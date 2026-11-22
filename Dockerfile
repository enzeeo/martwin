# Martwin image for a Hugging Face Docker Space (also runs anywhere Docker does).
FROM python:3.12-slim

COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

# Spaces run the container as user 1000.
RUN useradd -m -u 1000 user
USER user
ENV HOME=/home/user \
    HF_HOME=/home/user/.cache/huggingface \
    PATH=/home/user/app/.venv/bin:$PATH \
    UV_LINK_MODE=copy \
    PYTHONUNBUFFERED=1
WORKDIR /home/user/app

COPY --chown=user pyproject.toml uv.lock ./
RUN uv sync --locked --no-dev --group indus --no-install-project

# Bake the pinned INDUS encoder into the image so the first search is not slow.
COPY --chown=user src/backend/feature_selection.py /tmp/feature_selection.py
RUN python -c "import re, pathlib; from huggingface_hub import snapshot_download; \
s = pathlib.Path('/tmp/feature_selection.py').read_text(); \
snapshot_download(re.search(r'MODEL_ID = \"(.+?)\"', s).group(1), revision=re.search(r'MODEL_REVISION = \"(.+?)\"', s).group(1))"

COPY --chown=user src ./src
COPY --chown=user deploy ./deploy

EXPOSE 7860
CMD ["python", "deploy/start.py"]
