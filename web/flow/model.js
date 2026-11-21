export function chartDate(day) {
  return day.split('-').reverse().join('/');
}

const weekdayFormatter = new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', weekday: 'long' });

export function chartWeekday(day) {
  const weekday = weekdayFormatter.format(new Date(`${day}T00:00:00Z`));
  return weekday.charAt(0).toUpperCase() + weekday.slice(1);
}

export function sessionTime(session, timeZone) {
  const format = new Intl.DateTimeFormat('pt-BR', { timeZone, dateStyle: 'short', timeStyle: 'short' });
  return format.formatRange(session.start * 60_000, session.end * 60_000);
}

const dayMs = 86_400_000;
const minuteMs = 60_000;
const timeFormatters = new Map();

function clockMinute(timestamp, timeZone) {
  if (!timeFormatters.has(timeZone)) {
    timeFormatters.set(timeZone, new Intl.DateTimeFormat('en-GB', {
      timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }));
  }
  const [hour, minute] = timeFormatters.get(timeZone).format(timestamp * minuteMs).split(':').map(Number);
  return hour * 60 + minute;
}

export function clockLabel(minute) {
  return [Math.floor(minute / 60), minute % 60].map(value => String(value).padStart(2, '0')).join(':');
}

function isoDay(time) {
  return new Date(time).toISOString().slice(0, 10);
}

function localToday(timeZone) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const get = type => parts.find(part => part.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function sessionStatus(session, now = Date.now()) {
  if (session.needsScheduling) return 'missed';
  if (session.confirmed) return 'done';
  return session.end * minuteMs <= now ? 'missed' : 'planned';
}

export function confirmedSessions(agenda) {
  return [...(agenda?.confirmations || []).filter(session => session.card.kind === 'unit'), ...(agenda?.workflowCompletions || [])].map(session => ({
    ...session, date: session.completedDate || session.date, confirmed: true,
  }));
}

function periods(agenda, slots, timeZone) {
  const dates = new Map();
  for (const slot of slots) {
    for (const id of slot.schedules || []) {
      if (!dates.has(id)) dates.set(id, new Set());
      dates.get(id).add(slot.date);
    }
  }
  const today = localToday(timeZone);
  const rests = new Map();
  for (const block of agenda?.rests || []) {
    if (!rests.has(block.scheduleId)) rests.set(block.scheduleId, []);
    rests.get(block.scheduleId).push(block);
  }
  return (agenda?.schedules || []).map(schedule => {
    const days = [...(dates.get(schedule.id) || [])].sort();
    const deadline = schedule.deadline || days.at(-1);
    const start = schedule.startDate || days[0] || (deadline && (today < deadline ? today : deadline));
    const restByDate = new Map();
    let restCount = 0;
    let restMinutes = 0;
    for (const block of rests.get(schedule.id) || []) {
      if (block.date < start || block.date > deadline) continue;
      const day = restByDate.get(block.date) || { restCount: 0, restMinutes: 0, intervals: [] };
      const minutes = block.end - block.start;
      day.restCount++;
      day.restMinutes += minutes;
      day.intervals.push(sessionTime(block, timeZone));
      restByDate.set(block.date, day);
      restCount++;
      restMinutes += minutes;
    }
    return { id: schedule.id, name: schedule.name, start, deadline, restByDate, restCount, restMinutes };
  });
}

function pageDays(periods, slots, wantedPage = 0, pageSize = 14) {
  const dates = [...periods.flatMap(period => [period.start, period.deadline]), ...slots.map(slot => slot.date)].filter(Boolean).sort();
  const first = Date.parse(dates[0]);
  const last = Date.parse(dates.at(-1));
  const count = dates.length ? 1 + (last - first) / dayMs : 0;
  const pageCount = Math.max(1, Math.ceil(count / pageSize));
  const page = Math.min(Math.max(0, wantedPage), pageCount - 1);
  const offset = page * pageSize;
  const days = Array.from({ length: Math.max(0, Math.min(pageSize, count - offset)) },
    (_, index) => isoDay(first + (offset + index) * dayMs));
  return {
    days, page, pageCount, pageSize,
    start: days[0], end: days.at(-1),
    first: dates[0], last: dates.at(-1),
  };
}

export function dailyTotals(sessions) {
  return {
    cards: new Set(sessions.map(session => session.card.unit)).size,
    minutes: sessions.reduce((sum, session) => sum + (session.confirmed && session.actualMinutes ? session.actualMinutes : session.end - session.start), 0),
  };
}

export function formatDailyTotals(totals) {
  return `${totals.cards} ${totals.cards === 1 ? 'ficha' : 'fichas'} · ${durationLabel(totals.minutes)}`;
}

function durationLabel(total) {
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return hours ? `${hours} h${minutes ? ` ${minutes} min` : ''}` : `${minutes} min`;
}

export function formatRestTotals({ restCount, restMinutes }) {
  return `${restCount} ${restCount === 1 ? 'bloco de folga' : 'blocos de folga'} · ${durationLabel(restMinutes)}`;
}

export function stageStatus(statuses) {
  if (!statuses.length) return '';
  if (statuses.includes('missed')) return 'missed';
  return statuses.includes('planned') ? 'planned' : 'done';
}

function overviewStages(bars) {
  const stages = new Map();
  for (const bar of bars) {
    const unit = stages.get(bar.unit) || { id: bar.unit, name: bar.name, bars: [], minutes: 0 };
    unit.bars.push(bar);
    unit.minutes += bar.minutes;
    stages.set(bar.unit, unit);
  }
  return [...stages.values()].map(unit => ({
    ...unit, status: stageStatus(unit.bars.map(bar => bar.status)),
    workflowOnly: unit.bars.every(bar => bar.workflowOnly),
    needsScheduling: unit.bars.some(bar => bar.needsScheduling),
  }));
}

export function overviewModel(data, page = 0, now = Date.now()) {
  const { timeZone } = data.availability;
  const slots = [...confirmedSessions(data), ...data.sessions, ...(data.pendingPlacement || [])];
  const workPeriods = periods(data, slots, timeZone);
  const pagination = pageDays(workPeriods, slots, page);
  const days = [...new Set(slots.map(slot => slot.date))].sort();
  const byDate = new Map();
  for (const slot of slots) {
    const day = byDate.get(slot.date) || [];
    day.push(slot);
    byDate.set(slot.date, day);
  }
  const columns = pagination.days.map(date => ({ id: date, date, totals: dailyTotals(byDate.get(date) || []) }));
  const times = slots.map(session => {
    const actualEnd = session.studiedAt || session.confirmedAt;
    const actualStart = session.confirmed && actualEnd && session.actualMinutes
      ? Math.floor(Date.parse(actualEnd) / minuteMs) - session.actualMinutes : session.start;
    const duration = session.confirmed && session.actualMinutes ? session.actualMinutes : session.end - session.start;
    const start = Math.max(0, clockMinute(actualStart, timeZone));
    return { session, display: { start: actualStart, end: actualStart + duration }, duration, start, end: Math.min(1440, start + duration) };
  });
  const from = times.length ? Math.min(...times.map(item => Math.floor(item.start / 60) * 60)) : 0;
  const to = times.length ? Math.min(1440, Math.max(from + 60, ...times.map(item => Math.ceil(item.end / 60) * 60))) : 1440;
  const axis = { from, to };
  const cells = new Map();
  for (const { session, display, duration, start, end } of times.sort((a, b) => a.session.start - b.session.start)) {
    const bar = {
      id: session.id, unit: session.card.unit,
      left: 100 * (start - from) / (to - from),
      width: 100 * (end - start) / (to - from),
      minutes: duration,
      name: session.card.front || session.card.id,
      phase: session.milestoneName || session.phase,
      time: sessionTime(display, timeZone),
      status: sessionStatus(session, now),
      workflowOnly: Boolean(session.workflowOnly),
      needsScheduling: Boolean(session.needsScheduling),
      overtime: Boolean(session.overtime),
    };
    for (const id of session.schedules) {
      const key = JSON.stringify([id, session.date]);
      const cell = cells.get(key) || { minutes: 0, bars: [] };
      cell.minutes += bar.minutes;
      cell.bars.push(bar);
      cells.set(key, cell);
    }
  }
  return {
    days, columns, axis, pagination, hasSessions: slots.length > 0,
    rows: workPeriods.map(period => ({
      id: period.id, name: period.name, restCount: period.restCount, restMinutes: period.restMinutes,
      restByDate: period.restByDate,
      cells: columns.map(column => {
        const cell = cells.get(JSON.stringify([period.id, column.date]));
        return cell && { ...cell, stages: overviewStages(cell.bars) };
      }),
    })),
  };
}

const workKey = session => JSON.stringify([session.card.unit, session.card.id, session.phase]);

const stageNodeId = (side, session) => `${side}:unit:${session.date}:${session.card.unit}`;

function stageGroups(side, sessions) {
  const groups = new Map();
  for (const session of [...sessions].sort((a, b) => a.start - b.start)) {
    const id = stageNodeId(side, session);
    const group = groups.get(id) || { id, date: session.date, title: session.card.front || session.card.unit, sessions: [] };
    group.sessions.push(session);
    groups.set(id, group);
  }
  return groups;
}

function plannedIntervals(sessions, timeZone) {
  const intervals = [];
  for (const session of sessions.filter(entry => !entry.confirmed && !entry.needsScheduling)) {
    const last = intervals.at(-1);
    if (last?.end === session.start) last.end = session.end;
    else intervals.push({ start: session.start, end: session.end });
  }
  return intervals.map(({ start, end }) => {
    const from = clockMinute(start, timeZone);
    const to = clockMinute(end, timeZone) || 1440;
    return `${clockLabel(from)}–${clockLabel(to)}`;
  });
}

export function comparisonGraph(before, after, beforeZone, afterZone, { beforeAgenda, afterAgenda, page = 0, now = Date.now(), displayOnly = false } = {}) {
  before = [...before, ...confirmedSessions(beforeAgenda), ...(beforeAgenda?.pendingPlacement || [])];
  after = [...after, ...confirmedSessions(afterAgenda), ...(afterAgenda?.pendingPlacement || [])];
  const restBefore = periods(beforeAgenda, before, beforeZone);
  const restAfter = periods(afterAgenda, after, afterZone);
  const periodsInView = [...restBefore, ...restAfter];
  const slotsInView = [...before, ...after];
  let pagination = pageDays(periodsInView, slotsInView, page ?? 0, 7);
  const linkedBefore = new Set();
  const linkedAfter = new Set();
  const afterById = new Map(after.map(item => [item.id, item]));
  const retained = new Set(before.filter(item => {
    const current = afterById.get(item.id);
    return current && current.start === item.start && current.end === item.end && current.date === item.date;
  }).map(item => item.id));
  const changes = new Map();
  for (const side of displayOnly ? [] : [before, after]) {
    for (const session of side) {
      if (session.confirmed || session.needsScheduling || retained.has(session.id)) continue;
      const key = workKey(session);
      const group = changes.get(key) || { before: [], after: [] };
      group[side === before ? 'before' : 'after'].push(session);
      changes.set(key, group);
    }
  }
  if (page === null && !displayOnly && changes.size) {
    const changed = [...changes.values()];
    const focusDate = changed.flatMap(change => change.after.map(session => session.date)).sort()[0]
      || changed.flatMap(change => change.before.map(session => session.date)).sort()[0];
    const daysFromFirst = (Date.parse(focusDate) - Date.parse(pagination.first)) / dayMs;
    const focusPage = Math.floor(daysFromFirst / pagination.pageSize);
    if (focusPage > 0) pagination = pageDays(periodsInView, slotsInView, focusPage, pagination.pageSize);
  }
  const edges = new Map();
  for (const { before: left, after: right } of changes.values()) {
    left.sort((a, b) => a.start - b.start);
    right.sort((a, b) => a.start - b.start);
    // Match minutes of the same study stage and phase, including splits and merges.
    let i = 0, j = 0, usedLeft = 0, usedRight = 0;
    while (i < left.length && j < right.length) {
      const source = left[i], target = right[j];
      const lengthLeft = source.end - source.start, lengthRight = target.end - target.start;
      const transfer = Math.min(lengthLeft - usedLeft, lengthRight - usedRight);
      const from = stageNodeId('before', source);
      const to = stageNodeId('after', target);
      const id = `${from}→${to}`;
      edges.set(id, { id, source: from, target: to, markerEnd: { type: 'arrowclosed', color: '#24765f' }, class: 'flow-move' });
      linkedBefore.add(source.id);
      linkedAfter.add(target.id);
      usedLeft += transfer;
      usedRight += transfer;
      if (usedLeft === lengthLeft) { i++; usedLeft = 0; }
      if (usedRight === lengthRight) { j++; usedRight = 0; }
    }
  }
  const nodes = [];
  const stages = { before: stageGroups('before', before), after: stageGroups('after', after) };
  const groups = pagination.days.map(date => ({
    date,
    before: [...stages.before.values()].filter(unit => unit.date === date),
    after: [...stages.after.values()].filter(unit => unit.date === date),
    beforeRest: restBefore.filter(period => period.restByDate.has(date)),
    afterRest: restAfter.filter(period => period.restByDate.has(date)),
  }));
  const rowHeight = 118;
  const headerHeight = 122;
  const subcolumnWidth = 232;
  const dayWidth = subcolumnWidth * (displayOnly ? 1 : 2) + 32;
  const maxRows = Math.max(1, ...groups.map(day => Math.max(day.before.length + day.beforeRest.length, day.after.length + day.afterRest.length)));
  function heading(id, label, x, y, className) {
    return { id, position: { x, y }, data: { label }, class: `flow-axis ${className}`, type: 'input', focusable: false };
  }
  for (const [dayIndex, day] of groups.entries()) {
    const x = dayIndex * dayWidth;
    if (dayIndex) nodes.push({
      id: `divider:${day.date}`, position: { x: x - 18, y: 0 }, type: 'dayDivider',
      data: { height: headerHeight + maxRows * rowHeight }, focusable: false,
    });
    nodes.push({
      id: `date:${day.date}`, position: { x, y: 0 }, type: 'dateHeading', focusable: false,
      class: displayOnly ? 'flow-axis flow-date flow-date-single' : 'flow-axis flow-date',
      data: { date: chartDate(day.date), weekday: chartWeekday(day.date) },
    });
    for (const side of displayOnly ? ['after'] : ['before', 'after']) {
      const isBefore = side === 'before';
      const units = day[side];
      const sessions = units.flatMap(unit => unit.sessions);
      const rest = day[`${side}Rest`];
      const positionX = x + (isBefore || displayOnly ? 0 : subcolumnWidth);
      nodes.push(heading(`${side}:heading:${day.date}`,
        displayOnly ? formatDailyTotals(dailyTotals(sessions)) : `${isBefore ? 'Antes' : 'Depois'}\n${formatDailyTotals(dailyTotals(sessions))}`,
        positionX, 66, displayOnly ? 'flow-day-summary' : isBefore ? 'flow-before-heading' : 'flow-after-heading'));
      units.forEach((unit, index) => {
        const kept = unit.sessions.every(session => retained.has(session.id));
        const linked = unit.sessions.some(session => (isBefore ? linkedBefore : linkedAfter).has(session.id));
        const color = kept ? 'unchanged' : linked ? side : isBefore ? 'removed' : 'added';
        const state = stageStatus(unit.sessions.map(session => sessionStatus(session, now)));
        const workflowOnly = unit.sessions.every(session => session.workflowOnly);
        const needsScheduling = unit.sessions.some(session => session.needsScheduling);
        const status = needsScheduling ? 'Pendente de reprogramação' : workflowOnly ? 'Estudada no quadro' : state === 'done' ? 'Realizada'
          : state === 'missed' && (displayOnly || kept) ? 'Não realizada'
          : displayOnly || kept ? 'Programada' : linked ? (isBefore ? 'Horário anterior' : 'Novo horário') : isBefore ? 'Retirada' : 'Adicionada';
        const minutes = dailyTotals(unit.sessions).minutes;
        const timeZone = isBefore ? beforeZone : afterZone;
        const intervals = plannedIntervals(unit.sessions, timeZone);
        const shownIntervals = intervals.slice(0, 2).join(' · ');
        const extra = intervals.length > 2 ? ` +${intervals.length - 2}` : '';
        const detail = workflowOnly || needsScheduling ? '' : ` · ${durationLabel(minutes)}`;
        const label = `${unit.title.slice(0, 80)}\n${status}${detail}${shownIntervals ? `\n${shownIntervals}${extra}` : ''}`;
        nodes.push({
          id: unit.id,
          position: { x: positionX, y: headerHeight + index * rowHeight },
          type: isBefore ? 'input' : 'output',
          ...(isBefore ? { sourcePosition: 'right' } : { targetPosition: 'left' }),
          class: `flow-session ${displayOnly ? 'flow-view-only' : `flow-${color}`} flow-status-${state}`,
          ariaLabel: [unit.title, status + detail, ...intervals].join(', '),
          data: { label },
        });
      });
      rest.forEach((period, index) => nodes.push({
        id: `${side}:rest:${day.date}:${period.id}`,
        position: { x: positionX, y: headerHeight + (units.length + index) * rowHeight },
        class: 'flow-session flow-rest', type: 'input', focusable: false,
        data: { label: `Folga · ${formatRestTotals(period.restByDate.get(day.date))}\n${period.name.slice(0, 80)}` },
      }));
    }
  }

  const visible = new Set(nodes.map(node => node.id));
  const all = new Map([...stages.before, ...stages.after]);
  const continuationCount = { before: 0, after: 0 };
  function showContinuation(id) {
    if (visible.has(id)) return;
    const session = all.get(id);
    const earlier = session.date < pagination.start;
    const position = earlier ? 'before' : 'after';
    const source = id.startsWith('before:');
    nodes.push({
      id, position: { x: earlier ? -232 : groups.length * dayWidth, y: headerHeight + continuationCount[position]++ * rowHeight },
      type: source ? 'input' : 'output', class: 'flow-session flow-continuation',
      ...(source ? { sourcePosition: 'right' } : { targetPosition: 'left' }),
      data: { label: `${source ? 'Antes' : 'Depois'} · ${chartDate(session.date)}\nVer em outro intervalo` },
    });
    visible.add(id);
  }
  const shownEdges = [...edges.values()].filter(edge => visible.has(edge.source) || visible.has(edge.target));
  for (const edge of shownEdges) {
    showContinuation(edge.source);
    showContinuation(edge.target);
  }
  const inset = 16;
  const x = inset + (continuationCount.before ? 232 : 0);
  const rows = Math.max(maxRows, continuationCount.before, continuationCount.after);
  for (const node of nodes) {
    node.position.x += x;
    node.position.y += inset;
  }
  const canvas = {
    width: x + groups.length * dayWidth + (continuationCount.after ? subcolumnWidth : 0),
    height: inset + headerHeight + rows * rowHeight,
  };
  return { nodes, edges: shownEdges, pagination, restBefore, restAfter, canvas };
}

