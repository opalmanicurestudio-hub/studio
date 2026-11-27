// src/app/api/owner-taxes/route.ts — THE OWNER'S TAX SET-ASIDE (the Money page's Taxes tab; lib/owner-taxes-server,
// lib/renter-taxes). For the owner alone: it's about their own return, how they file and their household's income, so
// not for others who keep the books. POST { tenantId, action }:
//   list     { figures?: false, fresh?: true }     → the year's figures and what the owner has said (the plan is worked
//                                                    out on screen, lib/renter-taxes taxPlan); fresh: the whole year read again;
//                                                    through April 30, last year's payments too (lastYearRecorded)
//   status   {}                                    → the next date when it's a week away (the Money page's reminder)
//   settings { structure?, filing?, state?, other?, outside?, lastYearTax?, lastYearHigh? } (dollars) → what they've said
//   pay      { date, amount, to: 'irs'|'state', forYear? } → a payment they made (until April 15, last year's too)
//   unpay    { id, forYear? }                      → a payment taken off
//   remind   { channel: 'off'|'inbox'|'email' }    → reminders the week before each date
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { requireCan } from '@/lib/route-guard';
import { todayFor } from '@/lib/trip-log-server';
import { planYearOf, cleanTaxSettings, cleanTaxPayment, tableFor, dueDay, remindChannelOf, REMIND_CHANNELS } from '@/lib/renter-taxes';
import { ownerTaxFigures, ownerTaxRef, ownerRemindRef, ownerSignInEmail, ownerTaxDueSoon, ownerYearKept } from '@/lib/owner-taxes-server';
import { payrollStateOf } from '@/lib/payroll-taxes';
import { getStateProfile } from '@/lib/state-tax-profiles';

export const dynamic = 'force-dynamic';
const ID = /^[A-Za-z0-9_-]{1,160}$/;
const reply = (body: any, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const STRUCTURES = ['schedule_c', 'other'];

export async function POST(req: NextRequest) {
  try {
    const b: any = await req.json().catch(() => ({})); const tenantId = String(b?.tenantId || ''); const action = String(b?.action || 'list');
    if (!ID.test(tenantId)) return reply({ ok: false, error: 'Something went wrong.' }, 400);
    const g = await requireCan(req, tenantId, 'money.manage'); if (g.deny) return g.deny;
    if (!g.actor?.isTenantOwner) return reply({ ok: false, error: 'This is the owner’s own: it’s about their tax return.' }, 403);
    const db = getAdminDb(); const tenant: any = g.tenant || (await db.doc(`tenants/${tenantId}`).get()).data() || {};
    const today = todayFor(tenant); const year = planYearOf(today); const ref = ownerTaxRef(db, tenantId, year);
    const lastOpen = today <= dueDay(year, 4);
    // (Last year's payments are still read through April 30, for closing the year in Reports; they're changed only until
    // April 15.)
    const lastRead = today <= `${year}-04-30`;

    if (action === 'list') {
      // (The books' figures only when asked: after a save, what was said and paid is enough.)
      const figures = b.figures === false ? null : await ownerTaxFigures(db, tenantId, year, today, b.fresh === true);
      // (A new year starts with what was said before, until it's said again, and keeps it: owner-taxes-server ownerYearKept.)
      const [{ kept, before, last }, rem, email] = await Promise.all([ownerYearKept(db, tenantId, year), ownerRemindRef(db, tenantId).get().then((x: any) => x.data() || {}),
        ownerSignInEmail(String(tenant.ownerId || g.actor?.uid || '')).catch(() => '')]);
      const state = /^[A-Z]{2}$/.test(String(kept.state || '')) ? String(kept.state) : payrollStateOf(tenant) || '';
      const p = state ? getStateProfile(state) : null;
      return reply({ ok: true, year, today, lastYearOpen: lastOpen, remind: remindChannelOf(rem.channel), hasEmail: String(email || tenant.ownerEmail || '').includes('@'),
        table: { year: tableFor(year).year, stale: tableFor(year).stale },
        ...(figures ? { earnedByMonth: figures.earnedByMonth, writeOffsByMonth: figures.writeOffsByMonth, milesLeftOut: figures.milesLeftOut, countedAt: figures.countedAt } : {}),
        settings: { structure: STRUCTURES.includes(kept.structure) ? kept.structure : null, filing: kept.filing || 'single', state, statePct: p ? p.effectiveStateRate : 0, stateName: p ? p.name : '', stateType: p ? p.taxType : null,
          otherCents: Number(kept.otherCents) || 0, outsideCents: Number(kept.outsideCents) || 0, lastYearTaxCents: kept.lastYearTaxCents ?? null, lastYearHigh: kept.lastYearHigh === true },
        payments: Array.isArray(kept.payments) ? kept.payments : [], lastYearPayments: lastOpen && Array.isArray((last as any).payments) ? (last as any).payments : [],
        // (Closing last year in Reports: its payments, and how the business filed then.)
        ...(lastRead ? { lastYearRecorded: Array.isArray((last as any).payments) ? (last as any).payments : [], lastYearStructure: STRUCTURES.includes(before.structure) ? before.structure : null } : {}) });
    }

    if (action === 'status') return reply({ ok: true, soon: await ownerTaxDueSoon(db, tenantId, today) });

    if (action === 'settings') {
      const c = cleanTaxSettings(b); if (!c.ok) return reply({ ok: false, error: c.error }, 400);
      if (b.structure !== undefined) { if (!STRUCTURES.includes(String(b.structure))) return reply({ ok: false, error: 'Pick how the business files.' }, 400); c.s.structure = b.structure; }
      await ref.set({ ...c.s, updatedAt: new Date().toISOString() }, { merge: true });
      return reply({ ok: true });
    }
    if (action === 'remind') {
      if (!(REMIND_CHANNELS as readonly string[]).includes(String(b.channel))) return reply({ ok: false, error: 'Something went wrong.' }, 400);
      await ownerRemindRef(db, tenantId).set({ channel: b.channel, updatedAt: new Date().toISOString() }, { merge: true });
      return reply({ ok: true });
    }
    if (action === 'pay') {
      const c = cleanTaxPayment(b, today); if (!c.ok) return reply({ ok: false, error: c.error }, 400);
      const forYear = Number(b.forYear) === year - 1 && lastOpen ? year - 1 : year; const pRef = forYear === year ? ref : ownerTaxRef(db, tenantId, forYear);
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
      const id = String(b.id || ''); const uRef = Number(b.forYear) === year - 1 && lastOpen ? ownerTaxRef(db, tenantId, year - 1) : ref;
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
    console.error('[owner-taxes]', e?.message);
    return reply({ ok: false, error: 'That didn’t go through. Try again.' }, 500);
  }
}
