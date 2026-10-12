-- Additive only: no ledger documents, revision numbers, or pricing snapshots are changed.
create table if not exists private.ledger_realtime_backup (
  organization_id uuid primary key,
  document jsonb not null,
  revision bigint not null,
  backed_up_at timestamptz not null default now()
);
alter table private.ledger_realtime_backup enable row level security;
revoke all on private.ledger_realtime_backup from public, anon, authenticated;
insert into private.ledger_realtime_backup (organization_id, document, revision)
select organization_id, document, revision from public.ledger_states
on conflict do nothing;

-- Clients receive revision notices only, never full ledger records over Broadcast.
-- Only the database sends notifications; no client INSERT policy is granted.
create policy ledger_broadcast_members
on realtime.messages for select to authenticated
using (
  extension = 'broadcast'
  and topic = (select realtime.topic())
  and exists (
    select 1 from public.organization_members membership
    where membership.user_id = (select auth.uid())
      and 'ledger:' || membership.organization_id::text = (select realtime.topic())
  )
);

create or replace function private.notify_ledger_revision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then return new; end if;
  if not private.is_organization_member(new.organization_id) then return new; end if;
  perform realtime.send(
    jsonb_build_object('revision', new.revision),
    'ledger_changed',
    'ledger:' || new.organization_id::text,
    true
  );
  return new;
exception when others then
  -- Notification availability must not prevent a valid financial record save.
  -- Clients reconcile again on foreground/reconnect and have a slow fallback check.
  raise warning 'ledger_notification_failed';
  return new;
end;
$$;
revoke all on function private.notify_ledger_revision() from public, anon, authenticated;

create trigger ledger_revision_broadcast
after update on public.ledger_states
for each row when (new.revision is distinct from old.revision)
execute function private.notify_ledger_revision();
