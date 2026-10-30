// src/lib/digital-gift-server.ts — SENDING A DOWNLOAD BOUGHT AS A GIFT (server). On its day (today when none was chosen,
// in the shop's time zone), once: the gift email to the person it's for, with the buyer's first name and message and a
// link that opens their library. Claimed on the order first, so two checks at once send it once; a send that fails gives
// the claim back and the five-minute check tries again, up to GIFT_TRIES times, then the gift is marked as not sent and
// the buyer's order page says so. A gift on a cancelled or refunded order is never sent.
//
// `digitalGiftPending` is what the five-minute check looks for. It's set once the order is paid (lib/retail-webhook),
// never at checkout, and cleared as soon as the gift is sent or can't be, so abandoned checkouts never fill the list.
import { todayIn, tenantTimeZone } from '@/lib/tenant-time';
import { GIFT_TRIES, giftDead, giftDue } from '@/lib/digital-gift';

/** Send one order's gift if it's due. 'sent', 'not_due' (or already sent, or never will be), or 'failed'. */
export async function sendDueGift(db: any, tenantId: string, orderId: string): Promise<'sent' | 'not_due' | 'failed'> {
  const ref = db.doc(`tenants/${tenantId}/retailOrders/${orderId}`);
  const tSnap = await db.doc(`tenants/${tenantId}`).get();
  const t: any = tSnap.exists ? tSnap.data() : {};
  const today = todayIn(tenantTimeZone(t));
  const claimed: any = await db.runTransaction(async (tx: any) => {
    const s = await tx.get(ref); const o: any = s.exists ? s.data() : null;
    if (!o?.digitalGift) return null;
    // Sent, or never going (cancelled, refunded, gave up): off the five-minute check's list.
    if (o.digitalGift.sentAt || giftDead(o)) { if (o.digitalGiftPending) tx.set(ref, { digitalGiftPending: false }, { merge: true }); return null; }
    if (!giftDue(o, today)) return null;
    // A send cut off part way (its claim never given back) is tried again after ten minutes.
    if (o.digitalGift.sending && Date.now() - (Date.parse(String(o.digitalGift.sending)) || 0) < 10 * 60000) return null;
    tx.set(ref, { digitalGift: { ...o.digitalGift, sending: new Date().toISOString() } }, { merge: true });
    return o;
  });
  if (!claimed) return 'not_due';
  const g = claimed.digitalGift;
  const origin = String(process.env.NEXT_PUBLIC_APP_URL || '').trim().replace(/\/+$/, '');
  let ok = false;
  try {
    if (!origin) throw new Error('no app address');
    const shop = String(t.businessName || t.name || 'The shop');
    const from = String(claimed.customerName || '').split(' ')[0] || 'Someone';
    const names = (claimed.lines || []).filter((l: any) => l?.digital === true).map((l: any) => String(l.name || 'A download'));
    const url = `${origin}/shop/${tenantId}/library/${orderId}?g=${encodeURIComponent(String(g.token))}`;
    const subject = `${from} sent you a gift from ${shop}`;
    const { brandedEmailHtml } = await import('@/lib/email-template');
    const { sendNotification } = await import('@/lib/notify');
    const lines = [`Hi ${g.toName}, ${from} sent you ${names.length === 1 ? names[0] : `${names.length} things`} from ${shop}.`, ...(g.message ? [`“${g.message}”`] : []), ...(names.length > 1 ? [names.join(', ')] : []), 'It’s in your own library. On a new device you’ll confirm it’s you with a code sent to this email. Questions about it? Reply to this email to reach the shop.'];
    const html = brandedEmailHtml({ studioName: shop, title: subject, bodyLines: lines, cta: { label: 'Open my gift', url } });
    // The plain text, which the team's message log keeps, leaves the link out: the link opens the gift.
    const r = await sendNotification(db, { tenantId, channel: 'email', to: String(g.toEmail), subject, text: `${lines.join('\n\n')}\n\nOpen your gift from the button in this email.`, html, kind: 'digital_gift', recipientType: 'other', recipientName: String(g.toName) });
    ok = !!r.ok;
  } catch (e: any) { console.error('[digital-gift] send', String(e?.message || e).slice(0, 160)); }
  const tries = Math.max(0, Math.floor(Number(g.tries) || 0)) + (ok ? 0 : 1);
  const patch = ok
    ? { digitalGift: { ...g, sending: null, sentAt: new Date().toISOString() }, digitalGiftPending: false }
    : tries >= GIFT_TRIES
      ? { digitalGift: { ...g, sending: null, tries, failedAt: new Date().toISOString() }, digitalGiftPending: false }
      : { digitalGift: { ...g, sending: null, tries } };
  // The email has gone (or not): this record has to land, or the next check would send it again.
  for (let i = 0; i < 3; i++) {
    try { await ref.set(patch, { merge: true }); break; }
    catch (e: any) { if (i === 2) console.error('[digital-gift] record', orderId, String(e?.message || e).slice(0, 160)); }
  }
  return ok ? 'sent' : 'failed';
}

/** Every paid gift waiting for its day, for one shop (the five-minute check). Only paid, unsent gifts are on the list. */
export async function sweepDueGifts(db: any, tenantId: string): Promise<number> {
  const snap = await db.collection(`tenants/${tenantId}/retailOrders`).where('digitalGiftPending', '==', true).limit(300).get();
  let sent = 0;
  for (const d of snap.docs) { try { if ((await sendDueGift(db, tenantId, d.id)) === 'sent') sent++; } catch { /* next run */ } }
  return sent;
}
