-- Non-destructive upgrade. Back up the original documents inside the private
-- schema; no customer data belongs in source control or migration files.
lock table public.ledger_states in share row exclusive mode;
create table private.ledger_rate_snapshot_backup (
  organization_id uuid primary key,
  revision bigint not null,
  document jsonb not null,
  backed_up_at timestamptz not null default now()
);
alter table private.ledger_rate_snapshot_backup enable row level security;
revoke all on private.ledger_rate_snapshot_backup from public, anon, authenticated;
insert into private.ledger_rate_snapshot_backup (organization_id, revision, document)
select organization_id, revision, document from public.ledger_states;

-- Pure JSON transformation: preserve every original field and array order.
-- Incoming snapshots are never trusted; existing prices come from the old row.
create function private.freeze_ledger_rates(incoming jsonb, previous jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare
  result jsonb := incoming;
  record_item jsonb;
  old_item jsonb;
  service_item jsonb;
  driver_item jsonb;
  snapshot jsonb;
  kilometer jsonb;
  trips_result jsonb := '[]'::jsonb;
  entries_result jsonb := '[]'::jsonb;
  old_trips jsonb;
  old_entries jsonb;
  vehicle_class text;
  driver_rate numeric;
begin
  select coalesce(jsonb_object_agg(x->>'id', x), '{}'::jsonb) into old_trips
  from jsonb_array_elements(coalesce(previous->'trips', '[]'::jsonb)) x;
  select coalesce(jsonb_object_agg(x->>'id', x), '{}'::jsonb) into old_entries
  from jsonb_array_elements(coalesce(previous->'entries', '[]'::jsonb)) x;

  for record_item in select value from jsonb_array_elements(incoming->'trips') loop
    old_item := old_trips->(record_item->>'id');
    if jsonb_typeof(old_item->'pricing') = 'object' then
      snapshot := old_item->'pricing';
    else
      kilometer := '{}'::jsonb;
      vehicle_class := coalesce(incoming#>>'{settings,vehicleClass}', 'up-to-8-8');
      for driver_item in select value from jsonb_array_elements(incoming->'drivers') loop
        driver_rate := case when jsonb_array_length(incoming->'drivers') = 1
          then (incoming#>>'{settings,singleDriverKilometerRate}')::numeric
          else coalesce((incoming->'rates'->'kilometer'->vehicle_class->>(driver_item->>'level'))::numeric, (driver_item->>'rate')::numeric) end;
        kilometer := kilometer || jsonb_build_object(driver_item->>'id', driver_rate);
      end loop;
      snapshot := jsonb_build_object('kilometer', kilometer, 'restPerDay', incoming#>'{rates,restPerDay}');
    end if;
    trips_result := trips_result || jsonb_build_array(record_item || jsonb_build_object('pricing', snapshot));
  end loop;

  for record_item in select value from jsonb_array_elements(incoming->'entries') loop
    old_item := old_entries->(record_item->>'id');
    if jsonb_typeof(old_item->'pricing') = 'object'
      and (old_item->>'rateItemId') is not distinct from (record_item->>'rateItemId') then
      snapshot := old_item->'pricing';
    else
      select value into service_item from jsonb_array_elements(incoming#>'{rates,activities}')
      where value->>'id' = record_item->>'rateItemId' limit 1;
      kilometer := '{}'::jsonb;
      vehicle_class := coalesce(record_item->>'vehicleClass', 'up-to-8-8');
      for driver_item in select value from jsonb_array_elements(incoming->'drivers') loop
        driver_rate := case when jsonb_array_length(incoming->'drivers') = 1
          then (incoming#>>'{settings,singleDriverKilometerRate}')::numeric
          else coalesce((incoming->'rates'->'kilometer'->vehicle_class->>(driver_item->>'level'))::numeric, (driver_item->>'rate')::numeric) end;
        kilometer := kilometer || jsonb_build_object(driver_item->>'id', driver_rate);
      end loop;
      snapshot := jsonb_build_object('kilometer', coalesce(old_item#>'{pricing,kilometer}', kilometer), 'service',
        case when service_item is null then null else jsonb_build_object(
          'id', service_item->'id', 'label', service_item->'label', 'unit', service_item->'unit', 'rate', service_item->'rate',
          'minimum', case when coalesce((service_item->>'minimumApplies')::boolean, false)
            then incoming#>'{rates,minimumBusiness}' else '0'::jsonb end
        ) end);
    end if;
    entries_result := entries_result || jsonb_build_array(record_item || jsonb_build_object('pricing', snapshot));
  end loop;
  result := result || jsonb_build_object('version', 9, 'trips', trips_result, 'entries', entries_result);
  return result;
end;
$$;
revoke all on function private.freeze_ledger_rates(jsonb, jsonb) from public, anon, authenticated;

-- Read-only assertions against synthetic documents. No customer records change.
do $$
declare
  original jsonb;
  changed jsonb;
  frozen jsonb;
  result jsonb;
begin
  original := private.default_ledger_document() || jsonb_build_object(
    'trips', '[{"id":"test-trip","totalKilometers":100,"restDays":1}]'::jsonb,
    'entries', '[{"id":"test-entry","rateItemId":"commercial-loading","quantity":0.5,"vehicleClass":"up-to-8-8"}]'::jsonb);
  frozen := private.freeze_ledger_rates(original, '{}'::jsonb);
  assert frozen#>>'{trips,0,pricing,kilometer,ni}' = '0.09', 'original km rate';
  assert frozen#>>'{trips,0,pricing,restPerDay}' = '70', 'original rest rate';
  assert frozen#>>'{entries,0,pricing,service,minimum}' = '0', 'linear metre minimum exempt';
  changed := jsonb_set(frozen, '{rates,restPerDay}', '140');
  changed := jsonb_set(changed, '{rates,kilometer,up-to-8-8,senior}', '0.25');
  changed := jsonb_set(changed, '{rates,activities}', (
    select jsonb_agg(x || jsonb_build_object('rate', 123)) from jsonb_array_elements(changed#>'{rates,activities}') x));
  -- Attempted snapshot overrides must be ignored for existing records.
  changed := jsonb_set(changed, '{trips,0,pricing,restPerDay}', '999');
  changed := jsonb_set(changed, '{entries,0,pricing,service,rate}', '999');
  result := private.freeze_ledger_rates(changed, frozen);
  assert result#>'{trips,0,pricing}' = frozen#>'{trips,0,pricing}', 'trip pricing is immutable';
  assert result#>'{entries,0,pricing}' = frozen#>'{entries,0,pricing}', 'service pricing is immutable';
  changed := jsonb_set(changed, '{trips,0,id}', '"new-trip"');
  changed := jsonb_set(changed, '{entries,0,id}', '"new-entry"');
  result := private.freeze_ledger_rates(changed, frozen);
  assert result#>>'{trips,0,pricing,restPerDay}' = '140', 'new trip rest rate';
  assert result#>>'{trips,0,pricing,kilometer,ni}' = '0.25', 'new trip km rate';
  assert result#>>'{entries,0,pricing,service,rate}' = '123', 'new service rate';
  changed := jsonb_set(changed, '{entries,0,rateItemId}', '"none"');
  result := private.freeze_ledger_rates(changed, frozen);
  assert result#>'{entries,0,pricing,service}' = 'null'::jsonb, 'client without service';
  changed := jsonb_set(result, '{entries,0,rateItemId}', '"commercial-loading"');
  result := private.freeze_ledger_rates(changed, result);
  assert result#>>'{entries,0,pricing,service,rate}' = '123', 'service added later uses current rate';
  assert private.freeze_ledger_rates(private.default_ledger_document(), '{}'::jsonb)->>'version' = '9', 'new account version';
end;
$$;

update public.ledger_states
set document = private.freeze_ledger_rates(document, '{}'::jsonb), revision = revision + 1, updated_at = now();

-- Abort the entire migration if any pre-existing business field was changed.
do $$
declare row_item record; restored jsonb;
begin
  for row_item in select s.document as current_doc, b.document as backup_doc
    from public.ledger_states s join private.ledger_rate_snapshot_backup b using (organization_id) loop
    restored := row_item.current_doc || jsonb_build_object(
      'version', row_item.backup_doc->'version',
      'trips', (select coalesce(jsonb_agg(x - 'pricing'), '[]'::jsonb) from jsonb_array_elements(row_item.current_doc->'trips') x),
      'entries', (select coalesce(jsonb_agg(x - 'pricing'), '[]'::jsonb) from jsonb_array_elements(row_item.current_doc->'entries') x));
    if restored is distinct from row_item.backup_doc then
      raise exception 'snapshot_migration_changed_existing_fields';
    end if;
  end loop;
end;
$$;

create function private.enforce_ledger_rate_snapshots()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if new.document->>'version' is distinct from '9' then
      raise exception 'stale_ledger_client' using errcode = 'P0001';
    end if;
    new.document := private.freeze_ledger_rates(new.document, old.document);
  else
    new.document := private.freeze_ledger_rates(new.document, '{}'::jsonb);
  end if;
  return new;
end;
$$;
revoke all on function private.enforce_ledger_rate_snapshots() from public, anon, authenticated;
create trigger enforce_ledger_rate_snapshots before insert or update of document
on public.ledger_states for each row execute function private.enforce_ledger_rate_snapshots();
