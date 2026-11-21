import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ChannelPicker } from "../src/components/dashboard/channel-picker.tsx";
import { CommandCenterStats } from "../src/components/dashboard/command-center-stats.tsx";
import { OutreachComposer } from "../src/components/dashboard/outreach-composer.tsx";
import { CHANNEL_CATALOG } from "../src/lib/channel-catalog.ts";
import { exactTextDigest } from "../src/lib/exact-text.ts";
import { buildSeedState } from "../src/lib/seed.ts";
import { selectInterviewsThisWeek } from "../src/lib/quick-stats.ts";
import { SEED_NOW } from "../src/lib/utils.ts";

const RECRUITER = "Approving sends exactly this text. Any edit needs a new approval.";
const PLAIN_RISK = "Off by default. Uses LinkedIn outside its official tools, which may get the account restricted.";

test("an edited subject changes the approval digest and voids the previous approval", async () => {
  const mod = await import("../src/lib/exact-text.ts");
  assert.equal(typeof mod.displayedExactApproval, "function");
  const saved = mod.displayedExactApproval({
    subject: "Hello",
    body: "Body",
    savedSubject: "Hello",
    savedBody: "Body",
  });
  const edited = mod.displayedExactApproval({
    subject: "Hello there",
    body: "Body",
    savedSubject: "Hello",
    savedBody: "Body",
  });
  assert.equal(saved.voided, false);
  assert.equal(edited.voided, true);
  assert.notEqual(saved.digest, edited.digest);
  assert.equal(edited.digest, exactTextDigest("Hello there", "Body"));
  assert.notEqual(edited.digest, exactTextDigest("Hello", "Body"));
});

test("card and glass box approve through one function that does not deliver LinkedIn", async () => {
  const mod = await import("../src/lib/approve-displayed-outreach.ts");
  assert.equal(typeof mod.approveDisplayedOutreach, "function");
  const order: string[] = [];
  const out = await mod.approveDisplayedOutreach({
    messageId: "m1",
    displayedSubject: "Edited",
    displayedBody: "New body",
    savedSubject: "Saved",
    savedBody: "Old body",
    updateDraft: (patch: { subject: string; body: string }) => {
      order.push(`draft:${patch.subject}:${patch.body}`);
    },
    approve: async (id: string) => {
      order.push(`approve:${id}`);
      return { allowed: true, blockers: [], warnings: [] };
    },
  });
  assert.equal(out.voided, true);
  assert.deepEqual(order, ["draft:Edited:New body", "approve:m1"]);
  const source = readFileSync("src/lib/approve-displayed-outreach.ts", "utf8");
  assert.doesNotMatch(source, /deliverOnLinkedIn/);
  for (const path of [
    "src/components/outreach/outreach-message-card.tsx",
    "src/components/outreach/glass-box-panel.tsx",
  ]) {
    assert.match(readFileSync(path, "utf8"), /approveDisplayedOutreach\(/, path);
  }
});

test("synthetic interviews use the seed clock and 4 of 5 fall in that week", async () => {
  const mod = await import("../src/lib/quick-stats.ts");
  assert.equal(typeof mod.quickStatNow, "function");
  assert.equal(mod.quickStatNow({ synthetic: true }).toISOString(), SEED_NOW.toISOString());
  const seed = buildSeedState();
  const interviews = seed.bookings.map((booking) => ({ startTime: booking.startTime, status: booking.status }));
  assert.equal(interviews.length, 5);
  assert.equal(selectInterviewsThisWeek(interviews, mod.quickStatNow({ synthetic: true })), 4);
  assert.equal(selectInterviewsThisWeek(interviews, new Date("2026-11-21T00:00:00.000Z")), 0);
  const page = readFileSync("src/app/page.tsx", "utf8");
  assert.match(page, /quickStatNow\(/);
  assert.doesNotMatch(page, /now:\s*new Date\(\)/);
});

test("UTC week does not follow the local weekday", () => {
  const child = spawnSync(
    process.execPath,
    ["--import", "tsx", "tests/inspector-qa-week.mts"],
    { cwd: process.cwd(), env: { ...process.env, TZ: "Pacific/Auckland" }, encoding: "utf8" },
  );
  assert.equal(child.status, 0, child.stderr || child.stdout);
});

test("a missing stat source renders the unavailable mark", () => {
  const html = renderToStaticMarkup(
    createElement(CommandCenterStats, {
      source: { candidates: null, interviews: null, approvals: null, replies: null },
    }),
  );
  assert.equal((html.match(/data-unavailable="true"/g) ?? []).length, 6);
  assert.match(html, /—/);
});

test("the channel picker choice is wired to a draft channel", async () => {
  const mod = await import("../src/lib/channel-catalog.ts");
  assert.equal(typeof mod.outreachChannelForPicker, "function");
  assert.equal(mod.outreachChannelForPicker("email"), "Email");
  assert.equal(mod.outreachChannelForPicker("assisted-inmail"), "LinkedIn");
  assert.equal(mod.outreachChannelForPicker("heyreach"), null);
  assert.equal(mod.outreachChannelForPicker("linkedin-token"), null);
  const card = readFileSync("src/components/outreach/outreach-message-card.tsx", "utf8");
  assert.match(card, /onSelect=/);
  assert.match(card, /outreachChannelForPicker\(/);
});

test("approval proof uses recruiter language and hides the hash in a disclosure", () => {
  const digest = exactTextDigest("Role", "Hello Tomas.");
  const html = renderToStaticMarkup(
    createElement(OutreachComposer, {
      toName: "Tomas Ferreira",
      channelLabel: "Assisted Recruiter InMail",
      subject: "Role",
      exactText: "Hello Tomas.",
      digest,
      dirty: true,
    }),
  );
  assert.match(html, new RegExp(RECRUITER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(html, /<details[\s>]/);
  assert.match(html, new RegExp(`<details[\\s\\S]*${digest}[\\s\\S]*</details>`));
  assert.match(html, /min-h-11/);
});

test("channel caps end with a period and the off channels say the restriction in plain words", () => {
  for (const channel of CHANNEL_CATALOG) {
    assert.match(channel.cap, /per sender per day\.$/, channel.id);
  }
  for (const id of ["heyreach", "linkedin-token"] as const) {
    const channel = CHANNEL_CATALOG.find((item) => item.id === id);
    assert.equal(channel?.risk, PLAIN_RISK);
  }
  const html = renderToStaticMarkup(createElement(ChannelPicker, null));
  assert.match(html, /Off by default/);
  assert.doesNotMatch(html, /high ban risk|medium-high ban risk/);
});

test("success text on the soft green clears contrast, including the dark tokens", () => {
  const css = readFileSync("src/styles/globals.css", "utf8");
  assert.match(css, /\.dark\s*\{/);
  const light = contrastIn(css, ":root");
  const dark = contrastIn(css, ".dark");
  assert.ok(light >= 4.5, `light success contrast ${light}`);
  assert.ok(dark >= 4.5, `dark success contrast ${dark}`);
  const card = readFileSync("src/components/dashboard/metric-card.tsx", "utf8");
  assert.match(card, /max-\[420px\]:flex-col/);
});

function contrastIn(css: string, block: string): number {
  const start = css.indexOf(block);
  assert.ok(start >= 0, block);
  const slice = css.slice(start, css.indexOf("}", start));
  const success = hsl(slice, "--success");
  const soft = hsl(slice, "--success-soft");
  return contrast(success, soft);
}

function hsl(css: string, name: string): [number, number, number] {
  const match = css.match(new RegExp(`${name}:\\s*([0-9.]+)\\s+([0-9.]+)%\\s+([0-9.]+)%`));
  assert.ok(match, name);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function contrast(a: [number, number, number], b: [number, number, number]): number {
  const channel = (h: number, s: number, l: number) => {
    const sat = s / 100;
    const light = l / 100;
    const k = (n: number) => (n + h / 30) % 12;
    const amount = sat * Math.min(light, 1 - light);
    const f = (n: number) => light - amount * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return [f(0), f(8), f(4)].map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  };
  const lum = (rgb: number[]) => 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  const hi = Math.max(lum(channel(...a)), lum(channel(...b)));
  const lo = Math.min(lum(channel(...a)), lum(channel(...b)));
  return (hi + 0.05) / (lo + 0.05);
}
