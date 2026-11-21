import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '../src/core.js';
import { materialPages, materialResources } from '../src/material.js';
import { configureSchedule, confirmScheduleSession, planSchedule, projectSchedule, suggestScheduleDeadline, typicalDurations } from '../src/schedule.js';
import { serve } from '../src/server.js';
import { sampleVideoDurations } from '../web/video-metadata.js';
import { renderStudyTime } from '../web/material-view.js';

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'recall-material-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = new Store(directory);
  store.init();
  return store;
}

const page = (id, content = '', links = []) => ({ id, title: id, sections: [{ title: 'Seção', text: content, links }] });
const day = '2026-11-19';
const now = Date.parse(day + 'T11:00:00Z');
const video = name => 'https://video.example/' + name + '.mp4';
const configured = { timeZone: 'UTC', windows: [{ day: 4, start: '12:00', end: '15:00' }], overtimeHours: 0, overtimeMinutes: 0 };
const draft = {
  name: 'Estudo', priority: 0, groups: [{ type: 'deck', id: 'D' }], mode: 'sequential',
  startDate: day, deadline: day, phases: [{ name: 'Em estudo', minutes: 10 }],
};

test('material exibe previsão mínima antes de agendar e preserva o tempo realizado', () => {
  assert.match(renderStudyTime(), /5 min previstos/);
  assert.match(renderStudyTime({ estimatedMinutes: 2, actualMinutes: 1 }), /5 min previstos · 1 min realizados/);
  assert.match(renderStudyTime({ estimatedMinutes: 12 }), /12 min previstos/);
});

test('material preserva descrição anterior e identifica mídia sem cobrar leitura duplicada', t => {
  const store = fixture(t);
  const legacy = store.save({ title: 'Legado', deck: 'D', description: 'Texto antigo' });
  assert.equal(materialPages(legacy)[0].sections[0].text, 'Texto antigo');
  const content = '[artigo](https://www.docs.example/artigo) https://www.docs.example/artigo#trecho https://docs.example/outro';
  const youtube = 'https://youtu.be/dQw4w9WgXcQ';
  const updated = store.save({ material: [
    page('material', content, [{ url: youtube }, { url: 'https://img.example/capa.png' }]),
    page('segundo', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ e ' + video('teste')),
  ] }, legacy.id);
  assert.equal(updated.description, legacy.description);
  const resources = materialResources(updated);
  assert.deepEqual(resources.links, [{ domain: 'docs.example', count: 2 }]);
  assert.equal(resources.videos.length, 2);
  assert.throws(() => store.save({ material: [page('id', '', [{ url: 'javascript:alert(1)' }])] }, legacy.id), /HTTP ou HTTPS/);
});

test('amostra aleatória consulta até cinco vídeos e informa o progresso até em falhas', async () => {
  const videos = Array.from({ length: 8 }, (_, i) => ({ id: String(i) }));
  const stages = [];
  const probed = [];
  const sampled = await sampleVideoDurations(videos, (checked, count) => stages.push([checked, count]), async entry => {
    probed.push(entry.id);
    return probed.length === 3 ? null : 180;
  }, () => 0.99);
  assert.equal(probed.length, 5);
  assert.equal(new Set(probed).size, 5);
  assert.notDeepEqual(probed, ['0', '1', '2', '3', '4']);
  assert.equal(sampled.length, 4);
  assert.deepEqual(stages, Array.from({ length: 6 }, (_, i) => [i, 5]));
});

test('prazo e proposta usam páginas, links por domínio e média proporcional de vídeo sem outlier', t => {
  const store = fixture(t);
  const one = store.save({ title: 'Etapa longa', deck: 'D', material: [
    page('a', video('um') + ' ' + video('dois') + ' https://docs.example/a https://docs.example/b'),
    page('b', 'https://other.example/guia'),
  ] });
  const two = store.save({ title: 'Etapa curta', deck: 'D', material: [
    page('c', video('tres')),
  ] });
  const snapshot = store.scheduleSnapshot();
  const settings = { ...configured, linkMinutesByDomain: [{ domain: 'docs.example', minutes: 8 }] };
  const schedule = { ...draft, videoSamples: [
    { id: video('um'), seconds: 175 }, { id: video('dois'), seconds: 185 }, { id: video('tres'), seconds: 1200 },
  ] };
  const intent = { revision: snapshot.revision, availability: settings, schedule };
  const suggestion = suggestScheduleDeadline(snapshot, intent, now);
  assert.equal(suggestion.videoAverageSeconds, 180);
  assert.equal(suggestion.videoSampleCount, 2);
  assert.equal(suggestion.effortMinutes, 65);
  assert.equal(suggestion.bufferMinutes, 33);
  const planned = planSchedule(configureSchedule(snapshot, intent), snapshot.items, now);
  assert.deepEqual(planned.data.schedules[0].studyEstimates, [
    { unit: one.id, baseMinutes: 10, pageMinutes: 10, videoMinutes: 6, linkMinutes: 21, estimatedMinutes: 47 },
    { unit: two.id, baseMinutes: 10, pageMinutes: 5, videoMinutes: 3, linkMinutes: 0, estimatedMinutes: 18 },
  ]);
  store.updateSchedule(snapshot.revision, () => planned.data);
  assert.deepEqual(store.schedule().schedules[0].studyEstimates, planned.data.schedules[0].studyEstimates);
});

test('tempos realizados atípicos ficam no histórico sem afetar estimativa seguinte', t => {
  const store = fixture(t);
  const units = [1, 2, 3, 4].map(i => store.save({ title: 'Etapa ' + i, deck: 'D' }));
  const snapshot = store.scheduleSnapshot();
  const start = now / 60000;
  const scheduleData = configureSchedule(snapshot, { schedule: draft, availability: configured });
  scheduleData.confirmations = [9, 10, 120].map((actualMinutes, i) => ({
    id: 'confirm-' + i, card: snapshot.items[i], phase: 'Em estudo', start, end: start + 10,
    completedDate: day, date: day, schedules: [scheduleData.schedules[0].id], completed: true,
    targetMinutes: 10, plannedMinutes: 10, actualMinutes,
  }));
  const planned = planSchedule(scheduleData, snapshot.items, now);
  assert.deepEqual(typicalDurations([9, 10, 120]), [9, 10]);
  assert.deepEqual(typicalDurations([9, 120]), [9, 120]);
  assert.equal(planned.data.sessions.find(session => session.card.unit === units[3].id).targetMinutes, 10);
  const projected = projectSchedule(planned.data, snapshot.items, now);
  const recorded = projected.studyTimes.find(item => item.unit === units[2].id);
  assert.equal(recorded.plannedMinutes, 10);
  assert.equal(recorded.actualMinutes, 120);
  assert.equal(projected.confirmations.length, 3);
});

test('confirmação registra previsto e realizado da etapa no arquivo de agenda', t => {
  const store = fixture(t);
  const unit = store.save({ title: 'Etapa com páginas', deck: 'D', material: [page('primeira')] });
  const snapshot = store.scheduleSnapshot();
  const planned = planSchedule(configureSchedule(snapshot, { schedule: draft, availability: configured }), snapshot.items, now);
  store.updateSchedule(snapshot.revision, () => planned.data);
  const slot = store.schedule().sessions[0];
  const result = confirmScheduleSession(store, {
    revision: store.scheduleSnapshot().revision, sessionId: slot.id, actualMinutes: 17,
  }, slot.end * 60000);
  assert.equal(result.confirmations[0].plannedMinutes, 15);
  assert.equal(result.confirmations[0].actualMinutes, 17);
  assert.equal(store.schedule().confirmations[0].card.unit, unit.id);
  const record = projectSchedule(result, snapshot.items, slot.end * 60000).studyTimes[0];
  assert.equal(record.estimatedMinutes, 15);
  assert.equal(record.actualMinutes, 17);
});

test('progresso de leitura fica em SQLite e preserva o cursor mais recente e páginas visitadas', async t => {
  const store = fixture(t);
  const unit = store.save({ title: 'Páginas', material: [page('a'), page('b'), page('c')] });
  const file = path.join(store.tasks, unit.file);
  const original = fs.readFileSync(file, 'utf8');
  const server = await serve(store, 0);
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = 'http://127.0.0.1:' + server.address().port;
  const get = () => fetch(base + '/api/units/' + unit.id + '/reading-progress').then(response => response.json());
  const save = entry => fetch(base + '/api/material/progress', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ entries: [{ unit: unit.id, ...entry }] }),
  });
  assert.equal(await get(), null);
  const database = path.join(store.root, 'reading-progress.sqlite');
  assert.equal(fs.existsSync(database), false);
  const later = Date.now() - 10000;
  assert.equal((await save({ lastPage: 'c', visited: ['a', 'c'], changedAt: later })).status, 200);
  assert.equal((await save({ lastPage: 'b', visited: ['b'], changedAt: later - 1000 })).status, 200);
  assert.deepEqual(await get(), { unit: unit.id, lastPage: 'c', visited: ['a', 'c', 'b'], changedAt: later });
  assert.equal(fs.readFileSync(database).subarray(0, 15).toString(), 'SQLite format 3');
  assert.equal(fs.readFileSync(file, 'utf8'), original);
});

test('conclusão externa compartilha SHA-256 e tempo entre referências da mesma URL', async t => {
  const store = fixture(t);
  const url = 'https://docs.example/manual';
  const first = store.save({ title: 'Primeira', material: [page('a', url + '#um')] });
  const second = store.save({ title: 'Segunda', material: [page('b', url + '#dois')] });
  const server = await serve(store, 0);
  t.after(() => new Promise(resolve => server.close(resolve)));
  const resource = id => 'http://127.0.0.1:' + server.address().port + '/api/units/' + id + '/material-links';
  const complete = (id, page, url) => fetch(resource(id), {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ page, url, startedAt: Date.now() - 1000 }),
  });
  assert.equal((await complete(first.id, 'a', 'https://docs.example/indisponivel')).status, 404);
  assert.deepEqual(await fetch(resource(second.id)).then(r => r.json()), []);
  const original = await (await complete(first.id, 'a', url + '#um')).json();
  const repeated = await (await complete(second.id, 'b', url + '#dois')).json();
  assert.match(original.hash, /^[a-f0-9]{64}$/);
  assert.equal(original.hash, repeated.hash);
  assert.equal(original.startedAt, repeated.startedAt);
  assert.equal(original.completedAt, repeated.completedAt);
  assert.ok(original.completedAt - original.startedAt >= 1000);
  assert.deepEqual(await fetch(resource(second.id)).then(r => r.json()), [repeated]);
});

test('preserva visitas antigas e reabre as notas gravadas junto ao link correspondente', async t => {
  const store = fixture(t);
  const url = 'https://docs.example/manual';
  const unit = store.save({ title: 'Manual', material: [page('a', url + '#introducao'), page('b', url)] });
  const database = new DatabaseSync(path.join(store.root, 'reading-progress.sqlite'));
  database.exec(`CREATE TABLE material_link_reading (
    unit TEXT, page TEXT, url TEXT, started_at INTEGER, completed_at INTEGER
  )`);
  database.prepare('INSERT INTO material_link_reading VALUES (?, ?, ?, ?, ?)').run(unit.id, 'a', url + '#introducao', 1000, 2000);
  database.close();

  const server = await serve(store, 0);
  t.after(() => new Promise(resolve => server.close(resolve)));
  const resource = 'http://127.0.0.1:' + server.address().port + '/api/units/' + unit.id + '/material-links';
  const read = () => fetch(resource).then(response => response.json());
  const visits = await read();
  assert.equal(visits.length, 2);
  assert.ok(visits.every(visit => visit.startedAt === 1000 && visit.completedAt === 2000));
  const id = '10d7f471-dd7a-4705-91a0-4b724ac08247';
  const response = await fetch(resource, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ page: 'a', url: url + '#introducao', completed: false, notes: [{ id, text: 'Resumo' }] }),
  });
  assert.equal(response.status, 201);
  assert.equal((await response.json()).notes[0].id, id);
  assert.ok((await read()).every(visit => visit.notes[0].text === 'Resumo' && visit.completedAt === 2000));
});

test('remover uma anotação apaga seu texto ou imagem sem apagar as outras notas', async t => {
  const store = fixture(t);
  const url = 'https://docs.example/manual';
  const unit = store.save({ title: 'Manual', material: [page('a', url)] });
  const server = await serve(store, 0);
  t.after(() => new Promise(resolve => server.close(resolve)));
  const resource = 'http://127.0.0.1:' + server.address().port + '/api/units/' + unit.id + '/material-links';
  const text = { id: '10d7f471-dd7a-4705-91a0-4b724ac08247', text: 'Resumo' };
  const image = {
    id: '10d7f471-dd7a-4705-91a0-4b724ac08248', text: '',
    image: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jD1sAAAAASUVORK5CYII=',
  };
  const created = await fetch(resource, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ page: 'a', url, completed: false, notes: [text, image] }),
  });
  assert.equal(created.status, 201);
  const { hash } = await created.json();
  const noteUrl = note => resource + '/' + hash + '/' + note.id;
  const before = await fetch(noteUrl(image));
  assert.equal(before.headers.get('cache-control'), 'no-store');
  assert.ok((await before.arrayBuffer()).byteLength > 0);
  const remove = note => fetch(noteUrl(note), { method: 'DELETE', headers: { 'content-type': 'application/json' } });
  const deletedText = await remove(text);
  assert.equal(deletedText.status, 200);
  const afterText = await deletedText.json();
  assert.deepEqual(afterText.map(note => note.id), [image.id]);
  const deletedImage = await remove(image);
  assert.equal(deletedImage.status, 200);
  assert.deepEqual(await deletedImage.json(), []);
  assert.equal((await fetch(noteUrl(image))).status, 404);
  assert.deepEqual(await fetch(resource).then(response => response.json()), []);
  const database = new DatabaseSync(path.join(store.root, 'reading-progress.sqlite'), { readOnly: true });
  try {
    assert.equal(database.prepare('SELECT count(*) AS total FROM external_material_notes').get().total, 0);
  } finally {
    database.close();
  }
});
