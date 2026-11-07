// src/lib/forms-settings.ts — THE WORDS AND CHOICES OF SETTINGS › FORMS AND DOCUMENTS (board FormsOwner), kept apart from
// the screen so they can be checked: what each service needs in one line, when its forms are due, what happens if they
// aren't done (and the fields that choice writes), the kinds of documents the business asks for, and what a client
// reads before booking. One rule for what's due and what's released: lib/forms (formsRuleOf) and lib/forms-release.
import { formsRuleOf, formMinutes, hasSignature, wordingOnly, isHealthForm, asksInspirationPhotos, fieldsOf, type FormsDue } from './forms';
import { readinessRules } from './readiness-rules';

export type IfNotDone = 'checkin' | 'remind' | 'release';
export type Decide = 'auto' | 'ask';
export const DUE_CHOICES: { value: FormsDue; label: string }[] = [
  { value: 24, label: '24 hours before' }, { value: 48, label: '2 days before' }, { value: 'booking', label: 'When they book' },
];
export const IF_CHOICES: { value: IfNotDone; label: string }[] = [
  { value: 'checkin', label: 'Go through them at check-in' }, { value: 'remind', label: 'A reminder only' }, { value: 'release', label: 'Release the time' },
];
export const dueLabel = (due: FormsDue) => DUE_CHOICES.find((c) => c.value === due)?.label || '24 hours before';

export type DocType = { id: string; label: string; kept: boolean; services: number };
/** The documents the business asks for, one per name (Photo ID, a referral letter…), with the id every service shares. */
export function docTypesOf(services: any[]): DocType[] {
  const out: DocType[] = [];
  for (const s of services || []) for (const r of (Array.isArray(s?.requiredFileRequirements) ? s.requiredFileRequirements : [])) {
    if (!r?.label) continue;
    const k = String(r.label).trim().toLowerCase(); const had = out.find((d) => d.label.trim().toLowerCase() === k);
    if (had) { had.services++; if (r.persistToProfile) had.kept = true; } else out.push({ id: String(r.id || ''), label: String(r.label).trim(), kept: !!r.persistToProfile, services: 1 });
  }
  return out;
}

/** What a service asks for, in one line: its forms, its documents, inspiration photos. Empty when it asks for nothing. */
export function needsLine(service: any, forms: any[]): string {
  const ids: string[] = Array.isArray(service?.requiredFormIds) ? service.requiredFormIds.map(String) : [];
  const parts = ids.map((id) => forms.find((f) => f?.id === id)?.title).filter(Boolean) as string[];
  for (const r of (Array.isArray(service?.requiredFileRequirements) ? service.requiredFileRequirements : [])) if (r?.label) parts.push(`${r.label}${r.persistToProfile ? ', kept on file' : ''}`);
  if (asksInspirationPhotos(service)) parts.push('inspiration photos, optional');
  return parts.join(' · ');
}
/** Does the service ask for anything a client must do (a form or a document)? Inspiration photos are always optional. */
export const asksAnything = (service: any) => (Array.isArray(service?.requiredFormIds) && service.requiredFormIds.length > 0) || (Array.isArray(service?.requiredFileRequirements) && service.requiredFileRequirements.length > 0);

/** A form in a few words: questions and how long, or what's in it. */
export function formKind(form: any): string {
  const fs = fieldsOf(form); const photo = fs.some((f: any) => f?.type === 'image-upload'); const sig = hasSignature(form);
  if (wordingOnly(form)) return 'Wording to read';
  const questions = fs.some((f: any) => !['heading', 'paragraph', 'signature', 'image-upload'].includes(String(f?.type)));
  if (!questions) return sig && photo ? 'Wording, a photo and a signature' : sig ? 'Wording and a signature' : photo ? 'Wording and a photo' : 'Wording to read';
  const m = formMinutes(form);
  return `${isHealthForm(form) ? 'Health questions' : 'Questions'}${sig ? ' and a signature' : ''} · about ${m} minute${m === 1 ? '' : 's'}`;
}

/** What happens now if a service's forms aren't done: its own rule, or (before it has one) what Automations and "Before a
 *  visit" say, so saving the page keeps things as they were. */
export function ifNotDoneOf(service: any, tenant: any): { ifNot: IfNotDone; decide: Decide } {
  const r = formsRuleOf(service);
  if (r.own) return r.release !== 'off' ? { ifNot: 'release', decide: r.release === 'ask' ? 'ask' : 'auto' } : { ifNot: readinessRules(tenant, service).forms === 'block' ? 'checkin' : 'remind', decide: 'ask' };
  const auto = tenant?.appointmentAutomations?.consentFormUnsigned;
  if (auto?.enabled && auto?.severity === 'auto_cancel' && auto?.secondWindowHours != null) return { ifNot: 'release', decide: 'auto' };
  return { ifNot: readinessRules(tenant, service).forms === 'block' ? 'checkin' : 'remind', decide: 'ask' };
}
export type NeedsDraft = { formIds: string[]; files: any[]; photos: boolean; due: FormsDue; ifNot: IfNotDone; decide: Decide };
/** Only what the owner changed, so saving never moves anything they didn't touch: the forms, the documents, the photos;
 *  the service's own rule only when its timing or outcome changed; and the start gate (service.readiness.forms, the
 *  field "Before a visit" uses, as a single field) only when "check-in" or "reminder" was picked anew and differs from
 *  what applies now. "Release the time" leaves the start gate as it is. */
export function needsPatch(service: any, tenant: any, d: NeedsDraft): Record<string, any> {
  const out: Record<string, any> = {};
  const ids: string[] = Array.isArray(service?.requiredFormIds) ? service.requiredFormIds.map(String) : [];
  if (JSON.stringify(ids) !== JSON.stringify(d.formIds)) out.requiredFormIds = d.formIds;
  if (JSON.stringify(Array.isArray(service?.requiredFileRequirements) ? service.requiredFileRequirements : []) !== JSON.stringify(d.files)) out.requiredFileRequirements = d.files;
  if (asksInspirationPhotos(service) !== d.photos) out.inspirationPhotos = d.photos ? 'optional' : 'off';
  const was = ifNotDoneOf(service, tenant); const r = formsRuleOf(service);
  if (d.due !== r.due || d.ifNot !== was.ifNot || (d.ifNot === 'release' && d.decide !== was.decide)) {
    out.formsRule = { due: d.due, release: d.ifNot === 'release' ? d.decide : 'off' };
    const want = d.ifNot === 'remind' ? 'remind' : d.ifNot === 'checkin' ? 'block' : null;
    if (want && d.ifNot !== was.ifNot && want !== readinessRules(tenant, service).forms) out['readiness.forms'] = want;
  }
  return out;
}
/** Before a service has its own rule, what Automations does about an unsigned form, in words (saving a rule replaces it
 *  for that service), or null when Automations does nothing more than remind. */
export function automationNote(service: any, tenant: any): string | null {
  if (formsRuleOf(service).own) return null;
  const a = tenant?.appointmentAutomations?.consentFormUnsigned; const h = Number(a?.secondWindowHours);
  if (!a?.enabled || a?.secondWindowHours == null || !Number.isFinite(h)) return null;
  const when = h > 0 ? `${h} hour${h === 1 ? '' : 's'} before the visit` : 'when the visit starts';
  if (a.severity === 'auto_cancel') return `Right now Automations cancels the visit if a form isn’t signed ${when}. Changing the rules here replaces that for this service.`;
  if (a.severity === 'require') return `Right now Automations holds check-in if a form isn’t signed ${when}. Changing the rules here replaces that for this service.`;
  return null;
}
/** One line under the choice: what it means, in plain words. */
export function ifNotDoneHelp(ifNot: IfNotDone, decide: Decide, due: FormsDue): string {
  const when = due === 48 ? 'two days before' : 'a day before';
  if (ifNot === 'remind') return 'Forms not done show on the visit as a reminder. Nothing is held up or released.';
  if (ifNot === 'checkin') return 'Any form left is asked for first thing at check-in, and the visit starts once it’s signed. Nothing is released.';
  return decide === 'auto'
    ? `If the forms aren’t done ${when} the visit (and they’ve had at least 12 hours since booking), the time is released: the client is told, nothing is charged, any deposit waits for you to refund, and the time is offered to your waitlist. A missing document never releases the time.`
    : `If the forms aren’t done ${when} the visit, you, your managers and the provider are asked whether to release the time. Nothing changes until someone decides.`;
}

/** What a client reads before booking this service (the booking sheet says the same). */
export function clientReads(service: any, forms: any[], tenant?: any): string {
  const ids: string[] = Array.isArray(service?.requiredFormIds) ? service.requiredFormIds.map(String) : [];
  const fs = ids.map((id) => forms.find((f) => f?.id === id)).filter(Boolean);
  const docs: any[] = Array.isArray(service?.requiredFileRequirements) ? service.requiredFileRequirements : [];
  if (!fs.length && !docs.length) return asksInspirationPhotos(service) ? 'Nothing to fill in. They can add inspiration photos if they like.' : 'Nothing to fill in before this visit.';
  const words = [...fs.map((f: any) => String(f.title || 'a form')), ...docs.map((d: any) => `your ${String(d.label || 'document').replace(/^your\s+/i, '')}`)];
  const list = words.length > 1 ? `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}` : words[0];
  const mins = fs.reduce((n: number, f: any) => n + formMinutes(f), 0) + docs.length;
  const r = formsRuleOf(service); const { ifNot, decide } = ifNotDoneOf(service, tenant);
  const out = [`${list.charAt(0).toUpperCase()}${list.slice(1)}, about ${mins} minute${mins === 1 ? '' : 's'}.`];
  out.push(r.due === 'booking' && fs.length ? 'They’re needed to book.' : `They’re due ${r.due === 48 ? 'two days' : 'a day'} before your visit.`);
  if (ifNot === 'release' && fs.length) out.push(decide === 'auto' ? `If the form${fs.length === 1 ? ' isn’t' : 's aren’t'} done by then, your time is released.` : `If the form${fs.length === 1 ? ' isn’t' : 's aren’t'} done by then, your time may be released.`);
  const kept = docs.filter((d: any) => d.persistToProfile).map((d: any) => String(d.label || 'document'));
  if (kept.length) out.push(`Your ${kept.join(' and ')} ${kept.length === 1 ? 'is' : 'are'} kept on your profile, so you’re asked only once.`);
  return out.join(' ');
}
