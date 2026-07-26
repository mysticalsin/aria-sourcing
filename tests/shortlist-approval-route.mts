import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { NextRequest } from "next/server";

const moduleUrl = (path: string) => new URL(`../${path}`, import.meta.url).href;

const workspaceA = "11111111-1111-4111-8111-111111111111";
const workspaceB = "22222222-2222-4222-8222-222222222222";
const actorId = "33333333-3333-4333-8333-333333333333";

let currentUser: { id: string } | null = { id: actorId };
let currentWorkspaceId: string | null = workspaceA;
let adminAllowed = true;
let draftGenerateEnabled = true;
let serviceRpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
let candidateReads = 0;

type CandidateRow = {
  workspace_id: string;
  campaign_id: string;
  id: string;
};

type JobRow = {
  workspace_id: string;
  kind: string;
  idempotency_key: string;
  payload: Record<string, unknown>;
};

const candidates: CandidateRow[] = [
  { workspace_id: workspaceA, campaign_id: "camp-a", id: "cand-a" },
  { workspace_id: workspaceA, campaign_id: "camp-a", id: "cand-b" },
  { workspace_id: workspaceB, campaign_id: "camp-b", id: "cand-other" },
];
const ariaJobs: JobRow[] = [];

const session = {
  auth: { getUser: async () => ({ data: { user: currentUser }, error: null }) },
  rpc: async (name: string) => ({
    data: name === "current_workspace_id" ? currentWorkspaceId : null,
    error: null,
  }),
};

function samePayload(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

const service = {
  rpc: async (name: string, args: Record<string, unknown>) => {
    serviceRpcCalls.push({ name, args });
    if (name === "sourcing_loop_stage_enabled") {
      return { data: draftGenerateEnabled, error: null };
    }
    if (name === "enqueue_aria_job") {
      const payload = args.p_payload as Record<string, unknown>;
      const existing = ariaJobs.find(
        (job) =>
          job.workspace_id === args.p_workspace_id &&
          job.kind === args.p_kind &&
          job.idempotency_key === args.p_idempotency_key,
      );
      if (existing) {
        if (!samePayload(existing.payload, payload)) {
          return { data: { status: "idempotency_conflict" }, error: null };
        }
        return { data: { status: "enqueued", id: `job-${ariaJobs.indexOf(existing) + 1}`, replay: true }, error: null };
      }
      ariaJobs.push({
        workspace_id: String(args.p_workspace_id),
        kind: String(args.p_kind),
        idempotency_key: String(args.p_idempotency_key),
        payload,
      });
      return { data: { status: "enqueued", id: `job-${ariaJobs.length}`, replay: false }, error: null };
    }
    return { data: null, error: null };
  },
  from: (table: string) => {
    assert.equal(table, "candidates");
    return {
      select: () => ({
        eq: (_column: string, workspaceId: string) => ({
          in: async (_column: string, ids: string[]) => {
            candidateReads += 1;
            return {
              data: candidates
                .filter((candidate) => candidate.workspace_id === workspaceId && ids.includes(candidate.id))
                .map(({ id, campaign_id }) => ({ id, campaign_id })),
              error: null,
            };
          },
        }),
      }),
    };
  },
};

mock.module(moduleUrl("src/lib/supabase/server.ts"), {
  namedExports: {
    getServerSupabase: async () => session,
    getServiceSupabase: () => service,
    requireAdmin: async () => {
      if (!currentUser) {
        return { ok: false, response: new Response(JSON.stringify({ ok: false }), { status: 401 }) };
      }
      if (!adminAllowed) {
        return { ok: false, response: new Response(JSON.stringify({ ok: false }), { status: 403 }) };
      }
      return { ok: true, role: "admin" };
    },
  },
});

const route = await import("../src/app/api/shortlist/approve/route.ts");

function reset() {
  currentUser = { id: actorId };
  currentWorkspaceId = workspaceA;
  adminAllowed = true;
  draftGenerateEnabled = true;
  serviceRpcCalls = [];
  candidateReads = 0;
  ariaJobs.length = 0;
}

function request(
  candidateIds: string[],
  options: { origin?: string; contentType?: string } = {},
) {
  return new NextRequest("http://localhost/api/shortlist/approve", {
    method: "POST",
    headers: {
      "content-type": options.contentType ?? "application/json",
      origin: options.origin ?? "http://localhost",
      "x-request-id": crypto.randomUUID(),
    },
    body: JSON.stringify({ candidateIds }),
  });
}

test("authenticated shortlist approval enqueues one draft_generate row per candidate", async () => {
  reset();
  const response = await route.POST(request(["cand-a", "cand-b"]));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.jobs.length, 2);
  assert.deepEqual(
    ariaJobs.map((job) => ({ kind: job.kind, idempotencyKey: job.idempotency_key, payload: job.payload })),
    [
      {
        kind: "draft_generate",
        idempotencyKey: "draft:camp-a:cand-a",
        payload: { campaignId: "camp-a", candidateId: "cand-a", approvedBy: actorId, approvalSource: "human" },
      },
      {
        kind: "draft_generate",
        idempotencyKey: "draft:camp-a:cand-b",
        payload: { campaignId: "camp-a", candidateId: "cand-b", approvedBy: actorId, approvalSource: "human" },
      },
    ],
  );

  const replay = await route.POST(request(["cand-a", "cand-b"]));
  assert.equal(replay.status, 200);
  assert.equal(ariaJobs.length, 2);
});

test("unauthenticated shortlist approval writes no draft job", async () => {
  reset();
  currentUser = null;

  const response = await route.POST(request(["cand-a"]));

  assert.equal(response.status, 401);
  assert.equal(ariaJobs.length, 0);
  assert.equal(candidateReads, 0);
  assert.equal(serviceRpcCalls.length, 0);
});

test("shortlist approval from another workspace writes no draft job", async () => {
  reset();
  currentWorkspaceId = workspaceB;

  const response = await route.POST(request(["cand-a"]));

  assert.equal(response.status, 404);
  assert.equal(ariaJobs.length, 0);
  assert.equal(candidateReads, 1);
  assert.equal(serviceRpcCalls.filter((call) => call.name === "enqueue_aria_job").length, 0);
});

test("cross-origin shortlist approval writes no draft job", async () => {
  reset();

  const response = await route.POST(request(["cand-a"], { origin: "https://attacker.test" }));

  assert.equal(response.status, 403);
  assert.equal(ariaJobs.length, 0);
  assert.equal(candidateReads, 0);
  assert.equal(serviceRpcCalls.length, 0);
});

test("kill-switched or sourcing-disabled shortlist approval writes no draft job", async () => {
  reset();
  draftGenerateEnabled = false;

  const response = await route.POST(request(["cand-a"]));

  assert.equal(response.status, 403);
  assert.equal(ariaJobs.length, 0);
  assert.equal(candidateReads, 0);
  assert.equal(serviceRpcCalls.filter((call) => call.name === "enqueue_aria_job").length, 0);
  assert.deepEqual(serviceRpcCalls[0], {
    name: "sourcing_loop_stage_enabled",
    args: { p_workspace_id: workspaceA, p_kind: "draft_generate" },
  });
});
