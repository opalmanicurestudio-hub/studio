// scripts/verify/fake-db.ts — a small in-memory stand-in for the Firestore admin API, for checking server logic
// without a live database: doc/collection/where/limit/get/set/update/batch/runTransaction, the field sentinels we use
// (increment, delete, arrayUnion), and when each document was made and last changed (createTime, updateTime). Not
// complete — just what the checked code paths need.
type Doc = Record<string, any>;
const SENT = Symbol('sentinel');
export const FV = {
  increment: (n: number) => ({ [SENT]: 'inc', n }),
  delete: () => ({ [SENT]: 'del' }),
  arrayUnion: (...v: any[]) => ({ [SENT]: 'union', v }),
  serverTimestamp: () => ({ [SENT]: 'ts' }),
};
function apply(base: Doc, patch: Doc, deep = false) {
  const out: Doc = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    const path = k.split('.'); let o = out; for (let i = 0; i < path.length - 1; i++) { o[path[i]] = { ...(o[path[i]] || {}) }; o = o[path[i]]; }
    const last = path[path.length - 1]; const s = v && typeof v === 'object' ? (v as any)[SENT] : undefined;
    if (s === 'inc') o[last] = (Number(o[last]) || 0) + v.n; else if (s === 'del') delete o[last]; else if (s === 'union') o[last] = [...new Set([...(o[last] || []), ...v.v])]; else if (s === 'ts') o[last] = new Date().toISOString();
    else if (deep && isPlain(v) && isPlain(o[last])) o[last] = apply(o[last], v, true);   // Firestore merges nested maps on set(…, { merge: true })
    else o[last] = v;
  }
  return out;
}
const isPlain = (x: any) => !!x && typeof x === 'object' && !Array.isArray(x) && (x as any)[SENT] === undefined;
export function makeDb() {
  const store = new Map<string, Doc>(); let n = 0;
  // When each document was made and last changed (in milliseconds, never the same twice), as snapshots carry them.
  const times = new Map<string, { c: number; u: number }>(); let clock = 0;
  const touch = (path: string) => { clock = Math.max(clock + 1, Date.now()); const t = times.get(path); times.set(path, t ? { c: t.c, u: clock } : { c: clock, u: clock }); };
  const stamp = (v: number) => ({ toMillis: () => v, isEqual: (o: any) => o?.toMillis?.() === v });
  const timesOf = (path: string) => { const t = times.get(path); return t ? { createTime: stamp(t.c), updateTime: stamp(t.u) } : {}; };
  const clone = (x: any) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
  const ref = (path: string): any => ({ id: path.split('/').pop(), path,
    get: async () => ({ exists: store.has(path), id: path.split('/').pop(), ref: ref(path), data: () => clone(store.get(path)), ...timesOf(path) }),
    set: async (v: Doc, o?: any) => { store.set(path, o?.merge ? apply(store.get(path) || {}, v, true) : apply({}, v)); touch(path); },
    update: async (v: Doc) => { if (!store.has(path)) throw new Error(`no doc ${path}`); store.set(path, apply(store.get(path)!, v)); touch(path); },
    create: async (v: Doc) => { if (store.has(path)) throw new Error(`already exists ${path}`); store.set(path, apply({}, v)); touch(path); },
    delete: async () => { store.delete(path); times.delete(path); },
    collection: (c: string) => col(`${path}/${c}`) });
  const cmp = (op: string, a: any, b: any) => op === '==' ? a === b : op === '!=' ? a !== b && a !== undefined : op === '<=' ? a != null && a <= b : op === '<' ? a != null && a < b : op === '>=' ? a != null && a >= b : op === '>' ? a != null && a > b : op === 'in' ? (b as any[]).includes(a) : op === 'array-contains' ? Array.isArray(a) && a.includes(b) : op === 'array-contains-any' ? Array.isArray(a) && (b as any[]).some((x) => a.includes(x)) : false;
  // orderBy('__name__') returns documents in id order, as Firestore does; startAfter takes a snapshot or an id, for
  // paging in that order. Any other orderBy is ignored (insertion order).
  const q = (c: string, f: [string, string, any][] = [], lim = 1e9, after = '', byId = false): any => ({
    where: (k: string, op: string, v: any) => q(c, [...f, [k, op, v]], lim, after, byId), limit: (l: number) => q(c, f, l, after, byId),
    orderBy: (k?: any) => q(c, f, lim, after, byId || k === '__name__'),
    startAfter: (x: any) => q(c, f, lim, typeof x === 'string' ? x : String(x?.id || ''), true),
    get: async () => { const docs = [...store.entries()].filter(([p]) => p.startsWith(c + '/') && p.split('/').length === c.split('/').length + 1)
      .filter(([, d]) => f.every(([k, op, v]) => cmp(op, k.split('.').reduce((o: any, x) => (o == null ? o : o[x]), d), v)))
      .sort(([a], [b]) => (!byId ? 0 : a < b ? -1 : a > b ? 1 : 0)).filter(([p]) => !after || String(p.split('/').pop()) > after).slice(0, lim)
      .map(([p, d]) => ({ id: p.split('/').pop(), ref: ref(p), exists: true, data: () => clone(d), ...timesOf(p) }));
      return { empty: !docs.length, size: docs.length, docs }; } });
  const col = (c: string): any => ({ ...q(c), doc: (id?: string) => ref(`${c}/${id || `id${++n}`}`), add: async (v: Doc) => { const r = ref(`${c}/id${++n}`); await r.set(v); return r; } });
  const db: any = { doc: ref, collection: col, getAll: async (...refs: any[]) => Promise.all(refs.map((r) => r.get())),
    // All or nothing, as Firestore commits a batch: a create of a document that exists fails the whole batch.
    batch: () => { const ops: { kind: string; r: any; v?: Doc; o?: any }[] = []; return { set: (r: any, v: Doc, o?: any) => ops.push({ kind: 'set', r, v, o }), update: (r: any, v: Doc) => ops.push({ kind: 'update', r, v }), create: (r: any, v: Doc) => ops.push({ kind: 'create', r, v }), delete: (r: any) => ops.push({ kind: 'delete', r }),
      commit: async () => {
        const exists = new Set<string>([...store.keys()]);
        for (const op of ops) { const p = op.r.path;
          if (op.kind === 'create' && exists.has(p)) throw Object.assign(new Error(`6 ALREADY_EXISTS: Document already exists: ${p}`), { code: 6 });
          if (op.kind === 'update' && !exists.has(p)) throw Object.assign(new Error(`5 NOT_FOUND: ${p}`), { code: 5 });
          if (op.kind === 'delete') exists.delete(p); else exists.add(p); }
        for (const op of ops) { if (op.kind === 'set') await op.r.set(op.v, op.o); else if (op.kind === 'update') await op.r.update(op.v); else if (op.kind === 'create') await op.r.create(op.v); else await op.r.delete(); } } }; },
    runTransaction: async (fn: any) => fn({ get: (r: any) => (r.get ? r.get() : r), set: (r: any, v: Doc, o?: any) => r.set(v, o), update: (r: any, v: Doc) => r.update(v), delete: (r: any) => r.delete() }),
    _store: store };
  return db;
}
export let failures = 0;
export function check(name: string, ok: any, detail?: any) { if (ok) console.log(`  ✓ ${name}`); else { failures++; console.log(`  ✗ ${name}`, detail === undefined ? '' : JSON.stringify(detail)); } }
