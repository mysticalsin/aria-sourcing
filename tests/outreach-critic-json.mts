import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCriticJson } from "../src/lib/outreach-critic-json";

test("parseCriticJson accepts clean JSON", () => {
  const row = parseCriticJson('{"pass":true,"score":88,"reasons":["specific opener"]}');
  assert.deepEqual(row, { pass: true, score: 88, reasons: ["specific opener"] });
});

test("parseCriticJson tolerates markdown fences and trailing commas", () => {
  const row = parseCriticJson('```json\n{"pass": true, "score": 91, "reasons": ["ok"],}\n```');
  assert.equal(row?.pass, true);
  assert.equal(row?.score, 91);
  assert.deepEqual(row?.reasons, ["ok"]);
});

test("parseCriticJson coerces stringly pass/score", () => {
  const row = parseCriticJson('Here you go: {"pass":"true","score":"76","reasons":"warm tone"}');
  assert.equal(row?.pass, true);
  assert.equal(row?.score, 76);
  assert.deepEqual(row?.reasons, ["warm tone"]);
});

test("parseCriticJson returns null for non-JSON prose", () => {
  assert.equal(parseCriticJson("Looks fine to me."), null);
});
