You are the Integrator building Rock 3 in the MSourcing/ARIA Next.js repo. workspace-write. Build EXACTLY this.

Objective: stop the app from fabricating "connected" status for integrations that have zero backing code. Every integration card whose `real` is false must present as not-configured, not as a live connection with a fake lastSync timestamp.

Read first: (understand before editing)
- src/lib/integrations.ts — the integration card list. Cards with `real: false` currently set `status: 'connected'` and a fabricated `lastSync: isoHoursBefore(...)`. Examples cited by an earlier audit: Twenty CRM (~74-83), SMART ATS (~85-94), Knight M (~96-105), My Referral (~107-116), n8n (~143-152), Cal.com (~154-163), the Apollo/Hunter/Clearbit enrichment card (~177-186), Slack/Telegram (~199-208), Resume Matcher (~30-39). Also testConnection (~222-245) returns ok:true/0ms for these without a network call.
- src/lib/dispatch-outbound.ts — where a dry-run (unconfigured provider) outcome currently increments stats.failed (~356-365). An unconfigured provider is NOT a delivery failure.
- Look at how the UI reads these (search components/settings for integrations) so your status change doesn't break rendering. Do not change any card whose `real` is genuinely true (e.g. a card backed by real code).

Build:
1. In src/lib/integrations.ts, for every card with `real: false` (mock/roadmap placeholders): set `status: 'not_configured'` and `lastSync: null` (or the codebase's null-equivalent). Keep `real: false`. Do NOT invent new fields. Preserve cards with real:true unchanged.
2. Make testConnection for a real:false card return a clearly non-connected result (e.g. ok:false or a 'not_configured' shape) instead of a fabricated ok:true/0ms — matching how the code already signals unconfigured elsewhere.
3. In dispatch-outbound.ts, distinguish an unconfigured/dry-run provider outcome from a real failure so it does not increment stats.failed; add/[use] a distinct counter or status (e.g. stats.unconfigured or skipped) consistent with the existing DispatchStats shape.

Constraints: (what must NOT change) do not alter any card with real:true. Do not weaken or delete any existing test (tests/dispatch-outbound.mts must still pass). Do not change the wire/guardrail behavior — only the reported status/counters. No new dependencies.

Proof: create tests/integrations-honesty.mts (a `.mts` file in the tests/ style: ok()/RESULT lines, `if (fail>0) process.exitCode=1`). It must assert: NO card in integrations.ts has (`real === false` AND `status === 'connected'`); every real:false card has lastSync null; and at least one real:true card is unchanged (still connected if it was). The Visionary runs it with `npx tsx tests/integrations-honesty.mts` outside the sandbox — you only need it to compile and `npx tsc --noEmit` clean.

Stop when: `npx tsc --noEmit` is clean, tests/integrations-honesty.mts exists and encodes the assertions above, and no real:false card claims status 'connected'. Do not delete, skip, weaken, or narrow tests to make the goal pass.

Report: end with the tsc result and, on the final line alone, exactly one of:
ROCK-STATUS: DONE
ROCK-STATUS: BLOCKED <one-line reason>
