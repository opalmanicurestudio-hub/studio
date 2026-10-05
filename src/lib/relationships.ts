// src/lib/relationships.ts — WHO IS CONNECTED TO WHOM, AND WHAT THEY MAY DO FOR EACH OTHER.
// One record per link (tenants/{t}/clientRelationships/{id}): `fromId` is <kind> of `toId` — "Ana is GUARDIAN of Mia".
// The reverse reads automatically ("Mia is a DEPENDENT of Ana"). Each link carries permissions that say what `fromId`
// may do for `toId`; defaults follow the kind and can be changed, and a link can start and end on dates.
// Boundaries that never move, whatever the permissions say: an organiser sees a guest's logistics and readiness, never
// their private forms, photos, money or notes; nobody sees another person's health or sensitive records through a link.
export type RelKind = 'guardian' | 'household' | 'books_for' | 'pays_for' | 'organizer' | 'representative' | 'referred' | 'employer' | 'partner';
export type RelPermission = 'book' | 'change' | 'pay' | 'forms' | 'reminders' | 'readiness' | 'prices' | 'details' | 'speak';
export const PERMISSIONS: { key: RelPermission; label: string }[] = [
  { key: 'book', label: 'Book for them' }, { key: 'change', label: 'Change or cancel' }, { key: 'pay', label: 'Pay' }, { key: 'forms', label: 'Sign their forms' },
  { key: 'reminders', label: 'Get their reminders' }, { key: 'readiness', label: 'See if they’re ready' }, { key: 'prices', label: 'See prices' },
  { key: 'details', label: 'See service details' }, { key: 'speak', label: 'Speak for them' },
];
export const KINDS: Record<RelKind, { label: string; reverse: string; defaults: RelPermission[]; hint: string }> = {
  guardian:       { label: 'Guardian of', reverse: 'Dependent of', defaults: ['book', 'change', 'pay', 'forms', 'reminders', 'readiness', 'prices', 'details', 'speak'], hint: 'A parent or legal guardian of a child or someone in their care.' },
  household:      { label: 'Same household as', reverse: 'Same household as', defaults: ['reminders'], hint: 'Lives with them — family, partner, housemate.' },
  partner:        { label: 'Partner of', reverse: 'Partner of', defaults: ['book', 'change', 'reminders'], hint: 'A partner or spouse who books for them.' },
  books_for:      { label: 'Books for', reverse: 'Booked by', defaults: ['book', 'change', 'reminders'], hint: 'Arranges their appointments (an assistant, a relative).' },
  pays_for:       { label: 'Pays for', reverse: 'Paid for by', defaults: ['pay', 'prices'], hint: 'Pays their bills — a gift, an employer, a parent.' },
  organizer:      { label: 'Organises for', reverse: 'Guest of', defaults: ['book', 'readiness', 'reminders'], hint: 'Booked them as part of a group (a bridal party, a celebration).' },
  representative: { label: 'Speaks for', reverse: 'Represented by', defaults: ['book', 'change', 'speak', 'reminders'], hint: 'Has authority to act for them (a carer, a power of attorney).' },
  referred:       { label: 'Referred', reverse: 'Referred by', defaults: [], hint: 'Introduced them to the business.' },
  employer:       { label: 'Employer of', reverse: 'Employee of', defaults: ['pay'], hint: 'A company that books or pays for its people.' },
};
export type Relationship = { id: string; fromId: string; toId: string; kind: RelKind; permissions: RelPermission[]; startsAt?: string | null; endsAt?: string | null; note?: string | null; createdAt?: string; createdBy?: string | null; endedAt?: string | null };

/** Is the link in force today (started, not ended, not past its end date)? */
export function isActive(r: Relationship, now = new Date()): boolean {
  if (r.endedAt) return false; if (r.startsAt && new Date(r.startsAt) > now) return false; if (r.endsAt && new Date(r.endsAt) < now) return false; return true;
}
/** The link as seen from one person: "Guardian of Mia" from Ana's side, "Dependent of Ana" from Mia's. */
export function asSeenBy(r: Relationship, personId: string): { otherId: string; words: string; mayDoForOther: RelPermission[]; otherMayDoForMe: RelPermission[] } {
  const k = KINDS[r.kind] || KINDS.household; const forward = r.fromId === personId;
  return { otherId: forward ? r.toId : r.fromId, words: forward ? k.label : k.reverse, mayDoForOther: forward ? r.permissions : [], otherMayDoForMe: forward ? [] : r.permissions };
}
/** May `actorId` do `perm` for `forId`, through any active link? (Used by the portal and the receptionist later.) */
export function may(rels: Relationship[], actorId: string, forId: string, perm: RelPermission, now = new Date()): boolean {
  if (actorId === forId) return true;
  return rels.some((r) => isActive(r, now) && r.fromId === actorId && r.toId === forId && r.permissions.includes(perm));
}
