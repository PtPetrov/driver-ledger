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
