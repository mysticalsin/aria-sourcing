# Aria core

Rust workspace for the scoring, dedupe, approval-hash, and pipeline pieces of Aria. Go calls it in-process through a stable C ABI (`core/include/aria_core.h`), not gRPC. A batch of candidates is the unit of work, and the target is microseconds per candidate, so a network hop would cost more than the score.

The plan's interface decision is a `cdylib` plus `staticlib`. This crate builds both. The Go binding links the static library with cgo. Tests do not open sockets and use synthetic `@example.test` records only.

## Layout

| Path | Role |
| --- | --- |
| `crates/aria-scoring` | Port of `src/lib/scoring.ts` and `src/lib/geo-europe.ts`. Ranking is a suggestion. |
| `crates/aria-dedupe` | Profile identity, 90-day dedupe, transitive entity resolution. |
| `crates/aria-ledger` | SHA-256 of the canonical exact approval text. |
| `crates/aria-pipeline` | Named stages and guarded transitions. |
| `crates/aria-ffi` | C ABI (`libaria_core.a` and `libaria_core.so`). |
| `crates/aria-bench` | p95 of the shared 500-candidate fixture. |
| `go/aria` | cgo binding and tests. |
| `fixtures/` | Golden vectors generated from Michael's TypeScript. |

## Stages

These are Aria's own Odoo stage keys. They rebuild Smart's workflow. They are not an external SMARTX enum.

`to_rate` → `to_assess` → `to_interview` → `shoot` → `qm` → `to_hire` → `hired`

`hired` is terminal. It is reached only from `to_hire` when a non-empty contract id is attached and DNA (Mantu's ERP) has confirmed the contract is integrated. Otherwise the candidate stays in `to_hire`.

`rejected` and `withdrawn` are explicit transitions and require a non-empty reason. A match score is not an input to the machine. Nothing in scoring drops a candidate or selects `rejected`.

## Approval hash

The hash is SHA-256 over a length-prefixed encoding of the exact bytes of channel, recipient ref, subject, body, and notice version (`aria-approval-v1`). The body is not trimmed or case-folded. Any byte change, including an interior NUL, changes the hash.

## Commands

```bash
node core/scripts/gen-scoring-vectors.mjs
cargo test --manifest-path core/Cargo.toml --workspace
cargo build --release --manifest-path core/Cargo.toml -p aria-ffi
(cd core/go/aria && go test -count=1 .)
cargo bench --manifest-path core/Cargo.toml -p aria-scoring
cargo run --release --manifest-path core/Cargo.toml -p aria-bench --bin aria-p95
node core/scripts/bench-ts.mjs
```

Regenerate the fixtures only when `src/lib/scoring.ts` or `src/lib/rules.ts` changes. The parity tests read the committed JSON.

## Benchmark gate

`core/scripts/check-p95.mjs` compares the Rust batch p95 and the cgo batch p95 with the previous accepted CI sample. A result more than 10% slower fails the job. The first CI sample is stored and does not fail. The TypeScript p95 is recorded in the same job so the comparison is measured on one runner. It is not a fail line. `.github/workflows/core-rust.yml` also feeds the gated series to `benchmark-action/github-action-benchmark` (`customSmallerIsBetter`, alert and fail threshold 110%).
