"""Extend a frozen candidate/reference bundle with audited, pinned Starman tables.

Run in the existing research environment (NumPy, PyArrow); no serving dependency
is added. Input receipt records every current shard's local path and SHA-256.
"""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import re

import numpy as np
import pyarrow as pa
import pyarrow.parquet as pq

from src.backend.display_catalog import metadata


CATEGORIES = {'geomorphon_major', 'lc_major', 'dune_type', 'dominant_mapped_unit', 'broad_age_class', 'feature_type', 'feature_class',
              'LithMajor', 'LithMinor', 'LithCntact', 'EonMaxMjr', 'EonMinMjr',
              'EonMaxMnr', 'EonMinMnr', 'EraMaxMjr', 'EraMinMjr', 'EraMaxMnr',
              'EraMinMnr', 'PrdMaxMjr', 'PrdMinMjr', 'PrdMaxMnr', 'PrdMinMnr',
              'PrdContact', 'CntryMajor', 'CntryMinor'}

BOOKKEEPING = {
    'region_id', 'planet', 'grid_version', 'feature_version', 'layer_version',
    'source', 'source_url', 'source_checksum', 'code_version', 'produced_at',
    'band', 'column', 'version', 'source_version', 'quality_flags', 'interp_flag',
    'H3_Address', 'source_product', 'layer', 'computed_at',
}
REVIEWED = {
    'terrain': {'elev_range', 'elev_range_robust', 'slope_mean', 'slope_median',
                'slope_std', 'slope_p90', 'slope_p99', 'slope_frac_gt_2',
                'slope_frac_gt_5', 'slope_frac_gt_10', 'slope_frac_gt_20',
                'slope_frac_gt_30', 'roughness_detrended_std', 'local_relief_1km'},
    'mcd': {'tsurf_mean_K'},
    'era5_tsurf': {'tsurf_mean_K'},
    'geomorphometry': {'tri_p50', 'tri_p90', 'tpi_mean', 'tpi_p10', 'tpi_p90'},
}


def aligned_rows(source_ids, wanted):
    """Return target and source indices for an exact ID join; absent IDs stay null."""
    order = np.argsort(source_ids)
    sorted_ids = source_ids[order]
    if len(sorted_ids) > 1 and np.any(sorted_ids[1:] == sorted_ids[:-1]):
        raise ValueError('Duplicate source region IDs')
    positions = np.searchsorted(sorted_ids, wanted)
    valid = positions < len(sorted_ids)
    targets = np.flatnonzero(valid)
    targets = targets[sorted_ids[positions[targets]] == wanted[targets]]
    return targets, order[positions[targets]]


def main(receipt_path, base, reference_plan, output):
    receipt = json.loads(receipt_path.read_text())
    manifest = json.loads((base / 'manifest.json').read_text())
    if receipt['revision'] != manifest['starman_revision']:
        raise ValueError('Base bundle and source receipt must use the same pinned revision')
    output.mkdir(parents=True, exist_ok=False)
    for path in base.glob('*.npy'):
        if not path.name.startswith('filter_'):
            (output / path.name).symlink_to(path.resolve())
    earth_ids = np.load(base / 'earth_ids.npy', mmap_mode='r')
    plan = json.loads(reference_plan.read_text())
    if plan['revision'] != receipt['revision'] or plan['grid_version'] != manifest['grid_version']:
        raise ValueError('Reference plan revision/grid mismatch')
    # Reference row order matches the original builder: shard order, then plan order.
    refs = np.array(plan['reference_ids'])
    ref_groups = np.array([int(x[2:6]) // 100 for x in refs])
    refs = np.concatenate([refs[ref_groups == shard] for shard in plan['earth_shards']])
    np.save(output / 'reference_ids.npy', refs, allow_pickle=False)
    earth_groups = np.fromiter((int(x[2:6]) // 100 for x in earth_ids), dtype=np.int16)
    earth_positions = {int(g): np.flatnonzero(earth_groups == g) for g in np.unique(earth_groups)}
    ref_groups = np.fromiter((int(x[2:6]) // 100 for x in refs), dtype=np.int16)
    ref_positions = {int(g): np.flatnonzero(ref_groups == g) for g in np.unique(ref_groups)}
    mars_counts = np.load(base / 'mars_counts.npy')
    mars_offsets = np.r_[0, np.cumsum(mars_counts)]
    tables = receipt['tables']
    # Duplicate native names from different sources must never silently overwrite.
    occurrences = Counter()
    for path, entry in tables.items():
        if entry['current'] and path.startswith(('layers/', 'terrain/')):
            planet = re.search(r'planet=([^/]+)', path)[1]
            for field in entry['schemas'][0]:
                if field['name'] not in BOOKKEEPING:
                    occurrences[(planet, field['name'])] += 1
    manifest['filter_headers'] = []
    manifest['filter_choices'] = {}
    manifest['filter_counts'] = {}
    manifest['context_fields'] = {'earth': {}, 'mars': {}}
    manifest['field_metadata'] = {}
    audit = {'repo': receipt['repo'], 'revision': receipt['revision'], 'tables': [], 'fields': []}
    original = set(manifest['tolerances'])
    candidates = {}
    for path, entry in tables.items():
        reason = None
        if not entry['current']:
            reason = 'Superseded version; historical data retained only in source repository'
        elif not path.startswith(('layers/', 'terrain/')):
            reason = 'Not an aligned per-cell measurement table; native grid/site/window metadata only'
        elif len(entry['schemas']) != 1:
            reason = 'Inconsistent shard schemas; requires explicit migration'
        schema_fields = entry['schemas'][0]
        if not reason and 'region_id' not in {f['name'] for f in schema_fields}:
            reason = 'No region_id join; native table requires a reviewed spatial mapping'
        audit['tables'].append({'path': path, 'files': entry['files'], 'reason': reason})
        if reason:
            for field in schema_fields:
                audit['fields'].append({'table': path, 'column': field['name'], 'status': 'hidden', 'reason': reason})
            continue
        planet = re.search(r'planet=([^/]+)', path)[1]
        layer_match = re.search(r'layer=([^/]+)', path)
        layer = layer_match[1] if layer_match else 'terrain'
        size = len(earth_ids) if planet == 'earth' else int(mars_offsets[-1])
        first = pq.ParquetFile(receipt['files'][entry['files'][0]]['local']).schema_arrow
        fields = []
        for field in first:
            name = field.name
            if name in BOOKKEEPING or name.endswith('_status'):
                audit['fields'].append({'table': path, 'column': name, 'status': 'metadata', 'reason': 'Identity, provenance or validity metadata; applied during preparation where relevant'})
                continue
            numeric = pa.types.is_integer(field.type) or pa.types.is_floating(field.type) or pa.types.is_boolean(field.type)
            categorical = name in CATEGORIES
            if not numeric and not categorical:
                audit['fields'].append({'table': path, 'column': name, 'status': 'hidden', 'reason': 'Non-numeric native context; not configured for numeric filtering/scoring'})
                continue
            header = f'{layer}__{name}' if occurrences[(planet, name)] > 1 else name
            if '/extra=' in path:
                header = f'{layer}__{name}'
            values = np.lib.format.open_memmap(output / f'context_{planet}_{header}.npy', mode='w+', dtype=np.float64, shape=(size,))
            values[:] = np.nan
            reference = np.full(len(refs), np.nan) if planet == 'earth' and name in REVIEWED.get(layer, ()) else None
            fields.append((name, header, values, reference))
        vocabularies = {name: [] for name, _, _, _ in fields if name in CATEGORIES}
        for relative in entry['files']:
            record = receipt['files'][relative]
            source = Path(record['local'])
            with source.open('rb') as stream:
                if hashlib.file_digest(stream, 'sha256').hexdigest() != record['sha256']:
                    raise ValueError(f'Source hash changed: {relative}')
            table = pq.ParquetFile(source).read()
            if 'grid_version' in table.column_names and set(table['grid_version'].unique().to_pylist()) != {manifest['grid_version']}:
                raise ValueError(f'Grid version mismatch: {relative}')
            ids = np.array(table['region_id'].to_pylist(), dtype=str)
            group = int(re.search(r'band_group=(\d+)', relative)[1])
            if planet == 'earth':
                target_positions = earth_positions.get(group, np.array([], dtype=int))
                a, rows = aligned_rows(ids, earth_ids[target_positions])
                targets = target_positions[a]
                rpos = ref_positions.get(group, np.array([], dtype=int))
                a, rrows = aligned_rows(ids, refs[rpos])
                rtargets = rpos[a]
            else:
                if 'band' in table.column_names and 'column' in table.column_names:
                    bands, cols = table['band'].to_numpy(), table['column'].to_numpy()
                else:
                    bands = np.fromiter((int(x.split('_')[1]) for x in ids), dtype=int)
                    cols = np.fromiter((int(x.split('_')[2]) for x in ids), dtype=int)
                if ((bands < 0) | (bands >= len(mars_counts))).any() or ((cols < 0) | (cols >= mars_counts[bands])).any():
                    raise ValueError(f'Invalid Mars cell: {relative}')
                targets = mars_offsets[bands] + cols
                if len(np.unique(targets)) != len(targets):
                    raise ValueError(f'Duplicate Mars cells: {relative}')
                rows = np.arange(len(ids))
            for name, header, values, reference in fields:
                if name in vocabularies:
                    native = table[name].to_pylist()
                    vocabulary = vocabularies[name]
                    labels = [str(value) if value is not None else '' for value in native]
                    if name in {'geomorphon_major', 'lc_major'}:
                        labels = ['' if value in {'0', '0.0'} else value for value in labels]
                    vocabulary.extend(sorted(set(labels) - set(vocabulary) - {''}))
                    lookup = {value: float(i) for i, value in enumerate(vocabulary)}
                    raw = np.array([lookup.get(value, np.nan) for value in labels])
                else:
                    raw = table[name].to_numpy().astype(float)
                status = name + '_status'
                if status in table.column_names:
                    codes = np.array(table[status].to_pylist())
                    raw[codes != (0 if codes.dtype.kind in 'iuf' else 'ok')] = np.nan
                values[targets] = raw[rows]
                if reference is not None:
                    reference[rtargets] = raw[rrows]
        for name, header, values, reference in fields:
            values.flush()
            finite = np.isfinite(values)
            count = int(finite.sum())
            is_pair = name in REVIEWED.get(layer, ())
            field_audit = {'table': path, 'planet': planet, 'column': name, 'header': header,
                           'finite': count, 'missing': size - count,
                           'status': 'context' if count else 'hidden',
                           'reason': 'No reviewed cross-planet pair; native values only' if count else 'No usable values in configured population'}
            audit['fields'].append(field_audit)
            if count:
                manifest['context_fields'][planet][header] = {'layer': layer, 'column': name, 'table': path}
                if name in vocabularies:
                    manifest['context_fields'][planet][header]['categories'] = vocabularies[name]
                manifest['field_metadata'][header] = {'header': header, 'source': layer, 'native_column': name,
                                                     'planets': sorted(set(manifest['field_metadata'].get(header, {}).get('planets', [])) | {planet}),
                                                     'data_type': 'categorical' if name in CATEGORIES else 'boolean' if pa.types.is_boolean(first.field(name).type) else 'continuous'}
                if planet == 'earth':
                    if name in vocabularies:
                        labels = vocabularies[name]
                        raw_filter = np.lib.format.open_memmap(output / f'filter_{header}.npy', mode='w+',
                            dtype=f'U{max(map(len, labels))}', shape=(size,))
                        raw_filter[:] = ''
                        vocabulary = np.array(labels)
                        for start in range(0, size, 100_000):
                            chunk = values[start:start + 100_000]
                            present = np.isfinite(chunk)
                            raw_filter[start:start + len(chunk)][present] = vocabulary[chunk[present].astype(int)]
                        present_codes = np.unique(values[np.isfinite(values)]).astype(int)
                        manifest['filter_choices'][header] = sorted(labels[i] for i in present_codes)
                        raw_filter.flush()
                        del raw_filter
                    else:
                        (output / f'filter_{header}.npy').symlink_to(f'context_earth_{header}.npy')
                    manifest['filter_headers'].append(header)
                    manifest['filter_counts'][header] = count
                    field_audit['status'] = 'filter/context'
            if is_pair and count:
                candidates.setdefault(name, {})[planet] = (header, reference, field_audit)
            del values, finite
        print('prepared', planet, layer, len(fields), flush=True)
    # Preserve existing transforms/scales; new reviewed single-variable blocks use
    # native units. In 1D Method D, the positive scale cancels against fitted variance.
    for name, pair in candidates.items():
        if name in original:
            for _, _, field in pair.values():
                field['status'] = 'comparison and native use'
                field['reason'] = 'Existing verified terrain transform and fixed reference retained'
            continue
        if set(pair) != {'earth', 'mars'}:
            continue
        reference = pair['earth'][1]
        valid = reference[np.isfinite(reference)]
        if len(valid) < 2 or np.var(valid) <= 1e-9:
            for _, _, field in pair.values():field['reason'] = 'Degenerate or insufficient fixed Earth reference; native use only'
            continue
        for planet in ('earth', 'mars'):
            (output / f'{planet}_{name}.npy').symlink_to(f'context_{planet}_{pair[planet][0]}.npy')
            pair[planet][2]['status'] = 'comparison and native use'
            pair[planet][2]['reason'] = ('Reviewed mean surface-temperature pair; Earth ERA5 climatology QA passed; usable fixed Earth reference'
                                         if name == 'tsurf_mean_K' else 'Reviewed shared terrain operator; usable fixed Earth reference')
        np.save(output / f'reference_{name}.npy', reference, allow_pickle=False)
        manifest['tolerances'][name] = 1.0
    for header, field in manifest['field_metadata'].items():
        native = metadata(field['native_column'])
        sources = {planet: {**entries[header], 'revision': receipt['revision']}
                   for planet, entries in manifest['context_fields'].items() if header in entries}
        capabilities = ['context']
        if header in manifest['filter_headers']:capabilities.append('filter')
        if header in manifest['tolerances']:capabilities.append('comparison')
        enriched = {**native, **field, 'sources': sources, 'capabilities': capabilities}
        if native['data_type'] != 'unknown' and field['data_type'] not in {'categorical', 'boolean'}:
            enriched['data_type'] = native['data_type']
        if native['data_type'] == 'unknown':
            enriched.update(label=field['native_column'].replace('_', ' '),
                            unit='' if field['data_type'] in {'categorical', 'boolean'} else 'native units',
                            category=field['source'], description='Native source measurement; no reviewed cross-planet pair.')
        if field['native_column'] in {'tri_p50', 'tri_p90', 'tpi_mean', 'tpi_p10', 'tpi_p90'}:
            enriched['unit'] = 'm'
        manifest['field_metadata'][header] = enriched
    manifest['source_receipt_sha256'] = hashlib.sha256(receipt_path.read_bytes()).hexdigest()
    manifest['integration_version'] = 'starman-configured-v1'
    manifest['reference_policy'] = 'Existing frozen terrain Earth reference and candidate pool; each feature requires finite input, fixed reference fit and reviewed pair'
    manifest['filter_headers'] = sorted(set(manifest['filter_headers']))
    (output / 'manifest.json').write_text(json.dumps(manifest, indent=2)+'\n')
    (output / 'source_fields.json').write_text(json.dumps(manifest['field_metadata'], indent=2)+'\n')
    (output / 'audit.json').write_text(json.dumps(audit, indent=2)+'\n')
    (output / 'source-receipt.json').write_text(receipt_path.read_text())
    print('DONE', len(manifest['tolerances']), len(manifest['filter_headers']), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    for argument in ('receipt', 'base', 'reference_plan', 'output'):parser.add_argument(argument, type=Path)
    args = parser.parse_args()
    main(args.receipt, args.base, args.reference_plan, args.output)
