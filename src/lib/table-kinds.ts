// src/lib/table-kinds.ts — WHAT KIND OF TABLE IT IS (design canvas "Table shapes"; the event's seating chart,
// components/events/SeatingChartTab and TableKindFields; the seat map guests choose from, components/events/SeatPicker).
// Each table has a shape (round, square, a long banquet table, or a counter with seats in a row) and a few things a
// guest cares about (a high-top, by the window, outside, step-free, a quieter spot), and an optional note of the
// business's own. The seats are drawn where they really are around that shape. Pure.

export type TableShape = 'round' | 'square' | 'long' | 'counter';
export const TABLE_SHAPES: { id: TableShape; label: string; hint: string }[] = [
  { id: 'round', label: 'Round', hint: 'Seats all the way around' },
  { id: 'square', label: 'Square', hint: 'Seats on all four sides' },
  { id: 'long', label: 'Long', hint: 'Down both sides and at the ends' },
  { id: 'counter', label: 'Counter', hint: 'Seats in a row on one side' },
];
export type TableFeature = 'high_top' | 'window' | 'outside' | 'step_free' | 'quiet';
export const TABLE_FEATURES: { id: TableFeature; label: string; words: string }[] = [
  { id: 'high_top', label: 'High-top', words: 'a high-top' },
  { id: 'window', label: 'By the window', words: 'by the window' },
  { id: 'outside', label: 'Outside', words: 'outside' },
  { id: 'step_free', label: 'Step-free access', words: 'with step-free access' },
  { id: 'quiet', label: 'Quieter spot', words: 'in a quieter spot' },
];
export const MAX_TABLE_NOTE = 60;

export const shapeOf = (t: any): TableShape => (TABLE_SHAPES.some((s) => s.id === t?.shape) ? t.shape : 'round');
export const featuresOf = (t: any): TableFeature[] => TABLE_FEATURES.filter((f) => Array.isArray(t?.features) && t.features.includes(f.id)).map((f) => f.id);
export const noteOf = (t: any) => String(t?.note ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_TABLE_NOTE);

/** "A long table, by the window"; "A counter"; a high-top is its own kind of table ("A round high-top"). */
export function tableKindWords(t: any): string {
  const shape = shapeOf(t); const f = featuresOf(t);
  const base = shape === 'counter' ? 'A counter' : `A ${shape} ${f.includes('high_top') ? 'high-top' : 'table'}`;
  const rest = TABLE_FEATURES.filter((x) => x.id !== 'high_top' && f.includes(x.id)).map((x) => x.words);
  const and = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
  return rest.length ? `${base}, ${and(rest)}` : base;
}

export type Spot = { x: number; y: number };
export type Drawing = { w: number; h: number; top: { x: number; y: number; w: number; h: number; round: boolean }; seats: Spot[] };
const SEAT_GAP = 22;
/** Where the table and each of its `n` seats sit in a box of w by h pixels, by shape. Seats go in the chart's order. */
export function drawTable(shape: TableShape, n: number): Drawing {
  const count = Math.max(1, Math.min(20, Math.round(n) || 1));
  if (shape === 'counter') {
    const gap = count > 10 ? 18 : SEAT_GAP; const w = gap * count + 16; const h = 50;
    return { w, h, top: { x: 6, y: 6, w: w - 12, h: 16, round: false }, seats: Array.from({ length: count }, (_, i) => ({ x: 8 + gap / 2 + i * gap, y: 38 })) };
  }
  if (shape === 'long') {
    const ends = count >= 6 ? 2 : 0; const side = count - ends; const top = Math.ceil(side / 2); const bottom = side - top;
    const cols = Math.max(1, top); const w = cols * SEAT_GAP + 20 + (ends ? 24 : 0); const h = 76; const x0 = ends ? 22 : 10;
    const tw = cols * SEAT_GAP; const seats: Spot[] = [];
    for (let i = 0; i < top; i++) seats.push({ x: x0 + SEAT_GAP / 2 + i * SEAT_GAP, y: 10 });
    if (ends) seats.push({ x: x0 + tw + 11, y: h / 2 });
    for (let i = bottom - 1; i >= 0; i--) seats.push({ x: x0 + SEAT_GAP / 2 + i * SEAT_GAP + (top - bottom) * SEAT_GAP / 2, y: h - 10 });
    if (ends) seats.push({ x: x0 - 11, y: h / 2 });
    return { w, h, top: { x: x0, y: 21, w: tw, h: h - 42, round: false }, seats };
  }
  if (shape === 'square') {
    const per = Math.ceil(count / 4); const side = Math.max(44, per * SEAT_GAP); const w = side + 44; const h = w;
    const sides = [0, 0, 0, 0]; for (let i = 0; i < count; i++) sides[i % 4]++;
    const seats: Spot[] = []; const o = 22;
    const along = (k: number, i: number) => o + ((i + 0.5) * side) / k;
    for (let i = 0; i < sides[0]; i++) seats.push({ x: along(sides[0], i), y: 10 });
    for (let i = 0; i < sides[1]; i++) seats.push({ x: w - 10, y: along(sides[1], i) });
    for (let i = 0; i < sides[2]; i++) seats.push({ x: along(sides[2], sides[2] - 1 - i), y: h - 10 });
    for (let i = 0; i < sides[3]; i++) seats.push({ x: 10, y: along(sides[3], sides[3] - 1 - i) });
    return { w, h, top: { x: o, y: o, w: side, h: side, round: false }, seats };
  }
  const r = count > 10 ? 50 : 35; const w = r * 2 + 16; const c = w / 2;
  return { w, h: w, top: { x: c - (r - 14), y: c - (r - 14), w: (r - 14) * 2, h: (r - 14) * 2, round: true },
    seats: Array.from({ length: count }, (_, i) => { const a = (i / count) * Math.PI * 2 - Math.PI / 2; return { x: c + Math.cos(a) * r, y: c + Math.sin(a) * r }; }) };
}

/** A table's kind as saved: a known shape, known features, a short note. */
export function cleanTableKind(raw: any): { shape: TableShape; features: TableFeature[]; note: string | null } {
  const note = noteOf(raw); return { shape: shapeOf(raw), features: featuresOf(raw), note: note || null };
}
