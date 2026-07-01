# syntax=docker/dockerfile:1
#
# Obscura sidecar: read-only, multi-step browser automation backing Aria's
# browser_* tools (src/lib/ai/browser-tools.ts via server/obscura-adapter.js).
# Built from source, pinned to an exact upstream commit (not a mutable tag),
# with DEFAULT cargo features only -- `--features stealth` is never passed to
# `cargo build`, and the `obscura serve` command is never given `--stealth` or
# `--allow-private-network` either (see obscura-adapter.js). Building from
# source instead of pulling h4ckf0r0day/obscura's published image keeps that
# omission auditable here rather than trusting an unverified upstream build.
#
# See docs/superpowers/specs/2026-06-27-claw3d-office-merge-design.md §11.

FROM rust:1-slim-bookworm AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
        git \
        ca-certificates \
        perl \
        make \
        curl \
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

# Default features only -- no `--features stealth`.
RUN cargo build --release --bin obscura

FROM gcr.io/distroless/cc-debian12

COPY --from=builder /build/target/release/obscura /obscura

EXPOSE 9222

ENTRYPOINT ["/obscura"]
# --host 0.0.0.0 only so sibling containers on the compose network can reach
# this service by name -- the port is never published to the host (see
# docker-compose.yml). Never add --stealth or --allow-private-network here.
CMD ["serve", "--port", "9222", "--host", "0.0.0.0"]
