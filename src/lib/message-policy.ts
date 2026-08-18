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
  },
  {
    id: 'booking_hold', group: 'Booking', label: 'Slot held, deposit needed',
    when: 'A booking is waiting on a deposit before it is confirmed.',
    channels: ['email', 'sms'], canDisable: false,
    mandatoryNote: 'They are holding a time that is not theirs yet — they have to be told what is needed.',
    tokens: ['{{client_first}}', '{{service}}', '{{when}}', '{{amount}}', '{{link}}', '{{studio}}'],
    requiredTokens: ['{{link}}'],
  },
  {
    id: 'booking_request', group: 'Booking', label: 'Request received',
    when: 'Approval mode: a client asks for a time.',
    channels: ['email', 'sms'], canDisable: true,
    tokens: ['{{client_first}}', '{{service}}', '{{when}}', '{{amount}}', '{{studio}}', '{{link}}'],
    requiredTokens: [],
  },
  {
    id: 'request_accepted', group: 'Booking', label: 'Request accepted',
    when: 'You accept a booking request.',
    channels: ['email', 'sms'], canDisable: false,
    mandatoryNote: 'They asked for a time and are waiting on the answer.',
    tokens: ['{{client_first}}', '{{service}}', '{{when}}', '{{amount}}', '{{link}}', '{{studio}}'],
    requiredTokens: ['{{when}}'],
  },
  {
    id: 'request_declined', group: 'Booking', label: 'Request declined',
    when: 'You decline a booking request, or it expires unanswered.',
    channels: ['email', 'sms'], canDisable: false,
    mandatoryNote: 'Somebody is keeping that time free for you. Not telling them is the one unforgivable version of this feature.',
    tokens: ['{{client_first}}', '{{when}}', '{{reason}}', '{{link}}', '{{studio}}'],
    requiredTokens: [],
  },
  {
    id: 'appointment_reminder', group: 'Reminders', label: 'Appointment reminder',
    when: 'Ahead of the visit, on your reminder schedule.',
    channels: ['email', 'sms'], canDisable: true,
    tokens: ['{{client_first}}', '{{service}}', '{{when}}', '{{staff}}', '{{link}}', '{{studio}}'],
    requiredTokens: ['{{when}}'],
  },
  {
    id: 'deposit_charged', group: 'Money', label: 'Deposit charged',
    when: 'A deposit is taken from a card on file.',
    channels: ['email', 'sms'], canDisable: false,
    mandatoryNote: 'You moved money. A charge nobody was told about is how chargebacks start.',
    tokens: ['{{client_first}}', '{{amount}}', '{{when}}', '{{service}}', '{{link}}', '{{studio}}'],
    requiredTokens: ['{{amount}}'],
  },
  {
    id: 'deposit_failed', group: 'Money', label: 'Card declined',
    when: 'A card on file is declined.',
    channels: ['email', 'sms'], canDisable: false,
    mandatoryNote: 'They think they are paid up. Only this message tells them otherwise.',
    tokens: ['{{client_first}}', '{{amount}}', '{{when}}', '{{link}}', '{{studio}}'],
    requiredTokens: ['{{link}}'],
  },
  {
    id: 'refund_issued', group: 'Money', label: 'Refund sent',
    when: 'Money goes back to a client.',
    channels: ['email'], canDisable: false,
    mandatoryNote: 'Refund timing questions are the most common support message there is. This one prevents them.',
    tokens: ['{{client_first}}', '{{amount}}', '{{studio}}', '{{link}}'],
    requiredTokens: ['{{amount}}'],
  },
  {
    id: 'receipt', group: 'Money', label: 'Receipt',
    when: 'A sale is completed and the client asks for it by email.',
    channels: ['email'], canDisable: true,
    tokens: ['{{client_first}}', '{{amount}}', '{{when}}', '{{studio}}'],
    requiredTokens: ['{{amount}}'],
  },
  {
    id: 'order_shipped', group: 'Retail', label: 'Order on its way',
    when: 'A carrier scans a shop order.',
    channels: ['email'], canDisable: true,
    tokens: ['{{client_first}}', '{{order_number}}', '{{carrier}}', '{{link}}', '{{studio}}'],
    requiredTokens: ['{{link}}'],
  },
  {
    id: 'order_delayed', group: 'Retail', label: 'Delivery running late',
    when: 'The carrier moves its own delivery estimate, or a parcel stops scanning.',
    channels: ['email'], canDisable: true,
    tokens: ['{{client_first}}', '{{order_number}}', '{{carrier}}', '{{when}}', '{{link}}', '{{studio}}'],
    requiredTokens: [],
  },
  {
    id: 'renter_signin_code', group: 'Renters', label: 'Renter sign-in code',
    when: 'A booth renter asks for a code to open their portal.',
    channels: ['email', 'sms'], canDisable: false,
    mandatoryNote: 'They asked for it and cannot get into their own portal without it.',
    tokens: ['{{code}}', '{{studio}}', '{{link}}'],
    requiredTokens: ['{{code}}'],
  },
  {
    id: 'renter_credential_expiring', group: 'Renters', label: 'Licence or insurance expiring',
    when: 'A renter\u2019s licence or insurance is approaching its expiry date.',
    channels: ['email', 'sms'], canDisable: false,
    mandatoryNote: 'Working on an expired licence or lapsed insurance is a legal problem for them and for you. They get the warning.',
    tokens: ['{{renter_first}}', '{{document}}', '{{expiry}}', '{{link}}', '{{studio}}'],
    requiredTokens: ['{{expiry}}'],
  },
  {
    id: 'renter_rent_due', group: 'Renters', label: 'Rent reminder',
    when: 'A renter\u2019s booth rent is coming due or is late.',
    channels: ['email', 'sms'], canDisable: true,
    tokens: ['{{renter_first}}', '{{amount}}', '{{when}}', '{{link}}', '{{studio}}'],
    requiredTokens: ['{{amount}}'],
  },
  {
    id: 'renter_ticket_update', group: 'Renters', label: 'Maintenance ticket update',
    when: 'A renter\u2019s maintenance request changes status or gets a reply.',
    channels: ['email'], canDisable: true,
    tokens: ['{{renter_first}}', '{{ticket}}', '{{status}}', '{{link}}', '{{studio}}'],
    requiredTokens: [],
  },
  {
    id: 'support_reply', group: 'Retail', label: 'Reply to a customer message',
    when: 'You answer a customer\u2019s support message.',
    channels: ['email'], canDisable: false,
    mandatoryNote: 'They wrote to you and are waiting. A reply nobody receives is not a reply.',
    tokens: ['{{client_first}}', '{{order_number}}', '{{link}}', '{{studio}}'],
    requiredTokens: [],
  },
  {
    id: 'support_ack', group: 'Retail', label: 'Message received',
    when: 'A customer sends a support message.',
    channels: ['email'], canDisable: true,
    tokens: ['{{client_first}}', '{{order_number}}', '{{case_ref}}', '{{link}}', '{{studio}}'],
    requiredTokens: [],
  },
  {
    id: 'return_update', group: 'Retail', label: 'Return progress',
    when: 'A return is received, resolved, or a label is issued.',
    channels: ['email'], canDisable: false,
    mandatoryNote: 'They posted something back and are owed an answer about it.',
    tokens: ['{{client_first}}', '{{order_number}}', '{{amount}}', '{{link}}', '{{studio}}'],
    requiredTokens: [],
  },
  {
    id: 'claim_decision', group: 'Retail', label: 'Claim decision',
    when: 'You approve or decline a damage, missing, or wrong-item claim.',
    channels: ['email'], canDisable: false,
    mandatoryNote: 'They reported a problem. The decision is the whole point of reporting it.',
    tokens: ['{{client_first}}', '{{order_number}}', '{{amount}}', '{{link}}', '{{studio}}'],
    requiredTokens: [],
  },
  {
    id: 'account_link', group: 'Account', label: 'Sign-in link',
    when: 'A client asks to see their orders.',
    channels: ['email'], canDisable: false,
    mandatoryNote: 'They asked for it and cannot get in without it.',
    tokens: ['{{link}}', '{{studio}}'],
    requiredTokens: ['{{link}}'],
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
