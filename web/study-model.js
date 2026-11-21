// Pure study-session rules shared by the browser and the persistence layer.
export const STUDY_THRESHOLD = 10_000;
export const IDLE_LIMIT = 3_600_000;
export const SESSION_LIMIT = 28_800_000;
export const TAB_LEASE = 15_000;
export function startSession(projectId, now, id = crypto.randomUUID()) {
  return { version: 1, id, projectId, startedAt: now, lastActivityAt: now, status: 'active', entities: {}, tabs: {} };
}
export function endSession(s, now, reason = 'manual') {
  if (!s || s.status === 'pending') return s;
  s.endedAt = Math.max(s.startedAt, Math.min(now, s.startedAt + SESSION_LIMIT));
  s.reason = reason; s.status = 'pending';
  for (const tabId of Object.keys(s.tabs)) closeInterval(s, tabId, s.endedAt);
  return s;
}
export function advanceSession(s, now, interacting = false) {
  if (!s || s.status === 'pending') return s;
  if (now >= s.startedAt + SESSION_LIMIT) {
    const end = now - s.lastActivityAt > IDLE_LIMIT ? s.lastActivityAt : s.startedAt + SESSION_LIMIT;
    return endSession(s, end, 'limit');
  }
  if (now - s.lastActivityAt > IDLE_LIMIT) {
    s.status = 'inactive';
    if (interacting) return endSession(s, s.lastActivityAt, 'inactivity');
  } else if (interacting) { s.lastActivityAt = Math.max(now, s.lastActivityAt); s.status = 'active'; }
  return s;
}
// A tab owns only its provisional interval. It never owns the shared session.
export function closeInterval(s, tabId, now) {
  const tab = s.tabs[tabId];
  if (tab?.entity && tab.since != null) {
    const end = Math.min(now, s.endedAt ?? now);
    if (end > tab.since) s.entities[tab.entity]?.intervals.push([tab.since, end]);
  }
  if (tab) tab.since = null;
}
export function entityKey(c) { return JSON.stringify([c.deck, c.kind, c.unitId, c.id]); }
export function entityFor(s, c) {
  const key = entityKey(c);
  s.entities[key] ||= { kind: c.kind, id: c.id, unitId: c.unitId, title: c.title, deck: c.deck, intervals: [], actions: {} };
  return s.entities[key];
}
export function addAction(entity, action, at) {
  entity.actions[action] ||= []; entity.actions[action].push(at);
}
export function focusEntity(s, tabId, context, now, visible = true) {
  if (!s || s.status !== 'active') return s;
  const old = s.tabs[tabId] ||= { entity: null, since: null, checkpointAt: now, visible: false };
  const nextKey = context ? entityKey(context) : null;
  if (old.entity !== nextKey) {
    closeInterval(s, tabId, now);
    if (old.entity) addAction(s.entities[old.entity], 'close', now);
    old.entity = nextKey;
    if (context) addAction(entityFor(s, context), 'open', now);
  } else if (old.entity && old.visible !== visible) {
    addAction(s.entities[old.entity], visible ? 'visible' : 'hidden', now);
    if (!visible) closeInterval(s, tabId, now);
  }
  if (nextKey && visible && old.since == null) old.since = now;
  old.visible = visible; old.checkpointAt = now;
  return s;
}
export function checkpoint(s, tabId, now) {
  if (!s || s.status !== 'active') return s;
  for (const [id, tab] of Object.entries(s.tabs)) {
    if (id !== tabId && tab.entity && now - tab.checkpointAt > TAB_LEASE) {
      closeInterval(s, id, tab.checkpointAt);
      addAction(s.entities[tab.entity], 'close_inferred', tab.checkpointAt); tab.entity = null;
    }
  }
  if (s.tabs[tabId]) s.tabs[tabId].checkpointAt = now;
  return s;
}
export function recordAction(s, context, action, at) {
  if (s?.status === 'active' && context) addAction(entityFor(s, context), action, at);
  return s;
}
export function unionIntervals(intervals) {
  const result = [];
  for (const [a, b] of intervals.filter(([a,b]) => b > a).sort((x,y) => x[0]-y[0])) {
    const last = result.at(-1);
    if (last && a <= last[1]) last[1] = Math.max(last[1], b); else result.push([a,b]);
  }
  return result;
}
export function entityIntervals(s, key, now) {
  const end = Math.min(s.endedAt ?? now, s.startedAt + SESSION_LIMIT);
  const intervals = [...s.entities[key].intervals];
  for (const tab of Object.values(s.tabs)) if (tab.entity === key && tab.since != null) intervals.push([tab.since, Math.min(end, now - tab.checkpointAt > TAB_LEASE ? tab.checkpointAt : now)]);
  return unionIntervals(intervals.map(([a,b]) => [Math.max(a,s.startedAt),Math.min(b,end)]));
}
export function duration(intervals) { return intervals.reduce((total,[a,b])=>total+b-a,0); }
export function previewSession(s, now) {
  if (!s) return [];
  return Object.entries(s.entities).map(([key,entity]) => ({...entity,key,durationMs:duration(entityIntervals(s,key,now)),qualified:duration(entityIntervals(s,key,now)) >= STUDY_THRESHOLD}));
}

function valid(condition, message) { if (!condition) throw new Error(message); }
function epoch(value) { return Number.isSafeInteger(value) && value >= 0; }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function compactSession(s, projectId = s?.projectId) {
  valid(s && s.version === 1 && uuid.test(s.id), 'Sessão inválida.');
  valid(s.projectId === projectId && typeof projectId === 'string', 'Projeto da sessão inválido.');
  valid(s.status === 'pending' && epoch(s.startedAt) && epoch(s.endedAt) && s.endedAt >= s.startedAt && s.endedAt - s.startedAt <= SESSION_LIMIT, 'Limites de sessão inválidos.');
  valid(['manual','inactivity','limit'].includes(s.reason), 'Motivo de encerramento inválido.');
  valid(s.entities && typeof s.entities === 'object' && !Array.isArray(s.entities) && Object.keys(s.entities).length <= 2000, 'Atividades inválidas.');
  const decks = Object.create(null), deckIntervals = new Map();
  for (const [key, e] of Object.entries(s.entities).sort(([a],[b])=>a.localeCompare(b))) {
    valid(e && ['card','flashcard'].includes(e.kind) && key === entityKey(e), 'Identidade de atividade inválida.');
    for (const field of ['id','unitId','deck','title']) valid(typeof e[field] === 'string' && e[field].length > 0 && e[field].length <= 500, 'Referência de atividade inválida.');
    valid(Array.isArray(e.intervals) && e.intervals.length <= 20000, 'Intervalos inválidos.');
    const intervals = unionIntervals(e.intervals.map(pair => {
      valid(Array.isArray(pair) && pair.length === 2 && pair.every(epoch) && pair[1] >= pair[0], 'Intervalo inválido.');
      return [Math.max(pair[0],s.startedAt),Math.min(pair[1],s.endedAt)];
    }));
    const durationMs = duration(intervals);
    if (durationMs < STUDY_THRESHOLD) continue;
    valid(e.actions && typeof e.actions === 'object' && !Array.isArray(e.actions) && Object.keys(e.actions).length <= 5000, 'Ações inválidas.');
    const actions = Object.create(null);
    for (const [action, times] of Object.entries(e.actions).sort(([a],[b])=>a.localeCompare(b))) {
      valid(action.length > 0 && action.length <= 500 && !/[\u0000-\u001f]/.test(action) && Array.isArray(times) && times.length <= 50000 && times.every(epoch), 'Hora transacional inválida.');
      const filtered = times.filter(t=>t >= s.startedAt && t <= s.endedAt).sort((a,b)=>a-b);
      if (filtered.length) actions[action] = filtered;
    }
    const deck = decks[e.deck] ||= { durationMs: 0, cards: Object.create(null), flashcards: Object.create(null) };
    const target = e.kind === 'card' ? deck.cards : deck.flashcards;
    const id = e.kind === 'card' ? e.unitId : JSON.stringify([e.unitId,e.id]);
    valid(!Object.hasOwn(target,id),'Atividade duplicada.');
    target[id] = { title:e.title, durationMs, actions };
    if (!deckIntervals.has(e.deck)) deckIntervals.set(e.deck, []);
    deckIntervals.get(e.deck).push(...intervals);
  }
  for (const [deck,intervals] of deckIntervals) decks[deck].durationMs = duration(unionIntervals(intervals));
  return { version:1,id:s.id,projectId,startedAt:s.startedAt,endedAt:s.endedAt,reason:s.reason,decks };
}
