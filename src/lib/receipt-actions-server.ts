// src/lib/receipt-actions-server.ts — A RECEIPT'S LINK, PRINTING IT, THE CASH DRAWER, AND SENDING IT (design board
// "Receipts at the counter"). The same for the front desk and the counter (api/receipts, signed in) and for a lane
// screen that carries its own key (api/counter 'receipt': the drive-thru window). Built from what the server recorded,
// never the screen's numbers; a counter order's receipt (co_<order>) from the order itself (lib/counter-receipt).
// - print: on the receipt printer picked (or the only one); with none, the slip comes back for the device's own print
//   dialog. `drawer`: a cash sale's drawer opened with it.
// - drawer: a cash sale's drawer with no receipt. Either way only for a cash sale taken into the drawer (not a pouch),
//   once, within a few minutes of it, and never for a renter.
// - send: a private link to it, by text or email.
import { randomBytes } from 'crypto';
import { COUNTER_RECEIPT, counterReceipt, hasReceipt } from '@/lib/counter-receipt';
import { linkOrigin } from '@/lib/app-origin';
import { isPlaceholderName } from '@/lib/visit-email';

const $ = (n: any) => `$${(Number(n) || 0).toFixed(2)}`;
/** The receipt as label and amount rows for the email (the link has the full printable version). */
function receiptRows(r: any): { label: string; value: string; strong?: boolean; muted?: boolean }[] {
  const D = r?.detail; if (!D || r.voided) return [];
  const out: { label: string; value: string; strong?: boolean; muted?: boolean }[] = [];
  for (const l of D.lines || []) if (l.kind !== 'note') out.push({ label: `${l.kind === 'addon' ? '+ ' : ''}${l.label}${l.qty > 1 ? ` × ${l.qty}` : ''}${l.staff ? ` (${l.staff})` : ''}`, value: l.redeemed ? 'Included' : $(l.amount) });
  for (const f of D.fees || []) out.push({ label: String(f.label || 'Fee'), value: $(f.amount) });
  for (const d of r.discounts || []) out.push({ label: String(d.label || 'Discount'), value: `−${$(d.amount)}` });
  if (Number(r.tax) > 0) out.push({ label: r.taxLabel || 'Tax', value: $(r.tax), muted: true });
  if (Number(r.tip) > 0) out.push({ label: `Tip${(D.tipShares || []).length > 1 ? ` (${D.tipShares.map((t: any) => `${t.name} ${$(t.amount)}`).join(', ')})` : ''}`, value: $(r.tip), muted: true });
  if (Number(D.depositUsed) > 0) out.push({ label: 'Deposit already paid', value: `−${$(D.depositUsed)}`, muted: true });
  if (Number(D.storeCredit) > 0) out.push({ label: 'Store credit used', value: `−${$(D.storeCredit)}`, muted: true });
  out.push({ label: 'Total', value: $(r.total), strong: true });
  for (const a of D.accounts || []) out.push(a.kind === 'rent'
    ? { label: 'Rent', value: Number(a.owedAfterCents) > 0 ? `${$(a.owedAfterCents / 100)} still owed` : Number(a.creditCents) > 0 ? `${$(a.creditCents / 100)} paid ahead` : 'All paid up', muted: true }
    : { label: 'Tuition', value: Number(a.remainingCents) > 0 ? `${$(a.remainingCents / 100)} remaining` : 'Paid in full', muted: true });
  return out;
}

const key = () => randomBytes(18).toString('base64url');

/** A receipt by its id: the front desk's (kept), or a counter order's (built from the order). */
export async function receiptOf(db: any, T: string, id: string): Promise<{ r: any; ref: any; counter: boolean } | null> {
  const m = id.match(COUNTER_RECEIPT);
  if (m) {
    const ref = db.doc(`${T}/counterOrders/${m[1]}`); const o: any = (await ref.get()).data();
    return o && hasReceipt(o) ? { r: counterReceipt(o, m[1]), ref, counter: true } : null;
  }
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(id)) return null;
  const ref = db.doc(`${T}/receipts/${id}`); const r: any = (await ref.get()).data();
  return r ? { r, ref, counter: false } : null;
}
/** Its private key (made for one that has none yet: older receipts, and every counter order's until it's first asked). */
async function keyOf(db: any, x: { r: any; ref: any; counter: boolean }): Promise<string> {
  if (x.r.viewKey) return String(x.r.viewKey);
  // (Read again in the same step: two screens asking at once get the same key, so a link already sent keeps working.)
  const field = x.counter ? 'receiptKey' : 'viewKey';
  const k = await db.runTransaction(async (tx: any) => { const d: any = (await tx.get(x.ref)).data() || {}; if (d[field]) return String(d[field]); const n = key(); tx.set(x.ref, { [field]: n }, { merge: true }); return n; });
  x.r.viewKey = k; return k;
}
const DRAWER_MS = 15 * 60000;

/** Who asks. `guest`: the guest themselves at a kiosk, sending to what they typed: no name from the order goes in the
 *  message (a name typed at a kiosk is never sent to someone else). */
export type ReceiptActor = { name: string; isRenter?: boolean; guest?: boolean };
const J = (body: any, init?: { status?: number }) => ({ status: init?.status || 200, body });

/** link | print | drawer | send, for one receipt. */
export async function receiptAct(db: any, tenantId: string, receiptId: string, action: string, b: any, actor: ReceiptActor, origin: string): Promise<{ status: number; body: any }> {
  const T = `tenants/${tenantId}`; const renter = actor.isRenter === true;
  const got = await receiptOf(db, T, receiptId);
  if (!got) return J({ ok: false, error: 'That receipt could not be found.' }, { status: 404 });
  if (renter && (got.counter || action === 'drawer')) return J({ ok: false, error: 'That’s for the business’s own team.' }, { status: 403 });
  const { r, ref } = got;
  const viewKey = await keyOf(db, got);
  const t: any = ((await db.doc(T).get()).data() as any) || {};
  const url = `${linkOrigin(t, origin)}/r/${tenantId}/${receiptId}?k=${viewKey}`;
  if (action === 'link') return J({ ok: true, url });
  if (action === 'print' || action === 'drawer') {
    const { printersOf, queueJob } = await import('@/lib/printing-server'); const { receiptDoc, drawerDoc } = await import('@/lib/printing');
    const all = await printersOf(db, T);
    const want = String(b.printerId || '');
    const pick = (list: any[]) => list.find((p) => p.id === want) || (list.length === 1 ? list[0] : null);
    // The drawer: only a cash sale's, once, within a few minutes of it (never a way to open the drawer at any time). It's
    // the picked printer's own drawer, or the only printer with one.
    const cashNow = String(r.paymentMethod) === 'cash' && !r.voided && !r.inPouch && Date.now() - (Date.parse(String(r.date || '')) || 0) < DRAWER_MS;
    const wantsDrawer = !renter && (action === 'drawer' || b.drawer === true);
    const drawers = all.filter((p: any) => p.drawer);
    const drawerAt = wantsDrawer && cashNow ? pick(drawers) : null;
    let opened = false; let drawerQueued = false;
    if (drawerAt) {
      opened = await db.runTransaction(async (tx: any) => { const d: any = (await tx.get(ref)).data() || {}; if (d.drawerOpenedAt) return false; tx.set(ref, { drawerOpenedAt: new Date().toISOString(), drawerOpenedBy: actor.name || null }, { merge: true }); return true; });
    }
    // (Marked opened before it's sent: a send that didn't go through takes the mark back, so it can be tried again.)
    const drawerJob = async () => { await queueJob(db, T, drawerAt.id, 'drawer', drawerDoc(), { receiptId }); drawerQueued = true; };
    const unmark = async () => { if (opened && !drawerQueued) await ref.set({ drawerOpenedAt: null, drawerOpenedBy: null }, { merge: true }).catch(() => undefined); };
    if (action === 'drawer') {
      if (!opened) return J({ ok: false, error: !cashNow ? 'The drawer opens only for a cash sale, just after it.' : !drawers.length ? 'No printer here opens a cash drawer. Turn it on in Printers.'
        : !drawerAt ? 'More than one printer opens a drawer. Pick this screen’s receipt printer, the one with the drawer.' : 'The drawer was already opened for this sale.' }, { status: 409 });
      try { await drawerJob(); } catch { await unmark(); return J({ ok: false, error: 'The drawer didn’t open. Try again.' }, { status: 503 }); }
      return J({ ok: true, printer: drawerAt.name });
    }
    const addr = t.address || t.businessAddress || null;
    const doc = receiptDoc(r, { business: String(t.name || t.businessName || 'Receipt'), address: typeof addr === 'string' ? addr : [addr?.street, addr?.city, addr?.state].filter(Boolean).join(', ') || null, tz: t.timezone || null, url });
    const printers = all.filter((p: any) => p.receipts);
    const at = pick(printers);
    // (No networked receipt printer here, or more than one and none picked: the slip, for the tablet's own print dialog.)
    try {
      if (!at) {
        if (opened) await drawerJob();
        return J({ ok: true, doc, printers: printers.map((p: any) => ({ id: p.id, name: p.name })), drawer: opened });
      }
      // A drawer on another printer than the receipt's opens by itself.
      if (opened && drawerAt.id !== at.id) await drawerJob();
      await queueJob(db, T, at.id, 'receipt', opened && drawerAt.id === at.id ? { ...doc, drawer: true } : doc, { receiptId });
      drawerQueued = opened;
    } catch {
      await unmark();
      return J({ ok: false, error: 'The receipt didn’t reach the printer. Try again.' }, { status: 503 });
    }
    return J({ ok: true, printer: at.name, drawer: opened });
  }
  if (action === 'send') {
    const c: any = r.clientId ? (((await db.doc(`${T}/clients/${r.clientId}`).get()).data() as any) || {}) : {};
    const channel = b.channel === 'sms' ? 'sms' : 'email';
    const to = String(b.to || (channel === 'email' ? c.email : c.phone) || '').trim();
    if (!to || (channel === 'email' && !to.includes('@'))) return J({ ok: false, error: channel === 'email' ? 'There is no email address on file for this client. Please enter one.' : 'There is no mobile number on file for this client. Please enter one.' }, { status: 400 });
    const studio = t.name || t.businessName || 'Our team';
    const full = String(r.clientName || c.name || '').trim();
    const first = !actor.guest && full && !isPlaceholderName(full) ? full.split(/\s+/)[0] : 'there';   // a walk-in's placeholder is no name
    const what = r.voided ? (r.voidRefunded ? 'your refund slip' : r.cashReturned ? 'your void slip (cash returned)' : 'your void slip') : 'your receipt';
    const { sendNotification } = await import('@/lib/notify');
    let sent: any;
    if (channel === 'email') { const { brandedEmailHtml } = await import('@/lib/email-template');
      const replyTo = String(t.email || t.contactEmail || '').trim();
      sent = await sendNotification(db, { tenantId, channel: 'email', to, subject: `${studio}: ${r.voided ? 'your void slip' : 'your receipt'}`, kind: r.voided ? 'void_slip' : 'receipt',
        html: brandedEmailHtml(r.voided
          ? { studioName: studio, eyebrow: r.voidRefunded ? 'Refund slip' : 'Void slip', title: 'Your sale was', titleBold: 'voided',
              bodyLines: [`Hi ${first}, here is ${what}${r.total ? ` for $${Number(r.total).toFixed(2)}` : ''}.`, r.voidRefunded ? 'The refund will be returned to your card and usually appears within 5 to 10 business days.' : ''],
              cta: { label: 'View the slip', url } }
          : { studioName: studio, eyebrow: 'Receipt', title: first === 'there' ? 'Thanks for coming in' : 'Thanks for coming in,', titleBold: first === 'there' ? '' : first,
              preheader: r.total ? `Your receipt for $${Number(r.total).toFixed(2)}` : 'Your receipt',
              amounts: receiptRows(r), ...(receiptRows(r).length ? {} : { bodyLines: [`Here is your receipt${r.total ? ` for $${Number(r.total).toFixed(2)}` : ''}.`] }),
              cta: { label: 'View your receipt', url },
              // "Book again" when the sale was a visit (never on a shop-only sale, or rent and tuition).
              links: (r.detail?.lines || []).some((l: any) => l.kind === 'service') ? [{ label: 'Book again', url: `${linkOrigin(t, origin)}/book/${encodeURIComponent(tenantId)}` }] : null }),
        ...(replyTo.includes('@') ? { replyTo } : {}), clientId: r.clientId || null, clientName: r.clientName || null } as any);
    } else sent = await sendNotification(db, { tenantId, channel: 'sms', to, kind: r.voided ? 'void_slip' : 'receipt', text: `Hi ${first}, here is ${what}: ${url}`, clientId: r.clientId || null, clientName: r.clientName || null } as any);
    const prior: any[] = got.counter ? (((await ref.get()).data() as any)?.receiptSends || []) : (r.sends || []);
    await ref.set({ [got.counter ? 'receiptSends' : 'sends']: [...prior, { at: new Date().toISOString(), channel, to, by: actor.name, ok: !!sent?.ok }].slice(-20) }, { merge: true });
    return sent?.ok ? J({ ok: true, url }) : J({ ok: false, error: 'The message could not be sent. Please check the address and try again.' }, { status: 502 });
  }
  return J({ ok: false, error: 'Unknown action.' }, { status: 400 });
}
