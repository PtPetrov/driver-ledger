import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LedgerSync, SyncHttpError, equalData, mergeLedger } from '../lib/ledger-sync.ts';

const base = () => ({ version: 10, drivers: [{ id: 'd', name: 'Driver' }], trips: [{ id: 't', number: '1', totalKilometers: 0, pricing: { kilometer: { d: .17 }, restPerDay: 70 } }], entries: [{ id: 'a', tripId: 't', quantity: 2, pricing: { service: { rate: 9, minimum: 20 } } }, { id: 'b', tripId: 't', quantity: 3 }], rates: { minimumBusiness: 20 }, settings: { currency: 'EUR' } });
const clone = value => structuredClone(value);
const remote = (document, revision = 1) => ({ document, revision, organizationId: 'org', userId: 'user' });
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
function harness(t, overrides = {}) {
  let server = remote(base());
  const applied = [], views = [], saves = [], drafts = [];
  const sync = new LedgerSync({ delay: 600000,
    load: async () => clone(server),
    save: async (document, revision) => { saves.push({ document, revision }); server = remote(clone(document), revision + 1); return server.revision; },
    apply: d => applied.push(clone(d)), publish: v => views.push(clone(v)), persist: d => drafts.push(clone(d)), ...overrides,
  });
  sync.initialize(clone(server)); t.after(() => sync.stop());
  return { sync, applied, views, saves, drafts, setServer: s => { server = s; } };
}
test('JSONB key order does not trigger changes or autosaves', () => assert.equal(equalData({ a:1,b:2 }, { b:2,a:1 }), true));
test('different client edits merge, preserving snapshots and rate changes', () => {
  const b=base(), l=clone(b), r=clone(b); l.entries[0].quantity=5; r.entries[1].quantity=7; r.rates.minimumBusiness=40;
  const merged=mergeLedger(b,l,r); assert.equal(merged.conflicts.length,0);
  assert.equal(merged.document.entries[0].quantity,5); assert.equal(merged.document.entries[1].quantity,7);
  assert.deepEqual(merged.document.entries[0].pricing,b.entries[0].pricing); assert.deepEqual(merged.document.trips[0].pricing,b.trips[0].pricing);
  assert.equal(merged.document.rates.minimumBusiness,40);
});
test('same record conflict is atomic; explicit choice retains unrelated changes', () => {
  const b=base(), l=clone(b), r=clone(b); l.entries[0].quantity=5; r.entries[0].quantity=7; r.settings.currency='BGN';
  assert.equal(mergeLedger(b,l,r).conflicts[0].path,'entries/a');
  assert.equal(mergeLedger(b,l,r,'local').document.entries[0].quantity,5);
  assert.equal(mergeLedger(b,l,r,'remote').document.entries[0].quantity,7);
  assert.equal(mergeLedger(b,l,r,'local').document.settings.currency,'BGN');
});
test('concurrent additions are kept and duplicate trip numbers require review', () => {
  const b=base(), l=clone(b), r=clone(b); l.entries.push({id:'c'}); r.entries.push({id:'e'});
  assert.equal(mergeLedger(b,l,r).document.entries.length,4);
  l.trips.push({id:'t2',number:'2'}); r.trips.push({id:'t3',number:'2'});
  assert.ok(mergeLedger(b,l,r).conflicts.some(c=>c.path==='records'));
});
test('cascade deletion versus editing cannot silently orphan or resurrect clients', () => {
  const b=base(), l=clone(b), r=clone(b); l.entries[0].quantity=9; r.trips=[]; r.entries=[];
  assert.equal(mergeLedger(b,l,r).conflicts[0].path,'records');
  assert.equal(mergeLedger(b,l,r,'remote').document.entries.length,0);
  assert.equal(mergeLedger(b,l,r,'local').document.trips.length,1);
});
test('clean report refreshes automatically without writing anything', async t => {
  const h=harness(t); const r=base(); r.entries[0].quantity=9; h.setServer(remote(r,2));
  await h.sync.refresh(); assert.equal(h.sync.local.entries[0].quantity,9); assert.equal(h.saves.length,0);
});
test('open form holds remote data until submit then reviews same-record changes', async t => {
  const h=harness(t); h.sync.change(base(),true); const r=base(); r.entries[0].quantity=9; h.setServer(remote(r,2));
  await h.sync.refresh(); assert.equal(h.sync.local.entries[0].quantity,2); assert.equal(h.sync.view.remotePending,true);
  const l=base(); l.entries[0].quantity=5; h.sync.change(l,false);
  assert.equal(h.sync.view.status,'conflict'); await h.sync.flush(); assert.equal(h.saves.length,0);
  h.sync.resolve('local'); await h.sync.flush(); assert.equal(h.saves[0].revision,2); assert.equal(h.saves[0].document.entries[0].quantity,5);
});
test('unchanged refresh while editing does not report phantom remote changes', async t => {
  const h=harness(t); h.sync.change(base(),true); await h.sync.refresh(); assert.equal(h.sync.view.remotePending,false);
});
test('typing during in-flight save remains dirty and is saved next', async t => {
  const request=deferred(); let reads=0;
  const h=harness(t,{ save: ()=>request.promise, load: async ()=>{ reads++; return remote({ ...base(), settings:{currency:'BGN'} },2); } });
  const l=base(); l.settings.currency='BGN'; h.sync.change(l,false); const saving=h.sync.flush();
  const newer=clone(l); newer.entries[0].quantity=8; h.sync.change(newer,false); request.resolve(2); await saving; await tick();
  assert.equal(h.sync.local.entries[0].quantity,8); assert.equal(h.sync.dirty,true); assert.equal(reads,1);
});
test('GET in flight does not discard local edits made during that request', async t => {
  const request=deferred(); const h=harness(t,{load:()=>request.promise}); const loading=h.sync.refresh();
  const l=base(); l.entries[0].quantity=8; h.sync.change(l,false);
  const r=base(); r.entries[1].quantity=10; request.resolve(remote(r,2)); await loading;
  assert.equal(h.sync.local.entries[0].quantity,8); assert.equal(h.sync.local.entries[1].quantity,10);
});
test('409 fetches remote and preserves local conflict instead of reloading', async t => {
  const r=base(); r.entries[0].quantity=6;
  const h=harness(t,{save:async()=>{throw new SyncHttpError('conflict',409);},load:async()=>remote(r,2)});
  const l=base(); l.entries[0].quantity=8; h.sync.change(l,false); await h.sync.flush(); await tick();
  assert.equal(h.sync.view.status,'conflict'); assert.equal(h.sync.local.entries[0].quantity,8); assert.ok(h.drafts.at(-1));
});
test('reconnect reconciles server before saving an offline edit', async t => {
  const h=harness(t); h.sync.setOnline(false); const l=base(); l.entries[0].quantity=8; h.sync.change(l,false);
  await h.sync.flush(); assert.equal(h.saves.length,0);
  const r=base(); r.entries[1].quantity=9; h.setServer(remote(r,3)); h.sync.setOnline(true); await tick(); await h.sync.flush();
  assert.equal(h.saves[0].revision,3); assert.equal(h.saves[0].document.entries[1].quantity,9);
});
test('ambiguous successful write followed by timeout is not duplicated after refetch', async t => {
  const l=base(); l.entries.push({id:'new'});
  const h=harness(t,{ save:async()=>{throw new Error('timeout');},load:async()=>remote(l,2) });
  h.sync.change(l,false); await h.sync.flush(); await h.sync.refresh();
  assert.equal(h.sync.dirty,false); assert.equal(h.sync.local.entries.filter(e=>e.id==='new').length,1);
});
test('new organization or user cannot replace the current user draft', async t => {
  const h=harness(t,{load:async()=>({...remote(base(),2),organizationId:'other'})});
  await h.sync.refresh(); assert.equal(h.sync.view.status,'error'); assert.equal(h.sync.organizationId,'org');
  const l=base(); l.rates.minimumBusiness=25; h.sync.change(l,false); await h.sync.flush(); assert.equal(h.saves.length,0);
});
test('restoring a draft uses its original revision and detects conflicts', t => {
  const h=harness(t); const l=base(),r=base(); l.entries[0].quantity=8; r.entries[0].quantity=9;
  h.sync.initialize(remote(r,4), {base:base(),local:l,revision:1}); assert.equal(h.sync.view.status,'conflict');
});
test('restored open form keeps old base until user submits', t => {
  const h=harness(t),r=base(); r.entries[0].quantity=9; h.sync.editing=true;
  h.sync.initialize(remote(r,4),{base:base(),local:base(),revision:1});
  const l=base(); l.entries[0].quantity=7; h.sync.change(l,false); assert.equal(h.sync.view.status,'conflict');
});
test('non-retryable validation error retains data without marking it saved', async t => {
  const h=harness(t,{save:async()=>{throw new SyncHttpError('invalid',422);}});
  const l=base(); l.rates.minimumBusiness=-1; h.sync.change(l,false); await h.sync.flush();
  assert.equal(h.sync.view.status,'error'); assert.equal(h.sync.dirty,true); assert.equal(h.drafts.at(-1).local.rates.minimumBusiness,-1);
});
test('rate limit retains pending changes and respects Retry-After', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  let attempts=0; const h=harness(t,{save:async()=>{attempts++; throw new SyncHttpError('limited',429,60000);}});
  const l=base(); l.rates.minimumBusiness=25; h.sync.change(l,false); await h.sync.flush();
  t.mock.timers.tick(59999); await tick(); assert.equal(attempts,1); assert.equal(h.sync.dirty,true);
});
