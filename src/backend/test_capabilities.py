import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

import numpy as np
from fastapi.testclient import TestClient

from . import representation_families
from .terrain import TerrainBackend
from .web import app


class CapabilityTests(unittest.TestCase):
    def setUp(self):
        self.folder = TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.path = Path(self.folder.name)
        (self.path / 'manifest.json').write_text(json.dumps({
            'tolerances': {'tri_p50': 1, 'tri_p90': 1, 'slope_mean': 1, 'dune_frac': 1},
            'reference_id': 'fixture', 'filter_headers': ['tree_frac', 'sand_pct', 'clay_pct'],
            'starman_revision': 'fixture',
        }))
        arrays = {'earth_ids': ['E_0000_00000', 'E_0000_00001'],
                  'earth_edges': [-90, 90], 'earth_counts': [2],
                  'mars_edges': [-90, 90], 'mars_counts': [2],
                  'filter_tree_frac': [0, .2], 'filter_sand_pct': [np.nan, np.nan],
                  'filter_clay_pct': [1]}
        for header in ('tri_p50', 'tri_p90', 'slope_mean', 'dune_frac'):
            arrays.update({f'earth_{header}': [1, 3], f'mars_{header}': [2, np.nan],
                           f'reference_{header}': [0, 2]})
        arrays['reference_tri_p90'] = [2, 2]
        arrays['earth_slope_mean'] = [1]
        for name, values in arrays.items():np.save(self.path / (name + '.npy'), values)
        self.backend = TerrainBackend(self.path)

    def test_broken_unreviewed_and_degenerate_inputs_are_hidden(self):
        self.assertEqual(self.backend.score_headers, {'tri_p50'})
        self.assertNotIn('sand_pct', self.backend.filter_headers)
        self.assertNotIn('clay_pct', self.backend.filter_headers)
        self.assertIn('tree_frac', self.backend.filter_headers)
        self.assertEqual(self.backend.target_headers(0, -90), {'tri_p50'})
        self.assertEqual(self.backend.target_headers(0, 90), set())

    def test_catalog_uses_loaded_bundle_and_hides_empty_families(self):
        with patch('src.backend.web.scoring_backend', return_value=self.backend):
            menu = TestClient(app).get('/api/catalog').json()
        self.assertEqual([f['feature_id'] for f in menu['comparisons']], ['surface_roughness'])
        self.assertEqual([o['header'] for o in menu['comparisons'][0]['options']], ['tri_p50'])
        self.assertNotIn('sand_pct', {o['header'] for o in menu['dataset_fields']})

    def test_no_backend_has_no_visible_options(self):
        with patch('src.backend.web.scoring_backend', return_value=None):
            menu = TestClient(app).get('/api/catalog').json()
        self.assertEqual(menu['comparisons'], [])
        self.assertEqual(menu['filters'], [])
        self.assertEqual(menu['dataset_fields'], [])

    def test_model_menus_are_restricted_before_generation(self):
        available = {'comparisons': {'tri_p50'}, 'filters': {'tree_frac'}}
        families = representation_families(['surface_roughness', 'slope'], available=available)
        self.assertEqual(list(families['comparisons']), ['surface_roughness'])
        for kind, values in families.items():
            for family in values.values():
                self.assertTrue(family['options'])
                self.assertTrue({o['header'] for o in family['options']} <= available[kind])
        request = {'longitude': -90, 'latitude': 0, 'objective': 'Compare rough terrain'}
        with (patch('src.backend.web.scoring_backend', return_value=self.backend),
              patch('src.backend.web.choose_features', return_value=['surface_roughness']),
              patch('src.backend.web.choose_representations', return_value={'comparisons': [], 'filters': []}) as choose):
            TestClient(app).post('/api/select/stream', json=request)
        for families in choose.call_args.args[3:5]:
            for family in families.values():
                self.assertTrue({o['header'] for o in family['options']} <= {'tri_p50', 'tree_frac'})

    def test_real_tri_request_scores_and_missing_target_is_rejected(self):
        request = {'longitude': -90, 'latitude': 0, 'objective': 'Compare rough terrain',
                   'comparisons': [{'feature_id': 'surface_roughness', 'header': 'tri_p50', 'weight': 1}],
                   'result_count': 2, 'min_separation_km': 0}
        with patch('src.backend.web.scoring_backend', return_value=self.backend):
            result = TestClient(app).post('/api/score', json=request)
            missing = TestClient(app).post('/api/score', json={**request, 'longitude': 90})
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.json()['n_scored'], 2)
        self.assertEqual(missing.status_code, 422)

    def test_catalog_hides_missing_target_measurements(self):
        with patch('src.backend.web.scoring_backend', return_value=self.backend):
            menu = TestClient(app).get('/api/catalog?latitude=0&longitude=90').json()
        self.assertEqual(menu['comparisons'], [])
