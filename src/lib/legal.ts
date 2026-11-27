// src/lib/legal.ts — the company details the legal pages print, and the version of the platform terms a business agrees
// to at sign-up. The details come from settings on the hosting (Production), so they can be filled in or changed without
// a code change: set them in the hosting settings and redeploy (they're built into the pages). Until each is set, the
// pages keep neutral wording that stays accurate.
//
//   NEXT_PUBLIC_LEGAL_NAME     the registered company name, e.g. "ClarityFlow, Inc."
//   NEXT_PUBLIC_SUPPORT_EMAIL  the address people write to (support and privacy requests)
//   NEXT_PUBLIC_LEGAL_ADDRESS  a mailing address, on one line
//   NEXT_PUBLIC_LEGAL_PHONE    optional
//   NEXT_PUBLIC_LEGAL_STATE    the governing state, e.g. "Georgia"
//
// When the terms change in a way businesses must agree to again, change TERMS_VERSION and TERMS_EFFECTIVE together.
// The privacy policy keeps its own date. Payroll in ClarityFlow has its own short agreement too (PAYROLL_TERMS_VERSION
// in lib/payroll-terms), which a business agrees to in the app before running payroll there.

const clean = (v: string | undefined, max = 160) => String(v || '').trim().slice(0, max);

export const LEGAL = {
  platform: 'ClarityFlow',
  entity: clean(process.env.NEXT_PUBLIC_LEGAL_NAME, 120),
  email: clean(process.env.NEXT_PUBLIC_SUPPORT_EMAIL, 120) || 'opalmanicurestudio@gmail.com',
  address: clean(process.env.NEXT_PUBLIC_LEGAL_ADDRESS),
  phone: clean(process.env.NEXT_PUBLIC_LEGAL_PHONE, 40),
  state: clean(process.env.NEXT_PUBLIC_LEGAL_STATE, 40),
};

/** The platform terms a business agrees to at sign-up: matches the terms page's effective date. */
export const TERMS_VERSION = '2026-11-27';
export const TERMS_EFFECTIVE = 'November 27, 2026';
/** The latest changes, and when they take effect for a business that accepted an earlier version at sign-up (the version
 *  is kept: private/terms), giving notice before they apply (section 19), or sooner for one that agrees to them in the
 *  app (lib/payroll-terms). */
export const TERMS_CHANGES = { what: 'section 10, and the payroll parts of sections 9 and 14 through 17', existingFrom: 'December 27, 2026' };
export const PRIVACY_EFFECTIVE = 'July 27, 2026';
