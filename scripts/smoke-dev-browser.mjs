import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { Store } from '../src/core.js';
const root = fileURLToPath(new URL('../', import.meta.url));
const launcher = process.argv[2];
assert.ok(launcher, 'Informe o caminho de abrir-recall.sh');
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'recall-dev-browser-'));
const checkout = path.join(fixture, 'Recall.md'), study = path.join(fixture, 'study');
fs.mkdirSync(checkout); fs.mkdirSync(study);
for (const name of ['bin', 'src', 'web', 'package.json']) fs.cpSync(path.join(root, name), path.join(checkout, name), {recursive:true});
fs.symlinkSync(path.join(root, 'node_modules'), path.join(checkout, 'node_modules'), 'dir');
fs.copyFileSync(launcher, path.join(study, 'abrir-recall.sh'));
const store = new Store(study); store.init();
store.save({title:'Ensaio dev',questions:[{id:'choice',type:'choice',prompt:'Escolha',options:['A','B'],answer:1},{id:'text',type:'text',prompt:'Explique',answer:'Referência'}]});
const reserve = net.createServer(); reserve.listen(0,'127.0.0.1'); await once(reserve,'listening');
const port = reserve.address().port; await new Promise(r=>reserve.close(r));
const base = `http://127.0.0.1:${port}`;
const service = spawn('bash',[path.join(study,'abrir-recall.sh'),'--local','--port',String(port)],{cwd:fixture,env:{...process.env,RECALL_LOCAL_REPO:checkout},detached:true,stdio:['ignore','pipe','pipe']});
let output=''; service.stdout.on('data', c=>output+=c); service.stderr.on('data',c=>output+=c);
const profile=path.join(fixture,'profile');
let chrome,ws;
const delay=ms=>new Promise(r=>setTimeout(r,ms));
try {
  let ready=false;
  for(let i=0;i<100;i++){ try{ready=(await fetch(base+'/api/state')).ok;}catch{} if(ready)break;await delay(100); }
  assert.ok(ready,output);
  chrome=spawn(process.env.RECALL_CHROME_BIN||'google-chrome-stable',['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--no-first-run','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{stdio:['ignore','ignore','pipe']});
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
    while (true) {
      try { if (await evaluate(expression)) return; } catch (e) { if (!/context|navigat/i.test(e.message)) throw e; }
      if (Date.now() - start > timeout) throw new Error(`Tempo esgotado: ${expression}`);
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  };

  await send('Page.navigate', {url:base}, sessionId);
  await until(`document.querySelector('.study-card')`);
  await evaluate(`document.querySelector('.study-card').click()`);
  await until(`document.querySelector('[data-tab="quiz"]')`);
  await evaluate(`document.querySelector('[data-tab="quiz"]').click(); document.querySelector('#quiz-form input[value="1"]').checked=true; document.querySelector('#quiz-form textarea').value='Rascunho dev'; document.querySelector('#quiz-form textarea').dispatchEvent(new Event('input',{bubbles:true}))`);
  let stamp=await evaluate('performance.timeOrigin');
  for(const i of [1,2]){
    const target=path.join(checkout,'web','app.js'), temporary=path.join(checkout,'web','pending');
    fs.writeFileSync(temporary,fs.readFileSync(target,'utf8')+`\nwindow.devSmokeGeneration=${i};\n`);
    fs.renameSync(temporary,target);
    await until(`window.devSmokeGeneration===${i} && performance.timeOrigin!==${stamp} && document.querySelector('#quiz-form textarea')?.value==='Rascunho dev'`);
    assert.equal(await evaluate(`document.querySelector('#quiz-form input[value="1"]').checked`),true);
    stamp=await evaluate('performance.timeOrigin');
  }
  fs.appendFileSync(path.join(checkout,'src','server.js'),'\n// Reinício sintético do servidor.\n');
  await until(`performance.timeOrigin!==${stamp} && document.querySelector('#quiz-form textarea')?.value==='Rascunho dev'`,15000);
  stamp=await evaluate('performance.timeOrigin');
  await delay(1600);
  assert.equal(await evaluate('performance.timeOrigin'),stamp,'Reload não pode entrar em ciclo');
  assert.equal(store.events('attempts').length,0);
  await evaluate(`document.querySelector('#quiz-form').requestSubmit()`);
  await until(`document.querySelector('#quiz-feedback .result')`);
  assert.equal(store.events('attempts').length,1);
  await send('Page.reload',{},sessionId);
  await until(`document.querySelector('#quiz-form textarea')?.value===''`);
  assert.equal(await evaluate(`document.querySelector('#quiz-form input:checked')`),null);
  process.kill(-service.pid,'SIGINT');
  await Promise.race([once(service,'exit'),delay(5000).then(()=>{throw new Error('Serviço não encerrou com SSE aberto')})]);
  assert.deepEqual(exceptions,[]);
  console.log(JSON.stringify({substituicoesConsecutivas:2,reinicioServidor:true,rascunhoRestaurado:true,semCicloDeReload:true,tentativasAntesDoEnvio:0,rascunhoLimpoAposEnvio:true,ctrlCComSSE:true,excecoes:0},null,2));
} finally {
  ws?.close();
  if(chrome && chrome.exitCode===null){chrome.kill('SIGTERM');await once(chrome,'exit');}
  try{process.kill(-service.pid,'SIGTERM');}catch{}
  if(service.exitCode===null && service.signalCode===null)await Promise.race([once(service,'exit'),delay(3000)]);
  try{process.kill(-service.pid,'SIGKILL');}catch{}
  fs.rmSync(fixture,{recursive:true,force:true});
}
