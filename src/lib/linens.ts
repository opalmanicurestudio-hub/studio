// src/lib/linens.ts — LINENS & LAUNDRY (O6), counted by type (towels, capes, robes…), not one by one.
//   tenants/{t}/linens/{id} = { name, clean, dirty, washing, par, inventoryItemId?, inventoryName?, by, at }
// `name` matches the "Linens" line on a service's blueprint (case doesn't matter), which is how a visit knows what it uses.
// Life: clean → (used on a visit) → dirty → washing → clean. Damaged ones leave the count (and inventory, when linked).
// Used linens move to dirty on their own when a visit finishes; the team only starts and finishes wash loads.
export interface Linen { id: string; name: string; clean: number; dirty: number; washing: number; par?: number | null; inventoryItemId?: string | null; inventoryName?: string | null; by?: string | null; at?: string | null }
export type LinenMove = 'use' | 'wash' | 'washed' | 'add' | 'damaged_clean' | 'damaged_dirty';
export const LINEN_MOVE_LABEL: Record<LinenMove, string> = { use: 'Used', wash: 'Wash load started', washed: 'Wash load finished', add: 'Added', damaged_clean: 'Damaged (from clean)', damaged_dirty: 'Damaged (from dirty)' };

const norm = (s: any) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
const n0 = (v: any) => Math.max(0, Math.round(Number(v) || 0));
export const sameLinen = (a: any, b: any) => norm(a) === norm(b) && norm(a) !== '';
export const linenTotal = (l: Linen) => n0(l.clean) + n0(l.dirty) + n0(l.washing);

/** The new counts after a move. Never goes below zero: asking to move more than there are moves what's there. */
export function moveLinen(l: Linen, move: LinenMove, qty: number): { clean: number; dirty: number; washing: number; moved: number } {
  let clean = n0(l.clean), dirty = n0(l.dirty), washing = n0(l.washing); const q = n0(qty); let moved = q;
  if (move === 'use') { moved = Math.min(q, clean); clean -= moved; dirty += moved; }
  else if (move === 'wash') { moved = Math.min(q, dirty); dirty -= moved; washing += moved; }
  else if (move === 'washed') { moved = Math.min(q, washing); washing -= moved; clean += moved; }
  else if (move === 'add') { clean += q; }
  else if (move === 'damaged_clean') { moved = Math.min(q, clean); clean -= moved; }
  else if (move === 'damaged_dirty') { moved = Math.min(q, dirty); dirty -= moved; }
  return { clean, dirty, washing, moved };
}
/** What a service uses, from its blueprint ("Linens" lines that are required). */
export function linensNeeded(service: any): { name: string; qty: number }[] {
  const reqs: any[] = Array.isArray(service?.blueprint?.requirements) ? service.blueprint.requirements : [];
  return reqs.filter((r) => r?.kind === 'linen' && (r.mode || 'required') === 'required' && norm(r.name)).map((r) => ({ name: String(r.name).trim(), qty: Math.max(1, n0(r.qty) || 1) }));
}
/** A visit's linens including its add-ons. */
export function linensForVisit(visit: any, services: any[]): { name: string; qty: number }[] {
  const out: { name: string; qty: number }[] = [];
  for (const id of [visit?.serviceId, ...(Array.isArray(visit?.addOnIds) ? visit.addOnIds : [])].filter(Boolean))
    for (const n of linensNeeded((services || []).find((s: any) => s.id === id))) { const e = out.find((x) => sameLinen(x.name, n.name)); if (e) e.qty += n.qty; else out.push({ ...n }); }
  return out;
}
export interface LinenOutlook { id: string; name: string; clean: number; needed: number; short: number; runsOutAt: string | null; belowPar: boolean }
/** "Enough clean towels this afternoon?" — what the rest of today's visits need against what's clean now.
 *  `visits`: today's visits still to come or under way ({ startTime ISO, serviceId, addOnIds }), i.e. not yet counted as used. */
export function linenOutlook(linens: Linen[], visits: any[], services: any[]): LinenOutlook[] {
  const ordered = [...(visits || [])].sort((a, b) => String(a.startTime).localeCompare(String(b.startTime)));
  return (linens || []).map((l) => { let left = n0(l.clean), needed = 0; let runsOutAt: string | null = null;
    for (const v of ordered) { const q = linensForVisit(v, services).find((x) => sameLinen(x.name, l.name))?.qty || 0; if (!q) continue; needed += q; left -= q; if (left < 0 && !runsOutAt) runsOutAt = String(v.startTime); }
    return { id: l.id, name: l.name, clean: n0(l.clean), needed, short: Math.max(0, needed - n0(l.clean)), runsOutAt, belowPar: !!l.par && n0(l.clean) < n0(l.par) }; });
}
