/* ============================================================================
   tests/fail-closed.mts
   Area: Supabase fail-closed guard (audit Gate 9 — server auth must not fail open).

   `assertSupabaseConfiguredInProd()` reads `isProduction` / `supabaseEnabled`,
   which are module-level consts evaluated once from env at import time. tsx caches
   the module (query-string cache-busting does NOT re-evaluate it), so each
   scenario must run in a FRESH process with the env pre-set before the import.

   This file is its own worker: the orchestrator re-spawns it once per scenario
   (via the exact node + tsx entry that launched it) with scenario env, and the
   worker reports whether the guard threw.
   ========================================================================== */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SELF = fileURLToPath(import.meta.url);

/* ---- Worker branch: fresh module evaluation with scenario env applied. ---- */
if (process.env.__FAILCLOSED_WORKER) {
  // Explicit `.ts` extension: in a tsx-spawned child the dynamic import is
  // resolved by Node's ESM resolver first, which needs the real file name.
  const cfg = await import("../src/lib/supabase/config.ts");
  let threw = false;
  try {
    cfg.assertSupabaseConfiguredInProd();
  } catch {
    threw = true;
  }
  // Machine-readable line for the orchestrator: outcome | enabled | production.
  process.stdout.write(`__FC|${threw ? "THROW" : "NOTHROW"}|${cfg.supabaseEnabled}|${cfg.isProduction}`);
  process.exit(0);
}

/* ---- Orchestrator branch. ---- */
let pass = 0,
  fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

type Probe = { threw: boolean; enabled: boolean; prod: boolean };

/** Run the guard in a fresh process with `over` applied on top of the current
    env (an `undefined` value deletes the key). */
function probe(over: Record<string, string | undefined>): Probe {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const [k, v] of Object.entries(over)) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }
  env.__FAILCLOSED_WORKER = "1";
  // Register tsx as a loader directly (tsx's documented, Node-version-safe entry
  // point: https://tsx.is/node — works identically regardless of how *this*
  // process was launched or which Node minor version is running). Re-using
  // process.argv[1] instead is fragile: its exact resolved form depends on the
  // Node version and how tsx's own CLI bootstraps itself, which silently broke
  // in CI (Node 20) while passing locally (Node 22).
  const r = spawnSync(process.execPath, ["--import", "tsx", SELF], { env, encoding: "utf8" });
  const out = (r.stdout || "").trim();
  const m = out.match(/__FC\|(THROW|NOTHROW)\|(true|false)\|(true|false)/);
  if (!m) {
    throw new Error(
      `fail-closed worker produced no result (status=${r.status}) stdout=${JSON.stringify(out)} stderr=${r.stderr}`,
    );
  }
  return { threw: m[1] === "THROW", enabled: m[2] === "true", prod: m[3] === "true" };
}

const NO_SB = { NEXT_PUBLIC_SUPABASE_URL: undefined, NEXT_PUBLIC_SUPABASE_ANON_KEY: undefined };
const WITH_SB = {
  NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key-value",
};

/* THE security regression: production + Supabase disabled must FAIL CLOSED. */
const prodDisabled = probe({ NODE_ENV: "production", ...NO_SB });
ok("scenario sanity: prod+disabled is production & supabase disabled", prodDisabled.prod === true && prodDisabled.enabled === false);
ok("production + supabase DISABLED fails closed (throws — no open DEMO fallback)", prodDisabled.threw === true);

/* The guard must NOT over-deny: production + configured is allowed. */
const prodEnabled = probe({ NODE_ENV: "production", ...WITH_SB });
ok("scenario sanity: prod+enabled is production & supabase enabled", prodEnabled.prod === true && prodEnabled.enabled === true);
ok("production + supabase ENABLED is allowed (does not throw)", prodEnabled.threw === false);

/* Non-production keeps the open DEMO mode (no throw) — guard is conditional. */
const devDisabled = probe({ NODE_ENV: "development", ...NO_SB });
ok("development + supabase disabled allows DEMO mode (does not throw)", devDisabled.threw === false);

const testDisabled = probe({ NODE_ENV: "test", ...NO_SB });
ok("test env + supabase disabled does not throw (only production fails closed)", testDisabled.threw === false);

const studioPage = readFileSync(new URL("../src/app/studio/page.tsx", import.meta.url), "utf8");
ok(
  "Studio treats non-2xx or ok:false agent-spec responses as unavailable, not empty",
  /!res\.ok\s*\|\|\s*json\.ok\s*!==\s*true/.test(studioPage) && studioPage.includes("setAvailability(\"unavailable\")"),
);
ok(
  "Studio keeps 200 ok:true [] as a valid empty state",
  studioPage.includes("setSpecs(json.specs ?? [])") && studioPage.includes("setAvailability(\"ready\")"),
);
ok(
  "Studio create is disabled while the page is unavailable",
  /disabled=\{[^}]*availability\s*!==\s*"ready"/s.test(studioPage),
);
ok(
  "Studio create fails closed before mutating when unavailable",
  studioPage.indexOf('if (availability !== "ready")') >= 0 &&
    studioPage.indexOf("return;", studioPage.indexOf('if (availability !== "ready")')) <
      studioPage.indexOf("setSaving(true)", studioPage.indexOf('if (availability !== "ready")')),
);
ok(
  "Studio unavailable state is accessible and retryable",
  studioPage.includes('role="alert"') && studioPage.includes("Retry loading agents") && studioPage.includes("aria-describedby"),
);

console.log(`RESULT fail-closed: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
