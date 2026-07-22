/**
 * Reviewed source and upstream image identities for the agent-framework
 * release. Runtime code, Bake, and CI import this module instead of carrying
 * independent copies that can drift.
 */
export const DEERFLOW_SOURCE_COMMIT = "3c0a45ad772cdba388009b8d5ecad5e48cd22429";
export const FLOWISE_SOURCE_COMMIT = "ed9e100fb71643cd3922b005908f9732bc0e07dc";

export const POSTGRES_SOURCE_COMMIT = "4f9ced003ba58a854656ba150d146243d27ae3ac";
export const REDIS_SOURCE_COMMIT = "2b76f51f4af2f8586e137c49c55bfedb41d6751c";

export const POSTGRES_UPSTREAM_IMAGE =
  "mirror.gcr.io/library/postgres:17.10-bookworm@sha256:67870dc097790edf2bd6726658db995dcc830f799d41bb2b78ef07c9a2d5f010";
export const REDIS_UPSTREAM_IMAGE =
  "mirror.gcr.io/library/redis:7.4.9-bookworm@sha256:5c30969bb0ecdf1b654e0e4d4124aac99013f0b0fe345e33aa380f6b1dab780b";

/** The Fly release is deliberately single-platform; every base is its amd64 manifest. */
export const FRAMEWORK_BUILD_PLATFORM = "linux/amd64";
export const NODE_22_RUNTIME_IMAGE =
  "mirror.gcr.io/library/node:22.22.0-alpine3.23@sha256:48f53c3f0105ccddcc5e4f520347398dfc0ba9b3008fbfd98a2add27e5797957";
export const DEERFLOW_BUILD_IMAGE =
  "mirror.gcr.io/library/python:3.12.13-bookworm@sha256:058149828b8d4a90425f5ae6d255ee1fcfe73bf7d749635d824f4e033460d83c";
export const DEERFLOW_RUNTIME_IMAGE =
  "mirror.gcr.io/library/python:3.12.13-slim-bookworm@sha256:72d3d75f2639ab82b34b29390ad3d6e0827c775befee94edda8e9976818f488d";
export const DEERFLOW_UV_IMAGE =
  "ghcr.io/astral-sh/uv:0.7.20@sha256:b9e3cd81ee238e53078d6d9b45ad72b99d469a66f2804db0891784134e8b073a";
export const DEERFLOW_UV_LOCK_SHA256 = "c7caa9a710f07a14fe8952111576ed04b6361da15b4d68dc5580a063dbfcbe64";

export const FLOWISE_NODE_IMAGE =
  "mirror.gcr.io/library/node:24.18.0-bookworm-slim@sha256:d45d78e7929b46875bbd4e29bea672d5bc48186c6c3588306521c815e78352d6";
export const FLOWISE_RUNTIME_IMAGE =
  "gcr.io/distroless/nodejs24-debian13:nonroot@sha256:b1386d556b478c420927eb212236bfb31be9834a4549850a060a6351f7fff514";
export const FLOWISE_PNPM_LOCK_SHA256 = "f37c5b91f15e8a162a6daa3ed214d37649c887c9dab74c2ba840ce2db60eaae8";
export const FLOWISE_PNPM_TARBALL_SHA256 = "f60974c68cfe0a13f951fba0199669588577f0e3f0c9b7d1a7ca47633bf72386";
export const FLOWISE_FAISS_PREBUILD_SHA256 = "11981517fdf01c2651eb2007854128f84ea6a57d43d32f2a0cc02e819c4d8132";
export const FLOWISE_SQLITE_PREBUILD_SHA256 = "6d1f7a95e5aca90db1fd6a2839380a021d5ee23d46f2d7c520ded094da813fed";

export const FLOWISE_PNPM_TARBALL_URL = "https://registry.npmjs.org/pnpm/-/pnpm-10.26.0.tgz";
export const FLOWISE_FAISS_PREBUILD_URL =
  "https://github.com/ewfian/faiss-node/releases/download/v0.5.1/faiss-node-v0.5.1-napi-v8-linux-x64.tar.gz";
export const FLOWISE_SQLITE_PREBUILD_URL =
  "https://github.com/TryGhost/node-sqlite3/releases/download/v5.1.7/sqlite3-v5.1.7-napi-v6-linux-x64.tar.gz";

export const FRAMEWORK_UPSTREAM_IMAGES = Object.freeze({
  postgres: POSTGRES_UPSTREAM_IMAGE,
  redis: REDIS_UPSTREAM_IMAGE,
  "model-gateway": NODE_22_RUNTIME_IMAGE,
  deerflow: DEERFLOW_RUNTIME_IMAGE,
  flowise: FLOWISE_NODE_IMAGE,
  "flowise-worker": FLOWISE_NODE_IMAGE,
  adapter: NODE_22_RUNTIME_IMAGE,
});

function dockerMaterial(reference) {
  const [nameAndTag, digest] = reference.split("@sha256:");
  const tagSeparator = nameAndTag.lastIndexOf(":");
  const repository = nameAndTag.slice(0, tagSeparator);
  const tag = nameAndTag.slice(tagSeparator + 1);
  return Object.freeze({
    uri: `pkg:docker/${repository}@${tag}?digest=sha256:${digest}&platform=linux%2Famd64`,
    digest: Object.freeze({ sha256: digest }),
  });
}

function gitMaterial(repository, commit) {
  return Object.freeze({
    uri: `${repository}#${commit}`,
    digest: Object.freeze({ sha1: commit }),
  });
}

function httpMaterial(uri, sha256) {
  return Object.freeze({ uri, digest: Object.freeze({ sha256 }) });
}

export const FRAMEWORK_BUILD_INPUTS = Object.freeze({
  postgres: Object.freeze({ UPSTREAM_IMAGE: POSTGRES_UPSTREAM_IMAGE }),
  redis: Object.freeze({ UPSTREAM_IMAGE: REDIS_UPSTREAM_IMAGE }),
  "model-gateway": Object.freeze({ UPSTREAM_IMAGE: NODE_22_RUNTIME_IMAGE }),
  deerflow: Object.freeze({
    UPSTREAM_IMAGE: DEERFLOW_RUNTIME_IMAGE,
    DEERFLOW_BUILD_IMAGE,
    DEERFLOW_UV_IMAGE,
    DEERFLOW_UV_LOCK_SHA256,
  }),
  flowise: Object.freeze({
    UPSTREAM_IMAGE: FLOWISE_NODE_IMAGE,
    RUNTIME_IMAGE: FLOWISE_RUNTIME_IMAGE,
    FLOWISE_PNPM_LOCK_SHA256,
  }),
  "flowise-worker": Object.freeze({
    UPSTREAM_IMAGE: FLOWISE_NODE_IMAGE,
    RUNTIME_IMAGE: FLOWISE_RUNTIME_IMAGE,
    FLOWISE_PNPM_LOCK_SHA256,
  }),
  adapter: Object.freeze({ UPSTREAM_IMAGE: NODE_22_RUNTIME_IMAGE }),
});

export const FRAMEWORK_BUILD_MATERIALS = Object.freeze({
  postgres: Object.freeze([dockerMaterial(POSTGRES_UPSTREAM_IMAGE)]),
  redis: Object.freeze([dockerMaterial(REDIS_UPSTREAM_IMAGE)]),
  "model-gateway": Object.freeze([dockerMaterial(NODE_22_RUNTIME_IMAGE)]),
  deerflow: Object.freeze([
    dockerMaterial(DEERFLOW_RUNTIME_IMAGE),
    dockerMaterial(DEERFLOW_BUILD_IMAGE),
    dockerMaterial(DEERFLOW_UV_IMAGE),
    gitMaterial("https://github.com/bytedance/deer-flow.git", DEERFLOW_SOURCE_COMMIT),
  ]),
  flowise: Object.freeze([
    dockerMaterial(FLOWISE_NODE_IMAGE),
    dockerMaterial(FLOWISE_RUNTIME_IMAGE),
    gitMaterial("https://github.com/FlowiseAI/Flowise.git", FLOWISE_SOURCE_COMMIT),
    httpMaterial(FLOWISE_PNPM_TARBALL_URL, FLOWISE_PNPM_TARBALL_SHA256),
    httpMaterial(FLOWISE_FAISS_PREBUILD_URL, FLOWISE_FAISS_PREBUILD_SHA256),
    httpMaterial(FLOWISE_SQLITE_PREBUILD_URL, FLOWISE_SQLITE_PREBUILD_SHA256),
  ]),
  "flowise-worker": Object.freeze([
    dockerMaterial(FLOWISE_NODE_IMAGE),
    dockerMaterial(FLOWISE_RUNTIME_IMAGE),
    gitMaterial("https://github.com/FlowiseAI/Flowise.git", FLOWISE_SOURCE_COMMIT),
    httpMaterial(FLOWISE_PNPM_TARBALL_URL, FLOWISE_PNPM_TARBALL_SHA256),
    httpMaterial(FLOWISE_FAISS_PREBUILD_URL, FLOWISE_FAISS_PREBUILD_SHA256),
    httpMaterial(FLOWISE_SQLITE_PREBUILD_URL, FLOWISE_SQLITE_PREBUILD_SHA256),
  ]),
  adapter: Object.freeze([dockerMaterial(NODE_22_RUNTIME_IMAGE)]),
});
