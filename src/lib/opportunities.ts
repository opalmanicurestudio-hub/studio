// src/lib/opportunities.ts — OPPORTUNITIES, phase 1 (design canvas sections 27–30). Rules find a client worth a
// personal word — a regular who's due, a first visit with nothing booked, someone long gone, a cancel or no-show that
// never rebooked, a quote waiting, a gift card sitting unused — and each becomes a TASK WITH A PURPOSE for the right
// person: why, roughly what it's worth (always an estimate), by when, the words to use, and what to do with the answer.
// Pure: the server (lib/opportunities-server) loads the records and saves what this decides.
//
// How it should sound (canvas Op14): warm and professional, from the person who does your nails. Hello first, details
// when they answer; no link in the first text (except a waitlist spot they asked for); urgency only when it's real; an easy way
// out; never the same words twice to one client. Every playbook has several approved versions for that reason.

import { moduleEnabled, type ModuleId } from '@/lib/modules';

export type OppKind = 'due' | 'first_visit' | 'long_gone' | 'cancelled' | 'no_show' | 'no_rebook' | 'quote' | 'gift_card' | 'manual' | 'follow_up';
export type Who = 'provider' | 'desk' | 'owner';
export type OutcomeId = 'booked' | 'interested' | 'not_now' | 'price' | 'no_answer' | 'voicemail' | 'bad_experience' | 'stop' | 'declined' | 'quote_accepted' | 'no_longer_applies' | 'done';

export interface Branch { id: OutcomeId; say: string }
export interface Playbook {
  kind: OppKind; label: string; who: Who; marketing: boolean; priority: 'high' | 'medium' | 'low';
  expiresDays: number; cooldownDays: number; winBack: boolean;
  /** First message — several approved versions; a client never gets one they've had before. */
  versions: string[];
  /** What to say once they answer yes (times come second). */
  next: string;
  branches: Branch[];
  never: string;
  /** Sent automatically (no person waiting to answer, so a one-tap booking link goes in). Empty = person only. */
  auto?: string[];
  /** What the person says when an automatic text got no reply and it comes to them. */
  afterAuto?: string;
}

const B = (id: OutcomeId, say: string): Branch => ({ id, say });
const COMMON = (extra: Branch[] = []): Branch[] => [
  ...extra,
  B('not_now', '“Of course. I will leave it with you. Please text me whenever you are ready.”'),
  B('price', 'Give today’s price for their usual service — the one on your menu, nothing made up.'),
  B('no_answer', 'Leave it. One gentle follow-up at most; silence is an answer too.'),
  B('bad_experience', '“I am very sorry to hear that, and thank you for telling me. May I make it right?” Then stop selling: this opens a Making it right case.'),
  B('stop', '“Of course. You will not hear from us in this way again.” They come off every list.'),
];

export const PLAYBOOKS: Record<OppKind, Playbook> = {
  due: { kind: 'due', label: 'A regular who’s due', who: 'provider', marketing: true, priority: 'high', expiresDays: 14, cooldownDays: 45, winBack: true,
    versions: [
      'Hi {first}, this is {me}. I hope your nails are doing well. I have a few openings next week if you would like to come in. There is no rush at all.',
      'Hi {first}, this is {me}. It has been a little while since your last visit, and I wanted to check in. Would you like me to find you a time for your {service_short}?',
      'Hi {first}, this is {me}. I hope you are doing well. If you are due for your {service_short}, I would be glad to see you. Just let me know and I will send you a few times.',
    ],
    next: 'Offer two real times close to their usual day: “I have Thursday at 2:00 PM or Saturday at 10:00 AM. Which would suit you better?”',
    branches: COMMON([B('booked', '“Wonderful. Your appointment is confirmed, and you will receive a confirmation text shortly.”'), B('interested', '“Thank you. I will send you a few times shortly.” Follow up within a day.')]),
    auto: [
      'Hi {first}, this is {business}. You are due for your {service_short}. Whenever you are ready, you are welcome to book a time that suits you here: {link}',
      'Hi {first}, we hope you are well. If you would like to book your next {service_short}, you can choose a time here: {link}. There is no rush at all.',
    ],
    afterAuto: 'Hi {first}, this is {me}. I am following up on our text from the other day. Would you like me to find you a time?',
    never: '“We miss you!” It is about us, not them.' },
  first_visit: { kind: 'first_visit', label: 'After a first visit', who: 'provider', marketing: false, priority: 'medium', expiresDays: 7, cooldownDays: 365, winBack: true,
    versions: [
      'Hi {first}, this is {me} from {business}. I wanted to check how your {service_short} is holding up. I hope you are enjoying it.',
      'Hi {first}, this is {me} from {business}. How is your {service_short} holding up after the first few days?',
    ],
    next: 'If they are happy with it: “I am so glad to hear that. Most clients come back about every {weeks} weeks, and I would be happy to reserve a time for you whenever you would like.”',
    branches: COMMON([B('booked', '“Wonderful. We look forward to seeing you then.”'), B('interested', '“Thank you. I will send you a few times.”')]),
    never: 'A discount on visit two; it teaches them to wait for one.' },
  long_gone: { kind: 'long_gone', label: 'Long gone', who: 'owner', marketing: true, priority: 'low', expiresDays: 21, cooldownDays: 150, winBack: true,
    versions: [
      'Hi {first}, this is {me} from {business}. It has been a while, and I wanted to say hello. If anything about your last visit was not right, I would sincerely like to know. Either way, we would be delighted to see you again.',
      'Hi {first}, this is {me} at {business}. I wanted to check in, as it has been a while. If there is anything we could have done better, I would truly appreciate hearing it.',
    ],
    next: 'Listen first. If they’d like to come back, offer two real times.',
    branches: COMMON([B('booked', '“We are so pleased you are coming back. We look forward to seeing you.”'), B('interested', '“Thank you. I will send you a few times.”')]),
    never: 'Guilt, or “it’s been forever!”' },
  cancelled: { kind: 'cancelled', label: 'Cancelled, never rebooked', who: 'desk', marketing: false, priority: 'high', expiresDays: 7, cooldownDays: 30, winBack: false,
    versions: [
      'Hi {first}, this is {me} at {business}. We are sorry we were not able to see you {when}. Would you like me to find you another time for your {service_short}?',
      'Hi {first}, this is {me} from {business}. Thank you for letting us know about {when}. Whenever you would like a new time, just let me know and I will arrange it.',
    ],
    next: 'Offer two times close to the one they lost.',
    branches: COMMON([B('booked', '“Thank you. Your appointment is confirmed, and you will receive a confirmation text shortly.”')]),
    auto: [
      'Hi {first}, this is {business}. We are sorry we were not able to see you {when}. Whenever you would like another time, you are welcome to book one here: {link}',
      'Hi {first}, thank you for letting us know about {when}. When you are ready for a new time, you can book one here: {link}',
    ],
    afterAuto: 'Hi {first}, this is {me} at {business}. I wanted to check whether you would like me to find you a new time.',
    never: 'Mentioning a fee that wasn’t charged.' },
  no_show: { kind: 'no_show', label: 'Missed appointment', who: 'desk', marketing: false, priority: 'medium', expiresDays: 7, cooldownDays: 30, winBack: false,
    versions: [
      'Hi {first}, this is {me} at {business}. We were not able to see you {when}, and I hope everything is all right. Would you like to find another time?',
      'Hi {first}, this is {me} from {business}. I wanted to check that you are well after {when}. I would be happy to rebook you whenever it suits you.',
    ],
    next: 'Rebook with a card hold if your policy asks for one.',
    branches: COMMON([B('booked', '“Thank you. Your appointment is confirmed, and we look forward to seeing you.”')]),
    never: 'Shame, or a discount.' },
  no_rebook: { kind: 'no_rebook', label: 'Didn’t rebook at checkout', who: 'provider', marketing: false, priority: 'medium', expiresDays: 7, cooldownDays: 30, winBack: true,
    versions: [
      'Hi {first}, this is {me}. It was lovely seeing you. We did not book your next appointment before you left. Would you like me to reserve a time for you in about {weeks} weeks?',
      'Hi {first}, this is {me}. Would you like me to reserve your usual time in {weeks} weeks, so you do not need to think about it?',
    ],
    next: 'Offer their usual day and time, about {weeks} weeks out.',
    branches: COMMON([B('booked', '“Your appointment is reserved. You will receive a reminder beforehand.”')]),
    auto: [
      'Hi {first}, thank you for coming in. When you would like your next {service_short}, about {weeks} weeks from now is usually ideal. You can book a time here: {link}',
      'Hi {first}, it was lovely seeing you. Whenever you would like to book your next appointment, you can do so here: {link}',
    ],
    afterAuto: 'Hi {first}, this is {me}. Would you like me to reserve your usual time in about {weeks} weeks, so you do not need to think about it?',
    never: 'A hold that doesn’t really release.' },
  quote: { kind: 'quote', label: 'A quote waiting', who: 'owner', marketing: false, priority: 'medium', expiresDays: 10, cooldownDays: 14, winBack: false,
    versions: [
      'Hi {first}, this is {me} at {business}. I wanted to make sure you received the quote. I am happy to answer any questions or make any changes.',
      'Hi {first}, this is {me} from {business}. Do you have any questions about the quote? I would be glad to adjust it to suit your needs.',
    ],
    next: 'Answer questions; if they’re ready, mark it accepted on the quote.',
    branches: COMMON([B('quote_accepted', '“Wonderful. I will get everything arranged.”'), B('declined', '“I completely understand. Thank you for considering us.”')]),
    auto: [
      'Hi {first}, this is {business}. We wanted to make sure you received your quote. Please reply with any questions, and we would be happy to adjust anything to suit your needs.',
    ],
    afterAuto: 'Hi {first}, this is {me} at {business}. I wanted to follow up on the quote personally. Is there anything I can change or answer for you?',
    never: 'Pressure to decide today.' },
  gift_card: { kind: 'gift_card', label: 'Gift card sitting unused', who: 'desk', marketing: false, priority: 'low', expiresDays: 21, cooldownDays: 180, winBack: false,
    versions: [
      'Hi {first}, please note that you still have {balance} on your {business} gift card. Whenever you would like to treat yourself, it is ready for you.',
      'Hi {first}, this is {me} at {business}. You have {balance} available on a gift card. There is no rush; it is yours whenever you would like to use it.',
    ],
    next: 'If they would like to use it, offer two times.',
    branches: COMMON([B('booked', '“Wonderful. The balance will be applied at checkout.”')]),
    auto: [
      'Hi {first}, please note that you still have {balance} on your {business} gift card. Whenever you would like to use it, you can book here: {link}',
      'Hi {first}, this is {business}. You have {balance} available on a gift card, and it is yours whenever you would like to use it. You can book here: {link}',
    ],
    never: '“Use it or lose it” unless it truly expires.' },
  follow_up: { kind: 'follow_up', label: 'Follow-up', who: 'provider', marketing: false, priority: 'medium', expiresDays: 10, cooldownDays: 0, winBack: false,
    versions: ['Hi {first}, this is {me} again. I wanted to follow up, with no pressure at all.'],
    next: 'Pick up where you left off.',
    branches: COMMON([B('booked', '“Your appointment is confirmed.”'), B('done', 'Mark it done.')]),
    never: 'More than one follow-up.' },
  manual: { kind: 'manual', label: 'Task', who: 'desk', marketing: false, priority: 'medium', expiresDays: 14, cooldownDays: 0, winBack: false,
    versions: [''], next: '', branches: [B('done', 'Mark it done when it’s finished.'), B('booked', 'Booked.'), B('no_answer', 'Try again later.')], never: '' },
};

export const OUTCOMES: Record<OutcomeId, { label: string; tone: 'good' | 'neutral' | 'bad'; closes: boolean; followUpDays?: number }> = {
  booked: { label: 'Booked', tone: 'good', closes: true },
  quote_accepted: { label: 'Quote accepted', tone: 'good', closes: true },
  interested: { label: 'Interested', tone: 'good', closes: true, followUpDays: 1 },
  not_now: { label: 'Not now', tone: 'neutral', closes: true, followUpDays: 21 },
  price: { label: 'Asked about price', tone: 'neutral', closes: false },
  no_answer: { label: 'No answer', tone: 'neutral', closes: false },
  voicemail: { label: 'Left a voicemail', tone: 'neutral', closes: false },
  declined: { label: 'Not interested', tone: 'neutral', closes: true },
  bad_experience: { label: 'Bad experience', tone: 'bad', closes: true },
  stop: { label: 'Stop contacting me', tone: 'bad', closes: true },
  no_longer_applies: { label: 'No longer applies', tone: 'neutral', closes: true },
  done: { label: 'Done', tone: 'good', closes: true },
};
export const MAX_TRIES = 3;

export type Mode = 'off' | 'auto' | 'person' | 'auto_then_person';
export const MODE_LABEL: Record<Mode, string> = { off: 'Off', auto: 'Send it automatically', person: 'Give it to a person', auto_then_person: 'Automatic, then a person' };
/** The starting choice for each kind (canvas, section 31 follow-up): automatic where a friendly text is enough, a person
 * where the personal touch is the point, and "automatic, then a person" where a person only helps if there's no reply. */
export const DEFAULT_MODES: Record<string, Mode> = { due: 'auto_then_person', no_rebook: 'auto_then_person', cancelled: 'auto', gift_card: 'auto', quote: 'auto_then_person', first_visit: 'person', long_gone: 'person', no_show: 'person' };
export const modesFor = (k: OppKind): Mode[] => (PLAYBOOKS[k].auto?.length ? ['off', 'auto', 'auto_then_person', 'person'] : ['off', 'person']);
export interface OppSettings { on: boolean; finders: Record<string, boolean>; modes: Record<string, Mode>; afterDays: number; perPersonPerDay: number; holdoutPct: number; paceMin: number; paceDays: number }

// ── Which tool each kind belongs to ─────────────────────────────────────────────────────────
// One engine for every tool. A kind whose tool the business doesn't have is off, whatever its setting says.
export type Tool = 'appointments' | 'quotes' | 'gift_cards' | 'memberships' | 'shop' | 'booths' | 'academy' | 'hiring' | 'calls';
export const TOOL_OF: Record<OppKind, Tool> = { due: 'appointments', first_visit: 'appointments', long_gone: 'appointments', cancelled: 'appointments', no_show: 'appointments', no_rebook: 'appointments', quote: 'quotes', gift_card: 'gift_cards', follow_up: 'appointments', manual: 'appointments' };
const TOOL_GATE: Partial<Record<Tool, ModuleId>> = { quotes: 'classes_events', memberships: 'memberships', shop: 'retail', booths: 'booth_rental', academy: 'academy', hiring: 'team', calls: 'voice' };
export const toolOn = (tenant: any, tool: Tool) => { const g = TOOL_GATE[tool]; return !g || moduleEnabled(tenant, g); };

// ── Room on the schedule ────────────────────────────────────────────────────────────────────
// Win-back only makes sense when there is time to see the client. When a provider's next few weeks are nearly full,
// these kinds wait (they're found again the next day); recovering a lost visit, quotes and first-visit check-ins always go.
export const PACED: OppKind[] = ['due', 'long_gone', 'no_rebook', 'gift_card'];
/** Share of each provider's bookable start times still open over the next `days` days (0–1), worked out once a day. */
export interface Pace { day: string; days: number; byStaff: Record<string, { share: number; name?: string }>; business: number | null; held?: Record<string, number> }
export function heldForRoom(kind: OppKind, providerId: string | null, pace: Pace | null | undefined, S: OppSettings): boolean {
  if (!S.paceMin || !pace || !PACED.includes(kind)) return false;
  const share = providerId && pace.byStaff?.[providerId] ? pace.byStaff[providerId].share : pace.business;
  return typeof share === 'number' && share * 100 < S.paceMin;
}
export const FINDER_KINDS: OppKind[] = ['due', 'first_visit', 'no_rebook', 'cancelled', 'no_show', 'long_gone', 'quote', 'gift_card'];
export function oppSettingsOf(tenant: any): OppSettings {
  const o = tenant?.opportunities || {}; const f = o.finders || {};
  const n = (v: any, lo: number, hi: number, d: number) => { const x = Number(v); return Number.isFinite(x) ? Math.max(lo, Math.min(hi, Math.round(x))) : d; };
  const m = o.modes || {};
  const modes: Record<string, Mode> = Object.fromEntries(FINDER_KINDS.map((k) => { let v: Mode = modesFor(k).includes(m[k]) ? m[k] : DEFAULT_MODES[k] || 'person'; if (f[k] === false || !toolOn(tenant, TOOL_OF[k])) v = 'off'; return [k, v]; }));
  return { on: o.on !== false, finders: Object.fromEntries(FINDER_KINDS.map((k) => [k, modes[k] !== 'off'])), modes, afterDays: n(o.afterDays, 1, 14, 3), perPersonPerDay: n(o.perPersonPerDay, 1, 30, 5), holdoutPct: n(o.holdoutPct, 0, 30, 10), paceMin: n(o.paceMin, 0, 50, 10), paceDays: n(o.paceDays, 7, 42, 21) };
}

// ── Reading a client's history ──────────────────────────────────────────────────────────────
const DAY = 864e5;
export const ms = (v: any) => (typeof v === 'string' ? Date.parse(v) || 0 : v?.toDate ? v.toDate().getTime() : v?.seconds ? v.seconds * 1000 : Number(v) || 0);
const DONE = ['completed', 'checked_out', 'paid'];
const DEAD = ['cancelled', 'canceled', 'no_show', 'noshow', 'declined', 'expired', 'rejected'];
const isCancel = (s: any) => ['cancelled', 'canceled'].includes(String(s || ''));
const isNoShow = (s: any) => ['no_show', 'noshow'].includes(String(s || ''));
const money = (a: any) => Number(a?.revenue ?? a?.totalPrice ?? a?.price ?? 0) || 0;

export interface History { clientId: string; visits: any[]; last: any | null; upcoming: any | null; gapDays: number | null; avg: number; lastAny: any | null }
export function historyOf(appts: any[], now: number): Map<string, History> {
  const by = new Map<string, any[]>();
  for (const a of appts) { const c = String(a.clientId || ''); if (!c) continue; (by.get(c) || by.set(c, []).get(c)!).push(a); }
  const out = new Map<string, History>();
  for (const [clientId, list] of by) {
    const sorted = [...list].sort((a, b) => ms(a.startTime) - ms(b.startTime));
    const visits = sorted.filter((a) => DONE.includes(String(a.status || '')) && ms(a.startTime) <= now);
    const upcoming = sorted.find((a) => ms(a.startTime) > now && !DEAD.includes(String(a.status || ''))) || null;
    const gaps: number[] = []; for (let i = 1; i < visits.length; i++) gaps.push((ms(visits[i].startTime) - ms(visits[i - 1].startTime)) / DAY);
    const med = gaps.length ? [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)] : null;
    const recent = visits.slice(-5); const avg = recent.length ? recent.reduce((s, a) => s + money(a), 0) / recent.length : 0;
    const past = sorted.filter((a) => ms(a.startTime) <= now);
    out.set(clientId, { clientId, visits, last: visits[visits.length - 1] || null, upcoming, gapDays: med !== null && med >= 5 && med <= 120 ? Math.round(med) : null, avg: Math.round(avg * 100) / 100, lastAny: past[past.length - 1] || null });
  }
  return out;
}

export interface Candidate { kind: OppKind; tool: Tool; subject: { type: 'client' | 'contact'; id: string | null }; key: string; clientId: string | null; clientName: string; why: string; valueCents: number; valueNote?: string; providerId: string | null; dueAt: string; expiresAt: string; refs: Record<string, string>; facts: Record<string, string> }

const firstName = (c: any) => String(c?.firstName || String(c?.name || c?.clientName || '').split(' ')[0] || '').trim() || 'there';
const shortService = (n: any) => { const s = String(n || '').trim(); if (!s) return 'nails'; const l = s.toLowerCase();
  if (/gel/.test(l) && /fill/.test(l)) return 'gel fill'; if (/pedi/.test(l)) return 'pedicure'; if (/mani/.test(l)) return 'manicure'; return l.length > 28 ? 'last service' : l; };
const day = (n: number) => `${Math.round(n)} day${Math.round(n) === 1 ? '' : 's'}`;
const weeksOf = (g: number | null) => (g ? Math.max(1, Math.round(g / 7)) : 4);
const whenWord = (t: number, now: number, tz?: string) => { const d = Math.round((now - t) / DAY); if (d <= 1) return 'yesterday'; return new Date(t).toLocaleDateString('en-US', { weekday: 'long', ...(tz ? { timeZone: tz } : {}) }) + (d < 7 ? '' : ''); };

/** The rules. Returns everything that qualifies today; the server drops what's already open, cooling down or opted out.
 * `fresh`: called the moment something happened (a cancellation, a no-show, a checkout), so those kinds qualify the
 * same day; the server decides when the client actually hears from us. */
export function findCandidates(x: { clients: any[]; appointments: any[]; quotes: any[]; giftCards: any[]; settings: OppSettings; now: number; tz?: string; renterStaffIds?: Set<string>; fresh?: boolean }): Candidate[] {
  const { now, settings: S } = x; const minAge = x.fresh ? 0 : 1; const iso = (t: number) => new Date(t).toISOString();
  const renter = x.renterStaffIds || new Set<string>();
  const appts = x.appointments.filter((a) => !a.isRenterBooking && !renter.has(String(a.staffId || '')) && !a.isWalkIn);
  const H = historyOf(appts, now); const clients = new Map(x.clients.map((c) => [String(c.id), c]));
  const out: Candidate[] = [];
  const add = (kind: OppKind, c: any, h: History | null, why: string, valueCents: number, extra: Partial<Candidate> = {}) => {
    const pb = PLAYBOOKS[kind];
    out.push({ kind, tool: TOOL_OF[kind], subject: { type: c?.id ? 'client' : 'contact', id: c?.id ? String(c.id) : null }, key: `${kind}:${extra.refs?.quoteId || extra.refs?.giftCardId || extra.refs?.appointmentId || c?.id}`, clientId: c?.id ? String(c.id) : null, clientName: String(c?.name || [c?.firstName, c?.lastName].filter(Boolean).join(' ') || 'Client').slice(0, 120),
      why, valueCents: Math.max(0, Math.round(valueCents)), providerId: h?.last?.staffId ? String(h.last.staffId) : null, dueAt: iso(now), expiresAt: iso(now + pb.expiresDays * DAY), refs: {},
      facts: { first: firstName(c), service_short: shortService(h?.last?.serviceName), weeks: String(weeksOf(h?.gapDays ?? null)), ...(c?.phone ? { phone: String(c.phone) } : {}) }, ...extra } as Candidate);
  };
  for (const [cid, h] of H) {
    const c = clients.get(cid); if (!c || c.archived || c.deleted) continue;
    const since = h.last ? (now - ms(h.last.startTime)) / DAY : null; const g = h.gapDays; const n = h.visits.length;
    if (h.upcoming) continue;
    const la = h.lastAny; const laT = la ? ms(la.startTime) : 0;
    // A cancel or no-show that's the most recent thing, and never rebooked.
    if (la && isCancel(la.status) && S.finders.cancelled) { const at = ms(la.cancelledAt) || ms(la.updatedAt) || laT; const d = (now - at) / DAY;
      if (d >= minAge && d <= 7) { add('cancelled', c, h, `Cancelled ${la.serviceName || 'their visit'} ${day(d)} ago and hasn’t rebooked`, money(la) * 100, { refs: { appointmentId: String(la.id) }, providerId: la.staffId ? String(la.staffId) : null }); out[out.length - 1].facts.when = whenWord(laT, now, x.tz); continue; } }
    if (la && isNoShow(la.status) && S.finders.no_show) { const d = (now - laT) / DAY;
      if (d >= minAge && d <= 7) { add('no_show', c, h, `Missed ${la.serviceName || 'their visit'} ${day(d)} ago — nothing booked since`, money(la) * 100, { refs: { appointmentId: String(la.id) }, providerId: la.staffId ? String(la.staffId) : null }); out[out.length - 1].facts.when = whenWord(laT, now, x.tz); continue; } }
    if (since === null) continue;
    if (n === 1 && since >= 3 && since <= 10 && S.finders.first_visit) { add('first_visit', c, h, `First visit ${day(since)} ago (${h.last.serviceName || 'a service'}) — nothing booked yet`, h.avg * 100); continue; }
    if (n >= 2 && since >= minAge && since <= 3 && S.finders.no_rebook) { add('no_rebook', c, h, `Came in ${day(since)} ago and left without a next visit${g ? ` (usually every ${weeksOf(g)} weeks)` : ''}`, h.avg * 100); continue; }
    if (n >= 2 && g && since >= Math.max(g * 1.5, g + 7) && since < Math.max(g * 3, 90) && S.finders.due) { add('due', c, h, `${day(since)} since their ${h.last.serviceName || 'last visit'} — usually every ${weeksOf(g)} weeks`, h.avg * 100); continue; }
    const longAfter = Math.max(g ? g * 3 : 90, 90);
    if (since >= longAfter && since <= 365 && S.finders.long_gone) { add('long_gone', c, h, `Last visit ${Math.round(since / 30)} months ago${n > 1 ? ` — came ${n} times before` : ''}`, h.avg * 100); continue; }
  }
  if (S.finders.quote) for (const q of x.quotes) {
    if (!['sent', 'viewed'].includes(String(q.status || '')) || q.convertedToEventId) continue;
    const sent = ms(q.sentAt); if (!sent) continue; const d = (now - sent) / DAY; const exp = q.expiresInDays ? sent + Number(q.expiresInDays) * DAY : Infinity;
    if (d < 3 || exp <= now) continue;
    const total = quoteTotal(q); const c = clients.get(String(q.clientId || '')) || { id: q.clientId || null, name: q.clientName || q.contactName || 'Client', phone: q.clientPhone || q.phone, email: q.clientEmail || q.email };
    add('quote', c, null, `Quote${q.title ? ` “${String(q.title).slice(0, 60)}”` : ''} sent ${day(d)} ago${q.viewedAt ? ', opened' : ', not opened yet'}`, total * 100, { refs: { quoteId: String(q.id) }, expiresAt: iso(Math.min(exp, now + 10 * DAY)), providerId: q.createdByStaffId || null });
  }
  if (S.finders.gift_card) for (const gc of x.giftCards) {
    if (gc.status !== 'active' || !(Number(gc.balanceCents) > 0) || gc.promo || gc.ownerRenterId) continue;
    const last = ms(gc.lastUsedAt) || ms(gc.createdAt); if (!last || now - last < 60 * DAY) continue;
    const rid = gc.recipient?.id || gc.recipientClientId || null; const c = (rid && clients.get(String(rid))) || (gc.recipient?.phone || gc.recipient?.email ? { id: rid, name: gc.recipient?.name || 'Gift card holder', phone: gc.recipient?.phone, email: gc.recipient?.email } : null);
    if (!c) continue;
    add('gift_card', c, null, `${dollars(gc.balanceCents)} unused on a gift card since ${new Date(last).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}`, Number(gc.balanceCents), { refs: { giftCardId: String(gc.id) }, valueNote: 'their balance' });
    out[out.length - 1].facts.balance = dollars(gc.balanceCents);
  }
  return out;
}

export const quoteTotal = (q: any) => { const sub = (q.lineItems || []).reduce((a: number, i: any) => a + (Number(i.price) || 0) * (Number(i.quantity) || 1), 0); return Math.round((sub + (Number(q.travelExpenses) || 0) + sub * ((Number(q.projectFee) || 0) / 100)) * 100) / 100; };
export const dollars = (cents: number) => { const d = (Number(cents) || 0) / 100; return `$${d % 1 ? d.toFixed(2) : d.toLocaleString('en-US')}`; };

/** Keep only what should become a task: one open task per client, cooldowns, opt-outs, open cases. */
export function filterCandidates(c: Candidate[], o: { existing: any[]; clients: Map<string, any>; openCaseClients: Set<string>; recentAutoNudge: Set<string>; now: number }): Candidate[] {
  const ACT = ['open', 'holdout', 'waiting', 'auto', 'scheduled'];
  const openByClient = new Set(o.existing.filter((e) => ACT.includes(e.status) && e.clientId).map((e) => String(e.clientId)));
  const keys = new Set(o.existing.filter((e) => ACT.includes(e.status)).map((e) => e.key));
  const seen = new Set<string>();
  return c.filter((x) => {
    if (keys.has(x.key)) return false;
    const pb = PLAYBOOKS[x.kind];
    if (o.existing.some((e) => e.key === x.key && o.now - ms(e.createdAt) < Math.max(1, pb.cooldownDays) * DAY)) return false;   // same thing, recently — even with no client record (a gift card holder)
    if (x.clientId) {
      if (openByClient.has(x.clientId) || seen.has(x.clientId)) return false;
      const cl = o.clients.get(x.clientId); if (cl?.opportunityOptOut || (pb.marketing && cl?.marketingOptOut)) return false;
      if (o.openCaseClients.has(x.clientId)) return false;   // fix first — nothing is sold while a case is open
      if (pb.winBack && o.recentAutoNudge.has(x.clientId)) return false;   // the automatic reminder is already working
      const cool = o.existing.some((e) => e.clientId === x.clientId && e.kind === x.kind && o.now - ms(e.createdAt) < pb.cooldownDays * DAY);
      if (cool) return false;
      seen.add(x.clientId);
    }
    return true;
  });
}

/** 1 in N win-back candidates is left alone at random — the comparison that shows what outreach really did. */
export function isHoldout(key: string, monthKey: string, pct: number): boolean {
  if (!pct) return false; let h = 2166136261; const s = `${key}|${monthKey}`;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 100) < pct;
}

const DESK_ROLES = ['front_desk', 'frontdesk', 'desk', 'receptionist', 'coordinator', 'assistant'];
const MGR_ROLES = ['owner', 'admin', 'manager'];
/** Who gets it: the playbook's person, if they're on the team and not over today's limit; else someone in the same
 * role; else a manager; else nobody (it waits on the board for a manager to hand out). */
export function assignee(who: Who, providerId: string | null, team: any[], load: Map<string, number>, cap: number): any | null {
  const ok = (m: any) => m && !m.archived && m.isActive !== false && m.role !== 'renter' && !m.isRenter && m.appAccess !== 'off' && (load.get(m.id) || 0) < cap;
  const byRole = (roles: string[]) => team.filter((m) => roles.includes(String(m.role || '').toLowerCase()) && ok(m)).sort((a, b) => (load.get(a.id) || 0) - (load.get(b.id) || 0))[0] || null;
  if (who === 'provider') { const p = team.find((m) => m.id === providerId); if (ok(p)) return p; return byRole(DESK_ROLES) || byRole(MGR_ROLES); }
  if (who === 'desk') return byRole(DESK_ROLES) || byRole(MGR_ROLES);
  const owner = team.find((m) => String(m.role || '').toLowerCase() === 'owner'); return ok(owner) ? owner : byRole(MGR_ROLES);
}

/** The first message: the version this client hasn't had before, with their details filled in. */
export function pickVersion(kind: OppKind, used: number[]): number {
  const n = PLAYBOOKS[kind].versions.length; for (let i = 0; i < n; i++) if (!used.includes(i)) return i; return (Math.max(...used) + 1) % n;
}
export function fill(text: string, facts: Record<string, string | undefined>): string {
  return text.replace(/\{(\w+)\}/g, (_m, k) => String(facts[k] ?? '').trim()).replace(/\s{2,}/g, ' ').replace(/\s([,.!?])/g, '$1').trim();
}

/** What an answer does: closes it or not, the follow-up it makes, and the side effects the server carries out. */
export function outcomeEffects(opp: any, outcome: OutcomeId, now: number): { patch: any; followUpAt: string | null; openCase: boolean; optOut: boolean } {
  const o = OUTCOMES[outcome]; const tries = (opp.tries || 0) + (['no_answer', 'voicemail'].includes(outcome) ? 1 : 0);
  const giveUp = ['no_answer', 'voicemail'].includes(outcome) && tries >= MAX_TRIES;
  const closes = o.closes || giveUp;
  const patch: any = { tries, lastOutcome: outcome, updatedAt: new Date(now).toISOString() };
  if (closes) { patch.status = 'done'; patch.outcome = giveUp ? 'no_answer' : outcome; patch.closedAt = new Date(now).toISOString(); }
  const fu = o.followUpDays && opp.kind !== 'follow_up' ? new Date(now + o.followUpDays * DAY).toISOString() : null;
  return { patch, followUpAt: fu, openCase: outcome === 'bad_experience', optOut: outcome === 'stop' };
}

/** Did the client come back after we reached out? (not "caused by" — the holdout group says how much was the outreach) */
export function cameBack(opp: any, appts: any[], now: number): { status: 'none' | 'booked' | 'paid'; appointmentId?: string; paidCents?: number } {
  const from = ms(opp.firstContactAt) || ms(opp.createdAt); if (!from) return { status: 'none' };
  const mine = appts.filter((a) => String(a.clientId || '') === String(opp.clientId || '') && (ms(a.createdAt) || ms(a.startTime)) >= from - 3600e3 && (ms(a.createdAt) || 0) <= from + 30 * DAY && !DEAD.includes(String(a.status || '')))
    .sort((a, b) => ms(a.startTime) - ms(b.startTime));
  const paid = mine.find((a) => DONE.includes(String(a.status || '')) && ms(a.startTime) <= now);
  if (paid) return { status: 'paid', appointmentId: String(paid.id), paidCents: Math.round(money(paid) * 100) };
  const booked = mine.find((a) => ms(a.startTime) > now); if (booked) return { status: 'booked', appointmentId: String(booked.id) };
  return { status: 'none' };
}
