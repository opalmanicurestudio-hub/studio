// src/lib/confirm-ask.ts — ASKING CLIENTS TO CONFIRM THEY'RE COMING. The reminder carries a one-tap confirm link (their
// visit link with ?do=confirm, no sign-in) and, when text replies are answered automatically, "or reply YES". Anyone
// still unconfirmed some hours later gets ONE follow-up, then nothing more. The planner marks tomorrow's unconfirmed
// visits and lists them in "needs you" with a button to send the nudge by hand.
// Switches (Automations): 'confirm-ask' (clientNotify.askConfirm) and 'confirm-nudge' (clientNotify.confirmNudge,
// clientNotify.confirmNudgeAfterHours).
import { automationOn } from '@/lib/automation-switches';

const LIVE = ['confirmed', 'booked', 'scheduled', 'pending', 'deposit_pending', 'pending_payment'];
const ms = (v: any): number => { if (!v) return 0; if (typeof v === 'string') return Date.parse(v) || 0; if (v?.toDate) return v.toDate().getTime(); if (v?.seconds) return v.seconds * 1000; return Number(v) || 0; };

/** Still waiting to hear they're coming: booked, not yet confirmed or checked in, not a request, not finished. */
export function needsConfirm(a: any): boolean {
  if (!a || a.clientConfirmedAt || a.checkInStatus === 'arrived') return false;
  if (a.status === 'requested' || a.approvalStatus === 'pending') return false;
  if (a.isRenterBooking) return false;   // a renter's client hears from the renter
  return LIVE.includes(String(a.status || 'confirmed'));
}

/** The confirm link: their visit link, opening straight to "you're confirmed". */
export const confirmLink = (base: string, token?: string | null) => (base && token ? `${base}/check-in/${token}?do=confirm` : '');

/** The sentence added to a reminder text. Plain and short; "reply YES" only when replies are answered automatically. */
export function confirmLine(link: string, tenant: any): string {
  const replies = tenant?.bookingPolicies?.textAssist !== false;
  if (!link) return replies ? ' Please reply YES to confirm.' : '';
  return replies ? ` Please confirm here: ${link} (or reply YES).` : ` Please confirm here: ${link}`;
}

export const askOn = (tenant: any) => automationOn(tenant, 'confirm-ask');
export const nudgeAfterHours = (tenant: any) => { const h = Number(tenant?.clientNotify?.confirmNudgeAfterHours); return [2, 4, 6, 8].includes(h) ? h : 4; };

/** Time for the one follow-up: asked in the reminder, still unconfirmed, long enough since, and the visit not too close. */
export function nudgeDue(a: any, tenant: any, now = Date.now()): boolean {
  if (!automationOn(tenant, 'confirm-nudge') || !askOn(tenant)) return false;
  if (!needsConfirm(a) || !a.confirmAskedAt || a.confirmNudgedAt) return false;
  const start = ms(a.startTime); if (!start || start - now < 2 * 3600000) return false;   // too close to be useful
  return now - ms(a.confirmAskedAt) >= nudgeAfterHours(tenant) * 3600000;
}

/** The follow-up itself. */
export function nudgeText(o: { first: string; service: string; when: string; studio: string; link: string; tenant: any }): string {
  const replies = o.tenant?.bookingPolicies?.textAssist !== false;
  const how = o.link ? `You can confirm here: ${o.link}${replies ? ' (or reply YES)' : ''}` : replies ? 'Just reply YES to confirm' : '';
  return `Hi ${o.first}, just checking you're still able to make your ${o.service} ${o.when}.${how ? ` ${how}.` : ''}${o.link ? ' If you need to change it, the same link has everything.' : ''}`;
}

/** Tomorrow's visits (in the business's day) that haven't confirmed, for the planner. */
export function unconfirmedOn(appointments: any[], day: Date): any[] {
  const k = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; const want = k(day);
  return (appointments || []).filter((a) => { const t = ms(a?.startTime); return t && k(new Date(t)) === want && needsConfirm(a); })
    .sort((x, y) => ms(x.startTime) - ms(y.startTime));
}
