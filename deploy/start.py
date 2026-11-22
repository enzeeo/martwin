"""Container entry point: fetch the prepared scoring bundle, then serve Martwin.

Environment:
  MARTWIN_DATA_REPO      HF dataset holding the prepared bundle (manifest.json at its root).
  MARTWIN_DATA_REVISION  Optional branch, tag or commit to pin.
  HF_TOKEN               Needed only when that dataset is private.
  GUARDIANS_TERRAIN_DIR  Set this instead to use a bundle already on disk.
  OPENROUTER_API_KEY     Required for feature selection.
  PORT                   Defaults to 7860, the port Hugging Face Spaces expects.
"""

import os
import sys
from pathlib import Path

import uvicorn

APP_DIR = Path(__file__).resolve().parents[1]


def fetch_bundle():
    repo = os.environ.get("MARTWIN_DATA_REPO")
    if not repo or os.environ.get("GUARDIANS_TERRAIN_DIR"):
        return
    from huggingface_hub import snapshot_download

    target = APP_DIR / "data" / "scoring"
    print(f"Downloading scoring bundle from {repo} ...", flush=True)
    snapshot_download(
        repo_id=repo,
        repo_type="dataset",
        revision=os.environ.get("MARTWIN_DATA_REVISION") or None,
        token=os.environ.get("HF_TOKEN") or None,
        local_dir=target,
    )
    if not (target / "manifest.json").is_file():
        raise SystemExit(f"{repo} has no manifest.json at its root; scoring would be unavailable.")
    os.environ["GUARDIANS_TERRAIN_DIR"] = str(target)
    print("Scoring bundle ready.", flush=True)


if __name__ == "__main__":
    if not os.environ.get("OPENROUTER_API_KEY"):
        print("Warning: OPENROUTER_API_KEY is not set; feature selection will fail.", flush=True)
    fetch_bundle()
    os.chdir(APP_DIR)
    sys.path.insert(0, str(APP_DIR))
    uvicorn.run("src.backend.web:app", host="0.0.0.0", port=int(os.environ.get("PORT", "7860")))
