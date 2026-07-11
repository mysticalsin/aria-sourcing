-- The pinned Supabase migrate.sh interpolates its bootstrap password into an
-- ALTER ROLE statement before role-level logging policy exists. Suppress DDL
-- and error-statement logging for the complete first-init window. The post-init
-- reconciliation resets both settings before the server accepts network work.
alter system set log_statement = 'none';
alter system set log_min_error_statement = 'panic';
alter system set log_parameter_max_length_on_error = 0;
select pg_reload_conf();
