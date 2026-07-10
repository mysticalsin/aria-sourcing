You are the Integrator building release Rock R1 in the MSourcing repo. workspace-write. Owner standard: enterprise-ready, senior-dev-clear, no slop. This closes the LAST code blocker between "deployed" and "a pasted need gets fully worked" on a real (Supabase LIVE) deployment.

Objective: make fleet seats real server-side — a seat created in the UI must exist as an agent_seats row with a UUID id in live mode, so mailbox OAuth connect, domain verification, live email send, and calendar booking stop failing at the server gates; and make the first profile of a workspace an admin so a fresh tenant is usable without manual SQL.

Read first: (understand before editing)
- Finding (verified by a prior audit): nothing ever inserts into agent_seats; client seat IDs are non-UUID (e.g. seat_1); server gates that look up agent_seats by UUID therefore 400/fail: mailbox OAuth start (src/app/auth/google/route.ts seat_id), domain verify (/api/outreach/verify-domain), live send seat check (src/app/api/outreach/send/route.ts + dispatch), calendar event (/api/calendar/event). grep agent_seats across src/ + supabase/migrations/0002_fleet.sql (the "rw" RLS policy allows workspace members to insert).
- src/lib/store.ts fleet seat creation/update actions (search createSeat / addSeat / seats) — where client seats are born; how ids are generated.
- supabase/migrations/0001_init.sql ensure_workspace() (~89-127) — find-or-create workspace; profiles.role default 'member' (:24); the anti-escalation self-update policy (:53-68).
- src/lib/supabase/server.ts requireAdmin; src/lib/rbac.ts.
- Existing route patterns: src/app/api/keys/route.ts (auth-first, zod, rate-limit).

Build:
1. Server seat lifecycle: a small /api/fleet/seats route (POST create, PATCH update-mode, DELETE) — auth-first, RBAC manage_fleet, prodFailClosed, rate-limited, zod-validated. POST inserts into agent_seats (workspace-scoped) and returns the row's UUID id. In LIVE mode the store's seat-creation action calls this route and uses the SERVER's UUID as the seat id (demo mode keeps local ids — unchanged behavior). Seat updates that matter server-side (operator_email, mode) sync through PATCH.
2. Hydration: in LIVE mode, seats load from agent_seats (merge with workspace-state display fields; the agent_seats row is authoritative for id/operator_email/mode). Keep it minimal — do not rebuild the fleet UI.
3. First-user-admin: new migration supabase/migrations/0018_first_admin.sql — inside ensure_workspace(), when creating a NEW workspace, set the creating profile's role to 'admin' (only on workspace creation — never on join; do not weaken the anti-escalation policy). Include the CREATE OR REPLACE of the function with the change clearly commented.
4. Keep every existing gate intact (send/dispatch seat checks unchanged — they now simply find the row).

Constraints: (what must NOT change) no weakening of RBAC/RLS/anti-escalation; demo mode behavior unchanged; no UI redesign; no new deps; do not weaken or delete any existing test.

Proof: create tests/fleet-seats-server.mts using the fake-Supabase harness pattern (see tests/dispatch-outbound.mts): POST creates a workspace-scoped agent_seats row and returns a UUID; non-admin without manage_fleet is 403; live seat-creation path adopts the server UUID; migration 0018 file exists and contains role='admin' only in the workspace-creation branch (grep assertions on the SQL). The Visionary runs it + tsc outside the sandbox; you need `npx tsc --noEmit` clean.

Stop when: route + store wiring + hydration + migration 0018 + tests/fleet-seats-server.mts exist and tsc is clean. Do not delete, skip, weaken, or narrow tests to make the goal pass.

Report: give the tsc result. SHIP = built + tsc clean + test encodes the assertions; REVISE = blocked/incomplete (why).
End with EXACTLY one line, nothing after it: VERDICT: SHIP or VERDICT: REVISE
