// scripts/verify/fake-db.ts — a small in-memory stand-in for the Firestore admin API, for checking server logic
// without a live database: doc/collection/where/limit/get/set/update/batch/runTransaction and the field sentinels
// we use (increment, delete, arrayUnion). Not complete — just what the checked code paths need.
type Doc = Record<string, any>;
const SENT = Symbol('sentinel');
export const FV = {
  increment: (n: number) => ({ [SENT]: 'inc', n }),
  delete: () => ({ [SENT]: 'del' }),
  arrayUnion: (...v: any[]) => ({ [SENT]: 'union', v }),
  serverTimestamp: () => ({ [SENT]: 'ts' }),
};
function apply(base: Doc, patch: Doc) {
  const out: Doc = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    const path = k.split('.'); let o = out; for (let i = 0; i < path.length - 1; i++) { o[path[i]] = { ...(o[path[i]] || {}) }; o = o[path[i]]; }
    const last = path[path.length - 1]; const s = v && typeof v === 'object' ? (v as any)[SENT] : undefined;
    if (s === 'inc') o[last] = (Number(o[last]) || 0) + v.n; else if (s === 'del') delete o[last]; else if (s === 'union') o[last] = [...new Set([...(o[last] || []), ...v.v])]; else if (s === 'ts') o[last] = new Date().toISOString();
    else o[last] = v;
  }
  return out;
}
export function makeDb() {
  const store = new Map<string, Doc>(); let n = 0;
  const clone = (x: any) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
  const ref = (path: string): any => ({ id: path.split('/').pop(), path,
    get: async () => ({ exists: store.has(path), id: path.split('/').pop(), ref: ref(path), data: () => clone(store.get(path)) }),
    set: async (v: Doc, o?: any) => { store.set(path, o?.merge ? apply(store.get(path) || {}, v) : apply({}, v)); },
    update: async (v: Doc) => { if (!store.has(path)) throw new Error(`no doc ${path}`); store.set(path, apply(store.get(path)!, v)); },
    delete: async () => { store.delete(path); },
    collection: (c: string) => col(`${path}/${c}`) });
  const cmp = (op: string, a: any, b: any) => op === '==' ? a === b : op === '!=' ? a !== b && a !== undefined : op === '<=' ? a != null && a <= b : op === '<' ? a != null && a < b : op === '>=' ? a != null && a >= b : op === '>' ? a != null && a > b : op === 'in' ? (b as any[]).includes(a) : op === 'array-contains' ? Array.isArray(a) && a.includes(b) : false;
  const q = (c: string, f: [string, string, any][] = [], lim = 1e9): any => ({
    where: (k: string, op: string, v: any) => q(c, [...f, [k, op, v]], lim), limit: (l: number) => q(c, f, l), orderBy: () => q(c, f, lim),
    get: async () => { const docs = [...store.entries()].filter(([p]) => p.startsWith(c + '/') && p.split('/').length === c.split('/').length + 1)
      .filter(([, d]) => f.every(([k, op, v]) => cmp(op, k.split('.').reduce((o: any, x) => (o == null ? o : o[x]), d), v))).slice(0, lim)
      .map(([p, d]) => ({ id: p.split('/').pop(), ref: ref(p), exists: true, data: () => clone(d) }));
      return { empty: !docs.length, size: docs.length, docs }; } });
  const col = (c: string): any => ({ ...q(c), doc: (id?: string) => ref(`${c}/${id || `id${++n}`}`), add: async (v: Doc) => { const r = ref(`${c}/id${++n}`); await r.set(v); return r; } });
  const db: any = { doc: ref, collection: col,
    batch: () => { const ops: (() => Promise<void>)[] = []; return { set: (r: any, v: Doc, o?: any) => ops.push(() => r.set(v, o)), update: (r: any, v: Doc) => ops.push(() => r.update(v)), delete: (r: any) => ops.push(() => r.delete()), commit: async () => { for (const op of ops) await op(); } }; },
    runTransaction: async (fn: any) => fn({ get: (r: any) => (r.get ? r.get() : r), set: (r: any, v: Doc, o?: any) => r.set(v, o), update: (r: any, v: Doc) => r.update(v), delete: (r: any) => r.delete() }),
    _store: store };
  return db;
}
export let failures = 0;
export function check(name: string, ok: any, detail?: any) { if (ok) console.log(`  ✓ ${name}`); else { failures++; console.log(`  ✗ ${name}`, detail === undefined ? '' : JSON.stringify(detail)); } }
