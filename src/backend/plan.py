"""The user-reviewed comparison plan that sits between selection and scoring."""

import json
from pathlib import Path
from typing import Annotated, Literal, Protocol

from pydantic import BaseModel, Field, StringConstraints, model_validator

from .continents import CONTINENTS, CONTINENT_POLICY, Continent
from .display_catalog import dataset_fields, metadata
from .terrain_features import REVIEWED_COMPARISONS

CATALOG_DIR = Path(__file__).with_name("catalog")
NUMERIC_TYPES = frozenset({"continuous", "fraction", "percentage", "ordinal", "count", "coordinate"})
Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
Number = Annotated[float, Field(strict=True, allow_inf_nan=False)]
Category = Annotated[str, Field(strict=True, min_length=1)]


def _load(name):
    return json.loads((CATALOG_DIR / name).read_text(encoding="utf-8"))


def filter_metadata(field, filter_headers, filter_choices):
    header = field["header"]
    available = header in filter_headers and "earth" in (field.get("planets") or ["earth"])
    details = {"filter_available": available}
    if available and header in filter_choices:
        details["choices"] = filter_choices[header]
    return details


def catalog_menu(filter_headers=(), *, score_headers=(), filter_choices=None, continent_filter_available=False) -> dict:
    """Everything a reviewer may add: comparison families and Earth filter families."""
    filter_choices = filter_choices or {}
    keep = ("header", "stat", "meaning", "compare_mode", "caution", "scoring_status")
    menu = {}
    for key, name in (("comparisons", "comparison_families.json"), ("filters", "filter_families.json")):
        menu[key] = []
        for fid, family in _load(name).items():
            options = []
            for option in family["options"]:
                if option["header"] not in (score_headers if key == "comparisons" else filter_headers):
                    continue
                field = metadata(option["header"])
                details = filter_metadata(field, filter_headers, filter_choices)
                if key == "comparisons":
                    details["score_available"] = field["header"] in score_headers
                options.append({item: option.get(item, "") for item in keep} | field | details)
            if options:
                menu[key].append({"feature_id": fid, "description": family["description"], "options": options})
    menu["dataset_fields"] = [
        field | filter_metadata(field, filter_headers, filter_choices)
        | {"score_available": field["header"] in score_headers}
        for field in dataset_fields() if field["header"] in filter_headers
    ]
    menu["continent_filter"] = {
        "available": continent_filter_available,
        "continents": CONTINENTS,
        "policy": CONTINENT_POLICY,
    }
    return menu


class PlanComparison(BaseModel):
    """One individual representation with a reviewed weight."""

    feature_id: Name
    header: Name
    weight: Annotated[float, Field(strict=True, gt=0, allow_inf_nan=False)]


class PlanFilter(BaseModel):
    feature_id: Name
    header: Name
    operator: Literal[">", ">=", "<", "<=", "==", "!=", "between", "in", "has_data", "missing"] | None = None
    value: Number | Category | Annotated[bool, Field(strict=True)] | Annotated[list[Category], Field(min_length=1)] | None = None
    value_max: Number | None = None

    @model_validator(mode="after")
    def _check_values(self):
        if self.operator in (None, "has_data", "missing"):
            if self.value is not None or self.value_max is not None:
                raise ValueError("This filter does not take a value.")
            return self
        data_type = metadata(self.header)["data_type"]
        if data_type in NUMERIC_TYPES:
            if self.operator == "between":
                if not isinstance(self.value, float) or self.value_max is None or self.value > self.value_max:
                    raise ValueError("Between requires a lower and upper numeric bound in ascending order.")
            elif self.operator == "in" or not isinstance(self.value, float) or self.value_max is not None:
                raise ValueError("This numeric filter requires a comparison operator and one number.")
        elif data_type == "categorical":
            scalar = self.operator in ("==", "!=") and isinstance(self.value, str)
            multiple = self.operator == "in" and isinstance(self.value, list)
            if not (scalar or multiple) or self.value_max is not None:
                raise ValueError("A categorical filter requires == or != with a category, or in with a list of categories.")
        elif data_type == "boolean":
            if self.operator != "==" or not isinstance(self.value, bool) or self.value_max is not None:
                raise ValueError("A boolean filter requires == with true or false.")
        else:
            raise ValueError("This field supports only has_data and missing.")
        return self


class ConfirmedPlan(BaseModel):
    longitude: Annotated[float, Field(strict=True, ge=-180, le=180, allow_inf_nan=False)]
    latitude: Annotated[float, Field(strict=True, ge=-90, le=90, allow_inf_nan=False)]
    objective: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=1500)]
    comparisons: Annotated[list[PlanComparison], Field(min_length=1, max_length=20)]
    filters: Annotated[list[PlanFilter], Field(max_length=20)] = []
    selected_continents: Annotated[list[Continent], Field(max_length=len(CONTINENTS))] | None = None
    result_count: Annotated[int, Field(strict=True, ge=1, le=100)] = 10
    min_separation_km: Annotated[float, Field(strict=True, ge=0, allow_inf_nan=False)] = 25

    @model_validator(mode="after")
    def _check_against_catalog(self):
        problems = []
        families = _load("comparison_families.json")
        seen = set()
        for item in self.comparisons:
            family = families.get(item.feature_id)
            if family is None:
                problems.append(f"Unknown comparison family {item.feature_id!r}.")
                continue
            if item.header in seen:
                problems.append(f"Representation {item.header!r} appears twice.")
            seen.add(item.header)
            options = {option["header"]: option for option in family["options"]}
            if item.header not in options:
                problems.append(f"{item.feature_id}: unknown representation {item.header!r}.")
            elif item.header not in REVIEWED_COMPARISONS:
                problems.append(f"{item.feature_id}: {item.header!r} cannot be scored with the prepared terrain data.")
        filter_families = _load("filter_families.json")
        for item in self.filters:
            if item.feature_id == "dataset_field":
                if not any(field["header"] == item.header and "earth" in (field.get("planets") or ["earth"])
                           for field in dataset_fields()):
                    problems.append(f"Unknown Earth field {item.header!r}.")
                continue
            family = filter_families.get(item.feature_id)
            if family is None or item.header not in {o["header"] for o in family["options"]}:
                problems.append(f"Unknown filter {item.feature_id!r}/{item.header!r}.")
        if problems:
            raise ValueError(" ".join(problems))
        return self

    def weights(self) -> dict[str, float]:
        return {item.header: item.weight for item in self.comparisons}


class ScoringBackend(Protocol):
    """Runs a confirmed plan against Earth and Mars data and returns a JSON-ready result."""

    def score(self, plan: ConfirmedPlan, weights: dict[str, float]) -> dict: ...
