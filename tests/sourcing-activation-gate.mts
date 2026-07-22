import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createActivationSnapshot,
  createRedarkPlan,
  validateAutonomousProviderProof,
  validateLoopReadiness,
  validateSourcingReadiness,
  verifyMachinePlan,
  verifyOperationalHeartbeat,
} from "../scripts/sourcing-activation-gate.mjs";

const workflow = readFileSync(".github/workflows/deploy-aria-mantu.yml", "utf8");
const gate = readFileSync("scripts/sourcing-activation-gate.mjs", "utf8");
const releaseSha = "a".repeat(40);
const digest = `sha256:${"b".repeat(64)}`;
const image = `registry.fly.io/aria-mantu-app@${digest}`;
const sharedThrottleEvidenceKey = "k".repeat(43);
const evidenceNow = Date.parse("2026-07-21T12:05:00.000Z");

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => [key, stableValue((value as Record<string, unknown>)[key])]),
  );
}

function signedSharedThrottleEvidence(overrides: Record<string, unknown> = {}) {
  const unsigned = {
    schemaVersion: 1,
    status: "passed",
    app: "aria-mantu-app",
    releaseSha,
    imageDigest: digest,
    route: "/api/webhooks/needs",
    origins: ["https://aria-mantu-app.fly.dev"],
    webMachineIds: ["11111111111111", "88888888888888"],
    policy: {
      provider: "external-shared-limiter",
      policyIdSha256: "e".repeat(64),
      revisionSha256: "f".repeat(64),
      requestLimit: 20,
      windowSeconds: 60,
    },
    assertions: {
      everyPublicOriginCovered: true,
      directFlyOriginCovered: true,
      trustedIdentityBucket: true,
      combinedBurstAcrossMachines: true,
      distinctWebMachinesObserved: 2,
      returns429: true,
      positiveRetryAfter: true,
      noStore: true,
      signedBelowLimitAccepted: true,
      blockedInventedKeyOriginRequests: 0,
      blockedInventedKeyDatabaseWrites: 0,
    },
    testedAt: "2026-07-21T12:00:00.000Z",
    expiresAt: "2026-07-22T12:00:00.000Z",
    ...overrides,
  };
  const signature = createHmac("sha256", Buffer.from(sharedThrottleEvidenceKey, "base64url"))
    .update(JSON.stringify(stableValue(unsigned)))
    .digest("hex");
  return { ...unsigned, signature: `sha256=${signature}` };
}

function machine(id: string, group: string, state: "started" | "stopped", standbys: string[] = []) {
  return {
    id,
    state,
    image_ref: image,
    config: {
      image,
      metadata: { fly_process_group: group },
      ...(standbys.length ? { standbys } : {}),
      env: {
        ARIA_RELEASE_SHA: releaseSha,
        ARIA_EXPECTED_MIGRATION: "0056_need_ingress_credential_authority.sql",
        ARIA_EXPECTED_MIGRATION_SHA: "c".repeat(64),
        ARIA_EXPECTED_MIGRATION_COUNT: "55",
        ARIA_EXPECTED_LEDGER_SHA: "d".repeat(64),
        ARIA_LOOP_KILL_SWITCH: "true",
        ARIA_SOURCING_OPERATIONAL_REQUIRED: "false",
        ARIA_LOOP_ENABLE_OUTBOUND_DRAIN: "false",
        ARIA_NEED_INGRESS_SHARED_THROTTLE_VERIFIED: "false",
        ARIA_NEED_INGRESS_SHARED_THROTTLE_EVIDENCE_SHA256: "",
        PRESERVED_ENV: "preserved",
      },
      guest: { cpu_kind: "shared", cpus: 1, memory_mb: 256 },
    },
  };
}

function machines() {
  return [
    machine("11111111111111", "web", "started"),
    machine("88888888888888", "web", "started"),
    machine("22222222222222", "cleanup", "started"),
    machine("33333333333333", "cleanup", "stopped", ["22222222222222"]),
    machine("44444444444444", "framework_heartbeat", "started"),
    machine("55555555555555", "framework_heartbeat", "stopped", ["44444444444444"]),
    machine("66666666666666", "loop", "started"),
    machine("77777777777777", "loop", "stopped", ["66666666666666"]),
  ];
}

const releaseReceipt = {
  schemaVersion: 2,
  status: "accepted",
  releaseSha,
  images: { app: digest },
  migration: {
    filename: "0056_need_ingress_credential_authority.sql",
    sha256: "c".repeat(64),
    count: 55,
    ledgerSha256: "d".repeat(64),
  },
};

test("production sourcing activation is optional and owner approved after deploy", () => {
  assert.match(workflow, /activate_sourcing:[\s\S]*type:\s*boolean[\s\S]*default:\s*false/);
  assert.match(
    workflow,
    /activate-sourcing:[\s\S]*needs:\s*\[deploy, verify-need-ingress-throttle-evidence\][\s\S]*if:\s*\$\{\{\s*inputs\.activate_sourcing\s*\}\}[\s\S]*environment:\s*Production-Sourcing-Activation/,
  );
});

test("activation proves the exact accepted release and only mutates guarded machine config", () => {
  assert.match(workflow, /aria-accepted-release-\$\{\{ inputs\.release_sha \}\}-attempt-\$\{\{ github\.run_attempt \}\}/);
  assert.match(workflow, /sourcing-activation-gate\.mjs snapshot/);
  assert.match(workflow, /ARIA_LOOP_KILL_SWITCH:\s*"false"/);
  assert.match(workflow, /ARIA_SOURCING_OPERATIONAL_REQUIRED:\s*"true"/);
  assert.match(workflow, /ARIA_LOOP_ENABLE_OUTBOUND_DRAIN:\s*"false"/);
  assert.match(workflow, /verify-need-ingress-throttle-evidence:[\s\S]*environment:\s*Production-Need-Ingress-Throttle-Proof/);
  assert.match(workflow, /ARIA_NEED_INGRESS_THROTTLE_EVIDENCE_JSON:\s*\$\{\{ secrets\.ARIA_NEED_INGRESS_THROTTLE_EVIDENCE_JSON \}\}/);
  assert.match(workflow, /ARIA_NEED_INGRESS_THROTTLE_EVIDENCE_HMAC_KEY:\s*\$\{\{ secrets\.ARIA_NEED_INGRESS_THROTTLE_EVIDENCE_HMAC_KEY \}\}/);
  assert.match(workflow, /validate-shared-throttle-evidence/);
  assert.match(workflow, /aria-need-ingress-throttle-proof-\$\{\{ inputs\.release_sha \}\}-run-\$\{\{ github\.run_id \}\}-attempt-\$\{\{ github\.run_attempt \}\}/);
  assert.match(workflow, /artifact-ids:\s*\$\{\{ needs\.verify-need-ingress-throttle-evidence\.outputs\.artifact_id \}\}/);
  assert.match(workflow, /workflow_run\?\.id[\s\S]*GITHUB_RUN_ID/);
  assert.match(workflow, /artifact\.digest[\s\S]*ARIA_NEED_INGRESS_THROTTLE_ARTIFACT_DIGEST/);
  assert.match(workflow, /artifact\.expired\s*!==\s*false/);
  assert.match(workflow, /--shared-throttle-evidence/);
  assert.match(workflow, /sourcing-activation-gate\.mjs verify-machines/);
});

test("activation performs a tenant-bound real-provider no-contact canary", () => {
  assert.match(workflow, /ARIA_SOURCING_CANARY_NEED_KEY:\s*\$\{\{ secrets\.ARIA_SOURCING_CANARY_NEED_KEY \}\}/);
  assert.match(workflow, /ARIA_SOURCING_CANARY_CREDENTIAL_ID:\s*\$\{\{ vars\.ARIA_SOURCING_CANARY_CREDENTIAL_ID \}\}/);
  assert.match(workflow, /ARIA_SOURCING_CANARY_TAVILY_CREDENTIAL_ID:\s*\$\{\{ vars\.ARIA_SOURCING_CANARY_TAVILY_CREDENTIAL_ID \}\}/);
  assert.match(workflow, /ARIA_SOURCING_CANARY_WORKSPACE_ID:\s*\$\{\{ vars\.ARIA_SOURCING_CANARY_WORKSPACE_ID \}\}/);
  assert.match(workflow, /sourcing-activation-gate\.mjs canary/);
  assert.match(`${workflow}\n${gate}`, /messagesOutboundBefore/);
  assert.match(`${workflow}\n${gate}`, /messagesOutboundAfter/);
  assert.match(gate, /candidateEvidenceSha256/);
  assert.match(gate, /autonomousSourcing/);
  assert.match(gate, /get_autonomous_web_sourcing_activation_proof/);
  assert.match(gate, /providerProofBeforeReplay/);
  assert.match(gate, /providerProofAfterReplay/);
  assert.match(gate, /workspace_credential/);
  assert.match(gate, /p_source:\s*"LinkedIn"/);
  assert.doesNotMatch(gate, /provider:\s*"github"/);
});

test("Tavily activation proof is exact, fresh, credential-bound, and replay-comparable", () => {
  const credentialId = "81000000-0000-4000-8000-000000000001";
  const proof = {
    status: "completed",
    provider: "tavily",
    providerMode: "workspace_credential",
    attemptCount: 1,
    confirmationCount: 1,
    receiptCount: 1,
    failureCount: 0,
    credentialId,
    credentialVersion: "1".repeat(64),
    credentialVerifiedAt: "2026-07-21T11:55:00.000Z",
    verificationMethod: "tavily_usage_v1",
    verificationHttpStatus: 200,
    receipts: [{
      jobId: "71000000-0000-4000-8000-000000000001",
      egressAttemptId: "82000000-0000-4000-8000-000000000001",
      canonicalQuerySha256: "2".repeat(64),
      resultSha256: "3".repeat(64),
      candidateCount: 1,
      completedAt: "2026-07-21T11:58:00.000Z",
    }],
  };
  const summary = validateAutonomousProviderProof(proof, credentialId, evidenceNow);
  assert.equal(summary.attemptCount, 1);
  assert.equal(summary.candidateCount, 1);
  assert.match(summary.proofSha256, /^[0-9a-f]{64}$/);
  const retryProof = {
    ...proof,
    attemptCount: 2,
    confirmationCount: 2,
    failureCount: 1,
  };
  assert.equal(
    validateAutonomousProviderProof(retryProof, credentialId, evidenceNow).failureCount,
    1,
  );
  const boundedRetryProof = {
    ...proof,
    attemptCount: 4,
    confirmationCount: 4,
    failureCount: 3,
  };
  assert.equal(
    validateAutonomousProviderProof(boundedRetryProof, credentialId, evidenceNow).attemptCount,
    4,
  );
  assert.throws(
    () => validateAutonomousProviderProof({ ...proof, attemptCount: 2 }, credentialId, evidenceNow),
    /provider proof is invalid/,
  );
  assert.throws(
    () => validateAutonomousProviderProof({ ...retryProof, confirmationCount: 1 }, credentialId, evidenceNow),
    /provider proof is invalid/,
  );
  assert.throws(
    () => validateAutonomousProviderProof({
      ...boundedRetryProof,
      attemptCount: 5,
      confirmationCount: 5,
      failureCount: 4,
    }, credentialId, evidenceNow),
    /provider proof is invalid/,
  );
  assert.throws(
    () => validateAutonomousProviderProof({ ...proof, credentialId: "91000000-0000-4000-8000-000000000001" }, credentialId, evidenceNow),
    /provider proof is invalid/,
  );
  assert.throws(
    () => validateAutonomousProviderProof({ ...proof, credentialVerifiedAt: "2026-07-20T11:00:00.000Z" }, credentialId, evidenceNow),
    /credential proof is stale/,
  );
});

test("every post-mutation failure invokes the exact re-dark path", () => {
  assert.match(workflow, /trap redark EXIT HUP INT TERM/);
  assert.match(workflow, /if:\s*\$\{\{\s*failure\(\)\s*\|\|\s*cancelled\(\)\s*\}\}/);
  assert.match(workflow, /sourcing-activation-gate\.mjs redark/);
  assert.match(workflow, /ARIA_LOOP_KILL_SWITCH:\s*"true"/);
  assert.match(workflow, /ARIA_SOURCING_OPERATIONAL_REQUIRED:\s*"false"/);
  assert.match(workflow, /ARIA_LOOP_ENABLE_OUTBOUND_DRAIN:\s*"false"/);
});

test("activation emits bounded receipts without raw candidate or credential material", () => {
  assert.match(workflow, /aria-sourcing-activation-candidate-/);
  assert.match(workflow, /aria-sourcing-activation-receipt-/);
  assert.match(workflow, /retention-days:\s*90/);
  assert.doesNotMatch(workflow, /candidateName|candidateEmail|candidateUrl|needKeyRaw/);
});

test("snapshot accepts a bounded dark exact-release web fleet and paired loop topology", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "aria-activation-test-"));
  try {
    const { state, plan } = createActivationSnapshot({
      machines: machines(),
      releaseReceipt,
      releaseSha,
      configDirectory: directory,
      sharedThrottleEvidence: signedSharedThrottleEvidence(),
      sharedThrottleEvidenceKey,
      now: evidenceNow,
    });
    assert.equal(state.imageDigest, digest);
    assert.equal(state.activeLoopId, "66666666666666");
    assert.deepEqual(state.targets.map((target: { group: string }) => target.group), ["web", "loop", "loop", "web"]);
    assert.match(state.sharedThrottleEvidenceSha256, /^[0-9a-f]{64}$/);
    assert.equal(plan.mode, "operational");
    assert.equal(plan.targets.length, 4);
    for (const target of plan.targets) {
      const config = JSON.parse(readFileSync(target.configPath, "utf8"));
      assert.equal(config.env.ARIA_LOOP_KILL_SWITCH, "false");
      assert.equal(config.env.ARIA_SOURCING_OPERATIONAL_REQUIRED, "true");
      assert.equal(config.env.ARIA_LOOP_ENABLE_OUTBOUND_DRAIN, "false");
      assert.equal(config.env.ARIA_NEED_INGRESS_SHARED_THROTTLE_VERIFIED, "true");
      assert.equal(
        config.env.ARIA_NEED_INGRESS_SHARED_THROTTLE_EVIDENCE_SHA256,
        state.sharedThrottleEvidenceSha256,
      );
      assert.equal(config.env.PRESERVED_ENV, "preserved");
    }
    const notDark = machines();
    notDark[0].config.env.ARIA_LOOP_KILL_SWITCH = "false";
    assert.throws(
      () => createActivationSnapshot({
        machines: notDark,
        releaseReceipt,
        releaseSha,
        configDirectory: directory,
        sharedThrottleEvidence: signedSharedThrottleEvidence(),
        sharedThrottleEvidenceKey,
        now: evidenceNow,
      }),
      /protected dark mode/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("snapshot refuses absent or tampered shared-throttle evidence before mutation", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "aria-activation-test-"));
  try {
    assert.throws(
      () => createActivationSnapshot({
        machines: machines(),
        releaseReceipt,
        releaseSha,
        configDirectory: directory,
        sharedThrottleEvidence: undefined,
        sharedThrottleEvidenceKey: undefined,
      }),
      /shared need ingress throttle evidence/i,
    );
    const tampered = signedSharedThrottleEvidence();
    tampered.assertions.returns429 = false;
    assert.throws(
      () => createActivationSnapshot({
        machines: machines(),
        releaseReceipt,
        releaseSha,
        configDirectory: directory,
        sharedThrottleEvidence: tampered,
        sharedThrottleEvidenceKey,
        now: evidenceNow,
      }),
      /shared need ingress throttle evidence/i,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("snapshot rejects signed evidence with stale or mismatched authority, failed assertions, or extra fields", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "aria-activation-test-"));
  const failedAssertions = {
    ...signedSharedThrottleEvidence().assertions,
    returns429: false,
  };
  const invalidEvidence = [
    signedSharedThrottleEvidence({ expiresAt: "2026-07-21T12:04:59.000Z" }),
    signedSharedThrottleEvidence({ releaseSha: "9".repeat(40) }),
    signedSharedThrottleEvidence({ imageDigest: `sha256:${"9".repeat(64)}` }),
    signedSharedThrottleEvidence({ origins: ["https://sourcing.example.com"] }),
    signedSharedThrottleEvidence({ webMachineIds: ["11111111111111", "99999999999999"] }),
    signedSharedThrottleEvidence({ assertions: failedAssertions }),
    signedSharedThrottleEvidence({ unexpected: true }),
  ];
  try {
    for (const evidence of invalidEvidence) {
      assert.throws(
        () => createActivationSnapshot({
          machines: machines(),
          releaseReceipt,
          releaseSha,
          configDirectory: directory,
          sharedThrottleEvidence: evidence,
          sharedThrottleEvidenceKey,
          now: evidenceNow,
        }),
        /shared need ingress throttle evidence/i,
      );
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("activation readiness validators match the exact operational contracts", () => {
  const application = {
    ok: true,
    status: "ready",
    mode: "operational",
    build: releaseSha,
    migration: releaseReceipt.migration.filename,
    components: {
      database: true,
      auth: true,
      queue: true,
      agentFrameworks: true,
      sourcingLoop: true,
      migration: true,
      releaseIdentity: true,
      needIngressSharedThrottle: true,
    },
    capabilities: { autonomousSourcing: true, needIngress: true },
  };
  assert.equal(validateSourcingReadiness(application, releaseSha, releaseReceipt.migration.filename), true);
  assert.equal(validateSourcingReadiness({
    ...application,
    components: { ...application.components, needIngressSharedThrottle: false },
  }, releaseSha, releaseReceipt.migration.filename), false);

  const loop = {
    active_workers: 1,
    ambiguous_sourcing_attempts: 0,
    dead_sourcing_jobs: 0,
    expected_handler_count: 4,
    freshest_heartbeat_age_seconds: 1,
    healthy: true,
    heartbeat_status: "fresh",
    oldest_runnable_job_age_seconds: 0,
    overdue_begun_attempts: 0,
    overdue_runnable_jobs: 0,
    status: "ready",
  };
  assert.equal(validateLoopReadiness(loop), true);
  assert.equal(validateLoopReadiness({ ...loop, expected_handler_count: 3 }), false);
  assert.equal(validateLoopReadiness({ ...loop, expected_handler_count: 5 }), false);
  assert.equal(validateLoopReadiness({ ...loop, unexpected: 0 }), false);
});

test("machine verification rejects every non-activation config drift", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "aria-activation-test-"));
  try {
    const snapshot = createActivationSnapshot({
      machines: machines(), releaseReceipt, releaseSha, configDirectory: directory,
      sharedThrottleEvidence: signedSharedThrottleEvidence(), sharedThrottleEvidenceKey, now: evidenceNow,
    });
    const operational = machines();
    for (const row of operational.filter((entry) => ["web", "loop"].includes(entry.config.metadata.fly_process_group))) {
      row.config.env.ARIA_LOOP_KILL_SWITCH = "false";
      row.config.env.ARIA_SOURCING_OPERATIONAL_REQUIRED = "true";
      row.config.env.ARIA_NEED_INGRESS_SHARED_THROTTLE_VERIFIED = "true";
      row.config.env.ARIA_NEED_INGRESS_SHARED_THROTTLE_EVIDENCE_SHA256 = snapshot.state.sharedThrottleEvidenceSha256;
    }
    assert.equal(
      verifyMachinePlan({ machines: operational, state: snapshot.state, plan: snapshot.plan }).mode,
      "operational",
    );
    operational[0].config.guest.memory_mb = 512;
    assert.throws(
      () => verifyMachinePlan({ machines: operational, state: snapshot.state, plan: snapshot.plan }),
      /config mutation is not exact/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("re-dark plan preserves current config and clears shared-throttle runtime authority", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "aria-activation-test-"));
  try {
    const snapshot = createActivationSnapshot({
      machines: machines(), releaseReceipt, releaseSha, configDirectory: directory,
      sharedThrottleEvidence: signedSharedThrottleEvidence(), sharedThrottleEvidenceKey, now: evidenceNow,
    });
    const operational = machines();
    for (const row of operational.filter((entry) => ["web", "loop"].includes(entry.config.metadata.fly_process_group))) {
      row.config.env.ARIA_LOOP_KILL_SWITCH = "false";
      row.config.env.ARIA_SOURCING_OPERATIONAL_REQUIRED = "true";
      row.config.env.ARIA_NEED_INGRESS_SHARED_THROTTLE_VERIFIED = "true";
      row.config.env.ARIA_NEED_INGRESS_SHARED_THROTTLE_EVIDENCE_SHA256 = snapshot.state.sharedThrottleEvidenceSha256;
    }
    const plan = createRedarkPlan({ machines: operational, state: snapshot.state, configDirectory: directory });
    assert.equal(plan.mode, "dark");
    for (const target of plan.targets) {
      const config = JSON.parse(readFileSync(target.configPath, "utf8"));
      assert.equal(config.env.ARIA_LOOP_KILL_SWITCH, "true");
      assert.equal(config.env.ARIA_SOURCING_OPERATIONAL_REQUIRED, "false");
      assert.equal(config.env.ARIA_LOOP_ENABLE_OUTBOUND_DRAIN, "false");
      assert.equal(config.env.ARIA_NEED_INGRESS_SHARED_THROTTLE_VERIFIED, "false");
      assert.equal(config.env.ARIA_NEED_INGRESS_SHARED_THROTTLE_EVIDENCE_SHA256, "");
      assert.equal(config.env.PRESERVED_ENV, "preserved");
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("operational heartbeat must be exact-release, healthy, and no-send", () => {
  const healthy = JSON.stringify({
    timestamp: "2026-07-21T12:00:00Z",
    message: JSON.stringify({
      event: "sourcing_loop_tick",
      workerId: "loop-66666666666666",
      releaseSha,
      status: "ok",
      dispatch: "disabled",
      failureCodes: [],
      durationMs: 120,
    }),
  });
  const notBefore = "2026-07-21T11:59:59Z";
  assert.equal(verifyOperationalHeartbeat(healthy, releaseSha, notBefore), true);
  assert.equal(verifyOperationalHeartbeat(healthy, releaseSha, "2026-07-21T12:00:01Z"), false);
  assert.equal(verifyOperationalHeartbeat(healthy.replace(releaseSha, "f".repeat(40)), releaseSha, notBefore), false);
  assert.equal(verifyOperationalHeartbeat(healthy.replace('\\"disabled\\"', '\\"ok\\"'), releaseSha, notBefore), false);
  assert.equal(
    verifyOperationalHeartbeat(
      healthy.replace('\\"failureCodes\\":[]', '\\"failureCodes\\":[\\"heartbeat:failed\\"]'),
      releaseSha,
      notBefore,
    ),
    false,
  );
});
