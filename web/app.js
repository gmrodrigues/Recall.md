import { confirmedSessions, sessionStatus, stageStatus } from './flow/model.js';
import { DEFAULT_LINK_MINUTES, MIN_STUDY_MINUTES, materialLinkIdentity, materialPageLinks, materialPages } from './src/material.js';
import { editReading, playMaterial, renderMaterial, renderStudyTime } from './material-view.js';
import { readingProgress } from './reading-progress.js';
import { probeVideo, sampleVideoDurations } from './video-metadata.js';

const $ = s => document.querySelector(s);
const escape = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const enc = encodeURIComponent;
const chartUnmounts = new Map();
let ganttAssets;


let state, page = 'board', selected = null, tab = 'material', search = '', deckFilter = '', phaseFilter = '', sessionFilter = '', editing = null, materialType = null, reviewCards = [], reviewIndex = 0, reviewActive = false, toastTimer, refreshing = false;
let scheduleView;
let reading;
let readingView;
let detailVersion;
let boardDay = '';
let boardColorsAt = 0;
const routeTabs = { material: 'material', quiz: 'quiz', cards: 'cartoes-de-memorizacao', history: 'tentativas' };
const routeDialogIds = {
  'novo-plano': 'deck-dialog', 'nova-ficha': 'editor', 'novo-capitulo': 'board-phase-editor',
  'editar-ficha': 'editor', 'editar-material': 'reading-editor', 'nova-questao': 'material-editor',
  'novo-cartao-de-memorizacao': 'material-editor', 'agenda': 'saved-schedule-dialog', 'novo-cronograma': 'schedule-editor',
  'editar-cronograma': 'schedule-editor', 'configuracoes': 'schedule-settings', 'sessoes': 'schedule-sessions',
};
let routeOverlay = '';
let routeOverlayId = '';
let reviewPlan = '';
let reviewUnit = '';
let restoringRoute = false;
let linkedReadingPage = '';
let routeRequest = 0;
let createColumn = '';
const ignoredRouteCloses = new WeakSet();

function slug(value) {
  return String(value).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'plano';
}

function planSlug(name) {
  const plain = slug(name);
  let hash = 2166136261;
  for (const character of name) hash = Math.imul(hash ^ character.codePointAt(0), 16777619);
  return plain + '--' + (hash >>> 0).toString(36);
}

function planFromSlug(value) {
  const exact = decks().find(name => planSlug(name) === value);
  if (exact) return exact;
  const candidates = decks().filter(name => slug(name) === value);
  return candidates.length === 1 ? candidates[0] : '';
}

function chapterSlug(chapter) {
  const name = slug(chapter.name);
  const count = state.schedule?.milestones.filter(item => slug(item.name) === name).length;
  return count > 1 ? name + '--' + chapter.id : name;
}

function studyRoute() {
  let path = { board: deckFilter ? '/planos-de-estudo/' + planSlug(deckFilter) : '/quadro',
    archived: '/planos-de-estudo/arquivados', review: reviewPlan ? '/cartoes-de-memorizacao/' + planSlug(reviewPlan) : '/cartoes-de-memorizacao',
    history: '/historico', schedule: '/cronogramas', sessions: '/sessoes-de-estudo' }[page];
  const params = new URLSearchParams();
  if (page === 'review' && reviewUnit) params.set('ficha', slug(reviewUnit));
  if (page === 'board') {
    const chapter = state.schedule?.milestones.find(item => item.id === phaseFilter);
    if (chapter) params.set('capitulo', chapterSlug(chapter));
    if (boardDay) params.set('dia', boardDay);
    if (sessionFilter) params.set('sessao', sessionFilter);
    if (routeOverlay === 'nova-ficha' && createColumn) params.set('coluna', slug(createColumn));
    if (search) params.set('busca', search);
  }
  if (selected) {
    path += '/fichas/' + slug(selected) + '/' + routeTabs[tab];
    if (tab === 'material' && linkedReadingPage) params.set('pagina', linkedReadingPage);
  }
  if (routeOverlay) {
    if (routeOverlay === 'agenda' && routeOverlayId) path += '/agenda/' + enc(routeOverlayId);
    else if (routeOverlay === 'editar-cronograma') path += '/agenda/' + enc(routeOverlayId) + '/editar';
    else path += '/' + routeOverlay;
  }
  return path + (params.size ? '?' + params : '');
}

function updateRoute(replace = false) {
  if (restoringRoute || !state) return;
  const destination = studyRoute();
  if (destination === window.location.pathname + window.location.search) return;
  window.history[replace ? 'replaceState' : 'pushState'](null, '', destination);
}

function setRouteOverlay(type, id = '') {
  routeOverlay = type;
  routeOverlayId = id;
  updateRoute();
}

function watchRouteDialog(dialog, type) {
  dialog.addEventListener('close', () => {
    if (restoringRoute || ignoredRouteCloses.has(dialog) || dialog.open || routeOverlay !== type) return;
    routeOverlay = '';
    routeOverlayId = '';
    updateRoute(true);
  });
}

async function restoreRoute() {
  const request = ++routeRequest;
  restoringRoute = true;
  try {
    for (const dialog of document.querySelectorAll('dialog[open]')) {
      ignoredRouteCloses.add(dialog);
      dialog.addEventListener('close', () => ignoredRouteCloses.delete(dialog), { once: true });
      dialog.close();
    }
    const parts = window.location.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    const params = new URLSearchParams(window.location.search);
    const root = parts.shift();
    const possiblePage = { 'planos-de-estudo': 'board', flashcards: 'review', 'cartoes-de-memorizacao': 'review', historico: 'history',
      cronogramas: 'schedule', 'sessoes-de-estudo': 'sessions' }[root] ?? 'board';
    page = possiblePage;
    deckFilter = '';
    reviewActive = false;
    reviewPlan = '';
    reviewUnit = '';
    if (root === 'planos-de-estudo' && parts[0] === 'arquivados') {
      page = 'archived';
      parts.shift();
    } else if (root === 'planos-de-estudo') deckFilter = planFromSlug(parts.shift());
    else if (['flashcards', 'cartoes-de-memorizacao'].includes(root) && parts[0]) reviewPlan = planFromSlug(parts.shift());
    phaseFilter = state.schedule?.milestones.find(item => chapterSlug(item) === params.get('capitulo'))?.id || '';
    boardDay = /^\d{4}-\d{2}-\d{2}$/.test(params.get('dia') || '') ? params.get('dia') : '';
    sessionFilter = params.get('sessao') || '';
    search = params.get('busca') || '';
    selected = null;
    readingView = null;
    linkedReadingPage = params.get('pagina') || '';
    routeOverlay = '';
    routeOverlayId = '';
    await render();
    if (request !== routeRequest) return;
    if (reviewPlan) startReview(reviewPlan, state.units.find(unit => slug(unit.id) === params.get('ficha'))?.id);
    if (parts[0] === 'fichas') {
      parts.shift();
      const key = parts.shift();
      const target = state.units.find(unit => slug(unit.id) === key);
      if (parts[0] === 'flashcards') parts[0] = routeTabs.cards;
      const routeTab = Object.keys(routeTabs).find(key => routeTabs[key] === parts[0]);
      if (routeTab) {
        tab = routeTab;
        parts.shift();
      }
      if (target) await openUnit(target.id, Boolean(routeTab));
      if (request !== routeRequest) return;
    }
    const overlay = parts.shift();
    if (overlay === 'agenda') {
      const id = parts.shift() || '';
      if (parts[0] === 'editar' && page === 'schedule') {
        const schedule = scheduleView.data.schedules.find(item => item.id === id);
        if (schedule) {
          setRouteOverlay('editar-cronograma', id);
          scheduleEditor(schedule);
        }
      } else {
        setRouteOverlay('agenda', id);
        await openSavedSchedule(id, page === 'board');
      }
    } else if (page === 'schedule' && overlay === 'novo-cronograma') {
      setRouteOverlay(overlay);
      scheduleEditor();
    } else if (page === 'schedule' && ['configuracoes', 'sessoes'].includes(overlay)) {
      setRouteOverlay(overlay);
      $(overlay === 'configuracoes' ? '#schedule-settings' : '#schedule-sessions').showModal();
    } else if (overlay === 'novo-plano' && page === 'board') openDeckDialog('create');
    else if (overlay === 'nova-ficha' && page === 'board') openEditor(null, state.statuses.find(status => slug(status) === params.get('coluna')));
    else if (overlay === 'novo-capitulo' && page === 'board') await openBoardChapter();
    else if (selected && overlay === 'editar-ficha') openEditor(await api('/api/units/' + enc(selected) + '/edit'));
    else if (selected && overlay === 'editar-material') openReadingEditor();
    else if (selected && overlay === 'nova-questao') openMaterial('question');
    else if (selected && ['novo-flashcard', 'novo-cartao-de-memorizacao'].includes(overlay)) openMaterial('card');
  } finally {
    if (request === routeRequest) {
      restoringRoute = false;
      updateRoute(true);
    }
  }
}

const wizardSteps = [
  { key: 'availability', label: 'Agenda compartilhada' },
  { key: 'content', label: 'Conteúdo' },
  { key: 'deadline', label: 'Detalhes e prazo' },
  { key: 'review', label: 'Revisão' },
];
const reviewStep = wizardSteps.findIndex(step => step.key === 'review');
let scheduleWizard;

const weekDays = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
let study = null;
const quizDrafts = new Map();
const devProject = document.querySelector('meta[name="recall-dev-reload"]')?.content;
const devKey = devProject && `recall-dev-session:${devProject}`;
const draftQuestions = new Map();
function readDevSession() {
  try { return devKey ? JSON.parse(sessionStorage.getItem(devKey) || 'null') : null; } catch { return null; }
}
function saveDevSession() {
  if (!devKey) return;
  try { sessionStorage.setItem(devKey, JSON.stringify({ selected, tab, drafts: [...quizDrafts].map(([id, values]) => [id, { values, questions: draftQuestions.get(id) }]) })); } catch {}
}
function reloadDevelopment() { captureQuizDraft(); saveDevSession(); location.reload(); }
if (devProject) {
  const events = new EventSource('/api/dev-reload');
  let boot;
  events.onmessage = e => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'reload') reloadDevelopment();
    else if (msg.type === 'boot') {
      let previous = boot;
      try { sessionStorage.setItem(`${devKey}:boot`, msg.id); } catch {}
      boot = msg.id;
      if (previous && previous !== msg.id) reloadDevelopment();
    }
  };
  window.addEventListener('pagehide', () => { captureQuizDraft(); saveDevSession(); });
  document.addEventListener('input', e => { if (e.target.closest('#quiz-form')) { captureQuizDraft(); saveDevSession(); } });
}
async function restoreDevSession() {
  const saved = readDevSession();
  if (!saved || !Array.isArray(saved.drafts)) return;
  for (const entry of saved.drafts) {
    if (!Array.isArray(entry) || entry.length !== 2) continue;
    const [id, draft] = entry, u = state.units.find(item => item.id === id);
    if (!u || !draft?.values || !draft.questions) continue;
    const values = Object.fromEntries(u.questions.filter(q => draft.questions[q.id] === JSON.stringify(q) && Object.hasOwn(draft.values, q.id)).map(q => [q.id, draft.values[q.id]]));
    if (Object.keys(values).length) { quizDrafts.set(id, values); draftQuestions.set(id, Object.fromEntries(u.questions.map(q => [q.id, JSON.stringify(q)]))); }
  }
  if (state.units.some(u => u.id === saved.selected)) {
    if (!selected) {
      tab = ['material', 'quiz', 'cards', 'history'].includes(saved.tab) ? saved.tab : 'quiz';
      await openUnit(saved.selected, true);
    } else if (selected === saved.selected) renderUnitBody();
  }
}
async function api(url, method = 'GET', body) {
  if (study && method !== 'GET' && !url.startsWith('/api/sessions')) { const session = await study.touch(studyContext()); if (session?.status === 'pending') throw new Error('Finalize a sessão anterior no painel antes de continuar.'); }
  const r = await fetch(url, { method, ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
  const data = await r.json(); if (!r.ok) throw Object.assign(new Error(data.error || 'Não foi possível completar a operação.'), { status: r.status });
  if (study && method !== 'GET' && !url.startsWith('/api/sessions')) {
    const parts = url.split('/'), id = parts[3];
    const unitId = parts[2] === 'attempts' ? state.attempts.find(a => a.id === id)?.unit : id ? decodeURIComponent(id) : data.unit?.id;
    const u = data.unit || state.units.find(u => u.id === unitId);
    const current = studyContext();
    const context = current?.unitId === unitId ? current : u ? unitContext(u) : null;
    const action = parts[4] === 'attempts' ? 'quiz_completed' : parts[4] === 'reviews' ? `flashcard_rated:${body.card}:${body.rating}` : parts[4] === 'assess' ? `quiz_assessed:${body.question}:${body.correct}` : parts[4] === 'cards' ? `flashcard_created:${body.question}` : parts[4] === 'sync' ? 'links_synced' : body?.status ? `move:${body.status}` : body?.questions ? 'questions_saved' : body?.cards ? 'cards_saved' : 'unit_saved';
    try { await study.record(context, action, Number(r.headers.get('X-Recall-Transaction-At')) || undefined); } catch (e) { toast('A alteração foi salva; falha no registro da sessão: ' + e.message); }
  }
  return data;
}
function toast(message) { $('#toast').textContent = message; $('#toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 5000); }
function applyState(next) {
  const decksChanged = JSON.stringify(state?.decks) !== JSON.stringify(next.decks);
  if (!reading) {
    let storage;
    try { storage = window.localStorage; } catch {}
    reading = readingProgress(next.progressProject, api, storage, window);
  }
  state = next;
  if (deckFilter && !decks().includes(deckFilter)) { deckFilter = ''; updateRoute(true); }
  $('#project-name').textContent = state.name;
  $('#due-count').textContent = state.cards.filter(due).length;
  if (decksChanged) renderDeckMenu();
}
async function load() { applyState(await api('/api/state')); }
function captureQuizDraft() {
  const form = $('#quiz-form'), u = selected && state?.units.find(item => item.id === selected);
  if (!form || form.dataset.submitted || !u) return;
  const questions = form.draftQuestions || u.questions;
  const values = Object.fromEntries(questions.map(q => {
    const fields = [...form.elements].filter(field => field.name === q.id), checked = fields.find(field => field.checked);
    return [q.id, q.type === 'choice' ? (checked ? Number(checked.value) : null) : fields[0]?.value ?? ''];
  }));
  if (Object.values(values).some(value => value !== null && value !== '')) { quizDrafts.set(u.id, values); draftQuestions.set(u.id, Object.fromEntries(questions.map(q => [q.id, JSON.stringify(q)]))); } else { quizDrafts.delete(u.id); draftQuestions.delete(u.id); }
}
function hasQuizDraft() {
  const form = $('#quiz-form');
  if (!form) return false;
  if (form.dataset.submitted) return !!$('#quiz-feedback')?.textContent;
  return [...form.querySelectorAll('textarea')].some(field => field.value) || [...form.querySelectorAll('input[type="radio"]')].some(field => field.checked);
}
async function refreshView() {
  if ($('#detail').open) {
    if (selected && !state.units.some(unit => unit.id === selected)) {
      if ($('#material-editor').open) $('#material-editor').close();
      if ($('#reading-editor').open) $('#reading-editor').close();
      if ($('#editor').open) $('#editor').close();
      $('#detail').close();
      return;
    }
    if (tab === 'material' && state.units.find(unit => unit.id === selected)?.version === detailVersion) {
      const target = $('#unit-body [data-material-study-time]');
      if (target) target.innerHTML = renderStudyTime(stageTime(selected));
      return;
    }
    if (selected && !$('#editor').open && !$('#material-editor').open && !$('#reading-editor').open && !hasQuizDraft()) {
      await openUnit(selected, true, true);
    }
    return;
  }
  if (page === 'board') renderLanes();
  else if (page === 'archived') archivedDecks();
  else if (page === 'history') history();
  else if (page === 'sessions') await sessionsView();
  else if (page === 'review') {
    const current = reviewCards[reviewIndex];
    if (!reviewActive || (current && !state.cards.some(card => card.unit === current.unit && card.id === current.id))) {
      reviewActive = false;
      reviewHome();
    }
  }
}
async function synchronizeView() {
  if (refreshing || document.visibilityState === 'hidden' || !state) return;
  refreshing = true;
  try {
    const previous = state;
    const next = await api('/api/state');
    if (state !== previous) return;
    const changed = JSON.stringify(next) !== JSON.stringify(previous);
    applyState(next);
    if (changed) {
      const sameAttemptView = $('#detail').open && ['quiz', 'history'].includes(tab)
        && next.units.find(unit => unit.id === selected)?.version === detailVersion
        && JSON.stringify(next.attempts.filter(item => item.unit === selected))
          === JSON.stringify(previous.attempts.filter(item => item.unit === selected));
      if (sameAttemptView) refreshAssessmentFeedback();
      else await refreshView();
    }
    if (page === 'board' && next.schedule?.sessions.some(session =>
      sessionStatus(session, boardColorsAt) !== sessionStatus(session))) renderLanes();
  } catch {} finally { refreshing = false; }
}
function due(c) { return !c.due || Date.parse(c.due) <= Date.now(); }
function decks() {
  return (state.decks || []).filter(deck => deck.status === 'active').map(deck => deck.name);
}

function renderDeckMenu() {
  const active = decks();
  const menu = $('#board-deck-menu');
  menu.hidden = page !== 'board' && page !== 'archived';
  menu.innerHTML = active.map((name, index) => `<div class="deck-menu-row">
    <button type="button" class="deck-menu-item" data-board-deck="${escape(name)}" ${page === 'board' && name === deckFilter ? 'aria-current="page"' : ''}>${escape(name)}</button>
    <details class="deck-menu-actions"><summary aria-label="Opções de ${escape(name)}">⋯</summary>
      <div class="deck-menu-options">
        <button type="button" data-deck-action="up" data-deck-name="${escape(name)}" ${index === 0 ? 'disabled' : ''}>Mover para cima</button>
        <button type="button" data-deck-action="down" data-deck-name="${escape(name)}" ${index === active.length - 1 ? 'disabled' : ''}>Mover para baixo</button>
        <button type="button" data-deck-action="archive" data-deck-name="${escape(name)}">Arquivar</button>
        <button type="button" data-deck-action="remove" data-deck-name="${escape(name)}">Remover</button>
      </div>
    </details>
  </div>`).join('') + `
    <button type="button" class="deck-menu-item" data-deck-action="create">＋ Novo plano de estudo</button>
    <button type="button" class="deck-menu-item" data-page="archived" ${page === 'archived' ? 'aria-current="page"' : ''}>Arquivados</button>`;
}

function archivedDecks() {
  const archived = state.decks.filter(deck => deck.status === 'archived');
  $('#view').innerHTML = heading('Planos de estudo arquivados', 'Desarquive um plano de estudo para voltar a vê-lo nas áreas de estudo.') +
    (archived.length ? `<ul class="schedule-items content-card">${archived.map(({ name }) => `
      <li class="schedule-list-item"><strong>${escape(name)}</strong><div class="schedule-item-actions">
        <button type="button" class="button secondary" data-deck-action="restore" data-deck-name="${escape(name)}">Desarquivar</button>
        <button type="button" class="button secondary" data-deck-action="remove" data-deck-name="${escape(name)}">Remover</button>
      </div></li>`).join('')}</ul>` : '<p class="empty">Nenhum plano de estudo arquivado.</p>');
}

function navigate(target, deck = '') {
  captureQuizDraft();
  if ($('#detail').open) {
    ignoredRouteCloses.add($('#detail'));
    $('#detail').addEventListener('close', () => ignoredRouteCloses.delete($('#detail')), { once: true });
    $('#detail').close();
  }
  clearGantt();
  page = target;
  selected = null;
  reviewActive = false;
  reviewUnit = reviewPlan = routeOverlay = routeOverlayId = linkedReadingPage = '';
  if (target === 'board') {
    deckFilter = deck;
    boardDay = '';
    sessionFilter = '';
    phaseFilter = '';
    search = '';
  }
  render();
  updateRoute();
  study?.focus(null).catch(error => toast(error.message));
}

async function saveDeck(action, name, confirmation) {
  await api('/api/decks', 'POST', { action, name, confirmation });
  await load();
  if (action === 'create') navigate('board', name.trim());
  else render();
  const messages = { create: 'Plano de estudo criado.', archive: 'Plano de estudo arquivado.', restore: 'Plano de estudo desarquivado.', remove: 'Plano de estudo removido.' };
  if (messages[action]) toast(messages[action]);
}

function openNamedDialog(dialog, { titleId, title, description = '', name, submitLabel, submit }) {
  const confirmName = name !== undefined;
  dialog.innerHTML = `<form><header class="dialog-heading"><h2 id="${titleId}">${title}</h2>
    <button type="button" class="icon-button close-dialog" aria-label="Fechar">×</button></header>
    ${description}
    <label>${confirmName ? `Digite <strong>${escape(name)}</strong> para confirmar` : 'Nome do plano de estudo'}
      <input type="text" name="name" required maxlength="${confirmName ? Math.max(120, name.length) : 120}" autocomplete="off">
    </label>
    <p class="form-error" role="alert"></p>
    <div class="dialog-actions"><button type="button" class="button secondary close-dialog">Cancelar</button>
      <button class="button ${confirmName ? 'danger' : 'primary'}" type="submit" ${confirmName ? 'disabled' : ''}>${submitLabel}</button></div>
  </form>`;
  const form = dialog.querySelector('form');
  const field = form.elements.name;
  const button = form.querySelector('button[type="submit"]');
  const valid = () => confirmName ? field.value === name : Boolean(field.value.trim());
  field.addEventListener('input', () => { button.disabled = !valid(); });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (button.disabled || !valid()) return;
    button.disabled = true;
    field.readOnly = true;
    try {
      await submit(field.value);
      dialog.close();
    } catch (error) {
      form.querySelector('.form-error').textContent = error.message;
    } finally {
      field.readOnly = false;
      button.disabled = !valid();
    }
  });
  dialog.showModal();
  field.focus();
}

function openDeckDialog(action, name) {
  const removing = action === 'remove';
  if (action === 'create') setRouteOverlay('novo-plano');
  openNamedDialog($('#deck-dialog'), {
    titleId: 'deck-dialog-title', title: removing ? 'Remover plano de estudo' : 'Novo plano de estudo',
    name: removing ? name : undefined,
    description: removing ? '<p>O plano de estudo e suas fichas sairão das áreas de estudo e não poderão ser desarquivados. Os arquivos locais serão preservados.</p>' : '',
    submitLabel: removing ? 'Remover plano de estudo' : 'Criar plano de estudo',
    submit: value => saveDeck(action, removing ? name : value, removing ? value : undefined),
  });
}

function openRemoveSchedule(id) {
  const { data, revision } = scheduleView;
  const schedule = data.schedules.find(item => item.id === id);
  if (!schedule) return;
  openNamedDialog($('#remove-schedule-dialog'), {
    titleId: 'remove-schedule-title', title: 'Remover cronograma', name: schedule.name,
    description: '<p>Esta ação é irreversível. As sessões exclusivas do cronograma serão retiradas da agenda. As fichas e o histórico de estudo serão preservados.</p>',
    submitLabel: 'Remover cronograma',
    submit: async confirmation => {
      await api('/api/schedule/remove', 'POST', { id, revision, confirmation });
      await load();
      await scheduleHome();
      toast('Cronograma removido.');
    },
  });
}
function heading(title, desc, action = '', viewSchedule = false) {
  return `<div class="page-heading"><div><span class="eyebrow">APRENDA COM INTENÇÃO</span><h1>${viewSchedule ? `<button class="schedule-title-button" type="button" data-view-schedule="" aria-haspopup="dialog">${title}</button>` : title}</h1><p>${desc}</p></div>${action}</div>`;
}
function render() {
  $('#breadcrumb').textContent = { board: 'Quadro de estudos', archived: 'Planos de estudo arquivados', review: 'Cartões de memorização', history: 'Histórico', schedule: 'Cronogramas', sessions: 'Sessões de estudos' }[page];
  document.querySelectorAll('[data-page]').forEach(b => b.classList.toggle('active', b.dataset.page === page));
  $('[data-page="board"].nav-item').classList.toggle('active', page === 'board' || page === 'archived');
  renderDeckMenu();
  if (page === 'board') board(); else if (page === 'archived') archivedDecks(); else if (page === 'review') reviewHome(); else if (page === 'schedule') return perform(() => scheduleHome()); else if (page === 'sessions') return perform(sessionsView); else history();
}
function board() {
  const actions = `<div class="schedule-header-actions">
    <button type="button" class="button secondary" data-view-schedule="" data-board-schedule aria-haspopup="dialog">Exibir cronograma</button>
    <span id="board-next-study"></span>
    <button type="button" class="button primary" data-action="create"><span aria-hidden="true">+</span> Nova ficha de conteúdo</button>
  </div>`;
  $('#view').innerHTML = heading('Quadro de estudos', 'Um passo de cada vez, do primeiro contato à revisão.', actions) +
    `<div class="stats"><div class="stat"><span class="stat-icon">▦</span><div><strong>${state.units.length}</strong><small>Fichas de conteúdo</small></div></div><div class="stat"><span class="stat-icon">▱</span><div><strong>${state.cards.filter(due).length}</strong><small>Cartões para revisar</small></div></div><div class="stat"><span class="stat-icon">✓</span><div><strong>${state.attempts.length}</strong><small>Quizzes respondidos</small></div></div></div>` +
    (!state.units.length ? '<div class="empty-banner"><div><h3>O que você quer entender melhor?</h3><p>Crie uma ficha de conteúdo, reúna seu material e transforme o aprendizado em prática.</p></div><button class="button secondary" data-action="create">Criar primeira ficha de conteúdo ↗</button></div>' : '') +
    `<div class="toolbar"><div class="search-wrap"><span>⌕</span><input id="search" class="search" aria-label="Buscar fichas de conteúdo" placeholder="Buscar fichas de conteúdo..." value="${escape(search)}"></div><select id="deck-filter" aria-label="Filtrar plano de estudo"></select><select id="phase-filter" aria-label="Filtrar capítulo"></select><select id="session-filter" aria-label="Filtrar sessão agendada"></select><button type="button" class="button secondary" data-new-board-phase>Novo capítulo</button></div><div id="schedule-strip"></div><div id="board" class="board" tabindex="0" role="region" aria-label="Colunas do quadro de estudos"></div>
    <dialog id="board-phase-editor" aria-labelledby="board-phase-title">
      <header class="dialog-heading"><h2 id="board-phase-title">Novo capítulo</h2><button type="button" class="icon-button close-dialog" aria-label="Fechar">×</button></header>
      <div id="milestone-editor"></div>
    </dialog>`;
  renderLanes();
  $('#schedule-strip').addEventListener('click', event => {
    const button = event.target.closest('[data-board-day]');
    if (!button) return;
    const day = button.dataset.boardDay;
    boardDay = boardDay === day ? '' : day;
    renderLanes();
    updateRoute();
    $('#schedule-strip').querySelector(`[data-board-day="${day}"]`)?.focus();
  });
  $('#search').addEventListener('input', e => { search = e.target.value; renderLanes(); updateRoute(true); });
  $('#session-filter').addEventListener('change', event => { sessionFilter = event.target.value; renderLanes(); updateRoute(); });
  $('#phase-filter').addEventListener('change', event => { phaseFilter = event.target.value; renderLanes(); updateRoute(); });
  $('#deck-filter').addEventListener('change', e => { deckFilter = e.target.value; renderDeckMenu(); renderLanes(); updateRoute(); });
}
function memberOf(milestone, unit) {
  if (unit.milestoneId) return unit.milestoneId === milestone.id;
  return (milestone.units || []).includes(unit.id)
    || (milestone.cards || []).some(member => member.unit === unit.id)
    || (unit.legacyMilestones || []).includes(milestone.id)
    || (unit.cards || []).some(card => card.milestoneId === milestone.id);
}

function boardSessions(agenda) {
  return [...(agenda?.sessions || []), ...confirmedSessions(agenda), ...(agenda?.pendingPlacement || [])];
}

function visibleBoardUnits(phase, { skipSession = false, skipDay = false } = {}) {
  const dayUnits = boardDay && !skipDay
    ? new Set(boardSessions(state.schedule).filter(session => session.date === boardDay).map(session => session.card.unit))
    : null;
  const selectedSession = !skipSession && sessionFilter
    ? state.schedule?.sessions.find(session => session.id === sessionFilter) : null;
  return state.units.filter(unit => (!dayUnits || dayUnits.has(unit.id)) && (!selectedSession || selectedSession.card.unit === unit.id) && (!deckFilter || unit.deck === deckFilter) && (!phase || memberOf(phase, unit))
    && `${unit.title} ${unit.description} ${unit.id}`.toLowerCase().includes(search.toLowerCase()));
}

function visibleBoardSchedules(data, { skipDay = false, skipSession = false } = {}) {
  if (!deckFilter && !phaseFilter && (!sessionFilter || skipSession) && (!boardDay || skipDay) && !search.trim()) return data.schedules;
  const selectedSession = !skipSession && sessionFilter ? data.sessions.find(session => session.id === sessionFilter) : null;
  const phase = data.milestones.find(item => item.id === phaseFilter);
  const units = visibleBoardUnits(phase, { skipDay, skipSession });
  const milestones = new Map(data.milestones.map(item => [item.id, item]));
  function inMilestone(id, unit) {
    const milestone = milestones.get(id);
    return Boolean(milestone && memberOf(milestone, unit));
  }
  return data.schedules.filter(schedule => {
    if (selectedSession && !selectedSession.schedules.includes(schedule.id)) return false;
    const phases = schedule.phases.map(item => item.milestoneId).filter(Boolean);
    return units.some(unit => schedule.groups.some(group => group.type === 'deck' ? unit.deck === group.id : inMilestone(group.id, unit))
      && (!phases.length || phases.some(id => inMilestone(id, unit))));
  });
}

function boardSlotFilter(schedules, units) {
  const scheduleIds = new Set(schedules.map(item => item.id));
  const visibleUnits = new Set(units.map(unit => unit.id));
  return session => session.schedules.some(id => scheduleIds.has(id)) && visibleUnits.has(session.card.unit);
}

function pendingBoardSessions(schedules, units) {
  const eligible = units.filter(unit => !['Em revisão', 'Concluído'].includes(unit.status));
  return (state.schedule?.sessions || []).filter(boardSlotFilter(schedules, eligible))
    .sort((a, b) => a.start - b.start || a.end - b.end || a.id.localeCompare(b.id));
}

function nextBoardSession(schedules, units) {
  return pendingBoardSessions(schedules, units).find(session => (!boardDay || session.date === boardDay) && (!sessionFilter || session.id === sessionFilter));
}

function renderSessionFilter(data, phase) {
  const field = $('#session-filter');
  const sessions = data ? pendingBoardSessions(data.schedules, visibleBoardUnits(phase, { skipSession: true, skipDay: true })) : [];
  if (!sessions.some(session => session.id === sessionFilter)) sessionFilter = '';
  const zone = data?.availability.timeZone;
  field.innerHTML = '<option value="">Todas as sessões</option>' + sessions.map(session =>
    `<option value="${escape(session.id)}">${escape(sessionTime(session, zone))} · ${escape(session.card.front || session.card.id)}</option>`).join('');
  field.value = sessionFilter;
  field.disabled = !sessions.length;
}

async function openNextBoardCard() {
  await load();
  if (page !== 'board' || !state.schedule) return;
  const phase = state.schedule.milestones.find(item => item.id === phaseFilter);
  const next = nextBoardSession(visibleBoardSchedules(state.schedule), visibleBoardUnits(phase));
  if (!next) {
    renderLanes();
    toast('Nenhuma ficha de conteúdo programada disponível com estes filtros.');
    return;
  }
  await openUnit(next.card.unit);
}

function renderLanes() {
  const deckField = $('#deck-filter');
  const deckOptions = ['Todos os planos de estudo', ...decks()];
  if (deckOptions.length !== deckField.options.length ||
      deckOptions.some((name, index) => name !== deckField.options[index].textContent)) {
    deckField.innerHTML = '<option value="">Todos os planos de estudo</option>' + deckOptions.slice(1)
      .map(name => `<option value="${escape(name)}">${escape(name)}</option>`).join('');
  }
  deckField.value = deckFilter;
  const allChapters = state.schedule?.milestones || [];
  const planUnits = deckFilter ? state.units.filter(unit => unit.deck === deckFilter) : [];
  const milestones = deckFilter ? allChapters.filter(chapter => planUnits.some(unit => memberOf(chapter, unit))) : allChapters;
  const phase = milestones.find(item => item.id === phaseFilter);
  if (!phase) phaseFilter = '';
  const filter = $('#phase-filter');
  filter.innerHTML = '<option value="">Todos os capítulos</option>' + milestones.map(item =>
    `<option value="${escape(item.id)}">${escape(item.name)}</option>`).join('');
  filter.value = phase?.id || '';
  renderSessionFilter(state.schedule, phase);
  const stripFilters = { skipDay: true, skipSession: true };
  $('#schedule-strip').innerHTML = scheduleStrip(
    state.schedule ? visibleBoardSchedules(state.schedule, stripFilters) : [],
    visibleBoardUnits(phase, stripFilters),
  );
  if (boardDay && !$('#schedule-strip').querySelector('[aria-pressed="true"]')) boardDay = '';
  const units = visibleBoardUnits(phase);
  const schedules = state.schedule ? visibleBoardSchedules(state.schedule) : [];
  const next = nextBoardSession(schedules, units);
  $('#board-next-study').innerHTML = (schedules.length || boardDay) ? `<button type="button" class="button secondary" data-next-board-card aria-haspopup="dialog"
    ${next ? '' : 'disabled title="Nenhuma ficha de conteúdo programada disponível com estes filtros"'}>Abrir próxima ficha programada</button>` : '';
  const statusesByUnit = new Map();
  const agenda = state.schedule;
  const awaitingTime = new Set((agenda?.pendingPlacement || []).map(entry => entry.card.unit));
  boardColorsAt = Date.now();
  for (const session of boardSessions(agenda)) {
    if (boardDay && session.date !== boardDay) continue;
    if (sessionFilter && session.id !== sessionFilter) continue;
    const statuses = statusesByUnit.get(session.card.unit) || [];
    statuses.push(sessionStatus(session, boardColorsAt));
    statusesByUnit.set(session.card.unit, statuses);
  }
  const cardsInLane = list => {
    const card = unit => studyCard(unit, stageStatus(statusesByUnit.get(unit.id) || []), awaitingTime.has(unit.id));
    if (!deckFilter || !milestones.length) return list.map(card).join('');
    const groups = new Map();
    for (const unit of list) {
      const chapter = phase || milestones.find(item => memberOf(item, unit));
      const group = groups.get(chapter?.id) || [];
      group.push(unit);
      groups.set(chapter?.id, group);
    }
    return [...milestones, null].map(chapter => {
      const group = groups.get(chapter?.id);
      if (!group?.length) return '';
      const order = new Map((chapter?.units || []).map((id, index) => [id, index]));
      group.sort((left, right) => (order.get(left.id) ?? Infinity) - (order.get(right.id) ?? Infinity));
      const heading = !phase ? '<h3 class="board-chapter-heading">' + escape(chapter?.name || 'Sem capítulo') + '</h3>' : '';
      return heading + group.map(card).join('');
    }).join('');
  };
  const board = $('#board');
  board.innerHTML = state.statuses.map((status, index) => {
    const list = units.filter(unit => unit.status === status);
    return `<section class="lane" data-status="${escape(status)}" aria-labelledby="lane-title-${index}">
      <header class="lane-heading">
        <span class="lane-dot" aria-hidden="true"></span>
        <h2 id="lane-title-${index}">${escape(status)}</h2>
        <span class="count" aria-label="${list.length} fichas">${list.length}</span>
      </header>
      <div class="lane-stack">${cardsInLane(list)}</div>
      <button class="lane-add" data-create-status="${escape(status)}"><span aria-hidden="true">+</span> Adicionar ficha de conteúdo</button>
    </section>`;
  }).join('');
  document.querySelectorAll('.study-card').forEach(c => c.addEventListener('dragstart', e => e.dataTransfer.setData('text/plain', c.dataset.unit)));
  document.querySelectorAll('.lane').forEach(l => {
    l.addEventListener('dragover', e => { e.preventDefault(); l.classList.add('drag-over'); });
    l.addEventListener('dragleave', e => { if (!l.contains(e.relatedTarget)) l.classList.remove('drag-over'); });
    l.addEventListener('drop', async event => {
      event.preventDefault();
      l.classList.remove('drag-over');
      const id = event.dataTransfer.getData('text/plain');
      const unit = state.units.find(item => item.id === id);
      if (!unit || unit.status === l.dataset.status) return;
      await perform(async () => {
        await api(`/api/units/${enc(id)}`, 'PATCH', { status: l.dataset.status, version: unit.version });
        await load();
        if (page === 'board') renderLanes();
      });
    });
  });
}

function unitStudied(unit) {
  return ['Em revisão', 'Concluído'].includes(unit.status) || (state.schedule?.confirmations || [])
    .some(session => session.card.kind === 'unit' && session.card.unit === unit.id && session.phase === 'Em estudo' && session.completed);
}

function studyCard(unit, scheduleStatus, awaitingTime) {
  const questions = (unit.questions || []).length;
  const cards = (unit.cards || []).length;
  const studied = unitStudied(unit);
  const scheduleLabel = awaitingTime ? 'Pendente de reprogramação'
    : { planned: 'Programada', missed: 'Atrasada', done: 'Realizada' }[scheduleStatus];
  const countLabel = (count, singular, plural) => `${count} ${count === 1 ? singular : plural}`;
  return `<button class="study-card" data-schedule-status="${scheduleStatus}" data-unit="${escape(unit.id)}" draggable="true">
    <span class="card-id">${escape(unit.id)}</span>
    <span class="card-title">${escape(unit.title)}</span>
    ${unit.description ? `<span class="card-description">${escape(unit.description)}</span>` : ''}
    <span class="deck-tag">${escape(unit.deck)}</span>
    <span class="card-bottom">
      <span>${countLabel(questions, 'questão', 'questões')}</span>
      <span>${countLabel(cards, 'cartão', 'cartões')}</span>
      ${scheduleLabel ? `<span>${scheduleLabel}</span>` : studied ? '<span>Ficha estudada</span>' : ''}
    </span>
  </button>`;
}

async function perform(fn) { try { await fn(); } catch (e) { toast(e.message); } }
function openEditor(unit = null, status = state.statuses[0]) {
  createColumn = status;
  setRouteOverlay(unit ? 'editar-ficha' : 'nova-ficha');
  editing = unit; const form = $('#edit-form'); form.reset(); form.querySelector('.form-error').textContent = '';
  $('#editor-heading').textContent = unit ? 'Editar ficha de conteúdo' : 'Nova ficha de conteúdo';
  $('#editor-status').innerHTML = state.statuses.map(s => `<option ${s === (unit?.status || status) ? 'selected' : ''}>${escape(s)}</option>`).join('');
  for (const k of ['title', 'deck', 'description', 'file']) form.elements[k].value = unit?.[k] || (k === 'deck' ? deckFilter || 'Geral' : '');
  form.elements.file.disabled = !!unit; form.elements.sources.value = (unit?.sources || []).join('\n');
  form.elements.deck.onchange = () => updateUnitMilestone(form.elements.deck, unit);
  updateUnitMilestone(form.elements.deck, unit);
  $('#editor').showModal();
}
$('#edit-form').addEventListener('submit', async e => {
  e.preventDefault(); const form = e.target; const data = Object.fromEntries(new FormData(form)); data.sources = data.sources.split('\n').map(s => s.trim()).filter(Boolean); if (!data.file) delete data.file; if (editing) data.version = editing.version;
  if (data.milestoneId === '' && editing?.deck === data.deck) delete data.milestoneId;
  form.querySelector('button[type="submit"]').disabled = true;
  try {
    const prior = editing;
    const result = await api(prior ? `/api/units/${enc(prior.id)}` : '/api/units', prior ? 'PATCH' : 'POST', data);
    $('#editor').close();
    await load();
    render();
    if (selected) await openUnit(result.unit.id);
    toast(result.warning || 'Ficha de conteúdo salva.');
  }
  catch (err) { form.querySelector('.form-error').textContent = err.message; }
  finally { form.querySelector('button[type="submit"]').disabled = false; }
});
function assessmentFor(attempt, result) {
  return state.assessments.findLast(entry => entry.attempt === attempt.id && entry.question === result.question);
}

function studyStatusSuggestion(unit) {
  const attempt = state.attempts.findLast(item => item.unit === unit.id);
  const results = new Map(attempt?.results.map(result =>
    [result.question, result.correct ?? assessmentFor(attempt, result)?.correct]) || []);
  if (unit.status === 'Concluído') {
    const errors = unit.questions.filter(question => results.get(question.id) === false).length;
    return errors ? { status: 'Em revisão', reason: errors === 1
      ? 'A tentativa mais recente teve uma resposta incorreta.'
      : 'A tentativa mais recente teve ' + errors + ' respostas incorretas.' } : null;
  }
  let suggestion;
  if (unit.questions.length && unit.questions.every(question => results.get(question.id) === true)) {
    suggestion = { status: 'Concluído', reason: 'Você acertou todas as questões na tentativa mais recente.' };
  } else if (attempt) {
    suggestion = { status: 'Em revisão', reason: 'Você já fez uma tentativa do quiz, com questões erradas ou ainda sem autoavaliação.' };
  } else if (unit.material?.length || unit.description?.trim() || unit.sources?.length) {
    const visited = new Set(reading.cached(unit.id)?.visited || []);
    const pages = materialPages(unit);
    const count = pages.filter(page => visited.has(page.id)).length;
    if (count === pages.length) suggestion = { status: 'Praticando', reason: 'Você visitou 100% das páginas do material.' };
    else if (count) suggestion = { status: 'Estudando', reason: 'Você visitou ' + count + ' de ' + pages.length + ' páginas do material.' };
  }
  return suggestion && state.statuses.indexOf(suggestion.status) > state.statuses.indexOf(unit.status) ? suggestion : null;
}

function closeStudyDetail() {
  const unit = state.units.find(item => item.id === selected);
  const suggestion = unit && studyStatusSuggestion(unit);
  const detail = $('#detail');
  if (!suggestion) {
    detail.close();
    return;
  }
  const { status, reason } = suggestion;
  const dialog = $('#study-status-dialog');
  if (dialog.open) return;
  dialog.innerHTML = '<form><h2 id="study-status-title">Mover ficha?</h2><p>Mover esta ficha para <strong>'
    + escape(status) + '</strong> ao fechar?</p><p>' + escape(reason) + '</p><p class="form-error" role="alert"></p>'
    + '<div class="dialog-actions"><button type="button" class="button secondary" data-decline autofocus>Não</button>'
    + '<button type="submit" class="button primary">Sim</button></div></form>';
  const decline = dialog.querySelector('[data-decline]');
  decline.addEventListener('click', () => { dialog.close(); detail.close(); });
  dialog.querySelector('form').addEventListener('submit', async event => {
    event.preventDefault();
    const submit = dialog.querySelector('[type=submit]');
    if (submit.disabled) return;
    const current = state.units.find(item => item.id === unit.id);
    if (!current || studyStatusSuggestion(current)?.status !== status) {
      dialog.querySelector('.form-error').textContent = 'A sugestão mudou. Feche este diálogo e solicite novamente.';
      return;
    }
    decline.disabled = submit.disabled = true;
    try {
      await api('/api/units/' + enc(unit.id), 'PATCH', { status, version: current.version });
      await load();
      dialog.close();
      detail.close();
      toast('Ficha movida para ' + status + '.');
    } catch (error) {
      dialog.querySelector('.form-error').textContent = error.message;
    } finally {
      decline.disabled = submit.disabled = false;
    }
  });
  dialog.showModal();
}

$('#detail').addEventListener('cancel', event => {
  event.preventDefault();
  closeStudyDetail();
});

async function openUnit(id, keepTab = false, background = false) {
  const expectedTab = tab;
  captureQuizDraft();
  if (readingView?.unit !== id) {
    readingView = null;
    if (!restoringRoute) linkedReadingPage = '';
  }
  const u = state.units.find(unit => unit.id === id);
  if (!u) return;
  selected = id;
  if (!keepTab) tab = { Praticando: 'quiz', 'Em revisão': 'cards', 'Concluído': 'history' }[u.status] || 'material';
  let ctx; try { ctx = await api(`/api/units/${enc(id)}/context`); } catch (e) { ctx = { state: 'error', error: e.message }; }
  if (selected !== id) return;
  if (background && (tab !== expectedTab || hasQuizDraft() || $('#editor').open || $('#material-editor').open || $('#reading-editor').open)) return;
  $('#detail-content').innerHTML = `<div class="detail-top"><div class="dialog-heading"><div><span class="eyebrow">${escape(u.id)} · ${escape(u.deck)}</span><h2>${escape(u.title)}</h2></div><button class="icon-button close-dialog" aria-label="Fechar">×</button></div><div class="toolbar"><span class="pill">${escape(u.status)}</span><button class="button secondary" data-action="edit-unit">Editar ficha de conteúdo</button></div></div><div class="detail-grid"><div class="detail-main"><div class="tabs">${[['material', 'Material'], ['quiz', 'Quiz'], ['cards', 'Cartões de memorização'], ['history', 'Tentativas']].map(([key, name]) => `<button class="tab ${key === tab ? 'active' : ''}" data-tab="${key}">${name}</button>`).join('')}</div><div id="unit-body"></div></div><aside class="detail-aside"><section id="unit-reading-notes" hidden aria-label="Anotações do material"></section><span class="eyebrow">CONTEXTO DA TAREFA</span>${['linked', 'pending'].includes(ctx.state) ? `<span class="pill">${escape(ctx.id)} · ${escape(ctx.status)}</span><h3>${escape(ctx.title)}</h3><p>${escape(ctx.description || 'Sem descrição na tarefa.')}</p>${ctx.acceptance ? `<details><summary>Critérios de aceite</summary><div class="prose">${escape(ctx.acceptance)}</div></details>` : ''}<p><a href="/api/units/${enc(id)}/source" target="_blank" rel="noopener">Abrir tarefa original ↗</a></p><small>${escape(ctx.file)}</small>${ctx.state === 'pending' ? '<p><button class="button secondary" data-action="sync">Criar links</button></p>' : '<p><small>↔ Vínculo nos dois sentidos</small></p>'}` : `<p>${escape(ctx.error || (ctx.state === 'missing' ? 'A tarefa vinculada não está mais no caminho esperado.' : 'Nenhuma tarefa correspondente no Backlog.md. Esta etapa funciona de forma independente.'))}</p>`}</aside></div>`;
  detailVersion = u.version;
  renderUnitBody();
  const detail = $('#detail');
  if (!detail.open) {
    if (study && typeof detail.show === 'function') detail.show();
    else detail.showModal();
  }
  if (!background) updateRoute();
  if (!background) await study?.focus(studyContext(), true);
}
function renderUnitBody() {
  captureQuizDraft();
  const u = state.units.find(u => u.id === selected), draft = quizDrafts.get(u.id) || {};
  document.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  if (tab === 'material') openReading(u);
  else if (readingView?.unit === u.id) paintReadingNotes(readingView.linkVisits);
  else {
    const target = $('#unit-reading-notes');
    api('/api/units/' + enc(u.id) + '/material-links').then(visits => {
      if (target.isConnected && tab !== 'material') {
        paintReadingNotes(new Map(visits.map(visit => [linkVisitKey(visit.page, visit.url), visit])));
      }
    }).catch(error => { if (target.isConnected) toast(error.message); });
  }
  if (tab === 'quiz') $('#unit-body').innerHTML = `<div class="panel-title"><h3>Pratique o que aprendeu</h3><button class="button secondary" data-action="add-question">＋ Questão</button></div>${u.questions.length ? `<form id="quiz-form">${u.questions.map((q, i) => `<div class="question"><small>QUESTÃO ${i + 1} · ${q.type === 'choice' ? 'MÚLTIPLA ESCOLHA' : 'TEXTO LIVRE'}</small><h3>${escape(q.prompt)}</h3>${q.type === 'choice' ? q.options.map((o, n) => `<label class="option"><input type="radio" name="${escape(q.id)}" value="${n}" ${draft[q.id] === n ? 'checked' : ''} required>${escape(o)}</label>`).join('') : `<textarea name="${escape(q.id)}" rows="3" required aria-label="Sua resposta: ${escape(q.prompt)}" placeholder="Explique com suas palavras...">${escape(draft[q.id] ?? '')}</textarea>`}${q.source ? `<div class="source">Fonte: ${escape(q.source)}</div>` : ''}</div>`).join('')}<div class="toolbar"><button type="submit" class="button primary">Conferir respostas ↗</button><button type="button" class="button secondary" data-tab="history">Conferir suas tentativas anteriores</button></div></form><div id="quiz-feedback"></div>` : '<div class="empty">Adicione uma questão ou importe material pela CLI.</div>'}`;
  if (tab === 'cards') $('#unit-body').innerHTML = `<div class="panel-title"><h3>Cartões de memorização desta ficha</h3><button class="button secondary" data-action="add-card">＋ Cartão de memorização</button></div>${u.cards.map(c => `<div class="content-card"><strong>${escape(c.front)}</strong><details data-study-card="${escape(c.id)}"><summary>Ver resposta</summary><p>${escape(c.back)}</p></details><span class="deck-tag">${escape(c.deck)}</span>${originNoteButton(c.noteOrigin)}</div>`).join('') || '<div class="empty">Crie cartões manualmente ou a partir do gabarito de um quiz.</div>'}`;
  if (tab === 'history') $('#unit-body').innerHTML = `<h3>Tentativas preservadas</h3>${state.attempts.filter(a => a.unit === u.id).reverse().map(a => `<details class="content-card"><summary>${new Date(a.created).toLocaleString('pt-BR')} · ${a.results.length} questões</summary>${feedback(a)}</details>`).join('') || '<div class="empty">Suas tentativas aparecerão aqui depois de responder ao quiz.</div>'}`;
  if ($('#quiz-form')) $('#quiz-form').draftQuestions = u.questions;
  $('#quiz-form')?.addEventListener('submit', async e => {
    e.preventDefault(); const form = e.target, submit = form.querySelector('button[type="submit"],button:not([type])'); submit.disabled = true;
    try { const f = new FormData(form), answers = Object.fromEntries(u.questions.map(q => [q.id, q.type === 'choice' ? Number(f.get(q.id)) : f.get(q.id)])); const a = await api(`/api/units/${enc(u.id)}/attempts`, 'POST', { answers }); quizDrafts.delete(u.id); draftQuestions.delete(u.id); form.dataset.submitted = 'true'; saveDevSession(); await load(); $('#quiz-feedback').innerHTML = `<h3 class="sources-heading">Sua tentativa</h3>${feedback(a)}`; toast('Tentativa registrada.'); }
    catch (err) { toast(err.message); } finally { submit.disabled = false; }
  });
}
function stageTime(unit) {
  return state.schedule?.studyTimes?.find(item => item.unit === unit);
}

function openReading(unit) {
  const ids = materialPages(unit).map(page => page.id);
  if (readingView?.unit === unit.id) {
    if (!ids.includes(readingView.page)) {
      readingView.page = ids[0];
      linkedReadingPage = readingView.page;
      updateRoute(true);
      readingView.progress = reading.visit(unit.id, readingView.page, ids);
    }
    $('#unit-body').innerHTML = renderMaterial(unit, readingView.page, readingView.progress, stageTime(unit.id));
    paintReadingLinks();
    return;
  }
  const cached = reading.cached(unit.id);
  const linked = ids.includes(linkedReadingPage);
  const view = { unit: unit.id, page: linked ? linkedReadingPage : ids.includes(cached?.lastPage) ? cached.lastPage : ids[0],
    progress: cached, navigated: linked, linkVisits: new Map() };
  readingView = view;
  linkedReadingPage = view.page;
  $('#unit-body').innerHTML = renderMaterial(unit, view.page, view.progress, stageTime(unit.id));
  view.linksReady = api('/api/units/' + enc(unit.id) + '/material-links').then(visits => {
    if (readingView !== view) return;
    for (const visit of visits) view.linkVisits.set(linkVisitKey(visit.page, visit.url), visit);
    paintReadingLinks();
  }).catch(error => { if (readingView === view) toast(error.message); });
  async function restore() {
    const progress = await reading.load(unit.id).catch(() => reading.cached(unit.id));
    if (readingView !== view || selected !== unit.id || tab !== 'material') return;
    const current = state.units.find(item => item.id === unit.id);
    if (!current) return;
    const available = materialPages(current).map(page => page.id);
    const page = view.navigated ? view.page : progress?.lastPage;
    const previousPage = view.page;
    view.page = available.includes(page) ? page : available[0];
    linkedReadingPage = view.page;
    updateRoute(true);
    view.progress = reading.visit(unit.id, view.page, available);
    if (view.page !== previousPage) $('#unit-body').innerHTML = renderMaterial(current, view.page, view.progress, stageTime(current.id));
    else updateReadingMeter(view.progress, available);
    paintReadingLinks();
    }
  restore();
}

function updateReadingMeter(progress, pages) {
  const meter = $('#unit-body .material-progress progress');
  if (!meter) return;
  const count = pages.filter(page => progress.visited.includes(page)).length;
  meter.value = count;
  meter.nextElementSibling.textContent = count + ' de ' + pages.length + ' ' + (pages.length === 1 ? 'página visitada' : 'páginas visitadas');
}

function selectReadingPage(page) {
  const unit = state.units.find(item => item.id === selected);
  if (!unit || !readingView || tab !== 'material') return;
  const pages = materialPages(unit).map(item => item.id);
  if (!pages.includes(page)) return;
  readingView.page = page;
  linkedReadingPage = page;
  updateRoute();
  readingView.navigated = true;
  readingView.progress = reading.visit(unit.id, page, pages);
  $('#unit-body').innerHTML = renderMaterial(unit, page, readingView.progress, stageTime(unit.id));
  paintReadingLinks();
  $('#unit-body .material-page h4')?.focus();
}

function linkVisitKey(page, url) {
  return JSON.stringify([page, url]);
}

function noteImage(source) {
  const dialog = $('#note-image-dialog');
  dialog.innerHTML = '<header class="dialog-heading"><h2 id="note-image-title">Imagem da anotação</h2>'
    + '<button type="button" class="icon-button close-dialog" aria-label="Fechar imagem">×</button></header>'
    + '<img src="' + escape(source) + '" alt="Imagem da anotação ampliada">';
  dialog.showModal();
}

function jumpToNoteSource(note, visit, visits) {
  const origin = visits.get(linkVisitKey(note.sourcePage, note.sourceUrl))
    || [...visits.values()].find(item => item.hash === visit.hash && item.url === note.sourceUrl)
    || visit;
  if (tab !== 'material') {
    tab = 'material';
    renderUnitBody();
  }
  selectReadingPage(origin.page);
  const anchor = [...document.querySelectorAll('#unit-body [data-reading-link]')]
    .find(link => link.getAttribute('href') === origin.url);
  if (!anchor) return;
  anchor.classList.add('note-source-highlight');
  anchor.scrollIntoView({ block: 'center', inline: 'nearest' });
  anchor.focus({ preventScroll: true });
}

function paintReadingNotes(visits) {
  const panel = $('#unit-reading-notes');
  if (!panel) return;
  const entries = new Map();
  for (const visit of visits.values()) {
    for (const note of visit.notes || []) {
      if (!entries.has(note.id)) entries.set(note.id, { note, visit });
    }
  }
  const notes = [...entries.values()].sort((a, b) => a.note.position - b.note.position);
  panel.hidden = !notes.length;
  if (!notes.length) {
    panel.replaceChildren();
    return;
  }
  const unit = selected;
  const draw = index => {
    const { note, visit } = notes[index];
    const endpoint = '/api/units/' + enc(unit) + '/material-links/' + enc(visit.hash) + '/' + enc(note.id);
    panel.dataset.note = note.id;
    panel.innerHTML = '<h3>Anotações do material</h3><div class="reading-note-stack">'
      + '<button type="button" class="reading-note-paper' + (note.hasImage ? '' : ' reading-note-text') + '" title="Ir para o link de origem">'
      + (note.hasImage ? '<img src="' + endpoint + '" alt="Imagem da anotação">' : escape(note.text)) + '</button>'
      + (note.hasImage ? '<div class="reading-note-zoom" aria-hidden="true"><img src="' + endpoint + '" alt=""></div>'
        : '<div class="reading-note-text-zoom" aria-hidden="true">' + escape(note.text) + '</div>')
      + '<div class="reading-note-controls"><button type="button" aria-label="Anotação anterior" '
      + (index === 0 ? 'disabled' : '') + '>←</button><span aria-live="polite">' + (index + 1) + ' / ' + notes.length
      + '</span><button type="button" aria-label="Próxima anotação" ' + (index === notes.length - 1 ? 'disabled' : '')
      + '>→</button></div>'
      + '<div id="reading-note-actions" class="reading-note-actions">'
      + '<button type="button" class="button secondary" data-remove-note>Remover anotação</button>'
      + '<button type="button" class="button secondary" data-note-create="question">Criar pergunta</button>'
      + '<button type="button" class="button secondary" data-note-create="card">Criar cartão de memorização</button></div></div>';
    const paper = panel.querySelector('.reading-note-paper');
    paper.onclick = () => jumpToNoteSource(note, visit, visits);
    for (const button of panel.querySelectorAll('[data-note-create]')) {
      button.onclick = () => openMaterial(button.dataset.noteCreate, { origin: { id: note.id, hash: visit.hash }, note });
    }
    const [previous, next] = panel.querySelectorAll('.reading-note-controls button');
    previous.onclick = () => { draw(index - 1); panel.querySelector('.reading-note-paper').focus(); };
    next.onclick = () => { draw(index + 1); panel.querySelector('.reading-note-paper').focus(); };
    const remove = panel.querySelector('[data-remove-note]');
    remove.onclick = () => perform(async () => {
      remove.disabled = true;
      try {
        const remaining = await api(endpoint, 'DELETE', {});
        if (selected !== unit || !panel.isConnected) return;
        const activeVisits = readingView?.unit === unit ? readingView.linkVisits : visits;
        for (const [key, value] of activeVisits) {
          if (value.hash === visit.hash) activeVisits.set(key, { ...value, notes: remaining });
        }
        panel.dataset.note = notes[index + 1]?.note.id || notes[index - 1]?.note.id || '';
        paintReadingNotes(activeVisits);
        (panel.querySelector('.reading-note-paper') || $('#detail [data-tab="material"]'))?.focus();
      } finally {
        remove.disabled = false;
      }
    });
  };
  draw(Math.max(0, notes.findIndex(({ note }) => note.id === panel.dataset.note)));
}

function clipboardNoteParts(clipboard, files) {
  const html = clipboard.getData('text/html');
  const plain = clipboard.getData('text/plain');
  if (!html) return [{ text: plain }, ...files.map(file => ({ file }))];
  const template = document.createElement('template');
  template.innerHTML = html;
  const parts = [];
  let text = '';
  let fileIndex = 0;
  let foundImage = false;
  const lineBreak = /^(P|DIV|LI|UL|OL|TR|BLOCKQUOTE|H[1-6]|BR)$/;
  function walk(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.nodeValue;
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE || /^(SCRIPT|STYLE|NOSCRIPT|IFRAME)$/.test(node.tagName)) return;
    if (node.tagName === 'IMG') {
      foundImage = true;
      if (text) parts.push({ text });
      text = '';
      const image = node.getAttribute('src') || '';
      const file = files[fileIndex++];
      if (image.startsWith('data:')) parts.push({ image });
      else if (file) parts.push({ file });
      else parts.push({ missingImage: true });
      return;
    }
    if (lineBreak.test(node.tagName) && text && !text.endsWith('\n')) text += '\n';
    node.childNodes.forEach(walk);
    if (lineBreak.test(node.tagName) && text && !text.endsWith('\n')) text += '\n';
  }
  template.content.childNodes.forEach(walk);
  if (!foundImage) return [{ text: plain }, ...files.map(file => ({ file }))];
  if (text) parts.push({ text });
  parts.push(...files.slice(fileIndex).map(file => ({ file })));
  return parts;
}

function readNoteImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Não foi possível carregar a imagem.'));
    reader.readAsDataURL(file);
  });
}

function readingNoteDraft(dialog) {
  const items = [];
  let previewImage = '';
  let loading = false;
  const input = dialog.querySelector('[data-note-text]');
  const list = dialog.querySelector('[data-note-list]');
  const preview = dialog.querySelector('[data-note-preview]');
  const error = dialog.querySelector('.form-error');
  const draw = () => {
    list.innerHTML = items.map((_, i) => '<li>Anotação ' + (i + 1) + ' <button type="button" data-drop-note="' + i
      + '" aria-label="Remover anotação ' + (i + 1) + '">Remover</button></li>').join('');
    previewImage = items.findLast(note => note.image)?.image || '';
    preview.hidden = !previewImage;
    if (previewImage) preview.querySelector('img').src = previewImage;
  };
  function append(parts) {
    const notes = [];
    let text = '';
    function flushText() {
      while (text.length) {
        // Keep surrogate pairs intact while respecting the stored UTF-16 limit.
        const length = text.length > 1024 && /[\uD800-\uDBFF]/.test(text[1023]) ? 1023 : 1024;
        const chunk = text.slice(0, length);
        if (chunk.trim()) notes.push({ text: chunk, image: '' });
        text = text.slice(length);
      }
    }
    for (const part of parts) {
      if (part.image) {
        flushText();
        notes.push({ text: '', image: part.image });
      } else text += part.text || '';
    }
    flushText();
    if (items.length + notes.length > 100) throw new Error('Adicione até 100 anotações por conclusão.');
    items.push(...notes.map(note => ({ ...note, id: crypto.randomUUID() })));
    input.value = '';
    draw();
  }
  function add() {
    if (loading) throw new Error('Aguarde a prévia da imagem.');
    if (input.value.trim()) append([{ text: input.value }]);
  }
  input.addEventListener('paste', async event => {
    if (!event.clipboardData) return;
    const clipboard = event.clipboardData;
    const files = Array.from(clipboard.items || []).filter(item => item.kind === 'file' && item.type.startsWith('image/'))
      .map(item => item.getAsFile()).filter(Boolean);
    const images = files.length ? files : Array.from(clipboard.files || []).filter(file => file.type.startsWith('image/'));
    const parts = clipboardNoteParts(clipboard, images);
    if (!parts.some(part => part.image || part.file || part.missingImage)) return;
    event.preventDefault();
    if (loading) return;
    const before = input.value.slice(0, input.selectionStart);
    const after = input.value.slice(input.selectionEnd);
    error.textContent = '';
    loading = input.readOnly = true;
    try {
      const resolved = await Promise.all(parts.map(async part => {
        if (part.file && part.file.size > 512 * 1024) return { missingImage: true };
        const image = part.file ? await readNoteImage(part.file).catch(() => '') : part.image;
        if (part.file || part.image) {
          return image && image.length <= 699100 && /^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(image)
            ? { image } : { missingImage: true };
        }
        return part;
      }));
      append([{ text: before }, ...resolved, { text: after }]);
      if (resolved.some(part => part.missingImage)) {
        error.textContent = 'Uma ou mais imagens não vieram na colagem em PNG, JPEG, GIF ou WebP de até 512 KB.';
      }
    } catch (problem) {
      error.textContent = problem.message;
    } finally {
      loading = input.readOnly = false;
    }
  });
  preview.onclick = () => noteImage(previewImage);
  dialog.querySelector('[data-add-note]').onclick = () => {
    try { add(); error.textContent = ''; }
    catch (problem) { error.textContent = problem.message; }
  };
  list.onclick = event => {
    const remove = event.target.closest('[data-drop-note]');
    if (!remove) return;
    items.splice(Number(remove.dataset.dropNote), 1);
    draw();
  };
  return () => { add(); return items; };
}

function paintReadingLinks() {
  if (!readingView) return;
  paintReadingNotes(readingView.linkVisits);
  if (tab !== 'material') return;
  for (const anchor of document.querySelectorAll('#unit-body [data-reading-link]')) {
    const record = readingView.linkVisits.get(linkVisitKey(readingView.page, anchor.href));
    const badge = anchor.querySelector('.material-link-state');
    badge.hidden = !record?.completedAt;
    if (record?.completedAt) {
      const seconds = Math.round((record.completedAt - record.startedAt) / 1000);
      badge.title = seconds >= 60 ? Math.floor(seconds / 60) + ' min ' + seconds % 60 + ' s' : seconds + ' s';
    }
  }
}

function readingDialog(title, body, actions, { inlineActions = false } = {}) {
  const dialog = $('#external-reading-dialog');
  const heading = '<h2 id="external-reading-title">' + escape(title) + '</h2>';
  const controls = '<div class="dialog-actions external-reading-actions"></div>';
  dialog.innerHTML = (inlineActions ? '<header class="reading-completion-heading">' + heading + controls + '</header>' : heading)
    + body + '<p class="form-error" role="alert"></p>' + (inlineActions ? '' : controls);
  const container = dialog.querySelector('.external-reading-actions');
  for (const action of actions) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'button ' + (action.primary ? 'primary' : 'secondary');
    button.textContent = action.label;
    button.addEventListener('click', () => perform(() => action.run(dialog, button)));
    container.append(button);
  }
  if (!dialog.open) dialog.showModal();
  else container.firstElementChild?.focus();
  return dialog;
}

function nextUnreadLink(unit, page, after) {
  const links = materialPageLinks(unit, page).filter(link => link.kind === 'link');
  const index = after ? links.findIndex(link => link.url === after.url) + 1 : 0;
  return [...links.slice(index), ...links.slice(0, index)]
    .find(link => !readingView.linkVisits.get(linkVisitKey(page, link.url))?.completedAt);
}

function offerPractice(unit) {
  const actions = [{ label: 'Agora não', run: dialog => dialog.close() }];
  if (unit.questions.length) actions.push({
    label: 'Responder perguntas', primary: true,
    run: dialog => {
      dialog.close();
      tab = 'quiz';
      renderUnitBody();
      updateRoute();
    },
  });
  if (unit.cards.length) actions.push({
    label: 'Revisar cartões de memorização', primary: !unit.questions.length,
    run: dialog => {
      dialog.close();
      const detail = $('#detail');
      detail.addEventListener('close', () => {
        navigate('review');
        startReview(unit.deck, unit.id);
      }, { once: true });
      detail.close();
    },
  });
  readingDialog('Material concluído', actions.length > 1
    ? '<p>Você concluiu todas as páginas e leituras externas. Como quer praticar agora?</p>'
    : '<p>Você concluiu todas as páginas e leituras externas.</p>', actions);
}

function continueReading(unit, after) {
  const current = readingView;
  if (!current || current.unit !== unit.id) return;
  const link = nextUnreadLink(unit, current.page, after);
  if (link) {
    confirmExternalReading(unit, link, Boolean(after));
    return;
  }
  const pages = materialPages(unit);
  const index = pages.findIndex(page => page.id === current.page);
  const visited = new Set(current.progress?.visited || []);
  const following = pages[index + 1];
  const next = following || pages.find(page => page.id !== current.page
    && (!visited.has(page.id) || nextUnreadLink(unit, page.id)));
  if (!next) {
    offerPractice(unit);
    return;
  }
  const label = following ? 'Próxima página' : 'Página pendente';
  const message = following
    ? 'Você concluiu todos os links desta página. Quer avançar para a próxima?'
    : 'Ainda há material em outra página. Quer abrir essa página agora?';
  readingDialog(label, '<p>' + message + '</p><p>' + escape(next.title) + '</p>', [
    { label: 'Ficar nesta página', run: dialog => dialog.close() },
    { label: following ? 'Avançar' : 'Abrir página', primary: true, run: dialog => {
      dialog.close();
      selectReadingPage(next.id);
    } },
  ]);
}

function confirmExternalReading(unit, link, next = false) {
  const view = readingView;
  const page = view.page;
  const location = '<p class="external-reading-address">' + escape(link.label || link.url) + '</p>';
  readingDialog(next ? 'Próximo material externo' : 'Abrir material externo?',
    '<p>Você será direcionado a um material externo em outra aba. Ao terminar, feche essa aba e volte aqui. Deixe as próximas leituras para o Recall.md.</p>'
    + '<p>Ao voltar, diga se completou o material para seguir para a próxima leitura.</p>' + location,
    [{ label: 'Cancelar', run: dialog => dialog.close() }, { label: 'Abrir material', primary: true,
      run: () => {
        const startedAt = Date.now();
        window.open(link.url, '_blank', 'noopener,noreferrer');
        const saveResponse = completed => async (dialog, button) => {
          if (button.disabled) return;
          const controls = [...dialog.querySelectorAll('.external-reading-actions button')];
          controls.forEach(control => { control.disabled = true; });
          try {
            const notes = collectNotes();
            if (!completed && !notes.length) {
              dialog.close();
              return;
            }
            const saved = await api('/api/units/' + enc(unit.id) + '/material-links', 'POST',
              { page, url: link.url, startedAt, notes, completed });
            if (notes.length) {
              const savedIds = new Set(saved.notes?.map(note => note.id));
              if (!notes.every(note => savedIds.has(note.id))) {
                throw new Error('O servidor não confirmou as anotações. Abra a versão atualizada do Recall.md antes de tentar novamente.');
              }
            }
            if (readingView !== view || !dialog.open) return;
            const identity = materialLinkIdentity(link);
            for (const item of materialPages(unit)) {
              for (const related of materialPageLinks(unit, item.id)) {
                if (materialLinkIdentity(related) === identity) {
                  view.linkVisits.set(linkVisitKey(item.id, related.url), { ...saved, page: item.id, url: related.url });
                }
              }
            }
            paintReadingLinks();
            if (completed) continueReading(unit, link);
            else {
              dialog.close();
              toast('Anotações salvas.');
            }
          } catch (error) {
            dialog.querySelector('.form-error').textContent = error.message;
          } finally {
            controls.forEach(control => { control.disabled = false; });
          }
        };
        const dialog = readingDialog('Você concluiu o material?', '<p>Depois de terminar a leitura, feche a aba externa e volte aqui.</p>'
          + location + '<p><a href="' + escape(link.url) + '" target="_blank" rel="noopener noreferrer">Reabrir material</a></p>'
          + '<fieldset><legend>Anotações</legend><p id="note-instructions">Inclua aqui suas anotações. Elas ficarão associadas ao material de referência.</p>'
          + '<label>Texto da anotação<textarea data-note-text aria-describedby="note-instructions" maxlength="1024" rows="3"></textarea></label>'
          + '<p>Cole texto com imagens no campo. Cada trecho e imagem vira uma anotação, na ordem da colagem.</p>'
          + '<button type="button" data-note-preview hidden aria-label="Ampliar prévia da imagem"><img alt="Prévia da imagem"></button>'
          + '<button type="button" class="button secondary" data-add-note>Adicionar anotação</button><ul data-note-list></ul></fieldset>',
          [{ label: 'Não concluí', run: saveResponse(false) },
           { label: 'Concluí', primary: true, run: saveResponse(true) }], { inlineActions: true });
        const collectNotes = readingNoteDraft(dialog);
      },
    }]);
}

document.addEventListener('click', event => {
  const anchor = event.target.closest('#unit-body a[data-reading-link]');
  if (!anchor) return;
  event.preventDefault();
  const unit = state.units.find(item => item.id === selected);
  const link = unit && readingView && materialPageLinks(unit, readingView.page).find(item => item.url === anchor.href);
  if (link) confirmExternalReading(unit, link);
});

document.addEventListener('change', event => {
  if (event.target.id === 'material-page-select') selectReadingPage(event.target.value);
});

function feedbackStatus(correct, assessed) {
  const message = correct === true ? '✓ Correta' : correct === false ? '↻ Retomar este conceito' : 'Compare sua resposta com a referência';
  return message + (assessed ? ' · autoavaliação' : '');
}

function refreshAssessmentFeedback(attemptId, questionId) {
  for (const row of document.querySelectorAll('#unit-body [data-result-attempt]')) {
    const { resultAttempt, resultQuestion } = row.dataset;
    if (attemptId && (resultAttempt !== attemptId || resultQuestion !== questionId)) continue;
    const attempt = state.attempts.find(item => item.id === resultAttempt);
    const result = attempt?.results.find(item => item.question === resultQuestion);
    if (!result) continue;
    const assessment = assessmentFor(attempt, result);
    const correct = result.correct ?? assessment?.correct;
    row.classList.toggle('wrong', correct === false);
    row.querySelector('[data-result-status]').textContent = feedbackStatus(correct, assessment);
  }
}

async function assessAnswer(button) {
  const { assess: attempt, question, correct } = button.dataset;
  const buttons = button.closest('[data-result-attempt]').querySelectorAll('[data-assess]');
  if (button.disabled) return;
  for (const control of buttons) control.disabled = true;
  try {
    const saved = await api('/api/attempts/' + enc(attempt) + '/assess', 'POST', { question, correct: correct === 'true' });
    if (!state.assessments.some(item => item.id === saved.id)) {
      state = { ...state, assessments: [...state.assessments, saved] };
    }
    refreshAssessmentFeedback(attempt, question);
    toast('Autoavaliação registrada.');
  } finally {
    for (const control of buttons) control.disabled = false;
  }
}

function feedback(a) {
  return a.results.map(r => {
    const assessed = assessmentFor(a, r);
    const correct = r.correct ?? assessed?.correct;
    return `<div class="result ${correct === false ? 'wrong' : ''}" data-result-attempt="${escape(a.id)}" data-result-question="${escape(r.question)}"><strong>${escape(r.prompt)}</strong><p data-result-status aria-live="polite">${feedbackStatus(correct, assessed)}</p><p>Sua resposta: ${escape(r.options ? r.options[r.answer] : r.answer)}</p><p>Referência: ${escape(r.reference)}</p>${r.explanation ? `<p>${escape(r.explanation)}</p>` : ''}<div class="question-actions">${r.type === 'text' ? `<button class="button secondary" data-assess="${escape(a.id)}" data-question="${escape(r.question)}" data-correct="true">Entendi corretamente</button><button class="button secondary" data-assess="${escape(a.id)}" data-question="${escape(r.question)}" data-correct="false">Preciso retomar</button>` : ''}<button class="button secondary" data-from-question="${escape(r.question)}" data-owner="${escape(a.unit)}">Criar cartão de memorização do gabarito atual</button></div></div>`;
  }).join('');
}
async function updateUnitMilestone(deckField, unit) {
  const form = deckField.form;
  const target = form.querySelector('[data-unit-milestone]');
  const deck = deckField.value.trim();
  const request = Symbol('deck request');
  target.request = request;
  target.innerHTML = '';
  const submit = form.querySelector('button[type=submit]');
  submit.disabled = true;
  try {
    const { required, options } = await api(`/api/schedule/unit-milestones?deck=${enc(deck)}`);
    if (target.request !== request) return;
    const mustChoose = required && (!unit || unit.deck !== deck);
    if (!options.length && !mustChoose) return;
    if (!options.length) {
      target.textContent = 'Defina um capítulo no cronograma antes de adicionar uma ficha de conteúdo a este plano de estudo.';
      return;
    }
    target.innerHTML = `<label>Capítulo do cronograma<select name="milestoneId" ${mustChoose ? 'required' : ''}>
      <option value="">Selecione um capítulo</option>${options.map(item => `<option value="${escape(item.id)}" ${item.id === unit?.milestoneId ? 'selected' : ''}>${escape(item.name)}</option>`).join('')}
    </select></label>`;
  } catch (error) {
    if (target.request === request) target.textContent = error.message;
  } finally {
    if (target.request === request) submit.disabled = false;
  }
}

async function addCardFromQuestion(unit, question) {
  await api(`/api/units/${enc(unit)}/cards`, 'POST', { question });
  await load();
  await openUnit(unit, true);
  toast('Cartão de memorização criado a partir do gabarito atual.');
}

function originNoteButton(origin) {
  return origin ? '<button class="button secondary" type="button" data-note-origin="' + escape(origin.id)
    + '" data-note-hash="' + escape(origin.hash) + '">Ver anotação de origem</button>' : '';
}

function noteReference(unit, origin, note) {
  const image = note.hasImage ? '/api/units/' + enc(unit) + '/material-links/' + enc(origin.hash) + '/' + enc(note.id) : '';
  return '<section class="note-reference" aria-label="Anotação de origem"><strong>Anotação de origem</strong>'
    + (image ? '<button type="button" data-reference-image="' + escape(image)
      + '" aria-label="Ampliar anotação de origem"><img src="' + escape(image) + '" alt="Imagem da anotação de origem"></button>'
      : '<div class="prose">' + escape(note.text) + '</div>') + '</section>';
}

async function showNoteOrigin(button) {
  const unit = selected;
  const origin = { id: button.dataset.noteOrigin, hash: button.dataset.noteHash };
  const visits = await api('/api/units/' + enc(unit) + '/material-links');
  if (selected !== unit || !button.isConnected) return;
  const note = visits.find(visit => visit.hash === origin.hash)?.notes?.find(note => note.id === origin.id);
  readingDialog('Origem do material de estudo', note ? noteReference(unit, origin, note)
    : '<p>A anotação de origem foi removida.</p>', [{ label: 'Fechar', run: dialog => dialog.close() }]);
}

function openMaterial(type, reference) {
  setRouteOverlay(type === 'question' ? 'nova-questao' : 'novo-cartao-de-memorizacao');
  materialType = type; const form = $('#material-form'); form.reset(); form.querySelector('.form-error').textContent = '';
  form.querySelector('.dialog-actions button:last-child').disabled = false;
  $('#material-heading').textContent = type === 'question' ? 'Nova questão' : 'Novo cartão de memorização';
  $('#material-fields').innerHTML = type === 'question' ? `<label>Formato<select name="type" id="question-type"><option value="choice">Múltipla escolha</option><option value="text">Texto livre</option></select></label><label>Enunciado<textarea name="prompt" rows="2" required></textarea></label><div id="choice-fields"><label>Alternativas (uma por linha)<textarea name="options" rows="4" placeholder="Primeira alternativa&#10;Segunda alternativa"></textarea></label><label>Número da alternativa correta<input name="choiceAnswer" type="number" min="1" value="1"></label></div><label id="text-answer-label" hidden>Resposta de referência<textarea name="textAnswer" rows="3"></textarea></label><label>Explicação<textarea name="explanation" rows="2"></textarea></label><label>Fonte<input name="source" placeholder="Arquivo, revisão ou referência"></label>` : `<label>Frente<textarea name="front" rows="3" required></textarea></label><label>Verso<textarea name="back" rows="3" required></textarea></label><label>Plano de estudo<input name="deck" required value="${escape(state.units.find(u => u.id === selected).deck)}"></label><label>Fonte<input name="source"></label>`;
  if (reference) $('#material-fields').insertAdjacentHTML('afterbegin', noteReference(selected, reference.origin, reference.note));
  form.noteOrigin = reference?.origin;
  $('#question-type')?.addEventListener('change', e => { $('#choice-fields').hidden = e.target.value !== 'choice'; $('#text-answer-label').hidden = e.target.value !== 'text'; });
  $('#material-editor').showModal();
}
$('#material-form').addEventListener('submit', async e => {
  e.preventDefault(); const f = Object.fromEntries(new FormData(e.target));
  const origin = e.target.noteOrigin ? { noteOrigin: e.target.noteOrigin } : {};
  try {
    const u = await api(`/api/units/${enc(selected)}/edit`);
    let patch;
    if (materialType === 'question') { const question = { ...origin, type: f.type, prompt: f.prompt, answer: f.type === 'choice' ? Number(f.choiceAnswer) - 1 : f.textAnswer, explanation: f.explanation, ...(f.source ? { source: f.source } : {}), ...(f.type === 'choice' ? { options: f.options.split('\n').map(s => s.trim()).filter(Boolean) } : {}) }; patch = { questions: [...u.questions, question], version: u.version }; }
    else patch = { cards: [...u.cards, { ...origin, front: f.front, back: f.back, deck: f.deck, ...(f.source ? { source: f.source } : {}) }], version: u.version };
    const result = await api(`/api/units/${enc(selected)}`, 'PATCH', patch); $('#material-editor').close(); await load(); await openUnit(selected, true); toast(result.warning || 'Material adicionado.');
  } catch (err) { e.target.querySelector('.form-error').textContent = err.message; }
});
function reviewHome() {
  $('#view').innerHTML = heading('Volte para lembrar', 'Reencontre seus conceitos, um cartão de cada vez.') + `<div class="deck-grid">${decks().map(d => {
    const cards = state.cards.filter(c => c.deck === d), count = cards.filter(due).length;
    return `<button class="deck-card" data-review-deck="${escape(d)}"><span class="stat-icon">▱</span><h3>${escape(d)}</h3><small>${cards.length} cartões · ${count} para revisar</small><p class="muted">Revisar deck →</p></button>`;
  }).join('') || '<div class="empty">Seus planos de estudo aparecerão quando você criar fichas de conteúdo e cartões de memorização.</div>'}</div>`;
}
function startReview(deck, unit = '') { reviewPlan = deck; reviewUnit = unit; updateRoute(); reviewActive = true; reviewCards = state.cards.filter(c => unit ? c.unit === unit : c.deck === deck && due(c)); reviewIndex = 0; showReview(); }
function showReview() {
  queueMicrotask(() => study?.focus(studyContext(), true).catch(e => toast(e.message)));
  if (reviewIndex >= reviewCards.length) { $('#view').innerHTML = heading('Revisão em dia', 'Os cartões desta sessão foram revisados.') + `<div class="review-box"><div class="flashcard"><span class="eyebrow">ATÉ A PRÓXIMA</span><p>${reviewCards.length ? 'Mais uma etapa para lembrar melhor.' : 'Nenhum cartão pendente neste plano de estudo.'}</p><small>Você pode voltar ao material quando precisar.</small></div><button class="button primary" data-page="review">Voltar aos planos de estudo</button></div>`; return; }
  const c = reviewCards[reviewIndex];
  $('#view').innerHTML = heading(escape(c.deck), `${reviewIndex + 1} de ${reviewCards.length} cartões nesta sessão`, '<button class="button secondary" data-page="review">Encerrar revisão</button>') + `<div class="review-box"><small>${escape(c.title)}</small><div class="flashcard"><span class="eyebrow">TENTE LEMBRAR ANTES DE REVELAR</span><p>${escape(c.front)}</p><div id="card-back" class="back" hidden>${escape(c.back)}</div></div><button class="button primary" id="reveal">Mostrar resposta</button><div id="ratings" class="ratings" hidden>${[['again', 'Repetir', '10 minutos'], ['hard', 'Difícil', '1 dia'], ['good', 'Lembrei', `${Math.max(2, c.interval * 2)} dias`], ['easy', 'Fácil', `${Math.max(4, c.interval * 3)} dias`]].map(([value, label, interval]) => `<button class="button secondary" data-rating="${value}">${label}<small>${interval}</small></button>`).join('')}</div></div>`;
  $('#reveal').addEventListener('click', () => { $('#card-back').hidden = false; $('#ratings').hidden = false; $('#reveal').hidden = true; study?.record(studyContext(), 'flashcard_revealed').catch(e => toast(e.message)); });
}
function history() {
  $('#view').innerHTML = heading('Seu caminho até aqui', 'Tentativas registradas para acompanhar o que você está aprendendo.') + `<div class="panel">${[...state.attempts].reverse().map(a => `<div class="history-item"><div><strong>${escape(state.units.find(u => u.id === a.unit)?.title || a.unit)}</strong><small>${new Date(a.created).toLocaleString('pt-BR')} · ${a.results.length} questões</small></div><button class="button secondary" data-history-unit="${escape(a.unit)}">Ver tentativa ↗</button></div>`).join('') || '<div class="empty">Responda ao primeiro quiz para começar seu histórico.</div>'}</div>`;
}
function openReadingEditor() {
  const unit = state.units.find(item => item.id === selected);
  if (!unit) return;
  setRouteOverlay('editar-material');
  editReading($('#reading-editor'), unit, async pages => {
    await api('/api/units/' + enc(unit.id), 'PATCH', { material: pages, version: unit.version });
    await load();
    if (selected === unit.id && tab === 'material') renderUnitBody();
  });
}

async function openBoardChapter() {
  const snapshot = await api('/api/schedule');
  if (page !== 'board') return;
  setRouteOverlay('novo-capitulo');
  milestoneEditor(null, snapshot);
  $('#board-phase-editor').showModal();
  watchRouteDialog($('#board-phase-editor'), 'novo-capitulo');
}

document.addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  perform(async () => {
    if (b.classList.contains('close-dialog')) {
      const dialog = b.closest('dialog');
      if (dialog.id === 'detail') closeStudyDetail();
      else dialog.close();
      return;
    }
    if (b.dataset.page) { navigate(b.dataset.page); return; }
    if (b.dataset.boardDeck) { navigate('board', b.dataset.boardDeck); return; }
    if (b.dataset.deckAction) {
      const { deckAction: action, deckName: name } = b.dataset;
      if (action === 'create' || action === 'remove') openDeckDialog(action, name);
      else {
        await saveDeck(action, name);
        [...document.querySelectorAll('[data-board-deck]')].find(button => button.dataset.boardDeck === name)?.focus();
      }
      return;
    }
    if (b.dataset.removeSchedule) { openRemoveSchedule(b.dataset.removeSchedule); return; }
    if ('viewSchedule' in b.dataset) {
      setRouteOverlay('agenda', b.dataset.viewSchedule);
      await openSavedSchedule(b.dataset.viewSchedule, 'boardSchedule' in b.dataset);
    }
    if (b.dataset.action === 'create' || b.dataset.createStatus) openEditor(null, b.dataset.createStatus);
    if (b.dataset.unit) await openUnit(b.dataset.unit);
    if ('nextBoardCard' in b.dataset) await openNextBoardCard();
    if (b.dataset.tab) { tab = b.dataset.tab; renderUnitBody(); updateRoute(); await study?.record(studyContext(), `tab:${tab}`); }
    if (b.dataset.materialPage) selectReadingPage(b.dataset.materialPage);
    if (b.dataset.playMaterial) playMaterial(b);
    if (b.dataset.referenceImage) noteImage(b.dataset.referenceImage);
    if (b.dataset.noteOrigin) await showNoteOrigin(b);
    if ('finishReading' in b.dataset) {
      const unit = state.units.find(item => item.id === selected);
      const view = readingView;
      if (unit && view) {
        await view.linksReady;
        if (readingView !== view) return;
        view.progress = reading.visit(unit.id, view.page, materialPages(unit).map(page => page.id));
        continueReading(unit);
      }
    }
    if ('editReading' in b.dataset) openReadingEditor();
    if (b.dataset.action === 'edit-unit') openEditor(await api('/api/units/' + enc(selected) + '/edit'));
    if ('newBoardPhase' in b.dataset) await openBoardChapter();
    if (b.dataset.action === 'add-question') openMaterial('question');
    if (b.dataset.action === 'add-card') openMaterial('card');
    if (b.dataset.action === 'sync') { await api(`/api/units/${enc(selected)}/sync`, 'POST', {}); await load(); await openUnit(selected, true); toast('Links criados.'); }
    if (b.dataset.assess) await assessAnswer(b);
    if (b.dataset.fromQuestion) await addCardFromQuestion(b.dataset.owner, b.dataset.fromQuestion);
    if (b.dataset.reviewDeck) startReview(b.dataset.reviewDeck);
    if (b.dataset.rating) { const c = reviewCards[reviewIndex]; b.disabled = true; try { await api(`/api/units/${enc(c.unit)}/reviews`, 'POST', { card: c.id, rating: b.dataset.rating }); reviewIndex++; await load(); showReview(); } finally { b.disabled = false; } }
    if (b.dataset.historyUnit) { tab = 'history'; await openUnit(b.dataset.historyUnit, true); }
  });
});
$('#detail').addEventListener('close', () => {
  if (restoringRoute || ignoredRouteCloses.has($('#detail')) || $('#detail').open) return;
  captureQuizDraft();
  selected = null;
  readingView = null;
  linkedReadingPage = routeOverlay = routeOverlayId = '';
  render();
  updateRoute(true);
  study?.focus(studyContext()).catch(e => toast(e.message));
});
for (const [type, id] of Object.entries(routeDialogIds)) {
  const dialog = document.getElementById(id);
  if (dialog) watchRouteDialog(dialog, type);
}
window.addEventListener('keydown', event => {
  if (event.key !== 'Escape' || !study || !$('#detail').open || document.querySelector('dialog:modal')) return;
  closeStudyDetail();
});
window.addEventListener('popstate', () => perform(restoreRoute));
await perform(load);

function studyActionLabel(action) {
  const [type,target] = action.split(':');
  if (type === 'move') return `Estado alterado para ${target}`;
  if (type === 'tab') return `Aba ${ {material:'Material',quiz:'Quiz',cards:'Flashcards',history:'Tentativas'}[target] || 'de estudo' } aberta`;
  return {open:'Card aberto',close:'Card fechado',hidden:'Visualização pausada',visible:'Visualização retomada',close_inferred:'Fechamento estimado',quiz_completed:'Quiz enviado',unit_saved:'Card salvo',questions_saved:'Questões atualizadas',cards_saved:'Flashcards atualizados',flashcard_revealed:'Resposta do flashcard revelada',flashcard_rated:'Flashcard avaliado',flashcard_created:'Flashcard criado',quiz_assessed:'Resposta autoavaliada',links_synced:'Vínculo atualizado'}[type] || 'Ação registrada';
}
let studyViewMode = 'sessions', studyViewId = null;
const studyDuration = ms => {const sec=Math.floor(ms/1000);return `${Math.floor(sec/3600)}h ${Math.floor(sec/60)%60}m ${sec%60}s`;};
function studyHref(unitId, tabName = 'material', cardId = null) {
  return `#study/${enc(unitId)}/${tabName}${cardId ? '?card='+enc(cardId) : ''}`;
}
function activityLink(unitId, title, tabName = 'material', cardId = null) {
  const available = state.units.some(u=>u.id===unitId) && (!cardId || state.cards.some(c=>c.unit===unitId && c.id===cardId));
  return available ? `<a class="button secondary" data-study-link href="${studyHref(unitId,tabName,cardId)}">${escape(title)} ↗</a>` : `<span class="muted">${escape(title)} — atividade indisponível</span>`;
}
function savedEntityHtml(unitId, entity, kind) {
  return `<article class="content-card"><h3>${escape(entity.title)}</h3><p><strong>${studyDuration(entity.durationMs)}</strong> · ${entity.actions.open?.length||0} aberturas · ${entity.actions.close?.length||0} fechamentos</p>${activityLink(unitId,'Voltar à atividade','material',kind==='flashcard'?entity.id:null)}<dl>${Object.entries(entity.actions).map(([action,times])=>`<dt>${escape(studyActionLabel(action))}</dt><dd>${times.map(t=>new Date(t).toLocaleString('pt-BR')).join('<br>')}${activityLink(unitId,'Abrir contexto',action.startsWith('quiz')?'history':action.startsWith('flashcard')?'cards':'material',kind==='flashcard'?entity.id:null)}</dd>`).join('')}</dl></article>`;
}
async function sessionsView() {
  const records = await api('/api/sessions'); if(page!=='sessions')return;
  const current=records.find(s=>s.id===studyViewId);
  const tabs=`<div class="tabs"><button type="button" class="tab ${studyViewMode==='sessions'?'active':''}" data-study-mode="sessions">Sessões de estudos</button><button type="button" class="tab ${studyViewMode==='time'?'active':''}" data-study-mode="time">Tempo de estudo</button></div>`;
  const details = s => `<section class="panel"><h2>${new Date(s.startedAt).toLocaleString('pt-BR')}</h2><p>Encerramento: ${new Date(s.endedAt).toLocaleString('pt-BR')} · ${escape({manual:'Manual',inactivity:'Inatividade',limit:'Limite de 8 horas'}[s.reason]||s.reason)}</p>${Object.entries(s.decks).map(([name,d])=>`<h3>Deck ${escape(name)} · ${studyDuration(d.durationMs)}</h3>${Object.entries(d.cards).map(([id,e])=>savedEntityHtml(id,e,'card')).join('')}${Object.entries(d.flashcards).map(([key,e])=>{const [unitId,id]=JSON.parse(key);return savedEntityHtml(unitId,{...e,id},'flashcard');}).join('')}`).join('')||'<p>Nenhum card alcançou 10 segundos nesta sessão.</p>'}</section>`;
  $('#view').innerHTML=heading(studyViewMode==='time'?'Tempo de estudo':'Sessões de estudos','Registros confirmados. O tempo pertence aos cards; as ações têm horários.')+tabs+(studyViewMode==='time'? records.map(details).join('') : current?`<button type="button" class="button secondary" data-study-session="">Voltar à lista</button>${details(current)}`:`<div class="panel">${records.map(s=>`<div class="history-item"><div><strong>${new Date(s.startedAt).toLocaleString('pt-BR')}</strong><small>${Object.keys(s.decks).length} decks · ${escape({manual:'Manual',inactivity:'Inatividade',limit:'Limite de 8 horas'}[s.reason]||s.reason)}</small></div><button type="button" class="button secondary" data-study-session="${escape(s.id)}">Ver sessão</button></div>`).join('')||'<p>Nenhuma sessão salva. Registros provisórios e descartados não aparecem aqui.</p>'}</div>`);
  if(studyViewMode==='time'&&!records.length)$('#view').insertAdjacentHTML('beforeend','<div class="empty">Nenhum tempo de estudo confirmado.</div>');
}
async function routeStudy() {
  const match=/^#study\/([^/]+)\/(material|quiz|cards|history)(?:\?card=([^&]+))?$/.exec(location.hash);
  if(!match)return;
  const id=decodeURIComponent(match[1]),u=state.units.find(u=>u.id===id);
  if(!u){toast('Esta unidade não está mais disponível.');return;}
  if($('#detail').open)$('#detail').close();
  if(match[3]) {
    const card=state.cards.find(c=>c.unit===id&&c.id===decodeURIComponent(match[3]));
    if(!card){toast('Este flashcard não está mais disponível.');return;}
    page='review';selected=null;reviewActive=true;reviewCards=[card];reviewIndex=0;render();showReview();
    $('#breadcrumb').textContent='Flashcards';
  } else {navigate('board');tab=match[2];await openUnit(id,true);}
}
document.addEventListener('click',e=>{
  const link=e.target.closest('a[data-study-link]');
  if(link){e.preventDefault();window.history.replaceState(null,'',link.getAttribute('href'));perform(routeStudy);return;}
  const mode=e.target.closest('[data-study-mode]'),record=e.target.closest('[data-study-session]');
  if(mode){studyViewMode=mode.dataset.studyMode;perform(sessionsView);}
  if(record){studyViewId=record.dataset.studySession||null;perform(sessionsView);}
});
window.addEventListener('hashchange',()=>perform(routeStudy));

function unitContext(u) { return { kind: 'card', id: u.id, unitId: u.id, title: u.title, deck: u.deck }; }
function studyContext() {
  if (selected && $('#detail').open) { const u = state.units.find(u => u.id === selected); return u && unitContext(u); }
  if (reviewActive && reviewCards[reviewIndex]) { const c = reviewCards[reviewIndex]; return { kind: 'flashcard', id: c.id, unitId: c.unit, title: c.front.slice(0,500), deck: c.deck }; }
  return null;
}
document.addEventListener('toggle', e => { if (e.target.dataset?.studyCard && e.target.open) study?.record(studyContext(), `flashcard_revealed:${e.target.dataset.studyCard}`).catch(e => toast(e.message)); }, true);
if (globalThis.indexedDB && state?.projectId) await perform(async () => {
  const { setupStudyUI } = await import('/study-ui.js');
  study = await setupStudyUI({ projectId: state.projectId, getContext: studyContext, toast, api, labelAction: studyActionLabel, onSaved: () => { if (page === 'sessions') perform(sessionsView); } });
});
if (!globalThis.indexedDB && state?.projectId) toast('Registro de sessão indisponível: este navegador não oferece IndexedDB. O estudo continua disponível.');
setInterval(synchronizeView, 1000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') synchronizeView(); });
window.addEventListener('focus', synchronizeView);

if (state) await perform(async () => {
  await restoreRoute();
  await restoreDevSession();
  await routeStudy();
});

function clearGantt(root) {
  for (const [host, unmount] of chartUnmounts) {
    if (root && !root.contains(host)) continue;
    unmount();
    chartUnmounts.delete(host);
  }
}

function loadGanttAssets() {
  if (ganttAssets) return ganttAssets;
  const css = document.createElement('link');
  css.rel = 'stylesheet';
  css.href = '/schedule-flow.css';
  const styled = new Promise((resolve, reject) => {
    css.addEventListener('load', resolve, { once: true });
    css.addEventListener('error', () => reject(new Error('CSS do Gantt indisponível.')), { once: true });
  });
  document.head.append(css);
  ganttAssets = Promise.all([styled, import('/schedule-flow.js')]).then(([, module]) => module)
    .catch(error => {
      css.remove();
      ganttAssets = undefined;
      throw error;
    });
  return ganttAssets;
}

async function renderGantt(host, props) {
  try {
    const { mountGantt } = await loadGanttAssets();
    if (!host.isConnected || host.closest('dialog:not([open])') || chartUnmounts.has(host)) return;
    chartUnmounts.set(host, mountGantt(host, props));
  } catch (error) {
    console.error('Falha ao montar o Gantt.', error);
    if (host.isConnected) host.textContent = 'Gantt indisponível. Consulte a lista de sessões para ver os horários.';
  }
}

function scheduleStrip(schedules, units) {
  if (!schedules.length) return '';
  const data = state.schedule;
  const slots = boardSessions(data).filter(boardSlotFilter(schedules, units));
  const dates = [...slots.map(slot => slot.date), ...schedules.flatMap(item => [item.startDate, item.deadline])].filter(Boolean).sort();
  const first = Date.parse(dates[0]);
  const last = Date.parse(dates.at(-1));
  const span = 1 + (last - first) / 86_400_000;
  const now = Date.now();
  const missed = slots.filter(slot => sessionStatus(slot, now) === 'missed');
  const missedDays = new Set(missed.map(slot => slot.date));
  const firstDays = Array.from({ length: Math.min(span, 10) }, (_, index) =>
    new Date(first + index * 86_400_000).toISOString().slice(0, 10));
  const days = [...new Set([...firstDays, ...missedDays])].sort();
  const dateLabel = day => day.slice(5).split('-').reverse().join('/');
  return `<div class="schedule-strip" aria-label="Cronograma de estudo">
    <table aria-label="Sessões por cronograma e data">
      <thead><tr><th scope="col">Cronograma</th>${days.map(day => {
        const late = missedDays.has(day);
        const label = `Filtrar por ${dateLabel(day)}/${day.slice(0, 4)}${late ? ', com atraso' : ''}`;
        const weekday = new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', weekday: 'short' }).format(new Date(day));
        return `<th scope="col"><button type="button" class="schedule-day${late ? ' schedule-day-missed' : ''}"
          data-board-day="${day}" aria-pressed="${day === boardDay}" aria-controls="board" aria-label="${label}">
          ${dateLabel(day)}<small>${escape(weekday)}</small></button></th>`;
      }).join('')}</tr></thead>
      <tbody>${schedules.map(item => `<tr>
        <th scope="row"><button class="schedule-link" type="button" data-view-schedule="${escape(item.id)}" aria-haspopup="dialog">${escape(item.name)}</button></th>${days.map(day => {
          const count = slots.filter(slot => slot.date === day && slot.schedules.includes(item.id)).length;
          const late = missed.some(slot => slot.date === day && slot.schedules.includes(item.id));
          const label = `${count} sessões${late ? ', com atraso' : ''}`;
          return `<td>${count ? `<span class="gantt-bar${late ? ' gantt-bar-missed' : ''}" title="${label}"><span class="schedule-sr">${label}</span></span>` : ''}</td>`;
        }).join('')}</tr>`).join('')}</tbody>
    </table>${span > days.length ? `<small>+${span - days.length} dias</small>` : ''}
  </div>`;
}



function scheduleWindow(window = {}) {
  return `<div class="schedule-row">
    <label>Dia<select name="day">${weekDays.map((day, i) => `<option value="${i}" ${i === window.day ? 'selected' : ''}>${day}</option>`).join('')}</select></label>
    <label>Início<input name="start" type="time" required value="${escape(window.start || '09:00')}"></label>
    <label>Fim<input name="end" required pattern="(?:[01][0-9]|2[0-3]):[0-5][0-9]|24:00" value="${escape(window.end || '10:00')}"></label>
    <button type="button" class="button secondary" data-remove-row>Remover</button>
  </div>`;
}

function groupKey(group) {
  return group ? JSON.stringify([group.type, group.id]) : '';
}

function scheduleGroup(group) {
  const selected = groupKey(group);
  const options = scheduleView.groupOptions || [];
  return `<div class="schedule-row schedule-content-row">
    <label>Plano de estudo ou capítulo<select name="group" required><option value="">Selecione</option>${options.map(option =>
      `<option value="${escape(groupKey(option))}" ${groupKey(option) === selected ? 'selected' : ''}>${escape(groupTitle(option))}</option>`).join('')}</select></label>
    <label>Minutos por ficha<input name="groupMinutes" type="number" min="0" max="1440" value="${escape(Math.max(MIN_STUDY_MINUTES, group?.minutes ?? 0))}"></label>
    <button type="button" class="button secondary" data-move-row="-1" aria-label="Subir grupo">↑</button>
    <button type="button" class="button secondary" data-move-row="1" aria-label="Descer grupo">↓</button>
    <button type="button" class="button secondary" data-remove-row>Remover</button>
  </div>`;
}

function groupTitle(group) {
  return (group.type === 'deck' ? 'Plano de estudo · ' : 'Capítulo · ') + group.name;
}

function refreshContentOptions() {
  const container = $('#schedule-groups');
  if (!container) return;
  const selects = [...container.querySelectorAll('select[name=group]')];
  const all = scheduleView.groupOptions || [];
  const options = new Map(all.map(group => [groupKey(group), group]));
  const chosen = new Set(selects.map(select => select.value).filter(Boolean));
  const available = (option, own = '') => {
    const key = groupKey(option);
    if (key === own) return true;
    if (chosen.has(key) || option.assignedTo.some(id => id !== scheduleWizard.schedule.id)) return false;
    return option.units.every(unit => ![...chosen].some(other => other !== own && options.get(other)?.units.includes(unit)));
  };
  for (const select of selects) {
    const value = select.value;
    const list = all.filter(option => available(option, value));
    select.innerHTML = '<option value="">' + (list.length ? 'Selecione' : 'Nenhuma opção disponível') + '</option>'
      + list.map(option => '<option value="' + escape(groupKey(option)) + '">' + escape(groupTitle(option)) + '</option>').join('');
    select.value = value;
  }
  $('#schedule-editor [data-add-row="group"]').disabled = !all.some(option => available(option));
}

function displayedGroups(item) {
  return item.groups.map(group => ({
    type: group.type, id: group.id,
    minutes: Math.max(MIN_STUDY_MINUTES, group.minutes ?? item.phases.find(phase => phase.milestoneId === group.id)?.minutes ?? item.phases[0]?.minutes ?? 0),
  }));
}

function weeklyWindowTemplate() {
  return `<details class="weekly-template" data-weekly-template>
    <summary class="weekly-template-toggle">
      <span data-weekly-empty><strong>Definir janelas semanais</strong><span>Use o modelo de segunda a sexta, das 20h às 21h, ou ajuste os horários e os dias.</span></span>
      <span data-weekly-redefine>Redefinir por um modelo</span>
    </summary>
    <p>O modelo cria uma janela com a mesma duração e início em cada dia marcado. Depois, você pode editar ou remover cada janela.</p>
    <div class="weekly-template-presets" role="group" aria-label="Sugestões de duração diária">
      ${[1, 2, 3].map(hours => `<button type="button" class="button secondary" data-weekly-preset="${hours}">${hours} h por dia</button>`).join('')}
    </div>
    <div class="form-row">
      <label>Horas de estudo por dia<input data-weekly-hours inputmode="decimal" value="1"></label>
      <label>Horário de início do modelo<input data-weekly-start type="time" value="20:00"></label>
    </div>
    <fieldset class="weekly-template-days"><legend>Dias disponíveis</legend>
      ${[1, 2, 3, 4, 5, 6, 0].map(day => `<label><input type="checkbox" data-weekly-day="${day}" ${day >= 1 && day <= 5 ? 'checked' : ''}>${weekDays[day]}</label>`).join('')}
    </fieldset>
    <div class="weekly-template-actions">
      <button type="button" class="button secondary" data-cancel-weekly-template>Cancelar</button>
      <button type="button" class="button primary" data-apply-weekly-template>Aplicar</button>
    </div>
    <p class="form-error" role="alert"></p>
  </details>`;
}

function applyWeeklyTemplate(template) {
  const section = template.closest('[data-weekly-windows]');
  const error = template.querySelector('[role="alert"]');
  const feedback = section.querySelector('[data-weekly-feedback]');
  error.textContent = '';
  feedback.textContent = '';
  const hours = template.querySelector('[data-weekly-hours]').value.trim().replace(',', '.');
  const duration = Number(hours) * 60;
  const start = template.querySelector('[data-weekly-start]').value;
  const days = [...template.querySelectorAll('[data-weekly-day]:checked')].map(input => Number(input.dataset.weeklyDay));
  if (!/^\d+(?:\.\d+)?$/.test(hours) || !Number.isFinite(duration) || duration < 1 || duration > 1440
      || Math.abs(duration - Math.round(duration)) > 1e-8) {
    error.textContent = 'Informe uma duração diária entre 1 minuto e 24 horas, em minutos inteiros. Exemplo: 1,5 hora.';
    return;
  }
  if (!start || !days.length) {
    error.textContent = 'Informe o horário de início e marque pelo menos um dia.';
    return;
  }
  const dailyMinutes = Math.round(duration);
  const [hour, minute] = start.split(':').map(Number);
  const endMinute = hour * 60 + minute + dailyMinutes;
  if (endMinute > 1440) {
    error.textContent = 'A janela ultrapassa a meia-noite. Escolha um horário mais cedo ou reduza a duração.';
    return;
  }
  const end = [Math.floor(endMinute / 60), endMinute % 60].map(part => String(part).padStart(2, '0')).join(':');
  const windows = days.map(day => ({ day, start, end }));
  section.querySelector('[data-schedule-windows]').innerHTML = windows.map(scheduleWindow).join('');
  updateWindowPlaceholder(section);
  const minutes = dailyMinutes * windows.length;
  feedback.textContent = `${windows.length} ${windows.length === 1 ? 'janela gerada' : 'janelas geradas'} · ${Math.floor(minutes / 60)} h ${minutes % 60} min por semana.`;
  closeWeeklyTemplate(template);
}

function closeWeeklyTemplate(template) {
  template.open = false;
  template.querySelector('summary').focus();
}

function cancelWeeklyTemplate(template) {
  for (const input of template.querySelectorAll('input')) {
    if (input.type === 'checkbox') input.checked = input.defaultChecked;
    else input.value = input.defaultValue;
  }
  template.querySelector('[role="alert"]').textContent = '';
  closeWeeklyTemplate(template);
}

function updateWindowPlaceholder(section) {
  section.toggleAttribute('data-has-windows', Boolean(section.querySelector('[data-schedule-windows] .schedule-row')));
}

function linkDurationFields(settings) {
  const configured = new Map((settings.linkMinutesByDomain || []).map(entry => [entry.domain, entry.minutes]));
  const discovered = (scheduleView?.items || []).flatMap(item => (item.materialLinks || []).map(link => link.domain));
  const domains = [...new Set([...configured.keys(), ...discovered])].sort();
  if (!domains.length) return '';
  return '<fieldset class="link-duration-settings"><legend>Tempo em links externos</legend>'
    + '<p>A média inicial é de 5 minutos por link. Ajuste o tempo por domínio para todos os cronogramas.</p>'
    + domains.map(domain => '<label>' + escape(domain)
      + '<input type="hidden" name="linkDomain" value="' + escape(domain) + '">'
      + '<input type="number" name="linkMinutes" min="0" max="1440" required aria-label="Minutos por link em '
      + escape(domain) + '" value="' + (configured.get(domain) ?? DEFAULT_LINK_MINUTES) + '"></label>').join('')
    + '</fieldset>';
}

function availabilityFields(availability) {
  return `<label>Fuso horário<input name="zone" required value="${escape(availability.timeZone)}"></label>
    <p>O fuso determina quando começam as janelas e quando termina o dia do prazo.</p>
    <fieldset data-weekly-windows ${availability.windows.length ? 'data-has-windows' : ''}><legend>Janelas semanais</legend>
      <p>Informe os dias e horários regulares de estudo. Deixe sem janelas para registrar o plano sem encaixar sessões.</p>
      ${weeklyWindowTemplate()}
      <p class="weekly-template-feedback" data-weekly-feedback role="status"></p>
      <div data-schedule-windows>${availability.windows.map(scheduleWindow).join('')}</div>
      <button type="button" class="button secondary" data-add-row="window">Adicionar janela</button>
    </fieldset>
    <fieldset><legend>Tempo extra por semana</legend>
      <p>Permite estender a última janela de um dia quando o tempo regular não basta. Use zero para manter apenas os horários informados.</p>
      <div class="form-row">
        <label>Horas extras<input name="overtimeHours" type="number" min="0" max="168" required value="${escape(availability.overtimeHours)}"></label>
        <label>Minutos extras<input name="overtimeMinutes" type="number" min="0" max="59" required value="${escape(availability.overtimeMinutes)}"></label>
      </div>
    </fieldset>${linkDurationFields(availability)}`;
}

function readAvailability(fields) {
  const starts = fields.getAll('start');
  const ends = fields.getAll('end');
  const linkMinutes = fields.getAll('linkMinutes');
  return {
    timeZone: fields.get('zone'),
    overtimeHours: fields.get('overtimeHours') === '' ? '' : Number(fields.get('overtimeHours')),
    overtimeMinutes: fields.get('overtimeMinutes') === '' ? '' : Number(fields.get('overtimeMinutes')),
    linkMinutesByDomain: fields.getAll('linkDomain').map((domain, index) => ({
      domain, minutes: linkMinutes[index] === '' ? '' : Number(linkMinutes[index]),
    })),
    windows: fields.getAll('day').map((day, i) => ({ day: Number(day), start: starts[i], end: ends[i] })),
  };
}

function checkAvailability(availability) {
  try { new Intl.DateTimeFormat('pt-BR', { timeZone: availability.timeZone.trim() }); }
  catch { throw new Error('Informe um fuso válido, como America/Sao_Paulo.'); }
  if (availability.overtimeHours * 60 + availability.overtimeMinutes > 10080) {
    throw new Error('A tolerância semanal não pode ultrapassar 168 horas.');
  }
  const windows = [...availability.windows].sort((a, b) => a.day - b.day || a.start.localeCompare(b.start));
  if (windows.some(window => window.end <= window.start)) throw new Error('Cada janela deve terminar depois de começar.');
  if (windows.some((window, i) => i > 0 && window.day === windows[i - 1].day && window.start < windows[i - 1].end)) {
    throw new Error('Ajuste os horários para que as janelas do mesmo dia não se sobreponham.');
  }
}

function scheduleEditor(item) {
  scheduleWizard = {
    schedule: item ? structuredClone(item) : {
      name: '', deadline: '', startDate: '', priority: 0, groups: [], mode: 'sequential', phases: [{ minutes: MIN_STUDY_MINUTES }],
    },
    availability: structuredClone(scheduleView.data.availability),
    groupDraft: item ? displayedGroups(item) : [],
    legacy: item && !item.groups.some(group => Object.hasOwn(group, 'minutes'))
      ? { groups: structuredClone(item.groups), phases: structuredClone(item.phases), shown: displayedGroups(item) } : null,
    manualName: Boolean(item?.name),
    manualStart: Boolean(item?.startDate),
    manualDeadline: Boolean(item?.deadline),
    suggestedDeadline: null,
    step: 0,
  };
  const dialog = $('#schedule-editor');
  renderScheduleStep();
  if (!dialog.open) dialog.showModal();
  $('#schedule-editor h2').focus();
}

function scheduleBreadcrumbs(step) {
  return `<nav class="wizard-breadcrumbs" aria-label="Passos do cronograma"><ol>
    ${wizardSteps.map(({ label }, i) => `<li ${i === step ? 'aria-current="step"' : ''}>
      ${i < step ? `<button type="button" data-wizard-back="${i}">${label}</button>` : `<span>${label}</span>`}
    </li>`).join('')}</ol></nav>`;
}

function stepFields(key, item, availability) {
  if (key === 'content') return `
    <label>Distribuição<select name="mode"><option value="sequential">Sequencial</option><option value="round-robin" ${item.mode === 'round-robin' ? 'selected' : ''}>Round robin</option></select></label>
    <p>Sequencial termina um grupo antes de começar o próximo. Round robin alterna uma ficha de cada grupo.</p>
    <fieldset><legend>Planos de estudo e capítulos</legend>
      <p>Escolha o conteúdo e informe os minutos-base por ficha em cada linha. O mínimo é ${MIN_STUDY_MINUTES} minutos-base por ficha. O cálculo soma páginas, vídeos e links.</p>
      ${scheduleWizard.legacy ? '<p>Se você mantiver as linhas e valores, serão preservadas as estimativas já gravadas.</p>' : ''}
      <div id="schedule-groups">${(scheduleWizard.groupDraft.length ? scheduleWizard.groupDraft : [null]).map(scheduleGroup).join('')}</div>
      <button type="button" class="button secondary" data-add-row="group">Incluir plano de estudo ou capítulo</button>
    </fieldset>`;
  if (key === 'deadline') return `
    <label>Nome<input name="title" required maxlength="1000" value="${escape(item.name)}"></label>
    <p>Por padrão, o nome reúne os planos de estudo selecionados. Você pode alterar para identificar melhor o estudo.</p>
    <label>Prioridade<input name="priority" type="number" min="0" max="999" required value="${escape(item.priority)}"></label>
    <p>Quando não houver espaço para todos os cronogramas, números maiores têm preferência.</p>
    <label>Data de início<input name="startDate" type="date" value="${escape(item.startDate)}" aria-describedby="schedule-start-help"></label>
    <p id="schedule-start-help">A próxima janela regular com horário livre vem preenchida. Você pode trocar a data para definir quando o estudo começa.</p>
    <label>Data limite<input name="deadline" type="date" required min="${escape(item.startDate)}" aria-describedby="deadline-description deadline-suggestion" value="${escape(item.deadline)}"></label>
    <p id="deadline-description">O prazo sugerido reserva 50% a mais que o esforço restante nas janelas regulares. Você pode informar outra data.</p>

    <p id="deadline-suggestion" role="status">${escape(deadlineStatus(scheduleWizard))}</p>
    <button type="button" class="button secondary" data-suggest-deadline>Usar prazo sugerido</button>`;
  return `<p>Os campos já vêm preenchidos com as configurações gerais. Qualquer mudança nesta agenda afeta todos os cronogramas depois de aplicar a revisão.</p>${availabilityFields(availability)}`;
}

function renderScheduleStep() {
  clearGantt($('#schedule-editor'));
  const { step, schedule, availability } = scheduleWizard;
  const key = wizardSteps[step].key;
  $('#schedule-editor').innerHTML = `
    <div class="wizard-top"><strong>${schedule.id ? 'Editar cronograma' : 'Novo cronograma'}</strong>
      <button type="button" class="icon-button close-dialog" aria-label="Fechar">×</button>
    </div>
    ${scheduleBreadcrumbs(step)}
    <h2 tabindex="-1">${wizardSteps[step].label}</h2>
    <form data-schedule-form="wizard">
      ${key === 'deadline' ? `<div class="video-loading" data-video-loading role="status" hidden>
      <strong>Estimando duração dos vídeos</strong>
      <span data-video-loaded-step></span>
      <progress aria-label="Progresso da estimativa média" hidden></progress>
    </div>` : ''}
      <div data-wizard-fields>${stepFields(key, schedule, availability)}</div>
      <p class="form-error" role="alert"></p>
      <div class="wizard-actions">
        ${step ? `<button type="button" class="button secondary" data-wizard-back="${step - 1}">Voltar</button>` : '<button type="button" class="button secondary" data-cancel-wizard>Cancelar</button>'}
        <button type="submit" class="button primary">${step + 1 === reviewStep ? 'Revisar cronograma' : 'Avançar'}</button>
      </div>
    </form>`;
  refreshContentOptions();
}

function captureScheduleStep(fields) {
  const { step, schedule } = scheduleWizard;
  const { key } = wizardSteps[step];
  if (key === 'content') {
    schedule.mode = fields.get('mode');
    const minutes = fields.getAll('groupMinutes');
    const rows = fields.getAll('group').map((value, index) => {
      const [type, id] = value ? JSON.parse(value) : [];
      return { type, id, minutes: Math.max(MIN_STUDY_MINUTES, Number(minutes[index] || 0)) };
    });
    scheduleWizard.groupDraft = rows;
    const legacy = scheduleWizard.legacy;
    const unchanged = legacy && JSON.stringify(rows) === JSON.stringify(legacy.shown);
    schedule.groups = unchanged ? legacy.groups : rows;
    schedule.phases = unchanged ? legacy.phases : [];
    if (!scheduleWizard.manualName) schedule.name = suggestedScheduleName(schedule.groups);
  } else if (key === 'availability') {
    scheduleWizard.availability = readAvailability(fields);
  } else if (key === 'deadline') {
    schedule.name = fields.get('title');
    schedule.priority = fields.get('priority') === '' ? '' : Number(fields.get('priority'));
    schedule.startDate = fields.get('startDate');
    schedule.deadline = fields.get('deadline');
  }
}

function suggestedScheduleName(groups) {
  const { data, items: cards } = scheduleView;
  const names = new Set();
  for (const group of groups) {
    if (group.type === 'deck') names.add(group.id);
    else if (group.type === 'milestone') {
      const milestone = data.milestones.find(item => item.id === group.id);
      const decks = milestone ? cards.filter(card => memberOf(milestone, card)).map(card => card.deck) : [];
      for (const deck of decks) names.add(deck);
      if (!decks.length && milestone) names.add(milestone.name);
    }
  }
  return [...names].join(', ');
}

function videosInDraft(schedule) {
  const { data, items } = scheduleView;
  const milestones = new Map(data.milestones.map(milestone => [milestone.id, milestone]));
  const belongs = (card, id) => milestones.has(id) && memberOf(milestones.get(id), card);
  const phases = schedule.phases.map(phase => phase.milestoneId).filter(Boolean);
  return items.filter(card =>
    schedule.groups.some(group => group.type === 'deck' ? card.deck === group.id : belongs(card, group.id))
      && (!phases.length || phases.some(id => belongs(card, id))))
    .flatMap(card => card.materialVideos || []);
}

function showVideoLoading(wizard, step, checked, total) {
  if (wizard !== scheduleWizard) return;
  const view = $('#schedule-editor [data-video-loading]');
  if (!view) return;
  view.hidden = false;
  view.closest('form').querySelector('[data-wizard-fields]').hidden = true;
  view.querySelector('[data-video-loaded-step]').textContent = step;
  const meter = view.querySelector('progress');
  meter.hidden = !total;
  if (total) {
    meter.max = total;
    meter.value = checked;
  }
}

async function estimateDraftVideos(wizard, videos, host, retry) {
  const key = JSON.stringify([...new Set(videos.map(video => video.id))].sort());
  if (wizard.videoProbe?.key !== key || (retry && wizard.videoProbe.result?.length === 0)) {
    const probe = { key };
    wizard.videoProbe = probe;
    showVideoLoading(wizard, '1 de 3 · Identificando os vídeos do material…');
    probe.promise = new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      .then(() => sampleVideoDurations(videos, (checked, total) => {
        if (wizard.videoProbe === probe) showVideoLoading(wizard,
          '2 de 3 · Consultando duração dos vídeos · ' + checked + ' de ' + total, checked, total);
      }, video => probeVideo(video, host)))
      .then(result => { probe.result = result; return result; });
  }
  return wizard.videoProbe.promise;
}

function deadlineStatus(wizard) {
  const suggestion = wizard.suggestedDeadline;
  let message = '';
  if (wizard.manualDeadline) message = 'A data informada prevalece na revisão.';
  else if (suggestion?.date) message = 'Prazo sugerido: ' + suggestion.date.split('-').reverse().join('/')
    + ' · ' + suggestion.effortMinutes + ' min de estudo + ' + suggestion.bufferMinutes + ' min de margem.';
  else if (suggestion) message = 'Sem encaixe estimado nas janelas regulares. Ajuste a agenda ou informe um prazo.';
  if (suggestion?.videoAverageSeconds) {
    const minutes = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(suggestion.videoAverageSeconds / 60);
    const sample = wizard.schedule.videoSamples?.length || 0;
    const used = suggestion.videoSampleCount;
    message += sample ? ' Média de ' + minutes + ' min por vídeo · ' + used + ' de ' + sample + ' durações usadas.'
      : ' Média anterior mantida: ' + minutes + ' min por vídeo.';
  } else if (suggestion && 'videoAverageSeconds' in suggestion) {
    message += ' Nenhuma duração pôde ser obtida. O tempo dos vídeos ficou fora da estimativa.';
  }
  return message;
}

async function requestDeadlineSuggestion({ replaceDeadline = false } = {}) {
  const wizard = scheduleWizard;
  const form = $('#schedule-editor form[data-schedule-form="wizard"]');
  const start = form?.elements.startDate;
  const deadline = form?.elements.deadline;
  if (!wizard || !start || !deadline) return;
  const message = $('#deadline-suggestion');
  const button = form.querySelector('[data-suggest-deadline]');
  const submit = form.querySelector('button[type=submit]');
  const request = Symbol('suggestion');
  wizard.dateRequest = request;
  button.disabled = true;
  submit.disabled = true;
  const previousDeadline = deadline.value;
  const isCurrent = () => form.isConnected && wizard === scheduleWizard && wizard.dateRequest === request;
  if (!wizard.manualDeadline) {
    deadline.value = '';
    wizard.schedule.deadline = '';
  }
  wizard.suggestedDeadline = null;
  message.textContent = 'Consultando as próximas janelas e calculando o prazo…';
  try {
    const videos = videosInDraft(wizard.schedule);
    wizard.schedule.videoSamples = videos.length ? await estimateDraftVideos(wizard, videos, form, replaceDeadline) : [];
    if (!isCurrent()) return;
    if (videos.length) showVideoLoading(wizard, '3 de 3 · Calculando o prazo com a estimativa média…');
    const draft = { schedule: { ...wizard.schedule,
      name: form.elements.title.value.trim() || suggestedScheduleName(wizard.schedule.groups),
      priority: Number(form.elements.priority.value),
      startDate: wizard.manualStart ? start.value : '',
    }, availability: wizard.availability };
    const previousView = scheduleView;
    const suggest = revision => api('/api/schedule/suggest-deadline', 'POST', { ...draft, revision });
    let suggestion;
    try {
      suggestion = await suggest(previousView.revision);
    } catch (error) {
      if (error.status !== 409 || !isCurrent()) throw error;
      const latest = await api('/api/schedule');
      if (!isCurrent()) return;
      if (latest.data.revision !== previousView.data.revision) {
        throw new Error('A agenda mudou. Feche e reabra o cronograma para usar a agenda atualizada.');
      }
      scheduleView = latest;
      suggestion = await suggest(latest.revision);
    }
    if (!isCurrent()) return;
    wizard.suggestedDeadline = suggestion;
    if (!wizard.manualStart) {
      start.value = suggestion.startDate || '';
      wizard.schedule.startDate = start.value;
    }
    deadline.min = start.value;
    const replaceManual = replaceDeadline && deadline.value === previousDeadline;
    if (suggestion.date && (!wizard.manualDeadline || replaceManual)) {
      wizard.manualDeadline = false;
      deadline.value = suggestion.date;
      wizard.schedule.deadline = deadline.value;
    }
    message.textContent = deadlineStatus(suggestion.date ? wizard : { ...wizard, manualDeadline: false });
  } catch (error) {
    if (isCurrent()) message.textContent = error.message;
  } finally {
    if (wizard.dateRequest === request) {
      const loading = form.querySelector('[data-video-loading]');
      if (loading) loading.hidden = true;
      form.querySelector('[data-wizard-fields]').hidden = false;
      button.disabled = false;
      submit.disabled = false;
    }
  }
}

document.addEventListener('input', event => {
  const field = event.target;
  if (!scheduleWizard || !field.matches('#schedule-editor input')) return;
  if (field.name === 'title') scheduleWizard.manualName = Boolean(field.value.trim());
  if (field.name === 'deadline') {
    scheduleWizard.manualDeadline = Boolean(field.value);
    $('#deadline-suggestion').textContent = field.value ? deadlineStatus(scheduleWizard) : 'Informe uma data ou use a sugestão.';
  }
});

document.addEventListener('change', event => {
  const field = event.target;
  if (field.matches('#schedule-groups select[name=group]')) refreshContentOptions();
  if (!scheduleWizard || !field.matches('#schedule-editor input')) return;
  if (field.name === 'startDate') {
    scheduleWizard.manualStart = Boolean(field.value);
    scheduleWizard.schedule.startDate = field.value;
    field.form.elements.deadline.min = field.value;
    if (!scheduleWizard.manualDeadline || !field.value) requestDeadlineSuggestion();
  }
  if (field.name === 'priority' && field.validity.valid && !scheduleWizard.manualDeadline) requestDeadlineSuggestion();
});

function wizardReview() {
  const { schedule, availability } = scheduleWizard;
  const groupNames = schedule.groups.map(group => {
    const name = group.type === 'deck' ? group.id : scheduleView.data.milestones.find(item => item.id === group.id)?.name || group.id;
    return Number.isInteger(group.minutes) ? name + ' (' + group.minutes + ' min por ficha)' : name;
  });
  const windows = availability.windows.map(window => `${weekDays[window.day]} ${window.start}–${window.end}`);
  return `<div class="wizard-top"><strong>Revisão do cronograma</strong>
      <button type="button" class="icon-button close-dialog" aria-label="Fechar">×</button>
    </div>
    ${scheduleBreadcrumbs(reviewStep)}
    <h2 tabindex="-1">Revisão</h2>
    <dl class="wizard-summary">
      <dt>Cronograma</dt><dd>${escape(schedule.name)} · ${schedule.startDate ? `de ${escape(schedule.startDate.split('-').reverse().join('/'))} ` : ''}até ${escape(schedule.deadline.split('-').reverse().join('/'))} · prioridade ${schedule.priority}</dd>
      <dt>Conteúdo</dt><dd>${groupNames.map(escape).join(' → ')} · ${schedule.mode === 'sequential' ? 'Sequencial' : 'Round robin'}</dd>
      ${schedule.phases.length ? `<dt>Estimativas gravadas</dt><dd>${schedule.phases.map(phase => `${escape(phase.name)} (${phase.minutes} min por ficha)`).join(' → ')}</dd>` : ''}
      <dt>Agenda compartilhada</dt><dd>${windows.map(escape).join(', ') || 'Sem janelas regulares'} · ${escape(availability.timeZone)} · ${availability.overtimeHours} h ${availability.overtimeMinutes} min extras por semana</dd>
    </dl>`;
}

let milestoneRevision;
function milestoneEditor(item, snapshot = scheduleView) {
  const { items, revision } = snapshot;
  milestoneRevision = revision;
  const candidates = page === 'board' && deckFilter ? items.filter(unit => unit.deck === deckFilter) : items;
  $('#milestone-editor').innerHTML = `<form data-schedule-form="milestone" data-id="${escape(item?.id)}">
    <label>Nome do capítulo<input name="title" required maxlength="1000" value="${escape(item?.name)}"></label>
    <fieldset class="milestone-cards"><legend>Fichas do Quadro de estudos</legend>${candidates.map(unit => {
      const assigned = item && unit.milestoneId === item.id;
      const checked = item && memberOf(item, unit);
      return `<label class="option"><input type="checkbox" name="unit" value="${escape(unit.id)}" ${assigned ? 'checked disabled' : checked ? 'checked' : ''}>${escape(unit.deck)} · ${escape(unit.front)}</label>`;
    }).join('') || '<p>Crie fichas para cadastrar um capítulo.</p>'}</fieldset>
    <button class="button primary">Salvar capítulo</button>
  </form>`;
}

function sessionTime(session, timeZone) {
  const format = new Intl.DateTimeFormat('pt-BR', { timeZone, dateStyle: 'short', timeStyle: 'short' });
  return format.formatRange(session.start * 60_000, session.end * 60_000);
}

function sessionList(sessions, timeZone, allowConfirm = false) {
  if (!sessions.length) return '<p>Nenhuma sessão.</p>';
  return `<ul class="schedule-sessions">${sessions.map(session => `<li>
    <strong>${escape(session.card.front || session.card.id)}</strong>
    <small>${escape(session.milestoneName || session.phase)} · ${escape(sessionTime(session, timeZone))}${session.overtime ? ' · Hora extra' : ''}${session.source === 'manual' ? ' · Sessão avulsa' : ''}${session.actualMinutes ? ` · ${session.actualMinutes} min realizados` : ''}</small>
    ${allowConfirm && session.start * 60_000 <= Date.now() ? `<form data-schedule-form="confirm" data-id="${escape(session.id)}">
    <label>Minutos realizados<input name="minutes" type="number" min="1" max="1440" required></label>
    <button class="button secondary">Confirmar sessão</button></form>` : ''}
  </li>`).join('')}</ul>`;
}

async function openSavedSchedule(id, fromBoard = false) {
  const dialog = $('#saved-schedule-dialog');
  if (dialog.open) return;
  const header = title => `<header class="dialog-heading">
    <h2 id="saved-schedule-title">${escape(title)}</h2>
    <button type="button" class="icon-button close-dialog" aria-label="Fechar">×</button>
  </header>`;
  dialog.innerHTML = header('Cronograma') + '<p role="status">Carregando o cronograma…</p>';
  dialog.showModal();
  const loading = dialog.querySelector('[role=status]');
  try {
    const { data } = await api('/api/schedule');
    if (!dialog.open || !loading.isConnected) return;
    const schedules = id ? data.schedules.filter(item => item.id === id) : fromBoard ? visibleBoardSchedules(data) : data.schedules;
    if (!schedules.length) {
      loading.textContent = id ? 'Cronograma indisponível.' : fromBoard && data.schedules.length ? 'Nenhum cronograma corresponde aos filtros do quadro.' : 'Nenhum cronograma cadastrado.';
      return;
    }
    const ids = new Set(schedules.map(item => item.id));
    const sessions = data.sessions.filter(item => item.schedules.some(id => ids.has(id)));
    const confirmations = data.confirmations.filter(item => item.schedules.some(id => ids.has(id)));
    const rests = (data.rests || []).filter(item => ids.has(item.scheduleId));
    const workflowCompletions = (data.workflowCompletions || []).filter(item => item.schedules.some(id => ids.has(id)));
    const pendingPlacement = (data.pendingPlacement || []).filter(item => item.schedules.some(id => ids.has(id)));
    dialog.innerHTML = header(id ? schedules[0].name : 'Cronograma de estudos') + '<div data-saved-gantt></div>';
    dialog.querySelector('.close-dialog').focus();
    const zone = data.availability.timeZone;
    renderGantt(dialog.querySelector('[data-saved-gantt]'), {
      mode: 'schedule', after: sessions, beforeZone: zone, afterZone: zone,
      afterAgenda: { schedules, confirmations, rests, workflowCompletions, pendingPlacement },
    });
  } catch (error) {
    if (dialog.open && loading.isConnected) loading.textContent = error.message;
  }
}

$('#saved-schedule-dialog').addEventListener('close', event => clearGantt(event.currentTarget));

async function scheduleHome() {
  const request = routeRequest;
  const snapshot = await api('/api/schedule');
  if (page !== 'schedule' || request !== routeRequest) return;
  scheduleView = snapshot;
  scheduleWizard = null;
  clearGantt();
  const { data, items: cards } = snapshot;
  const completedStudy = new Set([...data.confirmations.filter(entry => entry.card.kind === 'unit' && entry.completed), ...(data.workflowCompletions || [])].filter(entry => entry.phase === 'Em estudo')
    .map(entry => JSON.stringify([entry.card.unit, entry.card.id])));
  const studyProgress = item => {
    const phaseIds = item.phases.map(phase => phase.milestoneId).filter(Boolean);
    const scope = cards.filter(card => item.groups.some(group => group.type === 'deck'
      ? card.deck === group.id
      : data.milestones.some(milestone => group.id === milestone.id && memberOf(milestone, card))));
    const included = scope.filter(card => !phaseIds.length
      || data.milestones.some(milestone => phaseIds.includes(milestone.id) && memberOf(milestone, card)))
      .map(card => JSON.stringify([card.unit, card.id]));
    const done = included.filter(key => completedStudy.has(key)).length;
    return done && done === included.length ? 'Estudo concluído' : `${done}/${included.length} fichas estudadas`;
  };
  const actions = `<div class="schedule-header-actions">
    <button type="button" class="button secondary schedule-settings-button" data-open-schedule-dialog="settings" aria-label="Configurações gerais" title="Configurações gerais"><span aria-hidden="true">⚙</span></button>
    <button type="button" class="button primary" data-edit-schedule="">Novo cronograma</button>
    <button type="button" class="button secondary" data-open-schedule-dialog="sessions">Sessões</button>
  </div>`;
  $('#view').innerHTML = heading('Cronogramas', 'Distribua o estudo das fichas na agenda compartilhada.', actions, true) + `
    ${data.schedules.length ? `<section class="content-card schedule-overview" aria-label="Agenda dos cronogramas">
      <div data-gantt-overview><p>Carregando a agenda…</p></div>
    </section>
    <section class="content-card">
      <h2>Seus cronogramas</h2>
      <ul class="schedule-items">${data.schedules.map(item => `<li class="schedule-list-item">
        <div class="schedule-item"><strong>${escape(item.name)}</strong><span>${item.startDate ? `De ${escape(item.startDate.split('-').reverse().join('/'))} até` : 'Até'} ${escape(item.deadline.split('-').reverse().join('/'))} · ${studyProgress(item)}</span></div>
        <div class="schedule-item-actions">
          <button class="button secondary" type="button" data-edit-schedule="${escape(item.id)}">Editar</button>
          <button class="button secondary" type="button" data-view-schedule="${escape(item.id)}">Exibir</button>
          <button class="button secondary danger-text" type="button" data-remove-schedule="${escape(item.id)}">Remover</button>
        </div>
      </li>`).join('')}</ul>
    </section>` : `<button type="button" class="schedule-empty" data-edit-schedule="">
      <strong>Crie seu primeiro cronograma</strong>
      <span>Escolha o conteúdo, indique o prazo e veja como o estudo cabe na sua agenda.</span>
    </button>`}
    <dialog class="schedule-wizard" id="schedule-settings" aria-labelledby="schedule-settings-title">
      <header class="dialog-heading"><h2 id="schedule-settings-title">Configurações gerais</h2><button type="button" class="icon-button close-dialog" aria-label="Fechar">×</button></header>
      <p>Esta agenda é compartilhada por todos os cronogramas. Revise o impacto antes de aplicar qualquer mudança.</p>
      <form data-schedule-form="availability">
        ${availabilityFields(data.availability)}
        <p class="form-error" role="alert"></p>
        <button class="button primary">Revisar mudanças</button>
      </form>
      <details><summary>Capítulos de estudo</summary>
        ${data.milestones.map(item => `<button class="button secondary" type="button" data-edit-milestone="${escape(item.id)}">${escape(item.name)}</button>`).join(' ')}
        <button type="button" class="button secondary" data-edit-milestone="">Novo capítulo</button>
        <div id="milestone-editor"></div>
      </details>
    </dialog>
    <dialog class="schedule-wizard" id="schedule-sessions" aria-labelledby="schedule-sessions-title">
      <header class="dialog-heading"><h2 id="schedule-sessions-title">Sessões</h2><button type="button" class="icon-button close-dialog" aria-label="Fechar">×</button></header>
      <section><h3>Agendadas</h3>${sessionList(data.sessions, data.availability.timeZone, true)}</section>
      <details><summary>Sessões confirmadas</summary>${sessionList(data.confirmations, data.availability.timeZone)}</details>
    </dialog>
    <dialog class="schedule-wizard" id="schedule-editor" aria-label="Editor de cronograma"></dialog>
    <dialog id="schedule-preview"></dialog>`;
  for (const [type, id] of Object.entries(routeDialogIds)) {
    if (['schedule-editor', 'schedule-settings', 'schedule-sessions'].includes(id)) watchRouteDialog(document.getElementById(id), type);
  }
  const overview = $('[data-gantt-overview]');
  if (overview) renderGantt(overview, { mode: 'overview', agenda: data });
  $('#schedule-editor').addEventListener('close', event => {
    clearGantt(event.currentTarget);
    scheduleWizard = null;
  });
  $('#schedule-preview').addEventListener('close', event => clearGantt(event.currentTarget));
}

function displayStageEstimate(estimate) {
  if (!estimate) return '';
  const factors = [
    estimate.baseMinutes + ' min base',
    estimate.pageMinutes && estimate.pageMinutes + ' min de páginas',
    estimate.linkMinutes && estimate.linkMinutes + ' min de links',
    estimate.videoMinutes && estimate.videoMinutes + ' min de vídeos',
  ].filter(Boolean);
  return ' · ' + estimate.estimatedMinutes + ' min previstos (' + factors.join(' + ') + ')';
}

function showSchedulePreview(preview, timeZone, inline = false) {
  const old = new Set(scheduleView.data.sessions.map(session => session.id));
  const retained = new Set(preview.sessions.map(session => session.id));
  const replaced = scheduleView.data.sessions.filter(session => !retained.has(session.id));
  const changed = replaced.length;
  const added = preview.sessions.filter(session => !old.has(session.id)).length;
  const extra = preview.sessions.reduce((sum, session) => sum + (session.overtime ? session.end - session.start : 0), 0);
  const statuses = { fits: 'Cabe no prazo', impossible: 'Impossível com a disponibilidade atual', unknown: 'Viabilidade não confirmada' };
  const target = $(inline ? '#schedule-editor' : '#schedule-preview');
  target.innerHTML = `${inline ? wizardReview() : '<div class="dialog-heading"><h2>Prévia do cronograma</h2><button type="button" class="icon-button close-dialog" aria-label="Fechar">×</button></div>'}
    <h3>Encaixe proposto</h3>
    <p>Confira a cobertura, o tempo extra e as sessões que serão alteradas na agenda.</p>
    ${(preview.restUsage || []).length ? `<aside class="schedule-rest-warning" role="status">
      <strong>Esta proposta usa folgas de outros cronogramas</strong>
      <ul>${preview.restUsage.map(item => `<li>${escape(item.date.split('-').reverse().join('/'))} · folga de ${escape(item.name)} · ${item.minutes} min usados por ${item.usedBy.map(escape).join(', ')}</li>`).join('')}</ul>
    </aside>` : ''}
    ${scheduleView.data.schedules.length || preview.schedules?.length || preview.sessions.length ? `<section class="schedule-comparison">
      <h3>Gantt antes e depois</h3>
      <p>As setas ligam os horários que mudaram. Role o gráfico para ver mais dias ou fichas.</p>
      <div data-gantt-comparison><p>Carregando a comparação…</p></div>
    </section>` : ''}
    <p>${changed} ${changed === 1 ? 'sessão removida ou remarcada' : 'sessões removidas ou remarcadas'} · ${added} ${added === 1 ? 'nova' : 'novas'} · ${extra} min extras</p>
    ${preview.summary.map(item => `<section class="content-card"><strong>${escape(item.name)}</strong>
      <p>${item.coverage.toFixed(1)}% do esforço até o prazo · ${escape(statuses[item.status])}${item.studyComplete ? ' · Estudo concluído' : ''}</p>
      ${item.advanced?.length ? `<p>${item.advanced.length} fichas já avançaram no quadro e não precisam de novas sessões para esse conteúdo.</p>` : ''}
      <details><summary>${item.included.length} ${item.included.length === 1 ? 'ficha incluída' : 'fichas incluídas'}</summary><ul>
      ${item.included.map(card => `<li>${escape(card.deck)} · ${escape(card.front || card.id)}${displayStageEstimate(item.estimates?.find(estimate => estimate.unit === card.unit))}</li>`).join('')}
      </ul></details>
      ${item.missing.length ? `<ul>${item.missing.map(missing => `<li>${escape(missing.card.front || missing.card.id)} · ${escape(missing.phase)} · ${missing.minutes} min sem encaixe</li>`).join('')}</ul>` : ''}
    </section>`).join('')}
    ${replaced.length ? `<details><summary>Horários que serão retirados</summary>${sessionList(replaced, scheduleView.data.availability.timeZone)}</details>` : ''}
    <details><summary>Sessões propostas</summary>${sessionList(preview.sessions, timeZone)}</details>
    <form data-schedule-form="apply" data-id="${escape(preview.id)}" class="dialog-actions">${inline ? `<button type="button" class="button secondary" data-wizard-back="${reviewStep - 1}">Voltar</button>` : ''}<button class="button primary">Aplicar distribuição</button></form>
    <p class="form-error" role="alert"></p><button class="button secondary" type="button" data-reload-schedule hidden>Atualizar cronogramas</button>`;
  if (!inline) target.showModal();
  target.querySelector('h2').focus();
  const comparison = target.querySelector('[data-gantt-comparison]');
  if (comparison) renderGantt(comparison, {
    mode: 'comparison', before: scheduleView.data.sessions, after: preview.sessions,
    beforeZone: scheduleView.data.availability.timeZone, afterZone: timeZone,
    beforeAgenda: scheduleView.data,
    afterAgenda: { schedules: preview.schedules || [], confirmations: scheduleView.data.confirmations, rests: preview.rests || [], workflowCompletions: preview.workflowCompletions || [], pendingPlacement: preview.pendingPlacement || [] },
  });
}

document.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (page !== 'schedule' || !button || !scheduleView) return;
  const dialog = button.dataset.openScheduleDialog;
  if (dialog === 'settings' || dialog === 'sessions') {
    setRouteOverlay(dialog === 'settings' ? 'configuracoes' : 'sessoes');
    $('#schedule-' + dialog).showModal();
  }
  if ('editSchedule' in button.dataset) {
    const id = button.dataset.editSchedule;
    perform(async () => {
      button.disabled = true;
      try {
        const latest = await api('/api/schedule');
        if (page !== 'schedule' || !button.isConnected) return;
        const item = latest.data.schedules.find(entry => entry.id === id);
        if (id && !item) {
          await scheduleHome();
          throw new Error('Cronograma indisponível.');
        }
        scheduleView = latest;
        setRouteOverlay(item ? 'editar-cronograma' : 'novo-cronograma', id);
        scheduleEditor(item);
      } finally {
        button.disabled = false;
      }
    });
  }
  if ('wizardBack' in button.dataset && scheduleWizard) {
    const form = $('#schedule-editor form[data-schedule-form=wizard]');
    if (form) captureScheduleStep(new FormData(form));
    scheduleWizard.step = Number(button.dataset.wizardBack);
    renderScheduleStep();
    $('#schedule-editor h2').focus();
  }
  if ('cancelWizard' in button.dataset) {
    scheduleWizard = null;
    $('#schedule-editor').close();
    $('[data-edit-schedule=""]').focus();
  }
  if ('editMilestone' in button.dataset) milestoneEditor(scheduleView.data.milestones.find(item => item.id === button.dataset.editMilestone));
  if ('removeRow' in button.dataset) {
    const section = button.closest('[data-weekly-windows]');
    button.closest('.schedule-row').remove();
    if (!section) refreshContentOptions();
    if (section) {
      section.querySelector('[data-weekly-feedback]').textContent = '';
      updateWindowPlaceholder(section);
    }
  }
  if ('moveRow' in button.dataset) {
    const row = button.closest('.schedule-row');
    const sibling = button.dataset.moveRow === '-1' ? row.previousElementSibling : row.nextElementSibling;
    if (sibling) {
      if (button.dataset.moveRow === '-1') sibling.before(row);
      else sibling.after(row);
      button.focus();
    }
  }
  if ('suggestDeadline' in button.dataset) requestDeadlineSuggestion({ replaceDeadline: true });
  if ('reloadSchedule' in button.dataset) perform(() => scheduleHome());
  const template = button.closest('[data-weekly-template]');
  if ('weeklyPreset' in button.dataset) template.querySelector('[data-weekly-hours]').value = button.dataset.weeklyPreset;
  if ('applyWeeklyTemplate' in button.dataset) applyWeeklyTemplate(template);
  if ('cancelWeeklyTemplate' in button.dataset) cancelWeeklyTemplate(template);
  const kind = button.dataset.addRow;
  if (kind === 'group') {
    $('#schedule-groups').insertAdjacentHTML('beforeend', scheduleGroup());
    refreshContentOptions();
    $('#schedule-groups .schedule-content-row:last-child select').focus();
  }
  if (kind === 'window') {
    const section = button.closest('[data-weekly-windows]');
    section.querySelector('[data-schedule-windows]').insertAdjacentHTML('beforeend', scheduleWindow());
    section.querySelector('[data-weekly-feedback]').textContent = '';
    updateWindowPlaceholder(section);
  }
});

document.addEventListener('submit', async event => {
  const form = event.target;
  const kind = form.dataset.scheduleForm;
  if (!kind) return;
  event.preventDefault();
  const button = event.submitter || form.querySelector('button:not([type])');
  if (button?.disabled) return;
  if (button) button.disabled = true;
  const fields = new FormData(form);
  const revision = kind === 'milestone' ? milestoneRevision : scheduleView.revision;
  const id = form.dataset.id;
  try {
    if (kind === 'wizard') {
      const wizard = scheduleWizard;
      captureScheduleStep(fields);
      const { step, schedule, availability } = wizard;
      const { key } = wizardSteps[step];
      if (key === 'availability') checkAvailability(availability);
      if (key === 'deadline' && !schedule.name.trim()) throw new Error('Informe o nome do cronograma.');
      if (key === 'content' && !schedule.groups.length) throw new Error('Adicione um plano de estudo ou capítulo para avançar.');
      if (step + 1 < reviewStep) {
        wizard.step++;
        if (wizardSteps[wizard.step].key === 'deadline' && !wizard.manualName) {
          schedule.name = suggestedScheduleName(schedule.groups);
        }
        renderScheduleStep();
        $('#schedule-editor h2').focus();
        if (wizardSteps[wizard.step].key === 'deadline'
            && (!wizard.manualStart || !wizard.manualDeadline || videosInDraft(wizard.schedule).length)) requestDeadlineSuggestion();
      } else {
        const result = await api('/api/schedule/preview', 'POST', { revision, schedule, availability });
        if (page === 'schedule' && wizard === scheduleWizard && wizard.step + 1 === reviewStep && form.isConnected) {
          wizard.step = reviewStep;
          showSchedulePreview(result, availability.timeZone, true);
        }
      }
      return;
    }
    if (kind === 'milestone') {
      const units = fields.getAll('unit');
      const updated = await api(id ? `/api/schedule/milestones/${enc(id)}` : '/api/schedule/milestones', id ? 'PATCH' : 'POST',
        { revision, milestone: { name: fields.get('title'), units } });
      if (page === 'board') {
        phaseFilter = updated.milestones.at(-1).id;
        $('#board-phase-editor').close();
        await load();
        render();
        toast('Capítulo criado.');
        return;
      }
    } else if (kind === 'apply') {
      await api('/api/schedule/apply', 'POST', { id });
      routeOverlay = routeOverlayId = '';
      updateRoute(true);
    } else if (kind === 'confirm') {
      await api('/api/schedule/confirm', 'POST', { revision, sessionId: id, actualMinutes: Number(fields.get('minutes')) });
    } else if (kind === 'availability') {
      const availability = readAvailability(fields);
      checkAvailability(availability);
      const result = await api('/api/schedule/preview', 'POST', { revision, availability });
      if (page === 'schedule' && form.isConnected) {
        showSchedulePreview(result, availability.timeZone);
      }
      return;
    }
    await load();
    if (page === 'schedule') {
      await scheduleHome();
      if (kind === 'confirm') $('#schedule-sessions')?.showModal();
      if (kind === 'milestone') $('#schedule-settings')?.showModal();
    }
    toast('Alteração registrada.');
  } catch (error) {
    const panel = form.closest('#schedule-editor, #schedule-preview, #schedule-settings');
    const feedback = form.querySelector(':scope > .form-error') || panel?.querySelector(':scope > .form-error');
    if (feedback) {
      feedback.textContent = error.message;
      const reload = panel.querySelector('[data-reload-schedule]');
      if (error.status === 409 && reload) reload.hidden = false;
    } else toast(error.message);
  } finally {
    if (button) button.disabled = false;
  }
});
