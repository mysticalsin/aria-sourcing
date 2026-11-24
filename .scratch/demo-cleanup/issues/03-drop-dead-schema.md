# Decide what to do with tables of removed features

Status: done

Migrations were deliberately left untouched during the cleanup. Tables and
functions for removed features remain: agent frameworks / agent_specs /
agent_runs / agent memory, swarm, loop jobs, Apollo enrichment receipts,
Seamless/Sillage, WhatsApp (contacts, templates, inbound, delivery events),
Databricks connections. No route reads them.

Options: (a) keep as-is (zero risk, schema noise), (b) add a forward migration
that drops them, (c) squash migrations into a fresh baseline before the Azure
deployment. Needs an owner decision; (c) fits best with the Terraform work.

## Resolution (2026-10-26)

Owner chose a clean restart. `8650e9a8` replaces the 53 migrations with `supabase/migrations/0001_baseline.sql` (retired tables dropped) plus `0002`. Contract: `tests/schema-baseline-contract.mts`.
