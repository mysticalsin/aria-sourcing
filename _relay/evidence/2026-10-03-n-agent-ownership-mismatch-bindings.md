# ownership-mismatch binding re-poison (2026-10-03)

GET `/api/fleet/computers` cleared poisoned `agent_seats.computer_id` in DB then still mapped `campaignSeats`/`browserSeatBindings` from the pre-clear seats snapshot — Floor ingest wrote the foreign id back.

Fix: `clearedPoisonedComputerIds` Set; force `computerId: null` in both binding maps.
Contract: computer-supervisor 130/130.
