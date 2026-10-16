// src/lib/klair.ts — KLAIR, THE ASSISTANT INSIDE CLARITYFLOW (the agent plan, Phase 2). What she understood, who it is
// about, and what would change, worked out here; the doing happens through the same routes the app uses
// (api/klair). Her rules:
//   - She never picks a person: names are matched against real visits in code, never by the language model. Two
//     possible people means she asks which one, showing each one's next visit and the end of their phone number.
//   - She shows exactly what will change before it happens. Everyday changes have Undo; money waits for approval.
//   - Asked from inside a visit, she only means that client.
// The business can rename her and choose her voice (Settings → Klair). Part of the ClarityFlow Assistant add-on.
import { assistantAddon } from '@/lib/agent-access';

export const DEFAULT_NAME = 'Klair';
export function klairSettings(t: any) {
  const k = t?.klair || {};
  const name = String(k.name || '').trim().slice(0, 24) || DEFAULT_NAME;
  return { on: assistantAddon(t) && k.enabled !== false, name, voice: String(k.voice || 'warm'), speak: k.speak !== false };
}

export type Intent = 'next' | 'unconfirmed' | 'gaps' | 'week' | 'move' | 'late' | 'confirm' | 'send' | 'rebook' | 'refund' | 'unknown';
export const ACT_INTENTS: Intent[] = ['move', 'confirm', 'send', 'rebook', 'refund'];
export type SendKind = 'visit_link' | 'aftercare' | 'review' | 'rebook';
export interface Plan { intent: Intent; person: string | null; date: string | null; time: string | null; minutes: number | null; weeks: number | null; kind: SendKind | null; spans: string[]; heard: string }

const W = (s: string) => s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/['’]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

/** The model's instructions: read one request into a plan. Names stay as heard; it never chooses a person. */
export function planPrompt(o: { today: string; weekday: string; tz: string; name: string; inVisitClient?: string | null }) {
  return `You are ${o.name}, the assistant inside a salon and studio app. Read ONE spoken or typed request from a staff member and reply with JSON only:
{"intent":"next|unconfirmed|gaps|week|move|late|confirm|send|rebook|refund|unknown","person":string|null,"date":"YYYY-MM-DD"|null,"time":"HH:mm"|null,"minutes":number|null,"weeks":number|null,"kind":"visit_link|aftercare|review|rebook"|null,"spans":[exact substrings of the request you used]}
Meanings: next = what or who is next; unconfirmed = visits not confirmed (usually tomorrow); gaps = open time today; week = how the week is going (money); move = move a client's visit to another day/time; late = tell my next clients I'm running N minutes late (minutes); confirm = ask a client to confirm; send = send a client a link (kind); rebook = book a client again in N weeks (weeks); refund = refund or waive money.
Today is ${o.weekday} ${o.today} (${o.tz}). Resolve "Thursday", "tomorrow", "next week" to a date on or after today. "at 3" in a salon means 3 PM unless they say morning. person = the client's name exactly as said (no guessing, no completing).${o.inVisitClient ? ` They are looking at ${o.inVisitClient}'s visit; "her", "him", "them" or no name means ${o.inVisitClient}.` : ''} If unsure what they want, intent "unknown".`;
}

/** A plan from the model's JSON, cleaned and limited to what the request actually contains. */
export function cleanPlan(j: any, heard: string): Plan {
  const intents: Intent[] = ['next', 'unconfirmed', 'gaps', 'week', 'move', 'late', 'confirm', 'send', 'rebook', 'refund', 'unknown'];
  const kinds: SendKind[] = ['visit_link', 'aftercare', 'review', 'rebook'];
  const inHeard = (s: any) => typeof s === 'string' && s.trim() && heard.toLowerCase().includes(s.trim().toLowerCase());
  return {
    intent: intents.includes(j?.intent) ? j.intent : 'unknown',
    person: inHeard(j?.person) ? String(j.person).trim().slice(0, 60) : null,
    date: /^\d{4}-\d{2}-\d{2}$/.test(String(j?.date || '')) ? j.date : null,
    time: /^\d{2}:\d{2}$/.test(String(j?.time || '')) ? j.time : null,
    minutes: Number.isFinite(Number(j?.minutes)) && Number(j.minutes) > 0 ? Math.min(180, Math.round(Number(j.minutes))) : null,
    weeks: Number.isFinite(Number(j?.weeks)) && Number(j.weeks) > 0 ? Math.min(26, Math.round(Number(j.weeks))) : null,
    kind: kinds.includes(j?.kind) ? j.kind : null,
    spans: Array.isArray(j?.spans) ? j.spans.filter(inHeard).map((s: string) => s.trim()).slice(0, 8) : [],
    heard,
  };
}

/** Without the language model: the plain requests, by their words. */
export function plainPlan(heard: string): Plan {
  const s = W(heard); const base: Plan = { intent: 'unknown', person: null, date: null, time: null, minutes: null, weeks: null, kind: null, spans: [], heard };
  if (/\b(confirm(ed)?)\b/.test(s) && /\b(who|hasnt|havent|not)\b/.test(s)) return { ...base, intent: 'unconfirmed' };
  if (/\b(whats|whos) next\b|\bnext client\b/.test(s)) return { ...base, intent: 'next' };
  if (/\b(gaps?|open time|free time|openings?)\b/.test(s)) return { ...base, intent: 'gaps' };
  if (/\b(this week|the week|hows the week)\b/.test(s)) return { ...base, intent: 'week' };
  const late = s.match(/\b(\d{1,3}) ?(min|mins|minutes)\b.*\b(late|behind)\b|\b(late|behind)\b.*\b(\d{1,3}) ?(min|mins|minutes)\b/);
  if (late) return { ...base, intent: 'late', minutes: Math.min(180, Number(late[1] || late[5])) };
  return base;
}

export interface Candidate { clientId: string | null; clientName: string; phoneLast4: string | null; next: { id: string; startTime: string; serviceName: string; staffName: string } | null; last: { id: string; startTime: string } | null }

/** Who a name could mean: clients with a visit from 120 days ago to 60 days ahead. Best matches first; several only when equally good. */
export function matchPeople(name: string, appointments: any[], clients: any[], now = Date.now(), staff: any[] = []): Candidate[] {
  const q = W(name).split(' ').filter(Boolean); if (!q.length) return [];
  const live = (a: any) => !['cancelled', 'canceled', 'declined', 'no_show', 'expired'].includes(String(a.status || ''));
  const t = (a: any) => Date.parse(String(a.startTime || '')) || 0;
  const window = appointments.filter((a) => live(a) && t(a) > now - 120 * 864e5 && t(a) < now + 60 * 864e5);
  const byClient = new Map<string, any[]>();
  for (const a of window) { const k = String(a.clientId || `name:${W(a.clientName || '')}`); byClient.set(k, [...(byClient.get(k) || []), a]); }
  const scored: { c: Candidate; score: number }[] = [];
  for (const [k, list] of byClient) {
    const cl = clients.find((c) => c.id === list[0].clientId) || {};
    const full = String(cl.name || list[0].clientName || '').trim(); if (!full) continue;
    const parts = W(full).split(' ').filter(Boolean);
    let score = 0;
    if (W(full) === q.join(' ')) score = 100;
    else if (q.length >= 2 && parts[0] === q[0] && parts.slice(1).some((p) => p.startsWith(q[q.length - 1]))) score = 90;
    else if (q.length === 1 && parts.some((p) => p === q[0])) score = 60;
    else if (q.length === 1 && parts[0]?.startsWith(q[0]) && q[0].length >= 3) score = 40;
    if (!score) continue;
    const upcoming = list.filter((a) => t(a) >= now - 3 * 3600e3).sort((a, b) => t(a) - t(b));
    const past = list.filter((a) => t(a) < now).sort((a, b) => t(b) - t(a));
    const n = upcoming[0]; const phone = String(cl.phone || n?.clientPhone || list[0].clientPhone || '').replace(/\D/g, '');
    const sname = (a: any) => String(staff.find((m: any) => m.id === a?.staffId)?.name || a?.staffName || '').split(' ')[0];
    scored.push({ score, c: { clientId: list[0].clientId || null, clientName: full, phoneLast4: phone.length >= 4 ? phone.slice(-4) : null,
      next: n ? { id: n.id, startTime: n.startTime, serviceName: String(n.serviceName || 'visit'), staffName: sname(n) } : null, last: past[0] ? { id: past[0].id, startTime: past[0].startTime } : null } });
    void k;
  }
  if (!scored.length) return [];
  const best = Math.max(...scored.map((x) => x.score));
  return scored.filter((x) => x.score === best).map((x) => x.c).slice(0, 4);
}

/** The words to underline: the parts of the request she used. */
export function underline(heard: string, spans: string[]): { text: string; got: boolean }[] {
  const out: { text: string; got: boolean }[] = []; let rest = heard;
  const marks = spans.filter(Boolean).sort((a, b) => heard.toLowerCase().indexOf(a.toLowerCase()) - heard.toLowerCase().indexOf(b.toLowerCase()));
  for (const m of marks) { const i = rest.toLowerCase().indexOf(m.toLowerCase()); if (i < 0) continue; if (i > 0) out.push({ text: rest.slice(0, i), got: false }); out.push({ text: rest.slice(i, i + m.length), got: true }); rest = rest.slice(i + m.length); }
  if (rest) out.push({ text: rest, got: false });
  return out;
}

/** What she says out loud: short, names the person and the change, never money amounts or private details. */
export function spokenLine(kind: 'listening' | 'choose' | 'preview' | 'done' | 'needs_ok' | 'answer', o: { name?: string; change?: string; count?: number; text?: string } = {}) {
  const first = String(o.name || '').split(' ')[0];
  switch (kind) {
    case 'listening': return 'I’m listening.';
    case 'choose': return `I have ${o.count || 2} people called ${first}. Which one?`;
    case 'preview': return `${o.name}${o.change ? `, ${o.change}` : ''}. Shall I?`;
    case 'done': return `Done.${first ? ` ${first} has been told.` : ''}`;
    case 'needs_ok': return `That needs your OK.`;
    default: return String(o.text || '').split(/(?<=[.?!])\s/)[0].slice(0, 160);
  }
}
