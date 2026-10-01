// src/lib/protocols.ts — CLEANING PROTOCOLS (O7).
// A protocol is a named, versioned procedure ("Pedicure spa — between clients"). Each step can be conditional:
//   always · only if an add-on was done on this visit · only if the service uses a requirement (from its blueprint).
// So the checklist after a visit lists what that visit actually needs — no paraffin step when there was no paraffin.
// Attached to a SERVICE (its turnover checklist) or a STATION (its default), and used to QUARANTINE a station: it
// can't be released until the protocol is completed. Stored in tenants/{t}/protocols; last 10 versions kept.
export type StepCondition = { type: 'always' } | { type: 'addon'; addOnId: string; label?: string } | { type: 'requirement'; name: string };
export interface ProtocolStep { id: string; text: string; condition: StepCondition }
export interface Protocol { id: string; name: string; zone?: 'clean' | 'dirty' | null; steps: ProtocolStep[]; version: number; updatedAt: string; history?: { version: number; at: string; steps: ProtocolStep[] }[] }
const rid = () => Math.random().toString(36).slice(2, 9);

export const newStep = (text = ''): ProtocolStep => ({ id: rid(), text, condition: { type: 'always' } });
export function conditionLabel(c: StepCondition, addOnName?: (id: string) => string | undefined): string {
  if (c.type === 'addon') return `Only if ${addOnName?.(c.addOnId) || c.label || 'that add-on'} was done`;
  if (c.type === 'requirement') return `Only if the service uses ${c.name}`;
  return 'Always';
}

/** The steps THIS visit needs: unconditional ones, plus those whose add-on was done or whose requirement the service uses. */
export function stepsForVisit(p: Protocol | null | undefined, visit: any, service: any): string[] {
  if (!p?.steps?.length) return [];
  const addOns = new Set<string>((Array.isArray(visit?.addOnIds) ? visit.addOnIds : []).map(String));
  const reqs = new Set<string>((service?.blueprint?.requirements || []).map((r: any) => String(r?.name || '').trim().toLowerCase()).filter(Boolean));
  return p.steps.filter((s) => { const c = s.condition || { type: 'always' };
    if (c.type === 'addon') return addOns.has(String(c.addOnId));
    if (c.type === 'requirement') return reqs.has(String(c.name || '').trim().toLowerCase());
    return true; }).map((s) => s.text).filter(Boolean);
}
/** For quarantine release and stations with no visit: every step that isn't tied to a particular visit. */
export const unconditionalSteps = (p: Protocol | null | undefined) => (p?.steps || []).filter((s) => (s.condition?.type || 'always') === 'always').map((s) => s.text).filter(Boolean);

export function cleanSteps(steps: ProtocolStep[]): ProtocolStep[] {
  return (steps || []).filter((s) => s && String(s.text || '').trim()).slice(0, 40).map((s) => {
    const c: any = s.condition || { type: 'always' };
    const condition: StepCondition = c.type === 'addon' && c.addOnId ? { type: 'addon', addOnId: String(c.addOnId).slice(0, 80), ...(c.label ? { label: String(c.label).slice(0, 60) } : {}) }
      : c.type === 'requirement' && String(c.name || '').trim() ? { type: 'requirement', name: String(c.name).trim().slice(0, 80) } : { type: 'always' };
    return { id: s.id || rid(), text: String(s.text).trim().slice(0, 160), condition };
  });
}
/** New version only when the steps actually changed; last 10 versions kept. */
export function nextProtocol(prev: Partial<Protocol> | null | undefined, name: string, steps: ProtocolStep[], zone?: 'clean' | 'dirty' | null): Omit<Protocol, 'id'> {
  const clean = cleanSteps(steps); const sig = (x: any[]) => JSON.stringify((x || []).map((s: any) => [s.text, s.condition]));
  const changed = !prev?.version || sig(prev.steps || []) !== sig(clean);
  const at = new Date().toISOString();
  return { name: String(name || '').trim().slice(0, 80) || 'Cleaning protocol', zone: zone || null, steps: clean,
    version: changed ? (prev?.version || 0) + 1 : (prev?.version as number), updatedAt: changed ? at : (prev?.updatedAt as string) || at,
    history: changed && prev?.version ? [...(prev.history || []), { version: prev.version, at: prev.updatedAt || at, steps: prev.steps || [] }].slice(-10) : (prev?.history || []) };
}
