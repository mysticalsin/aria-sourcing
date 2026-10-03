# N-agent floor / FE↔BE gaps — tip audit follow-up

**Source hunt:** `_relay/evidence/2026-10-03-n-agent-floor-febe-gaps.md` (explore at 10a4cb6)

## Closed on tip (this shift)

| Gap | Fix |
|---|---|
| ready+healthy+sends idle→sourcing (disabled / no campaigns) | `floor.ts`: never upgrade idle base; keep base.state only when already working |
| cortex inherits poisoned sourcing | fixed via floor |
| disabled+sends becomes PacketFX ceo | fixed via floor + floor.mts asserts |
| Attributed N-desk pulse blocked on idle healthy | `floor/page.tsx`: idle+healthy+seatId pulse may walk |

## Still blocked

- Owner Fly tip SHA (`21a42e7` stale) + LI healthy
