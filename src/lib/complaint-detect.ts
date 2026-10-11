// src/lib/complaint-detect.ts — DOES A CLIENT'S TEXT SOUND LIKE A COMPLAINT? Plain word matching, tuned to be cautious:
// it only ever suggests "Start a case" to the team, it never opens one by itself. Words that point to a safety concern
// (pain, burns, swelling, a reaction) are flagged so the suggestion says so.
// English and Spanish phrasing; short keyword replies (C, YES, CANCEL…) never match.

const SAFETY = [
  /\b(burn(ed|t|ing|s)?|blister(ed|s)?|bleed(ing|s)?|bled|infect(ed|ion)|swell(ing|ed)?|swollen|rash|allerg(y|ic)|reaction|pus|hurts?|hurting|painful|in pain|throbbing|cut me|cut my|nicked|stinging|itch(y|ing))\b/i,
  /(?<![\p{L}])(quem(a|ó|adura)|sangr(a|ó|e)|infecci[oó]n|hinchad[oa]|alergia|duele|dolor|ampolla)(?![\p{L}])/iu,
];
const COMPLAINT = [
  /\b(lift(ed|ing|s)?|chipp?(ed|ing|s)?|peel(ed|ing|s)?|crack(ed|ing|s)?|broke|broken|fell off|came off|popp?ed off|falling off|snapped)\b/i,
  /\b(not|n't|never|wasn'?t|isn'?t|am not|i'm not)\s+(happy|pleased|satisfied|what i (asked|wanted)|right|okay|ok)\b/i,
  /\b(unhappy|disappointed|dissatisfied|upset|frustrated|terrible|awful|horrible|worst|ruined|messed up|botched|sloppy|uneven|crooked|lumpy|bumpy|too (short|long|thick|thin|dark|light))\b/i,
  /\b(refund|money back|redo|re-do|fix (it|this|them|my)|come back in|wrong (color|colour|shape|length|service)|not the (color|colour|shape) i)\b/i,
  /\b(rude|unprofessional|rushed|ignored|waited (an hour|forever|\d+))\b/i,
  /(?<![\p{L}])(no (estoy|quedé) (contenta|contento|satisfech[oa])|se( me| le| te| nos)? (cayó|cayeron|levant(ó|aron)|despeg(ó|aron)|rompi(ó|eron))|reembolso|arreglar|mal hech[oa]|feo)(?![\p{L}])/iu,
];
const NOT_A_COMPLAINT = [/\b(love|loved|lovely|amazing|beautiful|thank(s| you)|obsessed|perfect|gorgeous)\b/i];

export type ComplaintHint = { match: boolean; safety: boolean; words: string[] };

export function soundsLikeComplaint(text: string | null | undefined): ComplaintHint {
  const t = String(text || '').trim(); const none: ComplaintHint = { match: false, safety: false, words: [] };
  if (t.length < 8 || /^(c|y|yes|no|n|x|confirm|cancel|stop|start|help)$/i.test(t)) return none;
  const words: string[] = []; let safety = false;
  for (const re of SAFETY) { const m = t.match(re); if (m) { safety = true; words.push(m[0]); } }
  for (const re of COMPLAINT) { const m = t.match(re); if (m) words.push(m[0]); }
  if (!words.length) return none;
  // "Thank you, I love them!" with a stray word isn't a complaint — unless there's a safety word or two complaint words.
  if (!safety && words.length < 2 && NOT_A_COMPLAINT.some((re) => re.test(t)) && !/\b(but|though|although|except|however|already)\b/i.test(t)) return none;
  return { match: true, safety, words: [...new Set(words.map((w) => w.toLowerCase()))].slice(0, 4) };
}
