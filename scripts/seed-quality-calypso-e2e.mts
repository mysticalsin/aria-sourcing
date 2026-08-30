/**
 * One-shot: seed quality contactable Calypso BA shortlist into the live
 * workspace for E2E / demo when GitHub hard gates yield 0.
 *
 * Usage: ADMIN_EMAIL=… ADMIN_PASSWORD=… ANON_KEY=… npx tsx scripts/seed-quality-calypso-e2e.mts
 */
import { scoreCandidate } from "../src/lib/scoring";
import { passesHardGates } from "../src/lib/sourcing/hard-gates";
import { eligibleForShortlist, SOURCING_QUALITY_FLOOR } from "../src/lib/sourcing/candidate-fit";
import { getContactStatus } from "../src/lib/contact-status";
import type { Candidate, Campaign, HermesState } from "../src/lib/types";

const APP = process.env.APP_URL ?? "https://aria-mantu-app.fly.dev";
const KONG = process.env.KONG_URL ?? "https://aria-mantu-kong.fly.dev";
const email = process.env.ADMIN_EMAIL ?? "";
const password = process.env.ADMIN_PASSWORD ?? "";
const anon = process.env.ANON_KEY ?? "";

if (!email || !password || !anon) {
  console.error("ADMIN_EMAIL, ADMIN_PASSWORD, ANON_KEY required");
  process.exit(2);
}

async function jsonFetch(url: string, init: RequestInit = {}) {
  const res = await fetch(url, init);
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { res, body };
}

const seeds = [
  {
    name: "Amina Best",
    company: "BNPP CIB",
    title: "Senior Calypso Business Analyst",
    years: 8,
    email: "amina.best.calypso@example.com",
    li: "https://www.linkedin.com/in/amina-best-calypso-ba",
    otw: true,
    contacted: false,
  },
  {
    name: "Marc Tremblay",
    company: "Desjardins",
    title: "Calypso BA — Settlements",
    years: 9,
    email: "marc.tremblay.ba@example.com",
    li: "https://www.linkedin.com/in/marc-tremblay-calypso",
    otw: true,
    contacted: false,
  },
  {
    name: "Sophie Chen",
    company: "National Bank",
    title: "Senior Business Analyst (Calypso)",
    years: 7,
    email: "sophie.chen.calypso@example.com",
    li: "https://www.linkedin.com/in/sophie-chen-calypso-ba",
    otw: false,
    contacted: false,
  },
  {
    name: "Julien Moreau",
    company: "Societe Generale",
    title: "Calypso Business Analyst",
    years: 10,
    email: "julien.moreau.ba@example.com",
    li: "https://www.linkedin.com/in/julien-moreau-calypso",
    otw: true,
    contacted: true,
  },
  {
    name: "Priya Nair",
    company: "BNPP CIB Canada",
    title: "Senior Calypso BA / MOA",
    years: 8,
    email: "priya.nair.calypso@example.com",
    li: "https://www.linkedin.com/in/priya-nair-calypso",
    otw: true,
    contacted: false,
  },
  {
    name: "Alex Rivera",
    company: "CIBC",
    title: "Calypso BA — Trade Lifecycle",
    years: 7,
    email: "alex.rivera.calypso@example.com",
    li: "https://www.linkedin.com/in/alex-rivera-calypso-ba",
    otw: true,
    contacted: false,
  },
] as const;

const login = await jsonFetch(`${KONG}/auth/v1/token?grant_type=password`, {
  method: "POST",
  headers: { apikey: anon, "Content-Type": "application/json" },
  body: JSON.stringify({ email, password }),
});
const sess = login.body as { access_token?: string };
if (!sess.access_token) {
  console.error("login failed", login.res.status, login.body);
  process.exit(1);
}
const tok = sess.access_token;

await jsonFetch(`${KONG}/rest/v1/rpc/ensure_workspace`, {
  method: "POST",
  headers: {
    apikey: anon,
    Authorization: `Bearer ${tok}`,
    "Content-Type": "application/json",
  },
  body: "{}",
});

const ws = await jsonFetch(`${KONG}/rest/v1/workspace_state?select=workspace_id,state`, {
  headers: {
    apikey: anon,
    Authorization: `Bearer ${tok}`,
    Accept: "application/vnd.pgrst.object+json",
  },
});
const row = ws.body as { workspace_id: string; state: HermesState };
const state = row.state;
const campaign =
  (state.campaigns ?? []).find((c: Campaign) => /calypso/i.test(c.title ?? c.jobAnalysis?.title ?? "")) ??
  state.campaigns?.[0];
if (!campaign) {
  console.error("no campaign in workspace");
  process.exit(1);
}

// Ensure language gate has a verifiable requirement for quality demos.
const jd = {
  ...campaign.jobAnalysis,
  requiredLanguages: campaign.jobAnalysis.requiredLanguages?.length
    ? campaign.jobAnalysis.requiredLanguages
    : ["English"],
  regions: campaign.jobAnalysis.regions?.length ? campaign.jobAnalysis.regions : ["Montreal"],
  location: campaign.jobAnalysis.location || "Montreal",
};
campaign.jobAnalysis = jd;

const quality: Candidate[] = [];
for (const [i, s] of seeds.entries()) {
  const base = {
    id: `cand_quality_calypso_${i + 1}`,
    campaignId: campaign.id,
    name: s.name,
    email: s.email,
    phone: `+1514${1000000 + i * 111}`,
    avatarInitials: s.name
      .split(" ")
      .map((p) => p[0])
      .join("")
      .slice(0, 2),
    currentTitle: s.title,
    currentCompany: s.company,
    location: "Montreal, QC",
    timezone: "America/Montreal",
    linkedinUrl: s.li,
    githubUrl: "",
    sourcePlatform: "LinkedIn" as const,
    sourceQuery: '("Calypso") AND ("Business Analyst" OR BA) AND (MySQL OR SQL) Montreal',
    matchScore: 0,
    matchBreakdown: [],
    techStack: ["Calypso", "Business Analysis", "MySQL", "Settlements", "SQL", "UAT"],
    yearsExperience: s.years,
    companyStageExperience: ["Enterprise"],
    industryExperience: ["Banking", "Capital Markets"],
    recentActivity: s.otw ? "Open to Work — Calypso BA settlements / T+1" : "Active Calypso BA delivery",
    languages: ["English", "French"],
    openToWork: s.otw || undefined,
    stage: s.contacted ? ("Contacted" as const) : ("Sourced" as const),
    lastContactedAt: s.contacted ? new Date(Date.now() - 3 * 864e5).toISOString() : null,
    outreachHistory: s.contacted
      ? [
          {
            id: "oh1",
            channel: "Email" as const,
            subject: "Calypso BA — Montreal",
            body: "Quick note about the Senior Calypso BA need in Montreal.",
            sentAt: new Date(Date.now() - 3 * 864e5).toISOString(),
            status: "sent" as const,
          },
        ]
      : [],
    replyHistory: [],
    booking: null,
    complianceFlags: {
      doNotContact: false,
      suppressed: false,
      unsubscribed: false,
      gdprExportRequested: false,
      anonymized: false,
      suppressedUntil: null,
    },
    createdAt: new Date().toISOString(),
    provenance: "manual" as const,
    domainTags: ["Calypso", "CIB", "settlements"],
    profileText: `${s.title} at ${s.company}. Calypso BO/FO, MySQL reconciliation, BA lifecycle UAT/NRT, Montreal.`,
  } as Candidate;
  const scored = scoreCandidate(base, jd);
  const c: Candidate = {
    ...base,
    matchScore: scored.score,
    matchBreakdown: scored.breakdown,
    matchEvidence: scored.evidence,
  };
  const gates = passesHardGates(c, jd);
  const elig = eligibleForShortlist(c, jd, SOURCING_QUALITY_FLOOR);
  const contact = getContactStatus(c);
  console.log(
    JSON.stringify({
      name: c.name,
      score: c.matchScore,
      gates,
      eligible: elig.ok,
      contact: contact.label,
      email: Boolean(c.email),
      linkedin: Boolean(c.linkedinUrl),
    }),
  );
  if (!gates || !elig.ok) {
    console.error("seed failed quality gates", c.name, scored.evidence);
    process.exit(1);
  }
  quality.push(c);
}

// Replace weak GitHub username matches for this campaign with quality shortlist.
const others = (state.candidates ?? []).filter((c) => c.campaignId !== campaign.id);
state.candidates = [...others, ...quality];
state.activeCampaignId = campaign.id;
state.campaigns = (state.campaigns ?? []).map((c) => (c.id === campaign.id ? campaign : c));

const upsert = await jsonFetch(`${KONG}/rest/v1/workspace_state?on_conflict=workspace_id`, {
  method: "POST",
  headers: {
    apikey: anon,
    Authorization: `Bearer ${tok}`,
    "Content-Type": "application/json",
    Prefer: "resolution=merge-duplicates,return=minimal",
  },
  body: JSON.stringify({
    workspace_id: row.workspace_id,
    state,
    updated_at: new Date().toISOString(),
  }),
});
if (!upsert.res.ok) {
  console.error("upsert failed", upsert.res.status, upsert.body);
  process.exit(1);
}

console.log(
  JSON.stringify({
    ok: true,
    app: APP,
    campaignId: campaign.id,
    qualityCount: quality.length,
    contactable: quality.filter((c) => c.email || c.linkedinUrl).length,
    neverContacted: quality.filter((c) => getContactStatus(c).status === "never").length,
    contactedBadge: quality.filter((c) => getContactStatus(c).status !== "never").length,
  }),
);
