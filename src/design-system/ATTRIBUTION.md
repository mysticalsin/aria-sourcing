# Aria design system — attribution and licence

Read-only survey on 20 November 2026. No commit was pushed to these repositories, and none of their files were modified.

| Repo | Ref read | Head |
|---|---|---|
| mysticalsin/vision | `main` | `d9e049a92d9b3a1930cc4ff5744706fca5d1b2c3` |
| mysticalsin/athena | `main` | `8270672e2b3a5bbc0045e4a8340b430150eafbb2` |
| mysticalsin/bidstack-360 (Polo) | `demo` (default branch) | `0ddf0a52a576172111049351477228dd94189d04` |
| Azure DevOps `VibeApps` / `manager-cards` | not read | The Azure DevOps connection reported ready, then `core_list_projects` and `search_code` timed out (`MCP -32001`). No manager-dashboard component was copied. |

## Licence

GitHub reports `license: null` for vision, athena, and bidstack-360. vision and athena are private. bidstack-360 is public and has no `LICENSE` file. All three sit under the GitHub user `mysticalsin` (Tony Walteur), the same owner as this repository.

This directory is an internal adaptation for Aria. It is not a sublicence, and it is not a claim that the source apps are open source. Patterns were rewritten in this folder. Product logic (CRM opportunities, video libraries, interview rooms) was not copied. Polo ADR 0002 keeps BidStack blue `#2c4bff` for that product, so those hex values are not used here.

Athena's stylesheet says its dark canvas follows an internal Atlas visual language (`atlas@1913d12`), with Atlas violet replaced by steel and ice. This gallery adapts Athena's already-adapted tokens (dark surfaces, status chips that carry a word, segmented radios, score ring). Atlas source was not opened and was not copied.

Carlito is already shipped in this repo under `public/fonts/carlito/` (SIL OFL 1.1, see `OFL.txt`).

## Inventory

The gallery renders the same rows as `inventory.ts`.

| Component | Source | Adapted how |
|---|---|---|
| Tokens | vision `apps/web/src/styles/tokens.css`; athena `src/ui/styles.css`; aria `src/styles/globals.css` | Mantu purple `#6600AE` / `#7F00DA`, yellow `#F8F060`, navy `#1A0033` / `#2B0058`. Athena dark canvas. Yellow is a button fill with navy text. Contrast pairs are tested. |
| Theme | Polo `apps/web/src/stores/theme.ts`, `docs/adr/0002-design-tokens.md`; Vision `.dark` | Colour swaps. Geometry does not. No zustand, no localStorage. |
| Chart colours | Polo `apps/web/src/components/charts/chartTokens.ts` | `--ds-chart-1` … `--ds-chart-8`. Retinted. |
| Sparkline | Polo `Sparkline.tsx`; aria `trend-spark.tsx` | Same min/max polyline. Decorative. |
| Funnel | aria `funnel-chart.tsx`; Polo `PipelineByStageCard.tsx` | SVG bars plus a hidden data table. No Recharts. |
| Columns | Polo `CartesianCharts.tsx` | Seven-day synthetic draft counts. |
| Score ring | Athena `.cover-ring` and `.score` | SVG ring. Suggestion only. No emotion score. |
| KPI card | Polo `KpiCard.tsx`, `KpiRow.tsx`; aria `metric-card.tsx` | Figure, worded delta, sparkline. Final value is in the HTML. |
| Filter bar | Vision `FilterBar.tsx` | Native selects, live count, clear. |
| Table | Athena `.list`; Vision `ShareTable.tsx`; Polo `chartShared.tsx` `DataTable` | Caption and `scope="col"`. |
| Candidate card | Polo `PipelineCard.tsx` | Initials, score, skills, `example.test` mail. No photo. |
| Pipeline | Polo `StageColumn.tsx`, `PipelineCard.tsx` | To Rate, To Assess, To Interview, Shoot, QM, To Hire, Hired. Arrows move one stage. Hired is refused. |
| Segmented control | Athena `.seg` | Real radios. Theme, and Manual / Full automatic. |
| Approval panel | Build plan §13. New. | Exact message and SHA-256. Manual is the default. |
| Odoo sync chip | Athena `.chip` | Icon and words: Synced to Odoo, Odoo sync pending, Odoo sync failed, Only in Aria. |
| Buttons | Athena `.btn`; Vision primary colour | 44px target. Yellow pill on dark, purple pill on light. |
| Manager dashboard | Azure DevOps `VibeApps/manager-cards` | Not read. Nothing copied. |

## What this folder does not do

It is not imported by the existing console pages. `/design-system` is a standalone gallery: the shell, the workspace provider, and the login gate treat it as a public page, and the product navigation does not link to it. Another change can adopt these components in the console.
