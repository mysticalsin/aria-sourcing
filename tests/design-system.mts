import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ApprovalPanel } from "../src/design-system/approval/approval-panel.tsx";
import {
  DEFAULT_SEND_MODE,
  EXACT_OUTREACH_MESSAGE,
  EXACT_OUTREACH_SHA256,
  sendModeCopy,
} from "../src/design-system/approval/message.ts";
import { sparklinePaths } from "../src/design-system/charts/sparkline.tsx";
import {
  applyCandidateFilters,
  EMPTY_FILTERS,
  SYNTHETIC_CANDIDATES,
} from "../src/design-system/data/synthetic.ts";
import { DesignSystemGallery } from "../src/design-system/gallery/gallery.tsx";
import { INVENTORY } from "../src/design-system/inventory.ts";
import { KpiCard } from "../src/design-system/kpi/kpi-card.tsx";
import { OdooSyncChip } from "../src/design-system/odoo/sync-chip.tsx";
import { HIRED_BLOCK, STAGES, placeCandidate, stepCandidate } from "../src/design-system/pipeline/stages.ts";
import { contrastPairs, contrastRatio } from "../src/design-system/tokens.ts";
import { themeVariableCss } from "../src/design-system/theme/variables.ts";

test("contrast pairs clear WCAG text and UI floors", () => {
  for (const pair of contrastPairs) {
    const ratio = contrastRatio(pair.foreground, pair.background);
    assert.ok(
      ratio + 1e-9 >= pair.minimum,
      `${pair.theme} ${pair.name} is ${ratio.toFixed(2)}:1, floor ${pair.minimum}:1`,
    );
  }
});

test("theme variables publish every palette colour", () => {
  const css = themeVariableCss();
  assert.match(css, /--ds-bg:#101011/);
  assert.match(css, /\.aria-ds\[data-theme="light"\]\{--ds-bg:#F4F1F6/);
  assert.equal(css.includes("#2c4bff"), false);
});

test("structural CSS does not change shape between themes", () => {
  const css = readFileSync(new URL("../src/design-system/theme/aria-ds.css", import.meta.url), "utf8");
  assert.equal(css.includes("data-theme") && css.includes("border-radius"), true);
  assert.equal(/\[data-theme="light"\][^{]*\{[^}]*border-radius/.test(css), false);
});

test("default send mode is manual and the exact text is hashed", () => {
  assert.equal(DEFAULT_SEND_MODE, "human");
  assert.match(sendModeCopy("human"), /Manual is the default/);
  assert.match(sendModeCopy("auto_qc"), /Live send stays off/);
  assert.equal(createHash("sha256").update(EXACT_OUTREACH_MESSAGE).digest("hex"), EXACT_OUTREACH_SHA256);
  const html = renderToStaticMarkup(createElement(ApprovalPanel));
  assert.match(html, /<input type="radio" name="aria-send-mode" checked="" value="human"\/>/);
  assert.equal(html.includes('value="auto_qc"'), true);
  assert.equal(/value="auto_qc"[^>]*checked|checked="" value="auto_qc"/.test(html), false);
  assert.ok(html.includes(EXACT_OUTREACH_MESSAGE.split("\n")[0] ?? ""));
  assert.ok(html.includes(EXACT_OUTREACH_SHA256));
  assert.match(html, /role="radiogroup"/);
  assert.match(html, /aria-label="Sending mode"/);
});

test("pipeline arrows move one stage and refuse Hired", () => {
  assert.deepEqual(
    STAGES.map((stage) => stage.label),
    ["To Rate", "To Assess", "To Interview", "Shoot", "QM", "To Hire", "Hired"],
  );
  assert.deepEqual(stepCandidate("to-rate", 1), { stage: "to-assess", blocked: null });
  assert.deepEqual(stepCandidate("to-rate", -1), { stage: "to-rate", blocked: null });
  const blocked = stepCandidate("to-hire", 1);
  assert.equal(blocked.stage, "to-hire");
  assert.equal(blocked.blocked, HIRED_BLOCK);
  assert.equal(placeCandidate("qm", "hired").blocked, HIRED_BLOCK);
  assert.deepEqual(placeCandidate("hired", "hired"), { stage: "hired", blocked: null });
});

test("filters and addresses stay synthetic", () => {
  for (const person of SYNTHETIC_CANDIDATES) {
    assert.match(person.email, /@example\.test$/);
    assert.equal(person.email.includes("@gmail."), false);
  }
  const french = applyCandidateFilters(SYNTHETIC_CANDIDATES, { ...EMPTY_FILTERS, language: "FR" });
  assert.ok(french.length > 0);
  assert.ok(french.every((person) => person.language === "FR"));
  const strong = applyCandidateFilters(SYNTHETIC_CANDIDATES, { ...EMPTY_FILTERS, score: "80+" });
  assert.ok(strong.every((person) => person.score >= 80));
  assert.equal(applyCandidateFilters(SYNTHETIC_CANDIDATES, { ...EMPTY_FILTERS, stage: "shoot", language: "PT" }).length, 0);
});

test("gallery markup is keyboard-labelled and keeps the inventory", () => {
  const html = renderToStaticMarkup(createElement(DesignSystemGallery));
  assert.match(html, /aria-keyshortcuts="ArrowLeft ArrowRight"/);
  assert.match(html, /Skip to the gallery/);
  assert.match(html, /data-theme="dark"/);
  for (const stage of ["To Rate", "To Assess", "To Interview", "Shoot", "QM", "To Hire", "Hired"]) {
    assert.ok(html.includes(stage), stage);
  }
  for (const label of ["Synced to Odoo", "Odoo sync pending", "Odoo sync failed", "Only in Aria"]) {
    assert.ok(html.includes(label), label);
  }
  for (const row of INVENTORY) {
    assert.ok(html.includes(row.component), row.component);
  }
  assert.match(html, /role="status"/);
  assert.match(html, /scope="col"/);
  const chip = renderToStaticMarkup(createElement(OdooSyncChip, { status: "failed" }));
  assert.match(chip, /Odoo sync failed/);
  assert.match(chip, /aria-hidden="true"/);
});

test("KPI loading state is named and a sparkline needs two points", () => {
  const loading = renderToStaticMarkup(createElement(KpiCard, { label: "In To Rate", value: 1, loading: true }));
  assert.match(loading, /role="status"/);
  assert.match(loading, /Loading In To Rate/);
  assert.equal(sparklinePaths([4], 96, 36), null);
  assert.ok(sparklinePaths([4, 8, 6], 96, 36)?.line.startsWith("M "));
});

test("the gallery is not mounted by the product navigation", () => {
  const nav = readFileSync(new URL("../src/components/app/nav.ts", import.meta.url), "utf8");
  const shell = readFileSync(new URL("../src/components/app/app-shell.tsx", import.meta.url), "utf8");
  const providers = readFileSync(new URL("../src/components/app/providers.tsx", import.meta.url), "utf8");
  const proxy = readFileSync(new URL("../src/proxy.ts", import.meta.url), "utf8");
  assert.equal(nav.includes("/design-system"), false);
  assert.equal(shell.includes('pathname.startsWith("/design-system")'), true);
  assert.equal(providers.includes('pathname.startsWith("/design-system")'), true);
  assert.equal(proxy.includes('path.startsWith("/design-system")'), true);
  assert.equal(providers.includes('pathname.startsWith("/careers")'), true);
});
