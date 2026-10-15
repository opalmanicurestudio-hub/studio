// src/lib/waitlist-calls.ts — the voice assistant calls about a same-day opening. Off unless the owner turns it on.
// Rules: only for an opening under 3 hours away, between 9am and 7pm local, one call at a time to at most 3 people
// who said we may call them about openings; a monthly spending cap stops it. No answer (or voicemail) → we hang up
// without a message and send the usual text offer instead. The assistant never takes card numbers on these calls:
// a deposit goes out as a link by text.
const H = 3600e3, MIN = 60000;
export const CALL_LEAD_H = 3, CALL_FROM_H = 9, CALL_UNTIL_H = 19, CALLS_PER_OPENING = 3, CALL_WAIT_MIN = 5;
export const CALL_COST_CENTS = 15;   // a rough per-call estimate, used only for the cap
export type CallSettings = { on: boolean; capDollars: number };
export function callSettingsOf(tenant: any): CallSettings {
  const w = tenant?.waitlistCalls || {}; const cap = Number(w.capDollars);
  return { on: w.on === true, capDollars: Number.isFinite(cap) && cap >= 1 && cap <= 500 ? Math.round(cap) : 20 };
}
export const monthKey = (now: number, tz: string) => new Date(now).toLocaleDateString('en-CA', { timeZone: tz }).slice(0, 7);
export const callsAllowed = (S: CallSettings) => Math.floor((S.capDollars * 100) / CALL_COST_CENTS);

/** Is this opening one we may call about right now? */
export function callWindow(startMs: number, now: number, localHour: number): boolean {
  const lead = startMs - now; return lead > 20 * MIN && lead < CALL_LEAD_H * H && localHour >= CALL_FROM_H && localHour < CALL_UNTIL_H;
}
export const mayCall = (entry: any, client: any) => !!(entry?.callOk === true || client?.openingCalls === true) && client?.doNotCall !== true;

/** What to do next for one opening, from the calls already made on it. */
export function nextCallStep(calls: any[], now: number): { wait: boolean; settle: any[]; room: number } {
  const open = (calls || []).filter((c) => c.status === 'calling');
  const settle = open.filter((c) => now - Date.parse(c.at) >= CALL_WAIT_MIN * MIN);
  return { wait: open.length > settle.length, settle, room: Math.max(0, CALLS_PER_OPENING - (calls || []).length) };
}
/** A call that ended without them picking up — the text goes out instead. */
export function unanswered(call: any): boolean {
  if (!call) return true; const why = String(call.disconnectionReason || '');
  if (/no_answer|voicemail|busy|dial_failed|machine/.test(why)) return true;
  return (Number(call.durationSeconds) || 0) < 15;
}
export function callTask(o: { first: string; business: string; service: string; provider: string; when: string }) {
  return `You are calling ${o.first} from ${o.business}. They are on the waitlist, and a ${o.service} with ${o.provider} just opened ${o.when}. Ask whether they would like it. If YES: book it right away with create_booking (that service, ${o.provider}, that exact time), confirm the time back to them, and end warmly. If the booking needs a deposit, tell them a link is on its way by text. Never take a card number on the call. If NO or not today: thank them, say they stay on the waitlist, and end the call. If you reach VOICEMAIL: hang up without leaving a message. Keep the whole call under two minutes.`;
}
