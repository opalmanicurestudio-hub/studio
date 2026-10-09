// src/lib/linens.ts — LINENS & LAUNDRY (O6), counted by type (towels, capes, robes…), not one by one.
//   tenants/{t}/linens/{id} = { name, clean, dirty, washing, par, inventoryItemId?, inventoryName?, by, at }
// `name` matches the "Linens" line on a service's blueprint (case doesn't matter), which is how a visit knows what it uses.
// Life: clean → (used on a visit) → dirty (the bin) → washing → drying (when the business has a dryer step) → to fold → clean.
// Each business sets, per linen type, its load size and its wash and dry minutes (asked when the type is added). Damaged ones leave the count (and inventory, when linked).
// Used linens move to dirty on their own when a visit finishes; the team only starts and finishes wash loads.
import { hasTag } from '@/lib/tags';
export interface Linen { id: string; name: string; clean: number; dirty: number; washing: number; inUse?: number; drying?: number; folding?: number; washMinutes?: number | null; washStartedAt?: string | null; dryMinutes?: number | null; dryStartedAt?: string | null; loadSize?: number | null; byBundle?: boolean; par?: number | null; inventoryItemId?: string | null; inventoryName?: string | null; by?: string | null; at?: string | null }
export type LinenMove = 'issue' | 'return' | 'unissue' | 'use' | 'wash' | 'washed' | 'dry' | 'dried' | 'folded' | 'add' | 'damaged_clean' | 'damaged_dirty';
export const LINEN_MOVE_LABEL: Record<LinenMove, string> = { issue: 'Taken out', return: 'Came back dirty', unissue: 'Unused — put back', use: 'Used', wash: 'Wash load started', washed: 'Washed — to fold', dry: 'Into the dryer', dried: 'Dry — to fold', folded: 'Folded and put away', add: 'Added', damaged_clean: 'Damaged (from clean)', damaged_dirty: 'Damaged (from dirty)' };

const norm = (s: any) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
const n0 = (v: any) => Math.max(0, Math.round(Number(v) || 0));
export const sameLinen = (a: any, b: any) => norm(a) === norm(b) && norm(a) !== '';
export const linenTotal = (l: Linen) => n0(l.clean) + n0(l.dirty) + n0(l.washing) + n0(l.inUse) + n0(l.drying) + n0(l.folding);

/** The new counts after a move. Never goes below zero: asking to move more than there are moves what's there. */
export function moveLinen(l: Linen, move: LinenMove, qty: number): { clean: number; dirty: number; washing: number; inUse: number; drying: number; folding: number; moved: number } {
  let clean = n0(l.clean), dirty = n0(l.dirty), washing = n0(l.washing), inUse = n0(l.inUse), drying = n0(l.drying), folding = n0(l.folding); const q = n0(qty); let moved = q;
  if (move === 'issue') { moved = Math.min(q, clean); clean -= moved; inUse += moved; }
  else if (move === 'unissue') { moved = Math.min(q, inUse); inUse -= moved; clean += moved; }
  else if (move === 'return') { moved = Math.min(q, inUse); inUse -= moved; dirty += moved; }
  else if (move === 'use') { moved = Math.min(q, clean); clean -= moved; dirty += moved; }
  else if (move === 'wash') { moved = Math.min(q, dirty); dirty -= moved; washing += moved; }
  else if (move === 'washed') { moved = Math.min(q, washing); washing -= moved; folding += moved; }   // no dryer step: straight to folding
  else if (move === 'dry') { moved = Math.min(q, washing); washing -= moved; drying += moved; }
  else if (move === 'dried') { moved = Math.min(q, drying); drying -= moved; folding += moved; }
  else if (move === 'folded') { moved = Math.min(q, folding); folding -= moved; clean += moved; }
  else if (move === 'add') { clean += q; }
  else if (move === 'damaged_clean') { moved = Math.min(q, clean); clean -= moved; }
  else if (move === 'damaged_dirty') { moved = Math.min(q, dirty); dirty -= moved; }
  return { clean, dirty, washing, inUse, drying, folding, moved };
}
/** The fields to write for a move: the new counts plus the load timers it starts or clears. */
export function linenUpdate(l: Linen, move: LinenMove, res: ReturnType<typeof moveLinen>, by: { name: string; uid: string | null }, at = new Date().toISOString()): Record<string, any> {
  return { clean: res.clean, dirty: res.dirty, washing: res.washing, inUse: res.inUse, drying: res.drying, folding: res.folding, by: by.name, at,
    ...(move === 'wash' ? { washStartedAt: at, washById: by.uid } : {}),
    ...((move === 'washed' || move === 'dry') && res.washing === 0 ? { washStartedAt: null } : {}),
    ...(move === 'dry' ? { dryStartedAt: at, dryById: by.uid } : {}),
    ...(move === 'dried' && res.drying === 0 ? { dryStartedAt: null } : {}) };
}
/** After the wash: into the dryer when the business has a dryer step for this type, else straight to folding. */
export const afterWash = (l: Linen): LinenMove => (Number(l.dryMinutes) > 0 ? 'dry' : 'washed');

/** Should a load go in now? A full load when the bin reaches the load size; a smaller one when clean ones will run short
 *  today. Without a load size and wash time set, it asks for them rather than guessing. */
export function loadDecision(l: Linen, short = 0): { due: boolean; qty: number; reason: string; needsSetup: boolean } {
  const dirty = n0(l.dirty); const size = n0(l.loadSize); const needsSetup = !size || !(Number(l.washMinutes) > 0);
  if (!dirty) return { due: false, qty: 0, reason: 'The bin is empty', needsSetup };
  if (size && dirty >= size) return { due: true, qty: size, reason: `Full load — ${dirty} in the bin (a load is ${size})`, needsSetup };
  if (short > 0) return { due: true, qty: dirty, reason: `Short by ${short} later today — wash the ${dirty} in the bin now`, needsSetup };
  return { due: false, qty: dirty, reason: size ? `${dirty} of ${size} for a full load` : `${dirty} in the bin`, needsSetup };
}

/** What a service uses, from its blueprint ("Linens" lines that are required). */
export function linensNeeded(service: any): { name: string; qty: number }[] {
  const reqs: any[] = Array.isArray(service?.blueprint?.requirements) ? service.blueprint.requirements : [];
  return reqs.filter((r) => r?.kind === 'linen' && (r.mode || 'required') === 'required' && norm(r.name)).map((r) => ({ name: String(r.name).trim(), qty: Math.max(1, n0(r.qty) || 1) }));
}
/** A visit's linens including its add-ons. */
export function linensForVisit(visit: any, services: any[], resources?: any[]): { name: string; qty: number }[] {
  const out: { name: string; qty: number }[] = []; const addIn = (n: { name: string; qty: number }) => { const e = out.find((x) => sameLinen(x.name, n.name)); if (e) e.qty += n.qty; else out.push({ ...n }); };
  for (const id of [visit?.serviceId, ...(Array.isArray(visit?.addOnIds) ? visit.addOnIds : [])].filter(Boolean))
    for (const n of linensNeeded((services || []).find((s: any) => s.id === id))) addIn(n);
  // What the room / station itself needs for every booking (Resources → "Every booking here needs").
  for (const n of resourceNeeds(visit, resources, 'linen')) addIn(n);
  return out;
}
/** Needs set on the rooms, stations or equipment a booking uses. */
export function resourceNeeds(visit: any, resources: any[] | undefined, kind: 'kit' | 'linen'): { name: string; qty: number }[] {
  if (!resources?.length) return []; const ids: string[] = Array.isArray(visit?.requiredResourceIds) ? visit.requiredResourceIds : [];
  const out: { name: string; qty: number }[] = [];
  for (const r of resources) if (ids.includes(r.id) && Array.isArray(r.needs)) for (const n of r.needs) if (n?.kind === kind && norm(n.name)) out.push({ name: String(n.name).trim(), qty: Math.max(1, n0(n.qty) || 1) });
  return out;
}
export interface LinenOutlook { id: string; name: string; clean: number; needed: number; short: number; runsOutAt: string | null; belowPar: boolean }
/** "Enough clean towels this afternoon?" — what the rest of today's visits need against what's clean now.
 *  `visits`: today's visits still to come or under way ({ startTime ISO, serviceId, addOnIds }), i.e. not yet counted as used. */
export function linenOutlook(linens: Linen[], visits: any[], services: any[], resources?: any[]): LinenOutlook[] {
  const ordered = [...(visits || [])].sort((a, b) => String(a.startTime).localeCompare(String(b.startTime)));
  return (linens || []).map((l) => { let left = n0(l.clean), needed = 0; let runsOutAt: string | null = null;
    for (const v of ordered) { const q = linensForVisit(v, services, resources).find((x) => sameLinen(x.name, l.name))?.qty || 0; if (!q) continue; needed += q; left -= q; if (left < 0 && !runsOutAt) runsOutAt = String(v.startTime); }
    return { id: l.id, name: l.name, clean: n0(l.clean), needed, short: Math.max(0, needed - n0(l.clean)), runsOutAt, belowPar: !!l.par && n0(l.clean) < n0(l.par) }; });
}

// ── Bundles: a tagged stack or bag of one linen type (say 6 towels) that is scanned through its life ───────────────────
//   tenants/{t}/linenBundles/{id} = { linenId, name, qty, code, status, at, by }
// Scanning the tag moves the whole bundle on and the type's counts with it. Automatic counting carries on as well: when a
// visit finishes, its linens come off the floor (then off clean stock). A scan never moves more than is really there, so
// the two together can't count anything twice, and the total owned never changes.
export type BundleStatus = 'clean' | 'in_use' | 'dirty' | 'washing' | 'drying' | 'folding';
export interface LinenBundle { id: string; linenId: string; name: string; qty: number; code: string; status: BundleStatus; tagIds?: string[]; at?: string | null; by?: string | null }
export const BUNDLE_LABEL: Record<BundleStatus, string> = { clean: 'Clean', in_use: 'Out on the floor', dirty: 'Dirty', washing: 'In the wash', drying: 'In the dryer', folding: 'To fold' };
export const BUNDLE_NEXT: Record<BundleStatus, { to: BundleStatus; move: LinenMove; label: string }> = {
  clean: { to: 'in_use', move: 'issue', label: 'Take out' }, in_use: { to: 'dirty', move: 'return', label: 'Back — dirty' },
  dirty: { to: 'washing', move: 'wash', label: 'Start washing' }, washing: { to: 'folding', move: 'washed', label: 'Washed — to fold' },
  drying: { to: 'folding', move: 'dried', label: 'Dry — to fold' }, folding: { to: 'clean', move: 'folded', label: 'Folded — check the tag' } };
/** A bundle's next step, following the business's own laundry (a dryer step only when its type has dry minutes). */
export const bundleNext = (b: LinenBundle, l?: Linen | null) => (b.status === 'washing' && l && Number(l.dryMinutes) > 0 ? { to: 'drying' as BundleStatus, move: 'dry' as LinenMove, label: 'Into the dryer' } : BUNDLE_NEXT[b.status]);
export function newBundleCode(taken: string[] = []): string {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; const used = new Set(taken.map((c) => String(c).toUpperCase()));
  for (let i = 0; i < 200; i++) { let c = 'L'; for (let j = 0; j < 4; j++) c += abc[Math.floor(Math.random() * abc.length)]; if (!used.has(c)) return c; }
  return 'L' + Date.now().toString(36).toUpperCase().slice(-6);
}
export function findBundle(bundles: LinenBundle[], typed: string): LinenBundle | null {
  const t = String(typed || '').trim().toUpperCase().split(/[/=#]/).pop() || ''; if (!t) return null;
  return (bundles || []).find((b) => String(b.code || '').toUpperCase() === t) || (bundles || []).find((b) => hasTag(b, typed)) || null;
}
