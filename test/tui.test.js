import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { spawnSync } from 'node:child_process';
import { stripVTControlCharacters } from 'node:util';
import { Store } from '../src/core.js';
import { TuiApp } from '../src/tui.js';
import { clean, fit, wrap, widthOf, runTerminal } from '../src/terminal.js';
function fixture(t) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'recall-tui-test-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const store = new Store(cwd); store.init(); return store;
}
const material = () => ({ title: 'Aprender entradas', deck: 'Arquitetura', description: 'O adaptador recebe a entrada.', questions: [
  { id: 'entrada', type: 'choice', prompt: 'Quem recebe a entrada?', options: ['Adaptador', 'Banco'], answer: 0, explanation: 'O adaptador traduz a entrada.' },
  { id: 'fluxo', type: 'text', prompt: 'Explique o fluxo.', answer: 'O adaptador chama o caso de uso.' }
], cards: [{ id: 'papel', front: 'Qual o papel do adaptador?', back: 'Traduzir a entrada para o caso de uso.', deck: 'Arquitetura' }] });
const key = (app, name, extra = {}) => app.handle(name.length === 1 ? name : '', { name, ...extra });
const type = (app, str) => { for (const c of str) app.handle(c, { name: c }); };
const plain = app => stripVTControlCharacters(app.render(110, 32));

test('TUI: quadro, lista, busca, seleção, ajuda e limites do terminal', t => {
  const s = fixture(t), u = s.save(material());
  s.save({ title: 'Outra etapa', status: 'Em revisão', deck: 'Outro deck' });
  const app = new TuiApp(s);
  assert.match(plain(app), /Aprender entradas/);
  key(app, 'tab'); assert.equal(app.page, 'list');
  key(app, '/'); type(app, 'Outra'); key(app, 'return');
  assert.equal(app.visible().length, 1); key(app, 'return'); assert.equal(app.unit().title, 'Outra etapa');
  key(app, 'escape'); key(app, 'escape'); assert.equal(app.query, '');
  key(app, '?'); assert.match(plain(app), /ATALHOS DO RECALL/); key(app, 'escape');
  for (const columns of [50, 60, 80, 100, 130, 200]) {
    for (const page of ['board', 'list']) {
      app.page = page;
      const lines = stripVTControlCharacters(app.render(columns, 24)).split('\r\n');
      assert.ok(lines.length < 24);
      for (const line of lines) assert.ok(widthOf(line) <= columns, `Linha excede ${columns}: ${line}`);
    }
  }
  assert.match(app.render(40, 12), /terminal pequeno/);
  app.page = 'board'; app.align(u.id); key(app, 'return'); assert.equal(app.selected, u.id);
});
test('TUI: formulário cria/edita etapas e move estado com os mesmos arquivos da CLI', t => {
  const s = fixture(t), app = new TuiApp(s);
  key(app, 'n'); type(app, 'Minha etapa'); key(app, 'tab'); key(app, 'u', { ctrl: true }); type(app, 'Meu deck'); key(app, 'tab'); type(app, 'Material'); key(app, 'j', { ctrl: true }); type(app, 'Segunda linha'); key(app, 's', { ctrl: true });
  assert.equal(app.page, 'detail'); assert.equal(s.list().length, 1);
  assert.equal(s.get('RCL-1').description, 'Material\nSegunda linha');
  key(app, 'e'); key(app, 'u', { ctrl: true }); type(app, 'Título revisado'); key(app, 's', { ctrl: true });
  assert.equal(s.get('RCL-1').title, 'Título revisado');
  key(app, 'm'); key(app, 'down'); key(app, 'return');
  assert.equal(s.get('RCL-1').status, 'Estudando');
  key(app, 'escape'); key(app, 'n'); type(app, 'Descartar'); key(app, 'escape'); assert.equal(s.list().length, 1);
});
test('TUI: inclusão de questões e cartões, validação e colagem não submetem formulário', t => {
  const s = fixture(t); s.save({ title: 'Estudo', questions: [], cards: [] });
  const app = new TuiApp(s); key(app, 'return');
  key(app, 'a'); key(app, 'return');
  type(app, 'Escolha'); key(app, 'tab'); type(app, 'Primeira'); key(app, 'j', { ctrl: true }); type(app, 'Segunda');
  key(app, 'tab'); type(app, '2'); key(app, 's', { ctrl: true });
  assert.equal(s.get('RCL-1').questions[0].answer, 1);
  key(app, 'f'); type(app, 'Frente'); key(app, 'tab');
  key(app, 's', { ctrl: true }); assert.ok(app.dialog); assert.match(app.notice, /Verso inválido/);
  app.handle('', { sequence: '\x1b[200~' }); app.handle('Verso', { name: 'v' }); app.handle('\r', { name: 'return' }); app.handle('Continuação', { name: 'c' }); app.handle('', { sequence: '\x1b[201~' });
  assert.ok(app.dialog); key(app, 's', { ctrl: true });
  assert.equal(s.get('RCL-1').cards[0].back, 'Verso\nContinuação');
});
test('TUI: quiz sem spoiler, tentativa incorreta, texto, histórico e cartão do gabarito', t => {
  const s = fixture(t), u = s.save(material()), app = new TuiApp(s);
  key(app, 'return'); key(app, 'q');
  assert.ok(!plain(app).includes('O adaptador traduz a entrada.'));
  key(app, '2'); key(app, 'return'); type(app, 'Minha resposta');
  assert.ok(!plain(app).includes('O adaptador chama o caso de uso.'));
  assert.equal(s.events('attempts').length, 0);
  key(app, 'return'); assert.equal(app.page, 'results');
  const attempt = s.events('attempts')[0]; assert.equal(attempt.results[0].correct, false);
  assert.equal(attempt.results[1].answer, 'Minha resposta');
  key(app, 'f'); assert.equal(s.get(u.id).cards.find(c => c.id === 'q-entrada').back, 'Adaptador');
  key(app, 'right'); assert.match(plain(app), /O adaptador chama o caso de uso/);
  key(app, '2'); assert.equal(s.events('assessments')[0].correct, false);
  key(app, 'return'); key(app, 't'); assert.equal(app.page, 'history'); key(app, 'return'); assert.equal(app.page, 'results');
  assert.equal(s.events('attempts').length, 1);
});
test('TUI: cancelamento de quiz e alteração externa não geram tentativas inventadas', t => {
  const s = fixture(t), u = s.save(material()), app = new TuiApp(s);
  key(app, 'return'); key(app, 'q'); key(app, 'return'); type(app, 'Texto'); key(app, 'escape');
  assert.equal(s.events('attempts').length, 0);
  key(app, 'q'); key(app, 'return'); type(app, 'Texto');
  s.save({ description: 'Material alterado' }, u.id); key(app, 'return');
  assert.match(app.notice, /material mudou/); assert.equal(s.events('attempts').length, 0);
});
test('TUI: revisão por deck só permite avaliar após revelar, com histórico e nova versão', t => {
  const s = fixture(t), u = s.save(material()), app = new TuiApp(s);
  key(app, 'r'); key(app, 'return'); assert.equal(app.page, 'review');
  assert.ok(!plain(app).includes('Traduzir a entrada para o caso de uso.'));
  key(app, '3'); assert.equal(s.events('reviews').length, 0);
  key(app, 'space'); assert.match(plain(app), /Traduzir a entrada para o caso de uso/);
  key(app, '3'); assert.equal(s.events('reviews').length, 1); assert.match(plain(app), /REVISÃO EM DIA/);
  key(app, '3'); assert.equal(s.events('reviews').length, 1);
  const unit = s.get(u.id); unit.cards[0].back = 'Nova referência'; s.save({ cards: unit.cards }, u.id);
  key(app, 'return'); key(app, 'return'); key(app, 'space');
  const changed = s.get(u.id); changed.cards[0].back = 'Mudou durante a revisão'; s.save({ cards: changed.cards }, u.id);
  key(app, '3'); assert.match(app.notice, /cartão de memorização mudou/); assert.equal(s.events('reviews').length, 1);
});
test('TUI: contexto de Backlog.md no detalhe e conteúdo com escapes não controla o terminal', t => {
  const s = fixture(t), u = s.save({ ...material(), file: 'back-1.md', description: '\x1b[2J\x1b]0;injetado\x07Texto legível' });
  fs.mkdirSync(path.join(s.cwd, 'backlog/tasks'), { recursive: true });
  fs.writeFileSync(path.join(s.cwd, 'backlog/tasks/back-1.md'), '---\nid: BACK-1\ntitle: Construir fluxo\nstatus: To Do\nreferences: []\n---\n\n## Description\n\nContexto externo\n');
  const app = new TuiApp(s); app.detail(u.id);
  assert.match(app.context.description, /Contexto externo/);
  key(app, 'end'); const output = app.render(110, 32); assert.match(stripVTControlCharacters(output), /Construir fluxo/);
  assert.ok(!output.includes('\x1b[2J')); assert.ok(!output.includes('\x1b]0;'));
  assert.equal(clean('\x1b[31mOlá\x1b[0m'), 'Olá');
  assert.equal(widthOf('漢字'), 4); assert.equal(widthOf('👩‍💻'), 2); assert.equal(widthOf(fit('漢字abc', 5)), 5);
  assert.ok(wrap('Texto muito comprido sem cortar 漢字', 8).every(s => widthOf(s) <= 8));
});
test('Runtime TUI: restaura raw/cursor/tela, redimensiona e remove listeners', async t => {
  const s = fixture(t), app = new TuiApp(s), input = new PassThrough(), output = new PassThrough(), signals = new EventEmitter();
  input.isTTY = output.isTTY = true; input.isRaw = false; input.setRawMode = value => { input.isRaw = value; };
  output.columns = 80; output.rows = 24; let bytes = ''; output.on('data', d => { bytes += d; });
  const done = runTerminal(app, { input, output, signals });
  assert.equal(input.isRaw, true); output.columns = 40; output.emit('resize');
  input.emit('keypress', 'n', { name: 'n' }); assert.equal(app.dialog, undefined);
  output.columns = 60; output.emit('resize'); input.emit('keypress', 'q', { name: 'q' }); await done;
  assert.equal(input.isRaw, false); assert.match(bytes, /\x1b\[\?1049h/); assert.match(bytes, /\x1b\[\?25h\x1b\[\?1049l/);
  assert.equal(input.listenerCount('keypress'), 0); assert.equal(output.listenerCount('resize'), 0); assert.equal(signals.listenerCount('SIGTERM'), 0);
});
test('Runtime TUI: sinal e falha restauram terminal; pipes não entram em raw', async t => {
  const s = fixture(t);
  for (const error of [false, true]) {
    const input = new PassThrough(), output = new PassThrough(), signals = new EventEmitter();
    input.isTTY = output.isTTY = true; input.isRaw = true; input.setRawMode = v => { input.isRaw = v; };
    const app = new TuiApp(s); let bytes = ''; output.on('data', d => { bytes += d; });
    const done = runTerminal(app, { input, output, signals });
    if (error) { app.handle = () => { throw new Error('falha simulada'); }; input.emit('keypress', 'n', { name: 'n' }); await assert.rejects(done, /falha simulada/); }
    else { signals.emit('SIGTERM'); await done; }
    assert.equal(input.isRaw, true); assert.match(bytes, /\x1b\[\?1049l/);
  }
  assert.throws(() => runTerminal(new TuiApp(s), { input: new PassThrough(), output: new PassThrough() }), /terminal interativo/);
});
test('PTY real: navegação, formulário, quiz, revisão e restauração do terminal', { skip: process.platform === 'win32' }, t => {
  const s = fixture(t); s.save(material());
  const python = spawnSync('python3', [new URL('./tui-pty.py', import.meta.url).pathname, new URL('../bin/recall.js', import.meta.url).pathname, s.cwd, process.execPath], { encoding: 'utf8', timeout: 20000 });
  assert.equal(python.status, 0, python.stdout + python.stderr);
  const attempts = s.events('attempts'); assert.equal(attempts.length, 1); assert.equal(attempts[0].results[0].correct, false);
  assert.equal(attempts[0].results[1].answer, 'Minha explicacao no terminal');
  assert.equal(s.events('reviews').length, 1); assert.equal(s.get('RCL-1').status, 'Estudando');
  assert.ok(s.list().some(u => u.title === 'Etapa pelo terminal'));
});
