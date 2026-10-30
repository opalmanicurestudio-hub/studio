// /api/retail/pickup-plan — THE SHOP'S PICKUP TIMES, SET (lib/pickup-slots). The Pickup times screen reads and saves
// here: opening hours for pickup, closed days, the size of each window and what it can take, the same-day cutoff, how
// many days ahead, and a pause. The team can look; managers change it. Settings and the pause are saved on their own
// paths, so pausing never undoes an hours change made at the same time, or the other way round. Prep time is the
// shop's one "ready in" setting (retailSettings.prepMinutes), shared with Shop settings.
//   GET  ?tenantId → { plan, zoneSet, timeZone, booked, shifts }   (booked and shifts cover the days shown, for the preview)
//   POST { tenantId, plan }                         → saves the settings
//   POST { tenantId, pause: { for: 'hour' | 'today' | 'manual' | 'off' | 'keep', note? } }   ('keep' changes only the message)
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyStaffActor } from '@/lib/staff-auth';
import { FieldValue } from 'firebase-admin/firestore';
import { cleanPlan, planFrom } from '@/lib/pickup-slots';
import { bookedFrom, shiftsFor } from '@/lib/pickup-slots-server';
import { addDays, hasTimeZone, startOfDay, tenantTimeZone, todayIn } from '@/lib/tenant-time';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ID = /^[A-Za-z0-9_-]{1,80}$/;
const SETTINGS = ['hours', 'closures', 'windowMinutes', 'perWindow', 'perPerson', 'sameDayCutoff', 'daysAhead'] as const;

const planOf = (rs: any) => planFrom(rs);
const plain = (v: any) => !!v && typeof v === 'object' && !Array.isArray(v);
/** The team's sign-in, in this screen's words. */
const authError = (status: number) => (status === 401 ? 'Please sign in again to see pickup times.' : 'Only the shop’s team can see pickup times.');

export async function GET(req: NextRequest) {
  const tenantId = String(req.nextUrl.searchParams.get('tenantId') || '').trim();
  if (!ID.test(tenantId)) return NextResponse.json({ error: 'Missing business.' }, { status: 400 });
  const auth: any = await verifyStaffActor(req, tenantId);
  if (!auth.ok) return NextResponse.json({ error: authError(auth.status) }, { status: auth.status });
  try {
    const db = getAdminDb();
    const tenant: any = (await db.doc(`tenants/${tenantId}`).get()).data() || {};
    const plan = planOf(tenant.retailSettings);
    const tz = tenantTimeZone(tenant);
    const today = todayIn(tz);
    const days = Array.from({ length: 30 }, (_, i) => addDays(today, i));
    const [booked, shifts] = await Promise.all([bookedFrom(db, tenantId, days[0], days[days.length - 1], Date.now()), shiftsFor(db, tenantId, days)]);
    // Who is on shift is shown only as a count per window, so the spans go without anything that names a person.
    const people = new Map<string, string>(); let n = 0;
    const anon = shifts.map((s) => { if (!people.has(s.staffId)) people.set(s.staffId, `p${++n}`); return { ...s, staffId: people.get(s.staffId)! }; });
    return NextResponse.json({ plan, zoneSet: hasTimeZone(tenant), timeZone: tz, booked, shifts: anon, canEdit: !!auth.actor?.isManager });
  } catch (e: any) {
    console.error('[pickup-plan] read', String(e?.message || e).slice(0, 160));
    return NextResponse.json({ error: 'Pickup times couldn’t be loaded.' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({}));
  const tenantId = String(b.tenantId || '').trim();
  if (!ID.test(tenantId)) return NextResponse.json({ error: 'Missing business.' }, { status: 400 });
  const auth: any = await verifyStaffActor(req, tenantId);
  if (!auth.ok) return NextResponse.json({ error: auth.status === 401 ? 'Please sign in again to change pickup times.' : 'Only a manager can change pickup times.' }, { status: auth.status });
  if (b.plan !== undefined && !plain(b.plan)) return NextResponse.json({ error: 'Those settings couldn’t be read. Reload and try again.' }, { status: 400 });
  if (!auth.actor?.isManager) return NextResponse.json({ error: 'Only a manager can change pickup times.' }, { status: 403 });
  const db = getAdminDb();
  const ref = db.doc(`tenants/${tenantId}`);
  try {
    const out = await db.runTransaction(async (tx: any) => {
      const tenant: any = (await tx.get(ref)).data() || {};
      const tz = tenantTimeZone(tenant);
      const patch: Record<string, any> = {};
      if (plain(b.plan)) {
        // Checked and tidied by the same reader checkout uses, so what's kept is exactly what customers are offered.
        // Only what was sent is written: a part left out stays as it is.
        const next = cleanPlan(b.plan);
        for (const k of SETTINGS) if (Object.prototype.hasOwnProperty.call(b.plan, k)) patch[`retailSettings.pickupPlan.${k}`] = JSON.parse(JSON.stringify(next[k]));
        // Prep time is the shop's one setting (Shop settings writes it too): written only when it was changed here.
        if (Object.prototype.hasOwnProperty.call(b.plan, 'prepMinutes')) patch['retailSettings.prepMinutes'] = Math.max(1, next.prepMinutes);
        // An older plan's own prep time never competes with the shared one again.
        // Moved, never lost: when the shared one was never set, the older value becomes it in the same step.
        if (tenant.retailSettings?.pickupPlan && Object.prototype.hasOwnProperty.call(tenant.retailSettings.pickupPlan, 'prepMinutes')) {
          patch['retailSettings.pickupPlan.prepMinutes'] = FieldValue.delete();
          if (!(Number(tenant.retailSettings?.prepMinutes) > 0) && !('retailSettings.prepMinutes' in patch)) patch['retailSettings.prepMinutes'] = planFrom(tenant.retailSettings).prepMinutes;
        }
        patch['retailSettings.pickupPlan.savedAt'] = new Date().toISOString();
      }
      if (b.pause && typeof b.pause === 'object') {
        const f = String(b.pause.for || '');
        const until = f === 'hour' ? new Date(Date.now() + 60 * 60e3).toISOString()
          : f === 'today' ? startOfDay(addDays(todayIn(tz), 1), tz).toISOString()
          : f === 'manual' ? 'manual' : f === 'off' ? null : f === 'keep' ? 'keep' : undefined;
        if (until === undefined) return { error: 'Choose how long to pause for.', status: 400 };
        // A pause that ends at a time needs the shop's clock, so customers aren't told a time hours off.
        if ((f === 'today' || f === 'hour') && !hasTimeZone(tenant)) return { error: 'Set your business time zone first, or pause until you turn it back on.', status: 400 };
        if (until !== 'keep') patch['retailSettings.pickupPlan.pausedUntil'] = until;
        if (typeof b.pause.note === 'string') patch['retailSettings.pickupPlan.pauseNote'] = cleanPlan({ pauseNote: b.pause.note }).pauseNote;
      }
      if (!Object.keys(patch).length) return { error: 'Nothing to change.', status: 400 };
      // Each part on its own path (Firestore makes the plan's map the first time). Something that isn't a map in its
      // place (an old value) is replaced whole instead.
      const cur = tenant.retailSettings?.pickupPlan;
      if (cur !== undefined && (cur === null || typeof cur !== 'object' || Array.isArray(cur))) {
        const whole: Record<string, any> = {};
        for (const [k, v] of Object.entries(patch)) if (k.startsWith('retailSettings.pickupPlan.')) { whole[k.slice('retailSettings.pickupPlan.'.length)] = v; delete patch[k]; }
        patch['retailSettings.pickupPlan'] = whole;
      }
      tx.update(ref, patch);
      return { ok: true };
    });
    if ('error' in out) return NextResponse.json({ error: out.error }, { status: out.status });
    const tenant: any = (await ref.get()).data() || {};
    return NextResponse.json({ ok: true, plan: planOf(tenant.retailSettings) });
  } catch (e: any) {
    console.error('[pickup-plan] save', String(e?.message || e).slice(0, 160));
    return NextResponse.json({ error: 'That didn’t save. Try again.' }, { status: 500 });
  }
}
