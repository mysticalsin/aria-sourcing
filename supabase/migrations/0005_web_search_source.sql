-- A third reviewed source per run: public LinkedIn profiles found through
-- Claude's web search, next to LinkedIn (Apify) and GitHub.
alter table public.campaign_sourcing_jobs drop constraint campaign_sourcing_jobs_steps_check;
alter table public.campaign_sourcing_jobs add constraint campaign_sourcing_jobs_steps_check
  check (jsonb_typeof(steps) = 'array' and jsonb_array_length(steps) between 1 and 3);
