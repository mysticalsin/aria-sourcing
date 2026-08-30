/**
 * Settings accordion / deep-link resolution — keeps one section open per tab
 * and maps Outreach Accounts hashes to the Integrations section.
 */
import assert from "node:assert/strict";
import {
  SETTINGS_HASH_TO_SECTION,
  SETTINGS_N_TO_TAB,
  resolveSettingsOpenSection,
  settingsDefaultSectionForTab,
  settingsHeaderId,
  settingsNeighborSection,
  settingsPanelId,
  settingsSectionFromHash,
  settingsSectionId,
  settingsSectionsForTab,
  settingsTabFromHash,
} from "../src/lib/settings-accordion.ts";

assert.deepEqual(settingsSectionsForTab("ai"), ["14", "15", "16", "17", "19"]);
assert.equal(settingsDefaultSectionForTab("ai"), "14");
assert.equal(settingsDefaultSectionForTab("integrations"), "04");
assert.equal(settingsSectionsForTab("integrations").length, 1);
assert.deepEqual(settingsSectionsForTab("fleet"), ["03", "06", "09", "18"]);

assert.equal(settingsSectionFromHash("email-connections-panel"), "04");
assert.equal(settingsSectionFromHash("#linkedin-outreach-stack"), "04");
assert.equal(settingsSectionFromHash("microsoft365-stack"), "04");
assert.equal(settingsSectionFromHash("integrations-catalog"), "04");
assert.equal(settingsSectionFromHash("settings-section-19"), "19");
assert.equal(settingsSectionFromHash("nope"), null);

assert.equal(settingsTabFromHash("email-connections-panel"), "integrations");
assert.equal(settingsTabFromHash("settings-section-19"), "ai");
assert.equal(SETTINGS_HASH_TO_SECTION["email-connections-panel"], "04");
assert.equal(SETTINGS_N_TO_TAB["19"], "ai");
assert.equal(settingsSectionId("04"), "settings-section-04");
assert.equal(settingsHeaderId("14"), "settings-header-14");
assert.equal(settingsPanelId("14"), "settings-panel-14");

assert.equal(
  resolveSettingsOpenSection({ tab: "integrations", hash: "email-connections-panel" }),
  "04",
);
assert.equal(
  resolveSettingsOpenSection({ tab: "ai", hash: "settings-section-19" }),
  "19",
);
assert.equal(
  resolveSettingsOpenSection({ tab: "ai", hash: "email-connections-panel" }),
  "14",
  "hash for another tab falls back to first section on current tab",
);
assert.equal(
  resolveSettingsOpenSection({ tab: "fleet", currentOpen: "09" }),
  "09",
);
assert.equal(
  resolveSettingsOpenSection({ tab: "fleet", currentOpen: "14" }),
  "03",
  "open section from another tab is discarded",
);
assert.equal(resolveSettingsOpenSection({ tab: "compliance" }), "02");
assert.equal(
  resolveSettingsOpenSection({ tab: "ai", sessionOpen: "19" }),
  "19",
  "session restores when no hash/current",
);
assert.equal(
  resolveSettingsOpenSection({ tab: "ai", hash: "settings-section-16", sessionOpen: "19" }),
  "16",
  "hash beats session",
);
assert.equal(
  resolveSettingsOpenSection({ tab: "ai", sessionOpen: "03" }),
  "14",
  "off-tab session ignored",
);

assert.equal(settingsNeighborSection("ai", "14", "next"), "15");
assert.equal(settingsNeighborSection("ai", "15", "next"), "16");
assert.equal(settingsNeighborSection("ai", "19", "next"), "14", "wraps");
assert.equal(settingsNeighborSection("ai", "14", "prev"), "19", "wraps up");
assert.equal(settingsNeighborSection("ai", "15", "first"), "14");
assert.equal(settingsNeighborSection("ai", "15", "last"), "19");
assert.equal(settingsNeighborSection("integrations", "04", "next"), "04");

console.log("settings-accordion: ok");
