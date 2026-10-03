# N-desk session probe rotation (2026-10-03)

refreshSessionHealthForList sliced Map-order candidates (limit 5), so first desks stuck at sessionHealthy=false monopolized every GET probe budget; later desks stayed null → Floor "LinkedIn unverified" forever.

Fix: sort by sessionProbedAt ascending (never-probed = 0 first) before slice.
