-- ============================================================================
-- Hermes Sourcing — Gate 5: tenant-isolation hardening
--
-- This migration is the authoritative RLS control layer. It:
--   1. Revokes anon / PUBLIC access from every application table (closes the
--      Supabase default "all public tables readable with the anon key" gap).
--   2. Re-asserts least-privilege grants for the `authenticated` role.
--   3. Re-enables RLS on all tables (idempotent).
--   4. Replaces or confirms all per-table policies with comments.
--   5. Tightens the fleet tables (agent_seats, suppression_list, outreach_ledger):
--      - members read; admins write — replaces the generic "all rw" shortcut.
--      - outreach_ledger is an append-only audit trail: no DELETE policy, and the
--        authenticated role's UPDATE is column-restricted to (status, reason) so
--        the identifying/audit columns can never be rewritten; only operators
--        (admin/member) may advance status — viewers cannot tamper with it.
--   6. workspace_state writes are role-gated. The UPDATE WITH CHECK (missing in
--      0001) blocks re-pointing a row's workspace_id to a foreign workspace, and
--      INSERT/UPDATE now require an operator role (admin/member) so a read-only
--      viewer can no longer overwrite the shared tenant state document.
--   7. Re-asserts that api_keys.secret and email_connections tokens are never
--      readable by authenticated; service-role is the only access path for secrets.
--
-- Safe to re-run: all policy drops are IF EXISTS; ALTER TABLE ... ENABLE ROW
-- LEVEL SECURITY is idempotent; REVOKE on a privilege not held is a no-op.
-- Run AFTER 0004_email_connections.sql.
-- ============================================================================


-- ============================================================================
-- SECTION 1 — Revoke anon / PUBLIC access
-- In Supabase the anon role (used with the public API key, no JWT) inherits the
-- PostgreSQL PUBLIC pseudo-role's default privileges. We strip everything here
-- so that zero table data is reachable without a valid authenticated JWT.
-- ============================================================================

revoke all on public.workspaces        from anon, public;
revoke all on public.profiles          from anon, public;
revoke all on public.workspace_state   from anon, public;
revoke all on public.agent_seats       from anon, public;
revoke all on public.suppression_list  from anon, public;
revoke all on public.outreach_ledger   from anon, public;
-- api_keys and email_connections have column-level grants set by 0003/0004;
-- fully revoke first so the column-scoped re-grants below remain canonical.
revoke all on public.api_keys          from anon, public;
revoke all on public.email_connections from anon, public;


-- ============================================================================
-- SECTION 2 — Least-privilege grants for the `authenticated` role
-- Every permission is explicit and minimal. Where column-level grants are
-- required (api_keys.secret, email_connections tokens) they are re-asserted
-- below alongside the relevant table's policy block.
-- ============================================================================

-- workspaces: read-only. All writes go through ensure_workspace() (SECURITY DEFINER).
grant select on public.workspaces to authenticated;

-- profiles: CRUD on own row only. No DELETE — profiles are removed only via
-- the auth.users cascade (ON DELETE CASCADE on the FK).
grant select, insert, update on public.profiles to authenticated;

-- workspace_state: upsert for workspace members (read + seed + update).
grant select, insert, update on public.workspace_state to authenticated;

-- agent_seats: full CRUD; policies below restrict to own workspace + admin-only writes.
grant select, insert, update, delete on public.agent_seats to authenticated;

-- suppression_list: full CRUD; policies below restrict to own workspace + admin-only writes.
grant select, insert, update, delete on public.suppression_list to authenticated;

-- outreach_ledger: append-only audit trail. The authenticated role may read,
-- insert, and perform a COLUMN-RESTRICTED update of only (status, reason) — the
-- delivery-state reconciliation (claimed → sent/skipped) the send route performs
-- under the caller's JWT (src/app/api/outreach/send/route.ts). The identifying
-- audit columns (workspace_id, candidate_id, candidate_email, seat_id,
-- campaign_id, channel, at) carry NO update privilege, so history cannot be
-- rewritten. No DELETE grant — purges require the service-role client (bypasses
-- RLS) and must never be a client-callable operation. The revoke first drops any
-- previously granted table-wide UPDATE so only the column-scoped grant remains.
revoke update on public.outreach_ledger from authenticated;
grant select, insert on public.outreach_ledger to authenticated;
grant update (status, reason) on public.outreach_ledger to authenticated;

-- api_keys: column-level grant withholds `secret` from authenticated.
-- The service-role client (server-side only, SUPABASE_SERVICE_ROLE_KEY) reads
-- `secret` for validation; that access bypasses RLS intentionally.
grant select (id, workspace_id, name, provider, last4, status, last_tested_at, created_by, created_at)
  on public.api_keys to authenticated;
grant insert, update, delete on public.api_keys to authenticated;

-- email_connections: column-level grant withholds access_token + refresh_token.
grant select (id, workspace_id, seat_id, provider, account_email, scope, connected_at, updated_at)
  on public.email_connections to authenticated;
grant insert, update, delete on public.email_connections to authenticated;


-- ============================================================================
-- SECTION 3 — Confirm RLS is enabled (idempotent; already set by 0001–0004)
-- ============================================================================

alter table public.workspaces        enable row level security;
alter table public.profiles          enable row level security;
alter table public.workspace_state   enable row level security;
alter table public.agent_seats       enable row level security;
alter table public.suppression_list  enable row level security;
alter table public.outreach_ledger   enable row level security;
alter table public.api_keys          enable row level security;
alter table public.email_connections enable row level security;


-- ============================================================================
-- SECTION 4 — workspaces
-- Members may read their own workspace record.
-- No INSERT / UPDATE / DELETE policy exists by design: direct DML is blocked
-- by RLS (no policy ⇒ no access); workspace creation runs exclusively through
-- ensure_workspace() which is SECURITY DEFINER and bypasses RLS.
-- ============================================================================

-- A workspace member reads only the record they are assigned to.
-- current_workspace_id() is SECURITY DEFINER to avoid recursive RLS on profiles.
drop policy if exists "members read workspace" on public.workspaces;
create policy "members read workspace"
  on public.workspaces for select
  using (id = public.current_workspace_id());


-- ============================================================================
-- SECTION 5 — profiles
-- A user owns exactly one row (their own). workspace_id and role are immutable
-- from the client: the insert policy requires both to be absent/default, and
-- the update policy pins them to their current stored values.
-- ============================================================================

-- Read: a user sees only their own profile row.
drop policy if exists "own profile read" on public.profiles;
create policy "own profile read"
  on public.profiles for select
  using (id = auth.uid());

-- Insert: the client may only create a row for itself, with no workspace assignment
-- and with the default 'member' role. ensure_workspace() then assigns the workspace.
drop policy if exists "own profile insert" on public.profiles;
create policy "own profile insert"
  on public.profiles for insert
  with check (
    id           = auth.uid()
    and workspace_id is null   -- workspace must be assigned by ensure_workspace(), not the client
    and role     = 'member'    -- no self-promotion at insert time
  );

-- Update: a user may update their own row only when workspace_id and role are
-- unchanged. IS NOT DISTINCT FROM handles NULL equality correctly.
-- This blocks both tenant-hopping (changing workspace_id to another org's id)
-- and privilege escalation (self-assigning 'admin').
drop policy if exists "own profile update" on public.profiles;
create policy "own profile update"
  on public.profiles for update
  using (id = auth.uid())
  with check (
    id           = auth.uid()
    and workspace_id is not distinct from public.current_workspace_id()  -- no tenant-hop
    and role     is not distinct from public.current_profile_role()      -- no self-elevation
  );

-- No DELETE policy: profile deletion is cascaded only from auth.users (FK).


-- ============================================================================
-- SECTION 6 — workspace_state
-- One JSONB document per workspace (the entire shared application store). Every
-- member may READ it, but only operators (admin/member) may PERSIST it: a
-- read-only viewer must not be able to overwrite the shared tenant state. The
-- UPDATE WITH CHECK was missing in 0001; it is added here to prevent a client
-- from replacing a row's workspace_id with a foreign value.
-- No DELETE policy: the document cannot be wiped from the client.
-- ============================================================================

-- Members (any role, incl. viewer) may read their workspace's persisted state document.
drop policy if exists "members read state" on public.workspace_state;
create policy "members read state"
  on public.workspace_state for select
  using (workspace_id = public.current_workspace_id());

-- Operators may seed the state document for their workspace (first-time write).
-- Viewers are read-only and cannot create the shared document.
drop policy if exists "members insert state" on public.workspace_state;
create policy "members insert state"
  on public.workspace_state for insert
  with check (
    workspace_id = public.current_workspace_id()
    and public.current_profile_role() in ('admin', 'member')  -- not viewer (read-only)
  );

-- Operators may update their workspace's state. The role predicate stops a
-- read-only viewer from overwriting the shared document (intra-tenant authz
-- bypass), and the WITH CHECK ensures the row's workspace_id cannot be silently
-- re-pointed to a foreign tenant during the update.
drop policy if exists "members update state" on public.workspace_state;
create policy "members update state"
  on public.workspace_state for update
  using     (
    workspace_id = public.current_workspace_id()              -- may only touch own workspace row
    and public.current_profile_role() in ('admin', 'member')  -- not viewer (read-only)
  )
  with check (
    workspace_id = public.current_workspace_id()              -- row must still belong to own workspace after write
    and public.current_profile_role() in ('admin', 'member')
  );


-- ============================================================================
-- SECTION 7 — agent_seats
-- Replaces the broad "agent_seats rw" (FOR ALL) shortcut from 0002 with
-- scoped policies: any workspace member reads; only admins write.
-- ============================================================================

-- Drop the 0002 catch-all before adding scoped replacements.
drop policy if exists "agent_seats rw" on public.agent_seats;

-- Any workspace member may read the fleet's seat configuration.
drop policy if exists "members read agent_seats" on public.agent_seats;
create policy "members read agent_seats"
  on public.agent_seats for select
  using (workspace_id = public.current_workspace_id());

-- Only admins may provision a new agent seat in the workspace fleet.
drop policy if exists "admins insert agent_seats" on public.agent_seats;
create policy "admins insert agent_seats"
  on public.agent_seats for insert
  with check (
    workspace_id                  = public.current_workspace_id()
    and public.current_profile_role() = 'admin'
  );

-- Only admins may reconfigure a seat (daily_limit, warmup, persona, etc.).
-- WITH CHECK prevents moving a seat to a different workspace mid-update.
drop policy if exists "admins update agent_seats" on public.agent_seats;
create policy "admins update agent_seats"
  on public.agent_seats for update
  using  (workspace_id = public.current_workspace_id() and public.current_profile_role() = 'admin')
  with check (workspace_id = public.current_workspace_id());

-- Only admins may delete a seat (triggers ON DELETE SET NULL on outreach_ledger.seat_id).
drop policy if exists "admins delete agent_seats" on public.agent_seats;
create policy "admins delete agent_seats"
  on public.agent_seats for delete
  using (workspace_id = public.current_workspace_id() and public.current_profile_role() = 'admin');


-- ============================================================================
-- SECTION 8 — suppression_list
-- Replaces the 0002 "suppression_list rw" catch-all. Members read; admins write.
-- ============================================================================

drop policy if exists "suppression_list rw" on public.suppression_list;

-- Any workspace member may read the suppression list (required for pre-send checks).
drop policy if exists "members read suppression_list" on public.suppression_list;
create policy "members read suppression_list"
  on public.suppression_list for select
  using (workspace_id = public.current_workspace_id());

-- Only admins may add entries (opt-out, block-list).
drop policy if exists "admins insert suppression_list" on public.suppression_list;
create policy "admins insert suppression_list"
  on public.suppression_list for insert
  with check (
    workspace_id                  = public.current_workspace_id()
    and public.current_profile_role() = 'admin'
  );

-- Only admins may update entries (e.g., extend expires_at, change reason).
-- WITH CHECK prevents moving an entry to another workspace's suppression list.
drop policy if exists "admins update suppression_list" on public.suppression_list;
create policy "admins update suppression_list"
  on public.suppression_list for update
  using  (workspace_id = public.current_workspace_id() and public.current_profile_role() = 'admin')
  with check (workspace_id = public.current_workspace_id());

-- Only admins may remove a suppression entry.
drop policy if exists "admins delete suppression_list" on public.suppression_list;
create policy "admins delete suppression_list"
  on public.suppression_list for delete
  using (workspace_id = public.current_workspace_id() and public.current_profile_role() = 'admin');


-- ============================================================================
-- SECTION 9 — outreach_ledger
-- Replaces the 0002 "outreach_ledger rw" catch-all. The ledger is an append-only
-- audit trail: members may read and insert (claim_and_record is SECURITY DEFINER
-- and also inserts here). UPDATE is doubly constrained against audit tampering:
--   (a) the SECTION 2 column-level grant limits the writable columns to
--       (status, reason) — the identifying audit columns are immutable; and
--   (b) the policy below restricts UPDATE to operators (admin/member), so a
--       read-only viewer cannot flip status to free a de-dupe slot.
-- The only legitimate mutation is the delivery-state reconciliation
-- (claimed → sent / skipped). No DELETE policy exists at this level — deletes
-- require the service-role client and are never a normal client operation.
-- ============================================================================

drop policy if exists "outreach_ledger rw" on public.outreach_ledger;

-- Members may read their workspace's full outreach history (campaign reporting, dedup checks).
drop policy if exists "members read outreach_ledger" on public.outreach_ledger;
create policy "members read outreach_ledger"
  on public.outreach_ledger for select
  using (workspace_id = public.current_workspace_id());

-- Members may insert a ledger entry for their workspace only.
-- Normal path is via claim_and_record() (SECURITY DEFINER); direct insert allowed
-- for server-side route handlers that write 'skipped' entries on provider failure.
drop policy if exists "members insert outreach_ledger" on public.outreach_ledger;
create policy "members insert outreach_ledger"
  on public.outreach_ledger for insert
  with check (workspace_id = public.current_workspace_id());

-- Operators (admin/member) may advance status (e.g., 'claimed' → 'sent' /
-- 'skipped') for own workspace rows. The SECTION 2 column-level grant already
-- limits the writable columns to (status, reason); this policy additionally
-- excludes read-only viewers (who could otherwise flip status to free a de-dupe
-- slot and bypass the anti-double-contact guardrail). WITH CHECK prevents
-- re-pointing a row to another workspace on update.
drop policy if exists "members update outreach_ledger" on public.outreach_ledger;
create policy "members update outreach_ledger"
  on public.outreach_ledger for update
  using     (
    workspace_id = public.current_workspace_id()
    and public.current_profile_role() in ('admin', 'member')  -- not viewer (read-only)
  )
  with check (
    workspace_id = public.current_workspace_id()
    and public.current_profile_role() in ('admin', 'member')
  );

-- No DELETE policy: the ledger is permanent from the client's perspective.
-- Service-role purges (GDPR erasure, data retention) bypass RLS by design.


-- ============================================================================
-- SECTION 10 — api_keys
-- service-role is the only path to `secret`.
-- authenticated role sees only metadata columns (column-level grant above).
-- Workspace members read metadata; only admins manage key lifecycle.
-- ============================================================================

-- Members see key metadata to verify which providers are configured.
-- The `secret` column is excluded from the authenticated role's SELECT grant,
-- so it never appears in query results regardless of RLS outcome.
drop policy if exists "members read keys" on public.api_keys;
create policy "members read keys"
  on public.api_keys for select
  using (workspace_id = public.current_workspace_id());
-- Access path for `secret`: server-side only via getServiceSupabase()
-- (src/lib/supabase/server.ts). The service-role client bypasses RLS and can
-- read the full row. It must never be exposed to client components.

-- Only admins may store a new API key for the workspace.
drop policy if exists "admins insert keys" on public.api_keys;
create policy "admins insert keys"
  on public.api_keys for insert
  with check (
    workspace_id                  = public.current_workspace_id()
    and public.current_profile_role() = 'admin'
  );

-- Only admins may update key metadata (e.g., status after a test, name rename).
-- WITH CHECK prevents moving a key to a different workspace.
drop policy if exists "admins update keys" on public.api_keys;
create policy "admins update keys"
  on public.api_keys for update
  using  (workspace_id = public.current_workspace_id() and public.current_profile_role() = 'admin')
  with check (workspace_id = public.current_workspace_id());

-- Only admins may revoke (delete) a key.
drop policy if exists "admins delete keys" on public.api_keys;
create policy "admins delete keys"
  on public.api_keys for delete
  using (workspace_id = public.current_workspace_id() and public.current_profile_role() = 'admin');


-- ============================================================================
-- SECTION 11 — email_connections
-- access_token and refresh_token are excluded from the authenticated role's
-- SELECT grant (column-level, set above). service-role reads tokens server-side
-- for OAuth refresh and sending. Members see connection metadata only;
-- only admins manage connections.
-- ============================================================================

-- Members may see which seats have an active email connection (no token columns).
drop policy if exists "members read email_connections" on public.email_connections;
create policy "members read email_connections"
  on public.email_connections for select
  using (workspace_id = public.current_workspace_id());
-- Token access path: server-side only via getServiceSupabase() in route handlers.
-- access_token and refresh_token are stripped from authenticated queries by the
-- column-level grant above; service-role bypasses RLS and reads the full row.

-- Only admins may link an email account to a seat.
drop policy if exists "admins insert email_connections" on public.email_connections;
create policy "admins insert email_connections"
  on public.email_connections for insert
  with check (
    workspace_id                  = public.current_workspace_id()
    and public.current_profile_role() = 'admin'
  );

-- Only admins may refresh / update connection tokens or metadata.
-- Typically executed by a server-side OAuth callback route using service-role;
-- the policy provides defense-in-depth for any authenticated-role path.
drop policy if exists "admins update email_connections" on public.email_connections;
create policy "admins update email_connections"
  on public.email_connections for update
  using  (workspace_id = public.current_workspace_id() and public.current_profile_role() = 'admin')
  with check (workspace_id = public.current_workspace_id());

-- Only admins may disconnect a seat's email connection.
drop policy if exists "admins delete email_connections" on public.email_connections;
create policy "admins delete email_connections"
  on public.email_connections for delete
  using (workspace_id = public.current_workspace_id() and public.current_profile_role() = 'admin');


-- ============================================================================
-- End of Gate 5 — tenant-isolation hardening
-- ============================================================================
