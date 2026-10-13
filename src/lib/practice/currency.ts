// Practice cash for the register game. Real denominations, sizes, colors and
// shapes so money looks like money, but original practice artwork (no real
// portraits or designs) and always marked PRACTICE. Amounts are in cents.

export type CurrencyCode = 'USD' | 'EUR' | 'GBP' | 'CAD';
export type Note = { value: number; w: number; h: number; bg: string; ink: string };            // mm
export type Coin = { value: number; label: string; mm: number; metal: 'copper' | 'nickel' | 'gold' | 'brass' | 'bi-gn' | 'bi-ng'; sides?: number };
export type Currency = { code: CurrencyCode; name: string; symbol: string; locale: string; notes: Note[]; coins: Coin[]; cashStep: number; float: Record<number, number>; tip: string };

export const CURRENCIES: Record<CurrencyCode, Currency> = {
  USD: { code: 'USD', name: 'US dollar', symbol: '$', locale: 'en-US', cashStep: 1,
    notes: [[100, '#cfe3e3', '#3e6b6b'], [50, '#e3d4e4', '#6e4d72'], [20, '#d4e3d2', '#3f6b52'], [10, '#efd9c2', '#8a5a3a'], [5, '#d9d3e4', '#5d5a7a'], [1, '#cfd9c7', '#4d6b4f']].map(([v, bg, ink]) => ({ value: (v as number) * 100, w: 156, h: 66.3, bg: bg as string, ink: ink as string })),
    coins: [{ value: 25, label: '25¢', mm: 24.26, metal: 'nickel' }, { value: 10, label: '10¢', mm: 17.91, metal: 'nickel' }, { value: 5, label: '5¢', mm: 21.21, metal: 'nickel' }, { value: 1, label: '1¢', mm: 19.05, metal: 'copper' }],
    float: { 2000: 3, 1000: 4, 500: 6, 100: 15, 25: 20, 10: 15, 5: 10, 1: 25 },
    tip: 'All notes are the same size, so read the number.' },
  EUR: { code: 'EUR', name: 'Euro', symbol: '€', locale: 'de-DE', cashStep: 1,
    notes: [[200, 153, 77, '#efe0b0', '#8a6a1c'], [100, 147, 77, '#cfe5cf', '#3d7a45'], [50, 140, 77, '#f4d2a8', '#b06a1c'], [20, 133, 72, '#c8d8ef', '#2f5c9a'], [10, 127, 67, '#f0c9c2', '#a3463a'], [5, 120, 62, '#d6d8dc', '#5e6470']].map(([v, w, h, bg, ink]) => ({ value: (v as number) * 100, w: w as number, h: h as number, bg: bg as string, ink: ink as string })),
    coins: [{ value: 200, label: '2€', mm: 25.75, metal: 'bi-ng' }, { value: 100, label: '1€', mm: 23.25, metal: 'bi-gn' }, { value: 50, label: '50c', mm: 24.25, metal: 'brass' }, { value: 20, label: '20c', mm: 22.25, metal: 'brass' }, { value: 10, label: '10c', mm: 19.75, metal: 'brass' }, { value: 5, label: '5c', mm: 21.25, metal: 'copper' }, { value: 2, label: '2c', mm: 18.75, metal: 'copper' }, { value: 1, label: '1c', mm: 16.25, metal: 'copper' }],
    float: { 2000: 3, 1000: 4, 500: 6, 200: 8, 100: 10, 50: 10, 20: 10, 10: 10, 5: 10, 2: 10, 1: 10 },
    tip: 'Bigger notes are bigger, and each has its own color.' },
  GBP: { code: 'GBP', name: 'Pound sterling', symbol: '£', locale: 'en-GB', cashStep: 1,
    notes: [[50, 146, 77, '#f0c8c6', '#a83a3a'], [20, 139, 73, '#ddd0ea', '#6a4a92'], [10, 132, 69, '#f3d3b4', '#b0602a'], [5, 125, 65, '#c9e6df', '#2f7a6b']].map(([v, w, h, bg, ink]) => ({ value: (v as number) * 100, w: w as number, h: h as number, bg: bg as string, ink: ink as string })),
    coins: [{ value: 200, label: '£2', mm: 28.4, metal: 'bi-gn' }, { value: 100, label: '£1', mm: 23.43, metal: 'bi-gn', sides: 12 }, { value: 50, label: '50p', mm: 27.3, metal: 'nickel', sides: 7 }, { value: 20, label: '20p', mm: 21.4, metal: 'nickel', sides: 7 }, { value: 10, label: '10p', mm: 24.5, metal: 'nickel' }, { value: 5, label: '5p', mm: 18, metal: 'nickel' }, { value: 2, label: '2p', mm: 25.9, metal: 'copper' }, { value: 1, label: '1p', mm: 20.3, metal: 'copper' }],
    float: { 2000: 3, 1000: 4, 500: 6, 200: 8, 100: 10, 50: 10, 20: 10, 10: 10, 5: 10, 2: 10, 1: 10 },
    tip: 'The 20p and 50p have seven sides; the £1 has twelve.' },
  CAD: { code: 'CAD', name: 'Canadian dollar', symbol: '$', locale: 'en-CA', cashStep: 5,
    notes: [[100, '#ead8c2', '#8a5a2a'], [50, '#f0c8c6', '#a83a3a'], [20, '#cfe5cf', '#3d7a45'], [10, '#ddd0ea', '#5e3f86'], [5, '#c9dcef', '#2f5f9a']].map(([v, bg, ink]) => ({ value: (v as number) * 100, w: 152.4, h: 69.85, bg: bg as string, ink: ink as string })),
    coins: [{ value: 200, label: '$2', mm: 28, metal: 'bi-ng' }, { value: 100, label: '$1', mm: 26.5, metal: 'gold', sides: 11 }, { value: 25, label: '25¢', mm: 23.88, metal: 'nickel' }, { value: 10, label: '10¢', mm: 18.03, metal: 'nickel' }, { value: 5, label: '5¢', mm: 21.2, metal: 'nickel' }],
    float: { 2000: 3, 1000: 4, 500: 6, 200: 8, 100: 10, 25: 20, 10: 15, 5: 15 },
    tip: 'No pennies: cash totals round to the nearest 5 cents. Card totals don’t.' },
};
export const CODES = Object.keys(CURRENCIES) as CurrencyCode[];

export const cents = (major: number) => Math.round(major * 100);
export function fmt(code: CurrencyCode, amountCents: number) {
  const c = CURRENCIES[code];
  return new Intl.NumberFormat(c.locale, { style: 'currency', currency: code }).format(amountCents / 100);
}
/** Short label for a denomination: $20, 20 €, £5, 25¢, 50p, 2€. */
export function denomLabel(code: CurrencyCode, value: number) {
  const c = CURRENCIES[code]; const coin = c.coins.find((x) => x.value === value);
  if (coin && !c.notes.some((n) => n.value === value)) return coin.label;
  const v = value / 100;
  return code === 'EUR' ? `${v} €` : `${c.symbol}${v}`;
}
/** Cash rounding (Canada: nearest 5 cents). Card totals are never rounded. */
export function cashRound(code: CurrencyCode, amountCents: number) {
  const step = CURRENCIES[code].cashStep; return step > 1 ? Math.round(amountCents / step) * step : amountCents;
}
export const denoms = (code: CurrencyCode) => [...CURRENCIES[code].notes.map((n) => n.value), ...CURRENCIES[code].coins.map((c) => c.value)].sort((a, b) => b - a);
export const isNote = (code: CurrencyCode, v: number) => CURRENCIES[code].notes.some((n) => n.value === v);

/** Fewest pieces for an amount, using only what's available. */
export function makeChange(code: CurrencyCode, amount: number, have?: Record<number, number>) {
  const out: number[] = []; let left = amount;
  for (const d of denoms(code)) { let n = have ? have[d] || 0 : Infinity; while (left >= d && n > 0) { out.push(d); left -= d; n--; } }
  return left === 0 ? out : null;
}
/** What a client hands over. 'one' = one big note (or several of the biggest); 'round' = notes up to the next 10. */
export function clientCash(code: CurrencyCode, due: number, style: 'one' | 'round'): number[] {
  const notes = CURRENCIES[code].notes.map((n) => n.value).sort((a, b) => a - b);
  if (style === 'one') { const one = notes.find((n) => n >= due); if (one) return [one]; const big = notes[notes.length - 1]; return Array.from({ length: Math.ceil(due / big) }, () => big); }
  const target = Math.ceil(due / 1000) * 1000 + (due % 1000 === 0 ? 0 : 0);
  return makeChange(code, Math.max(target, notes[0]), undefined)!.filter(Boolean);
}
export const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
export const drawerTotal = (d: Record<number, number>) => Object.entries(d).reduce((a, [v, n]) => a + Number(v) * n, 0);
