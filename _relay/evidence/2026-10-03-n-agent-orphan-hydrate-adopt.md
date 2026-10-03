# orphan-claim-blocked fleet 500 (2026-10-03)

GET hydrate only caught ownership-mismatch. When Map held computer as __orphan__ (host import) while DB had durable computer_id, hydrate threw computer-orphan-claim-blocked → whole /api/fleet/computers 500 → Floor wipe.

Fix: durableConflict includes orphan-claim-blocked; adoptDurableComputerBinding when !claimedByOtherSeat (GET + POST pre-hydrate).
