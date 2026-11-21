import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import YAML from 'yaml';
import { materialResources, materialURL } from './material.js';

export const STATUSES = ['A estudar', 'Estudando', 'Praticando', 'Em revisão', 'Concluído'];
export class RecallError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
export function ensure(condition, message, status) { if (!condition) throw new RecallError(message, status); }
export function text(value, label, max = 20000) {
  ensure(typeof value === 'string' && value.trim() && value.length <= max, `${label} inválido.`);
  return value.trim();
}
export function inside(root, relative) {
  ensure(typeof relative === 'string' && relative.length > 0 && !relative.includes('\\') && !path.isAbsolute(relative), 'Caminho relativo inválido.');
  const target = path.resolve(root, relative);
  ensure(target.startsWith(path.resolve(root) + path.sep), 'Caminho fora do diretório permitido.');
  let current = path.resolve(root);
  ensure(!fs.existsSync(current) || !fs.lstatSync(current).isSymbolicLink(), 'Links simbólicos não são aceitos.');
  for (const part of path.relative(root, target).split(path.sep)) {
    current = path.join(current, part);
    ensure(!fs.existsSync(current) || !fs.lstatSync(current).isSymbolicLink(), 'Links simbólicos não são aceitos.');
  }
  return target;
}
export function parseMarkdown(raw) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/);
  ensure(match, 'Markdown precisa de frontmatter YAML entre --- .');
  const data = YAML.parse(match[1], { maxAliasCount: 20 });
  ensure(data && typeof data === 'object' && !Array.isArray(data), 'Metadados YAML inválidos.');
  return { data, body: match[2].trim() };
}
function render(data, body = '') { return `---\n${YAML.stringify(data, { lineWidth: 0 }).trim()}\n---\n\n${body.trim()}\n`; }
function atomic(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  try { fs.writeFileSync(temp, content, { flag: 'wx' }); fs.renameSync(temp, file); }
  finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
}
function files(root, base = '') {
  if (!fs.existsSync(root)) return [];
  const result = [];
  for (const e of fs.readdirSync(root, { withFileTypes: true })) {
    ensure(!e.isSymbolicLink(), 'Links simbólicos não são aceitos no armazenamento.');
    const rel = path.posix.join(base, e.name);
    if (e.isDirectory()) result.push(...files(path.join(root, e.name), rel));
    else if (e.isFile() && e.name.endsWith('.md')) result.push(rel);
  }
  return result.sort();
}
function noteOrigin(origin) {
  if (origin === undefined) return {};
  ensure(typeof origin?.hash === 'string' && /^[a-f0-9]{64}$/.test(origin.hash)
    && typeof origin.id === 'string' && /^[0-9a-f-]{36}$/i.test(origin.id), 'Origem da anotação inválida.');
  return { noteOrigin: { id: origin.id, hash: origin.hash } };
}

function questions(input = []) {
  ensure(Array.isArray(input), 'Questões devem ser uma lista.');
  const ids = new Set();
  return input.map(q => {
    ensure(q && typeof q === 'object', 'Questão inválida.');
    const id = text(q.id || randomUUID(), 'ID da questão', 120);
    ensure(!ids.has(id), 'IDs de questões duplicados.'); ids.add(id);
    ensure(['choice', 'text'].includes(q.type), 'Tipo de questão: choice ou text.');
    const out = { id, type: q.type, prompt: text(q.prompt, 'Enunciado'), answer: q.answer, explanation: q.explanation || '' };
    if (q.type === 'choice') {
      ensure(Array.isArray(q.options) && q.options.length >= 2, 'Múltipla escolha exige ao menos duas alternativas.');
      out.options = q.options.map(o => text(o, 'Alternativa'));
      ensure(Number.isInteger(q.answer) && q.answer >= 0 && q.answer < out.options.length, 'Índice da alternativa correta inválido.');
    } else out.answer = text(q.answer, 'Resposta de referência');
    Object.assign(out, noteOrigin(q.noteOrigin));
    if (q.source) out.source = text(q.source, 'Fonte');
    return out;
  });
}
function cards(input = [], deck) {
  ensure(Array.isArray(input), 'Cartões de memorização devem ser uma lista.');
  const ids = new Set();
  return input.map(c => {
    const id = text(c.id || randomUUID(), 'ID do cartão', 120);
    ensure(!ids.has(id), 'IDs de cartões de memorização duplicados.'); ids.add(id);
    return { id, ...noteOrigin(c.noteOrigin), front: text(c.front, 'Frente'), back: text(c.back, 'Verso'), deck: text(c.deck || deck, 'Plano de estudo', 120), ...(c.source ? { source: text(c.source, 'Fonte') } : {}), ...(c.milestoneId ? { milestoneId: text(c.milestoneId, 'Fase', 120) } : {}) };
  });
}
function material(input) {
  ensure(Array.isArray(input) && input.length <= 100, 'Informe até 100 páginas de material.');
  const ids = new Set();
  return input.map(page => {
    ensure(page && typeof page === 'object', 'Página inválida.');
    const id = text(page.id || randomUUID(), 'ID da página', 120);
    ensure(!ids.has(id), 'IDs de páginas duplicados.');
    ids.add(id);
    ensure(Array.isArray(page.sections) && page.sections.length <= 100, 'Informe até 100 seções por página.');
    return { id, title: text(page.title, 'Título da página', 200), sections: page.sections.map(section => {
      ensure(section && typeof section === 'object', 'Seção inválida.');
      const { title = '', text: content = '', links = [] } = section;
      ensure(typeof title === 'string' && title.length <= 200, 'Título da seção inválido.');
      ensure(typeof content === 'string' && content.length <= 100000, 'Texto da seção inválido.');
      ensure(Array.isArray(links) && links.length <= 100, 'Informe até 100 links por seção.');
      return { title: title.trim(), text: content, links: links.map(link => {
        const value = text(link?.url, 'URL', 4000);
        ensure(materialURL(value), 'Use uma URL HTTP ou HTTPS válida.');
        const type = link.type || 'auto';
        ensure(['auto', 'link', 'video', 'image'].includes(type), 'Tipo de anexo inválido.');
        const label = link.label ? text(link.label, 'Rótulo do link', 200) : '';
        return { url: value, type, label };
      }) };
    }) };
  });
}

export function milestoneContains(milestone, item) {
  if (item.milestoneId) return item.milestoneId === milestone.id;
  return (milestone.units || []).includes(item.id)
    || (milestone.cards || []).some(member => member.unit === item.id)
    || (item.legacyMilestones || []).includes(milestone.id)
    || (item.cards || []).some(card => card.milestoneId === milestone.id);
}

export function deckMilestones(data, catalog, deck) {
  const deckCards = catalog.filter(card => card.deck === deck);
  const applicable = data.milestones.filter(milestone => deckCards.some(card => milestoneContains(milestone, card)));
  const associated = new Map();
  let required = false;
  for (const schedule of data.schedules) {
    const groups = schedule.groups.filter(group => group.type === 'milestone').map(group => group.id);
    if (!schedule.groups.some(group => group.type === 'deck' && group.id === deck)
      && !applicable.some(milestone => groups.includes(milestone.id))) continue;
    required = true;
    const selected = schedule.phases.map(phase => phase.milestoneId).filter(Boolean);
    for (const milestone of selected.length ? data.milestones.filter(item => selected.includes(item.id)) : applicable) {
      if (deckCards.some(card => milestoneContains(milestone, card))
        || (selected.length && !catalog.some(card => milestoneContains(milestone, card))
          && schedule.groups.some(group => group.type === 'deck' && group.id === deck))
        || (selected.length === 1 && schedule.groups.some(group => group.type === 'deck' && group.id === deck))) {
        associated.set(milestone.id, { id: milestone.id, name: milestone.name });
      }
    }
  }
  return { required, options: [...associated.values()] };
}

function retainHidden(previous, current, isHidden) {
  const restored = [...current];
  previous.forEach((entry, index) => {
    if (isHidden(entry)) restored.splice(index, 0, entry);
  });
  return restored;
}

export class Store {
  constructor(cwd = process.cwd()) {
    this.cwd = fs.realpathSync(path.resolve(cwd));
    this.root = inside(this.cwd, 'recall');
    this.tasks = inside(this.root, 'tasks');
  }
  init() {
    fs.mkdirSync(this.root, { recursive: true });
    const config = inside(this.root, 'config.yml');
    if (!fs.existsSync(config)) fs.writeFileSync(config, YAML.stringify({ version: 1, name: path.basename(this.cwd), backlogCommand: 'backlog' }), { flag: 'wx' });
    for (const dir of ['tasks', 'attempts', 'assessments', 'reviews']) fs.mkdirSync(inside(this.root, dir), { recursive: true });
    return this.config();
  }
  config() {
    const file = inside(this.root, 'config.yml');
    ensure(fs.existsSync(file), 'Execute recall init neste diretório primeiro.');
    return YAML.parse(fs.readFileSync(file, 'utf8'));
  }
  mutate(fn) {
    this.config();
    const lock = inside(this.root, '.write-lock');
    let fd;
    try { fd = fs.openSync(lock, 'wx'); } catch (e) { if (e.code === 'EEXIST') throw new RecallError('Outra operação está gravando. Tente novamente.', 409); throw e; }
    try { return fn(); } finally { fs.closeSync(fd); fs.unlinkSync(lock); }
  }
  schedule() {
    this.config();
    const file = inside(this.root, 'schedule.json');
    const data = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {
      version: 2,
      revision: 0,
      availability: { timeZone: 'America/Sao_Paulo', windows: [], overtimeHours: 0, overtimeMinutes: 20 },
      milestones: [],
      schedules: [],
      sessions: [],
      confirmations: [],
    };
    if (data.version === 1) {
      const minutes = data.availability.overtimeMinutes;
      data.availability.overtimeHours = Math.floor(minutes / 60);
      data.availability.overtimeMinutes = minutes % 60;
      data.version = 2;
    }
    ensure(data.version === 2, 'Versão do cronograma incompatível.', 409);
    return data;
  }
  scheduleCatalog(units = this.list()) {
    return units.map(unit => {
      const { videos, links } = materialResources(unit);
      return {
        kind: 'unit', unit: unit.id, id: unit.id, deck: unit.deck, front: unit.title,
        unitStatus: unit.status, statusChangedAt: unit.statusChangedAt || unit.updated,
        ...(unit.material?.length ? { materialPageCount: unit.material.length } : {}),
        ...(videos.length ? { materialVideos: videos } : {}),
        ...(links.length ? { materialLinks: links } : {}),
        ...(unit.milestoneId ? { milestoneId: unit.milestoneId } : {}),
        legacyMilestones: [...new Set((unit.cards || []).map(card => card.milestoneId).filter(Boolean))],
      };
    });
  }
  deckCatalog(units = this.list({ includeHidden: true })) {
    const file = inside(this.root, 'decks.json');
    const saved = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
    const known = new Set(saved.map(deck => deck.name));
    const discovered = new Set(units.flatMap(unit => [unit.deck, ...(unit.cards || []).map(card => card.deck)]));
    return [...saved, ...[...discovered].filter(name => name && !known.has(name))
      .sort((a, b) => a.localeCompare(b, 'pt-BR')).map(name => ({ name, status: 'active' }))];
  }
  hiddenDecks() {
    return new Set(this.deckCatalog([]).filter(deck => deck.status !== 'active').map(deck => deck.name));
  }
  changeDeck(input) {
    return this.mutate(() => {
      const name = text(input?.name, 'Nome do plano de estudo', 120);
      const decks = this.deckCatalog();
      const index = decks.findIndex(deck => deck.name === name);
      const deck = decks[index];
      switch (input.action) {
        case 'create':
          ensure(!deck, 'Já existe um registro com esse nome de plano de estudo.', 409);
          decks.push({ name, status: 'active' });
          break;
        case 'archive':
          ensure(deck?.status === 'active', 'Plano de estudo ativo não encontrado.', 404);
          deck.status = 'archived';
          break;
        case 'restore':
          ensure(deck?.status === 'archived', 'Plano de estudo arquivado não encontrado.', 404);
          deck.status = 'active';
          break;
        case 'remove':
          ensure(deck && deck.status !== 'removed', 'Plano de estudo não encontrado.', 404);
          ensure(input.confirmation === name, 'Digite o nome exato do plano de estudo para confirmar.');
          deck.status = 'removed';
          break;
        case 'up':
        case 'down': {
          ensure(deck?.status === 'active', 'Plano de estudo ativo não encontrado.', 404);
          const step = input.action === 'up' ? -1 : 1;
          let neighbor = index + step;
          while (decks[neighbor] && decks[neighbor].status !== 'active') neighbor += step;
          if (decks[neighbor]) [decks[index], decks[neighbor]] = [decks[neighbor], decks[index]];
          break;
        }
        default:
          throw new RecallError('Ação de plano de estudo inválida.');
      }
      atomic(inside(this.root, 'decks.json'), JSON.stringify(decks, null, 2) + '\n');
      return decks.filter(item => item.status !== 'removed');
    });
  }
  scheduleSnapshot() {
    const source = this.schedule();
    const units = this.list({ includeHidden: true });
    const hidden = this.hiddenDecks();
    const items = this.scheduleCatalog(units.filter(unit => !hidden.has(unit.deck)));
    const revision = createHash('sha256').update(JSON.stringify([source, items, [...hidden].sort()])).digest('hex');
    if (!hidden.size) return { data: source, items, revision };
    const hiddenItems = this.scheduleCatalog(units.filter(unit => hidden.has(unit.deck)));
    const hiddenIds = new Set(hiddenItems.map(unit => unit.id));
    const hiddenMilestones = new Set(source.milestones.filter(milestone =>
      hiddenItems.some(item => milestoneContains(milestone, item)) && !items.some(item => milestoneContains(milestone, item))
    ).map(milestone => milestone.id));
    const groupHidden = group => group.type === 'deck' ? hidden.has(group.id) : hiddenMilestones.has(group.id);
    const phaseHidden = phase => hiddenMilestones.has(phase.milestoneId);
    const schedules = source.schedules.map(schedule => ({
      ...schedule, groups: schedule.groups.filter(group => !groupHidden(group)), phases: schedule.phases.filter(phase => !phaseHidden(phase)),
      ...(schedule.studyEstimates ? { studyEstimates: schedule.studyEstimates.filter(entry => !hiddenIds.has(entry.unit)) } : {}),
    })).filter(schedule => schedule.groups.length && schedule.phases.length);
    const activeSchedules = new Set(schedules.map(schedule => schedule.id));
    const hiddenSchedule = schedule => !activeSchedules.has(schedule.id);
    const hiddenEntry = session => hiddenIds.has(session.card.unit) || hidden.has(session.card.deck)
      || (session.schedules.length > 0 && session.schedules.every(id => !activeSchedules.has(id)));
    const onlyActive = session => ({ ...session, schedules: session.schedules.filter(id => activeSchedules.has(id)) });
    const data = {
      ...source, schedules, milestones: source.milestones.filter(milestone => !hiddenMilestones.has(milestone.id)),
      sessions: source.sessions.filter(session => !hiddenEntry(session)).map(onlyActive),
      confirmations: source.confirmations.filter(session => !hiddenEntry(session)).map(onlyActive),
      ...(source.rests ? { rests: source.rests.filter(rest => activeSchedules.has(rest.scheduleId)) } : {}),
    };
    const restore = next => {
      const erased = new Set(schedules.filter(s => !next.schedules.some(current => current.id === s.id)).map(s => s.id));
      const hideRefs = session => session.schedules.filter(id => !erased.has(id));
      const busy = [...next.sessions, ...next.confirmations];
      const mergeEntries = (old, current, pending) => {
        const oldById = new Map(old.map(entry => [entry.id, entry]));
        const currentIds = new Set(current.map(entry => entry.id));
        const visible = current.map(entry => ({ ...entry, schedules: [...new Set([
          ...entry.schedules, ...(oldById.get(entry.id)?.schedules || []).filter(id => !activeSchedules.has(id)),
        ])] }));
        const retained = old.map(entry => ({
          ...entry,
          schedules: hiddenEntry(entry) ? hideRefs(entry) : hideRefs(entry).filter(id => !activeSchedules.has(id)),
        }));
        return retainHidden(retained, visible, (entry) => !currentIds.has(entry.id)
          && (hiddenEntry(oldById.get(entry.id)) || entry.schedules.length > 0)
          && (!pending || (entry.schedules.length && !busy.some(slot => slot.start < entry.end && slot.end > entry.start))));
      };
      return {
        ...next,
        schedules: retainHidden(source.schedules, next.schedules.map(schedule => {
          const old = source.schedules.find(item => item.id === schedule.id);
          return old ? { ...schedule, groups: retainHidden(old.groups, schedule.groups, groupHidden),
            phases: retainHidden(old.phases, schedule.phases, phaseHidden),
            ...(old.studyEstimates || schedule.studyEstimates ? {
              studyEstimates: retainHidden(old.studyEstimates || [], schedule.studyEstimates || [], entry => hiddenIds.has(entry.unit)),
            } : {}) } : schedule;
        }), hiddenSchedule),
        milestones: retainHidden(source.milestones, next.milestones, milestone => hiddenMilestones.has(milestone.id)),
        sessions: mergeEntries(source.sessions, next.sessions, true),
        confirmations: mergeEntries(source.confirmations, next.confirmations, false),
        ...(next.rests ? { rests: retainHidden(source.rests || [], next.rests, rest => !activeSchedules.has(rest.scheduleId)) } : {}),
      };
    };
    return { data, items, revision, restore };
  }
  updateSchedule(revision, update) {
    return this.mutate(() => {
      const snapshot = this.scheduleSnapshot();
      ensure(revision === snapshot.revision, 'O cronograma mudou. Gere uma nova prévia.', 409);
      const data = update(snapshot);
      data.revision = snapshot.data.revision + 1;
      atomic(inside(this.root, 'schedule.json'), JSON.stringify(snapshot.restore ? snapshot.restore(data) : data, null, 2) + '\n');
      return data;
    });
  }
  unitMilestoneOptions(deck) {
    const snapshot = this.scheduleSnapshot();
    return deckMilestones(snapshot.data, snapshot.items, deck);
  }
  saveMilestone(revision, input, id) {
    return this.updateSchedule(revision, ({ data, items }) => {
      const units = input?.units ?? input?.cards?.map(card => card.unit);
      ensure(Array.isArray(units), 'Informe as fichas de conteúdo do capítulo.');
      const available = new Set(items.map(item => item.id));
      ensure(units.every(unit => available.has(unit)), 'O capítulo contém uma ficha de conteúdo indisponível.');
      const milestone = { id: id || randomUUID(), name: text(input.name, 'Nome do capítulo', 1000), units: [...new Set(units)] };
      const index = id ? data.milestones.findIndex(item => item.id === id) : data.milestones.length;
      ensure(index >= 0, 'Capítulo não encontrado.', 404);
      if (id) {
        const hidden = this.hiddenDecks();
        const old = data.milestones[index];
        for (const unit of this.list({ includeHidden: true })) {
          if (hidden.has(unit.deck) && milestoneContains(old, unit)) milestone.units.push(unit.id);
        }
      }
      data.milestones[index] = milestone;
      return data;
    });
  }
  list({ includeHidden = false } = {}) {
    this.config();
    const list = files(this.tasks).map(file => {
      const raw = fs.readFileSync(inside(this.tasks, file), 'utf8');
      const { data, body } = parseMarkdown(raw);
      ensure(typeof data.id === 'string' && data.id, `ID ausente: ${file}`);
      ensure(STATUSES.includes(data.status), `Status inválido: ${file}`);
      return { ...data, file, description: body, version: createHash('sha256').update(raw).digest('hex') };
    });
    ensure(new Set(list.map(u => u.id)).size === list.length, 'IDs de unidades duplicados; corrija os arquivos antes de continuar.', 409);
    if (includeHidden) return list;
    const hidden = this.hiddenDecks();
    return list.filter(unit => !hidden.has(unit.deck));
  }
  get(id) { const unit = this.list().find(u => u.id === id); ensure(unit, 'Unidade não encontrada.', 404); return unit; }
  save(input, id) {
    return this.mutate(() => {
      const old = id ? this.get(id) : null;
      const units = this.list({ includeHidden: true });
      const hidden = this.hiddenDecks();
      const nextId = old?.id || `RCL-${Math.max(0, ...units.map(u => Number(u.id.match(/^RCL-(\d+)$/)?.[1] || 0))) + 1}`;
      const title = text(input.title ?? old?.title, 'Título', 200);
      const deck = text(input.deck ?? old?.deck ?? 'Geral', 'Plano de estudo', 120);
      ensure(!hidden.has(deck), 'Plano de estudo indisponível.', 409);
      const status = input.status ?? old?.status ?? STATUSES[0];
      ensure(STATUSES.includes(status), 'Status inválido.');
      const description = input.description ?? old?.description ?? '';
      ensure(typeof description === 'string' && description.length <= 100000, 'Descrição inválida.');
      const file = old?.file || input.file || `${nextId.toLowerCase()} - ${title.replace(/[^\p{L}\p{N} -]/gu, '').slice(0, 90) || 'etapa'}.md`;
      ensure(file.endsWith('.md'), 'Arquivo deve terminar em .md.');
      const target = inside(this.tasks, file);
      ensure(old || !fs.existsSync(target), 'Já existe um arquivo nesse caminho.', 409);
      if (old && input.version) ensure(input.version === old.version, 'Unidade mudou. Reabra antes de salvar.', 409);
      const { file: oldFile, description: oldDescription, version: oldVersion, ...oldData } = old || {};
      const data = {
        ...oldData, id: nextId, title, status, deck,
        created: old?.created || new Date().toISOString(), updated: new Date().toISOString(),
        statusChangedAt: old?.status === status ? (old.statusChangedAt || old.updated) : new Date().toISOString(),
        sources: input.sources ?? old?.sources ?? [],
        questions: questions(input.questions ?? old?.questions), cards: cards(input.cards ?? old?.cards, deck),
        ...(old?.backlog ? { backlog: old.backlog } : {})
      };
      ensure(data.cards.every(card => !hidden.has(card.deck) ||
        old?.cards?.some(previous => previous.id === card.id && previous.deck === card.deck)), 'Plano de estudo do cartão de memorização indisponível.', 409);
      if (input.material !== undefined) data.material = material(input.material);
      const milestoneId = input.milestoneId ?? old?.milestoneId;
      if (!old || old.deck !== deck || input.milestoneId !== undefined) {
        const agenda = this.schedule();
        const { required, options } = deckMilestones(agenda, this.scheduleCatalog(units), deck);
        if (required) {
          ensure(options.some(option => option.id === milestoneId), 'Selecione um capítulo do cronograma para a ficha de conteúdo.');
        } else if (milestoneId) {
          ensure(agenda.milestones.some(item => item.id === milestoneId), 'Capítulo indisponível.');
        }
      }
      if (milestoneId) data.milestoneId = milestoneId;
      else delete data.milestoneId;
      ensure(Array.isArray(data.sources) && data.sources.every(s => typeof s === 'string'), 'Fontes devem ser uma lista de textos.');
      atomic(target, render(data, description));
      return this.get(nextId);
    });
  }
  link(id, context) {
    return this.mutate(() => {
      const { file, description, version, ...data } = this.get(id);
      data.backlog = context;
      atomic(inside(this.tasks, file), render(data, description));
      return this.get(id);
    });
  }
  events(kind, unit) {
    return files(inside(this.root, kind)).map(f => parseMarkdown(fs.readFileSync(inside(this.root, `${kind}/${f}`), 'utf8')).data)
      .filter(e => !unit || e.unit === unit).sort((a, b) => a.created.localeCompare(b.created));
  }
  event(kind, data) {
    const record = { id: randomUUID(), created: new Date().toISOString(), ...data };
    fs.writeFileSync(inside(this.root, `${kind}/${record.id}.md`), render(record), { flag: 'wx' });
    return record;
  }
  attempt(id, answers) {
    return this.mutate(() => {
      const unit = this.get(id);
      ensure(Array.isArray(unit.questions) && unit.questions.length, 'Esta unidade não possui questões.');
      ensure(answers && typeof answers === 'object' && !Array.isArray(answers), 'Respostas inválidas.');
      const result = unit.questions.map(q => {
        const value = answers[q.id];
        if (q.type === 'choice') ensure(Number.isInteger(value) && value >= 0 && value < q.options.length, `Responda: ${q.prompt}`);
        else text(value, `Resposta: ${q.prompt}`);
        return { question: q.id, prompt: q.prompt, type: q.type, answer: value,
          correct: q.type === 'choice' ? value === q.answer : null,
          reference: q.type === 'choice' ? q.options[q.answer] : q.answer,
          explanation: q.explanation || '', ...(q.options ? { options: q.options } : {}) };
      });
      return this.event('attempts', { unit: id, version: unit.version, results: result });
    });
  }
  assess(attemptId, question, correct) {
    return this.mutate(() => {
      const attempt = this.events('attempts').find(a => a.id === attemptId);
      ensure(attempt, 'Tentativa não encontrada.', 404);
      this.get(attempt.unit);
      ensure(attempt.results.some(r => r.question === question && r.type === 'text'), 'Questão de texto não encontrada.');
      ensure(typeof correct === 'boolean', 'Autoavaliação deve ser true ou false.');
      return this.event('assessments', { unit: attempt.unit, attempt: attemptId, question, correct, method: 'self' });
    });
  }
  reviewQueue({ deck, due = false } = {}) {
    const reviews = this.events('reviews');
    const hidden = this.hiddenDecks();
    return this.list().flatMap(u => (u.cards || []).filter(card => !hidden.has(card.deck)).map(c => {
      const contentVersion = createHash('sha256').update(JSON.stringify([c.front, c.back])).digest('hex');
      const previous = reviews.filter(r => r.unit === u.id && r.card === c.id && r.version === contentVersion).at(-1);
      return { ...c, unit: u.id, title: u.title, version: contentVersion, due: previous?.due || null, interval: previous?.interval || 0 };
    })).filter(c => (!deck || c.deck === deck) && (!due || !c.due || Date.parse(c.due) <= Date.now()));
  }
  review(id, cardId, rating) {
    return this.mutate(() => {
      ensure(['again', 'hard', 'good', 'easy'].includes(rating), 'Avaliação: again, hard, good ou easy.');
      const card = this.reviewQueue().find(c => c.unit === id && c.id === cardId);
      ensure(card, 'Cartão de memorização não encontrado.', 404);
      const interval = rating === 'again' ? 0 : rating === 'hard' ? 1 : Math.max(rating === 'easy' ? 4 : 2, card.interval * (rating === 'easy' ? 3 : 2));
      const due = new Date(Date.now() + (interval ? interval * 86400000 : 600000)).toISOString();
      return this.event('reviews', { unit: id, card: cardId, version: card.version, rating, interval, due });
    });
  }
  cardFromQuestion(id, questionId) {
    const u = this.get(id), q = u.questions.find(q => q.id === questionId);
    ensure(q, 'Questão não encontrada.', 404);
    const card = { id: `q-${q.id}`, ...noteOrigin(q.noteOrigin), front: q.prompt, back: q.type === 'choice' ? q.options[q.answer] : q.answer, deck: u.deck, ...(q.source ? { source: q.source } : {}) };
    ensure(!u.cards.some(c => c.id === card.id), 'Já existe um cartão de memorização para esta questão.', 409);
    return this.save({ cards: [...u.cards, card], version: u.version }, id);
  }
  publicUnit(u, hidden = this.hiddenDecks()) { return { ...u, cards: (u.cards || []).filter(card => !hidden.has(card.deck)), questions: (u.questions || []).map(({ answer, explanation, ...q }) => q) }; }
}
