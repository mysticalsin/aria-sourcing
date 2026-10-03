import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { classifySameOriginJsonRequest } from "../src/lib/api/same-origin-json";

function request(origin: string | null, contentType: string | null, requestOrigin = "https://aria.example") {
  const headers = new Headers();
  if (origin !== null) headers.set("Origin", origin);
  if (contentType !== null) headers.set("Content-Type", contentType);
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

test("Fly bind origin is not trusted; public tenant Origin is", () => {
  assert.equal(
    classifySameOriginJsonRequest(
      request("http://0.0.0.0:3000", "application/json", "http://0.0.0.0:3000"),
    ),
    "cross_origin_request",
  );
  assert.equal(
    classifySameOriginJsonRequest(
      request("https://aria-mantu-app.fly.dev", "application/json", "http://0.0.0.0:3000"),
    ),
    "ok",
  );
});

test("JSON-shaped bodies under simple or missing media types are rejected", () => {
  for (const contentType of [null, "text/plain", "application/x-www-form-urlencoded", "multipart/form-data"]) {
    assert.equal(
      classifySameOriginJsonRequest(request("https://aria.example", contentType)),
      "unsupported_media_type",
    );
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
