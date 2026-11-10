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

// "1pm", "9:30am": the app's way of saying a time.
const t12 = (t?: string | null) => {
  if (!t || !/^\d{2}:\d{2}$/.test(t)) return t || '';
  const [h, m] = t.split(':').map(Number);
  const ap = h >= 12 ? 'pm' : 'am';
  const hr = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${hr}${ap}` : `${hr}:${String(m).padStart(2, '0')}${ap}`;
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
    return `${prettyDate(r.startDate)}, ${t12(r.startTime)} to ${t12(r.endTime)}`;
  }
  if (r.startDate === r.endDate) return prettyDate(r.startDate);
  return `${prettyDate(r.startDate)} to ${prettyDate(r.endDate)}${r.numDays ? ` (${r.numDays} days)` : ''}`;
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
    const studioName = tData.name || tData.businessName || 'The business';
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
      ? `A balance of $${(balanceCents / 100).toFixed(2)} is due ${r.balanceMode === 'at_checkin' ? 'at check-in' : 'in person'}.`
      : '';
    const paidLine = r.paidWithPassId
      ? `This reservation was paid with your day pass${r.passDaysUsed ? ` (${r.passDaysUsed} day${r.passDaysUsed === 1 ? '' : 's'} used)` : ''}.`
      : (paidCents > 0 ? `We have received your payment of $${(paidCents / 100).toFixed(2)}.` : '');

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
        title: 'Your reservation is confirmed',
        bodyLines: [
          `Hi ${firstName},`,
          `Thank you for your reservation. ${r.boothName || 'Your space'} is reserved for you on ${whenStr}.`,
          [paidLine, balanceLine].filter(Boolean).join(' '),
          'You can use the buttons below to manage your reservation or add it to your calendar. We look forward to seeing you.',
          `Kind regards, ${studioName}`,
        ].filter(Boolean),
        cta: manageUrl ? { label: 'Manage my reservation', url: manageUrl } : null,
        secondaryCta: calendarUrl ? { label: 'Add to calendar', url: calendarUrl } : null,
        footerNote: `If your plans change, you can use the Manage button at any time to request a change. Sent by ${studioName}.`,
      });
      await sendNotification(db, {
        tenantId, channel: 'email', to: email,
        subject: `Your reservation is confirmed: ${r.boothName || 'your space'} on ${whenStr}`,
        html, kind: 'reservation_confirmation',
        ...who,
      });
    }

    if (phone) {
      await sendNotification(db, {
        tenantId, channel: 'sms', to: phone,
        text: `Hi ${firstName}, your reservation for ${r.boothName || 'your space'} on ${whenStr} is confirmed.${balanceLine ? ` ${balanceLine}` : ''}${manageUrl ? ` You can manage your reservation here: ${manageUrl}` : ''}`,
        kind: 'reservation_confirmation',
        ...who,
      });
    }
  } catch (err) {
    // Confirmation is best-effort — the reservation itself is already safe.
    console.error('[reservation-notify] send failed (reservation is safe)', err);
  }
}

/** What a guest is told when money moves on their booking after they booked: a charge to their saved card (extra time,
 *  a charge, the balance), a refund, or their prepaid days given back. Their receipt, with a link to the booking, where
 *  every charge and what they've paid is listed. Once per thing that happened (its key), however often it's asked: the
 *  booking keeps the keys it has sent. By email; by text when there's no email. Best-effort: the money is already
 *  recorded, so a message that can't go out never undoes it. */
export async function sendStayMoneyNotice(
  db: any, tenantId: string, reservationId: string,
  n: { kind: 'charge' | 'refund' | 'days_back'; cents: number; what: string; key: string; days?: number },
): Promise<void> {
  try {
    const resRef = db.doc(`tenants/${tenantId}/boothReservations/${reservationId}`);
    const key = String(n.key || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 120);
    if (!key) return;
    const r: any = await db.runTransaction(async (tx: any) => {
      const cur: any = (await tx.get(resRef)).data() || null;
      if (!cur) return null;
      const sent: string[] = Array.isArray(cur.moneyNoticeKeys) ? cur.moneyNoticeKeys.map(String) : [];
      if (sent.includes(key)) return null;
      tx.set(resRef, { moneyNoticeKeys: [...sent, key].slice(-50) }, { merge: true });
      return cur;
    });
    if (!r) return;
    const email = String(r.email || '').trim();
    const phone = String(r.phone || '').trim();
    if (!email.includes('@') && !phone) return;

    const tData = ((await db.doc(`tenants/${tenantId}`).get()).data() as any) || {};
    const bizName = tData.name || tData.businessName || 'The business';
    const base = String(tData.publicOrigin || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '')).replace(/\/$/, '');
    const k = await ensureReservationToken(db, tenantId, reservationId);
    const bookingUrl = (base && k) ? `${base}/reservation/${tenantId}/${reservationId}?k=${k}` : null;
    const money = `$${(Math.max(0, n.cents) / 100).toFixed(2)}`;
    const space = r.boothName || 'your space';
    const whenStr = reservationWhenLabel(r);
    const firstName = String(r.name || '').split(' ')[0] || 'there';
    const days = Math.max(0, Math.round(Number(n.days) || 0));
    const what = String(n.what || '').trim();

    const head = n.kind === 'charge' ? `A charge of ${money} for your booking`
      : n.kind === 'refund' ? `Your refund of ${money}`
      : 'Your booking is cancelled';
    const line = n.kind === 'charge'
      ? `We charged ${money} to the card you booked with, for ${what ? what.charAt(0).toLowerCase() + what.slice(1) : 'your booking'}. This is for ${space} on ${whenStr}.`
      : n.kind === 'refund'
        ? `We refunded ${money} to the card you booked with${what ? `, for this reason: ${what}` : ''}. This is for ${space} on ${whenStr}. A refund usually shows on your statement within 5 to 10 business days.`
        : `Your booking for ${space} on ${whenStr} is cancelled${days > 0 ? `, and ${days} prepaid day${days === 1 ? ' is' : 's are'} back on your pack to use another time` : ''}.`;
    const who = { recipientType: 'contact' as const, recipientId: contactDocIdOf(contactKeyOf(r.phone, r.email)), recipientName: r.name || null };

    if (email.includes('@')) {
      const html = brandedEmailHtml({
        studioName: bizName,
        title: head,
        bodyLines: [
          `Hi ${firstName},`,
          line,
          bookingUrl ? 'Your booking lists every charge and everything you’ve paid.' : '',
          'If you have a question about it, reply to this email.',
          `Kind regards, ${bizName}`,
        ].filter(Boolean),
        cta: bookingUrl ? { label: 'See my booking', url: bookingUrl } : null,
        footerNote: `Sent by ${bizName} about your booking.`,
      });
      await sendNotification(db, { tenantId, channel: 'email', to: email, subject: head, html, kind: 'reservation_money', ...who });
    } else {
      await sendNotification(db, { tenantId, channel: 'sms', to: phone, text: `Hi ${firstName}, ${line}${bookingUrl ? ` Your booking: ${bookingUrl}` : ''}`, kind: 'reservation_money', ...who });
    }
  } catch (err) {
    console.error('[reservation-notify] money notice failed (the money is already recorded)', err);
  }
}
