// src/lib/blueprint.ts — SERVICE BLUEPRINTS (O1): how a service is actually delivered.
// Phases (set-up → active → processing → turnover) with minutes and whether the provider is needed, plus requirements
// beyond rooms/equipment (tools & kits, linens, amenities, extra roles), each required / optional / swappable / needs
// approval. The service's existing timing fields are DERIVED from the phases on save — duration = active + processing,
// padBefore = set-up, padAfter = turnover — so online booking keeps working from one source of truth. Every change is
// versioned (last 10 kept on the service); new bookings record the version they were booked under.
export type PhaseKind = 'setup' | 'active' | 'processing' | 'turnover';
export interface Phase { id: string; kind: PhaseKind; label: string; minutes: number; providerNeeded: boolean; resourceIds?: string[] }
export type RequirementKind = 'equipment' | 'kit' | 'linen' | 'amenity' | 'role';
export type RequirementMode = 'required' | 'optional' | 'substitutable' | 'approval';
export interface Requirement { id: string; kind: RequirementKind; name: string; qty: number; mode: RequirementMode; note?: string }
export interface Blueprint { version: number; updatedAt: string; phases: Phase[]; requirements: Requirement[]; history?: { version: number; at: string; phases: Phase[]; requirements: Requirement[] }[] }

export const PHASE_LABEL: Record<PhaseKind, string> = { setup: 'Set-up', active: 'Service', processing: 'Processing', turnover: 'Turnover' };
export const PHASE_HINT: Record<PhaseKind, string> = { setup: 'Before the client arrives — preparing the station', active: 'Hands-on time with the client',
  processing: 'Waiting time (e.g. colour developing) — the provider can be free', turnover: 'After the client leaves — cleaning and resetting' };
export const REQ_LABEL: Record<RequirementKind, string> = { equipment: 'Equipment', kit: 'Tools / kit', linen: 'Linens', amenity: 'Amenity', role: 'Extra person' };
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
    requirements: (reqs || []).filter((r) => r && String(r.name || '').trim()).slice(0, 40).map((r) => ({ id: r.id || rid(), kind: REQ_LABEL[r.kind] ? r.kind : 'kit', name: String(r.name).trim().slice(0, 80), qty: Math.max(1, Math.min(99, Math.round(Number(r.qty) || 1))), mode: MODE_LABEL[r.mode] ? r.mode : 'required', ...(r.note ? { note: String(r.note).slice(0, 160) } : {}) })) };
}

/** Next blueprint: a new version only when something actually changed; the last 10 versions are kept. */
export function nextBlueprint(prev: Blueprint | null | undefined, phases: Phase[], reqs: Requirement[]): Blueprint {
  const parts = cleanBlueprintParts(phases, reqs);
  const sig = (b: any) => JSON.stringify({ p: (b?.phases || []).map((x: any) => [x.kind, x.label, x.minutes, x.providerNeeded, x.resourceIds || []]), r: (b?.requirements || []).map((x: any) => [x.kind, x.name, x.qty, x.mode, x.note || '']) });
  if (prev && sig(prev) === sig(parts)) return prev;
  const at = new Date().toISOString();
  const history = [...(prev?.history || []), ...(prev ? [{ version: prev.version, at: prev.updatedAt, phases: prev.phases, requirements: prev.requirements }] : [])].slice(-10);
  return { version: (prev?.version || 0) + 1, updatedAt: at, ...parts, history };
}
