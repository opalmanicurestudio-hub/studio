// src/lib/automation-switches.ts — THE ON/OFF SWITCH FOR EVERYTHING THE APP DOES ON ITS OWN.
// (lib/automations.ts is the live-health catalogue — messages, counts and status. This file is the switches: the
//  jobs ask `automationOn` before acting, and the Automations page shows one row per entry.)
// The rule owners see everywhere:  Settings = your rules and details.  Automations = what the app does by itself
// (whether it runs, and when).  Messages = the words.  Each automation has exactly ONE switch — here — and every job
// asks `automationOn` before acting, so a switch always means what it says. Some must always run (rent invoices,
// closing requests nobody answered); they're listed too, marked "Always on" with the reason, so owners see everything
// done on their behalf. Where an older setting already switched something, its entry uses that same setting, so
// nothing changes for anyone the day this ships.
import type { ModuleId } from '@/lib/modules';

export type SwitchAudience = 'clients' | 'renters' | 'team' | 'you';
export interface Timing { field: string; label: string; options?: { value: number | string; label: string }[]; input?: 'phone' }
export interface AutomationSwitch {
  id: string; who: SwitchAudience; module?: ModuleId; title: string; does: string;
  /** Where its on/off lives on the business. Absent = always on (see `alwaysWhy`). */
  field?: string; defaultOn?: boolean; alwaysWhy?: string;
  timing?: Timing[];
  /** Needs this to run at all (e.g. a phone number) — shown as a hint when it's missing. */
  needs?: { field: string; hint: string };
  /** The words it sends live on the Messages page. */
  words?: boolean;
  /** A bigger editor lives on the Automations page under this entry. */
  details?: 'appointment-followups' | 'win-back';
  /** Message types it sends — the Automations page shows them inside this one row (counts, email/text choices). */
  kinds?: string[];
}

export const AUTOMATION_SWITCHES: AutomationSwitch[] = [
  // ── Clients ──
  { id: 'appt-reminders', kinds: ['appointment_reminder'], who: 'clients', title: 'Appointment reminders', does: 'A text or email before each appointment, with their visit link and anything still to do.', field: 'clientNotify.enabled', defaultOn: true, words: true,
    timing: [{ field: 'clientNotify.daysBefore', label: 'Send them', options: [{ value: 0, label: 'The same day' }, { value: 1, label: 'The day before' }, { value: 2, label: '2 days before' }, { value: 3, label: '3 days before' }, { value: 7, label: 'A week before' }] }] },
  { id: 'deposit-forms', who: 'clients', title: 'Chase unpaid deposits and unfinished forms', does: 'Reminds clients who still owe a deposit or haven’t filled in their forms — and releases the time if they never do.', details: 'appointment-followups' },
  { id: 'thank-you', kinds: ['post_visit_followup'], who: 'clients', title: 'Thank-you after a visit', does: 'A short thank-you the day after, with a link to book again.', field: 'clientNotify.followUp', defaultOn: true, words: true },
  { id: 'win-back', who: 'clients', module: 'marketing', title: 'Win back quiet clients', does: 'A friendly message to clients who haven’t been in for a while, or are due for their next visit.', field: 'reconnect.enabled', defaultOn: false, details: 'win-back' },
  { id: 'extra-product-suggest', who: 'clients', title: 'Suggest a charge for extra product', does: 'When the provider recorded more product than the service’s recipe (Products used on the visit), suggests a charge at checkout — at retail or cost, as set in Settings → Fees & credit. The desk adds it or waives it; it’s never charged on its own.', field: 'automations.extraProductSuggest', defaultOn: false },
  { id: 'overtime-suggest', who: 'clients', title: 'Suggest a charge for extra time', does: 'When a visit ran past the booked time and grace, and the provider said the client asked for it, suggests an extra-time charge at checkout. The desk adds it or waives it — it’s never charged on its own. The rules (grace, pricing) are in Settings → Fees & credit.', field: 'automations.overtimeSuggest', defaultOn: false },
  { id: 'fee-collection', who: 'clients', title: 'Collect fees owed from the card on file', does: 'Charges missed-visit and late-cancel fees a client still owes to their saved card. Only fees from the last 30 days. Up to 3 tries, then it stops and tells you. The client is always told.', field: 'automations.feeCollection', defaultOn: false, kinds: ['fee_charged'],
    timing: [{ field: 'automations.feeCollectionAfterHours', label: 'First try', options: [{ value: 0, label: 'Right away' }, { value: 24, label: 'After a day' }, { value: 72, label: 'After 3 days' }] }] },
  { id: 'no-show-check', who: 'clients', title: 'Check on clients who don’t arrive', does: 'When a client is well past their start time, asks the provider “No-show, or are they here?” — it never cancels on its own.', field: 'automations.noShowCheck', defaultOn: true },
  { id: 'turnover-notices', who: 'team', title: 'Remind the team to reset stations', does: 'When a station still needs resetting and it’s overdue or the next client is close, reminds the provider — then tells the managers if it’s still not ready.', field: 'automations.turnoverNotices', defaultOn: true },
  { id: 'request-expiry', who: 'clients', title: 'Close requests nobody answered', does: 'A booking request still waiting after its time has passed is closed, the time freed, and the client told kindly.', alwaysWhy: 'Otherwise old requests keep blocking your calendar.' },
  { id: 'repeat-deposits', who: 'clients', title: 'Deposits for repeat bookings', does: 'Takes each repeat visit’s deposit when it’s due, as your booking policies say.', alwaysWhy: 'Part of the policy clients agreed to — change it in Booking policies.' },
  // ── Renters ──
  { id: 'rent-invoices', kinds: ['rent_invoiced'], who: 'renters', module: 'booth_rental', title: 'Rent invoices', does: 'An invoice for each lease on its due date, with any credits taken off.', alwaysWhy: 'This is how rent is charged.' },
  { id: 'rent-due', kinds: ['renter_rent_due'], who: 'renters', module: 'booth_rental', title: 'Rent due reminder', does: 'A text to renters 3 days before rent is due, with a link to pay. Renters on autopay aren’t sent it.', field: 'automations.rentDue', defaultOn: true },
  { id: 'renter-paperwork', kinds: ['renter_credential_expiring'], who: 'renters', module: 'booth_rental', title: 'Licence and insurance reminders', does: 'Asks renters to upload a licence or insurance you require, or renew one that’s about to expire. At most once a month.', field: 'automations.renterPaperwork', defaultOn: true },
  { id: 'booth-guest-texts', who: 'renters', module: 'booth_rental', title: 'Texts for booth guests', does: 'Day and hourly guests get a text when they’re booked, a welcome at check-in, and a note if credit is added or an overage is charged.', field: 'automations.boothGuestTexts', defaultOn: true },
  { id: 'rent-collections', kinds: ['rent_overdue', 'rent_dunning', 'renter_barred_notice'], who: 'renters', module: 'booth_rental', title: 'Late rent notices', does: 'Late notices and, if you chose it, pausing a renter who doesn’t pay.', alwaysWhy: 'Follows the collection rules in your booth rental settings.' },
  // ── Your team ──
  { id: 'staff-agenda', kinds: ['staff_agenda'], who: 'team', title: 'Each person’s day ahead', does: 'A text to each team member with tomorrow’s appointments.', field: 'clientNotify.staffAgenda', defaultOn: true },
  { id: 'weekly-digest', who: 'team', module: 'maintenance', title: 'Monday week ahead', does: 'Every Monday, each maintenance worker gets their week at a glance.', field: 'automations.weeklyDigest', defaultOn: true },
  { id: 'maintenance-overdue', who: 'team', module: 'maintenance', title: 'Overdue maintenance', does: 'When a job passes its deadline, you’re told and the worker gets a nudge.', field: 'automations.maintenanceOverdue', defaultOn: true },
  { id: 'maintenance-plans', who: 'team', module: 'maintenance', title: 'Scheduled maintenance', does: 'Opens each planned maintenance job on its date and assigns it.', alwaysWhy: 'Turn individual plans off in Maintenance.' },
  { id: 'payroll-draft', who: 'team', module: 'money', title: 'Draft payroll', does: 'Prepares a payroll draft on your pay schedule, ready for you to check.', field: 'payroll.autoDraft', defaultOn: false },
  // ── You ──
  { id: 'owner-brief', kinds: ['owner_brief'], who: 'you', title: 'Your morning brief', does: 'A text each morning with the day ahead — bookings, gaps and anything that needs you.', field: 'clientNotify.ownerBrief', defaultOn: true,
    needs: { field: 'clientNotify.ownerPhone', hint: 'Add the phone number to send it to.' }, timing: [{ field: 'clientNotify.ownerPhone', label: 'Send it to', input: 'phone' }] },
  { id: 'tour-followup', who: 'you', module: 'booth_rental', title: 'Tours nobody wrote up', does: 'The day after a tour with no outcome, you’re reminded to note how it went.', field: 'automations.tourFollowup', defaultOn: true },
];

export const SWITCH_AUDIENCE_LABEL: Record<SwitchAudience, { title: string; help: string }> = {
  clients: { title: 'Clients', help: 'What clients receive without you lifting a finger.' },
  renters: { title: 'Renters', help: 'Rent and paperwork, kept moving.' },
  team: { title: 'Your team', help: 'Keeping everyone on schedule.' },
  you: { title: 'You', help: 'What the app tells you.' },
};

const get = (o: any, path: string) => path.split('.').reduce((v, k) => (v == null ? v : v[k]), o);

/** Is this automation running for this business? Off if its tool isn't on the plan, or the owner switched it off. */
export function automationOn(tenant: any, id: string): boolean {
  const a = AUTOMATION_SWITCHES.find((x) => x.id === id); if (!a) return true;
  if (a.module && tenant?.modules?.[a.module] === false) return false;
  if (!a.field) return true;   // always on
  const v = get(tenant, a.field);
  if (a.needs && !get(tenant, a.needs.field)) return false;
  return v === undefined || v === null ? !!a.defaultOn : v !== false && v !== 'false';
}

/** Count what an automation did, by week — "Sent 4 this week" on the Automations page. Never throws. */
export async function noteAutomation(db: any, tenantId: string, id: string, n = 1) {
  if (!n) return;
  try {
    const d = new Date(); const day = (d.getUTCDay() + 6) % 7; const mon = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day));
    const week = mon.toISOString().slice(0, 10);
    const ref = db.doc(`tenants/${tenantId}/automationStats/${id}`);
    await db.runTransaction(async (tx: any) => { const cur = (await tx.get(ref)).data() || {};
      tx.set(ref, { week, count: cur.week === week ? Number(cur.count || 0) + n : n, lastAt: new Date().toISOString() }); });
  } catch { /* a counter must never break the job */ }
}

/** Rows for the Automations page: each switch with its state, for the tools on this business's plan. */
export function switchRows(tenant: any, stats: Record<string, { week?: string; count?: number }>) {
  const d = new Date(); const day = (d.getUTCDay() + 6) % 7; const week = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day)).toISOString().slice(0, 10);
  return AUTOMATION_SWITCHES.filter((a) => !a.module || tenant?.modules?.[a.module] !== false).map((a) => ({
    ...a, on: a.id === 'deposit-forms' ? Object.values(tenant?.appointmentAutomations || {}).some((r: any) => r?.enabled) : automationOn(tenant, a.id),
    always: !a.field && !a.details,
    missing: a.needs && !get(tenant, a.needs.field) ? a.needs.hint : null,
    values: Object.fromEntries((a.timing || []).map((t) => [t.field, get(tenant, t.field) ?? null])),
    thisWeek: stats[a.id]?.week === week ? Number(stats[a.id]?.count || 0) : 0,
  }));
}
