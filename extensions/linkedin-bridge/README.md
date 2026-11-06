# ARIA LinkedIn Bridge (experimental Chrome extension)

Syncs your LinkedIn inbox into ARIA (`/linkedin`) and sends the messages you
write there, from your own LinkedIn session in this browser. Full design,
risks and troubleshooting: [docs/linkedin-bridge.md](../../docs/linkedin-bridge.md).

LinkedIn's User Agreement forbids automated access. Use it on your own
account, knowing LinkedIn may restrict it.

## Install

1. ARIA side: `LINKEDIN_BRIDGE_ENABLED=true` in `.env.local`, restart the app.
2. ARIA -> **LinkedIn** -> **Connect the extension** -> copy the code.
3. Chrome -> `chrome://extensions` -> Developer mode -> **Load unpacked** ->
   this folder.
4. Extension popup: ARIA address (default `http://localhost:3000`), paste the
   code, **Save**. Stay signed in to linkedin.com in this Chrome profile.

## Files

- `background.js`: polls ARIA every minute, runs the tasks in a LinkedIn tab.
- `allowlist.js`: the only LinkedIn requests it will run.
- `queries.js`: reads LinkedIn's current GraphQL query ids from its own
  messaging requests.
- `popup.html`, `popup.js`: settings and status.
- `package.json`: lets the Node tests import these modules; Chrome ignores it.

Permissions: `cookies` (to see that a LinkedIn session exists and to set
LinkedIn's CSRF header; cookie values never leave the browser), `scripting`
(to run the request inside the LinkedIn tab), `webRequest` (to read query
ids), `alarms`, `storage`. Hosts: www.linkedin.com and localhost; a remote
ARIA is asked for on save.
