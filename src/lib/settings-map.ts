// ─── settings-map.ts ──────────────────────────────────────────────────────────
// One description of every configurable thing in the platform: what it is, the
// question an owner is actually asking when they go looking for it, where it
// lives, and how to read its current value back in plain language.
//
// This file exists because the settings had grown to seven surfaces organised
// by SUBSYSTEM — booking here, automations there, messages somewhere else —
// which is how the code is structured but not how anybody thinks. Somebody
// asking "what happens when a client cancels?" had to visit three screens and
// know which one won.
//
// The map is deliberately NOT a second set of controls. Duplicating controls
// is what created the mess in the first place: two screens editing one policy
// means whichever you touched last is the one you trust. Every entry here
// reads the current value and links to the single screen that owns it.
//
// `summary` is the important field. "Auto-cancel at 24 hours" tells an owner
// nothing; "at 24 hours out, an unpaid appointment cancels itself and the slot
// goes back on sale" tells them everything. Every summary states the
// consequence, not the setting.

export type SettingGroupId =
  | 'arrive'      // How do bookings arrive?
  | 'change'      // What happens when plans change?
  | 'chase'       // What do we chase people about?
  | 'say'         // What do we say, and when?
  | 'charge'      // What do we charge, and what does it cost us?
  | 'shop'        // The online shop
  | 'business';   // Identity, hours, people, hardware

export interface SettingGroup {
  id: SettingGroupId;
  question: string;
  blurb: string;
}

export const SETTING_GROUPS: SettingGroup[] = [
  { id: 'arrive',   question: 'How do bookings arrive?',            blurb: 'Whether people book instantly, pay first, leave a card, or wait for your approval.' },
  { id: 'change',   question: 'What happens when plans change?',     blurb: 'Cancellations, no-shows, reschedules — what you keep, what you refund, what you charge.' },
  { id: 'chase',    question: 'What do we chase people about?',      blurb: 'Deposits, forms, cards and balances that are missing before an appointment.' },
  { id: 'say',      question: 'What do we say, and when?',           blurb: 'Every automatic email and text — the wording, the timing, and what stays quiet.' },
  { id: 'charge',   question: 'What do we charge?',                  blurb: 'Your hourly floor, service pricing, deposits, and what a lost slot really costs.' },
  { id: 'shop',     question: 'How does the online shop behave?',    blurb: 'Returns, refunds, claims and restocking for products you ship.' },
  { id: 'business', question: 'Who are we, and how do we operate?',  blurb: 'Identity, hours, staff, kiosk and hardware.' },
];

/* An inline control, for the handful of settings people actually change.
 *
 * This deliberately reverses an earlier decision. The map started read-only
 * on the reasoning that duplicate controls caused the settings mess — but
 * that is not quite what happened. The mess was two engines writing DIFFERENT
 * FIELDS for the same concept, so the screens genuinely disagreed. A control
 * here writes the SAME field as the owning screen, which cannot disagree with
 * itself; it is one field with two doors.
 *
 * Only the things owners touch often get a door here. Anything with real
 * complexity — a whole cancellation matrix, a message rewrite — still links
 * out, because a switch is a bad interface for a decision that needs context. */
export type InlineControl =
  | { kind: 'toggle'; field: string; on: (t: any) => boolean; onLabel: string; offLabel: string }
  | { kind: 'choice'; field: string; value: (t: any) => string; options: { value: string; label: string }[] }
  | { kind: 'number'; field: string; value: (t: any) => number; unit: string; max?: number; transform?: (n: number) => any };

export interface SettingEntry {
  group: SettingGroupId;
  label: string;
  /** The single screen that OWNS this. Never two. */
  href: string;
  screen: string;
  /** When present, the setting can be changed right here. */
  control?: InlineControl;
  /** Reads current config and states the consequence in plain language. */
  summarise: (tenant: any) => string;
  /** True when this is unset in a way that silently disables something. */
  isUnconfigured?: (tenant: any) => boolean;
  /** What breaks or goes unprotected while it is unconfigured. */
  unconfiguredWarning?: string;
}

const money = (n: any) => `$${(Number(n) || 0).toFixed(2)}`;
const hrs = (n: any) => {
  const v = Number(n) || 0;
  if (v === 0) return 'no limit';
  if (v % 24 === 0) return `${v / 24} day${v === 24 ? '' : 's'}`;
  return `${v} hour${v === 1 ? '' : 's'}`;
};
const outcomeWord = (v: any) => (v === 'refund' ? 'refunded'
  : v === 'rollover' ? 'rolled over as credit'
    : v === 'forfeit' ? 'kept by the studio' : 'not set');

export const SETTINGS_MAP: SettingEntry[] = [
  // ── How bookings arrive ──────────────────────────────────────────────────
  {
    group: 'arrive', label: 'How people book', href: '/settings/booking', screen: 'Booking & Deposits',
    control: {
      kind: 'choice', field: 'bookingMode.mode',
      value: (t) => t?.bookingMode?.mode || 'instant',
      options: [
        { value: 'instant', label: 'They just book' },
        { value: 'deposit_required', label: 'Pay to hold' },
        { value: 'card_on_file', label: 'Leave a card' },
        { value: 'approval', label: 'You approve' },
      ],
    },
    summarise: (t) => {
      const m = t?.bookingMode?.mode || 'instant';
      const card = t?.bookingMode?.requireCardOnFile === true;
      const base = m === 'approval' ? 'Requests wait for you to accept or decline'
        : m === 'deposit_required' ? 'The slot is held until the deposit is paid'
          : m === 'card_on_file' ? 'Booked immediately, card saved, nothing charged'
            : 'Booked instantly when someone taps';
      return card && m !== 'card_on_file' ? `${base} — and a card is saved either way.` : `${base}.`;
    },
  },
  {
    group: 'arrive', label: 'If you do not answer a request', href: '/settings/booking', screen: 'Booking & Deposits',
    control: {
      kind: 'number', field: 'bookingMode.approvalExpiryHours',
      value: (t) => Number(t?.bookingMode?.approvalExpiryHours ?? 24), unit: 'hours', max: 168,
    },
    summarise: (t) => {
      if ((t?.bookingMode?.mode || 'instant') !== 'approval') return 'Not in use — you are not running approval mode.';
      const h = Number(t?.bookingMode?.approvalExpiryHours ?? 24);
      return h > 0
        ? `A request you do not answer within ${hrs(h)} declines itself and frees the time.`
        : 'Requests wait indefinitely — a client could hold their day open for a week.';
    },
    isUnconfigured: (t) => (t?.bookingMode?.mode === 'approval') && Number(t?.bookingMode?.approvalExpiryHours ?? 24) === 0,
    unconfiguredWarning: 'With no expiry, your silence can cost a client their day.',
  },
  {
    group: 'arrive', label: 'Collect deposits at all', href: '/settings', screen: 'Studio Settings',
    control: {
      kind: 'toggle', field: 'depositsLive',
      on: (t) => t?.depositsLive === true,
      onLabel: 'Collecting deposits', offLabel: 'No deposits anywhere',
    },
    summarise: (t) => (t?.depositsLive === true
      ? 'Deposits are being collected as each service specifies.'
      : 'No deposits are collected anywhere, whatever individual services say.'),
    isUnconfigured: (t) => t?.depositsLive !== true,
    unconfiguredWarning: 'Every deposit rule you have set is currently inactive.',
  },
  {
    group: 'arrive', label: 'Protect against repeat no-shows', href: '/settings', screen: 'Studio Settings',
    control: {
      kind: 'toggle', field: 'guardianProtocolEnabled',
      on: (t) => t?.guardianProtocolEnabled !== false,
      onLabel: 'Repeat no-shows must pay up front', offLabel: 'History ignored',
    },
    summarise: (t) => (t?.guardianProtocolEnabled !== false
      ? 'Clients with repeated no-shows are asked for a deposit even on services that normally need none.'
      : 'Off — booking history does not affect what anyone is asked to pay.'),
  },

  // ── When plans change ────────────────────────────────────────────────────
  {
    group: 'change', label: 'Cancellation fee', href: '/settings', screen: 'Studio Settings',
    summarise: (t) => {
      const mode = t?.defaultCancellationMode || 'matrix';
      const w = hrs(t?.cancellationWindowHours ?? 24);
      if (mode === 'matrix') return `Cancel inside ${w} and the fee is what the slot costs you — time, products and labour.`;
      if (mode === 'percentage') return `Cancel inside ${w} and the fee is a share of the service price.`;
      return `Cancel inside ${w} and the fee is ${money(t?.cancellationFee)}, once per appointment.`;
    },
    isUnconfigured: (t) => (t?.defaultCancellationMode === 'flat') && !(Number(t?.cancellationFee) > 0),
    unconfiguredWarning: 'Flat mode with no amount set means late cancellations cost nothing.',
  },
  {
    group: 'change', label: 'Deposit outcomes', href: '/settings', screen: 'Studio Settings',
    summarise: (t) => {
      const p = t?.depositPolicy || {};
      return `Early cancel: ${outcomeWord(p.onEarlyCancel || 'refund')}. Late: ${outcomeWord(p.onLateCancel || 'forfeit')}. No-show: ${outcomeWord(p.onNoShow || 'forfeit')}. You cancel: ${outcomeWord(p.onStudioCancel || 'refund')}.`;
    },
  },
  {
    group: 'change', label: 'Reschedule fee', href: '/settings', screen: 'Studio Settings',
    summarise: (t) => {
      const f = Number(t?.rescheduleFee) || 0;
      const w = Number(t?.rescheduleFeeWindowHours) || 0;
      return f > 0 && w > 0
        ? `Moving an appointment inside ${hrs(w)} costs ${money(f)}.`
        : 'Moving an appointment is free, however late and however often.';
    },
  },
  {
    group: 'change', label: 'No-show fee (booths)', href: '/booths', screen: 'Booth settings',
    summarise: (t) => {
      const p = t?.noShowPolicy as any;
      const cents = Number(p?.feeCents) || 0;
      return p?.enabled && cents > 0
        ? `A booth no-show is charged ${money(cents / 100)} to the card on file; if it declines, it is added to their balance.`
        : 'Booth no-shows are flagged but never charged.';
    },
  },

  // ── What we chase ────────────────────────────────────────────────────────
  {
    group: 'chase', label: 'Pre-appointment checks', href: '/settings/automations', screen: 'Automations',
    summarise: (t) => {
      const a = t?.appointmentAutomations || {};
      const on = Object.entries(a).filter(([, v]: any) => v?.enabled !== false).length
        || 6; // defaults are all on
      const cancels = Object.values(a).filter((v: any) => v?.severity === 'auto_cancel').length;
      return `${on} checks run hourly before each appointment${cancels > 0 ? `, and ${cancels} can cancel it outright if still unresolved` : ' — reminders and warnings only'}.`;
    },
  },
  {
    group: 'chase', label: 'Staff credit limit', href: '/settings', screen: 'Studio Settings',
    summarise: (t) => {
      const c = Number(t?.retailSettings?.staffCreditCapCents ?? 2500) / 100;
      return c > 0
        ? `A non-manager can grant up to ${money(c)} in credit before a manager is needed.`
        : 'Only managers can grant credit.';
    },
  },

  // ── What we say ──────────────────────────────────────────────────────────
  {
    group: 'say', label: 'Remind people before they come', href: '/settings', screen: 'Studio Settings',
    control: {
      kind: 'number', field: 'clientNotify.daysBefore',
      value: (t) => (Number.isFinite(Number(t?.clientNotify?.daysBefore)) ? Number(t.clientNotify.daysBefore) : 1),
      unit: 'days before', max: 7,
    },
    summarise: (t) => {
      const c = t?.clientNotify || {};
      if (c.enabled === false) return 'No reminders are sent.';
      const d = Number.isFinite(Number(c.daysBefore)) ? Number(c.daysBefore) : 1;
      const h = Number.isFinite(Number(c.sendHour)) ? Number(c.sendHour) : 9;
      const hour = `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? 'am' : 'pm'}`;
      return d === 0
        ? `A reminder goes out on the morning of the appointment, at ${hour}.`
        : `A reminder goes out ${d} day${d === 1 ? '' : 's'} before, at ${hour}.`;
    },
  },
  {
    group: 'say', label: 'Message wording and switches', href: '/settings/messages', screen: 'Messages',
    summarise: (t) => {
      const mp = t?.messagePolicy || {};
      const custom = Object.values(mp).filter((v: any) => String(v?.body || '').trim()).length;
      const off = Object.values(mp).filter((v: any) => v?.emailEnabled === false || v?.smsEnabled === false).length;
      if (custom === 0 && off === 0) return 'Every message uses its built-in wording and is switched on.';
      const parts = [];
      if (custom > 0) parts.push(`${custom} rewritten in your own words`);
      if (off > 0) parts.push(`${off} switched off`);
      return `${parts.join(', ')}. The rest use their built-in wording.`;
    },
  },
  {
    group: 'say', label: 'Hold texts overnight', href: '/settings/messages', screen: 'Messages',
    control: {
      kind: 'toggle', field: 'messageQuietHours.enabled',
      on: (t) => t?.messageQuietHours?.enabled === true,
      onLabel: 'Texts held overnight', offLabel: 'Texts can send at any hour',
    },
    summarise: (t) => {
      const q = t?.messageQuietHours || {};
      if (q.enabled !== true) return 'Texts can go out at any hour, including overnight.';
      const f = Number(q.startHour ?? 21); const u = Number(q.endHour ?? 8);
      return `Texts are held between ${f}:00 and ${u}:00. Emails are unaffected.`;
    },
  },

  // ── What we charge ───────────────────────────────────────────────────────
  {
    group: 'charge', label: 'Your hourly floor (TMHR)', href: '/financials', screen: 'Foundation',
    summarise: (t) => {
      const v = Number(t?.tmhr) || 0;
      return v > 0
        ? `An hour of your time costs ${money(v)} before anyone is paid. Service pricing and cancellation fees both measure against it.`
        : 'Not calculated. Nothing knows what an hour of your time is worth.';
    },
    isUnconfigured: (t) => !(Number(t?.tmhr) > 0),
    unconfiguredWarning: 'Breakeven pricing and matrix-mode cancellation fees have nothing to measure against.',
  },
  {
    group: 'charge', label: 'Employer tax burden', href: '/financials', screen: 'Foundation',
    summarise: (t) => {
      const v = Number(t?.employerTaxBurdenPct) || 0;
      return v > 0
        ? `Staff pay is costed at ${v}% above the wage, which feeds every breakeven figure.`
        : 'Not set — staff cost is treated as the wage alone, understating every breakeven.';
    },
  },

  // ── The shop ─────────────────────────────────────────────────────────────
  {
    group: 'shop', label: 'Returns and refunds', href: '/retail-orders/policies', screen: 'Shop Policies',
    summarise: (t) => {
      const rs = t?.retailSettings || {};
      const p = rs.policies || {};
      const win = Number(rs.returnWindowDays) || 0;
      const auto = Number(p.refundAutoBelowCents) || 0;
      const parts = [rs.returnsEnabled === false
        ? 'Self-serve returns are off'
        : `Returns accepted${win > 0 ? ` within ${win} days` : ' with no time limit'}`];
      if (Number(p.restockingFeePct) > 0) parts.push(`${p.restockingFeePct}% restocking fee on remorse returns`);
      if (auto > 0) parts.push(`refunds under ${money(auto / 100)} fire automatically`);
      return `${parts.join('; ')}.`;
    },
  },
  {
    group: 'shop', label: 'Claims', href: '/retail-orders/policies', screen: 'Shop Policies',
    summarise: (t) => {
      const rs = t?.retailSettings || {};
      const p = rs.policies || {};
      const auto = Number(rs.claimAutoResolveMaxCents) || 0;
      const bits = [auto > 0
        ? `Low-risk claims under ${money(auto / 100)} resolve themselves`
        : 'Every claim waits for you'];
      if (Number(p.claimReviewAfter) > 0) bits.push(`nothing auto-approves after ${p.claimReviewAfter} prior claims`);
      if (p.claimPhotosRequired === true) bits.push('a photo is required before approving damage claims');
      return `${bits.join('; ')}.`;
    },
  },
];

/** Entries for one group, with their summaries resolved. */
export function summariseGroup(tenant: any, group: SettingGroupId) {
  return SETTINGS_MAP.filter((e) => e.group === group).map((e) => ({
    ...e,
    summary: e.summarise(tenant),
    needsAttention: e.isUnconfigured ? e.isUnconfigured(tenant) : false,
  }));
}

/** Everything currently unconfigured in a way that silently disables something. */
export function attentionItems(tenant: any) {
  return SETTINGS_MAP
    .filter((e) => e.isUnconfigured && e.isUnconfigured(tenant))
    .map((e) => ({ label: e.label, href: e.href, screen: e.screen, warning: e.unconfiguredWarning || '' }));
}
