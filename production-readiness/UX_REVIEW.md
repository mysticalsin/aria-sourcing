# UX Review — MSourcing ("Aria Sourcing by Mantu")

> SUPERSEDED by `STATUS.md` 2026-07-10 for current release posture. Historical 2026-06-27 evidence may contain stale stack versions, suite counts, migration ranges, and verdicts.


**Phase 3 — UX** · maps to **Gate 3 — Frontend/UX/accessibility (UX part)**
Reviewer: Product & UX Reviewer (production-readiness review)
Date: 2026-06-27
Scope: core journeys (login/onboarding → main workflows → settings), empty/loading/error/
permission-denied/expired-session/destructive-confirm states, responsiveness, broken links /
dead ends, confusing copy, risky defaults, validation quality.
Method: static review of the **current working tree** (DIRTY — 158 changed paths vs `main`,
`git status --short`), plus `npm run typecheck` and `next lint`. No browser/axe/cross-device run
in this pass (see Residual / Untested). Synthetic data only; no live systems touched.

---

## Executive summary

The UX of this build is **strong and unusually mature for an MVP demo**. Loading, empty, and
permission-denied states are handled consistently and deliberately across all 17 pages; the
safety-critical defaults (dry-run, human-approval gate, confidentiality) are all ON by default;
destructive candidate/key/settings actions now go through an **accessible, focus-trapped confirm
modal** (this supersedes the prior audit's MEDIUM finding that destructive actions used the
inaccessible native `window.confirm()` — that is now **FIXED** in code). Copy is honest and
free of overclaiming ("Dry-run · nothing sent", honest 3D render-cap messaging, RBAC banners).

It is **not** ready to PASS the UX gate, for one structural reason and a cluster of
medium-severity gaps:

- **No React error boundary anywhere** in the app (`error.tsx` / `global-error.tsx` absent).
  Any uncaught client render error drops the user onto Next.js's bare "Application error"
  screen with no branded recovery and no reset path — across every route. **(HIGH)**
- This is **compounded** by the 3D floor having **no WebGL-availability or context-loss
  fallback**: on a device without WebGL, or after a GPU context loss, react-three-fiber throws,
  and with no boundary above it the whole page (and SPA) crashes to that bare error screen. **(MEDIUM)**
- Two **destructive / high-consequence actions lack confirmation**: the topbar "Reset to
  defaults" (one click, no confirm — inconsistent with the Settings page which *does* confirm),
  and toggling OFF "Dry-run mode" / "Human approval gate" (enabling real sends with no warning step). **(MEDIUM x2)**
- **Mobile navigation reaches only 5 of 17 destinations** via visible chrome; the other 12 are
  reachable only through the command palette (no hamburger/drawer for the full sidebar). **(MEDIUM)**

### Gate 3 (UX part) decision: **FAIL**

Conservative call per operating rules: one **HIGH** finding open (no error boundary → app-wide
availability/recovery gap) plus four MEDIUM. Absent the error-boundary finding the UX would be
close to PASS-worthy. Formal accessibility scan (axe), keyboard/SR walkthrough, and
cross-browser/real-device responsiveness were **not executed** in this pass and remain UNKNOWN
sub-checks that also block a PASS.

---

## Verification evidence (positive — cited)

| Area | Verified behaviour | Evidence |
|---|---|---|
| Loading states | `HydrationGate` renders skeletons until the client store hydrates — no SSR/CSR flash | `src/components/app/page-header.tsx:32-44`; used in `page.tsx:158`, `settings/page.tsx:272`, `outreach/page.tsx:126`, `candidates/page.tsx:85`, `intake/page.tsx:226`, `floor/page.tsx:108`, `chat/page.tsx:65` |
| Empty states | Reusable `EmptyState` with icon/title/description/CTA, used on every list/queue | `src/components/ui/empty-state.tsx`; dashboard `page.tsx:244`, outreach `:159`, floor `:147,169`, settings `:538`, api-keys `:108` |
| Destructive confirm | Accessible promise-based `confirm()` modal (focus-trap, Esc/backdrop, SR labels) replaces `window.confirm()` | `src/components/ui/confirm.tsx`; callers: `settings/page.tsx:243`, `candidate-drawer.tsx:164,170,176`, `api-keys-panel.tsx:62` |
| Accessibility primitives | skip-link, `aria-live` toast region, `aria-modal` dialog w/ focus trap, `aria-current` nav, labelled fields, `aria-expanded`/`aria-pressed` | `app-shell.tsx:22`; `toast.tsx:52-57`; `modal.tsx:31-60,69-71`; `sidebar.tsx:41`; `floor/page.tsx:90-91` |
| Safe defaults | `dryRunMode:true`, `humanApprovalGate:true`, `confidentialityMode:true` | `src/lib/store.ts:2876-2891`; `src/lib/seed.ts:107-129` |
| Permission-denied UX | Non-admin sees a clear banner + read-only view (not broken/blank) | `api-keys-panel.tsx:70-75`; role gating in `providers/models/tools/guardrails/schedules/roles` panels |
| 404 / dead-end recovery | Branded global 404 and dynamic-route "Campaign not found" both offer a recovery link | `src/app/not-found.tsx`; `campaigns/[id]/page.tsx:180-189` |
| Open-redirect safety | Login `?redirect=` is path-only (`safeRedirect`) | `login/page.tsx:16-17,79,98,104` |
| Honest copy | 3D cap surfaced, not silently truncated; "Dry-run · nothing sent"; demo/live badges | `floor/page.tsx:222-236`; `intake/page.tsx:219-223`; `chat-thread-view.tsx:99-111` |
| Onboarding | 4-step skippable tour, once per browser, fails silently in private mode | `src/components/app/onboarding.tsx` |
| Build health | `tsc --noEmit` exit 0; `next lint` → "No ESLint warnings or errors" exit 0 | command output (this pass) |

> Note: an RTK lint summary in the first run referenced files that **do not exist** in this repo
> (`src/pages/Office3D.tsx`, `src/features/agents/*`, `src/components/theme-toggle.tsx`) — stale/
> cached output from another project. The real `next lint` run on this tree is clean.

---

## Findings

## [HIGH] No React error boundary — any client render error white-screens the whole app
- **Area / Affected:** Global app shell / all 17 routes. No `error.tsx`, `global-error.tsx`,
  or `<ErrorBoundary>` exists (`find src/app -name "error.tsx" -o -name "global-error.tsx"` →
  only `src/app/not-found.tsx`). `src/components/app/providers.tsx` and `app-shell.tsx` wrap
  children in `HermesProvider`/`ToastProvider`/`ConfirmProvider` but **no error boundary**.
- **Description:** In the App Router, an uncaught error in any client component bubbles past the
  (missing) route/segment boundaries to the framework default. In production that is a bare
  "Application error: a client-side exception has occurred" screen — unbranded, with no reset
  button and no path back to a working page.
- **Impact:** A single render bug, a malformed persisted-state shape in `localStorage`, a failed
  dynamic import, or the WebGL failure below takes down the entire SPA for that session with no
  in-app recovery. App-wide availability + trust risk for real users.
- **Likelihood:** Medium-High. The store is a ~3030-line client context hydrated from
  `localStorage`; any schema drift or a thrown selector crashes render. The 3D path (next finding)
  is a concrete, device-dependent trigger.
- **Reproduction:** Corrupt the `hermes` localStorage entry (or load `/floor` 3D on a
  WebGL-less browser) → uncaught throw → framework error screen, no recovery.
- **Evidence:** absence verified by `find`; provider stack at `providers.tsx:7-13`,
  `app-shell.tsx:19-62`.
- **Recommended fix:** Add a segment `error.tsx` (and a root `global-error.tsx`) with a branded
  message + "Reload" / "Back to Command Center" (`reset()` and a Link), matching the existing
  `not-found.tsx` style. Wrap the 3D scene in its own boundary so a 3D failure degrades to the
  2D grid instead of crashing the page.
- **Tests to add:** RTL test that a child throwing renders the boundary, not a blank tree;
  Playwright smoke that a forced error shows the recovery UI and "Reload" recovers.
- **Status:** OPEN · **Owner:** Frontend · **Residual risk (if unfixed):** High — every
  client error becomes a full app outage with no recovery.

## [MEDIUM] 3D Ops Floor has no WebGL-availability / context-loss fallback
- **Area / Affected:** `/floor` 3D view — `src/components/floor3d/Floor3D.tsx` (Suspense only),
  `floor/page.tsx:43,146-168,207-241`. No `webgl`/`contextlost`/availability guard anywhere in
  `src/components/floor3d/` (grep returned no matches).
- **Description:** The `Suspense` fallback covers GLB/font streaming, not WebGL initialization
  failure. react-three-fiber throws when no WebGL context is available or when the context is
  lost (common on low-end/older mobile GPUs, headless, or after a tab/GPU reset). With no error
  boundary (above) the throw crashes the page.
- **Impact:** Users on WebGL-less or GPU-constrained devices cannot use `/floor` and instead get
  the bare framework error screen — a dead end. The 2D grid (a perfectly good fallback) exists
  but is never reached on failure.
- **Likelihood:** Medium — device/browser dependent; deterministic where WebGL is unavailable.
- **Reproduction:** Open `/floor`, switch to "3D floor" on a browser with WebGL disabled →
  unhandled throw.
- **Evidence:** `Floor3D.tsx:1-40` (no guard); grep for webgl/contextlost in `floor3d/` = none.
- **Recommended fix:** Detect WebGL support before mounting the canvas; if unavailable, render an
  `EmptyState` ("3D view needs WebGL — showing the 2D grid") and auto-fall back to 2D. Handle
  `webglcontextlost` to recover or fall back. Wrap in a local error boundary regardless.
- **Tests to add:** unit test of the WebGL-availability detector; Playwright with WebGL disabled
  asserts the 2D fallback, not a crash.
- **Status:** OPEN · **Owner:** Frontend/3D · **Residual risk:** Medium.

## [MEDIUM] Topbar "Reset to defaults" is a one-click destructive action with no confirmation
- **Area / Affected:** `src/components/app/topbar.tsx:177-190` (user-menu button → `resetDemo()`
  → `window.location.href = "/"`). Contrast: `settings/page.tsx:242-252` performs the *same*
  reset behind the accessible confirm dialog.
- **Description:** From the user dropdown, a single click wipes the workspace back to factory
  defaults and reloads. In demo mode (`localStorage`) this destroys the operator's in-progress
  work; the debounced persist then writes the reset state over their saved data. No "are you
  sure?", no undo. In live mode it is mitigated (`resetDemo` sets `skipNextPersist` so it does
  not overwrite the shared Supabase workspace — `store.ts:2702-2709`), but the local view is
  still nuked without warning.
- **Impact:** Accidental, irreversible loss of the local working state from a low-friction menu;
  inconsistent with the confirmed reset elsewhere (users learn one is safe, the other isn't).
- **Likelihood:** Medium — it sits one click away in a frequently-opened menu, next to "Settings".
- **Reproduction:** Build up demo state → open user menu → click "Reset to defaults" → state
  gone immediately, no prompt.
- **Evidence:** `topbar.tsx:177-190`; `store.ts:2702-2709`; confirmed-variant `settings/page.tsx:243`.
- **Recommended fix:** Route the topbar reset through `useConfirm()` with the same destructive
  copy used on the Settings page (`danger: true`).
- **Tests to add:** RTL test that clicking the menu item opens the confirm dialog and only
  resets on confirm.
- **Status:** OPEN · **Owner:** Frontend · **Residual risk:** Medium (demo data loss).

## [MEDIUM] Disabling the safety switches (Dry-run / Human-approval gate) has no confirmation or warning
- **Area / Affected:** `settings/page.tsx:371-388` (`ToggleRow` for `humanApprovalGate` and
  `dryRunMode` → `setToggle()`); `setToggle` just patches + toasts (`:207-213`).
- **Description:** These two toggles are the highest-consequence controls in the product — turning
  OFF dry-run and/or the approval gate is what allows real messages to reach real candidates.
  They flip on a single tap, with only a passive success/info toast, no confirmation, and no
  "this enables live sends to real people" warning. The outreach page surfaces the resulting
  state ("Send mode: Live" in red, `outreach/page.tsx:304-309`) but nothing guards the flip itself.
- **Impact:** A mis-tap (or an unaware operator) silently moves the system from "nothing sends"
  to "messages can go to candidates." Given candidate PII + real outreach, this is a meaningful
  safety/consent risk, not just polish.
- **Likelihood:** Low-Medium (gated downstream by seat-connected + domain-verified before an
  actual send, per `outreach/page.tsx:318-322`), but the UX provides no friction at the decision point.
- **Reproduction:** Settings → Approval gate → toggle "Dry-run mode" off → immediately Live, no prompt.
- **Evidence:** `settings/page.tsx:371-388,207-213`; default-safe values at `store.ts:2876-2877`.
- **Recommended fix:** Require an explicit, danger-styled confirm when turning OFF either switch
  (e.g. "Leave dry-run? Aria will be able to send real messages once a seat is connected and its
  domain verified."). Consider a second confirmation in live mode.
- **Tests to add:** test that disabling each switch opens a confirm and is a no-op on cancel.
- **Status:** OPEN · **Owner:** Frontend + Product · **Residual risk:** Medium.

## [MEDIUM] Mobile navigation exposes only 5 of 17 destinations; full nav is search-only
- **Area / Affected:** Sidebar is `hidden lg:flex` (desktop ≥1024px only) — `sidebar.tsx:22`.
  Below `lg`, the only visible nav is the bottom bar (`app-shell.tsx:34-56`) built from
  `MOBILE_NAV` = `[/, /campaigns, /candidates, /outreach, /settings]` (`nav.ts:51-53`).
- **Description:** On phones/tablets, 12 of the 17 destinations — Intake, Replies, Calendar,
  Agent Fleet, Ops Floor, Chat, Reports, Skills, Memory, Sessions, Files (Curator), Soul — have
  **no visible navigation affordance**. They are reachable only via the ⌘K command palette
  (mounted in the mobile topbar row, `topbar.tsx:209-212`) or incidental in-page links. There is
  no hamburger/drawer that opens the full sidebar.
- **Impact:** Core flows (e.g. the Intake → campaign creation entry point, the Replies queue, the
  Calendar booking step) are effectively hidden on touch devices. Discoverability + dead-end risk;
  a mobile user can land on a page with no obvious way to reach the rest of the product.
- **Likelihood:** High on mobile usage; the command palette mitigates it only for users who
  discover it.
- **Reproduction:** Load any page at <1024px width → only 5 nav targets; no menu to reach Intake/Replies/etc.
- **Evidence:** `sidebar.tsx:22`; `app-shell.tsx:33-56`; `nav.ts:51-53`; `command-search.tsx:56-59` (palette lists all `NAV_ITEMS`).
- **Recommended fix:** Add a hamburger in the mobile topbar that opens the full `NAV_ITEMS`
  sidebar in a drawer (the `Drawer` primitive already exists), or expand the bottom nav with an
  overflow "More" sheet. Keep the palette as a power-user accelerator, not the only path.
- **Tests to add:** responsive test asserting all `NAV_ITEMS` are reachable from a visible
  control at mobile widths.
- **Status:** OPEN · **Owner:** Frontend · **Residual risk:** Medium.

## [LOW] Dead links in the login/marketing hero
- **Area / Affected:** `login/page.tsx:14` (`NAV_LINKS = ["Platform","Fleet","Security","Contact"]`)
  rendered as `href="#"` in the desktop nav (`:136-146`) and mobile menu (`:171-184`).
- **Description:** Four nav links and their mobile duplicates look clickable but navigate nowhere
  (jump to top). Pre-auth marketing chrome only, but still a polish/trust issue on the first screen
  a user sees.
- **Impact:** Minor confusion; broken-link impression on the landing/login page.
- **Evidence:** `grep 'href="#"' src/` → `login/page.tsx:140,174`.
- **Recommended fix:** Point them at real anchors/pages or remove them until the marketing
  content exists.
- **Status:** OPEN · **Owner:** Frontend/Marketing · **Residual risk:** Low.

## [LOW] No client-side handling of an expired live session
- **Area / Affected:** Client API callers (chat send, key test/save, hermes sessions) vs
  middleware-only redirect. `middleware.ts:37-42` redirects to `/login` on **navigation** when
  unauthenticated; `server.ts:29` returns 401 from API routes. No client code reacts to a 401
  (grep for `401`/`signOut`/`location.*login` in `src/lib`+`src/components` shows only
  `workspace.ts:78` signOut and unrelated reloads).
- **Description:** If a Supabase session expires while the user sits on a page, in-page fetches
  fail (401) and surface only as a generic toast or silent no-op; the user isn't told the session
  expired and isn't routed to re-auth until they next navigate.
- **Impact:** Confusing "nothing happens / generic error" state after idle in live mode; recovery
  requires a manual reload.
- **Evidence:** `middleware.ts:30-42`; `supabase/server.ts:29`; no client 401 handler found.
- **Recommended fix:** Central fetch wrapper that, on 401, shows a "Session expired — sign in
  again" prompt and redirects to `/login?redirect=<current>`.
- **Status:** OPEN (live mode only) · **Owner:** Frontend · **Residual risk:** Low-Medium in live.

## [LOW] Chat "Aria sessions" conflates error with empty; `/clear` doesn't clear
- **Area / Affected:** `chat/page.tsx:113-116` and `chat-thread-view.tsx:46-58`.
- **Description:** (a) On a failed `getHermesSessions` (`res.ok === false`) the panel shows
  "No sessions on the runtime yet." — an error is indistinguishable from a true empty state, and
  no error toast fires. (b) The `/clear` slash command only appends a "Thread cleared." system
  note; it does not actually clear the thread (acknowledged in the code comment at
  `chat-thread-view.tsx:54-56`) — misleading affordance.
- **Impact:** Operators can't tell a live-runtime failure from "nothing here"; `/clear` appears
  broken.
- **Evidence:** `chat/page.tsx:39-47,113-116`; `chat-thread-view.tsx:46-58`.
- **Recommended fix:** Distinguish error vs empty (error variant + retry); implement a real
  `clearThread` action or remove `/clear` from the help.
- **Status:** OPEN · **Owner:** Frontend · **Residual risk:** Low.

## [LOW] Intake validation is advisory only (weak data-quality guards)
- **Area / Affected:** `intake/page.tsx`. "Create campaign" stays enabled with **zero required
  skills** (only a red hint, `:504-507,665-674`); salary min/max (`:409-426`) and years min/max
  (`:474-497`) are not validated for `min <= max`; HM email accepts free text and falls back to
  `unknown@company.example` (`:196`).
- **Description:** A user can spin up a campaign from an effectively empty/contradictory brief.
  Acceptable for a demo, but for production data quality the create action should block (or
  explicitly warn-and-confirm) on missing required skills and inverted ranges.
- **Impact:** Low-quality campaigns / nonsensical ranges enter the pipeline silently.
- **Evidence:** cited lines above.
- **Recommended fix:** Disable/guard "Create campaign" until ≥1 required skill; validate
  `min <= max` on salary and years with inline field errors.
- **Status:** OPEN · **Owner:** Frontend + Product · **Residual risk:** Low.

## [LOW] Login form ships with `admin`/`admin` pre-filled
- **Area / Affected:** `login/page.tsx:49-50` (`useState("admin")` for both email and password),
  shown only when `supabaseEnabled` (`:221-280`).
- **Description:** The email sign-in form pre-populates demo credentials. This is harmless in
  pure demo mode and the demo-login endpoint is **hard-disabled in production**
  (`api/auth/demo-login/route.ts:15-17`, `NODE_ENV === "production"` → 404). But on any non-prod
  live build (e.g. a preview deployment with Supabase enabled and `NODE_ENV !== production`) the
  pre-filled `admin/admin` is a one-click backdoor to the seeded admin account.
- **Impact:** Risky default surfaced in the UI; relies entirely on `NODE_ENV` being correct.
- **Evidence:** `login/page.tsx:49-50,66-85`; `demo-login/route.ts:15-27`.
- **Recommended fix:** Don't pre-fill credentials when `supabaseEnabled`; show the demo shortcut
  only when the demo endpoint is actually reachable (i.e. dev), and label it clearly.
- **Status:** OPEN · **Owner:** Frontend/Security · **Residual risk:** Low (prod-gated).

---

## Core-journey walkthrough (code-traced)

1. **Login → console.** Demo: "Enter the console" → `/`. Live: Microsoft OAuth or email form
   (admin/admin shortcut → server-side demo-login). Open-redirect protected. Error param
   surfaced (`login/page.tsx:289-294`). **OK**, except dead marketing links + pre-filled creds (LOW).
2. **First-run onboarding.** 4-step skippable tour, once per browser. **OK.**
3. **Intake → campaign.** Paste/Sample/Scan-inbox → parse → editable structured brief with
   per-field confidence + validation warnings + clarification draft → "Create campaign" →
   `/campaigns/[id]`. Empty state until parsed. **OK**, validation advisory-only (LOW).
4. **Candidates → drawer.** Search/sort/stage/source filters; `?focus=` deep-link opens the
   drawer; destructive actions (anonymize/suppress/do-not-contact) all confirmed. **OK.**
5. **Outreach approval queue.** Awaiting / pending-manual / scheduled sections, per-campaign
   filter, live guardrail state (gate on/off, dry-run vs live), clear empty states. **OK.**
6. **Floor / Fleet / Chat.** 2D grid solid; 3D has the WebGL gap (MEDIUM). Chat has demo/live
   badge, typing indicators, empty states; minor error/empty + `/clear` issues (LOW).
7. **Settings.** Tabbed, deep-linkable, RBAC-aware (read-only banners for non-admins), confirmed
   reset. Safe defaults. Strong — except the unconfirmed safety-switch toggles (MEDIUM).
8. **Dead ends / 404.** Global `not-found.tsx` and dynamic "Campaign not found" both recover. **OK.**

---

## Residual / Untested (UNKNOWN — needs a real run, not blocked on infra)

These belong to the UX/a11y gate but were **not executed** in this static pass; they cannot be
marked PASS:

- **Formal accessibility scan** (axe-core) + manual keyboard-only and screen-reader walkthrough
  on the core flows (WCAG 2.2 AA). A11y *primitives* are present and correct in code, but no axe
  run, no contrast audit, no SR transcript. — UNKNOWN (owned with the a11y reviewer).
- **Cross-browser + real-device responsiveness** (Safari/iOS, Chrome/Android, Firefox). Layout
  reviewed in code only; the chat view uses a fixed `h-[calc(100vh-11rem)]` (`chat/page.tsx:71`)
  that should be verified on small viewports. — UNKNOWN.
- **Reduced-motion / prefers-reduced-motion** handling for the heavy framer-motion + autoplay
  login video — not verified. — UNKNOWN.
- **Real-error and expired-session behaviour in a browser** (to confirm the HIGH/LOW findings
  above empirically). Playwright is available in this environment but was not run this pass. — UNKNOWN.

---

## Recommended fix order (for the UX gate to reach PASS)

1. Add `error.tsx` + `global-error.tsx` with branded recovery (clears the **HIGH**).
2. WebGL-availability guard + auto-fallback to 2D + local 3D error boundary (MEDIUM).
3. Confirm dialog on topbar "Reset to defaults" and on disabling Dry-run / Approval gate (MEDIUM x2).
4. Mobile full-nav drawer/hamburger (MEDIUM).
5. Run axe + keyboard/SR + cross-browser; fix anything surfaced (clears the UNKNOWN sub-checks).
6. LOW polish: dead login links, 401 handler, chat error-vs-empty + `/clear`, intake validation,
   stop pre-filling credentials.

---

## Change log vs prior audit

- **Superseded (now FIXED):** prior `PRODUCTION_READINESS_REPORT.md:50` / `RELEASE_GATE_MATRIX.md`
  Gate 3 note that destructive actions use the inaccessible `window.confirm()`. The current tree
  uses an accessible `ConfirmProvider` modal for **all** destructive actions
  (`src/components/ui/confirm.tsx`; callers cited above). No `window.confirm`/`alert` remain
  (grep clean).
- **Still valid from prior audit:** "no formal WCAG scan run" and "no cross-browser" — confirmed
  still true; carried forward as UNKNOWN sub-checks.
- **New in this review:** the HIGH error-boundary gap, the 3D WebGL fallback gap, the two
  unconfirmed destructive/safety actions, and the mobile-nav coverage gap were not called out in
  the prior Gate 3 note.
