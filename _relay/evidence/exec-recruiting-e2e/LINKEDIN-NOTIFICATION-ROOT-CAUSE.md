# LinkedIn notification miss — root cause (exec)

**Date:** 2026-09-11  
**Audience:** Mantu exec review  
**Live app:** https://aria-mantu-app.fly.dev (build `8ea3370…`, tip not released)

## What you asked

Why didn’t a LinkedIn notification show up, and can we prove recruiting end-to-end?

## Short answer

Most outreach runs **never delivered a LinkedIn action** because the Browser Computer session was **unhealthy / on a login wall**. Aria correctly refused to invent a successful send. A separate earlier Connect invite to Tony Walteur **did** land (Sent today + Pending on profile) — that surfaces under **My Network → Invitations**, not Messaging. Direct Message was blocked (3rd+ needs InMail).

## Ranked causes

1. **LinkedIn Browser Computer session unhealthy** (primary, live today)  
   Ops Floor shows `LinkedIn session unhealthy` on durable VM `comp_7fe31958-…` / `VM …3bf53ff5`. Fleet: **0 sends today**. Without `sessionHealthy=true` after human Take control + login/2FA + Release, Connect/Message cannot complete → **no recipient notification**.

2. **Wrong notification surface**  
   Successful path is **Connect + note**, not Message. Recipient looks in **My Network → Invitations** (and email prefs). Messaging will not ping for a connection invite. Message path was blocked: “3rd+ relationship — Premium InMail”.

3. **Invite note > 200 characters**  
   LinkedIn free-tier greys out Send at **200** chars. We previously truncated at 280; a 229-char draft left Send disabled (zero delivery). Tip now truncates at **200** and refuses to claim success if Send is disabled or Sent/Pending proof is missing (`src/lib/openbot/linkedin-send.ts`).

4. **UI “delivered” vs LinkedIn truth**  
   Older mock/dry-run paths could look green while Fly audit showed login wall / `act_failed`. Do not treat Aria green as a phone notification.

5. **Already Pending**  
   If an invite is already Pending, LinkedIn will not fire a fresh invite notification on retry.

## Proof artifacts

| Artifact | What it shows |
|---|---|
| `/opt/cursor/artifacts/aria-exec-recruiting-e2e-walkthrough.mp4` (~6.7 min) | Live Fly walkthrough: need → JD → strategy → scores → drafts → Agents → Floor → unhealthy LI session |
| `_relay/evidence/exec-recruiting-e2e/*.png` | Still frames of each step |
| `tonywalteur_invite_sent_proof.jpg` | Sent invitations: Tony Walteur “Sent today” + note ≤200 |
| `tonywalteur_profile_pending_proof.jpg` | Profile Pending after invite |

## How to get a real notification next

1. Fleet / Agents → **Take control** on durable Browser Computer  
2. Human LinkedIn login + 2FA → **Release**  
3. `session_probe` / UI must show **healthy** (never invent)  
4. Send Connect with note **≤200 chars**  
5. Prove: Sent invitations + profile **Pending**; tell recipient to check **My Network → Invitations**

## Product fix shipped on tip (not yet on Fly)

- Invite note hard-cap **200** + fail closed if Send disabled  
- Require Sent/Pending UI proof before `ok: true`  
- Campaign Hermes clear-foreign + ownership fail-closed (prior commits on branch)
