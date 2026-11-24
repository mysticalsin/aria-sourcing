# ARIA LinkedIn Bridge (experimental Chrome extension)

Syncs your LinkedIn inbox into ARIA (`/linkedin`) and sends the messages you
write there, from your own LinkedIn session in this browser. Full design,
risks and troubleshooting: [docs/linkedin-bridge.md](../../docs/linkedin-bridge.md).

LinkedIn's User Agreement forbids automated access. Use it on your own
account, knowing LinkedIn may restrict it.

## Install

1. ARIA side: `LINKEDIN_BRIDGE_ENABLED=true` in `.env.local`, restart the app.
2. Chrome -> `chrome://extensions` -> Developer mode -> **Load unpacked** ->
   this folder. After an update: click the extension's reload arrow there,
   then reload the ARIA tab.
3. ARIA -> **LinkedIn** -> **Connect in one click**. The page hands the
   pairing code to the extension. (ARIA elsewhere than
   `http://localhost:3000`: set its address in the popup's Settings first,
   or use **Use a pairing code instead** and paste it there.)
4. Stay signed in to linkedin.com in this Chrome profile.

## Files

- `background.js`: polls ARIA every minute (immediately when nudged), runs
  the tasks in a LinkedIn tab, keeps the toolbar badge (unread count).
- `allowlist.js`: the only LinkedIn requests it will run.
- `queries.js`: reads LinkedIn's current GraphQL query ids from its own
  messaging requests.
- `aria-page.js`: relay with the ARIA page (one-click pairing, send nudges,
  live mode, status). Acts only for the ARIA address set in the extension.
- `linkedin-page.js`: watches the LinkedIn tab title; when LinkedIn's unread
  count goes up, asks ARIA for an inbox refresh. Passive.
- `popup.html`, `popup.css`, `popup.js`: status, counters and settings.
- `icons/`: the ARIA mark.
- `package.json`: lets the Node tests import these modules; Chrome ignores it.

Permissions: `cookies` (to see that a LinkedIn session exists and to set
LinkedIn's CSRF header; cookie values never leave the browser), `scripting`
(to run the request inside the LinkedIn tab), `webRequest` (to read query
ids), `alarms`, `storage`. Hosts: www.linkedin.com and localhost; a remote
ARIA is asked for on save.
