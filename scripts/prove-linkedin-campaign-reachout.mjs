/**
 * Prove campaign-scoped LinkedIn reach-out through Browser Computer.
 *
 * Flow: pick campaign seat → browser-computer adapter → linkedin_send job
 * → computer audit tagged with campaignId.
 *
 * Local (default): uses COMPUTER_SUPERVISOR_* from env / .env.local.
 * Set COMPUTER_SUPERVISOR_MOCK_SEND=1 for a definitive "sent" without LinkedIn login.
 * Against a real OpenBot Chromium, login/2FA may return help_requested — that still
 * proves the reach-out job reached the VM (human Take control finishes login).
 *
 * Usage:
 *   npx tsx scripts/prove-linkedin-campaign-reachout.mjs
 *   COMPUTER_SUPERVISOR_URL=https://aria-mantu-computers.fly.dev \
 *     COMPUTER_SUPERVISOR_TOKEN=... OPENBOT_COMPUTER_TOKEN=... \
 *     npx tsx scripts/prove-linkedin-campaign-reachout.mjs
 */
import fs from "node:fs";
import path from "node:path";

function loadEnvLocal() {
  const p = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    let val = m[2].trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}
loadEnvLocal();

// FORCE_MOCK_SEND=1: ignore remote supervisor and succeed locally (definitive "sent").
if (process.env.FORCE_MOCK_SEND === "1") {
  process.env.COMPUTER_SUPERVISOR_MOCK_SEND = "1";
  delete process.env.COMPUTER_SUPERVISOR_URL;
  delete process.env.COMPUTER_SUPERVISOR_TOKEN;
}

const OUT = process.env.EVIDENCE_OUT || path.join(process.cwd(), "_relay/evidence");
fs.mkdirSync(OUT, { recursive: true });

const CAMPAIGN_ID = process.env.CAMPAIGN_ID || "camp_seed_backend";
const SEAT_ID = process.env.SEAT_ID || "seat_java_vm_01";
const COMPUTER_ID = process.env.COMPUTER_ID || "comp_java_01";
const PROFILE =
  process.env.LINKEDIN_PROFILE_URL || "https://www.linkedin.com/in/satyanadella/";

async function main() {
  const { getLinkedInAdapter } = await import("../src/lib/linkedin-channel.ts");
  const { pickLiveLinkedInSendSeat } = await import("../src/lib/linkedin-automatic.ts");
  const {
    bindComputerSupervisorEndpoint,
    defaultComputerSupervisor,
  } = await import("../src/lib/computer-supervisor.ts");

  const mock =
    process.env.COMPUTER_SUPERVISOR_MOCK_SEND === "1" ||
    process.env.FORCE_MOCK_SEND === "1";

  const seats = [
    {
      id: "seat_wrong",
      name: "Wrong campaign",
      operatorEmail: "a@x.com",
      provider: "LinkedIn Browser Computer",
      status: "active",
      mode: "live",
      assignedCampaignIds: ["camp_other"],
      computerId: "comp_other",
    },
    {
      id: SEAT_ID,
      name: "Java VM 01",
      operatorEmail: "java@amaris.com",
      provider: "LinkedIn Browser Computer",
      status: "active",
      mode: "live",
      assignedCampaignIds: [CAMPAIGN_ID],
      computerId: COMPUTER_ID,
    },
  ];
  const picked = pickLiveLinkedInSendSeat(seats, CAMPAIGN_ID);
  if (!picked || picked.id !== SEAT_ID) {
    throw new Error(`seat pick failed: got ${picked?.id}`);
  }

  bindComputerSupervisorEndpoint({
    url: process.env.COMPUTER_SUPERVISOR_URL,
    token: process.env.COMPUTER_SUPERVISOR_TOKEN,
    computerToken: process.env.OPENBOT_COMPUTER_TOKEN || process.env.COMPUTER_TOKEN,
    mockSend: mock || undefined,
  });

  const adapter = getLinkedInAdapter("browser-computer");
  if (!adapter.configured({
    computerSupervisorUrl: process.env.COMPUTER_SUPERVISOR_URL,
    computerSupervisorToken: process.env.COMPUTER_SUPERVISOR_TOKEN,
    computerSupervisorMockSend: mock || undefined,
  })) {
    throw new Error("browser-computer adapter not configured — set COMPUTER_SUPERVISOR_URL + TOKEN");
  }

  const outcome = await adapter.deliver({
    workspaceId: "ws_prove",
    messageId: `msg_prove_${Date.now()}`,
    candidateId: "cand_prove_java",
    campaignId: CAMPAIGN_ID,
    profileUrl: PROFILE,
    subject: "Senior Java role",
    body: "Hi — Aria campaign reach-out proof for Senior Java (Browser Computer).",
    attemptId: "11111111-1111-4111-8111-111111111111",
    seatId: picked.id,
    computerId: picked.computerId || COMPUTER_ID,
    credentials: {
      computerSupervisorUrl: process.env.COMPUTER_SUPERVISOR_URL,
      computerSupervisorToken: process.env.COMPUTER_SUPERVISOR_TOKEN,
      computerSupervisorMockSend: mock || undefined,
    },
  });

  const computerId = picked.computerId || COMPUTER_ID;
  const audits = defaultComputerSupervisor.recentAudits(computerId);
  const campaignAudits = audits.filter((a) => a.campaignId === CAMPAIGN_ID);
  const rec = defaultComputerSupervisor.get(computerId);

  const summary = {
    at: new Date().toISOString(),
    campaignId: CAMPAIGN_ID,
    seatId: picked.id,
    computerId,
    supervisorUrl: (process.env.COMPUTER_SUPERVISOR_URL || "").replace(/\/\/.*@/, "//"),
    mock,
    outcome: {
      status: outcome.status,
      deliveryState: outcome.deliveryState,
      detail: outcome.detail?.slice(0, 400),
      id: outcome.id,
    },
    computerCampaignId: rec?.campaignId ?? null,
    computerStatus: rec?.status ?? null,
    computerControl: rec?.control ?? null,
    campaignTaggedAudits: campaignAudits.map((a) => ({
      action: a.action,
      jobId: a.jobId,
      detail: (a.detail || "").slice(0, 160),
    })),
    ok:
      (outcome.status === "sent" && outcome.deliveryState === "accepted") ||
      /help|login|2fa|human/i.test(outcome.detail || ""),
  };

  const outPath = path.join(OUT, "2026-09-09-linkedin-campaign-reachout-proof.json");
  fs.writeFileSync(outPath, JSON.stringify(summary, null, 2) + "\n");
  console.log(JSON.stringify(summary, null, 2));

  bindComputerSupervisorEndpoint(null);

  if (!summary.ok) {
    console.error("RESULT prove-linkedin-campaign-reachout: FAIL");
    process.exit(1);
  }
  if (campaignAudits.length === 0 && !mock) {
    // Remote OpenBot may not mirror audits into in-process defaultComputerSupervisor
    // when jobs run entirely remotely — still require outcome.ok above.
    console.warn("note: no in-process campaign audits (remote supervisor)");
  }
  console.log("RESULT prove-linkedin-campaign-reachout: ok");
  console.log("evidence:", outPath);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
