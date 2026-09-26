// src/lib/state-rules/index.ts
//
// STATE RULE SETS — how the Academy adapts to each state.
// Everything that differs by state lives in a program's rule fields (hours,
// online limit, daily/weekly caps, rounding, evaluations that unlock the
// student salon, performances, permanent-file checklist, Board forms and
// deadlines, record retention). Features read those fields — never a state
// name — so any state works:
//   • built-in templates (North Carolina today, from 21 NCAC 14T)
//   • "Set up for my state": a school enters its own state's rules (customProgram)
// Each rule set carries its source and a "last checked" date — rules change.

import { NC_TEMPLATES } from '@/lib/state-rules/nc';

export const US_STATES: Record<string, string> = { AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming' };

/** Built-in templates by state (more states are added here — or published from HQ — as they're verified). */
export const BUILT_IN = [...NC_TEMPLATES.map((t) => ({ ...t, source: t.rule, checkedAt: '2026-09-26', retention: { years: 5, untilExamIfEarlier: true } }))];

/** How long to keep a student's records, from the program's rule set. */
export function retainUntil(program: any, firstEnrolledAt: string, examAcceptedAt?: string | null): string | null {
  const r = program?.retention || (program?.state === 'NC' ? { years: 5, untilExamIfEarlier: true } : null);
  if (!r?.years) return null;
  const end = new Date(firstEnrolledAt); end.setFullYear(end.getFullYear() + Number(r.years));
  if (r.untilExamIfEarlier && examAcceptedAt && new Date(examAcceptedAt) < end) return new Date(examAcceptedAt).toISOString();
  return end.toISOString();
}

const key = (s: string) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'item';
const lines = (v: any): string[] => (Array.isArray(v) ? v : String(v || '').split('\n')).map((x: any) => String(x).trim()).filter(Boolean);

/**
 * "Set up for my state": build a program's rule fields from what the school
 * enters. Required evaluations are written "Evaluation name > performance it
 * unlocks" (the part after ">" is optional).
 */
export function customProgram(input: any) {
  const state = US_STATES[input.state] ? input.state : null;
  const performances = lines(input.performances).map((label) => ({ key: key(label), label }));
  const evaluations = [
    ...lines(input.infectionEvaluations).map((label) => ({ key: `ic_${key(label)}`, label, passPct: Math.max(0, Math.min(100, Number(input.infectionPassPct) || 100)), infection: true, gates: [] as string[] })),
    ...lines(input.requiredEvaluations).map((row) => { const [label, unlock] = row.split('>').map((x) => x.trim()); return { key: `eval_${key(label)}`, label, passPct: Math.max(0, Math.min(100, Number(input.passGrade) || 70)), gates: unlock ? [key(unlock)] : [] }; }),
  ];
  const forms = (Array.isArray(input.boardForms) ? input.boardForms : []).map((f: any) => ({ key: key(f.label), label: String(f.label || '').slice(0, 120), trigger: ['enrollment', 'transfer', 'withdrawal', 'graduation'].includes(f.trigger) ? f.trigger : 'enrollment', dueDays: Math.max(1, Math.min(365, Number(f.dueDays) || 30)) })).filter((f: any) => f.label);
  return {
    name: String(input.name || `${input.discipline || 'Program'}${state ? ` (${US_STATES[state]})` : ''}`).slice(0, 120), state, discipline: String(input.discipline || '').slice(0, 60) || null,
    rule: String(input.source || '').slice(0, 160) || null, checkedAt: new Date().toISOString().slice(0, 10),
    totalHours: Math.max(0, Number(input.totalHours) || 0) || null,
    // Online limit: blank = no limit (100%); 0 = online hours not allowed.
    limits: { onlineMaxPct: String(input.onlineMaxPct ?? '').trim() === '' ? 100 : Math.max(0, Math.min(100, Number(input.onlineMaxPct) || 0)), dailyCapHours: Math.max(1, Math.min(24, Number(input.dailyCapHours) || 24)), weeklyCapHours: Math.max(1, Math.min(168, Number(input.weeklyCapHours) || 168)), quarterHour: !!input.quarterHour, fieldTripMaxHours: Math.max(0, Number(input.fieldTripMaxHours) || 0), internshipMaxPct: Math.max(0, Number(input.internshipMaxPct) || 0) },
    passGrade: Math.max(0, Math.min(100, Number(input.passGrade) || 70)), evaluations, performances,
    requiredDocs: lines(input.requiredDocs), boardForms: forms,
    retention: { years: Math.max(0, Math.min(50, Number(input.retentionYears) || 0)), untilExamIfEarlier: !!input.untilExamIfEarlier },
  };
}
