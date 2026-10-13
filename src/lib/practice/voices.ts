// Practice a shift: who sounds like what. Pick a voice for each client and caller, or let a preset do it.
// Hearing different accents, ages and speeds is part of the training: understanding everyone who walks in or calls.

export type VoiceOpt = { id: string; name: string; gender: string; age: string; accent: string; description: string; preview: string | null; src: 'eleven' | 'browser' };
export type Pick = { src: 'eleven' | 'browser'; id: string; speed: number };
export type Person = { id: string; name: string; voiceHint: { gender: 'female' | 'male'; age: 'young' | 'middle_aged' | 'old' } };
export type Preset = 'matched' | 'accents' | 'challenge' | 'clear';
export const PRESETS: { key: Preset; label: string; note: string }[] = [
  { key: 'matched', label: 'Matched', note: 'Each client gets a voice that fits their age and gender.' },
  { key: 'accents', label: 'Mix of accents', note: 'As many different accents as your voices allow, so you practice understanding everyone.' },
  { key: 'challenge', label: 'Challenge', note: 'Different accents, and most people talk fast. Great for listening skills.' },
  { key: 'clear', label: 'Clear and slow', note: 'Easy to follow: steady voices at a relaxed pace. Good for beginners.' },
];

const NEUTRAL = /americ|us\b|general|neutral|^$/i;
/** Group accents so "british" and "english" count as the same one. */
export function accentKey(a: string) {
  const x = a.toLowerCase();
  if (/brit|english|uk|london|scott|welsh/.test(x)) return /scott/.test(x) ? 'scottish' : 'british';
  if (/austral/.test(x)) return 'australian'; if (/irish|ireland/.test(x)) return 'irish'; if (/india|indian/.test(x)) return 'indian';
  if (/afric|nigeri|kenya|ghana/.test(x)) return 'african'; if (/canad/.test(x)) return 'canadian'; if (/new zealand|nz/.test(x)) return 'new zealand';
  if (/latin|spanish|mexic|hispanic/.test(x)) return 'latin american'; if (/french/.test(x)) return 'french'; if (/german/.test(x)) return 'german';
  if (/southern/.test(x)) return 'southern us'; if (/americ|\bus\b|en-us/.test(x)) return 'american';
  return x.trim() || 'american';
}
const ageKey = (a: string) => (/old|senior|elder/i.test(a) ? 'old' : /middle/i.test(a) ? 'middle' : /young|teen/i.test(a) ? 'young' : '');

/** Give everyone a voice for the chosen preset. Keeps voices different from each other where possible. */
export function autoPick(people: Person[], voices: VoiceOpt[], preset: Preset): Record<string, Pick> {
  const out: Record<string, Pick> = {}; if (!voices.length) return out;
  const used = new Map<string, number>(); const accents = new Map<string, number>();
  people.forEach((p, i) => {
    const score = (v: VoiceOpt) => {
      const g = v.gender.toLowerCase(); const gender = g === p.voiceHint.gender ? 10 : g ? -6 : 0;
      const age = ageKey(v.age) && p.voiceHint.age.startsWith(ageKey(v.age)) ? 3 : 0;
      const ak = accentKey(v.accent); const fresh = -(used.get(v.id) || 0) * 9;
      const variety = preset === 'accents' || preset === 'challenge' ? (accents.has(ak) ? -(accents.get(ak)! * 5) : 7) + (ak === 'american' ? -1 : 0) : 0;
      const clear = preset === 'clear' ? (NEUTRAL.test(v.accent) || ak === 'american' ? 5 : -3) : preset === 'matched' && ak === 'american' ? 1 : 0;
      return gender + age + fresh + variety + clear;
    };
    const best = [...voices].sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id))[0];
    used.set(best.id, (used.get(best.id) || 0) + 1); const ak = accentKey(best.accent); accents.set(ak, (accents.get(ak) || 0) + 1);
    const speed = preset === 'clear' ? 0.9 : preset === 'challenge' ? (i % 3 === 2 ? 1 : [1.15, 1.2][i % 2]) : 1;
    out[p.id] = { src: best.src, id: best.id, speed };
  });
  return out;
}

const LANG: Record<string, string> = { 'en-us': 'American', 'en-gb': 'British', 'en-au': 'Australian', 'en-in': 'Indian', 'en-ie': 'Irish', 'en-za': 'South African', 'en-nz': 'New Zealand', 'en-ca': 'Canadian', 'en-ng': 'Nigerian', 'en-ke': 'Kenyan', 'en-sg': 'Singaporean', 'en-ph': 'Filipino', 'en-hk': 'Hong Kong', 'en-gh': 'Ghanaian', 'en-tz': 'Tanzanian' };
const FEM = /female|woman|samantha|victoria|karen|zira|susan|serena|moira|tessa|fiona|ava|allison|jenny|aria|kate|libby|sonia|natasha|neerja|veena|emma|michelle|catherine|hazel|heera|linda|nicky|zoe|isha|rishi?ka/i;
const MAL = /\bmale\b|\bman\b|daniel|alex|fred|david|guy|tom|aaron|arthur|oliver|ryan|george|james|william|ravi|prabhat|mark|rishi\b|lee|gordon|evan|nathan|thomas|eddy|reed|rocko/i;
/** The device's own voices, labeled by accent, for when real voices aren't connected. */
export function browserVoices(list: { name: string; lang: string; voiceURI: string }[]): VoiceOpt[] {
  return list.filter((v) => /^en[-_]/i.test(v.lang)).map((v) => {
    const lang = v.lang.replace('_', '-').toLowerCase();
    const gender = FEM.test(v.name) && !/\bmale\b/i.test(v.name) ? 'female' : MAL.test(v.name) ? 'male' : '';
    return { id: v.voiceURI, name: v.name.replace(/^(Microsoft|Google)\s+/, '').replace(/\s+Online \(Natural\).*$/, ' (natural)'), gender, age: '', accent: LANG[lang] || v.lang, description: /natural|neural|enhanced|premium/i.test(v.name) ? 'natural' : '', preview: null, src: 'browser' as const };
  });
}
