// src/lib/cleanse.ts — THE CLEANSE STEP. Every returned kit is cleansed before anything else: wiped or soaked (as its
// kit type says) with a disinfectant from the guide, for that product's contact time. Returning a kit starts it — no
// separate timer to remember — and when the contact time is reached the kit is marked cleansed by itself.
// Nothing can go into a steriliser, or back on the shelf, until its cleanse is complete.
//   kitType.cleanse = { method: 'wipe' | 'soak', disinfectantId }
//   kit.cleanse     = { method, disinfectantId, name, minutes, startedAt, timerId }   kit.cleansedAt = when it was reached
import type { Kit, KitType } from '@/lib/kits';
import { typeOf } from '@/lib/kits';

export type CleanseMethod = 'wipe' | 'soak';
export const METHOD_LABEL: Record<CleanseMethod, string> = { wipe: 'Wipe down', soak: 'Soak' };
const ms = (v: any) => Date.parse(String(v || '')) || 0;

/** What cleanse this kit gets: its type's method and disinfectant (null when the type has none set). */
export function cleansePlan(kit: Kit, types: KitType[], disinfectants: any[]): { method: CleanseMethod; disinfectant: any } | null {
  const c: any = (typeOf(types, kit.name) as any)?.cleanse; if (!c?.disinfectantId) return null;
  const d = (disinfectants || []).find((x: any) => x.id === c.disinfectantId && !x.archived); if (!d || !(Number(d.contactMinutes) > 0)) return null;
  return { method: c.method === 'wipe' ? 'wipe' : 'soak', disinfectant: d };
}
/** Where a kit is in its cleanse. `done` = the contact time has been reached (recorded, or simply passed). */
export function cleanseState(kit: any, now = Date.now()): { started: boolean; done: boolean; secondsLeft: number } {
  const c = kit?.cleanse; if (!c?.startedAt) return { started: false, done: !!kit?.cleansedAt, secondsLeft: 0 };
  const left = Math.round((ms(c.startedAt) + Math.max(0, Number(c.minutes) || 0) * 60000 - now) / 1000);
  return { started: true, done: !!kit?.cleansedAt || left <= 0, secondsLeft: Math.max(0, left) };
}
/** Can this kit go into a steriliser (or be marked ready) now? Gives the reason when it can't. */
export function readyForNextStep(kit: any, now = Date.now()): { ok: boolean; reason?: string } {
  if (kit?.status === 'dirty') return { ok: false, reason: 'It hasn’t been cleansed yet — start its cleanse first.' };
  if (kit?.status !== 'cleaning') return { ok: false, reason: 'It isn’t waiting to be sterilised.' };
  const s = cleanseState(kit, now);
  if (!s.started && !kit?.cleansedAt) return { ok: false, reason: 'Its cleanse hasn’t been started — start it first.' };
  if (!s.done) return { ok: false, reason: `Still in its cleanse — ${Math.floor(s.secondsLeft / 60)}:${String(s.secondsLeft % 60).padStart(2, '0')} to go.` };
  return { ok: true };
}
