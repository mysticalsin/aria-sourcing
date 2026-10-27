# Docker browser login receipt
Status: ready-for-agent
Type: task

CI run 40488342062 at f97f203d passed Quality, dependency audit, database security,
secret scan and CodeQL. Local Docker demo failed at openSession's browser
waitForURL after clicking Sign in (30 seconds). No successful Compose/browser
acceptance receipt exists yet.

The next run authenticates the fixture account through the direct Auth API first
and records only response statuses, failed request origins/paths, final path and
cookie metadata on a browser failure. Cookie/token/password values are excluded.
Read these diagnostics, fix the observed cause, and rerun the unchanged acceptance
criteria. No Docker or WSL installation on the owner's current Windows machine.
