import assert from "node:assert/strict";
import { mock, test } from "node:test";

const moduleUrl = (path: string) => new URL(`../${path}`, import.meta.url).href;
const workspaceId = "11111111-1111-4111-8111-111111111111";
const userId = "user-1";
const targetId = "22222222-2222-4222-8222-222222222222";
const candidateId = "99999999-9999-4999-8999-999999999999";
const campaignId = "campaign-1";
const nonce = "33333333-3333-4333-8333-333333333333";
const attemptId = "55555555-5555-4555-8555-555555555555";
const eventId = "77777777-7777-4777-8777-777777777777";

let available = true;
let response: { data: unknown; error: unknown } = { data: null, error: null };
let lastRpc: { name: string; args: Record<string, unknown> } | null = null;

mock.module("server-only", { namedExports: {} });
mock.module(moduleUrl("src/lib/supabase/server.ts"), {
  namedExports: {
    getServiceSupabase: () =>
      available
        ? {
            rpc: async (name: string, args: Record<string, unknown>) => {
              lastRpc = { name, args };
              return response;
            },
          }
        : null,
  },
});

const authority = await import("../src/lib/sourcing/source-authority");

const person = {
  id: "apollo-person-1",
  name: "Ada Lovelace",
  title: "Engineer",
  company: "Analytical Engines",
  linkedinUrl: "https://www.linkedin.com/in/ada-lovelace",
  city: "London",
  state: "",
  country: "United Kingdom",
  headline: "Engineer",
  seniority: "senior",
  departments: ["engineering"],
};

function reset() {
  available = true;
  response = { data: null, error: null };
  lastRpc = null;
}

test("registration sends raw provider ids only to service authority and returns opaque profiles", async () => {
  reset();
  response = {
    data: [{ target_id: targetId, candidate_id: candidateId, provider_external_id: person.id }],
    error: null,
  };

  const profiles = await authority.registerApolloEnrichmentTargets(
    { workspaceId, userId, campaignId },
    [person],
  );

  assert.equal(lastRpc?.name, "register_apollo_enrichment_targets");
  assert.deepEqual(lastRpc?.args, {
    p_workspace_id: workspaceId,
    p_user_id: userId,
    p_campaign_id: campaignId,
    p_profiles: [
      {
        providerExternalId: person.id,
        profile: {
          name: person.name,
          title: person.title,
          company: person.company,
          linkedinUrl: person.linkedinUrl,
          city: person.city,
          state: person.state,
          country: person.country,
          headline: person.headline,
          seniority: person.seniority,
          departments: person.departments,
        },
      },
    ],
  });
  const { id: _providerExternalId, ...publicProfile } = person;
  assert.deepEqual(profiles, [{ ...publicProfile, targetId, candidateId }]);
  assert.equal("id" in (profiles?.[0] ?? {}), false);
});

test("registration fails closed on missing service, malformed ids, or partial authority", async () => {
  reset();
  available = false;
  assert.equal(
    await authority.registerApolloEnrichmentTargets({ workspaceId, userId, campaignId }, [person]),
    null,
  );

  reset();
  response = {
    data: [{ target_id: "not-a-uuid", candidate_id: candidateId, provider_external_id: person.id }],
    error: null,
  };
  assert.equal(
    await authority.registerApolloEnrichmentTargets({ workspaceId, userId, campaignId }, [person]),
    null,
  );

  reset();
  response = { data: [], error: null };
  assert.equal(
    await authority.registerApolloEnrichmentTargets({ workspaceId, userId, campaignId }, [person]),
    null,
  );
});

test("selection binds the exact server candidate and campaign before enrichment", async () => {
  reset();
  response = { data: { ok: true }, error: null };
  assert.equal(
    await authority.selectApolloEnrichmentTargets(
      { workspaceId, userId, campaignId },
      [{ targetId, candidateId }],
    ),
    true,
  );
  assert.deepEqual(lastRpc, {
    name: "select_apollo_enrichment_target",
    args: {
      p_workspace_id: workspaceId,
      p_user_id: userId,
      p_campaign_id: campaignId,
      p_target_id: targetId,
      p_candidate_id: candidateId,
    },
  });
});

test("prepare accepts only a canonical normalized nonce and expiry", async () => {
  reset();
  response = {
    data: {
      status: "prepared",
      confirmation_nonce: nonce,
      expires_at: "2026-07-13T07:00:00.000Z",
    },
    error: null,
  };
  assert.deepEqual(
    await authority.prepareApolloEnrichmentTarget({ workspaceId, userId, campaignId, candidateId, targetId, scope: "email" }),
    {
      status: "prepared",
      confirmationNonce: nonce,
      expiresAt: "2026-07-13T07:00:00.000Z",
    },
  );

  response = {
    data: { status: "prepared", confirmation_nonce: "not-a-uuid", expires_at: "tomorrow" },
    error: null,
  };
  assert.deepEqual(
    await authority.prepareApolloEnrichmentTarget({ workspaceId, userId, campaignId, candidateId, targetId, scope: "email" }),
    { status: "dependency_unavailable" },
  );

  response = {
    data: {
      status: "already_erased",
      target_id: targetId,
      original_event_id: eventId,
    },
    error: null,
  };
  assert.deepEqual(
    await authority.eraseApolloEnrichmentTarget({
      workspaceId,
      userId,
      campaignId,
      candidateId,
      targetId,
      caseReference: `candidate-erasure:${candidateId}`,
      requestId: "erase-request-fresh-after-lost-response",
    }),
    {
      status: "erased",
      targetId,
      clearedReceipts: 0,
      cancelledAttempts: 0,
      eventId,
    },
  );
});

test("claim validates provider authority and preserves bounded terminal states", async () => {
  reset();
  response = {
    data: { status: "claimed", attempt_id: attemptId, provider_external_id: person.id },
    error: null,
  };
  assert.deepEqual(
    await authority.claimApolloEnrichmentTarget({
      workspaceId,
      userId,
      campaignId,
      candidateId,
      targetId,
      scope: "email",
      confirmationNonce: nonce,
      idempotencyKey: "44444444-4444-4444-8444-444444444444",
      requestId: "request-1",
    }),
    { status: "claimed", attemptId, providerExternalId: person.id },
  );

  response = {
    data: { status: "claimed", attempt_id: attemptId, provider_external_id: "x".repeat(201) },
    error: null,
  };
  assert.deepEqual(
    await authority.claimApolloEnrichmentTarget({
      workspaceId,
      userId,
      campaignId,
      candidateId,
      targetId,
      scope: "email",
      confirmationNonce: nonce,
      idempotencyKey: "44444444-4444-4444-8444-444444444444",
      requestId: "request-1",
    }),
    { status: "dependency_unavailable" },
  );

  response = { data: { status: "quota_exceeded" }, error: null };
  assert.deepEqual(
    await authority.claimApolloEnrichmentTarget({
      workspaceId,
      userId,
      campaignId,
      candidateId,
      targetId,
      scope: "email",
      confirmationNonce: nonce,
      idempotencyKey: "44444444-4444-4444-8444-444444444444",
      requestId: "request-1",
    }),
    { status: "quota_exceeded" },
  );
});

test("receipt completion and ambiguity return true only for exact service acknowledgements", async () => {
  reset();
  response = { data: { ok: true }, error: null };
  assert.equal(
    await authority.completeApolloEnrichmentTarget({
      workspaceId,
      userId,
      targetId,
      attemptId,
      found: true,
      emailSecret: "encrypted",
      phoneSecret: "",
    }),
    true,
  );
  assert.equal(lastRpc?.name, "complete_apollo_enrichment");

  response = { data: { ok: false }, error: null };
  assert.equal(
    await authority.markApolloEnrichmentAmbiguous({ workspaceId, userId, targetId, attemptId }),
    false,
  );
});

test("reconciliation queue parsing is bounded and normalizes database timestamps", async () => {
  reset();
  response = {
    data: [
      {
        attempt_id: attemptId,
        target_id: targetId,
        provider_external_id: person.id,
        requester_id: "66666666-6666-4666-8666-666666666666",
        status: "ambiguous",
        version: 2,
        request_id: "claim-request-1",
        created_at: "2026-07-13T08:00:00+00:00",
        lease_expires_at: "2026-07-13T08:02:00+00:00",
        ambiguous_at: "2026-07-13T08:00:20+00:00",
      },
    ],
    error: null,
  };
  assert.deepEqual(
    await authority.listApolloEnrichmentReconciliation(
      { workspaceId, userId },
      { beforeCreated: null, beforeId: null, limit: 20 },
    ),
    [
      {
        attemptId,
        targetId,
        providerExternalId: person.id,
        requesterId: "66666666-6666-4666-8666-666666666666",
        status: "ambiguous",
        version: 2,
        requestId: "claim-request-1",
        createdAt: "2026-07-13T08:00:00.000Z",
        leaseExpiresAt: "2026-07-13T08:02:00.000Z",
        ambiguousAt: "2026-07-13T08:00:20.000Z",
      },
    ],
  );

  response = { data: [{ attempt_id: attemptId, provider_external_id: "x".repeat(201) }], error: null };
  assert.equal(
    await authority.listApolloEnrichmentReconciliation(
      { workspaceId, userId },
      { beforeCreated: null, beforeId: null, limit: 20 },
    ),
    null,
  );
});

test("reconciliation parser returns only typed state-machine outcomes", async () => {
  reset();
  response = {
    data: {
      status: "reconciled",
      attempt_id: attemptId,
      attempt_status: "cancelled",
      version: 3,
      event_id: "77777777-7777-4777-8777-777777777777",
    },
    error: null,
  };
  assert.deepEqual(
    await authority.reconcileApolloEnrichment({
      workspaceId,
      userId,
      attemptId,
      expectedVersion: 2,
      action: "release_no_charge",
      emailSecret: "",
      caseReference: "INC-2026-0713",
      evidenceSha256: "a".repeat(64),
      requestId: "reconcile-request-1",
    }),
    {
      status: "reconciled",
      attemptId,
      attemptStatus: "cancelled",
      version: 3,
      eventId: "77777777-7777-4777-8777-777777777777",
    },
  );

  response = { data: { status: "conflict" }, error: null };
  assert.deepEqual(
    await authority.reconcileApolloEnrichment({
      workspaceId,
      userId,
      attemptId,
      expectedVersion: 2,
      action: "release_no_charge",
      emailSecret: "",
      caseReference: "INC-2026-0713",
      evidenceSha256: "a".repeat(64),
      requestId: "reconcile-request-1",
    }),
    { status: "conflict" },
  );
});

test("erasure binds the exact campaign, candidate, and target and validates its receipt", async () => {
  reset();
  response = {
    data: {
      status: "erased",
      target_id: targetId,
      cleared_receipts: 1,
      cancelled_attempts: 2,
      event_id: eventId,
    },
    error: null,
  };
  assert.deepEqual(
    await authority.eraseApolloEnrichmentTarget({
      workspaceId,
      userId,
      campaignId,
      candidateId,
      targetId,
      caseReference: `candidate-erasure:${candidateId}`,
      requestId: "erase-request-1",
    }),
    {
      status: "erased",
      targetId,
      clearedReceipts: 1,
      cancelledAttempts: 2,
      eventId,
    },
  );
  assert.deepEqual(lastRpc, {
    name: "erase_apollo_enrichment_target",
    args: {
      p_workspace_id: workspaceId,
      p_actor_id: userId,
      p_campaign_id: campaignId,
      p_candidate_id: candidateId,
      p_target_id: targetId,
      p_case_reference: `candidate-erasure:${candidateId}`,
      p_request_id: "erase-request-1",
    },
  });

  response = {
    data: {
      status: "erased",
      target_id: "88888888-8888-4888-8888-888888888888",
      cleared_receipts: 0,
      cancelled_attempts: 0,
    },
    error: null,
  };
  assert.deepEqual(
    await authority.eraseApolloEnrichmentTarget({
      workspaceId,
      userId,
      campaignId,
      candidateId,
      targetId,
      caseReference: `candidate-erasure:${candidateId}`,
      requestId: "erase-request-2",
    }),
    { status: "dependency_unavailable" },
  );
});
