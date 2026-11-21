import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { ensure, inside } from './core.js';
import { materialLinkIdentity, materialPageLinks, materialPages, mergeReadingProgress } from './material.js';

export function progressStore(store) {
  const file = () => inside(store.root, 'reading-progress.sqlite');
  const linkHash = link => createHash('sha256').update(materialLinkIdentity(link)).digest('hex');
  const project = createHash('sha256').update(store.cwd).digest('hex');
  function withDatabase(run) {
    const database = new DatabaseSync(file());
    try {
      database.exec('PRAGMA busy_timeout = 5000');
      database.exec(`CREATE TABLE IF NOT EXISTS reading_progress (
        unit TEXT PRIMARY KEY,
        last_page TEXT NOT NULL,
        visited TEXT NOT NULL,
        changed_at INTEGER NOT NULL
      ) STRICT`);
      database.exec(`CREATE TABLE IF NOT EXISTS external_material_reads (
        hash TEXT PRIMARY KEY,
        started_at INTEGER NOT NULL,
        completed_at INTEGER NOT NULL
      ) STRICT`);
      database.exec(`CREATE TABLE IF NOT EXISTS external_material_notes (
        id TEXT PRIMARY KEY, hash TEXT NOT NULL, body TEXT NOT NULL, image TEXT
      ) STRICT;
      CREATE INDEX IF NOT EXISTS external_material_notes_hash ON external_material_notes(hash)`);
      if (database.prepare('PRAGMA user_version').get().user_version < 3) {
        database.exec('BEGIN IMMEDIATE');
        try {
          if (database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'material_link_reading'").get()) {
            const insert = database.prepare(`INSERT INTO external_material_reads (hash, started_at, completed_at)
              VALUES (?, ?, ?) ON CONFLICT(hash) DO NOTHING`);
            const previous = database.prepare('SELECT url, started_at, completed_at FROM material_link_reading ORDER BY completed_at');
            for (const row of previous.iterate()) {
              insert.run(linkHash({ url: row.url }), row.started_at, row.completed_at);
            }
          }
          const noteColumns = new Set(database.prepare('PRAGMA table_info(external_material_notes)').all().map(column => column.name));
          if (!noteColumns.has('source_url')) {
            database.exec('ALTER TABLE external_material_notes ADD COLUMN source_url TEXT');
          }
          if (!noteColumns.has('source_page')) {
            database.exec('ALTER TABLE external_material_notes ADD COLUMN source_page TEXT');
          }
          database.exec('PRAGMA user_version = 3; COMMIT');
        } catch (error) {
          database.exec('ROLLBACK');
          throw error;
        }
      }
      return run(database);
    } finally {
      database.close();
    }
  }

  function get(database, unit) {
    const row = database.prepare('SELECT last_page, visited, changed_at FROM reading_progress WHERE unit = ?').get(unit);
    return row ? { unit, lastPage: row.last_page, visited: JSON.parse(row.visited), changedAt: row.changed_at } : null;
  }

  function sanitize(entry, allowed) {
    if (!entry) return null;
    const visited = entry.visited.filter(page => allowed.has(page));
    return { ...entry, visited, lastPage: allowed.has(entry.lastPage) ? entry.lastPage : visited.at(-1) || null };
  }

  function notesFor(database, hash) {
    return database.prepare(`SELECT id, rowid AS position, source_url AS sourceUrl, source_page AS sourcePage, body AS text, image IS NOT NULL AS hasImage
      FROM external_material_notes WHERE hash = ? ORDER BY rowid`).all(hash);
  }

  function noteScope(unit, hash) {
    return materialPages(unit).some(page => materialPageLinks(unit, page.id).some(link => linkHash(link) === hash));
  }

  function validateNotes(notes) {
    ensure(Array.isArray(notes) && notes.length <= 100, 'Informe até 100 anotações por conclusão.');
    return notes.map(note => {
      ensure(typeof note?.id === 'string' && /^[0-9a-f-]{36}$/i.test(note.id), 'ID de anotação inválido.');
      ensure(typeof note.text === 'string' && note.text.length <= 1024, 'Cada anotação pode ter até 1024 caracteres.');
      const image = note.image || null;
      ensure(!image || (typeof image === 'string' && image.length <= 699100
        && /^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(image)), 'Use uma imagem PNG, JPEG, GIF ou WebP de até 512 KB.');
      ensure(Boolean(note.text.trim()) !== Boolean(image), 'Cada anotação deve conter texto ou imagem.');
      return { id: note.id, text: note.text.trim(), image };
    });
  }

  return {
    project,
    read(unitId) {
      const allowed = new Set(materialPages(store.get(unitId)).map(page => page.id));
      if (!fs.existsSync(file())) return null;
      return withDatabase(database => sanitize(get(database, unitId), allowed));
    },
    links(unitId) {
      const unit = store.get(unitId);
      if (!fs.existsSync(file())) return [];
      return withDatabase(database => {
        const lookup = database.prepare(`SELECT started_at AS startedAt, completed_at AS completedAt
          FROM external_material_reads WHERE hash = ?`);
        return materialPages(unit).flatMap(page => materialPageLinks(unit, page.id).flatMap(link => {
          const hash = linkHash(link);
          const record = lookup.get(hash);
          const notes = notesFor(database, hash);
          if (!record && !notes.length) return [];
          return [{ ...record, page: page.id, url: link.url, hash, ...(notes.length ? { notes } : {}) }];
        }));
      });
    },
    completeLink(unitId, input) {
      const unit = store.get(unitId);
      const { page, url, startedAt, notes = [], completed = true } = input || {};
      ensure(typeof completed === 'boolean', 'Estado de conclusão inválido.');
      const drafts = validateNotes(notes);
      const now = Date.now();
      const link = materialPageLinks(unit, page).find(link => link.url === url);
      ensure(link, 'Link indisponível nesta página.', 404);
      ensure(!completed || (Number.isSafeInteger(startedAt) && startedAt > 0
        && startedAt <= now), 'Horário de início inválido.');
      const hash = linkHash(link);
      return withDatabase(database => {
        database.exec('BEGIN IMMEDIATE');
        try {
          if (completed) database.prepare(`INSERT INTO external_material_reads (hash, started_at, completed_at)
            VALUES (?, ?, ?) ON CONFLICT(hash) DO NOTHING`).run(hash, startedAt, now);
          const insert = database.prepare(`INSERT INTO external_material_notes (id, hash, body, image, source_url, source_page)
            VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`);
          for (const note of drafts) insert.run(note.id, hash, note.text, note.image, link.url, page);
          const record = database.prepare(`SELECT started_at AS startedAt, completed_at AS completedAt
            FROM external_material_reads WHERE hash = ?`).get(hash);
          const notes = notesFor(database, hash);
          database.exec('COMMIT');
          return { hash, page, url, ...record, ...(notes.length ? { notes } : {}) };
        } catch (error) {
          database.exec('ROLLBACK');
          throw error;
        }
      });
    },
    noteImage(unitId, hash, id) {
      ensure(noteScope(store.get(unitId), hash) && fs.existsSync(file()), 'Imagem indisponível.', 404);
      return withDatabase(database => {
        const note = database.prepare('SELECT image FROM external_material_notes WHERE hash = ? AND id = ?').get(hash, id);
        ensure(note?.image, 'Imagem indisponível.', 404);
        const [header, data] = note.image.split(',');
        return { type: header.slice(5, -7), data: Buffer.from(data, 'base64') };
      });
    },
    removeNote(unitId, hash, id) {
      ensure(noteScope(store.get(unitId), hash) && fs.existsSync(file()), 'Link indisponível.', 404);
      return withDatabase(database => {
        database.prepare('DELETE FROM external_material_notes WHERE hash = ? AND id = ?').run(hash, id);
        return notesFor(database, hash);
      });
    },
    save(entries) {
      ensure(Array.isArray(entries) && entries.length <= 100, 'Lote de progresso inválido.');
      const units = new Map(store.list({ includeHidden: true }).map(unit => [unit.id, unit]));
      const incoming = entries.flatMap(entry => {
        ensure(typeof entry?.unit === 'string' && Array.isArray(entry.visited) && entry.visited.length <= 100
          && entry.visited.every(page => typeof page === 'string' && page.length <= 120)
          && typeof entry.lastPage === 'string' && entry.lastPage.length <= 120
          && Number.isSafeInteger(entry.changedAt) && entry.changedAt > 0, 'Progresso de leitura inválido.');
        const unit = units.get(entry.unit);
        if (!unit) return [];
        const allowed = new Set(materialPages(unit).map(page => page.id));
        return [{ allowed, entry: sanitize({ unit: entry.unit, lastPage: entry.lastPage, visited: entry.visited,
          changedAt: Math.min(entry.changedAt, Date.now()) }, allowed) }];
      });
      if (!incoming.length) return [];
      return withDatabase(database => {
        database.exec('BEGIN IMMEDIATE');
        try {
          const insert = database.prepare(`INSERT INTO reading_progress (unit, last_page, visited, changed_at)
            VALUES (?, ?, ?, ?) ON CONFLICT(unit) DO UPDATE SET
            last_page = excluded.last_page, visited = excluded.visited, changed_at = excluded.changed_at`);
          const updated = incoming.flatMap(({ allowed, entry }) => {
            if (!entry.lastPage) return [];
            const merged = mergeReadingProgress(sanitize(get(database, entry.unit), allowed), entry);
            insert.run(merged.unit, merged.lastPage, JSON.stringify(merged.visited), merged.changedAt);
            return [merged];
          });
          database.exec('COMMIT');
          return updated;
        } catch (error) {
          database.exec('ROLLBACK');
          throw error;
        }
      });
    },
  };
}
