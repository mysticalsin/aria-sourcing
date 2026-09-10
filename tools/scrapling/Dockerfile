# Aria Scrapling sidecar — optional public-web research runtime.
# https://github.com/D4Vinci/Scrapling
FROM python:3.12-slim

WORKDIR /app
COPY tools/scrapling/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt || true
COPY tools/scrapling/server.py /app/server.py

ENV SCRAPLING_HOST=0.0.0.0 \
    SCRAPLING_PORT=8091
EXPOSE 8091
HEALTHCHECK --interval=20s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8091/health')"
CMD ["python", "/app/server.py"]
