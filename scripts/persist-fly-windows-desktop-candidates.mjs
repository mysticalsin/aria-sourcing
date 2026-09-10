#!/usr/bin/env node
/**
 * Fly-only: run live sourcing for the Windows Desktop Engineer need and
 * persist the returned candidates into workspace_state so the UI shows them
 * after a normal password login (not demo-login).
 *
 * Usage (from repo, with network):
 *   node --import tsx scripts/persist-fly-windows-desktop-candidates.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { candidateFromSourcingAgentDto } from "../src/lib/sourcing/sourcing-agent-contract.ts";

const APP = process.env.ARIA_APP_URL || "https://aria-mantu-app.fly.dev";
const KONG = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://aria-mantu-kong.fly.dev";
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const SERVICE =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.FLY_SUPABASE_SERVICE_KEY ||
  "";
const EMAIL = process.env.ARIA_OPERATOR_EMAIL || "twalteur@amaris.com";
const PASSWORD = process.env.ARIA_OPERATOR_PASSWORD || "";
const CAMP_ID = "camp_mor1jp00097605_enterprise-windows-desktop-engineer";
const WS = "0d179005-e8e2-4b99-8b9a-b67453348005";

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

function initialsFrom(name) {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

async function passwordSession() {
  if (!ANON) fail("NEXT_PUBLIC_SUPABASE_ANON_KEY required");
  if (!PASSWORD) fail("ARIA_OPERATOR_PASSWORD required");
  const res = await fetch(`${KONG}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${ANON}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    fail(`password login failed: ${res.status} ${JSON.stringify(body).slice(0, 300)}`);
  }
  return body;
}

function authCookie(session) {
  // Matches demo-login / supabase-js cookie shape used by getServerSupabase.
  const payload = {
    access_token: session.access_token,
    token_type: "bearer",
    expires_in: session.expires_in ?? 3600,
    expires_at: session.expires_at,
    refresh_token: session.refresh_token,
    user: session.user,
  };
  return `sb-auth-token=base64-${Buffer.from(JSON.stringify(payload)).toString("base64url")}`;
}

async function runSourcing(cookie) {
  const idem = crypto.randomUUID();
  const res = await fetch(`${APP}/api/sourcing-agent`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: APP,
      cookie,
      "idempotency-key": idem,
      "x-request-id": idem,
    },
    body: JSON.stringify({ campaignId: CAMP_ID, count: 5 }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.ok) {
    fail(`sourcing failed: ${res.status} ${JSON.stringify(body).slice(0, 500)}`);
  }
  return body;
}

async function loadState() {
  // Prefer service role via Fly private URL when run on the machine; from laptop use Kong + service key.
  const base = process.env.SUPABASE_URL || KONG;
  const key = SERVICE || ANON;
  if (!SERVICE) fail("SUPABASE_SERVICE_ROLE_KEY required to persist workspace_state");
  const res = await fetch(
    `${base}/rest/v1/workspace_state?workspace_id=eq.${WS}&select=state,updated_at`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } },
  );
  const rows = await res.json();
  if (!rows?.[0]?.state) fail("workspace_state missing");
  return { state: rows[0].state, updatedAt: rows[0].updated_at, base, key };
}

async function saveState(base, key, state) {
  const res = await fetch(`${base}/rest/v1/workspace_state?workspace_id=eq.${WS}`, {
    method: "PATCH",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify({ state }),
  });
  const text = await res.text();
  if (!res.ok) fail(`persist failed: ${res.status} ${text.slice(0, 400)}`);
  return JSON.parse(text)[0];
}

function toCandidate(dto) {
  const c = candidateFromSourcingAgentDto(dto);
  // Ensure avatar initials even if import path differs in standalone runs.
  if (!c.avatarInitials) c.avatarInitials = initialsFrom(c.name);
  return c;
}

async function main() {
  const session = await passwordSession();
  console.log(JSON.stringify({ step: "password_login", email: session.user?.email }));
  const cookie = authCookie(session);
  const sourced = await runSourcing(cookie);
  console.log(
    JSON.stringify({
      step: "sourced",
      n: sourced.candidates?.length ?? 0,
      mode: sourced.mode,
      names: (sourced.candidates || []).map((c) => c.name),
    }),
  );

  const { state, base, key } = await loadState();
  const campaign = (state.campaigns || []).find((c) => c.id === CAMP_ID);
  if (!campaign) fail("Windows Desktop campaign missing from workspace_state");

  const incoming = (sourced.candidates || []).map(toCandidate);
  const existingOther = (state.candidates || []).filter((c) => c.campaignId !== CAMP_ID);
  const existingSame = (state.candidates || []).filter((c) => c.campaignId === CAMP_ID);
  const byKey = new Set(
    existingSame.map((c) => `${(c.linkedinUrl || "").toLowerCase()}|${(c.name || "").toLowerCase()}`),
  );
  const added = [];
  for (const c of incoming) {
    const k = `${(c.linkedinUrl || "").toLowerCase()}|${(c.name || "").toLowerCase()}`;
    if (byKey.has(k)) continue;
    byKey.add(k);
    added.push(c);
  }

  state.candidates = [...added, ...existingSame, ...existingOther];
  state.activeCampaignId = CAMP_ID;
  // Keep Windows need first in the list for the campaign switcher.
  state.campaigns = [
    campaign,
    ...(state.campaigns || []).filter((c) => c.id !== CAMP_ID),
  ];
  const camp = state.campaigns[0];
  camp.metrics = {
    ...(camp.metrics || {}),
    sourced: (state.candidates || []).filter((c) => c.campaignId === CAMP_ID).length,
  };
  camp.activities = [
    {
      id: `act_persist_${Date.now()}`,
      type: "sourcing",
      title: `Persisted ${added.length} live sourced candidates`,
      detail: `Fly password-login path · ${added.map((c) => c.name).join(", ")}`,
      at: new Date().toISOString(),
    },
    ...(camp.activities || []),
  ];

  const saved = await saveState(base, key, state);
  const count = (state.candidates || []).filter((c) => c.campaignId === CAMP_ID).length;
  console.log(
    JSON.stringify({
      step: "persisted",
      ok: true,
      campaignId: CAMP_ID,
      activeCampaignId: state.activeCampaignId,
      candidatesForCampaign: count,
      added: added.length,
      updatedAt: saved?.updated_at,
      names: (state.candidates || [])
        .filter((c) => c.campaignId === CAMP_ID)
        .slice(0, 8)
        .map((c) => ({ name: c.name, title: c.currentTitle, score: c.matchScore })),
    }),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
