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

import { can } from '@/lib/permissions';

export type PrivacyAudience = 'all_staff' | 'admins_only';

export interface StaffPrivacySettings {
  financials?: PrivacyAudience;        // balance owed, lifetime value, revenue figures
  clientContact?: PrivacyAudience;     // phone/email on client-facing surfaces
  careNoteContents?: PrivacyAudience;  // medical/allergy/sensory note CONTENTS (flag always visible)
  staffMessaging?: boolean;            // staff may text / email clients THROUGH THE BUSINESS even when they can't see the number (default yes)
}

export const PRIVACY_DEFAULTS: Required<StaffPrivacySettings> = {
  financials: 'admins_only',
  clientContact: 'all_staff',
  careNoteContents: 'admins_only',
  staffMessaging: true,
};

// Since roles and permissions (lib/permissions): each role says what it may see. The privacy settings below are the
// starting point for the everyday roles until a business changes them on the Roles screen.
function isPrivileged(role?: string | null, tenant?: any, cap?: any): boolean {
  if (cap) return can(tenant, role || 'staff', cap);
  return (role === 'owner' || role === 'admin' || role === 'manager');
}

function audienceFor(tenant: any, key: 'financials' | 'clientContact' | 'careNoteContents'): PrivacyAudience {
  return tenant?.staffPrivacy?.[key] || PRIVACY_DEFAULTS[key];
}

export function canSeeFinancials(tenant: any, role?: string | null): boolean {
  return isPrivileged(role, tenant, 'money.view');
}

export function canSeeClientContact(tenant: any, role?: string | null): boolean {
  return isPrivileged(role, tenant, 'clients.contact');
}

export function canSeeCareNoteContents(tenant: any, role?: string | null): boolean {
  return isPrivileged(role, tenant, 'clients.notes');
}

/** May this person text or email a client through the business? Owners and admins always; staff unless the business
 *  has switched it off. Works whether or not they can SEE the number — the server looks it up and sends. */
export function canMessageClients(tenant: any, role?: string | null): boolean {
  return isPrivileged(role, tenant, 'clients.message') || canSeeClientContact(tenant, role);
}

/** The fields that count as a client's contact details. */
export const CONTACT_FIELDS = ['phone', 'email', 'address', 'mobile', 'phoneNumber', 'secondaryPhone', 'alternatePhone'] as const;
/** A client record with contact details removed (not blanked) and marked, for people who may not see them.
 *  Removed rather than emptied so nothing can mistake "hidden" for "no number"; marked so no screen can save the
 *  gap back over the real details (see stripHiddenContact). */
export function maskClientContact<T extends Record<string, any>>(c: T): T {
  if (!c) return c; const out: any = { ...c }; const ph = phoneHint(c.phone || c.mobile || c.phoneNumber), em = emailHint(c.email);
  for (const k of CONTACT_FIELDS) delete out[k];
  if (ph) out.phoneHint = ph; if (em) out.emailHint = em;   // enough to say "is this the Mia ending 7788?" — never the number
  if (out.emergencyContact) { const e = { ...out.emergencyContact }; delete e.phone; delete e.email; out.emergencyContact = e; }
  out.contactHidden = true; return out;
}
/** Copies of contact details stored on an appointment / visit. */
export function maskAppointmentContact<T extends Record<string, any>>(a: T): T {
  if (!a) return a; const out: any = { ...a }; const ph = phoneHint(a.clientPhone || a.customerPhone || a.phone), em = emailHint(a.clientEmail || a.customerEmail || a.email);
  for (const k of ['clientPhone', 'clientEmail', 'customerPhone', 'customerEmail', 'phone', 'email']) delete out[k];
  if (ph) out.clientPhoneHint = ph; if (em) out.clientEmailHint = em; return out;
}
/** Before saving a client record that was loaded hidden: drop every contact field, so the hidden gap is never written
 *  back over the real details. */
export function stripHiddenContact<T extends Record<string, any>>(record: { contactHidden?: boolean } | null | undefined, patch: T): T {
  if (!record?.contactHidden || !patch) return patch; const out: any = { ...patch }; for (const k of CONTACT_FIELDS) delete out[k];
  delete out.contactHidden; delete out.phoneHint; delete out.emailHint; if (out.emergencyContact) { const e = { ...out.emergencyContact }; delete e.phone; delete e.email; out.emergencyContact = e; } return out;
}

/** "(•••) •••-7788" — the last four digits only. Shown to people who may not see contact details. */
export function phoneHint(phone: any): string { const d = String(phone || '').replace(/\D/g, ''); return d.length >= 7 ? `(•••) •••-${d.slice(-4)}` : ''; }
/** "m•••@gmail.com" — the first letter and the domain only. */
export function emailHint(email: any): string { const e = String(email || '').trim(); const at = e.indexOf('@'); return at > 0 ? `${e[0]}•••${e.slice(at)}` : ''; }
