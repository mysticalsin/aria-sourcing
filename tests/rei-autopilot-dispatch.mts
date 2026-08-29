/* ============================================================================
   tests/rei-autopilot-dispatch.mts — mocked mint → enqueue for REI autopilot
   ========================================================================== */

import { mock } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

mock.module("server-only", { namedExports: {} });
mock.module("../src/lib/dispatch-outbound", {
  namedExports: {
    dispatchDue: async () => ({ claimed: 0, sent: 0, failed: 0, blocked: 0, unconfigured: 0 }),
  },
});

const { runAutopilotOutreachDispatch } = await import("../src/lib/rei-autopilot-dispatch");

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

type Row = Record<string, unknown>;

function makeSvc(opts: {
  entitled?: boolean;
  sequencesArmed?: boolean;
  seats?: Row[];
  mintStatus?: string;
  enqueue?: { ok?: boolean; id?: string; reason?: string };
  rpcError?: string;
}) {
  const rpcs: { name: string; args: Row }[] = [];
  const seats = opts.seats ?? [
    {
      id: "seat-mail-1",
      provider: "Microsoft Graph",
      status: "active",
      mode: "live",
      domain_verified: true,
      operator_email: "recruiter@example.com",
    },
  ];
  const controls = {
    kill_switch: opts.sequencesArmed === false,
    sequences_enabled: opts.sequencesArmed !== false,
  };
  const entitledId = opts.entitled === false ? null : "user-entitled-1";

  const svc = {
    from(table: string) {
      const filters: Array<(r: Row) => boolean> = [];
      const chain: Record<string, unknown> = {};
      const self = () => chain;
      chain.select = () => self();
      chain.eq = (_col: string, _val: unknown) => self();
      chain.in = () => self();
      chain.limit = () => self();
      chain.maybeSingle = async () => {
        if (table === "sourcing_loop_controls") return { data: controls, error: null };
        if (table === "profiles") {
          return { data: entitledId ? { id: entitledId } : null, error: null };
        }
        return { data: null, error: null };
      };
      // agent_seats uses bare await (no maybeSingle)
      const thenable = {
        then(resolve: (v: unknown) => void) {
          if (table === "agent_seats") {
            resolve({ data: seats, error: null });
            return;
          }
          resolve({ data: null, error: null });
        },
      };
      Object.assign(chain, thenable);
      // Keep filter hooks for realism
      chain.eq = () => Object.assign(self(), thenable);
      return chain;
    },
    async rpc(name: string, args: Row) {
      rpcs.push({ name, args });
      if (opts.rpcError) return { data: null, error: { message: opts.rpcError } };
      if (name === "mint_autopilot_critics_approval") {
        return { data: { status: opts.mintStatus ?? "ok" }, error: null };
      }
      if (
        name === "enqueue_email_outbound_service" ||
        name === "enqueue_whatsapp_outbound_service" ||
        name === "enqueue_linkedin_outbound_service"
      ) {
        return {
          data: opts.enqueue ?? { ok: true, id: "out-1", status: "queued" },
          error: null,
        };
      }
      return { data: null, error: { message: `unexpected rpc ${name}` } };
    },
  };

  return { svc: svc as unknown as SupabaseClient, rpcs };
}

const baseInput = {
  workspaceId: "11111111-1111-4111-8111-111111111111",
  messageId: "msg-1",
  campaignId: "camp-1",
  candidateId: "cand-1",
  channel: "Email" as const,
  subject: "Hello",
  body: "Body text for outreach.",
  recipient: "cand@example.com",
  qualityStatus: "ready",
  criticsPassed: true,
};

{
  const { svc, rpcs } = makeSvc({ entitled: false });
  const r = await runAutopilotOutreachDispatch(svc, baseInput);
  ok("no entitlement → skipped", r.status === "skipped" && "reason" in r && r.reason === "no_entitlement");
  ok("no entitlement → no mint rpc", !rpcs.some((c) => c.name === "mint_autopilot_critics_approval"));
}

{
  const { svc } = makeSvc({ sequencesArmed: false });
  const r = await runAutopilotOutreachDispatch(svc, baseInput);
  ok(
    "sequences disarmed → human review skip",
    r.status === "skipped" && "reason" in r && r.reason === "sequences_not_armed",
  );
}

{
  const { svc, rpcs } = makeSvc({});
  const r = await runAutopilotOutreachDispatch(svc, {
    ...baseInput,
    qualityStatus: "needs_review",
    criticsPassed: true,
  });
  ok(
    "needs_review → critics_not_green",
    r.status === "skipped" && "reason" in r && r.reason === "critics_not_green",
  );
  ok("needs_review → no mint", !rpcs.some((c) => c.name === "mint_autopilot_critics_approval"));
}

{
  const { svc, rpcs } = makeSvc({});
  const r = await runAutopilotOutreachDispatch(svc, baseInput);
  ok("email ready → queued", r.status === "queued" && "channel" in r && r.channel === "Email");
  ok(
    "email path mints then enqueues",
    rpcs.map((c) => c.name).join(",") ===
      "mint_autopilot_critics_approval,enqueue_email_outbound_service",
  );
}

{
  const { svc } = makeSvc({ mintStatus: "sequences_not_armed" });
  const r = await runAutopilotOutreachDispatch(svc, baseInput);
  ok("mint sequences_not_armed → error", r.status === "error");
}

{
  const { svc, rpcs } = makeSvc({
    seats: [
      {
        id: "seat-wa-1",
        provider: "WhatsApp Cloud",
        status: "active",
        mode: "live",
        domain_verified: true,
        operator_email: "wa@example.com",
      },
    ],
  });
  const r = await runAutopilotOutreachDispatch(svc, {
    ...baseInput,
    channel: "WhatsApp",
    recipient: "+15551234567",
  });
  ok("whatsapp ready → queued", r.status === "queued" && "channel" in r && r.channel === "WhatsApp");
  ok(
    "whatsapp enqueues service rpc",
    rpcs.some((c) => c.name === "enqueue_whatsapp_outbound_service"),
  );
}

{
  process.env.HEYREACH_API_KEY = "test-key";
  process.env.HEYREACH_CAMPAIGN_ID = "42";
  const { svc, rpcs } = makeSvc({
    seats: [
      {
        id: "seat-hr-1",
        provider: "HeyReach",
        status: "active",
        mode: "live",
        domain_verified: true,
        operator_email: "heyreach@aria.local",
      },
    ],
  });
  try {
    const r = await runAutopilotOutreachDispatch(svc, {
      ...baseInput,
      channel: "LinkedIn",
      recipient: "https://www.linkedin.com/in/jane-doe",
    });
    ok(
      "linkedin heyreach seat → queued",
      r.status === "queued" && "channel" in r && r.channel === "LinkedIn",
    );
    ok(
      "linkedin enqueues durable queue",
      rpcs.some((c) => c.name === "enqueue_linkedin_outbound_service"),
    );
  } finally {
    delete process.env.HEYREACH_API_KEY;
    delete process.env.HEYREACH_CAMPAIGN_ID;
  }
}

{
  const { svc } = makeSvc({
    seats: [],
  });
  const r = await runAutopilotOutreachDispatch(svc, baseInput);
  ok(
    "email without live mailbox → no_live_mailbox",
    r.status === "skipped" && "reason" in r && r.reason === "no_live_mailbox",
  );
}

console.log(`RESULT rei-autopilot-dispatch: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
