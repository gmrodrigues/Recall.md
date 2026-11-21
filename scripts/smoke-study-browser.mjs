import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { spawn } from 'node:child_process'; import { once } from 'node:events';
import { Store } from '../src/core.js'; import { serve } from '../src/server.js';
const cwd=fs.mkdtempSync(path.join(os.tmpdir(),'recall-study-browser-')), profile=path.join(cwd,'profile');
const store=new Store(cwd);store.init();
const unit=store.save({title:'Card sintético',deck:'Deck sintético',questions:[{id:'q',type:'choice',prompt:'Escolha',options:['A','B'],answer:1}],cards:[{id:'c',front:'Frente sintética',back:'Verso sintético'}]});
const server=await serve(store,0),base=`http://127.0.0.1:${server.address().port}`;
const chrome=spawn(process.env.RECALL_CHROME_BIN||'google-chrome-stable',['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--no-first-run','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{stdio:['ignore','ignore','pipe']});
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
    const result = await send('Runtime.evaluate', { expression: expression.includes("await ") ? `(async()=>{${expression}})()` : expression, awaitPromise: true, returnByValue: true }, sessionId);
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

 await send('Page.navigate',{url:base},sessionId); await until(`document.querySelector('.study-card')`);
 await until(`document.querySelector('#study-panel')`);
 await evaluate(`window.layoutBefore=document.querySelector('main').getBoundingClientRect().width`);
 assert.equal(await evaluate(`(()=>{const a=document.querySelector('[data-action="create"]').getBoundingClientRect(),b=document.querySelector('#study-toggle').getBoundingClientRect();return Math.abs((a.top+a.bottom)/2-(b.top+b.bottom)/2)<1})()`),true);
 await until(`document.querySelector('#study-panel').hidden`,4500);
 assert.equal(await evaluate(`document.querySelector('main').getBoundingClientRect().width===window.layoutBefore`),true);
 await evaluate(`document.querySelector('#study-toggle').click();document.querySelector('#study-collapse').focus()`);
 await new Promise(resolve=>setTimeout(resolve,3400));
 assert.equal(await evaluate(`!document.querySelector('#study-panel').hidden&&document.activeElement.id==='study-collapse'`),true);
 await evaluate(`document.activeElement.blur();document.querySelector('#study-panel').dispatchEvent(new PointerEvent('pointerenter'))`);
 await new Promise(resolve=>setTimeout(resolve,3400));
 assert.equal(await evaluate(`!document.querySelector('#study-panel').hidden`),true);
 await evaluate(`document.querySelector('#study-panel').dispatchEvent(new PointerEvent('pointerleave'))`);
 await until(`document.querySelector('#study-panel').hidden`,4500);
 assert.equal(await evaluate(`getComputedStyle(document.querySelector('#study-panel')).transitionDuration.includes('0.24s')`),true);
 await evaluate(`document.querySelector('#study-toggle').click()`);
 console.log('Painel flutuante: relógio alinhado, 3s sem foco, ponteiro e teclado preservados, transição CSS e layout estável.');

 await evaluate(`document.querySelector('.study-card').click()`);
 await until(`document.querySelector('#detail').open && document.querySelector('#study-entities .study-entity')`);
 assert.equal(await evaluate(`document.querySelector('#detail').contains(document.querySelector('#study-panel'))`),false);
 await evaluate(`document.querySelector('#study-collapse').click()`);
 assert.equal(await evaluate(`document.querySelector('#study-toggle').hidden`),false);
 await evaluate(`document.querySelector('#study-toggle').click()`);
 assert.equal(await evaluate(`document.querySelector('#study-panel').hidden`),false);
 const picture=await send('Page.captureScreenshot',{format:'png'},sessionId);fs.writeFileSync('/tmp/gmr36-panel.png',Buffer.from(picture.data,'base64'));
 await evaluate(`document.querySelector('#detail').close()`);
 await evaluate(`window.clock=1000000;window.focusContext={kind:'card',id:'RCL-1',unitId:'RCL-1',deck:'D',title:'Card sintético'}; window.studyTest=new (await import('/study-client.js')).StudyTracker({projectId:'test-shared',now:()=>window.clock,getContext:()=>window.focusContext}); await studyTest.init(); await studyTest.touch()`);
 const id=await evaluate('studyTest.current.id');
 const t2=await send('Target.createTarget',{url:base});
 const s2=(await send('Target.attachToTarget',{targetId:t2.targetId,flatten:true})).sessionId;
 const eval2=async expression=>{const r=await send('Runtime.evaluate',{expression: expression.includes("await ") ? `(async()=>{${expression}})()` : expression,awaitPromise:true,returnByValue:true},s2);if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
 for(let i=0;i<100;i++){if(await eval2(`!!document.querySelector('.study-card')`))break;await new Promise(r=>setTimeout(r,25));}
 await eval2(`window.clock=1005000;window.focusContext={kind:'card',id:'RCL-1',unitId:'RCL-1',deck:'D',title:'Card sintético'}; window.studyTest=new (await import('/study-client.js')).StudyTracker({projectId:'test-shared',now:()=>window.clock,getContext:()=>window.focusContext}); await studyTest.init(); await studyTest.touch()`);
 assert.equal(await eval2('studyTest.current.id'),id);
 await evaluate(`window.clock=1006000;window.focusContext=null;await studyTest.touch()`);
 await eval2(`window.clock=1011000;window.focusContext=null;await studyTest.touch()`);
 await eval2(`window.clock+=3600001;await studyTest.touch()`);
 await evaluate('await studyTest.read()'); assert.equal(await evaluate('studyTest.current.status'),'pending');
 assert.equal(await evaluate('studyTest.current.endedAt'),1011000);
 await evaluate(`try{await studyTest.resolve(true,async()=>{throw new Error('Falha sintética')})}catch(e){window.retryFailure=e.message}`);
 assert.equal(await evaluate('studyTest.current.status'),'pending');assert.equal(await evaluate('studyTest.current.resolving'),undefined);
 await evaluate(`window.clock=4611001;window.saving=studyTest.resolve(true,async s=>{await new Promise(resolve=>window.releaseSave=resolve);s.projectId=(await(await fetch('/api/state')).json()).projectId;window.savedPayload=s;const response=await fetch('/api/sessions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(s)});if(!response.ok)throw new Error(await response.text());});void 0`);
 await until(`typeof window.releaseSave==='function'`);
 await eval2(`try{await studyTest.resolve(false)}catch(e){window.resolutionConflict=e.message}`);
 assert.match(await eval2('window.resolutionConflict'),/Outra aba/);
 await evaluate(`window.releaseSave();await window.saving`);
 assert.equal(store.studySessions().length,1);assert.equal(store.studySessions()[0].decks.D.cards['RCL-1'].durationMs,11000);
 await evaluate(`const response=await fetch('/api/sessions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(window.savedPayload)});window.retryStatus=response.status`);
 assert.equal(await evaluate('window.retryStatus'),201);assert.equal(store.studySessions().length,1);
 await evaluate(`window.clock+=1000;await studyTest.touch();await studyTest.end();await studyTest.resolve(false)`);
 assert.equal(store.studySessions().length,1);assert.equal(await evaluate('studyTest.current'),null);
 await evaluate(`window.clock=5000000;window.focusContext={kind:'card',id:'RCL-1',unitId:'RCL-1',deck:'D',title:'Card sintético'};await studyTest.touch();await studyTest.update(s=>{s.lastActivityAt=s.startedAt+28800000-1;return s});window.clock+=28800000;await studyTest.tick()`);
 assert.equal(await evaluate('studyTest.current.reason'),'limit');assert.equal(store.studySessions().length,1);
 await evaluate(`await studyTest.resolve(true,async s=>{s.projectId=(await(await fetch('/api/state')).json()).projectId;const r=await fetch('/api/sessions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(s)});if(!r.ok)throw new Error(await r.text());})`);
 assert.equal(store.studySessions().length,2);
 await evaluate('studyTest.close()');await eval2('studyTest.close()');
 await send('Target.activateTarget',{targetId},undefined);await send('Page.bringToFront',{},sessionId);
 await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false},sessionId);
 await evaluate(`document.querySelector('[data-page="board"]').click()`);
 await until(`document.querySelector('.study-card')`);
 await evaluate(`document.querySelector('.study-card').click()`);
 await until(`document.querySelector('#detail').open`);
 await evaluate(`document.querySelector('.tabs [data-tab="quiz"]').click();document.querySelector('#quiz-form input[value="1"]').checked=true;document.querySelector('#quiz-form').requestSubmit()`);
 await until(`document.querySelector('#quiz-feedback .result')`);
 await evaluate(`document.querySelector('.tabs [data-tab="cards"]').click();document.querySelector('[data-study-card]').open=true`);
 await new Promise(r=>setTimeout(r,10500));
 await evaluate(`document.querySelector('#study-end').click()`);await until(`document.querySelector('#study-save')`);
 await evaluate(`document.querySelector('#study-save').click()`);
 await until(`document.querySelector('#study-panel').textContent.includes('Nenhuma sessão ativa')`);
 assert.equal(store.studySessions().length,3);
 const compact=store.studySessions()[0];const card=compact.decks['Deck sintético'].cards[unit.id];
 assert.ok(card.durationMs>=10000);assert.equal(card.actions.quiz_completed.length,1);assert.ok(card.actions['flashcard_revealed:c']);
 assert.equal(Object.keys(compact.decks['Deck sintético'].flashcards).length,0);
 await evaluate(`document.querySelector('[data-page="sessions"]').click()`);
 await until(`document.querySelectorAll('[data-study-session]').length===3`);
 await evaluate(`document.querySelector('[data-study-session]').click()`);
 await until(`document.querySelector('#view .content-card')`);
 assert.match(await evaluate(`document.querySelector('#view').textContent`),/Quiz enviado/);
 const finalPicture=await send('Page.captureScreenshot',{format:'png'},sessionId);fs.writeFileSync('/tmp/gmr36-sessoes.png',Buffer.from(finalPicture.data,'base64'));
 await evaluate(`document.querySelector('[data-study-mode="time"]').click()`);await until(`document.querySelector('#view h1').textContent==='Tempo de estudo'`);
 assert.match(await evaluate(`document.querySelector('#view').textContent`),/Limite de 8 horas/);
 await evaluate(`document.querySelector('a[data-study-link]').click()`);await until(`document.querySelector('#detail').open`);
 await evaluate(`document.querySelector('#study-end').click()`);await until(`document.querySelector('#study-discard')`);
 await evaluate(`document.querySelector('#study-discard').click()`);await until(`document.querySelector('#study-panel').textContent.includes('Nenhuma sessão ativa')`);
 assert.equal(store.studySessions().length,3);assert.equal(store.events('attempts').length,1);
 await evaluate(`document.querySelector('[data-page="review"]').click()`);await until(`document.querySelector('[data-review-deck]')`);
 await evaluate(`document.querySelector('[data-review-deck]').click()`);await until(`document.querySelector('#reveal')`);
 await new Promise(r=>setTimeout(r,10500));
 await evaluate(`document.querySelector('#reveal').click();document.querySelector('[data-rating="good"]').click()`);
 await until(`document.querySelector('#view h1')?.textContent==='Revisão em dia'`);
 await evaluate(`document.querySelector('#study-end').click()`);await until(`document.querySelector('#study-save')`);
 await evaluate(`document.querySelector('#study-save').click()`);await until(`document.querySelector('#study-panel').textContent.includes('Nenhuma sessão ativa')`);
 assert.equal(store.studySessions().length,4);
 const independent=store.studySessions()[0].decks['Deck sintético'];assert.equal(Object.keys(independent.cards).length,0);assert.equal(Object.keys(independent.flashcards).length,1);
 assert.ok(Object.values(independent.flashcards)[0].durationMs>=10000);
 await evaluate(`document.querySelector('[data-page="board"]').click()`);await until(`document.querySelector('.study-card')`);
 await evaluate(`document.querySelector('.study-card').click()`);await until(`document.querySelector('#detail').open`);
 await evaluate(`window.resumeTest=new (await import('/study-client.js')).StudyTracker({projectId:(await(await fetch('/api/state')).json()).projectId});await resumeTest.init();await resumeTest.update(s=>{s.startedAt=Date.now()-3610000;s.lastActivityAt=Date.now()-3600001;return s});document.dispatchEvent(new Event('visibilitychange'))`);
 await until(`document.querySelector('#study-discard')`);assert.equal(store.studySessions().length,4);
 await evaluate(`document.querySelector('#study-discard').click()`);await until(`document.querySelector('#study-panel').textContent.includes('Em andamento')`);
 assert.equal(store.studySessions().length,4);
 await evaluate(`document.querySelector('#study-end').click()`);await until(`document.querySelector('#study-discard')`);
 await evaluate(`document.querySelector('#study-discard').click()`);await until(`document.querySelector('#study-panel').textContent.includes('Nenhuma sessão ativa')`);
 await evaluate('resumeTest.close()');
 await evaluate(`document.querySelector('.study-card').click()`);await until(`document.querySelector('#detail').open`);
 await evaluate(`window.reloadTest=new (await import('/study-client.js')).StudyTracker({projectId:(await(await fetch('/api/state')).json()).projectId});await reloadTest.init();await reloadTest.update(s=>{s.startedAt=Date.now()-3610000;s.lastActivityAt=Date.now()-3600001;return s});reloadTest.close()`);
 await send('Page.reload',{},sessionId);await until(`document.querySelector('#study-discard')`);
 assert.equal(store.studySessions().length,4);
 await evaluate(`document.querySelector('#study-discard').click()`);await until(`document.querySelector('#study-panel').textContent.includes('Em andamento')`);
 assert.equal(store.studySessions().length,4);
 await evaluate(`document.querySelector('#study-end').click()`);await until(`document.querySelector('#study-discard')`);
 await evaluate(`document.querySelector('#study-discard').click()`);await until(`document.querySelector('#study-panel').textContent.includes('Nenhuma sessão ativa')`);




 console.log(JSON.stringify({duasAbasMesmaSessao:true,inatividadeCompartilhada:true,ultimaInteracao:1011000,retryIdempotente:true,descarteSemArquivo:true,tempoCompacto:11000,limite8hComConfirmacao:true,painelGlobal:true,quizSemDuracao:true,flashcardInternoSemDuracao:true,navegacaoELinks:true,flashcardIndependente:true,decisaoConcorrenteProtegida:true,retomadaAposDecisao:true,retomadaAposReload:true,excecoes:exceptions.length},null,2));
 assert.deepEqual(exceptions,[]);
}finally{ws?.close();chrome.kill('SIGTERM');await once(chrome,'exit');await new Promise(r=>server.close(r));fs.rmSync(cwd,{recursive:true,force:true});}
