// src/lib/fs-any.ts — THE SAME DATABASE CALLS, IN THE BROWSER OR ON THE SERVER. The fulfillment engine (lib/retail-
// fulfill) is written once against the browser SDK's calls (doc, collection, query, where, getDocs, runTransaction…).
// Handed the server's database instead, each call here does the same thing through the server's SDK, so the engine
// runs on the server, where its checks can't be skipped, without being written twice.
import {
  collection as cCollection, doc as cDoc, getDoc as cGetDoc, getDocs as cGetDocs, limit as cLimit, orderBy as cOrderBy,
  query as cQuery, runTransaction as cRunTransaction, where as cWhere,
} from 'firebase/firestore';

/** The server's database (firebase-admin): it has methods of its own; the browser's is a plain handle. */
export const isServerDb = (fs: any): boolean => !!fs && typeof fs.collection === 'function' && typeof fs.runTransaction === 'function' && typeof fs.doc === 'function';
const isServerRef = (r: any): boolean => !!r && typeof r.get === 'function' && (typeof r.collection === 'function' || typeof r.doc === 'function') && !r.type;

type Con = { k: 'where'; f: string; op: any; v: any } | { k: 'limit'; n: number } | { k: 'orderBy'; f: string; dir?: 'asc' | 'desc' };
export const where = (f: string, op: any, v: any): any => ({ k: 'where', f, op, v } as Con);
export const limit = (n: number): any => ({ k: 'limit', n } as Con);
export const orderBy = (f: string, dir?: 'asc' | 'desc'): any => ({ k: 'orderBy', f, dir } as Con);
const toClient = (c: Con) => (c.k === 'where' ? cWhere(c.f, c.op, c.v) : c.k === 'limit' ? cLimit(c.n) : cOrderBy(c.f, c.dir));

/** A snapshot the browser's way: exists() is a function. */
function snap(s: any): any {
  if (!s || typeof s.exists === 'function') return s;
  return { id: s.id, ref: s.ref, exists: () => !!s.exists, data: () => (s.exists ? s.data() : undefined), get: (f: string) => s.get(f) };
}

export function collection(base: any, path: string, ...segs: string[]): any {
  const p = [path, ...segs].join('/');
  if (isServerDb(base)) return base.collection(p);
  if (isServerRef(base)) return base.collection(p);
  return (cCollection as any)(base, path, ...segs);
}

export function doc(base: any, path?: string, ...segs: string[]): any {
  if (isServerDb(base)) return base.doc([path, ...segs].join('/'));
  if (isServerRef(base)) return path === undefined ? base.doc() : base.doc([path, ...segs].join('/'));
  return path === undefined ? (cDoc as any)(base) : (cDoc as any)(base, path, ...segs);
}

export function query(ref: any, ...cons: Con[]): any {
  if (!isServerRef(ref)) return (cQuery as any)(ref, ...cons.map(toClient));
  let q = ref;
  for (const c of cons) q = c.k === 'where' ? q.where(c.f, c.op, c.v) : c.k === 'limit' ? q.limit(c.n) : q.orderBy(c.f, c.dir);
  return q;
}

export async function getDoc(ref: any): Promise<any> {
  if (isServerRef(ref)) return snap(await ref.get());
  return cGetDoc(ref);
}

export type AnyDocs = { docs: any[]; empty: boolean; size: number; forEach: (fn: (d: any) => void) => void };
export async function getDocs(q: any): Promise<AnyDocs> {
  if (typeof q?.get === 'function' && !q.type) {
    const s = await q.get();
    return { docs: s.docs.map(snap), empty: s.empty, size: s.size, forEach: (fn: any) => s.docs.map(snap).forEach(fn) };
  }
  return (await cGetDocs(q)) as any;
}

export function runTransaction<T>(fs: any, fn: (txn: any) => Promise<T>): Promise<T> {
  if (!isServerDb(fs)) return cRunTransaction(fs, fn as any);
  return fs.runTransaction(async (t: any) => fn({
    get: async (r: any) => snap(await t.get(r)),
    set: (r: any, d: any, o?: any) => { (o ? t.set(r, d, o) : t.set(r, d)); return undefined; },
    update: (r: any, d: any) => { t.update(r, d); return undefined; },
    delete: (r: any) => { t.delete(r); return undefined; },
  }));
}

export type Firestore = any;
