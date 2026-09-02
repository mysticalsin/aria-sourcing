/**
 * Connect LinkedIn card: fail-closed proofs (docs/outreach/ARIA-LINKEDIN-CONNECT.md, S4).
 *
 *   - no vendor config means the card shows "not enabled", never a fake
 *     connected state, whatever the seat row says
 *   - provider_state other than connected blocks every claim: both claim
 *     RPCs are the 0056 bytes plus one sender-state branch each
 *   - the card copy is original Aria copy: no vendor, no em dash, never AI
 *   - the browser never reads the vendor's sender ref
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  LINKEDIN_CARD_TITLE,
  linkedInCardCopy,
  linkedInCardState,
  linkedInSenderCanSend,
  sendingEnabledFromResponse,
  type LinkedInCardState,
} from "../src/lib/linkedin-connect-card";
import { AGENT_SEAT_SELECT, agentSeatRowToSeat, linkedInSenderState, type AgentSeatRow } from "../src/lib/fleet-seats";
import { LINKEDIN_SENDER_STATES } from "../src/lib/types";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
function functionBlock(sql: string, name: string, args = "\\(p_message_id uuid\\)"): string {
  const m = sql.match(new RegExp(`create or replace function public\\.${name}${args}[\\s\\S]*?\\n\\$\\$;`));
  return m ? m[0] : "";
}

// ---------------------------------------------------------------------------
// No vendor config → not enabled, never connected
// ---------------------------------------------------------------------------
{
  const account = "Tony Walteur";
  for (const providerState of LINKEDIN_SENDER_STATES) {
    ok(
      `sending not enabled + provider_state ${providerState} → not-enabled`,
      linkedInCardState({ sendingEnabled: false, providerState, connectedAccount: account }) === "not-enabled",
    );
    ok(
      `sending unknown (null) + provider_state ${providerState} → not-enabled`,
      linkedInCardState({ sendingEnabled: null, providerState, connectedAccount: account }) === "not-enabled",
    );
  }
  ok("server answer must be an explicit true", !sendingEnabledFromResponse({ ok: true }) && !sendingEnabledFromResponse({ ok: true, enabled: "yes" }));
  ok("server answer with ok false is not enabled", !sendingEnabledFromResponse({ ok: false, enabled: true }));
  ok("server answer null is not enabled", !sendingEnabledFromResponse(null));
  ok("server answer true is enabled", sendingEnabledFromResponse({ ok: true, enabled: true }));
}

// ---------------------------------------------------------------------------
// With sending enabled: only 'connected' is connected
// ---------------------------------------------------------------------------
{
  const on = (providerState: (typeof LINKEDIN_SENDER_STATES)[number] | undefined, connectedAccount: string) =>
    linkedInCardState({ sendingEnabled: true, providerState, connectedAccount });
  ok("connected → connected", on("connected", "Tony") === "connected");
  ok("paused → restricted card", on("paused", "Tony") === "restricted");
  ok("restricted → restricted card", on("restricted", "Tony") === "restricted");
  ok("disconnected with a signed-in account → connecting, not connected", on("disconnected", "Tony") === "connecting");
  ok("missing state with a signed-in account → connecting, not connected", on(undefined, "Tony") === "connecting");
  ok("disconnected without an account → not-connected", on("disconnected", "") === "not-connected");
  ok("whitespace account is no account", on("disconnected", "   ") === "not-connected");
  ok("paused wins over a signed-in account", on("paused", "") === "restricted");

  ok("claims: only connected can send", linkedInSenderCanSend("connected"));
  for (const s of ["paused", "restricted", "disconnected", "", null, undefined, "CONNECTED"]) {
    ok(`claims: ${JSON.stringify(s)} cannot send`, !linkedInSenderCanSend(s));
  }
  ok("row mapping: unknown state reads as disconnected", linkedInSenderState("attached") === "disconnected" && linkedInSenderState(null) === "disconnected");
  ok("row mapping: known states pass through", LINKEDIN_SENDER_STATES.every((s) => linkedInSenderState(s) === s));
}

// ---------------------------------------------------------------------------
// Copy: original, no vendor, no em dash, never AI
// ---------------------------------------------------------------------------
{
  const states: LinkedInCardState[] = ["not-enabled", "not-connected", "connecting", "connected", "restricted"];
  const all = states.map((s) => linkedInCardCopy(s, "Tony Walteur"));
  const text = [LINKEDIN_CARD_TITLE, ...all.flatMap((c) => [c.headline, c.detail, c.button ?? ""])].join("\n");
  ok("copy never names a vendor", !/heyreach|unipile|phantombuster|dux-?soup|vendor/i.test(text));
  ok("copy has no em dash", !text.includes("—"));
  ok("copy never identifies as AI, a bot or automation", !/\b(AI|assistant|automation|automated|bot|model)\b/.test(text));
  ok("card title is Connect LinkedIn", LINKEDIN_CARD_TITLE === "Connect LinkedIn");

  const byState = Object.fromEntries(states.map((s, i) => [s, all[i]]));
  ok("not enabled: says so, asks the admin, no button", /not enabled on this workspace/.test(byState["not-enabled"].headline) && /Ask your admin/.test(byState["not-enabled"].detail) && byState["not-enabled"].button === null);
  ok("not connected: Connect LinkedIn button", byState["not-connected"].button === "Connect LinkedIn" && !byState["not-connected"].buttonDisabled);
  ok("connecting: disabled button, says sending stays off", byState.connecting.button === "Connecting" && byState.connecting.buttonDisabled && /Sending stays off/.test(byState.connecting.detail));
  ok("connected: Connected as {name}, Disconnect", /^Connected as Tony Walteur\. Sending from this account\./.test(byState.connected.headline) && byState.connected.button === "Disconnect");
  ok("connected: names the account's own limits for the admin", /follows your account's limits/.test(byState.connected.detail));
  ok("restricted: paused copy, Retry connection", /LinkedIn has paused sending/.test(byState.restricted.headline) && /stopped every campaign/.test(byState.restricted.detail) && byState.restricted.button === "Retry connection");
  ok("connected without a name never prints an empty name", /Connected as your LinkedIn account\./.test(linkedInCardCopy("connected", " ").headline));
}

// ---------------------------------------------------------------------------
// The browser: no sender ref, state from the row, server answers "enabled"
// ---------------------------------------------------------------------------
{
  ok("the seat select carries provider_state and never provider_sender_ref", /provider_state/.test(AGENT_SEAT_SELECT) && !/provider_sender_ref/.test(AGENT_SEAT_SELECT));
  const row: AgentSeatRow = {
    id: "seat-1",
    name: "LinkedIn",
    operator_email: "tony@example.test",
    provider: "LinkedIn Vendor API",
    status: "active",
    mode: "live",
    domain_verified: false,
    daily_limit: 25,
    warmup: false,
    warmup_start_cap: 10,
    warmup_step_per_day: 4,
    warmup_started_at: "2026-09-02T00:00:00.000Z",
    min_gap_minutes: 12,
    persona: "",
    signature: "",
    connected_account: "Tony Walteur",
    provider_state: "connected",
    created_at: "2026-09-02T00:00:00.000Z",
  };
  ok("row → seat carries the provider state", agentSeatRowToSeat(row).providerState === "connected");
  ok("row without the column → disconnected", agentSeatRowToSeat({ ...row, provider_state: undefined }).providerState === "disconnected");

  const component = readFileSync("src/components/fleet/linkedin-connect-card.tsx", "utf8");
  ok("card starts as unknown (not enabled) until the server answers", /useState<boolean \| null>\(supabaseEnabled \? null : false\)/.test(component));
  ok("card asks the server, never the seat, whether sending is enabled", /fetch\(LINKEDIN_SENDER_ENDPOINT/.test(component) && /setSendingEnabled\(sendingEnabledFromResponse\(body\)\)/.test(component));
  ok("card decides through linkedInCardState", /linkedInCardState\(\{\s*sendingEnabled,\s*providerState: seat\.providerState,\s*connectedAccount: seat\.connectedAccount,?\s*\}\)/.test(component));
  ok("card exposes its state for proofs", /data-testid="linkedin-connect-card" data-state=\{state\}/.test(component));
  ok("a failed request reads as not enabled", /\.catch\(\(\) => \{\s*if \(!cancelled\) setSendingEnabled\(false\);/.test(component));

  const seatCard = readFileSync("src/components/fleet/seat-card.tsx", "utf8");
  ok("the delivery seat renders the Connect LinkedIn card", /seat\.provider === LINKEDIN_VENDOR_PROVIDER \? \(\s*<LinkedInConnectCard/.test(seatCard));

  const route = readFileSync("src/app/api/outreach/linkedin/sender/route.ts", "utf8");
  const sender = readFileSync("src/lib/server/linkedin-sender.ts", "utf8");
  ok(
    "enabled is computed on the server from the adapter and the sign-in app, never from the request",
    /Boolean\(adapter\?\.configured\(\)\) && Boolean\(env\.LINKEDIN_CLIENT_ID\)/.test(sender) &&
      /enabled: linkedInSendingEnabled\(\)/.test(route) &&
      !/searchParams|validated\.data\.enabled/.test(route.slice(0, route.indexOf("DisconnectSchema"))),
  );
  ok("GET requires a signed-in member", /if \(!user\) return NextResponse\.json\(\{ ok: false, error: "Not authenticated\." \}, \{ status: 401 \}\);/.test(route));
  ok("without Supabase the answer is not enabled", /if \(!supabaseEnabled\) return NextResponse\.json\(NOT_ENABLED\);/.test(route) && /if \(!supabaseEnabled\) return false;/.test(sender));
  ok(
    "DELETE resets the seat to disconnected and clears the sender ref, delivery seat only, fleet managers only",
    /update\(\{ connected_account: "", provider_sender_ref: null, provider_state: "disconnected" \}\)/.test(route) &&
      /\.eq\("provider", LINKEDIN_VENDOR_PROVIDER\)/.test(route) &&
      /can\(role as Role, "manage_fleet"\)/.test(route),
  );
  const routeCode = route.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  ok("nothing in the route can set connected", !/provider_state: "connected"/.test(routeCode) && !/connected"/.test(routeCode.replace(/"disconnected"/g, "")));
}

// ---------------------------------------------------------------------------
// SQL contract (0058): provider_state other than connected blocks every claim
// ---------------------------------------------------------------------------
{
  const m56 = readFileSync("supabase/migrations/0056_linkedin_workspace_caps_authority.sql", "utf8");
  const m58 = readFileSync("supabase/migrations/0058_linkedin_sender_state_authority.sql", "utf8");
  ok(
    "0058 adds provider_sender_ref and provider_state with the fail-closed default",
    /add column if not exists provider_sender_ref text;/.test(m58) &&
      /add column if not exists provider_state text not null default 'disconnected';/.test(m58) &&
      /check \(provider_state in \('connected', 'paused', 'restricted', 'disconnected'\)\)/.test(m58),
  );
  ok(
    "connected requires a sender ref, so the browser can trust the state alone",
    /check \(provider_state <> 'connected' or length\(btrim\(coalesce\(provider_sender_ref, ''\)\)\) > 0\)/.test(m58),
  );

  const outbound56 = functionBlock(m56, "claim_linkedin_outbound_queued");
  const outbound58 = functionBlock(m58, "claim_linkedin_outbound_queued");
  const loop56 = functionBlock(m56, "claim_linkedin_loop_reply");
  const loop58 = functionBlock(m58, "claim_linkedin_loop_reply");
  ok("both claim bodies are present in 0058", outbound58.length > 0 && loop58.length > 0);

  const outboundBranch = /\n  -- Sender state \(0058\)\.[^\n]*\n(?:  --[^\n]*\n)*  if seat\.provider = 'LinkedIn Vendor API' and seat\.provider_state <> 'connected' then\n    return json_build_object\('allowed', false, 'reason', 'linkedin-sender-not-connected'\);\n  end if;\n/;
  const loopBranch = /\n  -- Sender state \(0058\)\.[^\n]*\n(?:  --[^\n]*\n)*  if seat\.provider_state <> 'connected' then\n    return json_build_object\('allowed', false, 'reason', 'linkedin-sender-not-connected'\);\n  end if;\n/;
  ok("first-touch claim refuses the delivery seat unless its sender is connected", outboundBranch.test(outbound58));
  ok("loop reply claim refuses unless the sender is connected", loopBranch.test(loop58));
  ok("first-touch claim is the 0056 body plus that one branch, byte for byte", outbound58.replace(outboundBranch, "") === outbound56);
  ok("loop reply claim is the 0056 body plus that one branch, byte for byte", loop58.replace(loopBranch, "") === loop56);
  ok(
    "the 0056 claim bodies this slice builds on are frozen",
    sha256(outbound56) === "278edc9ec3226b72edb0ecfee7099fc5c0e349649add0566708dca52ba6c1f99" &&
      sha256(loop56) === "50260e09a3cc249db7eb473e8cfccd18e4b4739709ff68a2f74309bece30aae3",
  );
  ok(
    "the sender check happens after the seat check and before any write",
    outbound58.indexOf("'seat-not-live'") < outbound58.indexOf("'linkedin-sender-not-connected'") &&
      outbound58.indexOf("'linkedin-sender-not-connected'") < outbound58.indexOf("insert into public.outreach_ledger(") &&
      loop58.indexOf("'seat-not-live-vendor'") < loop58.indexOf("'linkedin-sender-not-connected'") &&
      loop58.indexOf("'linkedin-sender-not-connected'") < loop58.indexOf("insert into public.linkedin_reply_attempts("),
  );
  ok(
    "the workspace cap check from 0056 survives in both",
    /'workspace-message-cap-reached'/.test(outbound58) && /'workspace-message-cap-reached'/.test(loop58),
  );
  ok(
    "0058 does not touch the approval trigger or the launch",
    !/enforce_active_linkedin_approval/.test(m58.replace(/^--.*$/gm, "")) &&
      !/create trigger/.test(m58) &&
      !/launch_linkedin_campaign/.test(m58.replace(/^--.*$/gm, "")),
  );
  ok("nothing in 0058 sets connected", !/set provider_state = 'connected'/.test(m58) && !/provider_state = 'connected'/.test(m58.replace(/<> 'connected'/g, "")));
  ok(
    "claim RPCs stay service-role only",
    /grant execute on function public\.claim_linkedin_outbound_queued\(uuid\) to service_role;/.test(m58) &&
      /grant execute on function public\.claim_linkedin_loop_reply\(uuid\) to service_role;/.test(m58) &&
      /revoke all on function public\.claim_linkedin_outbound_queued\(uuid\) from public, anon, authenticated, service_role, authenticator;/.test(m58) &&
      /revoke all on function public\.claim_linkedin_loop_reply\(uuid\) from public, anon, authenticated, service_role, authenticator;/.test(m58),
  );
}

// ---------------------------------------------------------------------------
// The dispatchers mirror the claim: block before the transport
// ---------------------------------------------------------------------------
{
  const outbound = readFileSync("src/lib/dispatch-outbound.ts", "utf8");
  ok(
    "first-touch dispatcher reads provider_state and blocks the delivery seat before the claim",
    /select\("id, provider, status, mode, provider_state"\)/.test(outbound) &&
      /adapter\.kind === "vendor-api" && !linkedInSenderCanSend\(seat\.provider_state\)/.test(outbound) &&
      outbound.indexOf('"linkedin-sender-not-connected"') < outbound.indexOf('rpc("claim_linkedin_outbound_queued"'),
  );
  const loop = readFileSync("src/lib/linkedin-loop-dispatch.ts", "utf8");
  ok(
    "loop dispatcher blocks before the claim",
    /if \(!linkedInSenderCanSend\(seat\.providerState\)\)/.test(loop) &&
      loop.indexOf('"linkedin-sender-not-connected"') < loop.indexOf("deps.store.claimReply(reply.id)"),
  );
  const store = readFileSync("src/lib/linkedin-loop-store.ts", "utf8");
  ok("loop store reads provider_state with the seat", /select\("id, provider, status, mode, provider_state"\)/.test(store) && /providerState: text\(row\.provider_state\)/.test(store));
}

console.log(`RESULT linkedin-connect-card: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
