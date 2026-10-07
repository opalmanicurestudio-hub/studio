// src/lib/sterilisation.ts — STERILISATION RECORDS. A written record of every steriliser cycle: which machine, who ran
// it, when, the settings used, exactly which kits were inside, and whether the indicator showed a pass. Plus the periodic
// spore (biological) tests. This is record-keeping for the business and its inspector — it doesn't decide what settings
// are right; those come from the machine's maker and the local board.
//   tenants/{t}/sterilisationCycles/{id} = { type: 'cycle' | 'spore', number, device, startedAt, startedBy, minutes, temp, tempUnit,
//       kits: [{ id, name, code }], status: 'running' | 'passed' | 'failed', endedAt, endedBy, indicator, note }
// Records are never edited away: a mistake is corrected with a note, and nothing here is deleted from the app.
export type CycleStatus = 'running' | 'passed' | 'failed';
export interface Cycle { id: string; type: 'cycle' | 'spore'; number?: number; device: string; startedAt: string; startedBy: string; startedById?: string | null; minutes?: number | null; temp?: number | null; tempUnit?: 'F' | 'C' | null;
  kits: { id: string; name: string; code: string }[]; status: CycleStatus; endedAt?: string | null; endedBy?: string | null; indicator?: 'pass' | 'fail' | null; note?: string | null; lab?: string | null }
const ms = (v: any) => Date.parse(String(v || '')) || 0;
/** The next cycle number: counts up through the day's records (so "cycle 3 today" matches a paper log). */
export function nextCycleNumber(cycles: Cycle[], now = Date.now()): number { const d = new Date(now).toDateString(); return (cycles || []).filter((c) => c.type === 'cycle' && new Date(ms(c.startedAt)).toDateString() === d).reduce((m, c) => Math.max(m, Number(c.number) || 0), 0) + 1; }
/** What stops a cycle being started (null when it's fine). */
export function cycleProblem(input: { device: string; kitIds: string[]; minutes: any; running: Cycle[] }): string | null {
  if (!String(input.device || '').trim()) return 'Say which machine this is.';
  if (!input.kitIds.length) return 'Add at least one kit to the load.';
  if (!(Number(input.minutes) > 0)) return 'Enter how many minutes the cycle runs.';
  const busy = input.running.find((c) => c.status === 'running' && c.device.trim().toLowerCase() === input.device.trim().toLowerCase());
  if (busy) return `${busy.device} already has a cycle running — finish that one first.`;
  return null;
}
/** Has this kit passed a recorded cycle since it was last used? (`kit.at` is when its current cleaning began.) */
export function sterilisedSinceUse(kit: any): boolean { const s = kit?.lastSterilised; return !!s && s.passed === true && ms(s.at) >= ms(kit?.at) - 1000; }
/** Days since the last spore test, and whether one is due (`everyDays` 0 = the business doesn't track them). */
export function sporeStatus(cycles: Cycle[], everyDays: number, now = Date.now()): { last: Cycle | null; daysSince: number | null; due: boolean } {
  const last = (cycles || []).filter((c) => c.type === 'spore').sort((a, b) => ms(b.startedAt) - ms(a.startedAt))[0] || null;
  const daysSince = last ? Math.floor((now - ms(last.startedAt)) / 86400000) : null;
  return { last, daysSince, due: everyDays > 0 && (daysSince === null || daysSince >= everyDays) };
}
/** Rows for the printable log, newest first. */
export function logRows(cycles: Cycle[], fromMs: number): { when: string; what: string; device: string; settings: string; load: string; result: string; by: string; note: string }[] {
  const t = (v: any) => (ms(v) ? new Date(ms(v)).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');
  return (cycles || []).filter((c) => ms(c.startedAt) >= fromMs).sort((a, b) => ms(b.startedAt) - ms(a.startedAt)).map((c) => ({
    when: t(c.startedAt), what: c.type === 'spore' ? 'Spore test' : `Cycle ${c.number || ''}`.trim(), device: c.device || '',
    settings: c.type === 'spore' ? (c.lab ? `Lab: ${c.lab}` : '') : [c.minutes ? `${c.minutes} min` : '', c.temp ? `${c.temp}°${c.tempUnit || 'F'}` : ''].filter(Boolean).join(' · '),
    load: (c.kits || []).map((k) => `${k.name} ${k.code}`).join(', '), result: c.status === 'running' ? 'Running' : c.status === 'passed' ? 'Pass' : 'FAIL',
    by: [c.startedBy, c.endedBy && c.endedBy !== c.startedBy ? `finished by ${c.endedBy}` : ''].filter(Boolean).join(', '), note: c.note || '' }));
}
