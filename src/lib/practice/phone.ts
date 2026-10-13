// Practice a shift: the salon phone. Two lines, hold, transfers, voicemail and callbacks, and the calls a
// front desk really gets: moving and cancelling, booking new clients (deposit by secure text link, never a card
// number read out loud), prices, gift cards, directions and parking, an upset client, someone asking for their
// provider, a wrong number and a sales call. Every call gets an etiquette checklist and a review.
// Business rules honored: no preset callback times; 24-hour cancellation with a yearly courtesy; prices never change
// on a line; staff personal numbers are never given out.
import type { RegState, Booking, Mistake } from './register';

export const SALON = { name: 'Opal Salon', address: '128 Market Street, Suite 3', parking: 'Free parking in the lot behind the building; street parking is metered until 6 PM.', hours: 'Tuesday to Saturday, 9 to 7' };
export const MANAGER = 'Dana';
export const CANCEL_FEE = 25;
export const DEPOSIT = 20;
/** Open times the desk can offer when moving a booking. */
export const OPEN_SLOTS = ['Sat 10:00 AM', 'Sat 1:00 PM', 'Tue 4:30 PM', 'Wed 11:00 AM'];
export const RING_LIMIT = 24;
/** Times offered for a free fix. */
export const REPAIR_SLOTS = ['Thu 5:30 PM', 'Fri 5:00 PM'];
/** On hold: after this the caller wonders if you're there; after the limit they hang up. */
export const HOLD_WARN = 40, HOLD_LIMIT = 90;

export type Service = { key: string; name: string; price: number; from?: boolean; minutes: number; provider: string; slots: string[] };
export const MENU: Service[] = [
  { key: 'gel', name: 'Gel manicure', price: 45, minutes: 60, provider: 'Ana', slots: ['Sat 1:00 PM', 'Tue 4:30 PM', 'Wed 11:00 AM'] },
  { key: 'art', name: 'Nail art (add-on)', price: 10, from: true, minutes: 15, provider: 'Ana', slots: [] },
  { key: 'pedi', name: 'Spa pedicure', price: 55, minutes: 60, provider: 'Ana', slots: ['Sat 1:00 PM', 'Wed 11:00 AM'] },
  { key: 'silk', name: 'Silk press', price: 85, minutes: 90, provider: 'Mei', slots: ['Sat 10:00 AM', 'Tue 4:30 PM'] },
  { key: 'blow', name: 'Blowout', price: 55, minutes: 45, provider: 'Mei', slots: ['Sat 10:00 AM', 'Tue 4:30 PM'] },
  { key: 'facial', name: 'Facial', price: 85, minutes: 60, provider: 'Hana', slots: ['Sat 1:00 PM', 'Wed 11:00 AM'] },
  { key: 'lash', name: 'Lash lift', price: 75, minutes: 60, provider: 'Hana', slots: ['Sat 1:00 PM', 'Wed 11:00 AM'] },
  { key: 'beard', name: 'Beard trim', price: 30, minutes: 30, provider: 'Diego', slots: ['Sat 10:00 AM', 'Sat 1:00 PM', 'Tue 4:30 PM'] },
];
export const serviceBy = (k: string | undefined) => MENU.find((m) => m.key === k || m.name === k) || null;

export type CallKind = 'reschedule' | 'cancel' | 'book' | 'price' | 'giftcard' | 'directions' | 'upset' | 'provider' | 'wrong' | 'sales';
export const KIND_LABEL: Record<CallKind, string> = { reschedule: 'Move a booking', cancel: 'Cancel', book: 'New booking', price: 'Price question', giftcard: 'Gift card', directions: 'Directions and parking', upset: 'Upset client', provider: 'Asking for a provider', wrong: 'Wrong number', sales: 'Sales call' };
export type Call = {
  id: string; at: number; name: string; phone: string; known: boolean; kind: CallKind;
  booking?: string; prefers?: string; want?: 'reschedule' | 'cancel';
  persona: string; goal: string; voiceHint: { gender: 'female' | 'male'; age: 'young' | 'middle_aged' | 'old' }; voice: { pitch: number; rate: number };
  opener: string; voicemail: string;
  /** What's true, for checking what you type: name, phone, email, service key, slot, amount, recipient, recipientEmail. */
  facts: Record<string, string>;
  /** What they say when asked for each detail. */
  say: Record<string, string>;
  outbound?: boolean;
};
export type Outcome =
  | { kind: 'rescheduled'; slot: string } | { kind: 'cancelled'; fee: boolean } | { kind: 'message'; for: string } | { kind: 'booked'; id: string }
  | { kind: 'answered' } | { kind: 'giftcard'; amount: number } | { kind: 'transferred'; to: string; warm: boolean } | { kind: 'declined' } | { kind: 'redirected' } | { kind: 'repair'; slot: string };
export type CallState = {
  call: Call; line: 1 | 2; started: number; found: string | null; offeredAnotherDay: boolean; outcome: Outcome | null; said: string;
  history: { who: 'you' | 'client'; text: string }[];
  hold: { since: number; asked: boolean; warned: boolean } | null; holdTotal: number; holds: number; holdsAsked: number; longHoldMissed: boolean;
  /** Steps done on this call (greeted, identity, readBack, anythingElse, policy, deposit, quoted, …). */
  did: Record<string, string | boolean>; form: Record<string, string>; mStart: number; mood: number;
};
export type Voicemail = { id: string; call: Call; at: number; listened: boolean; returned: boolean; overnight: boolean };
export type CallReview = { id: string; who: string; kind: CallKind; outbound: boolean; seconds: number; result: string; score: number; checklist: { label: string; ok: boolean }[]; mistakes: Mistake[]; transcript: { who: 'you' | 'client'; text: string }[] };

const CV = (pitch: number, rate: number) => ({ pitch, rate });
const spell = (s: string) => s.toUpperCase().split('').filter((c) => /[A-Z]/.test(c)).join('-');
const sayPhone = (p: string) => p.replace(/(\d{3})(\d{3})(\d{4})/, '$1, $2, $3');
const sayEmail = (e: string) => e.replace(/\./g, ' dot ').replace('@', ' at ');

export const CALLS: Call[] = [
  { id: 'call-dana', at: 50, name: 'Dana Lee', phone: '9195550142', known: true, kind: 'reschedule', want: 'reschedule', booking: 'b-dana', prefers: 'Sat 10:00 AM', goal: 'Move your Thursday gel manicure to next Saturday morning (Sat 10:00 AM).', persona: 'Friendly, organized caller in her 30s. Needs to move her Thursday gel manicure because of a work trip; would love next Saturday morning.', voiceHint: { gender: 'female', age: 'middle_aged' }, voice: CV(1.1, 1.02), opener: 'Hi! This is Dana. I need to move my appointment on Thursday, I have a work trip.', voicemail: 'Hi, it’s Dana Lee. I need to move my Thursday manicure. Please call me back. Thanks!', facts: { name: 'Dana Lee' }, say: { name: 'It’s Dana Lee, L-E-E.' } },
  { id: 'call-aisha', at: 68, name: 'Aisha Grant', phone: '9195550190', known: false, kind: 'book', goal: 'Book your first gel manicure, ideally Wednesday morning (Wed 11:00 AM).', persona: 'Warm first-time caller in her late 20s, found the salon online. Wants a gel manicure, ideally Wednesday morning. Happy to pay a deposit by text link. Says her details clearly when asked.', voiceHint: { gender: 'female', age: 'young' }, voice: CV(1.15, 1.04), opener: 'Hi! I’d like to book a gel manicure. I’ve never been there before.', voicemail: 'Hi, this is Aisha Grant. I’d like to book a gel manicure. My number is 919-555-0190. Thank you!',
    facts: { name: 'Aisha Grant', phone: '9195550190', email: 'aisha.grant@mailbox.com', service: 'gel', slot: 'Wed 11:00 AM' },
    say: { name: `It’s Aisha Grant. ${spell('Aisha')}, Grant.`, phone: `It’s ${sayPhone('9195550190')}.`, email: `It’s ${sayEmail('aisha.grant@mailbox.com')}.`, when: 'Do you have anything Wednesday morning?', service: 'Just a gel manicure, please.' } },
  { id: 'call-tasha', at: 110, name: 'Tasha Brooks', phone: '9195550188', known: true, kind: 'upset', goal: 'Get your lifting gel nails fixed before Saturday’s wedding. You calm down if they apologize and offer a free fix; if they blame you, ask for a manager.', persona: 'Frustrated client in her 40s. Got a gel manicure with Ana on Wednesday and three nails are lifting; she has a wedding Saturday. Reasonable if listened to and offered a fix; asks for a manager if blamed or brushed off.', voiceHint: { gender: 'female', age: 'middle_aged' }, voice: CV(0.95, 1.05), opener: 'Hi. I got a gel manicure on Wednesday and three of my nails are already lifting. I’m really not happy.', voicemail: 'This is Tasha Brooks. My nails from Wednesday are lifting and I have a wedding Saturday. Please call me back.',
    facts: { name: 'Tasha Brooks', slot: 'Fri 5:00 PM' }, say: { name: 'Tasha Brooks.', details: 'They started lifting two days ago, on three nails. I have a wedding Saturday.' } },
  { id: 'call-kim', at: 150, name: 'Kim Alvarez', phone: '9195550126', known: true, kind: 'cancel', want: 'cancel', booking: 'b-kim', prefers: 'Sat 1:00 PM', goal: 'Cancel tomorrow’s 9 AM lash lift. If they offer another day, take next Saturday afternoon (Sat 1:00 PM).', persona: 'Apologetic caller in her 20s. Something came up and she wants to cancel tomorrow’s 9 AM lash lift; if offered another day she’d gladly take next Saturday afternoon instead.', voiceHint: { gender: 'female', age: 'young' }, voice: CV(1.25, 1.08), opener: 'Hi, um, it’s Kim. I’m so sorry, I need to cancel my lash appointment tomorrow morning.', voicemail: 'Hi, it’s Kim Alvarez. I need to cancel my lash lift tomorrow, sorry! Call me back.', facts: { name: 'Kim Alvarez' }, say: { name: 'Kim Alvarez.' } },
  { id: 'call-sofia', at: 200, name: 'Sofia Russo', phone: '9195550173', known: true, kind: 'provider', goal: 'Talk to Ana about a nail art design for Friday. Happy to leave a message.', persona: 'Chatty regular in her 30s. Wants to talk to Ana about a nail art design for her Friday appointment. Fine leaving a message; would like a call back but has no set time.', voiceHint: { gender: 'female', age: 'middle_aged' }, voice: CV(1.08, 1.06), opener: 'Hi, is Ana there? I wanted to ask her about nail art for Friday.', voicemail: 'Hi, it’s Sofia. Could Ana call me about my nail art for Friday? Thanks!', facts: { name: 'Sofia Russo', topic: 'nail art design for Friday' }, say: { name: 'Sofia Russo.', details: 'It’s about a design for my Friday appointment. Something with little gold flowers.' } },
  // Busier phones (the phone practice shift)
  { id: 'call-ben', at: 30, name: 'Ben Ortiz', phone: '9195550152', known: false, kind: 'price', goal: 'Ask the price of a gel manicure and whether there’s anything Saturday. If they offer to book you, say yes to Sat 1:00 PM.', persona: 'Easygoing man in his 40s booking a treat for himself. Wants a price and a Saturday time.', voiceHint: { gender: 'male', age: 'middle_aged' }, voice: CV(0.9, 1.0), opener: 'Hey, how much is a gel manicure? And do you have anything this Saturday?', voicemail: 'Hi, Ben Ortiz here, wondering about gel manicure prices. 919-555-0152.',
    facts: { name: 'Ben Ortiz', phone: '9195550152', email: 'ben.ortiz@mailbox.com', service: 'gel', slot: 'Sat 1:00 PM' }, say: { name: `Ben Ortiz. ${spell('Ortiz')}.`, phone: `${sayPhone('9195550152')}.`, email: `${sayEmail('ben.ortiz@mailbox.com')}.`, when: 'Saturday afternoon would be great.', service: 'A gel manicure.' } },
  { id: 'call-wrong', at: 90, name: 'Unknown caller', phone: '9195550111', known: false, kind: 'wrong', goal: 'You think you called a pizza place. Order a large pepperoni.', persona: 'Hurried man who dialed the wrong number and thinks he called a pizza place.', voiceHint: { gender: 'male', age: 'young' }, voice: CV(1.0, 1.15), opener: 'Yeah, hi, can I get a large pepperoni for delivery?', voicemail: 'Yeah, large pepperoni for delivery to… oh, hang on.', facts: {}, say: {} },
  { id: 'call-carmen', at: 128, name: 'Carmen Diaz', phone: '9195550115', known: true, kind: 'giftcard', goal: 'Buy a $100 gift card for your sister Maya Diaz (maya.diaz@mailbox.com), sent by email. Happy to pay by a secure text link.', persona: 'Cheerful regular in her 50s buying a birthday gift card for her sister.', voiceHint: { gender: 'female', age: 'old' }, voice: CV(1.0, 0.98), opener: 'Hi, it’s Carmen! I’d like to get a gift card for my sister’s birthday.', voicemail: 'Hi, it’s Carmen Diaz, I’d like a gift card for my sister. Call me back!',
    facts: { name: 'Carmen Diaz', amount: '100', recipient: 'Maya Diaz', recipientEmail: 'maya.diaz@mailbox.com' }, say: { name: 'Carmen Diaz.', amount: 'Let’s do one hundred dollars.', recipient: `It’s for my sister, Maya Diaz. ${spell('Maya')}, Diaz.`, recipientEmail: `Her email is ${sayEmail('maya.diaz@mailbox.com')}.` } },
  { id: 'call-casey', at: 168, name: 'Casey (BrightLeads)', phone: '8885550123', known: false, kind: 'sales', goal: 'Sell marketing services. Ask for the owner, then for the owner’s cell number.', persona: 'Upbeat, pushy salesperson from a marketing company called BrightLeads. Wants the owner, then the owner’s cell number.', voiceHint: { gender: 'male', age: 'young' }, voice: CV(1.05, 1.15), opener: 'Hi there! This is Casey with BrightLeads. We help salons fill their books. Is the owner available?', voicemail: 'Hi, Casey with BrightLeads, would love five minutes with the owner!', facts: {}, say: {} },
  { id: 'call-nina', at: 185, name: 'Nina Park', phone: '9195550133', known: true, kind: 'directions', booking: 'b-nina-park', goal: 'You have a 1:00 with Ana today. Ask where to park and the exact address.', persona: 'Polite client driving in for her 1:00 manicure with Ana; first time at this location. Asks about parking and the address.', voiceHint: { gender: 'female', age: 'young' }, voice: CV(1.12, 1.0), opener: 'Hi! I have a one o’clock with Ana. Where should I park?', voicemail: 'Hi, Nina Park, where do I park for my one o’clock?', facts: { name: 'Nina Park' }, say: { name: 'Nina Park.' } },
];
/** Voicemails waiting when the shift starts: call them back. */
export const OVERNIGHT: Call[] = [
  { id: 'vm-leo', at: 0, name: 'Leo Turner', phone: '9195550164', known: false, kind: 'book', goal: 'Book a beard trim with Diego this Saturday (Sat 10:00 AM). You left a voicemail last night; they’re calling you back.', persona: 'Relaxed man in his 30s who left a voicemail last night asking for a beard trim this weekend.', voiceHint: { gender: 'male', age: 'middle_aged' }, voice: CV(0.85, 0.98), opener: 'Oh hey, thanks for calling me back! Yeah, I’m hoping for a beard trim this Saturday.', voicemail: 'Hey, this is Leo Turner. Looking for a beard trim this Saturday if you have anything. 919-555-0164. Thanks.',
    facts: { name: 'Leo Turner', phone: '9195550164', email: 'leo.turner@mailbox.com', service: 'beard', slot: 'Sat 10:00 AM' }, say: { name: 'Leo Turner, T-U-R-N-E-R.', phone: `${sayPhone('9195550164')}.`, email: `${sayEmail('leo.turner@mailbox.com')}.`, when: 'Saturday morning, if you can.', service: 'Just a beard trim.' }, outbound: true },
  { id: 'vm-joy', at: 0, name: 'Joy Park', phone: '9195550129', known: false, kind: 'price', goal: 'You left a voicemail asking the price of a silk press. If they offer to book, say yes to Sat 10:00 AM.', persona: 'Busy mom in her 30s who left a voicemail asking about silk press prices.', voiceHint: { gender: 'female', age: 'middle_aged' }, voice: CV(1.05, 1.1), opener: 'Hi! Yes, thanks for calling back. How much is a silk press?', voicemail: 'Hi, it’s Joy Park, just wondering how much a silk press is. 919-555-0129. Thanks!',
    facts: { name: 'Joy Park', phone: '9195550129', email: 'joy.park@mailbox.com', service: 'silk', slot: 'Sat 10:00 AM' }, say: { name: 'Joy Park. J-O-Y.', phone: `${sayPhone('9195550129')}.`, email: `${sayEmail('joy.park@mailbox.com')}.`, when: 'Saturday morning works.', service: 'A silk press.' }, outbound: true },
];
export type PhoneMode = 'full' | 'phones' | 'drill';
/** relaxed: nobody walks in and the phone waits while you're with someone (best for talking); normal; rush: a busy Saturday. */
export type Pace = 'relaxed' | 'normal' | 'rush';
export const CALL_SETS: Record<PhoneMode, { calls: string[]; overnight: string[] }> = {
  full: { calls: ['call-dana', 'call-aisha', 'call-tasha', 'call-kim', 'call-sofia'], overnight: ['vm-leo'] },
  phones: { calls: CALLS.map((c) => c.id), overnight: OVERNIGHT.map((c) => c.id) },
  drill: { calls: [], overnight: [] },
};
/** How long a phone rings before voicemail, and how patient callers on hold are, at each pace. */
export const ringLimit = (s: RegState) => (s.pace === 'relaxed' ? 60 : s.pace === 'rush' ? 16 : RING_LIMIT);
export const holdWarn = (s: RegState) => (s.pace === 'relaxed' ? 75 : s.pace === 'rush' ? 30 : HOLD_WARN);
export const holdLimit = (s: RegState) => (s.pace === 'relaxed' ? 180 : s.pace === 'rush' ? 70 : HOLD_LIMIT);
/** The caller-ID directory: existing clients the desk would see by name. */
export const clientByPhone = (s: RegState, phone: string) => {
  const b = s.bookings.find((x) => x.phone === phone); const c = [...CALLS, ...OVERNIGHT].find((x) => x.phone === phone && x.known);
  return b ? { name: b.name, note: `${b.service} with ${b.provider} · ${b.when}${b.day !== 'today' && b.day !== 'later' ? ` (${b.day})` : ''}` } : c ? { name: c.name, note: 'Client' } : null;
};

// ── Lines ───────────────────────────────────────────────────────────────
const bk = (s: RegState, id: string | null | undefined) => s.bookings.find((b) => b.id === id) || null;
const linesUsed = (s: RegState) => (s.onCall ? 1 : 0) + s.held.length;
const freeLine = (s: RegState): 1 | 2 => ([s.onCall, ...s.held].some((c) => c?.line === 1) ? 2 : 1);
const newCallState = (s: RegState, call: Call, said: string): CallState => ({ call, line: freeLine(s), started: s.t, found: null, offeredAnotherDay: false, outcome: null, said, history: [], hold: null, holdTotal: 0, holds: 0, holdsAsked: 0, longHoldMissed: false, did: {}, form: {}, mStart: s.mistakes.length, mood: 0.8 });
const oops = (s: RegState, who: string, what: string, later: string, right: string, minor = false) => s.mistakes.push({ at: s.t, who, what, later, right, ...(minor ? { minor: true } : {}) });

/** Each moment: ring the next call when a line is free, run hold timers, and send missed calls to voicemail. */
export function advancePhone(s: RegState) {
  for (const h of [...s.held]) {
    const held = s.t - h.hold!.since;
    if (held > holdWarn(s) && !h.hold!.warned) { h.hold!.warned = true; h.longHoldMissed = true; s.sfx.push('ring'); s.log.push(`${h.call.name} has been on hold a while.`); }
    if (held > holdLimit(s)) {
      const c = h.call; oops(s, c.name, `Left ${c.name} on hold until they hung up`, `${c.name} took their business elsewhere.`, 'Check back about every 30 to 45 seconds: “Thanks for holding, I’m still working on it,” or offer to call them right back.');
      s.held = s.held.filter((x) => x !== h); s.reviews.push(reviewOf(s, h, 'Hung up on hold')); s.done.push({ who: `📞 ${c.name}`, seconds: Math.round(s.t - h.started), clean: false, total: 0, points: 0 }); s.streak = 0;
    }
  }
  // Relaxed: the phone doesn't ring while you're with a client (except once, to practice hold), or while you're on a call.
  if (s.pace === 'relaxed') {
    const busy = linesUsed(s) > 0 || s.ringing; const withGuest = !!(s.cur || s.busy);
    for (const c of s.calls) if (c.at <= s.t && (busy || (withGuest && s.midCallUsed))) c.at = s.t + 0.01;
  }
  if (!s.ringing && linesUsed(s) < (s.pace === 'relaxed' ? 1 : 2)) { const next = s.calls.find((c) => c.at <= s.t); if (next && s.pace === 'relaxed' && (s.cur || s.busy)) s.midCallUsed = true; if (next) { s.calls = s.calls.filter((c) => c !== next); s.ringing = { call: next, since: s.t }; s.sfx.push('ring'); } }
  if (s.ringing && s.t - s.ringing.since > ringLimit(s)) {
    const c = s.ringing.call; s.ringing = null;
    s.voicemails.push({ id: `vm-${c.id}`, call: { ...c, outbound: true, opener: `Oh, hi! Thanks for calling me back.` }, at: s.t, listened: false, returned: false, overnight: false });
    oops(s, c.name, `Let ${c.name}’s call go to voicemail`, 'They waited for a call back instead of getting help right away.', 'Answer within three rings, even mid-checkout: “Excuse me one moment,” then pick up. If both lines are busy, call back as soon as you can.', true);
  }
}
export const phoneBusy = (s: RegState) => !!(s.ringing || s.onCall || s.held.length || s.calls.length);

/** Pick up. With a guest at the desk, excuse yourself first. With a caller already on the line, put them on hold first. */
export function answer(s: RegState, excused = true) {
  if (!s.ringing || s.onCall) return null; const call = s.ringing.call; s.ringing = null;
  if (s.cur && !s.held.length) {   // already on the phone: the guest already knows you're busy
    s.cur.mood = Math.max(0, s.cur.mood - (excused ? 0.03 : 0.12));
    if (!excused) oops(s, s.cur.c.name, `Picked up the phone mid-checkout without a word to ${s.cur.c.name}`, `${s.cur.c.name} felt ignored.`, `Look at them first: “Excuse me one moment, ${s.cur.c.name},” then answer.`, true);
  }
  s.onCall = newCallState(s, call, '');
  return s.onCall;
}
/** Call back a voicemail. */
export function callBack(s: RegState, vmId: string) {
  const vm = s.voicemails.find((v) => v.id === vmId); if (!vm || s.onCall || vm.returned) return null;
  vm.returned = true; vm.listened = true; s.onCall = newCallState(s, { ...vm.call, outbound: true }, 'Hello?'); return s.onCall;
}
export function listenVoicemail(s: RegState, vmId: string) { const vm = s.voicemails.find((v) => v.id === vmId); if (vm) vm.listened = true; return vm?.call.voicemail || ''; }
export function holdCall(s: RegState, asked: boolean) {
  const oc = s.onCall; if (!oc) return; oc.hold = { since: s.t, asked, warned: false }; oc.holds++; if (asked) oc.holdsAsked++;
  oc.said = asked ? 'Sure, no problem.' : 'Oh, um… okay?';
  if (!asked) oops(s, oc.call.name, `Put ${oc.call.name} on hold without asking`, `${oc.call.name} wasn’t sure if the call had dropped.`, '“May I place you on a brief hold?” Wait for a yes, then hold.', true);
  s.held.push(oc); s.onCall = null;
}
/** Pop back on to a caller on hold to say you're still there. Resets their patience. */
export function checkBack(s: RegState, id: string) {
  const h = s.held.find((x) => x.call.id === id); if (!h?.hold) return; h.hold.since = s.t; h.hold.warned = false; h.longHoldMissed = false; h.did.checkedBack = true;
  h.history.push({ who: 'you', text: 'Thanks so much for holding, I’m still working on it.' }, { who: 'client', text: 'No problem.' });
}
/** Back to a caller on hold (the line you're on must be free). */
export function resumeCall(s: RegState, id?: string) {
  if (s.onCall) return false; const h = id ? s.held.find((x) => x.call.id === id) : s.held[0]; if (!h?.hold) return false;
  const held = s.t - h.hold.since; h.holdTotal += held; h.hold = null; s.held = s.held.filter((x) => x !== h); s.onCall = h;
  h.said = held > holdWarn(s) ? 'Yes, I’m still here.' : 'Hi, yes, I’m here.'; return true;
}

// ── What you can do on a call ───────────────────────────────────────────
export type Act = { id: string; label: string; group: 'script' | 'ask' | 'do' | 'risky' | 'quote'; done?: boolean; hint?: string };
const has = (t: string, ...re: RegExp[]) => re.some((r) => r.test(t));
/** Lines that count as each step, when you say them out loud. */
const KEYS: Record<string, RegExp[]> = {
  greet: [/thank(s| you) for calling/i, /opal( salon)?.*(this is|speaking)/i, /how (can|may) i help/i],
  greetOut: [/returning your call/i, /calling (you )?back/i, /this is .* from opal/i],
  identify: [/(may|can|could) i (have|get) your (full |last )?name/i, /who (am i|do i have the pleasure)/i, /\bis this \w+/i, /am i speaking (with|to)/i],
  readBack: [/(just )?to confirm/i, /let me read/i, /i (have|'ve got) you (down|booked)/i, /so (we have|you're|that's|that is)/i, /you're all set for/i],
  anythingElse: [/anything else/i],
  'ask:name': [/your (full |last )?name/i, /spell (that|your)/i], 'ask:phone': [/(phone|cell|mobile)( number)?/i, /best number/i, /number (to|for) reach/i], 'ask:email': [/e-?mail/i],
  'ask:when': [/what (day|time)/i, /when (would|works|are you)/i, /(day|time) works/i], 'ask:service': [/what (service|can we do|are you looking)/i, /which service/i],
  'ask:amount': [/how much (would|did) you|what amount|(\$|dollar) amount/i], 'ask:recipient': [/who (is|'s) (it|the gift card) for/i, /recipient/i, /(her|their) name/i], 'ask:recipientEmail': [/(her|their|recipient'?s?) e-?mail/i, /where (should|do) (we|i) send/i],
  'ask:details': [/what happened/i, /tell me (more|what)/i, /can you (describe|explain)/i],
  policy: [/24.?hour/i, /cancel(l)?ation (policy|fee)/i, /(within|less than) a day/i],
  depositLink: [/(text|send)( you)?( a)?( secure)? (payment |deposit )?link/i, /link (to|for) (the|your) deposit/i],
  payLink: [/(text|send)( you)?( a)?( secure)? (payment )?link/i],
  cardAloud: [/(read|give) me (your|the) card/i, /card number/i, /(expiration|security code|cvv)/i],
  offerBook: [/(would you like|want|shall i|can i|may i)( me)? to book/i, /book (that|you) (in|for)/i, /get you (booked|in)/i],
  apologize: [/sorry/i, /apologi[sz]e/i, /frustrat/i, /i understand/i],
  blame: [/(did|have) you (pick|peel|bite|soak)/i, /your fault/i, /you must have/i],
  withClient: [/with a client/i, /in (a |an )?(service|appointment)/i, /(busy|unavailable) (right now|at the moment)/i, /can'?t (come|get) to the phone/i],
  promiseTime: [/(call you|call back|callback|get back to you) (at|by|around|before) \d/i, /\b(at|by) \d{1,2}(:\d{2})? ?(am|pm|o'?clock)\b.*call/i],
  giveInfo: [/park/i, /(lot|behind the building|street)/i, /\d+ market/i],
  textInfo: [/text (you|it|the address)/i, /send (you )?(the|our) address/i],
  confirmAppt: [/(1|one)( o'?clock|:00)/i, /with ana/i, /see you (at|soon)/i],
  thisIsSalon: [/(reached|this is|you've called) opal/i, /wrong number/i, /this is a (nail |hair )?salon/i],
  notInterested: [/not interested/i, /no,? thank you/i, /we('re| are) all set/i],
  takeInfo: [/(pass|give) (it|this|your (info|details|number)).*(manager|owner)/i, /take (down )?your (info|number|details)/i, /(leave|send) (us )?(your|an) (info|email)/i],
  giveCell: [/(her|his|the owner'?s?) (cell|personal) (number|phone) is/i],
  offerFix: [/free (fix|repair)/i, /fix (them|it|those) (for free|at no (cost|charge))/i, /no charge/i, /come (back )?in (and|so) (we|ana) (can )?fix/i],
  transferMgr: [/transfer you to/i, /(let me )?get (the |our )?manager/i, /connect you (with|to) (dana|the manager|our manager)/i, /put you through to/i],
  message: [/take a message/i, /leave (her |him )?a message/i, /pass (it|that|this) (along|on)/i, /have (her|him) call you/i],
};
/** What makes sense to offer right now, with the steps already done ticked. */
export function actsFor(s: RegState): Act[] {
  const oc = s.onCall; if (!oc) return []; const k = oc.call.kind; const d = oc.did; const out = oc.call.outbound;
  const a: Act[] = [
    out ? { id: 'greetOut', label: '“Hi, this is Jess from Opal Salon, returning your call.”', group: 'script', done: !!d.greeted } : { id: 'greet', label: '“Thank you for calling Opal Salon, this is Jess. How can I help?”', group: 'script', done: !!d.greeted },
  ];
  if (k !== 'wrong' && k !== 'sales') a.push({ id: 'identify', label: oc.call.known && !out ? `“Is this ${oc.call.name.split(' ')[0]}?”` : '“May I have your full name, please?”', group: 'script', done: !!d.identity });
  if (k === 'book' || (k === 'price' && d.offeredBook)) {
    for (const f of ['service', 'when', 'name', 'phone', 'email'] as const) a.push({ id: `ask:${f}`, label: { service: 'Ask what service', when: 'Ask what day and time', name: 'Ask for their name (and spelling)', phone: 'Ask for their phone number', email: 'Ask for their email' }[f], group: 'ask', done: !!d[`asked:${f}`] });
    a.push({ id: 'policy', label: '“Just so you know, we have a 24-hour cancellation policy.”', group: 'script', done: !!d.policy });
    a.push({ id: 'depositLink', label: `Text a secure link for the ${'$'}${DEPOSIT} deposit`, group: 'do', done: d.deposit === 'link' });
    a.push({ id: 'cardAloud', label: 'Take their card number over the phone', group: 'risky' });
  }
  if (k === 'price') { for (const m of MENU) a.push({ id: `quote:${m.key}`, label: `${m.name} · ${m.from ? 'from ' : ''}${'$'}${m.price}`, group: 'quote', done: d.quoted === m.key }); a.push({ id: 'offerBook', label: '“Would you like me to book that for you?”', group: 'script', done: !!d.offeredBook }); }
  if (k === 'giftcard') {
    for (const f of ['amount', 'recipient', 'recipientEmail'] as const) a.push({ id: `ask:${f}`, label: { amount: 'Ask what amount', recipient: 'Ask who it’s for', recipientEmail: 'Ask where to email it' }[f], group: 'ask', done: !!d[`asked:${f}`] });
    a.push({ id: 'payLink', label: 'Text a secure payment link', group: 'do', done: d.paid === 'link' }, { id: 'cardAloud', label: 'Take their card number over the phone', group: 'risky' });
  }
  if (k === 'directions') a.push({ id: 'giveInfo', label: 'Give the address and parking', group: 'do', done: !!d.info, hint: `${SALON.address}. ${SALON.parking}` }, { id: 'textInfo', label: 'Text them the address', group: 'do', done: !!d.texted }, { id: 'confirmAppt', label: '“See you at 1:00 with Ana!”', group: 'script', done: !!d.confirmed });
  if (k === 'upset') a.push({ id: 'ask:details', label: '“I’m so sorry. Can you tell me what happened?”', group: 'ask', done: !!d['asked:details'] }, { id: 'apologize', label: '“I’m really sorry, that’s frustrating, especially before a wedding.”', group: 'script', done: !!d.apologized }, { id: 'blame', label: 'Ask if she picked at them', group: 'risky' }, { id: 'refund', label: 'Promise a full refund', group: 'risky' });
  if (k === 'provider') a.push({ id: 'withClient', label: '“Ana’s with a client right now. Can I help, or take a message for her?”', group: 'script', done: !!d.explained }, { id: 'ask:details', label: 'Ask what it’s about', group: 'ask', done: !!d['asked:details'] }, { id: 'promiseTime', label: '“She’ll call you at 3:00.”', group: 'risky' });
  if (k === 'wrong') a.push({ id: 'thisIsSalon', label: '“I’m sorry, you’ve reached Opal Salon.”', group: 'script', done: oc.outcome?.kind === 'redirected' });
  if (k === 'sales') a.push({ id: 'notInterested', label: '“Thanks, but we’re not interested.”', group: 'script' }, { id: 'takeInfo', label: '“I can pass your info to our manager.”', group: 'script' }, { id: 'giveCell', label: 'Give out the owner’s cell number', group: 'risky' });
  if (oc.outcome && !['redirected', 'declined', 'transferred'].includes(oc.outcome.kind)) a.push({ id: 'readBack', label: '“Just to confirm…” (read the details back)', group: 'script', done: !!d.readBack });
  a.push({ id: 'anythingElse', label: '“Is there anything else I can help with?”', group: 'script', done: !!d.anythingElse });
  return a;
}
/** Do one thing on the call. Returns what the caller says back. */
export function act(s: RegState, id: string): string {
  const oc = s.onCall; if (!oc) return ''; const c = oc.call, k = c.kind, d = oc.did, first = c.name.split(' ')[0]; let said = '';
  const field = id.startsWith('ask:') ? id.slice(4) : null;
  if (id.startsWith('quote:')) {
    const m = serviceBy(id.slice(6)); const right = m?.key === c.facts.service;
    if (m && !right && !d.quotedWrong) { d.quotedWrong = true; oops(s, c.name, `Quoted ${first} the price of a ${m.name}`, `${first} was surprised by the real price at checkout.`, 'Listen for the exact service, then quote it from the menu.', true); }
    if (right) { d.quoted = m!.key; if (!oc.outcome) oc.outcome = { kind: 'answered' }; }
    said = right ? `Okay, ${'$'}${m!.price}, that’s fair. ${c.say.when || ''}`.trim() : `Hmm, I asked about a ${serviceBy(c.facts.service)?.name.toLowerCase()}?`;
  }
  else if (field) { d[`asked:${field}`] = true; said = c.say[field] || (field === 'details' ? 'It’s… well, let me explain.' : 'Hmm, let me think.'); if (field === 'details' && k === 'upset') d.listened = true; }
  else switch (id) {
    case 'greet': case 'greetOut': d.greeted = 'great'; said = oc.call.outbound ? c.opener : c.opener; break;
    case 'identify': d.identity = true; said = c.say.name || `It’s ${c.name}.`; break;
    case 'readBack': d.readBack = true; said = 'Yes, that’s right. Thank you!'; break;
    case 'anythingElse': d.anythingElse = true; said = oc.outcome ? 'No, that’s everything. Thanks so much!' : 'Well, I still need help with what I called about.'; break;
    case 'policy': d.policy = true; said = 'Got it, that’s fair.'; break;
    case 'depositLink': d.deposit = 'link'; said = 'Got the text. Paid!'; break;
    case 'payLink': d.paid = 'link'; said = 'Got it, paying now. Done!'; break;
    case 'cardAloud': if (d.cardAloud) break; d.cardAloud = true; d.deposit = d.deposit || 'aloud'; d.paid = d.paid || 'aloud';
      oops(s, c.name, `Took ${first}’s card number over the phone`, 'Card numbers said out loud at a front desk can be overheard and written down. The salon’s card processor doesn’t allow it.', 'Text a secure payment link instead. Never ask for card numbers out loud.'); said = 'Oh… okay, hold on, let me get my card.'; break;
    case 'offerBook': d.offeredBook = true; said = k === 'price' ? `Sure, let’s do it. ${c.say.when || ''}`.trim() : 'Yes please.'; break;
    case 'apologize': d.apologized = true; oc.mood = Math.min(1, oc.mood + 0.2); said = 'Thank you. I just want them fixed before Saturday.'; break;
    case 'blame': if (d.blamed) break; d.blamed = true; d.wantsManager = true; oc.mood = Math.max(0, oc.mood - 0.4);
      oops(s, c.name, `Asked ${first} if she picked at her nails`, `${first} felt accused and posted about it.`, 'Listen and apologize first. Lifting can happen for many reasons; offer the free fix within 7 days.'); said = 'Excuse me? No, I didn’t. Can I talk to a manager, please?'; break;
    case 'refund': if (d.refund) break; d.refund = true; oops(s, c.name, `Promised ${first} a refund without the manager`, 'The manager had to honor a refund the policy didn’t call for.', `Gel that lifts within 7 days gets a free fix. Refunds need ${MANAGER}’s approval.`, true); said = 'Oh. Okay… but I still need them fixed.'; break;
    case 'withClient': d.explained = true; said = c.say.details ? `Oh sure. ${c.say.details} Can she call me?` : 'Oh, okay.'; break;
    case 'promiseTime': if (d.promised) break; d.promised = true; oops(s, c.name, 'Promised a callback at a set time', `Ana was in back-to-back services and couldn’t call at 3:00. ${first} felt let down.`, 'Take the message and say Ana will call when she’s free. Don’t promise a time for someone else.', true); said = 'Great, 3:00 it is.'; break;
    case 'giveInfo': d.info = true; said = 'Perfect, the lot behind the building. Thank you!'; if (!oc.outcome) oc.outcome = { kind: 'answered' }; break;
    case 'textInfo': d.texted = true; said = 'Oh, that’s helpful, thanks!'; break;
    case 'confirmAppt': d.confirmed = true; said = 'See you soon!'; break;
    case 'thisIsSalon': oc.outcome = { kind: 'redirected' }; said = 'Oh! Sorry about that. Have a good one.'; break;
    case 'notInterested': oc.outcome = { kind: 'declined' }; said = 'Totally understand. Could I just get the owner’s cell to follow up?'; break;
    case 'takeInfo': oc.outcome = { kind: 'message', for: MANAGER }; said = 'Great! It’s casey at brightleads dot com. Thanks!'; break;
    case 'offerFix': offerRepair(s, REPAIR_SLOTS[1]); said = oc.said; break;
    case 'transferMgr': transfer(s, MANAGER, /fill (her|him) in|let (her|him) know|explain|tell (her|him)/i.test(String(d.lastSaid || ''))); said = oc.said; break;
    case 'message': takeMessage(s, d['asked:details'] ? (c.say.details || '') : '', oc.call.kind === 'provider' ? 'Ana' : MANAGER); said = oc.said; break;
    case 'giveCell': if (d.gaveCell) break; d.gaveCell = true; oops(s, c.name, 'Gave out the owner’s personal cell number', 'The owner got sales calls all weekend.', 'Never give out anyone’s personal number. Offer to pass a message along instead.'); said = 'Perfect, thanks so much!'; break;
  }
  if (said) oc.said = said;
  return said;
}
/** Words → steps. Used when you talk instead of tapping. */
export function detectActs(s: RegState, text: string): string[] {
  const oc = s.onCall; if (!oc) return []; const ok = new Set(actsFor(s).map((a) => a.id)); ok.add('greet'); ok.add('greetOut');
  const found: string[] = [];
  ok.add('transferMgr'); ok.add('message'); if (oc.call.kind === 'upset') ok.add('offerFix'); oc.did.lastSaid = text;
  for (const [id, res] of Object.entries(KEYS)) {
    if (!ok.has(id)) continue; if (oc.outcome && ['transferMgr', 'message', 'offerFix'].includes(id)) continue; if ((id === 'greet' || id === 'greetOut') && oc.did.greeted) continue; if (id === 'greetOut' && !oc.call.outbound) continue; if (id === 'greet' && oc.call.outbound) continue;
    if (id === 'payLink' && oc.call.kind !== 'giftcard') continue; if (id === 'depositLink' && oc.call.kind === 'giftcard') continue;
    if (has(text, ...res)) found.push(id);
  }
  // Saying the right price out loud counts as quoting it.
  if (oc.call.kind === 'price' && !oc.did.quoted) { const m = serviceBy(oc.call.facts.service); if (m && new RegExp(`\\$?\\b${m.price}\\b`).test(text)) found.push(`quote:${m.key}`); }
  // A plain "hello" still counts as answering, just not the full greeting.
  if (!oc.did.greeted && !found.includes('greet') && !found.includes('greetOut') && /\b(hi|hello|good (morning|afternoon))\b/i.test(text)) { oc.did.greeted = 'ok'; }
  return found;
}
/** The caller's answer in basic mode (no AI): from the steps you took, or the call's own flow. */
export function talkCall(s: RegState, text: string): { reply: string; acts: string[] } {
  const oc = s.onCall!; const acts = detectActs(s, text); let reply = '';
  for (const id of acts) { const r = act(s, id); if (r) reply = r; }
  if (!reply && oc.did.greeted === 'ok' && oc.history.filter((h) => h.who === 'you').length === 0) reply = oc.call.opener;
  if (!reply && oc.call.kind === 'reschedule' || !reply && oc.call.kind === 'cancel') {
    const t = ` ${text.toLowerCase()} `; const day = /\b(mon|tues|wednes|thurs|fri|satur|sun)day\b|\b(sat|sun|tue|wed)\b|\b\d{1,2}(:\d{2})?\s*(am|pm)\b/.test(t);
    if (/another day|different day|reschedule|move it|instead|available|would .* work/.test(t) || day) { offerAnotherDay(s); reply = oc.said; }
  }
  return { reply: reply || (oc.history.length < 2 ? oc.call.opener : 'Sorry, could you say that again?'), acts };
}

// ── Reschedule and cancel ───────────────────────────────────────────────
export function callFind(s: RegState, id: string) { const oc = s.onCall; if (!oc) return; oc.found = id; oc.did.identity = true; oc.said = id === oc.call.booking ? 'Yes, that’s me.' : 'Hmm, no, that’s not mine.'; }
/** Offer another day before cancelling (keeps the client). */
export function offerAnotherDay(s: RegState) { const oc = s.onCall; if (!oc) return; oc.offeredAnotherDay = true; oc.said = oc.call.want === 'cancel' ? `Oh, actually, could I do ${oc.call.prefers}?` : `${oc.call.prefers} would be perfect.`; }
export function callReschedule(s: RegState, slot: string) {
  const oc = s.onCall; if (!oc) return; const b = bk(s, oc.found);
  oc.outcome = { kind: 'rescheduled', slot }; oc.said = slot === oc.call.prefers ? 'Perfect, thank you so much!' : 'Okay… that works, I guess.';
  if (b) { b.status = 'rescheduled'; b.movedTo = slot; }
}
export function callCancel(s: RegState, chargeFee: boolean) {
  const oc = s.onCall; if (!oc) return; const b = bk(s, oc.found);
  oc.outcome = { kind: 'cancelled', fee: chargeFee }; oc.said = chargeFee ? 'Oh. Okay.' : 'Thank you for understanding.';
  if (b) { b.status = 'cancelled'; b.feeCharged = chargeFee; if (!chargeFee) b.courtesyLeft = Math.max(0, b.courtesyLeft - 1); }
}
export function takeMessage(s: RegState, note = '', forWho?: string) {
  const oc = s.onCall; if (!oc) return; const to = forWho || (oc.call.kind === 'provider' ? 'Ana' : MANAGER);
  oc.outcome = { kind: 'message', for: to }; oc.form.message = note; oc.said = to === 'Ana' ? 'Thank you! Tell her it’s about the flowers.' : 'Okay, thanks.';
}
export function setField(s: RegState, k: string, v: string) { if (s.onCall) s.onCall.form[k] = v; }

// ── New bookings and gift cards ─────────────────────────────────────────
const norm = (x: string) => x.trim().toLowerCase().replace(/\s+/g, ' ');
const digits = (x: string) => x.replace(/\D/g, '');
/** Book a new client from the call form: service, time, name, phone, email; deposit by text link. */
export function bookNew(s: RegState) {
  const oc = s.onCall; if (!oc || (oc.outcome && oc.outcome.kind !== 'answered')) return null; const c = oc.call, f = oc.form, d = oc.did, first = c.name.split(' ')[0];
  const svc = serviceBy(f.service); if (!svc || !f.slot || !f.name || !f.phone) return { ok: false as const, why: 'Pick the service and time, and fill in their name and phone first.' };
  const id = `b-new-${c.id}`;
  const booking: Booking = { id, name: f.name.trim(), when: f.slot, day: 'later', service: svc.name, provider: svc.provider, phone: digits(f.phone), email: norm(f.email || ''), deposit: d.deposit === 'link' ? DEPOSIT : 0, consentNeeded: false, consentOnFile: true, courtesyLeft: 1, status: 'booked' };
  s.bookings.push(booking); oc.outcome = { kind: 'booked', id };
  if (svc.key !== c.facts.service) oops(s, first, `Booked ${first} for a ${svc.name} instead of a ${serviceBy(c.facts.service)?.name}`, `${first} showed up expecting something else.`, 'Repeat the service back before you book it.');
  if (f.slot !== c.facts.slot) oops(s, first, `Booked ${first} at ${f.slot}; she asked for ${c.facts.slot}`, `${first} had to call again to move it.`, 'Ask what day and time works, then offer the openings closest to it.', true);
  if (norm(f.name) !== norm(c.facts.name)) oops(s, first, `Saved the name as “${f.name.trim()}”`, `The booking under the wrong name was hard to find at check-in.`, 'Ask them to spell it, then read it back.', true);
  if (digits(f.phone) !== c.facts.phone) oops(s, first, `Saved the wrong phone number for ${first}`, `Reminders went to a stranger and ${first} missed the appointment.`, 'Read the number back digit by digit.');
  if (c.facts.email && norm(f.email || '') !== c.facts.email) oops(s, first, `Saved the wrong email for ${first}`, 'The confirmation and receipt never arrived.', 'Ask them to spell the email, then read it back.', true);
  if (d.deposit !== 'link') oops(s, first, `Booked a new client without the ${'$'}${DEPOSIT} deposit`, `${first} didn’t show, and the time sat empty.`, `New clients hold their time with a ${'$'}${DEPOSIT} deposit, sent as a secure text link.`);
  if (!d.policy) oops(s, first, 'Didn’t mention the 24-hour cancellation policy', `${first} cancelled the morning of and was upset about the fee.`, '“Just so you know, we have a 24-hour cancellation policy.”', true);
  oc.said = `Perfect! ${f.slot}, I’ll see you then.`;
  return { ok: true as const, id };
}
export function sendGiftCard(s: RegState) {
  const oc = s.onCall; if (!oc || oc.outcome) return null; const c = oc.call, f = oc.form, d = oc.did, first = c.name.split(' ')[0];
  const amount = Number(f.amount); if (!amount || !f.recipient || !f.recipientEmail) return { ok: false as const, why: 'Fill in the amount, who it’s for and where to send it.' };
  oc.outcome = { kind: 'giftcard', amount };
  if (String(amount) !== c.facts.amount) oops(s, first, `Sold a ${'$'}${amount} gift card; ${first} asked for ${'$'}${c.facts.amount}`, `${first} was charged the wrong amount.`, 'Repeat the amount back before sending the link.');
  if (norm(f.recipient) !== norm(c.facts.recipient) || norm(f.recipientEmail) !== c.facts.recipientEmail) oops(s, first, 'Sent the gift card to the wrong name or email', `${c.facts.recipient.split(' ')[0]} never got her birthday gift.`, 'Ask them to spell the name and email, then read both back.');
  if (d.paid !== 'link') oops(s, first, 'Sent a gift card without taking payment the safe way', 'The card was sent before it was paid for.', 'Text a secure payment link; send the gift card once it’s paid.');
  oc.said = 'Oh, she’s going to love it. Thank you!';
  return { ok: true as const };
}
/** A free fix for gel that lifts within 7 days. She'll take it once she feels heard. */
export function offerRepair(s: RegState, slot: string) {
  const oc = s.onCall; if (!oc || oc.outcome) return; const d = oc.did;
  if (!d.apologized || d.blamed) { d.wantsManager = true; oc.said = d.blamed ? 'I’d rather talk to a manager.' : 'I mean… fine, but honestly I’d like to speak to a manager.'; return; }
  oc.outcome = { kind: 'repair', slot }; oc.said = `Thank you, ${slot} works. I really appreciate it.`;
}
export const STAFF = ['Ana', 'Mei', 'Hana', 'Diego'];
/** Hand the call to someone. Warm = tell them who's calling and why first. */
export function transfer(s: RegState, to: string, warm: boolean) {
  const oc = s.onCall; if (!oc || oc.outcome) return; const c = oc.call, first = c.name.split(' ')[0], k = c.kind;
  const voicemail = /voicemail/.test(to);
  oc.outcome = { kind: 'transferred', to, warm };
  if (to === MANAGER && !warm) oops(s, first, `Transferred ${first} to ${MANAGER} without a word`, `${MANAGER} picked up with no idea who was calling or why, and ${first} had to start over.`, `Warm transfer: “${MANAGER}, I have ${first} on the line about …” then connect.`, true);
  if (to === MANAGER && k === 'sales') oops(s, first, `Put a sales call through to ${MANAGER}`, `${MANAGER} lost ten minutes to a pitch.`, 'Take their info for the manager instead.', true);
  if (STAFF.includes(to) && !voicemail) oops(s, first, `Put the call through to ${to} in the middle of a service`, `${to} had to stop working on a client to take it.`, 'Providers don’t take calls during services. Take a message or offer their voicemail.', true);
  if (to === MANAGER && !['upset', 'sales'].includes(k)) oops(s, first, `Sent ${first} to the manager for something you could handle`, `${MANAGER} had to stop what she was doing.`, 'Handle what you can; transfer when the caller asks for a manager or it needs approval.', true);
  oc.said = voicemail ? 'Sure, I’ll leave her a message.' : `Okay, thank you.`;
}

// ── Ending a call, and the review ───────────────────────────────────────
function reviewOf(s: RegState, oc: CallState, result: string): CallReview {
  const k = oc.call.kind, d = oc.did; const items: { label: string; ok: boolean }[] = [];
  items.push({ label: oc.call.outbound ? 'Said who you are and why you’re calling' : 'Greeted with the salon’s name and offered help', ok: d.greeted === 'great' });
  if (k !== 'wrong' && k !== 'sales') items.push({ label: 'Confirmed who they are', ok: !!d.identity || !!oc.found });
  if (oc.holds) items.push({ label: 'Asked before putting them on hold', ok: oc.holdsAsked === oc.holds });
  if (oc.holds && (oc.longHoldMissed || d.checkedBack)) items.push({ label: 'Checked back during a long hold', ok: !oc.longHoldMissed });
  if (oc.outcome && ['rescheduled', 'cancelled', 'booked', 'giftcard', 'repair', 'message'].includes(oc.outcome.kind)) items.push({ label: 'Read the details back', ok: !!d.readBack });
  if (k !== 'wrong') items.push({ label: 'Closed warmly (“Anything else I can help with?”)', ok: !!d.anythingElse });
  const ok = items.filter((i) => i.ok).length;
  return { id: oc.call.id, who: oc.call.name, kind: k, outbound: !!oc.call.outbound, seconds: Math.round(s.t - oc.started), result, score: items.length ? Math.round((ok / items.length) * 100) : 100, checklist: items, mistakes: s.mistakes.slice(oc.mStart), transcript: oc.history.slice() };
}
const resultText = (o: Outcome | null) => !o ? 'No help' : o.kind === 'rescheduled' ? `Moved to ${o.slot}` : o.kind === 'cancelled' ? `Cancelled${o.fee ? ' with fee' : ''}` : o.kind === 'message' ? `Message for ${o.for}` : o.kind === 'booked' ? 'Booked' : o.kind === 'answered' ? 'Answered' : o.kind === 'giftcard' ? `Gift card ${'$'}${o.amount}` : o.kind === 'transferred' ? `Transferred to ${o.to}${o.warm ? ' (warm)' : ''}` : o.kind === 'declined' ? 'Declined politely' : o.kind === 'redirected' ? 'Wrong number, redirected' : `Free fix ${o.slot}`;
/** Hang up. Anything missed goes through and shows up later. */
export function endCall(s: RegState) {
  const oc = s.onCall; if (!oc) return null; const c = oc.call, who = c.name, first = who.split(' ')[0], at = s.t; const k = c.kind, d = oc.did, o = oc.outcome;
  const add = (what: string, later: string, right: string, minor = false) => s.mistakes.push({ at, who, what, later, right, ...(minor ? { minor: true } : {}) });
  if (k === 'reschedule' || k === 'cancel') {
    const right = bk(s, c.booking)!; const got = bk(s, oc.found);
    if (!o) add(`Hung up without helping ${who}`, c.want === 'cancel' ? `${who} didn’t come, and the slot sat empty.` : `${who} missed the appointment and was charged a no-show fee.`, 'Stay on until it’s done: find the booking, then move or cancel it while they’re on the line.');
    else if (o.kind === 'message') add(`Took a message instead of helping ${who}`, 'Nobody called back before the appointment.', 'You can move or cancel a booking right on the call. Don’t promise a callback time.', true);
    else if (o.kind === 'rescheduled' || o.kind === 'cancelled') {
      if (!got) add(`Changed a booking without finding ${who}’s`, 'The real appointment stayed on the books.', 'Find the booking first: name plus phone.');
      else if (got.id !== right.id) { add(`Changed ${got.name}’s booking instead of ${right.name}’s`, `${got.name} showed up to a missing appointment and ${right.name} was marked a no-show.`, 'Confirm the full name and the appointment time before changing anything.'); right.status = 'booked'; }
      if (o.kind === 'cancelled') {
        const within = right.day === 'Sun';   // tomorrow morning: inside 24 hours
        if (!oc.offeredAnotherDay) add(`Cancelled ${who} without offering another day`, `${who} would have rebooked. The chair stayed empty.`, 'Before cancelling, offer another day. Most people would rather move than cancel.', true);
        if (within && o.fee && right.courtesyLeft > 0) add(`Charged ${who} a late-cancel fee`, `${who} still had a courtesy this year. She left a 2-star review and stopped booking.`, `Inside 24 hours the fee is ${'$'}${CANCEL_FEE}, unless the client has a courtesy left. Use it, and tell them it’s been used.`);
      }
    }
  } else if (k === 'book') {
    if (o?.kind !== 'booked') add(`Hung up without booking ${first}`, `${first} booked somewhere else.`, 'Take the booking while they’re on the phone: service, time, name, phone, email, deposit link.');
  } else if (k === 'price') {
    if (!d.quoted) add(`Didn’t give ${first} the price`, `${first} called another salon.`, 'Quote the price from the menu, then offer to book.');
    if (!d.offeredBook) add(`Didn’t offer to book ${first}`, `${first} meant to call back and forgot.`, '“Would you like me to book that for you?” after every price question.', true);
    else if (o?.kind !== 'booked') add(`${first} said yes, but the booking never got made`, `${first} showed up Saturday to no appointment.`, 'When they say yes, book it on the call: time, name, phone, email, deposit link.');
  } else if (k === 'giftcard') { if (!o) add(`Hung up without selling ${first} the gift card`, `${first} bought one online somewhere else.`, 'Amount, who it’s for, where to email it, then a secure payment link.'); }
  else if (k === 'directions') { if (!d.info) add(`Didn’t tell ${first} where to park`, `${first} circled the block and arrived 15 minutes late.`, `Give the address and parking: ${SALON.address}. ${SALON.parking}`); else if (!d.confirmed) add(`Didn’t confirm ${first}’s appointment`, 'A quick confirm would have caught any mix-up.', '“See you at 1:00 with Ana!”', true); }
  else if (k === 'upset') {
    if (!o) add(`Left ${first}’s problem unsolved`, `${first} posted a 1-star review about lifting nails before a wedding.`, `Listen, apologize, then offer the free fix (gel that lifts within 7 days), or a warm transfer to ${MANAGER} if she asks.`);
    else if (o.kind === 'transferred' && o.to !== MANAGER) add(`Sent ${first} to the wrong person`, `${first} got more upset.`, `Offer the free fix, or warm-transfer to ${MANAGER}.`);
    if (!d.apologized && !d.blamed) add(`Didn’t apologize to ${first}`, `${first} felt brushed off.`, '“I’m so sorry, that’s frustrating.” Say it before anything else.', true);
  } else if (k === 'provider') { if (!o) add(`Hung up without taking ${first}’s message`, 'Ana never heard about the design.', 'Explain she’s with a client and take a message (no set callback time).'); else if (o.kind === 'message' && !(oc.form.message || '').trim()) add('Took a message with nothing in it', 'Ana didn’t know what to call back about.', 'Write who, the number and what it’s about.', true); }
  else if (k === 'wrong') { if (!o) add('Hung up on a wrong number without a word', 'The caller called back three times.', '“I’m sorry, you’ve reached Opal Salon.” Polite and quick.', true); }
  else if (k === 'sales') { if (!o) add('Hung up on a sales call mid-sentence', 'The company called back twice more.', '“Thanks, but we’re not interested,” or take their info for the manager.', true); }
  const rv = reviewOf(s, oc, resultText(o));
  const clean = rv.mistakes.filter((m) => !m.minor).length === 0; const points = clean ? 60 + Math.round(rv.score / 5) : 20;
  s.points += points; s.done.push({ who: `📞 ${who}`, seconds: Math.round(s.t - oc.started), clean, total: 0, points }); s.streak = clean ? s.streak + 1 : 0; s.bestStreak = Math.max(s.bestStreak, s.streak);
  s.reviews.push(rv); s.log.push(`Call with ${who}: ${rv.result}.`); s.onCall = null;
  return { clean, points, review: rv };
}
/** End of shift: voicemails nobody returned. */
export function phoneWrapUp(s: RegState) {
  if (s.wrapped) return; s.wrapped = true;
  for (const v of s.voicemails) if (!v.returned) s.mistakes.push({ at: s.t, who: v.call.name, what: `Didn’t call ${v.call.name} back`, later: `${v.call.name} gave up and went elsewhere.`, right: 'Return every voicemail the same day, starting with the oldest.' });
}

// ── Phone scripts (also printed for the Academy) ────────────────────────
export const SCRIPTS: { title: string; when: string; lines: string[] }[] = [
  { title: 'Answering', when: 'Every call, within three rings', lines: ['“Thank you for calling Opal Salon, this is [your name]. How can I help?”', 'If a guest is at the desk: “Excuse me one moment,” then answer.', 'Smile when you talk. It changes your voice.'] },
  { title: 'Confirming who you’re talking to', when: 'Before you look anything up', lines: ['“May I have your full name, please?” Then ask them to spell it.', 'Caller ID shows a name? “Is this Kim?”', 'Confirm the phone number on the profile: “Is this still the best number for you?”'] },
  { title: 'Putting someone on hold', when: 'When you need a moment', lines: ['“May I place you on a brief hold?” Wait for a yes.', 'Check back every 30 to 45 seconds: “Thanks so much for holding, I’m still working on it.”', 'Coming back: “Thank you for holding.” Over two minutes, offer to call them back.'] },
  { title: 'Two lines at once', when: 'Line 2 rings while you’re on a call', lines: ['“May I place you on a brief hold? Another line is ringing.”', 'Answer line 2, take their name and number, and ask if you can call right back, or ask them to hold.', 'Return to the first caller: “Thank you for holding.”'] },
  { title: 'Booking a new client', when: 'Someone new wants an appointment', lines: ['Service → day and time → full name (spelled) → phone → email.', `“To hold your time, we take a ${'$'}${DEPOSIT} deposit. I’ll text you a secure link.” Never take a card number out loud.`, '“Just so you know, we have a 24-hour cancellation policy.”', '“Just to confirm: a gel manicure with Ana, Wednesday at 11:00.”'] },
  { title: 'Moving or cancelling', when: 'A client can’t make it', lines: ['Find the booking: name, then the appointment time.', 'Before cancelling: “Would another day work better?”', `Inside 24 hours, the fee is ${'$'}${CANCEL_FEE} unless they have a courtesy left this year. Use it and tell them.`] },
  { title: 'Price questions', when: 'Someone asks how much', lines: ['Quote from the menu: “A gel manicure is $45, and nail art starts at $10.”', 'Then offer: “Would you like me to book that for you?”'] },
  { title: 'Gift cards', when: 'Someone wants to buy one', lines: ['Amount → who it’s for (spelled) → their email.', '“I’ll text you a secure payment link, and we’ll email the gift card as soon as it’s paid.”'] },
  { title: 'An upset client (Listen, Apologize, Solve, Thank)', when: 'Something went wrong', lines: ['Listen: “I’m so sorry. Can you tell me what happened?”', 'Apologize: “That’s frustrating, especially before a wedding.” Never ask what they did wrong.', 'Solve: gel that lifts within 7 days gets a free fix. Offer the earliest time.', `Asked for a manager? Warm transfer: “${MANAGER}, I have Tasha on the line about lifting gel from Wednesday.”`] },
  { title: 'Asking for a provider', when: '“Is Ana there?”', lines: ['“Ana’s with a client right now. Can I help, or take a message for her?”', 'Write who, their number and what it’s about. Don’t promise a callback time.'] },
  { title: 'Directions and parking', when: 'Someone’s on the way', lines: [`“We’re at ${SALON.address}. ${SALON.parking}”`, 'Offer to text the address, then confirm their appointment.'] },
  { title: 'Wrong numbers and sales calls', when: 'Not a client', lines: ['Wrong number: “I’m sorry, you’ve reached Opal Salon.”', 'Sales: “Thanks, but we’re not interested,” or “I can pass your info to our manager.”', 'Never give out anyone’s personal number.'] },
  { title: 'Voicemail', when: 'Start of shift and after missed calls', lines: ['Return every voicemail the same day, oldest first.', '“Hi, this is [your name] from Opal Salon, returning your call.”'] },
  { title: 'Closing every call', when: 'Before you hang up', lines: ['Read the details back.', '“Is there anything else I can help with?”', '“Thank you for calling, have a great day!”'] },
];

/** What the caller knows, for the AI client and the second player's role card. */
export function callerBrief(s: RegState, oc: CallState) {
  const c = oc.call; const b = bk(s, c.booking);
  const facts = [c.goal, b ? `Your booking: ${b.service} with ${b.provider}, ${b.when}.` : '', c.facts.name ? `Your name: ${c.facts.name}.` : '', c.facts.phone ? `Your phone: ${c.facts.phone}.` : '', c.facts.email ? `Your email: ${c.facts.email}.` : '', c.facts.recipient ? `Gift card for: ${c.facts.recipient} (${c.facts.recipientEmail}), ${'$'}${c.facts.amount}.` : ''].filter(Boolean);
  return { who: c.name, persona: c.persona, facts, outbound: !!c.outbound };
}
