-- Provider-run tables deliberately have no direct service/browser table grant.
-- Expose only the workspace-bound identity needed by the legacy status route.
create function public.read_sourcing_provider_run(p_workspace_id uuid, p_external_run_id text)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, pg_temp as $$
declare binding jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    return jsonb_build_object('ok',false,'reason','service-only');
  end if;
  if p_workspace_id is null or p_external_run_id is null or length(p_external_run_id) not between 1 and 200 then
    return jsonb_build_object('ok',false,'reason','invalid_request');
  end if;
  select jsonb_build_object('external_run_id',external_run_id,'dataset_id',dataset_id,'campaign_id',campaign_id)
    into binding from public.sourcing_provider_runs
    where workspace_id = p_workspace_id and provider = 'Apify' and external_run_id = p_external_run_id;
  if binding is null then return jsonb_build_object('ok',false,'reason','not_found'); end if;
  return jsonb_build_object('ok',true,'run',binding);
end $$;
revoke all on function public.read_sourcing_provider_run(uuid,text) from public, anon, authenticated;
grant execute on function public.read_sourcing_provider_run(uuid,text) to service_role;
