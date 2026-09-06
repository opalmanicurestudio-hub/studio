// src/lib/renter-documents.ts
//
// THE PAPERWORK THAT USUALLY LIVES IN A TEXT THREAD.
//
// A booth lease gets signed once, at onboarding. Everything after it — what
// the deal actually is in plain words, what condition the space was in on day
// one, a written warning, a renewal — is the paperwork that ends up as a
// screenshot of a text, if it exists at all. This module gives each of those
// a template, fills it from the lease itself (so the numbers cannot be typed
// wrong), and produces one immutable snapshot the renter reads and signs in
// the portal. The signature lands in the same signedDocuments collection the
// lease did, so a renter's file is one file.
//
// RULES OF THE ROAD
//   • Templates are starting points, not legal advice. The owner edits the
//     text before sending; what they send is what gets signed.
//   • Rendered once. A document's body is frozen at send. Editing the
//     template later changes nothing already sent — that is the point.
//   • Variables come from data, never retyped: rent, dates, deposit, space.
//   • A renewal's new terms ride the document as structured meta; the lease
//     changes only when the renter SIGNS, because the signature is the
//     agreement. Nothing changes a lease on send.

import { fillTemplate } from './esign';

export type RenterDocKind = 'agreement_summary' | 'move_in_checklist' | 'violation_notice' | 'renewal_offer';
export type RenterDocStatus = 'sent' | 'signed' | 'declined' | 'withdrawn';

export interface RenterDocTemplate {
  kind: RenterDocKind;
  title: string;
  /** What the owner sees when picking it. */
  blurb: string;
  /** Signature (typed name) vs a plain acknowledgment — same mechanics, different words. */
  action: 'sign' | 'acknowledge';
  body: string;
}

export const RENTER_DOC_TEMPLATES: Record<RenterDocKind, RenterDocTemplate> = {
  agreement_summary: {
    kind: 'agreement_summary',
    title: 'Your Agreement, In Plain Words',
    blurb: 'One page: the space, the rent, when it is due, the deposit, the dates. Filled in from the lease so nothing is retyped.',
    action: 'acknowledge',
    body:
`This is a plain-language summary of the agreement between {{studioName}} and {{renterName}}. The signed lease is the agreement; this page exists so both of us can find the essentials without reading it end to end.

THE SPACE
{{boothName}}{{scheduleLine}}

RENT
{{rentAmount}} per {{rentPeriod}}, due {{dueLine}}.
{{lateFeeLine}}

DEPOSIT
{{depositLine}}

DATES
Started {{startDate}}. {{endLine}}

WHAT IS INCLUDED
{{amenitiesLine}}

TIME AWAY
If you need leave — parental, medical, family — ask from your portal. Rent is handled the way the studio's leave policy says, only once the studio has approved it.

IF SOMETHING BREAKS
Report it from your portal. The studio's response-time promise is shown there before you report.

IF SOMETHING IS WRONG
Raise a concern from your portal. You will get a reference number and a receipt, and every reply is on the record.

Nothing on this page changes the lease. Where they differ, the lease governs.`,
  },

  move_in_checklist: {
    kind: 'move_in_checklist',
    title: 'Move-In Condition Report',
    blurb: 'What the space looked like on day one, agreed by both sides. This is what a fair deposit decision is made against at move-out.',
    action: 'sign',
    body:
`Condition of {{boothName}} at the start of {{renterName}}'s rental with {{studioName}}, as of {{startDate}}.

Both of us are recording what the space looked like on day one, so that at move-out we compare against a shared record instead of two memories.

WALLS, FLOOR, LIGHTING
{{conditionWalls}}

FURNITURE AND FIXTURES
{{conditionFurniture}}

EQUIPMENT PROVIDED BY THE STUDIO
{{conditionEquipment}}

PLUMBING, POWER, VENTILATION
{{conditionServices}}

KEYS, ACCESS, STORAGE
{{conditionAccess}}

ANYTHING ALREADY DAMAGED OR WORN
{{preExisting}}

By signing, the Renter confirms this is an accurate description of the space as received, and that anything not listed under "already damaged or worn" was in good condition. Normal wear from ordinary use is expected and is not damage.`,
  },

  violation_notice: {
    kind: 'violation_notice',
    title: 'Notice of Policy Violation',
    blurb: 'A written warning, on the record, with what happened, which rule it broke, and what needs to change by when.',
    action: 'acknowledge',
    body:
`To {{renterName}}, from {{studioName}}. Date of this notice: {{date}}.

WHAT HAPPENED
{{incidentDescription}}

WHEN
{{incidentDate}}

WHICH POLICY
{{policyReference}}

WHAT NEEDS TO CHANGE
{{expectedChange}}

BY WHEN
{{deadline}}

{{consequenceLine}}

Acknowledging this notice means you have received and read it. It does not mean you agree with it. If you believe this notice is wrong, raise a concern from your portal and it will be considered on the record.`,
  },

  renewal_offer: {
    kind: 'renewal_offer',
    title: 'Lease Renewal Offer',
    blurb: 'New term and rent, for signature. The lease changes only when the renter signs — the signature is the agreement.',
    action: 'sign',
    body:
`{{studioName}} offers {{renterName}} a renewal of the rental of {{boothName}}.

CURRENT TERMS
{{rentAmount}} per {{rentPeriod}}{{currentEndLine}}

RENEWAL TERMS
New rent: {{newRentAmount}} per {{rentPeriod}}, from {{renewalStart}}.
New end date: {{newEndDate}}.
{{renewalNotes}}

Everything else in the current lease continues unchanged. Signing this offer accepts the renewal terms above; they take effect on {{renewalStart}}. This offer can be withdrawn by the studio at any time before it is signed.`,
  },
};

export interface RenterDocumentRecord {
  id: string;
  renterId: string;
  renterName: string;
  leaseId: string | null;
  kind: RenterDocKind;
  title: string;
  /** The exact text shown to the renter. Frozen at send. */
  body: string;
  action: 'sign' | 'acknowledge';
  status: RenterDocStatus;
  sentAt: string;
  sentBy: string;
  signedAt?: string | null;
  signedName?: string | null;
  signedDocumentId?: string | null;
  declinedAt?: string | null;
  declineNote?: string | null;
  /** Structured terms for documents that DO something on signature. */
  meta?: Record<string, any>;
}

const money = (c: number) => `$${(Math.round(c) / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
const period = (f: string) => ({ daily: 'day', weekly: 'week', biweekly: 'two weeks', monthly: 'month' } as Record<string, string>)[f] || 'month';
const ordinal = (n: number) => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
const dayName = (d: number) => ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d] || '';

/**
 * Every variable a template can use, from the data the app already holds.
 * Free-text fields (conditions, incident details, renewal notes) are left
 * for the owner to fill; everything with a number behind it is filled here.
 */
export function renterDocVars(ctx: { tenant: any; renter: any; lease: any; booth: any; today?: string }): Record<string, string> {
  const { tenant, renter, lease, booth } = ctx;
  const today = ctx.today || new Date().toISOString().slice(0, 10);
  const freq = String(lease?.frequency || 'monthly');
  const rent = Number(lease?.rentAmountCents) || 0;
  const dueDay = Number(lease?.dueDay) || 1;
  const dueLine = freq === 'monthly' ? `on the ${ordinal(dueDay)} of each month`
    : freq === 'weekly' || freq === 'biweekly' ? `each ${dayName(dueDay) || 'week'}` : 'each day';
  const lf = lease?.lateFeePolicy;
  const lateFeeLine = lf?.enabled
    ? `Late after ${Number(lf.graceDays) || 0} day${Number(lf.graceDays) === 1 ? '' : 's'}: ${lf.type === 'percent' ? `${Number(lf.percent) || 0}% of the amount due` : money(Number(lf.amountCents) || 0)}${lf.maxFeeCents ? `, capped at ${money(Number(lf.maxFeeCents))}` : ''}.`
    : 'No late fee is charged.';
  const dep = lease?.deposit;
  const depositLine = dep && Number(dep.amountCents) > 0
    ? `${money(Number(dep.amountCents))} held${dep.refundable === false ? ', non-refundable' : ', refundable at move-out less any documented deductions'}.${dep.refundConditions ? ` ${String(dep.refundConditions).trim()}` : ''}`
    : 'No deposit is held.';
  const slot = lease?.scheduleSlot;
  const scheduleLine = slot && Array.isArray(slot.days) && slot.days.length > 0
    ? ` — ${slot.days.map((d: number) => dayName(d).slice(0, 3)).join(', ')}${slot.startTime ? ` ${slot.startTime}–${slot.endTime || 'close'}` : ''}`
    : '';
  const am = Array.isArray(lease?.includedAmenities) ? lease.includedAmenities.filter(Boolean) : [];
  return {
    date: today,
    studioName: String(tenant?.name || tenant?.businessName || 'The studio'),
    renterName: `${renter?.firstName || ''} ${renter?.lastName || ''}`.trim() || 'Renter',
    boothName: String(booth?.name || lease?.boothName || 'the space'),
    scheduleLine,
    rentAmount: money(rent),
    rentPeriod: period(freq),
    dueLine,
    lateFeeLine,
    depositLine,
    startDate: String(lease?.startDate || ''),
    endLine: lease?.endDate ? `Runs to ${lease.endDate}.` : 'Open-ended — continues until either side gives notice.',
    currentEndLine: lease?.endDate ? `, ending ${lease.endDate}.` : ', open-ended.',
    amenitiesLine: am.length ? am.join(', ') : 'As listed in the lease.',
  };
}

/** Fields the owner fills by hand for a given kind — shown as inputs before send. */
export const RENTER_DOC_FIELDS: Record<RenterDocKind, { key: string; label: string; placeholder: string; multiline?: boolean; type?: 'text' | 'date' | 'money' }[]> = {
  agreement_summary: [],
  move_in_checklist: [
    { key: 'conditionWalls', label: 'Walls, floor, lighting', placeholder: 'Clean, no marks. One scuff on the left wall by the mirror.', multiline: true },
    { key: 'conditionFurniture', label: 'Furniture and fixtures', placeholder: 'Chair, mirror, two shelves — good condition.', multiline: true },
    { key: 'conditionEquipment', label: 'Equipment provided', placeholder: 'Dryer, UV lamp — working.', multiline: true },
    { key: 'conditionServices', label: 'Plumbing, power, ventilation', placeholder: 'Sink drains, outlets work, vent on.', multiline: true },
    { key: 'conditionAccess', label: 'Keys, access, storage', placeholder: 'One key, one drawer with lock.', multiline: true },
    { key: 'preExisting', label: 'Already damaged or worn', placeholder: 'Small chip on the counter edge, right side.', multiline: true },
  ],
  violation_notice: [
    { key: 'incidentDescription', label: 'What happened', placeholder: 'Space left with product open and tools unsanitised at close.', multiline: true },
    { key: 'incidentDate', label: 'When', placeholder: '', type: 'date' },
    { key: 'policyReference', label: 'Which policy', placeholder: 'House rules — sanitation at close of day.' },
    { key: 'expectedChange', label: 'What needs to change', placeholder: 'Station sanitised and product sealed before leaving.', multiline: true },
    { key: 'deadline', label: 'By when', placeholder: '', type: 'date' },
    { key: 'consequenceLine', label: 'If it continues (optional)', placeholder: 'A further notice may lead to termination under clause 7 of the lease.', multiline: true },
  ],
  renewal_offer: [
    { key: 'newRentAmount', label: 'New rent', placeholder: '850.00', type: 'money' },
    { key: 'renewalStart', label: 'New terms start', placeholder: '', type: 'date' },
    { key: 'newEndDate', label: 'New end date', placeholder: '', type: 'date' },
    { key: 'renewalNotes', label: 'Notes (optional)', placeholder: 'Includes the new back-room storage.', multiline: true },
  ],
};

const OPTIONAL_KEYS = ['consequenceLine', 'renewalNotes', 'scheduleLine'];

/** Render a kind with data + the owner's hand-filled fields into the frozen body. */
export function renderRenterDoc(kind: RenterDocKind, vars: Record<string, string>, fields: Record<string, string>): { title: string; body: string } {
  const t = RENTER_DOC_TEMPLATES[kind];
  const all: Record<string, string> = { ...vars };
  for (const [k, v] of Object.entries(fields || {})) {
    const s = String(v ?? '').trim();
    if (kind === 'renewal_offer' && k === 'newRentAmount') { all[k] = s ? money(Math.round(Number(s) * 100)) : ''; continue; }
    if (k === 'consequenceLine' || k === 'renewalNotes') { all[k] = s; continue; }
    all[k] = s;
  }
  // Optional lines disappear when empty rather than leaving a [placeholder]
  // for the blank-guard to trip on.
  let tpl = t.body;
  for (const opt of OPTIONAL_KEYS) if (!all[opt]) tpl = tpl.replace(new RegExp(`\\{\\{\\s*${opt}\\s*\\}\\}\\n?`, 'g'), '');
  return { title: t.title, body: fillTemplate(tpl, all).replace(/\n{3,}/g, '\n\n').trim() };
}

/** Anything still unfilled shows as [name] — refuse to send with one of those in it. */
export function unfilledPlaceholders(body: string): string[] {
  return [...new Set((body.match(/\[(\w+)\]/g) || []).map((m) => m.slice(1, -1)))];
}

/** What a renewal changes on the lease, taken from its meta — applied ONLY at signature. */
export function renewalLeasePatch(meta: Record<string, any> | undefined): { rentAmountCents?: number; endDate?: string; renewalEffective?: string } | null {
  if (!meta) return null;
  const patch: { rentAmountCents?: number; endDate?: string; renewalEffective?: string } = {};
  const cents = Number(meta.newRentCents);
  if (Number.isFinite(cents) && cents > 0) patch.rentAmountCents = Math.round(cents);
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(meta.newEndDate || ''))) patch.endDate = String(meta.newEndDate);
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(meta.renewalStart || ''))) patch.renewalEffective = String(meta.renewalStart);
  return Object.keys(patch).length ? patch : null;
}
