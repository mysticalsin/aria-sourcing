# LinkedIn operator guide (source of truth)

**Updated:** 2026-09-09  
**Status:** Production LinkedIn messaging uses **OpenBot Browser Computer** on **Fly only**.

## Happy path (one story)

1. Connect email + pick an LLM (Settings → Get started).
2. Intake → create a campaign → source candidates.
3. Campaign → **Agents** → attach a **LinkedIn Browser Computer** seat.
4. **Take control** (fullscreen) → log into LinkedIn once (2FA if needed) → **Release**.
5. Turn **dry-run off** (Approval & Compliance) when you intend live contact.
6. Outreach → **Approve** → **Send** (Automatic). Aria drives the seat’s Chromium.
7. If login/checkpoint returns → Attention shows **Needs LinkedIn login** → Take control again.

## What Automatic means

- **Automatic** = after human approval, Aria queues `linkedin_send` on the entitled Browser Computer (or legacy Vendor API seat if configured).
- **Manual** = opt-in paste/confirm path (`409 manual-required`).
- Approval is always required. Automatic never bypasses the human gate.
- Never set `COMPUTER_SUPERVISOR_MOCK_SEND=1` in production.

## Anti-bot posture (honest)

Aria reduces ban risk with **caps, warmup, min-gap + jitter, business hours, durable Chrome profiles, human-like typing, and session health gates**.

Aria does **not** ship stealth fingerprint spoofing, residential proxy farms, or “unbannable” guarantees. LinkedIn ToS risk remains; operators must stay conservative.

## Demoted / advanced

- Vendor API (`LINKEDIN_VENDOR_*`) — optional legacy adapter.
- Assisted-manual paste — Manual delivery mode only.
- OIDC “Sign in with LinkedIn” — identity helper, not the send path.

## Stale docs

If another doc says “LinkedIn cannot auto-send” or “assisted-manual only,” treat **this file** as newer. Prefer OpenBot Automatic on Fly.
