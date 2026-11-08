// src/lib/launch-readiness-shared.ts — the shape of HQ's "Ready to launch?" rows and its one-line summary, with no
// server imports, so HQ's page can use them (the rows themselves are built in lib/launch-readiness).
export type ReadyGroup = 'need' | 'invite' | 'optional' | 'unset';
export type ReadyState = 'ok' | 'missing' | 'warn' | 'unknown';
export type ReadyRow = { id: string; group: ReadyGroup; label: string; state: ReadyState; note: string; fix?: string };

/** How many needed things are missing, how many couldn't be checked, and how many are for before the first business. */
export function readinessSummary(rows: ReadyRow[]): { need: number; invite: number; unknown: number } {
  return {
    need: rows.filter((r) => (r.group === 'need' || r.group === 'unset') && r.state === 'missing').length,
    invite: rows.filter((r) => r.group === 'invite' && r.state !== 'ok').length,
    unknown: rows.filter((r) => r.state === 'unknown').length,
  };
}
