// src/lib/state-rules/nc.ts
//
// NORTH CAROLINA — Board of Cosmetic Art Examiners, 21 NCAC 14T
// (readopted effective April 1, 2026). Program templates a school can start
// from; every value stays editable because a school's Board-approved
// curriculum is what governs it (performance COUNTS, for example, are set by
// each school's approved curriculum, not by the rule).
//
// What these drive in ClarityFlow:
//   • hours: total, online limited to 30% (theory only), max 10 h/day and
//     48 h/week in school (online is additional), quarter-hour rounding
//   • infection control + blood exposure evaluations first, at 100%, in order
//   • required mannequin evaluations — passed before that service is performed
//     on a live client (the student salon only offers a student the services
//     they're cleared for); every other performance needs infection control
//     passed first. Schools can widen what an evaluation unlocks.
//   • required performances, passing grade 70, field-trip cap
//   • the permanent-file checklist, Board-form deadlines, record retention

export interface StateEvaluation { key: string; label: string; passPct: number; infection?: boolean; gates?: string[] }
export interface StateTemplate {
  state: 'NC'; discipline: string; name: string; totalHours: number;
  limits: { onlineMaxPct: number; dailyCapHours: number; weeklyCapHours: number; quarterHour: true; fieldTripMaxHours: number; internshipMaxPct: number };
  passGrade: number; weeklyGuidedMinPct: number;
  evaluations: StateEvaluation[]; performances: { key: string; label: string }[];
  requiredDocs: string[]; boardForms: { key: string; label: string; trigger: 'enrollment' | 'transfer' | 'withdrawal' | 'graduation'; dueDays: number }[];
  rule: string;
}

const infection: StateEvaluation[] = [
  { key: 'ic_hand_washing', label: 'Infection control — hand washing', passPct: 100, infection: true },
  { key: 'ic_implement_disinfection', label: 'Infection control — implement disinfection', passPct: 100, infection: true },
  { key: 'ic_day_start_end', label: 'Infection control — beginning and end of day', passPct: 100, infection: true },
  { key: 'ic_blood_self', label: 'Blood exposure — self cut', passPct: 100, infection: true },
  { key: 'ic_blood_client', label: 'Blood exposure — client', passPct: 100, infection: true },
];
export const NC_PERMANENT_FILE = [
  'Board Enrollment Form (sealed, signed by the student)',
  'Receipt of evaluation plans, school policies, handbook, contract and Board rules',
  'Social Security card, tax ID or Department of Homeland Security ID',
  'Government-issued photo ID',
  'Proof of date of birth',
  'Online-readiness assessment (how the school judged the student ready for online learning)',
];
const forms = (enrolDays: number, exitDays: number) => [
  { key: 'enrollment', label: 'Board Enrollment Form', trigger: 'enrollment' as const, dueDays: enrolDays },
  { key: 'withdrawal', label: 'Board Withdrawal Form', trigger: 'withdrawal' as const, dueDays: exitDays },
  { key: 'graduation', label: 'Board Graduation Form (school documents portal)', trigger: 'graduation' as const, dueDays: exitDays },
];
// Same keys programs already use for requirements (academy-school keyOf).
const k = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'service';
const perf = (xs: string[]) => xs.map((label) => ({ key: k(label), label }));

export const NC_TEMPLATES: StateTemplate[] = [
  {
    state: 'NC', discipline: 'manicuring', name: 'Manicurist (North Carolina)', totalHours: 300, rule: '21 NCAC 14T .0605',
    limits: { onlineMaxPct: 30, dailyCapHours: 10, weeklyCapHours: 48, quarterHour: true, fieldTripMaxHours: 10, internshipMaxPct: 5 }, passGrade: 70, weeklyGuidedMinPct: 10,
    evaluations: [...infection,
      { key: 'eval_basic_manicure', label: 'Required evaluation — basic manicure', passPct: 70, gates: [k('Basic manicure')] },
      { key: 'eval_basic_pedicure', label: 'Required evaluation — basic pedicure with rasp', passPct: 70, gates: [k('Basic pedicure')] },
      { key: 'eval_sculptured', label: 'Required evaluation — sculptured nails (application, fill, removal)', passPct: 70, gates: [k('Sculptured nails (application, repair, fill, and removal)')] },
      { key: 'eval_electric_file', label: 'Required evaluation — electric file', passPct: 70, gates: [k('Electric file')] },
    ],
    performances: perf(['Basic manicure', 'Basic pedicure', 'Nail tips', 'Acrylic overlay (application, repair, fill, and removal)', 'Sculptured nails (application, repair, fill, and removal)', 'Gel overlay (application, repair, fill, and removal)', 'Trimming', 'Filing', 'Shaping', 'Decorating', 'Arm and hand manipulation', 'Electric file']),
    requiredDocs: NC_PERMANENT_FILE, boardForms: forms(15, 30),
  },
  {
    state: 'NC', discipline: 'esthetics', name: 'Esthetician (North Carolina)', totalHours: 600, rule: '21 NCAC 14T .0604',
    limits: { onlineMaxPct: 30, dailyCapHours: 10, weeklyCapHours: 48, quarterHour: true, fieldTripMaxHours: 20, internshipMaxPct: 5 }, passGrade: 70, weeklyGuidedMinPct: 10,
    evaluations: [...infection,
      { key: 'eval_basic_facial', label: 'Required evaluation — basic facial including steam', passPct: 70 },
      { key: 'eval_waxing', label: 'Required evaluation — waxing', passPct: 70 },
      { key: 'eval_lash_lift', label: 'Required evaluation — lash lift and brow lamination', passPct: 70 },
      { key: 'eval_artificial_lashes', label: 'Required evaluation — artificial lashes', passPct: 70 },
      { key: 'eval_lash_tint', label: 'Required evaluation — lash and brow tint', passPct: 70 },
    ],
    performances: perf(['Draping', 'Basic facials', 'Waxing (underarm, lip, eyebrow, leg, bikini)', 'Hair removal with depilatory and tweezers', 'Makeup application', 'Facials with machines', 'Manual exfoliation', 'Manual extraction', 'Artificial lashes including single eyelash extensions', 'Facial or body treatment', 'Aromatherapy', 'Lash lift and brow lamination', 'Microneedling', 'Dermaplaning', 'Lash and brow tint']),
    requiredDocs: NC_PERMANENT_FILE, boardForms: forms(15, 30),
  },
  {
    state: 'NC', discipline: 'natural_hair_care', name: 'Natural Hair Care Specialist (North Carolina)', totalHours: 300, rule: '21 NCAC 14T .0606',
    limits: { onlineMaxPct: 30, dailyCapHours: 10, weeklyCapHours: 48, quarterHour: true, fieldTripMaxHours: 10, internshipMaxPct: 5 }, passGrade: 70, weeklyGuidedMinPct: 10,
    evaluations: [...infection,
      { key: 'eval_braid', label: 'Required evaluation — three strand overbraid and underbraid', passPct: 70 },
      { key: 'eval_weft', label: 'Required evaluation — track and sew weft', passPct: 70 },
      { key: 'eval_blowdry', label: 'Required evaluation — blow drying and hot iron', passPct: 70 },
    ],
    performances: perf(['Twists', 'Knots', 'Locs', 'Two strand overlap', 'Three strand overbraid', 'Three strand underbraid', 'On the scalp three strand braid', 'Track and sew weft', 'Adding hair extensions', 'Shampooing', 'Draping', 'Wrapping', 'Blowdry and thermal iron']),
    requiredDocs: NC_PERMANENT_FILE, boardForms: forms(15, 30),
  },
  {
    state: 'NC', discipline: 'cosmetology', name: 'Cosmetologist (North Carolina)', totalHours: 1500, rule: '21 NCAC 14T .0602',
    limits: { onlineMaxPct: 30, dailyCapHours: 10, weeklyCapHours: 48, quarterHour: true, fieldTripMaxHours: 40, internshipMaxPct: 5 }, passGrade: 70, weeklyGuidedMinPct: 10,
    evaluations: [...infection, ...['Blow drying and hot iron', 'Hair cut with shears, a razor, and clipper', 'Color application including virgin and retouch', 'Relaxer application including virgin and retouch', 'Permanent waving', 'Basic manicure', 'Basic pedicure', 'Basic facial including steam', 'Waxing'].map((l) => ({ key: `eval_${k(l)}`, label: `Required evaluation — ${l.toLowerCase()}`, passPct: 70 }))],
    performances: perf(['Shampooing', 'Roller sets', 'Pin curls', 'Ridge curls with C shaping', 'Fingerwaves', 'Artificial hair', 'Up-styles', 'Pressing or thermal', 'Blow drying', 'Hot iron', 'Styles that apply tension', 'Solid form cut', 'Elevated cut', 'Cut with tapered or thinning shears', 'Razor cut', 'Clipper cut', 'Shears over comb cut', 'Clippers over comb cut', 'Virgin darker', 'Virgin lightener', 'Retouch', 'Foil', 'Freehand painting', 'Relaxer', 'Permanent waving rod placement', 'Basic manicure or pedicure', 'Artificial nails', 'Basic facial', 'Waxing including face and body', 'Hair removal with tweezers', 'Hair removal with razor', 'Makeup application', 'Lash lift and brow lamination', 'Artificial lashes', 'Lash and brow tint']),
    requiredDocs: NC_PERMANENT_FILE, boardForms: forms(30, 30),
  },
];

/** NC record retention: until accepted for the Board exam, or 5 years after first enrolment — whichever is earlier. */
export function ncRetainUntil(firstEnrolledAt: string, examAcceptedAt?: string | null) {
  const five = new Date(firstEnrolledAt); five.setFullYear(five.getFullYear() + 5);
  const exam = examAcceptedAt ? new Date(examAcceptedAt) : null;
  return (exam && exam < five ? exam : five).toISOString();
}
