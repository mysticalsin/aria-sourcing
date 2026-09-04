---
project: MSourcing / ARIA
shift: 98
agent: cursor-cloud
updated: 2026-09-04 UTC
status: linkedin-auto-vm-fleet-implemented
---

# Handoff — Shift 98

## Current state

- **Branch/PR:** `cursor/linkedin-auto-vm-fleet-b91d` → `integration/sourcing-enrichment-on-main`
- LinkedIn delivery **defaults to Automatic**; Manual is an explicit Settings toggle
- Automatic backends: **LinkedIn Vendor API** and **LinkedIn Browser Computer** (OpenBot-shaped isolated Chromium per seat)
- **Postgres `claim_contact` / `contact_leases`** (migration `0063`) is the sole who-contacted-whom authority
- Knowledge plane (`src/lib/knowledge-plane.ts`, `/api/knowledge/campaign`) is **read/write for recall only** — `knowledgePlaneMayGrantContactClaim()` is always `false`
- Fleet → Computers panel: Observe / Take control **closed by default**; bot actions refuse while human holds control
- Shortlist → `allocateBatch` prefers LinkedIn automatic seats when `deliveryMode=automatic` (`preferLinkedInAutomaticSeats`)

## Done this shift

1. Policy + Settings automatic default / Manual toggle (carry-forward + browser-computer entitlement)
2. Contact lease module + migration 0063 + 80-claimer chaos test
3. Computer supervisor + `browser-computer` LinkedIn adapter (fails closed without supervisor URL / mock)
4. Minimal wiki/graph knowledge plane (serial write queue; no contact grants)
5. Sourcing alignment helper + store `allocateOutreach` seat ordering
6. Fleet computers API + UI (observe/takeover closed by default)
7. Tests: contact-lease, computer-supervisor, knowledge-plane, sourcing-automatic-deliver; LinkedIn contracts green
8. `npm run typecheck` + `npm run typecheck:tests` green

## Blockers

- Live Chromium pool still needs `COMPUTER_SUPERVISOR_URL` (or mock) + Tony ToS/ban-risk accept for browser seats
- Vendor path still needs `LINKEDIN_VENDOR_API_URL` / `LINKEDIN_VENDOR_API_KEY`
- Apply migration **0063** on deploy
- N=100 computer RAM budget not provisioned (documented in `services/computer-supervisor/README.md`)

## Next steps

1. Ops: apply 0063; set vendor and/or computer supervisor env on Fly
2. Smoke: automatic Vendor seat send + Browser Computer mock send; second seat blocked on same identity
3. Optional: gVisor / remote computer pool for N>5
4. Optional: deepen Graphify EXTRACTED/INFERRED edges beyond minimal notes

## Decisions made (don't relitigate)

- LinkedIn delivery **defaults to Automatic**; Manual is opt-in (Tony 2026-09-04)
- Automatic channel = entitled **vendor-api OR browser-computer**; never silent assisted-manual fallback
- **Postgres contact lease is the only double-contact lock** — Graphify/wiki are knowledge recall only
- Observe/takeover available in Fleet; **not auto-opened**
- Scrape / PhantomBuster / cookie-jar tooling remains forbidden
- Research browser tools (`browser-tools`) stay research-only — do not reuse for LinkedIn send

## Watch out

- Provider string is `LinkedIn Browser Computer` (seat) / backend kind `browser-computer`
- Enqueue requires live automatic seat; fails closed with Settings deep-link when missing
- `COMPUTER_SUPERVISOR_MOCK_SEND=1` is for tests only — never in production
- Approval scope still normalizes LinkedIn profile URLs via `normalizeLinkedInProfileUrl`
