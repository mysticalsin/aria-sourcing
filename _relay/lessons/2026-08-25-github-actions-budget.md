# Lesson — GitHub Actions budget can fail every check with empty jobs

**Date:** 2026-08-25  
**Source:** PR #24 CI — 14 red checks, ~3s each, empty step lists  
**Tags:** #ci #github-actions #budget #false-negative

## What happened

All PR checks failed with annotation: "The job was not started because an Actions budget is preventing further use." No test or typecheck output. Root cause was billing/minutes, not application code.

## What to do next time

1. For mass failures under ~5s with empty steps, read `gh run view --json jobs` / check annotations before debugging product code.
2. Avoid `push: branches: ["**"]` plus `pull_request` on the same SHA — doubles Actions spend.
3. After budget restore, re-run failed workflows; do not treat budget annotations as product regressions.

## Files / commands

- `gh run view <id> --json jobs,conclusion`
- `.github/workflows/ci.yml`, `.github/workflows/codeql.yml`
