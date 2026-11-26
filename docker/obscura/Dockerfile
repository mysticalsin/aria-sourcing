# syntax=docker/dockerfile:1
#
# Obscura sidecar: browser automation backing Aria's
# browser_* tools (src/lib/ai/browser-tools.ts via server/obscura-adapter.js).
# Built from source with default features only. The sidecar remains an honest,
# read-only research browser and never enables stealth or private-network access.

FROM rust:1-slim-bookworm AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
        git \
        ca-certificates \
        perl \
        make \
        curl \
        cmake \
        g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build

# Pin to the exact commit for v0.1.9, fetched by SHA rather than by tag name so
# an upstream re-tag can't silently change what gets built here.
ARG OBSCURA_COMMIT=3a5d977940b6629d82c079f624b214f08f5d8519
RUN git init -q . \
    && git remote add origin https://github.com/h4ckf0r0day/obscura \
    && git fetch --depth 1 origin "${OBSCURA_COMMIT}" \
    && git checkout -q "${OBSCURA_COMMIT}" \
    && test "$(git rev-parse HEAD)" = "${OBSCURA_COMMIT}"

# Build both binaries without optional stealth support.
# Cache the verified upstream V8 archive across BuildKit builds. Restricted
# builders can supply their own non-secret, checksum-verified mirror instead
# of relying on public GitHub release egress.
# The pinned Obscura commit uses v8 137.3.0. Seed that archive before cargo:
# rusty_v8 tries one Python fetch, then one curl, and CI often loses that
# single GitHub Releases request. The filename matches rusty_v8's cache key.
ARG RUSTY_V8_MIRROR
RUN --mount=type=cache,id=aria-obscura-rusty-v8,target=/usr/local/cargo/.rusty_v8,sharing=locked \
    if [ -n "${RUSTY_V8_MIRROR:-}" ]; then export RUSTY_V8_MIRROR; fi; \
    arch="$(uname -m)"; \
    case "$arch" in \
      x86_64) triple=x86_64-unknown-linux-gnu ;; \
      aarch64|arm64) triple=aarch64-unknown-linux-gnu ;; \
      *) echo "unsupported V8 arch: ${arch}" >&2; exit 1 ;; \
    esac; \
    base="${RUSTY_V8_MIRROR:-https://github.com/denoland/rusty_v8/releases/download}"; \
    url="${base}/v137.3.0/librusty_v8_release_${triple}.a.gz"; \
    key="$(printf '%s' "$url" | tr -c 'A-Za-z0-9' '_')"; \
    dest="/usr/local/cargo/.rusty_v8/${key}"; \
    if [ ! -s "$dest" ]; then \
      curl -L --fail --retry 5 --retry-all-errors --retry-delay 5 -o "${dest}.partial" "$url"; \
      mv "${dest}.partial" "$dest"; \
    fi; \
    cargo build --release --bin obscura --bin obscura-worker

FROM gcr.io/distroless/cc-debian12

COPY --from=builder /build/target/release/obscura /obscura
COPY --from=builder /build/target/release/obscura-worker /obscura-worker

EXPOSE 9222

ENTRYPOINT ["/obscura"]
CMD ["serve", "--port", "9222", "--host", "0.0.0.0"]
