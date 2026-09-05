# Computer supervisor (OpenBot sandbox / VM)

In-process MVP lives in `src/lib/computer-supervisor.ts` and is driven by:

- `LinkedIn Browser Computer` seats via `src/lib/linkedin-channel.ts`
- Fleet UI: Observe / Take control (closed by default)
- API: `GET/POST /api/fleet/computers`

**Product default:** Automatic LinkedIn outreach uses this OpenBot path — not LinkedIn OIDC and not Vendor API. Operators log into LinkedIn inside the sandbox via Fleet → Computers → Observe / Take control.

## Contract

- **1 seat = 1 Chromium computer** (persistent `profileVolume`)
- **decide → audit → act**; bot actions **refuse** while `control === "human"`
- Login/2FA raises `help_requested` — operator opens Observe / Take control
- Contact permission is **never** decided here — Postgres `claim_contact` is sole authority

## Connect OpenBot to Aria

1. Run your OpenBot computer supervisor (isolated Chromium seats / VMs).
2. In Aria → API keys, save the supervisor bearer token under provider **Computer Supervisor**.
3. In Settings → LinkedIn credentials, paste the supervisor base URL and attach that vault key.
4. In LinkedIn connections, click **Create OpenBot Browser Computer seat**.
5. Open Fleet → Computers → Observe / Take control and complete LinkedIn login / 2FA inside the sandbox.
6. Keep Delivery mode on **Automatic** — approved LinkedIn messages dispatch through the supervisor into that seat’s computer.

Env fallback (optional; Settings vault is preferred):

```bash
COMPUTER_SUPERVISOR_URL=https://computers.your-openbot-host.example
COMPUTER_SUPERVISOR_TOKEN=...
COMPUTER_SUPERVISOR_MOCK_SEND=1   # local tests only — never on production
```

When `COMPUTER_SUPERVISOR_URL` is unset, jobs queue locally and automatic send
fails closed unless `COMPUTER_SUPERVISOR_MOCK_SEND=1`.

## Scale notes (N computers)

| Concurrent computers | Rough RAM |
| --- | --- |
| 2–5 | ~2–8 Gi |
| 20 | ~20–40 Gi |
| 100 | ~100–200 Gi (plan gVisor / dedicated pool) |

Start with N=2–5 on Fly/Docker; do not share one browser across seats.
