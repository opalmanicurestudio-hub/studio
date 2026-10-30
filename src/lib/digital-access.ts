// src/lib/digital-access.ts — WHO MAY OPEN A PURCHASED DOWNLOAD, AND FOR HOW LONG (server).
// One answer, read by the file route, the library, the customer's account and the order page, so a refunded or
// charged-back buyer is closed out everywhere at once:
//   · the order is paid and not cancelled;
//   · the line wasn't refunded or returned, in full or unit by unit (a part refund of the item counts);
//   · the whole order wasn't refunded (in the app or in the Stripe dashboard);
//   · no chargeback is open on it, and none was lost (a won one opens it again);
//   · the access window sold hasn't ended.
// Opening a file also takes proof it's the buyer (the order pass, lib/order-pass), and each open gets a stream link
// signed for ten minutes, so a copied address stops working almost at once.
import { createHmac, timingSafeEqual } from 'crypto';

export { fullyRefunded, disputeHolds, digitalLineAccess, closedMessage } from '@/lib/digital-access-rule';
export type { ClosedReason } from '@/lib/digital-access-rule';

// ─── Stream links signed for ten minutes ─────────────────────────────────────────

export const STREAM_MINUTES = 10;
const secret = () => String(process.env.ORDER_PASS_SECRET || process.env.CRON_SECRET || process.env.FIREBASE_ADMIN_PRIVATE_KEY || 'order-pass');
// A link is for viewing in the page (never counted against downloads) or for saving a copy (counted). The kind is
// signed into the link, so a view link can't be turned into a download.
export type StreamMode = 'view' | 'download';
const sign = (tenantId: string, orderId: string, productId: string, exp: number, mode: StreamMode) =>
  createHmac('sha256', secret()).update(`stream:${tenantId}:${orderId}:${productId}:${exp}${mode === 'download' ? ':download' : ''}`).digest('base64url').slice(0, 32);

export function makeStreamToken(tenantId: string, orderId: string, productId: string, now = Date.now(), mode: StreamMode = 'view'): string {
  const exp = now + STREAM_MINUTES * 60_000;
  return `${exp}.${mode === 'download' ? 'd' : 'v'}.${sign(tenantId, orderId, productId, exp, mode)}`;
}

/** Which kind of link a token is (it says nothing about whether it's valid: check that first). */
export function streamTokenMode(token: unknown): StreamMode {
  return String(token || '').split('.')[1] === 'd' ? 'download' : 'view';
}

export function checkStreamToken(tenantId: string, orderId: string, productId: string, token: unknown, now = Date.now()): boolean {
  const [e, m, s] = String(token || '').split('.');
  const exp = Number(e);
  if (!Number.isFinite(exp) || exp < now || !s || !['v', 'd'].includes(m)) return false;
  const want = Buffer.from(sign(tenantId, orderId, productId, exp, m === 'd' ? 'download' : 'view')); const got = Buffer.from(s);
  return want.length === got.length && timingSafeEqual(want, got);
}

// ─── Chargebacks ─────────────────────────────────────────────────────────────────

/**
 * Pauses (dispute opened), closes (lost) or reopens (won) the downloads on the order a disputed payment was for, kept
 * per dispute so one dispute's outcome never overwrites another's, and a decided dispute is never set back to open by
 * a late notice. Found by the order named on the payment's books, else by the payment itself. Orders with nothing
 * digital are left alone. Returns 'failed' on a database error so the webhook can answer Stripe with an error and be
 * sent the notice again.
 */
export async function holdDigitalForDispute(db: any, tenantId: string, find: { retailOrderId?: string | null; paymentIntentId?: string | null }, status: 'open' | 'won' | 'lost', disputeId: string): Promise<'held' | 'none' | 'failed'> {
  try {
    let ref: any = null;
    if (find.retailOrderId) ref = db.doc(`tenants/${tenantId}/retailOrders/${find.retailOrderId}`);
    else if (find.paymentIntentId) {
      const q = await db.collection(`tenants/${tenantId}/retailOrders`).where('stripePaymentIntentId', '==', find.paymentIntentId).limit(1).get();
      ref = q.docs[0]?.ref || null;
    }
    if (!ref) return 'none';
    const key = String(disputeId).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 120);
    const at = new Date().toISOString();
    const wrote = await db.runTransaction(async (tx: any) => {
      const snap = await tx.get(ref);
      const o: any = snap.exists ? snap.data() : null;
      if (!o || !(o.lines || []).some((l: any) => l?.digital === true)) return false;
      const cur = String(o.digitalHolds?.[key]?.status || '');
      if (cur === status || (status === 'open' && ['won', 'lost'].includes(cur))) return false;
      tx.set(ref, { digitalHolds: { [key]: { status, at } } }, { merge: true });
      const ev = ref.collection('events').doc(`dispute_${key}_${status}`);
      tx.set(ev, { id: ev.id, type: 'note', at, actorId: 'system', actorName: 'Payments',
        meta: { text: status === 'open' ? 'Downloads paused: the payment is being disputed.' : status === 'won' ? 'Downloads open again: the dispute was won.' : 'Downloads closed: the dispute was lost.' } });
      return true;
    });
    return wrote ? 'held' : 'none';
  } catch (e: any) {
    console.error('[digital-access] dispute hold', String(e?.message || e).slice(0, 200));
    return 'failed';
  }
}
