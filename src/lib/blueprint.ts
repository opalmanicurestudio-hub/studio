// src/lib/blueprint.ts — SERVICE BLUEPRINTS (O1): how a service is actually delivered.
// Phases (set-up → active → processing → turnover) with minutes and whether the provider is needed, plus requirements
// beyond rooms/equipment (tools & kits, linens, amenities, extra roles), each required / optional / swappable / needs
// approval. The service's existing timing fields are DERIVED from the phases on save — duration = active + processing,
// padBefore = set-up, padAfter = turnover — so online booking keeps working from one source of truth. Every change is
// versioned (last 10 kept on the service); new bookings record the version they were booked under.
export type PhaseKind = 'setup' | 'active' | 'processing' | 'turnover';
export interface Phase { id: string; kind: PhaseKind; label: string; minutes: number; providerNeeded: boolean; resourceIds?: string[] }
export type RequirementKind = 'equipment' | 'kit' | 'tool' | 'disposable' | 'linen' | 'amenity' | 'role';
/** How a single reusable tool is made safe again after each client. */
export type ToolCare = 'wipe' | 'soak' | 'sterilise';
export type RequirementMode = 'required' | 'optional' | 'substitutable' | 'approval';
export interface Requirement { id: string; kind: RequirementKind; name: string; qty: number; mode: RequirementMode; note?: string; care?: ToolCare; inventoryItemId?: string }
export interface Blueprint { version: number; updatedAt: string; phases: Phase[]; requirements: Requirement[]; history?: { version: number; at: string; phases: Phase[]; requirements: Requirement[] }[] }

export const PHASE_LABEL: Record<PhaseKind, string> = { setup: 'Set-up', active: 'Service', processing: 'Processing', turnover: 'Turnover' };
export const PHASE_HINT: Record<PhaseKind, string> = { setup: 'Before the client arrives — preparing the station', active: 'Hands-on time with the client',
  processing: 'Waiting time (e.g. colour developing) — the provider can be free', turnover: 'After the client leaves — cleaning and resetting' };
export const REQ_LABEL: Record<RequirementKind, string> = { equipment: 'Equipment', kit: 'Tools / kit', tool: 'Single tool', disposable: 'Disposable', linen: 'Linens', amenity: 'Amenity', role: 'Extra person' };
export const CARE_LABEL: Record<ToolCare, string> = { wipe: 'Wipe down', soak: 'Soak', sterilise: 'Sterilize' };
export const MODE_LABEL: Record<RequirementMode, string> = { required: 'Required', optional: 'Optional', substitutable: 'Can be swapped', approval: 'Needs approval' };
const rid = () => Math.random().toString(36).slice(2, 9);
const clampMin = (n: any) => Math.max(0, Math.min(24 * 60, Math.round(Number(n) || 0)));

/** Starting phases from a service's current timings, so nothing starts blank. */
export function phasesFromService(s: any): Phase[] {
  const out: Phase[] = [];
  if (Number(s?.padBefore) > 0) out.push({ id: rid(), kind: 'setup', label: PHASE_LABEL.setup, minutes: clampMin(s.padBefore), providerNeeded: true });
  out.push({ id: rid(), kind: 'active', label: PHASE_LABEL.active, minutes: clampMin(s?.duration || 60), providerNeeded: true });
  if (Number(s?.padAfter) > 0) out.push({ id: rid(), kind: 'turnover', label: PHASE_LABEL.turnover, minutes: clampMin(s.padAfter), providerNeeded: false });
  return out;
}
export const newPhase = (kind: PhaseKind = 'active'): Phase => ({ id: rid(), kind, label: PHASE_LABEL[kind], minutes: kind === 'turnover' ? 10 : 15, providerNeeded: kind !== 'turnover' && kind !== 'processing' });
export const newRequirement = (kind: RequirementKind = 'kit'): Requirement => ({ id: rid(), kind, name: '', qty: 1, mode: 'required' });

/** The timing fields online booking uses, worked out from the phases. */
export function deriveTimings(phases: Phase[]) {
  const sum = (k: PhaseKind[]) => phases.filter((p) => k.includes(p.kind)).reduce((a, p) => a + clampMin(p.minutes), 0);
  const duration = sum(['active', 'processing']); const padBefore = sum(['setup']); const padAfter = sum(['turnover']);
  const providerMinutes = phases.filter((p) => p.providerNeeded).reduce((a, p) => a + clampMin(p.minutes), 0);
  return { duration, padBefore, padAfter, clientMinutes: duration, providerMinutes, stationMinutes: duration + padBefore + padAfter, providerFreeMinutes: Math.max(0, duration - phases.filter((p) => p.providerNeeded && (p.kind === 'active' || p.kind === 'processing')).reduce((a, p) => a + clampMin(p.minutes), 0)) };
}

/** Clean what the editor produced (no blanks, sane numbers). */
export function cleanBlueprintParts(phases: Phase[], reqs: Requirement[]) {
  return { phases: (phases || []).filter((p) => p && PHASE_LABEL[p.kind]).slice(0, 20).map((p) => ({ id: p.id || rid(), kind: p.kind, label: String(p.label || PHASE_LABEL[p.kind]).slice(0, 60), minutes: clampMin(p.minutes), providerNeeded: !!p.providerNeeded, ...(p.resourceIds?.length ? { resourceIds: p.resourceIds.slice(0, 10) } : {}) })),
    requirements: (reqs || []).filter((r) => r && String(r.name || '').trim()).slice(0, 40).map((r) => ({ id: r.id || rid(), kind: REQ_LABEL[r.kind] ? r.kind : 'kit', name: String(r.name).trim().slice(0, 80), qty: Math.max(1, Math.min(99, Math.round(Number(r.qty) || 1))), mode: MODE_LABEL[r.mode] ? r.mode : 'required', ...(r.note ? { note: String(r.note).slice(0, 160) } : {}),
      ...(r.kind === 'tool' ? { care: CARE_LABEL[r.care as ToolCare] ? r.care : 'wipe' } : {}), ...(r.kind === 'disposable' && r.inventoryItemId ? { inventoryItemId: String(r.inventoryItemId).slice(0, 80) } : {}) })) };
}

/** Next blueprint: a new version only when something actually changed; the last 10 versions are kept. */
export function nextBlueprint(prev: Blueprint | null | undefined, phases: Phase[], reqs: Requirement[]): Blueprint {
  const parts = cleanBlueprintParts(phases, reqs);
  const sig = (b: any) => JSON.stringify({ p: (b?.phases || []).map((x: any) => [x.kind, x.label, x.minutes, x.providerNeeded, x.resourceIds || []]), r: (b?.requirements || []).map((x: any) => [x.kind, x.name, x.qty, x.mode, x.note || '', x.care || '', x.inventoryItemId || '']) });
  if (prev && sig(prev) === sig(parts)) return prev;
  const at = new Date().toISOString();
  const history = [...(prev?.history || []), ...(prev ? [{ version: prev.version, at: prev.updatedAt, phases: prev.phases, requirements: prev.requirements }] : [])].slice(-10);
  return { version: (prev?.version || 0) + 1, updatedAt: at, ...parts, history };
}

/** Tools (single reusable ones) these services need cleaned after the client, grouped by how: wipe, soak, sterilise. */
export function toolCare(services: any[]): { care: ToolCare; label: string; tools: { name: string; qty: number }[] }[] {
  const m = new Map<ToolCare, Map<string, { name: string; qty: number }>>();
  for (const sv of services || []) for (const r of (sv?.blueprint?.requirements || []) as Requirement[]) {
    if (r?.kind !== 'tool' || !String(r.name || '').trim() || r.mode === 'optional') continue;
    const c: ToolCare = CARE_LABEL[r.care as ToolCare] ? (r.care as ToolCare) : 'wipe'; const g = m.get(c) || new Map(); const k = String(r.name).trim().toLowerCase();
    const cur = g.get(k) || { name: String(r.name).trim(), qty: 0 }; cur.qty += Math.max(1, Math.round(Number(r.qty) || 1)); g.set(k, cur); m.set(c, g);
  }
  return (['wipe', 'soak', 'sterilise'] as ToolCare[]).filter((c) => m.has(c)).map((c) => ({ care: c, label: CARE_LABEL[c], tools: [...m.get(c)!.values()] }));
}
/** Disposables these services use up (thrown away after one client), each linked to a stock item when one was picked. */
export function disposablesUsed(services: any[]): { name: string; qty: number; inventoryItemId: string | null }[] {
  const m = new Map<string, { name: string; qty: number; inventoryItemId: string | null }>();
  for (const sv of services || []) for (const r of (sv?.blueprint?.requirements || []) as Requirement[]) {
    if (r?.kind !== 'disposable' || !String(r.name || '').trim() || r.mode === 'optional') continue;
    const k = r.inventoryItemId || String(r.name).trim().toLowerCase(); const cur = m.get(k) || { name: String(r.name).trim(), qty: 0, inventoryItemId: r.inventoryItemId || null };
    cur.qty += Math.max(1, Math.round(Number(r.qty) || 1)); m.set(k, cur);
  }
  return [...m.values()];
}
