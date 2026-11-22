// src/lib/activity-server.ts — ONE LINE IN ACTIVITY FOR EACH MONEY MOMENT (server; lib/activity). Writes the audit log's
// line (lib/audit: append-only, nobody edits or deletes it) with what kind it is, how much, where, who did it, who okayed
// it, why, and whether it's worth a second look: a void after the kitchen started, the drawer opened with no sale again
// by the same person within half an hour, a refund in cash by the person who took the payment, a big refund, too many
// wrong PINs. Then the owner hears about it, as they chose (lib/tell-managers). Never throws, and never stops what it
// records.
import { logAuditAdmin } from '@/lib/audit';
import type { ActivityLine } from '@/lib/activity';
import { activityLine, flagFor, lookMessage, tellModeOf, NO_SALE_WINDOW_MS, BIG_REFUND_CENTS, type ActivityKind, type ActivityWhere, type ActivityWho } from '@/lib/activity';
import { tellManagers } from '@/lib/tell-managers';

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
    const entry = {
      action: m.action, targetType: m.targetType, targetId: String(m.targetId || ''), summary: String(m.summary).slice(0, 500),
      ...(cents !== null ? { amount: cents / 100 } : {}),
      actor: m.auto ? { type: 'system', name: 'Automatic' } : { type: 'user', ...(acting.id ? { id: acting.id } : {}), name: acting.name },
      kind: m.kind, cents, where: m.where, by, okBy, reason: clean(m.reason, 120), ref: clean(m.ref, 40), flag, ...(m.auto ? { auto: true } : {}),
    };
    await logAuditAdmin(db, tenantId, entry as any);
    // Worth a look: the owner (and admins) hear, as they chose (their phone, or in the app), never the people it's about.
    // (Not for what the app did on its own by the owner's own rules: it's marked in Activity and the night report.)
    if (flag && !m.auto) {
      const mode = tellModeOf(t);
      if (mode !== 'off') {
        const line = activityLine('new', { ...entry, at: new Date().toISOString() });
        if (line) await tellManagers(db, tenantId, t, { type: mode === 'push' ? 'money_look' : 'money_look_quiet', message: lookMessage(line), link: '/activity', priority: 'high' }, { ownersOnly: true, except: [by.id, okBy?.id] });
      }
    }
    return { flag };
  } catch (e: any) {
    console.error('[activity] not written', m.action, e?.message);
    return { flag: null };
  }
}

/** A span's money lines from the audit log, newest first: read back from its end a page at a time (each page from the
 *  last one's oldest time, that time included, a line already read not counted twice), so other kinds of line never
 *  crowd the money ones out. `more`: there were more than `max`, or more pages than were read. */
export async function moneyLinesIn(db: any, tenantId: string, from: string, to: string, o: { max?: number; page?: number; pages?: number; endIncluded?: boolean } = {}): Promise<{ lines: ActivityLine[]; more: boolean }> {
  const { activityLine } = await import('@/lib/activity');
  const max = o.max ?? 1000, size = o.page ?? 1000, pages = o.pages ?? 5;
  const seen = new Set<string>(); const lines: ActivityLine[] = []; let before = to; let full = true; let first = true;
  for (let n = 0; n < pages && full && lines.length < max; n++) {
    const snap = await db.collection(`tenants/${tenantId}/auditLogs`).where('at', '>=', from).where('at', first && o.endIncluded === false ? '<' : '<=', before).orderBy('at', 'desc').limit(size).get();
    first = false;
    for (const d of snap.docs) { if (seen.has(d.id)) continue; seen.add(d.id); const l = activityLine(d.id, d.data() || {}); if (l) lines.push(l); }
    full = snap.docs.length >= size; if (snap.docs.length) before = String((snap.docs[snap.docs.length - 1].data() || {}).at || before);
  }
  lines.sort((x, y) => String(y.at).localeCompare(String(x.at)));
  return { lines: lines.slice(0, max), more: full || lines.length > max };
}
