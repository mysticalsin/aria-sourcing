-- ============================================================================
-- Hermes Sourcing — initial schema
-- Shared-org workspace model. Each org (by email domain) has one workspace and
-- one JSONB state document. RLS scopes all access to the caller's workspace.
-- Run in the Supabase SQL editor (or `supabase db push`).
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---- Tables ----------------------------------------------------------------

create table if not exists public.workspaces (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  allowed_domain text unique,
  created_at     timestamptz not null default now()
);

create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text,
  full_name    text,
  workspace_id uuid references public.workspaces(id) on delete set null,
  role         text not null default 'member',
  created_at   timestamptz not null default now()
);

create table if not exists public.workspace_state (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  state        jsonb not null default '{}'::jsonb,
  updated_at   timestamptz not null default now()
);

-- ---- Row Level Security ----------------------------------------------------

alter table public.workspaces       enable row level security;
alter table public.profiles         enable row level security;
alter table public.workspace_state  enable row level security;

-- SECURITY DEFINER helper avoids recursive RLS when policies reference profiles.
create or replace function public.current_workspace_id()
returns uuid
language sql stable security definer set search_path = public as $$
  select workspace_id from public.profiles where id = auth.uid();
$$;

-- profiles: a user owns their own row
drop policy if exists "own profile read"   on public.profiles;
drop policy if exists "own profile insert" on public.profiles;
drop policy if exists "own profile update" on public.profiles;
create policy "own profile read"   on public.profiles for select using (id = auth.uid());
create policy "own profile insert" on public.profiles for insert with check (id = auth.uid());
create policy "own profile update" on public.profiles for update using (id = auth.uid());

-- workspaces: members may read their workspace
drop policy if exists "members read workspace" on public.workspaces;
create policy "members read workspace" on public.workspaces for select
  using (id = public.current_workspace_id());

-- workspace_state: members may read + write their workspace's document
drop policy if exists "members read state"   on public.workspace_state;
drop policy if exists "members insert state" on public.workspace_state;
drop policy if exists "members update state" on public.workspace_state;
create policy "members read state"   on public.workspace_state for select
  using (workspace_id = public.current_workspace_id());
create policy "members insert state" on public.workspace_state for insert
  with check (workspace_id = public.current_workspace_id());
create policy "members update state" on public.workspace_state for update
  using (workspace_id = public.current_workspace_id());

-- ---- Bootstrap: find-or-create org workspace by email domain ---------------

create or replace function public.ensure_workspace()
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  uid    uuid := auth.uid();
  uemail text;
  domain text;
  wid    uuid;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;

  select email into uemail from auth.users where id = uid;
  domain := lower(split_part(coalesce(uemail, 'user@workspace'), '@', 2));
  if domain = '' then domain := 'workspace'; end if;

  -- already provisioned?
  select workspace_id into wid from public.profiles where id = uid;
  if wid is not null then
    return wid;
  end if;

  -- shared org workspace, keyed by domain
  select id into wid from public.workspaces where allowed_domain = domain;
  if wid is null then
    insert into public.workspaces(name, allowed_domain)
      values (initcap(domain) || ' Workspace', domain)
      returning id into wid;
  end if;

  insert into public.profiles(id, email, full_name, workspace_id)
    values (uid, uemail, split_part(coalesce(uemail, 'user'), '@', 1), wid)
    on conflict (id) do update
      set workspace_id = excluded.workspace_id, email = excluded.email;

  return wid;
end;
$$;

grant execute on function public.ensure_workspace()     to authenticated;
grant execute on function public.current_workspace_id() to authenticated;

-- keep updated_at fresh on state writes
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists workspace_state_touch on public.workspace_state;
create trigger workspace_state_touch
  before update on public.workspace_state
  for each row execute function public.touch_updated_at();
