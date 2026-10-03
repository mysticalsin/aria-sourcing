# PRD — Agent Reach + human LinkedIn loop inside Aria

**Date:** 2026-10-02  
**Status:** Active — slices 1–3.5 implemented in tip; slice 4 (Fly+LI) blocked on deploy/login  
**Upstream researched:** [Panniantong/Agent-Reach](https://github.com/Panniantong/Agent-Reach)  
**Owner product:** Aria / MSourcing  
**Related tip work:** N isolated Browser Computer seats, human Take→login→Release, never invent `sessionHealthy=true`

---

## 1. Problem

Tony wants Aria to:

1. **Source** candidates better than “search + hope”
2. **See LinkedIn** like a human operator (logged-in desk), without looking like a bot farm
3. Use **Agent Reach** (+ **Jina** Reader — “Jev” in conversation) as the internet-eyes layer for public/read paths
4. Run an **automatic-ish loop**: source → outreach → interested reply → **book a meeting**, with **all tracking scoped inside Aria**

Today Aria already has most of the *control plane* for (2) and (4)’s approval spine, but it does **not** yet treat Agent Reach as a first-class capability layer, and the closed loop “interested → calendar booked → tracked” is incomplete / operator-heavy.

---

## 2. What already exists (do not rebuild)

| Need | Aria today | Honest limit |
|---|---|---|
| Discovery | GitHub, Tavily `site:linkedin.com`, Apify, Apollo, NightTrek-style agent tool, Scrapling | Public/login-wall; no magic “see everything logged-in” without a seat |
| Human LinkedIn desk | OpenBot Chromium per seat, Take / Release, session probe TTL, Claude-in-Chrome permissions | Needs tip Fly deploy + human login; `sessionHealthy` never invented |
| Anti-bot posture | Warmup, min-gap + jitter, business hours, human typing, adaptive UI pauses, durable profiles | **Not** residential proxies / unbannable guarantees (see `docs/LINKEDIN_OPERATOR.md`) |
| Copy quality | Humanizer on outbound | Does not make LinkedIn UI undetectable |
| Outreach | Approval-gated Automatic send on Browser Computer | Never auto-send without approval |
| Booking | Durable calendar claim/reconcile ledger | Create/propose is wired; full “interested reply → book” autopilot is partial |
| Inbound | Email inbound webhook → classify → draft_generate (still approval-gated) | LinkedIn inbound path thinner than email |

**Agent Reach is not a LinkedIn sender.** Its LinkedIn channel is:

- **Zero-config read:** Jina Reader (`r.jina.ai/…`) for public pages  
- **Configured unlock:** `mcp-server-linkedin` via mcporter (profile/company/jobs)  
- OpenCLI browser-session pattern for *other* sites; LinkedIn MCP is separate

So Agent Reach improves **eyes** (read/search). Aria’s OpenBot seats remain the **hands** (Connect/Message) after human login.

---

## 3. Product goal (north star)

One Aria-scoped loop:

```
Campaign need
  → Agent-Reach–assisted discovery + enrichment (Jina / MCP when configured)
  → Score + shortlist (existing quality floor / role binding)
  → Human-approved outreach on N isolated Browser Computers (human pacing)
  → Inbound interest (email / LinkedIn webhook)
  → Propose booking (durable calendar authority)
  → Confirmed meeting + activity trail (campaign / candidate / seat / computerId)
```

**Non-goals (v1):**

- Guaranteeing LinkedIn will never detect automation  
- Cookie farms, stealth plugins, residential proxy fleets as product features  
- Bypassing outreach approval or inventing healthy sessions  
- Replacing OpenBot with Agent Reach for Connect/Message

---

## 4. Requirements

### R1 — Eyes: Agent Reach LinkedIn read path (slice 1)

- Aria can read a public LinkedIn profile URL via **Jina Reader** with provenance `via: agent-reach-jina`.
- Fail closed: SSRF-guarded HTTPS egress only; only `linkedin.com` target URLs wrapped for Jina.
- Optional later: `mcp-server-linkedin` sidecar when `ARIA_AGENT_REACH_LINKEDIN_MCP_URL` is set (same pattern as Orca).
- Operator status lists Agent Reach alongside Orca / Scrapling (enabled + configured flags).
- Never invent profile content when Jina returns empty / blocked.

### R2 — Hands: human desk remains source of truth

- All Connect / Message / invite stay on entitled Browser Computer seats.
- Take control for login / CAPTCHA / checkpoint; Release restores agent control.
- `sessionHealthy=true` only from fresh probe within TTL.

### R3 — Loop: interest → booking tracked in Aria (slice 2+)

- On INTERESTED / QUALIFIED_INTEREST (email or LinkedIn inbound), enqueue **booking propose** (not silent calendar create) with campaign + candidate + seat receipts.
- Operator (or entitled autopilot profile) confirms → existing calendar claim/reconcile.
- Floor / Campaign Agents / candidate drawer show booking state; no parallel shadow CRM.

### R4 — Tracking scope

Every hop records: `workspaceId`, `campaignId`, `candidateId`, `seatId`, `computerId` (when known), `provider` / `via`, approval ids, booking ledger ids.

### R5 — Safety / compliance

- Keep “never auto-send” gate.
- Humanizer on generated copy.
- Role-token binding for Senior Java (and any seed campaign) on sourcing queries.
- Document LinkedIn ToS risk; conservative caps remain default.

---

## 5. Iteration plan

| Slice | Deliverable | Done when |
|---|---|---|
| **1** | PRD + Jina LinkedIn read adapter wired into `analyzeLinkedInProfile` + tests + status | Unit tests green; provenance `agent-reach-jina` when Jina returns text |
| **2** | Optional MCP LinkedIn sidecar + doctor/status API for Agent Reach | Fail-closed without inventing connectivity |
| **3** | Interest → booking propose job + UI trail | Receipts in activity + calendar ledger |
| **3.5** | Durable loop: `inbound_classify` → `booking.proposed` event + `append_activities`; ICP provenance preserves Agent Reach `via`; `GET /api/source/agent-reach/status` | Worker + unit tests green; no silent calendar create |
| **4** | Tip Fly deploy + N desks logged in | Live `/api/ready` tip SHA; `sessionHealthy:true` within TTL on Floor |

**Slice status (2026-10-03):** 1 ✅ · 2 ✅ · 3 ✅ · 3.5 ✅ · 4 ❌ Fly tip + LI login

---

## 6. Decisions (do not relitigate)

1. Agent Reach = **capability / eyes** layer; OpenBot = **hands**.  
2. “Jev” in this PRD means **Jina Reader** (Agent Reach’s LinkedIn zero-config backend).  
3. Never invent `sessionHealthy=true`.  
4. Outreach stays approval-gated; “automatic” means post-approval send on a healthy desk.  
5. No demo theater of “Agent Reach installed” without a real doctor/read path.

---

## 7. Success metrics

- Public profile enrich: ≥ measurable lift in `evidenceText` length vs login-wall stub on sample URLs (offline fixture + live when keyless Jina works).  
- Loop: % of INTERESTED replies that produce a **Proposed** booking within 1 operator action.  
- Safety: zero CI/prod paths that set healthy without probe; Quality gate green for tip-owned suites.
