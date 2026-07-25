// src/lib/booth-recognition.ts
//
// Single source of truth for WHO a booking contact is. Both public booking
// paths import from here so a person is recognized the same way everywhere:
//
//   • /api/booths/kiosk    — action:'recognize'  (booking form "welcome back")
//   • /api/booths/reserve  — POST                (pricing + paperwork rules)
//
// Matching is by normalized phone digits or lowercased email against the
// renters collection (resident recognition) and past paid reservations
// (recurring-guest tiers). Server-side ONLY — this reads across renters and
// reservations, so it must never run with client credentials.
//
// Tiers (computed, never stored — always current):
//   resident  — an active/on-leave renter (has or had a lease relationship)
//   regular   — 4+ paid bookings in the last 90 days
//   returning — 2+ paid bookings ever
//   new       — first time
//
// The renter day-booking discount is OWNER-CONFIGURED (0 = off) at
// tenants/{tid}.bookingPageSettings.renterDayDiscountPercent. Recognition
// never invents a price break the owner didn't set.

export type GuestTier = 'resident' | 'regular' | 'returning' | 'new';

export interface RecognitionResult {
  renterId: string | null;
  renterFirstName: string | null;
  renterStatus: string | null;          // 'active' | 'prospective' | ...
  isResident: boolean;                  // active or on-leave renter
  hasSignedLease: boolean;              // a lease doc with signedAt / signedDocumentUrl
  tier: GuestTier;
  paidVisitsTotal: number;
  paidVisits90d: number;
  discountPercent: number;              // 0 when owner hasn't configured one
}

const digits = (s: any) => String(s || '').replace(/\D/g, '');
const emailKey = (s: any) => String(s || '').trim().toLowerCase();

// Tier thresholds — deliberately simple and explainable to an owner.
export const REGULAR_MIN_VISITS_90D = 4;
export const RETURNING_MIN_VISITS = 2;

export function resolveRenterDayDiscount(tenantData: any): number {
  const pct = Number(tenantData?.bookingPageSettings?.renterDayDiscountPercent);
  return Number.isFinite(pct) && pct > 0 && pct < 100 ? Math.round(pct) : 0;
}

// Count paid/served reservations for a contact. 'confirmed', 'checked_in',
// and 'completed' all represent real revenue visits.
const PAID_STATUSES = ['confirmed', 'checked_in', 'completed'];

export async function recognizeContact(
  db: any, // FirebaseFirestore.Firestore (admin) — typed loose to keep this lib import-light
  tenantId: string,
  phone: string | null | undefined,
  email: string | null | undefined,
): Promise<RecognitionResult> {
  const phoneKey = digits(phone);
  const mailKey = emailKey(email);
  const out: RecognitionResult = {
    renterId: null, renterFirstName: null, renterStatus: null,
    isResident: false, hasSignedLease: false,
    tier: 'new', paidVisitsTotal: 0, paidVisits90d: 0,
    discountPercent: 0,
  };
  if (!phoneKey && !mailKey) return out;

  // ── Resident match: renters collection ─────────────────────────────
  try {
    const snap = await db.collection(`tenants/${tenantId}/renters`).get();
    for (const d of snap.docs) {
      const r = d.data() as any;
      const match =
        (phoneKey && digits(r.phone) && digits(r.phone) === phoneKey) ||
        (mailKey && emailKey(r.email) && emailKey(r.email) === mailKey);
      if (!match) continue;
      out.renterId = d.id;
      out.renterFirstName = r.firstName || null;
      out.renterStatus = r.status || null;
      out.isResident = ['active', 'on_leave'].includes(String(r.status || ''));
      // Prefer an ACTIVE renter if multiple contacts share a phone/email.
      if (out.isResident) break;
    }
  } catch { /* recognition is additive — never block a booking over it */ }

  // ── Signed lease on file? (waives the day-use re-sign) ─────────────
  if (out.renterId) {
    try {
      const leases = await db.collection(`tenants/${tenantId}/leases`)
        .where('renterId', '==', out.renterId).get();
      out.hasSignedLease = leases.docs.some((d: any) => {
        const l = d.data() as any;
        return ['active', 'on_leave', 'ending_soon'].includes(String(l.status || ''))
          && (l.signedAt || l.signedDocumentUrl);
      });
    } catch { /* fall through — they just re-sign, which is safe */ }
  }

  // ── Visit history: paid reservations by contact ────────────────────
  try {
    const snap = await db.collection(`tenants/${tenantId}/boothReservations`).get();
    const cutoff90 = Date.now() - 90 * 24 * 60 * 60 * 1000;
    for (const d of snap.docs) {
      const r = d.data() as any;
      if (!PAID_STATUSES.includes(String(r.status || ''))) continue;
      const match =
        (phoneKey && digits(r.phone) === phoneKey) ||
        (mailKey && emailKey(r.email) && emailKey(r.email) === mailKey);
      if (!match) continue;
      out.paidVisitsTotal += 1;
      const t = new Date(r.createdAt || r.startDate || 0).getTime();
      if (t >= cutoff90) out.paidVisits90d += 1;
    }
  } catch { /* additive */ }

  out.tier = out.isResident ? 'resident'
    : out.paidVisits90d >= REGULAR_MIN_VISITS_90D ? 'regular'
    : out.paidVisitsTotal >= RETURNING_MIN_VISITS ? 'returning'
    : 'new';
  return out;
}
