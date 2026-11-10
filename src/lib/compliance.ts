// src/lib/compliance.ts
//
// IS THIS RENTER COVERED? — one answer, used everywhere.
//
// Liability insurance and a license each have an expiry date on the renter
// record and, since the portal upload, a photo of the document. Three
// surfaces ask the same question — the renter's portal, the owner's desk,
// and the nightly — and each used to answer it a little differently. This
// module is the one place the question is answered.
//
// "Required" is the shop's existing onboarding setting
// (bookingPageSettings.automationRules.requireInsurance / requireLicense),
// not a new switch. If a shop never turned it on, a missing document is
// information, not a problem, and nothing nags.

export type CredentialState = 'ok' | 'expiring' | 'expired' | 'missing';
export type CredentialKind = 'insurance' | 'license';

export const EXPIRING_WITHIN_DAYS = 30;

export const CREDENTIAL_LABEL: Record<CredentialKind, string> = { insurance: 'Liability insurance', license: 'License' };

export interface CredentialView {
  kind: CredentialKind;
  state: CredentialState;
  expiry: string | null;       // YYYY-MM-DD
  docUrl: string | null;
  carrier: string | null;      // insurance only
  policyNumber: string | null; // insurance only
  daysLeft: number | null;     // negative when expired
  required: boolean;
}

const dayDiff = (a: string, b: string) => {
  const p = (v: string) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v || ''); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN; };
  const x = p(a), y = p(b);
  return isNaN(x) || isNaN(y) ? null : Math.round((x - y) / 86_400_000);
};

export function judgeExpiry(expiry: string | null | undefined, docUrl: string | null | undefined, todayIso: string): { state: CredentialState; daysLeft: number | null } {
  const exp = String(expiry || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(exp)) return { state: docUrl ? 'ok' : 'missing', daysLeft: null };
  const left = dayDiff(exp, todayIso);
  if (left === null) return { state: 'missing', daysLeft: null };
  if (left < 0) return { state: 'expired', daysLeft: left };
  if (left <= EXPIRING_WITHIN_DAYS) return { state: 'expiring', daysLeft: left };
  return { state: 'ok', daysLeft: left };
}

/** Which of the two a credential in the business's list of the renter's papers is: its own `kind` when it has one,
 *  otherwise its name ("Esthetics license", "Liability insurance"). Anything else (a permit, a certificate, a business
 *  registration, a business or driver's license, health insurance, a liability waiver, an entry marked as something
 *  else) is its own paper, null here. */
export function credentialKindOf(entry: unknown): CredentialKind | null {
  const e: any = entry && typeof entry === 'object' ? entry : { label: entry };
  if (e.kind === 'insurance' || e.kind === 'license') return e.kind;
  if (e.kind) return null;
  const s = String(e.label || '');
  if (/insurance|liability/i.test(s) && !/health|dental|vision|life|waiver|release/i.test(s)) return 'insurance';
  if (/licen[cs]e/i.test(s) && !/business|driver|vehicle|liquor|alcohol/i.test(s)) return 'license';
  return null;
}

const isDay = (v: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '').slice(0, 10));

/** Where in that list the one entry for this kind is (the first one marked or named that way), or -1. A second license
 *  on the list is a paper of its own, never folded into this one. */
export function primaryCredentialIndex(list: unknown, kind: CredentialKind): number {
  if (!Array.isArray(list)) return -1;
  const marked = list.findIndex((c: any) => c?.kind === kind);
  return marked >= 0 ? marked : list.findIndex((c: any) => !!c && !c.kind && credentialKindOf(c) === kind);
}

/** The date on file for one kind: the renter's own upload (the insurance and license fields) or that kind's entry in the
 *  business's list, whichever runs later, with that one's document. So a renewal uploaded in the portal clears an old
 *  date typed in when they were added, and the other way round. */
export function latestCredential(renter: any, kind: CredentialKind): { expiry: string | null; docUrl: string | null } {
  const flatExpiry = kind === 'insurance' ? renter?.insuranceExpiry : renter?.licenseExpiry;
  let expiry: string | null = isDay(flatExpiry) ? String(flatExpiry).slice(0, 10) : null;
  let docUrl: string | null = (kind === 'insurance' ? renter?.insuranceDocUrl : renter?.licenseDocUrl) || null;
  const i = primaryCredentialIndex(renter?.credentials, kind);
  const c: any = i >= 0 ? renter.credentials[i] : null;
  if (c) {
    const e = isDay(c.expiry) ? String(c.expiry).slice(0, 10) : null;
    if (e && (!expiry || e > expiry)) { expiry = e; docUrl = c.fileUrl || docUrl; }
    else if (!docUrl && c.fileUrl) docUrl = c.fileUrl;
  }
  return { expiry, docUrl };
}

/** The papers on the business's list that aren't the one insurance or the one license (shown and reminded on their own). */
export function otherCredentials(list: unknown): any[] {
  if (!Array.isArray(list)) return [];
  const skip = new Set([primaryCredentialIndex(list, 'insurance'), primaryCredentialIndex(list, 'license')]);
  return list.filter((c: any, i: number) => !!c?.label && !skip.has(i));
}

/** Read a renter's credentials the way every surface should. */
export function credentialViews(renter: any, tenant: any, todayIso: string): CredentialView[] {
  const rules = (tenant?.bookingPageSettings?.automationRules || {}) as any;
  const insOn = latestCredential(renter, 'insurance');
  const licOn = latestCredential(renter, 'license');
  const ins = judgeExpiry(insOn.expiry, insOn.docUrl, todayIso);
  const lic = judgeExpiry(licOn.expiry, licOn.docUrl, todayIso);
  return [
    { kind: 'insurance', ...ins, expiry: insOn.expiry, docUrl: insOn.docUrl, carrier: renter?.insuranceCarrier || null, policyNumber: renter?.insurancePolicyNumber || null, required: rules.requireInsurance === true },
    { kind: 'license', ...lic, expiry: licOn.expiry, docUrl: licOn.docUrl, carrier: null, policyNumber: null, required: rules.requireLicense === true },
  ];
}

/** When the renter uploads a renewal in their portal, that kind's one entry in the business's list moves to the new
 *  date and document too, so every list shows the same paper; nothing else on the list changes. Returns the new list,
 *  or null when there's nothing in it to change. */
export function credentialsAfterUpload(list: unknown, kind: CredentialKind, up: { expiry: string | null; fileUrl: string; number?: string }): any[] | null {
  const i = primaryCredentialIndex(list, kind);
  if (i < 0) return null;
  const next = (list as any[]).slice();
  next[i] = { ...next[i], fileUrl: up.fileUrl, fileName: null, ...(up.expiry ? { expiry: up.expiry } : {}), ...(up.number ? { number: up.number } : {}) };
  return next;
}

/** A problem is: required-and-missing, expired, or expiring. Missing-but-not-required is not a problem. */
export function isProblem(v: CredentialView): boolean {
  if (v.state === 'expired' || v.state === 'expiring') return true;
  return v.state === 'missing' && v.required;
}

/** 2027-10-01 → Oct 1, 2027 (left as it is when it isn't a date). */
function longDate(iso: string): string {
  const d = new Date(`${String(iso).slice(0, 10)}T12:00:00`);
  return isNaN(d.getTime()) ? String(iso) : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
export function stateLabel(v: CredentialView): string {
  switch (v.state) {
    case 'ok': return v.expiry ? `On file · to ${longDate(v.expiry)}` : 'On file';
    case 'expiring': return `Expires in ${v.daysLeft} day${v.daysLeft === 1 ? '' : 's'}`;
    case 'expired': return `Expired ${Math.abs(v.daysLeft || 0)} day${Math.abs(v.daysLeft || 0) === 1 ? '' : 's'} ago`;
    default: return v.required ? 'Missing · required' : 'Not on file';
  }
}
