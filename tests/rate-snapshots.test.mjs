import { test } from 'node:test';
import assert from 'node:assert/strict';
import { captureTripPricing, captureEntryPricing, serviceAmount, tripDriverAmounts } from '../lib/rate-snapshots.ts';
import { ledgerDocumentSchema } from '../lib/ledger-schema.ts';

const drivers = [
  { id: 'a', name: 'A', rate: .09, level: 'senior', color: '#000000' },
  { id: 'b', name: 'B', rate: .08, level: 'junior', color: '#000000' },
];
const settings = { vehicleClass: 'up-to-8-8', singleDriverKilometerRate: .17, vehicle: '', company: '', currency: 'EUR' };
const rates = {
  effectiveDate: '', minimumBusiness: 20, restPerDay: 70,
  kilometer: { 'up-to-8-8': { senior: .09, junior: .08 }, 'up-to-11-99': { senior: .1, junior: .09 } },
  activities: [
    { id: 'load', label: 'Товарене', rate: 9, unit: 'm3', minimumApplies: true },
    { id: 'linear', label: 'Линеен метър', rate: 5, unit: 'linear_m' },
  ],
};
const laterRates = { ...rates, minimumBusiness: 100, restPerDay: 140,
  kilometer: { ...rates.kilometer, 'up-to-8-8': { senior: .2, junior: .18 } },
  activities: rates.activities.map((item) => ({ ...item, rate: 11 })),
};
const trip = { id: 't', number: '1', departureDate: '2026-10-04', totalKilometers: 4854, restDays: 2, pricing: captureTripPricing(drivers, rates, settings) };
const entry = { id: 'e', tripId: 't', date: '2026-10-04', documentNo: 'SEE-1', direction: 'outbound', reference: '', client: 'Client', country: 'BG', kilometers: 0, activity: '', workAmount: 0, driverIds: ['a', 'b'], rateItemId: 'load', quantity: 10, pricing: captureEntryPricing('load', drivers, rates, settings) };

test('existing service amount stays frozen after catalogue changes', () => {
  assert.equal(serviceAmount(entry, laterRates), 90);
  assert.equal(serviceAmount({ ...entry, quantity: 1 }, laterRates), 20);
  assert.equal(serviceAmount({ ...entry, quantity: 1.25 }, laterRates), 20);
  assert.equal(serviceAmount({ ...entry, quantity: 2.5 }, laterRates), 22.5);
});
test('new services use new prices and minimums', () => {
  const pricing = captureEntryPricing('load', drivers, laterRates, settings);
  assert.equal(serviceAmount({ ...entry, pricing }, laterRates), 110);
});
test('linear metre services remain exempt from minimum payment', () => {
  const pricing = captureEntryPricing('linear', drivers, rates, settings);
  assert.equal(serviceAmount({ ...entry, rateItemId: 'linear', quantity: .5, pricing }, laterRates), 2.5);
});
test('kilometre and rest rates remain frozen, including driver count', () => {
  const fallback = captureTripPricing([drivers[0]], laterRates, { ...settings, singleDriverKilometerRate: .5 });
  assert.ok(Math.abs(tripDriverAmounts(trip, 'a', fallback).kilometers - 436.86) < 1e-9);
  assert.ok(Math.abs(tripDriverAmounts(trip, 'b', fallback).kilometers - 388.32) < 1e-9);
  assert.equal(tripDriverAmounts(trip, 'a', fallback).rest, 70);
  assert.deepEqual(tripDriverAmounts(trip, 'new', fallback), { kilometers: 0, rest: 0 });
  assert.equal(tripDriverAmounts({ ...trip, totalKilometers: 5000 }, 'a', fallback).kilometers, 450);
});
test('new single-driver trips keep their combined kilometre rate', () => {
  const pricing = captureTripPricing([drivers[0]], rates, settings);
  assert.equal(pricing.kilometer.a, .17);
  assert.equal(tripDriverAmounts({ ...trip, pricing }, 'a', pricing).rest, 140);
});
test('client without service validates, earns zero, then can receive a service', () => {
  const draft = { ...entry, rateItemId: 'none', quantity: 0, pricing: captureEntryPricing('none', drivers, rates, settings) };
  const document = ledgerDocumentSchema.parse({ version: 10, drivers, trips: [trip], entries: [draft], settings, rates });
  assert.equal(document.entries[0].pricing.service, null);
  assert.equal(serviceAmount(draft, laterRates), 0);
  assert.equal(serviceAmount({ ...draft, rateItemId: 'load', quantity: 10, pricing: captureEntryPricing('load', drivers, laterRates, settings) }, laterRates), 110);
});
test('API schema preserves snapshot fields and rejects obsolete documents', () => {
  const document = { version: 10, drivers, trips: [trip], entries: [entry], settings, rates };
  assert.deepEqual(ledgerDocumentSchema.parse(document).trips[0].pricing, trip.pricing);
  assert.deepEqual(ledgerDocumentSchema.parse(document).entries[0].pricing, entry.pricing);
  assert.equal(ledgerDocumentSchema.safeParse({ ...document, version: 8 }).success, false);
  assert.equal(ledgerDocumentSchema.safeParse({ ...document, version: 9 }).success, false);
});
