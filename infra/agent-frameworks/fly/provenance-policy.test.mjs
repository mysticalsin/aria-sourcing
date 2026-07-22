import assert from "node:assert/strict";
import test from "node:test";

import {
  agentFrameworkProvenancePolicy,
  validateAgentFrameworkProvenance,
} from "./provenance-policy.mjs";

const RELEASE = "c".repeat(40);
const COMPONENTS = [
  "postgres",
  "redis",
  "model-gateway",
  "deerflow",
  "flowise",
  "flowise-worker",
  "adapter",
];

function validPredicate(component) {
  const policy = agentFrameworkProvenancePolicy(component, RELEASE);
  const secrets = {
    secrets: [
      { id: "GIT_AUTH_HEADER", optional: true },
      { id: "GIT_AUTH_TOKEN", optional: true },
    ],
  };
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
        ...secrets,
        root: {
          configSource: {
            uri: policy.releaseMaterial.uri,
            digest: structuredClone(policy.releaseMaterial.digest),
            path: policy.entryPoint,
          },
          request: {
            args: structuredClone(policy.args),
          },
        },
        compatibilityVersion: 20,
      },
      environment: { dockerfileVersion: "1.24.0", platform: "linux/amd64" },
    },
    buildConfig: {
      llbDefinition: [
        {
          id: "step0",
          op: {
            Op: {
              source: {
                identifier: `git://github.com/mysticalsin/aria-sourcing.git#${RELEASE}`,
                attrs: {
                  "git.authheadersecret": "GIT_AUTH_HEADER",
                  "git.authtokensecret": "GIT_AUTH_TOKEN",
                  "git.fullurl": "https://github.com/mysticalsin/aria-sourcing.git",
                },
              },
            },
            platform: { Architecture: "amd64", OS: "linux" },
            constraints: {},
          },
        },
        {
          id: "step1",
          op: {
            Op: {
              exec: {
                meta: { args: ["/bin/sh", "-c", "true"] },
                mounts: [{ dest: "/" }],
                network: 0,
              },
            },
            platform: { Architecture: "amd64", OS: "linux" },
            constraints: {},
          },
          inputs: ["step0:0"],
        },
        {
          id: "step2",
          op: {
            Op: {
              exec: {
                meta: { args: ["/bin/sh", "-c", "true"] },
                mounts: [{ dest: "/" }],
                network: 2,
              },
            },
            platform: { Architecture: "amd64", OS: "linux" },
            constraints: {},
          },
          inputs: ["step1:0"],
        },
      ],
      digestMapping: { [`sha256:${"a".repeat(64)}`]: "step0" },
    },
    metadata: {
      buildInvocationID: "fixture",
      buildStartedOn: "2026-07-19T00:00:00Z",
      buildFinishedOn: "2026-07-19T00:00:01Z",
      completeness: { parameters: true, environment: true, materials: true },
      reproducible: false,
      "https://mobyproject.org/buildkit@v1#metadata": {
        vcs: {
          revision: RELEASE,
          source: "https://github.com/mysticalsin/aria-sourcing.git",
        },
      },
    },
  };
}

function mutate(component, change) {
  const document = validPredicate(component);
  change(document, agentFrameworkProvenancePolicy(component, RELEASE));
  return document;
}

test("the exact max-provenance policy accepts all seven reviewed linux/amd64 component builds", () => {
  for (const component of COMPONENTS) {
    assert.doesNotThrow(() => validateAgentFrameworkProvenance(
      validPredicate(component),
      { component, releaseSha: RELEASE },
    ), component);
  }
});

test("the policy binds build type, max shape, platform, source materials, base digests, and canonical args", () => {
  const cases = [
    ["deerflow", (value) => { value.buildType = "https://example.invalid/builder"; }],
    ["deerflow", (value) => { delete value.buildConfig; }],
    ["deerflow", (value) => { value.invocation.environment.platform = "linux/arm64"; }],
    ["deerflow", (value) => { value.buildConfig.llbDefinition[0].op.platform.Architecture = "arm64"; }],
    ["adapter", (value) => { value.invocation.configSource.digest.sha1 = "b".repeat(40); }],
    ["adapter", (value) => { value.metadata.completeness.materials = false; }],
    ["deerflow", (value) => { value.materials.pop(); }],
    ["deerflow", (value) => { value.materials[0].digest.sha256 = "f".repeat(64); }],
    ["deerflow", (value) => { value.materials.push({ uri: "https://evil.invalid/input", digest: { sha256: "e".repeat(64) } }); }],
    ["flowise", (value) => {
      const material = value.materials.find((item) => item.uri.includes("pnpm-10.26.0.tgz"));
      material.digest.sha256 = "d".repeat(64);
    }],
    ["flowise-worker", (value) => {
      const material = value.materials.find((item) => item.uri.includes("faiss-node"));
      material.uri = "https://evil.invalid/faiss.tar.gz";
    }],
    ["flowise", (value) => {
      const material = value.materials.find((item) => item.uri.includes("sqlite3"));
      value.materials.splice(value.materials.indexOf(material), 1);
    }],
    ["flowise", (value) => { value.invocation.parameters.args.target = "worker"; }],
    ["deerflow", (value) => { value.invocation.parameters.args["build-arg:UPSTREAM_SOURCE_COMMIT"] = "b".repeat(40); }],
    ["adapter", (value) => { value.invocation.parameters.args["build-arg:UNREVIEWED"] = "true"; }],
    ["redis", (value) => { delete value.invocation.parameters.args["build-arg:UPSTREAM_IMAGE"]; }],
    ["deerflow", (value) => { value.invocation.parameters.root.configSource.digest.sha1 = "b".repeat(40); }],
  ];
  for (const [component, change] of cases) {
    assert.throws(
      () => validateAgentFrameworkProvenance(mutate(component, change), { component, releaseSha: RELEASE }),
      /provenance/i,
      component,
    );
  }
});

test("the policy rejects unexpected secret, SSH, host-network, insecure, and nested request authority", () => {
  const cases = [
    (value) => { value.invocation.parameters.secrets.push({ id: "DEPLOY_TOKEN", optional: true }); },
    (value) => { value.invocation.parameters.secrets.pop(); },
    (value) => { value.invocation.parameters.secrets[0].optional = false; },
    (value) => { value.invocation.parameters.locals = [{ name: "context" }]; },
    (value) => { value.invocation.parameters.ssh = [{ id: "default" }]; },
    (value) => { value.invocation.parameters.root.request.secrets = [{ id: "ROOT_SECRET" }]; },
    (value) => { value.invocation.parameters.root.request.ssh = [{ id: "default" }]; },
    (value) => { value.invocation.parameters.root.request.args["network"] = "host"; },
    (value) => { value.buildConfig.llbDefinition[1].op.Op.exec.network = 1; },
    (value) => {
      value.buildConfig.llbDefinition[0].op.Op.source.attrs["git.authtokensecret"] = "DEPLOY_TOKEN";
    },
    (value) => { value.buildConfig.llbDefinition[1].op.Op.exec.security = 1; },
    (value) => { value.buildConfig.llbDefinition[1].op.Op.exec.mounts[0].secretOpt = { ID: "secret" }; },
    (value) => { value.buildConfig.llbDefinition[1].op.Op.exec.mounts[0].SSHOpt = { ID: "default" }; },
    (value) => { value.buildConfig.llbDefinition[1].op.Op.exec.secretenv = [{ ID: "secret", name: "TOKEN" }]; },
    (value) => { value.buildConfig.llbDefinition[1].op.Op.exec.cdiDevices = [{ name: "gpu" }]; },
    (value) => {
      value.metadata["https://mobyproject.org/buildkit@v1#metadata"].network = { mode: "host" };
    },
    (value) => { value.invocation.parameters.compatibilityVersion = 19; },
  ];
  for (const change of cases) {
    assert.throws(
      () => validateAgentFrameworkProvenance(mutate("deerflow", change), {
        component: "deerflow",
        releaseSha: RELEASE,
      }),
      /provenance/i,
    );
  }
});

test("policy construction itself fails closed on unknown components and malformed release identities", () => {
  assert.throws(() => agentFrameworkProvenancePolicy("unknown", RELEASE), /component/i);
  assert.throws(() => agentFrameworkProvenancePolicy("deerflow", "main"), /release SHA/i);
  assert.throws(
    () => validateAgentFrameworkProvenance(validPredicate("deerflow"), {
      component: "deerflow",
      releaseSha: "main",
    }),
    /release SHA/i,
  );
});
