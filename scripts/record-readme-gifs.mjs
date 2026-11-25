/**
 * Regenerate the three README loops from this branch's dry-run demo.
 *
 *   npm run dev -- --hostname 127.0.0.1 --port 3000
 *   ARIA_DEMO_URL=http://127.0.0.1:3000 node scripts/record-readme-gifs.mjs
 *
 * Supabase must be unset so the browser seed loads. The script rewrites that
 * seed to fixture names before it records, and it only writes the three
 * README loops under docs/media.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const ROOT = process.cwd();
const MEDIA = path.join(ROOT, "docs", "media");
const DEMO = process.env.ARIA_DEMO_URL ?? "http://127.0.0.1:3000";
const STORAGE_KEY = "hermes-sourcing:v1";
const ONBOARDED_KEY = "hermes:onboarded:v1";
const WIDTH = 1200;
const HEIGHT = 760;
const MAX_BYTES = 3 * 1024 * 1024;

const GIVEN = ["Ada", "Bea", "Cal", "Dee", "Eli", "Fay", "Gia", "Hal", "Ivy", "Jan", "Kit", "Lee", "Max", "Noa", "Ora"];
const FAMILIES = ["Example", "Fixture", "Demo", "Sample"];
const BANNED = [
  "Maya", "Diego", "Aisha", "Liam", "Priya", "Noah", "Sofia", "Kenji", "Amara", "Lucas",
  "Ingrid", "Tariq", "Elena", "Mateo", "Hana", "Oliver", "Zara", "Felix", "Nadia", "Arjun",
  "Clara", "Idris", "Yuki", "Marco", "Leila", "Sven", "Rosa", "Omar", "Freya", "Daniel",
  "Bianca", "Ravi", "Astrid", "Caleb", "Mina", "Theo", "Lena", "Hugo", "Sara", "Niko",
  "Camille", "Viktor", "Joel", "Petra", "Sami", "Greta", "Ade", "Tomas", "Iris",
  "Okafor", "Reyes", "Khan", "Novak", "Patel", "Andersen", "Romano", "Tanaka", "Nwosu", "Silva",
  "Lindqvist", "Haddad", "Petrova", "Garcia", "Sato", "Whitfield", "Ahmadi", "Berg", "Costa", "Mehta",
  "Dubois", "Larsson", "Yamamoto", "Bianchi", "Hassan", "Mueller", "Fontaine", "Aziz", "Holm", "Cruz",
  "Ferraro", "Kapoor", "Sorensen", "Brennan", "Vargas", "Eriksson", "Bauer", "Moreau",
  "Jordan", "Bryce", "Daniela", "Brandt", "Dana", "Marcus", "Nair", "Giulia", "Okonkwo",
  "Marta", "Nowak", "Amin", "Chloe", "Chloé", "Carter", "Tony", "Walteur",
];

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const BANNED_RE = new RegExp(
  `\\b(?:${[...BANNED].sort((a, b) => b.length - a.length).map(escapeRegExp).join("|")})\\b`,
  "gu",
);

function exampleName(index) {
  const family = FAMILIES[Math.floor(index / GIVEN.length)] ?? "Demo";
  return `${GIVEN[index % GIVEN.length]} ${family}`;
}

function scrubString(value) {
  return value
    .replace(BANNED_RE, "Example")
    .replace(/\bExample(?:\s+Example)+\b/g, "Ada Example")
    .replace(/https?:\/\/(?:www\.)?linkedin\.com\/\S*/gi, "")
    .replace(/https?:\/\/(?:www\.)?github\.com\/\S*/gi, "")
    .replace(/\+\d[\d\s()-]{6,}/g, "");
}

function scrub(value) {
  if (typeof value === "string") return scrubString(value);
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === "object") {
    for (const key of Object.keys(value)) value[key] = scrub(value[key]);
  }
  return value;
}

function anonymize(state) {
  scrub(state);
  state.settings.operatorName = "Riley Example";
  state.settings.confidentialityMode = false;
  state.settings.dryRunMode = true;
  for (const [index, person] of [...(state.seats ?? []), ...(state.interviewers ?? [])].entries()) {
    const name = exampleName(index + 1);
    if ("name" in person) person.name = index < (state.seats ?? []).length ? `Aria · ${name}` : name;
    if ("operatorEmail" in person) person.operatorEmail = `seat.${index}.example@example.com`;
    if ("email" in person && person.email) person.email = `person.${index}.example@example.com`;
  }
  for (const [index, campaign] of (state.campaigns ?? []).entries()) {
    campaign.hiringManager = "Quinn Example";
    campaign.hiringManagerEmail = `quinn.${index}.example@example.com`;
    if (campaign.metrics) campaign.metrics.emailsSentToday = Math.min(campaign.metrics.emailsSentToday ?? 0, 2);
  }
  const ranked = [...(state.candidates ?? [])].sort((a, b) => (b.matchScore ?? 0) - (a.matchScore ?? 0));
  ranked.forEach((candidate, index) => {
    const name = index === 9 ? "Jan Fixture" : exampleName(index);
    candidate.name = name;
    candidate.email = `${name.toLowerCase().replace(/\s+/g, ".")}@example.com`;
    candidate.currentCompany = "Example Labs";
    candidate.location = "Example City";
    candidate.linkedinUrl = "";
    candidate.githubUrl = "";
    candidate.phone = "";
    candidate.avatarUrl = undefined;
    candidate.sourceUrl = "";
    candidate.avatarInitials = name.split(" ").map((part) => part[0]).join("").slice(0, 2);
    candidate.sourceQuery = "example public profile";
    candidate.recentActivity = "Shipped an example project that uses this role's required skills.";
    if (candidate.referredBy) candidate.referredBy = "Quinn Example";
  });
  const ada = ranked[0];
  if (!ada) throw new Error("synthetic demo has no candidates");
  ada.name = "Ada Example";
  ada.email = "ada.example@example.com";
  ada.avatarInitials = "AE";
  ada.lawfulBasis = "legitimate_interest";
  ada.lawfulBasisRecordedAt = "2026-01-15T12:00:00.000Z";
  ada.lawfulBasisSource = "operator_selection";
  ada.complianceFlags = {
    ...(ada.complianceFlags ?? {}),
    doNotContact: false,
    suppressed: false,
    unsubscribed: false,
    anonymized: false,
  };
  const draft = (state.outreach ?? []).find((message) => message.candidateId === ada.id && message.channel === "Email" && (message.status === "Needs Approval" || message.status === "Draft"))
    ?? (state.outreach ?? []).find((message) => message.channel === "Email" && (message.status === "Needs Approval" || message.status === "Draft"));
  if (!draft) throw new Error("synthetic demo has no email draft");
  draft.candidateId = ada.id;
  draft.campaignId = ada.campaignId;
  draft.channel = "Email";
  draft.status = "Needs Approval";
  draft.subject = "Example role, a short conversation";
  draft.body = [
    "Hi Ada,",
    "",
    "Your example profile matches the skills this role asks for. I would like to share the team and the work.",
    "",
    "Would a 15-minute conversation be useful?",
    "",
    "Riley Example",
  ].join("\n");
  draft.personalizationEvidence = ["Example profile lists the role's required skills."];
  draft.approvedBy = null;
  draft.dryRun = true;
  for (const message of state.outreach ?? []) {
    if (message === draft) continue;
    const owner = (state.candidates ?? []).find((candidate) => candidate.id === message.candidateId);
    const first = (owner?.name ?? "Bea Example").split(" ")[0];
    message.subject = `Example note for ${first}`;
    message.body = `Hi ${first},\n\nThis is a synthetic example draft. Nothing is sent until a person approves this exact text.\n\nRiley Example`;
    message.personalizationEvidence = ["Synthetic example evidence for this profile."];
    if (message.approvedBy) message.approvedBy = "Riley Example";
    if (message.channel === "LinkedIn") message.channel = "Email";
  }
  for (const submission of state.chatboxSubmissions ?? []) {
    submission.firstName = "Quinn";
    submission.lastName = "Example";
    submission.email = "quinn.example@example.com";
    submission.phone = "";
    submission.cvFileName = "Quinn_Example_CV.pdf";
  }
  return scrub(state);
}

async function maskChrome(page) {
  await page.evaluate(() => {
    const walk = (node) => {
      if (node.nodeType === Node.TEXT_NODE && node.nodeValue && /Tony Walteur/.test(node.nodeValue)) {
        node.nodeValue = node.nodeValue.replaceAll("Tony Walteur", "Riley Example");
      }
      for (const child of node.childNodes) walk(child);
    };
    if (document.body) walk(document.body);
  });
}

function assertClean(text, label) {
  BANNED_RE.lastIndex = 0;
  const hit = BANNED_RE.exec(text);
  if (hit) throw new Error(`${label} still shows a non-fixture name: ${hit[0]}`);
  if (/linkedin\.com/i.test(text)) throw new Error(`${label} still shows a LinkedIn host`);
}

function toGif(webm, gif) {
  const attempts = [
    "fps=8,scale=880:-1:flags=lanczos",
    "fps=6,scale=760:-1:flags=lanczos",
    "fps=5,scale=640:-1:flags=lanczos",
  ];
  let last = "";
  for (const scale of attempts) {
    const result = spawnSync("ffmpeg", [
      "-y",
      "-ss", "0.9",
      "-t", "7.2",
      "-i", webm,
      "-vf", `${scale},split[s0][s1];[s0]palettegen=max_colors=48:stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=4`,
      "-loop", "0",
      gif,
    ], { encoding: "utf8" });
    if (result.status !== 0) {
      last = result.stderr || result.stdout || "ffmpeg failed";
      continue;
    }
    if (statSync(gif).size < MAX_BYTES) return;
    last = `size ${statSync(gif).size}`;
  }
  throw new Error(`could not encode ${gif} under 3 MB (${last.slice(-400)})`);
}

async function launch() {
  return chromium.launch({
    channel: "chrome",
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
}

async function prepareDemo(browser) {
  const context = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT } });
  await context.addInitScript((key) => {
    localStorage.setItem(key, "1");
  }, ONBOARDED_KEY);
  const page = await context.newPage();
  await page.goto(DEMO, { waitUntil: "load" });
  await page.getByText("Command Center", { exact: true }).first().waitFor({ timeout: 30000 });
  await page.waitForFunction((key) => localStorage.getItem(key), STORAGE_KEY, { timeout: 30000 });
  const raw = await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY);
  const state = anonymize(JSON.parse(raw));
  await page.evaluate(([key, json]) => localStorage.setItem(key, json), [STORAGE_KEY, JSON.stringify(state)]);
  await page.reload({ waitUntil: "load" });
  await page.getByText("Your next move is ready.", { exact: true }).waitFor({ timeout: 30000 });
  await maskChrome(page);
  await page.getByText("Ada Example").first().waitFor({ timeout: 15000 }).catch(() => undefined);
  assertClean(await page.locator("body").innerText(), "command center");
  const storage = await context.storageState();
  await context.close();
  return storage;
}

async function recordClip(browser, storage, file, action) {
  const dir = path.join(ROOT, "tmp", "readme-video", path.basename(file, ".gif"));
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const context = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT },
    storageState: storage,
    recordVideo: { dir, size: { width: WIDTH, height: HEIGHT } },
  });
  await context.addInitScript((key) => {
    localStorage.setItem(key, "1");
  }, ONBOARDED_KEY);
  const page = await context.newPage();
  await action(page);
  await page.waitForTimeout(700);
  const video = page.video();
  await context.close();
  toGif(await video.path(), path.join(MEDIA, file));
}

async function recordNext(browser) {
  const storage = await prepareDemo(browser);
  await recordClip(browser, storage, "command-center.gif", async (page) => {
    await page.goto(DEMO, { waitUntil: "load" });
    await page.getByText("Your next move is ready.", { exact: true }).waitFor();
    await maskChrome(page);
    await page.getByRole("link", { name: "Review outreach" }).first().waitFor();
    await page.waitForTimeout(1000);
    await page.getByText("Avg match score", { exact: true }).first().evaluate((node) => {
      node.scrollIntoView({ block: "center", inline: "nearest" });
    });
    await page.getByText("Time to first interview", { exact: true }).first().waitFor();
    await page.waitForTimeout(1800);
  });
  await recordClip(browser, storage, "candidate-ranking.gif", async (page) => {
    await page.goto(`${DEMO}/candidates`, { waitUntil: "load" });
    const ada = page.getByRole("button", { name: "Ada Example" }).first();
    await ada.waitFor();
    await maskChrome(page);
    assertClean(await page.locator("body").innerText(), "candidate list");
    await page.waitForTimeout(900);
    await ada.click();
    const drawer = page.getByLabel("Ada Example", { exact: true });
    await drawer.getByText("Match score", { exact: true }).waitFor();
    await drawer.getByText("Overall fit", { exact: true }).waitFor();
    assertClean(await page.locator("body").innerText(), "candidate profile");
    await page.waitForTimeout(1600);
  });
  await recordClip(browser, storage, "exact-text-approval.gif", async (page) => {
    await page.goto(`${DEMO}/outreach`, { waitUntil: "load" });
    await page.getByText("Awaiting approval", { exact: false }).first().waitFor();
    await maskChrome(page);
    const index = await page.locator("textarea").evaluateAll((nodes) =>
      nodes.findIndex((node) => (node instanceof HTMLTextAreaElement ? node.value : "").includes("Hi Ada,")),
    );
    if (index < 0) {
      console.error(await page.locator("body").innerText());
      throw new Error("exact draft was not on the approval queue");
    }
    const area = page.locator("textarea").nth(index);
    await area.scrollIntoViewIfNeeded();
    assertClean(await page.locator("body").innerText(), "outreach queue");
    await page.waitForTimeout(1200);
    const card = area.locator("xpath=ancestor::*[.//button[normalize-space()='Approve']][1]");
    const approve = card.getByRole("button", { name: "Approve", exact: true });
    await approve.scrollIntoViewIfNeeded();
    await approve.click();
    const confirmed = page.getByText("Approved: queued for send").first();
    const blocked = page.getByText("Approval blocked").first();
    await Promise.race([
      confirmed.waitFor({ timeout: 10000 }),
      blocked.waitFor({ timeout: 10000 }),
    ]);
    if (await blocked.count()) {
      console.error(await page.locator("body").innerText());
      throw new Error("approval was blocked");
    }
    await page.waitForTimeout(1400);
  });
}

mkdirSync(MEDIA, { recursive: true });
const browser = await launch();
try {
  await recordNext(browser);
} finally {
  await browser.close();
}
console.log("recorded next demo loops");
