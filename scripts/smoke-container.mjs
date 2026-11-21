import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { request } from 'node:http';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const image = process.argv[2];
assert.ok(image, 'Use npm run test:container -- IMAGE');
const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'recall-container-'));
const container = `recall-smoke-${randomUUID().slice(0, 12)}`;
const docker = args => execFileSync('docker', args, { encoding: 'utf8', timeout: 60000, maxBuffer: 4 * 1024 * 1024 }).trim();
const mount = ['--user', `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`, '--mount', `type=bind,source=${cwd},target=/workspace`];
const cli = args => docker(['run', '--rm', ...mount, image, ...args]);
let started = false;
try {
  docker(['run', '--rm', '--entrypoint', 'node', image, '-e', `
    const fs=require('node:fs');
    if(process.getuid()===0) throw Error('Imagem executa como root');
    for(const p of ['/app/recall','/app/.git','/app/node_modules/jsdom']) if(fs.existsSync(p)) throw Error('Conteúdo indevido: '+p);
    console.log('Runtime não-root, sem dados locais, Git ou dependências de desenvolvimento.');
  `]);
  fs.mkdirSync(path.join(cwd, 'vocabulario'));
  fs.copyFileSync(new URL('../examples/example-vocabulario/vocabulario-ingles.json', import.meta.url),
    path.join(cwd, 'vocabulario', 'vocabulario-ingles.json'));
  const vocabulary = args => cli(['--cwd', '/workspace/vocabulario', ...args]);
  vocabulary(['init']);
  const imported = JSON.parse(vocabulary(['unit', 'import', '/workspace/vocabulario/vocabulario-ingles.json']));
  assert.equal(imported.length, 91);
  assert.equal(imported[0].unit.title, 'O alfabeto');
  assert.ok(imported.every(result => result.unit.deck === 'Vocabulário em inglês'));
  const vocabularySchedule = JSON.parse(fs.readFileSync(path.join(cwd, 'vocabulario', 'recall', 'schedule.json')));
  assert.equal(vocabularySchedule.milestones.length, 10);
  assert.equal(JSON.parse(vocabulary(['unit', 'list', '--json'])).length, 91);
  console.log('Vocabulário: importação das 91 fichas em estudo separado.');
  cli(['init']);
  const material = JSON.parse(fs.readFileSync(new URL('../examples/primeira-etapa.json', import.meta.url), 'utf8'));
  material.cards = material.cards.slice(0, 1);
  fs.writeFileSync(path.join(cwd, 'material.json'), JSON.stringify(material));
  cli(['unit', 'import', '/workspace/material.json']);
  const pty = fileURLToPath(new URL('../test/tui-pty.py', import.meta.url));
  const output = execFileSync('python3', [pty, '/app/bin/recall.js', cwd, process.execPath, image], { encoding: 'utf8', timeout: 45000 });
  console.log(output.trim());
  assert.ok(JSON.parse(cli(['unit', 'list', '--json'])).some(u => u.title === 'Etapa pelo terminal'));
  docker(['run', '--rm', '-d', '--name', container, ...mount, '-p', '127.0.0.1::6421', image]); started = true;
  const port = docker(['port', container, '6421/tcp']);
  assert.match(port, /^127\.0\.0\.1:\d+$/);
  const base = `http://${port}`;
  let state;
  for (let n = 0; n < 40; n++) {
    try { const response = await fetch(`${base}/api/state`); if (response.ok) { state = await response.json(); break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  assert.ok(state?.units?.length >= 2, 'Web não leu o volume de estudo');
  assert.equal((await fetch(base)).status, 200);
  const created = await fetch(`${base}/api/units`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify({ title: 'Persistência no contêiner', deck: 'Smoke sintético' }) });
  assert.equal(created.status, 201); const saved = await created.json();
  const badOrigin = await fetch(`${base}/api/units`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://outro-site.test' }, body: '{}' }); assert.equal(badOrigin.status, 403);
  const badHost = await new Promise((resolve, reject) => {
    const req = request(`${base}/api/state`, { headers: { Host: 'outro-site.test' } }, res => { res.resume(); resolve(res.statusCode); }); req.on('error', reject); req.end();
  });
  assert.equal(badHost, 403);
  docker(['stop', '--time', '5', container]); started = false;
  const persisted = JSON.parse(cli(['unit', 'list', '--json']));
  assert.ok(persisted.some(u => u.id === saved.unit.id && u.title === 'Persistência no contêiner'));
  console.log('Docker smoke: CLI/TUI/web, porta remapeada, Host/Origin e persistência após encerrar: OK.');
} finally {
  if (started) docker(['rm', '-f', container]);
  fs.rmSync(cwd, { recursive: true, force: true });
}
