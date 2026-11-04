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

test("JSON-shaped bodies under simple or missing media types are rejected", () => {
  for (const contentType of [null, "text/plain", "application/x-www-form-urlencoded", "multipart/form-data"]) {
    assert.equal(
      classifySameOriginJsonRequest(request("https://aria.example", contentType)),
      "unsupported_media_type",
    );
  }
});

test("compliance mutations use the shared request boundary", () => {
  const compliance = readFileSync(new URL("../src/app/api/compliance/suppress/route.ts", import.meta.url), "utf8");
  assert.match(compliance, /classifySameOriginJsonRequest/);
  for (const source of [compliance]) {
    assert.match(source, /unsupported_media_type/);
    assert.match(source, /unsupported_media_type" \? 415 : 403/);
  }
});

test("Docker bind address: the Host the browser addressed wins over nextUrl", () => {
  // HOSTNAME=0.0.0.0 makes Next build nextUrl from the bind address.
  const docker = (origin: string, headers: Record<string, string>) => {
    const request = { headers: new Headers({ "Content-Type": "application/json", Origin: origin, ...headers }), nextUrl: { origin: "http://0.0.0.0:3000" } };
    return classifySameOriginJsonRequest(request);
  };
  const local = { Host: "localhost:3000", "X-Forwarded-Host": "localhost:3000", "X-Forwarded-Proto": "http" };
  assert.equal(docker("http://localhost:3000", local), "ok");
  assert.equal(docker("http://127.0.0.1:3000", { Host: "127.0.0.1:3000" }), "ok");
  assert.equal(docker("https://aria.example", { Host: "app:3000", "X-Forwarded-Host": "aria.example", "X-Forwarded-Proto": "https" }), "ok");
  for (const origin of ["http://evil.example", "https://localhost:3000", "http://localhost:3001", "null"]) {
    assert.equal(docker(origin, local), "cross_origin_request");
  }
  assert.equal(docker("http://localhost:3000", { Host: "bad host" }), "cross_origin_request");
});

test("sourcing routes use the shared origin check, not nextUrl.origin", () => {
  for (const route of [
    "source/route.ts",
    "source/campaign/route.ts",
    "source/enrich/route.ts",
    "sourcing-agent/route.ts",
    "sourcing-learning/feedback/route.ts",
    "careers/route.ts",
  ]) {
    const source = readFileSync(new URL(`../src/app/api/${route}`, import.meta.url), "utf8");
    assert.match(source, /isSameOriginRequest\(req\)/, route);
    assert.doesNotMatch(source, /nextUrl\.origin/, route);
  }
});
