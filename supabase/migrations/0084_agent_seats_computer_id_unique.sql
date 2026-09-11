-- 0084_agent_seats_computer_id_unique.sql
--
-- One Chromium profile / OpenBot bot id per seat. Prevents two seats from
-- silently sharing computer_id (which collapses N agents onto one VM).

create unique index if not exists agent_seats_workspace_computer_id_uniq
  on public.agent_seats (workspace_id, computer_id)
  where computer_id is not null;
