// src/lib/owed-to-clients.ts — WHAT THE BUSINESS STILL OWES CLIENTS (Money). Store credit that hasn't been used or run
// out (referral rewards apart from refunds and goodwill), and gift card balances. It's money already taken or promised,
// so it's owed, not income; it becomes a sale only when it's spent. Ending in the next 30 days is shown on its own.
import { availableCredits } from '@/lib/store-credit';

const T = (t: string) => `tenants/${t}`;
const ms = (v: any) => (typeof v === 'string' ? Date.parse(v) || 0 : Number(v) || 0);
const cents = (n: any) => Math.round((Number(n) || 0) * 100);

export async function owedToClients(db: any, t: string, now = Date.now()) {
  const soon = now + 30 * 86400000;
  const credit = { referralCents: 0, otherCents: 0, clients: 0, endingSoonCents: 0 };
  const cs = await db.collection(`${T(t)}/clients`).where('totalStoreCredit', '>', 0).get();
  for (const d of cs.docs) { const list = availableCredits(d.data() || {}, now); if (!list.length) continue; credit.clients++;
    for (const c of list) { const v = Number.isFinite(Number(c.amountCents)) && Number(c.amountCents) > 0 ? Math.round(Number(c.amountCents)) : cents(c.amount);
      if (c.source === 'referral_reward') credit.referralCents += v; else credit.otherCents += v;
      if (c.expiresAt && ms(c.expiresAt) <= soon) credit.endingSoonCents += v; } }
  const gift = { cents: 0, cards: 0 };
  const gs = await db.collection(`${T(t)}/giftCards`).where('status', '==', 'active').get();
  for (const d of gs.docs) { const g: any = d.data() || {}; const v = Math.max(0, Math.round(Number(g.balanceCents) || 0)); if (v > 0 && !g.renterId && !g.ownerRenterId) { gift.cents += v; gift.cards++; } }
  // Creators you pay yourself: cash per paid first visit, and fees for approved pieces, until you mark them paid.
  let creatorsCents = 0;
  try { const rs = await db.collection(`${T(t)}/referrals`).where('cashOwedCents', '>', 0).get(); for (const d of rs.docs) { const r: any = d.data() || {}; if (!r.cashPaidAt) creatorsCents += Math.round(Number(r.cashOwedCents) || 0); }
    const { feesOwed } = await import('@/lib/creator-campaigns-server'); for (const v of (await feesOwed(db, t)).values()) creatorsCents += v; } catch { /* none */ }
  return { ok: true as const, totalCents: credit.referralCents + credit.otherCents + gift.cents, credit, gift, creatorsCents };
}
