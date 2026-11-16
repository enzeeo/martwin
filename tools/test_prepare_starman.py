import hashlib
import importlib.util
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

import numpy as np
import pyarrow as pa
import pyarrow.parquet as pq

spec = importlib.util.spec_from_file_location('prepare', Path(__file__).with_name('prepare_starman.py'))
prepare = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prepare)


class PreparationTests(unittest.TestCase):
    def test_join_is_by_id_and_does_not_fill_missing(self):
        target, source = prepare.aligned_rows(np.array(['b', 'a']), np.array(['a', 'c', 'b']))
        np.testing.assert_array_equal(target, [0, 2])
        np.testing.assert_array_equal(source, [1, 0])
        with self.assertRaisesRegex(ValueError, 'Duplicate'):
            prepare.aligned_rows(np.array(['a', 'a']), np.array(['a']))

    def test_prepares_tri_reference_and_masks_latent_status(self):
        with TemporaryDirectory() as folder:
            root = Path(folder); base = root / 'base'; base.mkdir()
            manifest = {'starman_revision': 'pin', 'grid_version': 'v1', 'reference_id': 'fixed',
                        'reference_count': 2, 'tolerances': {}}
            (base / 'manifest.json').write_text(json.dumps(manifest))
            for key, values in {'earth_ids': ['E_0000_00000', 'E_0000_00001'],
                                'earth_edges': [-90, 90], 'earth_counts': [2],
                                'mars_edges': [-90, 90], 'mars_counts': [2]}.items():
                np.save(base / (key + '.npy'), values)
            plan = {'revision': 'pin', 'grid_version': 'v1', 'earth_shards': [0],
                    'reference_ids': ['E_0000_00000', 'E_0000_00001']}
            (root / 'plan.json').write_text(json.dumps(plan))
            receipt = {'revision': 'pin', 'repo': 'fixture', 'files': {}, 'tables': {}}
            for planet in ('earth', 'mars'):
                table_path = f'layers/planet={planet}/layer=geomorphometry/version=geomorphometry-v0.1'
                relative = table_path + '/band_group=000.parquet'
                prefix = planet[0].upper()
                table = pa.table({'region_id': [f'{prefix}_0000_00001', f'{prefix}_0000_00000'],
                                  'grid_version': ['v1', 'v1'], 'tri_p50': [4., 2.],
                                  'geomorphon_major': [3, 0], 'LithMajor': ['Basalt', None],
                                  'relative_terrain_texture': [0.4, 0.2],
                                  'relative_terrain_texture_status': [0, 1]})
                source = root / (planet + '.parquet'); pq.write_table(table, source)
                receipt['files'][relative] = {'local': str(source), 'sha256': hashlib.sha256(source.read_bytes()).hexdigest()}
                receipt['tables'][table_path] = {'current': True, 'files': [relative],
                    'schemas': [[{'name': f.name, 'type': str(f.type)} for f in table.schema]]}
            (root / 'receipt.json').write_text(json.dumps(receipt))
            output = root / 'output'
            prepare.main(root / 'receipt.json', base, root / 'plan.json', output)
            np.testing.assert_array_equal(np.load(output / 'earth_tri_p50.npy'), [2, 4])
            np.testing.assert_array_equal(np.load(output / 'reference_tri_p50.npy'), [2, 4])
            np.testing.assert_array_equal(np.load(output / 'mars_tri_p50.npy'), [2, 4])
            raw = np.load(output / 'filter_relative_terrain_texture.npy')
            self.assertTrue(np.isnan(raw[0])); self.assertEqual(raw[1], .4)
            final = json.loads((output / 'manifest.json').read_text())
            self.assertEqual(final['tolerances'], {'tri_p50': 1})
            self.assertEqual(np.load(output / 'filter_geomorphon_major.npy').tolist(), ['', '3'])
            self.assertEqual(np.load(output / 'filter_LithMajor.npy').tolist(), ['', 'Basalt'])
            self.assertEqual(final['field_metadata']['LithMajor']['data_type'], 'categorical')
            self.assertEqual(final['field_metadata']['tri_p50']['unit'], 'm')
            self.assertNotIn('relative_terrain_texture', final['tolerances'])
