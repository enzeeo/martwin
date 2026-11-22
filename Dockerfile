# Martwin image. Runs on any Docker host (Cloud Run, Fly.io, a VPS, HF Spaces).

# Stage 1: export the pinned INDUS encoder to ONNX. PyTorch lives only here.
FROM python:3.12-slim AS encoder
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv
ENV UV_LINK_MODE=copy
WORKDIR /build
COPY pyproject.toml uv.lock ./
RUN uv sync --locked --no-dev --only-group export --no-install-project
COPY src ./src
COPY tools/export_encoder_onnx.py ./tools/
RUN .venv/bin/python tools/export_encoder_onnx.py /encoder

# Stage 2: the server, with ONNX Runtime and no PyTorch.
FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

# Hugging Face Spaces run the container as user 1000; elsewhere this is harmless.
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

COPY --chown=user --from=encoder /encoder ./data/encoder
COPY --chown=user src ./src
COPY --chown=user deploy ./deploy

EXPOSE 7860
CMD ["python", "deploy/start.py"]
