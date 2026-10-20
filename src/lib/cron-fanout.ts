// src/lib/cron-fanout.ts — BACKGROUND JOBS THAT GROW WITH THE NUMBER OF BUSINESSES. A job that walked every business
// one after another eventually runs out of time, and the businesses at the end of the list are never reached. This
// runs several businesses at once, stops starting new ones shortly before the time limit, and remembers where it
// stopped, so the next run starts there: everyone gets their turn, however many businesses there are.

export interface FanoutResult { done: number; total: number; nextStart: number; ranOut: boolean }

export async function forEachTenant(
  db: any,
  job: string,
  fn: (t: { id: string; data: any }) => Promise<void>,
  opts: { concurrency?: number; budgetMs?: number; startedAt?: number } = {},
): Promise<FanoutResult> {
  const concurrency = Math.max(1, opts.concurrency ?? 6);
  const deadline = (opts.startedAt ?? Date.now()) + (opts.budgetMs ?? 45_000);
  const docs: any[] = (await db.collection('tenants').get()).docs;
  const total = docs.length;
  if (!total) return { done: 0, total: 0, nextStart: 0, ranOut: false };
  const cursorRef = db.doc(`system/cronCursors`);
  let start = 0;
  try { start = Math.max(0, Math.floor(Number((await cursorRef.get()).data()?.[job]) || 0)) % total; } catch { /* from the top */ }
  const order = [...docs.slice(start), ...docs.slice(0, start)];
  let next = 0; let done = 0; let ranOut = false;
  const worker = async () => {
    for (;;) {
      if (Date.now() > deadline) { ranOut = true; return; }
      const i = next++; if (i >= order.length) return;
      const d = order[i];
      try { await fn({ id: d.id, data: d.data() || {} }); } catch (e: any) { console.error(`[${job}]`, d.id, String(e?.message || e).slice(0, 200)); }
      done++;
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, order.length) }, worker));
  const nextStart = ranOut ? (start + done) % total : 0;
  try { await cursorRef.set({ [job]: nextStart, [`${job}At`]: new Date().toISOString() }, { merge: true }); } catch { /* next run starts from the top */ }
  return { done, total, nextStart, ranOut };
}
