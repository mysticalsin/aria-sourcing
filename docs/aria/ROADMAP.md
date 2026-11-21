# Aria roadmap

Open items only. Each item names the public pull request that holds the work today. **In review** means the change is on an open pull request and is not on `twa-odoo`. Nothing here is a merge instruction. The integration branch (#208) is a test vehicle and stays unmerged.

## System of record

- Load one stage spec from the Odoo addon into the Rust core and the Go stage package. Today the addon spec (#176) allows one step back between adjacent non-terminal stages. The Rust core (#170) and the Go package (#171) are forward-only. Hired already requires a contract and a DNA status of `integrated` or `complete` on each copy.
- Serve the Go API against Odoo. The process in review (#171) serves an in-memory fake and refuses live mode. The JSON-2 client is tested with an in-memory round tripper.
- Stop outreach touches after Hired. Stress case A5 on #208 hired with a contract and a DNA pass, then the in-memory service still stored touches (#171).
- Show Odoo stages, the Hired refusal, opt-out, and erasure from the console. The click run found none of those controls in the Next.js shell (#176, #208).

## Ranking and models

- Keep the Rust ranker as a suggestion and call it from the console path that still uses TypeScript scoring on `twa-odoo` (#170).
- Point the model router at a live provider. The module in review (#169) ships fake providers and does not open a network connection.
- Run the fairness audit on a real ranking export. The tool in review (#180) reads a JSON file, uses a fake scorer in tests, and does not drop candidates.

## Outreach

- Use one approval encoding. The database hashes (#167), the Rust hash (#170), and the Go channel token (#175) are three specifications.
- Make the Go QC verdict the checker the ledger consults. The ledger still uses its stub (#167). The seven-check gate (#185) does not import the ledger.
- Finish cap ownership. The caller-supplied cap is replaced by the configuration row on a branch stacked on the ledger (#182).
- Add a human resume after HeyReach auto-pause. The pause store can pause and can report paused (#175). Stress case A3 stayed paused.
- Add a refresh call for the LinkedIn token channel, or record that refresh is out of scope. Expire, revoke, and log scrub already hold (#178).
- Surface manual approval, the manual/automatic control, the fake sink, HeyReach, and the kill switch on the outreach queue the click journey can open. Those clicks failed on #208. The underlying controls are in review on #167, #175, and #178.
- Confirm a manual candidate add in the console. The dialog accepted input and the list stayed empty (#208). CV ingest remains a worker (#174).

## Channels

- Remove the browser bridge, the campaign autopilot, and web-search sourcing (#168). They are still on `twa-odoo`.
- Keep HeyReach on the official API and off until `ARIA_HEYREACH_ENABLED` is set (#175).
- Keep the LinkedIn token channel off until an owner or admin records the risk notice (#178). The token stays encrypted, revocable, and out of logs. The design has no LinkedIn scraping and no login automation.
- Rebuild the CV ingest image. The recorded sweep could not build it (#174).

## Console

- Finish the feature-module split so a later Go API can sit behind the same client (#172). The client still reads the workspace snapshot.
- Compare the six quick-stat values with the rows under them. The labels rendered, and a first-run modal covered the numbers (#177).
- Decide whether the standalone design gallery (#173) is adopted by the console. It is not imported by the product pages.

## Interviewer

- Leave `ARIA_INTERVIEWER_ENABLED` off until a screening facade is available (#184). The adapter's recommendation stays advisory and does not change a stage.

## Hardening and dependencies

- Request-boundary hardening for the caller address, the model endpoint, the compose secret, and the gateway origins is in review (#201).
- The console framework dependency update is in review (#179).
- Rust CI on the scoring branch should resolve with the committed lockfile (#206).

## Tests still open

- Re-run `scripts/integration-e2e.sh` on #208 after the failed click journeys have an owning fix. The script is not on `twa-odoo`.
- Bring the packaged stack up far enough for the Odoo click path. The recorded sweep lost the Odoo database connection and fell back to a local Next.js process.
- Add a Markdown link check to CI if the repository wants one. Base CI does not have it. The README contract in review (#181) checks the root README only. The scan in [Testing](TESTING.md) covers this design set on this branch.

## Reading order

1. [Architecture](ARCHITECTURE.md)
2. [Pipeline](PIPELINE.md)
3. [Outreach safety](OUTREACH-SAFETY.md)
4. [Testing](TESTING.md)
