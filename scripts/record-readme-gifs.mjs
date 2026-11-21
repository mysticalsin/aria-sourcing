/**
 * Regenerate the README loops.
 *
 * The Next.js loops use the synthetic browser demo (Supabase unset):
 *   npm run dev -- --hostname 127.0.0.1 --port 3000
 *   ARIA_DEMO_URL=http://127.0.0.1:3000 node scripts/record-readme-gifs.mjs --next
 *
 * The Docker Compose stack on this branch is live mode and does not load that
 * seed. Sourcing there can reach public networks, so this script does not.
 *
 * The Hired-gate loop is the Odoo 19 addon from the in-review pipeline, which
 * is not in this branch. Point the script at a local server seeded with
 * Ada Example (see that pull request's e2e bootstrap):
 *   ARIA_E2E_PASSWORD=... ODOO_BASE_URL=http://127.0.0.1:8069 \
 *     node scripts/record-readme-gifs.mjs --odoo
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const ROOT = process.cwd();
const MEDIA = path.join(ROOT, "docs", "media");
const DEMO = process.env.ARIA_DEMO_URL ?? "http://127.0.0.1:3000";
const ODOO = process.env.ODOO_BASE_URL ?? "";
const WIDTH = 1200;
const HEIGHT = 760;
const MAX_BYTES = 3 * 1024 * 1024;

const GIVEN = ["Ada", "Bea", "Cal", "Dee", "Eli", "Fay", "Gia", "Hal", "Ivy", "Jan", "Kit", "Lee", "Max", "Noa", "Ora"];
const BANNED = [
  "Maya", "Diego", "Aisha", "Liam", "Priya", "Noah", "Sofia", "Kenji", "Amara", "Lucas",
  "Ingrid", "Tariq", "Elena", "Mateo", "Hana", "Oliver", "Zara", "Felix", "Nadia", "Arjun",
  "Clara", "Idris", "Yuki", "Marco", "Leila", "Sven", "Rosa", "Omar", "Freya", "Daniel",
  "Bianca", "Ravi", "Astrid", "Caleb", "Mina", "Theo", "Lena", "Hugo", "Sara", "Niko",
  "Camille", "Viktor", "Joel", "Petra", "Sami", "Greta", "Ade", "Tomas", "Iris",
  "Okafor", "Reyes", "Khan", "Novak", "Patel", "Andersen", "Romano", "Tanaka", "Nwosu", "Silva",
  "Lindqvist", "Haddad", "Petrova", "Garcia", "Sato", "Whitfield", "Ahmadi", "Berg", "Costa", "Mehta",
  "Dubois", "Larsson", "Yamamoto", "Bianchi", "Hassan", "Mueller", "Fontaine", "Aziz", "Holm", "Cruz",
  "Ferraro", "Kapoor", "Sorensen", "Brennan", "Park", "Vargas", "Eriksson", "Bauer", "Moreau",
  "Amélie", "Rousseau", "Kowalski", "Almeida", "Giulia", "Daniela", "Brandt", "Jordan", "Bryce",
  "Chloé", "Okonkwo", "Nowak", "El-Amin", "Carter",
];

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const BANNED_RE = new RegExp(`\\b(?:${[...BANNED].sort((a, b) => b.length - a.length).map(escapeRegExp).join("|")})\\b`, "gi");

function scrubString(value) {
  BANNED_RE.lastIndex = 0;
  return value.replace(BANNED_RE, "Example").replace(/\bExample(?:\s+Example)+\b/g, "Ada Example");
}

function scrub(value) {
  if (typeof value === "string") return scrubString(value);
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === "object") {
    for (const key of Object.keys(value)) value[key] = scrub(value[key]);
  }
  return value;
}

function exampleName(index) {
  const family = ["Example", "Sample", "Fixture", "Demo"][Math.floor(index / GIVEN.length)] ?? "Demo";
  return `${GIVEN[index % GIVEN.length]} ${family}`;
}

function anonymize(state) {
  scrub(state);
  state.settings.operatorName = "Riley Example";
  state.settings.confidentialityMode = false;
  state.settings.dryRunMode = true;
  const people = [
    ...(state.seats ?? []),
    ...(state.interviewers ?? []),
  ];
  for (const [index, person] of people.entries()) {
    const name = exampleName(index + 1);
    if ("name" in person) person.name = index < (state.seats ?? []).length ? `Aria · ${name}` : name;
    if ("operatorEmail" in person) person.operatorEmail = `seat.${index}.example@example.com`;
    if ("email" in person && person.email) person.email = `person.${index}.example@example.com`;
  }
  for (const [index, campaign] of (state.campaigns ?? []).entries()) {
    campaign.hiringManager = "Quinn Example";
    campaign.hiringManagerEmail = `quinn.${index}.example@example.com`;
  }
  const ranked = [...(state.candidates ?? [])].sort((a, b) => b.matchScore - a.matchScore);
  ranked.forEach((candidate, index) => {
    const name = exampleName(index);
    candidate.name = name;
    candidate.email = `${name.toLowerCase().replace(/\s+/g, ".")}@example.com`;
    candidate.currentCompany = "Example Labs";
    candidate.location = "Example City";
    candidate.linkedinUrl = "";
    candidate.githubUrl = "";
    candidate.phone = "";
    candidate.avatarUrl = undefined;
    candidate.avatarInitials = name.split(" ").map((part) => part[0]).join("").slice(0, 2);
    candidate.sourceQuery = "example public profile";
    candidate.recentActivity = "Shipped an example project that uses this role's required skills.";
    if (candidate.referredBy) candidate.referredBy = "Quinn Example";
  });
  const ada = ranked[0];
  if (!ada) throw new Error("synthetic demo has no candidates");
  ada.name = "Ada Example";
  ada.email = "ada.example@example.com";
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
  const draft = (state.outreach ?? []).find((message) => message.status === "Needs Approval" && message.channel === "Email")
    ?? (state.outreach ?? []).find((message) => message.channel === "Email");
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
  }
  return state;
}

function assertClean(text, label) {
  BANNED_RE.lastIndex = 0;
  const hit = BANNED_RE.exec(text);
  if (hit) throw new Error(`${label} still shows a non-example name: ${hit[0]}`);
}

async function launch() {
  return chromium.launch({ channel: "chrome", headless: true });
}

async function prepareDemo(browser) {
  const context = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT } });
  await context.addInitScript(() => {
    localStorage.setItem("aria:onboarded:v1", "1");
  });
  const page = await context.newPage();
  await page.goto(DEMO, { waitUntil: "load" });
  await page.getByText("Command Center", { exact: true }).waitFor({ timeout: 30000 });
  await page.waitForFunction(() => localStorage.getItem("aria-sourcing:v1"));
  const raw = await page.evaluate(() => localStorage.getItem("aria-sourcing:v1"));
  const state = anonymize(JSON.parse(raw));
  await page.evaluate((json) => localStorage.setItem("aria-sourcing:v1", json), JSON.stringify(state));
  await page.reload({ waitUntil: "load" });
  await page.getByText("Command Center", { exact: true }).waitFor();
  await page.getByText("Ada Example").first().waitFor({ timeout: 15000 }).catch(() => undefined);
  assertClean(await page.locator("body").innerText(), "command center");
  const storage = await context.storageState();
  await context.close();
  return storage;
}

function toGif(webm, gif, start = "0.4") {
  const attempts = [
    "fps=8,scale=880:-1:flags=lanczos",
    "fps=6,scale=760:-1:flags=lanczos",
    "fps=5,scale=640:-1:flags=lanczos",
  ];
  let last = "";
  for (const scale of attempts) {
    const result = spawnSync("ffmpeg", [
      "-y",
      "-ss", start,
      "-t", "7.2",
      "-i", webm,
      "-vf", `${scale},split[s0][s1];[s0]palettegen=max_colors=48:stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=4`,
      "-loop", "0",
      gif,
    ], { encoding: "utf8" });
    if (result.status !== 0) {
      last = result.stderr || result.stdout;
      continue;
    }
    if (statSync(gif).size < MAX_BYTES) return;
    last = `size ${statSync(gif).size}`;
  }
  throw new Error(`could not encode ${gif} under 3 MB (${last.slice(-400)})`);
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
  await context.addInitScript(() => {
    localStorage.setItem("aria:onboarded:v1", "1");
  });
  const page = await context.newPage();
  await action(page);
  await page.waitForTimeout(900);
  const video = page.video();
  await context.close();
  const webm = await video.path();
  toGif(webm, path.join(MEDIA, file));
}

async function recordNext(browser) {
  const storage = await prepareDemo(browser);
  await recordClip(browser, storage, "command-center.gif", async (page) => {
    await page.goto(DEMO, { waitUntil: "load" });
    await page.getByText("Command Center", { exact: true }).waitFor();
    await page.getByText("Active campaigns", { exact: true }).first().waitFor();
    await page.getByText("Avg match score", { exact: true }).waitFor();
    await page.waitForTimeout(2500);
  });
  await recordClip(browser, storage, "candidate-ranking.gif", async (page) => {
    await page.goto(`${DEMO}/candidates`, { waitUntil: "load" });
    const ada = page.getByRole("button", { name: "Ada Example" }).first();
    await ada.waitFor();
    await page.waitForTimeout(700);
    await ada.click();
    await page.getByLabel("Overview").getByText("Match score").waitFor();
    await page.getByText("Observed requirements:").waitFor();
    await page.waitForTimeout(1800);
  });
  await recordClip(browser, storage, "exact-text-approval.gif", async (page) => {
    await page.goto(`${DEMO}/outreach`, { waitUntil: "load" });
    const row = page.getByRole("button", { name: /Ada Example/ }).first();
    await row.waitFor();
    await row.click();
    const exact = page.getByText("Hi Ada,");
    await exact.waitFor();
    await exact.scrollIntoViewIfNeeded();
    await page.waitForTimeout(1400);
    await page.getByRole("button", { name: "Approve", exact: true }).scrollIntoViewIfNeeded();
    await page.getByRole("button", { name: "Approve", exact: true }).click();
    const confirmed = page.getByText(/Approved: queued for send|Nothing sent live|Approval blocked/i).first();
    try {
      await confirmed.waitFor({ timeout: 10000 });
    } catch (error) {
      console.error(await page.locator("body").innerText());
      throw error;
    }
    if (await page.getByText(/Approval blocked/i).count()) {
      console.error(await page.locator("body").innerText());
      throw new Error("approval was blocked");
    }
    await page.waitForTimeout(1800);
  });
}

async function hideRealHosts(page) {
  await page.evaluate(() => {
    const rewrite = (value) => value.replace(/https?:\/\/(?:www\.)?linkedin\.com\/\S*/gi, "example.test/ada");
    const walk = (node) => {
      if (node.nodeType === Node.TEXT_NODE && /linkedin\.com/i.test(node.nodeValue || "")) {
        node.nodeValue = rewrite(node.nodeValue || "");
      }
      for (const child of node.childNodes) walk(child);
    };
    walk(document.body);
    for (const el of document.querySelectorAll("[placeholder]")) {
      const hint = el.getAttribute("placeholder") || "";
      if (/linkedin\.com/i.test(hint)) el.setAttribute("placeholder", rewrite(hint));
    }
  });
}

async function moveToHire(page) {
  const stages = ["To Assess", "To Interview", "Shoot", "QM", "To Hire"];
  for (const label of stages) {
    const radio = page.getByRole("radio", { name: label }).first();
    if (await radio.count() && await radio.isVisible()) await radio.click();
    else {
      await page.getByRole("button", { name: "More..." }).click();
      await page.getByRole("menuitem", { name: label }).click();
    }
    await page.getByRole("radio", { name: label, checked: true }).waitFor({ timeout: 30000 });
  }
}

async function recordOdoo(browser) {
  if (!ODOO) throw new Error("Set ODOO_BASE_URL to the Odoo hire-gate demo");
  const password = process.env.ARIA_E2E_PASSWORD;
  if (!password) throw new Error("Set ARIA_E2E_PASSWORD; it is not stored in the repo");
  const context = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT } });
  const page = await context.newPage();
  await page.goto(`${ODOO}/web/login`, { waitUntil: "domcontentloaded" });
  await page.locator('input[name="login"]').fill("recruiter@example.test");
  await page.locator('input[name="password"]').fill(password);
  await page.locator('button[type="submit"]').click();
  await page.waitForSelector(".o_main_navbar, .o_home_menu, .o_web_client", { timeout: 120000 });
  await page.goto(`${ODOO}/odoo/recruitment-applications`, { waitUntil: "domcontentloaded" });
  await page.getByText("Ada Example", { exact: true }).first().click();
  await page.getByRole("radio", { name: "To Rate" }).or(page.getByRole("radio", { name: "To Hire" })).first().waitFor({ timeout: 60000 });
  const already = page.getByRole("radio", { name: "To Hire", checked: true });
  if (!(await already.count())) await moveToHire(page);
  const storage = await context.storageState();
  await context.close();

  const dir = path.join(ROOT, "tmp", "readme-video", "hired-gate");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const recording = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT },
    storageState: storage,
    recordVideo: { dir, size: { width: WIDTH, height: HEIGHT } },
  });
  await recording.addInitScript(() => {
    const rewrite = (value) => value.replace(/https?:\/\/(?:www\.)?linkedin\.com\/\S*/gi, "example.test/ada");
    const scrub = () => {
      const walk = (node) => {
        if (node.nodeType === Node.TEXT_NODE && /linkedin\.com/i.test(node.nodeValue || "")) {
          node.nodeValue = rewrite(node.nodeValue || "");
        }
        for (const child of node.childNodes) walk(child);
      };
      if (document.body) walk(document.body);
    };
    new MutationObserver(scrub).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    scrub();
  });
  const shot = await recording.newPage();
  await shot.goto(`${ODOO}/odoo/recruitment-applications`, { waitUntil: "domcontentloaded" });
  await shot.getByText("Ada Example", { exact: true }).first().click();
  await shot.getByRole("radio", { name: "To Hire", checked: true }).waitFor({ timeout: 60000 });
  await hideRealHosts(shot);
  await shot.waitForTimeout(900);
  const hired = shot.getByRole("radio", { name: "Hired" }).first();
  if (await hired.count() && await hired.isVisible()) await hired.click();
  else {
    await shot.getByRole("button", { name: "More..." }).click();
    await shot.getByRole("menuitem", { name: "Hired" }).click();
  }
  await shot.getByRole("dialog").filter({ hasText: "contract" }).waitFor({ timeout: 30000 });
  await hideRealHosts(shot);
  await shot.waitForTimeout(1600);
  const video = shot.video();
  await recording.close();
  toGif(await video.path(), path.join(MEDIA, "hired-gate.gif"), "0.9");
}

const mode = process.argv.includes("--odoo") ? "odoo" : process.argv.includes("--next") ? "next" : "all";
mkdirSync(MEDIA, { recursive: true });
const browser = await launch();
try {
  if (mode === "next" || mode === "all") await recordNext(browser);
  if (mode === "odoo" || (mode === "all" && ODOO)) await recordOdoo(browser);
} finally {
  await browser.close();
}
console.log("recorded", mode);
