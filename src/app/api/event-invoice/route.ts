// src/app/api/event-invoice/route.ts — AN EVENT'S FINAL INVOICE, for managers (lib/event-invoice, lib/event-invoice-server;
// design canvas "Event sheet and final invoice"; the card on the event sheet).
//   view { tenantId, eventId }                         → what's saved (or a start), the lines, what sending needs.
//   save { tenantId, eventId, invoice }                → saved (not once it's paid).
//   send { tenantId, eventId }                         → the client is emailed the invoice and its link to pay by card.
//   mark_paid { tenantId, eventId, how }               → the balance paid another way (cash, check, other).
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { requireRole } from '@/lib/route-guard';
import { invoiceFor, markInvoicePaid, saveInvoice, sendInvoice } from '@/lib/event-invoice-server';

export const dynamic = 'force-dynamic';
const ID = /^[A-Za-z0-9_-]{1,160}$/;
const ok = (b: any = {}) => NextResponse.json({ ok: true, ...b }, { headers: { 'Cache-Control': 'no-store' } });
const bad = (error: string, status = 400) => NextResponse.json({ ok: false, error }, { status });

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({}));
  const tenantId = String(b.tenantId || ''); const eventId = String(b.eventId || ''); const action = String(b.action || 'view');
  if (!ID.test(tenantId)) return bad('Which business?');
  if (!ID.test(eventId)) return bad('Which event?');
  if (!['view', 'save', 'send', 'mark_paid'].includes(action)) return bad('Unknown action.');
  const g: any = await requireRole(req, tenantId, 'manager'); if (g.deny) return g.deny;
  if (g.actor?.isRenter || g.actor?.role === 'renter') return bad('The event is the business’s own.', 403);
  const db = getAdminDb(); const T = `tenants/${tenantId}`; const by = String(g.actor?.name || 'Manager');
  try {
    const tenant: any = (await db.doc(T).get()).data() || {};
    if (action === 'save') {
      const r = await saveInvoice(db, T, eventId, b.invoice, by);
      if (r === 'missing') return bad('That event isn’t here any more.', 404);
      if (r === 'bad') return bad('Each amount needs to be a sensible number, and each other line a name and an amount (up to 10).');
      if (r === 'paid') return bad('This invoice is paid in full, so it can’t change.', 409);
    }
    if (action === 'send') {
      const r = await sendInvoice(db, T, tenant, tenantId, eventId, req.nextUrl.origin, by);
      if (!r.ok) return bad(r.error, r.status);
    }
    if (action === 'mark_paid') {
      const how = ['cash', 'check', 'other'].includes(String(b.how)) ? String(b.how) as any : null;
      if (!how) return bad('Paid how: cash, check or other?');
      const r = await markInvoicePaid(db, T, eventId, how, by);
      if (r === 'missing') return bad('That event isn’t here any more.', 404);
      if (r === 'nothing') return bad('There’s nothing left to pay on it.', 409);
    }
    const inv = await invoiceFor(db, T, tenant, eventId);
    if (!inv) return bad('That event isn’t here any more.', 404);
    return ok({ invoice: inv });
  } catch (e) {
    console.error('[event-invoice]', e);
    return bad('That didn’t go through just now. Try again in a moment.', 500);
  }
}
