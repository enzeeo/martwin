import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from .feature_selection import MODEL_ID, MODEL_REVISION, OnnxEncoder, _encode


def write_encoder(directory, **overrides):
    (directory / "model.onnx").write_bytes(b"model")
    (directory / "tokenizer.json").write_bytes(b"tokenizer")
    info = {
        "model_id": MODEL_ID,
        "model_revision": MODEL_REVISION,
        "dimension": 576,
        "model_sha256": hashlib.sha256(b"model").hexdigest(),
        "tokenizer_sha256": hashlib.sha256(b"tokenizer").hexdigest(),
        **overrides,
    }
    (directory / "encoder.json").write_text(json.dumps(info))


class OnnxEncoderGuards(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.directory = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def test_missing_encoder_is_a_configuration_error(self):
        with self.assertRaisesRegex(RuntimeError, "Encoder not found"):
            OnnxEncoder(self.directory)

    def test_other_model_revision_is_rejected(self):
        write_encoder(self.directory, model_revision="0" * 40)
        with self.assertRaisesRegex(RuntimeError, "pinned INDUS revision"):
            OnnxEncoder(self.directory)

    def test_modified_model_fails_checksum(self):
        write_encoder(self.directory)
        (self.directory / "model.onnx").write_bytes(b"changed")
        with self.assertRaisesRegex(RuntimeError, "checksum: model.onnx"):
            OnnxEncoder(self.directory)

    def test_modified_tokenizer_fails_checksum(self):
        write_encoder(self.directory)
        (self.directory / "tokenizer.json").write_bytes(b"changed")
        with self.assertRaisesRegex(RuntimeError, "checksum: tokenizer.json"):
            OnnxEncoder(self.directory)


class EncodeLengthGuard(unittest.TestCase):
    class Model:
        dimension = 4

        def __init__(self, length):
            self.length = length

        def token_lengths(self, texts):
            return [self.length for _ in texts]

        def encode(self, texts):
            return [[1.0, 0.0, 0.0, 0.0] for _ in texts]

    def test_overlong_input_is_rejected_without_truncation(self):
        with self.assertRaisesRegex(ValueError, "^Input exceeds fixed token support;"):
            _encode(self.Model(257), ["text"])

    def test_limit_is_inclusive(self):
        self.assertEqual(len(_encode(self.Model(256), ["text"])), 1)

    def test_empty_input_keeps_dimension(self):
        self.assertEqual(_encode(self.Model(1), []).shape, (0, 4))


if __name__ == "__main__":
    unittest.main()
