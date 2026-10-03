# Poll Hermes computerId local-only (2026-10-03)

Floor/Fleet/Agents/LinkedIn GET polls called `updateSeat({computerId})` which PATCHed agent_seats — racing reclaim/ensure persist and could null a just-bound desk.

Fix: `applyFleetHermesComputerPatches` (store) + `applyHermesComputerPatchesToSeats` (pure) — local commit only.
