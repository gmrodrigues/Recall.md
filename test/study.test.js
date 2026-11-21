import test from 'node:test';
import assert from 'node:assert/strict';
import { startSession, advanceSession, endSession, focusEntity, recordAction, previewSession, compactSession, IDLE_LIMIT, SESSION_LIMIT } from '../web/study-model.js';
test('Sessão: só interação renova, limiar de inatividade é estrito e retorno encerra no último uso', () => {
 const s = startSession('project', 1000);
 advanceSession(s, 1100, true); advanceSession(s, 1100 + IDLE_LIMIT);
 assert.equal(s.status, 'active'); assert.equal(s.lastActivityAt, 1100);
 advanceSession(s, 1101 + IDLE_LIMIT); assert.equal(s.status, 'inactive');
 advanceSession(s, 1200 + IDLE_LIMIT, true); assert.equal(s.status, 'pending'); assert.equal(s.endedAt, 1100);
});
test('Sessão: oito horas encerram sem continuar acumulando; encerramento é estável', () => {
 const s = startSession('project', 1000);
 s.lastActivityAt = 1000 + SESSION_LIMIT - 100;
 advanceSession(s, 1000 + SESSION_LIMIT); assert.equal(s.endedAt, 1000 + SESSION_LIMIT); assert.equal(s.reason, 'limit');
 endSession(s, 1000 + SESSION_LIMIT + 100); assert.equal(s.endedAt, 1000 + SESSION_LIMIT);
 assert.equal(startSession('other', 0).projectId, 'other');
});

const context = {kind:'card',id:'RCL-1',unitId:'RCL-1',title:'Card',deck:'D'};
test('Tempo: reaberturas somam, ações só possuem horários e visibilidade pausa contagem', () => {
 const s=startSession('p',0); focusEntity(s,'tab',context,0);
 recordAction(s,context,'quiz',2000); focusEntity(s,'tab',null,6000);
 focusEntity(s,'tab',context,7000); focusEntity(s,'tab',context,12000,false);
 const e=previewSession(s,15000)[0]; assert.equal(e.durationMs,11000);assert.deepEqual(e.actions.quiz,[2000]);
 assert.deepEqual(e.actions.open,[0,7000]);assert.deepEqual(e.actions.close,[6000]);
 assert.equal(e.actions.quiz[0].duration,undefined);
});
test('Tempo: abas sobrepostas unem o mesmo card; flashcard independente é outra entidade',()=>{
 const s=startSession('p',0);focusEntity(s,'a',context,0);focusEntity(s,'b',context,5000);
 focusEntity(s,'a',null,9000);focusEntity(s,'b',null,12000);
 focusEntity(s,'c',{...context,kind:'flashcard',id:'c'},13000);focusEntity(s,'c',null,23000);
 const rows=previewSession(s,23000);assert.equal(rows[0].durationMs,12000);assert.equal(rows[1].durationMs,10000);
});

test('Limiar: 9999ms permanece provisório, exatamente10000ms inclui ações anteriores',()=>{
 const s=startSession('p',0);focusEntity(s,'a',context,0);recordAction(s,context,'quiz_completed',100);
 assert.equal(previewSession(s,9999)[0].qualified,false);assert.equal(previewSession(s,10000)[0].qualified,true);
 assert.deepEqual(previewSession(s,10000)[0].actions.quiz_completed,[100]);
});

test('Compactação: um mapa por deck/card, tempos unidos, ações em listas e sem eventos/contadores',()=>{
 const s=startSession('p',0);focusEntity(s,'a',context,0);recordAction(s,context,'quiz_completed',50);focusEntity(s,'a',null,6000);
 focusEntity(s,'a',context,7000);focusEntity(s,'a',null,12000);
 focusEntity(s,'b',{...context,id:'RCL-2',unitId:'RCL-2'},0);focusEntity(s,'b',null,10000);
 focusEntity(s,'c',{...context,kind:'flashcard',id:'c'},0);focusEntity(s,'c',null,9999);
 endSession(s,12000);const c=compactSession(s);
 assert.equal(c.decks.D.durationMs,12000);assert.equal(c.decks.D.cards['RCL-1'].durationMs,11000);
 assert.deepEqual(c.decks.D.cards['RCL-1'].actions.open,[0,7000]);assert.deepEqual(c.decks.D.cards['RCL-1'].actions.quiz_completed,[50]);
 assert.equal(Object.keys(c.decks.D.flashcards).length,0);
 const raw=JSON.stringify(c);for(const name of ['events','intervals','tabs','lastActivityAt','count'])assert.equal(raw.includes('"'+name+'"'),false);
 assert.equal(Object.hasOwn(c,'durationMs'),false);
});
test('Compactação: flashcard independente qualificado; horário inválido é recusado e propriedades extras não vazam',()=>{
 const s=startSession('p',0);const c={...context,kind:'flashcard',id:'c'};focusEntity(s,'a',c,0);focusEntity(s,'a',null,10000);endSession(s,10000);
 s.answers={secret:'não persistir'};const result=compactSession(s);assert.equal(Object.keys(result.decks.D.flashcards).length,1);assert.equal(JSON.stringify(result).includes('secret'),false);
 s.entities[Object.keys(s.entities)[0]].actions.bad=[-1];assert.throws(()=>compactSession(s),/transacional/);
 assert.throws(()=>compactSession(s,'outro'),/Projeto/);
});

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/core.js';
import { serve } from '../src/server.js';
function fixture(t) {const dir=fs.mkdtempSync(path.join(os.tmpdir(),'recall-sessions-test-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const store=new Store(dir);store.init();return store;}
function finalized(store){const s=startSession(store.projectIdentity(),1000);focusEntity(s,'a',context,1000);recordAction(s,context,'quiz_completed',2000);focusEntity(s,'a',null,12000);return endSession(s,13000);}
test('Persistência: um JSON minificado, UUID idempotente, configuração antiga preservada',t=>{
 const store=fixture(t);const name=store.config().name;assert.equal(store.config().projectId,undefined);const s=finalized(store);
 assert.equal(store.config().name,name);assert.equal(store.projectIdentity(),s.projectId);
 const first=store.saveStudySession(s);assert.deepEqual(store.saveStudySession(s),first);
 const dir=path.join(store.root,'sessions');assert.equal(fs.readdirSync(dir).length,1);
 const raw=fs.readFileSync(path.join(dir,s.id+'.json'),'utf8');assert.equal(raw.includes('\n'),false);assert.equal(raw.includes('intervals'),false);assert.equal(raw.includes('transactionAt'),false);
 assert.equal(new Store(store.cwd).studySessions()[0].id,s.id);
 const changed=structuredClone(s);changed.endedAt++;assert.throws(()=>store.saveStudySession(changed),/UUID/);
});
test('Persistência: projeto/caminho/formato inválidos e symlinks são recusados',t=>{
 const store=fixture(t),s=finalized(store);s.id='../bad';assert.throws(()=>store.saveStudySession(s),/inválida/);
 s.id=crypto.randomUUID();s.projectId='other';assert.throws(()=>store.saveStudySession(s),/Projeto/);
 const link=path.join(store.root,'sessions');fs.symlinkSync(os.tmpdir(),link);assert.throws(()=>store.studySessions(),/simbólicos/);
});
test('HTTP sessões: confirmar/listar/consultar e repetir POST sem duplicar; mantém proteções Host/Origin',async t=>{
 const store=fixture(t),s=finalized(store);const server=await serve(store,0);t.after(()=>new Promise(r=>server.close(r)));
 const base=`http://127.0.0.1:${server.address().port}`, headers={'Content-Type':'application/json'};
 const before=await (await fetch(base+'/api/sessions')).json();assert.deepEqual(before,[]);
 for(let i=0;i<2;i++){const response=await fetch(base+'/api/sessions',{method:'POST',headers,body:JSON.stringify(s)});assert.equal(response.status,201);assert.equal((await response.json()).id,s.id);}
 assert.equal((await(await fetch(base+'/api/sessions')).json()).length,1);
 assert.equal((await(await fetch(base+'/api/sessions/'+s.id)).json()).decks.D.cards['RCL-1'].durationMs,11000);
 assert.equal((await fetch(base+'/api/sessions',{method:'POST',headers:{...headers,Origin:'https://other.invalid'},body:JSON.stringify(s)})).status,403);
 assert.equal((await fetch(base+'/api/sessions',{method:'POST',headers,body:JSON.stringify({...s,projectId:'other'})})).status,400);
});
