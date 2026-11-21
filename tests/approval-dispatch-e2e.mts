/**
 * End-to-end against the disposable Postgres started by approval-dispatch-db.sh.
 * Not a source scan: claim, the pre-dispatch trigger, and dispatchDue all run.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { exactBodyHash, OUTREACH_NOTICE_VERSION } from "../src/lib/approval/hash.ts";
import { dispatchDue } from "../src/lib/dispatch-outbound.ts";
import { approvalHash, approvalScopeHash } from "../src/lib/outreach-content.ts";

const NETWORK = process.env.APPROVAL_DB_NETWORK ?? "";
const PASSWORD = process.env.APPROVAL_DB_PASSWORD ?? "";
const IMAGE = process.env.APPROVAL_DB_IMAGE ?? "";

const WS = "61111111-1111-4111-8111-111111111111";
const USER = "e2000000-0000-4000-8000-000000000002";
const SEAT = "6a000000-0000-4000-8000-0000000000aa";
const APPROVED_AT = "2026-11-21T00:00:00.000Z";
const RECIPIENT = "ada.dispatch@example.test";
const OTHER = "other.dispatch@example.test";
const SUBJECT = "Example note";
const BODY = "Hi Ada, the example ledger is why I wrote. The team works in Go and Postgres. Open to a short conversation Thursday?";
const EDITED = `${BODY} Edited.`;
const CANDIDATE = "cand-dispatch-1";

const OK_APPROVAL = "msg-dispatch-ok";
const EDIT_APPROVAL = "msg-dispatch-edited";
const SWAP_APPROVAL = "msg-dispatch-swapped";
const OK_ROW = "6c000000-0000-4000-8000-0000000000c1";
const EDIT_ROW = "6c000000-0000-4000-8000-0000000000c2";
const SWAP_ROW = "6c000000-0000-4000-8000-0000000000c3";

function psql(sql: string): string {
  const result = spawnSync(
    "docker",
    [
      "run", "--rm", "-i",
      "--network", NETWORK,
      "--env", `PGPASSWORD=${PASSWORD}`,
      "--entrypoint", "psql",
      IMAGE,
      "-X", "-q", "-v", "ON_ERROR_STOP=1",
      "-h", "db", "-U", "postgres", "-d", "postgres",
      "-t", "-A",
    ],
    { input: sql, encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || "psql failed");
  }
  return result.stdout.trim();
}

function serviceJson(call: string): Record<string, unknown> {
  const raw = psql(`
    select set_config('request.jwt.claims', '{"sub":"${USER}","role":"service_role"}', false);
    select set_config('request.jwt.claim.sub', '${USER}', false);
    select set_config('request.jwt.claim.role', 'service_role', false);
    set role service_role;
    select (${call})::text;
  `);
  const line = raw.split(/\n/).map((item) => item.trim()).filter(Boolean).at(-1) ?? "";
  return JSON.parse(line) as Record<string, unknown>;
}

function sqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function rows(sql: string): Array<Record<string, unknown>> {
  const raw = psql(`select coalesce(json_agg(row_to_json(t)), '[]'::json)::text from (${sql}) t;`);
  return JSON.parse(raw) as Array<Record<string, unknown>>;
}

function hashes(body: string, recipient: string) {
  return {
    wire: approvalHash(SUBJECT, body),
    scope: approvalScopeHash({ candidateId: CANDIDATE, channel: "Email", recipient }) ?? "",
    exact: exactBodyHash({
      channel: "Email",
      recipient,
      subject: SUBJECT,
      body,
      noticeVersion: OUTREACH_NOTICE_VERSION,
      approverId: USER,
      approvedAt: APPROVED_AT,
    }),
  };
}

function insertApproval(messageId: string, body: string, recipient: string): void {
  const hash = hashes(body, recipient);
  psql(`
    insert into public.outreach_approvals(
      workspace_id, message_id, body_hash, exact_body_hash, approval_scope_hash,
      approved_by, approved_at, approval_source
    ) values (
      '${WS}', ${sqlLiteral(messageId)}, ${sqlLiteral(hash.wire)}, ${sqlLiteral(hash.exact)},
      ${sqlLiteral(hash.scope)}, '${USER}', '${APPROVED_AT}'::timestamptz, 'human'
    );
  `);
}

function insertOutbound(id: string, approvalId: string, body: string, recipient: string): void {
  psql(`
    insert into public.messages_outbound(
      id, workspace_id, candidate_id, seat_id, channel, to_address, type, subject, body,
      status, dedupe_hash, scheduled_at, approval_message_id, campaign_id
    ) values (
      '${id}', '${WS}', '${CANDIDATE}', '${SEAT}', 'Email', ${sqlLiteral(recipient)},
      'candidate_reply', ${sqlLiteral(SUBJECT)}, ${sqlLiteral(body)}, 'queued',
      ${sqlLiteral(`dedupe-${id}`)}, now() - interval '1 minute', ${sqlLiteral(approvalId)}, 'camp-dispatch'
    );
  `);
}

function client() {
  return {
    from(table: string) {
      const filters: Array<{ col: string; op: "eq" | "lte" | "is"; val: unknown }> = [];
      let patch: Record<string, unknown> | null = null;
      const where = () => filters.map((filter) => {
        if (filter.op === "is") return `${filter.col} is null`;
        if (filter.op === "lte") return `${filter.col} <= ${sqlLiteral(String(filter.val))}::timestamptz`;
        return `${filter.col} = ${sqlLiteral(String(filter.val))}`;
      }).join(" and ");
      const api = {
        select: () => api,
        update: (next: Record<string, unknown>) => {
          patch = next;
          return api;
        },
        eq: (col: string, val: unknown) => {
          filters.push({ col, op: "eq", val });
          return api;
        },
        lte: (col: string, val: unknown) => {
          filters.push({ col, op: "lte", val });
          return api;
        },
        is: (col: string, val: unknown) => {
          filters.push({ col, op: "is", val });
          return api;
        },
        order: () => api,
        limit: async () => ({ data: rows(`select * from public.${table} where ${where()}`), error: null }),
        maybeSingle: async () => {
          if (patch) {
            const assignments = Object.entries(patch).map(([key, value]) => {
              if (value === null) return `${key} = null`;
              if (typeof value === "object") return `${key} = ${sqlLiteral(JSON.stringify(value))}::jsonb`;
              return `${key} = ${sqlLiteral(String(value))}`;
            }).join(", ");
            const raw = psql(`
              with updated as (
                update public.${table} set ${assignments} where ${where()} returning *
              )
              select coalesce(json_agg(row_to_json(updated)), '[]'::json)::text from updated;
            `);
            const updated = JSON.parse(raw) as Array<Record<string, unknown>>;
            return { data: updated[0] ?? null, error: null };
          }
          const found = rows(`select * from public.${table} where ${where()}`);
          return { data: found[0] ?? null, error: null };
        },
        single: async () => {
          const found = rows(`select * from public.${table} where ${where()}`);
          return { data: found[0] ?? null, error: found[0] ? null : { message: "no row" } };
        },
      };
      return api;
    },
    async rpc(fn: string, args: Record<string, unknown> = {}) {
      const typed = Object.entries(args).map(([key, value]) => {
        if (typeof value === "number") return `${key} := ${value}`;
        if (key === "p_message_id" && fn !== "claim_email_outbound") return `${key} := ${sqlLiteral(String(value))}::uuid`;
        if (key.endsWith("_id") && key !== "p_message_id") return `${key} := ${sqlLiteral(String(value))}::uuid`;
        if (key === "p_workspace_id") return `${key} := ${sqlLiteral(String(value))}::uuid`;
        return `${key} := ${sqlLiteral(String(value))}`;
      }).join(", ");
      try {
        return { data: serviceJson(`public.${fn}(${typed})`), error: null };
      } catch (error) {
        return { data: null, error: { message: error instanceof Error ? error.message : "rpc failed" } };
      }
    },
  };
}

test("test_approved_email_passes_claim_trigger_and_dispatcher", async () => {
  assert.ok(NETWORK && PASSWORD && IMAGE, "the database shell must export the disposable Postgres");
  psql(`
    insert into auth.users (
      id, instance_id, aud, role, email, encrypted_password, confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at
    ) values (
      '${USER}','00000000-0000-0000-0000-000000000000','authenticated','authenticated',
      'dispatch-member@example.test','',now(),'{}','{}',now(),now()
    );
    insert into public.workspaces(id, name, allowed_domain) values
      ('${WS}','Dispatch','example.test');
    insert into public.profiles(id, email, full_name, workspace_id, role) values
      ('${USER}','dispatch-member@example.test','Dispatch Member','${WS}','member');
    insert into public.agent_seats(
      id, workspace_id, name, operator_email, provider, status, mode, domain_verified, daily_limit, warmup
    ) values (
      '${SEAT}','${WS}','Dispatch seat','recruiter@example.test','Resend','active','live', true, 40, false
    );
  `);

  const good = hashes(BODY, RECIPIENT);
  const sqlExact = psql(`
    select public.exact_outreach_body_hash(
      'Email', ${sqlLiteral(RECIPIENT)}, ${sqlLiteral(SUBJECT)}, ${sqlLiteral(BODY)},
      '${OUTREACH_NOTICE_VERSION}', '${USER}', '${APPROVED_AT}'::timestamptz
    );
  `);
  assert.equal(sqlExact, good.exact, "Postgres and TypeScript exact hashes diverge");

  insertApproval(OK_APPROVAL, BODY, RECIPIENT);
  insertApproval(EDIT_APPROVAL, BODY, RECIPIENT);
  insertApproval(SWAP_APPROVAL, BODY, RECIPIENT);
  insertOutbound(OK_ROW, OK_APPROVAL, BODY, RECIPIENT);
  insertOutbound(EDIT_ROW, EDIT_APPROVAL, EDITED, RECIPIENT);
  insertOutbound(SWAP_ROW, SWAP_APPROVAL, BODY, OTHER);

  const editedClaim = serviceJson(`public.claim_email_outbound_queued('${EDIT_ROW}'::uuid)`);
  assert.equal(editedClaim.allowed, false);
  const swappedClaim = serviceJson(`public.claim_email_outbound_queued('${SWAP_ROW}'::uuid)`);
  assert.equal(swappedClaim.allowed, false);
  assert.throws(
    () => psql(`update public.messages_outbound set status = 'dispatching' where id = '${EDIT_ROW}';`),
    /active human approval required/,
  );
  assert.throws(
    () => psql(`update public.messages_outbound set status = 'dispatching' where id = '${SWAP_ROW}';`),
    /active human approval required/,
  );
  assert.equal(psql(`select status from public.messages_outbound where id = '${EDIT_ROW}';`), "queued");
  assert.equal(psql(`select status from public.messages_outbound where id = '${SWAP_ROW}';`), "queued");

  process.env.ARIA_RECIPIENT_ALLOWLIST = `${RECIPIENT},${OTHER}`;
  process.env.OUTREACH_UNSUBSCRIBE_BASE_URL = "https://aria.example.test";
  process.env.NEXT_PUBLIC_ENABLE_DEMO_LOGIN = "false";
  delete process.env.RESEND_API_KEY;
  delete process.env.SENDGRID_API_KEY;
  delete process.env.ARIA_SEND_KILL_SWITCH;

  const db = client();
  const editedStats = await dispatchDue(db as never, 10, EDIT_ROW);
  assert.equal(editedStats.blocked, 1);
  assert.equal(editedStats.sent, 0);
  const editedGate = psql(`select gate_result::text from public.messages_outbound where id = '${EDIT_ROW}';`);
  assert.match(editedGate, /approval-hash-mismatch/);

  const swappedStats = await dispatchDue(db as never, 10, SWAP_ROW);
  assert.equal(swappedStats.blocked, 1);
  assert.equal(swappedStats.sent, 0);
  const swappedGate = psql(`select gate_result::text from public.messages_outbound where id = '${SWAP_ROW}';`);
  // The recipient is inside exactBodyHash, so a swap fails the exact hash before the scope compare.
  assert.match(swappedGate, /approval-hash-mismatch/);

  const okStats = await dispatchDue(db as never, 10, OK_ROW);
  assert.equal(okStats.blocked, 0);
  assert.equal(okStats.unconfigured, 1);
  const ledger = psql(`select count(*) from public.outreach_ledger where outbound_message_id = '${OK_ROW}';`);
  assert.equal(ledger, "1");
  const status = psql(`select status from public.messages_outbound where id = '${OK_ROW}';`);
  assert.ok(status === "failed" || status === "dispatching", status);

  const second = serviceJson(`public.consume_outreach_channel_daily_cap('${WS}'::uuid, 'Email', 1)`);
  assert.equal(second.allowed, false);
  assert.equal(second.reason, "channel-cap");
});
