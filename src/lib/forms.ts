// src/lib/forms.ts — ONE RULE FOR "WHAT DOES THIS VISIT STILL NEED SIGNED?" (Forms and documents, boards FormsBook,
// FormsAfter, FormsOwner). Every screen asks here: the booking sheet, the visit link, the desk, the planner sheet, the
// staff portal, the walk-in kiosk, phone bookings and the reminders. Before, each had its own copy (18 months in some,
// forever in others), so a form signed online counted as missing at the desk.
//
// The rule: a form a client signed stays on file until its WORDING changes (each wording has its own version, below)
// or the business's time limit passes (Settings: "A signed form lasts", 12 months unless the business chooses), unless
// the form must be signed at every visit. Health questions on file get one question at the next booking instead of the
// whole form again: "Anything changed?" (Settings: Health questions). Works in the browser and on the server.

export type FormRules = {
  /** How long a signed form lasts, in months; 0 = until its wording changes. */
  lastsMonths: number;
  /** Health questions on file: ask "anything changed?" at each booking, or the whole form each time. */
  health: 'changed' | 'every';
  /** Signing for someone under 18 asks for the guardian's name and how they're related. */
  guardian: boolean;
};
export const FORM_RULES_DEFAULT: FormRules = { lastsMonths: 12, health: 'changed', guardian: true };
export const LASTS_CHOICES = [0, 6, 12, 18, 24] as const;

export function formRulesOf(tenant: any): FormRules {
  const r = tenant?.formRules || {};
  const m = Number(r.lastsMonths);
  return {
    lastsMonths: (LASTS_CHOICES as readonly number[]).includes(m) ? m : FORM_RULES_DEFAULT.lastsMonths,
    health: r.health === 'every' ? 'every' : 'changed',
    guardian: r.guardian !== false,
  };
}

/** The version of a form's wording: changes whenever anything a client reads or answers changes (the title, the
 *  wording, a question, its choices, whether it's required), and never otherwise (so re-saving the same words keeps it). */
export function formVersion(form: any): string {
  const f = form || {};
  const words = JSON.stringify([
    String(f.title || '').trim(), String(f.content || '').trim(), !!f.requiresSignature, !!f.requiresGuardianSignature,
    (Array.isArray(f.fields) ? f.fields : []).map((x: any) => [String(x?.type || ''), String(x?.label || '').trim(), (Array.isArray(x?.options) ? x.options : []).map((o: any) => String(o).trim()), !!x?.required]),
  ]);
  let h = 0x811c9dc5;   // FNV-1a, 32 bits: the same answer in every browser and on the server
  for (let i = 0; i < words.length; i++) { h ^= words.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return `v${h.toString(36)}`;
}

/** A health form (the builder's "Intake" category): on file, it gets "anything changed?" instead of the whole form. */
export const isHealthForm = (form: any) => String(form?.category || '') === 'Intake';

// ── Is a form finished? (the booking sheet's form screen, and the server checking what it was sent) ──────────────
/** Who completes a form for someone under 18: their name, how they're related, and their tick that they agree. */
export type Guardian = { on: boolean; name: string; relationship: string; consent?: boolean };
const NOT_QUESTION = new Set(['heading', 'paragraph']);
/** A signature typed instead of drawn: kept as the words, marked as typed. */
export const TYPED = 'typed:';
/** The form screen's own marks, kept beside the answers and never sent as answers (a question's own id can start with
 *  "__" too, so only these are left out). */
export const FORM_META: ReadonlySet<string> = new Set(['__signedName', '__read', '__seen']);
/** A real signature: a drawn picture (not a blank pad) or typed words. */
export const isSignature = (v: any) => typeof v === 'string' && ((/^data:image\/png;base64,/.test(v) && v.length >= 80) || (v.startsWith(TYPED) && v.slice(TYPED.length).trim().length > 0));
const answered = (f: any, v: any) => f?.type === 'signature' ? isSignature(v)
  : v !== undefined && v !== null && !(typeof v === 'string' && !v.trim()) && !(Array.isArray(v) && v.length === 0);
/** A form's fields: its own (with a signature added when it asks for one and has none), or its plain wording. */
export function fieldsOf(form: any): any[] {
  const fs: any[] = Array.isArray(form?.fields) ? form.fields.filter(Boolean) : [];
  const sign = { id: 'signature', type: 'signature', label: 'Your signature' };
  if (fs.length) return form?.requiresSignature && !fs.some((f) => f?.type === 'signature') ? [...fs, sign] : fs;
  return [...(form?.content ? [{ id: 'content', type: 'paragraph', label: String(form.content) }] : []), ...(form?.requiresSignature ? [sign] : [])];
}
export const hasSignature = (form: any) => fieldsOf(form).some((f) => f.type === 'signature');
export const questionsOf = (form: any) => fieldsOf(form).filter((f) => !NOT_QUESTION.has(f.type));
/** A form with wording and nothing to answer or sign: it asks "I've read this". */
export const wordingOnly = (form: any) => questionsOf(form).length === 0;
/** About how long a form takes, in minutes (reading at 200 words a minute, a few seconds a question). */
export function formMinutes(form: any): number {
  const fs = fieldsOf(form);
  const words = fs.filter((f) => NOT_QUESTION.has(f.type)).reduce((n, f) => n + String(f.label || '').split(/\s+/).length, 0);
  const secs = words * 0.3 + questionsOf(form).filter((f) => f.type !== 'signature').length * 12 + (hasSignature(form) ? 20 : 0);
  return Math.max(1, Math.round(secs / 60));
}
/** Is a guardian completing this form? Always for a form that needs one; otherwise when they say so (and the business asks). */
export const guardianSigns = (form: any, g?: Guardian | null, guardianAsk = true) => !!form?.requiresGuardianSignature || (guardianAsk && !!g?.on && hasSignature(form));
/** What's still missing on a form: questions without an answer, a real signature and the signer's name, the guardian's
 *  details and consent, "I've read this" on a form with only wording, and (on a form with nothing it requires) opening
 *  it at all. Answers keep their own keys; "__signedName", "__read" and "__seen" are the form screen's own. */
export function formLeft(form: any, a: Record<string, any> = {}, g?: Guardian | null, guardianAsk = true): number {
  const req = questionsOf(form).filter((f) => f.required !== false);
  let n = req.filter((f) => !answered(f, a[f.id])).length;
  if (hasSignature(form) && !String(a.__signedName || '').trim()) n++;
  if (wordingOnly(form) && a.__read !== true) n++;
  if (guardianSigns(form, g, guardianAsk) && !(String(g?.name || '').trim() && String(g?.relationship || '').trim() && g?.consent === true)) n++;
  if (!req.length && !wordingOnly(form) && !hasSignature(form) && a.__seen !== true) n++;
  return n;
}
// ── When forms are due (board FormsAfter) ─────────────────────────────────────────────────────────────────────────
/** Forms are due a day before the visit, so the team sees them in time (a service can ask for two days). */
export const FORMS_DUE_HOURS = 24;
/** When a visit's forms are due: `hours` before it starts (a day unless the service says otherwise), or at its start for
 *  a visit booked after that. */
export function formsDueAt(startIso: any, bookedIso?: any, hours: number = FORMS_DUE_HOURS): string | null {
  const s = toMs(startIso); if (!s) return null;
  const due = s - (hours === 48 ? 48 : FORMS_DUE_HOURS) * 3600e3; const b = toMs(bookedIso);
  return new Date(b && due < b ? s : due).toISOString();
}

// ── A service's own rule for its forms (Settings › Forms and documents, board FormsOwner) ─────────────────────────────
/** When: 'booking' (online, they're done to book; a visit the team books is due a day before), or 24 / 48 hours before.
 *  If they aren't done by then: 'off' (check-in goes through them, or a reminder only, as service.readiness.forms says),
 *  'auto' (the time is released, nothing charged) or 'ask' (the team is asked whether to release it). own: the service
 *  set its own rule (otherwise Automations' "consent form unsigned" applies, as before). */
export type FormsDue = 'booking' | 24 | 48;
export type FormsRule = { due: FormsDue; dueHours: number; release: 'off' | 'auto' | 'ask'; own: boolean };
export function formsRuleOf(service: any): FormsRule {
  const r = service?.formsRule && typeof service.formsRule === 'object' ? service.formsRule : null;
  const due: FormsDue = r?.due === 'booking' ? 'booking' : Number(r?.due) === 48 ? 48 : 24;
  const release = r?.release === 'auto' || r?.release === 'ask' ? r.release : 'off';
  return { due, dueHours: due === 48 ? 48 : 24, release, own: !!r };
}
/** Does this service offer inspiration photos when it's booked? Yes unless the business switched them off for it. */
export const asksInspirationPhotos = (service: any) => service?.inspirationPhotos !== 'off';

/** Does a visit's request ask for more than its forms and documents (a card or deposit, a policy, an emergency contact,
 *  a marketing choice, things to confirm)? Then the visit link's "Send" finishes it; otherwise the last form does. */
export const requestAsksMore = (rec: any) => !!rec && (rec.skipCardStep !== true || rec.requestMarketingConsent === true || rec.requestEmergencyContact === true || (Array.isArray(rec.acknowledgments) && rec.acknowledgments.length > 0));

/** A form as the server was sent it (answers, the name it was signed in, "I've read this", the guardian): finished? */
export function sentFormDone(form: any, f: { formData?: any; signedName?: any; acknowledged?: any; guardian?: any }, rules: FormRules = FORM_RULES_DEFAULT): boolean {
  const g = f.guardian && f.guardian.confirmed === true ? { on: true, name: String(f.guardian.name || ''), relationship: String(f.guardian.relationship || ''), consent: true } : null;
  return formLeft(form, { ...(f.formData || {}), __signedName: f.signedName || '', __read: f.acknowledged === true, __seen: true }, g, rules.guardian) === 0;
}

export type OnFile = { signedAt?: any; version?: string | null; everyVisit?: boolean; guardian?: boolean; formTitle?: string | null; confirmedAt?: string | null; source?: string | null; appointmentId?: string | null };

/** What the client record says about one form: the signedForms map (formId → when, which version), the field the
 *  kiosk used to write by mistake ("signedForms.<id>" stored as one literal name), or an older list of ids. */
export function onFileEntry(client: any, formId: string): OnFile | null {
  const map = client?.signedForms && typeof client.signedForms === 'object' && !Array.isArray(client.signedForms) ? client.signedForms : {};
  const asEntry = (e: any): OnFile | null => {
    if (!e) return null;
    const bare = typeof e !== 'object' || e instanceof Date || typeof e.toDate === 'function' || 'seconds' in e || '_seconds' in e;
    return bare ? { signedAt: e } : (e as OnFile);
  };
  // The map, or the dotted field the kiosk wrote by mistake: whichever was signed more recently.
  const a = asEntry(map[formId]), b = asEntry(client?.[`signedForms.${formId}`]);
  const e = a && b ? (toMs(b.signedAt) > toMs(a.signedAt) ? b : a) : a || b;
  if (e) return e;
  const ids: string[] = [...(Array.isArray(client?.signedConsentIds) ? client.signedConsentIds : []), ...(Array.isArray(client?.signedFormIds) ? client.signedFormIds : [])].map(String);
  return ids.includes(formId) ? { signedAt: null } : null;
}

/** A date as stored anywhere (an ISO string, a Firestore Timestamp, {seconds}, a number, a Date): milliseconds, or 0. */
export function toMs(v: any): number {
  if (!v) return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (v instanceof Date) return v.getTime() || 0;
  if (typeof v?.toDate === 'function') { try { return v.toDate().getTime() || 0; } catch { return 0; } }
  if (typeof v === 'object' && Number.isFinite(Number(v.seconds ?? v._seconds))) return Number(v.seconds ?? v._seconds) * 1000;
  const t = Date.parse(String(v)); return Number.isFinite(t) ? t : 0;
}

/** When this rule began. A form signed before it (no version on file) counts its time from here, so nobody who signed
 *  under the old rules is suddenly asked again (or held up at the desk) the day it starts. */
export const RULES_BEGAN = Date.parse('2026-11-03T00:00:00Z');

// Whole months between two moments, by the calendar in UTC (so the server and every browser agree).
const monthsBetween = (a: Date, b: Date) => (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth()) - (b.getUTCDate() < a.getUTCDate() ? 1 : 0);

export type FormState = 'current' | 'changed' | 'expired' | 'every' | 'none';
/** Where one form stands for one client. The form itself (when a screen has it) tells whether its wording changed
 *  since they signed, whether it's signed at every visit, and whether it needs a guardian. */
export function formStateOf(form: any | null, entry: OnFile | null, rules: FormRules = FORM_RULES_DEFAULT, now = new Date()): FormState {
  if (!entry) return 'none';
  // Signed at every visit: the form as it is now decides (a flag stored when they signed only counts without it).
  if (form ? !!form.requiresEveryAppointment : !!entry.everyVisit) return 'every';
  // Health questions the business asks in full at every booking.
  if (form && isHealthForm(form) && rules.health === 'every') return 'every';
  const versioned = !!entry.version;
  if (form && versioned && entry.version !== formVersion(form)) return 'changed';   // from the words themselves, never a stored label
  // Signed before versions began, and the wording has changed since (the builder stamps when it does).
  if (form && !versioned && toMs(form.versionedAt) > toMs(entry.signedAt)) return 'changed';
  // A form that needs a guardian, signed (under this rule) without one: not on file.
  if (form?.requiresGuardianSignature && versioned && !entry.guardian) return 'none';
  if (rules.lastsMonths > 0) {
    let at = toMs(entry.signedAt);
    if (!versioned) at = Math.max(at, RULES_BEGAN);          // signed before this rule: counted from when it began
    if (!at) return 'expired';                               // a date that can't be read is never taken as current
    if (monthsBetween(new Date(at), now) >= rules.lastsMonths) return 'expired';
  }
  return 'current';
}

/** The forms one visit asks for: its service's, any add-on's, and any the team added to the visit. */
export function formsAskedFor(apt: any, services: any[] = []): string[] {
  const ids = new Set<string>();
  for (const s of services) for (const x of (s?.requiredFormIds || s?.consentFormIds || [])) ids.add(String(x));
  for (const x of [...(apt?.requiredFormIds || []), ...(apt?.extraFormIds || [])]) ids.add(String(x));
  return [...ids].filter(Boolean);
}

/** Forms the team waived for this visit, with why (appointment.formsWaived: formId → { by, reason, at }). A waived form
 *  doesn't hold the visit up and isn't asked for again on it; it isn't on file, so the next visit asks as usual. */
export const waivedOnVisit = (apt: any): Map<string, { by?: string; reason?: string; at?: string }> => {
  const w = apt?.formsWaived && typeof apt.formsWaived === 'object' && !Array.isArray(apt.formsWaived) ? apt.formsWaived : {};
  return new Map(Object.entries(w).filter(([, v]) => v && typeof v === 'object').map(([k, v]: [string, any]) => [k, v]));
};
/** What the client reads for a form the team waived (never who waived it or why). */
export const CLIENT_WAIVED = 'Not needed this time';
/** Forms already signed for this visit (on the visit itself). */
export const signedOnVisit = (apt: any) => new Set<string>((Array.isArray(apt?.signedForms) ? apt.signedForms : []).map((f: any) => String(typeof f === 'string' ? f : f?.formId || f?.id || '')).filter(Boolean));

/** The forms this visit still needs signed: asked for, not signed on this visit, and not current on file. */
export function formsStillNeeded(o: { apt?: any; services?: any[]; ids?: string[]; client?: any; forms?: any[]; rules?: FormRules; now?: Date }): string[] {
  const asked = o.ids || formsAskedFor(o.apt, o.services || []);
  const here = signedOnVisit(o.apt); const waived = waivedOnVisit(o.apt);
  const rules = o.rules || FORM_RULES_DEFAULT;
  return asked.filter((id) => !here.has(id) && !waived.has(id) && formStateOf((o.forms || []).find((f: any) => f?.id === id) || null, onFileEntry(o.client, id), rules, o.now) !== 'current');
}

export type FormAsk = { formId: string; title: string; ask: 'sign' | 'sign_again' | 'confirm' | 'done'; why: string; waived?: true };
/** What a client is asked for each form, in plain words: sign it, sign it again (its wording changed, or it's been a
 *  while), confirm nothing's changed (a health form on file), or nothing (on file, or signed for this visit). */
export function formAsks(o: { apt?: any; services?: any[]; ids?: string[]; client?: any; forms: any[]; rules?: FormRules; now?: Date }): FormAsk[] {
  const asked = o.ids || formsAskedFor(o.apt, o.services || []);
  const here = signedOnVisit(o.apt); const rules = o.rules || FORM_RULES_DEFAULT;
  const confirmedHere = new Set<string>(Array.isArray(o.apt?.healthConfirmed) ? o.apt.healthConfirmed.map(String) : []);
  return asked.map((id) => {
    const form = o.forms.find((f: any) => f?.id === id) || null;
    const title = String(form?.title || 'Form');
    if (here.has(id)) return { formId: id, title, ask: 'done', why: 'Signed for this visit' };
    const w = waivedOnVisit(o.apt).get(id);
    // The team's reason is for the team: anything the client sees says only that it isn't needed this time (CLIENT_WAIVED).
    if (w) return { formId: id, title, ask: 'done', waived: true, why: `Waived${w.by ? ` by ${String(w.by).split(' ')[0]}` : ''}${w.reason ? `: ${String(w.reason).slice(0, 80)}` : ''}` };
    const entry = onFileEntry(o.client, id);
    const st = formStateOf(form, entry, rules, o.now);
    if (st === 'none') return { formId: id, title, ask: 'sign', why: form?.requiresSignature || (form?.fields || []).some((f: any) => f?.type === 'signature') ? 'Read and sign' : 'A few questions' };
    if (st === 'every') return { formId: id, title, ask: 'sign', why: isHealthForm(form) && rules.health === 'every' && !form?.requiresEveryAppointment ? 'Asked at every visit' : 'Signed at every visit' };
    if (st === 'changed') return { formId: id, title, ask: 'sign_again', why: 'The wording has changed since you signed' };
    if (st === 'expired') return { formId: id, title, ask: 'sign_again', why: 'It’s been a while since you signed' };
    const day = toMs(entry?.signedAt) ? new Date(toMs(entry?.signedAt)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : '';
    if (isHealthForm(form) && !confirmedHere.has(id)) return { formId: id, title, ask: 'confirm', why: day ? `On file since ${day}` : 'On file' };
    return { formId: id, title, ask: 'done', why: day ? `Signed ${day} · still current` : 'On file' };
  });
}

/** Documents a service asks for (photo ID and the like) that this client doesn't already have on file. */
export function filesStillNeeded(service: any, client: any): any[] {
  const reqs: any[] = Array.isArray(service?.requiredFileRequirements) ? service.requiredFileRequirements : [];
  const onFile: any[] = Array.isArray(client?.profileDocuments) ? client.profileDocuments : [];
  return reqs.filter((r) => r && (!r.persistToProfile || !onFile.some((d) => d?.requirementId === r.id && (d.files || []).length)));
}

/** Adds documents to a client's profile without dropping the ones already there: same requirement → the new files. */
export function mergeProfileDocuments(existing: any[], incoming: any[]): any[] {
  const out = [...(Array.isArray(existing) ? existing : [])];
  for (const d of incoming || []) {
    if (!d?.requirementId) continue;
    const i = out.findIndex((x) => x?.requirementId === d.requirementId);
    if (i >= 0) out[i] = d; else out.push(d);
  }
  return out.slice(-30);
}

/** A visit's list of signed forms kept within what one record can hold: when the answers together grow large, the older
 *  entries keep their name and date, and their answers move to the visit's own formAnswers records (moved: what the
 *  caller writes there, in the same batch). Nothing is dropped. */
export function fitOnVisit(list: any[], newest: number): { list: any[]; moved: any[] } {
  const out = Array.isArray(list) ? [...list] : [];
  if (JSON.stringify(out).length <= 500_000) return { list: out, moved: [] };
  const moved: any[] = [];
  const kept = out.map((x, i) => {
    if (i < out.length - newest && x && typeof x === 'object' && x.formData && Object.keys(x.formData).length) { moved.push(x); return { ...x, formData: {}, answersMoved: true }; }
    return x;
  });
  return { list: kept, moved };
}
