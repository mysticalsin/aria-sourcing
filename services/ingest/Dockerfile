# Local OCR runtime. Tesseract and Poppler are the only document tools;
# the image does not call a paid OCR API.
# Pins are debian bookworm amd64 as of 2026-11-21.
# poppler-utils 22.12.0-2+deb12u2 no longer resolves; u3 is the bookworm candidate.
FROM golang:1.22-bookworm@sha256:3d699e4d15d0f8f13c9195c0632a16702b8cbdece2955af1c23b37ae5d55a253 AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/ingest ./cmd/ingest

FROM debian:bookworm-slim@sha256:734a72b3d6142a71993b4bc580ca01d8ca687f77a2c422d96a961d3376b179bc
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates=20230311+deb12u1 \
        poppler-utils=22.12.0-2+deb12u3 \
        tesseract-ocr=5.3.0-2 \
        tesseract-ocr-eng=1:4.1.0-2 \
        tesseract-ocr-fra=1:4.1.0-2 \
        tesseract-ocr-por=1:4.1.0-2 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /out/ingest /usr/local/bin/ingest
USER nobody
ENTRYPOINT ["ingest"]

# This image does not apply a memory cap or disable the network.
# Both are run flags, not image settings:
#   docker run --network=none --memory=512m --pids-limit=64 ...
# Compose sets the memory cap only. Add --network=none when the process
# just reads a mounted file.
