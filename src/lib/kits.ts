// src/lib/kits.ts — KITS (O5): the sets of tools a service needs (a manicure kit, a pedicure kit, a colour kit…), each one
// tracked through its life so the desk knows whether a clean one is waiting before the client sits down.
//   tenants/{t}/kits/{id} = { name, code, status, by, at, visitId?, clientName?, stationName?, note?, cycles, history[] }
// `name` is the kit's TYPE and matches the "Tools / kit" line on a service's blueprint (case doesn't matter), which is how
// a service knows which kits it can use. `code` is what's printed on the label and typed or scanned to move it along.
// Life: ready → in use → dirty → being cleaned → ready. Anything can be pulled out ("out") with a reason; only a manager
// puts it back into service or retires it.
import { hasTag } from '@/lib/tags';
export type KitStatus = 'ready' | 'in_use' | 'dirty' | 'cleaning' | 'out' | 'retired';
export const KIT_LABEL: Record<KitStatus, string> = { ready: 'Clean & ready', in_use: 'In use', dirty: 'Needs cleaning', cleaning: 'Being cleaned', out: 'Pulled out', retired: 'Retired' };
export const KIT_NEXT: Partial<Record<KitStatus, { to: KitStatus; label: string }>> = {
  ready: { to: 'in_use', label: 'Take for a client' }, in_use: { to: 'dirty', label: 'Finished — needs cleaning' },
  dirty: { to: 'cleaning', label: 'Start cleaning' }, cleaning: { to: 'ready', label: 'Clean — ready' } };
export interface Kit { id: string; name: string; code: string; status: KitStatus; by?: string | null; at?: string | null; visitId?: string | null; clientName?: string | null; stationName?: string | null; note?: string | null; cycles?: number; tagIds?: string[]; cycleId?: string | null; lastSterilised?: { cycleId: string; at: string; by: string; passed: boolean; device?: string } | null; inventoryItemId?: string | null; inventoryName?: string | null; lastCheck?: { at: string; by: string; ok: boolean; missing: string[]; version?: number } | null; history?: { at: string; by: string; from: KitStatus; to: KitStatus; note?: string | null }[] }

const norm = (s: any) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
export const sameKitType = (a: any, b: any) => norm(a) === norm(b) && norm(a) !== '';
/** A short code that's easy to read off a label: no 0/O or 1/I. */
export function newKitCode(taken: string[] = []): string {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; const used = new Set(taken.map((c) => String(c).toUpperCase()));
  for (let i = 0; i < 200; i++) { let c = 'K'; for (let j = 0; j < 4; j++) c += abc[Math.floor(Math.random() * abc.length)]; if (!used.has(c)) return c; }
  return 'K' + Date.now().toString(36).toUpperCase().slice(-6);
}
/** What a scanner or a person typed → the kit it means (the label's code; a scanned link ending in the code also works). */
export function findKit(kits: Kit[], typed: string): Kit | null {
  const t = String(typed || '').trim().toUpperCase().split(/[/=#]/).pop() || ''; if (!t) return null;
  return kits.find((k) => String(k.code || '').toUpperCase() === t && k.status !== 'retired') || kits.find((k) => k.status !== 'retired' && hasTag(k, typed)) || null;   // its printed code, or an RFID/NFC tag paired to it
}
/** The change to save when a kit moves on. Returns an error message instead when the move isn't allowed. */
export function moveKit(kit: Kit, to: KitStatus, who: { name: string; manager: boolean }, extra: { note?: string | null; visitId?: string | null; clientName?: string | null; stationName?: string | null } = {}, at = new Date().toISOString()): { patch: Partial<Kit> } | { error: string } {
  const from = kit.status;
  if (from === to) return { error: `It’s already ${KIT_LABEL[to].toLowerCase()}.` };
  if (from === 'retired') return { error: 'That kit has been retired.' };
  if (to === 'out') { if (!String(extra.note || '').trim()) return { error: 'Say what’s wrong with it.' }; }
  else if (from === 'out' || to === 'retired') { if (!who.manager) return { error: 'A manager decides what happens to a kit that’s been pulled out.' }; if (from === 'out' && to !== 'ready' && to !== 'retired' && to !== 'dirty') return { error: 'A pulled-out kit goes back as needing cleaning, ready, or retired.' }; }
  else if (from === 'cleaning' && to === 'dirty' && String(extra.note || '').trim()) { /* a failed cycle sends it round again, with the reason */ }
  else if (KIT_NEXT[from]?.to !== to) return { error: `A kit that’s ${KIT_LABEL[from].toLowerCase()} can’t go straight to ${KIT_LABEL[to].toLowerCase()}.` };
  const history = [...(kit.history || []), { at, by: who.name, from, to, note: extra.note?.trim() || null }].slice(-40);
  return { patch: { status: to, by: who.name, at, note: to === 'out' ? String(extra.note).trim().slice(0, 200) : null, history,
    visitId: to === 'in_use' ? extra.visitId || null : null, clientName: to === 'in_use' ? extra.clientName || null : null, stationName: to === 'in_use' ? extra.stationName || null : null,
    cycles: (kit.cycles || 0) + (from === 'cleaning' && to === 'ready' ? 1 : 0) } };
}
/** The kit types a service needs, from its blueprint ("Tools / kit" lines marked required). */
export function kitsNeeded(service: any): { name: string; qty: number }[] {
  const reqs: any[] = Array.isArray(service?.blueprint?.requirements) ? service.blueprint.requirements : [];
  return reqs.filter((r) => r?.kind === 'kit' && (r.mode || 'required') === 'required' && norm(r.name)).map((r) => ({ name: String(r.name).trim(), qty: Math.max(1, Math.round(Number(r.qty) || 1)) }));
}
/** Per kit type: how many of each status. Retired kits aren't counted. */
export function kitSupply(kits: Kit[]): { name: string; total: number; ready: number; in_use: number; dirty: number; cleaning: number; out: number }[] {
  const m = new Map<string, any>();
  for (const k of kits || []) { if (!k || k.status === 'retired' || !norm(k.name)) continue; const key = norm(k.name);
    const row = m.get(key) || { name: String(k.name).trim(), total: 0, ready: 0, in_use: 0, dirty: 0, cleaning: 0, out: 0 }; row.total++; row[k.status] = (row[k.status] || 0) + 1; m.set(key, row); }
  return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
}
/** Kit types this service needs that have no clean one waiting. Types the business doesn't track at all are ignored. */
export function kitsShort(service: any, kits: Kit[]): string[] {
  const supply = kitSupply(kits);
  return kitsNeeded(service).filter((n) => { const s = supply.find((x) => sameKitType(x.name, n.name)); return !!s && s.ready < n.qty; }).map((n) => n.name);
}
/** Who a kit being taken is most likely for: today's guests in service or waiting whose service needs this kit type and
 *  who don't have one of that type yet. In-service guests first. `stage` is the visit's stage ('in_service', 'waiting', 'arrived'…). */
export function kitCandidates(kit: Kit, visits: { id: string; clientName?: string | null; serviceId?: string | null; stage: string; kits?: any[] }[], services: any[]): { id: string; clientName: string; stage: string }[] {
  const rank = (st: string) => (st === 'in_service' ? 0 : st === 'waiting' || st === 'arrived' ? 1 : 9);
  return (visits || []).filter((v) => rank(v.stage) < 9)
    .filter((v) => kitsNeeded((services || []).find((x: any) => x.id === v.serviceId)).some((n) => sameKitType(n.name, kit.name)))
    .filter((v) => !(v.kits || []).some((k: any) => sameKitType(k?.name, kit.name)))
    .sort((a, b) => rank(a.stage) - rank(b.stage))
    .map((v) => ({ id: v.id, clientName: String(v.clientName || 'Guest'), stage: v.stage }));
}
/** Kits still marked "in use" although their visit has finished (nobody scanned them back) — or taken with no client
 *  more than `staleHours` ago. These are the ones that quietly make "no clean kit" appear. */
export function kitsLeftOut(kits: Kit[], visitStage: (visitId: string) => string | null, now = Date.now(), staleHours = 14): Kit[] {
  return (kits || []).filter((k) => { if (k.status !== 'in_use') return false; const age = now - (Date.parse(String(k.at || '')) || now);
    if (k.visitId) { const st = visitStage(k.visitId); return st === 'complete' || st === 'ready_to_pay' || st === 'cancelled' || (st === null && age > staleHours * 3600000); }
    return age > staleHours * 3600000; });
}
/** Hours a kit has sat in its current state (for "being cleaned for 5 h"). */
export const kitHours = (k: Kit, now = Date.now()) => Math.max(0, Math.floor((now - (Date.parse(String(k.at || '')) || now)) / 3600000));

// ── What's IN a kit, cleaning time, and capacity for booking ────────────────────────────────────────────────────────────
//   tenants/{t}/kitTypes/{key} = { name, items: [{ inventoryItemId, name, sku, qty }], cleanMinutes, version, updatedAt, by }
// One record per kit TYPE: every "Manicure kit" holds the same things and takes the same time to clean.
export interface KitItem { inventoryItemId: string | null; name: string; sku?: string | null; qty: number }
export interface KitType { id: string; name: string; items: KitItem[]; cleanMinutes?: number | null; version?: number; updatedAt?: string; by?: string }
export const kitKey = (name: any) => norm(name).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'kit';
export const typeOf = (types: KitType[], name: any) => (types || []).find((t) => sameKitType(t.name, name)) || null;

/** The inventory item a scanned or typed code means: its SKU or barcode, else its id, else an exact name. */
export function matchInventory(inventory: any[], scanned: string): any | null {
  const t = String(scanned || '').trim().toLowerCase(); if (!t) return null;
  const eq = (v: any) => String(v ?? '').trim().toLowerCase() === t;
  return (inventory || []).find((i) => eq(i?.sku) || eq(i?.barcode) || eq(i?.upc)) || (inventory || []).find((i) => hasTag(i, scanned)) || (inventory || []).find((i) => eq(i?.id)) || (inventory || []).find((i) => eq(i?.name)) || null;
}
/** Add one of an item to a contents list (scanning the same thing again raises its quantity). */
export function addKitItem(items: KitItem[], inv: any, qty = 1): KitItem[] {
  const i = (items || []).findIndex((x) => x.inventoryItemId && x.inventoryItemId === inv?.id);
  if (i >= 0) return items.map((x, j) => (j === i ? { ...x, qty: x.qty + qty } : x));
  return [...(items || []), { inventoryItemId: inv?.id || null, name: String(inv?.name || 'Item').slice(0, 80), sku: inv?.sku || inv?.barcode || null, qty: Math.max(1, qty) }].slice(0, 40);
}
/** Is everything there? `have` = how many of each line were scanned or ticked (by position in `items`). */
export function contentsCheck(items: KitItem[], have: number[]): { complete: boolean; missing: string[] } {
  const missing = (items || []).map((it, i) => ({ it, short: Math.max(0, it.qty - (Number(have?.[i]) || 0)) })).filter((x) => x.short > 0).map((x) => (x.it.qty > 1 ? `${x.it.name} × ${x.short}` : x.it.name));
  return { complete: missing.length === 0, missing };
}
/** Seconds left on a timer that started at `since` and runs `minutes` (negative once it's over). */
export const secondsLeft = (since: any, minutes: number, now = Date.now()) => Math.round(((Date.parse(String(since || '')) || now) + Math.max(0, Number(minutes) || 0) * 60000 - now) / 1000);
/** Kit capacity for booking, kept on the business record so every booking screen has it without loading kits:
 *  tenant.kitCapacity = { [kitKey]: { name, usable, cleanMinutes } } — usable = every kit that isn't pulled out or retired. */
export function kitCapacityOf(kits: Kit[], types: KitType[] = []): Record<string, { name: string; usable: number; cleanMinutes: number }> {
  const out: Record<string, { name: string; usable: number; cleanMinutes: number }> = {};
  for (const k of kits || []) { if (!k || k.status === 'retired' || !norm(k.name)) continue; const key = kitKey(k.name);
    const row = out[key] || { name: String(k.name).trim(), usable: 0, cleanMinutes: Math.max(0, Math.round(Number(typeOf(types, k.name)?.cleanMinutes) || 0)) };
    if (k.status !== 'out') row.usable++; out[key] = row; }
  return out;
}
