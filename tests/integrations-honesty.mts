import { readFileSync } from "node:fs";
import { defaultIntegrations, defaultLiveIntegrations, isLinkedInSourcingCard, mergeSeedIntegrations, testConnection } from "../src/lib/integrations";
import {
  EMPTY_PEOPLE_FIRST_HARVEST,
  MISSING_PEOPLE_PLUGINS_TOAST,
  MOCK_APIFY_TOAST,
  PEOPLE_FIRST_HARVEST_UNAVAILABLE,
  SOURCING_AGENT_UNAVAILABLE_TOAST,
  emptyPeopleFirstShortlistError,
  emptyPeopleFirstToast,
  hasValidApifyKey,
  integrationShowsLive,
  missingPeoplePluginsToast,
  peopleFirstFailActivity,
  peoplePluginFailLoudUi,
  peopleSourcePluginsConnected,
  remapPeopleFirstSourcingError,
  sourceRejectedToast,
  visiblePeopleFirstLearningReceipts,
} from "../src/lib/sourcing/people-plugins";
import {
  applyHarvestKeysToIntegrations,
  CONNECT_CHANNELS_COPY,
  hasLiveApifyHarvest,
  isSyntheticRecipientEmail,
  liveSendBlocker,
  workspaceApifyIsMock,
} from "../src/lib/sourcing/people-connect";
import {
  FIXTURE_NOT_ON_LIVE,
  FIXTURE_NOT_ON_LIVE_TOAST,
  isLabFixtureCandidate,
  stripLabFixturePeople,
} from "../src/lib/sourcing/lab-fixture-people";
import { buildSeedState } from "../src/lib/seed";
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
  peopleSourcePluginsConnected(keyedApify, [{ provider: "Apify", status: "valid" }]) &&
    missingPeoplePluginsToast(calypsoJob, keyedApify, [{ provider: "Apify", status: "valid" }]) === null,
);
ok(
  "an Apify card toggled Live without a valid Access & Keys row is not harvest",
  !peopleSourcePluginsConnected(keyedApify) &&
    Boolean(missingPeoplePluginsToast(calypsoJob, keyedApify)),
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
  "a valid Apify Access & Keys row is not a people harvest when the card is Mock",
  hasValidApifyKey([{ provider: "Apify", status: "valid" }]) &&
    !peopleSourcePluginsConnected(liveTenant, [{ provider: "Apify", status: "valid" }]) &&
    missingPeoplePluginsToast(calypsoJob, liveTenant, [{ provider: "Apify", status: "valid" }]) === MOCK_APIFY_TOAST,
);
ok(
  "mergeSeedIntegrations restores a missing Apify card",
  mergeSeedIntegrations(liveTenant.filter((row) => row.id !== "int_apify")).some((row) => row.id === "int_apify" && row.real),
);
ok(
  "Apify (LinkedIn profile search) is not a LinkedIn partner-search concept card",
  apify != null && !isLinkedInSourcingCard(apify) && apify.real === true,
);
const demotedApify = mergeSeedIntegrations([
  {
    id: "int_apify",
    name: "Apify (LinkedIn profile search)",
    category: "Sourcing" as const,
    description: "old",
    status: "connected" as const,
    mode: "mock" as const,
    lastSync: null,
    errors: [],
    real: false,
  },
]);
const repairedApify = demotedApify.find((row) => row.id === "int_apify");
ok(
  "merge seed cannot demote Apify to Concept — leftover mock from Concept is Live",
  repairedApify?.real === true &&
    repairedApify.mode === "live" &&
    repairedApify.setupHref === "/settings",
);
const conceptPlusKey = applyHarvestKeysToIntegrations(
  [
    {
      id: "int_apify",
      name: "Apify (LinkedIn profile search)",
      category: "Sourcing",
      description: "old",
      status: "connected",
      mode: "mock",
      lastSync: null,
      errors: [],
      real: false,
    },
  ],
  [{ provider: "Apify", status: "valid" }],
);
ok(
  "valid stored Apify key on a Concept card is harvest, not Mock",
  conceptPlusKey.some((row) => row.id === "int_apify" && row.real && row.mode === "live" && row.status === "connected") &&
    hasLiveApifyHarvest(conceptPlusKey, [{ provider: "Apify", status: "valid" }]) &&
    !workspaceApifyIsMock({ integrations: conceptPlusKey }),
);
ok(
  "operator Mock on a real card stays Mock even with a valid key",
  workspaceApifyIsMock({ integrations: liveTenant }) &&
    !hasLiveApifyHarvest(liveTenant, [{ provider: "Apify", status: "valid" }]),
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
  "Apify and LinkedIn cards route to Access & Keys, not a generic API-key dead-end",
  /Access & Keys/.test(settingsCard) &&
    /isLinkedInSourcingCard/.test(settingsCard) &&
    /Connect Microsoft account/.test(settingsCard) &&
    !/Connect in Fleet/.test(settingsCard),
);
ok(
  "LinkedIn Sourcing Configure never opens an API-key paste",
  /Paste your API key/.test(settingsCard) &&
    /setupOnly && setupHref/.test(settingsCard) &&
    /isLinkedInSourcingCard\(integration\)/.test(settingsCard),
);
const linkedinSourcing = integrations.find((integration) => integration.id === "int_linkedin");
ok(
  "LinkedIn Sourcing is an honest concept card pointing at Apify Access & Keys",
  linkedinSourcing?.real === false &&
    linkedinSourcing.setupHref === "/settings" &&
    /not wired/i.test(linkedinSourcing.description) &&
    /apify/i.test(linkedinSourcing.description) &&
    !/Paste your API key/i.test(linkedinSourcing.description) &&
    isLinkedInSourcingCard(linkedinSourcing),
);
ok(
  "LinkedIn RSC no longer claims Fleet OAuth is partner search",
  linkedinRsc?.setupHref === "/settings" &&
    /not partner search/i.test(linkedinRsc?.description ?? "") &&
    /apify/i.test(linkedinRsc?.description ?? ""),
);
const leftoverLinkedIn = mergeSeedIntegrations([
  {
    id: "int_linkedin_vendor",
    name: "LinkedIn Sourcing",
    category: "Sourcing" as const,
    description: "Paste a LinkedIn API key to search.",
    status: "connected" as const,
    mode: "live" as const,
    lastSync: "2026-07-15T00:00:00.000Z",
    errors: [],
    real: true,
  },
]);
const rewritten = leftoverLinkedIn.find((row) => row.id === "int_linkedin_vendor");
ok(
  "leftover LinkedIn Sourcing cards are rewritten off the API-key dead-end",
  rewritten?.real === false &&
    rewritten?.status === "not_configured" &&
    rewritten?.setupHref === "/settings" &&
    /not wired/i.test(rewritten?.description ?? "") &&
    !/Paste a LinkedIn API key/i.test(rewritten?.description ?? ""),
);
ok(
  "a valid HeyReach key is not a fake Live/Connected send account",
  applyHarvestKeysToIntegrations(liveTenant, [{ provider: "HeyReach", status: "valid" }]).every(
    (row) => row.id !== "int_heyreach" || row.status !== "connected",
  ) &&
    !integrationShowsLive(
      { id: "int_heyreach", mode: "live", status: "connected" },
      liveTenant,
      calypsoJob,
      [{ provider: "HeyReach", status: "valid" }],
    ) &&
    mergeSeedIntegrations([
      {
        id: "int_heyreach",
        name: "HeyReach",
        category: "Comms" as const,
        description: "old",
        status: "connected" as const,
        mode: "live" as const,
        lastSync: "2026-07-15T00:00:00.000Z",
        errors: [],
        real: true,
      },
    ]).some((row) => row.id === "int_heyreach" && row.status === "not_configured" && row.mode === "mock"),
);
ok(
  "HeyReach card has no Live toggle and names the dry-run send key",
  /int_heyreach/.test(settingsCard) &&
    /no campaign or sender console/i.test(settingsCard) &&
    /integration\.id !== "int_heyreach"/.test(settingsCard),
);
ok(
  "valid Apify key never asks to reconnect via MISSING_PLUGIN on an empty harvest",
  emptyPeopleFirstShortlistError(
    calypsoJob,
    keyedApify,
    { accepted: { length: 0 }, source: "github" },
    [{ provider: "Apify", status: "valid" }],
  ) === EMPTY_PEOPLE_FIRST_HARVEST,
);
ok(
  "Mock Apify card with a valid key is a Mock toast, not a silent empty harvest",
  emptyPeopleFirstShortlistError(
    calypsoJob,
    liveTenant,
    { accepted: { length: 0 }, source: "web" },
    [{ provider: "Apify", status: "valid" }],
  ) === MOCK_APIFY_TOAST &&
    peoplePluginFailLoudUi(MOCK_APIFY_TOAST, calypsoJob, liveTenant, [{ provider: "Apify", status: "valid" }])?.title === "Connect Apify",
);
ok(
  "fail-loud toast always carries a Settings CTA",
  peoplePluginFailLoudUi(MISSING_PEOPLE_PLUGINS_TOAST, calypsoJob, liveTenant)?.href === "/settings" &&
    Boolean(peoplePluginFailLoudUi(MISSING_PEOPLE_PLUGINS_TOAST, calypsoJob, liveTenant)?.actionLabel),
);
ok(
  "missing Apify key is Connect Apify, not silent 0",
  peoplePluginFailLoudUi(MISSING_PEOPLE_PLUGINS_TOAST, calypsoJob, liveTenant)?.title === "Connect Apify" &&
    peoplePluginFailLoudUi(MISSING_PEOPLE_PLUGINS_TOAST, calypsoJob, liveTenant)?.actionLabel === "Connect Apify",
);
const keyedEmptyToast = emptyPeopleFirstToast(
  calypsoJob,
  keyedApify,
  { accepted: { length: 0 }, source: "web" },
  [{ provider: "Apify", status: "valid" }],
);
const keyedEmptyFailLoud = peoplePluginFailLoudUi(
  EMPTY_PEOPLE_FIRST_HARVEST,
  calypsoJob,
  keyedApify,
  [{ provider: "Apify", status: "valid" }],
);
ok(
  "keyed empty harvest is fail-loud without an Access & Keys reconnect CTA",
  keyedEmptyToast?.title === "No shortlist from this harvest" &&
    keyedEmptyToast.description === EMPTY_PEOPLE_FIRST_HARVEST &&
    keyedEmptyToast.href === "#source-apify" &&
    /Source via Apify/i.test(keyedEmptyToast.actionLabel) &&
    !/Access & Keys/i.test(keyedEmptyToast.actionLabel) &&
    keyedEmptyFailLoud?.href === "#source-apify" &&
    /Source via Apify/i.test(String(keyedEmptyFailLoud?.actionLabel)),
);
ok(
  "people-first learning hides stacked LinkedIn 0-rows",
  visiblePeopleFirstLearningReceipts(
    [
      { platform: "LinkedIn", candidateCount: 0 },
      { platform: "LinkedIn", candidateCount: 0 },
      { platform: "Apify", candidateCount: 3 },
    ],
    calypsoJob,
    keyedApify,
    [{ provider: "Apify", status: "valid" }],
  ).every((receipt) => receipt.candidateCount > 0),
);
const liveInvalidResponse = "The sourcing agent returned an invalid response.";
const keyedHarvestFail = remapPeopleFirstSourcingError(
  liveInvalidResponse,
  calypsoJob,
  keyedApify,
  [{ provider: "Apify", status: "valid" }],
);
const keyedCrashToast = peoplePluginFailLoudUi(
  liveInvalidResponse,
  calypsoJob,
  keyedApify,
  [{ provider: "Apify", status: "valid" }],
);
ok(
  "keyed invalid-response remaps to harvest-unavailable, not MISSING_PLUGIN",
  keyedHarvestFail === PEOPLE_FIRST_HARVEST_UNAVAILABLE &&
    !/invalid response|MISSING_PLUGIN/i.test(keyedHarvestFail),
);
ok(
  "keyed invalid-response toast has Access & Keys CTA, not Dismiss-only",
  keyedCrashToast?.href === "/settings" &&
    /Access & Keys/.test(String(keyedCrashToast?.actionLabel)) &&
    !/invalid response|MISSING_PLUGIN/i.test(String(keyedCrashToast?.description)),
);
const toolLoopSource = readFileSync(new URL("../src/lib/ai/tool-loop.ts", import.meta.url), "utf8");
const sourcingAgentRoute = readFileSync(new URL("../src/app/api/sourcing-agent/route.ts", import.meta.url), "utf8");
ok(
  "tool-loop does not statically import Playwright or browser-tools",
  !/from ["']@\/lib\/ai\/browser-tools["']/.test(toolLoopSource) &&
    !/from ["']playwright-core["']/.test(toolLoopSource) &&
    /import\(["']@\/lib\/ai\/browser-tools["']\)/.test(toolLoopSource),
);
ok(
  "people-first sourcing-agent route does not statically import the cloud tool-loop",
  !/from ["']@\/lib\/ai\/tool-loop["']/.test(sourcingAgentRoute) &&
    !/from ["']playwright-core["']/.test(sourcingAgentRoute) &&
    /import\(["']@\/lib\/ai\/tool-loop["']\)/.test(sourcingAgentRoute),
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
ok(
  "workspace_state with int_apify mode mock is not a live harvest key",
  workspaceApifyIsMock({ integrations: liveTenant }) &&
    !workspaceApifyIsMock({ integrations: keyedApify }),
);
const toastSource = readFileSync(new URL("../src/components/ui/toast.tsx", import.meta.url), "utf8");
ok("toast can render a CTA button", /toast-cta/.test(toastSource) && /actionLabel/.test(toastSource));
ok(
  "error toasts are assertive alerts, not polite-only",
  /role=\{t\.variant === "error" \? "alert"/.test(toastSource) &&
    /aria-live=\{t\.variant === "error" \? "assertive"/.test(toastSource),
);
const rejectedCrossOrigin = sourceRejectedToast(
  "CROSS_ORIGIN_REQUEST",
  calypsoJob,
  liveTenant,
);
ok(
  "sourceRejectedToast never swallows CROSS_ORIGIN_REQUEST",
  rejectedCrossOrigin.title === "Sourcing failed" &&
    /cross-origin/i.test(rejectedCrossOrigin.description) &&
    /do not treat this as 0 people/i.test(rejectedCrossOrigin.description),
);
ok(
  "sourceRejectedToast never swallows SOURCING_AGENT_UNAVAILABLE",
  sourceRejectedToast("SOURCING_AGENT_UNAVAILABLE", calypsoJob, liveTenant).description ===
    SOURCING_AGENT_UNAVAILABLE_TOAST &&
    /This is not 0 people/i.test(SOURCING_AGENT_UNAVAILABLE_TOAST),
);
const mockAudit = peopleFirstFailActivity(MOCK_APIFY_TOAST);
const unavailableAudit = peopleFirstFailActivity(SOURCING_AGENT_UNAVAILABLE_TOAST);
ok(
  "campaign activity notes keep stdout codes with the toast, not toast-only",
  mockAudit.title === "Connect Apify" &&
    /PEOPLE_FIRST_HARVEST_MOCK/.test(mockAudit.notes) &&
    /Mock mode/.test(mockAudit.notes) &&
    unavailableAudit.title === "Sourcing failed" &&
    /SOURCING_AGENT_UNAVAILABLE/.test(unavailableAudit.notes) &&
    /This is not 0 people/.test(unavailableAudit.notes),
);
const briefToast = sourceRejectedToast("CAMPAIGN_NOT_READY", calypsoJob, keyedApify);
ok(
  "campaign_invalid_state toasts brief review, never Open Access & Keys",
  /complete and review the campaign brief/i.test(briefToast.description) &&
    briefToast.actionLabel !== "Open Access & Keys" &&
    briefToast.href !== "/settings" &&
    sourceRejectedToast("campaign_invalid_state codes=invalid_type", calypsoJob, keyedApify).actionLabel !==
      "Open Access & Keys",
);
ok(
  "generic unavailable on a Mock card stays unavailable, not a guessed Mock toast",
  remapPeopleFirstSourcingError(SOURCING_AGENT_UNAVAILABLE_TOAST, calypsoJob, liveTenant) ===
    SOURCING_AGENT_UNAVAILABLE_TOAST &&
    remapPeopleFirstSourcingError("SOURCING_AGENT_UNAVAILABLE", calypsoJob, liveTenant) ===
      SOURCING_AGENT_UNAVAILABLE_TOAST,
);
ok(
  "sourceRejectedToast never returns null on a people-first 4xx",
  sourceRejectedToast("Sourcing request failed (HTTP 403). Do not treat this as 0 people.", calypsoJob, liveTenant)
    .description.length > 0 &&
    sourceRejectedToast("The sourcing agent is unavailable.", calypsoJob, liveTenant).description.length > 0,
);
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
const design = readFileSync(new URL("../docs/sourcing-engine/DESIGN.md", import.meta.url), "utf8");
ok(
  "DESIGN pins invalid-agent recovery to Access & Keys and honest LinkedIn/HeyReach cards",
  /Open\s+Access & Keys/.test(design) &&
    /not an API-key paste/.test(design) &&
    /not partner search/.test(design) &&
    /not a fake Live(?:\/Connected)? send account/.test(design) &&
    /Dismiss-only/.test(design),
);
ok(
  "DESIGN forbids fixture hydration on Fly and does not promise a dry-run matcher",
  /FIXTURE_NOT_ON_LIVE/.test(design) &&
    /must not/.test(design) &&
    /sourceEngineFixtureCandidates/.test(design) &&
    !/still runs a dry-run\s+fixture matcher/.test(design) &&
    /PEOPLE_FIRST_HARVEST_MOCK/.test(design) &&
    /audit row/.test(design) &&
    /not toast-only/.test(design) &&
    /SOURCING_AGENT_UNAVAILABLE/.test(design) &&
    /without a second Source click/.test(design),
);
ok(
  "DESIGN pins Apify as a real Live-switch card; Concept + valid key is harvest",
  /isLinkedInSourcingCard/.test(design) &&
    /excludes Apify/.test(design) &&
    /Live mode switch/.test(design) &&
    /Concept/.test(design) &&
    /apifyKeyPresent/.test(design) &&
    /harvestapi Full/.test(design),
);
ok(
  "DESIGN requires email, phone, and LinkedIn on people-first rows",
  /email, phone, and LinkedIn/.test(design) &&
    /PEOPLE_FIRST_HARVEST_INCOMPLETE_CONTACTS/.test(design) &&
    /Do not invent contact/.test(design),
);
ok(
  "Connect copy no longer promises a dry-run shortlist on live",
  /lab fixtures are not LinkedIn/.test(CONNECT_CHANNELS_COPY) &&
    !/dry-run shortlist/.test(CONNECT_CHANNELS_COPY),
);

const seed = buildSeedState();
const livePerson = {
  ...seed.candidates[0],
  id: "cand_live_calypso",
  email: "maya.rivera@amaris.com",
  provenance: "live" as const,
};
const fixturePerson = {
  ...seed.candidates[0],
  id: "cand_fixture_lab",
  email: "elena@fixture.example",
  provenance: "synthetic" as const,
  linkedinUrl: "https://www.linkedin.com/in/elena-fixture",
};
const dirty = {
  ...seed,
  candidates: [livePerson, fixturePerson],
  outreach: seed.outreach.filter((message) => message.candidateId === seed.candidates[0]?.id).map((message) => ({
    ...message,
    candidateId: "cand_fixture_lab",
  })),
};
const cleaned = stripLabFixturePeople(dirty);
ok("lab fixture email is not a live person", isLabFixtureCandidate(fixturePerson));
ok("empty-email live harvest row is not a lab fixture", !isLabFixtureCandidate({ email: "", provenance: "live" }));
ok(
  "strip removes @fixture.example people from a live campaign snapshot",
  cleaned.removedIds.includes("cand_fixture_lab") &&
    cleaned.state.candidates.every((candidate) => candidate.id !== "cand_fixture_lab") &&
    cleaned.state.candidates.some((candidate) => candidate.id === "cand_live_calypso") &&
    cleaned.state.outreach.every((message) => message.candidateId !== "cand_fixture_lab"),
);

const calypsoCampaign = {
  ...seed.campaigns[0],
  id: "camp_calypso_ba",
  jobAnalysis: {
    ...seed.campaigns[0].jobAnalysis,
    title: "Senior Calypso Business Analyst",
    department: "Finance",
    requiredSkills: ["Calypso", "Linux", "Python"],
  },
};
const leftoverGithub = {
  ...seed.candidates[0],
  id: "cand_github_leftover",
  campaignId: "camp_calypso_ba",
  email: "",
  phone: "",
  linkedinUrl: "",
  githubUrl: "https://github.com/calypso-martinez",
  sourcePlatform: "GitHub" as const,
  provenance: "live" as const,
};
const realCalypso = {
  ...seed.candidates[0],
  id: "cand_real_calypso",
  campaignId: "camp_calypso_ba",
  email: "elena.varga@bnpp-cib.com",
  phone: "+1 514 555 0142",
  linkedinUrl: "https://www.linkedin.com/in/elena-varga",
  sourcePlatform: "Apify" as const,
  provenance: "live" as const,
};
const leftoverCleaned = stripLabFixturePeople({
  ...seed,
  campaigns: [...seed.campaigns, calypsoCampaign],
  candidates: [realCalypso, leftoverGithub],
  outreach: [],
});
ok(
  "strip removes leftover GitHub / name-only people from a people-first campaign",
  leftoverCleaned.removedIds.includes("cand_github_leftover") &&
    leftoverCleaned.state.candidates.every((candidate) => candidate.id !== "cand_github_leftover") &&
    leftoverCleaned.state.candidates.some((candidate) => candidate.id === "cand_real_calypso"),
);
const storeHygiene = readFileSync(new URL("../src/lib/store.ts", import.meta.url), "utf8");
ok(
  "live hydrate and conflict reload strip leftover GitHub / example.com and persist the audit",
  /applyLivePeopleFirstHygiene/.test(storeHygiene) &&
    /persistHygiene/.test(storeHygiene) &&
    /leftover GitHub \/ example\.com/.test(storeHygiene) &&
    /visibleWorkspaceCandidates/.test(storeHygiene) &&
    /isPeopleFirstContactComplete/.test(storeHygiene),
);
ok(
  "fixture deny toast is Connect Apify / switch to Live",
  FIXTURE_NOT_ON_LIVE === "FIXTURE_NOT_ON_LIVE" &&
    /Connect a real Apify key/.test(FIXTURE_NOT_ON_LIVE_TOAST) &&
    /Live/.test(FIXTURE_NOT_ON_LIVE_TOAST),
);

console.log(`RESULT integrations-honesty: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
