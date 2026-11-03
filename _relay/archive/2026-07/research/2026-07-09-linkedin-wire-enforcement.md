# LinkedIn wire enforcement evidence

Date: 2026-07-09
Scope: focused production safety slice, not a declaration that the full ARIA platform is production-ready.

## Problem verified

`/api/outreach/send` accepted `channel: "LinkedIn"`, skipped the WhatsApp/SMS branch, then entered the email delivery path. The client UI used an assisted-manual workflow, but a direct API caller could still cause the wrong delivery path to run.

## Change

- `src/lib/linkedin-policy.ts` now exposes `getOutboundChannelPolicy(channel)`.
- The policy returns a manual-only refusal for LinkedIn and permits the other validated channels.
- `src/app/api/outreach/send/route.ts` invokes that policy immediately after body validation, before mode checks, approval checks, database claims, or providers.
- A LinkedIn request now receives HTTP 409 with `status: "manual-required"`.
- `tests/linkedin-policy.mts` proves the policy decision and the route's structural wire boundary.
- `package.json` includes `tests/linkedin-policy.mts` in `npm test`.

## TDD evidence

RED, before production changes:

```text
FAIL: outbound policy exposes a delivery decision
FAIL: outreach route imports outbound channel policy
FAIL: outreach route returns manual-required before a provider path for LinkedIn
RESULT linkedin-policy: 12 passed, 3 failed
```

GREEN, after the minimal change:

```text
RESULT linkedin-policy: 18 passed, 0 failed
```

## Verification run and read

| Check | Result |
| --- | --- |
| `git diff --check` | Passed, no whitespace errors |
| `npm run typecheck` | Passed |
| `tests/linkedin-policy.mts` | 18 passed, 0 failed |
| `tests/outreach-guardrails.mts` | 13 passed, 0 failed |
| `tests/dispatch-outbound.mts` | 21 passed, 0 failed |
| `npm test` | Passed, including the LinkedIn policy suite |
| `npm run lint` | Exit 0 with 13 pre-existing warnings outside this slice |
| `npm run build` | Passed; one existing Turbopack tracing warning through the Obscura launcher |

## Compliance boundary

- LinkedIn stays assisted-manual unless a separately approved official LinkedIn integration and entitlement are verified.
- No LinkedIn scraping, login handling, browser automation, credential collection, automated InMail, or platform-evasion behavior is in scope.
- Do not use LinkedIn-origin data for automated candidate scoring, screening, or LLM prompting without a separately verified contractual basis and policy review.

## Remaining blockers before full production acceptance

1. WhatsApp needs channel-specific consent proof, opt-out enforcement, approved-template selection outside the 24-hour service window, and a real controlled wire test. A free-form cold message must not be treated as a supported production path.
2. Flowise remains an unhosted sidecar/proxy integration. The current Studio opens the external editor and no sidecar deployment or end-to-end Flowise test exists.
3. The user-facing Run Aria panel is still synthetic rather than driving the persisted agent runtime.
4. Agent run persistence needs a required, validated `spec_id`, insert-error handling, resume behavior, and an end-to-end caller.
5. The full platform acceptance test remains owned by Tony and has not run against a deployed environment.

## Worktree note

The repository contained unrelated modified and untracked files before this slice. Nothing was staged or committed, so those changes remain untouched.
