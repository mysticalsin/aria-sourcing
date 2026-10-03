import assert from "node:assert/strict";
import { mock, test } from "node:test";

import { NextRequest } from "next/server";

const moduleUrl = (path: string) => new URL(`../${path}`, import.meta.url).href;
const WORKSPACE_ID = "51111111-1111-4111-8111-111111111111";
const OTHER_WORKSPACE_ID = "52222222-2222-4222-8222-222222222222";
const CRON_SECRET = ["cron", "secret", "material", "with", "enough", "length", "0001"].join("-");

let controls: Array<Record<string, unknown>> = [];
let ariaJobs: Array<Record<string, unknown>> = [];

function reset() {
  controls = [
    {
      workspace_id: WORKSPACE_ID,
      kill_switch: false,
      intake_enabled: true,
    },
  ];
  ariaJobs = [];
  process.env.CRON_SECRET = CRON_SECRET;
}

function fakeQuery(table: string) {
  const filters: Array<(row: Record<string, unknown>) => boolean> = [];
  const rows = table === "sourcing_loop_controls" ? controls : [];
  const query = {
    select: () => query,
    eq: (column: string, value: unknown) => {
      filters.push((row) => row[column] === value);
      return query;
    },
    maybeSingle: async () => ({ data: rows.find((row) => filters.every((filter) => filter(row))) ?? null, error: null }),
  };
  return query;
}

mock.module(moduleUrl("src/lib/supabase/server.ts"), {
  namedExports: {
    getServiceSupabase: () => ({
      from: (table: string) => fakeQuery(table),
      rpc: async (name: string, args: Record<string, unknown>) => {
        if (name !== "enqueue_aria_job") throw new Error(`unexpected rpc ${name}`);
        const existing = ariaJobs.find(
          (row) =>
            row.workspace_id === args.p_workspace_id &&
            row.kind === args.p_kind &&
            row.idempotency_key === args.p_idempotency_key,
        );
        if (existing) {
          return { data: { status: "enqueued", id: existing.id, replay: true }, error: null };
        }
        const row = {
          id: `job-${ariaJobs.length + 1}`,
          workspace_id: args.p_workspace_id,
          kind: args.p_kind,
          idempotency_key: args.p_idempotency_key,
          payload: args.p_payload,
        };
        ariaJobs.push(row);
        return { data: { status: "enqueued", id: row.id, replay: false }, error: null };
      },
    }),
  },
});

const route = await import("../src/app/api/cron/ignite-sourcing-loop/route.ts");
const post = ((route as any).POST ?? (route as any).default?.POST) as (request: NextRequest) => Promise<Response>;

function request(headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/cron/ignite-sourcing-loop", {
    method: "POST",
    headers: {
      "x-aria-workspace-id": WORKSPACE_ID,
      ...headers,
    },
  });
}

test("valid machine credential ignites one idempotent email_sync root job", async () => {
  reset();

  await post(request({ authorization: `Bearer ${CRON_SECRET}` }));
  await post(request({ authorization: `Bearer ${CRON_SECRET}` }));

  assert.equal(ariaJobs.length, 1);
  assert.equal(ariaJobs[0].workspace_id, WORKSPACE_ID);
  assert.equal(ariaJobs[0].kind, "email_sync");
  assert.match(String(ariaJobs[0].idempotency_key), /^ignite:email_sync:/);
  assert.deepEqual(ariaJobs[0].payload, {});
});

test("machine ignition refuses missing credential without writing a job", async () => {
  reset();

  await post(request());

  assert.equal(ariaJobs.length, 0);
});

test("machine ignition refuses malformed credential without writing a job", async () => {
  reset();

  await post(request({ authorization: "Bearer wrong-secret" }));

  assert.equal(ariaJobs.length, 0);
});

test("machine ignition refuses a credential scoped to another workspace without writing a job", async () => {
  reset();

  await post(request({ authorization: `Bearer ${CRON_SECRET}`, "x-aria-workspace-id": OTHER_WORKSPACE_ID }));

  assert.equal(ariaJobs.length, 0);
});

test("machine ignition refuses a browser cookie session without writing a job", async () => {
  reset();

  await post(request({ cookie: "sb-access-token=browser-session", origin: "http://localhost" }));

  assert.equal(ariaJobs.length, 0);
});
