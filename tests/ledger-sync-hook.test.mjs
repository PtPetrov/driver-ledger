import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import React, { useCallback, useMemo, useState } from 'react';
import { act, create } from 'react-test-renderer';

// Exercise the real hook with React, an in-memory HTTP server and an event-driven
// Realtime transport. No production credentials or browser permission required.
const dataModule = code => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
const hookSource = readFileSync(new URL('../hooks/use-ledger-sync.ts',import.meta.url),'utf8')
  .replace('"react"',JSON.stringify(import.meta.resolve('react')))
  .replace('"sonner"',JSON.stringify(dataModule('export const toast={success(){},info(){}};')))
  .replace('"@/lib/supabase/client"',JSON.stringify(dataModule('export function createClient(){return globalThis.__syncTestSupabase}')))
  .replace('"@/lib/ledger-sync"',JSON.stringify(pathToFileURL(new URL('../lib/ledger-sync.ts',import.meta.url).pathname).href));
const {useLedgerSync}=await import(dataModule(ts.transpileModule(hookSource,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText));
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const base=()=>({version:10,drivers:[{id:'d'}],trips:[{id:'t',number:'1'}],entries:[{id:'e',quantity:1}],rates:{rate:9},settings:{currency:'EUR'}});
const normalize=d=>d;

test('React hook: live refresh, draft protection, conflict review, offline recovery, remount and cleanup', async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT=true;
  const storage=new Map();
  globalThis.sessionStorage={getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)};
  globalThis.window=new EventTarget();
  globalThis.document=Object.assign(new EventTarget(),{visibilityState:'visible'});
  Object.defineProperty(globalThis,'navigator',{value:{onLine:true},configurable:true});
  let server={document:base(),revision:1,organizationId:'org',userId:'user'}, writes=0, removed=0, control, listener;
  globalThis.__syncTestSupabase={realtime:{setAuth:async()=>{}},channel:()=>({
    on(_type,_filter,callback){listener=callback;return this},subscribe(callback){callback('SUBSCRIBED');return this},
  }),removeChannel:async()=>{removed++}};
  globalThis.fetch=async(_url,options={})=>{
    if(options.method==='PUT') {
      assert.equal(options.headers['X-Ledger-Organization'],'org');
      assert.equal(options.headers['X-Ledger-User'],'user');
      const body=JSON.parse(options.body);
      if(body.expectedRevision!==server.revision) return Response.json({error:'conflict'},{status:409});
      writes++; server={...server,document:body.document,revision:server.revision+1};
      return Response.json({revision:server.revision});
    }
    return Response.json(server);
  };
  function Fixture(){
    const [document,setDocument]=useState(base),[form,setForm]=useState({editing:false,value:''});
    const restore=useCallback(d=>setForm(d),[]),unauthorized=useCallback(()=>{},[]);
    const draft=useMemo(()=>form,[form]);
    const sync=useLedgerSync({document,formDraft:draft,editing:form.editing,apply:setDocument,restoreForm:restore,normalize,onUnauthorized:unauthorized});
    control={sync,document,form,setDocument,setForm};return null;
  }
  let root;
  await act(async()=>{root=create(React.createElement(Fixture));await tick()});
  await act(tick);
  assert.equal(control.sync.hydrated,true); assert.equal(control.sync.live,true); assert.equal(writes,0);

  // Push to a clean report updates the view without saving it back to the server.
  server={...server,revision:2,document:{...base(),entries:[{id:'e',quantity:3}]}};
  await act(async()=>{listener({payload:{revision:2}});await wait(180)});
  assert.equal(control.document.entries[0].quantity,3); assert.equal(writes,0);

  // An open form remains untouched by a push, and submitting it detects a conflict.
  await act(async()=>control.setForm({editing:true,value:'unfinished client'}));
  server={...server,revision:3,document:{...base(),entries:[{id:'e',quantity:5}]}};
  await act(async()=>{listener({payload:{revision:3}});await wait(180)});
  assert.equal(control.form.value,'unfinished client'); assert.equal(control.document.entries[0].quantity,3);
  assert.equal(control.sync.view.remotePending,true);
  await act(async()=>{control.setDocument({...control.document,entries:[{id:'e',quantity:7}]});control.setForm({editing:false,value:''})});
  assert.equal(control.sync.view.status,'conflict'); assert.equal(writes,0);
  await act(async()=>control.sync.resolve('local'));
  await act(async()=>wait(780)); await act(tick);
  assert.equal(server.document.entries[0].quantity,7); assert.equal(writes,1);

  // Offline drafts remain in the tab. Reconnect fetches the server before saving.
  await act(async()=>{navigator.onLine=false;window.dispatchEvent(new Event('offline'))});
  await act(async()=>control.setDocument({...control.document,rates:{rate:12}}));
  assert.equal(control.sync.view.status,'offline');
  assert.ok(storage.has('driver-ledger-draft:user:org'));
  server={...server,revision:server.revision+1,document:{...server.document,settings:{currency:'BGN'}}};
  await act(async()=>{navigator.onLine=true;window.dispatchEvent(new Event('online'));await tick()});
  await act(async()=>wait(780)); await act(tick);
  assert.equal(server.document.rates.rate,12); assert.equal(server.document.settings.currency,'BGN');

  // Reload while editing retains the ORIGINAL base and exact input value.
  await act(async()=>control.setForm({editing:true,value:'still typing'}));
  await act(async()=>root.unmount());
  server={...server,revision:server.revision+1,document:{...server.document,entries:[{id:'e',quantity:11}]}};
  await act(async()=>{root=create(React.createElement(Fixture));await tick()}); await act(tick);
  assert.equal(control.form.value,'still typing'); assert.equal(control.document.entries[0].quantity,7);
  await act(async()=>{control.setDocument({...control.document,entries:[{id:'e',quantity:13}]});control.setForm({editing:false,value:''})});
  assert.equal(control.sync.view.status,'conflict');
  await act(async()=>root.unmount()); assert.equal(removed,2);
});
