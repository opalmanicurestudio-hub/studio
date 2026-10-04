// src/lib/consent.ts — CONSENT RECORDS: what a client agreed to, in the exact words, when, and how. Every charge the app
// makes on its own (fees, extra time, card on file, overstays) points at the record it rests on, so any charge can be
// explained and defended: "You agreed to this wording on 12 Sep when you booked online."
//   kinds: booking_policies (cancellation, no-show, deposit, extra time) · card_on_file (we may charge your saved card
//          for fees you owe) · rental_agreement (day-use terms) · extra_time (the running-over note)
export type ConsentKind = 'booking_policies' | 'card_on_file' | 'rental_agreement' | 'extra_time';
/** A short stable version for a block of policy text (changes whenever the wording changes). */
export function policyVersion(text: string): string { let h = 5381; for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0; return `v${(h >>> 0).toString(36)}`; }
export async function recordConsent(db: any, tenantId: string, x: { clientId: string; kind: ConsentKind; text: string; via: string; ref?: string | null; name?: string | null }) {
  const T = `tenants/${tenantId}`; const now = new Date().toISOString(); const version = policyVersion(x.text); const id = `${x.clientId}_${x.kind}_${version}`;
  const ref = db.doc(`${T}/consents/${id}`); const existing: any = (await ref.get()).data();
  await ref.set({ id, clientId: x.clientId, kind: x.kind, version, text: x.text.slice(0, 4000), via: x.via.slice(0, 40), ref: x.ref || null, name: x.name || null, firstAt: existing?.firstAt || now, lastAt: now, times: (existing?.times || 0) + 1 }, { merge: true });
  await db.doc(`${T}/clients/${x.clientId}`).set({ consents: { [x.kind]: { version, at: now, via: x.via.slice(0, 40) } } }, { merge: true });
  return { id, version, at: now };
}
export async function latestConsent(db: any, tenantId: string, clientId: string, kind: ConsentKind) {
  const c: any = (await db.doc(`tenants/${tenantId}/clients/${clientId}`).get()).data(); const s = c?.consents?.[kind]; return s ? { kind, version: String(s.version), at: String(s.at), via: String(s.via || '') } : null;
}
/** The card-on-file wording a client accepts when a card is saved (one place, so the record and the screen agree). */
export function cardOnFileWording(businessName: string) { return `I agree that ${businessName} may keep this card on file and charge it for fees I owe under the policies I agreed to when booking (no-shows, late cancellations, extra time I ask for, and any balance I leave unpaid). I'll be sent a receipt for every charge.`; }
