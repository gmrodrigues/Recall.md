import { startSession, advanceSession, endSession, focusEntity, checkpoint, recordAction } from './study-model.js';
export class StudyTracker {
  constructor({ projectId, now = Date.now, onChange = () => {}, onError = () => {}, getContext = () => null, isVisible = () => true }) {
    this.projectId = projectId; this.now = now; this.onChange = onChange; this.onError = onError;
    this.getContext = getContext; this.isVisible = isVisible; this.tabId = crypto.randomUUID(); this.current = null;
  }
  async init() {
    if (!globalThis.indexedDB) throw new Error('Armazenamento de sessão indisponível neste navegador.');
    this.db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('recall-study-v1', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('projects');
      req.onblocked = () => reject(new Error('Armazenamento de sessão bloqueado por outra versão aberta.'));
      req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
    });
    if (globalThis.BroadcastChannel) {
      this.channel = new BroadcastChannel(`recall-study:${this.projectId}`);
      this.channel.onmessage = () => this.read().catch(e => this.onError(e));
    }
    await this.read(); await this.tick();
    this.timer = setInterval(() => this.tick().catch(e => this.onError(e)), 2000);
    return this;
  }
  async read() {
    const current = await new Promise((resolve, reject) => {
      const tx = this.db.transaction('projects', 'readonly'), req = tx.objectStore('projects').get(this.projectId);
      req.onsuccess = () => resolve(req.result ?? null); req.onerror = () => reject(req.error);
    });
    this.current = current; this.onChange(current); return current;
  }
  async update(fn) {
    const current = await new Promise((resolve, reject) => {
      const tx = this.db.transaction('projects', 'readwrite'), store = tx.objectStore('projects'), req = store.get(this.projectId);
      let next;
      req.onsuccess = () => {
        try { next = fn(req.result ?? null); if (next) store.put(next, this.projectId); else store.delete(this.projectId); }
        catch (e) { tx.abort(); reject(e); }
      };
      tx.oncomplete = () => resolve(next); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error || new Error('Sessão não atualizada.'));
    });
    this.current = current; this.onChange(current); this.channel?.postMessage('changed'); return current;
  }
  async touch(context = this.getContext()) {
    return this.update(s => {
      const now = this.now(); s ||= startSession(this.projectId, now); advanceSession(s, now, true);
      return focusEntity(s, this.tabId, context, now, this.isVisible());
    });
  }
  async tick() {
    return this.update(s => {
      const now = this.now(); advanceSession(s, now);
      if (s?.status === 'active') { checkpoint(s, this.tabId, now); focusEntity(s, this.tabId, this.getContext(), now, this.isVisible()); }
      return s;
    });
  }
  async focus(context = this.getContext(), interacting = false) {
    if (interacting) return this.touch(context);
    return this.update(s => focusEntity(s, this.tabId, context, this.now(), this.isVisible()));
  }
  async record(context, action, at = this.now()) {
    return this.update(s => { const now = this.now(); s ||= startSession(this.projectId, Math.min(now, at)); advanceSession(s, now, true); return recordAction(s, context, action, at); });
  }
  async end() { return this.update(s => { advanceSession(s, this.now(), true); return endSession(s, this.now()); }); }
  async resolve(save, persist) {
    const token = crypto.randomUUID(); let snapshot;
    await this.update(s => {
      if (s?.status === 'inactive') endSession(s, s.lastActivityAt, 'inactivity');
      if (!s || s.status !== 'pending') throw new Error('Nenhuma sessão aguardando confirmação.');
      if (s.resolving && s.resolving.expires > this.now()) throw new Error('Outra aba está finalizando esta sessão.');
      snapshot = structuredClone(s); delete snapshot.resolving;
      s.resolving = { token, expires: this.now() + 30000 }; return s;
    });
    try {
      if (save) await persist(snapshot);
      await this.update(s => s?.id === snapshot.id && s.resolving?.token === token ? null : s);
    } catch (error) {
      await this.update(s => { if (s?.resolving?.token === token) delete s.resolving; return s; });
      throw error;
    }
  }
  close() { clearInterval(this.timer); this.channel?.close(); this.db?.close(); }
}
