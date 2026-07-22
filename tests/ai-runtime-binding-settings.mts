import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const panelPath = new URL("../src/components/settings/ai-runtime-bindings-panel.tsx", import.meta.url);
const settingsPath = new URL("../src/app/settings/page.tsx", import.meta.url);

test("Settings exposes normalized runtime authority separately from planning metadata", async () => {
  const [panel, settings] = await Promise.all([
    readFile(panelPath, "utf8"),
    readFile(settingsPath, "utf8"),
  ]);

  assert.match(settings, /AiRuntimeBindingsPanel/);
  assert.match(settings, /planning metadata/i);
  assert.match(settings, /execution authority/i);
  assert.match(panel, /\/api\/admin\/ai-runtime-bindings/);
  assert.match(panel, /A second workspace admin is required/i);
  assert.match(panel, /different workspace admin/i);
});

test("runtime mutations use same-origin credentials and retry-safe idempotency keys", async () => {
  const panel = await readFile(panelPath, "utf8");

  assert.match(panel, /credentials:\s*["']same-origin["']/);
  assert.match(panel, /["']Idempotency-Key["']/);
  assert.match(panel, /crypto\.randomUUID\(\)/);
  assert.match(panel, /stageOperationRef/);
  assert.match(panel, /activationOperationRef/);
});

test("runtime model inputs accept exact values and only suggest saved model names", async () => {
  const panel = await readFile(panelPath, "utf8");

  assert.match(panel, /useSavedModels/);
  assert.match(panel, /model\.modelName/);
  assert.match(panel, /Enter exact provider model ID/i);
  assert.doesNotMatch(panel, /claude-(?:opus|sonnet)-\d/);
  assert.doesNotMatch(panel, /gpt-\d/);
});
