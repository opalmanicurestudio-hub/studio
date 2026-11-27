// src/app/api/money/receipt-read/route.ts — SNAP A RECEIPT (Books; components/ledger/AddTransactionDialog; lib/receipt-read).
// For anyone who keeps the books (money.manage). POST { tenantId, url } → { ok, reading } for a receipt photo already in
// the business's own storage (ImageUpload's uploads folder, nothing else): who was paid, the day, the total, the tax and
// the likeliest of the business's expense categories, to fill the empty boxes of Add a line for the person to check.
// Nothing is saved here; `reading` is null when nothing could be read (reading is off for the business, or a day's
// readings are used up: lib/receipt-read takeReceiptRead), and the form is filled in by hand as before.
import { NextRequest, NextResponse } from 'next/server';
import { requireCan } from '@/lib/route-guard';
import { limitByKey } from '@/lib/rate-limit';
import { receiptUrlOk } from '@/lib/write-offs';
import { ourBuckets } from '@/lib/inspo-photos';
import { categoryNames } from '@/lib/categories';
import { todayIn, tenantTimeZone } from '@/lib/tenant-time';
import { fetchReceiptPhoto, readReceipt, takeReceiptRead } from '@/lib/receipt-read';
import { getAdminDb } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';
const ID = /^[A-Za-z0-9_-]{1,160}$/;
const reply = (body: any, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function POST(req: NextRequest) {
  try {
    const b: any = await req.json().catch(() => ({})); const tenantId = String(b?.tenantId || '');
    if (!ID.test(tenantId)) return reply({ ok: false, error: 'Something went wrong.' }, 400);
    const g = await requireCan(req, tenantId, 'money.manage'); if (g.deny) return g.deny;
    const tenant: any = g.tenant || ((await getAdminDb().doc(`tenants/${tenantId}`).get()).data() as any) || {};
    if (!receiptUrlOk(b.url, tenantId, await ourBuckets(tenant))) return reply({ ok: false, error: 'That photo didn’t upload. Try again.' }, 400);
    const limited = await limitByKey('receipt-read', `${tenantId}|${String(g.actor?.uid || g.actor?.id || '')}`, 60, 'That’s a lot of receipts this hour. Fill this one in by hand.'); if (limited) return limited;
    // (The photo itself, from the business's own storage: a picture, and not too big.)
    const photo = await fetchReceiptPhoto(String(b.url));
    if (!photo) return reply({ ok: true, reading: null });
    const today = todayIn(tenantTimeZone(tenant));
    // (A day's readings, for the business and each person: past them, the form is filled in by hand.)
    if (!(await takeReceiptRead(getAdminDb(), tenantId, `team_${String(g.actor?.uid || g.actor?.id || '')}`, today))) return reply({ ok: true, reading: null, capped: true });
    const reading = await readReceipt({ ...photo, kinds: categoryNames('expense'), today, tenantId, purpose: 'receipt_read' }).catch(() => null);
    return reply({ ok: true, reading });
  } catch (e: any) {
    console.error('[receipt-read]', e?.message);
    return reply({ ok: false, error: 'That didn’t go through. Try again.' }, 500);
  }
}
