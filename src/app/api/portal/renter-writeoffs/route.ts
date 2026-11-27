// src/app/api/portal/renter-writeoffs/route.ts — A RENTER'S OWN WRITE-OFFS, for their own business (the renter portal's
// Money, Your business, Write-offs; included in rent; lib/renter-write-offs). Their rent and space fees paid to the
// business, their business miles, the costs they log, tips collected for them at the front desk, and what's often
// missed, for their accountant. Everything read is theirs: their payments (by their renter id, lib/renter-rent-history),
// their own mileage log, their own costs, their own front-desk lines. Their checklist is kept privately with their log
// (tenants/{t}/private/renter_{id}/writeOffs/checklist), never in the business's books or its activity.
// Signed in with the renter portal's session token. POST { tenantId, token, action }:
//   list   { year? }                                  → the year's write-offs
//   add    { date, amount, kind, note?, people? }      → a cost logged (the same costs as Earnings and expenses)
//   finish { id, note?, people? }                     → a meal's who and why, or a gift's how many people
//   check  { year, item, answer: 'ask'|'no'|null }     → an often-missed write-off marked
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { renterSession } from '@/lib/renter-session';
import { renterRentPayments, rentTakeBacks } from '@/lib/renter-rent-history';
import { tripsOf, loadSetup, todayFor } from '@/lib/trip-log-server';
import { yearSummary } from '@/lib/trip-log';
import { limitByKey } from '@/lib/rate-limit';
import { renterFound, rentPaidOf, deskTipsOf, missingRenterUsual, cleanRenterCost, RENTER_CHECKLIST } from '@/lib/renter-write-offs';

export const dynamic = 'force-dynamic';
const ID = /^[A-Za-z0-9_-]{1,160}$/;
const reply = (body: any, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const clip = (v: unknown, n: number) => String(v ?? '').replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

export async function POST(req: NextRequest) {
  try {
    const b: any = await req.json().catch(() => ({})); const tenantId = String(b?.tenantId || ''); const action = String(b?.action || 'list');
    if (!ID.test(tenantId)) return reply({ ok: false, error: 'Something went wrong.' }, 400);
    const db = getAdminDb(); const s = await renterSession(db, tenantId, b.token);
    if (!s || !ID.test(s.renterId)) return reply({ ok: false, error: 'Please sign in again.' }, 401);
    const rid = s.renterId; const T = `tenants/${tenantId}`;
    const tenant: any = (await db.doc(T).get()).data() || {};
    const today = todayFor(tenant); const thisYear = Number(today.slice(0, 4));
    const checklistRef = db.doc(`${T}/private/renter_${rid}/writeOffs/checklist`);
    const expenses = () => db.collection(`${T}/renterExpenses`).where('renterId', '==', rid).limit(5000).get().then((x: any) => x.docs.map((d: any) => ({ id: d.id, ...d.data() })));

    // (Their payments, as the rent statement finds them: by their renter id and their own records, and space bookings made
    // with their phone or email; then any undo, void or correction of one, which carries none of their ids.)
    // (A read that fails is an error, never a year with no rent in it.)
    const rentLines = async () => {
      const r: any = (await db.doc(`${T}/renters/${rid}`).get()).data() || {};
      const byContact = async (field: string, v: unknown) => (typeof v === 'string' && v.trim() ? (await db.collection(`${T}/boothReservations`).where(field, '==', v).get()).docs.map((d: any) => String(d.id)) : []);
      const extra = [...await byContact('phone', r.phone), ...await byContact('email', r.email)];
      const pays = await renterRentPayments(db, tenantId, { renterId: rid, extraSourceIds: extra });
      return [...pays, ...await rentTakeBacks(db, tenantId, pays.map((p: any) => String(p.id)))];
    };

    if (action === 'list') {
      const year = Number(b.year) === thisYear - 1 ? thisYear - 1 : thisYear;
      const [exp, pays, ledger, trips, setup, kept] = await Promise.all([
        expenses(),
        rentLines(),
        db.collection(`${T}/rentLedger`).where('renterId', '==', rid).get().then((x: any) => x.docs.map((d: any) => ({ id: d.id, ...d.data() }))),
        tripsOf(db, tenantId, year, rid),
        loadSetup(db, tenantId, rid),
        checklistRef.get().then((x: any) => x.data() || {}),
      ]);
      const m = yearSummary(trips as any, year, setup as any);
      return reply({ ok: true, year, years: [thisYear, thisYear - 1], today, space: clip(tenant.name || 'the business you rent from', 80),
        found: renterFound(exp, year), rent: rentPaidOf(pays, year, ledger), deskTipsCents: deskTipsOf(ledger, year), missing: missingRenterUsual(exp, year),
        miles: m.trips > 0 ? { tenths: m.businessTenths, cents: m.amountCents, rate: m.rate.label, trips: m.trips, stale: m.rate.stale, rateYear: m.rate.year } : null,
        checklist: (kept as any)?.[String(year)] || {} });
    }

    const limited = await limitByKey('renter-writeoffs', `${tenantId}|${rid}`, 300, 'That’s a lot of changes this hour. Try again later.'); if (limited) return limited;

    if (action === 'add') {
      const c = cleanRenterCost(b, today); if (!c.ok) return reply({ ok: false, error: c.error }, 400);
      const ref = db.collection(`${T}/renterExpenses`).doc(); const now = new Date().toISOString();
      // (The same shape Earnings and expenses keeps, so a cost shows in both.)
      await ref.set({ id: ref.id, renterId: rid, date: c.cost.date, cents: c.cost.cents, category: c.cost.category, note: c.cost.note, ...(c.cost.people ? { people: c.cost.people } : {}), createdAt: now, updatedAt: now });
      return reply({ ok: true, id: ref.id });
    }

    if (action === 'finish') {
      const id = String(b.id || ''); if (!ID.test(id)) return reply({ ok: false, error: 'Something went wrong.' }, 400);
      const ref = db.doc(`${T}/renterExpenses/${id}`); const cur: any = (await ref.get()).data();
      if (!cur || cur.renterId !== rid) return reply({ ok: false, error: 'That cost isn’t in your list.' }, 404);
      const patch: any = {};
      if (b.note != null) { const note = clip(b.note, 200); if (note.length < 3) return reply({ ok: false, error: 'Say who was there and what it was about. The IRS asks for both.' }, 400); patch.note = note; }
      if (b.people != null) { const n = Math.floor(Number(b.people)); if (!(n >= 1 && n <= 999)) return reply({ ok: false, error: 'How many people, like 3.' }, 400); patch.people = n; }
      if (!Object.keys(patch).length) return reply({ ok: false, error: 'Something went wrong.' }, 400);
      await ref.set({ ...patch, updatedAt: new Date().toISOString() }, { merge: true });
      return reply({ ok: true });
    }

    if (action === 'check') {
      const year = Number(b.year); const item = String(b.item || '');
      if (!(year === thisYear || year === thisYear - 1) || !RENTER_CHECKLIST.some((c) => c.id === item) || !(b.answer === 'ask' || b.answer === 'no' || b.answer === null)) return reply({ ok: false, error: 'Something went wrong.' }, 400);
      await checklistRef.set({ [String(year)]: { [item]: b.answer } }, { merge: true });
      return reply({ ok: true });
    }

    return reply({ ok: false, error: 'Something went wrong.' }, 400);
  } catch (e: any) {
    console.error('[renter-writeoffs]', e?.message);
    return reply({ ok: false, error: 'That didn’t go through. Try again.' }, 500);
  }
}
