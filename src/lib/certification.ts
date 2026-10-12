// src/lib/certification.ts — CERTIFIED FOR A SERVICE (approved design, canvas row 23 "Certified for a service").
// A service can need certification. What it takes is set on the service (service.certification):
//   docIds       — documents to read and sign (their current version; any quick check is passed before signing)
//   watched      — a manager or educator watches one and signs it off
//   renewMonths  — how long it lasts (0 = for good); when it runs out a manager renews it
// Each person's record is tenants/{t}/certifications/{staffId}__{serviceId} (written by the server only).
// What happens to someone who isn't certified is the business's choice (tenant.certificationMode):
//   'warn'  (the default) — they can still be booked; the desk sees a warning when booking them
//   'block' — they're left off the booking page, the desk and walk-ins for that service. The scheduling engine already
//             honours service.certifiedStaffIds, so in block mode the server keeps that list to the certified people.
// The certified people are always kept on the service as certStaffIds (for the warning and the staff app).
export type CertMode = 'block' | 'warn';
export interface CertRule { required: boolean; docIds: string[]; watched: boolean; renewMonths: number }
export interface CertRecord { staffId: string; staffName?: string; serviceId: string; serviceName?: string; status: 'working' | 'certified' | 'lapsed' | 'removed';
  certifiedAt?: string | null; how?: 'requirements' | 'already' | 'renewed' | null; by?: string | null; renewBy?: string | null;
  watchedAt?: string | null; watchedBy?: string | null; watchedNote?: string | null; updatedAt?: string }

/** Placed in certifiedStaffIds when nobody is certified yet in block mode (an empty list would mean "anyone"). */
export const NOBODY = '__nobody_certified__';
export const RENEW_CHOICES = [0, 6, 12, 24] as const;

export const certModeOf = (tenant: any): CertMode => (tenant?.certificationMode === 'block' ? 'block' : 'warn');
export const certId = (staffId: string, serviceId: string) => `${staffId}__${serviceId}`;

export function cleanRule(raw: any): CertRule {
  const docIds = [...new Set((Array.isArray(raw?.docIds) ? raw.docIds : []).map((x: any) => String(x).slice(0, 120)).filter(Boolean))].slice(0, 6) as string[];
  const rm = Number(raw?.renewMonths) || 0;
  return { required: raw?.required === true, docIds, watched: raw?.watched === true, renewMonths: (RENEW_CHOICES as readonly number[]).includes(rm) ? rm : 0 };
}
export const certRuleOf = (service: any): CertRule => cleanRule(service?.certification);

/** yyyy-mm-dd, n months after a date (end-of-month safe). */
export function addMonths(isoDay: string, n: number): string {
  const [y, m, d] = isoDay.slice(0, 10).split('-').map(Number); const t = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}
export const renewByFor = (rule: CertRule, certifiedDay: string) => (rule.renewMonths ? addMonths(certifiedDay, rule.renewMonths) : null);

/** Certified and not past the renew-by date. */
export const isCurrent = (rec: Partial<CertRecord> | null | undefined, today: string) => !!rec && rec.status === 'certified' && (!rec.renewBy || rec.renewBy >= today);
/** Within this many days of renewing — shown amber. */
export const renewSoon = (rec: Partial<CertRecord> | null | undefined, today: string, days = 30) => !!rec?.renewBy && isCurrent(rec, today) && rec.renewBy <= addDays(today, days);
export function addDays(isoDay: string, n: number) { const t = new Date(`${isoDay.slice(0, 10)}T12:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); }

const short = (iso: any) => { const t = Date.parse(`${String(iso).slice(0, 10)}T12:00:00Z`); return Number.isFinite(t) ? new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : ''; };
export interface CertStep { key: string; label: string; detail: string; done: boolean; kind: 'doc' | 'watched' }
/** What someone still has to do. `acks` by document id ({ version } of their sign-off); `docs` by id ({ title, version, status }). */
export function certSteps(rule: CertRule, rec: Partial<CertRecord> | null | undefined, acks: Record<string, any>, docs: Record<string, any>): CertStep[] {
  const out: CertStep[] = [];
  for (const id of rule.docIds) {
    const d = docs[id]; if (!d || d.status !== 'published') continue;   // a document that isn't published can't be required
    const a = acks[id]; const v = Number(d.version || 1); const done = !!a && Number(a.version) === v;
    out.push({ key: `doc:${id}`, kind: 'doc', label: `Read and sign “${d.title || 'the document'}”`, done,
      detail: done ? `v${v} · signed${a?.acknowledgedAt ? ` ${short(a.acknowledgedAt)}` : ''}${a?.quiz ? ` · quick check ${a.quiz.right} of ${a.quiz.total}` : ''}` : a ? `Signed v${a.version} — v${v} to sign` : `v${v}${Array.isArray(d.quiz) && d.quiz.length ? ' · with a quick check' : ''}` });
  }
  if (rule.watched) out.push({ key: 'watched', kind: 'watched', label: 'Do one with a manager watching', done: !!rec?.watchedAt,
    detail: rec?.watchedAt ? `Signed off by ${rec.watchedBy || 'a manager'} · ${short(rec.watchedAt)}${rec.watchedNote ? ` · ${rec.watchedNote}` : ''}` : 'A manager or educator watches and signs it off' });
  return out;
}
/** Ready to be certified: every step done (and at least one step — a rule with none is certified by a manager by hand). */
export const stepsDone = (steps: CertStep[]) => steps.length > 0 && steps.every((s) => s.done);

/** The certified people for one service. */
export const certifiedIds = (recs: Partial<CertRecord>[], serviceId: string, today: string) =>
  [...new Set(recs.filter((r) => r.serviceId === serviceId && isCurrent(r, today)).map((r) => String(r.staffId)))].sort();

/** What the service should carry. `certifiedStaffIds` null means "remove it" (nothing is gated). `exempt` (renters —
 *  they run their own business and make their own choice) stay bookable in block mode. */
export function gateFields(rule: CertRule, mode: CertMode, ids: string[], exempt: string[] = []): { certStaffIds: string[]; certifiedStaffIds: string[] | null } {
  if (!rule.required) return { certStaffIds: ids, certifiedStaffIds: null };
  const gate = [...new Set([...ids, ...exempt])].sort();
  return { certStaffIds: ids, certifiedStaffIds: mode === 'block' ? (gate.length ? gate : [NOBODY]) : null };
}

/** For the desk: a warning when booking someone who isn't certified (warn mode), or null. */
export function certWarning(service: any, staffId: string | null | undefined, staffName?: string | null): string | null {
  if (!service || !staffId || !certRuleOf(service).required) return null;
  const ids: string[] = Array.isArray(service.certStaffIds) ? service.certStaffIds : [];
  if (ids.includes(staffId)) return null;
  return `Please note: ${staffName ? `${String(staffName).split(' ')[0]} is` : 'this team member is'} not yet certified for ${service.name || 'this service'}.`;
}
