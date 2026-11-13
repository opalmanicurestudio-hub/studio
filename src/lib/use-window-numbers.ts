'use client';
// src/lib/use-window-numbers.ts — THE PICKUP WINDOW'S NUMBERS (lib/pickup-window, api/retail/window 'numbers'), for a
// screen that shows products the way customers order them: the bag list (components/orders/workspace/PackPane). By the
// product's id (a listing's, so a variant is looked up by its listing first). Read at most every few minutes per
// business while the app is open; none when the shop has no window or this person can't see it.
import * as React from 'react';

const FRESH_MS = 5 * 60_000;
const seen = new Map<string, { at: number; p: Promise<Map<string, number>> }>();

function read(tenantId: string): Promise<Map<string, number>> {
  const hit = seen.get(tenantId);
  if (hit && Date.now() - hit.at < FRESH_MS) return hit.p;
  const p = fetch('/api/retail/window', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, action: 'numbers' }) })
    .then((r) => r.json()).then((d) => {
      if (!d?.ok || !d.numbers || typeof d.numbers !== 'object') throw new Error('not read');
      return new Map<string, number>(Object.entries(d.numbers).filter(([, n]) => Number.isInteger(Number(n)) && Number(n) > 0).map(([id, n]) => [id, Number(n)]));
    })
    // Not read (offline, or not allowed): nothing shown, and nothing kept, so the next screen asks again.
    .catch(() => { if (seen.get(tenantId)?.p === p) seen.delete(tenantId); return new Map<string, number>(); });
  seen.set(tenantId, { at: Date.now(), p });
  return p;
}

export function useWindowNumbers(tenantId: string): Map<string, number> {
  const [m, setM] = React.useState<Map<string, number>>(() => new Map());
  React.useEffect(() => {
    if (!tenantId) return;
    let live = true;
    void read(tenantId).then((x) => { if (live) setM(x); });
    return () => { live = false; };
  }, [tenantId]);
  return m;
}

/** A line's number: its listing's (a variant sells inside its listing), else its own product's. */
export function lineNumber(nums: Map<string, number>, line: { listingId?: string; productId?: string }): number | null {
  return nums.get(String(line?.listingId || '')) ?? nums.get(String(line?.productId || '')) ?? null;
}
