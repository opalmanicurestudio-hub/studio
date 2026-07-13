/**
 * privacy — v1: THE single source of truth for sensitive-data visibility.
 *
 * Every surface that shows financials, contact info, or care notes asks
 * these helpers instead of hard-coding role checks. The owner configures
 * the policy once (tenant.staffPrivacy, via the PrivacySettings card);
 * every card, list, and panel obeys it automatically.
 *
 * Rules of the model:
 * - Owner and admin ALWAYS see everything. Settings govern regular staff.
 * - Defaults are the conservative choice: financials admins-only,
 *   contact info all-staff (messaging is phone-keyed — hiding the number
 *   of a client a tech is actively texting breaks function), care-note
 *   CONTENTS admins-only (the "notes on file" flag stays visible to all,
 *   because knowing notes exist is operational, reading them is not).
 *
 * HONESTY CLAUSE (same as staff-identity.ts): this is UI-level workflow
 * privacy, not cryptographic security. The shared login + the Firestore
 * rules catch-all mean a determined staff member with devtools can read
 * raw docs. Server enforcement arrives with the rules-retirement project;
 * until then this controls what the app SHOWS, which is what matters
 * day-to-day.
 */

export type PrivacyAudience = 'all_staff' | 'admins_only';

export interface StaffPrivacySettings {
  financials?: PrivacyAudience;        // balance owed, lifetime value, revenue figures
  clientContact?: PrivacyAudience;     // phone/email on client-facing surfaces
  careNoteContents?: PrivacyAudience;  // medical/allergy/sensory note CONTENTS (flag always visible)
}

export const PRIVACY_DEFAULTS: Required<StaffPrivacySettings> = {
  financials: 'admins_only',
  clientContact: 'all_staff',
  careNoteContents: 'admins_only',
};

function isPrivileged(role?: string | null): boolean {
  return role === 'owner' || role === 'admin';
}

function audienceFor(tenant: any, key: keyof StaffPrivacySettings): PrivacyAudience {
  return tenant?.staffPrivacy?.[key] || PRIVACY_DEFAULTS[key];
}

export function canSeeFinancials(tenant: any, role?: string | null): boolean {
  return isPrivileged(role) || audienceFor(tenant, 'financials') === 'all_staff';
}

export function canSeeClientContact(tenant: any, role?: string | null): boolean {
  return isPrivileged(role) || audienceFor(tenant, 'clientContact') === 'all_staff';
}

export function canSeeCareNoteContents(tenant: any, role?: string | null): boolean {
  return isPrivileged(role) || audienceFor(tenant, 'careNoteContents') === 'all_staff';
}
