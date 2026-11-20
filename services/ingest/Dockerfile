# Local OCR runtime. Tesseract and Poppler are the only document tools;
# the image does not call a paid OCR API.
FROM golang:1.22-bookworm AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/ingest ./cmd/ingest

FROM debian:bookworm-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        poppler-utils \
        tesseract-ocr \
        tesseract-ocr-eng \
        tesseract-ocr-fra \
        tesseract-ocr-por \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /out/ingest /usr/local/bin/ingest
USER nobody
ENTRYPOINT ["ingest"]

# This image does not apply a memory cap. Compose sets 512m.
# A direct run must pass it: docker run --memory=512m --pids-limit=64 ...
