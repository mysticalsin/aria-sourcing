# Runbook: Reconcile a stuck Apollo enrichment attempt

Version: 1.0
Last reviewed: 2026-07-13
Owner: ARIA production owner
Refresh cadence: quarterly and whenever the Apollo adapter or authority schema changes
Agent-executable: No. Provider evidence and the final state transition require a human administrator.

## Trigger

Use this runbook when the admin reconciliation queue contains either:

- an `in_progress` Apollo enrichment attempt whose two-minute lease expired; or
- an `ambiguous` attempt returned after an unknown provider outcome.

Do not use it for normal provider errors, missing Apollo configuration, invalid
confirmations, or quota rejections.

## Severity

P2. One target is blocked and a provider credit may have been consumed. Escalate
as P1 if repeated ambiguous outcomes suggest a provider, network, or ledger-wide
incident.

## Prerequisites

- [ ] ARIA administrator access in the affected workspace.
- [ ] Access to the approved Apollo administration and usage evidence surfaces.
- [ ] An approved incident or support case reference.
- [ ] A local evidence file that contains no API keys, session cookies, or unrelated candidate data.
- [ ] Bash or zsh, `jq`, a SHA-256 utility, and `curl` 7.76 or later installed.
- [ ] Human approval for the exact final resolution.
- [ ] The production incident roster names the ARIA production owner and contact route. The repository intentionally does not store personal contact details.

## Safety rules

- Never retry an ambiguous provider call.
- Never edit Apollo authority tables directly.
- Never refund or decrement the database quota.
- Never place an API key, session cookie, email address, or evidence contents in the case reference.
- If the evidence cannot prove the outcome, leave the attempt `ambiguous` and escalate.
- `release_no_charge` is allowed only when evidence proves Apollo was not called or charged.

## Steps

### Step 1: Create a private authenticated shell session

Command:

```bash
export ARIA_BASE_URL='https://aria-mantu-app.fly.dev'
umask 077
export ARIA_RUN_PARENT="${TMPDIR:-/tmp}"
ARIA_RUN_PARENT="${ARIA_RUN_PARENT%/}"
export ARIA_RUN_DIR="$(mktemp -d "$ARIA_RUN_PARENT/aria-apollo-reconcile.XXXXXX")"
cleanup_aria_reconciliation() {
  unset ARIA_COOKIE_HEADER VERIFIED_EMAIL
  case "${ARIA_RUN_DIR:-}" in
    "$ARIA_RUN_PARENT"/aria-apollo-reconcile.*)
      test -d "$ARIA_RUN_DIR" && rm -rf -- "$ARIA_RUN_DIR"
      ;;
  esac
  unset ARIA_RUN_DIR ARIA_RUN_PARENT
}
aria_sha256_file() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  elif command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    printf 'No SHA-256 utility is available.\n' >&2
    return 127
  fi
}
trap cleanup_aria_reconciliation EXIT
trap 'cleanup_aria_reconciliation; exit 130' HUP INT TERM
read -r -s -p 'ARIA auth cookie pairs (name=value; name=value): ' ARIA_COOKIE_HEADER
printf '\n'
printf 'header = "Cookie: %s"\n' "$ARIA_COOKIE_HEADER" > "$ARIA_RUN_DIR/curl-auth.conf"
unset ARIA_COOKIE_HEADER
```

Copy every `sb-auth-token` cookie pair from the approved administrator browser
session. This includes `.0`, `.1`, or later chunks when present. Do not include
the `Cookie:` header name. Expected: no cookie value is printed and the private
working directory has mode `700`.

Verify:

```bash
test -s "$ARIA_RUN_DIR/curl-auth.conf"
test "$(find "$ARIA_RUN_DIR" -prune -perm 0700 -print)" = "$ARIA_RUN_DIR"
test "$(find "$ARIA_RUN_DIR/curl-auth.conf" -prune -perm 0600 -print)" = "$ARIA_RUN_DIR/curl-auth.conf"
printf 'session-loaded\n'
```

Expected: `session-loaded`.

If failure: stop. Obtain a fresh administrator session through the approved login flow.

### Step 2: List the reconciliation queue

Command:

```bash
curl --fail-with-body --silent --show-error \
  --request POST "$ARIA_BASE_URL/api/admin/source/apollo/reconciliation" \
  --config "$ARIA_RUN_DIR/curl-auth.conf" \
  --header "Origin: $ARIA_BASE_URL" \
  --header 'Content-Type: application/json' \
  --data '{"operation":"list","limit":20}' \
  | tee "$ARIA_RUN_DIR/queue.json"
```

Expected: HTTP success and JSON with `ok: true`, `items`, and `nextCursor`.

Verify:

```bash
jq -e '.ok == true and (.items | type == "array")' \
  "$ARIA_RUN_DIR/queue.json"
jq -r '.items[] | [.attemptId,.status,.version,.providerExternalId,.createdAt,.leaseExpiresAt] | @tsv' \
  "$ARIA_RUN_DIR/queue.json"
```

Expected: the first command prints `true`. The second prints one tab-separated row per queued attempt and never prints an email, nonce, idempotency key, or secret.

If failure: stop. Do not query the database directly.

### Step 3: Bind the exact attempt and evidence

Copy the selected values from Step 2 and the approved case system:

```bash
export ATTEMPT_ID='<attemptId from Step 2>'
export EXPECTED_VERSION='<version from Step 2>'
export PROVIDER_LOOKUP_ID='<providerExternalId from Step 2>'
export CASE_REFERENCE='<approved bounded case reference>'
export EVIDENCE_FILE='<absolute path to the approved evidence file>'
export EVIDENCE_SHA256="$(aria_sha256_file "$EVIDENCE_FILE")"
```

Verify:

```bash
printf '%s\n' "$ATTEMPT_ID" | grep -Eq '^[0-9a-fA-F-]{36}$'
printf '%s\n' "$EXPECTED_VERSION" | grep -Eq '^[1-9][0-9]*$'
printf '%s\n' "$CASE_REFERENCE" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9._:/#-]{0,119}$'
printf '%s\n' "$EVIDENCE_SHA256" | grep -Eq '^[0-9a-f]{64}$'
```

Expected: all four commands exit 0 and print nothing.

If failure: correct the copied value or evidence file before continuing.

### Step 4: Quarantine an expired in-progress lease

Run this step only when Step 2 reported `in_progress`. It does not resolve the provider outcome.

Command:

```bash
jq -n \
  --arg attemptId "$ATTEMPT_ID" \
  --argjson expectedVersion "$EXPECTED_VERSION" \
  --arg caseReference "$CASE_REFERENCE" \
  --arg evidenceSha256 "$EVIDENCE_SHA256" \
  '{operation:"reconcile",attemptId:$attemptId,expectedVersion:$expectedVersion,resolution:"quarantine_stale",caseReference:$caseReference,evidenceSha256:$evidenceSha256}' \
| curl --fail-with-body --silent --show-error \
    --request POST "$ARIA_BASE_URL/api/admin/source/apollo/reconciliation" \
    --config "$ARIA_RUN_DIR/curl-auth.conf" \
    --header "Origin: $ARIA_BASE_URL" \
    --header 'Content-Type: application/json' \
    --data-binary @- \
| tee "$ARIA_RUN_DIR/quarantine-receipt.json"
```

Expected: `ok: true`, `status: "ambiguous"`, `version` incremented by one, and a non-empty `eventId`.

Verify:

```bash
jq -e '.ok == true and .status == "ambiguous" and (.eventId | type == "string")' \
  "$ARIA_RUN_DIR/quarantine-receipt.json"
export EXPECTED_VERSION="$(jq -r '.version' "$ARIA_RUN_DIR/quarantine-receipt.json")"
```

If response code is `APOLLO_ATTEMPT_NOT_STALE`, stop and wait for the lease. If it is `APOLLO_RECONCILIATION_CONFLICT`, return to Step 2 and re-investigate the latest version.

### Step 5: Determine the provider outcome

Action: in the approved Apollo administration surface, use
`$PROVIDER_LOOKUP_ID`, the UTC claim time, and the case evidence to establish exactly one result:

1. Apollo returned the verified email.
2. Apollo completed with no email.
3. Apollo was not called or charged.
4. The outcome remains uncertain.

Expected: the case contains the evidence file digest and a human-approved result.

Decision:

- Result 1: use `complete_found` in Step 6.
- Result 2: use `complete_not_found` in Step 6.
- Result 3: use `release_no_charge` in Step 6.
- Result 4: stop. Leave the attempt ambiguous and escalate.

Recompute the digest after the investigation and human evidence update:

```bash
export EVIDENCE_SHA256="$(aria_sha256_file "$EVIDENCE_FILE")"
printf '%s\n' "$EVIDENCE_SHA256" | grep -Eq '^[0-9a-f]{64}$'
```

Expected: the digest now covers the final evidence approved for Step 6.

### Step 6: Record the approved terminal resolution

HITL: REQUIRED. A human administrator must approve the exact action before this request. Terminal resolutions are immutable.

For a verified email:

```bash
read -r -s -p 'Verified email: ' VERIFIED_EMAIL
printf '\n'
printf '%s' "$VERIFIED_EMAIL" > "$ARIA_RUN_DIR/verified-email.txt"
unset VERIFIED_EMAIL
export RESOLUTION='complete_found'
jq -n \
  --arg attemptId "$ATTEMPT_ID" \
  --argjson expectedVersion "$EXPECTED_VERSION" \
  --arg resolution "$RESOLUTION" \
  --rawfile email "$ARIA_RUN_DIR/verified-email.txt" \
  --arg caseReference "$CASE_REFERENCE" \
  --arg evidenceSha256 "$EVIDENCE_SHA256" \
  '{operation:"reconcile",attemptId:$attemptId,expectedVersion:$expectedVersion,resolution:$resolution,email:$email,caseReference:$caseReference,evidenceSha256:$evidenceSha256}' \
  > "$ARIA_RUN_DIR/resolution-request.json"
```

For a verified no-match or verified no-charge release:

```bash
export RESOLUTION='<complete_not_found or release_no_charge>'
jq -n \
  --arg attemptId "$ATTEMPT_ID" \
  --argjson expectedVersion "$EXPECTED_VERSION" \
  --arg resolution "$RESOLUTION" \
  --arg caseReference "$CASE_REFERENCE" \
  --arg evidenceSha256 "$EVIDENCE_SHA256" \
  '{operation:"reconcile",attemptId:$attemptId,expectedVersion:$expectedVersion,resolution:$resolution,caseReference:$caseReference,evidenceSha256:$evidenceSha256}' \
  > "$ARIA_RUN_DIR/resolution-request.json"
```

Submit the prepared request:

```bash
curl --fail-with-body --silent --show-error \
  --request POST "$ARIA_BASE_URL/api/admin/source/apollo/reconciliation" \
  --config "$ARIA_RUN_DIR/curl-auth.conf" \
  --header "Origin: $ARIA_BASE_URL" \
  --header 'Content-Type: application/json' \
  --data-binary @"$ARIA_RUN_DIR/resolution-request.json" \
  | tee "$ARIA_RUN_DIR/resolution-receipt.json"
```

Expected: `ok: true`; `status` is `completed` or `cancelled`; `version` increments once; `eventId` is the append-only audit receipt.

Remove the temporary email immediately after the terminal request:

```bash
rm -f -- "$ARIA_RUN_DIR/verified-email.txt"
```

Verify:

```bash
jq -e '.ok == true and (.status == "completed" or .status == "cancelled") and (.eventId | type == "string")' \
  "$ARIA_RUN_DIR/resolution-receipt.json"
```

If failure: do not retry blindly. `APOLLO_RECONCILIATION_CONFLICT` means another transition won. Return to Step 2 and compare the case evidence with the current state.

### Step 7: Verify removal from the unresolved queue

Command:

```bash
curl --fail-with-body --silent --show-error \
  --request POST "$ARIA_BASE_URL/api/admin/source/apollo/reconciliation" \
  --config "$ARIA_RUN_DIR/curl-auth.conf" \
  --header "Origin: $ARIA_BASE_URL" \
  --header 'Content-Type: application/json' \
  --data '{"operation":"list","limit":50}' \
  | jq -e --arg attemptId "$ATTEMPT_ID" \
      '[.items[] | select(.attemptId == $attemptId)] | length == 0'
```

Expected: `true`.

For `cancelled`, a later enrichment remains blocked until an operator performs a new prepare and confirmation through the normal candidate drawer. No runbook step calls Apollo.

### Step 8: Remove local sensitive material

Command:

```bash
cleanup_aria_reconciliation
trap - EXIT HUP INT TERM
```

Expected: command exits 0.

Verify:

```bash
test -z "${ARIA_RUN_DIR:-}" && printf 'session-cleared\n'
```

Expected: `session-cleared`.

## Rollback

There is no rollback after a terminal reconciliation event. The ledger is
append-only and terminal states are immutable by design.

Before Step 6, rollback means stop and leave the attempt ambiguous. If Step 6
records the wrong verified outcome, do not edit SQL or issue another provider
call. Escalate with the attempt ID, event ID, case reference, UTC timestamp, and
evidence digest.

## Escalation

Escalate when:

- the outcome remains uncertain;
- the same request returns a state conflict after one fresh investigation;
- more than one ambiguous attempt appears in 15 minutes;
- the audit receipt is missing;
- an administrator cannot access the queue; or
- any secret or unrelated candidate data entered the evidence file.

Contact: the ARIA production owner and security on-call listed in the approved
incident roster. Their exact names and contact channels were not present in the
repository when this runbook was written. Production release must not proceed
until the roster is configured.

Include:

- attempt ID and event ID, if present;
- request ID and UTC timestamps;
- case reference and evidence SHA-256, not the evidence contents;
- the step and exact typed error code;
- whether Apollo usage evidence showed a call or charge.

## Agent failure handling

An agent may collect non-sensitive diagnostics and draft the request, but it
must not execute Step 6. If an agent stalls, loops, or sees an output mismatch:

1. stop after the current read-only step;
2. write the attempt ID, last completed step, typed error code, and recommended next action to `_relay/HANDOFF.md`;
3. do not retry a provider call or a reconciliation mutation; and
4. hand control to the human administrator named in the incident roster.

## Verification history

- v1.0, 2026-07-13: initial runbook. Route contract tests and disposable PostgreSQL state-machine tests are automated. Independent staging execution is still required before production release.
