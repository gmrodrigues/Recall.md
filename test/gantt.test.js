import { test } from 'node:test';
import assert from 'node:assert/strict';
import { comparisonGraph, overviewModel } from '../web/flow/model.js';

const date = '2026-11-19';
const start = Date.parse(date + 'T12:00:00Z') / 60000;
const slot = (id, { name = 'cartão', offset = 0, minutes = 10, day = date, schedules = ['one'], unit = 'RCL-1' } = {}) => ({
  id, date: day, start: start + offset, end: start + offset + minutes, phase: 'Em estudo',
  card: { kind: 'unit', unit, id: unit, front: name }, schedules,
});

test('Gantt consolidado agrupa por data e cronograma, incluindo trabalho compartilhado e concluído', () => {
  const other = '2026-11-20';
  const agenda = {
    schedules: [{ id: 'one', name: 'Primeiro' }, { id: 'two', name: 'Segundo' }],
    sessions: [slot('shared', { day: other, schedules: ['one', 'two'], minutes: 15 })],
    confirmations: [slot('confirmed', { minutes: 5 })],
    availability: { timeZone: 'UTC' },
  };
  const model = overviewModel(agenda);
  assert.deepEqual(model.days, [date, other]);
  assert.deepEqual(model.rows.map(row => row.cells.map(cell => cell?.minutes)), [[5, 15], [undefined, 15]]);
});

test('Gantt comparativo liga trechos repartidos e distingue adições, retiradas e horários iguais', () => {
  const before = [slot('old'), slot('same', { name: 'igual', unit: 'RCL-2', offset: 20 }), slot('removed', { name: 'retirado', unit: 'RCL-3', offset: 40 })];
  const after = [slot('part-a', { offset: 60, minutes: 4 }), slot('part-b', { offset: 70, minutes: 6 }),
    before[1], slot('added', { name: 'novo', unit: 'RCL-4', offset: 80 })];
  const graph = comparisonGraph(before, after, 'UTC', 'UTC');
  assert.deepEqual(graph.edges.map(edge => [edge.source, edge.target]), [
    [`before:unit:${date}:RCL-1`, `after:unit:${date}:RCL-1`],
  ]);
  const nodeClass = id => graph.nodes.find(node => node.id === id).class;
  assert.match(nodeClass(`before:unit:${date}:RCL-3`), /flow-removed/);
  assert.match(nodeClass(`after:unit:${date}:RCL-4`), /flow-added/);
  assert.match(nodeClass(`after:unit:${date}:RCL-2`), /flow-unchanged/);
});

test('Gantt mantém dias vazios, escala as barras pelo horário e desloca mudanças no mesmo dia', () => {
  const later = '2026-11-21';
  const agenda = {
    schedules: [{ id: 'one', name: 'Plano' }], confirmations: [],
    sessions: [slot('x', { minutes: 15 }), slot('y', { offset: 30, minutes: 30, day: later })],
    availability: { timeZone: 'UTC' },
  };
  const model = overviewModel(agenda);
  assert.deepEqual(model.columns.map(column => column.date), [date, '2026-11-20', later]);
  assert.deepEqual(model.axis, { from: 720, to: 780 });
  assert.deepEqual(model.rows[0].cells.map(cell => cell?.bars.map(bar => [bar.left, bar.width])),
    [[[0, 25]], undefined, [[50, 50]]]);
  const graph = comparisonGraph([slot('before')], [slot('after', { offset: 60 })], 'UTC', 'UTC');
  assert.ok(graph.nodes.find(node => node.id === `after:unit:${date}:RCL-1`).position.x > graph.nodes.find(node => node.id === `before:unit:${date}:RCL-1`).position.x);
});

test('cada dia tem Antes e Depois, cartões em pilha e total sem duplicar etapas fracionadas', () => {
  const later = '2026-11-21';
  const before = [slot('first', { minutes: 20 }), slot('second', { offset: 30, minutes: 45, unit: 'RCL-2' }),
    slot('other', { name: 'Outro', offset: 120, day: later })];
  const after = [slot('moved', { minutes: 20, offset: 90 }), before[1], before[2]];
  const graph = comparisonGraph(before, after, 'UTC', 'UTC');
  const get = id => graph.nodes.find(node => node.id === id);
  assert.equal(get(`before:unit:${date}:RCL-1`).position.x, get(`before:unit:${date}:RCL-2`).position.x);
  assert.ok(get(`before:unit:${date}:RCL-1`).position.y < get(`before:unit:${date}:RCL-2`).position.y);
  assert.ok(get(`after:unit:${date}:RCL-1`).position.x > get(`before:unit:${date}:RCL-1`).position.x);
  assert.ok(get(`before:unit:${later}:RCL-1`).position.x > get(`after:unit:${date}:RCL-1`).position.x);
  assert.equal(get('before:heading:' + date).data.label, 'Antes\n2 fichas · 1 h 5 min');
  assert.equal(get('after:heading:' + later).data.label, 'Depois\n1 ficha · 10 min');
  assert.equal(get('divider:' + later).type, 'dayDivider');
  const agenda = overviewModel({
    sessions: before, confirmations: [], schedules: [{ id: 'one', name: 'Plano' }], availability: { timeZone: 'UTC' },
  });
  assert.deepEqual(agenda.columns.map(day => day.totals), [
    { cards: 2, minutes: 65 }, { cards: 0, minutes: 0 }, { cards: 1, minutes: 10 },
  ]);
});

test('todos os dias são paginados, folgas contam por cronograma e sessões aparecem no dia efetivo', () => {
  const plan = { id: 'one', name: 'Plano', startDate: '2026-11-01', deadline: '2026-11-20' };
  const actualDay = '2026-11-10';
  const reference = Date.parse('2026-11-19T12:10:00Z');
  const agenda = {
    availability: { timeZone: 'UTC' },
    schedules: [plan],
    rests: [{ scheduleId: 'one', date: '2026-11-09', start: 100, end: 112 },
      { scheduleId: 'one', date: '2026-11-20', start: 200, end: 212 }],
    sessions: [slot('passed', { offset: -15 }), slot('future', { offset: 30 })],
    confirmations: [slot('done', { name: 'Realizado', day: '2026-11-09' })],
  };
  Object.assign(agenda.confirmations[0], { completedDate: actualDay, confirmedAt: actualDay + 'T12:00:00Z', actualMinutes: 7 });
  const first = overviewModel(agenda, 0, reference);
  const last = overviewModel(agenda, 1, reference);
  assert.equal(first.columns.length + last.columns.length, 20);
  assert.equal(first.columns[0].date, '2026-11-01');
  assert.equal(last.columns.at(-1).date, '2026-11-20');
  const row = first.rows[0];
  assert.equal(row.restCount, 2);
  assert.equal(row.restMinutes, 24);
  assert.ok(row.restByDate.has('2026-11-09'));
  assert.ok(!row.restByDate.has('2026-11-11'));
  assert.equal(row.cells[9].bars[0].status, 'done');
  assert.equal(row.cells[9].bars[0].minutes, 7);
  const finalDay = last.columns.findIndex(day => day.date === date);
  assert.deepEqual(last.rows[0].cells[finalDay].bars.map(bar => bar.status), ['missed', 'planned']);
  const graph = comparisonGraph(agenda.sessions, agenda.sessions, 'UTC', 'UTC',
    { beforeAgenda: agenda, afterAgenda: agenda, now: reference, page: 2 });
  assert.equal(graph.pagination.pageCount, 3);
  assert.ok(graph.nodes.some(node => node.class?.includes('flow-rest')));
  assert.ok(graph.nodes.some(node => node.id === `before:unit:${date}:RCL-1` && node.class.includes('flow-status-missed')));
});

test('uma conexão que atravessa páginas mantém o horário do outro intervalo', () => {
  const old = slot('old');
  const later = slot('new', { day: '2026-11-29', offset: 10 * 1440 });
  const graph = comparisonGraph([old], [later], 'UTC', 'UTC');
  assert.equal(graph.pagination.pageCount, 2);
  assert.equal(graph.edges[0].target, `after:unit:2026-11-29:RCL-1`);
  const endpoint = graph.nodes.find(node => node.id === `after:unit:2026-11-29:RCL-1`);
  assert.match(endpoint.data.label, /29\/11\/2026/);
  assert.match(endpoint.class, /flow-continuation/);
});

test('visualização do cronograma salvo usa uma coluna por dia com nome da semana, horários e folga', () => {
  const agenda = {
    schedules: [{ id: 'one', name: 'Plano', startDate: date, deadline: '2026-11-20' }],
    rests: [{ scheduleId: 'one', date: '2026-11-20', start: 1, end: 21 }],
    confirmations: [],
  };
  const graph = comparisonGraph([], [slot('saved')], 'UTC', 'UTC', { afterAgenda: agenda, displayOnly: true });
  assert.equal(graph.edges.length, 0);
  assert.ok(graph.nodes.every(node => !node.id.startsWith('before:')));
  assert.deepEqual(graph.nodes.find(node => node.id === 'date:2026-11-20').data,
    { date: '20/11/2026', weekday: 'Sexta-feira' });
  assert.match(graph.nodes.find(node => node.id.startsWith('after:rest:')).data.label, /1 bloco de folga · 20 min/);
});

test('avanço do Kanban fica verde no gráfico, sem incrementar tempo de estudo', () => {
  const advanced = { ...slot('kanban', { minutes: 0 }), workflowOnly: true };
  const agenda = { schedules: [{ id: 'one', name: 'Plano', startDate: date, deadline: date }],
    availability: { timeZone: 'UTC' }, sessions: [], confirmations: [], workflowCompletions: [advanced] };
  const overview = overviewModel(agenda);
  assert.deepEqual(overview.columns[0].totals, { cards: 1, minutes: 0 });
  assert.equal(overview.rows[0].cells[0].bars[0].status, 'done');
  assert.equal(overview.rows[0].cells[0].bars[0].workflowOnly, true);
  const graph = comparisonGraph([], [], 'UTC', 'UTC', { afterAgenda: agenda, displayOnly: true });
  const green = graph.nodes.find(node => node.id === `after:unit:${date}:RCL-1`);
  assert.match(green.class, /flow-status-done/);
  assert.match(green.data.label, /Estudada no quadro/);
  assert.doesNotMatch(green.data.label, /0 min/);
});

test('a prévia abre no intervalo alterado e mostra horários fracionados sem preencher a pausa', () => {
  const later = '2026-11-29';
  const before = [slot('old')];
  const after = [
    slot('new-a', { day: later, offset: 10 * 1440, minutes: 4 }),
    slot('new-b', { day: later, offset: 10 * 1440 + 20, minutes: 6 }),
  ];
  const graph = comparisonGraph(before, after, 'UTC', 'UTC', { page: null });
  assert.equal(graph.pagination.page, 1);
  const stage = graph.nodes.find(node => node.id === `after:unit:${later}:RCL-1`);
  assert.match(stage.data.label, /10 min\n12:00–12:04 · 12:20–12:26/);
  assert.doesNotMatch(stage.data.label, /12:00–12:26/);
  assert.equal(graph.edges.length, 1);
  assert.ok(graph.canvas.width > stage.position.x + 208);
});
