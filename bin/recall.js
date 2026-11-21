#!/usr/bin/env node
import fs from 'node:fs';
import { parseArgs } from 'node:util';
import { Store, STATUSES, ensure } from '../src/core.js';
import { backlogContext, synchronize, autoLink } from '../src/backlog.js';
import { serve } from '../src/server.js';
import { startTui } from '../src/tui.js';
const usage = `Recall.md • aprendizagem com fichas de conteúdo\nModo desenvolvimento: browser --dev-reload (recarrega ao alterar web/).

recall init                                  Inicializa recall/ no diretório atual
recall unit create --title "Assunto" --deck "Deck" [--description "..."] [--file "mesmo-nome.md"]
recall unit list [--json]                     Mostra unidades e estados
recall unit view RCL-1                        Mostra material e questões
recall unit edit RCL-1 --status "Estudando"    Atualiza título, descrição, deck ou estado
recall unit import arquivo.json [--id RCL-1]  Importa unidade/questões/cartões de memorização de um agente
recall quiz RCL-1                             Mostra questões sem revelar respostas
recall answer RCL-1 --answers respostas.json  Registra tentativa e feedback
recall assess ID-TENTATIVA --question q1 --correct true|false
recall card from-question RCL-1 --question q1  Cria cartão de memorização do gabarito
recall review [--deck "Deck"] [--due]         Lista cartões para revisão
recall review RCL-1 --card ID --rating again|hard|good|easy
recall sync [RCL-1]                           Detecta simetria e cria links nos dois sentidos
recall context RCL-1                          Mostra contexto atual da tarefa vinculada
recall tui                                   Abre interface interativa de terminal
recall browser [--port 6421] [--host 127.0.0.1]                  Inicia interface web local
recall instructions                          Contrato para agentes

Opções globais: --cwd DIRETÓRIO, --json, --help
Estados: ${STATUSES.join(', ')}
`;
try {
  const { values: o, positionals: a } = parseArgs({ allowPositionals: true, strict: true, options: {
    cwd: { type: 'string' }, json: { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
    title: { type: 'string' }, description: { type: 'string' }, deck: { type: 'string' }, file: { type: 'string' },
    status: { type: 'string' }, id: { type: 'string' }, answers: { type: 'string' }, question: { type: 'string' },
    correct: { type: 'string' }, card: { type: 'string' }, rating: { type: 'string' }, due: { type: 'boolean' }, milestone: { type: 'string' }, port: { type: 'string' }, host: { type: 'string' },
    'dev-reload': { type: 'boolean' }
  } });
  if (o.help || !a.length) { console.log(usage); process.exit(0); }
  const store = new Store(o.cwd);
  const output = v => console.log(JSON.stringify(v, null, 2));
  const input = Object.fromEntries(['title', 'description', 'deck', 'file', 'status'].filter(k => o[k] !== undefined).map(k => [k, o[k]]));
  if (o.milestone) input.milestoneId = o.milestone;
  if (a[0] === 'init') output(store.init());
  else if (a[0] === 'instructions') console.log(fs.readFileSync(new URL('../docs/agents.md', import.meta.url), 'utf8'));
  else if (a[0] === 'unit' && a[1] === 'create') output(autoLink(store, store.save(input)));
  else if (a[0] === 'unit' && a[1] === 'import') {
    ensure(a[2], 'Informe o arquivo JSON.');
    output(autoLink(store, store.save(JSON.parse(fs.readFileSync(a[2], 'utf8')), o.id)));
  }
  else if (a[0] === 'unit' && a[1] === 'edit') output(autoLink(store, store.save(input, a[2])));
  else if (a[0] === 'unit' && a[1] === 'view') output(store.publicUnit(store.get(a[2])));
  else if (a[0] === 'unit' && a[1] === 'list') {
    const list = store.list();
    if (o.json) output(list.map(u => store.publicUnit(u)));
    else for (const status of STATUSES) { console.log(`\n${status}`); for (const u of list.filter(u => u.status === status)) console.log(`  ${u.id}  ${u.title}  [${u.deck}]`); }
  }
  else if (a[0] === 'quiz') output(store.publicUnit(store.get(a[1])).questions);
  else if (a[0] === 'answer') { ensure(o.answers, 'Informe --answers arquivo.json.'); output(store.attempt(a[1], JSON.parse(fs.readFileSync(o.answers, 'utf8')))); }
  else if (a[0] === 'assess') { ensure(['true', 'false'].includes(o.correct), '--correct deve ser true ou false.'); output(store.assess(a[1], o.question, o.correct === 'true')); }
  else if (a[0] === 'card' && a[1] === 'from-question') output(store.publicUnit(store.cardFromQuestion(a[2], o.question)));
  else if (a[0] === 'review') output(a[1] ? store.review(a[1], o.card, o.rating) : store.reviewQueue({ deck: o.deck, due: o.due }));
  else if (a[0] === 'context') output(backlogContext(store, a[1]));
  else if (a[0] === 'sync') output((a[1] ? [store.get(a[1])] : store.list()).map(u => ({ unit: u.id, ...synchronize(store, u.id) })));
  else if (a[0] === 'tui') {
    ensure(!o.json, 'TUI não suporta --json. Use recall unit list --json para automação.');
    await startTui(store);
  }
  else if (a[0] === 'browser') {
    const port = Number(o.port || 6421); ensure(Number.isInteger(port) && port >= 0 && port <= 65535, 'Porta inválida.');
    store.config();
    for (const unit of store.list()) { const result = autoLink(store, unit); if (result.warning) console.error(result.warning); }
    const server = await serve(store, port, o.host || '127.0.0.1', { devReload: o['dev-reload'] || false });
    console.log(`Recall.md: http://127.0.0.1:${server.address().port}\nProjeto: ${store.cwd}\nCtrl+C para encerrar.`);
    for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close(() => process.exit(0)));
  } else { console.error(usage); process.exitCode = 1; }
} catch (e) { console.error(`Recall.md: ${e.message}`); process.exitCode = 1; }
