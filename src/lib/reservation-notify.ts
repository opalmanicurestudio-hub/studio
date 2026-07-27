// src/lib/reservation-notify.ts
//
// v18 — RESERVATION CONFIRMATIONS, appointment-standard. One helper both
// confirm paths (day-pass redemption and paid Stripe checkout) call the
// moment a booth reservation becomes real:
//   • Branded email — space, dates/times, what was paid, any balance due,
//     a "Manage reservation" button (tokened link) and "Add to calendar".
//   • Text — same manage link.
// Both flow through the notification core, so they land in messageLog
// tagged to the guest's contact record with full delivery tracking.

import { sendNotification } from './notify';
import { brandedEmailHtml } from './email-template';

// Same key/id derivation the booth CRM uses (booth-contacts.ts) —
// duplicated here because that module imports the CLIENT SDK and this
// runs on the server. Keep the two in sync.
const contactKeyOf = (phone?: any, email?: any): string => {
  const norm = (v: any) => String(v ?? '').trim().toLowerCase();
  return norm(phone) || norm(email);
};
const contactDocIdOf = (key: string): string =>
  String(key || '').replace(/[^a-z0-9@._-]/gi, '_').slice(0, 200) || 'unknown';

const t12 = (t?: string | null) => {
  if (!t || !/^\d{2}:\d{2}$/.test(t)) return t || '';
  const [h, m] = t.split(':').map(Number);
  const ap = h >= 12 ? 'PM' : 'AM';
  const hr = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${hr} ${ap}` : `${hr}:${String(m).padStart(2, '0')} ${ap}`;
};

const prettyDate = (iso?: string | null) => {
  if (!iso) return '';
  try {
    return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC',
    });
  } catch { return iso; }
};

export function reservationWhenLabel(r: any): string {
  if (r.bookingType === 'hourly' && r.startTime && r.endTime) {
    return `${prettyDate(r.startDate)} · ${t12(r.startTime)}–${t12(r.endTime)}`;
  }
  if (r.startDate === r.endDate) return prettyDate(r.startDate);
  return `${prettyDate(r.startDate)} → ${prettyDate(r.endDate)}${r.numDays ? ` (${r.numDays} days)` : ''}`;
}

// Mint (or reuse) the reservation's manage token — the key inside the
// guest's own links, scoped to this one reservation.
export async function ensureReservationToken(db: any, tenantId: string, resId: string): Promise<string | null> {
  try {
    const ref = db.doc(`tenants/${tenantId}/boothReservations/${resId}`);
    const snap = await ref.get();
    if (!snap.exists) return null;
    const cur = (snap.data() as any)?.manageToken;
    if (cur && String(cur).length >= 16) return cur;
    const token = Array.from({ length: 2 }, () => Math.random().toString(36).slice(2, 10)).join('') + Date.now().toString(36);
    await ref.set({ manageToken: token }, { merge: true });
    return token;
  } catch { return null; }
}

export async function sendReservationConfirmation(
  db: any, tenantId: string, reservationId: string, r: any,
  opts?: { originFallback?: string },
): Promise<void> {
  try {
    // Idempotence: the Stripe success page can be refreshed — only the
    // FIRST confirmation call sends. The stamp is written before sending
    // so even a concurrent double-call can't double-message the guest.
    const resRef = db.doc(`tenants/${tenantId}/boothReservations/${reservationId}`);
    const fresh = ((await resRef.get()).data() as any) || {};
    if (fresh.confirmationSentAt) return;
    await resRef.set({ confirmationSentAt: new Date().toISOString() }, { merge: true });

    const tData = ((await db.doc(`tenants/${tenantId}`).get()).data() as any) || {};
    const studioName = tData.name || tData.businessName || 'The studio';
    const base = String(
      tData.publicOrigin
      || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '')
      || opts?.originFallback || '',
    ).replace(/\/$/, '');

    const k = await ensureReservationToken(db, tenantId, reservationId);
    const manageUrl = (base && k) ? `${base}/reservation/${tenantId}/${reservationId}?k=${k}` : null;
    const calendarUrl = (base && k)
      ? `${base}/api/reservation?tenantId=${encodeURIComponent(tenantId)}&resId=${encodeURIComponent(reservationId)}&k=${encodeURIComponent(k)}`
      : null;

    const whenStr = reservationWhenLabel(r);
    const firstName = String(r.name || '').split(' ')[0] || 'there';
    const paidCents = Number(r.amountCents) || 0;
    const balanceCents = (!r.balancePaid && Number(r.balanceDueCents) > 0) ? Number(r.balanceDueCents) : 0;
    const balanceLine = balanceCents > 0
      ? `Balance of $${(balanceCents / 100).toFixed(2)} is due ${r.balanceMode === 'at_checkin' ? 'at check-in' : 'in person'}.`
      : '';
    const paidLine = r.paidWithPassId
      ? `Paid with your day pass${r.passDaysUsed ? ` (${r.passDaysUsed} day${r.passDaysUsed === 1 ? '' : 's'} used)` : ''}.`
      : (paidCents > 0 ? `Paid today: $${(paidCents / 100).toFixed(2)}.` : '');

    const email = String(r.email || '').trim();
    const phone = String(r.phone || '').trim();
    const who = {
      recipientType: 'contact' as const,
      recipientId: contactDocIdOf(contactKeyOf(r.phone, r.email)),
      recipientName: r.name || null,
    };

    if (email.includes('@')) {
      const html = brandedEmailHtml({
        studioName,
        title: "You're booked",
        bodyLines: [
          `Hi ${firstName} — ${r.boothName || 'your space'} is yours for ${whenStr}.`,
          [paidLine, balanceLine].filter(Boolean).join(' '),
          'We\'ll see you then — the buttons below have everything you need.',
        ].filter(Boolean),
        cta: manageUrl ? { label: 'Manage reservation', url: manageUrl } : null,
        secondaryCta: calendarUrl ? { label: 'Add to calendar', url: calendarUrl } : null,
        footerNote: `Plans changed? Use the Manage button any time to request a change. Sent by ${studioName}.`,
      });
      await sendNotification(db, {
        tenantId, channel: 'email', to: email,
        subject: `Booked: ${r.boothName || 'your space'} — ${whenStr}`,
        html, kind: 'reservation_confirmation',
        ...who,
      });
    }

    if (phone) {
      await sendNotification(db, {
        tenantId, channel: 'sms', to: phone,
        text: `You're booked — ${r.boothName || 'your space'}, ${whenStr}.${balanceLine ? ` ${balanceLine}` : ''}${manageUrl ? ` Manage: ${manageUrl}` : ''}`,
        kind: 'reservation_confirmation',
        ...who,
      });
    }
  } catch (err) {
    // Confirmation is best-effort — the reservation itself is already safe.
    console.error('[reservation-notify] send failed (reservation is safe)', err);
  }
}
