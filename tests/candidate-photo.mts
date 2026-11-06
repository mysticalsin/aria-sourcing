import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { candidatePhotoUrl } from "../src/lib/candidate-photo";
import { candidateFromPayload } from "../src/lib/candidate-payload";

const photo = "https://media.licdn.com/dms/image/v2/C5603AQE/profile-displayphoto-shrink_400_400/0?e=1&v=beta&t=x";

test("only https photos on LinkedIn's media CDN are kept", () => {
  assert.equal(candidatePhotoUrl(photo), photo);
  for (const raw of [
    "http://media.licdn.com/x.jpg",
    "https://media.licdn.com.evil.test/x.jpg",
    "https://evil.example/pixel.gif",
    "https://user:pw@media.licdn.com/x.jpg",
    "https://media.licdn.com:8443/x.jpg",
    "data:image/png;base64,AAAA",
    "javascript:alert(1)",
    `https://media.licdn.com/${"a".repeat(2_000)}`,
    "",
    null,
    42,
  ]) {
    assert.equal(candidatePhotoUrl(raw), "", String(raw).slice(0, 60));
  }
});

test("stored candidate payloads keep a valid photo and drop a planted one", () => {
  const base = { id: "cand_1", campaignId: "camp_1", name: "Ada Lovelace" };
  assert.equal(candidateFromPayload({ ...base, avatarUrl: photo })?.avatarUrl, photo);
  assert.equal(candidateFromPayload({ ...base, avatarUrl: "https://evil.example/p.gif" })?.avatarUrl, undefined);
});

test("the CSP allows exactly the photo host the validator accepts", () => {
  const config = readFileSync(new URL("../next.config.mjs", import.meta.url), "utf8");
  assert.match(config, /"img-src 'self' data: blob: https:\/\/media\.licdn\.com"/);
});
