// src/lib/disinfect.ts — DISINFECTANTS: the instructions and contact times the team needs at the moment they're cleaning.
// Each product the business uses is written down once, from ITS OWN LABEL (nothing here supplies or guesses a contact
// time): what it's for, how to mix it, how long the surface or tool must stay wet, the steps, what to wear, and how often
// the solution must be made fresh. Anyone can then start a contact timer from it, and log a fresh mix.
//   tenants/{t}/disinfectants/{id} = { name, use, contactMinutes, dilution, steps[], ppe, changeEveryHours, regNumber, mixedAt, mixedBy }
//   tenants/{t}/contactTimers/{id}  = { disinfectantId, name, what, minutes, startedAt, byName, byId, doneAt }
export interface Disinfectant { id: string; name: string; use?: string | null; contactMinutes: number; dilution?: string | null; steps?: string[]; ppe?: string | null; changeEveryHours?: number | null; regNumber?: string | null; mixedAt?: string | null; mixedBy?: string | null; code?: string | null }
export interface ContactTimer { id: string; disinfectantId: string; name: string; what?: string | null; minutes: number; startedAt: string; byName?: string | null; byId?: string | null; doneAt?: string | null }
const ms = (v: any) => Date.parse(String(v || '')) || 0;
/** Seconds still to go before the contact time is reached (0 or less = reached). */
export const contactLeft = (t: { startedAt: string; minutes: number }, now = Date.now()) => Math.round((ms(t.startedAt) + Math.max(0, Number(t.minutes) || 0) * 60000 - now) / 1000);
/** Is the mixed solution past its life? `null` when the product has no "make fresh every…" rule or nothing has been logged. */
export function solutionState(d: Disinfectant, now = Date.now()): { due: boolean; hoursOld: number | null; never: boolean } {
  const every = Math.max(0, Number(d.changeEveryHours) || 0); const at = ms(d.mixedAt);
  if (!every) return { due: false, hoursOld: at ? Math.floor((now - at) / 3600000) : null, never: !at };
  if (!at) return { due: true, hoursOld: null, never: true };
  const hoursOld = Math.floor((now - at) / 3600000); return { due: now - at >= every * 3600000, hoursOld, never: false };
}
/** What stops a product being saved (null when it's fine). The contact time must be typed in by a person. */
export function disinfectantProblem(d: { name: string; contactMinutes: any }): string | null {
  if (!String(d.name || '').trim()) return 'Give the product a name.';
  if (!(Number(d.contactMinutes) > 0)) return 'Enter the contact time from the product’s label.';
  if (Number(d.contactMinutes) > 240) return 'That contact time looks too long — check the label (minutes).';
  return null;
}
export const cleanSteps = (text: string) => String(text || '').split(/\r?\n/).map((s) => s.replace(/^\s*(\d+[.)]|[-•*])\s*/, '').trim()).filter(Boolean).slice(0, 12);
/** Timers still running or reached but not yet cleared, newest first; ones left for over 12 hours are dropped. */
export const openTimers = (timers: ContactTimer[], now = Date.now()) => (timers || []).filter((t) => !t.doneAt && now - ms(t.startedAt) < 12 * 3600000).sort((a, b) => ms(b.startedAt) - ms(a.startedAt));
