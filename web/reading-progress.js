import { mergeReadingProgress } from '../src/material.js';

const WRITE_INTERVAL = 10 * 60 * 1000;
const RETRY_INTERVAL = 30 * 1000;

export function readingProgress(project, request, storage, environment = globalThis) {
  const now = () => environment.Date.now();
  const prefix = 'recall:reading:' + project + ':';
  const memory = new Map();
  let timer;
  let saving = false;

  function read(unit) {
    try {
      return JSON.parse(storage?.getItem(prefix + unit) || 'null') || memory.get(unit);
    } catch {
      return memory.get(unit);
    }
  }

  function write(unit, entry) {
    memory.set(unit, entry);
    try { storage?.setItem(prefix + unit, JSON.stringify(entry)); } catch {}
  }

  function queued() {
    const units = new Set(memory.keys());
    try {
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (key?.startsWith(prefix)) units.add(key.slice(prefix.length));
      }
    } catch {}
    return [...units].map(read).filter(entry => entry?.queuedAt !== null && entry?.queuedAt !== undefined);
  }

  function schedule(earliestRetry = 0) {
    environment.clearTimeout(timer);
    const pending = queued();
    if (!pending.length) return;
    const first = Math.min(...pending.map(entry => entry.queuedAt));
    timer = environment.setTimeout(flush, Math.max(earliestRetry, first + WRITE_INTERVAL - now()));
  }

  async function flush() {
    if (saving) return;
    const due = queued().filter(entry => entry.queuedAt + WRITE_INTERVAL <= now()).slice(0, 100);
    if (!due.length) {
      schedule();
      return;
    }
    saving = true;
    let retry = 0;
    try {
      const saved = await request('/api/material/progress', 'POST', { entries: due.map(entry => entry.progress) });
      const savedByUnit = new Map(saved.map(progress => [progress.unit, progress]));
      for (const sent of due) {
        const unit = sent.progress.unit;
        const current = read(unit);
        if (!current) continue;
        const unchanged = JSON.stringify(current.progress) === JSON.stringify(sent.progress);
        const server = savedByUnit.get(unit);
        write(unit, {
          progress: mergeReadingProgress(current.progress, server),
          queuedAt: unchanged ? null : now(),
        });
      }
    } catch {
      retry = RETRY_INTERVAL;
    } finally {
      saving = false;
      schedule(retry);
    }
  }

  schedule();
  return {
    cached(unit) { return read(unit)?.progress; },
    async load(unit) {
      const remote = await request('/api/units/' + encodeURIComponent(unit) + '/reading-progress');
      const local = read(unit);
      const progress = mergeReadingProgress(remote, local?.progress);
      if (progress) write(unit, { progress, queuedAt: local?.queuedAt ?? null });
      return progress;
    },
    visit(unit, page, eligiblePages) {
      const local = read(unit);
      const previous = local?.progress && {
        ...local.progress, visited: local.progress.visited.filter(id => eligiblePages.includes(id)),
      };
      if (previous?.lastPage === page && previous.visited.includes(page)) {
        if (previous.visited.length !== local.progress.visited.length) write(unit, { ...local, progress: previous });
        return previous;
      }
      const changedAt = Math.max(now(), (local?.progress.changedAt || 0) + 1);
      const progress = mergeReadingProgress(previous, { unit, lastPage: page, visited: [page], changedAt });
      write(unit, { progress, queuedAt: local?.queuedAt ?? now() });
      if (!saving) schedule();
      return progress;
    },
  };
}
