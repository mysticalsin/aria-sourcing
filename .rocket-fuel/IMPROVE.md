# Kaizen ledger — rocket-fuel harness improvements (append-only)

## 2026-07-09 · G2 Same Page Meeting round 1 (pre-verdict) · score 55/100
Deductions: meeting round 1 failed to produce a verdict — codex 400'd on `reasoning.effort='max'` because `~/.codex/config.toml` is being actively rewritten (to gpt-5.6-sol / "ultra") by a background process. rf-codex.sh pinned the model but NOT the effort, so it inherited the poison. A driver that pins one hostile-config field but not the sibling field is half-hardened.
Improvement applied (before round 1 re-fires): added `EFFORT` var (RF_EFFORT env, default "high") to rf-codex.sh and injected `-c model_reasoning_effort` into doctor/start/resume. Logged as trap 13 in references/traps.md. Now every invocation pins both model and effort — no config default trusted for either.
