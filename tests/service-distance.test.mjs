import { test } from 'node:test';
import assert from 'node:assert/strict';
import { distancePercent, supportsDistance } from '../lib/service-distance.ts';
import { serviceAmount } from '../lib/rate-snapshots.ts';
import { splitServiceEarnings } from '../lib/service-split.ts';
import { ledgerDocumentSchema } from '../lib/ledger-schema.ts';
const rates = { activities: [] };
const entry = { rateItemId: 'address-loading', quantity: 10, workAmount: 0, pricing: { service: { id: 'address-loading', label: 'Loading', rate: 10, minimum: 20, unit: 'm3' }, kilometer: {} } };
test('started 30m bands are additive, including the first band', () => {
  for (const [meters, percent] of [[0,0],[1,25],[30,25],[31,50],[45,50],[60,50],[61,75],[90,75],[91,100]]) {
    assert.equal(distancePercent(entry.rateItemId, meters), percent);
    assert.equal(serviceAmount({...entry, distanceMeters:meters}, rates), 100 * (1 + percent / 100));
  }
});
test('old records and unchecked distance retain original earnings and saved prices', () => {
  assert.equal(serviceAmount(entry, rates), 100);
  assert.equal(serviceAmount({...entry, distanceMeters:0}, rates), 100);
  assert.equal(serviceAmount({...entry, distanceMeters:30}, {activities:[{id:'address-loading', rate:999}]}), 125);
});
test('minimum applies before surcharge; zero quantity still earns zero', () => {
  assert.equal(serviceAmount({...entry, quantity:1, distanceMeters:30}, rates), 25);
  assert.equal(serviceAmount({...entry, quantity:0, distanceMeters:30}, rates), 0);
});
test('surcharged amount is shared equally with helpers', () => {
  const total=serviceAmount({...entry,distanceMeters:60}, rates);
  assert.deepEqual(splitServiceEarnings(total,['a','b'],2), {drivers:{a:37.5,b:37.5},helpersTotal:75});
});
test('only approved services qualify, including old cartons records', () => {
  for(const id of ['address-loading','address-delivery','packing-furniture','loading-packed','unpacking','blanket-packing','aerofol-packing','carton-packing']) assert.equal(supportsDistance(id),true);
  for(const id of ['warehouse-loading','agent-warehouse-loading','commercial-loading','delivery','none','hourly-loading']) {
    assert.equal(supportsDistance(id),false);
    assert.equal(distancePercent(id,60),0);
  }
});
test('API bounds and service eligibility reject invalid distance', () => {
  const schema=ledgerDocumentSchema.shape.entries.element;
  const base={...entry,id:'e',date:'',documentNo:'SEE-1',direction:'outbound',reference:'',client:'Client',country:'',kilometers:0,activity:'',driverIds:['a']};
  assert.equal(schema.parse(base).distanceMeters,0);
  assert.equal(schema.safeParse({...base,distanceMeters:45}).success,true);
  for(const distanceMeters of [-1,1.5,100001,Infinity,'30',null]) assert.equal(schema.safeParse({...base,distanceMeters}).success,false);
  assert.equal(schema.safeParse({...base,rateItemId:'commercial-loading',distanceMeters:30}).success,false);
});
