# Meeting 001 — Same Page, Round 1/5
Method: co-founder (V: claude · I: codex gpt-5.5) · Round 1/5
Verdict: REVISE (7 findings)
Verdict trend: REVISE

## Findings (Codex, read-only) + IDS disposition
- F1 [BLOCKER] :90 Fly registry per-app; no nested repos → SOLVE: role→Fly-app repo map, tags `registry.fly.io/<app>:<tag>`; shared adapter/redis land in ONE app repo, both manifest roles point to it (cross-app pull is expected).
- F2 [HIGH] :219 flyctl auth docker 5-min expiry → SOLVE: re-auth (`flyctl auth docker`) immediately before each phase (bake, wrapper-bake, per-image sign, trivy).
- F3 [HIGH] operator.mjs:267 cosign/trivy no registry creds → SOLVE: explicit `cosign login` + trivy TRIVY_USERNAME/PASSWORD before verify; document operator-side auth precondition.
- F4 [HIGH] :306 digest emission invents repo → SOLVE: read exact pushed repo@digest from `--metadata-file` JSON (image.name/containerimage.digest), never reconstruct.
- F5 [HIGH] :370 deerflow provenance duplicates values → SOLVE: single source of truth: read the 7 identities from operator-core DEERFLOW_RUNTIME_IDENTITY / bake args; assert equality before attest.
- F6 [MED] :403 CI never runs operator validator → SOLVE: after signing, run the operator's own verify commands (or a vendored validator) as fail-fast self-check incl sourceCommit + deerflow params.
- F7 [MED] :239 `${ref%%:*}` corrupts port/digest refs → SOLVE: parse repo/digest with a proper OCI-ref parser, not shell trimming.

Phase score: 72/100 — deductions: registry-path blocker, auth-lifetime gaps, provenance drift — improvement applied: role→app repo map + metadata-driven digest capture folded into revision brief.
