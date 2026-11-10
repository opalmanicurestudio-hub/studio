// src/app/api/rent/pay-link/route.ts — EMAIL A RENTER A LINK TO PAY WHAT THEY OWE. From the Owed list on the Rent page.
// The amount is worked out here from their open bills and charges (lib/booth-rental-types, the same rule as the page), and
// the link opens their portal signed in (lib/renter-link), where they pay by card. It goes through the logged sender as its
// own message ("Pay link" in message settings, which can be reworded but not switched off: lib/notify), so it shows in
// their message history. The link's address is the business's own or the app's, never one taken from the request. At most
// once every 30 minutes for one renter, so a second tap doesn't send it twice.
//   POST { tenantId, renterId } → { ok, sentTo, cents } | { ok: false, error }
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { requireRole } from '@/lib/route-guard';
import { renterOwedCents } from '@/lib/booth-rental-types';
import { mintRenterLink } from '@/lib/renter-link';
import { linkOrigin } from '@/lib/app-origin';
import { brandedEmailHtml } from '@/lib/email-template';
import { sendNotification } from '@/lib/notify';

export const dynamic = 'force-dynamic';
const j = (b: any, status = 200) => NextResponse.json(b, { status, headers: { 'Cache-Control': 'no-store' } });
const rows = (s: any) => s.docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) }));
const money = (c: number) => `$${(Math.round(c) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const PAY_LINK_GAP_MS = 30 * 60 * 1000;

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({}));
  const tenantId = String(b.tenantId || '').trim().slice(0, 120);
  const renterId = String(b.renterId || '').trim().slice(0, 120);
  const g: any = await requireRole(req, tenantId, 'manager'); if (g.deny) return g.deny;
  if (g.actor?.isRenter) return j({ ok: false, error: 'This is for the business only.' }, 403);
  if (!/^[A-Za-z0-9_-]{1,120}$/.test(renterId)) return j({ ok: false, error: 'No renter given.' }, 400);
  try {
    const db = getAdminDb(); const T = `tenants/${tenantId}`;
    const rRef = db.doc(`${T}/renters/${renterId}`);
    const rSnap = await rRef.get();
    if (!rSnap.exists) return j({ ok: false, error: 'That renter isn’t here any more.' }, 404);
    const renter: any = { id: rSnap.id, ...(rSnap.data() as any) };
    const to = String(renter.email || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return j({ ok: false, error: 'There’s no email for them. Add one with Edit on their page.' }, 400);
    const last = Date.parse(String(renter.payLinkSentAt || ''));
    const recent = () => j({ ok: false, error: 'A pay link went to them in the last half hour. Give them time to open it.' }, 429);
    if (Number.isFinite(last) && Date.now() - last < PAY_LINK_GAP_MS) return recent();
    const [invoices, ledger] = await Promise.all([
      db.collection(`${T}/rentInvoices`).where('renterId', '==', renterId).get().then(rows),
      db.collection(`${T}/rentLedger`).where('renterId', '==', renterId).get().then(rows),
    ]);
    const cents = renterOwedCents(renterId, invoices, ledger);
    if (cents <= 0) return j({ ok: false, error: 'They don’t owe anything right now.' }, 409);
    const tenant: any = ((await db.doc(T).get()).data() as any) || {};
    // Never the request's own address: a link that signs them in only ever points at the business's or the app's.
    const base = linkOrigin(tenant, null);
    if (!/^https:\/\//.test(base)) return j({ ok: false, error: 'The link couldn’t be made: the app’s address isn’t set yet.' }, 500);
    const business = String(tenant.name || '').trim() || 'the business';
    const first = String(renter.firstName || '').trim() || 'there';
    // Claimed before it's sent, so two taps at once send one email.
    const claimed = await db.runTransaction(async (tx: any) => {
      const cur: any = (await tx.get(rRef)).data() || {};
      const prev = Date.parse(String(cur.payLinkSentAt || ''));
      if (Number.isFinite(prev) && Date.now() - prev < PAY_LINK_GAP_MS) return false;
      tx.set(rRef, { payLinkSentAt: new Date().toISOString() }, { merge: true });
      return true;
    });
    if (!claimed) return recent();
    // Made only once the send is claimed, so a refused second tap leaves no sign-in link lying about.
    const link = await mintRenterLink(db, tenantId, renterId, base, { renter, query: 'tab=rent' }).catch(() => null);
    if (!link) {
      await rRef.set({ payLinkSentAt: null }, { merge: true }).catch(() => undefined);
      return j({ ok: false, error: 'The link couldn’t be made. Try again in a moment.' }, 500);
    }
    const sent = await sendNotification(db, {
      tenantId, channel: 'email', to, kind: 'rent_pay_link', recipientType: 'renter', recipientId: renterId,
      recipientName: `${renter.firstName || ''} ${renter.lastName || ''}`.trim() || null,
      subject: `${money(cents)} to pay to ${business}`,
      html: brandedEmailHtml({
        studioName: business,
        title: `You have ${money(cents)} to pay.`,
        bodyLines: [`Hi ${first}, this is what’s open on your account with ${business}: ${money(cents)}.`, 'You can see each bill and pay by card in your portal.'],
        cta: { label: 'See it and pay', url: link },
        footerNote: `Sent by ${business}.`,
      }),
      tokens: { renter_first: first, studio: business, amount: money(cents), link },
    } as any).catch(() => ({ ok: false }));
    if (!(sent as any)?.ok) {
      await rRef.set({ payLinkSentAt: null }, { merge: true }).catch(() => undefined);
      return j({ ok: false, error: 'The email didn’t go out. Try again in a moment.' }, 502);
    }
    return j({ ok: true, sentTo: to, cents });
  } catch {
    return j({ ok: false, error: 'That didn’t go out. Try again in a moment.' }, 500);
  }
}
