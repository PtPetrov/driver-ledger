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
  actor_user_id uuid := auth.uid();
  target_organization_id uuid;
  actor_member_role public.app_role;
  next_revision bigint;
begin
  if actor_user_id is null then
    raise exception 'authentication_required' using errcode = 'P0001';
  end if;

  select membership.organization_id, membership.role
  into target_organization_id, actor_member_role
  from public.organization_members membership
  where membership.user_id = actor_user_id
  order by membership.created_at
  limit 1;

  if target_organization_id is null then
    raise exception 'organization_not_found' using errcode = 'P0001';
  end if;

  if actor_member_role not in ('owner'::public.app_role, 'manager'::public.app_role) then
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
      updated_by = actor_user_id,
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
