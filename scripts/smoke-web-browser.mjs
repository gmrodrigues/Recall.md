import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { Store } from '../src/core.js';
import { serve } from '../src/server.js';

const chromeBin = process.argv[2] || process.env.RECALL_CHROME_BIN || 'google-chrome-stable';
const image = process.env.RECALL_IMAGE;
const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'recall-browser-smoke-'));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'recall-browser-profile-'));
const store = new Store(cwd); store.init();
const unit = store.save({ title: 'Ensaio sintético de navegador', deck: 'Smoke', questions: [
  { id: 'escolha', type: 'choice', prompt: 'Qual alternativa está correta?', options: ['Errada', 'Certa'], answer: 1 },
  { id: 'texto', type: 'text', prompt: 'Explique o ensaio.', answer: 'Referência sintética.' }
], cards: [{ id: 'inicial', front: 'Cartão inicial', back: 'Verso inicial' }] });
const container = `recall-browser-${randomUUID().slice(0, 12)}`;
const docker = args => execFileSync('docker', args, { encoding: 'utf8', timeout: 60000 }).trim();
let server, base, containerStarted = false;
if (image) {
  docker(['run', '--rm', '-d', '--name', container, '--user', `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`, '--mount', `type=bind,source=${cwd},target=/workspace`, '-p', '127.0.0.1::6421', image]);
  containerStarted = true; base = `http://${docker(['port', container, '6421/tcp'])}`;
} else {
  server = await serve(store, 0); base = `http://127.0.0.1:${server.address().port}`;
}
let ready = false;
for (let attempt = 0; attempt < 40 && !ready; attempt++) {
  try { ready = (await fetch(`${base}/api/state`)).ok; } catch {}
  if (!ready) await new Promise(resolve => setTimeout(resolve, 200));
}
assert.ok(ready, 'Aplicação web não respondeu');
const chrome = spawn(chromeBin, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--no-first-run', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
let ws;
try {
  const browserWs = await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error(`Chrome sem DevTools: ${output}`)), 10000);
    chrome.stderr.on('data', chunk => {
      output += chunk;
      const match = output.match(/DevTools listening on (ws:\/\/\S+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
    chrome.once('error', reject);
    chrome.once('exit', code => { clearTimeout(timer); reject(new Error(`Chrome saiu (${code}): ${output}`)); });
  });
  ws = new WebSocket(browserWs);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let sequence = 0;
  const pending = new Map(), exceptions = [];
  ws.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id); pending.delete(message.id);
      if (message.error) reject(new Error(JSON.stringify(message.error))); else resolve(message.result);
    }
    if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails.text);
  };
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++sequence; pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Runtime.enable', {}, sessionId);
  await send('Page.enable', {}, sessionId);
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const until = async (expression, timeout = 6000) => {
    const start = Date.now();
    while (!(await evaluate(expression))) {
      if (Date.now() - start > timeout) throw new Error(`Tempo esgotado: ${expression}`);
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  };
  await send('Page.navigate', { url: base }, sessionId);
  await until(`document.querySelector('.study-card')`);
  await evaluate(`document.querySelector('.study-card').click()`);
  await until(`document.querySelector('#detail').open && document.querySelector('[data-tab="quiz"]')`);
  await evaluate(`document.querySelector('[data-tab="quiz"]').click()`);
  await until(`document.querySelector('#quiz-form')`);
  await evaluate(`document.querySelector('#quiz-form input[value="0"]').checked = true; document.querySelector('#quiz-form textarea').value = 'Resposta sintética preservada'; document.querySelector('[data-tab="cards"]').click()`);
  await until(`document.querySelector('#unit-body').textContent.includes('Cartão inicial') && !document.querySelector('#quiz-form')`);
  await evaluate(`document.querySelector('[data-tab="quiz"]').click()`);
  assert.equal(await evaluate(`document.querySelector('#quiz-form input[value="0"]').checked`), true);
  assert.equal(await evaluate(`document.querySelector('#quiz-form textarea').value`), 'Resposta sintética preservada');
  await evaluate(`document.querySelector('#quiz-form button[data-tab="history"]').click()`);
  await until(`document.querySelector('#unit-body').textContent.includes('Suas tentativas aparecerão aqui') && !document.querySelector('#quiz-form')`);
  assert.equal(store.events('attempts').length, 0);
  await evaluate(`document.querySelector('.tabs [data-tab="quiz"]').click()`);
  assert.equal(await evaluate(`document.querySelector('#quiz-form input[value="0"]').checked`), true);
  assert.equal(await evaluate(`document.querySelector('#quiz-form textarea').value`), 'Resposta sintética preservada');
  await evaluate(`document.querySelector('#quiz-form').requestSubmit()`);
  await until(`document.querySelector('#quiz-feedback .wrong') && document.querySelector('[data-assess]')`);
  assert.deepEqual(store.events('attempts')[0].results.map(result => result.correct), [false, null]);
  assert.equal(await evaluate(`document.querySelector('#quiz-history')`), null);
  await evaluate(`document.querySelector('#quiz-form button[data-tab="history"]').click()`);
  await until(`document.querySelectorAll('#unit-body details.content-card').length === 1`);
  await evaluate(`document.querySelector('#unit-body details.content-card').open = true`);
  assert.match(await evaluate(`document.querySelector('#unit-body').textContent`), /Resposta sintética preservada/);
  assert.match(await evaluate(`document.querySelector('#unit-body').textContent`), /Criar flashcard do gabarito atual/);
  await evaluate(`document.querySelector('[data-action="edit-unit"]').click()`);
  await until(`document.querySelector('#editor').open`);
  await evaluate(`document.querySelector('#edit-form').elements.status.value = 'Estudando'; document.querySelector('#edit-form').requestSubmit()`);
  await until(`!document.querySelector('#editor').open`);
  assert.equal(store.get(unit.id).status, 'Estudando');
  await send('Page.reload', { ignoreCache: true }, sessionId);
  await until(`document.querySelector('.study-card')`);
  assert.equal(await evaluate(`document.querySelector('.study-card').closest('.lane').dataset.status`), 'Estudando');
  await evaluate(`document.querySelector('.study-card').click()`);
  await until(`document.querySelector('#detail').open && document.querySelector('[data-tab="history"]')`);
  await evaluate(`document.querySelector('[data-tab="history"]').click()`);
  assert.match(await evaluate(`document.querySelector('#unit-body').textContent`), /Resposta sintética preservada/);
  assert.match(await evaluate(`document.querySelector('#unit-body').textContent`), /Retomar este conceito/);
  await evaluate(`document.querySelector('#detail').close()`);
  let current = store.get(unit.id);
  store.save({ status: 'Praticando', cards: [...current.cards, { id: 'externo', front: 'Cartão externo', back: 'Atualização ao vivo' }] }, unit.id);
  await until(`document.querySelector('.study-card').closest('.lane').dataset.status === 'Praticando' && document.querySelector('.study-card').textContent.includes('2 cartões')`);
  await evaluate(`document.querySelector('.study-card').click()`);
  await until(`document.querySelector('#detail').open && document.querySelector('[data-tab="quiz"]')`);
  await evaluate(`document.querySelector('[data-tab="quiz"]').click(); document.querySelector('#quiz-form textarea').value = 'Rascunho protegido'`);
  current = store.get(unit.id);
  store.save({ cards: [...current.cards, { id: 'durante-quiz', front: 'Novo cartão', back: 'Sem interromper' }] }, unit.id);
  await until(`document.querySelector('#due-count').textContent === '3'`);
  assert.equal(await evaluate(`document.querySelector('#quiz-form textarea').value`), 'Rascunho protegido');
  await evaluate(`document.querySelector('[data-tab="cards"]').click()`);
  current = store.get(unit.id);
  store.save({ cards: [...current.cards, { id: 'detalhe', front: 'Cartão no detalhe', back: 'Atualização visível' }] }, unit.id);
  await until(`document.querySelector('#unit-body').textContent.includes('Cartão no detalhe')`);
  assert.equal(await evaluate(`document.querySelectorAll('#unit-body .content-card').length`), 4);
  assert.deepEqual(exceptions, []);
  console.log(JSON.stringify({ tentativaPersistida: true, correcao: [false, null], alternanciaQuizFlashcard: true, historicoQuiz: 1, estadoAposRecarregar: 'Estudando', liveUpdate: 'Praticando; 2 cartões', rascunhoPreservado: true, detalheAtualizado: 4, excecoes: exceptions.length }, null, 2));
} finally {
  ws?.close();
  if (chrome.exitCode === null && chrome.signalCode === null) { chrome.kill('SIGTERM'); await once(chrome, 'exit'); }
  if (server) await new Promise(resolve => server.close(resolve));
  if (containerStarted) docker(['stop', '--time', '5', container]);
  fs.rmSync(cwd, { recursive: true, force: true });
  fs.rmSync(profile, { recursive: true, force: true });
}
