// src/lib/booth-texts.ts — TEXTS FOR BOOTH GUESTS (day / hourly reservations). Moved into the app from a background
// function that was never deployed (conciergeMessenger), so these were never sent:
//   booked · welcome at check-in · credit issued for unused time · overage charged (a courtesy receipt)
// The 5-minute job looks for reservations whose moment happened in the last 2 hours (each moment has its own
// timestamp) and sends each text once — marked in `sentMessages`. Older reservations are never texted out of the
// blue, and a moment without a timestamp is skipped. Sent through the app's own sender (logs, quiet hours, provider).
// One switch in Automations ("Texts for booth guests"); only for businesses with booth rental.
import { automationOn } from '@/lib/automation-switches';

const WINDOW_MS = 2 * 3600000;
const t12 = (t?: string | null) => { if (!t || !/^\d{2}:\d{2}$/.test(t)) return t || ''; const [h, m] = t.split(':').map(Number); const ap = h >= 12 ? 'PM' : 'AM'; const hr = h % 12 || 12; return m ? `${hr}:${String(m).padStart(2, '0')} ${ap}` : `${hr} ${ap}`; };
const day = (d?: string) => { const m = String(d || '').match(/^(\d{4})-(\d{2})-(\d{2})$/); if (!m) return d || ''; return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }); };
const money = (c: number) => `$${(Number(c || 0) / 100).toFixed(2)}`;

export function boothTextsFor(r: any, studio: string, now: number): { key: string; text: string }[] {
  const sent = r.sentMessages || {}; const recent = (iso?: string) => { const t = Date.parse(iso || ''); return Number.isFinite(t) && now - t <= WINDOW_MS && t <= now + 60000; };
  const first = String(r.name || 'there').split(' ')[0]; const space = r.boothName || 'your space';
  const hourly = r.bookingType === 'hourly' && r.startTime && r.endTime;
  const when = hourly ? `${day(r.startDate)}, ${t12(r.startTime)}–${t12(r.endTime)}` : r.startDate === r.endDate || !r.endDate ? day(r.startDate) : `${day(r.startDate)} – ${day(r.endDate)}`;
  const out: { key: string; text: string }[] = [];
  if (r.status === 'confirmed' && recent(r.confirmedAt) && !sent.confirmed)
    out.push({ key: 'confirmed', text: `${studio}: you're booked — ${space}, ${when}. When you arrive, check in at the front tablet with the last 4 digits of this number.` });
  if (['checked_in', 'completed'].includes(r.status) && recent(r.checked_inAt || r.actualCheckIn) && !sent.checked_in)
    out.push({ key: 'checked_in', text: hourly ? `Welcome, ${first}! ${space} is yours until ${t12(r.endTime)}. — ${studio}` : `Welcome, ${first}! ${space} is all yours today. — ${studio}` });
  if (r.creditDecision === 'issued' && Number(r.creditIssuedCents) > 0 && recent(r.creditIssuedAt) && !sent.credit)
    out.push({ key: 'credit', text: `Good news, ${first} — a ${money(r.creditIssuedCents)} credit for your unused time is on your account. It applies automatically next time you book. — ${studio}` });
  if (r.overageStatus === 'charged' && Number(r.overageDueCents) > 0 && recent(r.overageChargedAt) && !sent.overage)
    out.push({ key: 'overage', text: `Hi ${first} — your stay at ${space} ran ${r.overageMinutes || 'some'} min past the booked time, so ${money(r.overageDueCents)} was charged to your card on file. Questions? Just reply. — ${studio}` });
  return out;
}

export async function sendBoothGuestTexts(db: any, tenantId: string, tenant: any, now = Date.now()) {
  if (!automationOn(tenant, 'booth-guest-texts')) return 0;
  const T = `tenants/${tenantId}`; const since = new Date(now - WINDOW_MS).toISOString();
  const seen = new Map<string, any>();
  for (const f of ['confirmedAt', 'checked_inAt', 'creditIssuedAt', 'overageChargedAt']) {
    const snap = await db.collection(`${T}/boothReservations`).where(f, '>=', since).limit(100).get().catch(() => ({ docs: [] as any[] }));
    for (const d of snap.docs) seen.set(d.id, d);
  }
  const { sendNotification } = await import('@/lib/notify'); let sent = 0;
  for (const d of seen.values()) {
    const r: any = d.data() || {}; if (!r.phone) continue;
    for (const m of boothTextsFor(r, tenant?.name || 'The studio', now)) {
      const mine = await db.runTransaction(async (tx: any) => { const cur: any = (await tx.get(d.ref)).data() || {}; if ((cur.sentMessages || {})[m.key]) return false;
        tx.update(d.ref, { [`sentMessages.${m.key}`]: new Date(now).toISOString() }); return true; });   // claimed first — never twice
      if (!mine) continue;
      try { const res: any = await sendNotification(db, { tenantId, channel: 'sms', to: r.phone, kind: `booth_${m.key}`, clientName: r.name || null, text: m.text } as any); if (res?.ok) sent++; } catch { /* logged by the sender */ }
    }
  }
  return sent;
}
