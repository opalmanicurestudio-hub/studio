// src/lib/licenses.ts — LICENSES A SHOP REUSES ACROSS ITS DOWNLOADS (pure).
// A license says what a buyer may do with what they bought. Three are ready to use (personal, professional, commercial);
// a shop can change their words or add its own, saved once on the shop (tenant.digitalLicenses) and picked on each
// product. The words are built from plain choices (use with clients, sell what you make with it, change it, how many
// people may use it), so every license reads the same way, plus a note the shop writes.
// At sale the license's words are copied onto the buyer's access record (lib/entitlements): a later change never
// changes what someone already bought.

export type LicenseUses = { clients: boolean; commercial: boolean; modify: boolean; resale: boolean; seats: number };
export type LicensePolicy = { id: string; name: string; uses: LicenseUses; note: string; builtIn?: boolean };
export type LicenseCopy = { id: string; name: string; terms: string };

export const BUILT_IN_LICENSES: LicensePolicy[] = [
  { id: 'personal', name: 'Personal use', builtIn: true, uses: { clients: false, commercial: false, modify: true, resale: false, seats: 1 }, note: '' },
  { id: 'professional', name: 'Professional use', builtIn: true, uses: { clients: true, commercial: false, modify: true, resale: false, seats: 1 }, note: '' },
  { id: 'commercial', name: 'Commercial use', builtIn: true, uses: { clients: true, commercial: true, modify: true, resale: false, seats: 1 }, note: '' },
];

/** The license's words, from its choices and the shop's note. */
export function termsOf(p: Pick<LicensePolicy, 'uses' | 'note'>): string {
  const u = p.uses || ({} as LicenseUses);
  const seats = Math.max(1, Math.floor(Number(u.seats) || 1));
  const may: string[] = ['use it yourself'];
  if (u.clients) may.push('use it in your work with clients');
  if (u.commercial) may.push('sell things you make with it');
  if (u.modify) may.push('change it for your own use');
  if (u.resale) may.push('resell or share the files');
  const mayNot: string[] = [];
  if (!u.resale) mayNot.push('resell, share or repost the files');
  if (!u.clients) mayNot.push('use it in paid work for others');
  if (!u.commercial && u.clients) mayNot.push('sell things made from it');
  if (!u.modify) mayNot.push('change it');
  const list = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);
  const s = [`You may ${list(may)}.`];
  if (seats > 1) s.push(`Up to ${seats} people in your business may use it.`);
  if (mayNot.length) s.push(`Please don’t ${mayNot.join(', or ')}.`);
  const note = String(p.note || '').trim();
  if (note) s.push(note);
  return s.join(' ');
}

/** How many licenses of its own a shop can keep. */
export const MAX_OWN_LICENSES = 30;

/** Every license the shop can pick: the ready-made ones (with the shop's own words if it changed them) and its own. */
export function licensesOf(tenant: any): LicensePolicy[] {
  const saved: LicensePolicy[] = (Array.isArray(tenant?.digitalLicenses) ? tenant.digitalLicenses : [])
    .filter((l: any) => l && l.id && l.name).slice(0, MAX_OWN_LICENSES + BUILT_IN_LICENSES.length)
    .map((l: any) => ({ id: String(l.id), name: String(l.name).slice(0, 60), note: String(l.note || '').slice(0, 600), uses: cleanUses(l.uses) }));
  const byId = new Map(saved.map((l) => [l.id, l]));
  const built = BUILT_IN_LICENSES.map((b) => (byId.has(b.id) ? { ...byId.get(b.id)!, builtIn: true } : b));
  return [...built, ...saved.filter((l) => !BUILT_IN_LICENSES.some((b) => b.id === l.id))];
}

export function cleanUses(u: any): LicenseUses {
  return { clients: u?.clients === true, commercial: u?.commercial === true, modify: u?.modify !== false, resale: u?.resale === true, seats: Math.min(999, Math.max(1, Math.floor(Number(u?.seats) || 1))) };
}

/** The words copied onto a sale. */
export const copyOf = (p: LicensePolicy): LicenseCopy => ({ id: p.id, name: p.name, terms: termsOf(p) });

/**
 * The license a product sells with right now: the shop's license it picked (current words), else the words saved on
 * the product (a one-off license, or one the shop has since removed), else personal use.
 */
export function licenseFor(tenant: any, item: any): LicenseCopy {
  const id = String(item?.licenseId || item?.license?.id || '');
  const pol = id && id !== 'custom' ? licensesOf(tenant).find((l) => l.id === id) : null;
  if (pol) return copyOf(pol);
  const own = item?.license;
  if (own && own.id && String(own.terms || '').trim()) return { id: String(own.id), name: String(own.name || 'License'), terms: String(own.terms) };
  return copyOf(BUILT_IN_LICENSES[0]);
}

export const newLicenseId = () => `lic${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
