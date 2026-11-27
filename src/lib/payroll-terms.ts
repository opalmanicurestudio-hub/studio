// src/lib/payroll-terms.ts — the short agreement a business makes before it runs payroll in ClarityFlow (Settings >
// Payroll, "ClarityFlow works out the taxes"): the figures are estimates from published tables, the business is the
// employer and pays and files, nothing is sent or filed for it, tables can lag, and an accountant should check. The full
// wording is section 10 of the platform terms (/legal/terms#payroll-taxes); these points are what Payday shows.
//
// Agreed once by the owner or an admin (api/payroll/forms, action 'agreeTerms'): the version and day on the business
// (payrollTax.termsAgreed, so the app knows), and who agreed, when and from where kept privately
// (tenants/{id}/private/payrollTerms). Payday can't be recorded with taxes worked out here until it's agreed
// (api/payroll/record). When these points change in a way a business must agree to again, change the version: each
// business is asked again on Payday.

import { TERMS_EFFECTIVE } from './legal';

export const PAYROLL_TERMS_VERSION = '2026-11-27';
export const PAYROLL_TERMS_HREF = '/legal/terms#payroll-taxes';

export const PAYROLL_TERMS: { title: string; text: string }[] = [
  { title: 'The figures are estimates to help you', text: 'Each person’s taxes are worked out from the IRS’s and your state’s published tables and from what you and your team enter. They aren’t tax, legal or accounting advice.' },
  { title: 'You’re the employer', text: 'Paying your team, withholding and depositing the taxes, and filing every form on time are yours to do, and so are any penalties or interest, even when you used these figures.' },
  { title: 'Nothing is sent or filed for you', text: 'ClarityFlow doesn’t pay your team, pay the taxes or file with the IRS or your state. You do that from your bank, or your accountant does.' },
  { title: 'Tables change, and updates can lag', text: 'Tax tables, wage limits and rates change each year and sometimes during it. They’re updated here as new ones are published, and Payday says when a payday is worked out with another year’s. Some local taxes and unusual cases aren’t covered.' },
  { title: 'Have an accountant check it', text: 'Especially your first payday, the first one each year, and anything unusual.' },
];

/** Agreeing to the points also accepts the platform terms as they are now (TERMS_VERSION), payroll's section and all. */
export const PAYROLL_TERMS_ALSO = `Agreeing also accepts the platform terms as updated ${TERMS_EFFECTIVE}, including the limits on liability for payroll and tax figures.`;

/** The business has agreed to the payroll points as they are now. */
export const payrollTermsOk = (tenant: any): boolean => String(tenant?.payrollTax?.termsAgreed?.version || '') === PAYROLL_TERMS_VERSION;

/** The owner or an admin: who can agree for the business (the person who signs up, and anyone they make an admin). */
export const canAgreeFor = (actor: any): boolean => !!actor?.isTenantOwner || ['owner', 'admin'].includes(String(actor?.role || '').toLowerCase());
