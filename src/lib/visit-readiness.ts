// src/lib/visit-readiness.ts — IS THIS VISIT READY TO START? One answer for every screen (cards, the visit, the side panel,
// Now, the staff portal, the desk).
//
// Six things can matter: confirmed, deposit, forms, a photo, a card on file, before-visit questions. For each, the
// business chooses (Settings → Before a visit) whether it MUST be done to start ('block'), shows as a REMINDER only
// ('remind'), or is OFF; a service can override any of them (service.readiness) — e.g. a photo required only for a
// colour correction. An item only appears when it applies to this visit (no deposit asked → no deposit line).
import { pendingFormIds, type RequestItem } from './visit-requests';
import { checkOf } from './prep-check';

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

export type ReadyItem = { key: ReadyKey; label: string; rule: ReadyRule; state: 'done' | 'waiting' | 'missing'; detail: string; request?: RequestItem };
const day = (iso?: string) => { const t = Date.parse(String(iso || '')); if (!t) return ''; const d = new Date(t); const today = new Date(); const y = new Date(Date.now() - 864e5);
  if (d.toDateString() === today.toDateString()) return 'today'; if (d.toDateString() === y.toDateString()) return 'yesterday'; return d.toLocaleDateString('en-US', { weekday: 'short' }); };
const PAID = ['paid', 'waived', 'credited'];

/** The checklist for one visit, in a fixed order, only the items that apply; plus what blocks starting and what to ask for. */
export function readinessOf(apt: any, service: any, client?: any, tenant?: any, forms?: any[]) {
  const rules = readinessRules(tenant, service); const items: ReadyItem[] = [];
  if (!apt) return { items, blocker: null as string | null, missing: [] as RequestItem[], done: 0 };
  const asked = apt.lastRequirementsRequestedAt ? `sent ${day(apt.lastRequirementsRequestedAt)}${apt.completionLinkFirstViewedAt ? ' · opened' : ' · not opened yet'}` : 'not asked yet';
  const requested: string[] = Array.isArray(apt.requestedItems) ? apt.requestedItems : [];
  const add = (key: ReadyKey, applies: boolean, done: boolean, doneText: string, request?: RequestItem) => {
    const rule = rules[key]; if (rule === 'off' || !applies) return;
    // Asked for: in the last request (requestedItems); older requests didn't record items, so any request counts for forms.
    const wasAsked = !!apt.lastRequirementsRequestedAt && !!request && (requested.includes(request) || (!requested.length && request === 'forms'));
    items.push({ key, label: key === 'deposit' && apt.depositAmountCents ? `Deposit $${(Number(apt.depositAmountCents) / 100).toFixed(0)}` : READY_LABEL[key], rule, state: done ? 'done' : wasAsked ? 'waiting' : 'missing', detail: done ? doneText : wasAsked ? asked : 'not asked yet', request });
  };
  add('confirmed', true, !!apt.clientConfirmedAt || ['checked_in'].includes(String(apt.status)) || apt.checkInStatus === 'arrived', apt.clientConfirmedAt ? `${apt.clientConfirmedVia === 'sms' ? 'by text' : 'yes'}, ${day(apt.clientConfirmedAt)}` : 'they’re here', 'confirm');
  add('deposit', Number(apt.depositAmountCents || 0) > 0, PAID.includes(String(apt.depositStatus || '')), apt.depositStatus === 'paid' ? `paid${apt.depositPaidAt ? ` ${day(apt.depositPaidAt)}` : ''}` : String(apt.depositStatus || ''), 'deposit');
  const needForms = [...new Set([...((service?.requiredFormIds || []) as string[]), ...((apt.requiredFormIds || []) as string[])])];
  const pending = pendingFormIds(apt, service, client, forms);
  add('forms', needForms.length > 0, pending.length === 0, needForms.length === 1 ? 'signed' : `all ${needForms.length} signed`, 'forms');
  const photoAsked = !!service?.requiresPhoto || requested.includes('photo_current') || requested.includes('inspo') || rules.photo === 'block';
  const hasPhoto = (apt.requirementFiles || []).some((f: any) => (f?.files || f?.urls || []).length || f?.url) || !!apt.inspirationPhotoUrl || !!(apt.prep?.answers && JSON.stringify(apt.prep.answers).includes('http'));
  add('photo', photoAsked, hasPhoto, 'added', 'photo_current');
  const cardAsked = !!service?.requiresCard || !!apt.readinessFlags?.cardRequired || rules.card === 'block';
  const c = client?.cardOnFile; const hasCard = !!apt.cardOnFileSecured || !!(c && (c.paymentMethodId || (c.token && !String(c.token).startsWith('tok_fake'))));
  add('card', cardAsked, hasCard, c?.last4 ? `ending ${c.last4}` : 'saved', 'card');
  add('questions', !!checkOf(service) || !!apt.prepSentAt, !!apt.prep?.answeredAt, `answered ${day(apt.prep?.answeredAt)}`, 'questions');
  const block = items.find((i) => i.rule === 'block' && i.state !== 'done');
  const blockerText: Record<ReadyKey, string> = { confirmed: 'Not confirmed', deposit: 'Deposit not paid', forms: 'Form not signed', photo: 'No photo yet', card: 'No card on file', questions: 'Questions not answered' };
  return { items, blocker: block ? blockerText[block.key] : null, missing: items.filter((i) => i.state !== 'done' && i.request).map((i) => i.request!) as RequestItem[], done: items.filter((i) => i.state === 'done').length };
}
