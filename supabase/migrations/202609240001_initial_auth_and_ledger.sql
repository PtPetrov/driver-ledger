create extension if not exists pgcrypto;

create type public.app_role as enum ('owner', 'manager', 'driver');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null default 'driver',
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create index organization_members_user_id_idx
  on public.organization_members(user_id, organization_id);

create table public.ledger_states (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  revision bigint not null default 0 check (revision >= 0),
  document jsonb not null,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint ledger_states_document_is_object check (jsonb_typeof(document) = 'object'),
  constraint ledger_states_document_size check (octet_length(document::text) <= 1048576)
);

create table public.rate_limit_windows (
  user_id uuid not null references auth.users(id) on delete cascade,
  action text not null check (char_length(action) between 1 and 80),
  window_started_at timestamptz not null,
  request_count integer not null default 1 check (request_count > 0),
  primary key (user_id, action, window_started_at)
);

create index rate_limit_windows_started_at_idx
  on public.rate_limit_windows(window_started_at);

create or replace function public.default_ledger_document()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'version', 1,
    'drivers', jsonb_build_array(
      jsonb_build_object('id', 'ni', 'name', 'NI', 'rate', 0.09, 'level', 'senior', 'color', '#62e6a7'),
      jsonb_build_object('id', 'di', 'name', 'DI', 'rate', 0.08, 'level', 'junior', 'color', '#ffb86b')
    ),
    'entries', '[]'::jsonb,
    'trips', '[]'::jsonb,
    'settings', jsonb_build_object(
      'vehicle', 'CB6514PP',
      'vehicleClass', 'up-to-8-8',
      'currency', 'EUR',
      'company', 'Финансов отчет 2026',
      'singleDriverKilometerRate', 0.17
    ),
    'rates', jsonb_build_object(
      'effectiveDate', '2026-01-01',
      'minimumBusiness', 20,
      'restPerDay', 70,
      'kilometer', jsonb_build_object(
        'up-to-8-8', jsonb_build_object('senior', 0.09, 'junior', 0.08),
        'up-to-11-99', jsonb_build_object('senior', 0.10, 'junior', 0.09)
      ),
      'activities', jsonb_build_array(
        jsonb_build_object('id', 'warehouse-loading', 'label', 'Товарене от склад на РОССИН-90', 'rate', 3, 'unit', 'm3', 'minimumApplies', true),
        jsonb_build_object('id', 'warehouse-unloading', 'label', 'Разтоварване в склад на РОССИН-90', 'rate', 3, 'unit', 'm3', 'minimumApplies', true),
        jsonb_build_object('id', 'agent-warehouse-loading', 'label', 'Товарене от склад на агент', 'rate', 3, 'unit', 'm3', 'minimumApplies', true),
        jsonb_build_object('id', 'agent-warehouse-unloading', 'label', 'Разтоварване в склад на агент', 'rate', 3, 'unit', 'm3', 'minimumApplies', true),
        jsonb_build_object('id', 'commercial-loading', 'label', 'Товарене на търговски пратки (линеен метър)', 'rate', 5, 'unit', 'linear_m'),
        jsonb_build_object('id', 'commercial-unloading', 'label', 'Разтоварване на търговски пратки (линеен метър)', 'rate', 5, 'unit', 'linear_m'),
        jsonb_build_object('id', 'address-loading', 'label', 'Товарене от адрес без разопаковане', 'rate', 9, 'unit', 'm3', 'minimumApplies', true),
        jsonb_build_object('id', 'address-delivery', 'label', 'Доставка до адрес без разопаковане', 'rate', 9, 'unit', 'm3', 'minimumApplies', true),
        jsonb_build_object('id', 'packing-furniture', 'label', 'Опаковане на мебели, дрехи и кашони PBO', 'rate', 11, 'unit', 'm3'),
        jsonb_build_object('id', 'loading-packed', 'label', 'Товарене на опаковани мебели, дрехи и кашони PBO', 'rate', 11, 'unit', 'm3'),
        jsonb_build_object('id', 'delivery', 'label', 'Доставка', 'rate', 12, 'unit', 'm3', 'minimumApplies', true),
        jsonb_build_object('id', 'unpacking', 'label', 'Разопаковане', 'rate', 12, 'unit', 'm3'),
        jsonb_build_object('id', 'blanket-packing', 'label', 'Опаковане с одеала', 'rate', 9, 'unit', 'm3'),
        jsonb_build_object('id', 'transfer-truck', 'label', 'Претоварване от камион в камион', 'rate', 3, 'unit', 'm3', 'minimumApplies', true),
        jsonb_build_object('id', 'transfer-van', 'label', 'Претоварване от/на бус', 'rate', 3, 'unit', 'm3', 'minimumApplies', true),
        jsonb_build_object('id', 'aerofol-packing', 'label', 'Опаковане с еврорап', 'rate', 17, 'unit', 'm3'),
        jsonb_build_object('id', 'carton-packing', 'label', 'Опаковане с кашони', 'rate', 17, 'unit', 'm3'),
        jsonb_build_object('id', 'hourly-loading', 'label', 'Допълнително товарене', 'rate', 5, 'unit', 'hour', 'minimumApplies', true),
        jsonb_build_object('id', 'hourly-unloading', 'label', 'Допълнително разтоварване', 'rate', 5, 'unit', 'hour', 'minimumApplies', true),
        jsonb_build_object('id', 'assembly', 'label', 'Сглобяване', 'rate', 0, 'unit', 'hour'),
        jsonb_build_object('id', 'disassembly', 'label', 'Разглобяване', 'rate', 0, 'unit', 'hour')
      )
    )
  );
$$;

create or replace function public.is_organization_member(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_members membership
    where membership.organization_id = target_organization_id
      and membership.user_id = (select auth.uid())
  );
$$;

create or replace function public.can_manage_organization(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_members membership
    where membership.organization_id = target_organization_id
      and membership.user_id = (select auth.uid())
      and membership.role in ('owner', 'manager')
  );
$$;

create or replace function public.is_organization_owner(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_members membership
    where membership.organization_id = target_organization_id
      and membership.user_id = (select auth.uid())
      and membership.role = 'owner'
  );
$$;

create or replace function public.consume_rate_limit(
  action_name text,
  maximum_requests integer default 60,
  window_seconds integer default 60
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  current_window timestamptz;
  new_count integer;
begin
  if current_user_id is null then
    raise exception 'authentication_required' using errcode = 'P0001';
  end if;

  if maximum_requests < 1 or window_seconds < 1 then
    raise exception 'invalid_rate_limit_configuration' using errcode = 'P0001';
  end if;

  current_window := to_timestamp(
    floor(extract(epoch from clock_timestamp()) / window_seconds) * window_seconds
  );

  insert into public.rate_limit_windows (user_id, action, window_started_at, request_count)
  values (current_user_id, action_name, current_window, 1)
  on conflict (user_id, action, window_started_at)
  do update set request_count = public.rate_limit_windows.request_count + 1
  returning request_count into new_count;

  if new_count > maximum_requests then
    raise exception 'rate_limit_exceeded' using errcode = 'P0001';
  end if;
end;
$$;

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

  perform public.consume_rate_limit('ledger_write', 60, 60);

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

create or replace function public.handle_new_user()
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
  values (new_organization_id, public.default_ledger_document(), new.id);

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.ledger_states enable row level security;
alter table public.rate_limit_windows enable row level security;

create policy "profiles_select_own"
  on public.profiles for select
  to authenticated
  using ((select auth.uid()) = id);

create policy "profiles_update_own"
  on public.profiles for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

create policy "organizations_select_member"
  on public.organizations for select
  to authenticated
  using ((select public.is_organization_member(id)));

create policy "organizations_update_manager"
  on public.organizations for update
  to authenticated
  using ((select public.can_manage_organization(id)))
  with check ((select public.can_manage_organization(id)));

create policy "members_select_same_organization"
  on public.organization_members for select
  to authenticated
  using ((select public.is_organization_member(organization_id)));

create policy "members_insert_owner"
  on public.organization_members for insert
  to authenticated
  with check ((select public.is_organization_owner(organization_id)));

create policy "members_update_owner"
  on public.organization_members for update
  to authenticated
  using ((select public.is_organization_owner(organization_id)))
  with check ((select public.is_organization_owner(organization_id)));

create policy "members_delete_owner"
  on public.organization_members for delete
  to authenticated
  using ((select public.is_organization_owner(organization_id)));

create policy "ledger_select_member"
  on public.ledger_states for select
  to authenticated
  using ((select public.is_organization_member(organization_id)));

create policy "ledger_insert_manager"
  on public.ledger_states for insert
  to authenticated
  with check ((select public.can_manage_organization(organization_id)));

create policy "ledger_update_manager"
  on public.ledger_states for update
  to authenticated
  using ((select public.can_manage_organization(organization_id)))
  with check ((select public.can_manage_organization(organization_id)));

revoke all on public.rate_limit_windows from anon, authenticated;
revoke all on function public.default_ledger_document() from public;
revoke all on function public.consume_rate_limit(text, integer, integer) from public;
revoke all on function public.save_ledger_state(jsonb, bigint) from public;
grant execute on function public.save_ledger_state(jsonb, bigint) to authenticated;
grant execute on function public.is_organization_member(uuid) to authenticated;
grant execute on function public.can_manage_organization(uuid) to authenticated;
grant execute on function public.is_organization_owner(uuid) to authenticated;
grant select on public.profiles, public.organizations, public.organization_members, public.ledger_states to authenticated;
grant update on public.profiles, public.organizations, public.organization_members, public.ledger_states to authenticated;
grant insert, delete on public.organization_members to authenticated;
