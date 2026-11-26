"""Feature and representation selection for a Mars analog search."""

import json
import re
from pathlib import Path

from .feature_selection import choose_features
from .representation_selection import choose_representations

CATALOG_DIR = Path(__file__).with_name("catalog")

__all__ = [
    "choose_features",
    "family_phrases",
    "choose_representations",
    "select_features_and_representations",
]


def select_features_and_representations(
    mars_longitude: float,
    mars_latitude: float,
    objective: str,
    *,
    score_documents=None,
    generate=None,
    available=None,
) -> dict[str, list[dict]]:
    """Recommend comparison and Earth filter fields for a Mars objective."""
    if not -180 <= mars_longitude <= 180 or not -90 <= mars_latitude <= 90:
        raise ValueError("Mars longitude must be within ±180° and latitude within ±90°")

    concepts = choose_features(objective, score_documents=score_documents)
    selected = representation_families(concepts, available=available)
    return choose_representations(
        objective,
        mars_latitude,
        mars_longitude,
        selected["comparisons"],
        selected["filters"],
        generate=generate,
    )


def representation_families(concepts, *, available=None):
    selected = {}
    for output_key, mapping_name, menu_name in (
        ("comparisons", "concept_families.json", "comparison_families.json"),
        ("filters", "earth_filter_concepts.json", "filter_families.json"),
    ):
        mapping = json.loads((CATALOG_DIR / mapping_name).read_text(encoding="utf-8"))
        family_ids = sorted({family for concept in concepts for family in mapping.get(concept, [])})
        catalog = json.loads((CATALOG_DIR / menu_name).read_text(encoding="utf-8"))
        selected[output_key] = {family: catalog[family] for family in family_ids
                                if available is not None or not catalog[family].get("requires_prepared_data")}

    if available is not None:
        for key, families in selected.items():
            selected[key] = {
                fid: {**family, "options": options}
                for fid, family in families.items()
                if (options := [option for option in family["options"]
                                if option["header"] in available[key]])
            }
    return selected


def family_phrases(objective, concepts):
    """Map each family id to the words in the question that led to it.

    A family's phrase is the longest concept alias found in the objective for
    any of its selected concepts. Families chosen without a matching alias
    (added by related-concept links) are absent: the viewer shows those as
    inferred.
    """
    aliases = json.loads((CATALOG_DIR / "concepts.json").read_text(encoding="utf-8"))["concepts"]
    phrases = {}
    for mapping_name in ("concept_families.json", "earth_filter_concepts.json"):
        mapping = json.loads((CATALOG_DIR / mapping_name).read_text(encoding="utf-8"))
        for concept in concepts:
            words = sorted(aliases.get(concept, {}).get("aliases", []), key=len, reverse=True)
            found = next((m for w in words if (m := re.search(rf"(?<!\w){re.escape(w)}(?!\w)", objective, re.I))), None)
            if found:
                for family in mapping.get(concept, []):
                    if len(found.group(0)) > len(phrases.get(family, "")):
                        phrases[family] = found.group(0)
    return phrases
