#!/bin/bash
# Shared release authority for owner-run Fly production scripts.
#
# The scripts that source this file are emergency owner-run surfaces. They are
# allowed to exist only when bound to an exact reviewed Git SHA, a clean working
# tree, an explicit app-naming confirmation, and a local non-secret receipt.

aria_prod_guard_die() {
  echo "ERROR: $*" >&2
  exit 1
}

aria_join_by_comma() {
  local IFS=,
  printf '%s' "$*"
}

aria_require_reviewed_production_release() {
  local operation="$1"
  shift || aria_prod_guard_die "usage: aria_require_reviewed_production_release <operation> <app> [app...]"
  [ "$#" -gt 0 ] || aria_prod_guard_die "at least one target Fly app is required"

  local target_apps expected_confirmation supplied_confirmation resolved_sha checked_sha drift
  target_apps="$(aria_join_by_comma "$@")"
  ARIA_RELEASE_SHA="${ARIA_RELEASE_SHA:-}"

  [[ "$ARIA_RELEASE_SHA" =~ ^[0-9a-f]{40}$ ]] \
    || aria_prod_guard_die "ARIA_RELEASE_SHA must be an exact lowercase 40-character Git SHA"
  command -v git >/dev/null 2>&1 || aria_prod_guard_die "git is required"
  resolved_sha="$(git rev-parse --verify --quiet "${ARIA_RELEASE_SHA}^{commit}")" \
    || aria_prod_guard_die "ARIA_RELEASE_SHA is not resolvable in this checkout"
  checked_sha="$(git rev-parse HEAD)" || aria_prod_guard_die "could not read the checked-out Git SHA"
  [ "$checked_sha" = "$resolved_sha" ] \
    || aria_prod_guard_die "checked-out SHA does not match ARIA_RELEASE_SHA"
  drift="$(git status --porcelain --untracked-files=all)" \
    || aria_prod_guard_die "could not inspect working-tree drift"
  [ -z "$drift" ] || aria_prod_guard_die "working tree must be clean before production mutation"

  expected_confirmation="aria-production-release-v1:${operation}:${ARIA_RELEASE_SHA}:${target_apps}"
  supplied_confirmation="${ARIA_PROD_DEPLOY_CONFIRM:-}"
  # Interactive prompt only when a real TTY is usable. Never let a broken
  # /dev/tty short-circuit into a cryptic I/O error instead of the confirm hint.
  if [ -z "$supplied_confirmation" ] && [ -t 0 ] && [ -r /dev/tty ] && [ -w /dev/tty ]; then
    if printf 'Type %s to mutate Fly production app(s) %s at %s: ' \
      "$expected_confirmation" "$target_apps" "$ARIA_RELEASE_SHA" > /dev/tty 2>/dev/null; then
      IFS= read -r supplied_confirmation < /dev/tty || supplied_confirmation=""
    fi
  fi
  [ "$supplied_confirmation" = "$expected_confirmation" ] \
    || aria_prod_guard_die "ARIA_PROD_DEPLOY_CONFIRM must equal: $expected_confirmation"

  local receipt_path receipt_dir receipt_tmp confirmed_at operator_user operator_uid operator_host safe_operation
  confirmed_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  operator_user="$(id -un 2>/dev/null || printf 'unknown')"
  operator_uid="$(id -u 2>/dev/null || printf 'unknown')"
  operator_host="$(hostname 2>/dev/null || printf 'unknown')"
  safe_operation="$(printf '%s' "$operation" | tr -c 'A-Za-z0-9_.-' '-')"
  receipt_path="${ARIA_PROD_DEPLOY_RECEIPT_PATH:-}"
  if [ -z "$receipt_path" ]; then
    receipt_dir="${TMPDIR:-/tmp}/aria-prod-release-receipts"
    receipt_path="${receipt_dir}/${safe_operation}-${ARIA_RELEASE_SHA}-${confirmed_at}.json"
  fi
  receipt_dir="$(dirname "$receipt_path")"
  mkdir -p "$receipt_dir" || aria_prod_guard_die "could not create release receipt directory"
  receipt_tmp="$(mktemp "${receipt_dir}/.receipt.XXXXXX")" \
    || aria_prod_guard_die "could not create release receipt"

  export \
    ARIA_PROD_RELEASE_OPERATION="$operation" \
    ARIA_PROD_RELEASE_TARGET_APPS="$target_apps" \
    ARIA_PROD_RELEASE_RESOLVED_SHA="$resolved_sha" \
    ARIA_PROD_RELEASE_CHECKED_SHA="$checked_sha" \
    ARIA_PROD_RELEASE_CONFIRMED_AT="$confirmed_at" \
    ARIA_PROD_RELEASE_OPERATOR_USER="$operator_user" \
    ARIA_PROD_RELEASE_OPERATOR_UID="$operator_uid" \
    ARIA_PROD_RELEASE_OPERATOR_HOST="$operator_host" \
    ARIA_PROD_RELEASE_CONFIRMATION="$expected_confirmation" \
    ARIA_PROD_DEPLOY_RECEIPT_PATH="$receipt_path"

  node - "$receipt_tmp" <<'NODE'
const fs = require("node:fs");
const receiptPath = process.argv[2];
const targetApps = process.env.ARIA_PROD_RELEASE_TARGET_APPS.split(",").filter(Boolean);
const receipt = {
  schemaVersion: 1,
  status: "reviewed-production-mutation-authorized",
  operation: process.env.ARIA_PROD_RELEASE_OPERATION,
  targetApps,
  releaseSha: process.env.ARIA_RELEASE_SHA,
  resolvedSha: process.env.ARIA_PROD_RELEASE_RESOLVED_SHA,
  checkedSha: process.env.ARIA_PROD_RELEASE_CHECKED_SHA,
  confirmedAt: process.env.ARIA_PROD_RELEASE_CONFIRMED_AT,
  confirmation: process.env.ARIA_PROD_RELEASE_CONFIRMATION,
  operator: {
    user: process.env.ARIA_PROD_RELEASE_OPERATOR_USER,
    uid: process.env.ARIA_PROD_RELEASE_OPERATOR_UID,
    host: process.env.ARIA_PROD_RELEASE_OPERATOR_HOST,
  },
};
fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
NODE
  mv "$receipt_tmp" "$receipt_path" || aria_prod_guard_die "could not finalize release receipt"
  chmod 600 "$receipt_path" || aria_prod_guard_die "could not restrict release receipt permissions"
  echo "Release authority receipt: $receipt_path"
}
