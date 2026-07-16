/**
 * conciergeMessenger.ts — C1 (the concierge messaging engine)
 *
 * The front desk that never sleeps: watches booth-reservation state
 * transitions and texts guests at the moments that matter. Rides the
 * same event stream the Live Floor visualizes.
 *
 * Messages sent (each exactly once, tracked via sentMessages on the doc):
 *   1. CONFIRMED  → booking confirmation with details + kiosk heads-up
 *   2. CHECKED IN → welcome text with the until-time
 *   3. CREDIT ISSUED → "you have $X credit — auto-applies next booking"
 *   4. OVERAGE CHARGED → courtesy receipt note for the card charge
 *
 * SMS goes through Twilio's REST API directly (no SDK dependency),
 * using the secrets already provisioned in this functions project:
 *   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER
 *
 * Deploy:
 *   1. Save as functions/src/conciergeMessenger.ts
 *   2. index.ts: export { conciergeMessenger } from './conciergeMessenger';
 *   3. firebase deploy --only functions:conciergeMessenger
 *
 * Fail-open design: any Twilio problem logs and moves on — messaging
 * must never break bookings. If a studio hasn't configured Twilio,
 * the function no-ops silently.
 */

import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { defineSecret } from 'firebase-functions/params';
import { getFirestore } from 'firebase-admin/firestore';
import { initializeApp, getApps } from 'firebase-admin/app';

if (getApps().length === 0) initializeApp();

const t12 = (t?: string | null): string => {
  if (!t || !/^\d{2}:\d{2}$/.test(t)) return t || '';
  const [h, m] = t.split(':').map(Number);
  const ap = h >= 12 ? 'PM' : 'AM';
  const hr = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${hr} ${ap}` : `${hr}:${String(m).padStart(2, '0')} ${ap}`;
};


const TWILIO_SID   = defineSecret('TWILIO_ACCOUNT_SID');
const TWILIO_TOKEN = defineSecret('TWILIO_AUTH_TOKEN');
const TWILIO_FROM  = defineSecret('TWILIO_PHONE_NUMBER');

function normalizePhone(raw: any): string | null {
  const d = String(raw || '').replace(/\D/g, '');
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith('1')) return `+${d}`;
  if (String(raw || '').startsWith('+') && d.length >= 10) return `+${d}`;
  return null;
}

async function sendSms(to: string, body: string): Promise<boolean> {
  try {
    const sid = TWILIO_SID.value();
    const token = TWILIO_TOKEN.value();
    const from = TWILIO_FROM.value();
    if (!sid || !token || !from) return false;
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: to, From: from, Body: body }).toString(),
    });
    if (!res.ok) {
      console.warn('[conciergeMessenger] Twilio rejected', res.status, await res.text().catch(() => ''));
      return false;
    }
    return true;
  } catch (err) {
    console.warn('[conciergeMessenger] SMS failed', err);
    return false;
  }
}

export const conciergeMessenger = onDocumentWritten(
  {
    document: 'tenants/{tenantId}/boothReservations/{resId}',
    region: 'us-central1',
    secrets: [TWILIO_SID, TWILIO_TOKEN, TWILIO_FROM],
  },
  async (event) => {
    const after = event.data?.after?.data();
    if (!after) return;                     // deletion — nothing to say
    const before = event.data?.before?.data() || {};

    const phone = normalizePhone(after.phone);
    if (!phone) return;                     // no phone, no SMS — fine

    const sent: Record<string, string> = (after.sentMessages as any) || {};
    const queue: { key: string; body: string }[] = [];
    const first = String(after.name || 'there').split(' ')[0];
    const space = after.boothName || 'your space';
    const isHourly = after.bookingType === 'hourly' && after.startTime && after.endTime;
    const when = isHourly
      ? `${after.startDate}, ${t12(after.startTime)}–${t12(after.endTime)}`
      : after.startDate === after.endDate ? after.startDate : `${after.startDate} → ${after.endDate}`;

    // 1. Booking confirmed (pending → confirmed) — with the stay link:
    // details, house rules acknowledgment, add-to-calendar. Set APP_URL
    // once: firebase functions:secrets:set APP_URL  (or env config) —
    // e.g. https://studio-one-blue.vercel.app
    if (after.status === 'confirmed' && before.status !== 'confirmed' && !sent.confirmed) {
      const appUrl = (process.env.APP_URL || '').replace(/\/$/, '');
      const link = appUrl ? ` Your booking page: ${appUrl}/stay/${event.params.tenantId}/${event.params.resId}` : '';
      queue.push({
        key: 'confirmed',
        body: `You're booked! ${space} · ${when}.${link} When you arrive, check in at the front tablet with the last 4 digits of this number. ✨`,
      });
    }

    // 2. Checked in (→ checked_in)
    if (after.status === 'checked_in' && before.status !== 'checked_in' && !sent.checked_in) {
      queue.push({
        key: 'checked_in',
        body: isHourly
          ? `Welcome, ${first}! ${space} is yours until ${t12(after.endTime)}. Need anything? The concierge kiosk can bring it to your station. ☕`
          : `Welcome, ${first}! ${space} is all yours today. Need anything? The concierge kiosk can bring it to your station. ☕`,
      });
    }

    // 3. Credit issued (owner tapped Issue Credit)
    if (after.creditDecision === 'issued' && before.creditDecision !== 'issued' && after.creditIssuedCents > 0 && !sent.credit) {
      queue.push({
        key: 'credit',
        body: `Good news, ${first} — a $${(after.creditIssuedCents / 100).toFixed(2)} credit for your unused time is on your account. It applies automatically the next time you book. 💚`,
      });
    }

    // 3.5 How was your stay? (→ completed, with the review link)
    if (after.status === 'completed' && before.status !== 'completed' && !sent.review) {
      const appUrl = (process.env.APP_URL || '').replace(/\/$/, '');
      if (appUrl) {
        queue.push({
          key: 'review',
          body: `Thanks for visiting, ${first}! How was your stay at ${space}? Two taps: ${appUrl}/stay/${event.params.tenantId}/${event.params.resId} 💚`,
        });
      }
    }

    // 4. Overage charged to card
    if (after.overageStatus === 'charged' && before.overageStatus !== 'charged' && after.overageDueCents > 0 && !sent.overage) {
      queue.push({
        key: 'overage',
        body: `Hi ${first} — your stay at ${space} ran ${after.overageMinutes} min past the booked time, so $${(after.overageDueCents / 100).toFixed(2)} was charged to your card on file. Questions? Just reply or ask at the desk.`,
      });
    }

    if (queue.length === 0) return;

    const db = getFirestore();
    const nowIso = new Date().toISOString();
    const updates: Record<string, string> = {};
    for (const msg of queue) {
      const ok = await sendSms(phone, msg.body);
      if (ok) updates[`sentMessages.${msg.key}`] = nowIso;
    }
    if (Object.keys(updates).length > 0) {
      await db
        .doc(`tenants/${event.params.tenantId}/boothReservations/${event.params.resId}`)
        .update(updates)
        .catch((err) => console.warn('[conciergeMessenger] stamp failed', err));
    }
  }
);


// ── Tour messaging: confirmation + reminders on the tours collection. ─────────
export const tourMessenger = onDocumentWritten(
  {
    document: 'tenants/{tenantId}/tours/{tourId}',
    region: 'us-central1',
    secrets: [TWILIO_SID, TWILIO_TOKEN, TWILIO_FROM],
  },
  async (event) => {
    const after = event.data?.after?.data();
    if (!after) return;
    const before = event.data?.before?.data() || {};
    const phone = normalizePhone(after.phone);
    if (!phone) return;
    const sent: Record<string, string> = (after.sentMessages as any) || {};
    const first = String(after.name || 'there').split(' ')[0];
    const when = `${after.date} at ${t12(after.time)}`;

    let body = '';
    let key = '';
    if (after.status === 'confirmed' && before.status !== 'confirmed' && !sent.confirmed) {
      key = 'confirmed';
      body = `Hi ${first}! Your tour is confirmed for ${when}. We look forward to showing you around. Reply here if anything changes. ✨`;
    } else if (after.status === 'requested' && !before.status && !sent.requested) {
      key = 'requested';
      body = `Hi ${first}! We got your tour request for ${when} and will confirm shortly. ✨`;
    }
    if (!key) return;

    const db = getFirestore();
    const sid = TWILIO_SID.value(), token = TWILIO_TOKEN.value(), from = TWILIO_FROM.value();
    if (!sid || !token || !from) return;
    try {
      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
        method: 'POST',
        headers: { 'Authorization': 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ To: phone, From: from, Body: body }).toString(),
      });
      if (res.ok) {
        await db.doc(`tenants/${event.params.tenantId}/tours/${event.params.tourId}`)
          .update({ [`sentMessages.${key}`]: new Date().toISOString() }).catch(() => {});
      }
    } catch (err) { console.warn('[tourMessenger] failed', err); }
  }
);
