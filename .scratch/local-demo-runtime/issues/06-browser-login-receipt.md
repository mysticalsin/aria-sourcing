# Connected Docker browser acceptance
Status: ready-for-human
Type: task

CI run 40488342062 at f97f203d passed Quality, dependency audit, database security,
secret scan and CodeQL. The initial waitForURL failure was first attributed to
login; the later exact stack proves it occurs after Create campaign. Direct
Auth login, browser login and the Settings readiness check all passed.

The next run authenticates the fixture account through the direct Auth API first
and records only response statuses, failed request origins/paths, final path and
cookie metadata on a browser failure. Cookie/token/password values are excluded.
Run 40496031702 reaches scripts/accept-local-demo.mjs:109 after Create campaign.
The bundled sample omitted employmentType, so the existing readiness gate refused
creation. The sample JD now explicitly says Full-time and has a readiness
regression test. No validation rule was bypassed. A real Linux receipt now passes on 0be6b3ca (CI 40498433529).
No Docker or WSL installation on the owner's current Windows machine.

The next observed small-viewport dialog defect was fixed by portalling modals to
body, bounding their height and scrolling internally. Docker acceptance now
passes the full refresh/restart/credential-decryption journey without bypassing
readiness, authority or clickability checks. Owner-machine review is still
optional; no Windows Docker/WSL installation was attempted.

Confirmed again on final code 43b9db34: CI 40499885119 completed SUCCESS,
including Local Docker demo and the full release gate.
