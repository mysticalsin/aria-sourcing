# Computer supervisor (OpenBot-shaped)

In-process MVP lives in `src/lib/computer-supervisor.ts` and is driven by:

- `LinkedIn Browser Computer` seats via `src/lib/linkedin-channel.ts`
- Fleet UI: Observe / Take control (closed by default)
- API: `GET/POST /api/fleet/computers`

## Contract

- **1 seat = 1 Chromium computer** (persistent `profileVolume`)
- **decide → audit → act**; bot actions **refuse** while `control === "human"`
- Login/2FA raises `help_requested` — operator opens Observe / Take control
- Contact permission is **never** decided here — Postgres `claim_contact` is sole authority

## Remote spawn (optional)

Set:

```bash
COMPUTER_SUPERVISOR_URL=https://computers.internal
COMPUTER_SUPERVISOR_TOKEN=...
COMPUTER_SUPERVISOR_MOCK_SEND=1   # local tests only
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
