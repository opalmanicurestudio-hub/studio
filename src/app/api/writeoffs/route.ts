// src/app/api/writeoffs/route.ts — WRITE-OFFS THAT ARE EASY TO MISS (lib/write-offs; the Money page's Write-offs tab).
// For anyone who keeps the books (money.manage). POST { tenantId, action }:
//   list     { year? }                     → what the year's lines show (meals, receipts, gifts, equipment, classes;
//                                            for the owner, personal-account purchases from places the business books
//                                            costs from) and the often-missed answers; `partial` when there were more
//                                            lines than are read at once
//   meal     { id, kind, who?, why? }      → a meal's kind, and what that kind asks for (lib/write-offs MEAL_ASKS)
//   gift     { id, people }                → how many people a gift was for
//   receipt  { id, url }                   → a receipt photo kept with a line (the business's own storage only)
//   note     { id, on }                    → equipment marked for the accountant
//   check    { year, item, answer }        → an often-missed one: 'ask' (ask the accountant), 'no', or null (owner only)
//   personal { id }                        → a personal-account purchase that was personal, so it isn't asked about
//                                            again (owner only: personal accounts are the owner's)
// Lines are the business's own (tenants/{t}/transactions); what's said about them is kept on each (`writeOff`). A line
// in a closed month (lib/books-close) takes these too: they're finished at tax time, and none changes the books' own
// figures, kind or date (the server writes them; in a closed month a browser can't, firestore.rules).
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { requireCan } from '@/lib/route-guard';
import { logAuditAdmin } from '@/lib/audit';
import { tenantTimeZone, todayIn } from '@/lib/tenant-time';
import { vendorKey } from '@/lib/plaid-sync';
import { inClosedMonth, monthName } from '@/lib/books-close';
import { ourBuckets } from '@/lib/inspo-photos';
import { CHECKLIST, EQUIPMENT_AT_CENTS, cleanMeal, dayOf, everydayPurchase, findWriteOffs, isGift, isMeal, receiptUrlOk, type PersonalLine } from '@/lib/write-offs';
import { canonicalCategory, scheduleCFor } from '@/lib/categories';
export const dynamic = 'force-dynamic';

const ID = /^[A-Za-z0-9_-]{1,160}$/;
const reply = (body: any, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
/** The kinds of line looked at, as they're written (their other names too: lib/categories). */
const KINDS = ['Meals & Entertainment', 'Meals', 'meals', 'Business Gifts', 'Travel', 'Travel & Transport', 'Equipment', 'Capital Equipment', 'Education & Training'];
const KINDS_READ = 20000;
/** A category a cost booked from a place can be under for that place to count as one the business buys from: one that
 *  counts on the return, not a draw, a transfer, a loan or payroll. */
const bookedCost = (c: string) => !!c && !/^Not deductible/.test(scheduleCFor(c)) && !/^payroll/i.test(canonicalCategory(c));
/** The fields read from each line. */
const FIELDS = ['type', 'context', 'category', 'amount', 'amountCents', 'date', 'clientOrVendor', 'description', 'reversalOf', 'voidOf', 'reversedBy', 'removed', 'writeOff', 'hasReceipt', 'receiptUrl', 'receiptId'];
const clip = (v: unknown, n: number) => String(v ?? '').replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

export async function POST(req: NextRequest) {
  try {
    const b: any = await req.json().catch(() => ({})); const tenantId = String(b?.tenantId || ''); const action = String(b?.action || 'list');
    if (!ID.test(tenantId)) return reply({ ok: false, error: 'Something went wrong.' }, 400);
    const g = await requireCan(req, tenantId, 'money.manage'); if (g.deny) return g.deny;
    const db = getAdminDb(); const a = g.actor; const tenant: any = g.tenant || (await db.doc(`tenants/${tenantId}`).get()).data() || {};
    const actor = { type: 'user', id: String(a.id || a.uid || 'owner'), name: clip(a.name || 'Owner', 80) } as any;
    const thisYear = Number(todayIn(tenantTimeZone(tenant)).slice(0, 4));
    const privRef = db.doc(`tenants/${tenantId}/private/writeOffs`);

    if (action === 'list') {
      const year = Number(b.year) >= thisYear - 1 && Number(b.year) <= thisYear ? Number(b.year) : thisYear;
      // (The kinds looked at, by category: a small read, never the year's sales. Then what takes the year's lines back,
      // by what it says it takes back (a reversal, an undo, a void, and a take-back of one of those), however it's dated.)
      const col = db.collection(`tenants/${tenantId}/transactions`);
      const kinds = await col.where('category', 'in', KINDS).select(...FIELDS).limit(KINDS_READ).get();
      const byId = new Map<string, any>(kinds.docs.map((d: any) => [d.id, { ...(d.data() || {}), id: d.id }]));
      let ask = [...byId.values()].filter((t) => dayOf(t.date).slice(0, 4) === String(year)).map((t) => String(t.id)); const asked = new Set(ask);
      for (let round = 0; round < 3 && ask.length; round++) {
        const parts: string[][] = []; for (let i = 0; i < ask.length; i += 30) parts.push(ask.slice(i, i + 30));
        const snaps: any[] = await Promise.all(parts.flatMap((ids) => ['reversalOf', 'voidOf'].map((f) => col.where(f, 'in', ids).select(...FIELDS).get())));
        const found = snaps.flatMap((x) => x.docs).map((d: any) => ({ ...(d.data() || {}), id: d.id }));
        for (const t of found) if (!byId.has(t.id)) byId.set(t.id, t);
        // (Each take-back found is asked about in turn, one the category read had already brought in too.)
        ask = Array.from(new Set(found.map((t: any) => String(t.id)))).filter((id) => !asked.has(id)); ask.forEach((id) => asked.add(id));
      }
      const lines = [...byId.values()];
      const kept: any = (await privRef.get()).data() || {};
      // (For the owner only, as personal accounts are the owner's: purchases on a personal account, not sorted yet, from
      // a place the business books costs from (its own account's learned rules: lib/plaid-sync, a cost that counts, not a
      // draw, a transfer or payroll). Not a store or a restaurant anyone might use, and not one the owner said was
      // personal.)
      let personal: PersonalLine[] = [];
      if (a.isTenantOwner) {
        const open = await db.collection(`tenants/${tenantId}/bankTransactions`).where('context', '==', 'Personal').where('status', '==', 'unmatched').get().catch(() => ({ docs: [] as any[] }));
        const no = kept.personalNo || {}; const name = (x: any) => String(x.merchant || x.name || '');
        const maybe = open.docs.map((d: any) => ({ ...(d.data() || {}), id: d.id })).filter((x: any) => x.context === 'Personal' && x.direction === 'out' && !x.pending && !no[x.id]
          && !everydayPurchase(x) && String(x.date || '').slice(0, 4) === String(year) && vendorKey(name(x)));
        if (maybe.length) {
          const rules = await db.collection(`tenants/${tenantId}/vendorRules`).get().catch(() => ({ docs: [] as any[] }));
          const places = new Set(rules.docs.filter((d: any) => { const r: any = d.data() || {}; return String(d.id).startsWith('business:') && String(r.type || '') === 'expense' && bookedCost(String(r.category || '')); })
            .map((d: any) => String(d.id).slice('business:'.length)));
          personal = maybe.filter((x: any) => places.has(vendorKey(name(x))))
            .map((x: any) => ({ id: String(x.id), day: String(x.date).slice(0, 10), title: clip(name(x), 80), cents: Math.abs(Number(x.amountCents) || 0) }))
            .sort((p: PersonalLine, q: PersonalLine) => q.day.localeCompare(p.day)).slice(0, 50);
        }
      }
      return reply({ ok: true, year, years: [thisYear, thisYear - 1], found: findWriteOffs(lines, year, personal), checklist: kept.checklist?.[String(year)] || {}, owner: !!a.isTenantOwner,
        ...(kinds.docs.length >= KINDS_READ ? { partial: true } : {}) });
    }

    if (action === 'check') {
      if (!a.isTenantOwner) return reply({ ok: false, error: 'These are about the owner’s own taxes, so the owner answers them.' }, 403);
      const year = Number(b.year); const item = String(b.item || '');
      if (!(year >= thisYear - 1 && year <= thisYear) || !CHECKLIST.some((c) => c.id === item) || ![null, 'ask', 'no'].includes(b.answer ?? null)) return reply({ ok: false, error: 'Something went wrong.' }, 400);
      await privRef.set({ checklist: { [String(year)]: { [item]: b.answer ?? null } } }, { merge: true });
      return reply({ ok: true });
    }
    if (action === 'personal') {
      if (!a.isTenantOwner) return reply({ ok: false, error: 'Personal accounts are the owner’s, so the owner answers these.' }, 403);
      const id = String(b.id || ''); if (!ID.test(id)) return reply({ ok: false, error: 'Something went wrong.' }, 400);
      const x: any = (await db.doc(`tenants/${tenantId}/bankTransactions/${id}`).get()).data();
      if (!x || x.context !== 'Personal') return reply({ ok: false, error: 'That purchase isn’t on a personal account.' }, 404);
      await privRef.set({ personalNo: { [id]: true } }, { merge: true });
      return reply({ ok: true });
    }

    const id = String(b.id || ''); if (!ID.test(id)) return reply({ ok: false, error: 'Something went wrong.' }, 400);
    const ref = db.doc(`tenants/${tenantId}/transactions/${id}`); const t: any = (await ref.get()).data();
    if (!t || String(t.type || '') !== 'expense') return reply({ ok: false, error: 'That line isn’t in your books.' }, 404);
    const day = String(t.date || '').slice(0, 10);
    // (Said in the activity when the line's month is closed: the books' own figures stay as they were.)
    const closed = /^\d{4}-\d{2}/.test(day) && inClosedMonth(tenant, String(t.date || '')) ? ` (${monthName(day.slice(0, 7))} is closed; the books stay as they were)` : '';

    if (action === 'meal') {
      if (!isMeal(t)) return reply({ ok: false, error: 'That line isn’t a meal.' }, 400);
      const m = cleanMeal(b); if (!m.ok) return reply({ ok: false, error: m.error }, 400);
      await ref.set({ writeOff: { meal: { ...m.meal, by: actor.name, at: new Date().toISOString() } } }, { merge: true });
      await logAuditAdmin(db, tenantId, { action: 'writeoffs.meal', targetType: 'transaction', targetId: id, summary: `Said what a meal on ${day} was for.${closed}`, actor }).catch(() => {});
      return reply({ ok: true });
    }
    if (action === 'gift') {
      if (!isGift(t)) return reply({ ok: false, error: 'That line isn’t a gift.' }, 400);
      const n = Math.floor(Number(b.people)); if (!(n >= 1 && n <= 1000)) return reply({ ok: false, error: 'How many people, from 1.' }, 400);
      await ref.set({ writeOff: { giftPeople: n } }, { merge: true });
      await logAuditAdmin(db, tenantId, { action: 'writeoffs.gift', targetType: 'transaction', targetId: id, summary: `Said a gift on ${day} was for ${n} ${n === 1 ? 'person' : 'people'}.${closed}`, actor }).catch(() => {});
      return reply({ ok: true });
    }
    if (action === 'receipt') {
      if (!receiptUrlOk(b.url, tenantId, await ourBuckets(tenant))) return reply({ ok: false, error: 'That photo didn’t upload. Try again.' }, 400);
      await ref.set({ receiptUrl: String(b.url), hasReceipt: true }, { merge: true });
      await logAuditAdmin(db, tenantId, { action: 'writeoffs.receipt', targetType: 'transaction', targetId: id, summary: `Added a receipt to a cost on ${day}.${closed}`, actor }).catch(() => {});
      return reply({ ok: true });
    }
    if (action === 'note') {
      const cents = Math.round(Math.abs(Number(t.amountCents) || Number(t.amount) * 100 || 0));
      if (canonicalCategory(String(t.category || '')) !== 'Equipment' || cents < EQUIPMENT_AT_CENTS) return reply({ ok: false, error: 'Only equipment of $2,500 or more is marked for the accountant.' }, 400);
      await ref.set({ writeOff: { forAccountant: b.on === true } }, { merge: true });
      await logAuditAdmin(db, tenantId, { action: 'writeoffs.note', targetType: 'transaction', targetId: id, summary: `${b.on === true ? 'Marked' : 'Unmarked'} equipment bought on ${day} for the accountant.${closed}`, actor }).catch(() => {});
      return reply({ ok: true });
    }
    return reply({ ok: false, error: 'Something went wrong.' }, 400);
  } catch (e: any) {
    console.error('[writeoffs]', e?.message);
    return reply({ ok: false, error: 'That didn’t go through. Try again.' }, 500);
  }
}
