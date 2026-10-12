-- Preserve every original field and snapshot before adding optional helpers.
lock table public.ledger_states in share row exclusive mode;
create table private.ledger_helpers_backup (
  organization_id uuid primary key,
  revision bigint not null,
  document jsonb not null,
  backed_up_at timestamptz not null default now()
);
alter table private.ledger_helpers_backup enable row level security;
revoke all on private.ledger_helpers_backup from public, anon, authenticated;
insert into private.ledger_helpers_backup (organization_id, revision, document)
select organization_id, revision, document from public.ledger_states;

create or replace function private.enforce_ledger_rate_snapshots()
returns trigger language plpgsql set search_path = '' as $$
declare
  item jsonb;
  helpers numeric;
  normalized_entries jsonb := '[]'::jsonb;
begin
  if tg_op = 'UPDATE' then
    if new.document->>'version' is distinct from '10' then
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
    normalized_entries := normalized_entries || jsonb_build_array(item);
  end loop;
  new.document := new.document || jsonb_build_object('version', 10, 'entries', normalized_entries);
  return new;
end;
$$;
revoke all on function private.enforce_ledger_rate_snapshots() from public, anon, authenticated;

-- The trigger supplies helperCount:0, retains frozen prices, and upgrades version.
update public.ledger_states set document = document || '{"version":10}'::jsonb,
  revision = revision + 1, updated_at = now();

-- Any changed business field aborts the complete transaction, including backup.
do $$
declare item record; restored jsonb;
begin
  for item in select s.document as current_doc, b.document as backup_doc
    from public.ledger_states s join private.ledger_helpers_backup b using (organization_id) loop
    restored := item.current_doc || jsonb_build_object('version', item.backup_doc->'version',
      'entries', (select coalesce(jsonb_agg(x.value - 'helperCount' order by x.ordinality), '[]'::jsonb)
        from jsonb_array_elements(item.current_doc->'entries') with ordinality x));
    if restored is distinct from item.backup_doc then raise exception 'helpers_migration_changed_existing_data'; end if;
    if exists (select 1 from jsonb_array_elements(item.current_doc->'entries') x where x->>'helperCount' is distinct from '0') then
      raise exception 'existing_helpers_must_default_to_zero';
    end if;
  end loop;
end;
$$;
