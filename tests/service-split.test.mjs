import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitServiceEarnings } from '../lib/service-split.ts';
import { ledgerDocumentSchema } from '../lib/ledger-schema.ts';
import { captureEntryPricing, serviceAmount, tripDriverAmounts } from '../lib/rate-snapshots.ts';

test('old records with missing/zero helpers retain their exact previous shares', () => {
  for (const amount of [0, 25, 20, 100, 10.005]) {
    assert.equal(splitServiceEarnings(amount, ['a', 'b']).drivers.a, amount / 2);
    assert.deepEqual(splitServiceEarnings(amount, ['a', 'b'], 0), splitServiceEarnings(amount, ['a', 'b']));
  }
});
test('100 split between two drivers and two helpers gives 25 to each', () => {
  assert.deepEqual(splitServiceEarnings(100, ['a', 'b'], 2), { drivers: { a: 25, b: 25 }, helpersTotal: 50 });
});
test('one helper splits 100 into exact cents without losing money', () => {
  assert.deepEqual(splitServiceEarnings(100, ['a', 'b'], 1), { drivers: { a: 33.34, b: 33.33 }, helpersTotal: 33.33 });
});
test('one driver and helpers split only this service; removing helpers restores earnings', () => {
  assert.deepEqual(splitServiceEarnings(100, ['a'], 1), { drivers: { a: 50 }, helpersTotal: 50 });
  assert.equal(splitServiceEarnings(100, ['a'], 0).drivers.a, 100);
});
test('allocated cents always add up, even for small totals and many helpers', () => {
  for (const helpers of [1, 2, 7, 1000]) for (const amount of [0, .01, .03, 20, 123.45]) {
    const result = splitServiceEarnings(amount, ['a', 'b'], helpers);
    assert.equal(Math.round((result.drivers.a + result.drivers.b + result.helpersTotal) * 100), Math.round(amount * 100));
  }
});
test('helper count must be a bounded non-negative integer', () => {
  const helperSchema = ledgerDocumentSchema.shape.entries.element.shape.helperCount;
  assert.equal(helperSchema.parse(undefined), 0);
  for (const count of [-1, .5, 1001, Infinity, '2']) assert.equal(helperSchema.safeParse(count).success, false);
  assert.equal(helperSchema.parse(2), 2);
});
test('adding helpers to an old record keeps its frozen price and minimum; km/rest unchanged', () => {
  const drivers = [{ id: 'a', level: 'senior', rate: .09 }, { id: 'b', level: 'junior', rate: .08 }];
  const rates = { kilometer: { 'up-to-8-8': { senior: .09, junior: .08 } }, restPerDay: 70, minimumBusiness: 20, activities: [{ id: 'load', label: 'Товарене', unit: 'm3', rate: 5, minimumApplies: true }] };
  const settings = { vehicleClass: 'up-to-8-8', singleDriverKilometerRate: .17 };
  const pricing = captureEntryPricing('load', drivers, rates, settings);
  const old = { rateItemId: 'load', quantity: 1, workAmount: 0, pricing };
  const amount = serviceAmount({ ...old, helperCount: 2 }, { ...rates, minimumBusiness: 100 });
  assert.equal(amount, 20);
  assert.equal(splitServiceEarnings(amount, ['a', 'b'], 2).drivers.a, 5);
  const tripPricing = { kilometer: { a: .09, b: .08 }, restPerDay: 70 };
  assert.deepEqual(tripDriverAmounts({ totalKilometers: 1000, restDays: 1, pricing: tripPricing }, 'a', tripPricing), { kilometers: 90, rest: 35 });
});
