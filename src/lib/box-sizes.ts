// src/lib/box-sizes.ts — CHECKING A BOX SIZE THE SHOP TYPES IN (api/retail/box-sizes, the box sizes sheet). A name,
// three sides in inches and the empty box's own weight in ounces; at most eight sizes a shop. Pure.
import type { Preset } from './ship-run';

export const MAX_BOX_SIZES = 8;
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : NaN; };

/** A box size as typed, checked: a name, sides from 0.5 to 120 inches, the empty box's weight from 0 to 40 lb. */
export function cleanPreset(p: any): { preset: Omit<Preset, 'id'> & { id?: string }; error: string } {
  const name = String(p?.name || '').replace(/\s+/g, ' ').trim().slice(0, 40);
  const [l, w, h, oz] = [num(p?.lengthIn), num(p?.widthIn), num(p?.heightIn), num(p?.weightOz)];
  const side = (n: number) => Number.isFinite(n) && n >= 0.5 && n <= 120;
  const id = p?.id ? String(p.id).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) : undefined;
  const preset = { ...(id ? { id } : {}), name, lengthIn: Math.round(l * 10) / 10, widthIn: Math.round(w * 10) / 10, heightIn: Math.round(h * 10) / 10, weightOz: Math.round(oz * 10) / 10 };
  if (!name) return { preset, error: 'Give the box a name, for example Small mailer.' };
  if (!side(l) || !side(w) || !side(h)) return { preset, error: 'Each side is between half an inch and 120 inches.' };
  if (!Number.isFinite(oz) || oz < 0 || oz > 640) return { preset, error: 'The empty box’s weight is between 0 and 640 ounces.' };
  return { preset, error: '' };
}

