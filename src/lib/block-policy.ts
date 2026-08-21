/**
 * block-policy — who may put a block on their own calendar, and how.
 *
 * WHY THIS EXISTS
 * Appointment authority decides whether a provider may decline a booking. It
 * is worth nothing if the same provider can block the slot so no booking ever
 * arrives. A calendar block is a decline made in advance and without a reason,
 * which is why the whole authority model leaks through this one hole.
 *
 * THE SHAPE
 * Seven block types and four authority levels is twenty-eight decisions on a
 * settings page an owner opens once. So every type gets ONE of three
 * permissions, and the defaults below are chosen so most shops never touch it:
 *
 *   free      goes on the calendar immediately, nobody is asked
 *   notify    goes on immediately AND a manager is told
 *   approval  does NOT block anything until a manager says yes
 *
 * The defaults gate exactly one type. Break and lunch are legally protected in
 * most places and must never wait on a queue. Training and meetings were
 * scheduled by the business already. Emergency blocks instantly and tells a
 * manager, because somebody whose child is ill should not be waiting for
 * approval — misuse is a conversation to have afterwards, with a record.
 *
 * That leaves personal, and administrative for shops that want it. Personal is
 * the actual loophole and the only one worth defending by default.
 */

export type BlockType =
  | 'break' | 'lunch' | 'training' | 'meeting'
  | 'emergency' | 'administrative' | 'personal';

export type BlockPermission = 'free' | 'notify' | 'approval';

export const BLOCK_TYPES: Array<{ id: BlockType; label: string; blurb: string }> = [
  { id: 'break', label: 'Break', blurb: 'Short rest during a shift.' },
  { id: 'lunch', label: 'Lunch', blurb: 'The meal break.' },
  { id: 'training', label: 'Training', blurb: 'Courses and skills work.' },
  { id: 'meeting', label: 'Meeting', blurb: 'Anything the business called.' },
  { id: 'emergency', label: 'Emergency', blurb: 'Blocks now, tells you now.' },
  { id: 'administrative', label: 'Administrative', blurb: 'Paperwork and admin time.' },
  { id: 'personal', label: 'Personal', blurb: 'Their own time during shop hours.' },
];

export type BlockRule = { permission: BlockPermission; dailyCapMinutes?: number };

/**
 * Free does not mean unlimited. A break somebody may take without asking is
 * still a break that should not run to four hours — "allowed within policy",
 * not "allowed".
 */
export const DEFAULT_BLOCK_POLICY: Record<BlockType, BlockRule> = {
  break: { permission: 'free', dailyCapMinutes: 30 },
  lunch: { permission: 'free', dailyCapMinutes: 60 },
  training: { permission: 'free' },
  meeting: { permission: 'free' },
  emergency: { permission: 'notify' },
  administrative: { permission: 'approval' },
  personal: { permission: 'approval' },
};

export type BlockPolicy = Partial<Record<BlockType, BlockRule>>;

export type BlockVerdict = {
  permission: BlockPermission;
  capMinutes: number | null;
  /** True when the block must not affect availability until someone says yes. */
  holdsUntilApproved: boolean;
  /** Plain sentence for the person creating it. */
  note: string;
};

/**
 * A renter or contractor runs their own book, so their calendar is their
 * business and the platform has no standing to gate it. Gating it would be the
 * software making a claim about somebody's working arrangement that is not
 * ours to make.
 */
export function resolveBlockPermission(input: {
  blockType: BlockType | string;
  employmentModel?: string | null;
  role?: string | null;
  isManager?: boolean;
  policy?: BlockPolicy | null;
}): BlockVerdict {
  const type = String(input.blockType || 'personal') as BlockType;
  const rule = (input.policy && input.policy[type]) || DEFAULT_BLOCK_POLICY[type] || { permission: 'approval' as const };

  const model = input.employmentModel
    || (String(input.role || '') === 'renter' ? 'renter' : null);
  const runsOwnBook = model === 'renter' || model === 'contractor';
  const isManager = input.isManager === true
    || ['owner', 'admin', 'manager'].includes(String(input.role || ''));

  if (runsOwnBook || isManager) {
    return {
      permission: 'free',
      capMinutes: null,
      holdsUntilApproved: false,
      note: 'Goes straight on your calendar.',
    };
  }

  const cap = typeof rule.dailyCapMinutes === 'number' ? rule.dailyCapMinutes : null;

  if (rule.permission === 'approval') {
    return {
      permission: 'approval',
      capMinutes: cap,
      holdsUntilApproved: true,
      note: 'A manager has to approve this. Your time stays bookable until they do.',
    };
  }
  if (rule.permission === 'notify') {
    return {
      permission: 'notify',
      capMinutes: cap,
      holdsUntilApproved: false,
      note: 'Blocks your calendar straight away and lets a manager know.',
    };
  }
  return {
    permission: 'free',
    capMinutes: cap,
    holdsUntilApproved: false,
    note: cap ? `Goes straight on. Up to ${cap} minutes a day.` : 'Goes straight on your calendar.',
  };
}

/** Minutes of this block type already on someone's calendar for the day. */
export function minutesUsed(events: any[], staffId: string, blockType: string, day: Date): number {
  const d = new Date(day);
  return (events || [])
    .filter(e => e && String(e.blockType || e.type || '') === blockType)
    .filter(e => (e.staffIds || []).includes(staffId) || String(e.staffId || '') === staffId)
    .filter(e => String(e.status || 'approved') !== 'pending')
    .filter(e => {
      const s = new Date(e.startTime);
      return s.getFullYear() === d.getFullYear() && s.getMonth() === d.getMonth() && s.getDate() === d.getDate();
    })
    .reduce((sum, e) => {
      const s = new Date(e.startTime).getTime();
      const t = new Date(e.endTime).getTime();
      return sum + (Number.isFinite(s) && Number.isFinite(t) ? Math.max(0, Math.round((t - s) / 60000)) : 0);
    }, 0);
}

export function exceedsCap(input: {
  verdict: BlockVerdict;
  events: any[];
  staffId: string;
  blockType: string;
  day: Date;
  newMinutes: number;
}): { over: boolean; usedMinutes: number; capMinutes: number | null } {
  const cap = input.verdict.capMinutes;
  const used = minutesUsed(input.events, input.staffId, input.blockType, input.day);
  return {
    over: cap !== null && used + input.newMinutes > cap,
    usedMinutes: used,
    capMinutes: cap,
  };
}
