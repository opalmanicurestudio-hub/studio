// src/lib/menu-numbers.ts — THE NUMBERS GUESTS ORDER BY ("number 3"). Every item on the menu (for everyone, not
// members-only), numbered in the order the menu board shows them: section by section as the menu lists them
// (lib/menu-server readMenu), item by item within each. The menu board shows the numbers, the lane tablet's buttons carry
// them, and the voice assistant at the speaker knows them, so a number means the same item on every screen.
export type Numbered = { id: string; section: string; onMenu?: boolean; membersOnly?: boolean };

export function menuNumbers(menu: Numbered[]): Map<string, number> {
  const shown = menu.filter((m) => m.onMenu !== false && !m.membersOnly);
  const sections: string[] = [];
  for (const m of shown) if (!sections.includes(m.section)) sections.push(m.section);
  const out = new Map<string, number>(); let n = 0;
  for (const s of sections) for (const m of shown) if (m.section === s && !out.has(m.id)) out.set(m.id, ++n);
  return out;
}

export const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];

/** The number in "number 3", "#3", "no. 3", "number three", or "3" on its own; null for anything else. (A number in
 *  words only after "number" or "#": "no one" is not number one.) */
export function spokenNumber(spoken: unknown): number | null {
  const s = String(spoken ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
  const m = /^(?:(?:the\s+)?(?:number|num|no\.?|#)\s*)?(\d{1,3})$/.exec(s);
  if (m) { const n = Number(m[1]); return n > 0 ? n : null; }
  const w = /^(?:the\s+)?(?:(?:number|num)\s+|#\s*)([a-z]+)$/.exec(s);
  if (w) { const i = NUMBER_WORDS.indexOf(w[1]); return i > 0 ? i : null; }
  return null;
}
