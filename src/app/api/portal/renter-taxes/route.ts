// src/app/api/portal/renter-taxes/route.ts — A RENTER'S TAX SET-ASIDE, for their own business (the renter portal's Money,
// Your business, Taxes to set aside; included in rent; lib/renter-taxes). What they've earned through ClarityFlow
// (lib/renter-earned) and tips the front desk collected for them, less their write-offs (lib/renter-write-offs), month by
// month for the year they're paying toward, with what they say about the rest: how they file, their state, the
// household's other income, business income from outside ClarityFlow, last year's tax, and the payments they've made. All
// of it theirs, kept privately with their log (tenants/{t}/private/renter_{id}/taxes/{year}); never the business's.
// Signed in with the renter portal's session token. POST { tenantId, token, action }:
//   list     {}                                   → the year's figures and what they've said (the plan is worked out
//                                                   on their phone, lib/renter-taxes taxPlan)
//   settings { filing?, state?, other?, outside?, lastYearTax? } (dollars) → what they've said, kept
//   pay      { date, amount, to: 'irs'|'state', forYear? } → a payment they made (until April 15, last year's too)
//   unpay    { id, forYear? }                     → a payment taken off (until April 15, last year's too)
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { renterSession } from '@/lib/renter-session';
import { renterRentPayments, rentTakeBacks } from '@/lib/renter-rent-history';
import { renterEarned } from '@/lib/renter-earned';
import { tripsOf, todayFor } from '@/lib/trip-log-server';
import { limitByKey } from '@/lib/rate-limit';
import { writeOffsByMonth, deskTipsByMonth, shopSalesByMonth } from '@/lib/renter-write-offs';
import { planYearOf, cleanTaxSettings, cleanTaxPayment, tableFor, dueDay } from '@/lib/renter-taxes';
import { payrollStateOf } from '@/lib/payroll-taxes';
import { getStateProfile } from '@/lib/state-tax-profiles';

export const dynamic = 'force-dynamic';
const ID = /^[A-Za-z0-9_-]{1,160}$/;
const reply = (body: any, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function POST(req: NextRequest) {
  try {
    const b: any = await req.json().catch(() => ({})); const tenantId = String(b?.tenantId || ''); const action = String(b?.action || 'list');
    if (!ID.test(tenantId)) return reply({ ok: false, error: 'Something went wrong.' }, 400);
    const db = getAdminDb(); const s = await renterSession(db, tenantId, b.token);
    if (!s || !ID.test(s.renterId)) return reply({ ok: false, error: 'Please sign in again.' }, 401);
    const rid = s.renterId; const T = `tenants/${tenantId}`;
    const tenant: any = (await db.doc(T).get()).data() || {};
    const today = todayFor(tenant); const year = planYearOf(today);
    const ref = db.doc(`${T}/private/renter_${rid}/taxes/${year}`);
    const kept: any = (await ref.get()).data() || {};

    if (action === 'list') {
      const from = `${year}-01-01T00:00:00.000Z`, to = `${year + 1}-01-01T00:00:00.000Z`;
      const r: any = (await db.doc(`${T}/renters/${rid}`).get()).data() || {};
      const byContact = async (field: string, v: unknown) => (typeof v === 'string' && v.trim() ? (await db.collection(`${T}/boothReservations`).where(field, '==', v).get()).docs.map((d: any) => String(d.id)) : []);
      const [earned, exp, pays, ledger, trips] = await Promise.all([
        renterEarned(db, tenantId, rid, from, to, { eachMonth: { today } }).catch(() => ({ visits: [], packages: [] })),
        db.collection(`${T}/renterExpenses`).where('renterId', '==', rid).limit(5000).get().then((x: any) => x.docs.map((d: any) => ({ id: d.id, ...d.data() }))).catch(() => []),
        (async () => { const extra = [...await byContact('phone', r.phone), ...await byContact('email', r.email)]; const p = await renterRentPayments(db, tenantId, { renterId: rid, extraSourceIds: extra }); return [...p, ...await rentTakeBacks(db, tenantId, p.map((x: any) => String(x.id)))]; })().catch(() => []),
        db.collection(`${T}/rentLedger`).where('renterId', '==', rid).get().then((x: any) => x.docs.map((d: any) => ({ id: d.id, ...d.data() }))).catch(() => []),
        tripsOf(db, tenantId, year, rid).catch(() => []),
      ]);
      const earnedByMonth: Record<string, number> = {};
      for (const x of [...earned.visits, ...earned.packages]) { const m = String(x.date || '').slice(0, 7); if (m.slice(0, 4) === String(year)) earnedByMonth[m] = (earnedByMonth[m] || 0) + (Number(x.cents) || 0); }
      for (const [m, c] of [...Object.entries(deskTipsByMonth(ledger, year)), ...Object.entries(shopSalesByMonth(ledger, year))]) earnedByMonth[m] = (earnedByMonth[m] || 0) + c;
      const state = /^[A-Z]{2}$/.test(String(kept.state || '')) ? String(kept.state) : payrollStateOf(tenant) || '';
      return reply({ ok: true, year, today, lastYearOpen: today <= dueDay(year, 4), table: { year: tableFor(year).year, stale: tableFor(year).stale },
        earnedByMonth, writeOffsByMonth: writeOffsByMonth(exp, pays, ledger, trips, year),
        settings: { filing: kept.filing || 'single', state, statePct: state ? getStateProfile(state).effectiveStateRate : 0, stateName: state ? getStateProfile(state).name : '', stateType: state ? getStateProfile(state).taxType : null,
          otherCents: Number(kept.otherCents) || 0, outsideCents: Number(kept.outsideCents) || 0, lastYearTaxCents: kept.lastYearTaxCents ?? null, lastYearHigh: kept.lastYearHigh === true },
        payments: Array.isArray(kept.payments) ? kept.payments : [],
        // (Until April 15, last year's payments too, so one saved toward last year can be seen and taken off.)
        lastYearPayments: today <= dueDay(year, 4) ? (((await db.doc(`${T}/private/renter_${rid}/taxes/${year - 1}`).get()).data() as any)?.payments || []) : [] });
    }

    const limited = await limitByKey('renter-taxes', `${tenantId}|${rid}`, 200, 'That’s a lot of changes this hour. Try again later.'); if (limited) return limited;

    if (action === 'settings') {
      const c = cleanTaxSettings(b); if (!c.ok) return reply({ ok: false, error: c.error }, 400);
      await ref.set({ ...c.s, updatedAt: new Date().toISOString() }, { merge: true });
      return reply({ ok: true });
    }
    if (action === 'pay') {
      const c = cleanTaxPayment(b, today); if (!c.ok) return reply({ ok: false, error: c.error }, 400);
      // (Until April 15, a payment can be for last year: a late last payment, or one made with the return.)
      const forYear = Number(b.forYear) === year - 1 && today <= dueDay(year, 4) ? year - 1 : year;
      const pRef = forYear === year ? ref : db.doc(`${T}/private/renter_${rid}/taxes/${forYear}`);
      const p = { id: `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, ...c.p };
      const full = await db.runTransaction(async (tx: any) => {
        const cur: any = (await tx.get(pRef)).data() || {}; const list = Array.isArray(cur.payments) ? cur.payments : [];
        if (list.length >= 40) return true;
        tx.set(pRef, { payments: [...list, p], updatedAt: new Date().toISOString() }, { merge: true }); return false;
      });
      if (full) return reply({ ok: false, error: 'That’s a lot of payments for one year. Take one off first.' }, 400);
      return reply({ ok: true, payment: p, forYear });
    }
    if (action === 'unpay') {
      const id = String(b.id || '');
      const uRef = Number(b.forYear) === year - 1 && today <= dueDay(year, 4) ? db.doc(`${T}/private/renter_${rid}/taxes/${year - 1}`) : ref;
      const found = await db.runTransaction(async (tx: any) => {
        const cur: any = (await tx.get(uRef)).data() || {}; const list = Array.isArray(cur.payments) ? cur.payments : [];
        if (!list.some((x: any) => x?.id === id)) return false;
        tx.set(uRef, { payments: list.filter((x: any) => x?.id !== id), updatedAt: new Date().toISOString() }, { merge: true }); return true;
      });
      if (!found) return reply({ ok: false, error: 'That payment isn’t in your list.' }, 404);
      return reply({ ok: true });
    }
    return reply({ ok: false, error: 'Something went wrong.' }, 400);
  } catch (e: any) {
    console.error('[renter-taxes]', e?.message);
    return reply({ ok: false, error: 'That didn’t go through. Try again.' }, 500);
  }
}
