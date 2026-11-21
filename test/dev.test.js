import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { runApp } from './run-web-app.js';
import { Store } from '../src/core.js';
import { serve } from '../src/server.js';

const delay = ms => new Promise(r => setTimeout(r, ms));
async function until(fn) { const end = Date.now() + 5000; while (!fn()) { assert.ok(Date.now() < end, 'Tempo esgotado'); await delay(10); } }

test('Dev: substituições consecutivas notificam e close encerra SSE conectado', { timeout: 10000 }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recall-dev-server-'));
  const web = path.join(dir, 'web'); fs.mkdirSync(web); fs.writeFileSync(path.join(web, 'app.js'), 'v1');
  const store = new Store(dir); store.init();
  const server = await serve(store, 0, '127.0.0.1', { devReload: web });
  const controller = new AbortController();
  t.after(async () => { controller.abort(); if (server.listening) await new Promise(r => server.close(r)); fs.rmSync(dir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const html = await (await fetch(base)).text();
  assert.match(html, /name="recall-dev-reload" content="[a-f0-9]{64}"/);
  const response = await fetch(base + '/api/dev-reload', { signal: controller.signal });
  const reader = response.body.getReader(), decoder = new TextDecoder(); let pending = '';
  async function event() {
    while (!pending.includes('\n\n')) { const {value, done} = await reader.read(); assert.equal(done, false); pending += decoder.decode(value, {stream: true}); }
    const end = pending.indexOf('\n\n'), data = pending.slice(0, end); pending = pending.slice(end + 2);
    return JSON.parse(data.slice(6));
  }
  assert.equal((await event()).type, 'boot');
  for (const version of ['v2', 'v3']) {
    fs.writeFileSync(path.join(web, 'temporary'), version); fs.renameSync(path.join(web, 'temporary'), path.join(web, 'app.js'));
    assert.equal((await event()).type, 'reload');
  }
  await new Promise(r => server.close(r));
  assert.equal((await reader.read()).done, true);
});

test('Dev DOM: reload restaura projeto/unidade e invalida questão alterada sem gravar tentativa', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recall-dev-draft-'));
  const store = new Store(dir); store.init();
  const unit = store.save({title: 'Rascunho', questions: [
    {id:'choice', type:'choice', prompt:'Escolha', options:['A','B'], answer:1},
    {id:'text', type:'text', prompt:'Explique', answer:'Referência'}
  ]});
  const server = await serve(store, 0, '127.0.0.1', {devReload: true});
  const base = `http://127.0.0.1:${server.address().port}`;
  const html = await (await fetch(base)).text();
  const windows = [];
  t.after(async () => { for (const w of windows) w.close(); await new Promise(r => server.close(r)); fs.rmSync(dir, { recursive:true, force:true }); });
  async function open(saved = {}, markup = html) {
    const w = new JSDOM(markup, {url:base, runScripts:'outside-only', pretendToBeVisual:true}).window;
    windows.push(w); w.fetch = (url, options) => fetch(base + url, options);
    w.EventSource = class { constructor() { w.events = this; } };
    w.HTMLDialogElement.prototype.showModal = function () {this.open=true;};
    w.HTMLDialogElement.prototype.close = function () {this.open=false; this.dispatchEvent(new w.Event('close'));};
    for (const [k,v] of Object.entries(saved)) w.sessionStorage.setItem(k,v);
    await runApp(w);
    return w;
  }
  const w = await open(); const $ = s => w.document.querySelector(s);
  $('.study-card').click(); await until(() => $('[data-tab="quiz"]'));
  $('[data-tab="quiz"]').click();
  $('#quiz-form input[value="1"]').checked=true; $('#quiz-form textarea').value='Rascunho sintético';
  w.dispatchEvent(new w.Event('pagehide'));
  const saved = Object.fromEntries(Object.keys(w.sessionStorage).map(k=>[k,w.sessionStorage.getItem(k)]));
  const restored = await open(saved), $$ = s => restored.document.querySelector(s);
  assert.equal($$('#quiz-form input[value="1"]').checked,true);
  assert.equal($$('#quiz-form textarea').value,'Rascunho sintético');
  assert.equal(store.events('attempts').length,0);
  store.save({questions:store.get(unit.id).questions.map(q=>q.id==='choice'?{...q,prompt:'Mudou'}:q)},unit.id);
  const changed = await open(saved);
  assert.equal(changed.document.querySelector('#quiz-form input:checked'),null);
  assert.equal(changed.document.querySelector('#quiz-form textarea').value,'Rascunho sintético');
  const other = await open(saved,html.replace(/content="[a-f0-9]{64}"/,'content="outro-projeto"'));
  assert.equal(other.document.querySelector('#quiz-form'),null);
  $$('#quiz-form').dispatchEvent(new restored.Event('submit',{bubbles:true,cancelable:true}));
  await until(() => $$('#quiz-feedback .result'));
  const afterSubmit = Object.fromEntries(Object.keys(restored.sessionStorage).map(k=>[k,restored.sessionStorage.getItem(k)]));
  const submitted = await open(afterSubmit);
  assert.equal(submitted.document.querySelector('#quiz-form input:checked'),null);
  assert.equal(submitted.document.querySelector('#quiz-form textarea').value,'');
  assert.equal(store.events('attempts').length,1);
  const plain = await open({}, html.replace(/<meta name="recall-dev-reload"[^>]*>/,''));
  assert.equal(plain.events,undefined); assert.equal(plain.sessionStorage.length,0);
});
