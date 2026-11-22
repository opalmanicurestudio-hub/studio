// src/lib/activity-server.ts — ONE LINE IN ACTIVITY FOR EACH MONEY MOMENT (server; lib/activity). Writes the audit log's
// line (lib/audit: append-only, nobody edits or deletes it) with what kind it is, how much, where, who did it, who okayed
// it, why, and whether it's worth a second look: a void after the kitchen started, the drawer opened with no sale again
// by the same person within half an hour, a refund in cash by the person who took the payment, a big refund, too many
// wrong PINs. Never throws, and never stops what it records.
import { logAuditAdmin } from '@/lib/audit';
import { flagFor, NO_SALE_WINDOW_MS, BIG_REFUND_CENTS, type ActivityKind, type ActivityWhere, type ActivityWho } from '@/lib/activity';

export type MoneyMoment = {
  /** The audit line's name (counter.refund, counter.void…), as other screens already read it. */
  action: string; kind: ActivityKind; targetType: string; targetId?: string | null; summary: string;
  cents?: number | null; where: ActivityWhere; by: ActivityWho; okBy?: ActivityWho | null; reason?: unknown; ref?: string | null;
  /** Sent by the app on its own (a rule the business set), not by a person. */
  auto?: boolean;
  /** What makes it worth a look, as the caller knows it. */
  afterKitchen?: boolean; toCash?: boolean; sameAsPaid?: boolean;
};

const clean = (v: unknown, n: number) => (typeof v === 'string' && v.trim() ? v.replace(/\s+/g, ' ').trim().slice(0, n) : null);
const who = (w: ActivityWho | null | undefined) => (w ? { id: w.id && /^[A-Za-z0-9_-]{1,160}$/.test(w.id) ? w.id : null, name: clean(w.name, 60) || 'Someone' } : null);

/** The refund amount worth a look for this business (its own, or $50); null when it turned that off. */
export function bigRefundOf(tenant: any): number | null {
  const v = tenant?.moneyRules?.alerts?.refundOverCents;
  if (v === null) return null;
  const n = Math.round(Number(v)); return Number.isFinite(n) && n >= 100 ? n : BIG_REFUND_CENTS;
}

/** Writes the line; answers with why it's worth a look (null: it isn't), for the caller's alerts. */
export async function logMoney(db: any, tenantId: string, m: MoneyMoment, tenant?: any): Promise<{ flag: string | null }> {
  try {
    const by = who(m.by)!; const okBy = who(m.okBy || null);
    // (The drawer opened with no sale again by the same person, within half an hour: counted on a small record of their
    // own, in one step, so two at once are each counted.)
    let noSalesBefore = 0;
    if (m.kind === 'drawer' && by.id) {
      const ref = db.doc(`tenants/${tenantId}/private/noSales_${by.id}`); const nowMs = Date.now();
      noSalesBefore = await db.runTransaction(async (tx: any) => {
        const d: any = (await tx.get(ref)).data() || {};
        const live = (Array.isArray(d.at) ? d.at : []).filter((x: unknown) => typeof x === 'number' && nowMs - (x as number) < NO_SALE_WINDOW_MS) as number[];
        tx.set(ref, { at: [...live, nowMs].slice(-20) });
        return live.length;
      }).catch(() => 0);
    }
    const t = tenant === undefined ? (await db.doc(`tenants/${tenantId}`).get()).data() || {} : tenant;
    const cents = Number.isFinite(Number(m.cents)) && m.cents !== null ? Math.round(Number(m.cents)) : null;
    const flag = flagFor({ kind: m.kind, cents, afterKitchen: m.afterKitchen, noSalesBefore, bigRefundCents: bigRefundOf(t), toCash: m.toCash, sameAsPaid: m.sameAsPaid });
    const acting = okBy || by;
    await logAuditAdmin(db, tenantId, {
      action: m.action, targetType: m.targetType, targetId: String(m.targetId || ''), summary: String(m.summary).slice(0, 500),
      ...(cents !== null ? { amount: cents / 100 } : {}),
      actor: m.auto ? { type: 'system', name: 'Automatic' } : { type: 'user', ...(acting.id ? { id: acting.id } : {}), name: acting.name },
      kind: m.kind, cents, where: m.where, by, okBy, reason: clean(m.reason, 120), ref: clean(m.ref, 40), flag, ...(m.auto ? { auto: true } : {}),
    } as any);
    return { flag };
  } catch (e: any) {
    console.error('[activity] not written', m.action, e?.message);
    return { flag: null };
  }
}
