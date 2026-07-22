import assert from "node:assert/strict";
import { after, mock, test } from "node:test";

import { NextRequest } from "next/server";
import { createProcessEnvScope } from "./helpers/process-env.mts";

const moduleUrl = (path: string) => new URL(`../${path}`, import.meta.url).href;
const workspaceId = "11111111-1111-4111-8111-111111111111";
const ownerId = "22222222-2222-4222-8222-222222222222";
const specId = "33333333-3333-4333-8333-333333333333";
const memoryId = "44444444-4444-4444-8444-444444444444";
const encryptionKey = Buffer.alloc(32, 7).toString("base64");
const noCandidateProvenance = { classification: "none" } as const;

const envScope = createProcessEnvScope(["NODE_ENV", "DATA_ENCRYPTION_KEY"]);
envScope.set({ NODE_ENV: "test", DATA_ENCRYPTION_KEY: encryptionKey });
after(() => envScope.restore());

type RpcCall = { name: string; args: Record<string, unknown> };
type MemoryRow = {
  id: string;
  spec_id: string;
  kind: string;
  content_ciphertext: string;
  content_sha256: string;
  content_byte_count: number;
  revision: number;
  status: string;
  source_type: string;
  pinned: boolean;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
};

let rpcCalls: RpcCall[] = [];
let storedRow: MemoryRow | null = null;
let mutateResult: Record<string, unknown> = { status: "updated" };
let rpcError: { code: string } | null = null;
let deleteResult: Record<string, unknown> = { status: "deleted", revision: 4 };
let queryCount = 0;

function query(table: string) {
  const filters = new Map<string, unknown>();
  const builder: any = {
    select: () => builder,
    eq: (column: string, value: unknown) => {
      filters.set(column, value);
      return builder;
    },
    neq: () => builder,
    is: () => builder,
    in: () => builder,
    order: () => builder,
    limit: () => builder,
    maybeSingle: async () => {
      queryCount += 1;
      assert.equal(filters.get("workspace_id"), workspaceId);
      assert.equal(filters.get("owner_id"), ownerId);
      if (table === "agent_specs") {
        assert.equal(filters.get("id"), specId);
        return { data: { id: specId, name: "Owner agent", status: "active" }, error: null };
      }
      assert.equal(table, "agent_memories");
      assert.equal(filters.get("spec_id"), specId);
      assert.equal(filters.get("id"), memoryId);
      return { data: storedRow, error: null };
    },
    then: (
      resolve: (value: unknown) => unknown,
      reject: (reason: unknown) => unknown,
    ) => Promise.resolve({
      data: table === "agent_memories" && storedRow ? [storedRow] : [],
      error: null,
    }).then(resolve, reject),
  };
  return builder;
}

const session = {
  auth: { getUser: async () => ({ data: { user: { id: ownerId } }, error: null }) },
  rpc: async (name: string) => ({
    data: name === "current_workspace_id"
      ? workspaceId
      : name === "current_profile_role"
        ? "member"
        : null,
    error: null,
  }),
};

const service = {
  from: (table: string) => query(table),
  rpc: async (name: string, args: Record<string, unknown>) => {
    rpcCalls.push({ name, args });
    if (name === "create_agent_memory_with_candidate_provenance") {
      storedRow = {
        id: memoryId,
        spec_id: specId,
        kind: String(args.p_kind),
        content_ciphertext: String(args.p_content_ciphertext),
        content_sha256: String(args.p_content_sha256),
        content_byte_count: Number(args.p_content_byte_count),
        revision: 1,
        status: "pending_review",
        source_type: "operator",
        pinned: Boolean(args.p_pinned),
        expires_at: null,
        created_at: "2026-07-14T12:00:00.000Z",
        updated_at: "2026-07-14T12:00:00.000Z",
      };
      return { data: { status: "created", id: memoryId, revision: 1 }, error: null };
    }
    if (name === "mutate_agent_memory_with_candidate_provenance") {
      return { data: rpcError ? null : mutateResult, error: rpcError };
    }
    if (name === "delete_agent_memory_content") {
      return { data: deleteResult, error: null };
    }
    return { data: null, error: new Error(`unexpected RPC ${name}`) };
  },
};

mock.module(moduleUrl("src/lib/supabase/config.ts"), {
  namedExports: { supabaseEnabled: true, prodFailClosed: () => null },
});
mock.module(moduleUrl("src/lib/supabase/server.ts"), {
  namedExports: {
    getServerSupabase: async () => session,
    getServiceSupabase: () => service,
    requireAdmin: async () => ({ ok: true, role: "admin" }),
  },
});

const route = await import("../src/app/api/agents/memories/route");

function request(method: "POST" | "PATCH" | "DELETE", body: unknown, options: {
  origin?: string | null;
  contentType?: string;
} = {}) {
  const headers = new Headers({
    "content-type": options.contentType ?? "application/json",
    "x-request-id": crypto.randomUUID(),
    "x-real-ip": "127.0.0.1",
  });
  if (options.origin !== null) headers.set("origin", options.origin ?? "http://localhost");
  return new NextRequest("http://localhost/api/agents/memories", {
    method,
    headers,
    body: JSON.stringify(body),
  });
}

function reset() {
  rpcCalls = [];
  storedRow = null;
  mutateResult = { status: "updated" };
  rpcError = null;
  deleteResult = { status: "deleted", revision: 4 };
  queryCount = 0;
  envScope.set({ NODE_ENV: "test", DATA_ENCRYPTION_KEY: encryptionKey });
}

test("memory mutations use the shared same-origin JSON boundary", async () => {
  reset();
  const body = {
    specId,
    kind: "fact",
    content: "reviewed fact",
    candidateProvenance: noCandidateProvenance,
  };
  const unsupported = await route.POST(request("POST", body, { contentType: "text/plain" }));
  assert.equal(unsupported.status, 415);
  assert.equal((await unsupported.json()).code, "invalid_request");
  assert.equal(unsupported.headers.get("cache-control"), "no-store");

  const missingOrigin = await route.POST(request("POST", body, { origin: null }));
  assert.equal(missingOrigin.status, 403);
  assert.equal((await missingOrigin.json()).code, "cross_origin_request");
  assert.equal(queryCount, 0);
  assert.equal(rpcCalls.length, 0);
});

test("memory create enforces the 8192-byte UTF-8 boundary before persistence", async () => {
  reset();
  const oversized = await route.POST(request("POST", {
    specId,
    kind: "fact",
    content: "€".repeat(2731),
    candidateProvenance: noCandidateProvenance,
  }));
  assert.equal(Buffer.byteLength("€".repeat(2731), "utf8"), 8193);
  assert.equal(oversized.status, 400);
  assert.equal((await oversized.json()).code, "invalid_request");
  assert.equal(queryCount, 0);
  assert.equal(rpcCalls.length, 0);

  const boundaryContent = `${"€".repeat(2730)}ab`;
  assert.equal(Buffer.byteLength(boundaryContent, "utf8"), 8192);
  const accepted = await route.POST(request("POST", {
    specId,
    kind: "instruction",
    content: boundaryContent,
    candidateProvenance: noCandidateProvenance,
  }));
  const acceptedBody = await accepted.json();
  assert.equal(accepted.status, 201);
  assert.equal(accepted.headers.get("cache-control"), "no-store");
  assert.equal(acceptedBody.memory.content, boundaryContent);
  assert.equal(acceptedBody.memory.status, "pending_review");
  assert.equal(rpcCalls.length, 1);
  assert.equal(rpcCalls[0]?.name, "create_agent_memory_with_candidate_provenance");
  assert.equal(rpcCalls[0]?.args.p_workspace_id, workspaceId);
  assert.equal(rpcCalls[0]?.args.p_owner_id, ownerId);
  assert.equal(rpcCalls[0]?.args.p_spec_id, specId);
  assert.equal(rpcCalls[0]?.args.p_content_byte_count, 8192);
  assert.equal(rpcCalls[0]?.args.p_campaign_id, null);
  assert.deepEqual(rpcCalls[0]?.args.p_candidate_identifiers, []);
});

test("memory content writes require an explicit exact candidate classification", async () => {
  reset();
  const missing = await route.POST(request("POST", {
    specId,
    kind: "fact",
    content: "Candidate alias omitted",
  }));
  assert.equal(missing.status, 400);
  assert.equal((await missing.json()).code, "invalid_request");
  assert.equal(rpcCalls.length, 0);

  const exact = await route.POST(request("POST", {
    specId,
    kind: "episodic",
    content: "Reviewed candidate-specific lesson",
    candidateProvenance: {
      classification: "exact",
      campaignId: "campaign-a",
      identifiers: [{ kind: "email", value: "candidate@example.test" }],
    },
  }));
  assert.equal(exact.status, 201);
  assert.equal(rpcCalls.length, 1);
  assert.equal(rpcCalls[0]?.args.p_campaign_id, "campaign-a");
  assert.deepEqual(rpcCalls[0]?.args.p_candidate_identifiers, [
    { kind: "email", value: "candidate@example.test" },
  ]);

  reset();
  const missingEdit = await route.PATCH(request("PATCH", {
    action: "edit",
    id: memoryId,
    specId,
    revision: 1,
    content: "Changed candidate-specific lesson",
  }));
  assert.equal(missingEdit.status, 400);
  assert.equal((await missingEdit.json()).code, "invalid_request");
  assert.equal(rpcCalls.length, 0);
});

test("production blocks free-text memory writes while preserving read and metadata operations", async () => {
  reset();
  const seeded = await route.POST(request("POST", {
    specId,
    kind: "fact",
    content: "Reviewed non-candidate operating guidance",
    candidateProvenance: noCandidateProvenance,
  }));
  assert.equal(seeded.status, 201);

  rpcCalls = [];
  queryCount = 0;
  envScope.set({ NODE_ENV: "production", DATA_ENCRYPTION_KEY: encryptionKey });

  const blockedCreate = await route.POST(request("POST", {
    specId,
    kind: "instruction",
    content: "Production free-text create must stay disabled",
    candidateProvenance: noCandidateProvenance,
  }));
  const blockedCreateBody = await blockedCreate.json();
  assert.equal(blockedCreate.status, 403);
  assert.equal(blockedCreateBody.code, "memory_content_writes_disabled");
  assert.equal(blockedCreate.headers.get("cache-control"), "no-store");
  assert.equal(blockedCreate.headers.get("pragma"), "no-cache");
  assert.equal(queryCount, 0);
  assert.equal(rpcCalls.length, 0);

  const blockedEdit = await route.PATCH(request("PATCH", {
    action: "edit",
    id: memoryId,
    specId,
    revision: 1,
    content: "Production free-text edit must stay disabled",
    candidateProvenance: noCandidateProvenance,
  }));
  const blockedEditBody = await blockedEdit.json();
  assert.equal(blockedEdit.status, 403);
  assert.equal(blockedEditBody.code, "memory_content_writes_disabled");
  assert.equal(blockedEdit.headers.get("cache-control"), "no-store");
  assert.equal(rpcCalls.length, 0);

  const metadataEdit = await route.PATCH(request("PATCH", {
    action: "edit",
    id: memoryId,
    specId,
    revision: 1,
    pinned: true,
  }));
  assert.equal(metadataEdit.status, 200);
  assert.equal(rpcCalls.at(-1)?.name, "mutate_agent_memory_with_candidate_provenance");
  assert.equal(rpcCalls.at(-1)?.args.p_content_ciphertext, null);
  assert.equal(rpcCalls.at(-1)?.args.p_replace_candidate_provenance, false);

  const read = await route.GET(new NextRequest(
    `http://localhost/api/agents/memories?specId=${specId}`,
    { method: "GET", headers: { "x-request-id": "memory-production-read" } },
  ));
  const readBody = await read.json();
  assert.equal(read.status, 200);
  assert.equal(read.headers.get("cache-control"), "no-store");
  assert.equal(readBody.memories.length, 1);
  assert.equal(readBody.memories[0].id, memoryId);

  const review = await route.PATCH(request("PATCH", {
    action: "approve",
    id: memoryId,
    specId,
    revision: 1,
  }));
  assert.equal(review.status, 200);

  const deleted = await route.DELETE(request("DELETE", {
    id: memoryId,
    specId,
    revision: 1,
  }));
  assert.equal(deleted.status, 200);
});

test("memory route maps optimistic conflicts and secure deletion receipts", async () => {
  reset();
  mutateResult = { status: "revision_conflict", revision: 3 };
  const conflict = await route.PATCH(request("PATCH", {
    action: "approve",
    id: memoryId,
    specId,
    revision: 2,
  }));
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).code, "revision_conflict");
  assert.equal(rpcCalls[0]?.name, "mutate_agent_memory_with_candidate_provenance");
  assert.equal(rpcCalls[0]?.args.p_replace_candidate_provenance, false);
  assert.equal(rpcCalls[0]?.args.p_candidate_identifiers, null);

  rpcCalls = [];
  const deleted = await route.DELETE(request("DELETE", { id: memoryId, specId, revision: 3 }));
  const deletedBody = await deleted.json();
  assert.equal(deleted.status, 200);
  assert.equal(deletedBody.id, memoryId);
  assert.equal(deletedBody.revision, 4);
  assert.equal(rpcCalls[0]?.name, "delete_agent_memory_content");
  assert.equal(rpcCalls[0]?.args.p_workspace_id, workspaceId);
  assert.equal(rpcCalls[0]?.args.p_owner_id, ownerId);
  assert.equal(rpcCalls[0]?.args.p_tombstone_byte_count, 9);
  assert.match(String(rpcCalls[0]?.args.p_tombstone_ciphertext), /^enc:v2:/);
});

test("active framework memory egress returns a retryable conflict for edits and deletion", async () => {
  reset();
  mutateResult = { status: "memory_in_use", revision: 2 };
  let response = await route.PATCH(request("PATCH", {
    action: "approve",
    id: memoryId,
    specId,
    revision: 2,
  }));
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, "memory_in_use");

  deleteResult = { status: "memory_in_use", revision: 2 };
  response = await route.DELETE(request("DELETE", { id: memoryId, specId, revision: 2 }));
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, "memory_in_use");
});

test("candidate tombstones roll back content writes with a typed conflict", async () => {
  reset();
  rpcError = { code: "23514" };
  const response = await route.PATCH(request("PATCH", {
    action: "edit",
    id: memoryId,
    specId,
    revision: 2,
    content: "Candidate-bound content",
    candidateProvenance: {
      classification: "exact",
      identifiers: [{ kind: "candidate_id", value: "erased-candidate" }],
    },
  }));
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, "candidate_provenance_blocked");
  assert.equal(rpcCalls[0]?.name, "mutate_agent_memory_with_candidate_provenance");
  assert.equal(rpcCalls[0]?.args.p_replace_candidate_provenance, true);
});

test("memory persistence fails closed without encryption authority", async () => {
  reset();
  envScope.set({ DATA_ENCRYPTION_KEY: undefined });
  const response = await route.POST(request("POST", {
    specId,
    kind: "fact",
    content: "must not persist",
    candidateProvenance: noCandidateProvenance,
  }));
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, "memory_authority_unavailable");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(rpcCalls.length, 0);
  envScope.set({ DATA_ENCRYPTION_KEY: encryptionKey });
});
