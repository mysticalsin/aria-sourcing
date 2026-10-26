# Decide what to do with tables of removed features

Status: needs-triage

Migrations were deliberately left untouched during the cleanup. Tables and
functions for removed features remain: agent frameworks / agent_specs /
agent_runs / agent memory, swarm, loop jobs, Apollo enrichment receipts,
Seamless/Sillage, WhatsApp (contacts, templates, inbound, delivery events),
Databricks connections. No route reads them.

Options: (a) keep as-is (zero risk, schema noise), (b) add a forward migration
that drops them, (c) squash migrations into a fresh baseline before the Azure
deployment. Needs an owner decision; (c) fits best with the Terraform work.
