import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/core.js';
import { confirmScheduleSession, editSchedule, planSchedule, projectSchedule, removeSchedule, resolveGroups, schedulePreviews, suggestScheduleDeadline } from '../src/schedule.js';
import { serve } from '../src/server.js';

const today = '2026-11-19';
const now = Date.parse(today + 'T11:00:00Z');
const card = (id, deck) => ({ kind: 'unit', id, deck, unit: id, front: id });
const group = id => ({ type: 'deck', id });
const schedule = (id, groups, minutes, options = {}) => ({
  id, name: id, deadline: today, priority: 0, mode: 'sequential',
  groups, phases: [{ name: 'Em estudo', minutes }], ...options,
});
const window = (day, start, end) => ({ day, start, end });
const data = (schedules, windows, overtimeMinutes = 0) => ({
  schedules, sessions: [], confirmations: [], milestones: [],
  availability: { timeZone: 'UTC', windows, overtimeHours: 0, overtimeMinutes },
});

test('grupos sequenciais e round robin preservam ordem e eliminam sobreposição', () => {
  const cards = [card('a1', 'A'), card('a2', 'A'), card('b1', 'B'), card('b2', 'B')];
  const config = data([], []);
  config.milestones = [{ id: 'm', cards: [cards[0], cards[2], cards[3]] }];
  const item = schedule('S', [group('A'), { type: 'milestone', id: 'm' }], 1);
  assert.deepEqual(resolveGroups(item, config, cards).map(g => g.map(c => c.id)), [['a1', 'a2'], ['b1', 'b2']]);
  item.mode = 'round-robin';
  assert.deepEqual(resolveGroups(item, config, cards).flat().map(c => c.id), ['a1', 'b1', 'a2', 'b2']);
});

test('prazo mais próximo obtém a primeira janela se ambos couberem', () => {
  const config = data([
    schedule('alta', [group('A')], 5, { priority: 9, deadline: '2026-11-20' }),
    schedule('urgente', [group('B')], 5),
  ], [window(4, '12:00', '12:05'), window(5, '12:00', '12:05')]);
  const result = planSchedule(config, [card('a', 'A'), card('b', 'B')], now);
  assert.deepEqual(result.data.sessions.map(s => s.card.id), ['b', 'a']);
  assert.ok(result.summary.every(s => s.status === 'fits'));
});

test('compartilha trabalho, reparte sessões e minimiza extras', () => {
  const config = data([
    schedule('A', [group('D')], 12), schedule('B', [group('D')], 10),
  ], [window(4, '12:00', '12:05'), window(4, '13:00', '13:05')], 2);
  const result = planSchedule(config, [card('one', 'D')], now);
  assert.deepEqual(result.data.sessions.map(s => s.end - s.start), [5, 5, 2]);
  assert.equal(result.data.sessions.filter(s => s.overtime).length, 1);
  assert.ok(result.data.sessions.every(s => s.schedules.length === 2));
  assert.ok(result.summary.every(s => s.coverage === 100));
});

test('mostra insuficiência provada e preserva prioridade com janelas disputadas', () => {
  const config = data([
    schedule('alta', [group('A')], 5, { priority: 9 }), schedule('baixa', [group('B')], 5),
  ], [window(4, '12:00', '12:06')]);
  const result = planSchedule(config, [card('a', 'A'), card('b', 'B')], now);
  assert.deepEqual(result.summary.map(s => [s.status, s.coverage]), [['fits', 100], ['impossible', 20]]);
  const limited = data([schedule('longe', [group('A')], 1440, { deadline: '2027-11-19' })],
    [window(4, '12:00', '12:01')]);
  assert.equal(planSchedule(limited, [card('a', 'A')], now).summary[0].status, 'unknown');
});

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recall-schedule-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = new Store(dir);
  store.init();
  store.save({ title: 'Etapa', deck: 'D', cards: [{ id: 'one', front: 'Q', back: 'A', deck: 'D' }] });
  return store;
}

test('confirmação fracionada persiste, preserva o total e alimenta médias', t => {
  const store = fixture(t);
  const snapshot = store.scheduleSnapshot();
  const config = data([schedule('A', [group('D')], 10)], [window(4, '12:00', '12:05'), window(4, '13:00', '13:05')]);
  store.updateSchedule(snapshot.revision, () => ({ ...snapshot.data, ...planSchedule(config, snapshot.items, now).data }));
  const after = Date.parse(today + 'T14:00:00Z');
  for (const [i, actualMinutes] of [3, 4].entries()) {
    const { revision, data } = store.scheduleSnapshot();
    const result = confirmScheduleSession(store, { revision, sessionId: data.sessions[0].id, actualMinutes }, after);
    assert.equal(result.confirmations.at(-1).completed, i === 1);
  }
  const reopened = new Store(store.cwd).scheduleSnapshot();
  assert.deepEqual(reopened.data.confirmations.map(entry => entry.actualMinutes), [3, 4]);
  assert.equal(planSchedule(reopened.data, reopened.items, after).summary[0].studyComplete, true);
  const next = card('new', 'D');
  reopened.data.schedules[0].deadline = '2026-11-26';
  const forecast = planSchedule(reopened.data, [...reopened.items, next], after);
  assert.equal(forecast.data.sessions.reduce((sum, s) => sum + s.end - s.start, 0), 7);
});

test('API grava a proposta do servidor e rejeita prévia desatualizada', async t => {
  const store = fixture(t);
  const server = await serve(store, 0);
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}/api/schedule`;
  const request = async (route = '', body) => {
    const response = await fetch(base + route, body ? {
      method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' },
    } : undefined);
    return [response.status, await response.json()];
  };
  const [, snapshot] = await request();
  assert.deepEqual(snapshot.data.schedules, []);
  const [, first] = await request('/preview', { revision: snapshot.revision, schedule: schedule(undefined, [group('D')], 5, { name: 'Estudo' }) });
  const [, second] = await request('/preview', { revision: snapshot.revision });
  assert.equal((await request('/apply', { id: first.id }))[0], 200);
  assert.equal((await request('/apply', { id: second.id }))[0], 409);
  const [, refreshed] = await request();
  const [status, saved] = await request('/milestones', {
    revision: refreshed.revision, milestone: { name: 'Marco', units: [snapshot.items[0].id, snapshot.items[0].id] },
  });
  assert.equal(status, 201);
  assert.equal(saved.milestones[0].units.length, 1);
  assert.equal(new Store(store.cwd).schedule().schedules[0].name, 'Estudo');
});

test('horas extras confirmadas consomem o saldo da mesma semana no replanejamento', () => {
  const item = card('one', 'D');
  const config = data([schedule('A', [group('D')], 12)], [window(4, '12:00', '12:01')], 10);
  const historicalStart = Date.parse(today + 'T10:00:00Z') / 60000;
  config.confirmations.push({
    card: item, phase: 'Em estudo', start: historicalStart, end: historicalStart + 4,
    overtime: true, date: today, completedDate: today, actualMinutes: 3,
    plannedMinutes: 4, targetMinutes: 12, completed: false,
  });
  const result = planSchedule(config, [item], now);
  assert.equal(result.data.sessions.filter(session => session.overtime)
    .reduce((total, session) => total + session.end - session.start, 0), 6);
  assert.equal(result.summary[0].missing[0].minutes, 1);
});

test('fases de cada etapa e a ordem entre grupos aparecem nas sessões', () => {
  const phases = [{ name: 'Em estudo', minutes: 1 }, { name: 'Revisão', minutes: 1 }];
  const cards = [card('a1', 'A'), card('a2', 'A'), card('b1', 'B')];
  for (const [mode, order] of [['sequential', ['a1', 'a2', 'b1']], ['round-robin', ['a1', 'b1', 'a2']]]) {
    const config = data([schedule('S', [group('A'), group('B')], 1, { mode, phases })],
      [window(4, '12:00', '12:06')]);
    const result = planSchedule(config, cards, now);
    assert.deepEqual(result.data.sessions.map(session => [session.card.id, session.phase]),
      order.flatMap(id => phases.map(phase => [id, phase.name])));
  }
});

test('migra tolerância legada, persiste horas e minutos e rejeita minuto 60 na API', async t => {
  const store = fixture(t);
  const file = path.join(store.root, 'schedule.json');
  const legacy = store.schedule();
  legacy.version = 1;
  legacy.availability = { timeZone: 'UTC', windows: [], overtimeMinutes: 95 };
  fs.writeFileSync(file, JSON.stringify(legacy));
  const server = await serve(store, 0);
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}/api/schedule`;
  const snapshot = await (await fetch(base)).json();
  assert.deepEqual(snapshot.data.availability, { timeZone: 'UTC', windows: [], overtimeHours: 1, overtimeMinutes: 35 });
  const post = (route, body) => fetch(base + route, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const availability = { ...snapshot.data.availability, overtimeHours: 2, overtimeMinutes: 60 };
  assert.equal((await post('/preview', { revision: snapshot.revision, availability })).status, 400);
  availability.overtimeMinutes = 59;
  const preview = await post('/preview', { revision: snapshot.revision, availability });
  assert.equal(preview.status, 201);
  const { id } = await preview.json();
  assert.equal((await post('/apply', { id })).status, 200);
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(saved.version, 2);
  assert.deepEqual(saved.availability, availability);
});

test('sugere prazo com 50% de margem, sem contar cartões duplicados nem recorrer a extras', () => {
  const cards = [card('one', 'D')];
  const settings = data([], [window(4, '12:00', '12:10'), window(5, '12:00', '12:10')], 20);
  const snapshot = { revision: 'same', data: settings, items: cards };
  const draft = schedule(undefined, [group('D'), group('D')], 9, {
    name: 'Estudo', phases: [{ name: 'Em estudo', minutes: 9 }, { name: 'Revisão', minutes: 2 }],
  });
  assert.deepEqual(suggestScheduleDeadline(snapshot, { revision: 'same', schedule: draft }, now), {
    startDate: '2026-11-19', date: '2026-11-20', effortMinutes: 11, bufferMinutes: 6,
  });
  assert.equal(settings.schedules.length, 0);
  const unavailable = { ...settings.availability, windows: [] };
  assert.deepEqual(suggestScheduleDeadline(snapshot, { revision: 'same', schedule: draft, availability: unavailable }, now), {
    startDate: null, date: null, effortMinutes: 11, bufferMinutes: 6,
  });
});

test('agenda nova parte de 20 minutos extras e preserva tolerância gravada', t => {
  const store = fixture(t);
  const snapshot = store.scheduleSnapshot();
  assert.equal(snapshot.data.availability.overtimeHours, 0);
  assert.equal(snapshot.data.availability.overtimeMinutes, 20);
  store.updateSchedule(snapshot.revision, ({ data }) => {
    data.availability.overtimeMinutes = 0;
    return data;
  });
  assert.equal(new Store(store.cwd).schedule().availability.overtimeMinutes, 0);
});

test('fases usam a associação do milestone e só planejam os cartões incluídos', () => {
  const cards = [card('enredo', 'D'), card('design', 'D'), card('extra', 'D')];
  const config = data([], [window(4, '12:00', '12:15')]);
  config.milestones = [
    { id: 'story', name: 'Enredo', cards: [cards[0]] },
    { id: 'design', name: 'Design', cards: [] },
  ];
  cards[1].milestoneId = 'design';
  const draft = schedule(undefined, [group('D')], 5, {
    name: 'Escopo', phases: [{ milestoneId: 'design', minutes: 3 }, { milestoneId: 'story', minutes: 2 }],
  });
  editSchedule(config, cards, draft);
  const { data: planned, summary } = planSchedule(config, cards, now);
  assert.deepEqual(planned.sessions.map(session => [session.card.id, session.milestoneName]),
    [['design', 'Design'], ['enredo', 'Enredo']]);
  assert.deepEqual(summary[0].included.map(item => item.id), ['design', 'enredo']);
});

test('marco padrão inclui etapas e só etapas novas do deck agendado exigem fase', t => {
  const store = fixture(t);
  const unit = store.get('RCL-1');
  const previews = schedulePreviews(store, (config, items) => planSchedule(config, items, now));
  const { id } = previews.create({
    revision: store.scheduleSnapshot().revision,
    schedule: schedule(undefined, [group('D')], 5, { name: 'Todo o escopo', phases: [{ milestoneId: '', minutes: 5 }] }),
  });
  assert.equal(store.schedule().milestones.length, 0);
  const saved = previews.apply(id);
  const [milestone] = saved.milestones;
  assert.equal(milestone.name, 'Todo o escopo');
  assert.deepEqual(milestone.units, ['RCL-1']);
  assert.equal(saved.schedules[0].phases[0].milestoneId, milestone.id);
  assert.throws(() => store.save({ title: 'Etapa nova', deck: 'D' }), /Selecione um capítulo/);
  const updated = store.save({ title: 'Etapa nova', deck: 'D', milestoneId: milestone.id });
  assert.equal(updated.milestoneId, milestone.id);
  const before = store.scheduleSnapshot().revision;
  store.save({ cards: [...unit.cards, { id: 'new', front: 'Nova frente', back: 'Novo verso' }] }, unit.id);
  const snapshot = store.scheduleSnapshot();
  assert.equal(snapshot.revision, before);
  const proposed = planSchedule(snapshot.data, snapshot.items, now);
  assert.deepEqual(proposed.summary[0].included.map(item => item.id), ['RCL-1', updated.id]);
});

test('data de início exclui janelas anteriores da prévia e da sugestão', () => {
  const cards = [card('one', 'D')];
  const config = data([], [window(4, '12:00', '12:45'), window(5, '12:00', '12:30')]);
  const input = schedule(undefined, [group('D')], 20, {
    name: 'Estudo', startDate: '2026-11-20', deadline: '2026-11-20',
  });
  const snapshot = { revision: 'same', data: config, items: cards };
  assert.equal(suggestScheduleDeadline(snapshot, { revision: 'same', schedule: input }, now).date, '2026-11-20');
  assert.throws(() => editSchedule(config, cards, { ...input, deadline: today }), /anterior ou igual/);
  assert.throws(() => editSchedule(config, cards, { ...input, startDate: '2026-11-31' }), /inválida/);
  editSchedule(config, cards, input);
  const planned = planSchedule(config, cards, now);
  assert.deepEqual(planned.data.sessions.map(session => session.date), ['2026-11-20']);
  assert.equal(planned.data.schedules[0].startDate, '2026-11-20');
});

test('início automático usa a próxima janela regular livre e a data manual prevalece', () => {
  const item = card('one', 'D');
  const config = data([], [window(4, '12:00', '12:10'), window(5, '12:00', '12:30')], 20);
  const occupied = Date.parse(today + 'T12:00:00Z') / 60000;
  config.sessions.push({ start: occupied, end: occupied + 10, schedules: ['other'], card: item, phase: 'Em estudo' });
  const snapshot = { revision: 'same', data: config, items: [item] };
  const draft = schedule(undefined, [group('D')], 10, { name: 'Estudo' });
  assert.deepEqual(suggestScheduleDeadline(snapshot, { revision: 'same', schedule: draft }, now), {
    startDate: '2026-11-20', date: '2026-11-20', effortMinutes: 10, bufferMinutes: 5,
  });
  const manualStart = '2026-11-27';
  const suggestion = suggestScheduleDeadline(snapshot, {
    revision: 'same', schedule: { ...draft, startDate: manualStart },
  }, now);
  assert.equal(suggestion.startDate, manualStart);
  assert.equal(suggestion.date, manualStart);
});

test('folga de outro cronograma é preservada quando há alternativa e avisada quando indispensável', () => {
  const a = card('a', 'A'), b = card('b', 'B');
  const windows = [window(4, '12:00', '12:30'), window(5, '12:00', '12:30')];
  const old = data([schedule('A', [group('A')], 15, { startDate: today })], windows);
  const wednesday = Date.parse('2026-11-18T12:00:00Z') / 60000;
  old.confirmations.push({ id: 'done', card: a, phase: 'Em estudo', start: wednesday, end: wednesday + 15,
    completedDate: '2026-11-18', date: '2026-11-18', schedules: ['A'], completed: true, plannedMinutes: 15, actualMinutes: 15 });
  const addition = schedule('B', [group('B')], 15, { startDate: today, deadline: '2026-11-20' });
  const candidate = structuredClone(old);
  candidate.schedules.push(addition);
  const preserved = planSchedule(candidate, [a, b], now, old);
  const bSession = preserved.data.sessions.find(session => session.card.id === 'b');
  assert.ok(bSession.date !== today || bSession.start >= Date.parse(today + 'T12:07:00Z') / 60000);
  assert.deepEqual(preserved.restUsage, []);
  const forced = structuredClone(old);
  const bPast = { ...old.confirmations[0], id: 'b-past', card: b, schedules: ['B'] };
  forced.confirmations.push(bPast);
  forced.schedules.push({ ...addition, deadline: today,
    phases: [{ name: 'Em estudo', minutes: 15 }, { name: 'Prática', minutes: 30 }] });
  const result = planSchedule(forced, [a, b], now, old);
  assert.equal(result.summary.find(item => item.id === 'B').coverage, 100);
  assert.deepEqual(result.restUsage, [{ date: today, scheduleId: 'A', name: 'A', minutes: 7, usedBy: ['B'] }]);
});

test('sessão vencida continua no Gantt até o esforço ser reprogramado', () => {
  const item = card('one', 'D');
  const original = data([schedule('S', [group('D')], 20)], []);
  const past = Date.parse(today + 'T09:00:00Z') / 60000;
  original.sessions = [{ id: 'missed', start: past, end: past + 20, date: today, card: item, phase: 'Em estudo', schedules: ['S'] }];
  const noRoom = planSchedule(structuredClone(original), [item], now);
  assert.equal(noRoom.data.sessions[0].id, 'missed');
  assert.equal(noRoom.summary[0].coverage, 0);
  const partial = structuredClone(original);
  partial.availability.windows = [window(4, '12:00', '12:10')];
  const revised = planSchedule(partial, [item], now);
  assert.equal(revised.data.sessions.find(session => session.id === 'missed').end - past, 10);
  assert.equal(revised.summary[0].coverage, 50);
  const full = structuredClone(original);
  full.availability.windows = [window(4, '12:00', '12:20')];
  const replanned = planSchedule(full, [item], now);
  assert.equal(replanned.data.sessions.some(session => session.id === 'missed'), false);
  assert.equal(replanned.summary[0].coverage, 100);
});

test('duas horas de estudo em dois dias geram até uma hora de folga dentro da janela', () => {
  const cards = [card('a', 'D'), card('b', 'D')];
  const weeks = [window(4, '12:00', '13:00'), window(5, '12:00', '13:00'), window(6, '18:00', '19:00')];
  const config = data([schedule('S', [group('D')], 60, { startDate: today, deadline: '2026-11-21' })], weeks);
  const result = planSchedule(config, cards, now);
  assert.deepEqual(result.data.sessions.map(session => session.date), [today, '2026-11-20']);
  const start = Date.parse('2026-11-21T18:00:00Z') / 60000;
  assert.deepEqual(result.data.rests, [{ scheduleId: 'S', date: '2026-11-21', start, end: start + 60 }]);
  const shorter = structuredClone(result.data);
  shorter.availability.windows[2].end = '18:20';
  const limited = planSchedule(shorter, cards, now);
  assert.equal(limited.data.rests.reduce((sum, slot) => sum + slot.end - slot.start, 0), 20);
});

test('avançar para revisão torna o cartão verde sem inventar sessões ou minutos', t => {
  const store = fixture(t);
  const snapshot = store.scheduleSnapshot();
  const config = data([schedule('A', [group('D')], 20)], [window(4, '12:00', '13:00')]);
  const planned = planSchedule(config, snapshot.items, now).data;
  store.updateSchedule(snapshot.revision, () => ({ ...snapshot.data, ...planned }));
  store.save({ status: 'Praticando' }, 'RCL-1');
  const practicing = store.scheduleSnapshot();
  assert.equal(projectSchedule(practicing.data, practicing.items, now).sessions.length, 1);
  store.save({ status: 'Em revisão' }, 'RCL-1');
  const review = store.scheduleSnapshot();
  assert.notEqual(practicing.revision, review.revision);
  const projected = projectSchedule(review.data, review.items, now);
  assert.equal(projected.sessions.length, 0);
  assert.equal(projected.workflowCompletions.length, 1);
  assert.equal(projected.workflowCompletions[0].workflowOnly, true);
  assert.equal(projected.workflowCompletions[0].end - projected.workflowCompletions[0].start, 0);
  assert.deepEqual(projected.confirmations, []);
  const next = planSchedule(review.data, review.items, now);
  assert.equal(next.data.sessions.length, 0);
  assert.equal(next.summary[0].studyComplete, true);
  assert.equal(next.workflow.length, 1);
  assert.equal(store.schedule().confirmations.length, 0);
});

test('etapa é agendada uma vez, mesmo com várias questões, e etapa sem flashcards também entra', t => {
  const store = fixture(t);
  const first = store.get('RCL-1');
  store.save({ cards: [...first.cards, { id: 'two', front: 'Mais uma', back: 'Resposta' }],
    questions: [{ id: 'q', type: 'text', prompt: 'Pergunta', answer: 'Resposta' }] }, first.id);
  const second = store.save({ title: 'Etapa sem flashcards', deck: 'D' });
  const snapshot = store.scheduleSnapshot();
  const config = data([schedule('A', [group('D')], 15)], [window(4, '12:00', '13:00')]);
  const result = planSchedule(config, snapshot.items, now);
  assert.deepEqual(result.data.sessions.map(session => [session.card.id, session.end - session.start]), [[first.id, 15], [second.id, 15]]);
  assert.deepEqual(result.summary[0].included.map(item => item.front), [first.title, second.title]);
});

test('cronograma anterior deixa de repetir horários de flashcards e preserva o histórico antigo', t => {
  const store = fixture(t);
  const snapshot = store.scheduleSnapshot();
  const start = Date.parse(today + 'T12:00:00Z') / 60000;
  const config = data([schedule('A', [group('D')], 10)], [window(4, '12:00', '13:00')]);
  const legacy = id => ({ id, start, end: start + 10, date: today, targetMinutes: 10,
    phase: 'Em estudo', card: { unit: 'RCL-1', id, front: 'Pergunta antiga', deck: 'D' }, schedules: ['A'] });
  config.sessions = [legacy('old1'), { ...legacy('old2'), start: start + 10, end: start + 20 }];
  config.confirmations = [{ ...legacy('history'), completed: true, actualMinutes: 8, plannedMinutes: 10 }];
  store.updateSchedule(snapshot.revision, () => ({ ...snapshot.data, ...config }));
  const projected = projectSchedule(config, snapshot.items, now);
  assert.deepEqual(projected.sessions.map(session => [session.card.id, session.card.front, session.end - session.start]),
    [['RCL-1', 'Etapa', 10]]);
  assert.equal(projected.confirmations[0].id, 'history');
  const saved = confirmScheduleSession(store, {
    revision: store.scheduleSnapshot().revision, sessionId: projected.sessions[0].id, actualMinutes: 8,
  }, (start + 10) * 60000);
  assert.deepEqual(saved.confirmations.map(entry => [entry.card.id, entry.actualMinutes]), [['history', 8], ['RCL-1', 8]]);
});

test('arquivar deck oculta etapas e cronogramas sem perder sua configuração ao editar a agenda ativa', t => {
  const store = fixture(t);
  const hidden = store.save({ title: 'Etapa que será arquivada', deck: 'Oculto' });
  const blank = 'Deck vazio';
  store.changeDeck({ action: 'create', name: blank });
  store.changeDeck({ action: 'up', name: blank });
  assert.deepEqual(store.deckCatalog().map(deck => deck.name), ['D', blank, 'Oculto']);
  const snapshot = store.scheduleSnapshot();
  const config = data([
    schedule('A', [group('D')], 15),
    schedule('B', [group('Oculto')], 15),
    schedule('C', [group('D'), group('Oculto')], 15),
  ], [window(4, '12:00', '13:00')]);
  const planned = planSchedule(config, snapshot.items, now).data;
  store.updateSchedule(snapshot.revision, () => ({ ...snapshot.data, ...planned }));
  store.changeDeck({ action: 'archive', name: 'Oculto' });
  const archived = store.scheduleSnapshot();
  assert.deepEqual(archived.data.schedules.map(item => item.id), ['A', 'C']);
  assert.deepEqual(archived.data.schedules[1].groups, [group('D')]);
  assert.ok(archived.data.sessions.every(slot => slot.card.unit !== hidden.id));
  assert.throws(() => store.get(hidden.id), /Unidade não encontrada/);
  assert.throws(() => store.save({ title: 'Indisponível', deck: 'Oculto' }), /Plano de estudo indisponível/);
  const visible = store.save({ title: 'Etapa de outro deck', deck: blank });
  assert.notEqual(visible.id, hidden.id);
  const current = store.scheduleSnapshot();
  store.updateSchedule(current.revision, ({ data }) => ({ ...data, availability: { ...data.availability, overtimeMinutes: 25 } }));
  store.changeDeck({ action: 'restore', name: 'Oculto' });
  const restored = store.scheduleSnapshot();
  assert.deepEqual(restored.data.schedules.map(item => item.id), ['A', 'B', 'C']);
  assert.deepEqual(restored.data.schedules[2].groups, [group('D'), group('Oculto')]);
  assert.equal(restored.data.availability.overtimeMinutes, 25);
  assert.ok(restored.data.sessions.some(slot => slot.card.unit === hidden.id));
  assert.throws(() => store.changeDeck({ action: 'remove', name: 'Oculto', confirmation: 'errado' }), /nome exato/);
  store.changeDeck({ action: 'remove', name: 'Oculto', confirmation: 'Oculto' });
  assert.throws(() => store.changeDeck({ action: 'restore', name: 'Oculto' }), /arquivado não encontrado/);
  assert.ok(store.list({ includeHidden: true }).some(unit => unit.id === hidden.id));
});

test('remover cronograma exige nome exato e preserva sessões compartilhadas e confirmações', t => {
  const store = fixture(t);
  const snapshot = store.scheduleSnapshot();
  const start = Date.parse(today + 'T12:00:00Z') / 60000;
  const slot = (id, schedules) => ({ id, schedules, phase: 'Em estudo', card: snapshot.items[0], date: today, start, end: start + 10 });
  const configured = data([schedule('A', [group('D')], 10), schedule('B', [group('D')], 10)], []);
  store.updateSchedule(snapshot.revision, () => ({
    ...snapshot.data, ...configured,
    sessions: [slot('exclusive', ['A']), slot('shared', ['A', 'B'])],
    confirmations: [{ ...slot('history', ['A']), actualMinutes: 8, plannedMinutes: 10 }],
  }));
  const current = store.scheduleSnapshot();
  assert.throws(() => removeSchedule(store, { id: 'A', revision: current.revision, confirmation: 'B' }, now), /nome exato/);
  assert.throws(() => removeSchedule(store, { id: 'A', revision: snapshot.revision, confirmation: 'A' }, now), /cronograma mudou/);
  const removed = removeSchedule(store, { id: 'A', revision: current.revision, confirmation: 'A' }, now);
  assert.deepEqual(removed.schedules.map(item => item.id), ['B']);
  assert.deepEqual(removed.sessions.map(({ id, schedules }) => [id, schedules]), [['shared', ['B']]]);
  assert.deepEqual(removed.confirmations.map(({ id, actualMinutes, schedules }) => [id, actualMinutes, schedules]), [['history', 8, []]]);
  assert.equal(store.get(snapshot.items[0].id).title, snapshot.items[0].front);
});

test('etapa reaberta aparece como pendente e entra na próxima proposta sem registrar sessão fictícia', t => {
  const store = fixture(t);
  store.save({ status: 'Em revisão' }, 'RCL-1');
  const other = store.save({ title: 'Outra etapa', deck: 'D' });
  const snapshot = store.scheduleSnapshot();
  const config = data([schedule('A', [group('D')], 10)], [window(4, '12:00', '12:25')]);
  const planned = planSchedule(config, snapshot.items, now);
  store.updateSchedule(snapshot.revision, () => ({ ...snapshot.data, ...planned.data }));
  const savedSlot = store.schedule().sessions[0];
  assert.equal(savedSlot.card.unit, other.id);

  store.save({ status: 'Estudando' }, 'RCL-1');
  const snapshotAfter = store.scheduleSnapshot();
  const pending = projectSchedule(snapshotAfter.data, snapshotAfter.items, now);
  assert.deepEqual(pending.sessions, [savedSlot]);
  assert.deepEqual(pending.pendingPlacement.map(entry => [entry.card.unit, entry.needsScheduling, entry.end - entry.start]),
    [['RCL-1', true, 0]]);
  assert.deepEqual(pending.confirmations, []);
  const proposed = planSchedule(snapshotAfter.data, snapshotAfter.items, now);
  assert.deepEqual(proposed.pending, []);
  assert.ok(proposed.data.sessions.some(session => session.card.unit === 'RCL-1'));
  assert.deepEqual(store.schedule().sessions, [savedSlot]);
});

test('minutos por grupo incluem todas as fichas selecionadas e impedem sobreposição de conteúdo', () => {
  const items = [card('a', 'A'), card('b', 'B'), card('c', 'C'), card('d', 'D')];
  const config = data([schedule('existente', [group('A')], 10)], [window(4, '12:00', '13:00')]);
  config.milestones = [{ id: 'part', name: 'Capítulo', units: ['b'] }, { id: 'assigned', name: 'Em uso', units: ['a'] }];
  const draft = { ...schedule(undefined, [], 10), name: 'Estudo', groups: [
    { type: 'milestone', id: 'part', minutes: 7 },
    { type: 'deck', id: 'C', minutes: 12 },
  ] };
  assert.throws(() => editSchedule(config, items, { ...draft, groups: [{ ...draft.groups[0], id: 'assigned' }] }),
    /já está em outro cronograma/);
  assert.throws(() => editSchedule(config, items, { ...draft, groups: [...draft.groups, { type: 'deck', id: 'B', minutes: 15 }] }),
    /já aparecem em outro grupo/);
  editSchedule(config, items, draft);
  const result = planSchedule(config, items, now);
  const created = result.summary.find(entry => entry.name === 'Estudo');
  assert.deepEqual(created.estimates.map(estimate => [estimate.unit, estimate.estimatedMinutes]), [['b', 7], ['c', 12]]);
  assert.equal(config.milestones.filter(chapter => chapter.name === 'Estudo').length, 1);
});
