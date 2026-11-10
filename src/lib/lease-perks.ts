// src/lib/lease-perks.ts — PERKS WRITTEN INTO A LEASE ARE GIVEN WHEN THEY'RE DUE. A lease from the builder can promise a
// free week, a percentage off one bill, or a set credit, when the lease starts or after 3, 6 or 12 months. Each is
// posted to the renter's rent account as a credit the night it's due, and the same nightly step then takes it off their
// open bills (lib/rent-credits). Only leases in the builder's own words, which state them: an attorney's lease says
// what it says, and older leases kept a perks list that was never applied, so turning that on now would hand out
// credits the business may already have honored by hand.
// The grant re-reads the lease in one step and the credit has a fixed id per perk, so a perk is never given twice.

const n = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export type BuilderPerkType = 'free_week' | 'rent_discount' | 'custom';
export type BuilderPerkTrigger = 'on_signup' | 'after_3_months' | 'after_6_months' | 'after_12_months';
export const BUILDER_PERK_TYPES: { key: BuilderPerkType; label: string }[] = [
  { key: 'free_week', label: 'A free week' },
  { key: 'rent_discount', label: 'A percentage off one bill' },
  { key: 'custom', label: 'A set credit' },
];
export const BUILDER_PERK_TRIGGERS: { key: BuilderPerkTrigger; label: string }[] = [
  { key: 'on_signup', label: 'When the lease starts' },
  { key: 'after_3_months', label: 'After 3 months' },
  { key: 'after_6_months', label: 'After 6 months' },
  { key: 'after_12_months', label: 'After 12 months' },
];
export interface PerkLike { id?: string; type: string; label?: string; trigger: string; valueCents?: number; valuePercent?: number; appliedAt?: string | null; ledgerEntryId?: string | null }

const MONTHS_AFTER: Record<string, number> = { after_3_months: 3, after_6_months: 6, after_12_months: 12 };
const PERIOD: Record<string, string> = { daily: 'day', weekly: 'week', biweekly: 'two weeks', monthly: 'month' };

/** One week's rent, from the rent and how often it's due. */
export function weekOfRent(rentCents: number, frequency: string): number {
  const r = Math.max(0, n(rentCents));
  return Math.round(frequency === 'weekly' ? r : frequency === 'biweekly' ? r / 2 : frequency === 'daily' ? r * 7 : (r * 12) / 52);
}

/** What a perk is worth, in cents, on this rent. */
export function perkCreditCents(p: PerkLike, rentCents: number, frequency: string): number {
  if (p.type === 'free_week') return weekOfRent(rentCents, frequency);
  if (p.type === 'rent_discount') return Math.round(Math.max(0, n(rentCents)) * Math.min(100, Math.max(0, n(p.valuePercent))) / 100);
  return Math.max(0, Math.round(n(p.valueCents)));
}

/** Same day n months on, the day clamped to a shorter month (Aug 31 + 6 months is Feb 28). */
function plusMonths(iso: string, months: number): string {
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return '';
  const last = new Date(Date.UTC(y, m - 1 + months + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 + months, Math.min(d, last))).toISOString().slice(0, 10);
}

/** The day a perk is due: the start date (or the day they signed, if later), or that many months after the start. */
export function perkDueOn(p: PerkLike, lease: { startDate?: string; signedAt?: string | null }): string | null {
  const start = String(lease.startDate || '').slice(0, 10);
  if (!start) return null;
  if (p.trigger === 'on_signup') { const signed = String(lease.signedAt || '').slice(0, 10); return signed > start ? signed : start; }
  const months = MONTHS_AFTER[p.trigger];
  return months ? plusMonths(start, months) || null : null;
}

/** A perk in the lease's words: "a credit of one week's rent when the lease starts". */
export function perkWords(p: PerkLike, frequency: string, usd: (c: number) => string): string {
  const what = p.type === 'free_week' ? 'a credit of one week’s rent'
    : p.type === 'rent_discount' ? `a credit of ${n(p.valuePercent)}% of one ${PERIOD[frequency] || 'month'}’s rent`
    : `a ${usd(Math.max(0, Math.round(n(p.valueCents))))} credit`;
  const when = p.trigger === 'on_signup' ? 'when the lease starts, or when it’s signed if that’s later' : MONTHS_AFTER[p.trigger] ? `after ${MONTHS_AFTER[p.trigger]} months` : '';
  const label = String(p.label || '').trim();
  return `${label ? `${label}: ` : ''}${what}${when ? ` ${when}` : ''}`;
}

/** Can the nightly step give this perk? Only on a builder lease, only kinds it knows, not yet given. */
export function perkGivable(p: PerkLike): boolean {
  return !p.appliedAt && !!p.id && ['free_week', 'rent_discount', 'custom'].includes(String(p.type)) && (p.trigger === 'on_signup' || !!MONTHS_AFTER[p.trigger]);
}

/** Give every perk that's due on one business's builder leases. Returns how many were given. */
export async function grantLeasePerks(db: any, tenantId: string, todayIso: string, nowIso: string = new Date().toISOString()): Promise<{ given: number; cents: number }> {
  const T = `tenants/${tenantId}`;
  const snap = await db.collection(`${T}/leases`).where('leaseFrom', '==', 'builder').get();
  let given = 0, cents = 0;
  for (const d of snap.docs) {
    const l: any = d.data() || {};
    if (!['active', 'on_leave'].includes(String(l.status))) continue;
    const due = (Array.isArray(l.perks) ? l.perks : []).filter((p: PerkLike) => perkGivable(p) && (perkDueOn(p, l) || '9999') <= todayIso);
    for (const p0 of due) {
      try {
        const r: any = await db.runTransaction(async (tx: any) => {
          const ref = db.doc(`${T}/leases/${d.id}`);
          const cur = await tx.get(ref);
          const lease: any = cur.data() || {};
          const perks: PerkLike[] = Array.isArray(lease.perks) ? lease.perks : [];
          const i = perks.findIndex((x) => x.id === p0.id);
          if (i < 0 || !perkGivable(perks[i]) || !['active', 'on_leave'].includes(String(lease.status))) return null;
          const lineId = `perk_${d.id}_${String(perks[i].id).replace(/[^A-Za-z0-9_-]/g, '')}`;
          const lineRef = db.doc(`${T}/rentLedger/${lineId}`);
          const line = await tx.get(lineRef);
          const credit = perkCreditCents(perks[i], n(lease.rentAmountCents), String(lease.frequency || 'monthly'));
          const today = todayIso.slice(0, 10);
          if (!line.exists && credit > 0) {
            tx.set(lineRef, {
              leaseId: d.id, renterId: lease.renterId || null, boothId: lease.boothId || null, locationId: lease.locationId || null,
              type: 'perk_credit', status: 'paid', amountCents: -credit, description: `Lease perk: ${String(perks[i].label || 'perk').slice(0, 80)}`,
              note: '', dueDate: null, paidAt: today, method: 'perk', perkId: perks[i].id, appliesToEntryIds: [], stripePaymentIntentId: null,
              createdBy: 'system', createdAt: nowIso, updatedAt: nowIso,
            });
          }
          const next = perks.map((x, k) => (k === i ? { ...x, appliedAt: today, ledgerEntryId: credit > 0 ? lineId : null } : x));
          tx.update(ref, { perks: next, updatedAt: nowIso });
          return { credit: line.exists ? 0 : credit };
        });
        if (r) { given += 1; cents += r.credit; }
      } catch (e) { console.error('[lease-perks] grant', tenantId, d.id, e); }
    }
  }
  return { given, cents };
}
