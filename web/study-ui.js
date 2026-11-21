import { StudyTracker } from './study-client.js';
import { previewSession, compactSession, unionIntervals, entityIntervals, duration } from './study-model.js';
const escape = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
export const formatTime = ms => { const s=Math.floor(ms/1000);return `${Math.floor(s/3600)}h ${Math.floor(s/60)%60}m ${s%60}s`; };
export async function setupStudyUI({ projectId, getContext, toast, api, labelAction = () => 'Ação registrada', onSaved = () => {} }) {
  let collapsed=false, tracker;
  const panel=document.createElement('aside');panel.id='study-panel';panel.className='study-panel';panel.setAttribute('aria-label','Sessão de estudo');
  const toggle=document.createElement('button');toggle.id='study-toggle';toggle.className='button secondary study-toggle';toggle.textContent='◷';toggle.setAttribute('aria-label','Abrir sessão de estudo');
  document.body.append(panel,toggle);
  let hideTimer, pointerInside=false;
  const positionPanel=()=>{
    const rect=toggle.getBoundingClientRect();
    panel.style.top=`${Math.max(12,rect.bottom+12)}px`;
    panel.style.maxHeight=`calc(100dvh - ${Math.max(12,rect.bottom+12)+16}px)`;
  };
  function attachToggle(){
    const heading=document.querySelector('.page-heading');
    if(!heading)return;
    if(heading.contains(toggle)){positionPanel();return;}
    const action=heading.querySelector('[data-action="create"]');
    const group=document.createElement('div');group.className='study-heading-actions';
    if(action){action.replaceWith(group);group.append(action);}else heading.append(group);
    group.append(toggle);positionPanel();
  }
  new MutationObserver(attachToggle).observe(document.querySelector('#view'),{childList:true,subtree:true});
  window.addEventListener('resize',positionPanel);
  window.addEventListener('scroll',positionPanel,{passive:true});
  attachToggle();
  function setCollapsed(value){
    collapsed=value;panel.hidden=value;panel.inert=value;
    toggle.setAttribute('aria-expanded',String(!value));
    toggle.setAttribute('aria-controls',panel.id);
    toggle.setAttribute('aria-label',value?'Abrir sessão de estudo':'Recolher sessão de estudo');
    if(value&&panel.contains(document.activeElement))toggle.focus({preventScroll:true});
    clearTimeout(hideTimer);
    if(!value){positionPanel();scheduleHide();}
  }
  function scheduleHide(){
    clearTimeout(hideTimer);
    if(!collapsed&&!pointerInside&&!panel.contains(document.activeElement))hideTimer=setTimeout(()=>setCollapsed(true),3000);
  }
  panel.addEventListener('pointerenter',()=>{pointerInside=true;clearTimeout(hideTimer);});
  panel.addEventListener('pointerleave',()=>{pointerInside=false;scheduleHide();});
  panel.addEventListener('focusin',()=>clearTimeout(hideTimer));
  panel.addEventListener('focusout',()=>queueMicrotask(scheduleHide));
  const safely = fn => Promise.resolve().then(fn).catch(e=>toast(e.message));
  function render(s) {
    const focusedId=panel.contains(document.activeElement)?document.activeElement.id:null;
    const rows=previewSession(s,Date.now());
    const deckNames=[...new Set(rows.map(e=>e.deck))];
    const deckSummary=deckNames.map(d=>`<p>Deck ${escape(d)}: <strong>${formatTime(duration(unionIntervals(rows.filter(e=>e.deck===d&&e.qualified).flatMap(e=>entityIntervals(s,e.key,Date.now())))))}</strong></p>`).join('');
    const compact = s?.status === 'pending' ? compactSession(s) : null;
    const labels={open:'Abriu',close:'Fechou',hidden:'Ocultou',visible:'Retomou',quiz_completed:'Quiz enviado',unit_saved:'Card salvo',questions_saved:'Questões salvas',cards_saved:'Flashcards salvos'};
    panel.innerHTML=`<header><h2>Sessão de estudo</h2><button type="button" id="study-collapse" class="icon-button" aria-label="Recolher sessão de estudo">›</button></header>${!s?'<p>Nenhuma sessão ativa. Abra um card ou inicie uma prática.</p>':`<p><strong>${s.status==='active'?'Em andamento':s.status==='inactive'?'Inativa — decida ao retornar':'Aguardando confirmação'}</strong></p><small>Início: ${new Date(s.startedAt).toLocaleString('pt-BR')}</small>${deckSummary}<div id="study-entities">${rows.map(e=>`<section class="study-entity"><h3>${escape(e.deck)} · ${escape(e.title)}</h3><strong>${formatTime(e.durationMs)}</strong>${e.qualified?'':'<span class="pill">Provisório: mínimo 10s</span>'}<ul>${Object.entries(e.actions).map(([action,times])=>`<li>${escape(labelAction(action))}: ${times.map(t=>new Date(t).toLocaleTimeString('pt-BR')).join(', ')}</li>`).join('')}</ul></section>`).join('')||'<p>A sessão ainda não tem atividades.</p>'}</div><button type="button" id="study-end" class="button secondary" ${s.status==='pending'?'disabled':''}>Encerrar sessão</button>${s.status==='pending'?`<div class="study-confirm"><p>Registro compacto: ${Object.keys(compact.decks).length} decks qualificados. Revise antes de confirmar.</p><button type="button" id="study-save" class="button primary" ${s.resolving && s.resolving.expires>Date.now()?'disabled':''}>Salvar registro</button><button type="button" id="study-discard" class="button secondary" ${s.resolving && s.resolving.expires>Date.now()?'disabled':''}>Descartar</button></div>`:''}`}`;
    if(focusedId)panel.querySelector(`#${focusedId}`)?.focus({preventScroll:true});
  }
  tracker=new StudyTracker({projectId,getContext,isVisible:()=>document.visibilityState!=='hidden',onChange:render,onError:e=>toast(e.message)});
  await tracker.init();if(tracker.current?.status==='inactive'&&document.visibilityState!=='hidden')await tracker.touch();render(tracker.current);
  setCollapsed(false);
  toggle.onclick=()=>setCollapsed(!collapsed);
  panel.addEventListener('click',e=>{
    if(e.target.closest('#study-collapse')){setCollapsed(true);}
    if(e.target.closest('#study-end'))safely(()=>tracker.end());
    if(e.target.closest('#study-save')||e.target.closest('#study-discard')){ const save=!!e.target.closest('#study-save'); safely(async()=>{const resume=tracker.current?.reason!=='manual',context=getContext();await tracker.resolve(save,s=>api('/api/sessions','POST',s));if(resume&&context&&document.visibilityState!=='hidden')await tracker.touch(context);toast(save?'Sessão salva.':'Registro de estudo descartado; alterações do material preservadas.');onSaved();}); }
  });
  let lastInteraction=0;
  for(const event of ['pointerdown','keydown','input','scroll'])document.addEventListener(event,e=>{
    if(e.target.closest?.('#study-panel,#study-toggle')||document.visibilityState==='hidden'||(!tracker.current&&!getContext())||Date.now()-lastInteraction<1000)return;
    lastInteraction=Date.now();safely(()=>tracker.touch());
  },{capture:true,passive:true});
  document.addEventListener('visibilitychange',()=>safely(async()=>{await tracker.tick();if(document.visibilityState!=='hidden'&&tracker.current?.status==='inactive')await tracker.touch();else await tracker.focus();}));
  window.addEventListener('pagehide',()=>safely(()=>tracker.focus(null)));
  return tracker;
}
