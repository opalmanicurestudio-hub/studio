// src/app/api/cron/retail-nightly/route.ts — THE SHOP'S NIGHTLY CHECKS, ON THEIR OWN CLOCK. They used to run at the end
// of the main nightly job, after the bank feeds, rent, bills and maintenance, so a long night could use up its five
// minutes before they started. Now they run on their own, twice before the main job (vercel.json): each run stops
// before its time is up and remembers the last shop it reached, the second carries on from there only when the first
// was cut off, and a night that still can't finish starts the next night with the shops it missed.
//   · stock holds healed (lib/stock-reconcile) and renters' shop credits caught up (lib/renter-sales-server)
//   · gift cards and store credit back on cancelled orders (lib/cancel-restore)
//   · returns never sent back closed (lib/return-close)
//   · stock about to expire (lib/expiry-alerts), and anyone left showing as outside at curbside
//   · parcels that stopped moving, claim windows closing, resolved cases nobody touched (lib/retail-sweeps)
//   · order pages' live views past their time removed (lib/order-tracking), once a night for every shop
// Each check is marker-guarded, so running one twice sends nothing twice.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { recordCronRun } from '@/lib/cron-heartbeat';
import { refuseCron } from '@/lib/cron-auth';
import { retailNightlyForShop } from '@/lib/retail-nightly';
import { sweepTracking } from '@/lib/order-tracking';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

const BUDGET_MS = 240_000;   // stop starting new shops after four minutes, well inside the five allowed

export async function GET(req: NextRequest) {
  // Only the scheduler, holding the secret. No secret set: nobody.
  const refused = refuseCron(req); if (refused) return refused;
  void recordCronRun('retail-nightly');
  const started = Date.now();
  const db = getAdminDb();
  const today = new Date().toISOString().slice(0, 10);
  const curRef = db.doc('platformHealth/cursor_retail_nightly');
  const cur: any = (await curRef.get()).data() || {};
  if (cur.day === today && cur.done) return NextResponse.json({ ok: true, skipped: 'Already done today.' });

  const all = (await db.collection('tenants').orderBy('__name__').get()).docs;
  const ids: string[] = all.map((d: any) => String(d.id));
  const n = ids.length;
  const after = (id: string) => { if (!id) return 0; const i = ids.findIndex((x) => x > id); return i < 0 ? 0 : i; };
  // Carrying on today's round where the last run stopped, or starting a new one just after where the last round ended.
  const continuing = cur.day === today && !cur.done && !!cur.cycleStart;
  const start = after(String(cur.after || ''));
  const cycleStart = continuing ? String(cur.cycleStart) : ids[start] || '';
  const results: Record<string, any> = {};
  let last = String(cur.after || ''); let reached = 0; let cutOff = false;
  for (let k = 0; k < n; k++) {
    const i = (start + k) % n;
    if (ids[i] === cycleStart && (k > 0 || continuing)) break;   // round complete
    if (Date.now() - started > BUDGET_MS) { cutOff = true; break; }
    const r = await retailNightlyForShop(db, ids[i], all[i].data() || {});
    if (Object.keys(r).length) results[ids[i]] = r;
    last = ids[i]; reached++;
  }
  // Live views of orders whose link has expired (lib/order-tracking): one sweep for every shop at once.
  let trackingRemoved = 0; if (!cutOff) { try { trackingRemoved = await sweepTracking(db); } catch (e: any) { console.warn('[cron/retail-nightly] tracking sweep', String(e?.message || e).slice(0, 160)); } }
  await curRef.set({ day: today, cycleStart, after: last, done: !cutOff, at: new Date().toISOString(), reached }, { merge: true });
  console.log('[cron/retail-nightly]', { shops: reached, cutOff, changed: Object.keys(results).length });
  return NextResponse.json({ ok: true, shops: reached, cutOff, trackingRemoved, results });
}
