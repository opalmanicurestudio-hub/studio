/**
 * niches — the business types this assistant serves, each with a spoken
 * phrase for the prompt and an expert starter set of consultation
 * questions. Selecting a niche personalizes the agent's language AND
 * seeds a credible consultation script in one tap — the "who is this
 * for" answer, productized.
 */

export type VoiceNiche = {
  id: string;
  label: string;
  spoken: string; // fills {{business_niche}}: "a nail studio"
  consultQuestions: string[];
};

export const VOICE_NICHES: VoiceNiche[] = [
  {
    id: 'nails',
    label: 'Nail studio',
    spoken: 'a nail studio',
    consultQuestions: [
      'What look are you going for — natural, glam, or something in between?',
      'How are your natural nails right now — any lifting, peeling, or soreness?',
      'Do you have any allergies or sensitivities to nail products?',
      'What do you currently have on your nails, if anything?',
      'How hard are you on your hands day to day — work, gym, water?',
      'How long would you like the set to last between visits?',
    ],
  },
  {
    id: 'hair',
    label: 'Hair salon',
    spoken: 'a hair salon',
    consultQuestions: [
      'What are you hoping to change about your hair?',
      'When was your last color or chemical service, and what was it?',
      'Any scalp sensitivities or product allergies?',
      'How much time do you spend styling on a normal day?',
      'How often are you willing to come in for upkeep?',
    ],
  },
  {
    id: 'barber',
    label: 'Barbershop',
    spoken: 'a barbershop',
    consultQuestions: [
      'How do you usually get your cut — do you know your guard numbers?',
      'Are you keeping the same style or trying something new?',
      'Anything for the beard today?',
      'Any skin sensitivities we should know about?',
    ],
  },
  {
    id: 'lash_brow',
    label: 'Lash & brow bar',
    spoken: 'a lash and brow studio',
    consultQuestions: [
      'Have you had lash extensions or a lift before?',
      'Any known allergies, especially to adhesives?',
      'Do you wear contacts or have sensitive eyes?',
      'How full and dramatic do you want the result?',
    ],
  },
  {
    id: 'esthetics',
    label: 'Esthetics & skincare',
    spoken: 'a skincare studio',
    consultQuestions: [
      'What are your main skin concerns right now?',
      'Walk me through your current skincare routine.',
      'Are you using anything active — retinoids, acids, prescriptions?',
      'Any allergies or past reactions to treatments?',
      'How much sun exposure do you get in a typical week?',
    ],
  },
  {
    id: 'spa',
    label: 'Spa & massage',
    spoken: 'a spa',
    consultQuestions: [
      'What areas need the most attention?',
      'Do you prefer lighter or deeper pressure?',
      'Any injuries, surgeries, or medical conditions we should work around?',
      'Are you pregnant or is there any chance you might be?',
      'Any allergies to oils or scents?',
    ],
  },
  {
    id: 'tattoo',
    label: 'Tattoo & piercing',
    spoken: 'a tattoo studio',
    consultQuestions: [
      'Tell me about the piece — concept, placement, and rough size.',
      'Is this your first tattoo?',
      'Any skin conditions where the piece would go?',
      'Are you on any medications that affect healing or bleeding?',
      'Do you have a budget range in mind for the artist to work with?',
    ],
  },
  {
    id: 'medspa',
    label: 'Med spa',
    spoken: 'a med spa',
    consultQuestions: [
      'Which treatments are you interested in exploring?',
      'Have you had injectables or laser treatments before?',
      'Any medical conditions or medications the provider should review?',
      'What results are you hoping to see?',
    ],
  },
  {
    id: 'makeup',
    label: 'Makeup artist',
    spoken: 'a makeup studio',
    consultQuestions: [
      "What's the occasion, and when is it?",
      'What kind of look do you love — soft, glam, editorial?',
      'Any skin sensitivities or product allergies?',
      'Would you like lashes included?',
      'Do you want a trial before the day?',
    ],
  },
  {
    id: 'wellness',
    label: 'Wellness studio',
    spoken: 'a wellness studio',
    consultQuestions: [
      'What brought you in — what are you hoping to work on?',
      'Have you tried anything like this before?',
      'Any health considerations your practitioner should know about?',
      'What does a good outcome look like for you?',
    ],
  },
];

export const nicheById = (id: string | undefined | null): VoiceNiche | null =>
  VOICE_NICHES.find((n) => n.id === id) || null;

// Service-name keywords per niche — powers pre-population from the data the
// business already entered (their service menu), so "what kind of business
// is this" arrives pre-answered.
const NICHE_KEYWORDS: Record<string, string[]> = {
  nails: ['nail', 'mani', 'pedi', 'gel', 'acrylic', 'dip', 'polish', 'full set', 'fill'],
  hair: ['haircut', 'blowout', 'balayage', 'highlights', 'color', 'silk press', 'trim', 'perm', 'keratin'],
  barber: ['fade', 'beard', 'lineup', 'line up', 'shave', 'taper', 'buzz'],
  lash_brow: ['lash', 'brow', 'lamination', 'tint', 'extension'],
  esthetics: ['facial', 'peel', 'dermaplan', 'microderm', 'extraction', 'skincare'],
  spa: ['massage', 'body wrap', 'hot stone', 'reflexology', 'sauna'],
  tattoo: ['tattoo', 'piercing', 'ink', 'flash'],
  medspa: ['botox', 'filler', 'laser', 'injectable', 'microneedling', 'iv '],
  makeup: ['makeup', 'glam', 'bridal look'],
};

/** Best-guess niche from the tenant's own service names. */
export function inferNicheFromServices(services: any[]): string {
  const haystack = services
    .map((s: any) => String(s?.name || '').toLowerCase())
    .join(' | ');
  let best = '';
  let bestScore = 0;
  for (const [id, words] of Object.entries(NICHE_KEYWORDS)) {
    const score = words.reduce((acc, w) => acc + (haystack.includes(w) ? 1 : 0), 0);
    if (score > bestScore) { bestScore = score; best = id; }
  }
  return bestScore >= 1 ? best : '';
}
