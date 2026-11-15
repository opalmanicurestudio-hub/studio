// src/app/api/back/route.ts — THE DISH PIT AND THE BARBACK (design canvas "Dish and barback"; the screens at /dish and
// /barback, and the kitchen screen's Call). Like the kitchen screen, a tablet in the dish pit or behind the bar has nobody
// signed in: it uses the key of a kitchen screen or floor board a manager set up (api/kitchen 'pair'), and a PIN
// (api/kitchen 'pin') puts a name on what's done. A team member signed in on their own phone can use it as themselves.
//   dish       { tenantId, key?, staffPass? }      → the calls to the dish pit, what's heading its way, the tables being
//                                                    cleared, tonight's rush, the machine check and today's breakage
//   barback    { tenantId, key?, staffPass? }      → the calls to the barback, what's running low at the bar, the drinks
//                                                    made in the last hour and tonight's rush (lib/barback-server)
//   changed    { tenantId, key?, staffPass?, itemId } → a keg or bottle changed (a little left by the count is pour loss).
//                                                    It moves stock, so on a shared tablet it needs a PIN first (code 'pin')
//   undoChange { tenantId, key?, staffPass?, id }  → a change tapped by mistake, put back (within a few minutes)
//   calls      { tenantId, key?, staffPass? }      → this screen's own calls (still going, or done in the last minutes)
//   call       { tenantId, key?, staffPass?, to, what, note?, station? } → ask the dish pit or the barback
//   callStep   { tenantId, key?, staffPass?, id, step: 'coming'|'done'|'cancel'|'release' } (cancel: only the station
//                                                    that asked; release: only whoever took it)
//   machine    { tenantId, key?, staffPass?, value, note? } → a machine reading (lib/dish). On a shared tablet it needs
//                                                    a PIN first (code 'pin'), so the log shows who took it
//   machineLog { tenantId, key?, staffPass? }      → the last 30 days of readings, to print
//   broke      { tenantId, key?, staffPass?, kind, count, note? }
//   closing    { tenantId, key?, staffPass?, area: 'dish'|'bar' }, closingCheck { …, area, itemId, done?, value?, note? }
//                                                  → tonight's closing items for that area and anyone's (lib/night-close)
//   settings   { tenantId, dish }                  (an owner or manager, signed in) → the machine check settings
// A call nobody has taken after a few minutes tells the owner and managers (lib/back-calls-server tellLate), checked
// whenever a screen reads its calls; calls from before yesterday are cleared away now and then. A paused or closed
// business has these screens closed too.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { requireRole } from '@/lib/route-guard';
import { limitPublic } from '@/lib/rate-limit';
import { accessLockOf } from '@/lib/tenant-access';
import { toolLocked } from '@/lib/tool-lock';
import { screenOf, teamInstead, workingNow } from '@/lib/screen-keys';
import { callQueue, cleanCall, myCalls } from '@/lib/back-calls';
import { CallStop, makeCall, readCalls, stepCall, sweepOld, tellLate } from '@/lib/back-calls-server';
import { BarStop, barbackFor, changePart, undoChange } from '@/lib/barback-server';
import { cleanDishSettings } from '@/lib/dish';
import { DishStop, dishFor, machineLog, recordBreak, recordMachine } from '@/lib/dish-server';

export const dynamic = 'force-dynamic';

const ok = (b: any = {}) => NextResponse.json({ ok: true, ...b }, { headers: { 'Cache-Control': 'no-store' } });
const bad = (error: string, status = 400, more: any = {}) => NextResponse.json({ ok: false, error, ...more }, { status });
const ID = /^[A-Za-z0-9_-]{1,160}$/;
const clip = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const ACTIONS = ['dish', 'barback', 'calls', 'call', 'callStep', 'machine', 'machineLog', 'broke', 'changed', 'undoChange', 'closing', 'closingCheck', 'settings'];
const WRITES = ['call', 'callStep', 'machine', 'broke', 'changed', 'undoChange', 'closingCheck'];

// Telling the managers about a late call is checked at most this often for a business (every screen reads every few seconds).
const LATE_EVERY_MS = 30000, SWEEP_EVERY_MS = 10 * 60000;
const lateChecked = new Map<string, number>(); const swept = new Map<string, number>();

export async function POST(req: NextRequest) {
  try {
    const b: any = await req.json().catch(() => ({}));
    const tenantId = String(b.tenantId || ''); if (!ID.test(tenantId)) return bad('Which business?');
    const action = String(b.action || ''); if (!ACTIONS.includes(action)) return bad('Unknown action.');
    const db = getAdminDb(); const T = `tenants/${tenantId}`;

    if (action === 'settings') {
      const g: any = await requireRole(req, tenantId, 'manager'); if (g.deny) return g.deny;
      const s = cleanDishSettings(b.dish); if (!s) return bad('Check the numbers: the rinse between 120 and 200°F, the sanitizer between 1 and 1000 ppm (the lowest under the highest).');
      await db.doc(T).set({ dishSettings: s }, { merge: true });
      return ok({ dish: s });
    }

    // A set-up screen (the kitchen screen's or a floor board's), or a team member signed in on their own device.
    let screen: any = await screenOf(db, tenantId, b.key);
    let member: { id: string; name: string } | null = null;
    if (!screen && !b.key) {
      const t: any = await teamInstead(req, db, tenantId);
      if (t.deny) return t.deny;
      if (t.renter) return bad('This is for the business’s own team.', 403);
      member = t.member; screen = { ref: null, name: member!.name, passes: {} };
    }
    if (!screen) {
      const slow = await limitPublic(req, 'kitchen_key', tenantId, { perHour: 60, perDay: 2000 }); if (slow) return slow;
      return bad('This screen isn’t set up, or was stopped. A manager can set it up again here.', 401);
    }
    if (screen.ref && (screen.kind === 'drive-thru' || screen.kind === 'drive-thru-board' || screen.kind === 'host')) return bad('This screen isn’t set up for the kitchen. A manager can set it up here.', 401);
    const tenant: any = (await db.doc(T).get()).data() || {};
    if (accessLockOf(tenant).locked) return NextResponse.json({ ok: false, closed: true, error: 'This screen is closed for now. The business owner can tell you more.' }, { status: 403 });
    { const locked = toolLocked(tenant, ['hospitality', 'classes_events']); if (locked) return locked; }
    const staff = member || (b.staffPass ? await workingNow(db, tenantId, screen, b.staffPass) : null);
    const staffOk = b.staffPass && !member ? !!staff : undefined;
    const by = staff?.name || screen.name;
    // Who did it, by id: the person (PIN or sign-in), else the screen itself.
    const byId = staff?.id ? `p_${staff.id}` : screen.ref ? `s_${String(screen.ref.id).slice(0, 40)}` : 'unknown';
    if (WRITES.includes(action)) { const slow = await limitPublic(req, 'back_write', tenantId, { perHour: 600, perDay: 6000 }); if (slow) return slow; }
    // Which screen this is, for its own calls: the set-up screen, or the person on their own phone.
    const fromId = screen.ref ? `s_${String(screen.ref.id).slice(0, 40)}` : `m_${member!.id}`;
    const base = { me: byId, screen: screen.name, business: { name: clip(tenant.name || tenant.businessName, 80) }, staff: staff ? { id: staff.id, name: staff.name } : null, staffOk, signedIn: !!member };

    const lateCheck = async (calls: any[]) => {
      const last = lateChecked.get(tenantId) || 0; if (Date.now() - last < LATE_EVERY_MS) return;
      lateChecked.set(tenantId, Date.now()); await tellLate(db, tenantId, tenant, calls).catch(() => 0);
      if (Date.now() - (swept.get(tenantId) || 0) > SWEEP_EVERY_MS) { swept.set(tenantId, Date.now()); await sweepOld(db, T).catch(() => 0); }
      if (lateChecked.size > 2000) for (const [k, v] of Array.from(lateChecked)) if (Date.now() - v > SWEEP_EVERY_MS) { lateChecked.delete(k); swept.delete(k); }
    };

    if (action === 'dish') {
      const [calls, dish] = await Promise.all([readCalls(db, T), dishFor(db, T, tenant)]);
      await lateCheck(calls);
      return ok({ ...base, calls: callQueue(calls, 'dish'), mine: myCalls(calls, fromId), dish, now: new Date().toISOString() });
    }
    if (action === 'barback') {
      const [calls, bar] = await Promise.all([readCalls(db, T), barbackFor(db, tenantId, tenant)]);
      await lateCheck(calls);
      return ok({ ...base, calls: callQueue(calls, 'barback'), mine: myCalls(calls, fromId), bar, now: new Date().toISOString() });
    }
    if (action === 'changed' || action === 'undoChange') {
      // Stock moves (and food cost with it): the history names a person, not just the tablet.
      if (!staff) return bad('Enter your PIN first, so the stock history shows who changed it.', 409, { code: 'pin' });
      return ok(action === 'changed' ? await changePart(db, tenantId, tenant, String(b.itemId || ''), { id: staff.id, name: staff.name }) : await undoChange(db, tenantId, String(b.id || ''), { id: staff.id, name: staff.name }));
    }
    if (action === 'calls') {
      const calls = await readCalls(db, T); await lateCheck(calls);
      return ok({ ...base, mine: myCalls(calls, fromId), now: new Date().toISOString() });
    }
    if (action === 'call') {
      const c = cleanCall(b); if ('error' in c) return bad(c.error);
      const from = clip(b.station, 40) || screen.name;
      const r = await makeCall(db, T, c, { id: fromId, name: from }, staff?.name || null);
      return ok({ call: r.call, already: r.already });
    }
    if (action === 'callStep') {
      const step = String(b.step || ''); if (!['coming', 'done', 'cancel', 'release'].includes(step)) return bad('Which step?');
      const r = await stepCall(db, T, String(b.id || ''), step as any, { id: byId, name: by }, fromId);
      return ok({ call: r.call, already: r.already });
    }
    if (action === 'machine') {
      // A reading an inspector may ask about carries a person's name, not just the tablet's.
      if (!staff) return bad('Enter your PIN first, so the log shows who took the reading.', 409, { code: 'pin' });
      return ok({ check: await recordMachine(db, tenantId, tenant, { value: b.value, note: b.note }, by) });
    }
    if (action === 'machineLog') return ok({ log: await machineLog(db, T, tenant) });
    if (action === 'broke') return ok(await recordBreak(db, T, tenant, b, by));
    if (action === 'closing' || action === 'closingCheck') {
      const area = b.area === 'bar' ? 'bar' : 'dish';
      const { closeSettingsOf } = await import('@/lib/night-close'); const { tonight, recordCheck } = await import('@/lib/night-close-server');
      const day = tonight(tenant);
      if (action === 'closingCheck') {
        const r = await recordCheck(db, T, tenant, day, String(b.itemId || ''), { done: b.done, value: b.value, note: b.note }, by, [area, 'anyone']);
        return r.ok ? ok({ mark: r.mark }) : bad(r.error, r.status || 400);
      }
      const cur: any = (await db.doc(`${T}/nightCloses/${day}`).get()).data() || {};
      return ok({ day, closed: cur.status === 'closed', items: closeSettingsOf(tenant).items.filter((i) => i.area === area || i.area === 'anyone'), checks: cur.checks || {} });
    }
    return bad('Unknown action.');
  } catch (e: any) {
    if (e instanceof CallStop || e instanceof DishStop || e instanceof BarStop) return bad(e.msg, e.status);
    console.error('[back]', e?.message || e);
    return bad('Something went wrong. Try again.', 500);
  }
}
