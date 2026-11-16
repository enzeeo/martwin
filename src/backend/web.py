"""Serve the viewer and its selection API from one origin."""

import json
import logging
import os
from functools import lru_cache
from pathlib import Path
from threading import Lock
from typing import Annotated
from urllib.error import HTTPError, URLError

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, StringConstraints
from starlette.concurrency import run_in_threadpool

from . import choose_features, representation_families, select_features_and_representations
from .display_catalog import metadata
from .plan import ConfirmedPlan, ScoringBackend, catalog_menu, filter_metadata
from .representation_selection import choose_representations

app = FastAPI(title="Guardians of a Galaxy")
selection_lock = Lock()
scoring_lock = Lock()
logger = logging.getLogger(__name__)


@lru_cache(maxsize=1)
def _terrain_backend(directory: str) -> ScoringBackend:
    from .terrain import TerrainBackend

    return TerrainBackend(Path(directory))


def scoring_backend():
    default = Path(__file__).resolve().parents[2] / "data" / "scoring"
    directory = os.environ.get("GUARDIANS_TERRAIN_DIR") or (str(default) if (default / "manifest.json").is_file() else None)
    return _terrain_backend(directory) if directory else None


def prepared_filters(backend):
    try:
        return getattr(backend, "filter_headers", ()), getattr(backend, "filter_choices", {})
    except (RuntimeError, ValueError, OSError):
        return (), {}


def prepared_comparison_headers(request=None):
    try:
        backend = scoring_backend()
        if backend is None:
            return set()
        if request is not None:
            return backend.target_headers(request.latitude, request.longitude)
        return backend.score_headers
    except (RuntimeError, ValueError, OSError):
        return set()


def selection_availability(request):
    return {"comparisons": prepared_comparison_headers(request),
            "filters": prepared_filters(scoring_backend())[0]}


class SelectionRequest(BaseModel):
    longitude: Annotated[float, Field(strict=True, ge=-180, le=180, allow_inf_nan=False)]
    latitude: Annotated[float, Field(strict=True, ge=-90, le=90, allow_inf_nan=False)]
    objective: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=1500)]


@app.get("/healthz")
def health():
    return {"status": "ok"}


@app.post("/api/select")
def select(request: SelectionRequest):
    if not selection_lock.acquire(blocking=False):
        raise HTTPException(429, "A selection is already running. Try again shortly.")

    try:
        return select_features_and_representations(
            request.longitude, request.latitude, request.objective,
            available=selection_availability(request),
        )
    except (HTTPError, TimeoutError, URLError, ValueError, RuntimeError) as error:
        raise selection_error(error) from None
    finally:
        selection_lock.release()


def selection_error(error):
    if isinstance(error, HTTPError):
        if error.code == 429:
            return HTTPException(429, "OpenRouter has reached its request limit. Try again later.")
        if error.code in (404, 503):
            return HTTPException(503, "The configured OpenRouter model has no available endpoint.")
        logger.warning("OpenRouter request failed with status %s", error.code)
        return HTTPException(502, "The OpenRouter request failed.")
    if isinstance(error, (TimeoutError, URLError)):
        return HTTPException(504, "The selection service timed out or could not connect.")
    if isinstance(error, ValueError):
        if str(error).startswith("Input exceeds fixed token support;"):
            return HTTPException(422, "Shorten the research question and try again.")
        return HTTPException(502, "The model could not return a valid selection.")
    return HTTPException(503, "The selection service is unavailable. Check the server configuration.")


@app.post("/api/select/stream")
def select_stream(request: SelectionRequest):
    def event(stage, **data):
        return json.dumps({"stage": stage, **data}, ensure_ascii=False) + "\n"

    async def stream():
        if not selection_lock.acquire(blocking=False):
            yield event("error", detail="A selection is already running. Try again shortly.", status=429)
            return
        try:
            yield event("features")
            concepts = await run_in_threadpool(choose_features, request.objective)
            available = await run_in_threadpool(selection_availability, request)
            families = representation_families(concepts, available=available)
            yield event("features_selected", concepts=concepts, families={
                name: [{"feature_id": feature_id, "description": family["description"]}
                       for feature_id, family in available.items()]
                for name, available in families.items()
            })
            yield event("representations")
            result = await run_in_threadpool(
                choose_representations, request.objective, request.latitude, request.longitude,
                families["comparisons"], families["filters"],
            )
            filter_headers, filter_choices = await run_in_threadpool(prepared_filters, scoring_backend())
            for key in ("comparisons", "filters"):
                result[key] = [item for item in result[key] if item["header"] in available[key]]
            for item in result["comparisons"]:
                item.update(metadata(item["header"]))
                item["score_available"] = item["header"] in available["comparisons"]
            for item in result["filters"]:
                item.update(metadata(item["header"]))
                item.update(filter_metadata(item, filter_headers, filter_choices))
            supported = [item for item in result["comparisons"] if item["score_available"]]
            for index, item in enumerate(supported):
                item["weight"] = (100 // len(supported) + (index < 100 % len(supported))) / 100
            yield event("done", result=result)
        except (HTTPError, TimeoutError, URLError, ValueError, RuntimeError) as error:
            public = selection_error(error)
            yield event("error", detail=public.detail, status=public.status_code)
        finally:
            selection_lock.release()

    return StreamingResponse(stream(), media_type="application/x-ndjson",
                             headers={"Cache-Control": "no-store"})


@app.get("/api/catalog")
def catalog(
    latitude: Annotated[float | None, Query(ge=-90, le=90)] = None,
    longitude: Annotated[float | None, Query(ge=-180, le=180)] = None,
):
    """Families and representations a reviewer may add to the plan."""
    backend = scoring_backend()
    try:
        continent_available = getattr(backend, "continent_filter_available", False)
    except (RuntimeError, OSError):
        continent_available = False
    filter_headers, filter_choices = prepared_filters(backend)
    target = (SelectionRequest(latitude=latitude, longitude=longitude, objective="Catalog")
              if latitude is not None and longitude is not None else None)
    return catalog_menu(filter_headers, score_headers=prepared_comparison_headers(target),
                        filter_choices=filter_choices, continent_filter_available=continent_available)


@app.post("/api/score")
def score(plan: ConfirmedPlan):
    """Score the individual features and weights the user reviewed."""
    backend = scoring_backend()
    if backend is None:
        raise HTTPException(503, "Scoring data is not configured on this server.")
    if not scoring_lock.acquire(blocking=False):
        raise HTTPException(429, "A scoring run is already in progress. Try again shortly.")
    try:
        return backend.score(plan, plan.weights())
    except ValueError as error:
        raise HTTPException(422, str(error)) from None
    except (RuntimeError, OSError):
        raise HTTPException(503, "The scoring service is unavailable. Check the server configuration.") from None
    finally:
        scoring_lock.release()


app.mount("/", StaticFiles(directory=Path(__file__).resolve().parents[1] / "frontend", html=True))
