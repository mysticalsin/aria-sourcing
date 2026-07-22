import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { agentFrameworkProvenancePolicy } from "./provenance-policy.mjs";
import {
  manifestImagesFromBundle,
  validateReleaseBundle,
} from "./release-bundle.mjs";
import {
  DEERFLOW_SOURCE_COMMIT,
  FRAMEWORK_UPSTREAM_IMAGES,
  FLOWISE_SOURCE_COMMIT,
  POSTGRES_SOURCE_COMMIT,
  REDIS_SOURCE_COMMIT,
} from "../../../src/lib/agents/framework/source-identity.mjs";

const RELEASE = "c".repeat(40);
const REPOSITORY = "registry.fly.io/aria-mantu-agent-frameworks";
const IDENTITY = "https://github.com/mysticalsin/aria-sourcing/.github/workflows/deploy-agent-frameworks.yml@refs/heads/main";
const ISSUER = "https://token.actions.githubusercontent.com";
const COMPONENTS = ["postgres", "redis", "model-gateway", "deerflow", "flowise", "flowise-worker", "adapter"];

function provenanceDocument(component) {
  const policy = agentFrameworkProvenancePolicy(component, RELEASE);
  return {
    builder: { id: "" },
    buildType: "https://mobyproject.org/buildkit@v1",
    materials: structuredClone(policy.materials),
    invocation: {
      configSource: {
        uri: policy.releaseMaterial.uri,
        digest: structuredClone(policy.releaseMaterial.digest),
        entryPoint: policy.entryPoint,
      },
      parameters: {
        frontend: "dockerfile.v0",
        args: structuredClone(policy.args),
        secrets: [
          { id: "GIT_AUTH_HEADER", optional: true },
          { id: "GIT_AUTH_TOKEN", optional: true },
        ],
        root: {
          configSource: {
            uri: policy.releaseMaterial.uri,
            digest: structuredClone(policy.releaseMaterial.digest),
            path: policy.entryPoint,
          },
          request: { args: structuredClone(policy.args) },
        },
        compatibilityVersion: 20,
      },
      environment: { dockerfileVersion: "1.24.0", platform: "linux/amd64" },
    },
    buildConfig: {
      llbDefinition: [{
        id: "step0",
        op: {
          Op: { source: { identifier: policy.releaseMaterial.uri, attrs: {
            "git.authheadersecret": "GIT_AUTH_HEADER",
            "git.authtokensecret": "GIT_AUTH_TOKEN",
          } } },
          constraints: {},
        },
      }],
      digestMapping: { [`sha256:${"a".repeat(64)}`]: "step0" },
    },
    metadata: {
      buildInvocationID: `fixture-${component}`,
      buildStartedOn: "2026-07-19T00:00:00Z",
      buildFinishedOn: "2026-07-19T00:00:01Z",
      completeness: { parameters: true, environment: true, materials: true },
      reproducible: false,
      "https://mobyproject.org/buildkit@v1#metadata": { source: { infos: [] } },
    },
  };
}

function writeJson(directory, file, value) {
  const text = `${JSON.stringify(value)}\n`;
  fs.writeFileSync(path.join(directory, file), text, { mode: 0o600 });
  return createHash("sha256").update(text).digest("hex");
}

function replaceEvidence({ directory, bundle }, component, kind, document) {
  const sha256 = writeJson(directory, `${component}.${kind}.json`, document);
  bundle.evidence[component][kind].sha256 = sha256;
  writeJson(directory, "release-bundle.json", bundle);
}

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "aria-release-bundle-"));
  const refs = Object.fromEntries(COMPONENTS.map((name, index) => [
    name,
    `${REPOSITORY}@sha256:${(index + 1).toString(16).repeat(64)}`,
  ]));
  const sourceCommits = {
    postgres: POSTGRES_SOURCE_COMMIT,
    redis: REDIS_SOURCE_COMMIT,
    "model-gateway": RELEASE,
    deerflow: DEERFLOW_SOURCE_COMMIT,
    flowise: FLOWISE_SOURCE_COMMIT,
    "flowise-worker": FLOWISE_SOURCE_COMMIT,
    adapter: RELEASE,
  };
  const upstreamImages = { ...FRAMEWORK_UPSTREAM_IMAGES };
  const evidence = {};
  for (const name of COMPONENTS) {
    const documents = {
      trivy: {
        SchemaVersion: 2,
        ArtifactName: refs[name],
        Results: [{ Target: refs[name], Vulnerabilities: [], Secrets: [], Misconfigurations: [] }],
      },
      spdx: {
        spdxVersion: "SPDX-2.3",
        SPDXID: "SPDXRef-DOCUMENT",
        dataLicense: "CC0-1.0",
        name,
        documentNamespace: `https://aria.invalid/spdx/${name}`,
        creationInfo: { created: "2026-07-19T00:00:00Z", creators: ["Tool: trivy"] },
        packages: [{ SPDXID: `SPDXRef-${name}`, name }],
      },
      provenance: provenanceDocument(name),
      metadata: { [name]: { "containerimage.digest": `sha256:${refs[name].split("@sha256:")[1]}` } },
    };
    evidence[name] = {};
    for (const [kind, document] of Object.entries(documents)) {
      const file = `${name}.${kind}.json`;
      evidence[name][kind] = { file, sha256: writeJson(directory, file, document) };
    }
  }
  const bundle = {
    schema: "aria.agent-framework.image-release.v1",
    releaseSha: RELEASE,
    repository: REPOSITORY,
    certificateIdentity: IDENTITY,
    certificateIssuer: ISSUER,
    refs,
    sourceCommits,
    upstreamImages,
    evidence,
  };
  writeJson(directory, "release-bundle.json", bundle);
  return { directory, bundle };
}

const options = (directory) => ({
  directory,
  releaseSha: RELEASE,
  repository: REPOSITORY,
  certificateIdentity: IDENTITY,
  certificateIssuer: ISSUER,
});

test("release bundle validation binds exact source, image, evidence, scanner, SPDX, and provenance identities", async () => {
  const { directory, bundle } = fixture();
  try {
    assert.deepEqual(await validateReleaseBundle(options(directory)), bundle);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("release bundle validation fails closed on tampering, findings, misplaced provenance, paths, and extras", async () => {
  for (const mutation of [
    ({ directory }) => fs.appendFileSync(path.join(directory, "adapter.spdx.json"), " "),
    (value) => replaceEvidence(value, "redis", "trivy", {
      SchemaVersion: 2,
      ArtifactName: value.bundle.refs.redis,
      Results: [{ Target: value.bundle.refs.redis, Secrets: [{ Severity: "CRITICAL", RuleID: "secret" }] }],
    }),
    (value) => replaceEvidence(value, "deerflow", "provenance", {
      metadata: { parameters: { RELEASE_SOURCE_COMMIT: value.bundle.releaseSha } },
      invocation: { parameters: {} },
    }),
    (value) => {
      const { bundle } = value;
      bundle.upstreamImages.adapter = `${REPOSITORY}@sha256:${"f".repeat(64)}`;
      replaceEvidence(value, "adapter", "provenance", {
        invocation: { parameters: {
          RELEASE_SOURCE_COMMIT: RELEASE,
          UPSTREAM_SOURCE_COMMIT: RELEASE,
          UPSTREAM_IMAGE: bundle.upstreamImages.adapter,
        } },
      });
    },
    ({ directory, bundle }) => {
      bundle.evidence.flowise.spdx.file = "../outside.json";
      writeJson(directory, "release-bundle.json", bundle);
    },
    ({ directory }) => writeJson(directory, "unexpected.json", {}),
  ]) {
    const value = fixture();
    try {
      mutation(value);
      await assert.rejects(validateReleaseBundle(options(value.directory)));
    } finally {
      fs.rmSync(value.directory, { recursive: true, force: true });
    }
  }
});

test("release bundle rejects structurally malformed Trivy and SPDX evidence even when hashes are valid", async () => {
  for (const [component, kind, document] of [
    ["postgres", "trivy", {
      SchemaVersion: 2,
      ArtifactName: `${REPOSITORY}@sha256:${"1".repeat(64)}`,
      Results: [{}],
    }],
    ["redis", "trivy", {
      SchemaVersion: 2,
      ArtifactName: `${REPOSITORY}@sha256:${"2".repeat(64)}`,
      Results: [{ Target: "redis", Vulnerabilities: [{}] }],
    }],
    ["model-gateway", "spdx", {
      spdxVersion: "SPDX-2.3",
      SPDXID: "SPDXRef-DOCUMENT",
      dataLicense: "CC0-1.0",
      name: "model-gateway",
      documentNamespace: "https://aria.invalid/spdx/model-gateway",
      creationInfo: [],
      packages: [{ SPDXID: "SPDXRef-model-gateway", name: "model-gateway" }],
    }],
    ["adapter", "spdx", {
      spdxVersion: "SPDX-2.3",
      SPDXID: "SPDXRef-DOCUMENT",
      dataLicense: "CC0-1.0",
      name: "adapter",
      documentNamespace: "https://aria.invalid/spdx/adapter",
      creationInfo: { created: "2026-07-19T00:00:00Z", creators: ["Tool: trivy"] },
      packages: [{}],
      files: [{ SPDXID: "SPDXRef-file", fileName: "/app/server.mjs" }],
    }],
  ]) {
    const value = fixture();
    try {
      replaceEvidence(value, component, kind, document);
      await assert.rejects(validateReleaseBundle(options(value.directory)));
    } finally {
      fs.rmSync(value.directory, { recursive: true, force: true });
    }
  }
});

test("release bundle emits the exact ten-role operator mapping without duplicating image authority", async () => {
  const { directory, bundle } = fixture();
  try {
    const images = manifestImagesFromBundle(await validateReleaseBundle(options(directory)));
    assert.deepEqual(Object.keys(images).sort(), [
      "deerflow-adapter", "deerflow-db", "deerflow-redis", "deerflow", "flowise-adapter",
      "flowise-db", "flowise-redis", "flowise-worker", "flowise", "model-gateway",
    ].sort());
    assert.equal(images["deerflow-db"].ref, bundle.refs.postgres);
    assert.equal(images["flowise-db"].ref, bundle.refs.postgres);
    assert.equal(images["deerflow-redis"].ref, bundle.refs.redis);
    assert.equal(images["flowise-redis"].ref, bundle.refs.redis);
    assert.equal(images["deerflow-adapter"].ref, bundle.refs.adapter);
    assert.equal(images["flowise-adapter"].ref, bundle.refs.adapter);
    assert.equal(images.deerflow.sourceCommit, DEERFLOW_SOURCE_COMMIT);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
