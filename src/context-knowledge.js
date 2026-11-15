import { readFile, open, mkdir, writeFile, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import { projects } from './project-knowledge.js';

const MAX_BYTES = 256 * 1024;
export function validateKnowledge(value) {
  if (value?.schemaVersion !== 1 || !/^\d{4}-\d{2}-\d{2}$/.test(value.reviewedAt) || !Array.isArray(value.projects) || value.projects.length !== projects.length) throw Error('Invalid catalog');
  const text = (v, max) => typeof v === 'string' && v.trim() && v.length <= max && !/[\x00-\x08\x0b-\x1f]/.test(v);
  for (const p of projects) {
    const entries = value.projects.filter(x => x.id === p.id);
    const e = entries[0];
    if (entries.length !== 1 || !text(e.source, 500) || !text(e.implementedRevision, 500) || !(e.deployedRevision === null || text(e.deployedRevision, 500)) || !text(e.summary, 350) || !text(e.overview, 1100) || !Array.isArray(e.topics) || e.topics.length !== p.topics.length || e.topics.some(t => !text(t, 1600))) throw Error('Invalid project');
  }
  return value;
}

export function createContextKnowledge({ filePath = process.env.WHITEBIRD_CONTEXT_PATH, cachePath = process.env.WHITEBIRD_CONTEXT_CACHE, now = Date.now, intervalMs = 10000 } = {}) {
  let catalog, checkedAt, stale = true, pending;
  const snapshot = () => ({ catalog, checkedAt, stale });
  async function refresh() {
    if (pending) return pending;
    pending = (async () => {
      try {
        if (!filePath) throw Error('No local context path');
        const file = await open(filePath, 'r');
        let raw;
        try {
          if (!(await file.stat()).isFile()) throw Error('Not a regular file');
          const buffer = Buffer.alloc(MAX_BYTES + 1);
          const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
          if (bytesRead > MAX_BYTES) throw Error('Catalog too large');
          raw = buffer.subarray(0, bytesRead).toString('utf8');
        } finally { await file.close(); }
        const next = validateKnowledge(JSON.parse(raw));
        const stamp = new Date(now()).toISOString();
        if (cachePath) {
          const temporary = `${cachePath}.${process.pid}.tmp`;
          try {
            await mkdir(dirname(cachePath), { recursive: true, mode: 0o700 });
            await writeFile(temporary, JSON.stringify({ catalog: next, checkedAt: stamp }), { mode: 0o600 });
            await rename(temporary, cachePath);
          } catch { /* A read-only cache must not hide a valid deployed catalog. */ }
        }
        catalog = next; checkedAt = stamp; stale = false;
      } catch { stale = true; }
      return snapshot();
    })();
    try { return await pending; } finally { pending = undefined; }
  }
  return {
    snapshot,
    refresh,
    async start() {
      if (cachePath) {
        try {
          const raw = await readFile(cachePath, 'utf8');
          if (Buffer.byteLength(raw) > MAX_BYTES) throw Error('Cache too large');
          const saved = JSON.parse(raw);
          catalog = validateKnowledge(saved.catalog); checkedAt = saved.checkedAt;
        } catch { /* Fall back to bundled documented help. */ }
      }
      await refresh();
      const timer = setInterval(refresh, intervalMs); timer.unref();
      return () => clearInterval(timer);
    }
  };
}

export const contextKnowledge = createContextKnowledge();
