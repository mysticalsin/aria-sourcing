# Skip no-remoteUrl session probes (2026-10-03)

Desks with empty remoteUrl stayed never-probed (probeSession clears probedAt), won rotation sort forever, and consumed limit=5 so real Floor desks never re-probed.

Fix: candidate filter requires trimmed remoteUrl.
