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
  /** Link-tree rows: where else to find them. Ordered. */
  links?: RenterLink[] | null;
}

export type RenterLinkKind = 'instagram' | 'tiktok' | 'facebook' | 'youtube' | 'pinterest' | 'x' | 'website' | 'booking' | 'custom';
export interface RenterLink { kind: RenterLinkKind; value: string; label?: string }

export const LINK_KINDS: { kind: RenterLinkKind; label: string; placeholder: string; base?: string }[] = [
  { kind: 'instagram', label: 'Instagram', placeholder: 'yourhandle', base: 'https://instagram.com/' },
  { kind: 'tiktok', label: 'TikTok', placeholder: 'yourhandle', base: 'https://tiktok.com/@' },
  { kind: 'facebook', label: 'Facebook', placeholder: 'yourpage', base: 'https://facebook.com/' },
  { kind: 'youtube', label: 'YouTube', placeholder: 'https://youtube.com/@…' },
  { kind: 'pinterest', label: 'Pinterest', placeholder: 'yourhandle', base: 'https://pinterest.com/' },
  { kind: 'x', label: 'X', placeholder: 'yourhandle', base: 'https://x.com/' },
  { kind: 'website', label: 'Website', placeholder: 'https://…' },
  { kind: 'custom', label: 'Other link', placeholder: 'https://…' },
];

/** A handle or a URL becomes a URL; a URL stays one. Never trusts a scheme other than https. */
export function linkHref(l: RenterLink): string {
  const v = String(l.value || '').trim().replace(/^@/, '');
  if (!v) return '';
  if (/^https?:\/\//i.test(v)) return v.replace(/^http:\/\//i, 'https://');
  const def = LINK_KINDS.find((k) => k.kind === l.kind);
  if (def?.base) return def.base + v.replace(/^.*\//, '');
  return `https://${v}`;
}

/** Clean what the renter typed: cap, dedupe by kind+value, drop empties, cap at 8. */
export function cleanLinks(raw: any): RenterLink[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: RenterLink[] = [];
  for (const r of raw) {
    const kind = String(r?.kind || '') as RenterLinkKind;
    if (!LINK_KINDS.some((k) => k.kind === kind)) continue;
    const value = String(r?.value || '').trim().slice(0, 200);
    if (!value || /\s/.test(value) || /^javascript:/i.test(value)) continue;
    const key = `${kind}|${value.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ kind, value, ...(r?.label ? { label: String(r.label).trim().slice(0, 40) } : {}) });
    if (out.length >= 8) break;
  }
  return out;
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
export function staffMirrorFields(r: RenterIdentity): Record<string, any> {
  const out: Record<string, any> = {};
  const set = (k: string, v: unknown) => { if (v !== undefined && v !== null) out[k] = String(v); };
  const name = publicName(r);
  if (name && name !== 'Provider') set('name', name);
  set('email', r.email ?? undefined);
  set('phone', r.phone ?? undefined);
  set('bio', r.bio ?? undefined);
  set('instagram', r.instagram ?? undefined);
  if (r.links !== undefined && r.links !== null) (out as any).links = cleanLinks(r.links);
  if (r.photoUrl !== undefined && r.photoUrl !== null) { out.photoUrl = String(r.photoUrl); out.avatarUrl = String(r.photoUrl); }
  return out;
}

/** Would mirroring change anything? Saves a needless write on every edit. */
export function mirrorDiffers(mirror: Record<string, any>, staff: any): boolean {
  return Object.entries(mirror).some(([k, v]) => JSON.stringify(staff?.[k] ?? '') !== JSON.stringify(v));
}
