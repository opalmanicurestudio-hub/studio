// src/lib/arrival-nudge.ts — THEY'RE HERE (design canvas: They’re here). However a guest checks in (the front desk,
// the planner, the kiosk, their own link's I'm here), their provider is nudged once, at once (lib/arrival-nudge-server,
// api/arrival); the provider answers with one tap (Coming now, 5 minutes, 10 minutes, Send them back), and the desk sees
// the answer (components/pos/desk/HereNow), as does the guest on their own page, in first names only. No answer after
// three minutes: the desk can nudge again. On the visit: `arrivalNudge` { at, lastAt, count, to, toName, via, buzz }
// and `arrivalReply` { kind, at, by, byName, for }. Pure: shared by the screens and the server.

export type ReplyKind = 'now' | 'five' | 'ten' | 'send';
export const REPLIES: { id: ReplyKind; words: string }[] = [
  { id: 'now', words: 'Coming now' }, { id: 'five', words: '5 minutes' }, { id: 'ten', words: '10 minutes' }, { id: 'send', words: 'Send them back' },
];
export const isReply = (v: unknown): v is ReplyKind => REPLIES.some((r) => r.id === v);
export const replyWords = (k: unknown) => REPLIES.find((r) => r.id === k)?.words || '';
/** No answer this long after the first nudge: the desk can nudge again (at most once a minute). */
export const AGAIN_AFTER_MIN = 3; export const AGAIN_GAP_MS = 60000;
/** Visits past waiting: nobody is nudged about them, and nothing is shown. */
export const STARTED = ['servicing', 'completed', 'cancelled', 'no_show', 'declined', 'in_service'];

const ms = (v: any) => { const t = Date.parse(String(v?.toDate ? v.toDate().toISOString() : v || '')); return Number.isFinite(t) ? t : 0; };
export const firstOf = (v: unknown) => String(v ?? '').trim().split(/\s+/)[0] || '';
const ago = (at: number, now: number) => { const m = Math.max(0, Math.round((now - at) / 60000)); return m < 1 ? 'just now' : `${m} min ago`; };
const here = (a: any) => ['arrived', 'checked_in', 'checkedIn'].includes(String(a?.checkInStatus || '')) && !STARTED.includes(String(a?.status || '')) && String(a?.stage || '') !== 'in_service';

/** Where a guest checked in, as the nudge says it. */
export const viaWords = (via: unknown) => (via === 'kiosk' ? 'Checked in at the kiosk.' : via === 'client link' ? 'Checked in on their own link.' : 'Checked in at the desk.');

/** Why a provider's phone didn't buzz, from what the sender recorded (lib/push pushResult). */
export function buzzOf(pushResult: unknown): 'sent' | 'no phone' | 'paused' | 'failed' | 'later' {
  const p = String(pushResult || '');
  return /sent to/.test(p) ? 'sent' : /no phone|no staff record/.test(p) ? 'no phone' : /held/.test(p) ? 'paused' : /failed/.test(p) ? 'failed' : 'later';
}
const NOT_BUZZED: Record<string, string> = { 'no phone': 'no phone is set up for alerts', paused: 'their alerts are paused', failed: 'it didn’t go through' };

/** What the desk sees about a guest who's here: the provider's answer, or that they were told and how long ago, and
 *  whether it can nudge again. Null when nobody was nudged (a renter's guest, no provider, they checked them in
 *  themselves) or the visit has started. */
export function nudgeView(a: any, now: number): { text: string; tone: 'ok' | 'info' | 'warn'; canAgain: boolean } | null {
  if (!here(a)) return null;
  const r = a?.arrivalReply; const n = a?.arrivalNudge;
  if (isReply(r?.kind)) return { text: `${r.for || n?.toName || 'Their provider'}: ${replyWords(r.kind).toLowerCase()}, ${ago(ms(r.at), now)}`, tone: r.kind === 'now' || r.kind === 'send' ? 'ok' : 'info', canAgain: false };
  const first = ms(n?.at); if (!first) return null;
  const who = n.toName || 'Their provider'; const last = ms(n.lastAt) || first;
  const soon = now - last >= AGAIN_GAP_MS;
  if (NOT_BUZZED[n.buzz]) return { text: `${who} wasn’t buzzed: ${NOT_BUZZED[n.buzz]}`, tone: 'warn', canAgain: n.buzz === 'failed' && soon };
  if (now - first >= AGAIN_AFTER_MIN * 60000) return { text: `${who} was ${Number(n.count) > 1 ? `nudged ${Number(n.count) === 2 ? 'twice' : `${n.count} times`}` : `told ${ago(first, now)}`}, no answer yet`, tone: 'warn', canAgain: soon };
  return { text: `Told ${who} ${ago(first, now)}`, tone: 'info', canAgain: false };
}

/** The line on the guest's own page once they've checked in: the provider's answer when there is one (counting down a
 *  5 or 10 minute answer), otherwise that they know. */
export function guestWaitLine(who: string, when: string, reply: { kind?: unknown; at?: unknown } | null | undefined, now: number): string {
  const name = firstOf(who); const at = ms(reply?.at);
  if (isReply(reply?.kind) && at) {
    const mins = (now - at) / 60000;
    if (reply!.kind === 'send') return `${name || 'We'} ${name ? 'is' : 'are'} ready for you. Someone will show you back.`;
    const left = reply!.kind === 'now' ? 0 : Math.round((reply!.kind === 'five' ? 5 : 10) - mins);
    if (reply!.kind === 'now' && mins < 5) return `${name || 'We'} will be right out.`;
    if (left > 1) return `${name || 'We'} will be with you in about ${left} minutes.`;
    return `${name || 'We'} will be with you shortly.`;
  }
  return `${name ? `${name} knows` : 'We know'} you’re here and will be with you ${when}.`;
}
