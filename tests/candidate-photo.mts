import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { candidatePhotoUrl } from "../src/lib/candidate-photo";
import { candidateFromPayload } from "../src/lib/candidate-payload";

test("remote candidate photos are dropped so the UI uses initials", () => {
  for (const raw of [
    "https://cdn.example.test/photo.jpg",
    "http://cdn.example.test/x.jpg",
    "https://evil.example/pixel.gif",
    "data:image/png;base64,AAAA",
    "javascript:alert(1)",
    "",
    null,
    42,
  ]) {
    assert.equal(candidatePhotoUrl(raw), "", String(raw).slice(0, 60));
  }
});

test("stored candidate payloads do not keep a remote photo", () => {
  const base = { id: "cand_1", campaignId: "camp_1", name: "Ada Lovelace" };
  assert.equal(candidateFromPayload({ ...base, avatarUrl: "https://cdn.example.test/photo.jpg" })?.avatarUrl, undefined);
  assert.equal(candidateFromPayload({ ...base, avatarUrl: "https://evil.example/p.gif" })?.avatarUrl, undefined);
});

test("the CSP does not allow a third-party image host", () => {
  const config = readFileSync(new URL("../next.config.mjs", import.meta.url), "utf8");
  assert.match(config, /"img-src 'self' data: blob:"/);
});
