// src/lib/readiness-rules.ts — WHAT A BUSINESS (OR ONE SERVICE) SAYS ABOUT STARTING A VISIT: for each of six things,
// must it be done to start ('block'), a reminder only ('remind'), or off. No other imports, so any screen can read it
// without bringing in the rest of the visit checklist (lib/visit-readiness, which uses it).
export type ReadyKey = 'confirmed' | 'deposit' | 'forms' | 'photo' | 'card' | 'questions';
export type ReadyRule = 'block' | 'remind' | 'off';
export const READY_KEYS: ReadyKey[] = ['confirmed', 'deposit', 'forms', 'photo', 'card', 'questions'];
export const READY_DEFAULTS: Record<ReadyKey, ReadyRule> = { confirmed: 'remind', deposit: 'block', forms: 'block', photo: 'remind', card: 'remind', questions: 'remind' };
export const READY_LABEL: Record<ReadyKey, string> = { confirmed: 'Confirmed', deposit: 'Deposit', forms: 'Forms signed', photo: 'Photo from the client', card: 'Card on file', questions: 'Before-visit questions' };
export const READY_HELP: Record<ReadyKey, string> = {
  confirmed: 'They replied to say they’re coming.',
  deposit: 'Only when the booking asked for one.',
  forms: 'The service’s forms, and any added to the visit.',
  photo: 'When the service or the visit asks for one.',
  card: 'When the service or booking needs a card saved.',
  questions: 'When the service has before-visit questions.',
};

export function readinessRules(tenant: any, service?: any): Record<ReadyKey, ReadyRule> {
  const out = { ...READY_DEFAULTS }; const ok = (v: any): v is ReadyRule => v === 'block' || v === 'remind' || v === 'off';
  for (const k of READY_KEYS) { const t = tenant?.readiness?.[k]; if (ok(t)) out[k] = t; const s = service?.readiness?.[k]; if (ok(s)) out[k] = s; }
  return out;
}
