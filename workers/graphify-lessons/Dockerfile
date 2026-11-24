FROM python:3.12-slim@sha256:090ba77e2958f6af52a5341f788b50b032dd4ca28377d2893dcf1ecbdfdfe203 AS builder

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

FROM python:3.12-slim@sha256:090ba77e2958f6af52a5341f788b50b032dd4ca28377d2893dcf1ecbdfdfe203 AS runtime

LABEL org.opencontainers.image.source="https://github.com/Graphify-Labs/graphify.git" \
      org.opencontainers.image.revision="94d3099540550d58dd121ec3e67cf93e80364079" \
      org.opencontainers.image.licenses="MIT"

ENV PATH="/opt/venv/bin:$PATH" \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    GRAPHIFY_QUERY_LOG_DISABLE=1

RUN groupadd --gid 10001 graphify \
    && useradd --uid 10001 --gid 10001 --create-home --shell /usr/sbin/nologin graphify

WORKDIR /app
COPY --from=builder /opt/venv /opt/venv
COPY --chown=10001:10001 worker.py ./worker.py

USER 10001:10001
HEALTHCHECK NONE

ENTRYPOINT ["python", "/app/worker.py"]
CMD ["/data/input.json", "/data/output"]
