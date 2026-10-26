# Consolidate decision-maker reporting

Status: done

Owner requirement: a report on the number of candidates sourced, ROI, and
everything decision-makers need. Today this is spread across `/` (Command
Center), `/exec`, `/trust` (ROI calculator + compliance), `/reports`,
`/funnel` and `/winlog`.

Needs from the owner: which KPIs matter (e.g. candidates sourced per campaign
and per source, time-to-shortlist, reply rate, interviews booked, cost per hire,
time saved), the audience (recruiting lead, management), and whether an export
(PDF / CSV) is required.

## Resolution (2026-10-26)

Owner had no specific KPIs, so `6e6bf3cc` adds a decision report to `/exec`: period picker (7d/30d/90d/all), conversion funnel sourced → accepted meeting, recruiter hours and value saved, annualized return, PDF (print) and Markdown export. Assumptions shared with Trust & ROI via `src/lib/roi.ts`. Follow-up: `08-demo-seed-dates.md`.
