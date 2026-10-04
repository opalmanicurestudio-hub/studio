// src/lib/charge-records.ts — A RECORD FOR EVERY CHARGE the app makes on its own or at the desk beyond the ticket:
// what, why, how much, who approved it, the receipt / payment, and the consent it rests on (kind, version, when).
// Shown to the owner on the client's account and used in any dispute.
import { latestConsent, type ConsentKind } from '@/lib/consent';
export type ChargeKind = 'no_show_fee' | 'late_cancel_fee' | 'fees_card_on_file' | 'fees_pay_link' | 'extra_time' | 'extra_product' | 'overstay' | 'deposit_kept' | 'other';
export async function recordCharge(db: any, tenantId: string, x: { kind: ChargeKind; clientId: string; cents: number; reason: string; appointmentId?: string | null; receiptId?: string | null; paymentIntentId?: string | null; approvedBy?: string | null; by?: string | null; needs?: ConsentKind[] }) {
  if (!x.clientId || !(x.cents > 0)) return null;
  const T = `tenants/${tenantId}`; const now = new Date().toISOString(); const ref = db.collection(`${T}/chargeRecords`).doc();
  const needs = x.needs || ['booking_policies']; const consents: any[] = []; const missing: ConsentKind[] = [];
  for (const k of needs) { const c = await latestConsent(db, tenantId, x.clientId, k); if (c) consents.push(c); else missing.push(k); }
  await ref.set({ id: ref.id, kind: x.kind, clientId: x.clientId, cents: Math.round(x.cents), reason: x.reason.slice(0, 300), appointmentId: x.appointmentId || null, receiptId: x.receiptId || null, paymentIntentId: x.paymentIntentId || null,
    approvedBy: x.approvedBy || null, by: x.by || 'system', consents, missingConsent: missing, at: now });
  return { id: ref.id, consents, missing };
}
