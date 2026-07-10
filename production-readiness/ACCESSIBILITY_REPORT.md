# ACCESSIBILITY REPORT — MSourcing ("hermes-sourcing" / "Aria by Mantu")

> SUPERSEDED by `STATUS.md` 2026-07-10 for current release posture. Historical 2026-06-27 evidence may contain stale stack versions, suite counts, migration ranges, and verdicts.


Phase 3 — WCAG 2.2 AA static accessibility review
Maps to: **Gate 3 — accessibility part**

- **Auditor role:** Accessibility Engineer (production-readiness review)
- **Date:** 2026-06-27
- **Scope:** Static source review of components + config under `src/`. Keyboard model, focus management, labels/form-error semantics, color contrast vs. Tailwind tokens, ARIA, semantic HTML, reduced-motion, accessible auth.
- **Baseline:** WCAG 2.2 AA (with note where 2.2-new SCs apply).
- **Repo state:** branch `main`, **working tree DIRTY** at audit time (`git status` shows ~50 modified files incl. `src/app/layout.tsx`, `src/app/login/page.tsx`, most page/route files and `src/components/ui/*`). This report audits the **current on-disk tree as-is**; a re-audit is required before release once the tree is committed/clean.
- **Method:** `grep`/`Read` over `src/`, plus a WCAG contrast calculator run over the design tokens in `src/styles/globals.css` (script: `production-readiness/`-external scratch; ratios reproduced inline below).
- **No prior `ACCESSIBILITY_REPORT.md` existed.** The only prior a11y signal in the doc set is `RELEASE_GATE_MATRIX.md:11` (Gate 3 = PARTIAL, "a11y unverified → not PASS") and `EVIDENCE_INDEX.md` (a11y scan deferred; "a11y fixes landed"). This document supersedes those for the accessibility sub-gate.

---

## Executive summary

The codebase shows **above-average baseline accessibility hygiene for an MVP** — far better than typical. Verified strengths (evidence in §"What passes"): `<html lang>`, a working skip-link, a global high-contrast `:focus-visible` ring (9.2:1), a CSS `prefers-reduced-motion` reset, a focus-trapping Drawer with focus restore, an ARIA tablist with roving tabindex/arrow keys, a `role="switch"` toggle, an accessible `Confirm` dialog that replaced `window.confirm()`, an `aria-live` toast region, a `<table>` with `<caption>` + `scope`, `aria-current` nav, and icon-only buttons that carry `aria-label`. Body-text contrast is excellent (ink 18:1, muted 6.2:1).

However, there are **multiple open WCAG 2.2 AA issues** plus one **Level A** failure, and the required **full manual axe + screen-reader + keyboard pass across all 19 routes has NOT been performed**, so a large surface remains UNKNOWN. Headline gaps:

1. **Form errors / status messages are not programmatically announced or associated** — zero `aria-invalid`, zero `aria-describedby`, zero `role="alert"` across the app; only the toast uses `aria-live`. (SC 3.3.1 A, 4.1.3 AA, 3.3.2.)
2. **Color-contrast failures in the status/"soft" badge & pill system** used app-wide — `success`-on-`success-soft` = **3.26:1**, `danger`-on-`danger-soft` = **3.72:1**, bright `warning`-on-`warning-soft` = **2.08:1**. (SC 1.4.3 AA.)
3. **Auto-playing looping background `<video>` on `/login` with no pause/stop/hide control** (SC 2.2.2 **Level A**) — also bypasses `prefers-reduced-motion`.
4. **framer-motion + r3f + the autoplay video bypass `prefers-reduced-motion`** (the CSS reset only neutralizes CSS animation/transition, not JS-driven motion).
5. **Modal/Confirm dialogs don't restore focus to the trigger on close** (SC 2.4.3) and the **⌘K command palette lacks combobox/listbox semantics + a focus trap** (SC 4.1.2 / 2.1.2).
6. **No automated a11y gate** (CI runs only the `next/core-web-vitals` jsx-a11y subset; no axe/lighthouse/pa11y, no jest-axe in the 22 test suites).

**Gate 3 (accessibility part) verdict: FAIL.** Open AA issues + one Level A issue + an unperformed mandatory manual pass. No CRITICAL/HIGH; the dominant risk is breadth of AA defects + unverified runtime behavior. Per audit rules, unverified ≠ PASS.

---

## Gate 3 — accessibility sub-checks

| Sub-check | Status | Evidence (summary) |
|---|---|---|
| Visible focus indicator | **PASS** | Global `:focus-visible` 2px electric outline, offset 2px, 9.2:1 contrast — `globals.css:85-89`; per-component focus rings throughout. |
| Semantic structure / landmarks | **PASS** | `<html lang="en">` `layout.tsx:24`; skip-link `app-shell.tsx:22`; `<main id="main-content">`, `<nav aria-label>`, `<header>`, `<aside>`; one `<h1>` per page via `PageHeader` (`page-header.tsx:24`); `<table>` + sr-only `<caption>` + `scope` (`table.tsx`). |
| Keyboard nav & focus management | **FAIL** | Drawer/Tabs/Switch excellent; but Modal/Confirm don't restore focus (F-06) and ⌘K palette lacks focus trap + listbox semantics (F-07). |
| Labels & form errors | **FAIL** | Inputs/labels associated; but errors not announced/associated — 0 `aria-invalid`/`aria-describedby`/`role=alert` (F-01). |
| Color contrast (vs tokens) | **FAIL** | Status/badge "soft" system fails 4.5:1 (F-02); login low-opacity-over-video text (F-08). Body/buttons/links PASS. |
| ARIA & roles | **FAIL** | Good coverage (dialogs, tabs, switch, aria-current); gaps in command palette (F-07) and 3D canvas (F-05). |
| Reduced motion | **FAIL** | CSS reset present (`globals.css:332`); JS motion (framer-motion login, r3f canvas, autoplay video) bypasses it (F-03, F-04, F-05). |
| Accessible auth | **FAIL** | Labels/autocomplete good; but autoplay video (F-03), low-contrast helper text (F-08), auth error not announced (part of F-01) on the entry page. |
| Automated/manual a11y verification | **UNKNOWN — blocked** | No axe/SR/keyboard pass run; only jsx-a11y lint subset in CI (F-11). |
| **Overall Gate 3 (a11y part)** | **FAIL** | Open AA + Level A defects; mandatory manual pass not performed. |

---

## What passes (verified strengths — keep)

- **Language:** `<html lang="en">` — `src/app/layout.tsx:24`.
- **Skip link:** `<a href="#main-content" className="skip-link">` — `src/components/app/app-shell.tsx:22-24`; styled off-screen until `:focus` — `src/styles/globals.css:91-105`; target `<main id="main-content">` — `app-shell.tsx:28`.
- **Focus visibility:** global `:focus-visible { outline: 2px solid hsl(var(--electric)); outline-offset: 2px }` — `globals.css:85-89`. Ring contrast electric vs paper/surface = **9.23 / 9.44:1** (≥3:1 required). Verified.
- **Reduced motion (CSS):** `@media (prefers-reduced-motion: reduce)` neutralizes all CSS animations/transitions incl. `.bot-float`, `.status-live`, `.dot-typing`, skeleton shimmer — `globals.css:332-341`.
- **Drawer (exemplary):** `role="dialog"` + `aria-modal` + `aria-labelledby`, Escape-to-close, focus trap (`trapFocus`), focus **restored** to trigger on close, body-scroll lock — `src/components/ui/drawer.tsx:33-118`.
- **Tabs:** `role="tablist"`/`tab`/`tabpanel`, roving `tabIndex`, Arrow/Home/End keys, `aria-selected`, `aria-controls`/`aria-labelledby` — `src/components/ui/tabs.tsx`.
- **Switch:** `role="switch"` + `aria-checked` + `aria-label` + focus ring — `src/components/ui/input.tsx:79-114`.
- **Accessible confirm:** `useConfirm()` replaces native `window.confirm()` with a focus-managed modal — `src/components/ui/confirm.tsx` (addresses the `RELEASE_GATE_MATRIX.md:11` "window.confirm" finding).
- **Toast live region:** `role="region"` + `aria-live="polite"` + dismiss buttons with `aria-label` — `src/components/ui/toast.tsx:52-77`.
- **Tables:** sr-only `<caption>` mandatory, `<th scope="col">` default — `src/components/ui/table.tsx`.
- **Nav state:** `aria-current="page"` on active links, `aria-label` on each `<nav>` — `sidebar.tsx:41`, `app-shell.tsx:34-45`.
- **Icon-only buttons named:** topbar bell/user (`topbar.tsx:106,153`), floor sound toggle with `aria-pressed` (`floor/page.tsx:90-91`), drawer/modal close (`drawer.tsx:88`, `modal.tsx:86`), table de-dup name button (`candidate-table.tsx:115-121`).
- **Login inputs:** `<label htmlFor>`/`id` (sr-only) + `autoComplete="username"/"current-password"` — `login/page.tsx:240-267`.
- **3D is opt-in:** floor defaults to a keyboard-accessible **2D grid**; 3D is behind a toggle (`floor/page.tsx:55,122-144`) — a non-canvas alternative exists.
- **Decorative icons hidden:** `aria-hidden` on lucide glyphs that sit beside text labels (widespread, e.g. `floor/page.tsx:102`, `candidate-table.tsx:131`).
- **Contrast — body/buttons/links (computed):** ink-on-paper 18.23:1, ink-soft 9.98:1, muted 6.19–6.34:1, white-on-ink 19.24:1, white-on-tangerine 7.14:1, white-on-electric 9.74:1, electric link 9.23:1, tangerine-on-tangerine-soft 5.95:1, yellow-ink-on-yellow 15.71:1 — all PASS.
- **Lint:** `eslint-plugin-jsx-a11y` (6.10.2) ships transitively via `next/core-web-vitals` (`.eslintrc.json`); CI runs `lint` (`.github/workflows/ci.yml:30`) — a (limited) static a11y rule subset is enforced.

---

## FINDINGS

## [MEDIUM] F-01 — Form errors & status messages are not announced or programmatically associated
- **Area:** Forms / status messages (app-wide)
- **Affected:** `src/components/ui/input.tsx:57-77` (`Field` renders hint as unlinked `<p>`, no `aria-describedby`); `src/app/login/page.tsx:278` (`authError`) and `:289-294` (URL `error`) render as static text; `src/app/intake/page.tsx:505` (`text-danger` validation text, unlinked). Codebase-wide: `aria-invalid` = **0**, `aria-describedby` = **0**, `role="alert"` = **0**; only `src/components/ui/toast.tsx:56` uses `aria-live`.
- **Description:** Validation/error/success copy is rendered visually but never (a) linked to its field via `aria-describedby`, (b) marked `aria-invalid`, or (c) placed in a live region. A screen-reader user submitting the login form or an intake form is not notified that an error occurred and cannot tell which field is invalid. Native `required` (21 uses) gives browser-default validation only.
- **Impact:** SR/AT users cannot perceive validation failures or success confirmations → cannot complete auth/forms reliably.
- **Likelihood:** High (any failed login/form submit).
- **Reproduction:** With a screen reader, submit `/login` email form with a wrong password → visible red text appears (`text-red-300`) but nothing is announced; no field marked invalid.
- **Evidence:** grep counts above; `login/page.tsx:51,69,93,278`; `input.tsx:57-77`.
- **WCAG:** 3.3.1 Error Identification (A), 4.1.3 Status Messages (AA), 3.3.2 Labels/Instructions, 1.3.1 Info & Relationships.
- **Recommended fix:** Add `aria-invalid` + `aria-describedby={errorId}` to fields; render error containers with `role="alert"` (or `aria-live="assertive"`); wire `Field`'s `hint`/error to the control via a generated id; for auth errors use a live region. Consider `aria-busy` on submit buttons during "Signing in…".
- **Tests to add:** jest-axe form snapshot; RTL test asserting `aria-invalid`/`role=alert` on submit failure.
- **Status:** OPEN · **Owner:** Frontend · **Residual risk:** Medium until announced + associated.

## [MEDIUM] F-02 — Color-contrast failures in the status/"soft" badge & pill system
- **Area:** Color contrast (Tailwind tokens)
- **Affected:** `src/components/ui/badge.tsx:10-12`; `src/app/outreach/page.tsx:50,148`; `src/components/settings/integration-card.tsx:243-245`; `src/components/shared/stage-pipeline.tsx:24`; reuse in `metric-card.tsx:14`, `attention-panel.tsx:22-23`, `activity-timeline.tsx:41-42`, `topbar.tsx:92` (approval-gate pill), `fleet/page.tsx:238`, `candidate-table.tsx:192`.
- **Description:** Computed WCAG ratios (tokens from `globals.css`): `text-success` on `bg-success-soft` = **3.26:1**; `text-danger` on `bg-danger-soft` = **3.72:1**; bright `text-warning` on `bg-warning-soft` = **2.08:1**; solid `bg-success text-white` = **3.75:1**; `bg-danger text-white` = **4.34:1**. All below the 4.5:1 needed for normal text (these are small/`text-xs` even when bold, so the 3:1 large-text exception does not apply). The `Badge` component *partially* remediates warning by overriding to `text-[hsl(32_90%_34%)]` (= **4.54:1**, passes), but the bright `text-warning` combo persists in `outreach/page.tsx` and `integration-card.tsx`.
- **Impact:** Low-vision users cannot reliably read status badges/pills (stage, health, compliance, approval-gate) used across the whole console.
- **Likelihood:** High (badges are everywhere).
- **Reproduction:** Render any `<Badge tone="success|danger">` or the outreach warning chip; measure with an axe/contrast tool.
- **Evidence:** contrast computation above; `badge.tsx:10-12`; `stage-pipeline.tsx:24`.
- **Caveat / partial UNKNOWN:** several soft backgrounds are applied at reduced opacity (`/40`, `/80`, `/0.06`) over the page's purple gradient (`globals.css:73-82`), so the *effective* rendered contrast differs from the flat-token math and must be confirmed on the rendered DOM with axe.
- **WCAG:** 1.4.3 Contrast (Minimum) (AA).
- **Recommended fix:** Darken status text tokens (apply the `hsl(32 90% 34%)` darkening pattern to success/danger too, or define `*-ink` variants), and route all status chips through `<Badge>` so the fix is centralized; avoid white-on-success/danger solids for text.
- **Tests to add:** token-level contrast unit test asserting ≥4.5:1 for every `text-* / bg-*-soft` pair; axe contrast scan.
- **Status:** OPEN · **Owner:** Design system · **Residual risk:** Medium.

## [MEDIUM] F-03 — Auto-playing looping background video on /login with no pause control (Level A)
- **Area:** Reduced motion / moving content / accessible auth
- **Affected:** `src/app/login/page.tsx:116-125` (`<video autoPlay muted loop playsInline>`).
- **Description:** The login hero plays a remote CloudFront `.mp4` that auto-starts and loops indefinitely with no mechanism to pause, stop, or hide it. WCAG 2.2.2 requires a pause/stop/hide control for any moving content that starts automatically and lasts >5s. Because it is a real `<video>` (not CSS), the `prefers-reduced-motion` CSS reset (`globals.css:332`) does **not** stop it.
- **Impact:** Continuous background motion behind the auth form distracts users with attention/vestibular/cognitive disabilities; no way to disable it. It is also a moving, low-contrast backdrop for the only login text (compounds F-08).
- **Likelihood:** High (every visit to the entry page).
- **Reproduction:** Open `/login` → video loops; no pause button anywhere.
- **Evidence:** `login/page.tsx:116-125`.
- **WCAG:** 2.2.2 Pause, Stop, Hide (**Level A**); 2.3.3 Animation from Interactions (AAA, related).
- **Recommended fix:** Gate autoplay behind `useReducedMotion()`/`matchMedia('(prefers-reduced-motion: reduce)')` (render the poster/static frame instead), and/or provide a visible pause toggle. Keep `muted` (no audio control needed since silent).
- **Tests to add:** unit test asserting video is not auto-played when reduced-motion is set; manual verification.
- **Status:** OPEN · **Owner:** Frontend · **Residual risk:** Medium (single page, decorative, silent — but Level A).

## [MEDIUM] F-04 — JS-driven motion (framer-motion) ignores prefers-reduced-motion
- **Area:** Reduced motion
- **Affected:** `src/app/login/page.tsx` — `StaggeredFade` (`:20-39`, per-character opacity stagger), `motion.p` (`:199`), `motion.button` (`:209`), mobile-menu `AnimatePresence` (`:162-186`). framer-motion is used in **1 file** (login); no `useReducedMotion()`/`MotionConfig reducedMotion="user"` anywhere (grep: 0 hits).
- **Description:** framer-motion animates via JS/inline styles and the Web Animations API, which the CSS `transition-duration: 0.001ms` reset does not affect. The headline character-stagger and entrance animations therefore run for all users regardless of OS reduced-motion preference.
- **Impact:** Users who set reduced-motion still get the animated entrance — vestibular-trigger risk; mainly the entry page.
- **Likelihood:** Medium.
- **Reproduction:** Set OS "Reduce motion", load `/login` → headline still staggers in.
- **Evidence:** `login/page.tsx:20-39,162-219`; grep `useReducedMotion|MotionConfig|reducedMotion` → 0.
- **WCAG:** 2.3.3 Animation from Interactions (AAA); best-practice for 2.2.2/1.4.3 context.
- **Recommended fix:** Wrap the app (or login) in `<MotionConfig reducedMotion="user">`, or branch each `motion.*` on `useReducedMotion()` to skip transforms.
- **Tests to add:** RTL test with mocked `matchMedia` reduced-motion asserting static render.
- **Status:** OPEN · **Owner:** Frontend · **Residual risk:** Low–Medium (AAA-level).

## [MEDIUM] F-05 — 3D floor canvas: not keyboard-operable, no accessible name, motion ignores reduced-motion
- **Area:** Keyboard / ARIA / reduced motion
- **Affected:** `src/components/floor3d/Floor3D.tsx`, `src/components/floor3d/retro/RetroOfficeScene.tsx:104-122`, `src/components/floor3d/Floor3DScene.tsx:147-161` (`<Canvas>`); selection is mouse raycast (`floor/page.tsx:238` `onSelect`).
- **Description:** The r3f `<Canvas>` renders a `<canvas>` with no `role`/`aria-label`/text alternative; agents are selectable only by clicking 3D meshes (no keyboard path within the canvas); a continuous `useFrame` walking simulation animates regardless of `prefers-reduced-motion`.
- **Impact:** Keyboard/SR users cannot operate the 3D view; continuous motion cannot be reduced.
- **Mitigation (important):** The floor **defaults to a 2D grid** (`floor/page.tsx:55`) whose `AgentDesk` cards are keyboard-accessible, and 3D is an explicit opt-in toggle — so an equivalent accessible path exists. This downgrades severity.
- **Likelihood:** Medium (only when a user opts into 3D).
- **Reproduction:** Switch to "3D floor" → Tab cannot reach/activate agents; reduced-motion does not stop the walking sim.
- **Evidence:** `Floor3D.tsx`; `RetroOfficeScene.tsx:104-122`; `floor/page.tsx:122-167`.
- **WCAG:** 2.1.1 Keyboard, 1.1.1 Non-text Content, 2.2.2 Pause/Stop/Hide.
- **Recommended fix:** Add `aria-label` + a visually-hidden text summary/list mirroring the agents to the canvas container; pause/throttle `useFrame` under reduced-motion; document that 2D is the accessible canonical view.
- **Tests to add:** assert canvas container exposes an accessible name; manual SR pass.
- **Status:** OPEN · **Owner:** Frontend/3D · **Residual risk:** Low (accessible 2D default).

## [MEDIUM] F-06 — Modal/Confirm dialogs do not restore focus to the trigger on close
- **Area:** Focus management
- **Affected:** `src/components/ui/modal.tsx:28-60` (no `previouslyFocused` capture/restore); consumed by `src/components/ui/confirm.tsx` (`ConfirmProvider`, used app-wide for destructive actions, mounted in `app-shell.tsx:20`).
- **Description:** `Modal` traps focus and moves focus inward (good) but never records `document.activeElement` on open nor restores it on close — unlike `Drawer` which does (`drawer.tsx:35,56`). On close (confirm/cancel/Escape/backdrop), focus falls to `<body>`.
- **Impact:** Keyboard users lose their place after confirming a destructive action (delete key, reset, suppression) — focus order/predictability failure.
- **Likelihood:** High wherever Modal/Confirm is used.
- **Reproduction:** Tab to a delete button → trigger Confirm → Cancel → focus is on body, not the delete button.
- **Evidence:** `modal.tsx:25-60` vs `drawer.tsx:30,35,56`.
- **WCAG:** 2.4.3 Focus Order; 3.2.x predictability.
- **Recommended fix:** Mirror Drawer: store `previouslyFocused = document.activeElement` on open and `previouslyFocused?.focus()` in cleanup.
- **Tests to add:** RTL test asserting focus returns to trigger after Modal close.
- **Status:** OPEN · **Owner:** Frontend · **Residual risk:** Medium.

## [MEDIUM] F-07 — Command palette (⌘K) lacks combobox/listbox semantics and a focus trap
- **Area:** ARIA / keyboard
- **Affected:** `src/components/app/command-search.tsx:131-190`.
- **Description:** The palette dialog has `role="dialog"`+`aria-modal` and Arrow/Enter handling, but: (a) no focus trap — Tab can move out of the open modal to the page behind; (b) the active item is **visual only** — results are `<button>`s with no `role="option"`, no `aria-selected`, and the input has no `role="combobox"`/`aria-expanded`/`aria-controls`/`aria-activedescendant`, so SR users get no announcement of the highlighted result or result count.
- **Impact:** SR users cannot perceive the active suggestion or that results changed; keyboard focus can escape the modal.
- **Likelihood:** Medium (power-user feature, but global).
- **Reproduction:** Open ⌘K, type, Arrow-down → highlight moves visually but is not announced; Tab leaves the dialog.
- **Evidence:** `command-search.tsx:102-190`.
- **WCAG:** 4.1.2 Name/Role/Value, 1.3.1, 2.1.2 No Keyboard Trap (here, the inverse — missing containment), 4.1.3 Status Messages.
- **Recommended fix:** Implement APG combobox-with-listbox: `role="combobox"` input + `aria-controls`/`aria-activedescendant`, `role="listbox"`/`option` results, `aria-selected`, an `aria-live` result-count, and a Tab focus trap.
- **Tests to add:** axe + RTL combobox role/activedescendant assertions.
- **Status:** OPEN · **Owner:** Frontend · **Residual risk:** Medium.

## [LOW] F-08 — Low-opacity helper text over the dark login video
- **Area:** Color contrast
- **Affected:** `src/app/login/page.tsx:296` (`text-white/40` disclaimer), `:283` (`text-white/50`), nav `text-white/80`/`/60`, error `text-red-300`/`text-red-200` (`:278,290`).
- **Description:** `text-white/40` over pure black = **3.66:1** (fails 4.5:1); `text-white/50` = 5.32:1 (passes on black). But all of this text overlays an **auto-playing video** (F-03) with only a gradient overlay (`:127`), so the effective background luminance varies frame-to-frame and contrast can drop well below the flat-color math wherever the video is bright.
- **Impact:** Legibility of the consent/disclaimer and error copy on the auth screen is unreliable for low-vision users.
- **Likelihood:** Medium.
- **Reproduction:** Load `/login`, sample the disclaimer over a bright video frame with a contrast picker.
- **Caveat / UNKNOWN:** exact rendered contrast depends on actual video frames → confirm on rendered DOM.
- **WCAG:** 1.4.3 Contrast (Minimum) (AA).
- **Recommended fix:** Raise minimum text opacity to ≥`/70` for normal text; add a stronger scrim behind text blocks; never rely on `/40`–`/50` for body/disclaimer copy over video.
- **Tests to add:** manual axe over login with video paused at several frames.
- **Status:** OPEN · **Owner:** Frontend/Design · **Residual risk:** Low.

## [LOW] F-09 — Login decorative nav links non-functional; mobile menu has no focus management
- **Area:** Keyboard / predictability
- **Affected:** `src/app/login/page.tsx:14,136-159` (`NAV_LINKS` all `href="#"`), `:162-186` (mobile menu).
- **Description:** "Platform/Fleet/Security/Contact" links are focusable but go nowhere (`href="#"`). The mobile menu opens via framer-motion but does not move focus into the menu, trap focus, or close on Escape.
- **Impact:** Keyboard users hit dead links; menu open/close is not keyboard-discoverable.
- **WCAG:** 2.4.4 Link Purpose, 2.1.1 Keyboard, 2.4.3 Focus Order.
- **Recommended fix:** Make links real or render as `<button disabled>`/remove; add Escape + focus management to the mobile menu.
- **Status:** OPEN · **Owner:** Frontend · **Residual risk:** Low.

## [LOW] F-10 — Topbar disclosure menus don't close on Escape / lack menu semantics
- **Area:** Keyboard / ARIA
- **Affected:** `src/components/app/topbar.tsx:99-206` (notifications + user menus).
- **Description:** Both menus set `aria-expanded` (good) but close only via outside-click overlay; no Escape handler and items are plain links/buttons in a `<div>` (no `role="menu"`/arrow-key nav). Acceptable as a disclosure pattern, but Escape-to-close is expected.
- **WCAG:** 2.1.1 Keyboard (best practice), 1.3.1.
- **Recommended fix:** Add Escape-to-close and return focus to the toggle; optionally adopt APG menu-button pattern.
- **Status:** OPEN · **Owner:** Frontend · **Residual risk:** Low.

## [LOW] F-12 — Redundant non-keyboard row click on candidate table (documented, low impact)
- **Area:** Keyboard
- **Affected:** `src/components/candidates/candidate-table.tsx:100-104` (`<tr onClick>` with no role/tabIndex/keyhandler).
- **Description:** Rows are mouse-clickable, but the candidate name is a real `<button>` (`:115-121`, `stopPropagation`) providing the keyboard path, and the drawer is reachable. So the `<tr onClick>` is a redundant mouse affordance, not an exclusive control — acceptable. Documented for completeness; recommend removing the row-level handler or making cells individually actionable to avoid confusion.
- **WCAG:** 2.1.1 (mitigated — accessible alternative present).
- **Status:** ACCEPTED (low) · **Owner:** Frontend · **Residual risk:** Low.

## [MEDIUM] F-11 — No automated accessibility gate; full manual axe/SR/keyboard pass not performed (UNKNOWN surface)
- **Area:** Process / verification
- **Affected:** `.github/workflows/ci.yml` (steps: typecheck/lint/test/build/audit/gitleaks — no a11y scan); `tests/` (22 suites, grep `axe|jest-axe|accessib` → none); `axe-core` present only transitively under `eslint-plugin-jsx-a11y`.
- **Description:** The only static a11y enforcement is the `next/core-web-vitals` jsx-a11y rule subset at lint time. There is no runtime axe/lighthouse/pa11y scan, no jest-axe component tests, and no evidence of a manual screen-reader/keyboard pass across the 19 routes. Therefore many runtime AA behaviors are **unverified**: focus order on dynamically inserted content, SR announcement of live updates, reflow at 320px / 400% zoom (1.4.10), text spacing (1.4.12), target size 24px (2.5.8, new in 2.2), focus-not-obscured by the sticky topbar/sidebar (2.4.11, new in 2.2), dragging alternatives (2.5.7), redundant entry (3.3.7), consistent help (3.2.6), and the real rendered contrast of opacity-over-gradient surfaces (see F-02 caveat).
- **Impact:** Unknown number of additional AA defects; cannot certify the gate.
- **WCAG:** Process gap covering 1.4.10, 1.4.12, 2.4.11, 2.5.7, 2.5.8, 3.2.6, 3.3.7 (verification).
- **Recommended fix:** Add `@axe-core/playwright` (or `jest-axe`) smoke across all 19 routes to CI; commission one manual NVDA/VoiceOver + keyboard-only pass; record results here before release.
- **Status:** UNKNOWN — blocked on a manual axe + screen-reader + keyboard audit (and a clean committed tree). · **Owner:** QA/Frontend · **Residual risk:** Medium–High until run.

---

## Items requiring a manual pass (explicitly UNKNOWN — needed to clear the gate)
1. **axe-core scan of all 19 routes** (contrast over gradients/video, ARIA validity, names/roles).
2. **Screen-reader pass** (NVDA + VoiceOver): dialog/drawer/tab/toast announcements, command palette, form errors, dynamic store updates.
3. **Keyboard-only pass**: full reachability/operability, focus order, no traps, visible focus on every interactive element, modal focus-restore (F-06).
4. **WCAG 2.2-new SCs**: 2.4.11 Focus Not Obscured (sticky topbar/sidebar), 2.5.8 Target Size (≥24px) on small icon controls, 2.5.7 Dragging, 3.2.6 Consistent Help, 3.3.7 Redundant Entry, 3.3.8 Accessible Authentication.
5. **Reflow/zoom**: 320px width and 400% zoom (1.4.10), 1.4.12 text spacing.
6. **Effective contrast** of `/40`–`/80`-opacity status surfaces over the page gradient (resolves the F-02 caveat).

---

## Verdict

**Gate 3 — accessibility part: FAIL.**
Reasons: open WCAG 2.2 **AA** defects (F-01 status messages, F-02 status-system contrast), one **Level A** defect (F-03 autoplay video, no pause), reduced-motion gaps (F-04/F-05), focus-management gaps (F-06/F-07), and — decisively — **the mandatory manual axe + screen-reader + keyboard audit has not been performed** (F-11), so the runtime surface is UNKNOWN. No CRITICAL/HIGH accessibility issues found; the baseline is genuinely strong, and the fixes are well-scoped and mostly centralizable (design-token contrast, one focus-restore mirror, framer-motion `MotionConfig`, live regions, a combobox refactor, and a video reduced-motion guard). Re-audit on a clean committed tree after fixes + the manual pass.
