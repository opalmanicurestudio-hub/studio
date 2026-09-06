// src/lib/compliance.ts
//
// IS THIS RENTER COVERED? — one answer, used everywhere.
//
// Liability insurance and a licence each have an expiry date on the renter
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

export const CREDENTIAL_LABEL: Record<CredentialKind, string> = { insurance: 'Liability insurance', license: 'Licence' };

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

/** Read a renter's credentials the way every surface should. */
export function credentialViews(renter: any, tenant: any, todayIso: string): CredentialView[] {
  const rules = (tenant?.bookingPageSettings?.automationRules || {}) as any;
  const ins = judgeExpiry(renter?.insuranceExpiry, renter?.insuranceDocUrl, todayIso);
  const lic = judgeExpiry(renter?.licenseExpiry, renter?.licenseDocUrl, todayIso);
  return [
    { kind: 'insurance', ...ins, expiry: renter?.insuranceExpiry || null, docUrl: renter?.insuranceDocUrl || null, carrier: renter?.insuranceCarrier || null, policyNumber: renter?.insurancePolicyNumber || null, required: rules.requireInsurance === true },
    { kind: 'license', ...lic, expiry: renter?.licenseExpiry || null, docUrl: renter?.licenseDocUrl || null, carrier: null, policyNumber: null, required: rules.requireLicense === true },
  ];
}

/** A problem is: required-and-missing, expired, or expiring. Missing-but-not-required is not a problem. */
export function isProblem(v: CredentialView): boolean {
  if (v.state === 'expired' || v.state === 'expiring') return true;
  return v.state === 'missing' && v.required;
}

export function stateLabel(v: CredentialView): string {
  switch (v.state) {
    case 'ok': return v.expiry ? `On file · to ${v.expiry}` : 'On file';
    case 'expiring': return `Expires in ${v.daysLeft} day${v.daysLeft === 1 ? '' : 's'}`;
    case 'expired': return `Expired ${Math.abs(v.daysLeft || 0)} day${Math.abs(v.daysLeft || 0) === 1 ? '' : 's'} ago`;
    default: return v.required ? 'Missing · required' : 'Not on file';
  }
}
