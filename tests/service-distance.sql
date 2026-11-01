-- Run within a transaction and roll back. Synthetic data only.
create temporary table distance_test (id integer primary key, document jsonb);
create trigger distance_test_guard before insert or update on distance_test
for each row execute function private.enforce_ledger_rate_snapshots();
do $$
declare doc jsonb; saved jsonb; updated jsonb;
begin
  doc := private.default_ledger_document() || jsonb_build_object('version',10,'entries',
    '[{"id":"distance-test","rateItemId":"address-loading","quantity":1,"helperCount":0}]'::jsonb);
  insert into distance_test values (1,doc);
  select document into saved from distance_test where id=1;
  update distance_test set document=jsonb_set(jsonb_set(document,'{version}','11'),'{entries,0,distanceMeters}','45') where id=1;
  select document into updated from distance_test where id=1;
  assert updated#>>'{entries,0,distanceMeters}' = '45', 'distance persisted';
  assert updated#>'{entries,0,pricing}' = saved#>'{entries,0,pricing}', 'saved pricing preserved';
  begin
    update distance_test set document=jsonb_set(document,'{version}','10') where id=1;
    raise exception 'test_old_client_not_rejected';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'stale_ledger_client' then raise; end if;
  end;
  begin
    update distance_test set document=jsonb_set(document,'{entries,0,rateItemId}','"warehouse-loading"') where id=1;
    raise exception 'test_ineligible_service_not_rejected';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'invalid_distance' then raise; end if;
  end;
  begin
    update distance_test set document=jsonb_set(document,'{entries,0,distanceMeters}','1.5') where id=1;
    raise exception 'test_fraction_not_rejected';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'invalid_distance' then raise; end if;
  end;
  update distance_test set document=jsonb_set(document,'{entries,0,distanceMeters}','0') where id=1;
  select document into updated from distance_test where id=1;
  assert updated#>>'{entries,0,distanceMeters}' = '0', 'unchecking clears surcharge';
  assert updated#>'{entries,0,pricing}' = saved#>'{entries,0,pricing}', 'unchecking preserves saved rates';
end $$;
