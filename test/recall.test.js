import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import YAML from 'yaml';
import { Store, inside, parseMarkdown } from '../src/core.js';
import { backlogContext, synchronize } from '../src/backlog.js';
import { serve } from '../src/server.js';
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recall-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = new Store(dir); store.init(); return store;
}
const learning = () => ({ title: 'Como um pedido chega ao domínio?', deck: 'Arquitetura', description: 'Siga o fluxo de entrada até a regra de negócio.', questions: [
  { id: 'entrada', type: 'choice', prompt: 'Quem recebe a entrada?', options: ['Adaptador', 'Banco de dados'], answer: 0, explanation: 'O adaptador traduz a entrada.' },
  { id: 'fluxo', type: 'text', prompt: 'Explique o fluxo.', answer: 'Adaptador chama o caso de uso, que aplica as regras do domínio.' }
], cards: [] });

test('Markdown roundtrip, estados, nomes, IDs e edição concorrente', t => {
  const s = fixture(t), u = s.save(learning());
  assert.equal(s.get(u.id).description, learning().description);
  assert.equal(parseMarkdown(fs.readFileSync(inside(s.tasks, u.file), 'utf8')).data.deck, 'Arquitetura');
  s.save({ status: 'Estudando', version: u.version }, u.id);
  assert.throws(() => s.save({ title: 'Conflito', version: u.version }, u.id), /mudou/);
  assert.throws(() => s.save({ status: 'Desconhecido' }, u.id), /Status inválido/);
  assert.equal(s.save({ title: 'Segunda etapa' }).id, 'RCL-2');
});
test('Recusa traversal e symlinks e IDs duplicados', t => {
  const s = fixture(t);
  assert.throws(() => s.save({ title: 'Fora', file: '../../fora.md' }), /fora do diretório/);
  fs.symlinkSync(os.tmpdir(), path.join(s.tasks, 'link'));
  assert.throws(() => s.save({ title: 'Link', file: 'link/fora.md' }), /simbólicos/);
  fs.unlinkSync(path.join(s.tasks, 'link'));
  const u = s.save(learning()); fs.copyFileSync(inside(s.tasks, u.file), inside(s.tasks, 'duplicado.md'));
  assert.throws(() => s.list(), /IDs de unidades duplicados/);
});
test('Tentativa errada, autoavaliação e referência histórica preservadas', t => {
  const s = fixture(t), u = s.save(learning());
  assert.ok(!('answer' in s.publicUnit(u).questions[0]));
  assert.throws(() => s.attempt(u.id, { entrada: 8, fluxo: 'Minha explicação' }), /Responda/);
  const a = s.attempt(u.id, { entrada: 1, fluxo: 'Minha explicação' });
  assert.equal(a.results[0].correct, false); assert.equal(a.results[0].reference, 'Adaptador');
  assert.equal(a.results[1].correct, null);
  s.assess(a.id, 'fluxo', false);
  assert.equal(s.events('assessments')[0].method, 'self');
  const qs = learning().questions; qs[0].answer = 1; s.save({ questions: qs }, u.id);
  assert.equal(s.events('attempts')[0].results[0].reference, 'Adaptador');
  assert.equal(s.events('attempts')[0].version, u.version);
});
test('Flashcard vem do gabarito, deck e revisão mantêm histórico', t => {
  const s = fixture(t), u = s.save(learning());
  s.cardFromQuestion(u.id, 'entrada');
  let card = s.reviewQueue()[0]; assert.equal(card.back, 'Adaptador'); assert.equal(card.deck, 'Arquitetura');
  assert.throws(() => s.cardFromQuestion(u.id, 'entrada'), /Já existe/);
  s.review(u.id, card.id, 'good'); assert.equal(s.reviewQueue({ due: true }).length, 0);
  assert.equal(s.events('reviews').length, 1);
  const current = s.get(u.id); current.cards[0].back = 'Novo conteúdo'; s.save({ cards: current.cards }, u.id);
  assert.equal(s.reviewQueue({ due: true }).length, 1);
  s.review(u.id, card.id, 'again'); assert.equal(s.events('reviews').length, 2);
});
test('Vínculo automático exige caminho simétrico e ID não ambíguo', t => {
  const s = fixture(t), u = s.save({ ...learning(), file: 'sub/etapa.md' });
  assert.equal(backlogContext(s, u.id).state, 'unlinked');
  const target = inside(s.cwd, 'backlog/tasks/sub/etapa.md'); fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, '---\nid: BACK-1\ntitle: Uma tarefa\nstatus: To Do\nreferences: []\n---\n\n## Description\n\n<!-- SECTION:DESCRIPTION:BEGIN -->\nDescrição de origem\n<!-- SECTION:DESCRIPTION:END -->\n');
  assert.equal(backlogContext(s, u.id).description, 'Descrição de origem');
  fs.copyFileSync(target, inside(s.cwd, 'backlog/tasks/duplicado.md'));
  assert.throws(() => backlogContext(s, u.id), /ambíguo/);
});
test('CLI: importação por agente, quiz, tentativa e persistência entre processos', t => {
  const s = fixture(t), cli = new URL('../bin/recall.js', import.meta.url).pathname;
  const run = args => spawnSync(process.execPath, [cli, '--cwd', s.cwd, ...args], { encoding: 'utf8' });
  const file = path.join(s.cwd, 'unidade.json'); fs.writeFileSync(file, JSON.stringify(learning()));
  const created = run(['unit', 'import', file]); assert.equal(created.status, 0, created.stderr);
  const quiz = run(['quiz', 'RCL-1']); assert.equal(quiz.status, 0); assert.equal(JSON.parse(quiz.stdout)[0].answer, undefined);
  fs.writeFileSync(path.join(s.cwd, 'answers.json'), JSON.stringify({ entrada: 0, fluxo: 'Minha explicação' }));
  const attempt = run(['answer', 'RCL-1', '--answers', path.join(s.cwd, 'answers.json')]); assert.equal(attempt.status, 0, attempt.stderr);
  assert.equal(s.events('attempts').length, 1);
  const bad = run(['unit', 'edit', 'RCL-1', '--status', 'Inválido']); assert.notEqual(bad.status, 0);
});
test('HTTP: criação, quiz, flashcard, contexto, origem e persistência', async t => {
  const s = fixture(t), server = await serve(s, 0); t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function req(url, method = 'GET', body) { return fetch(base + url, { method, headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }); }
  assert.equal((await req('/')).status, 200);
  const result = await (await req('/api/units', 'POST', learning())).json(); const id = result.unit.id;
  assert.equal(result.unit.questions[0].answer, undefined);
  const attempt = await (await req(`/api/units/${id}/attempts`, 'POST', { answers: { entrada: 0, fluxo: 'Expliquei o fluxo' } })).json();
  assert.equal(attempt.results[0].correct, true);
  assert.equal((await req(`/api/units/${id}/cards`, 'POST', { question: 'entrada' })).status, 201);
  const queue = await (await req('/api/state')).json(); assert.equal(queue.cards.length, 1);
  assert.equal((await req(`/api/units/${id}/context`)).status, 200);
  const denied = await fetch(base + '/api/units', { method: 'POST', headers: { Origin: 'https://outro-site.test', 'Content-Type': 'application/json' }, body: JSON.stringify(learning()) }); assert.equal(denied.status, 403);
  const invalid = await fetch(base + '/api/units', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' }); assert.equal(invalid.status, 400);
  const plain = await fetch(base + '/api/units', { method: 'POST', body: '{}' }); assert.equal(plain.status, 415);
});
test('Backlog.md real: comandos suportados, vínculo idempotente e contexto', { skip: !process.env.RECALL_BACKLOG_BIN }, t => {
  const s = fixture(t), bin = process.env.RECALL_BACKLOG_BIN;
  function backlog(args) {
    const env = { ...process.env }; delete env.BACKLOG_CWD;
    const r = spawnSync(bin, args, { cwd: s.cwd, encoding: 'utf8', timeout: 20000, env }); assert.equal(r.status, 0, r.stderr); return r;
  }
  backlog(['init', 'Estudo', '--defaults', '--no-git', '--integration-mode', 'none']);
  backlog(['task', 'create', 'Aprender entrada', '-d', 'Entender o caminho até o domínio', '--ref', 'src/entrada.js', '--plain']);
  const file = fs.readdirSync(path.join(s.cwd, 'backlog/tasks')).find(f => f.endsWith('.md'));
  const config = inside(s.root, 'config.yml'); const c = YAML.parse(fs.readFileSync(config, 'utf8')); c.backlogCommand = bin; fs.writeFileSync(config, YAML.stringify(c));
  const u = s.save({ ...learning(), file });
  assert.equal(synchronize(s, u.id).state, 'linked'); assert.equal(synchronize(s, u.id).state, 'linked');
  const md = parseMarkdown(fs.readFileSync(path.join(s.cwd, 'backlog/tasks', file), 'utf8'));
  assert.equal(md.data.references.filter(r => r === `recall/tasks/${file}`).length, 1);
  assert.ok(md.data.references.includes('src/entrada.js'));
  assert.equal(s.get(u.id).backlog.file, `backlog/tasks/${file}`);
  assert.equal(backlogContext(s, u.id).description, 'Entender o caminho até o domínio');
  fs.renameSync(path.join(s.cwd, 'backlog/tasks', file), path.join(s.cwd, 'backlog/tasks', 'renomeado.md'));
  assert.equal(backlogContext(s, u.id).state, 'missing');
});

test('CLI: init, criação, edição e criação de flashcard do gabarito', t => {
  const s = fixture(t), cli = new URL('../bin/recall.js', import.meta.url).pathname;
  const run = args => spawnSync(process.execPath, [cli, '--cwd', s.cwd, ...args], { encoding: 'utf8' });
  assert.equal(run(['init']).status, 0);
  assert.equal(run(['unit', 'create', '--title', 'Uma etapa', '--deck', 'Meu deck']).status, 0);
  assert.equal(run(['unit', 'edit', 'RCL-1', '--status', 'Estudando']).status, 0);
  const u = s.save(learning());
  const card = run(['card', 'from-question', u.id, '--question', 'entrada']); assert.equal(card.status, 0, card.stderr);
  assert.equal(s.reviewQueue()[0].back, 'Adaptador');
  const help = run(['instructions']); assert.equal(help.status, 0, help.stderr); assert.match(help.stdout, /Gerar um percurso/);
});

test('CLI: importa o vocabulário em um plano com dez capítulos', t => {
  const s = fixture(t), cli = new URL('../bin/recall.js', import.meta.url).pathname;
  const source = new URL('../examples/example-vocabulario/vocabulario-ingles.json', import.meta.url).pathname;
  const run = (...args) => spawnSync(process.execPath, [cli, '--cwd', s.cwd, ...args], { encoding: 'utf8' });
  const invalidUpdate = run('unit', 'import', source, '--id', 'RCL-1');
  assert.equal(invalidUpdate.status, 1);
  assert.match(invalidUpdate.stderr, /--id apenas com uma ficha individual/);
  assert.equal(s.list().length, 0);

  const imported = run('unit', 'import', source);
  assert.equal(imported.status, 0, imported.stderr);
  const results = JSON.parse(imported.stdout);
  assert.equal(results.length, 91);
  assert.equal(results[0].unit.id, 'RCL-1');
  assert.equal(results[0].unit.title, 'O alfabeto');
  assert.equal(results.at(-1).unit.id, 'RCL-91');
  assert.equal(s.get('RCL-1').questions[0].answer, 0);
  assert.equal(s.get('RCL-1').cards[0].back, '26');
  assert.deepEqual(s.deckCatalog().map(deck => deck.name), ['Vocabulário em inglês']);
  assert.ok(s.reviewQueue().every(card => card.deck === 'Vocabulário em inglês'));
  const chapters = s.schedule().milestones;
  assert.equal(chapters.length, 10);
  assert.equal(chapters[0].name, 'Base');
  assert.equal(chapters[0].units.length, 9);
  assert.deepEqual(chapters.flatMap(chapter => chapter.units), results.map(result => result.unit.id));

  const bad = path.join(s.cwd, 'bad.json');
  fs.writeFileSync(bad, JSON.stringify([{ title: 'Ficha válida' }, {}]));
  const partial = run('unit', 'import', bad);
  assert.equal(partial.status, 1);
  assert.match(partial.stderr, /Ficha 2:.*1 já importadas/);
  assert.equal(s.get('RCL-92').title, 'Ficha válida');
});
