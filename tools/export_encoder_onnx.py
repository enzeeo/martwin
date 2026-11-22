"""Export the pinned INDUS encoder to ONNX so serving needs no PyTorch.

Run once with the export dependencies (PyTorch, Transformers):

    uv run --no-sync --group export python tools/export_encoder_onnx.py data/encoder

The graph takes `input_ids` and `attention_mask` and returns the normalized CLS
embedding, matching the model's sentence-transformers modules
(Transformer -> CLS pooling -> Normalize). The output directory receives
`model.onnx`, `tokenizer.json` and `encoder.json` (provenance and checksums).
"""

import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from src.backend.feature_selection import MODEL_ID, MODEL_REVISION  # noqa: E402


def main(output):
    import torch
    from huggingface_hub import snapshot_download
    from transformers import AutoModel, AutoTokenizer

    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    source = Path(snapshot_download(MODEL_ID, revision=MODEL_REVISION))
    pooling = json.loads((source / "1_Pooling" / "config.json").read_text())
    modules = [m["type"].rsplit(".", 1)[-1] for m in json.loads((source / "modules.json").read_text())]
    if modules != ["Transformer", "Pooling", "Normalize"] or not pooling.get("pooling_mode_cls_token"):
        raise SystemExit(f"Unexpected modules {modules} or pooling {pooling}; export would not match.")

    model = AutoModel.from_pretrained(source, torch_dtype=torch.float32).float().eval()

    class Encoder(torch.nn.Module):
        def __init__(self, base):
            super().__init__()
            self.base = base

        def forward(self, input_ids, attention_mask):
            hidden = self.base(input_ids=input_ids, attention_mask=attention_mask).last_hidden_state
            return torch.nn.functional.normalize(hidden[:, 0], p=2, dim=1)

    example = (torch.tensor([[0, 100, 2], [0, 2, 1]]), torch.tensor([[1, 1, 1], [1, 1, 0]]))
    target = output / "model.onnx"
    torch.onnx.export(
        Encoder(model),
        example,
        str(target),
        input_names=["input_ids", "attention_mask"],
        output_names=["embedding"],
        dynamic_axes={"input_ids": {0: "batch", 1: "tokens"},
                      "attention_mask": {0: "batch", 1: "tokens"},
                      "embedding": {0: "batch"}},
        opset_version=17,
        dynamo=False,
    )
    # Save the tokenizer exactly as the PyTorch path built it. The repository's own
    # tokenizer.json splits some words differently from its vocab.json/merges.txt,
    # and the locked Transformers version builds the served tokenizer from the latter.
    AutoTokenizer.from_pretrained(source).backend_tokenizer.save(str(output / "tokenizer.json"))
    digest = hashlib.sha256(target.read_bytes()).hexdigest()
    tokenizer_digest = hashlib.sha256((output / "tokenizer.json").read_bytes()).hexdigest()
    (output / "encoder.json").write_text(json.dumps({
        "model_id": MODEL_ID,
        "model_revision": MODEL_REVISION,
        "license": "apache-2.0",
        "pooling": "cls",
        "normalized": True,
        "dimension": model.config.hidden_size,
        "model_sha256": digest,
        "tokenizer_sha256": tokenizer_digest,
    }, indent=2) + "\n")
    print(f"Wrote {target} ({target.stat().st_size / 1e6:.0f} MB), sha256 {digest}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("usage: export_encoder_onnx.py OUTPUT_DIR")
    main(sys.argv[1])
