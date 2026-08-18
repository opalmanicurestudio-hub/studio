// ─── message-policy.ts ────────────────────────────────────────────────────────
// Which messages go out, and what they say.
//
// Every client-facing send already carries a `kind`. This file turns that
// string into a policy: is this kind switched on for this shop, on this
// channel, and has the owner written their own words for it?
//
// Two hard rules, both about not letting a settings toggle create a lie:
//
//   1. SOME MESSAGES CANNOT BE SWITCHED OFF. If a shop takes someone's money,
//      holds their card, declines their request, or cancels their visit, the
//      person is told — full stop. Silence there is not a preference, it is a
//      shop hiding from its own customer. Those kinds are marked
//      `canDisable: false` and the resolver refuses to disable them no matter
//      what the database says.
//
//   2. A CUSTOM MESSAGE STILL HAS TO CARRY ITS FACTS. Copy overrides are
//      rendered through a token map, and any kind with `requiredTokens` must
//      include them — you can rewrite "your deposit was charged" in your own
//      voice, but you cannot ship a version that omits the amount. Validation
//      happens at edit time (so the owner sees it) AND at send time (so a
//      malformed old override falls back to the built-in copy rather than
//      sending something wrong).
//
// Pure, dependency-free, and safe to import from both a client settings page
// and a server send path.

export type MessageChannel = 'email' | 'sms';

export interface MessageKindDef {
  id: string;
  group: 'Booking' | 'Money' | 'Reminders' | 'Retail' | 'Renters' | 'Account';
  label: string;
  /** What actually triggers it, in the owner's language. */
  when: string;
  channels: MessageChannel[];
  /** False = a person has a right to this message; the toggle is not offered. */
  canDisable: boolean;
  /** Tokens the copy may use. First is shown as the example. */
  tokens: string[];
  /** Tokens a custom version MUST keep, or it is rejected. */
  requiredTokens: string[];
  /** Why it cannot be disabled — shown in the UI instead of a dead switch. */
  mandatoryNote?: string;

  /* ── Default copy ──────────────────────────────────────────────────────
   * The shipped wording, kept HERE rather than inside the route that sends
   * it. Two consequences that matter: the settings screen can show the owner
   * exactly what goes out today and let them edit that text directly instead
   * of writing from a blank box, and changing the house voice is a change to
   * one file rather than a hunt through a dozen send paths.
   *
   * The voice is deliberately plain and professional: state the fact, state
   * what happens next, stop. No apologising for things that are not
   * failures, no filling silence with reassurance nobody asked for. */
  defaultSubject: string;
  defaultBody: string;

  /* ── Timing ────────────────────────────────────────────────────────────
   * 'immediate'  fires on the action itself. Nothing to schedule.
   * 'before_event' fires a configurable interval BEFORE a known moment
   *   (the appointment, the expiry date, the rent date).
   * 'after_event' fires an interval AFTER something happened. */
  timing: 'immediate' | 'before_event' | 'after_event';
  /** Default offset in hours for scheduled kinds. Ignored when immediate. */
  defaultOffsetHours?: number;
  /** What the offset is measured from, in the owner's words. */
  offsetAnchor?: string;
  /** Set when this kind's timing is owned by ANOTHER screen. Two controls for
   *  one schedule is how settings start disagreeing with reality, so the
   *  Messages screen shows this sentence and no input. */
  timingOwnedElsewhere?: string;
}

/** The catalog. Adding a kind here is what makes it configurable — a `kind`
 *  string that is not in this list simply sends as written, which keeps
 *  internal/system mail out of the owner's settings screen. */
export const MESSAGE_KINDS: MessageKindDef[] = [
  {
    id: 'booking_confirmation', group: 'Booking', label: 'Booking confirmed',
    when: 'A booking is confirmed online or by staff.',
    channels: ['email', 'sms'], canDisable: true,
    tokens: ['{{client_first}}', '{{service}}', '{{staff}}', '{{when}}', '{{studio}}', '{{link}}', '{{code}}'],
    requiredTokens: ['{{when}}'],
    defaultSubject: 'Confirmed: {{service}} on {{when}}',
    defaultBody: '{{client_first}}, your {{service}} with {{staff}} is confirmed for {{when}}.\n\nYour confirmation code is {{code}}. Manage or check in here: {{link}}',
    timing: 'immediate',
  },
  {
    id: 'booking_hold', group: 'Booking', label: 'Slot held, deposit needed',
    when: 'A booking is waiting on a deposit before it is confirmed.',
    channels: ['email', 'sms'], canDisable: false,
    mandatoryNote: 'They are holding a time that is not theirs yet — they have to be told what is needed.',
    tokens: ['{{client_first}}', '{{service}}', '{{when}}', '{{amount}}', '{{link}}', '{{studio}}'],
    requiredTokens: ['{{link}}'],
    defaultSubject: 'Complete your booking — {{service}}',
    defaultBody: '{{client_first}}, {{when}} is held for your {{service}}.\n\nThe booking is confirmed once the {{amount}} deposit is paid: {{link}}',
    timing: 'immediate',
  },
  {
    id: 'booking_request', group: 'Booking', label: 'Request received',
    when: 'Approval mode: a client asks for a time.',
    channels: ['email', 'sms'], canDisable: true,
    tokens: ['{{client_first}}', '{{service}}', '{{when}}', '{{amount}}', '{{studio}}', '{{link}}'],
    requiredTokens: [],
    defaultSubject: 'Request received — {{service}} on {{when}}',
    defaultBody: '{{client_first}}, we have your request for {{service}} on {{when}}.\n\nThis time is not booked yet. We will confirm or offer an alternative shortly. Nothing has been charged.',
    timing: 'immediate',
  },
  {
    id: 'request_accepted', group: 'Booking', label: 'Request accepted',
    when: 'You accept a booking request.',
    channels: ['email', 'sms'], canDisable: false,
    mandatoryNote: 'They asked for a time and are waiting on the answer.',
    tokens: ['{{client_first}}', '{{service}}', '{{when}}', '{{amount}}', '{{link}}', '{{studio}}'],
    requiredTokens: ['{{when}}'],
    defaultSubject: 'Confirmed: {{service}} on {{when}}',
    defaultBody: '{{client_first}}, your request for {{when}} is accepted.\n\n{{link}}',
    timing: 'immediate',
  },
  {
    id: 'request_declined', group: 'Booking', label: 'Request declined',
    when: 'You decline a booking request, or it expires unanswered.',
    channels: ['email', 'sms'], canDisable: false,
    mandatoryNote: 'Somebody is keeping that time free for you. Not telling them is the one unforgivable version of this feature.',
    tokens: ['{{client_first}}', '{{when}}', '{{reason}}', '{{link}}', '{{studio}}'],
    requiredTokens: [],
    defaultSubject: 'Your request for {{when}}',
    defaultBody: '{{client_first}}, we are not able to take {{when}}.\n\n{{reason}}\n\nNothing has been charged. You can view other available times here: {{link}}',
    timing: 'immediate',
  },
  {
    /* A decline can mean two very different things, and sending "here are
     * other times" to someone you are declining as a CLIENT is worse than
     * saying nothing — it reads as a brush-off and invites a booking you will
     * decline again. So the studio picks which one it is, and the wording
     * follows. */
    id: 'request_declined_final', group: 'Booking', label: 'Declined — not taking this booking',
    when: 'You decline and do NOT want the client to try another time (not taking new clients, not a service you offer, not a fit).',
    channels: ['email', 'sms'], canDisable: false,
    mandatoryNote: 'They are holding time open for an answer. Saying nothing is worse than saying no.',
    tokens: ['{{client_first}}', '{{when}}', '{{reason}}', '{{studio}}'],
    requiredTokens: [],
    defaultSubject: 'Your booking request',
    defaultBody: '{{client_first}}, we are not able to take this booking.\n\n{{reason}}\n\nNothing has been charged. Thank you for your interest in {{studio}}.',
    timing: 'immediate',
  },
  {
    /* The only STAFF-facing kind in the catalog. Approval mode is only a good
     * experience for the client when the answer is fast, and "fast" cannot
     * depend on the owner happening to open the app. This fires the moment a
     * request lands. Disableable, because a busy shop may prefer the daily
     * digest — but on by default, because the alternative is a client waiting
     * on silence. */
    id: 'staff_new_request', group: 'Booking', label: 'Alert me: new booking request',
    when: 'A client sends a booking request in approval mode. Sent to you, not the client.',
    channels: ['email', 'sms'], canDisable: true,
    tokens: ['{{client_first}}', '{{service}}', '{{when}}', '{{amount}}', '{{link}}', '{{studio}}'],
    requiredTokens: [],
    defaultSubject: 'New request: {{service}} on {{when}}',
    defaultBody: '{{client_first}} has requested {{service}} on {{when}}.\n\nAccept or decline here: {{link}}',
    timing: 'immediate',
  },
  {
    id: 'appointment_reminder', group: 'Reminders', label: 'Appointment reminder',
    when: 'Ahead of the visit, on your reminder schedule.',
    channels: ['email', 'sms'], canDisable: true,
    tokens: ['{{client_first}}', '{{service}}', '{{when}}', '{{staff}}', '{{link}}', '{{studio}}'],
    requiredTokens: ['{{when}}'],
    timingOwnedElsewhere: 'Reminder timing (how many days ahead, and the hour it goes out) is set under Automations \u2192 Reminders, so the schedule stays in one place.',
    defaultSubject: 'Reminder: {{service}} on {{when}}',
    defaultBody: '{{client_first}}, this is a reminder for your {{service}} with {{staff}} on {{when}}.\n\nManage your appointment: {{link}}',
    timing: 'before_event',
    defaultOffsetHours: 24,
    offsetAnchor: 'the appointment start time',
  },
  {
    id: 'deposit_charged', group: 'Money', label: 'Deposit charged',
    when: 'A deposit is taken from a card on file.',
    channels: ['email', 'sms'], canDisable: false,
    mandatoryNote: 'You moved money. A charge nobody was told about is how chargebacks start.',
    tokens: ['{{client_first}}', '{{amount}}', '{{when}}', '{{service}}', '{{link}}', '{{studio}}'],
    requiredTokens: ['{{amount}}'],
    defaultSubject: 'Deposit received — {{amount}}',
    defaultBody: '{{client_first}}, we have charged {{amount}} to your card on file as the deposit for {{service}} on {{when}}.\n\nIt will be applied to your total. {{link}}',
    timing: 'immediate',
  },
  {
    id: 'deposit_failed', group: 'Money', label: 'Card declined',
    when: 'A card on file is declined.',
    channels: ['email', 'sms'], canDisable: false,
    mandatoryNote: 'They think they are paid up. Only this message tells them otherwise.',
    tokens: ['{{client_first}}', '{{amount}}', '{{when}}', '{{link}}', '{{studio}}', '{{card_issue}}', '{{hold_until}}'],
    requiredTokens: ['{{link}}'],
    defaultSubject: 'Payment required — {{amount}}',
    defaultBody: '{{client_first}}, the {{amount}} deposit did not complete on the card we have on file.\n\n{{card_issue}}\n\nYour time is held until {{hold_until}}. Pay here to confirm it: {{link}}',
    timing: 'immediate',
  },
  {
    id: 'refund_issued', group: 'Money', label: 'Refund sent',
    when: 'Money goes back to a client.',
    channels: ['email'], canDisable: false,
    mandatoryNote: 'Refund timing questions are the most common support message there is. This one prevents them.',
    tokens: ['{{client_first}}', '{{amount}}', '{{studio}}', '{{link}}'],
    requiredTokens: ['{{amount}}'],
    defaultSubject: 'Refund issued — {{amount}}',
    defaultBody: '{{client_first}}, a refund of {{amount}} has been issued to your original payment method.\n\nMost banks post refunds within 5–10 business days. {{link}}',
    timing: 'immediate',
  },
  {
    id: 'receipt', group: 'Money', label: 'Receipt',
    when: 'A sale is completed and the client asks for it by email.',
    channels: ['email'], canDisable: true,
    tokens: ['{{client_first}}', '{{amount}}', '{{when}}', '{{studio}}'],
    requiredTokens: ['{{amount}}'],
    defaultSubject: 'Your receipt — {{amount}}',
    defaultBody: '{{client_first}}, thank you. Your receipt for {{amount}} on {{when}} is below.',
    timing: 'immediate',
  },
  {
    id: 'order_shipped', group: 'Retail', label: 'Order on its way',
    when: 'A carrier scans a shop order.',
    channels: ['email'], canDisable: true,
    tokens: ['{{client_first}}', '{{order_number}}', '{{carrier}}', '{{link}}', '{{studio}}'],
    requiredTokens: ['{{link}}'],
    defaultSubject: 'Order {{order_number}} is on its way',
    defaultBody: '{{client_first}}, order {{order_number}} has been collected by {{carrier}}.\n\nTrack it here: {{link}}',
    timing: 'immediate',
  },
  {
    id: 'order_delayed', group: 'Retail', label: 'Delivery running late',
    when: 'The carrier moves its own delivery estimate, or a parcel stops scanning.',
    channels: ['email'], canDisable: true,
    tokens: ['{{client_first}}', '{{order_number}}', '{{carrier}}', '{{when}}', '{{link}}', '{{studio}}'],
    requiredTokens: [],
    defaultSubject: 'Delivery update — order {{order_number}}',
    defaultBody: '{{client_first}}, {{carrier}} has revised the delivery estimate for order {{order_number}} to {{when}}.\n\nThe parcel is still in transit. Track it here: {{link}}',
    timing: 'immediate',
  },
  {
    id: 'renter_signin_code', group: 'Renters', label: 'Renter sign-in code',
    when: 'A booth renter asks for a code to open their portal.',
    channels: ['email', 'sms'], canDisable: false,
    mandatoryNote: 'They asked for it and cannot get into their own portal without it.',
    tokens: ['{{code}}', '{{studio}}', '{{link}}'],
    requiredTokens: ['{{code}}'],
    defaultSubject: 'Your sign-in code',
    defaultBody: 'Your sign-in code is {{code}}. It expires in 10 minutes.',
    timing: 'immediate',
  },
  {
    id: 'renter_credential_expiring', group: 'Renters', label: 'Licence or insurance expiring',
    when: 'A renter\u2019s licence or insurance is approaching its expiry date.',
    channels: ['email', 'sms'], canDisable: false,
    mandatoryNote: 'Working on an expired licence or lapsed insurance is a legal problem for them and for you. They get the warning.',
    tokens: ['{{renter_first}}', '{{document}}', '{{expiry}}', '{{link}}', '{{studio}}'],
    requiredTokens: ['{{expiry}}'],
    defaultSubject: '{{document}} expires {{expiry}}',
    defaultBody: '{{renter_first}}, your {{document}} on file expires on {{expiry}}.\n\nPlease upload the renewal before that date: {{link}}',
    timing: 'before_event',
    defaultOffsetHours: 720,
    offsetAnchor: 'the expiry date',
  },
  {
    id: 'renter_rent_due', group: 'Renters', label: 'Rent reminder',
    when: 'A renter\u2019s booth rent is coming due or is late.',
    channels: ['email', 'sms'], canDisable: true,
    tokens: ['{{renter_first}}', '{{amount}}', '{{when}}', '{{link}}', '{{studio}}'],
    requiredTokens: ['{{amount}}'],
    defaultSubject: 'Rent due — {{amount}}',
    defaultBody: '{{renter_first}}, booth rent of {{amount}} is due {{when}}.\n\n{{link}}',
    timing: 'before_event',
    defaultOffsetHours: 72,
    offsetAnchor: 'the rent due date',
  },
  {
    id: 'renter_ticket_update', group: 'Renters', label: 'Maintenance ticket update',
    when: 'A renter\u2019s maintenance request changes status or gets a reply.',
    channels: ['email'], canDisable: true,
    tokens: ['{{renter_first}}', '{{ticket}}', '{{status}}', '{{link}}', '{{studio}}'],
    requiredTokens: [],
    defaultSubject: 'Maintenance update — {{ticket}}',
    defaultBody: '{{renter_first}}, your maintenance request {{ticket}} is now {{status}}.\n\n{{link}}',
    timing: 'immediate',
  },
  {
    id: 'support_reply', group: 'Retail', label: 'Reply to a customer message',
    when: 'You answer a customer\u2019s support message.',
    channels: ['email'], canDisable: false,
    mandatoryNote: 'They wrote to you and are waiting. A reply nobody receives is not a reply.',
    tokens: ['{{client_first}}', '{{order_number}}', '{{link}}', '{{studio}}'],
    requiredTokens: [],
    defaultSubject: 'Re: your message about order {{order_number}}',
    defaultBody: '{{client_first}}, a reply to your message about order {{order_number}} is below.\n\nView the full conversation: {{link}}',
    timing: 'immediate',
  },
  {
    id: 'support_ack', group: 'Retail', label: 'Message received',
    when: 'A customer sends a support message.',
    channels: ['email'], canDisable: true,
    tokens: ['{{client_first}}', '{{order_number}}', '{{case_ref}}', '{{link}}', '{{studio}}'],
    requiredTokens: [],
    defaultSubject: 'Message received — order {{order_number}}',
    defaultBody: '{{client_first}}, we have your message about order {{order_number}} (case {{case_ref}}).\n\nIt is in the queue and sending it again will not move it up. {{link}}',
    timing: 'immediate',
  },
  {
    id: 'return_update', group: 'Retail', label: 'Return progress',
    when: 'A return is received, resolved, or a label is issued.',
    channels: ['email'], canDisable: false,
    mandatoryNote: 'They posted something back and are owed an answer about it.',
    tokens: ['{{client_first}}', '{{order_number}}', '{{amount}}', '{{link}}', '{{studio}}'],
    requiredTokens: [],
    defaultSubject: 'Return update — order {{order_number}}',
    defaultBody: '{{client_first}}, there is an update on the return for order {{order_number}}.\n\n{{link}}',
    timing: 'immediate',
  },
  {
    id: 'claim_decision', group: 'Retail', label: 'Claim decision',
    when: 'You approve or decline a damage, missing, or wrong-item claim.',
    channels: ['email'], canDisable: false,
    mandatoryNote: 'They reported a problem. The decision is the whole point of reporting it.',
    tokens: ['{{client_first}}', '{{order_number}}', '{{amount}}', '{{link}}', '{{studio}}'],
    requiredTokens: [],
    defaultSubject: 'Decision on your report — order {{order_number}}',
    defaultBody: '{{client_first}}, we have reviewed your report on order {{order_number}}.\n\n{{link}}',
    timing: 'immediate',
  },
  {
    id: 'account_link', group: 'Account', label: 'Sign-in link',
    when: 'A client asks to see their orders.',
    channels: ['email'], canDisable: false,
    mandatoryNote: 'They asked for it and cannot get in without it.',
    tokens: ['{{link}}', '{{studio}}'],
    requiredTokens: ['{{link}}'],
    defaultSubject: 'Your sign-in link',
    defaultBody: 'Use this link to view your orders. It works for 30 days.\n\n{{link}}',
    timing: 'immediate',
  },
];

export const MESSAGE_KIND_BY_ID: Record<string, MessageKindDef> =
  MESSAGE_KINDS.reduce((acc, k) => { acc[k.id] = k; return acc; }, {} as Record<string, MessageKindDef>);

export interface MessagePolicy {
  /** Send at all, on this channel? */
  enabled: boolean;
  /** Owner's subject line, or '' to use the built-in. */
  subject: string;
  /** Owner's body copy, or '' to use the built-in. */
  body: string;
  /** True when the owner supplied usable custom copy. */
  custom: boolean;
  /** Set when an override existed but was rejected — the send falls back to
   *  the built-in copy and this explains why, for logs and the settings UI. */
  overrideRejected?: string;
}

/**
 * The resolver. Unknown kinds are ALWAYS enabled with no override — a message
 * that predates this system keeps working exactly as it did.
 */
export function resolveMessagePolicy(
  tenant: any,
  kind: string,
  channel: MessageChannel = 'email',
): MessagePolicy {
  const def = MESSAGE_KIND_BY_ID[kind];
  const cfg = ((tenant && tenant.messagePolicy) || {})[kind] || {};

  if (!def) return { enabled: true, subject: '', body: '', custom: false };

  // Rule 1: a mandatory message cannot be switched off, whatever is stored.
  const storedOff = channel === 'sms' ? cfg.smsEnabled === false : cfg.emailEnabled === false;
  const enabled = def.canDisable ? !storedOff : true;

  const rawSubject = String(cfg.subject || '').trim();
  const rawBody = String(channel === 'sms' ? (cfg.smsBody || '') : (cfg.body || '')).trim();

  if (!rawBody) return { enabled, subject: rawSubject, body: '', custom: false };

  // Rule 2: custom copy must still carry the facts it exists to deliver.
  const missing = def.requiredTokens.filter((t) => !rawBody.includes(t));
  if (missing.length > 0) {
    return {
      enabled, subject: rawSubject, body: '', custom: false,
      overrideRejected: `Custom copy is missing ${missing.join(', ')} — the built-in wording was used instead.`,
    };
  }
  return { enabled, subject: rawSubject, body: rawBody, custom: true };
}

/** Merge tokens into copy. Unknown tokens render EMPTY rather than leaking
 *  `{{whatever}}` to a client — a stray token is the owner's typo, and the
 *  client should never see the machinery. */
export function renderMessage(template: string, tokens: Record<string, string | number | null | undefined>): string {
  return String(template || '').replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (_m, name) => {
    const v = tokens[String(name).toLowerCase()];
    return v === null || v === undefined ? '' : String(v);
  }).replace(/[ \t]{2,}/g, ' ').trim();
}

/** Edit-time validation for the settings screen. */
export function validateOverride(kind: string, body: string): { ok: boolean; error?: string } {
  const def = MESSAGE_KIND_BY_ID[kind];
  if (!def) return { ok: true };
  const text = String(body || '').trim();
  if (!text) return { ok: true }; // empty = use the built-in
  const missing = def.requiredTokens.filter((t) => !text.includes(t));
  if (missing.length > 0) {
    return { ok: false, error: `Keep ${missing.join(' and ')} in the message — without it the client is missing the point of the message.` };
  }
  const unknown = (text.match(/\{\{\s*[a-z0-9_]+\s*\}\}/gi) || [])
    .map((t) => t.replace(/\s/g, ''))
    .filter((t) => !def.tokens.map((x) => x.replace(/\s/g, '')).includes(t));
  if (unknown.length > 0) {
    return { ok: false, error: `${unknown[0]} is not available for this message — it would come out blank.` };
  }
  return { ok: true };
}


// ═════════════════════════════════════════════════════════════════════════════
// THE GATE FOR DIRECT SENDERS
//
// sendNotification enforces policy for everything that goes through it. But a
// good half of the app's mail is composed by the sender itself — retail order
// mail with its shop-branded shell, renter portal mail, receipts — and routing
// those through a generic helper would flatten the very branding that makes
// them look like the business.
//
// So instead of moving them, this gate goes TO them: three lines at the top of
// any direct sender, and that sender is policy-governed without giving up its
// own HTML.
//
//     const gate = await gateMessage(db, tenantId, 'return_update');
//     if (!gate.send) return { ok: false, reason: gate.reason };
//     ... existing branded send, unchanged ...
//
// Mandatory kinds can never come back `send: false`, so wiring the gate into a
// sender can never accidentally silence a message a person has a right to.

export interface MessageGate {
  send: boolean;
  reason: string;
  /** Owner's custom copy, already merged, when they wrote their own. Senders
   *  that can use a plain body may; senders with rich layouts may ignore it
   *  and simply respect `send`. */
  body: string;
  subject: string;
}

export async function gateMessage(
  db: any,
  tenantId: string,
  kind: string,
  opts?: { channel?: MessageChannel; tokens?: Record<string, string | number | null | undefined>; tenant?: any },
): Promise<MessageGate> {
  const channel = opts?.channel || 'email';
  let tenant = opts?.tenant;
  if (!tenant) {
    try {
      const snap = await db.collection('tenants').doc(tenantId).get();
      tenant = snap.exists ? snap.data() : {};
    } catch {
      // Fail OPEN: a policy lookup that breaks must never swallow a message.
      return { send: true, reason: 'policy unavailable', body: '', subject: '' };
    }
  }
  const p = resolveMessagePolicy(tenant, kind, channel);
  if (!p.enabled) return { send: false, reason: `${kind} is switched off in message settings`, body: '', subject: '' };
  const tokens = opts?.tokens || {};
  return {
    send: true,
    reason: p.overrideRejected || 'ok',
    body: p.custom && p.body ? renderMessage(p.body, tokens) : '',
    subject: p.subject ? renderMessage(p.subject, tokens) : '',
  };
}


// ═════════════════════════════════════════════════════════════════════════════
// COPY + TIMING RESOLUTION
//
// One call answers "should this send, when, and in exactly what words" — and
// it ALWAYS returns copy. The catalog default is real, editable text rather
// than a hidden string inside a route, so there is no wording in the product
// the owner cannot see and change.

export interface MessageTimingConfig {
  /** 'immediate' kinds ignore this. */
  offsetHours: number;
  /** Which side of the anchor. Fixed per kind; surfaced for the UI's wording. */
  timing: 'immediate' | 'before_event' | 'after_event';
  anchor: string;
}

export function resolveMessageTiming(tenant: any, kind: string): MessageTimingConfig {
  const def = MESSAGE_KIND_BY_ID[kind];
  const cfg = ((tenant && tenant.messagePolicy) || {})[kind] || {};
  if (!def) return { offsetHours: 0, timing: 'immediate', anchor: '' };
  const stored = Number(cfg.offsetHours);
  return {
    offsetHours: Number.isFinite(stored) && stored >= 0 ? stored : (def.defaultOffsetHours || 0),
    timing: def.timing,
    anchor: def.offsetAnchor || '',
  };
}

/** Shop-wide quiet hours. A text at 3am is not a service, and this is the one
 *  setting that protects every kind at once rather than per-message. */
export interface QuietHours { enabled: boolean; startHour: number; endHour: number }

export function resolveQuietHours(tenant: any): QuietHours {
  const q = (tenant && tenant.messageQuietHours) || {};
  const h = (v: any, d: number) => {
    const n = Number(v);
    return Number.isInteger(n) && n >= 0 && n <= 23 ? n : d;
  };
  return { enabled: q.enabled === true, startHour: h(q.startHour, 21), endHour: h(q.endHour, 8) };
}

/** Is `date` inside quiet hours? Handles the overnight wrap (21:00 → 08:00). */
export function inQuietHours(qh: QuietHours, date: Date): boolean {
  if (!qh.enabled) return false;
  const h = date.getHours();
  return qh.startHour > qh.endHour
    ? (h >= qh.startHour || h < qh.endHour)   // wraps midnight
    : (h >= qh.startHour && h < qh.endHour);
}

export interface ResolvedMessage {
  send: boolean;
  reason: string;
  subject: string;
  body: string;
  /** True when the owner wrote this wording; false = the shipped default. */
  custom: boolean;
  timing: MessageTimingConfig;
}

/**
 * The full resolution. `body` is never empty for a known kind — custom copy
 * when it is valid, the catalog default otherwise.
 */
export function resolveMessage(
  tenant: any,
  kind: string,
  tokens: Record<string, string | number | null | undefined> = {},
  channel: MessageChannel = 'email',
): ResolvedMessage {
  const def = MESSAGE_KIND_BY_ID[kind];
  const policy = resolveMessagePolicy(tenant, kind, channel);
  const timing = resolveMessageTiming(tenant, kind);

  if (!def) {
    return { send: policy.enabled, reason: 'unknown kind', subject: '', body: '', custom: false, timing };
  }
  const subjectTpl = policy.subject || def.defaultSubject;
  const bodyTpl = policy.custom && policy.body ? policy.body : def.defaultBody;
  return {
    send: policy.enabled,
    reason: policy.overrideRejected || 'ok',
    subject: renderMessage(subjectTpl, tokens),
    body: renderMessage(bodyTpl, tokens),
    custom: policy.custom,
    timing,
  };
}

/** Cleans a rendered body for display: collapses the blank lines left behind
 *  when an optional token (a decline reason, a staff name) renders empty. */
export function tidyBody(body: string): string {
  return String(body || '')
    .split('\n')
    .map((l) => l.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}


// ═════════════════════════════════════════════════════════════════════════════
// CARD FAILURES — saying what happened without diagnosing someone's bank
//
// Stripe tells us WHY a card failed. That fact is useful to the client only
// when it changes what they should DO, so the map below converts a decline
// code into an action, not an explanation. "Your bank declined it" helps
// nobody; "this card has expired — add another" is a next step.
//
// retryable marks failures where the SAME card might work later (a temporary
// hold, a daily limit). An expired or reported card will never work again, so
// retrying is just a second failure with the client's hope attached.

export interface CardFailure {
  code: string;
  /** One sentence, actionable, no speculation about their finances. */
  guidance: string;
  retryable: boolean;
  /** True when the card itself must be replaced, not just paid around. */
  needsNewCard: boolean;
}

const CARD_FAILURES: Record<string, Omit<CardFailure, 'code'>> = {
  expired_card:        { guidance: 'That card has expired. Please pay with a current card.', retryable: false, needsNewCard: true },
  incorrect_cvc:       { guidance: 'The security code did not match. Please re-enter the card.', retryable: false, needsNewCard: true },
  incorrect_number:    { guidance: 'The card number was not accepted. Please re-enter the card.', retryable: false, needsNewCard: true },
  card_declined:       { guidance: 'The card was declined. Please pay with another card.', retryable: false, needsNewCard: true },
  insufficient_funds:  { guidance: 'The card was declined for insufficient funds. You can pay with another card, or we can try this one again later.', retryable: true, needsNewCard: false },
  withdrawal_count_limit_exceeded: { guidance: 'The card hit a limit set by the bank. Another card will work, or we can try again later.', retryable: true, needsNewCard: false },
  processing_error:    { guidance: 'The payment could not be processed just now. We will try again shortly.', retryable: true, needsNewCard: false },
  authentication_required: { guidance: 'Your bank needs you to approve this payment. Please complete it here.', retryable: false, needsNewCard: false },
  lost_card:           { guidance: 'That card cannot be used. Please pay with another card.', retryable: false, needsNewCard: true },
  stolen_card:         { guidance: 'That card cannot be used. Please pay with another card.', retryable: false, needsNewCard: true },
  no_card_on_file:     { guidance: 'There is no card on file to charge.', retryable: false, needsNewCard: true },
  network:             { guidance: 'We could not reach the payment processor. We will try again shortly.', retryable: true, needsNewCard: false },
};

export function classifyCardFailure(code?: string | null, declineCode?: string | null): CardFailure {
  const c = String(declineCode || code || '').toLowerCase().trim();
  const hit = CARD_FAILURES[c];
  if (hit) return { code: c, ...hit };
  return {
    code: c || 'charge_failed',
    guidance: 'The payment did not go through. Please pay with another card.',
    retryable: false,
    needsNewCard: true,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// HOW LONG AN UNPAID-BUT-ACCEPTED APPOINTMENT KEEPS ITS TIME
//
// The 30-minute checkout hold is right for someone sitting at the payment
// screen. It is wrong for a card that failed during an approval the client
// was not present for — they may be at work, or asleep, and losing the slot
// while they had no idea anything went wrong is not a policy, it is an
// accident. So an accepted booking gets its own, longer, configurable grace.

export function resolvePaymentGraceHours(tenant: any): number {
  const v = Number((tenant && tenant.bookingMode || {}).paymentGraceHours);
  return Number.isFinite(v) && v >= 0 ? v : 24;
}

/** The moment an unpaid accepted booking stops holding its slot. Never later
 *  than the appointment itself — holding a slot past its own start time is
 *  nonsense. Returns null when the shop grants unlimited grace. */
export function paymentDueAt(
  acceptedAtIso: string,
  graceHours: number,
  appointmentStartIso?: string | null,
): string | null {
  if (graceHours <= 0) return null;
  const base = Date.parse(acceptedAtIso);
  if (!Number.isFinite(base)) return null;
  let due = base + graceHours * 3600000;
  const start = appointmentStartIso ? Date.parse(appointmentStartIso) : NaN;
  if (Number.isFinite(start) && start < due) due = start;
  return new Date(due).toISOString();
}


// ═════════════════════════════════════════════════════════════════════════════
// INTERNAL CALL ORIGIN
//
// Server code that calls another of our own routes needs a base URL, and the
// obvious choice — the incoming request's origin — is wrong in two situations
// that both happen in production: a cron run has no incoming request at all,
// and a preview/proxy origin can differ from where the app actually serves.
// A deposit that silently fell back to "send them a pay link" because the
// origin was off is the kind of failure nobody reports and everybody feels.
//
// Order of trust: what the tenant declares > the platform's production URL >
// the request we happen to be handling.

export function internalOrigin(tenant?: any, requestOrigin?: string | null): string {
  const candidates = [
    tenant?.publicOrigin,
    process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '',
    process.env.NEXT_PUBLIC_APP_URL,
    requestOrigin,
  ];
  for (const c of candidates) {
    const v = String(c || '').trim().replace(/\/+$/, '');
    if (/^https?:\/\/.+/.test(v)) return v;
  }
  return '';
}

/** POST to one of our own routes with a bounded wait and one retry on a
 *  transport failure. A cold serverless start can exceed a default fetch's
 *  patience; a single retry costs a second and saves the charge. */
export async function internalPost(
  origin: string,
  path: string,
  body: any,
  opts?: { timeoutMs?: number; retries?: number },
): Promise<{ ok: boolean; status: number; data: any; transportError?: string }> {
  const timeoutMs = opts?.timeoutMs ?? 15000;
  const retries = opts?.retries ?? 1;
  if (!origin) return { ok: false, status: 0, data: {}, transportError: 'no origin configured' };

  let lastErr = '';
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${origin}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      const data = await res.json().catch(() => ({}));
      // A 5xx is worth one retry; a 4xx is a real answer and must not be.
      if (res.status >= 500 && attempt < retries) { lastErr = `server ${res.status}`; continue; }
      return { ok: res.ok, status: res.status, data };
    } catch (e: any) {
      clearTimeout(timer);
      lastErr = e?.name === 'AbortError' ? 'timed out' : String(e?.message || e).slice(0, 80);
      // Retry transport failures only.
    }
  }
  return { ok: false, status: 0, data: {}, transportError: lastErr };
}
