// src/lib/payroll-terms.ts — the short agreement a business makes before it runs payroll in ClarityFlow (Settings >
// Payroll, "ClarityFlow works out the taxes"; design board "Payroll trust wording", A: who does what). What ClarityFlow
// handles (the math from the official tables, each year's checked line by line against the agencies' own guides, and
// the forms and checks to print; it never sends money or files), what the business handles as the employer (sending the
// money, filing, W-4s, any local tax Payday doesn't show, a look from its accountant), and one plain line: the figures
// aren't advice and are only as right as the tables and what's entered, new tables can arrive late, and filing on time,
// penalties and interest stay with the employer even when they come from figures worked out here. The full wording is section 10 of the platform terms (/legal/terms#payroll-taxes), with the
// limits on liability in sections 15 to 17; this is what Payday shows.
//
// Agreed once by the owner or an admin (api/payroll/forms, action 'agreeTerms'): the version and day on the business
// (payrollTax.termsAgreed, so the app knows), and who agreed, when and from where kept privately
// (tenants/{id}/private/payrollTerms). Payday can't be recorded with taxes worked out here until it's agreed
// (api/payroll/record). When these points change in a way a business must agree to again, change the version: each
// business is asked again on Payday.

import { TERMS_EFFECTIVE } from './legal';

export const PAYROLL_TERMS_VERSION = '2026-11-27b';
export const PAYROLL_TERMS_HREF = '/legal/terms#payroll-taxes';

export type PayrollTerms = { intro: string; noTax: string | null; handles: string[]; yours: string[]; fine: string };

/** What the business agrees to, for its state (`state`: its name, or '' when it isn't set; `noWageTax`: a state with no
 *  income tax on wages). */
export function payrollTerms(state = '', noWageTax = false): PayrollTerms {
  const tables = !state ? 'the IRS’s and your state’s' : noWageTax ? 'the IRS’s' : `the IRS’s and ${state}’s`;
  return {
    intro: `ClarityFlow does the math from ${tables} official tables, and never sends money or files anything. You stay the employer, so the payments and filings go out in your name.`,
    noTax: state && noWageTax ? `${state} has no state income tax, so there’s nothing to withhold for the state. Its unemployment tax is worked out all the same.` : null,
    handles: [
      'Each paycheck: pay, tips, withholding and take-home',
      'Year-to-date totals for every person',
      'What to deposit, and the day it’s due',
      'Quarterly and year-end forms, worked out line by line for you to look over',
      'Checks and pay stubs to print',
      'Each year’s tables, checked line by line against the IRS’s and the states’ own guides',
    ],
    yours: [
      'Sending pay and tax deposits from your bank',
      'Filing the forms, or handing them to your accountant',
      'Keeping each person’s W-4 up to date',
      'Any city or county payroll tax Payday doesn’t show',
      'A look from your accountant at your first payday and anything unusual, as with any new payroll',
    ],
    fine: 'The figures aren’t tax, legal or accounting advice, and they’re only as right as the tables and what’s entered. New tables can arrive after a change takes effect, and Payday says when it’s using another year’s. As the employer, filing on time and any penalties or interest stay with you, even when they come from figures worked out here.',
  };
}
/** The agreement as most businesses see it (no state named). */
export const PAYROLL_TERMS = payrollTerms();

/** Agreeing to the points also accepts the platform terms as they are now (TERMS_VERSION), payroll's section and all. */
export const PAYROLL_TERMS_ALSO = `Agreeing also accepts them as updated ${TERMS_EFFECTIVE}, including the limits on liability for payroll and tax figures.`;

/** The business has agreed to the payroll points as they are now. */
export const payrollTermsOk = (tenant: any): boolean => String(tenant?.payrollTax?.termsAgreed?.version || '') === PAYROLL_TERMS_VERSION;

/** The owner or an admin: who can agree for the business (the person who signs up, and anyone they make an admin). */
export const canAgreeFor = (actor: any): boolean => !!actor?.isTenantOwner || ['owner', 'admin'].includes(String(actor?.role || '').toLowerCase());
