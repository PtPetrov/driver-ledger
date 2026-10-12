-- Run inside a transaction and ROLLBACK. No committed messages or ledger changes.
do $$
declare
  actor uuid;
  org uuid;
  test_id uuid := gen_random_uuid();
  other_id uuid := gen_random_uuid();
  visible_count integer;
  before_document jsonb;
  before_revision bigint;
begin
  select user_id, organization_id into actor, org
  from public.organization_members where role in ('owner', 'manager') limit 1;
  if actor is null then raise exception 'test requires an existing organization'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub',actor,'role','authenticated')::text,true);
  perform set_config('realtime.topic','ledger:'||org::text,true);
  insert into realtime.messages(id,topic,extension,event,payload,private,skip_broadcast)
  values(test_id,'ledger:'||org::text,'broadcast','sync_permission_test','{}',true,true),
        (other_id,'ledger:'||gen_random_uuid()::text,'broadcast','sync_permission_test','{}',true,true);
  perform set_config('role','authenticated',true);
  select count(*) into visible_count from realtime.messages where id in(test_id,other_id);
  if visible_count <> 1 then raise exception 'member policy must expose only own topic'; end if;
  perform set_config('realtime.topic','ledger:'||gen_random_uuid()::text,true);
  select count(*) into visible_count from realtime.messages where id in(test_id,other_id);
  if visible_count <> 0 then raise exception 'cross-organization channel must be denied'; end if;
  perform set_config('realtime.topic','ledger:'||org::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',gen_random_uuid(),'role','authenticated')::text,true);
  select count(*) into visible_count from realtime.messages where id=test_id;
  if visible_count <> 0 then raise exception 'unrelated authenticated user must be denied'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
  begin
    insert into realtime.messages(topic,extension,event,payload,private,skip_broadcast)
    values('ledger:'||org::text,'broadcast','forged','{}',true,true);
    raise exception 'client broadcasting should be denied';
  exception when insufficient_privilege then null;
  end;
  perform set_config('role','postgres',true);
  select document,revision into before_document,before_revision from public.ledger_states where organization_id=org;
  update public.ledger_states set revision=revision+1 where organization_id=org;
  if not exists(select 1 from realtime.messages where topic='ledger:'||org::text and event='ledger_changed' and private=true and payload - 'id'=jsonb_build_object('revision',before_revision+1)) then
    raise exception 'trigger must send a private revision-only notification';
  end if;
  if (select document from public.ledger_states where organization_id=org) is distinct from before_document then
    raise exception 'notification trigger changed a document';
  end if;
  if has_function_privilege('authenticated','private.notify_ledger_revision()','EXECUTE') then
    raise exception 'clients must not call the notification trigger directly';
  end if;
end;
$$;
