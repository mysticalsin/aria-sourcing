# LinkedIn channel position — send-only until vendor inbound exists

**Date:** 2026-08-25  
**Status:** interim product position (L-5)

Until a contracted messaging vendor exposes a signed inbound webhook that ARIA
can treat with the same untrusted-data envelope as WhatsApp:

1. LinkedIn **outbound** may use `assisted-manual` (working) or `vendor-api`
   (fail-closed without `LINKEDIN_VENDOR_*`).
2. LinkedIn **inbound replies are out of band** — operators read and respond in
   LinkedIn; ARIA does not correlate LinkedIn reply webhooks.
3. No scraper, session reuse, or first-party LinkedIn automation.

When vendor inbound lands: add `/api/webhooks/linkedin`, reuse disclosure/
injection sanitization from WhatsApp inbound, and reconcile via
`record_linkedin_delivery_outcome` / delivery_reconcile jobs.
