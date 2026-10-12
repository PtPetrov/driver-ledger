-- Transactional integration test: every test write is rolled back.
begin;
do $$
declare row_item record; actual jsonb; rejected boolean; invalid jsonb;
begin
  for row_item in select organization_id, document from public.ledger_states
    where jsonb_array_length(document->'entries') > 0 loop
    update public.ledger_states set document = jsonb_set(row_item.document, '{entries,0,helperCount}', '2')
      where organization_id = row_item.organization_id returning document into actual;
    assert actual#>>'{entries,0,helperCount}' = '2', 'helpers must be editable on old clients';
    assert actual#>'{entries,0,pricing}' = row_item.document#>'{entries,0,pricing}', 'old service price must remain frozen';
    assert actual->'trips' = row_item.document->'trips', 'km/rest must remain unchanged';
    assert jsonb_set(actual, '{entries,0,helperCount}', row_item.document#>'{entries,0,helperCount}') = row_item.document,
      'helper edit must preserve all other data';
    foreach invalid in array array['-1'::jsonb, '0.5'::jsonb, '1001'::jsonb, '"2"'::jsonb, 'null'::jsonb] loop
      rejected := false;
      begin
        update public.ledger_states set document = jsonb_set(actual, '{entries,0,helperCount}', invalid)
          where organization_id = row_item.organization_id;
      exception when raise_exception then
        if sqlerrm = 'invalid_helper_count' then rejected := true; else raise; end if;
      end;
      assert rejected, 'invalid helper count must be rejected';
    end loop;
    rejected := false;
    begin
      update public.ledger_states set document = jsonb_set(actual, '{version}', '9') where organization_id = row_item.organization_id;
    exception when raise_exception then
      if sqlerrm = 'stale_ledger_client' then rejected := true; else raise; end if;
    end;
    assert rejected, 'older browser tabs cannot strip helper counts';
    update public.ledger_states set document = jsonb_set(actual, '{entries,0,helperCount}', '0')
      where organization_id = row_item.organization_id returning document into actual;
    assert actual#>>'{entries,0,helperCount}' = '0', 'helpers can be removed from existing records';
  end loop;
end;
$$;
rollback;
