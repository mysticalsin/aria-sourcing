import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  classifySameOriginJsonRequest,
  requestSameOrigin,
} from "../src/lib/api/same-origin-json";

function request(
  origin: string | null,
  contentType: string | null,
  requestOrigin = "https://aria.example",
  extraHeaders: Record<string, string> = {},
) {
  const headers = new Headers();
  if (origin !== null) headers.set("Origin", origin);
  if (contentType !== null) headers.set("Content-Type", contentType);
  for (const [key, value] of Object.entries(extraHeaders)) headers.set(key, value);
  return { headers, nextUrl: { origin: requestOrigin } };
}

test("same-origin JSON with parameters is accepted", () => {
  assert.equal(
    classifySameOriginJsonRequest(request("https://aria.example", "application/json; charset=utf-8")),
    "ok",
  );
});

test("hostile, missing, lookalike, and downgraded origins fail closed", () => {
  for (const origin of [
    null,
    "https://evil.example",
    "https://aria.example.evil.test",
    "http://aria.example",
    "https://aria.example:444",
  ]) {
    assert.equal(
      classifySameOriginJsonRequest(request(origin, "application/json")),
      "cross_origin_request",
    );
  }
});

test("JSON-shaped bodies under simple or missing media types are rejected", () => {
  for (const contentType of [null, "text/plain", "application/x-www-form-urlencoded", "multipart/form-data"]) {
    assert.equal(
      classifySameOriginJsonRequest(request("https://aria.example", contentType)),
      "unsupported_media_type",
    );
  }
});

test("Fly HOSTNAME=0.0.0.0 nextUrl still accepts the public browser Origin via Host/forwarded", () => {
  // Production bind address leaks into nextUrl.origin; browsers still send the public host.
  const brokenNextUrl = "https://0.0.0.0:3000";
  const publicOrigin = "https://aria-mantu-app.fly.dev";
  assert.equal(
    requestSameOrigin(
      request(publicOrigin, "application/json", brokenNextUrl, {
        Host: "aria-mantu-app.fly.dev",
        "X-Forwarded-Host": "aria-mantu-app.fly.dev",
        "X-Forwarded-Proto": "https",
      }),
    ),
    true,
  );
  assert.equal(
    classifySameOriginJsonRequest(
      request(publicOrigin, "application/json", brokenNextUrl, {
        Host: "aria-mantu-app.fly.dev",
      }),
    ),
    "ok",
  );
  assert.equal(
    requestSameOrigin(
      request("https://evil.example", "application/json", brokenNextUrl, {
        Host: "aria-mantu-app.fly.dev",
      }),
    ),
    false,
  );
});

test("sourcing-agent routes use requestSameOrigin (not raw nextUrl.origin equality)", () => {
  const agent = readFileSync(new URL("../src/app/api/sourcing-agent/route.ts", import.meta.url), "utf8");
  const ack = readFileSync(new URL("../src/app/api/sourcing-agent/ack/route.ts", import.meta.url), "utf8");
  const source = readFileSync(new URL("../src/app/api/source/route.ts", import.meta.url), "utf8");
  for (const body of [agent, ack, source]) {
    assert.match(body, /requestSameOrigin/);
    assert.doesNotMatch(body, /origin !== req\.nextUrl\.origin/);
    assert.doesNotMatch(body, /origin === req\.nextUrl\.origin/);
  }
});

test("changed spec and compliance mutations use the shared request boundary", () => {
  const specs = readFileSync(new URL("../src/app/api/agents/specs/route.ts", import.meta.url), "utf8");
  const compliance = readFileSync(new URL("../src/app/api/compliance/suppress/route.ts", import.meta.url), "utf8");
  const memories = readFileSync(new URL("../src/app/api/agents/memories/route.ts", import.meta.url), "utf8");
  assert.match(specs, /classifySameOriginJsonRequest/);
  assert.match(compliance, /classifySameOriginJsonRequest/);
  assert.match(memories, /classifySameOriginJsonRequest/);
  for (const source of [specs, compliance, memories]) {
    assert.match(source, /unsupported_media_type/);
    assert.match(source, /unsupported_media_type" \? 415 : 403/);
  }
});
