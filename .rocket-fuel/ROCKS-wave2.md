# ROCKS Wave 2 — approved 2026-07-10 (meeting rounds 013-015, VERDICT: APPROVED)
Order: W1 → W2 ∥ W4 → W3 → W5.

## Rock W1: Canonical real-send KPI truth  ✅ DONE (SHIP — metrics-canonical 21/0, scoring-metrics 160/0, HUD unified)
Owner: Integrator
Done means: one canonical derivation in metrics.ts — contacted = distinct candidates with OutreachMessage.dryRun===false AND sentAt!=null (or server-ledger terminal 'sent'); live KPIs exclude provenance:'synthetic'; globalKpis, campaign metrics, and mission-control HUD all consume it.
Proof: `npx tsx tests/metrics-canonical.mts` → exit 0 (fixture with 3 traps: demo dry-run 'sent', live approved-unsent, synthetic — all excluded; HUD/metrics agree)
Status: DONE

## Rock W2: WinRecord + private winlog  ✅ DONE (SHIP — winlog 22/0, PII in-app only)
Owner: Integrator
Done means: wins: WinRecord[] (cap 500 FIFO) appended atomically in createBookingFor's commit with real completed-send touchCount, winningChannel, timeToBookMs, triggeringReplyIntent, messageTraits (messageId→outreach join); feeds learnedParamsFor; private authenticated in-app view/download only.
Proof: `npx tsx tests/winlog.mts` → exit 0
Status: DONE

## Rock W3: /exec dashboard  ✅ DONE (SHIP — exec-dashboard 28/0, no fake data)
Owner: Integrator
Done means: read-only exec page over canonical W1 derivations (never re-implemented filters): KPI tiles, per-platform + per-campaign funnels, trends, wins feed, open-rate "not tracked yet"; viewer=aggregate PII-redacted, admin=export; demo banners itself; live excludes synthetic+dryRun.
Proof: `npx tsx tests/exec-dashboard.mts` → exit 0
Status: DONE

## Rock W4: Databricks intake (config → route)  ✅ DONE (SHIP — databricks-intake 15/0, SSRF guarded, no server mutation)
Owner: Integrator
Done means: DatabricksSettings ({host, warehouseId, authMode pat|m2m, clientId?, apiKeyId, needsQuery}); "Databricks" provider for the secret; /api/integrations/databricks/needs (RBAC, prodFailClosed, rate-limit, assertPublicUrl on host, M2M token cache or PAT, parameterized statement, INLINE JSON_ARRAY, PENDING→poll) returning PROPOSED ParsedIntake drafts only — server never creates campaigns.
Proof: `npx tsx tests/databricks-intake.mts` → exit 0 (incl. SSRF private-host rejection + no-server-mutation)
Status: DONE

## Rock W5: Gate + wiring
Owner: Integrator
Done means: all new tests in npm chain; full gate green.
Proof: `npx tsc --noEmit && npm test` exit 0; `npm run lint` 0 errors
Status: NOT STARTED
