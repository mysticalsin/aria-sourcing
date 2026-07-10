You are the Integrator co-founder. Read-only next-wave audit of the MSourcing/ARIA repo. The Owner's Wave-2 requirements plus a general refinement pass. Modify nothing.

Wave 1 just shipped (commit a3df79a..a95c193): real paste→candidates sourcing, encrypted Tavily key surface, candidate-disclosure security layer, honesty pass, mailbox OAuth docs, gate green (89 suites).

Wave-2 Owner requirements:
1. WINLOG: a winlog.md (or better: durable store + rendered view) auto-appended whenever a candidate ACCEPTS a meeting — structured pattern record (role, source platform, seniority, outreach channel, touches-to-yes, message traits) so the system can learn what works. Find where "candidate accepts / booking created / positive reply" events live today (bookings, replies classification, ledger) and the cleanest hook point.
2. EXEC DASHBOARD: a clean interactive top-management view — sourcing KPIs (sourced, contacted, open rate, reply rate, positive-reply rate, meetings booked, time-to-source, per-platform + per-campaign funnel) from REAL store/ledger data, zero synthetic. Find what metric data actually exists (outreach_ledger, activities, candidates, bookings), what's missing (opens tracking?), and which existing UI patterns (trust page, mission-control HUD, replay) to build on.
3. DATABRICKS: needs may originate in Databricks; integrate via MCP or the Databricks REST API (SQL Warehouse statement execution) so a query result can create a campaign through the existing intake. Keys via the encrypted api_keys surface. Assess: where's the cleanest seam (an /api/integrations/databricks route calling statement-execution, mapped into parseEmailAndJD-style intake)?
4. GENERAL REFINEMENT: after wave 1, what are the top 5 remaining production/enterprise defects in the repo worth fixing next (real bugs, weak seams, missing enforcement — not style)?

Report findings as greppable lines: `wave2: <area> — <recommended seam/design with file:line evidence>` and `refine: <defect with file:line>` — most valuable first. Be concrete; cite real files. No scope invention beyond the 4 areas.
End with EXACTLY one line, nothing after it:
VERDICT: APPROVED
or
VERDICT: REVISE
(Use APPROVED if the wave-2 asks are feasible on the current architecture; REVISE only if something is structurally blocked.)
