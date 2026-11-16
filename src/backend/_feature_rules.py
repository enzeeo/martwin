import re


def normalize(text):
    return re.sub(r"\s+", " ", re.sub(r"[-–—_/]", " ", str(text).casefold())).strip()


def contains(phrase, text):
    return bool(
        re.search(
            r"(?<!\w)" + re.escape(normalize(phrase)) + r"(?!\w)", normalize(text)
        )
    )


GENERAL_RULES = [
    (
        r"\b(?:consistent|uniform|gradual|gradually|smooth)\b.*\b(?:terrain|ground|landscape|changes|surface)",
        ["slope", "surface_roughness", "relief"],
        0.90,
    ),
    (
        r"\b(?:rover|navigation|wheels?|driving|traversability)\b",
        ["slope", "surface_roughness", "wheel_scale_obstacles"],
        0.84,
    ),
    (
        r"\b(?:easy|gentle|difficult|challenging)\b.*\b(?:terrain|ground|navigate|navigation|rover)",
        ["slope", "surface_roughness", "relief"],
        0.88,
    ),
    (
        r"\b(?:loose|sandy|bogged|sinkage|traction|slip)\b",
        ["soil_texture", "grain_size", "soil_bearing_strength"],
        0.88,
    ),
    (r"\bsediments?\b", ["grain_size", "soil_texture"], 0.75),
    (r"\b(?:ancient|former)\b.*\blake\b", ["geology", "mineralogy"], 0.82),
    (
        r"\b(?:old|ancient|former)\b.*\b(?:river|drainage|channels?|waterways)\b",
        ["channels", "landform"],
        0.87,
    ),
    (
        r"\b(?:temperature changes|thermal cycling|hot days|cold nights|heating and cooling|thermal stress|thermal environment)\b",
        ["surface_temperature"],
        0.94,
    ),
    (
        r"\b(?:little|few|minimal|sparse)\b.*\b(?:plants?|vegetation)\b",
        ["vegetation_cover"],
        0.94,
    ),
    (
        r"\b(?:human disturbance|human footprint|construction|development)\b",
        ["built_cover"],
        0.89,
    ),
    (
        r"\b(?:exposed|uncovered)\b.*\b(?:ground|surfaces?|rocks?|sediments?|geology)\b",
        ["bare_ground"],
        0.90,
    ),
    (
        r"\b(?:very dry|dry place|dry site|dry landscape|little moisture|arid|dry conditions|low moisture)\b",
        ["soil_moisture"],
        0.90,
    ),
    (r"\b(?:ground|buried|underground|subsurface) ice\b", ["ground_ice"], 0.94),
    (
        r"\b(?:good sediment|interesting sedimentary)\b",
        ["grain_size", "soil_texture"],
        0.72,
    ),
    (
        r"\b(?:terrain shape|shape of the ground|surrounding terrain|broad terrain|varied terrain)\b",
        ["landform", "slope", "relief", "surface_roughness"],
        0.84,
    ),
]


def explicit_exclusions(text, catalog):
    fragments = []
    for pattern in [
        r"\bignore\s+([^.;]+)",
        r"\bdo not (?:use|match|consider|select sites by)\s+([^.;]+)",
        r"\bwithout (?:using|matching|considering)\s+([^.;]+)",
        r"\bnot (?:interested in|by|matching)\s+([^.;]+)",
        r"\brather than\s+([^.;]+)",
    ]:
        for m in re.finditer(pattern, text, re.I):
            fragments.append(re.split(r"\bbut\b", m.group(1), flags=re.I)[0])
    for m in re.finditer(
        r"([^.;]+?)\b(?:is|are)\s+(?:unimportant|irrelevant)", text, re.I
    ):
        fragments.append(m.group(1))
    if re.search(
        r"\btrees\b.*\bacceptable\b|\bgreen\b|\bnot making the site look barren\b",
        text,
        re.I,
    ):
        fragments.append("vegetation trees shrubs grass ndvi")
    excluded = set()
    for frag in fragments:
        for cid, c in catalog["concepts"].items():
            if any(contains(a, frag) for a in c["aliases"]):
                excluded.add(cid)
        n = normalize(frag)
        if "terrain shape" in n or "shape of the ground" in n:
            excluded.update(
                [
                    "landform",
                    "slope",
                    "relief",
                    "surface_roughness",
                    "terrain_ruggedness",
                    "topographic_position",
                ]
            )
        if "vegetation" in n:
            excluded.update(
                [
                    "vegetation_cover",
                    "tree_cover",
                    "shrub_cover",
                    "grass_cover",
                    "crop_cover",
                    "moss_cover",
                    "mangrove_cover",
                    "vegetation_index",
                ]
            )
        if "rock composition" in n:
            excluded.update(["geology", "mineralogy"])
        if "rock chemistry" in n:
            excluded.add("mineralogy")
        if "colour" in n or "color" in n:
            excluded.add("albedo")
        if "altitude" in n or "absolute elevation" in n:
            excluded.add("elevation")
        if "snow" in n or "glaciers" in n:
            excluded.add("snow_cover")
        if "modern lake" in n:
            excluded.update(["open_water", "water_mask"])
    if re.search(r"does not need to have water flowing today", text, re.I):
        excluded.update(["open_water", "water_mask"])
    if re.search(r"not visible snow", text, re.I):
        excluded.add("snow_cover")
    return excluded


def candidates(text, catalog):
    """Return the frozen rule and ontology concept IDs after exclusions."""
    excluded = explicit_exclusions(text, catalog)
    selected = {
        concept_id
        for concept_id, concept in catalog["concepts"].items()
        if any(contains(alias, text) for alias in concept["aliases"])
    }
    for pattern, concept_ids, _weight in GENERAL_RULES:
        if re.search(pattern, normalize(text)):
            selected.update(concept_ids)
    for node in catalog["ontology"]:
        if any(contains(trigger, text) for trigger in node["triggers"]):
            for requirement in node["requirements"]:
                selected.update(requirement["concepts"])
    return selected - excluded


IGNORE = r"(?:ignore|disregard|do not (?:use|consider|match|compare|measure|include)|don't (?:use|consider|match|compare|measure|include|care about)|without (?:using|matching|considering)|no need to (?:use|consider|match|compare|measure|include)|not interested in|rather than|instead of)"

ACT = r"(?:study|investigate|compare|find|test|examine|explore|understand|measure|need|want|match|consider|use|seek|identify|avoid|exclude places|focus|look)"

VEGETATION = {
    "vegetation_cover",
    "tree_cover",
    "shrub_cover",
    "grass_cover",
    "crop_cover",
    "moss_cover",
    "mangrove_cover",
    "vegetation_index",
}

TERRAIN = {
    "landform",
    "slope",
    "relief",
    "surface_roughness",
    "terrain_ruggedness",
    "topographic_position",
}


def concept_mentions(text, catalog):
    out = {
        cid
        for cid, c in catalog["concepts"].items()
        if any(contains(a, text) for a in c["aliases"] + [c["label"]])
    }
    t = normalize(text)
    if re.search(r"\b(?:vegetation|plants?)\b", t):
        out |= VEGETATION
    if re.search(r"\b(?:terrain|topography|shape of the ground)\b", t):
        out |= TERRAIN
    if re.search(r"rock (?:chemistry|composition)|mineral composition", t):
        out.add("mineralogy")
    if re.search(
        r"\b(?:built up|buildings?|human disturbance|development|construction)\b", t
    ):
        out.add("built_cover")
    if re.search(r"\b(?:modern|present day|current)\b.*\b(?:lake|water)\b", t):
        out |= {"open_water", "water_mask"}
    if re.search(r"\b(?:altitude|absolute elevation)\b", t):
        out.add("elevation")
    return out & set(catalog["concepts"])


def scope_objective(text, catalog):
    if not isinstance(text, str) or not text.strip():
        raise ValueError("Query must be nonempty text")
    text = text.replace("\u2019", "'")
    # Do not split coordinated nouns: heating and cooling, rocky and sandy, sand and silt.
    boundary = (
        r"(?<=[.;!?])\s+|\b(?:but|however|whereas|while)\b|"
        r",\s*(?=(?:we\b|I\b|matching\b|" + IGNORE + r"|" + ACT + r"\b))|"
        r"\band\s+(?=(?:we\b|I\b|" + ACT + r"\b|" + IGNORE + r"\b))|"
        r"(?=\b" + IGNORE + r"\b)|"
        r"(?=\bnot visible\b)|(?=\beven if\b)"
    )
    parts = [
        x.strip(" ,.;")
        for x in re.split(boundary, text, flags=re.I)
        if x and x.strip(" ,.;")
    ]
    pos = []
    excluded = set()
    for part in parts:
        ignore = bool(re.match(r"^" + IGNORE + r"\b", part, re.I))
        priority = bool(
            re.search(
                r"\b(?:is|are|should be)\s+(?:irrelevant|unimportant|not relevant|not important)\b",
                part,
                re.I,
            )
        )
        elliptical = bool(re.search(r"\bis not\s*$", part, re.I))
        context = bool(
            re.search(
                r"\b(?:acceptable|does not matter|do not matter|should not count|shouldn\'t count|not count against|regardless of)\b",
                part,
                re.I,
            )
        )
        if re.search(r"^even if\b.*\b(?:green|trees|vegetation)\b", part, re.I):
            context = True
        no_water = bool(
            re.search(
                r"does not need to have water flowing today|not visible snow",
                part,
                re.I,
            )
        )
        if ignore or priority or elliptical or context or no_water:
            ids = concept_mentions(part, catalog)
            if re.search(r"\b(?:trees|green|vegetation)\b", part, re.I) and context:
                ids |= VEGETATION
            if no_water:
                ids |= (
                    {"snow_cover"}
                    if "snow" in part.casefold()
                    else {"open_water", "water_mask"}
                )
            excluded |= ids
        else:
            pos.append(part)
    # Preserve phrases within each positive clause for both frozen rules and semantic scoring.
    clean = "; ".join(pos)
    views = list(
        dict.fromkeys(
            ([clean] if clean else [])
            + pos
            + [
                x.strip()
                for p in pos
                for x in p.split(",")
                if len(p.split()) > 38 and x.strip()
            ]
        )
    )
    return {
        "positive_text": clean,
        "views": views,
        "excluded_concepts": sorted(excluded),
    }


def matches_conditions(cond, text):
    norm = normalize(text)
    return (
        not cond.get("any") or any(re.search(p, norm, re.I) for p in cond["any"])
    ) and all(re.search(p, norm, re.I) for p in cond.get("all", []))
