// src/lib/tip-split.ts — SPLITTING A TIP between the people who did the work (the screen and the server use this).
//   even   — the same to each
//   value  — in proportion to what each did (the price of their services on the ticket)
//   custom — the amounts someone typed (staff, or the client on the client screen)
// Every split comes out to the cent and adds up to the tip exactly. On the server, `checkTipSplit` makes sure only
// people who worked on the visit (or the school) get a share and that it adds up — anything unassigned goes to the main
// provider, so nothing is ever lost. Students whose program keeps tips are paid to the school ('__school').
export type TipPerson = { id: string; name: string; weight?: number };
export const SCHOOL = '__school';

const cents = (n: number) => Math.round((Number(n) || 0) * 100);

/** Split `tip` across people (by weight, or evenly) to the cent; the rounding remainder goes to the largest share. */
export function splitTip(tip: number, people: TipPerson[], mode: 'even' | 'value' = 'even'): Record<string, number> {
  const total = cents(tip); const out: Record<string, number> = {}; if (!people.length || total <= 0) return out;
  const w = people.map((p) => (mode === 'value' ? Math.max(0, Number(p.weight) || 0) : 1)); const sum = w.reduce((a, b) => a + b, 0) || people.length;
  const raw = people.map((p, i) => Math.floor((total * (sum === people.length && mode === 'value' && w.every((x) => x === 0) ? 1 : w[i])) / sum));
  let left = total - raw.reduce((a, b) => a + b, 0); const order = raw.map((v, i) => i).sort((a, b) => w[b] - w[a] || a - b);
  for (let k = 0; left > 0; k = (k + 1) % order.length, left--) raw[order[k]]++;
  people.forEach((p, i) => { if (raw[i] > 0) out[p.id] = Number(((out[p.id] ? cents(out[p.id]) : 0) + raw[i]) / 100); });
  return out;
}

/** Server-side check: only allowed people, adds up exactly; unassigned → the main provider. */
export function checkTipSplit(tip: number, alloc: Record<string, any> | null | undefined, allowed: string[], mainId: string): Record<string, number> {
  const total = cents(tip); if (total <= 0) return {};
  const clean: Record<string, number> = {}; let given = 0;
  for (const [id, v] of Object.entries(alloc || {})) { const c = Math.max(0, cents(v)); if (!c) continue;
    const to = allowed.includes(id) || id === SCHOOL ? id : mainId; clean[to] = (clean[to] || 0) + c; given += c; }
  if (given > total) {   // more than the tip: scale down proportionally (to the cent)
    const ids = Object.keys(clean); const scaled = ids.map((id) => Math.floor((clean[id] * total) / given)); let left = total - scaled.reduce((a, b) => a + b, 0);
    ids.forEach((id, i) => { clean[id] = scaled[i] + (left-- > 0 ? 1 : 0); }); given = total;
  }
  if (given < total) clean[mainId] = (clean[mainId] || 0) + (total - given);   // what's unassigned → the main provider
  return Object.fromEntries(Object.entries(clean).filter(([, c]) => c > 0).map(([id, c]) => [id, c / 100]));
}
