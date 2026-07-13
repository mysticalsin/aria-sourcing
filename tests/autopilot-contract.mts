import { readFileSync } from "fs";
import { decideAutopilot } from "../src/lib/autopilot";
import { newOutreachMessage, type GeneratedOutreach } from "../src/lib/mock-ai";
import { buildSeedState, defaultSettings } from "../src/lib/seed";

let pass = 0;
let fail = 0;

function ok(name: string, condition: boolean) {
  if (condition) pass += 1;
  else {
    fail += 1;
    console.log("FAIL:", name);
  }
}

function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const safeDraft = "The team works in TypeScript and Go. A recruiter can help arrange a conversation with the hiring lead.";
const decision = decideAutopilot(safeDraft, {
  autopilot: true,
  canary_remaining: 0,
  topics_allow: ["role-stack"],
  max_per_day: 200,
});
ok("legacy guardrail fields never grant provider delivery authority", decision.action === "queue");
ok("every generated reply requires named human review", decision.reasons.includes("human-review-required"));

const seed = buildSeedState();
const candidate = seed.candidates[0];
const campaign = seed.campaigns.find((item) => item.id === candidate?.campaignId) ?? seed.campaigns[0];
if (!candidate || !campaign) {
  ok("seed provides a candidate and campaign for the approval contract", false);
} else {
  const generated: GeneratedOutreach = {
    subject: "A role you may like",
    body: safeDraft,
    personalizationEvidence: ["Relevant experience"],
    channel: "Email",
  };
  const message = newOutreachMessage(
    candidate,
    campaign,
    generated,
    "Casual Professional",
    { ...defaultSettings(), humanApprovalGate: false },
  );
  ok("a browser approval setting cannot label a generated draft Approved", message.status === "Needs Approval");
}

const studio = source("src/app/studio/page.tsx");
ok("Studio names the graph output as draft storage", studio.includes("Draft storage"));
ok(
  "Studio states that graph drafts remain in run history with no delivery authority",
  studio.includes("Run history only") && studio.includes("No delivery authority"),
);
ok("Studio exposes no Autopilot or canary control", !/autopilot|canary/i.test(studio));

const settings = source("src/app/settings/page.tsx");
ok("Settings presents human approval as required", settings.includes("Human approval required"));
ok("Settings cannot toggle the human approval authority", !/id="humanApprovalGate"/.test(settings));

const topbar = source("src/components/app/topbar.tsx");
ok("topbar presents approval as required", topbar.includes("Approval required"));
ok("topbar never claims the server approval gate is off", !topbar.includes("Gate OFF"));

const autopilot = source("src/lib/autopilot.ts");
ok("legacy reply guardrails are documented as non-authoritative", /legacy compatibility only/i.test(autopilot) && /never grant provider delivery authority/i.test(autopilot));
ok("reply routing comments do not claim a scheduled send", !/schedule send/i.test(autopilot));

const whatsappInbound = source("src/lib/whatsapp-inbound.ts");
ok(
  "WhatsApp inbound never mutates legacy canary counters while queuing review drafts",
  !/canary_remaining[\s\S]{0,220}\.update\(/i.test(whatsappInbound) &&
    !/canary update failed/i.test(whatsappInbound),
);

const readinessStatus = source("production-readiness/STATUS.md");
ok(
  "current readiness status declares inbound reply drafting queue-only",
  /Inbound candidate repl(?:y|ies)[^.]*named\s+human review/i.test(readinessStatus),
);
ok(
  "current readiness status declares agent graph drafts run-history-only",
  /Agent graph drafts[^.]*run history[^.]*no delivery authority/i.test(readinessStatus),
);

console.log(`RESULT autopilot-contract: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
