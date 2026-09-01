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

test("Fly product-host Origin is same-site when nextUrl is the [::] bind", () => {
  const headers = new Headers({
    origin: "https://aria-mantu-app.fly.dev",
    "content-type": "application/json",
    host: "[::]:3000",
    "x-forwarded-proto": "https",
    "x-forwarded-host": "aria-mantu-app.fly.dev",
  });
  assert.equal(
    classifySameOriginJsonRequest({
      headers,
      nextUrl: { origin: "http://[::]:3000" },
    }),
    "ok",
  );
  const publicHost = new Headers({
    origin: "https://aria-mantu-app.fly.dev",
    "content-type": "application/json",
    host: "aria-mantu-app.fly.dev",
    "x-forwarded-proto": "https",
  });
  assert.equal(
    classifySameOriginJsonRequest({
      headers: publicHost,
      nextUrl: { origin: "http://[::]:3000" },
    }),
    "ok",
  );
});

test("a real cross-origin stays rejected even when Fly bind nextUrl is [::]", () => {
  const headers = new Headers({
    origin: "https://attacker.test",
    "content-type": "application/json",
    host: "[::]:3000",
    "x-forwarded-proto": "https",
    "x-forwarded-host": "aria-mantu-app.fly.dev",
  });
  assert.equal(
    classifySameOriginJsonRequest({
      headers,
      nextUrl: { origin: "http://[::]:3000" },
    }),
    "cross_origin_request",
  );
  const forgedForward = new Headers({
    origin: "https://attacker.test",
    "content-type": "application/json",
    host: "aria-mantu-app.fly.dev",
    "x-forwarded-proto": "https",
    "x-forwarded-host": "attacker.test",
  });
  assert.equal(
    classifySameOriginJsonRequest({
      headers: forgedForward,
      nextUrl: { origin: "http://[::]:3000" },
    }),
    "cross_origin_request",
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
