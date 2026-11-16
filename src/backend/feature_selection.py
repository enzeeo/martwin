"""Select physical concepts using the fixed INDUS and guarded ontology workflow."""

from functools import lru_cache
import json
from pathlib import Path

from . import _feature_rules as rules

MODEL_ID = "nasa-impact/nasa-ibm-st.38m"
MODEL_REVISION = "32f8f80c7f751e18d167472fa607415c0afc6156"
THRESHOLD = 0.65
CATALOG_DIR = Path(__file__).parent / "catalog"


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


@lru_cache(maxsize=1)
def _model_and_matrix():
    import torch
    from sentence_transformers import SentenceTransformer

    torch.set_num_threads(2)
    torch.manual_seed(42)
    model = SentenceTransformer(
        MODEL_ID,
        revision=MODEL_REVISION,
        device="cpu",
        trust_remote_code=False,
        model_kwargs={"torch_dtype": torch.float32},
    )
    model.float().eval()
    model.max_seq_length = 256
    documents = _catalog_data()[3]
    matrix = _encode(model, [document["text"] for document in documents])
    return model, matrix


def _encode(model, texts):
    import numpy as np

    if not texts:
        return np.empty((0, model.get_sentence_embedding_dimension()), dtype=np.float32)
    lengths = [
        len(ids)
        for ids in model.tokenizer(texts, add_special_tokens=True, truncation=False)[
            "input_ids"
        ]
    ]
    if max(lengths) > 256:
        raise ValueError(
            "Input exceeds fixed token support; no silent truncation: "
            + str(max(lengths))
        )
    return model.encode(
        texts,
        normalize_embeddings=True,
        convert_to_numpy=True,
        batch_size=16,
        show_progress_bar=False,
    )


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
