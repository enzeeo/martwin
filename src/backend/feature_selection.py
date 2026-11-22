"""Select physical concepts using the fixed INDUS and guarded ontology workflow."""

from functools import lru_cache
import hashlib
import json
import os
from pathlib import Path

from . import _feature_rules as rules

MODEL_ID = "nasa-impact/nasa-ibm-st.38m"
MODEL_REVISION = "32f8f80c7f751e18d167472fa607415c0afc6156"
THRESHOLD = 0.65
CATALOG_DIR = Path(__file__).parent / "catalog"
DEFAULT_ENCODER_DIR = Path(__file__).resolve().parents[2] / "data" / "encoder"


@lru_cache(maxsize=1)
def _catalog_data():
    def read(name):
        return json.loads((CATALOG_DIR / name).read_text())

    catalog = read("concepts.json")
    cards = read("ontology_cards.json")
    objectives = read("reference_objectives.json")
    documents = objectives + [
        {"doc_id": "external:" + card["id"], "kind": "external", "text": card["text"]}
        for card in cards
    ]
    return catalog, cards, objectives, documents


def _sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


class OnnxEncoder:
    """The pinned INDUS encoder exported by tools/export_encoder_onnx.py.

    Reproduces the model's sentence-transformers pipeline (Transformer, CLS
    pooling, Normalize) with onnxruntime and tokenizers, without PyTorch.
    """

    def __init__(self, directory: Path):
        import onnxruntime
        from tokenizers import Tokenizer

        info_path = directory / "encoder.json"
        if not info_path.is_file():
            raise RuntimeError(
                f"Encoder not found in {directory}. Run tools/export_encoder_onnx.py "
                "or set MARTWIN_ENCODER_DIR."
            )
        info = json.loads(info_path.read_text())
        if (info.get("model_id"), info.get("model_revision")) != (MODEL_ID, MODEL_REVISION):
            raise RuntimeError("The exported encoder does not match the pinned INDUS revision.")
        model_path = directory / "model.onnx"
        tokenizer_path = directory / "tokenizer.json"
        for path, key in ((model_path, "model_sha256"), (tokenizer_path, "tokenizer_sha256")):
            if _sha256(path) != info.get(key):
                raise RuntimeError(f"The exported encoder failed its checksum: {path.name}.")
        options = onnxruntime.SessionOptions()
        options.intra_op_num_threads = 2
        options.inter_op_num_threads = 1
        self.session = onnxruntime.InferenceSession(
            str(model_path), options, providers=["CPUExecutionProvider"]
        )
        self.tokenizer = Tokenizer.from_file(str(tokenizer_path))
        self.tokenizer.no_truncation()
        self.tokenizer.no_padding()
        self.dimension = int(info["dimension"])
        self.pad_id = self.tokenizer.token_to_id("<pad>")

    def token_lengths(self, texts):
        return [len(item.ids) for item in self.tokenizer.encode_batch(texts)]

    def encode(self, texts, batch_size=16):
        import numpy as np

        rows = []
        for start in range(0, len(texts), batch_size):
            batch = self.tokenizer.encode_batch(
                [text.strip() for text in texts[start:start + batch_size]]
            )
            width = max(len(item.ids) for item in batch)
            ids = np.full((len(batch), width), self.pad_id, dtype=np.int64)
            mask = np.zeros((len(batch), width), dtype=np.int64)
            for row, item in enumerate(batch):
                ids[row, :len(item.ids)] = item.ids
                mask[row, :len(item.ids)] = 1
            rows.append(self.session.run(["embedding"], {"input_ids": ids, "attention_mask": mask})[0])
        return np.concatenate(rows).astype(np.float32, copy=False)


@lru_cache(maxsize=1)
def _model_and_matrix():
    model = OnnxEncoder(Path(os.environ.get("MARTWIN_ENCODER_DIR") or DEFAULT_ENCODER_DIR))
    documents = _catalog_data()[3]
    matrix = _encode(model, [document["text"] for document in documents])
    return model, matrix


def _encode(model, texts):
    import numpy as np

    if not texts:
        return np.empty((0, model.dimension), dtype=np.float32)
    lengths = model.token_lengths(texts)
    if max(lengths) > 256:
        raise ValueError(
            "Input exceeds fixed token support; no silent truncation: "
            + str(max(lengths))
        )
    return model.encode(texts)


def _score_documents(views, documents):
    import numpy as np

    model, matrix = _model_and_matrix()
    if not views:
        return {"scores": {d["doc_id"]: -1.0 for d in documents}}
    similarities = _encode(model, ["query: " + view for view in views]) @ matrix.T
    if not np.isfinite(similarities).all():
        raise ValueError("Nonfinite encoder scores")
    return {
        "scores": {
            d["doc_id"]: float(score)
            for d, score in zip(documents, similarities.max(axis=0))
        },
    }


def choose_features(objective: str, *, score_documents=None) -> list[str]:
    catalog, cards, objectives, documents = _catalog_data()
    scope = rules.scope_objective(objective, catalog)
    excluded = set(scope["excluded_concepts"])
    keep = rules.candidates(scope["positive_text"], catalog) - excluded
    scores = (score_documents or _score_documents)(scope["views"], documents)["scores"]

    for document in objectives:
        if scores[document["doc_id"]] >= THRESHOLD:
            keep.update(set(document["concept_ids"]) - excluded)
    for card in cards:
        if card["pack"] not in ("SWEET", "GEO", "MEPAG"):
            continue
        aliases = any(
            rules.contains(alias, scope["positive_text"]) for alias in card["aliases"]
        )
        if scores["external:" + card["id"]] < THRESHOLD and not aliases:
            continue
        if not rules.matches_conditions(card["conditions"], scope["positive_text"]):
            continue
        keep.update(set(card["anchor_concepts"]) - excluded)
        for link in card["links"]:
            if link["target_concept"] not in excluded and rules.matches_conditions(
                link["conditions"], scope["positive_text"]
            ):
                keep.add(link["target_concept"])
    assert keep <= set(catalog["concepts"])
    return sorted(keep)
