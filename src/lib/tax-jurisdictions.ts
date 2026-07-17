// src/lib/tax-jurisdictions.ts
//
// Jurisdiction layer above the tax data — built for international expansion.
//
// A tenant's tax location is (country, region): { 'US', 'NC' } today,
// { 'CA', 'ON' } or { 'GB' } tomorrow. Every consumer goes through
// getJurisdictionProfile() and never touches country-specific data files
// directly, so adding a country later is data entry plus a provider
// function — not a rebuild.
//
// What adding a country involves (roadmap notes):
//   • Canada  — federal + provincial rates, CPP/EI employer costs, GST/HST
//               instead of sales tax; payroll engine: Wagepoint/Wave
//               (Gusto is US-only).
//   • UK      — income tax bands + NI employer contributions, VAT;
//               payroll must be RTI-compliant (e.g. PayFit, Moneysoft).
//   • AU      — income tax + superannuation guarantee, GST; payroll must
//               be STP-compliant (e.g. Xero Payroll).
//   Currency lives here too — reports should format with the tenant's
//   currency, not hardcoded USD.

import {
  getStateProfile, GENERIC_US_PROFILE, STATE_OPTIONS,
  type StateTaxProfile,
} from './state-tax-profiles';

export type CountryCode = 'US' | 'CA' | 'GB' | 'AU';

export type CountryOption = {
  code: CountryCode;
  name: string;
  currency: string;        // ISO 4217
  regionLabel: string;     // what a "region" is called there
  enabled: boolean;        // false = structured, data not yet populated
};

export const COUNTRY_OPTIONS: CountryOption[] = [
  { code: 'US', name: 'United States',  currency: 'USD', regionLabel: 'State',    enabled: true },
  { code: 'CA', name: 'Canada',         currency: 'CAD', regionLabel: 'Province', enabled: false },
  { code: 'GB', name: 'United Kingdom', currency: 'GBP', regionLabel: 'Region',   enabled: false },
  { code: 'AU', name: 'Australia',      currency: 'AUD', regionLabel: 'State',    enabled: false },
];

export type Jurisdiction = { country: CountryCode; region?: string | null };

/** The common shape every country's provider must return. US is backed by
 *  state-tax-profiles; other countries plug in here later. */
export type JurisdictionProfile = StateTaxProfile & {
  country: CountryCode;
  currency: string;
};

export const getCountryOption = (code?: string | null): CountryOption =>
  COUNTRY_OPTIONS.find(c => c.code === (code || 'US').toUpperCase()) || COUNTRY_OPTIONS[0];

/** Resolve a tenant's (country, region) to a tax profile.
 *  - US + region set  → that state's profile
 *  - US + no region   → federal-only generic (UI must prompt for state)
 *  - other countries  → null until their data is populated (UI shows
 *    "not yet supported" and uses no numbers rather than wrong ones) */
export function getJurisdictionProfile(j: Jurisdiction): JurisdictionProfile | null {
  const country = getCountryOption(j.country);
  if (country.code === 'US') {
    const base = j.region ? getStateProfile(j.region) : GENERIC_US_PROFILE;
    return { ...base, country: 'US', currency: country.currency };
  }
  return null; // structured, not yet populated
}

/** Region choices for a country ('US' → the 50 states + DC). */
export function regionOptionsFor(country: CountryCode) {
  if (country === 'US') return STATE_OPTIONS;
  return [];
}

/** Currency formatter honoring the tenant's jurisdiction. */
export const formatMoney = (n: number, currency = 'USD') =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency, minimumFractionDigits: 2 }).format(n);
