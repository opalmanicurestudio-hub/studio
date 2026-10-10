// src/lib/notify-prefs.ts — WHAT BUZZES WHOSE PHONE, AND WHEN. Each person chooses, per kind of alert, whether it buzzes
// their phone or just waits in the app, and can set quiet hours (e.g. 9pm–8am) or mark themselves away until a date.
// Nothing is ever lost: a held alert is still in their notification list. While someone is clocked in, quiet hours and
// "away" don't apply — they're at work.
import { PUSH_TIER } from '@/lib/push-tier';

export type NotifyGroup = 'clients' | 'visits' | 'schedule' | 'team' | 'pay' | 'floor' | 'rent' | 'business';
export const GROUPS: { id: NotifyGroup; label: string; hint: string }[] = [
  { id: 'clients', label: 'Clients reaching out', hint: 'Texts, calls and messages from clients' },
  { id: 'visits', label: 'Your visits', hint: 'Arrivals, running late, add-ons, hand-offs' },
  { id: 'schedule', label: 'Your schedule', hint: 'Shift changes, swaps, cover and time off' },
  { id: 'team', label: 'Team chat', hint: 'Messages, shout-outs and pinned notices' },
  { id: 'pay', label: 'Time clock and pay', hint: 'Clock reminders and clock-out fixes' },
  { id: 'floor', label: 'Floor and stations', hint: 'Station help, kits, cleaning and linens' },
  { id: 'rent', label: 'Rent and booth', hint: 'Rent, bookings and booth notices' },
  { id: 'business', label: 'Running the business', hint: 'Approvals, quotes, maintenance and reports' },
];

const OF: Record<string, NotifyGroup> = {};
const put = (g: NotifyGroup, types: string) => types.split(/\s+/).filter(Boolean).forEach((t) => { OF[t] = g; });
put('clients', 'sms sms_escalation sms_escalation_unassigned call_message call_reply front_door');
put('visits', 'visit_cancelled visit_moved visit_added visit_removed appointment_assigned walk_in_assigned guest_arrived guest_running_late late_choice suspected_no_show no_show_escalation appointment_overdue addon_handoff escalation provider_delay_reply disruption_reply provider_ask provider_offer_reply change_request visit_delay delay_affects_you appointment');
put('schedule', 'shift_changed swap_request request_approved request_denied day_off_approved swap_approved schedule_published cover_request');
put('team', 'staff_message shoutout task');
put('pay', 'pay_question pay_question_update clock_reminder timeclock clock_fix clock_fix_approved clock_fix_declined payroll_draft');
put('floor', 'assist assist_escalation floor_assist turnover_due turnover_escalation kit_timer kit_cleansed contact_reached cycle_done linen_timer kit_none_usable kit_short');
put('rent', 'renter_arrived booth_reservation booth_tour booth_application booth_no_show renter_leave renter_document renter_concern renter_message renter_swap credential rent_late renter_barred tour_followup');
export const groupOf = (type?: string): NotifyGroup => OF[String(type || '')] || 'business';

/** Always buzz, whatever the settings — someone's safety or a test the person ran themselves. */
const ALWAYS = ['test', 'pin_reset'];

const minsOf = (hhmm: any) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '')); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
export function inQuietHours(q: any, now: number, timeZone: string): boolean {
  if (!q?.on) return false;
  const a = minsOf(q.start), b = minsOf(q.end); if (a == null || b == null || a === b) return false;
  const parts = new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone }).formatToParts(new Date(now));
  const h = Number(parts.find((p) => p.type === 'hour')?.value || 0) % 24, m = Number(parts.find((p) => p.type === 'minute')?.value || 0);
  const t = h * 60 + m;
  return a < b ? t >= a && t < b : t >= a || t < b;   // 21:00–08:00 wraps past midnight
}

export function isAway(staff: any, now: number): boolean {
  const a = staff?.notificationAvailability; if (a?.mode !== 'away') return false;
  return !a.awayUntil || Date.parse(a.awayUntil) > now;
}

const atWork = (staff: any) => staff?.active === true || staff?.onBreak === true;   // clocked in (lib/punch)

/** Should this alert buzz this person's phone right now? Returns the reason when it's held. */
export function buzzFor(type: string | undefined, staff: any, tenant: any, now = Date.now()): { buzz: boolean; why?: string } {
  const t = String(type || '');
  if (ALWAYS.includes(t)) return { buzz: true };
  if (!PUSH_TIER[t]) return { buzz: false, why: 'in-app only' };
  if (staff?.notificationPrefs?.[groupOf(t)] === 'quiet') return { buzz: false, why: 'they turned this kind off' };
  if (atWork(staff)) return { buzz: true };
  if (isAway(staff, now)) return { buzz: false, why: 'away' };
  if (inQuietHours(staff?.quietHours, now, tenant?.timezone || 'America/New_York')) return { buzz: false, why: 'quiet hours' };
  return { buzz: true };
}
