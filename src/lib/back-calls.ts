// src/lib/back-calls.ts — CALLS TO THE DISH PIT AND THE BARBACK (design canvas "Dish and barback"; lib/back-calls-server,
// api/back, the kitchen screen's Call, the dish screen at /dish and the barback's at /barback). A station taps what it
// needs ("Plates", "Ice", "A bottle of house vodka"); whoever's on dish or barback says "On my way" so nobody doubles up,
// then "Done". The station sees who's coming. A call nobody has taken after a few minutes tells the managers on shift.
// The kitchen can call people too (design canvas "The bar and the pass"): a runner (food to run, from expo, with the
// table and what's on it), a table's server (their section on tonight's floor) or a manager. Their phones buzz, and
// they take it from My tables. Pure.

export type CallTo = 'dish' | 'barback' | 'runner' | 'server' | 'manager';
/** Calls that go to people's phones rather than a station's screen. */
export const PEOPLE: CallTo[] = ['runner', 'server', 'manager'];
export type CallStatus = 'open' | 'coming' | 'done' | 'cancelled';
export type CallKind = { id: string; label: string; needsNote?: boolean; needsTable?: boolean };

export const CALL_KINDS: Record<CallTo, CallKind[]> = {
  dish: [
    { id: 'plates', label: 'Plates' }, { id: 'bowls', label: 'Bowls' }, { id: 'pans', label: 'Pans to the line' },
    { id: 'cutlery', label: 'Cutlery' }, { id: 'glasses', label: 'Glasses' }, { id: 'other', label: 'Something else', needsNote: true },
  ],
  barback: [
    { id: 'ice', label: 'Ice' }, { id: 'glasses', label: 'Glasses' }, { id: 'keg', label: 'Change a keg' },
    { id: 'bottle', label: 'A bottle of…', needsNote: true }, { id: 'garnish', label: 'Limes and garnish' }, { id: 'other', label: 'Something else', needsNote: true },
  ],
  runner: [{ id: 'run', label: 'Food to run', needsTable: true }, { id: 'pass', label: 'Help at the pass' }, { id: 'other', label: 'Something else', needsNote: true }],
  server: [{ id: 'pass', label: 'Come to the pass', needsTable: true }, { id: 'question', label: 'A question about the table', needsTable: true }, { id: 'other', label: 'Something else', needsNote: true, needsTable: true }],
  manager: [{ id: 'kitchen', label: 'Come to the kitchen' }, { id: 'comp', label: 'A comp or a remake' }, { id: 'other', label: 'Something else', needsNote: true }],
};
export const TO_WORD: Record<CallTo, string> = { dish: 'The dish pit', barback: 'The barback', runner: 'A runner', server: 'The table’s server', manager: 'A manager' };
export const NOTE_MAX = 60;
/** Minutes a call can wait for someone to take it before the managers on shift are told. */
export const TELL_AFTER_MIN = 5;
/** How long a finished call stays on the screen that made it, so the station sees it was done. */
export const DONE_SHOWN_MIN = 5;

const clip = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
export const isTo = (v: unknown): v is CallTo => v === 'dish' || v === 'barback' || v === 'runner' || v === 'server' || v === 'manager';

/** A call as asked for: who it's for, which kind, and a few words (needed for "A bottle of…" and "Something else"). */
export function cleanCall(raw: any): { to: CallTo; what: string; note: string | null } | { error: string } {
  if (!isTo(raw?.to)) return { error: 'Who is it for?' };
  const kind = CALL_KINDS[raw.to as CallTo].find((k) => k.id === raw?.what);
  if (!kind) return { error: 'What do you need?' };
  const note = clip(raw?.note, NOTE_MAX) || null;
  if (kind.needsNote && !note) return { error: kind.id === 'bottle' ? 'Which bottle?' : 'Say what you need.' };
  return { to: raw.to, what: kind.id, note };
}

/** What the call says, in a few words: "Plates", "A bottle of house vodka", "Ice, well 2". */
export function callWords(to: CallTo, what: string, note: string | null | undefined): string {
  const kind = CALL_KINDS[to]?.find((k) => k.id === what);
  const n = clip(note, NOTE_MAX);
  if (what === 'bottle') return n ? `A bottle of ${n}` : 'A bottle';
  if (what === 'other') return n || 'Something else';
  return n ? `${kind?.label || 'Help'}, ${n}` : kind?.label || 'Help';
}

export type Call = { id: string; to: CallTo; what: string; note: string | null; words: string; from: string; fromId: string | null; askedBy: string | null;
  status: CallStatus; at: string; takenBy: string | null; takenById: string | null; takenAt: string | null; doneAt: string | null; doneBy: string | null; toldAt: string | null;
  /** A call to people: the table it's about ("Table 12"), and its visit and course (a run from expo). */
  table: string | null; visitId: string | null; course: string | null;
  /** Who it went to, by team record (the table's server, the runners, the managers): it shows on their My tables. */
  forIds: string[]; ticketIds: string[] };

/** A stored call, read back safely. */
export function callFrom(id: string, d: any): Call | null {
  if (!d || !isTo(d.to)) return null;
  const status: CallStatus = ['open', 'coming', 'done', 'cancelled'].includes(d.status) ? d.status : 'open';
  return { id, to: d.to, what: String(d.what || 'other'), note: d.note ? clip(d.note, NOTE_MAX) : null, words: callWords(d.to, String(d.what || 'other'), d.note),
    from: clip(d.from, 40) || 'A station', fromId: d.fromId ? String(d.fromId) : null, askedBy: d.askedBy ? clip(d.askedBy, 60) : null, status, at: String(d.at || ''),
    takenBy: d.takenBy ? clip(d.takenBy, 60) : null, takenById: d.takenById ? String(d.takenById).slice(0, 80) : null, takenAt: d.takenAt || null, doneAt: d.doneAt || null, doneBy: d.doneBy ? clip(d.doneBy, 60) : null, toldAt: d.toldAt || null,
    table: d.table ? clip(d.table, 40) : null, visitId: d.visitId ? String(d.visitId).slice(0, 160) : null, course: d.course === null || d.course === undefined ? null : clip(d.course, 20),
    forIds: Array.isArray(d.forIds) ? d.forIds.map(String).slice(0, 40) : [], ticketIds: Array.isArray(d.ticketIds) ? d.ticketIds.map(String).slice(0, 40) : [] };
}

const minsSince = (iso: string | null | undefined, now: number) => { const t = Date.parse(String(iso || '')); return Number.isFinite(t) ? Math.max(0, Math.floor((now - t) / 60000)) : 0; };

/** What's waiting for dish or the barback: nobody on it yet first (longest waiting at the top), then the ones someone's
 *  bringing. Each with how long it's waited and whether it's waited long enough for the managers to hear. */
export function callQueue(calls: Call[], to: CallTo, now = Date.now()): (Call & { mins: number; late: boolean })[] {
  return calls.filter((c) => c.to === to && (c.status === 'open' || c.status === 'coming'))
    .map((c) => ({ ...c, mins: minsSince(c.at, now), late: c.status === 'open' && minsSince(c.at, now) >= TELL_AFTER_MIN }))
    .sort((a, b) => (a.status === b.status ? a.at.localeCompare(b.at) : a.status === 'open' ? -1 : 1));
}

/** A station's own calls: the ones still going, and the ones done in the last few minutes (so it sees they were). */
export function myCalls(calls: Call[], fromId: string, now = Date.now()): Call[] {
  return calls.filter((c) => c.fromId === fromId && (c.status === 'open' || c.status === 'coming' || (c.status === 'done' && minsSince(c.doneAt, now) < DONE_SHOWN_MIN)))
    .sort((a, b) => a.at.localeCompare(b.at));
}

/** The calls for one person on their phone: the ones sent to them by name, and a runner's runs. Nobody's taken it yet, or
 *  they have. */
export function callsFor(calls: Call[], me: { id: string; runner: boolean; manager: boolean }): Call[] {
  return calls.filter((c) => PEOPLE.includes(c.to) && (c.status === 'open' || (c.status === 'coming' && c.takenById === `p_${me.id}`))
    && (c.forIds.includes(me.id) || (c.to === 'runner' && me.runner) || (c.to === 'manager' && me.manager)))
    .sort((a, b) => a.at.localeCompare(b.at));
}

/** What a person reads on their phone: "Table 12: mains. Burger, Steak frites" or "Come to the pass, Table 7". */
export function callLine(c: Call): string {
  if (c.to === 'runner' && c.what === 'run') return `${c.table || 'A table'}${c.course ? `: ${c.course}` : ''}${c.note ? `. ${c.note}` : ''}`;
  return `${c.words}${c.table ? `, ${c.table}` : ''}`;
}

/** How a station reads its call: "Waiting, 2 min", "Sam's on the way", "Done, Sam". */
export function callState(c: Call, now = Date.now()): string {
  const first = (n: string | null) => String(n || '').trim().split(/\s+/)[0] || 'Someone';
  if (c.status === 'coming') return `${first(c.takenBy)}’s on the way`;
  if (c.status === 'done') return `Done, ${first(c.doneBy || c.takenBy)}`;
  const m = minsSince(c.at, now); return m < 1 ? 'Asked just now' : `Waiting, ${m} min`;
}

/** Whether a step can be taken from where a call is: "On my way" from open, "Done" from open or on the way, "Cancel"
 *  while nobody's taken it, and "Not me after all" by whoever took it. */
export function canStep(status: CallStatus, step: 'coming' | 'done' | 'cancel' | 'release'): boolean {
  if (step === 'coming') return status === 'open';
  if (step === 'done') return status === 'open' || status === 'coming';
  if (step === 'cancel') return status === 'open';
  return status === 'coming';
}
