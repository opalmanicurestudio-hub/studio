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

export type ReasonGroup = 'service' | 'schedule' | 'client' | 'operational' | 'personal';

export type DeclineReason = {
  code: string;
  label: string;
  group: ReasonGroup;
  /** 'auto' may release the booking without a manager; 'manager' raises a request. */
  resolution: ReasonResolution;
  /** Built-in codes are stable across every shop; custom ones belong to one. */
  source?: 'builtin' | 'custom';
};

/**
 * CUSTOM REASONS, AND WHY THE CODE IS NOT THE LABEL
 *
 * This runs salons today and other trades tomorrow, so the wording below is
 * wrong somewhere by definition — "consultation" and "specialty" mean nothing
 * to a kitchen, and "client" is "guest" or "customer" depending on the room.
 * So a shop can rename any built-in, hide the ones that do not apply, and add
 * its own.
 *
 * What a shop cannot do is change what a CODE means. Built-in codes are the
 * stable spine: they are what a year of decision history is aggregated by, and
 * what the platform can reason about across tenants. Renaming
 * 'consultation_missing' to "Tasting not booked" keeps every past row
 * comparable; inventing a new meaning for that code would silently corrupt it.
 *
 * Custom codes are therefore namespaced. A shop's own reason is always
 * 'custom:<slug>' and can never collide with a built-in or be mistaken for one
 * in a report.
 */
export const CUSTOM_PREFIX = 'custom:';

export const isCustomReasonCode = (code: string): boolean =>
  String(code || '').startsWith(CUSTOM_PREFIX);

export const customReasonCode = (slug: string): string =>
  CUSTOM_PREFIX + String(slug || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);

export type TenantReason = {
  /** Stored with the custom: prefix. customReasonCode() puts it there. */
  code: string;
  label: string;
  group?: ReasonGroup;
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
  DECLINE_REASONS.reduce((acc, r) => { acc[r.code] = { ...r, source: 'builtin' }; return acc; }, {} as Record<string, DeclineReason>);

/**
 * The list this shop actually shows: built-ins minus anything hidden, renamed
 * where the shop has its own words, plus its own reasons. A custom reason with
 * no valid namespaced code is dropped rather than guessed at.
 */
export function resolveReasonList(policy?: AuthorityPolicy | null): DeclineReason[] {
  const hidden = new Set(policy?.hiddenReasonCodes || []);
  const labels = policy?.reasonLabels || {};

  const builtins: DeclineReason[] = DECLINE_REASONS
    .filter(r => !hidden.has(r.code))
    .map(r => ({ ...r, label: labels[r.code] || r.label, source: 'builtin' as const }));

  const custom: DeclineReason[] = (policy?.customReasons || [])
    .filter(r => r && isCustomReasonCode(r.code) && String(r.label || '').trim())
    .filter(r => !hidden.has(r.code))
    .map(r => ({
      code: r.code,
      label: String(r.label).trim().slice(0, 80),
      group: r.group || 'personal',
      resolution: r.resolution === 'auto' ? 'auto' : 'manager',
      source: 'custom' as const,
    }));

  return [...builtins, ...custom];
}

export function findReason(code: string, policy?: AuthorityPolicy | null): DeclineReason | null {
  return resolveReasonList(policy).find(r => r.code === code) || null;
}

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
  /** The shop's own reasons. Codes must be namespaced with custom:. */
  customReasons?: TenantReason[];
  /** Rename a built-in without changing what its code means. */
  reasonLabels?: Record<string, string>;
  /** Built-in or custom codes this trade has no use for. */
  hiddenReasonCodes?: string[];
  /** How long a provider has to answer a booking put in front of them. */
  providerResponseHours?: number;
  /** What the shop wants done when that runs out. Default: escalate. */
  overdueAction?: OverdueAction;
  /** Nudge this many minutes BEFORE the deadline. 0 = no nudge. */
  overdueReminderMinutes?: number;
  /** Auto-accept only for people at or above this authority. */
  autoAcceptMinAuthority?: DecisionAuthority;
};

/**
 * "Nobody answered" has two entirely different causes and one setting cannot
 * serve both.
 *
 *   escalate    — a provider has not looked at their phone. A person should
 *                 pick it up. This is the default because it is the only
 *                 option that cannot silently do something the shop did not
 *                 intend.
 *   auto_accept — the shop never really wanted a decision; approval is on for
 *                 deposit reasons and the acceptance step is ceremony.
 *   raise_issue — put it in the queue the shop already works from, so it is
 *                 handled the same way every other exception is.
 */
export type OverdueAction = 'escalate' | 'auto_accept' | 'raise_issue';

export const DEFAULT_OVERDUE_ACTION: OverdueAction = 'escalate';
export const DEFAULT_AUTO_ACCEPT_FLOOR: DecisionAuthority = 'limited';

export type OverduePlan =
  | { state: 'ok' }
  | { state: 'remind'; minutesLeft: number }
  | { state: 'act'; action: OverdueAction; downgraded: boolean };

/**
 * Auto-accepting on behalf of somebody who could never have declined is just
 * an assignment with extra steps, and it quietly turns the shop's own
 * authority model off. So a shop that asks for auto-accept gets it only for
 * people who had a real choice; everyone else escalates instead, which is the
 * safe direction to fail in.
 */
export function overduePlan(
  apt: any,
  policy: AuthorityPolicy | null | undefined,
  providerAuthority: DecisionAuthority,
  now?: Date,
): OverduePlan {
  const clock = responseClock(apt, policy, now);
  if (!clock) return { state: 'ok' };

  if (!clock.overdue) {
    const nudge = Number(policy?.overdueReminderMinutes ?? 0);
    if (nudge > 0 && clock.minutesLeft <= nudge) {
      return { state: 'remind', minutesLeft: clock.minutesLeft };
    }
    return { state: 'ok' };
  }

  const wanted = (policy?.overdueAction || DEFAULT_OVERDUE_ACTION) as OverdueAction;
  if (wanted !== 'auto_accept') return { state: 'act', action: wanted, downgraded: false };

  const floor = (policy?.autoAcceptMinAuthority || DEFAULT_AUTO_ACCEPT_FLOOR) as DecisionAuthority;
  if (authorityAtLeast(providerAuthority, floor)) {
    return { state: 'act', action: 'auto_accept', downgraded: false };
  }
  return { state: 'act', action: 'escalate', downgraded: true };
}

/**
 * THE PROVIDER'S CLOCK IS NOT THE CLIENT'S CLOCK.
 *
 * requestExpiresAt is a promise to the CLIENT: you will hear back within so
 * many hours or the time is released. This is a promise to the SHOP: this
 * booking will not sit unanswered on someone's screen all day. They run at
 * different lengths for different reasons, so this is derived from when the
 * request arrived rather than stored — one setting changes every open request
 * at once, and no document has to be rewritten.
 *
 * Zero or unset means no deadline, which is exactly today's behaviour.
 */
export function providerRespondBy(apt: any, policy?: AuthorityPolicy | null): Date | null {
  const hours = Number(policy?.providerResponseHours ?? 0);
  if (!Number.isFinite(hours) || hours <= 0) return null;
  const from = String(apt?.requestedAt || apt?.createdAt || '');
  const ms = from ? Date.parse(from) : NaN;
  if (!Number.isFinite(ms)) return null;
  const due = new Date(ms + hours * 3600000);
  /* Never ask someone to answer after the appointment has already started. */
  const startMs = apt?.startTime ? Date.parse(String(apt.startTime)) : NaN;
  if (Number.isFinite(startMs) && startMs < due.getTime()) return new Date(startMs);
  return due;
}

export type ResponseClock = { due: Date; overdue: boolean; minutesLeft: number } | null;

export function responseClock(apt: any, policy?: AuthorityPolicy | null, now?: Date): ResponseClock {
  const due = providerRespondBy(apt, policy);
  if (!due) return null;
  const ref = (now || new Date()).getTime();
  const minutesLeft = Math.round((due.getTime() - ref) / 60000);
  return { due, overdue: minutesLeft < 0, minutesLeft };
}

export type AuthorityInput = {
  isManager?: boolean;
  employmentModel?: EmploymentModel | null;
  decisionAuthority?: DecisionAuthority | null;
  /** The staff document's role. 'renter' predates employmentModel — see below. */
  role?: string | null;
  policy?: AuthorityPolicy | null;
};

/**
 * The staff portal has been reading `staffMember.role === 'renter'` since long
 * before employmentModel existed, and that value is live in real staff
 * documents today. Two fields meaning the same thing is how a person ends up
 * a renter on one screen and an employee on another, so employmentModel wins
 * where it is set and role fills the gap where it is not. Nothing has to be
 * migrated for the two to agree.
 */
export function effectiveEmploymentModel(input: {
  employmentModel?: EmploymentModel | null;
  role?: string | null;
}): EmploymentModel | null {
  if (input.employmentModel) return input.employmentModel;
  if (String(input.role || '') === 'renter') return 'renter';
  return null;
}

/**
 * The resolution order from the spec, top wins:
 *   business policy → work arrangement → provider setting → preference.
 * Preference never appears here on purpose: it is an input to MATCHING, not a
 * veto, and treating it as authority is how a preference quietly becomes a
 * hard restriction nobody configured.
 */
export function resolveAuthority(input: AuthorityInput): DecisionAuthority {
  if (input.isManager) return 'full';

  const model = effectiveEmploymentModel(input);
  const base: DecisionAuthority = input.decisionAuthority
    || (model ? DEFAULT_AUTHORITY[model] : 'full');

  const capped = model === 'renter' || model === 'contractor';
  const ceiling = input.policy?.maxProviderAuthority;
  if (!capped && ceiling && !authorityAtLeast(ceiling, base)) return ceiling;
  return base;
}

export type AppointmentIssue = {
  code: string;
  label: string;
  note?: string | null;
  raisedByUid: string;
  raisedByName: string;
  raisedAt: string;
  status: 'open' | 'resolved' | 'dismissed';
  resolvedByUid?: string | null;
  resolvedByName?: string | null;
  resolvedAt?: string | null;
  outcome?: 'reassigned' | 'declined' | 'kept' | 'other' | null;
};

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
  /* A shop's own reason resolves exactly like a built-in: the SHOP decides
   * whether it is self-service, and a custom reason marked auto must also be
   * on the approved list, so adding one is never enough on its own. */
  const known = findReason(code, input.policy);
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
