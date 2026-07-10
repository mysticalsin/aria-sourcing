Visionary here. You audited the Wave-2 asks read-only and returned VERDICT: APPROVED on feasibility with concrete seams. I've bound your seams + independent research (Databricks Statement Execution API mechanics verified against docs.databricks.com) into .rocket-fuel/PLAN-wave2.md with 5 rocks.

Attack PLAN-wave2.md read-only. Your default is REVISE; APPROVED must be earned. Focus:
1. Rock W1 (KPI truth): is "contacted = distinct candidates with a ledger send fact" the right canonical definition given demo-mode simulated sends land in the local ledger as 'sent' (store.ts:2497-2511)? How must demo/simulated ledger entries be handled so exec KPIs never count simulated sends as real? Name the exact discriminator available.
2. Rock W2 (WinRecord): is the field list complete and derivable at the createBookingFor commit seam? Is HermesState growth a risk (wins unbounded)? Where must the winlog.md export live so it never leaks candidate PII outside the app boundary?
3. Rock W3 (/exec): what auth/RBAC must gate an exec page in live mode (viewer role? admin?), and does anything in the plan risk shipping synthetic data into exec metrics in demo mode?
4. Rock W4 (Databricks): attack the route design — auth resolution (secret in api_keys but host/warehouse_id where?), SSRF posture (host is customer-supplied — must it pass the existing URL guard? private-network Databricks hosts?), and the no-auto-create human-confirm flow. Is a "Databricks" api_keys provider entry enough, or does this need a dedicated integration config?
5. Proof commands: every one decidable? Test names collide with anything existing?
6. Is the W1→(W2∥W4)→W3→W5 order right?

Greppable findings (blocker:/risk:/question:/nit:), severest first, then EXACTLY one final line:
VERDICT: APPROVED
or
VERDICT: REVISE
