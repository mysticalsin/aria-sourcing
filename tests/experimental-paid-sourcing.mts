import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("unhardened paid sourcing providers can never be enabled in production", () => {
  const config = read("src/lib/supabase/config.ts");
  assert.match(
    config,
    /experimentalPaidSourcingEnabled\s*=\s*!isProduction\s*&&\s*process\.env\.NEXT_PUBLIC_ENABLE_EXPERIMENTAL_PAID_SOURCING === "true"/,
  );
});

test("every Sillage and Seamless route fails closed before rate limits, secrets, or egress", () => {
  for (const path of [
    "src/app/api/source/sillage/start/route.ts",
    "src/app/api/source/sillage/status/route.ts",
    "src/app/api/source/seamless/search/route.ts",
    "src/app/api/source/seamless/research/route.ts",
    "src/app/api/source/seamless/research-status/route.ts",
  ]) {
    const source = read(path);
    const gate = source.indexOf("if (!experimentalPaidSourcingEnabled)");
    assert.ok(gate > 0, `${path} has the disabled-provider gate`);
    assert.ok(gate < source.indexOf("checkRateLimit("), `${path} gates before rate-limit or provider work`);
    assert.match(source.slice(gate, gate + 500), /status:\s*503/);
    assert.match(source.slice(gate, gate + 500), /Cache-Control.*no-store/);
  }
});

test("production UI does not expose unfinished Sillage or Seamless actions", () => {
  for (const path of [
    "src/components/candidates/source-sillage-dialog.tsx",
    "src/components/candidates/source-seamless-dialog.tsx",
  ]) {
    assert.match(read(path), /if \(!experimentalPaidSourcingEnabled \|\| !can\(role, "source"\)\) return null/);
  }
  assert.match(
    read("src/components/candidates/candidate-drawer.tsx"),
    /experimentalPaidSourcingEnabled && c\.sourcePlatform === "Seamless"/,
  );
});
