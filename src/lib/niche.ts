// src/lib/niche.ts — WHAT KIND OF BUSINESS (client and server safe). Nails, hair, lashes, a barbershop, a spa, a med spa,
// a tattoo studio, a gym, a café, a shop… Worked out from what the business has told the app (the starter menu it
// chose, its kind and name), and the owner can say in Settings → Business profile → How your business works
// (tenant.niche). Words, examples and tools that only fit one kind of business are chosen here, so a barbershop is
// never asked about polish and a café isn't shown a nail guide. Anything not known keeps every tool (nothing is taken
// away from a business the app can't place).

export type Niche = 'nails' | 'hair' | 'lash' | 'barber' | 'beauty' | 'spa' | 'medspa' | 'tattoo' | 'fitness' | 'hospitality' | 'shop' | 'events' | 'general';

export const NICHES: { value: Niche; label: string }[] = [
  { value: 'nails', label: 'Nails' }, { value: 'hair', label: 'Hair' }, { value: 'lash', label: 'Lashes and brows' },
  { value: 'barber', label: 'Barbering' }, { value: 'beauty', label: 'A mix of beauty services' }, { value: 'spa', label: 'Spa and massage' },
  { value: 'medspa', label: 'Med spa or clinic' }, { value: 'tattoo', label: 'Tattoo and piercing' }, { value: 'fitness', label: 'Fitness and classes' },
  { value: 'hospitality', label: 'Food and drink' }, { value: 'shop', label: 'A shop' }, { value: 'events', label: 'Events' },
  { value: 'general', label: 'Something else' },
];
const IS = new Set(NICHES.map((n) => n.value));

/** The kind of business: what the owner chose, else worked out. */
export function nicheOf(t: any): Niche {
  const chosen = String(t?.niche || '').toLowerCase();
  if (IS.has(chosen as Niche)) return chosen as Niche;
  return guessNiche(t);
}
/** Whether the owner chose it (Settings says "worked out" otherwise). */
export const nicheChosen = (t: any) => IS.has(String(t?.niche || '').toLowerCase() as Niche);
/** The kind of business only when the owner chose it, else null: what a tool is ever left out on (a guess never takes
 *  a tool away). */
export const chosenNiche = (t: any): Niche | null => (nicheChosen(t) ? String(t.niche).toLowerCase() as Niche : null);

/** Worked out: its kind and name, then the starter menu it added, then its signup type. */
export function guessNiche(t: any): Niche {
  const txt = `${t?.businessType || ''} ${t?.category || ''} ${t?.name || t?.businessName || ''}`.toLowerCase().replace(/_/g, ' ');
  if (/\bnails?\b|manicure|pedicure|\bmani\b|\bpedi\b/.test(txt)) return 'nails';
  if (/\blash(es)?\b|\bbrows?\b/.test(txt)) return 'lash';
  if (/barber/.test(txt)) return 'barber';
  if (/\bmed ?spa\b|\bmedi ?spa\b|\bmedical\b|\bclinic\b|\binject/.test(txt)) return 'medspa';
  if (/tattoo|pierc/.test(txt)) return 'tattoo';
  if (/\bspa\b|massage|\bskin\b|facial|wellness/.test(txt)) return 'spa';
  if (/\bhair\b|stylist|blowout|blow ?dry|\bcurls?\b/.test(txt)) return 'hair';
  if (/fitness|\bgym\b|yoga|pilates|barre|boxing/.test(txt)) return 'fitness';
  if (/restaurant|\bcaf[eé](?![a-z])|bakery|coffee|bistro|\bpub\b|hospitality/.test(txt)) return 'hospitality';   // not "bar": a nail, brow or blow-dry bar isn't one
  if (/\bshop\b|retail|store|boutique/.test(txt)) return 'shop';
  if (/\bevents?\b|venue/.test(txt)) return 'events';
  // The starter menu it added (suggested to it, so it comes after what the business said itself).
  const starter = String(t?.movingIn?.starterMenu || '');
  if (['nails', 'hair', 'lash', 'barber', 'spa'].includes(starter)) return starter as Niche;
  // What a Making it right set chosen on purpose says (its "nails" set is also the starting set for any salon, so it
  // says nothing on its own).
  const preset = String(t?.makingItRight?.preset || '');
  if (['hair', 'medspa', 'spa', 'tattoo', 'fitness', 'hospitality', 'shop'].includes(preset)) return preset as Niche;
  if (/\bsalon\b|beauty/.test(txt)) return 'beauty';
  return 'general';
}

// ── Tools
/** Markup tools left out for a kind of business they can't fit (the nail guide only where nails are done). Pass only a
 *  kind the owner chose (chosenNiche): a worked-out guess never takes a tool away. */
export function markupToolsHidden(n: Niche | null | undefined): string[] {
  if (!n || n === 'nails' || n === 'beauty' || n === 'general') return [];
  return ['nail'];
}

// ── A client's care notes (the client form): the quick picks that fit the work done.
export type CareKey = 'medical' | 'allergies' | 'sensory';
export type CareSet = { key: CareKey; title: string; picks: string[] };
const MEDICAL: Partial<Record<Niche, string[]>> = {
  nails: ['Diabetes', 'Poor Circulation', 'Pregnant', 'Blood Thinners'],
  beauty: ['Pregnant', 'Diabetes', 'Blood Thinners', 'Sensitive Skin'],
  hair: ['Pregnant', 'Sensitive Scalp', 'Hair Loss Condition'],
  lash: ['Pregnant', 'Eye Condition', 'Recent Eye Surgery'],
  spa: ['Pregnant', 'High Blood Pressure', 'Recent Injury', 'Blood Thinners'],
  medspa: ['Pregnant', 'Pacemaker', 'Blood Thinners', 'Recent Fillers'],
  tattoo: ['Blood Thinners', 'Diabetes', 'Pregnant', 'Keloid Scarring'],
  fitness: ['Heart Condition', 'Pregnant', 'Recent Injury', 'Asthma'],
};
const ALLERGIES: Partial<Record<Niche, string[]>> = {
  nails: ['Acrylates', 'Latex', 'Fragrance', 'Nuts'],
  beauty: ['Acrylates', 'PPD (Hair Dye)', 'Latex', 'Fragrance'],
  hair: ['PPD (Hair Dye)', 'Latex', 'Fragrance', 'Nuts'],
  lash: ['Lash Adhesive', 'Latex', 'Fragrance'],
  spa: ['Nuts', 'Essential Oils', 'Fragrance', 'Latex'],
  medspa: ['Lidocaine', 'Latex', 'Aspirin', 'Fragrance'],
  tattoo: ['Latex', 'Nickel', 'Red Ink'],
  hospitality: ['Nuts', 'Gluten', 'Shellfish', 'Dairy'],
};
const OLD_MEDICAL = ['Pregnant', 'Pacemaker', 'Diabetes', 'High Blood Pressure'];
const OLD_ALLERGIES = ['Latex', 'Fragrance', 'Nuts', 'Aspirin'];
const SENSORY = ['Wheelchair Access', 'Prefers Quiet', 'Sensory Sensitivities', 'Service Animal'];

/** The care sections a client's form shows, with quick picks for the kind of business. Health notes show where the
 *  work calls for them, where the business keeps health information, or where this client already has some (nothing
 *  saved is ever hidden). */
export function careSetsFor(n: Niche, o: { health?: boolean; hasMedical?: boolean } = {}): CareSet[] {
  const med = MEDICAL[n] || (o.health ? OLD_MEDICAL : null);
  const out: CareSet[] = [];
  if (med || o.health || o.hasMedical) out.push({ key: 'medical', title: 'Medical & Health', picks: med || OLD_MEDICAL });
  out.push({ key: 'allergies', title: 'Allergies & Sensitivities', picks: ALLERGIES[n] || OLD_ALLERGIES });
  out.push({ key: 'sensory', title: 'Access & Comfort', picks: SENSORY });
  return out;
}

// ── Words
/** What a client is asked to agree to before a visit, to start from (the team edits it). */
export function prepNoteFor(n: Niche): string {
  if (n === 'nails') return 'Please arrive with no polish on your nails.';
  if (n === 'hair') return 'Please arrive with clean, dry hair.';
  if (n === 'lash') return 'Please arrive with no eye makeup.';
  return 'Please arrive a few minutes early.';
}
