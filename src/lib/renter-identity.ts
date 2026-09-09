// src/lib/renter-identity.ts
//
// ONE PERSON, TWO RECORDS.
//
// A bookable renter exists twice: a renter doc (the tenancy — who they are to
// you) and a staff doc (the provider — what the booking engine needs). That
// split is a storage decision, not a truth about the person, and until now
// nothing kept the two in step. Change a renter's name on the renter card and
// the booking page kept showing the old one, because the public page reads the
// STAFF copy. Same for their photo.
//
// So: the renter doc is the source, the staff doc is the mirror. Every write
// to a renter's identity — from your card or from their portal — goes through
// here, and there is exactly one description of what "the same" means.
//
// THE PUBLIC NAME. A booth renter is an independent business, so when they
// have given a business name, that is what clients see; otherwise it is their
// own name. No new setting, no choice to remember: the field they filled in
// decides, and clearing it puts their name back.

export interface RenterIdentity {
  firstName?: string | null;
  lastName?: string | null;
  businessName?: string | null;
  email?: string | null;
  phone?: string | null;
  photoUrl?: string | null;
  bio?: string | null;
  instagram?: string | null;
}

/** Their own name, as a person. */
export function personName(r: RenterIdentity): string {
  return `${r.firstName || ''} ${r.lastName || ''}`.trim();
}

/** What a client sees: the business if they named one, otherwise the person. */
export function publicName(r: RenterIdentity): string {
  const biz = String(r.businessName || '').trim();
  return biz || personName(r) || 'Provider';
}

/**
 * The fields the provider record copies from the renter record.
 *
 * Only ever a subset: role, pay, schedule, services and everything else on the
 * staff doc belong to the booking engine and must not be touched by an
 * identity edit. `avatarUrl` and `photoUrl` are both written because the
 * booking page reads one and the portal the other — writing a single field
 * meant a renter's face saved and never appeared.
 *
 * Undefined values are dropped so a partial edit cannot blank a field the
 * renter set from their own portal.
 */
export function staffMirrorFields(r: RenterIdentity): Record<string, string> {
  const out: Record<string, string> = {};
  const set = (k: string, v: unknown) => { if (v !== undefined && v !== null) out[k] = String(v); };
  const name = publicName(r);
  if (name && name !== 'Provider') set('name', name);
  set('email', r.email ?? undefined);
  set('phone', r.phone ?? undefined);
  set('bio', r.bio ?? undefined);
  set('instagram', r.instagram ?? undefined);
  if (r.photoUrl !== undefined && r.photoUrl !== null) { out.photoUrl = String(r.photoUrl); out.avatarUrl = String(r.photoUrl); }
  return out;
}

/** Would mirroring change anything? Saves a needless write on every edit. */
export function mirrorDiffers(mirror: Record<string, string>, staff: any): boolean {
  return Object.entries(mirror).some(([k, v]) => String(staff?.[k] ?? '') !== v);
}
