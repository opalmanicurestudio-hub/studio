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
// The privacy policy keeps its own date.

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
export const TERMS_VERSION = '2026-07-27';
export const TERMS_EFFECTIVE = 'July 27, 2026';
export const PRIVACY_EFFECTIVE = 'July 27, 2026';
