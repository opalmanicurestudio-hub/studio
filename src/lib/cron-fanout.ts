// src/lib/cron-fanout.ts — BACKGROUND JOBS THAT GROW WITH THE NUMBER OF BUSINESSES. A job that walked every business
// one after another eventually runs out of time, and the businesses at the end of the list are never reached. This
// runs several businesses at once, stops starting new ones shortly before the time limit, and remembers where it
// stopped, so the next run starts there: everyone gets their turn, however many businesses there are.
// A business whose own work was cut off by the time limit says so (it returns { again: true }) and goes first next
// time, ahead of the rotation, which carries on from where it stopped. Only once: a business cut off while it was
// going first waits for its turn in the rotation like everyone else, so busy ones can't hold the others back.

export interface FanoutResult { done: number; total: number; nextStart: number; ranOut: boolean }

export async function forEachTenant(
  db: any,
  job: string,
  fn: (t: { id: string; data: any }) => Promise<void | { again?: boolean }>,
  opts: { concurrency?: number; budgetMs?: number; startedAt?: number; clock?: () => number } = {},
): Promise<FanoutResult> {
  const clock = opts.clock || Date.now;
  const concurrency = Math.max(1, opts.concurrency ?? 6);
  const deadline = (opts.startedAt ?? clock()) + (opts.budgetMs ?? 45_000);
  const docs: any[] = (await db.collection('tenants').get()).docs;
  const total = docs.length;
  if (!total) return { done: 0, total: 0, nextStart: 0, ranOut: false };
  const cursorRef = db.doc(`system/cronCursors`);
  let start = 0; let firstIds: string[] = [];
  try {
    const c = (await cursorRef.get()).data() || {};
    start = Math.max(0, Math.floor(Number(c[job]) || 0)) % total;
    firstIds = Array.isArray(c[`${job}First`]) ? c[`${job}First`].map(String) : [];
  } catch { /* from the top */ }
  const byId = new Map(docs.map((d: any) => [d.id, d]));
  const first: any[] = [...new Set(firstIds)].map((id) => byId.get(id)).filter(Boolean);
  const going = new Set(first.map((d: any) => d.id));
  const rotation = [...docs.slice(start), ...docs.slice(0, start)].filter((d: any) => !going.has(d.id));
  const order = [...first, ...rotation];
  let next = 0; let done = 0; const again: string[] = [];
  const worker = async () => {
    for (;;) {
      if (clock() > deadline) return;
      const i = next++; if (i >= order.length) return;
      const d = order[i];
      try {
        const r = await fn({ id: d.id, data: d.data() || {} });
        if (r && r.again && !going.has(d.id)) again.push(d.id);
      } catch (e: any) { console.error(`[${job}]`, d.id, String(e?.message || e).slice(0, 200)); }
      done++;
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, order.length) }, worker));
  // Businesses are taken in order, so everything before `done` was reached. Ones due to go first that weren't reached
  // keep their place; the rotation resumes at its first business not reached.
  const nextFirst = [...first.slice(done).map((d: any) => d.id), ...again];
  const reached = Math.max(0, done - first.length);
  const ranOut = done < order.length;
  const nextStart = ranOut && reached < rotation.length ? docs.indexOf(rotation[reached]) : 0;
  try { await cursorRef.set({ [job]: nextStart, [`${job}First`]: nextFirst.slice(0, 100), [`${job}At`]: new Date().toISOString() }, { merge: true }); } catch { /* next run starts from the top */ }
  return { done, total, nextStart, ranOut: ranOut || nextFirst.length > 0 };
}
