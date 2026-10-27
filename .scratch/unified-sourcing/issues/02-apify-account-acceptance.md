# Real Apify account acceptance
Status: ready-for-human
Type: task

2026-10-27 provider-only check:

- Token accepted with HTTP 200; the account matched the owner-supplied identity.
- Actor metadata and the bounded Short-mode input schema validated (HTTP 200).
- One actor run: sample Backend Go/Kubernetes, France, maxItems=3, takePages=1,
  API maxTotalChargeUsd=0.1, timeout=120 seconds. No automatic start retry.
- Provider status SUCCEEDED, but statusMessage is "free user run limit reached";
  dataset itemCount=0. This is a provider refusal, not an empty successful search.
- A read-only repeat poll used the same stored run and started no actor. The
  adapter now returns account_limit and the two source paths surface that failure.
- No candidate was retrieved, no outreach occurred and no workspace was modified.

The application runs only on the owner's other local machine, with no reachable
instance URL provided here. Save the key in that machine's Settings -> API Keys
-> Apify. Review the actor/account allowance in Apify before another paid run;
do not assume a subscription upgrade is the only remedy for a fresh account.

Credentials and the provider receipt are outside Git, under the current Windows
user's LocalAppData/ARIA. Credentials and the result payload use Windows DPAPI.
Do not copy token/account values or raw provider receipts into relay, tests, env
examples, logs or commits. No Docker/WSL was installed in this Windows session.
