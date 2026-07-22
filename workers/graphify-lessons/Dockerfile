FROM cgr.dev/chainguard/python:latest-dev@sha256:5233e2961d13485e80cd9adc5515cf4242dc43d23045a6540466eee82764879b AS builder

USER root

ENV PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /build
COPY requirements.txt requirements.lock ./
COPY vendor/graphifyy-0.9.14-py3-none-any.whl ./vendor/graphifyy-0.9.14-py3-none-any.whl
RUN python -m venv /opt/venv \
    && /opt/venv/bin/pip install --require-hashes --requirement requirements.lock \
    && /opt/venv/bin/pip install --no-deps --require-hashes --requirement requirements.txt \
    && /opt/venv/bin/pip check \
    && /opt/venv/bin/python -c "import importlib.metadata; assert importlib.metadata.version('graphifyy') == '0.9.14'" \
    && /opt/venv/bin/python -c "from graphify.build import build_from_json; from graphify.cluster import cluster, score_all; from graphify.export import to_json"

FROM cgr.dev/chainguard/python:latest@sha256:2c6a2e8bdeb1336cd8545d3586d1c1e5b4f7564ef00924b0447ebfbe57a549ee AS runtime

LABEL org.opencontainers.image.source="https://github.com/Graphify-Labs/graphify.git" \
      org.opencontainers.image.revision="94d3099540550d58dd121ec3e67cf93e80364079" \
      org.opencontainers.image.licenses="MIT"

ENV PATH="/opt/venv/bin:$PATH" \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    GRAPHIFY_QUERY_LOG_DISABLE=1

WORKDIR /app
COPY --from=builder --chown=65532:65532 /opt/venv /opt/venv
COPY --chown=65532:65532 worker.py ./worker.py

USER 65532:65532
HEALTHCHECK NONE

ENTRYPOINT ["/opt/venv/bin/python", "/app/worker.py"]
CMD ["/data/input.json", "/data/output"]
