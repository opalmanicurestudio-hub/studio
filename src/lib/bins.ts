// src/lib/bins.ts — WHERE A PRODUCT LIVES. A pick bin (aisle, shelf, spot: "A-02-3") and an optional overflow spot
// ("Back room, shelf 4"). Pick lists walk bins in order, so A-01 comes before A-02 and B-01, and A-2 sorts before
// A-10. Products with no bin sort last. Older records used shelf or binLocation; those still count.

export function binOf(item: any): string {
  return String(item?.storageLocation || item?.shelf || item?.binLocation || '').trim();
}

export function overflowOf(item: any): string {
  return String(item?.overflowLocation || '').trim();
}

export function normalizeBin(raw: unknown): string {
  return String(raw ?? '').trim().replace(/\s+/g, ' ').slice(0, 40).toUpperCase();
}

export function compareBins(a: string, b: string): number {
  const x = String(a || '').trim(); const y = String(b || '').trim();
  if (!x && !y) return 0; if (!x) return 1; if (!y) return -1;
  return x.localeCompare(y, undefined, { numeric: true, sensitivity: 'base' });
}

export function binMatches(bin: string, scanned: string): boolean {
  const n = (s: string) => String(s || '').trim().toUpperCase().replace(/[\s_-]+/g, '');
  return !!n(bin) && n(bin) === n(scanned);
}
