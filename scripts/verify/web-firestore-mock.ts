// An in-memory stand-in for the Firestore WEB SDK (firebase/firestore), for checking the code that runs in the browser
// (lib/retail-fulfill and friends) without a database: doc/collection/query/where/orderBy/limit, getDoc(s),
// set/update/add/delete, batches and transactions, and the field sentinels. A test points 'firebase/firestore' here.
type Doc = Record<string, any>;
const store = new Map<string, Doc>();
const SENT = Symbol('sent');

export class Timestamp { constructor(public seconds: number, public nanoseconds: number) {} toDate() { return new Date(this.seconds * 1000); } toMillis() { return this.seconds * 1000; } static now() { return new Timestamp(Math.floor(Date.now() / 1000), 0); } static fromDate(d: Date) { return new Timestamp(Math.floor(d.getTime() / 1000), 0); } }
export const increment = (n: number) => ({ [SENT]: 'inc', n });
export const arrayUnion = (...v: any[]) => ({ [SENT]: 'union', v });
export const arrayRemove = (...v: any[]) => ({ [SENT]: 'remove', v });
export const deleteField = () => ({ [SENT]: 'del' });
export const serverTimestamp = () => ({ [SENT]: 'ts' });
export const documentId = () => '__name__';

function setPath(o: Doc, k: string, v: any) {
  const path = k.split('.'); let cur = o;
  for (let i = 0; i < path.length - 1; i++) { cur[path[i]] = { ...(cur[path[i]] || {}) }; cur = cur[path[i]]; }
  const last = path[path.length - 1]; const s = v && typeof v === 'object' ? v[SENT] : undefined;
  if (s === 'inc') cur[last] = (Number(cur[last]) || 0) + v.n;
  else if (s === 'union') cur[last] = [...(cur[last] || []), ...v.v.filter((x: any) => !(cur[last] || []).some((y: any) => JSON.stringify(y) === JSON.stringify(x)))];
  else if (s === 'remove') cur[last] = (cur[last] || []).filter((y: any) => !v.v.some((x: any) => JSON.stringify(x) === JSON.stringify(y)));
  else if (s === 'del') delete cur[last];
  else if (s === 'ts') cur[last] = new Date().toISOString();
  else cur[last] = v;
}
function merge(base: Doc, patch: Doc, deep: boolean): Doc {
  const out = JSON.parse(JSON.stringify(base || {}));
  for (const [k, v] of Object.entries(patch || {})) {
    if (deep && v && typeof v === 'object' && !Array.isArray(v) && !(v as any)[SENT] && out[k] && typeof out[k] === 'object' && !Array.isArray(out[k])) out[k] = merge(out[k], v as Doc, true);
    else setPath(out, k, v);
  }
  return out;
}
export function reset() { store.clear(); auto = 0; }
export function seed(path: string, data: Doc) { store.set(path, JSON.parse(JSON.stringify(data))); }
export function read(path: string): Doc | null { const d = store.get(path); return d ? JSON.parse(JSON.stringify(d)) : null; }
export function list(prefix: string): (Doc & { id: string })[] { return [...store.entries()].filter(([p]) => p.startsWith(`${prefix}/`) && p.split('/').length === prefix.split('/').length + 1).map(([p, d]) => ({ ...JSON.parse(JSON.stringify(d)), id: p.split('/').pop()! })); }

let auto = 0;
const ref = (path: string): any => ({ type: 'document', path, id: path.split('/').pop(), parent: { path: path.split('/').slice(0, -1).join('/') } });
const colRef = (path: string): any => ({ type: 'collection', path, id: path.split('/').pop() });
export function getFirestore() { return {}; }
export type Firestore = any; export type Query = any; export type Transaction = any; export type DocumentData = any;
export function doc(a: any, ...segs: string[]) {
  if (a && a.type === 'collection') { const id = segs.length ? segs.join('/') : `auto${++auto}`; return ref(`${a.path}/${id}`); }
  if (a && a.type === 'document') { return ref(`${a.path}/${segs.join('/')}`); }
  const p = segs.join('/'); if (p.split('/').length % 2 === 1) return ref(`${p}/auto${++auto}`); return ref(p);
}
export function collection(a: any, ...segs: string[]) { const base = a && a.path ? `${a.path}/` : ''; return colRef(`${base}${segs.join('/')}`); }
export function query(c: any, ...cs: any[]) { return { ...c, type: 'query', cons: [...(c.cons || []), ...cs] }; }
export const where = (field: string, op: string, value: any) => ({ k: 'where', field, op, value });
export const orderBy = (field: string, dir: 'asc' | 'desc' = 'asc') => ({ k: 'orderBy', field, dir });
export const limit = (n: number) => ({ k: 'limit', n });
const get = (o: any, f: string) => f.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);
const cmp = (op: string, a: any, b: any) => op === '==' ? a === b : op === '!=' ? a !== b : op === '<' ? a < b : op === '<=' ? a <= b : op === '>' ? a > b : op === '>=' ? a >= b
  : op === 'in' ? (b || []).includes(a) : op === 'not-in' ? !(b || []).includes(a) : op === 'array-contains' ? Array.isArray(a) && a.includes(b) : op === 'array-contains-any' ? Array.isArray(a) && (b || []).some((x: any) => a.includes(x)) : false;
function run(q: any): { id: string; path: string }[] {
  const depth = q.path.split('/').length;
  let rows = [...store.entries()].filter(([p]) => p.startsWith(`${q.path}/`) && p.split('/').length === depth + 1).map(([p, d]) => ({ id: p.split('/').pop()!, path: p, data: d }));
  for (const c of q.cons || []) if (c.k === 'where') rows = rows.filter((r) => cmp(c.op, c.field === '__name__' ? r.id : get(r.data, c.field), c.value));
  for (const o of [...(q.cons || []).filter((c: any) => c.k === 'orderBy')].reverse()) rows = rows.sort((a, b) => { const x = get(a.data, o.field); const y = get(b.data, o.field); return (x < y ? -1 : x > y ? 1 : 0) * (o.dir === 'desc' ? -1 : 1); });
  const lim = (q.cons || []).find((c: any) => c.k === 'limit');
  return lim ? rows.slice(0, lim.n) : rows;
}
const docSnap = (path: string) => { const d = store.get(path); return { id: path.split('/').pop(), ref: ref(path), exists: () => !!d, data: () => (d ? JSON.parse(JSON.stringify(d)) : undefined), get: (f: string) => (d ? get(d, f) : undefined) }; };
const querySnap = (rows: any[]) => { const docs = rows.map((r) => docSnap(r.path)); return { docs, size: docs.length, empty: !docs.length, forEach: (f: any) => docs.forEach(f) }; };
export async function getDoc(r: any) { return docSnap(r.path); }
export async function getDocs(q: any) { return querySnap(run(q)); }
const write = (path: string, data: Doc, opt?: any) => { store.set(path, opt?.merge ? merge(store.get(path) || {}, data, true) : merge({}, data, false)); };
const upd = (path: string, data: Doc) => { if (!store.has(path)) throw new Error(`No document to update: ${path}`); store.set(path, merge(store.get(path)!, data, false)); };
export async function setDoc(r: any, data: Doc, opt?: any) { write(r.path, data, opt); }
export async function updateDoc(r: any, data: Doc) { upd(r.path, data); }
export async function addDoc(c: any, data: Doc) { const r = ref(`${c.path}/auto${++auto}`); write(r.path, data); return r; }
export async function deleteDoc(r: any) { store.delete(r.path); }
export function writeBatch() { const ops: (() => void)[] = []; return { set: (r: any, d: Doc, o?: any) => { ops.push(() => write(r.path, d, o)); }, update: (r: any, d: Doc) => { ops.push(() => upd(r.path, d)); }, delete: (r: any) => { ops.push(() => store.delete(r.path)); }, commit: async () => { ops.forEach((f) => f()); } }; }
export async function runTransaction(_fs: any, fn: (tx: any) => any) {
  const ops: (() => void)[] = [];
  const tx = { get: async (r: any) => docSnap(r.path), set: (r: any, d: Doc, o?: any) => { ops.push(() => write(r.path, d, o)); return tx; }, update: (r: any, d: Doc) => { ops.push(() => upd(r.path, d)); return tx; }, delete: (r: any) => { ops.push(() => store.delete(r.path)); return tx; } };
  const out = await fn(tx); ops.forEach((f) => f()); return out;
}
export function onSnapshot() { return () => undefined; }
