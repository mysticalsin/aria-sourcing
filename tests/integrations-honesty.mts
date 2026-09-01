import { readFileSync } from "node:fs";
import { defaultIntegrations, defaultLiveIntegrations, mergeSeedIntegrations, testConnection } from "../src/lib/integrations";
import {
  EMPTY_PEOPLE_FIRST_HARVEST,
  MISSING_PEOPLE_PLUGINS_TOAST,
  emptyPeopleFirstShortlistError,
  hasValidApifyKey,
  integrationShowsLive,
  missingPeoplePluginsToast,
  peoplePluginFailLoudUi,
  peopleSourcePluginsConnected,
  visiblePeopleFirstLearningReceipts,
} from "../src/lib/sourcing/people-plugins";
import {
  applyHarvestKeysToIntegrations,
  isSyntheticRecipientEmail,
  liveSendBlocker,
} from "../src/lib/sourcing/people-connect";
import type { JobAnalysis } from "../src/lib/types";

let pass = 0, fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.log("FAIL:", name);
  }
}

const integrations = defaultIntegrations();
const placeholders = integrations.filter((integration) => integration.real === false);
const realCards = integrations.filter((integration) => integration.real === true);
const github = integrations.find((integration) => integration.id === "int_github");
const apify = integrations.find((integration) => integration.id === "int_apify");
const linkedinRsc = integrations.find((integration) => integration.id === "int_linkedin_rsc");

ok("has roadmap placeholder integrations to audit", placeholders.length > 0);
ok(
  "no real:false integration claims connected",
  placeholders.every((integration) => integration.status !== "connected"),
);
ok(
  "every real:false integration has null lastSync",
  placeholders.every((integration) => integration.lastSync === null),
);
ok(
  "real:true cards still exist",
  realCards.length > 0,
);
ok(
  "GitHub real card remains connected",
  github?.real === true && github.status === "connected" && typeof github.lastSync === "string",
);
ok(
  "real:false connection tests fail closed",
  placeholders.every((integration) => testConnection(integration).ok === false),
);
ok(
  "Apify LinkedIn profile search is a truthfully real card, not a roadmap placeholder",
  apify?.real === true && apify.status === "connected" && typeof apify.lastSync === "string",
);
ok(
  "Apify card's description names the third-party vendor and disclaims first-party LinkedIn automation",
  /apify/i.test(apify?.description ?? "") &&
    /third-party/i.test(apify?.description ?? "") &&
    /no direct linkedin login, scraping, or session automation/i.test(apify?.description ?? ""),
);
ok(
  "Official LinkedIn Recruiter System Connect remains an honest, unbuilt placeholder",
  linkedinRsc?.real === false && linkedinRsc.status !== "connected",
);

const liveTenant = defaultLiveIntegrations();
const liveGithub = liveTenant.find((integration) => integration.id === "int_github");
ok(
  "live tenant GitHub starts not configured and not Live",
  liveGithub?.status === "not_configured" && liveGithub.mode !== "live",
);
ok(
  "GitHub Live+unconfigured does not display as Live",
  !integrationShowsLive(
    { id: "int_github", mode: "live", status: "not_configured" },
    liveTenant,
  ),
);
const calypsoJob = {
  title: "Calypso Application Support",
  department: "IS&D - Applicative Support",
  requiredSkills: ["Linux", "Calypso"],
  industryExperience: ["Fintech"],
} as JobAnalysis;
ok(
  "GitHub does not display Live on a people-first need when LinkedIn and Apify are unkeyed",
  !integrationShowsLive(
    { id: "int_github", mode: "live", status: "connected" },
    liveTenant,
    calypsoJob,
  ),
);
ok(
  "GitHub does not display Live on Settings when people plugins are unkeyed and no need is loaded",
  !integrationShowsLive(
    { id: "int_github", mode: "live", status: "connected" },
    liveTenant,
  ),
);
const softwareJob = {
  title: "Senior Backend Engineer",
  department: "Engineering",
  requiredSkills: ["Go", "Kubernetes"],
  industryExperience: ["SaaS"],
} as JobAnalysis;
ok(
  "GitHub-first software need may still show GitHub Live without LinkedIn",
  integrationShowsLive(
    { id: "int_github", mode: "live", status: "connected" },
    liveTenant,
    softwareJob,
  ),
);
const settingsCard = readFileSync(new URL("../src/components/settings/integration-card.tsx", import.meta.url), "utf8");
ok(
  "Settings GitHub Live switch uses githubLiveAllowed, not raw mode",
  /githubLiveAllowed/.test(settingsCard) && /integrationShowsLive/.test(settingsCard),
);
ok(
  "people-first learning panel hides GitHub 0-row residue while LinkedIn and Apify are unkeyed",
  visiblePeopleFirstLearningReceipts(
    [{ platform: "GitHub", candidateCount: 0 }, { platform: "LinkedIn", candidateCount: 1 }],
    calypsoJob,
    liveTenant,
  ).every((receipt) => receipt.platform !== "GitHub"),
);
ok(
  "unkeyed live tenant fails the people-plugin check on a finance need",
  !peopleSourcePluginsConnected(liveTenant) &&
    Boolean(missingPeoplePluginsToast(calypsoJob, liveTenant)),
);
const keyedApify = liveTenant.map((item) =>
  item.id === "int_apify" ? { ...item, status: "connected" as const, mode: "live" as const } : item,
);
ok(
  "keyed Apify satisfies the people-plugin check without inventing LinkedIn OAuth",
  peopleSourcePluginsConnected(keyedApify) && missingPeoplePluginsToast(calypsoJob, keyedApify) === null,
);
ok(
  "Tavily connected is not a people source",
  !peopleSourcePluginsConnected([
    ...liveTenant,
    {
      id: "int_tavily",
      name: "Tavily",
      category: "Sourcing",
      description: "Web search",
      status: "connected",
      mode: "live",
      lastSync: null,
      errors: [],
      real: true,
    },
  ]),
);

ok(
  "a valid Apify Access & Keys row is a people harvest even when the card is not Live",
  hasValidApifyKey([{ provider: "Apify", status: "valid" }]) &&
    peopleSourcePluginsConnected(liveTenant, [{ provider: "Apify", status: "valid" }]) &&
    missingPeoplePluginsToast(calypsoJob, liveTenant, [{ provider: "Apify", status: "valid" }]) === null,
);
ok(
  "mergeSeedIntegrations restores a missing Apify card",
  mergeSeedIntegrations(liveTenant.filter((row) => row.id !== "int_apify")).some((row) => row.id === "int_apify" && row.real),
);
ok(
  "synthetic example.com addresses cannot be sent",
  isSyntheticRecipientEmail("julien.moreau.ba@example.com") &&
    isSyntheticRecipientEmail("elena@fixture.example") &&
    !isSyntheticRecipientEmail("maya.rivera@amaris.com"),
);
ok(
  "email send without Outlook connect is blocked even when Approved",
  liveSendBlocker("Email", "Approved", [], []) ===
    "Connect Outlook in Fleet (Microsoft account), then Verify domain. Approval alone never sends.",
);
ok(
  "LinkedIn confirm without connect is blocked",
  /Connect LinkedIn or HeyReach/.test(liveSendBlocker("LinkedIn", "Pending Manual Send", [], []) ?? ""),
);
ok(
  "unapproved email cannot send even if a mailbox looks connected",
  liveSendBlocker(
    "Email",
    "Needs Approval",
    [
      {
        id: "seat_maya",
        name: "Maya",
        operatorEmail: "maya@amaris.com",
        provider: "Microsoft Graph",
        status: "active",
        mode: "live",
        domainVerified: true,
        dailyLimit: 40,
        warmup: true,
        warmupStartCap: 12,
        warmupStepPerDay: 4,
        warmupStartedAt: "",
        minGapMinutes: 12,
        sendWindow: { timezone: "CET", days: [1, 2, 3, 4, 5], startHour: 8, endHour: 18 },
        sentToday: 0,
        lastSendAt: null,
        health: { sentTotal: 0, bounces: 0, complaints: 0, bounceRate: 0, complaintRate: 0 },
        persona: "",
        signature: "",
        connectedAccount: "maya@amaris.com",
        createdAt: "",
      },
    ],
  ) === "Only an approved message can be sent.",
);
ok(
  "example.com is blocked even when approved and connected",
  /synthetic example\.com/.test(
    liveSendBlocker(
      "Email",
      "Approved",
      [
        {
          id: "seat_maya",
          name: "Maya",
          operatorEmail: "maya@amaris.com",
          provider: "Microsoft Graph",
          status: "active",
          mode: "live",
          domainVerified: true,
          dailyLimit: 40,
          warmup: true,
          warmupStartCap: 12,
          warmupStepPerDay: 4,
          warmupStartedAt: "",
          minGapMinutes: 12,
          sendWindow: { timezone: "CET", days: [1, 2, 3, 4, 5], startHour: 8, endHour: 18 },
          sentToday: 0,
          lastSendAt: null,
          health: { sentTotal: 0, bounces: 0, complaints: 0, bounceRate: 0, complaintRate: 0 },
          persona: "",
          signature: "",
          connectedAccount: "maya@amaris.com",
          createdAt: "",
        },
      ],
      [],
      [],
      "julien.moreau.ba@example.com",
    ) ?? "",
  ),
);

const connectUi = readFileSync(new URL("../src/components/dashboard/connect-channels.tsx", import.meta.url), "utf8");
ok("Connect UI has LinkedIn and Outlook CTAs", /cc-connect-linkedin/.test(connectUi) && /cc-connect-outlook/.test(connectUi));
const modalSource = readFileSync(new URL("../src/components/ui/modal.tsx", import.meta.url), "utf8");
ok(
  "Modal focuses the first input and does not re-steal focus when onClose identity changes",
  /input:not\(\[disabled\]\)/.test(modalSource) && /\[open\]/.test(modalSource) && !/, onClose\]/.test(modalSource),
);
const apifyDialog = readFileSync(new URL("../src/components/candidates/source-apify-dialog.tsx", import.meta.url), "utf8");
ok(
  "Apify Start search fails loud on empty harvest or timeout and keeps the query field focused",
  /apify-search-error/.test(apifyDialog) &&
    /POLL_TIMEOUT_MS/.test(apifyDialog) &&
    /autoFocus/.test(apifyDialog) &&
    /0 profiles/.test(readFileSync(new URL("../src/lib/store.ts", import.meta.url), "utf8")),
);
ok(
  "Apify and LinkedIn cards route to Access & Keys or Fleet, not a generic API-key dead-end",
  /Access & Keys/.test(settingsCard) && /Connect in Fleet/.test(settingsCard) && /Connect Microsoft account/.test(settingsCard),
);
ok(
  "valid Apify key never asks to reconnect via MISSING_PLUGIN on an empty harvest",
  emptyPeopleFirstShortlistError(
    calypsoJob,
    liveTenant,
    { accepted: { length: 0 }, source: "github" },
    [{ provider: "Apify", status: "valid" }],
  ) === EMPTY_PEOPLE_FIRST_HARVEST,
);
ok(
  "fail-loud toast always carries a Settings CTA",
  peoplePluginFailLoudUi(MISSING_PEOPLE_PLUGINS_TOAST, calypsoJob, liveTenant)?.href === "/settings" &&
    Boolean(peoplePluginFailLoudUi(MISSING_PEOPLE_PLUGINS_TOAST, calypsoJob, liveTenant)?.actionLabel),
);
ok(
  "valid Apify key marks the Integrations Apify card connected",
  applyHarvestKeysToIntegrations(liveTenant, [{ provider: "Apify", status: "valid" }]).some(
    (row) => row.id === "int_apify" && row.status === "connected",
  ),
);
ok(
  "Apify (sourcing) label on a valid key still counts as harvest",
  hasValidApifyKey([{ provider: "Apify (sourcing)", status: "valid" }]),
);
const toastSource = readFileSync(new URL("../src/components/ui/toast.tsx", import.meta.url), "utf8");
ok("toast can render a CTA button", /toast-cta/.test(toastSource) && /actionLabel/.test(toastSource));
ok(
  "Apify query field asks the modal to keep focus",
  /data-autofocus/.test(apifyDialog),
);
const connectedUnverified = [
  {
    id: "seat_maya",
    name: "Maya",
    operatorEmail: "maya@amaris.com",
    provider: "Microsoft Graph" as const,
    status: "active" as const,
    mode: "live" as const,
    domainVerified: false,
    dailyLimit: 40,
    warmup: true,
    warmupStartCap: 12,
    warmupStepPerDay: 4,
    warmupStartedAt: "",
    minGapMinutes: 12,
    sendWindow: { timezone: "CET", days: [1, 2, 3, 4, 5], startHour: 8, endHour: 18 },
    sentToday: 0,
    lastSendAt: null,
    health: { sentTotal: 0, bounces: 0, complaints: 0, bounceRate: 0, complaintRate: 0 },
    persona: "",
    signature: "",
    connectedAccount: "maya@amaris.com",
    createdAt: "",
  },
];
ok(
  "connected Outlook without Verify domain cannot send",
  /Verify domain/.test(liveSendBlocker("Email", "Approved", connectedUnverified, [], [], "maya.rivera@amaris.com") ?? ""),
);
const quickDraft = readFileSync(new URL("../src/components/outreach/quick-draft.tsx", import.meta.url), "utf8");
ok("LinkedIn drafter surfaces HeyReach as the send account", /heyreach-sender/.test(quickDraft) && /HeyReach/.test(quickDraft));

console.log(`RESULT integrations-honesty: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
