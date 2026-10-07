// src/lib/linens.ts — LINENS & LAUNDRY (O6), counted by type (towels, capes, robes…), not one by one.
//   tenants/{t}/linens/{id} = { name, clean, dirty, washing, par, inventoryItemId?, inventoryName?, by, at }
// `name` matches the "Linens" line on a service's blueprint (case doesn't matter), which is how a visit knows what it uses.
// Life: clean → (used on a visit) → dirty → washing → clean. Damaged ones leave the count (and inventory, when linked).
// Used linens move to dirty on their own when a visit finishes; the team only starts and finishes wash loads.
export interface Linen { id: string; name: string; clean: number; dirty: number; washing: number; inUse?: number; washMinutes?: number | null; washStartedAt?: string | null; byBundle?: boolean; par?: number | null; inventoryItemId?: string | null; inventoryName?: string | null; by?: string | null; at?: string | null }
export type LinenMove = 'issue' | 'return' | 'unissue' | 'use' | 'wash' | 'washed' | 'add' | 'damaged_clean' | 'damaged_dirty';
export const LINEN_MOVE_LABEL: Record<LinenMove, string> = { issue: 'Taken out', return: 'Came back dirty', unissue: 'Unused — put back', use: 'Used', wash: 'Wash load started', washed: 'Wash load finished', add: 'Added', damaged_clean: 'Damaged (from clean)', damaged_dirty: 'Damaged (from dirty)' };

const norm = (s: any) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
const n0 = (v: any) => Math.max(0, Math.round(Number(v) || 0));
export const sameLinen = (a: any, b: any) => norm(a) === norm(b) && norm(a) !== '';
export const linenTotal = (l: Linen) => n0(l.clean) + n0(l.dirty) + n0(l.washing) + n0(l.inUse);

/** The new counts after a move. Never goes below zero: asking to move more than there are moves what's there. */
export function moveLinen(l: Linen, move: LinenMove, qty: number): { clean: number; dirty: number; washing: number; inUse: number; moved: number } {
  let clean = n0(l.clean), dirty = n0(l.dirty), washing = n0(l.washing), inUse = n0(l.inUse); const q = n0(qty); let moved = q;
  if (move === 'issue') { moved = Math.min(q, clean); clean -= moved; inUse += moved; }
  else if (move === 'unissue') { moved = Math.min(q, inUse); inUse -= moved; clean += moved; }
  else if (move === 'return') { moved = Math.min(q, inUse); inUse -= moved; dirty += moved; }
  else if (move === 'use') { moved = Math.min(q, clean); clean -= moved; dirty += moved; }
  else if (move === 'wash') { moved = Math.min(q, dirty); dirty -= moved; washing += moved; }
  else if (move === 'washed') { moved = Math.min(q, washing); washing -= moved; clean += moved; }
  else if (move === 'add') { clean += q; }
  else if (move === 'damaged_clean') { moved = Math.min(q, clean); clean -= moved; }
  else if (move === 'damaged_dirty') { moved = Math.min(q, dirty); dirty -= moved; }
  return { clean, dirty, washing, inUse, moved };
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

// ── Bundles: a tagged stack or bag of one linen type (say 6 towels) that is scanned through its life ───────────────────
//   tenants/{t}/linenBundles/{id} = { linenId, name, qty, code, status, at, by }
// Scanning the tag moves the whole bundle on and the type's counts with it. Automatic counting carries on as well: when a
// visit finishes, its linens come off the floor (then off clean stock). A scan never moves more than is really there, so
// the two together can't count anything twice, and the total owned never changes.
export type BundleStatus = 'clean' | 'in_use' | 'dirty' | 'washing';
export interface LinenBundle { id: string; linenId: string; name: string; qty: number; code: string; status: BundleStatus; at?: string | null; by?: string | null }
export const BUNDLE_LABEL: Record<BundleStatus, string> = { clean: 'Clean', in_use: 'Out on the floor', dirty: 'Dirty', washing: 'In the wash' };
export const BUNDLE_NEXT: Record<BundleStatus, { to: BundleStatus; move: LinenMove; label: string }> = {
  clean: { to: 'in_use', move: 'issue', label: 'Take out' }, in_use: { to: 'dirty', move: 'return', label: 'Back — dirty' },
  dirty: { to: 'washing', move: 'wash', label: 'Start washing' }, washing: { to: 'clean', move: 'washed', label: 'Washed — clean' } };
export function newBundleCode(taken: string[] = []): string {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; const used = new Set(taken.map((c) => String(c).toUpperCase()));
  for (let i = 0; i < 200; i++) { let c = 'L'; for (let j = 0; j < 4; j++) c += abc[Math.floor(Math.random() * abc.length)]; if (!used.has(c)) return c; }
  return 'L' + Date.now().toString(36).toUpperCase().slice(-6);
}
export function findBundle(bundles: LinenBundle[], typed: string): LinenBundle | null {
  const t = String(typed || '').trim().toUpperCase().split(/[/=#]/).pop() || ''; if (!t) return null;
  return (bundles || []).find((b) => String(b.code || '').toUpperCase() === t) || null;
}
