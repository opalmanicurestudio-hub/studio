// src/lib/notice-record.ts — A RENTER'S MESSAGES AND NOTICES, ONE RECORD.
//
// Everything the business sends a renter by email or text lands in the message log (lib/notify, lib/sms) word for word,
// sent or not and why, and the log can't be edited or deleted (firestore.rules: messageLog is written by the server
// only). Their conversation with the business is its own thread (renterThreads/{id}/messages). This module reads both
// and returns ONE list: each notice once, with every copy of it (the email, the text) and how far each got, when they
// saw it in their portal, and the exact words.
//
//   Owner: the renter's Messages and notices (components/renters/RenterNoticeRecord), and its printed copy
//          (api/booths/notice-record).
//   Renter: their portal's inbox (forRenter), where formal notices always appear, even when the email or text didn't
//          get through. Opening one there records that they've seen it.
//   Timeline: the renter's account timeline shows each message once (lib/renter-timeline).
//
// Pure: give it the log entries and the thread, get back the record. It writes nothing.

export type NoticeCategory = 'notice' | 'money' | 'conversation' | 'account' | 'other';

export type NoticeCopy = {
  logId: string;
  channel: 'email' | 'sms';
  to: string;
  /** How far it got: delivered and opened come from the provider's reports. */
  state: 'opened' | 'delivered' | 'sent' | 'held' | 'bounced' | 'failed' | 'not_sent';
  sentAt: string;
  deliveredAt: string | null;
  openedAt: string | null;
  bouncedAt: string | null;
  /** Why it didn't get there, in the provider's or the app's words. */
  why: string | null;
  /** This copy's own words (an email and a text of the same notice say it differently). */
  subject: string | null;
  body: string;
  fingerprint: string | null;
};

export type NoticeItem = {
  id: string;
  at: string;
  kind: string;
  category: NoticeCategory;
  /** A formal notice: one their lease relies on. Always in their portal, sent or not. */
  formal: boolean;
  direction: 'out' | 'in';
  title: string;
  subject: string | null;
  /** Exactly what was sent: the email's words when there was an email, otherwise the text's. */
  body: string;
  copies: NoticeCopy[];
  portalSeenAt: string | null;
  /** Who sent it: a person, or 'automatic' for the business's own scheduled messages. */
  sentBy: string | null;
  /** The conversation message this is, when it is one. */
  threadId: string | null;
  /** At least one copy went out. */
  went: boolean;
  /** A copy that failed, bounced or wasn't sent. */
  trouble: boolean;
  /** Not sent only because the business switched this message off in message settings. */
  switchedOff: boolean;
  fingerprint: string | null;
};

// ── What each kind is ────────────────────────────────────────────────────────
// Formal notices: the ones a lease relies on (late rent, escalation, booking paused, a deposit kept or applied, a charge
// added, leave decided, renewal, paperwork that lapses).
const FORMAL = new Set([
  'rent_overdue', 'rent_dunning', 'renter_barred_notice', 'lease_renewal', 'renewal_offer', 'violation_notice',
  'leave_approved', 'leave_declined', 'deposit_notice', 'renter_charge_added', 'renter_credential_expiring', 'renter_paperwork_missing',
]);
const MONEY = new Set([
  'rent_receipt', 'renter_refund', 'renter_charge', 'renter_credit', 'rent_invoiced', 'rent_invoice', 'rent_charge_upcoming',
  'renter_rent_due', 'rent_failed', 'station_booking_confirmed', 'renter_incidental', 'rent_pay_link',
]);
const CONVERSATION = new Set([
  'renter_message', 'renter_broadcast', 'grievance_received', 'renter_ticket_update', 'renter_day_swap', 'leave_ended',
]);
const ACCOUNT = new Set(['renter_signin_code', 'renter_portal_invite']);
// Sent by the business's own schedule, not by a person.
const AUTOMATIC = new Set([
  'rent_overdue', 'rent_dunning', 'renter_rent_due', 'rent_receipt', 'rent_failed', 'renter_credential_expiring', 'renter_paperwork_missing',
  'rent_invoiced', 'rent_charge_upcoming', 'lease_renewal', 'leave_ended', 'renter_signin_code', 'renter_refund',
  'renter_charge', 'renter_incidental',
]);

const LABEL: Record<string, string> = {
  renter_paperwork_missing: 'License or insurance needed', rent_overdue: 'Late rent notice', rent_dunning: 'Rent notice', renter_barred_notice: 'Booking paused',
  lease_renewal: 'Lease renewal', renewal_offer: 'Renewal offer', violation_notice: 'Notice about the rules',
  leave_approved: 'Time away approved', leave_declined: 'Time away request', leave_ended: 'Welcome back',
  deposit_notice: 'Security deposit', renter_charge_added: 'Charge added', renter_credential_expiring: 'License or insurance',
  rent_receipt: 'Rent receipt', renter_refund: 'Refund', renter_charge: 'Agreed charge', renter_credit: 'Waived or credited',
  rent_invoiced: 'Rent bill', rent_invoice: 'Rent bill', rent_charge_upcoming: 'Rent charge coming up', renter_rent_due: 'Rent reminder',
  rent_failed: 'Rent payment didn’t go through', station_booking_confirmed: 'Booking confirmed', renter_incidental: 'Charge',
  renter_message: 'Message', renter_broadcast: 'Message to every renter', grievance_received: 'Your concern',
  renter_ticket_update: 'Maintenance', renter_day_swap: 'Day swap', renter_signin_code: 'Sign-in code',
  renter_portal_invite: 'Portal link', rent_pay_link: 'What you owe',
};

export function noticeCategory(kind: string): NoticeCategory {
  const k = String(kind || '');
  if (FORMAL.has(k)) return 'notice';
  if (MONEY.has(k)) return 'money';
  if (CONVERSATION.has(k)) return 'conversation';
  if (ACCOUNT.has(k)) return 'account';
  if (/notice|violation|terminat|evict|renewal/.test(k)) return 'notice';
  if (/receipt|refund|invoice|charge|credit|payment|deposit|autopay/.test(k)) return 'money';
  return 'other';
}
export const isFormalKind = (kind: string): boolean => noticeCategory(kind) === 'notice';
export const noticeLabel = (kind: string): string => LABEL[String(kind || '')] || String(kind || 'message').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

// A message the business sends a renter about their space, their rent or their account. (Not the renter's own messages
// to their clients, which also pass through the log: those carry renterId as the sender, lib/renter-inbox.)
export function isRenterKind(kind: string): boolean {
  const k = String(kind || '');
  if (/^renter_(client|campaign)/.test(k)) return false;
  return k in LABEL || /^(renter_|rent_|lease_|deposit_|leave_|renewal_|violation_|grievance_|station_)/.test(k);
}

const digits10 = (v: unknown) => String(v || '').replace(/\D/g, '').slice(-10);

/** Does this log entry belong on this renter's record? Addressed to them by id, or to their email or phone with a
 *  renter message. Never a message they sent their own clients, one to them as a client or a team member, or one
 *  addressed to someone else who shares their email or phone (another renter, a prospect on a tour). `otherRenters`:
 *  the business's other renters, when known, so an entry naming one of them is never shown here. */
export function belongsToRenter(row: any, renterId: string, renter: any, otherRenters?: Set<string>): boolean {
  if (!row) return false;
  const rid = String(renterId);
  const to = row.recipientId ? String(row.recipientId) : '';
  if (row.renterId && to !== rid) return false;   // sent on a renter's behalf, to their client (lib/renter-inbox)
  // To them as a client, a team member or a maintenance worker: not a message about their space.
  if (row.recipientType === 'client' || row.recipientType === 'staff' || row.recipientType === 'maintenance') return false;
  if (to === rid) return true;
  // Addressed to someone else: another renter or a contact (a prospect's tour, say) is theirs, even at the same address.
  if (to && (row.recipientType === 'renter' || row.recipientType === 'contact' || otherRenters?.has(to))) return false;
  const addr = String(row.to || '').trim().toLowerCase();
  const email = String(renter?.email || '').trim().toLowerCase();
  const phone = digits10(renter?.phone);
  const mine = (email && addr === email) || (!addr.includes('@') && phone.length === 10 && digits10(addr) === phone);
  if (!mine) return false;
  return row.recipientType === 'renter' || isRenterKind(row.kind);
}

const stamp = (v: any): string => {
  if (!v) return '';
  if (typeof v === 'string') return v;
  if (typeof v?.toDate === 'function') { try { return v.toDate().toISOString(); } catch { return ''; } }
  if (typeof v?.seconds === 'number') return new Date(v.seconds * 1000).toISOString();
  return '';
};
const ms = (v: any) => Date.parse(stamp(v)) || 0;

function copyOf(row: any): NoticeCopy {
  const st = String(row.status || '');
  const state: NoticeCopy['state'] = row.bouncedAt ? 'bounced'
    : st === 'failed' ? 'failed'
      : st.startsWith('skipped') ? (row.held ? 'held' : 'not_sent')
        : row.openedAt || row.clickedAt ? 'opened' : row.deliveredAt ? 'delivered' : 'sent';
  return {
    logId: String(row.id || ''),
    channel: row.channel === 'sms' ? 'sms' : 'email',
    to: String(row.to || ''),
    state,
    sentAt: stamp(row.sentAt),
    deliveredAt: stamp(row.deliveredAt) || null,
    openedAt: stamp(row.openedAt || row.clickedAt) || null,
    bouncedAt: stamp(row.bouncedAt) || null,
    why: ['bounced', 'failed', 'not_sent', 'held'].includes(state) ? (String(row.failureDetail || row.error || '').trim() || null) : null,
    subject: row.subject ? String(row.subject) : null,
    // What reached them: a text's own words with the business's name in front (lib/sms sentText), an email's words.
    body: String(row.sentText || row.body || row.preview || ''),
    fingerprint: row.fingerprint ? String(row.fingerprint) : null,
  };
}
const WENT: NoticeCopy['state'][] = ['opened', 'delivered', 'sent'];
const TROUBLE: NoticeCopy['state'][] = ['bounced', 'failed', 'not_sent'];
const switchedOffCopy = (c: NoticeCopy) => c.state === 'not_sent' && /message settings/i.test(String(c.why || ''));

function firstLine(s: string): string {
  const line = String(s || '').split('\n').map((x) => x.trim()).find(Boolean) || '';
  return line.length > 80 ? `${line.slice(0, 77).trimEnd()}…` : line;
}

function itemFrom(rows: any[], o: { kind: string; at: string; sentBy?: string | null; threadId?: string | null; text?: string | null; direction?: 'out' | 'in' }): NoticeItem {
  const copies = rows.map(copyOf).sort((a, b) => (a.channel === b.channel ? 0 : a.channel === 'email' ? -1 : 1));
  const primary = copies.find((c) => c.channel === 'email') || copies[0] || null;
  const kind = o.kind;
  const category: NoticeCategory = o.threadId ? 'conversation' : noticeCategory(kind);
  const body = o.text != null ? String(o.text) : (primary?.body || '');
  const subject = o.threadId ? null : (primary?.subject || null);
  const seen = rows.map((r) => stamp(r.portalSeenAt)).filter(Boolean).sort()[0] || null;
  const went = copies.some((c) => WENT.includes(c.state));
  const fromByName = rows.map((r) => String(r.sentBy || '').trim()).find(Boolean) || null;
  return {
    id: o.threadId ? `t_${o.threadId}` : String(primary?.logId || rows[0]?.id || ''),
    at: o.at,
    kind,
    category,
    formal: !o.threadId && isFormalKind(kind),
    direction: o.direction || 'out',
    title: o.threadId ? firstLine(body) : (subject || `${noticeLabel(kind)}${primary?.body ? ` · ${firstLine(primary.body).slice(0, 60)}` : ''}`),
    subject,
    body,
    copies,
    portalSeenAt: seen,
    sentBy: o.sentBy || fromByName || (AUTOMATIC.has(kind) ? 'automatic' : null),
    threadId: o.threadId || null,
    went,
    trouble: copies.some((c) => TROUBLE.includes(c.state) && !switchedOffCopy(c)),
    switchedOff: copies.length > 0 && copies.every(switchedOffCopy),
    fingerprint: primary?.fingerprint || null,
  };
}

/** Which log entries carry each conversation message: linked by id (new), or for older messages, the email and the
 *  text of a message to this renter sent within two minutes of it. Returns threadMessageId → entries. */
export function threadCopies(thread: any[], rows: any[]): Map<string, any[]> {
  const out = new Map<string, any[]>();
  const ids = new Set((thread || []).map((m) => String(m.id || '')));
  const used = new Set<string>();
  for (const r of rows || []) {
    const t = String(r.threadMessageId || '');
    if (t && ids.has(t)) { out.set(t, [...(out.get(t) || []), r]); used.add(String(r.id)); }
  }
  const loose = (rows || []).filter((r) => !used.has(String(r.id)) && !r.threadMessageId && ['renter_message', 'renter_broadcast'].includes(String(r.kind)));
  // An older copy carries the message's own words (the email in full, the text up to its length).
  // Letters and digits only, so quotes and characters an email's markup changed don't get in the way.
  const flat = (v: unknown) => String(v || '').toLowerCase().replace(/&[a-z#0-9]+;/g, '').replace(/[^a-z0-9]+/g, '');
  const carries = (r: any, m: any) => {
    const head = flat(m.text).slice(0, 30);
    if (head.length >= 6) return flat(r.body).includes(head);
    const raw = String(m.text || '').trim();   // a very short message, or one in another alphabet: its exact words, whole
    if (!raw) return false;
    const esc = raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[\\s:,])${esc}($|[\\s.,!?])`).test(String(r.body || ''));
  };
  for (const m of [...(thread || [])].sort((a, b) => ms(a.createdAt) - ms(b.createdAt))) {
    if (m.direction === 'inbound' || out.has(String(m.id))) continue;
    if (m.emailLogId) {
      const e = loose.find((r) => String(r.id) === String(m.emailLogId) && !used.has(String(r.id)));
      if (e) { out.set(String(m.id), [e]); used.add(String(e.id)); }
    }
    const at = ms(m.createdAt);
    for (const ch of ['email', 'sms']) {
      if ((out.get(String(m.id)) || []).some((r) => (r.channel === 'sms' ? 'sms' : 'email') === ch)) continue;
      const near = loose.filter((r) => !used.has(String(r.id)) && (r.channel === 'sms' ? 'sms' : 'email') === ch && Math.abs(ms(r.sentAt) - at) <= 120000 && carries(r, m))
        .sort((a, b) => Math.abs(ms(a.sentAt) - at) - Math.abs(ms(b.sentAt) - at))[0];
      if (near) { out.set(String(m.id), [...(out.get(String(m.id)) || []), near]); used.add(String(near.id)); }
    }
  }
  return out;
}

/** The record: every notice once (its email and text together), and the conversation, newest first. */
export function buildNoticeRecord(input: { rows: any[]; thread?: any[]; renterName?: string | null }): NoticeItem[] {
  const all = (input.rows || []).filter((r) => r && r.id && stamp(r.sentAt)).sort((a, b) => ms(a.sentAt) - ms(b.sentAt));
  // A text held for quiet hours and then sent (or found too late to send) when they ended is one attempt, not two: the
  // held entry gives way to what happened to it, and lends that its id, so the notice keeps its id and seen time.
  const heldFor = new Map<string, string>();
  const later = (h: any) => all.find((r) => r !== h && !r.held && r.kind === h.kind && r.channel === h.channel && String(r.to) === String(h.to)
    && String(r.body || '') === String(h.body || '') && ms(r.sentAt) >= ms(h.sentAt) && ms(r.sentAt) - ms(h.sentAt) <= (r.heldExpired ? 48 : 17) * 3600e3 && !heldFor.has(String(r.id)));
  const gone = new Set<string>();
  for (const h of all) { if (!h.held) continue; const r = later(h); if (r) { heldFor.set(String(r.id), String(h.id)); gone.add(String(h.id)); } }
  const rows = all.filter((r) => !gone.has(String(r.id))).map((r) => (heldFor.has(String(r.id)) ? { ...r, portalSeenAt: r.portalSeenAt || all.find((h) => String(h.id) === heldFor.get(String(r.id)))?.portalSeenAt || null } : r));
  const idOf = (r: any) => heldFor.get(String(r.id)) || String(r.id);

  const thread = input.thread || [];
  const linked = threadCopies(thread, rows);
  const taken = new Set<string>(); for (const list of linked.values()) for (const r of list) taken.add(String(r.id));
  const items: NoticeItem[] = [];

  for (const m of thread) {
    const inbound = m.direction === 'inbound';
    const at = stamp(m.createdAt); if (!at) continue;
    items.push(itemFrom(linked.get(String(m.id)) || [], {
      kind: inbound ? 'renter_reply' : m.broadcastId ? 'renter_broadcast' : 'renter_message', at, threadId: String(m.id), text: String(m.text || ''),
      sentBy: inbound ? (m.byName || input.renterName || 'Renter') : (m.byName || null), direction: inbound ? 'in' : 'out',
    }));
  }

  // The email and the text of one notice go out together: the same kind within ten minutes, one of each channel (or
  // tied by the caller's own key). The notice's id is its first copy's, so it stays the same when the second lands.
  type G = { rows: any[]; at: number; kind: string; key: string };
  const groups: G[] = [];
  for (const r of rows.filter((x) => !taken.has(String(x.id)))) {
    const t = ms(r.sentAt); const ch = r.channel === 'sms' ? 'sms' : 'email'; const key = String(r.noticeKey || '');
    const g = groups.find((x) => key ? x.key === key
      : !x.key && x.kind === r.kind && Math.abs(t - x.at) <= 10 * 60e3 && !x.rows.some((y) => (y.channel === 'sms' ? 'sms' : 'email') === ch));
    if (g) g.rows.push(r); else groups.push({ rows: [r], at: t, kind: String(r.kind || ''), key });
  }
  for (const g of groups) items.push({ ...itemFrom(g.rows, { kind: g.kind, at: stamp(g.rows[0].sentAt) }), id: idOf(g.rows[0]) });

  return items.sort((a, b) => b.at.localeCompare(a.at));
}

/** What the renter sees in their portal: everything that went to them, and every formal notice even when it didn't get
 *  through (a lease relies on it). Not sign-in codes, not a message the business switched off, and not the
 *  conversation, which their portal shows as itself. */
export function forRenter(items: NoticeItem[]): NoticeItem[] {
  return items.filter((i) => !i.threadId && i.category !== 'account' && !i.switchedOff && (i.went || i.formal || i.copies.some((c) => c.state === 'held')));
}

/** A link to their own portal whose sign-in is hidden on the record (lib/code-redact) still opens their portal: they
 *  read it there signed in already, so the hidden part is simply left off. */
export function plainLinks(text: string): string {
  return String(text || '').replace(/\?rt=••••(&amp;|&)/g, '?').replace(/(\?|&amp;|&)rt=••••/g, '');
}

/** The renter's portal copy of one item: their own words, without the delivery details meant for the business. */
export function renterView(i: NoticeItem): { id: string; at: string; kind: string; category: NoticeCategory; formal: boolean; title: string; body: string; seenAt: string | null; channels: string[] } {
  return {
    id: i.id, at: i.at, kind: i.kind, category: i.category, formal: i.formal, title: plainLinks(i.title), body: plainLinks(i.body), seenAt: i.portalSeenAt,
    channels: [...new Set(i.copies.filter((c) => WENT.includes(c.state)).map((c) => (c.channel === 'sms' ? 'text' : 'email')))],
  };
}

// ── Plain words for each copy, for the owner's record ─────────────────────────
const CH = { email: 'Email', sms: 'Text' } as const;
export function copyWords(c: NoticeCopy, time: (iso: string) => string): string {
  const ch = CH[c.channel];
  switch (c.state) {
    case 'opened': return `${ch} opened ${time(c.openedAt || c.sentAt)}`;
    case 'delivered': return `${ch} delivered ${time(c.deliveredAt || c.sentAt)}`;
    case 'sent': return `${ch} sent ${time(c.sentAt)}`;
    case 'held': return `${ch} held until quiet hours end`;
    case 'bounced': return `${ch} bounced`;
    case 'failed': return `${ch} didn’t go`;
    default: return `${ch} not sent`;
  }
}

export const CATEGORY_LABEL: Record<NoticeCategory, string> = {
  notice: 'Written notice', money: 'Money', conversation: 'Conversation', account: 'Account', other: 'Message',
};
