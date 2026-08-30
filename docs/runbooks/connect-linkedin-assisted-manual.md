# Connect LinkedIn messaging (assisted-manual)

Aria does **not** log into LinkedIn. Connecting LinkedIn means enabling a
fleet seat so drafts → human paste → confirm works end-to-end.

## Steps

1. Sign in as workspace **admin**.
2. **Settings → Integrations → Connect my LinkedIn**.
3. Enter an operator label (your name/handle — not a password).
4. Click **Validate**.
5. On Outreach: approve a LinkedIn draft → Copy → Open profile → paste/send in
   LinkedIn → **Confirm** in Aria.

## APIs

| Method | Path | Purpose |
|---|---|---|
| GET/POST | `/api/linkedin/connections` | List / ensure assisted-manual seat + inbound route_key |
| POST | `/api/linkedin/test` | Validate seat (no call to linkedin.com) |
| POST | `/api/outreach/confirm-manual` | Durable ledger after human send |
| POST | `/api/webhooks/linkedin` | Vendor inbound replies (HMAC) |

## Env (optional vendor)

```
LINKEDIN_VENDOR_API_URL=
LINKEDIN_VENDOR_API_KEY=
LINKEDIN_INBOUND_WEBHOOK_SECRET=
```

Migration **0058** required for inbound routes + assisted confirm RPC.
