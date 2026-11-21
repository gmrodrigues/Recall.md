import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { Store } from '../src/core.js';
import { serve } from '../src/server.js';
import { confirmedSessions, sessionStatus, stageStatus } from '../web/flow/model.js';

import { DEFAULT_LINK_MINUTES, materialLinkIdentity, materialPageLinks, materialPages } from '../src/material.js';
import { editReading, playMaterial, renderMaterial, renderStudyTime } from '../web/material-view.js';
import { readingProgress } from '../web/reading-progress.js';
import { probeVideo, sampleVideoDurations } from '../web/video-metadata.js';

function runApp(window) {
  const source = fs.readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
  const script = source.replace(/^import .*;\n/gm, '');
  const imports = { confirmedSessions, sessionStatus, stageStatus, DEFAULT_LINK_MINUTES, materialLinkIdentity, materialPageLinks, materialPages, editReading,
    playMaterial, renderMaterial, renderStudyTime, readingProgress, probeVideo, sampleVideoDurations };
  return window.eval('(async (' + Object.keys(imports).join(', ') + ') => { ' + script + '\n})')(
    ...Object.values(imports));
}

test('Web DOM: criar etapa, adicionar quiz, responder errado, criar cartão e revisar deck', async t => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'recall-web-'));
  const store = new Store(cwd); store.init();
  const server = await serve(store, 0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const html = fs.readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
  const dom = new JSDOM(html, { url: base, runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  w.fetch = (url, opts) => fetch(base + url, opts);
  w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  w.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new w.Event('close')); };
  t.after(async () => { w.close(); await new Promise(r => server.close(r)); fs.rmSync(cwd, { recursive: true, force: true }); });
  await runApp(w);
  const $ = s => w.document.querySelector(s);
  const until = async predicate => {
    const start = Date.now(); while (!predicate()) { if (Date.now() - start > 4000) throw new Error('Tempo esgotado no fluxo DOM. Toast: ' + $('#toast').textContent); await new Promise(r => setTimeout(r, 10)); }
  };
  const submit = form => $(form).dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  assert.match($('#view').textContent, /O que você quer entender/);
  $('[data-action="create"]').click();
  $('#edit-form').elements.title.value = 'Entender o fluxo'; $('#edit-form').elements.deck.value = 'Meu estudo';
  $('#edit-form').elements.description.value = 'Adaptador recebe a entrada.'; submit('#edit-form');
  await until(() => $('.study-card'));
  $('.study-card').click(); await until(() => $('[data-tab="quiz"]'));
  $('[data-tab="quiz"]').click(); $('[data-action="add-question"]').click();
  const form = $('#material-form'); form.elements.prompt.value = 'Quem recebe a entrada?';
  form.elements.options.value = 'Adaptador\nBanco'; form.elements.choiceAnswer.value = '1'; submit('#material-form');
  await until(() => $('#quiz-form'));
  $('#quiz-form input[value="1"]').checked = true; submit('#quiz-form');
  await until(() => $('#quiz-feedback .result'));
  assert.ok($('#quiz-feedback .wrong')); assert.match($('#quiz-feedback').textContent, /Referência: Adaptador/);
  $('#quiz-feedback [data-from-question]').click(); await until(() => $('#due-count').textContent === '1');
  assert.equal(store.reviewQueue()[0].back, 'Adaptador');
  $('#detail').close(); $('[data-page="review"]').click();
  $('[data-review-deck]').click(); assert.ok($('#card-back').hidden);
  $('#reveal').click(); assert.equal($('#card-back').hidden, false); assert.equal($('#card-back').textContent, 'Adaptador');
  $('[data-rating="good"]').click(); await until(() => $('#view').textContent.includes('Revisão em dia'));
  assert.equal(store.events('reviews').length, 1); assert.equal(store.events('attempts')[0].results[0].correct, false);
});

test('Web DOM: contexto da tarefa, quiz de texto e autoavaliação preservam a tentativa', async t => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'recall-web-context-'));
  const store = new Store(cwd); store.init();
  const unit = store.save({ title: 'Explicar regra', file: 'back-1.md', deck: 'Domínio', questions: [{ id: 'regra', type: 'text', prompt: 'Explique a regra.', answer: 'A regra decide o comportamento.' }] });
  fs.mkdirSync(path.join(cwd, 'backlog/tasks'), { recursive: true });
  fs.writeFileSync(path.join(cwd, 'backlog/tasks/back-1.md'), '---\nid: BACK-1\ntitle: Implementar regra\nstatus: In Progress\nreferences: [recall/tasks/back-1.md]\n---\n\n## Description\n\n<!-- SECTION:DESCRIPTION:BEGIN -->\nContexto da tarefa de origem\n<!-- SECTION:DESCRIPTION:END -->\n');
  const server = await serve(store, 0), base = `http://127.0.0.1:${server.address().port}`;
  const dom = new JSDOM(fs.readFileSync(new URL('../web/index.html', import.meta.url), 'utf8'), { url: base, runScripts: 'outside-only' });
  const w = dom.window; w.fetch = (url, opts) => fetch(base + url, opts);
  w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  w.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new w.Event('close')); };
  t.after(async () => { w.close(); await new Promise(r => server.close(r)); fs.rmSync(cwd, { recursive: true, force: true }); });
  await runApp(w);
  const $ = s => w.document.querySelector(s);
  const until = async p => { const start = Date.now(); while (!p()) { if (Date.now() - start > 4000) throw new Error('Tempo esgotado: ' + $('#toast').textContent); await new Promise(r => setTimeout(r, 10)); } };
  $('.study-card').click(); await until(() => $('.detail-aside'));
  assert.match($('.detail-aside').textContent, /Contexto da tarefa de origem/);
  assert.match($('.detail-aside').textContent, /Implementar regra/);
  $('[data-tab="quiz"]').click(); $('#quiz-form textarea').value = 'Minha explicação';
  $('#quiz-form').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  await until(() => $('[data-assess]'));
  assert.match($('#quiz-feedback').textContent, /A regra decide o comportamento/);
  $('[data-assess][data-correct="false"]').click(); await until(() => store.events('assessments').length === 1);
  assert.equal(store.events('attempts', unit.id)[0].results[0].answer, 'Minha explicação');
  assert.equal(store.events('attempts', unit.id)[0].results[0].correct, null);
  assert.equal(store.events('assessments')[0].correct, false);
});

test('Web DOM: tentativa, correção e estado sobrevivem a reabrir a página', async t => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'recall-web-reload-'));
  const store = new Store(cwd); store.init();
  const unit = store.save({ title: 'Persistir prática', deck: 'Persistência', questions: [
    { id: 'escolha', type: 'choice', prompt: 'Qual opção está certa?', options: ['Errada', 'Certa'], answer: 1 },
    { id: 'texto', type: 'text', prompt: 'Explique com suas palavras.', answer: 'Referência para comparação.' }
  ] });
  const server = await serve(store, 0), base = `http://127.0.0.1:${server.address().port}`;
  let w;
  const open = async () => {
    w = new JSDOM(fs.readFileSync(new URL('../web/index.html', import.meta.url), 'utf8'), { url: base, runScripts: 'outside-only', pretendToBeVisual: true }).window;
    w.fetch = (url, opts) => fetch(base + url, opts);
    w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
    w.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new w.Event('close')); };
    await runApp(w);
  };
  const $ = s => w.document.querySelector(s);
  const until = async p => { const start = Date.now(); while (!p()) { if (Date.now() - start > 5000) throw new Error('Tempo esgotado: ' + $('#toast').textContent); await new Promise(r => setTimeout(r, 10)); } };
  await open();
  t.after(async () => { w.close(); await new Promise(r => server.close(r)); fs.rmSync(cwd, { recursive: true, force: true }); });
  await until(() => $('.study-card'));
  $('.study-card').click(); await until(() => $('[data-tab="quiz"]'));
  $('[data-tab="quiz"]').click();
  $('#quiz-form input[value="0"]').checked = true; $('#quiz-form textarea').value = 'Minha resposta preservada';
  $('#quiz-form').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  await until(() => $('#quiz-feedback .wrong'));
  assert.match($('#quiz-feedback').textContent, /Referência: Certa/);
  assert.match($('#quiz-feedback').textContent, /Compare sua resposta com a referência/);
  $('[data-action="edit-unit"]').click(); await until(() => $('#editor').open);
  $('#edit-form').elements.status.value = 'Estudando';
  $('#edit-form').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  await until(() => store.get(unit.id).status === 'Estudando' && !$('#editor').open);
  w.close(); await open(); await until(() => $('.study-card'));
  assert.equal($('.study-card').closest('.lane').dataset.status, 'Estudando');
  $('.study-card').click(); await until(() => $('[data-tab="history"]'));
  $('[data-tab="history"]').click();
  assert.match($('#unit-body').textContent, /Minha resposta preservada/);
  assert.match($('#unit-body').textContent, /Retomar este conceito/);
  assert.equal(store.events('attempts', unit.id).length, 1);
  assert.deepEqual(store.events('attempts', unit.id)[0].results.map(r => r.correct), [false, null]);
});

test('Web DOM: alterações externas atualizam cards sem apagar rascunho do quiz', async t => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'recall-web-live-'));
  const store = new Store(cwd); store.init();
  const unit = store.save({ title: 'Acompanhar mudanças', deck: 'Ao vivo', questions: [
    { id: 'texto', type: 'text', prompt: 'Escreva sem perder o rascunho.', answer: 'Referência.' }
  ], cards: [{ id: 'inicial', front: 'Frente inicial', back: 'Verso inicial' }] });
  const server = await serve(store, 0), base = `http://127.0.0.1:${server.address().port}`;
  const dom = new JSDOM(fs.readFileSync(new URL('../web/index.html', import.meta.url), 'utf8'), { url: base, runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window; w.fetch = (url, opts) => fetch(base + url, opts);
  w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  w.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new w.Event('close')); };
  t.after(async () => { w.close(); await new Promise(r => server.close(r)); fs.rmSync(cwd, { recursive: true, force: true }); });
  await runApp(w);
  const $ = s => w.document.querySelector(s);
  const until = async p => { const start = Date.now(); while (!p()) { if (Date.now() - start > 5000) throw new Error('Tempo esgotado: ' + $('#toast').textContent); await new Promise(r => setTimeout(r, 10)); } };
  await until(() => $('.study-card'));
  let current = store.get(unit.id);
  store.save({ status: 'Estudando', cards: [...current.cards, { id: 'externo', front: 'Cartão externo', back: 'Atualizado' }] }, unit.id);
  await until(() => $('.study-card').closest('.lane').dataset.status === 'Estudando' && $('.study-card').textContent.includes('2 cartões'));
  $('.study-card').click(); await until(() => $('[data-tab="quiz"]'));
  $('[data-tab="quiz"]').click(); $('#quiz-form textarea').value = 'Rascunho que não pode ser perdido';
  current = store.get(unit.id);
  store.save({ cards: [...current.cards, { id: 'durante-quiz', front: 'Novo cartão', back: 'Sem interromper' }] }, unit.id);
  await until(() => $('#due-count').textContent === '3');
  assert.equal($('#quiz-form textarea').value, 'Rascunho que não pode ser perdido');
  $('[data-tab="cards"]').click();
  current = store.get(unit.id);
  store.save({ cards: [...current.cards, { id: 'detalhe', front: 'Cartão no detalhe', back: 'Atualização visível' }] }, unit.id);
  await until(() => $('#unit-body').textContent.includes('Cartão no detalhe'));
  assert.equal(w.document.querySelectorAll('#unit-body .content-card').length, 4);
});
