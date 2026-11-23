// src/lib/bump-bar.ts — A BUMP BAR AT EACH STATION (pure; design board "A bump bar at each station", A: pick an order,
// then bump). A bump bar is a small keypad by the kitchen screen (or any USB keyboard): it types keys, and the screen
// (app/kds) turns them into what a cook would tap.
//   - Every order or ticket on the screen has a number in its corner, 1 to 9, in reading order. Its number picks it;
//     the same number twice quickly moves it along straight away.
//   - Bump moves the picked one along: made (ready), then out (served, or bagged and out), and picks the next one. One
//     with an allergy nobody has noted isn't moved by a key: the cook taps Allergy noted on the screen, having read it.
//   - Next and Previous (the arrows) move between them. Recall brings back the last one this screen moved, for 10
//     minutes, unless it's been handed over (api/kitchen 'recall').
//   - The usual keys work with no setup (numbers, arrows, Enter, Backspace); "Set up a bump bar" learns a bar's own keys,
//     one press each, kept on that tablet.
// Taps keep working as before; the keys are only another way in.

export type BumpAction = 'bump' | 'recall' | 'next' | 'prev' | `pick${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9}`;
/** The keys a bar is set up with, in the order the setup asks for them. */
export const LEARN_ORDER: BumpAction[] = ['bump', 'recall', 'next', 'prev', 'pick1', 'pick2', 'pick3', 'pick4', 'pick5', 'pick6', 'pick7', 'pick8', 'pick9'];
export const MAX_NUMBERED = 9;
/** The same number twice within this long moves it along. */
export const DOUBLE_MS = 700;
/** How long a move can be brought back. */
export const RECALL_MS = 10 * 60000;
/** Where a tablet keeps its bar's own keys, and whether the key strip shows. */
export const KEYS_STORE = 'cf.kitchen.bumpKeys';
export const STRIP_STORE = 'cf.kitchen.bumpStrip';

/** What each action is called on the screen and in the setup. */
export const ACTION_WORDS: Record<BumpAction, string> = {
  bump: 'Bump', recall: 'Recall', next: 'Next', prev: 'Previous',
  pick1: '1', pick2: '2', pick3: '3', pick4: '4', pick5: '5', pick6: '6', pick7: '7', pick8: '8', pick9: '9',
};

type KeyLike = { key?: string; code?: string; ctrlKey?: boolean; altKey?: boolean; shiftKey?: boolean; metaKey?: boolean };

/** One key press as the bar sends it, the same each time it's pressed: its physical key (or the key typed, when the bar
 *  gives no code), with any held modifier. */
export function keySig(e: KeyLike): string {
  const base = String(e.code || e.key || '').slice(0, 32);
  if (!base || base === 'Unidentified') return '';
  return `${e.ctrlKey ? 'Ctrl+' : ''}${e.altKey ? 'Alt+' : ''}${e.metaKey ? 'Meta+' : ''}${e.shiftKey ? 'Shift+' : ''}${base}`;
}
/** A key as a person reads it: "Enter", "F2", "Ctrl+B", "Numpad 4". */
export function keyWords(sig: string): string {
  return String(sig || '').replace(/Key([A-Z])$/, '$1').replace(/Digit(\d)$/, '$1').replace(/^(.*?)Numpad(\w+)$/, '$1Numpad $2').replace(/Arrow(\w+)$/, '$1 arrow');
}
/** Modifier keys alone are never a bar's key (a bar that sends Ctrl+F1 sends the Ctrl first). */
export const isModifierOnly = (e: KeyLike) => ['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Fn', 'OS'].includes(String(e.key || ''));

/** The usual keys, with no setup: numbers (on the top row or the number pad), the arrows, Enter and Backspace. */
export function defaultAction(e: KeyLike): BumpAction | null {
  if (e.ctrlKey || e.altKey || e.metaKey) return null;
  const k = String(e.key || '');
  if (/^[1-9]$/.test(k)) return `pick${Number(k)}` as BumpAction;
  if (k === 'Enter') return 'bump';
  if (k === 'Backspace' || k === 'Delete') return 'recall';
  // (Page Up and Page Down still scroll the screen.)
  if (k === 'ArrowDown' || k === 'ArrowRight') return 'next';
  if (k === 'ArrowUp' || k === 'ArrowLeft') return 'prev';
  return null;
}

export type LearnedKeys = Partial<Record<BumpAction, string>>;
/** A tablet's learned keys, as kept: only known actions, each a key on its own (a key learned twice keeps its last use). */
export function cleanLearned(raw: unknown): LearnedKeys {
  const src = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const out: LearnedKeys = {}; const used = new Set<string>();
  for (const a of [...LEARN_ORDER].reverse()) {
    const sig = typeof src[a] === 'string' ? String(src[a]).slice(0, 60) : '';
    if (!sig || used.has(sig)) continue;
    used.add(sig); out[a] = sig;
  }
  return out;
}
/** Learn one key for an action: any other action that had the same key loses it. */
export function learn(keys: LearnedKeys, action: BumpAction, sig: string): LearnedKeys {
  const out: LearnedKeys = {};
  for (const [a, s] of Object.entries(keys) as [BumpAction, string][]) if (s !== sig && a !== action) out[a] = s;
  if (sig) out[action] = sig;
  return out;
}

/** What a key press does: a learned key first, then the usual keys (unless that usual key was learned for something
 *  else, so a bar whose Recall sends Enter never bumps). */
export function actionOf(e: KeyLike, keys: LearnedKeys): BumpAction | null {
  const sig = keySig(e); if (!sig) return null;
  for (const [a, s] of Object.entries(keys) as [BumpAction, string][]) if (s === sig) return a;
  return defaultAction(e);
}

export const pickNumber = (a: BumpAction): number | null => (a.startsWith('pick') ? Number(a.slice(4)) : null);

/** The number in a card's corner (1 to 9, in reading order), or null past the ninth. */
export const numberOf = (index: number): number | null => (index >= 0 && index < MAX_NUMBERED ? index + 1 : null);

/** A number pressed: which card it picks, and whether it's the same number pressed twice quickly (move it along). */
export function pressNumber(keys: string[], n: number, last: { n: number; at: number } | null, now: number): { focus: string | null; bumpNow: boolean } {
  const focus = keys[n - 1] ?? null;
  if (!focus) return { focus: null, bumpNow: false };
  return { focus, bumpNow: !!last && last.n === n && now - last.at <= DOUBLE_MS };
}

/** Next or previous from the card picked (the first, with none picked yet); stops at the ends. */
export function moveFocus(keys: string[], current: string | null, dir: 'next' | 'prev'): string | null {
  if (!keys.length) return null;
  const i = current ? keys.indexOf(current) : -1;
  if (i < 0) return keys[0];
  return keys[Math.max(0, Math.min(keys.length - 1, i + (dir === 'next' ? 1 : -1)))];
}

/** After the screen changes (one moved along, a new one in), the card picked stays picked while it's there; when it's
 *  gone, the one now in its place is (or the last one); with nothing up, none. */
export function keepFocus(prevKeys: string[], keys: string[], current: string | null): string | null {
  if (!current) return null;
  if (keys.includes(current)) return current;
  if (!keys.length) return null;
  const was = prevKeys.indexOf(current);
  if (was < 0) return null;
  // (The first card after it that's still up, else the last.)
  for (const k of prevKeys.slice(was + 1)) if (keys.includes(k)) return k;
  return keys[keys.length - 1];
}

/** One ticket the way it's moved along: by a key, it's made (ready) first, then out. Null when a key can't move it. */
export type TicketLike = { status: string; needsNote: boolean };
export function bumpStep(t: TicketLike): 'ready' | 'deliver' | 'note' | null {
  if (t.needsNote) return 'note';
  if (t.status === 'pending' || t.status === 'in_progress') return 'ready';
  if (t.status === 'ready') return 'deliver';
  return null;
}

/** What this screen moved, newest last, to bring back with Recall: kitchen tickets only (a lounge order's stock and
 *  money move as it's delivered), and only for RECALL_MS. */
export type Moved = { tickets: { col: string; id: string }[]; from: 'ready' | 'deliver'; at: number; label: string };
export const MAX_MOVED = 20;
export function remember(list: Moved[], m: Moved): Moved[] {
  const tickets = m.tickets.filter((t) => t.col === 'kdsTickets');
  if (!tickets.length) return list;
  return [...list, { ...m, tickets }].slice(-MAX_MOVED);
}
/** The newest move that can still be brought back, and the list without it; or none. */
export function lastMoved(list: Moved[], now: number): { m: Moved; rest: Moved[] } | null {
  const live = list.filter((x) => now - x.at < RECALL_MS);
  if (!live.length) return null;
  return { m: live[live.length - 1], rest: live.slice(0, -1) };
}

/** Whether a ticket can be brought back now, on the server (api/kitchen 'recall'): one this screen marked ready goes
 *  back to being made, one it marked out back to ready, within RECALL_MS of that, and never once its order has been
 *  handed over or its table's check closed. `from` is the step this screen took: a ticket another screen has moved on
 *  since (served what this one readied) is left as it is, so Recall only ever undoes this screen's own move. */
export function canRecall(t: { status?: string; readyAt?: string | null; deliveredAt?: string | null }, from: 'ready' | 'deliver', now: number): { to: 'in_progress' | 'ready' } | { no: 'late' | 'moved' } {
  const s = String(t?.status || '');
  const since = (iso: unknown) => { const at = Date.parse(String(iso || '')); return Number.isFinite(at) ? now - at : Infinity; };
  if (from === 'ready' && s === 'ready') return since(t.readyAt) <= RECALL_MS ? { to: 'in_progress' } : { no: 'late' };
  if (from === 'deliver' && s === 'delivered') return since(t.deliveredAt) <= RECALL_MS ? { to: 'ready' } : { no: 'late' };
  return { no: 'moved' };
}
