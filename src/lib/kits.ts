// src/lib/kits.ts — KITS (O5): the sets of tools a service needs (a manicure kit, a pedicure kit, a colour kit…), each one
// tracked through its life so the desk knows whether a clean one is waiting before the client sits down.
//   tenants/{t}/kits/{id} = { name, code, status, by, at, visitId?, clientName?, stationName?, note?, cycles, history[] }
// `name` is the kit's TYPE and matches the "Tools / kit" line on a service's blueprint (case doesn't matter), which is how
// a service knows which kits it can use. `code` is what's printed on the label and typed or scanned to move it along.
// Life: ready → in use → dirty → being cleaned → ready. Anything can be pulled out ("out") with a reason; only a manager
// puts it back into service or retires it.
export type KitStatus = 'ready' | 'in_use' | 'dirty' | 'cleaning' | 'out' | 'retired';
export const KIT_LABEL: Record<KitStatus, string> = { ready: 'Clean & ready', in_use: 'In use', dirty: 'Needs cleaning', cleaning: 'Being cleaned', out: 'Pulled out', retired: 'Retired' };
export const KIT_NEXT: Partial<Record<KitStatus, { to: KitStatus; label: string }>> = {
  ready: { to: 'in_use', label: 'Take for a client' }, in_use: { to: 'dirty', label: 'Finished — needs cleaning' },
  dirty: { to: 'cleaning', label: 'Start cleaning' }, cleaning: { to: 'ready', label: 'Clean — ready' } };
export interface Kit { id: string; name: string; code: string; status: KitStatus; by?: string | null; at?: string | null; visitId?: string | null; clientName?: string | null; stationName?: string | null; note?: string | null; cycles?: number; history?: { at: string; by: string; from: KitStatus; to: KitStatus; note?: string | null }[] }

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
  return kits.find((k) => String(k.code || '').toUpperCase() === t && k.status !== 'retired') || null;
}
/** The change to save when a kit moves on. Returns an error message instead when the move isn't allowed. */
export function moveKit(kit: Kit, to: KitStatus, who: { name: string; manager: boolean }, extra: { note?: string | null; visitId?: string | null; clientName?: string | null; stationName?: string | null } = {}, at = new Date().toISOString()): { patch: Partial<Kit> } | { error: string } {
  const from = kit.status;
  if (from === to) return { error: `It’s already ${KIT_LABEL[to].toLowerCase()}.` };
  if (from === 'retired') return { error: 'That kit has been retired.' };
  if (to === 'out') { if (!String(extra.note || '').trim()) return { error: 'Say what’s wrong with it.' }; }
  else if (from === 'out' || to === 'retired') { if (!who.manager) return { error: 'A manager decides what happens to a kit that’s been pulled out.' }; if (from === 'out' && to !== 'ready' && to !== 'retired' && to !== 'dirty') return { error: 'A pulled-out kit goes back as needing cleaning, ready, or retired.' }; }
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
