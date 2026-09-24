create schema if not exists private;

revoke all on schema private from public;
grant usage on schema private to authenticated;

alter function public.default_ledger_document() set schema private;
alter function public.is_organization_member(uuid) set schema private;
alter function public.can_manage_organization(uuid) set schema private;
alter function public.is_organization_owner(uuid) set schema private;
alter function public.consume_rate_limit(text, integer, integer) set schema private;
alter function public.handle_new_user() set schema private;

revoke all on function private.default_ledger_document() from public, anon, authenticated;
revoke all on function private.consume_rate_limit(text, integer, integer) from public, anon, authenticated;
revoke all on function private.handle_new_user() from public, anon, authenticated;
revoke all on function private.is_organization_member(uuid) from public, anon;
revoke all on function private.can_manage_organization(uuid) from public, anon;
revoke all on function private.is_organization_owner(uuid) from public, anon;

grant execute on function private.is_organization_member(uuid) to authenticated;
grant execute on function private.can_manage_organization(uuid) to authenticated;
grant execute on function private.is_organization_owner(uuid) to authenticated;

create or replace function public.save_ledger_state(
  new_document jsonb,
  expected_revision bigint
)
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  target_organization_id uuid;
  current_role public.app_role;
  next_revision bigint;
begin
  if current_user_id is null then
    raise exception 'authentication_required' using errcode = 'P0001';
  end if;

  select membership.organization_id, membership.role
  into target_organization_id, current_role
  from public.organization_members membership
  where membership.user_id = current_user_id
  order by membership.created_at
  limit 1;

  if target_organization_id is null then
    raise exception 'organization_not_found' using errcode = 'P0001';
  end if;

  if current_role not in ('owner', 'manager') then
    raise exception 'insufficient_permissions' using errcode = 'P0001';
  end if;

  if jsonb_typeof(new_document) <> 'object'
    or jsonb_typeof(new_document -> 'drivers') <> 'array'
    or jsonb_typeof(new_document -> 'entries') <> 'array'
    or jsonb_typeof(new_document -> 'trips') <> 'array'
    or jsonb_typeof(new_document -> 'settings') <> 'object'
    or jsonb_typeof(new_document -> 'rates') <> 'object'
    or octet_length(new_document::text) > 1048576 then
    raise exception 'invalid_ledger_document' using errcode = 'P0001';
  end if;

  perform private.consume_rate_limit('ledger_write', 60, 60);

  update public.ledger_states
  set document = new_document,
      revision = revision + 1,
      updated_by = current_user_id,
      updated_at = now()
  where organization_id = target_organization_id
    and revision = expected_revision
  returning revision into next_revision;

  if next_revision is null then
    raise exception 'revision_conflict' using errcode = 'P0001';
  end if;

  return next_revision;
end;
$$;

revoke all on function public.save_ledger_state(jsonb, bigint) from public, anon;
grant execute on function public.save_ledger_state(jsonb, bigint) to authenticated;

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_organization_id uuid;
  account_name text;
begin
  account_name := coalesce(
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
    'Driver Ledger'
  );

  insert into public.profiles (id, email, display_name)
  values (new.id, new.email, account_name)
  on conflict (id) do update
    set email = excluded.email,
        display_name = excluded.display_name,
        updated_at = now();

  insert into public.organizations (name, created_by)
  values (account_name || ' — Driver Ledger', new.id)
  returning id into new_organization_id;

  insert into public.organization_members (organization_id, user_id, role)
  values (new_organization_id, new.id, 'owner');

  insert into public.ledger_states (organization_id, document, updated_by)
  values (new_organization_id, private.default_ledger_document(), new.id);

  return new;
end;
$$;

revoke all on function private.handle_new_user() from public, anon, authenticated;

drop policy if exists "organizations_select_member" on public.organizations;
drop policy if exists "organizations_update_manager" on public.organizations;
drop policy if exists "members_select_same_organization" on public.organization_members;
drop policy if exists "members_insert_owner" on public.organization_members;
drop policy if exists "members_update_owner" on public.organization_members;
drop policy if exists "members_delete_owner" on public.organization_members;
drop policy if exists "ledger_select_member" on public.ledger_states;
drop policy if exists "ledger_insert_manager" on public.ledger_states;
drop policy if exists "ledger_update_manager" on public.ledger_states;

create policy "organizations_select_member"
  on public.organizations for select to authenticated
  using ((select private.is_organization_member(id)));

create policy "organizations_update_manager"
  on public.organizations for update to authenticated
  using ((select private.can_manage_organization(id)))
  with check ((select private.can_manage_organization(id)));

create policy "members_select_same_organization"
  on public.organization_members for select to authenticated
  using ((select private.is_organization_member(organization_id)));

create policy "members_insert_owner"
  on public.organization_members for insert to authenticated
  with check ((select private.is_organization_owner(organization_id)));

create policy "members_update_owner"
  on public.organization_members for update to authenticated
  using ((select private.is_organization_owner(organization_id)))
  with check ((select private.is_organization_owner(organization_id)));

create policy "members_delete_owner"
  on public.organization_members for delete to authenticated
  using ((select private.is_organization_owner(organization_id)));

create policy "ledger_select_member"
  on public.ledger_states for select to authenticated
  using ((select private.is_organization_member(organization_id)));

create policy "ledger_insert_manager"
  on public.ledger_states for insert to authenticated
  with check ((select private.can_manage_organization(organization_id)));

create policy "ledger_update_manager"
  on public.ledger_states for update to authenticated
  using ((select private.can_manage_organization(organization_id)))
  with check ((select private.can_manage_organization(organization_id)));

create policy "rate_limits_deny_all"
  on public.rate_limit_windows for all
  to anon, authenticated
  using (false)
  with check (false);

create index organizations_created_by_idx on public.organizations(created_by);
create index ledger_states_updated_by_idx on public.ledger_states(updated_by);

