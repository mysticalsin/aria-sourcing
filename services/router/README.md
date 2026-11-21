# Aria model router

Token-saving router for Aria. A request is answered from a content-addressed cache, then from deterministic rules and templates, then from a small model, and from a big model only when confidence is below the threshold or the request is a shortlisted draft.

This module is its own Go module. Providers in this tree are fakes. They do not open network connections and they do not take API keys. `ANTHROPIC_API_KEY` is consulted only as a name: the value is reduced to a boolean and dropped, and it is never written to a log.

## State machine

```
received -> rule_hit -> cached -> done
received -> small_model -> cached -> done
received -> small_model -> escalated -> big_model -> cached -> done
received -> cached -> done                  (cache hit; provider not called)
received -> budget_exceeded                 (hard stop before a model call)
received -> small_model -> escalated -> budget_exceeded
```

`done` and `budget_exceeded` are terminal. A shortlisted draft records `small_model -> escalated` and does not call the small provider.

## Budgets

Hard stops, checked before the provider is called, and reserved under a lock so concurrent calls cannot overshoot:

- per-run, daily, and monthly token ceilings
- daily and monthly USD ceilings

Rules and cache hits spend nothing. A refused call is not cached. The per-run counter resets on `BeginRun`. The daily counter resets at the next UTC day, the monthly counter at the next UTC month. In-flight reservations count against the ceiling, including a hold that commits after `BeginRun`.

The ledger is in memory only. It is not the agents usage file (`var/ai-usage.json` or `AI_USAGE_FILE`). A process restart clears it. Prices for the small tier (claude-haiku-5-5) and the big tier (claude-sonnet-5-5) are copied from `src/lib/ai/model-prices.json`, which `src/lib/ai/usage.ts` reads.

`LoadConfig` reads only these names:

| Name | Use |
|---|---|
| `ANTHROPIC_API_KEY` | presence only; fake providers either way |
| `AI_DAILY_BUDGET_USD` | daily USD hard stop (default 6) |
| `AI_MONTHLY_BUDGET_USD` | monthly USD hard stop (default 30) |

Parse errors name the variable and do not include the raw string.

## Targets

From the build plan (§16), measured on a 1,000-request synthetic workload (cold pass for tiers, exact replay for the cache):

| | Target | This module |
|---|---|---|
| Rules | ≥ 80% | 80% |
| Small model | ≤ 15% | 15% |
| Big model | ≤ 5% | 5% |
| Cache on a repeat run | ≥ 70% (plan text says ≥ 75%) | 100% on an exact replay |
| Average tokens | ≤ 250 over imported candidates | 100 (rules 0, small 300, big 1,100) |

Latency targets in the plan (QC p50 0.6s / p95 1.5s, intake p50 1.2s / p95 3s, cached draft p50 2s / p95 5s) are model time. `go test -bench` measures router overhead on fakes, which has to stay well under those.

## Tests

```
cd services/router
go test ./...
go test -bench . -benchmem
```

Named tests:

- `Test_test_rules_tier_handles_deterministic_cases_without_model`
- `Test_test_escalates_only_below_confidence_threshold`
- `Test_test_cache_hit_skips_provider`
- `Test_test_budget_hard_stop`
- `Test_test_synthetic_workload_hit_rates`
