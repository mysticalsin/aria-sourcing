\set ON_ERROR_STOP on

-- migrate.sh invokes this file directly as supabase_admin after every bundled
-- base migration. The owner transaction splits role credentials and secures
-- owner-local defaults before the database opens its network listener.
\ir /opt/aria/supabase-admin-reconciliation.sql

-- Restore the pinned image's normal logging policy only after every
-- secret-bearing statement has committed successfully. If reconciliation
-- fails, migrate.sh exits and the init-complete marker is never written.
alter system reset log_statement;
alter system reset log_min_error_statement;
alter system reset log_parameter_max_length_on_error;
select pg_reload_conf();
