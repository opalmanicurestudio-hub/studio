/**
 * appointment-authority — who may answer a booking, and for what reason.
 *
 * THE POINT OF THIS FILE
 * A booking a provider cannot perform is not the same as a booking a provider
 * would rather not perform, and neither is the same as a booking the system
 * should never have offered them. The scheduling engine already refuses the
 * third kind: availability.ts owns qualifiedFor(), isCertified(), findShift(),
 * hasApprovedDayOff() and resourceDowntime(), and /api/appointments/book
 * returns 409 rather than booking an uncertified provider. So "I don't perform
 * this service" is deliberately NOT a reason code here — if that ever reaches
 * a person, it is a bug in the booking engine, not a decision to delegate.
 *
 * What is left, and what this file models:
 *   EXCEPTION  — something unusual stops this specific appointment.
 *   PREFERENCE — the provider would rather not. Never a veto on its own.
 *
 * NOTHING HERE CHANGES BEHAVIOUR UNTIL IT IS CONFIGURED. Every field is
 * optional and every default reproduces exactly what the shop does today.
 */

export type EmploymentModel = 'employee' | 'commission' | 'contractor' | 'renter';

/**
 * What a PROVIDER may do with their own bookings.
 *
 * The six rows in the original spec collapse to four here, because two of them
 * describe the APPOINTMENT rather than the person: "Manager Control" and
 * "Owner Control" are properties of a booking that needs a particular level of
 * sign-off, not of a provider's authority over their own book. Those belong on
 * the tenant or the service, and are modelled below as requiredApprovalLevel.
 */
export type DecisionAuthority =
  /** Eligible bookings simply appear. The provider reports issues, never declines. */
  | 'none'
  /** May decline, but only for reasons the shop has approved for self-service. */
  | 'limited'
  /** May raise any reason; a manager makes the call. */
  | 'request_approval'
  /** Answers their own bookings outright. */
  | 'full';

export const AUTHORITY_ORDER: DecisionAuthority[] = ['none', 'limited', 'request_approval', 'full'];

export const authorityAtLeast = (a: DecisionAuthority, floor: DecisionAuthority): boolean =>
  AUTHORITY_ORDER.indexOf(a) >= AUTHORITY_ORDER.indexOf(floor);

/**
 * Defaults by working relationship, used only when nobody has set an explicit
 * authority on the provider. A renter runs their own book; an employee whose
 * schedule and services the business assigns does not. The platform records
 * the relationship the business states — it never infers one from pay
 * structure, because how someone is PAID and what they ARE are different
 * questions with different consequences.
 */
export const DEFAULT_AUTHORITY: Record<EmploymentModel, DecisionAuthority> = {
  employee: 'none',
  commission: 'limited',
  contractor: 'full',
  renter: 'full',
};

export type ReasonResolution = 'auto' | 'manager';

export type DeclineReason = {
  code: string;
  label: string;
  group: 'service' | 'schedule' | 'client' | 'operational' | 'personal';
  /** 'auto' may release the booking without a manager; 'manager' raises a request. */
  resolution: ReasonResolution;
};

/**
 * Deliberately short. Every reason the scheduling engine already prevents has
 * been left out (see the note at the top). What remains is the set a person
 * can genuinely know that the system cannot.
 */
export const DECLINE_REASONS: DeclineReason[] = [
  { code: 'consultation_missing', label: 'Required consultation has not happened', group: 'service', resolution: 'auto' },
  { code: 'needs_other_specialty', label: 'Client needs a different specialty', group: 'service', resolution: 'auto' },
  { code: 'wrong_service_booked', label: 'Client booked the wrong service', group: 'service', resolution: 'auto' },
  { code: 'prep_not_completed', label: 'Required preparation was not completed', group: 'service', resolution: 'auto' },
  { code: 'unsafe_to_perform', label: 'Cannot be performed safely on this client', group: 'client', resolution: 'manager' },
  { code: 'workload_limit', label: 'Would exceed my workload limit', group: 'schedule', resolution: 'manager' },
  { code: 'client_conflict', label: 'I should not be assigned this client', group: 'client', resolution: 'manager' },
  { code: 'management_review', label: 'Needs management review', group: 'client', resolution: 'manager' },
  { code: 'emergency', label: 'Emergency', group: 'personal', resolution: 'manager' },
  { code: 'personal_conflict', label: 'Personal conflict', group: 'personal', resolution: 'manager' },
  { code: 'other', label: 'Other', group: 'personal', resolution: 'manager' },
];

export const REASONS_BY_CODE: Record<string, DeclineReason> =
  DECLINE_REASONS.reduce((acc, r) => { acc[r.code] = r; return acc; }, {} as Record<string, DeclineReason>);

/** Codes a shop may hand to providers for self-service decline, out of the box. */
export const DEFAULT_AUTO_CODES: string[] =
  DECLINE_REASONS.filter(r => r.resolution === 'auto').map(r => r.code);

export type AuthorityPolicy = {
  /** Shop-wide ceiling for employees and commission staff. Renters are not capped. */
  maxProviderAuthority?: DecisionAuthority;
  /** Which codes a 'limited' provider may resolve without a manager. */
  autoDeclineCodes?: string[];
  /** Require a reason on every decline, including a manager's. */
  requireDeclineReason?: boolean;
};

export type AuthorityInput = {
  isManager?: boolean;
  employmentModel?: EmploymentModel | null;
  decisionAuthority?: DecisionAuthority | null;
  policy?: AuthorityPolicy | null;
};

/**
 * The resolution order from the spec, top wins:
 *   business policy → work arrangement → provider setting → preference.
 * Preference never appears here on purpose: it is an input to MATCHING, not a
 * veto, and treating it as authority is how a preference quietly becomes a
 * hard restriction nobody configured.
 */
export function resolveAuthority(input: AuthorityInput): DecisionAuthority {
  if (input.isManager) return 'full';

  const model = input.employmentModel || null;
  const base: DecisionAuthority = input.decisionAuthority
    || (model ? DEFAULT_AUTHORITY[model] : 'full');

  const capped = model === 'renter' || model === 'contractor';
  const ceiling = input.policy?.maxProviderAuthority;
  if (!capped && ceiling && !authorityAtLeast(ceiling, base)) return ceiling;
  return base;
}

export type DecisionVerdict =
  | { allowed: true; via: 'manager' | 'authority' | 'approved_reason' }
  | { allowed: false; reason: string; raiseRequest: boolean };

/**
 * May THIS person answer THIS booking THIS way, for THIS reason?
 *
 * A refusal is never a dead end: raiseRequest tells the caller that the honest
 * next step is to put it in front of a manager, which is the difference
 * between "you may not" and "here is how this gets solved."
 */
export function evaluateDecision(
  input: AuthorityInput & { decision: 'accept' | 'decline'; reasonCode?: string | null },
): DecisionVerdict {
  if (input.decision === 'accept') {
    return { allowed: true, via: input.isManager ? 'manager' : 'authority' };
  }
  if (input.isManager) return { allowed: true, via: 'manager' };

  const authority = resolveAuthority(input);
  if (authority === 'full') return { allowed: true, via: 'authority' };

  if (authority === 'none') {
    return {
      allowed: false,
      raiseRequest: true,
      reason: 'This booking is assigned to you. Report an issue and a manager will pick it up.',
    };
  }

  if (authority === 'request_approval') {
    return {
      allowed: false,
      raiseRequest: true,
      reason: 'Your issue goes to a manager, who will decline or reassign it.',
    };
  }

  const allowedCodes = input.policy?.autoDeclineCodes || DEFAULT_AUTO_CODES;
  const code = String(input.reasonCode || '');
  const known = REASONS_BY_CODE[code];
  if (!code || !known) {
    return { allowed: false, raiseRequest: true, reason: 'Pick a reason so this can be handled properly.' };
  }
  if (known.resolution === 'auto' && allowedCodes.includes(code)) {
    return { allowed: true, via: 'approved_reason' };
  }
  return {
    allowed: false,
    raiseRequest: true,
    reason: `"${known.label}" needs a manager. It will be sent for review.`,
  };
}
