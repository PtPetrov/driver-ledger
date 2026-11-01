-- Snapshot existing documents before installing validation. No ledger rows change.
create table private.ledger_distance_backup (
  organization_id uuid primary key,
  revision bigint not null,
  document jsonb not null,
  backed_up_at timestamptz not null default now()
);
alter table private.ledger_distance_backup enable row level security;
revoke all on private.ledger_distance_backup from public, anon, authenticated;
insert into private.ledger_distance_backup (organization_id, revision, document)
select organization_id, revision, document from public.ledger_states;

-- Version 10 remains readable until a version 11 client saves. After that,
-- reject old writers so they cannot silently erase distance fields.
create or replace function private.enforce_ledger_rate_snapshots()
returns trigger language plpgsql set search_path = '' as $$
declare
  item jsonb;
  helpers numeric;
  meters numeric;
  incoming_version text := new.document->>'version';
  normalized_entries jsonb := '[]'::jsonb;
begin
  if tg_op = 'UPDATE' then
    if incoming_version not in ('10', '11') or incoming_version is null
      or (old.document->>'version' = '11' and incoming_version <> '11') then
      raise exception 'stale_ledger_client' using errcode = 'P0001';
    end if;
    new.document := private.freeze_ledger_rates(new.document, old.document);
  else
    new.document := private.freeze_ledger_rates(new.document, '{}'::jsonb);
  end if;
  for item in select value from jsonb_array_elements(new.document->'entries') loop
    if not (item ? 'helperCount') then item := item || '{"helperCount":0}'::jsonb; end if;
    if jsonb_typeof(item->'helperCount') is distinct from 'number' then
      raise exception 'invalid_helper_count' using errcode = 'P0001';
    end if;
    helpers := (item->>'helperCount')::numeric;
    if helpers < 0 or helpers > 1000 or helpers <> trunc(helpers)
      or (helpers > 0 and item->>'rateItemId' = 'none') then
      raise exception 'invalid_helper_count' using errcode = 'P0001';
    end if;
    if item ? 'distanceMeters' then
      if jsonb_typeof(item->'distanceMeters') is distinct from 'number' then
        raise exception 'invalid_distance' using errcode = 'P0001';
      end if;
      meters := (item->>'distanceMeters')::numeric;
      if meters < 0 or meters > 100000 or meters <> trunc(meters)
        or (meters > 0 and (incoming_version is distinct from '11' or coalesce(item->>'rateItemId', '') not in
          ('address-loading', 'address-delivery', 'packing-furniture', 'loading-packed', 'unpacking', 'blanket-packing', 'aerofol-packing', 'carton-packing'))) then
        raise exception 'invalid_distance' using errcode = 'P0001';
      end if;
    elsif incoming_version = '11' then
      item := item || '{"distanceMeters":0}'::jsonb;
    end if;
    normalized_entries := normalized_entries || jsonb_build_array(item);
  end loop;
  new.document := new.document || jsonb_build_object('version', case when incoming_version = '11' then 11 else 10 end, 'entries', normalized_entries);
  return new;
end;
$$;
revoke all on function private.enforce_ledger_rate_snapshots() from public, anon, authenticated;

