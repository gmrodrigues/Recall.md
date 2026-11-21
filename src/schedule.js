import { DEFAULT_LINK_MINUTES, materialURL } from './material.js';
import { randomUUID } from 'node:crypto';
import { ensure, milestoneContains, text } from './core.js';

export const STUDY = 'Em estudo';
export const cardKey = card => JSON.stringify([card.unit, card.id]);
export const phaseKey = (card, phase) => JSON.stringify([card.unit, card.id, phase]);

function integer(value, min, max, label) {
  ensure(Number.isSafeInteger(value) && value >= min && value <= max, `${label} inválido.`);
  return value;
}

function wallMinute(value) {
  ensure(typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value), 'Horário inválido.');
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
}

export function availability(input) {
  ensure(input && Array.isArray(input.windows), 'Informe as janelas de estudo.');
  const timeZone = text(input.timeZone, 'Fuso horário', 100);
  try { new Intl.DateTimeFormat('pt-BR', { timeZone }); }
  catch { ensure(false, 'Fuso horário inválido.'); }
  const windows = input.windows.map(window => {
    const day = integer(window?.day, 0, 6, 'Dia da semana');
    const start = wallMinute(window.start);
    const end = window.end === '24:00' ? 1440 : wallMinute(window.end);
    ensure(start < end, 'A janela deve terminar depois do início no mesmo dia.');
    return { day, start: window.start, end: window.end };
  }).sort((a, b) => a.day - b.day || a.start.localeCompare(b.start));
  for (let i = 1; i < windows.length; i++) {
    const previous = windows[i - 1];
    const current = windows[i];
    ensure(current.day !== previous.day || current.start >= previous.end, 'As janelas não podem se sobrepor.');
  }
  const overtimeHours = integer(input.overtimeHours, 0, 168, 'Horas extras por semana');
  const overtimeMinutes = integer(input.overtimeMinutes, 0, 59, 'Minutos extras por semana');
  ensure(overtimeHours * 60 + overtimeMinutes <= 10080, 'A tolerância semanal não pode ultrapassar 168 horas.');
  const overrides = input.linkMinutesByDomain ?? [];
  ensure(Array.isArray(overrides) && overrides.length <= 2000, 'Informe até 2.000 médias por domínio.');
  const domains = new Set();
  const linkMinutesByDomain = overrides.map(entry => {
    const domain = text(entry?.domain, 'Domínio', 253);
    ensure(materialURL('https://' + domain)?.hostname === domain && !domains.has(domain), 'Domínio inválido ou repetido.');
    domains.add(domain);
    return { domain, minutes: integer(entry.minutes, 0, 1440, 'Minutos por link') };
  }).filter(entry => entry.minutes !== DEFAULT_LINK_MINUTES);
  return { timeZone, windows, overtimeHours, overtimeMinutes, ...(linkMinutesByDomain.length ? { linkMinutesByDomain } : {}) };
}

function cardsInGroup(group, data, cards) {
  if (group.type === 'deck') return cards.filter(card => card.deck === group.id);
  const milestone = data.milestones.find(item => item.id === group.id);
  if (!milestone) return [];
  const catalog = new Map(cards.map(card => [card.id, card]));
  const ids = milestone.units || (milestone.cards || []).map(member => member.unit);
  const named = ids.map(id => catalog.get(id)).filter(card => card && milestoneContains(milestone, card));
  return [...named, ...cards.filter(card => milestoneContains(milestone, card))];
}

function groupRows(schedule, data, cards) {
  const seen = new Set();
  return schedule.groups.map(group => ({
    group,
    cards: cardsInGroup(group, data, cards).filter(card => {
      const key = cardKey(card);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
  })).filter(row => row.cards.length);
}

function orderRows(rows, mode) {
  if (mode === 'sequential') return rows;
  const ordered = [];
  const count = Math.max(0, ...rows.map(row => row.cards.length));
  for (let i = 0; i < count; i++) {
    for (const row of rows) if (row.cards[i]) ordered.push({ ...row, cards: [row.cards[i]] });
  }
  return ordered;
}

export function resolveGroups(schedule, data, cards) {
  return orderRows(groupRows(schedule, data, cards), schedule.mode).map(row => row.cards);
}

function scheduledUnits(data, cards, except) {
  const covered = new Set();
  for (const schedule of data.schedules.filter(item => item.id !== except)) {
    for (const batch of workBatches(schedule, data, cards)) {
      for (const card of batch.cards) covered.add(card.id);
    }
  }
  return covered;
}

export function scheduleGroupOptions(data, cards) {
  const groups = [
    ...[...new Set(cards.map(card => card.deck))].sort().map(id => ({ id, type: 'deck', name: id })),
    ...data.milestones.map(item => ({ id: item.id, type: 'milestone', name: item.name })),
  ];
  const coverage = new Map(data.schedules.map(schedule => [schedule.id, new Set(
    workBatches(schedule, data, cards).flatMap(batch => batch.cards.map(card => card.id))
  )]));
  return groups.flatMap(group => {
    const units = [...new Set(cardsInGroup(group, data, cards).map(card => card.id))];
    if (!units.length) return [];
    return [{ ...group, units, assignedTo: [...coverage].filter(([, covered]) => units.some(unit => covered.has(unit))).map(([id]) => id) }];
  });
}

function scheduleDate(date, label) {
  const iso = new Date(`${date}T00:00:00Z`);
  ensure(typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)
    && Number.isFinite(+iso) && iso.toISOString().slice(0, 10) === date, `${label} inválida.`);
  return date;
}

function dateInSchedule(schedule, date) {
  return (!schedule.startDate || date >= schedule.startDate) && date <= schedule.deadline;
}

function median(sorted) {
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function typicalDurations(samples) {
  if (samples.length < 3) return samples;
  const center = median([...samples].sort((a, b) => a - b));
  const deviations = samples.map(value => Math.abs(value - center)).sort((a, b) => a - b);
  const limit = Math.max(1, center * 0.2, median(deviations) * 1.4826 * 3);
  return samples.filter(value => Math.abs(value - center) <= limit);
}

function estimateVideos(input, included, previous, sameScope) {
  const videos = new Set(included.flatMap(card => (card.materialVideos || []).map(video => video.id)));
  const fallback = videos.size && sameScope
    ? { seconds: previous?.videoAverageSeconds, count: previous?.videoSampleCount } : {};
  if (input.videoSamples === undefined) return fallback;
  ensure(Array.isArray(input.videoSamples) && input.videoSamples.length <= 5, 'Informe até cinco durações de vídeo.');
  const sampled = new Map();
  for (const sample of input.videoSamples) {
    ensure(videos.has(sample?.id) && !sampled.has(sample.id)
      && Number.isFinite(sample.seconds) && sample.seconds > 0 && sample.seconds <= 86400, 'Amostra de vídeo inválida.');
    sampled.set(sample.id, sample.seconds);
  }
  if (!sampled.size) return fallback;
  const typical = typicalDurations([...sampled.values()]);
  return { seconds: typical.reduce((sum, seconds) => sum + seconds, 0) / typical.length, count: typical.length };
}

export function editSchedule(data, cards, input) {
  ensure(input && ['sequential', 'round-robin'].includes(input.mode), 'Distribuição inválida.');
  ensure(Array.isArray(input.groups) && input.groups.length, 'Selecione planos de estudo ou capítulos.');
  const modern = input.groups.some(group => group && Object.hasOwn(group, 'minutes'));
  const groups = input.groups.map(group => {
    const exists = group?.type === 'deck' ? cards.some(card => card.deck === group.id)
      : group?.type === 'milestone' && data.milestones.some(milestone => milestone.id === group.id);
    ensure(exists, 'Plano de estudo ou capítulo indisponível.');
    return { type: group.type, id: group.id,
      ...(modern ? { minutes: integer(group.minutes, 1, 1440, 'Minutos por ficha') } : {}) };
  });
  const name = text(input.name, 'Nome do cronograma', 1000);
  const included = resolveGroups({ groups, mode: input.mode }, data, cards).flat();
  ensure(included.length, 'Selecione pelo menos uma ficha de conteúdo.');
  let phases;
  if (!modern) ensure(Array.isArray(input.phases) && input.phases.length, 'Selecione pelo menos um capítulo.');
  if (modern) {
    const previous = data.schedules.find(item => item.id === input.id);
    const existingKeys = new Set(previous?.groups.map(group => JSON.stringify([group.type, group.id])));
    const assigned = scheduledUnits(data, cards, input.id);
    const picked = new Set();
    const includedUnits = new Set();
    const uncoveredDecks = [];
    for (const group of groups) {
      const key = JSON.stringify([group.type, group.id]);
      const units = [...new Set(cardsInGroup(group, data, cards).map(card => card.id))];
      ensure(units.length && !picked.has(key), 'Selecione um plano ou capítulo diferente em cada linha.');
      ensure(existingKeys.has(key) || units.every(id => !assigned.has(id)), 'Parte do conteúdo já está em outro cronograma.');
      ensure(existingKeys.has(key) || units.every(id => !includedUnits.has(id)), 'As fichas já aparecem em outro grupo deste cronograma.');
      picked.add(key);
      for (const id of units) includedUnits.add(id);
      if (group.type === 'deck' && !data.milestones.some(m => included.some(card =>
        card.deck === group.id && milestoneContains(m, card)))) uncoveredDecks.push(group.id);
    }
    for (const deck of uncoveredDecks) {
      const chapterName = uncoveredDecks.length === 1 ? name : name + ' · ' + deck;
      data.milestones.push({ id: randomUUID(), name: chapterName, units: included.filter(card => card.deck === deck).map(card => card.id) });
    }
    phases = [{ name: STUDY, minutes: groups[0].minutes }];
  } else if (input.phases.some(phase => phase && Object.hasOwn(phase, 'milestoneId'))) {
    const candidates = data.milestones.filter(milestone => included.some(card => milestoneContains(milestone, card))
      || !cards.some(card => milestoneContains(milestone, card)));
    let automatic;
    if (!candidates.length && input.phases.length === 1 && input.phases[0].milestoneId === '') {
      automatic = { id: randomUUID(), name, units: included.map(card => card.id) };
      data.milestones.push(automatic);
      candidates.push(automatic);
    }
    phases = input.phases.map(phase => {
      const milestone = candidates.find(item => item.id === (phase?.milestoneId || automatic?.id));
      ensure(milestone, 'Selecione um capítulo disponível para o conteúdo.');
      return { name: milestone.name, milestoneId: milestone.id, minutes: integer(phase.minutes, 1, 1440, 'Minutos por ficha') };
    });
    ensure(new Set(phases.map(phase => phase.milestoneId)).size === phases.length, 'Selecione cada capítulo uma única vez.');
  } else {
    ensure(input.phases[0]?.name === STUDY, 'O primeiro capítulo deve ser Em estudo.');
    phases = input.phases.map(phase => ({
      name: text(phase?.name, 'Nome do capítulo', 80),
      minutes: integer(phase?.minutes, 1, 1440, 'Minutos por ficha'),
    }));
    ensure(new Set(phases.map(phase => phase.name)).size === phases.length, 'Os nomes dos capítulos devem ser únicos.');
  }
  const deadline = scheduleDate(input.deadline, 'Data limite');
  const startDate = input.startDate ? scheduleDate(input.startDate, 'Data de início') : '';
  ensure(!startDate || startDate <= deadline, 'A data de início deve ser anterior ou igual ao prazo.');
  const previous = data.schedules.find(item => input.id && item.id === input.id);
  const scope = entries => entries?.map(group => [group.type, group.id]);
  const sameScope = JSON.stringify(scope(previous?.groups)) === JSON.stringify(scope(groups))
    && JSON.stringify(previous?.phases.map(phase => phase.milestoneId || phase.name))
      === JSON.stringify(phases.map(phase => phase.milestoneId || phase.name));
  const selected = included.filter(card => modern || !phases.some(phase => phase.milestoneId)
    || data.milestones.some(milestone => phases.some(phase => phase.milestoneId === milestone.id) && milestoneContains(milestone, card)));
  const video = estimateVideos(input, selected, previous, sameScope);
  const schedule = {
    id: input.id || randomUUID(), name,
    ...(video.seconds ? { videoAverageSeconds: video.seconds, ...(video.count ? { videoSampleCount: video.count } : {}) } : {}),
    deadline, ...(startDate ? { startDate } : {}), groups, phases, mode: input.mode, priority: integer(input.priority, 0, 999, 'Prioridade'),
  };
  const index = input.id ? data.schedules.findIndex(item => item.id === input.id) : data.schedules.length;
  ensure(index >= 0, 'Cronograma não encontrado.', 404);
  data.schedules[index] = schedule;
}

export function configureSchedule(snapshot, input) {
  ensure(input && typeof input === 'object', 'Configuração inválida.');
  const data = structuredClone(snapshot.data);
  if (input.availability !== undefined) data.availability = availability(input.availability);
  if (input.schedule !== undefined) editSchedule(data, snapshot.items, input.schedule);
  return data;
}

// The browser submits an opaque reference. Only the server-generated plan is applied.
export function schedulePreviews(store, plan) {
  const pending = new Map();
  const maxAge = 15 * 60 * 1000;
  function expire() {
    const now = Date.now();
    for (const [id, preview] of pending) {
      if (now - preview.createdAt >= maxAge) pending.delete(id);
    }
  }
  return {
    create(input) {
      expire();
      const snapshot = store.scheduleSnapshot();
      ensure(input?.revision === snapshot.revision, 'O cronograma mudou. Atualize a página.', 409);
      const configured = configureSchedule(snapshot, input);
      const { data, summary, restUsage, workflow, pending: pendingStages } = plan(configured, snapshot.items, undefined, snapshot.data);
      const id = randomUUID();
      pending.set(id, { data, revision: snapshot.revision, createdAt: Date.now() });
      if (pending.size > 20) pending.delete(pending.keys().next().value);
      return { id, summary, sessions: data.sessions, schedules: data.schedules, rests: data.rests || [], restUsage: restUsage || [], workflowCompletions: workflow || [], pendingPlacement: pendingStages || [] };
    },
    apply(id) {
      expire();
      const preview = pending.get(id);
      ensure(preview, 'Prévia indisponível. Gere uma nova proposta.', 409);
      const result = store.updateSchedule(preview.revision, () => structuredClone(preview.data));
      pending.delete(id);
      return result;
    },
  };
}

const MINUTE = 60_000;
const PLANNING_DAYS = 180;

function calendar(settings) {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: settings.timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  const windows = settings.windows.map(window => ({
    day: window.day, start: wallMinute(window.start),
    end: window.end === '24:00' ? 1440 : wallMinute(window.end),
  }));
  let hourKey;
  let offset;
  return function at(minute) {
    // Offset is resolved for the actual UTC instant, including repeated local times.
    const timestamp = minute * MINUTE;
    const parts = formatter.formatToParts(timestamp);
    const get = name => parts.find(part => part.type === name).value;
    const date = `${get('year')}-${get('month')}-${get('day')}`;
    if (hourKey !== date) {
      hourKey = date;
      const midnight = Date.parse(date);
      const weekday = new Date(midnight).getUTCDay();
      offset = { week: midnight - ((weekday + 6) % 7) * 86400000, windows: windows.filter(window => window.day === weekday) };
    }
    const time = Number(get('hour')) * 60 + Number(get('minute'));
    const regular = offset.windows.some(window => window.start <= time && time < window.end);
    const extra = offset.windows.length > 0 && time >= offset.windows.at(-1).end;
    return { date, week: offset.week, regular, extra };
  };
}

function workBatches(schedule, data, cards) {
  if (schedule.groups.some(group => Number.isInteger(group.minutes))) {
    return orderRows(groupRows(schedule, data, cards), schedule.mode).map(({ group, cards }) => ({
      cards,
      phases: [{ name: STUDY, minutes: group.minutes ?? schedule.phases[0].minutes,
        milestoneName: group.type === 'milestone' ? data.milestones.find(item => item.id === group.id)?.name : undefined }],
    }));
  }
  const groups = resolveGroups(schedule, data, cards);
  if (!schedule.phases.some(phase => phase.milestoneId)) {
    return groups.map(cards => ({ cards, phases: schedule.phases }));
  }
  const milestones = new Map(data.milestones.map(milestone => [milestone.id, milestone]));
  const seen = new Set();
  return schedule.phases.flatMap(phase => {
    const milestone = milestones.get(phase.milestoneId);
    if (!milestone) return [];
    const study = { ...phase, name: STUDY, milestoneName: milestone.name };
    return groups.flatMap(group => {
      const selected = group.filter(card => {
        const key = cardKey(card);
        if (seen.has(key) || !milestoneContains(milestone, card)) return false;
        seen.add(key);
        return true;
      });
      return selected.length ? [{ cards: selected, phases: [study] }] : [];
    });
  });
}

function phaseSuperseded(status, phase) {
  return status === 'Concluído' || (phase === STUDY && status === 'Em revisão');
}

function studyEffort(card, phase, baseMinutes, videoSeconds = 0, linkMinutes) {
  const pageMinutes = phase === STUDY ? (card.materialPageCount || 0) * 5 : 0;
  const videoMinutes = phase === STUDY ? Math.ceil((card.materialVideos?.length || 0) * videoSeconds / 60) : 0;
  const externalMinutes = phase === STUDY ? (card.materialLinks || []).reduce((minutes, { domain, count }) =>
    minutes + count * (linkMinutes?.get(domain) ?? DEFAULT_LINK_MINUTES), 0) : 0;
  return {
    unit: card.unit, baseMinutes, pageMinutes, videoMinutes, linkMinutes: externalMinutes,
    estimatedMinutes: baseMinutes + pageMinutes + videoMinutes + externalMinutes,
  };
}

function buildWork(data, cards) {
  const tasks = new Map();
  const linkMinutes = new Map((data.availability.linkMinutesByDomain || []).map(entry => [entry.domain, entry.minutes]));
  const ordered = [...data.schedules].sort((a, b) =>
    b.priority - a.priority || a.deadline.localeCompare(b.deadline) || a.id.localeCompare(b.id));
  const completed = new Map();
  const averages = new Map();
  for (const entry of data.confirmations) {
    if (entry.card.kind !== 'unit') continue;
    const key = phaseKey(entry.card, entry.phase);
    const result = completed.get(key) || { planned: 0, actual: 0, entries: [] };
    result.planned += entry.plannedMinutes;
    result.actual += entry.actualMinutes;
    result.entries.push(entry);
    completed.set(key, result);
    if (entry.completed) {
      const list = averages.get(entry.phase) || [];
      const material = entry.materialMinutes ?? studyEffort(entry.card, entry.phase, 0).estimatedMinutes;
      list.push(Math.max(1, result.actual - material));
      averages.set(entry.phase, list);
    }
  }
  const baseAverages = new Map([...averages].map(([phase, samples]) => {
    const typical = typicalDurations(samples);
    return [phase, Math.ceil(typical.reduce((total, value) => total + value, 0) / typical.length)];
  }));
  const requirements = ordered.map(schedule => {
    const jobs = [];
    let preceding = [];
    for (const { cards: group, phases } of workBatches(schedule, data, cards)) {
      const last = [];
      for (const card of group) {
        let dependencies = preceding;
        for (const phase of phases) {
          const key = phaseKey(card, phase.name);
          const base = baseAverages.get(phase.name) ?? phase.minutes;
          const effort = studyEffort(card, phase.name, base, schedule.videoAverageSeconds, linkMinutes);
          const estimate = effort.estimatedMinutes;
          const task = tasks.get(key) || {
            key, card, phase: phase.name, estimate: 0, coverage: [],
            confirmed: completed.get(key), dependencies: new Set(),
            superseded: phaseSuperseded(card.unitStatus, phase.name),
          };
          task.milestoneName ||= phase.milestoneName;
          if (!task.effort || estimate >= task.effort.estimatedMinutes) {
            task.effort = effort;
            task.materialMinutes = estimate - base;
          }
          task.estimate = Math.max(task.estimate, estimate, task.confirmed?.entries.at(-1)?.targetMinutes || 0);
          task.coverage.push(schedule);
          for (const dependency of dependencies) task.dependencies.add(dependency);
          tasks.set(key, task);
          jobs.push(task);
          dependencies = [key];
        }
        last.push(...dependencies);
      }
      preceding = last;
    }
    return { schedule, jobs };
  });
  return { tasks, requirements };
}

function availableSlots(data, deadlines, now) {
  const at = calendar(data.availability);
  const earliest = data.schedules.every(schedule => schedule.startDate)
    ? data.schedules.map(schedule => schedule.startDate).sort()[0] : undefined;
  // Start scanning before the first possible local day, allowing for UTC offsets.
  const first = Math.max(Math.ceil(now / MINUTE), earliest ? Date.parse(earliest) / MINUTE - 1440 : 0);
  const lastDate = deadlines.at(-1);
  const end = lastDate ? Math.ceil(Date.parse(lastDate) / MINUTE) + 2880 : first;
  const limit = data.availability.windows.length ? Math.min(end, first + PLANNING_DAYS * 1440) : end;
  const occupied = new Set();
  const allowance = new Map();
  const overtimeLimit = data.availability.overtimeHours * 60 + data.availability.overtimeMinutes;
  for (const entry of data.confirmations) {
    for (let minute = entry.start; minute < entry.end; minute++) {
      occupied.add(minute);
      if (entry.overtime && minute >= first - 8 * 1440 && minute < limit) {
        const week = at(minute).week;
        allowance.set(week, Math.max(0, (allowance.get(week) ?? overtimeLimit) - 1));
      }
    }
  }
  const slots = [];
  const extras = new Map();
  const capacity = new Map();
  let total = 0;
  for (let minute = first; data.availability.windows.length && minute < limit; minute++) {
    const slot = at(minute);
    if (slot.date > lastDate) break;
    if (earliest && slot.date < earliest) continue;
    if (occupied.has(minute) || (!slot.regular && !slot.extra)) continue;
    if (slot.extra) {
      const count = extras.get(slot.week) || 0;
      if (!(allowance.get(slot.week) ?? overtimeLimit)) continue;
      extras.set(slot.week, count + 1);
      total += Number(count < (allowance.get(slot.week) ?? overtimeLimit));
    } else total++;
    slots.push({ ...slot, minute });
    capacity.set(slot.date, total);
  }
  return {
    slots, capacity, complete: limit === end,
    extraLimit: week => allowance.get(week) ?? overtimeLimit,
  };
}

function compareScore(left, right) {
  const difference = left.findIndex((value, index) => value !== right[index]);
  return difference === -1 ? 0 : left[difference] - right[difference];
}

function pendingMinutes(task) {
  if (task.superseded) return 0;
  if (task.confirmed?.entries.some(entry => entry.completed)) return 0;
  return Math.max(0, task.estimate - (task.confirmed?.planned || 0));
}

function emptyRegularWindows(calendar, sessions) {
  const busy = new Set();
  for (const session of sessions) {
    for (let minute = session.start; minute < session.end; minute++) busy.add(minute);
  }
  const windows = [];
  for (const slot of calendar.slots) {
    if (!slot.regular || busy.has(slot.minute)) continue;
    const last = windows.at(-1);
    if (last && last.date === slot.date && last.end === slot.minute) last.end++;
    else windows.push({ date: slot.date, start: slot.minute, end: slot.minute + 1 });
  }
  return windows;
}

function fitRestBlocks(data, work, calendar, now) {
  const intervals = emptyRegularWindows(calendar, [...data.sessions, ...data.confirmations]);
  const prior = (data.rests || []).filter(block => block.end * MINUTE <= now
    && data.schedules.some(schedule => schedule.id === block.scheduleId && dateInSchedule(schedule, block.date)));
  const rests = [...prior];
  for (const { schedule, jobs: allJobs } of work.requirements) {
    const jobs = allJobs.filter(job => !job.superseded);
    const cardCount = new Set(jobs.map(job => cardKey(job.card))).size;
    if (!cardCount) continue;
    const effort = jobs.reduce((sum, job) => sum + job.estimate, 0);
    const average = Math.max(1, Math.round(effort / cardCount));
    let remaining = Math.floor(effort / 2) - prior.filter(block => block.scheduleId === schedule.id)
      .reduce((sum, block) => sum + block.end - block.start, 0);
    if (remaining <= 0) continue;
    const lastStudyDay = data.sessions.filter(session => session.schedules.includes(schedule.id)).map(session => session.date).sort().at(-1);
    const byDay = new Map();
    for (const window of intervals) {
      if (!dateInSchedule(schedule, window.date)) continue;
      if (!byDay.has(window.date)) byDay.set(window.date, { date: window.date, capacity: 0, windows: [] });
      const day = byDay.get(window.date);
      day.windows.push(window);
      day.capacity += window.end - window.start;
    }
    const compareDays = (left, right) => {
      // Prefer putting a complete break on one day. Use days after study first when possible.
      const fits = day => day.capacity >= remaining;
      const after = day => !lastStudyDay || day.date >= lastStudyDay;
      return Number(fits(right)) - Number(fits(left))
        || (fits(left) ? Number(after(right)) - Number(after(left)) : right.capacity - left.capacity)
        || left.date.localeCompare(right.date);
    };
    const fragments = [];
    for (const day of [...byDay.values()].sort(compareDays)) {
      for (const interval of day.windows) {
        let start = interval.start;
        while (remaining > 0) {
          const length = Math.min(average, remaining);
          if (start + length > interval.end) break;
          rests.push({ scheduleId: schedule.id, date: day.date, start, end: start + length });
          remaining -= length;
          start += length;
        }
        if (start < interval.end) fragments.push({ ...interval, start });
      }
      if (!remaining) break;
    }
    for (const interval of fragments) {
      if (!remaining) break;
      const length = Math.min(remaining, interval.end - interval.start);
      rests.push({ scheduleId: schedule.id, date: interval.date, start: interval.start, end: interval.start + length });
      remaining -= length;
    }
  }
  return rests.sort((a, b) => a.start - b.start || a.scheduleId.localeCompare(b.scheduleId));
}

function workflowCompletions(data, work, now) {
  if (!data.schedules.length) return [];
  const at = calendar(data.availability);
  return [...work.tasks.values()].flatMap(task => {
    if (!task.superseded || task.phase !== STUDY || task.confirmed?.entries.some(entry => entry.completed)) return [];
    const changedAt = Date.parse(task.card.statusChangedAt);
    const minute = Math.floor((Number.isFinite(changedAt) ? Math.min(changedAt, now) : now) / MINUTE);
    const date = at(minute).date;
    return [{
      id: `kanban:${task.key}`, card: task.card, phase: STUDY, workflowOnly: true,
      ...(task.milestoneName ? { milestoneName: task.milestoneName } : {}),
      date, start: minute, end: minute, schedules: task.coverage.map(schedule => schedule.id),
    }];
  });
}

function normalizeLegacySessions(data, items, work) {
  if (data.sessions.every(session => session.card.kind === 'unit')) return data.sessions;
  const byUnit = new Map(items.map(item => [item.id, item]));
  const normal = data.sessions.filter(session => session.card.kind === 'unit');
  const remaining = new Map();
  for (const task of work.tasks.values()) remaining.set(task.key, pendingMinutes(task));
  for (const session of normal) {
    const key = phaseKey(session.card, session.phase);
    remaining.set(key, Math.max(0, (remaining.get(key) || 0) - (session.end - session.start)));
  }
  for (const session of data.sessions.filter(item => item.card.kind !== 'unit').sort((a, b) => a.start - b.start)) {
    const card = byUnit.get(session.card.unit);
    if (!card) continue;
    const key = phaseKey(card, session.phase);
    const minutes = Math.min(remaining.get(key) || 0, session.end - session.start);
    if (!minutes) continue;
    const task = work.tasks.get(key);
    const schedules = session.schedules.filter(id => task.coverage.some(schedule => schedule.id === id));
    if (!schedules.length) continue;
    normal.push({
      ...session, card, end: session.start + minutes, schedules, targetMinutes: task.estimate,
    });
    remaining.set(key, remaining.get(key) - minutes);
  }
  return normal.sort((a, b) => a.start - b.start);
}

function stageEstimates(tasks) {
  return tasks.filter(task => task.phase === STUDY).map(task => task.effort);
}

function stageStudyTimes(data, work) {
  const byUnit = new Map();
  const current = stageEstimates([...(work?.tasks.values() || [])]);
  const inScope = new Set(current.map(entry => entry.unit));
  const saved = data.schedules.flatMap(schedule => schedule.studyEstimates || []).filter(entry => inScope.has(entry.unit));
  const savedUnits = new Set(saved.map(entry => entry.unit));
  const estimates = [...saved, ...current.filter(entry => !savedUnits.has(entry.unit))];
  for (const entry of estimates) {
    if (!byUnit.has(entry.unit) || byUnit.get(entry.unit).estimatedMinutes < entry.estimatedMinutes) {
      byUnit.set(entry.unit, { ...entry, plannedMinutes: 0, actualMinutes: 0 });
    }
  }
  for (const entry of data.confirmations) {
    if (entry.card.kind !== 'unit' || entry.phase !== STUDY) continue;
    const unit = entry.card.unit;
    const current = byUnit.get(unit) || { unit, estimatedMinutes: entry.targetMinutes };
    current.plannedMinutes = (current.plannedMinutes || 0) + entry.plannedMinutes;
    current.actualMinutes = (current.actualMinutes || 0) + entry.actualMinutes;
    byUnit.set(unit, current);
  }
  return [...byUnit.values()];
}

function pendingPlacement(sessions, work, availability, now) {
  if (!work?.tasks.size) return [];
  const booked = new Set(sessions.map(session => phaseKey(session.card, session.phase)));
  const at = calendar(availability);
  return [...work.tasks.values()].flatMap(task => {
    if (task.phase !== STUDY || !pendingMinutes(task) || booked.has(task.key)) return [];
    const changedAt = Date.parse(task.card.statusChangedAt);
    const minute = Math.floor((Number.isFinite(changedAt) ? Math.min(changedAt, now) : now) / MINUTE);
    return [{
      id: `pending-placement:${task.key}`, card: task.card, phase: task.phase, needsScheduling: true,
      date: at(minute).date, start: minute, end: minute,
      schedules: task.coverage.map(schedule => schedule.id),
    }];
  });
}

export function projectSchedule(data, items, now = Date.now(), { includeRests = true } = {}) {
  const statuses = new Map(items.map(item => [cardKey(item), item.unitStatus]));
  const legacy = data.sessions.some(session => session.card.kind !== 'unit');
  const hasAdvanced = data.schedules.length && items.some(item => phaseSuperseded(item.unitStatus, STUDY));
  const work = legacy || data.schedules.length ? buildWork(data, items) : null;
  const normalized = legacy ? normalizeLegacySessions(data, items, work) : data.sessions;
  const sessions = normalized.filter(session => !phaseSuperseded(statuses.get(cardKey(session.card)), session.phase));
  const changed = legacy || sessions.length !== data.sessions.length;
  const projected = {
    ...data, sessions, workflowCompletions: [], studyTimes: stageStudyTimes(data, work),
    pendingPlacement: pendingPlacement(sessions, work, data.availability, now),
  };
  if (hasAdvanced) projected.workflowCompletions = workflowCompletions(projected, work, now);
  if (!includeRests) return projected;
  if (!changed) return { ...projected, rests: scheduleRestSlots(data, items, now) };
  const deadlines = data.schedules.map(schedule => schedule.deadline).sort();
  return { ...projected, rests: fitRestBlocks({ ...projected, rests: legacy ? [] : data.rests }, work || buildWork(projected, items),
    availableSlots(projected, deadlines, now), now) };
}

export function scheduleRestSlots(data, cards, now = Date.now()) {
  if (Array.isArray(data.rests) && data.sessions.every(session => session.card.kind === 'unit')) return data.rests;
  if (!data.schedules.length) return [];
  const work = buildWork(data, cards);
  const deadlines = data.schedules.map(schedule => schedule.deadline).sort();
  const sessions = normalizeLegacySessions(data, cards, work);
  const agenda = { ...data, sessions, rests: sessions === data.sessions ? data.rests : [] };
  return fitRestBlocks(agenda, work, availableSlots(agenda, deadlines, now), now);
}

function restPolicy(data, cards, now) {
  const schedules = new Map(data.schedules.map(schedule => [schedule.id, schedule]));
  const byScheduleDay = new Map();
  for (const block of scheduleRestSlots(data, cards, now)) {
    const schedule = schedules.get(block.scheduleId);
    if (!schedule || block.end * MINUTE <= now) continue;
    const key = JSON.stringify([block.scheduleId, block.date]);
    if (!byScheduleDay.has(key)) byScheduleDay.set(key, []);
    const intervals = byScheduleDay.get(key);
    const last = intervals.at(-1);
    if (last && last.end === block.start) last.end = block.end;
    else intervals.push({ ...block, schedule });
  }
  const byDay = new Map();
  for (const interval of [...byScheduleDay.values()].flat()) {
    if (!byDay.has(interval.date)) byDay.set(interval.date, []);
    byDay.get(interval.date).push(interval);
  }
  const cached = new Map();
  return slot => {
    const intervals = byDay.get(slot.date);
    if (!intervals) return [];
    if (!cached.has(slot.minute)) {
      cached.set(slot.minute, intervals
        .filter(interval => interval.start <= slot.minute && slot.minute < interval.end)
        .map(interval => interval.schedule));
    }
    return cached.get(slot.minute);
  };
}

function chooseSlots(work, calendar, prior, restOn = () => []) {
  const { tasks, requirements } = work;
  const jobs = [...tasks.values()];
  const { slots, extraLimit } = calendar;
  const indexes = new Map(jobs.map((job, i) => [job.key, i]));
  const demand = jobs.map(task => pendingMinutes(task));
  const dependencies = jobs.map(job => [...job.dependencies].map(key => indexes.get(key)));
  const ranks = jobs.map(job => requirements.flatMap(({ schedule, jobs }, i) =>
    jobs.includes(job) ? [{ i, schedule }] : []));
  const due = ranks.map(list => list.map(rank => rank.schedule.deadline).sort()[0]);
  // An earlier deadline also applies to the unfinished prerequisites of that job.
  for (let pass = 0; pass < jobs.length; pass++) {
    let changed = false;
    for (const [index, parents] of dependencies.entries()) {
      for (const parent of parents) {
        if (demand[parent] && due[index] < due[parent]) {
          due[parent] = due[index];
          changed = true;
        }
      }
    }
    if (!changed) break;
  }
  const priorAt = new Map();
  for (const session of prior) {
    const index = indexes.get(phaseKey(session.card, session.phase));
    if (index === undefined) continue;
    for (let minute = session.start; minute < session.end; minute++) priorAt.set(minute, index);
  }

  const restByJob = jobs.map(() => new Map());
  function affectedAt(slot, index) {
    if (priorAt.get(slot.minute) === index) return [];
    const available = restOn(slot);
    if (!available.length) return [];
    const cache = restByJob[index];
    if (!cache.has(slot.minute)) {
      const studying = new Set(ranks[index].filter(rank => dateInSchedule(rank.schedule, slot.date)).map(rank => rank.schedule.id));
      cache.set(slot.minute, available.filter(schedule => !studying.has(schedule.id)));
    }
    return cache.get(slot.minute);
  }

  let best = { assignments: [], score: [0, ...requirements.map(() => 0), 0, 0, 0, 0] };
  function run({ earliest, keep, allowExtra, explore, share, avoidRest }) {
    const left = [...demand];
    const extras = new Map();
    const assignment = [];
    const covered = requirements.map(() => 0);
    let extraCount = 0;
    let kept = 0;
    const affectedDays = new Map();
    let restMinutes = 0;
    let steps = 0;
    let truncated = false;
    const remaining = left.reduce((sum, value) => sum + value, 0);
    function options(slot) {
      return jobs.flatMap((_, index) => {
        if (!left[index] || !dependencies[index].every(parent => left[parent] === 0)) return [];
        if (avoidRest && affectedAt(slot, index).length) return [];
        if (share && !ranks[index].every(rank => dateInSchedule(rank.schedule, slot.date))) return [];
        const rank = ranks[index].find(rank => dateInSchedule(rank.schedule, slot.date));
        return rank ? [{ index, rank: rank.i }] : [];
      }).sort((a, b) => {
        const previous = Number(priorAt.get(slot.minute) === b.index) - Number(priorAt.get(slot.minute) === a.index);
        const deadline = due[a.index].localeCompare(due[b.index]);
        return (keep ? previous : 0) || (earliest ? deadline : 0) || a.rank - b.rank || deadline;
      });
    }
    function set(slot, index, delta) {
      left[index] -= delta;
      if (slot.extra) {
        extras.set(slot.week, (extras.get(slot.week) || 0) + delta);
        extraCount += delta;
      }
      if (priorAt.get(slot.minute) === index) kept += delta;
      for (const schedule of affectedAt(slot, index)) {
        const key = JSON.stringify([schedule.id, slot.date]);
        const count = (affectedDays.get(key) || 0) + delta;
        if (count) affectedDays.set(key, count);
        else affectedDays.delete(key);
        restMinutes += delta;
      }
      for (const rank of ranks[index]) if (dateInSchedule(rank.schedule, slot.date)) covered[rank.i] += delta;
    }
    function save() {
      const full = covered.every((count, index) => count === expected[index]);
      const score = [Number(full), ...covered, -affectedDays.size, -restMinutes, -extraCount, kept];
      if (compareScore(score, best.score) > 0) best = { assignments: [...assignment], score };
    }
    function possible(slot) {
      return !slot.extra || (allowExtra && (extras.get(slot.week) || 0) < extraLimit(slot.week));
    }
    if (explore) {
      function search(i) {
        if (++steps > 35_000) { truncated = true; return; }
        if (i === slots.length || assignment.length === remaining) { save(); return; }
        const slot = slots[i];
        if (possible(slot)) {
          for (const { index } of options(slot)) {
            set(slot, index, 1);
            assignment.push([slot, index]);
            search(i + 1);
            assignment.pop();
            set(slot, index, -1);
            if (truncated) return;
          }
        }
        search(i + 1);
      }
      search(0);
    } else {
      for (const slot of slots) {
        if (assignment.length === remaining) break;
        if (!possible(slot)) continue;
        const option = options(slot)[0];
        if (!option) continue;
        set(slot, option.index, 1);
        assignment.push([slot, option.index]);
      }
      save();
    }
    return !truncated;
  }

  const expected = requirements.map(({ schedule, jobs }) => jobs.reduce((sum, job) => {
    if (job.superseded) return sum;
    const entries = job.confirmed?.entries.filter(entry => (entry.completedDate || entry.date) <= schedule.deadline) || [];
    if (entries.some(entry => entry.completed)) return sum;
    return sum + Math.max(0, job.estimate - entries.reduce((count, entry) => count + entry.plannedMinutes, 0));
  }, 0));
  for (const earliest of [true, false]) {
    for (const allowExtra of [false, true]) {
      run({ earliest, allowExtra, keep: false });
      if (priorAt.size) run({ earliest, allowExtra, keep: true });
    }
  }
  if (requirements.length > 1 && requirements.some(({ schedule }) => schedule.startDate)) {
    run({ earliest: true, allowExtra: false, share: true });
    run({ earliest: true, allowExtra: true, share: true });
  }
  if (requirements.length > 1 && slots.some(slot => restOn(slot).length)) {
    for (const allowExtra of [false, true]) {
      run({ earliest: true, allowExtra, keep: true, avoidRest: true });
    }
  }
  const exhaustive = slots.length <= 90 && run({ earliest: true, allowExtra: true, explore: true });
  return { assignments: best.assignments.map(([slot, index]) => [slot, jobs[index], affectedAt(slot, index)]), exhaustive };
}

function nextRegularDate(data, settings, start, editingId) {
  if (!settings.windows.length) return null;
  const at = calendar(settings);
  const last = start + PLANNING_DAYS * 1440;
  const busy = [
    ...data.sessions.filter(session => !editingId || session.schedules.some(id => id !== editingId)),
    ...data.confirmations,
  ].filter(session => session.end > start && session.start < last)
    .sort((a, b) => a.start - b.start);
  let index = 0;
  for (let minute = start; minute < last; minute++) {
    while (index < busy.length && busy[index].end <= minute) index++;
    if (index < busy.length && busy[index].start <= minute) {
      minute = busy[index].end - 1;
      continue;
    }
    const slot = at(minute);
    if (slot.regular) return slot.date;
  }
  return null;
}

export function suggestScheduleDeadline(snapshot, input, now = Date.now()) {
  ensure(input?.revision === snapshot.revision, 'O cronograma mudou. Atualize a página.', 409);
  ensure(input.schedule, 'Informe o conteúdo e os capítulos do cronograma.');
  const settings = input.availability === undefined ? snapshot.data.availability : availability(input.availability);
  const at = calendar(settings);
  const first = Math.ceil(now / MINUTE);
  const today = at(Math.floor(now / MINUTE)).date;
  const requested = input.schedule.startDate ? scheduleDate(input.schedule.startDate, 'Data de início') : '';
  const startDate = requested || nextRegularDate(snapshot.data, settings, first, input.schedule.id);
  const forecastStart = Math.max(first, startDate ? Date.parse(startDate) / MINUTE : first);
  const horizon = at(forecastStart + (PLANNING_DAYS - 2) * 1440).date;
  const data = configureSchedule(snapshot, {
    schedule: { ...input.schedule, startDate, deadline: horizon },
  });
  data.availability = { ...settings, overtimeHours: 0, overtimeMinutes: 0 };
  const target = input.schedule.id || data.schedules.at(-1).id;
  const work = buildWork(data, snapshot.items);
  const requirement = work.requirements.find(item => item.schedule.id === target);
  const effortMinutes = requirement.jobs.reduce((sum, task) => sum + pendingMinutes(task), 0);
  const bufferMinutes = Math.ceil(effortMinutes / 2);
  const hasVideos = requirement.jobs.some(task => task.card.materialVideos?.length);
  const result = { startDate, date: null, effortMinutes, bufferMinutes,
    ...(hasVideos ? {
      videoAverageSeconds: requirement.schedule.videoAverageSeconds || 0,
      videoSampleCount: requirement.schedule.videoSampleCount || 0,
    } : {}),
  };
  if (!effortMinutes) return { ...result, date: startDate && startDate > today ? startDate : today };
  if (!data.availability.windows.length) return result;
  // Forecast only: the margin follows all required phases and is never written to the agenda.
  const margin = {
    key: Symbol('deadline buffer'), estimate: bufferMinutes, coverage: [requirement.schedule],
    dependencies: new Set(requirement.jobs.map(task => task.key)),
  };
  work.tasks.set(margin.key, margin);
  requirement.jobs.push(margin);
  const deadlines = [...new Set(work.requirements.map(({ schedule }) => schedule.deadline))].sort();
  const { assignments } = chooseSlots(work, availableSlots(data, deadlines, now), data.sessions, restPolicy(snapshot.data, snapshot.items, now));
  const bufferSlots = assignments.filter(([, task]) => task === margin);
  if (bufferSlots.length === bufferMinutes) result.date = bufferSlots.at(-1)[0].date;
  return result;
}

function retainMissedSessions(previous, future, tasks, now) {
  const remaining = new Map([...tasks].map(([key, task]) => [key, pendingMinutes(task)]));
  for (const session of future) {
    const key = phaseKey(session.card, session.phase);
    remaining.set(key, Math.max(0, (remaining.get(key) || 0) - (session.end - session.start)));
  }
  const missed = [];
  for (const old of previous.filter(session => session.end * MINUTE <= now).sort((a, b) => a.start - b.start)) {
    const key = phaseKey(old.card, old.phase);
    const count = Math.min(old.end - old.start, remaining.get(key) || 0);
    if (!count) continue;
    const schedules = (old.schedules || []).filter(id => tasks.get(key).coverage.some(schedule => schedule.id === id));
    if (!schedules.length) continue;
    missed.push({ ...old, end: old.start + count, schedules });
    remaining.set(key, remaining.get(key) - count);
  }
  return [...missed, ...future];
}

export function planSchedule(data, cards, now = Date.now(), previousAgenda = data) {
  const work = buildWork(data, cards);
  const { tasks, requirements } = work;
  const normalized = normalizeLegacySessions(data, cards, work);
  if (normalized !== data.sessions) {
    data.sessions = normalized;
    data.rests = [];
  }
  const deadlines = [...new Set(requirements.map(({ schedule }) => schedule.deadline))].sort();
  const calendar = availableSlots(data, deadlines, now);
  const priorSessions = data.sessions;
  const previous = new Map(priorSessions.map(session =>
    [JSON.stringify([phaseKey(session.card, session.phase), session.start, session.end]), session.id]));
  const { assignments, exhaustive } = chooseSlots(work, calendar, data.sessions, restPolicy(previousAgenda, cards, now));
  const allocated = new Map([...tasks.keys()].map(key => [key, []]));
  const sessions = [];
  const restUsed = new Map();
  for (const [slot, task, affected] of assignments) {
    allocated.get(task.key).push(slot.date);
    for (const schedule of affected) {
      const key = JSON.stringify([schedule.id, slot.date]);
      const entry = restUsed.get(key) || { date: slot.date, scheduleId: schedule.id, name: schedule.name, minutes: 0, usedBy: new Set() };
      entry.minutes++;
      for (const user of task.coverage) {
        if (dateInSchedule(user, slot.date)) entry.usedBy.add(user.name);
      }
      restUsed.set(key, entry);
    }
    const previous = sessions.at(-1);
    if (previous?.key === task.key && previous.end === slot.minute && previous.overtime === slot.extra
      && previous.date === slot.date) previous.end++;
    else sessions.push({
      key: task.key, card: task.card, phase: task.phase,
      ...(task.milestoneName ? { milestoneName: task.milestoneName } : {}),
      start: slot.minute, end: slot.minute + 1, overtime: slot.extra, date: slot.date,
    });
  }
  const futureSessions = sessions.map(({ key, ...session }) => ({
    ...session,
    targetMinutes: tasks.get(key).estimate,
    ...(tasks.get(key).materialMinutes ? { materialMinutes: tasks.get(key).materialMinutes } : {}),
    id: previous.get(JSON.stringify([key, session.start, session.end])) || randomUUID(),
    schedules: tasks.get(key).coverage.filter(schedule => dateInSchedule(schedule, session.date)).map(schedule => schedule.id),
  }));
  data.sessions = retainMissedSessions(priorSessions, futureSessions, tasks, now);
  data.rests = fitRestBlocks(data, work, calendar, now);
  const upperAt = deadline => [...calendar.capacity].filter(([date]) => date <= deadline).at(-1)?.[1] || 0;
  const impossibleTogether = calendar.complete && deadlines.some(deadline => {
    const due = [...new Set(requirements.filter(({ schedule }) => schedule.deadline <= deadline).flatMap(({ jobs }) => jobs))];
    const demand = due.reduce((sum, task) => {
      if (task.superseded) return sum;
      const entries = task.confirmed?.entries.filter(entry => (entry.completedDate || entry.date) <= deadline) || [];
      return entries.some(entry => entry.completed) ? sum
        : sum + Math.max(0, task.estimate - entries.reduce((total, entry) => total + entry.plannedMinutes, 0));
    }, 0);
    return demand > upperAt(deadline);
  });
  const summary = requirements.map(({ schedule, jobs }) => {
    const missing = [];
    let total = 0;
    let placed = 0;
    let studyComplete = true;
    let requiredFuture = 0;
    const advanced = new Map();
    for (const task of jobs) {
      if (task.superseded) {
        advanced.set(cardKey(task.card), task.card);
        continue;
      }
      const history = task.confirmed?.entries || [];
      const done = history.some(entry => entry.completed && (entry.completedDate || entry.date) <= schedule.deadline);
      const confirmed = history.filter(entry => (entry.completedDate || entry.date) <= schedule.deadline).reduce((sum, entry) => sum + entry.plannedMinutes, 0);
      const scheduled = allocated.get(task.key).filter(date => dateInSchedule(schedule, date)).length;
      const deficit = done ? 0 : Math.max(0, task.estimate - confirmed - scheduled);
      total += task.estimate;
      placed += task.estimate - deficit;
      requiredFuture += done ? 0 : Math.max(0, task.estimate - confirmed);
      if (deficit) missing.push({ card: task.card, phase: task.milestoneName || task.phase, minutes: deficit });
      if (task.phase === STUDY && !history.some(entry => entry.completed)) studyComplete = false;
    }
    const status = !missing.length ? 'fits'
      : calendar.complete && (exhaustive || impossibleTogether || requiredFuture > upperAt(schedule.deadline) - (schedule.startDate ? [...calendar.capacity].filter(([date]) => date < schedule.startDate).at(-1)?.[1] || 0 : 0)) ? 'impossible' : 'unknown';
    const included = [...new Map(jobs.map(job => [cardKey(job.card), job.card])).values()];
    return { id: schedule.id, name: schedule.name, included, estimates: stageEstimates(jobs), advanced: [...advanced.values()], coverage: total ? 100 * placed / total : 100, missing, status, studyComplete };
  });
  const estimatesBySchedule = new Map(summary.map(item => [item.id, item.estimates]));
  data.schedules = data.schedules.map(schedule => ({ ...schedule, studyEstimates: estimatesBySchedule.get(schedule.id) }));
  const restUsage = [...restUsed.values()].map(entry => ({ ...entry, usedBy: [...entry.usedBy] }));
  return { data, summary, restUsage, workflow: workflowCompletions(data, work, now),
    pending: pendingPlacement(data.sessions, work, data.availability, now) };
}

function refreshRestBlocks(data, cards, now) {
  const work = buildWork(data, cards);
  const deadlines = data.schedules.map(item => item.deadline).sort();
  data.rests = fitRestBlocks(data, work, availableSlots(data, deadlines, now), now);
}

export function removeSchedule(store, input, now = Date.now()) {
  return store.updateSchedule(input?.revision, ({ data, items }) => {
    const schedule = data.schedules.find(entry => entry.id === input.id);
    ensure(schedule, 'Cronograma não encontrado.', 404);
    ensure(input.confirmation === schedule.name, 'Digite o nome exato do cronograma para confirmar.');
    data.schedules = data.schedules.filter(entry => entry.id !== schedule.id);
    const unlink = entry => ({ ...entry, schedules: entry.schedules.filter(id => id !== schedule.id) });
    data.sessions = data.sessions.map(unlink).filter(entry => entry.schedules.length);
    data.confirmations = data.confirmations.map(unlink);
    data.rests = (data.rests || []).filter(entry => entry.scheduleId !== schedule.id);
    refreshRestBlocks(data, items, now);
    return data;
  });
}

export function confirmScheduleSession(store, input, now = Date.now()) {
  return store.updateSchedule(input?.revision, ({ data, items }) => {
    const work = buildWork(data, items);
    data.sessions = normalizeLegacySessions(data, items, work);
    const session = data.sessions.find(item => item.id === input?.sessionId);
    ensure(session, 'Sessão não encontrada.', 404);
    ensure(session.start * MINUTE <= now, 'A sessão ainda não começou.');
    const actualMinutes = integer(input.actualMinutes, 1, 1440, 'Minutos realizados');
    const key = phaseKey(session.card, session.phase);
    const previous = data.confirmations.filter(entry => entry.card.kind === 'unit' && phaseKey(entry.card, entry.phase) === key);
    const plannedMinutes = session.end - session.start;
    const completed = previous.reduce((sum, entry) => sum + entry.plannedMinutes, plannedMinutes) >= session.targetMinutes;
    data.confirmations.push({ ...session, actualMinutes, plannedMinutes, completed, completedDate: calendar(data.availability)(Math.floor(now / MINUTE)).date, confirmedAt: new Date(now).toISOString() });
    data.sessions = data.sessions.filter(item => item.id !== session.id);
    refreshRestBlocks(data, items, now);
    return data;
  });
}
