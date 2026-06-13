// ─────────────────────────────────────────────────────────────────────────────
// appointment-requirements.ts — the requirements model + pure evaluation engine
//
// A "requirement" is anything a client must satisfy for an appointment to be
// ready: policy acknowledgement, deposit, card on file, consent forms, and now
// file/photo deliverables. Each requirement carries a DEADLINE and a CONSEQUENCE
// (what happens if it's not met), and the consequence can either auto-enforce or
// flag for the owner to decide — the business chooses per requirement.
//
// Pure TypeScript, ZERO imports — safe on client pages and server routes alike,
// the same as ledger.ts and deposit-policy.ts.
// ─────────────────────────────────────────────────────────────────────────────

export type RequirementType =
  | 'policy'
  | 'deposit'
  | 'card_on_file'
  | 'consent_form'
  | 'file_upload'
  | 'questionnaire';

// How hard the consequence bites.
export type ConsequenceLevel =
  | 'confirmation_blocking'   // slot isn't truly held until met (deposit/card/policy)
  | 'service_blocking'        // booking holds, but the work needs this (inspo/intake)
  | 'advisory';               // reminder only; staff proceeds regardless

// What actually happens when an unmet requirement passes its deadline.
export type ConsequenceAction =
  | 'release_slot'
  | 'forfeit_deposit'
  | 'auto_reschedule'
  | 'fee'
  | 'artist_choice'
  | 'flag'
  | 'none';

// Auto-enforce vs flag-for-review — set by the business, per requirement.
export type ConsequenceMode = 'auto' | 'flag';

// Per-appointment fulfilment state.
export type RequirementStatus = 'pending' | 'submitted' | 'accepted' | 'waived' | 'failed';

export interface RequirementDeadline {
  kind: 'at_booking' | 'hours_before' | 'none';
  hoursBefore?: number; // used when kind === 'hours_before'
}

export interface RequirementConsequence {
  level:   ConsequenceLevel;
  action:  ConsequenceAction;
  mode:    ConsequenceMode;
  message: string;        // plain-language, shown to the client AND used as the rule
  feeCents?: number;      // used when action === 'fee'
}

export interface FileRequirementConfig {
  prompt:        string;          // "Share 2–3 inspiration photos"
  minCount:      number;
  maxCount:      number;
  acceptedTypes: string[];        // e.g. ['image/*', 'application/pdf']
  needsReview:   boolean;         // owner must accept (true for files by default)
}

export interface SubmittedFile {
  name: string;
  url: string;
  uploadedAt: string;
}

export interface Requirement {
  id:        string;
  type:      RequirementType;
  label:     string;
  required:  boolean;
  deadline:  RequirementDeadline;
  consequence: RequirementConsequence;
  // type-specific config
  consentFormId?:     string;
  depositAmountCents?: number;
  file?:              FileRequirementConfig;
  // per-appointment instance state
  status?:      RequirementStatus;
  submittedAt?: string | null;
  acceptedAt?:  string | null;
  waivedBy?:    string | null;
  files?:       SubmittedFile[];
}

// ─── Sensible defaults per type ──────────────────────────────────────────────
// These seed a new requirement; the business can override any field.
export function defaultConsequence(type: RequirementType): RequirementConsequence {
  switch (type) {
    case 'deposit':
      return { level: 'confirmation_blocking', action: 'release_slot', mode: 'auto',
        message: 'A deposit is required to hold your appointment. Without it, your slot may be released.' };
    case 'card_on_file':
      return { level: 'confirmation_blocking', action: 'release_slot', mode: 'auto',
        message: 'A card on file is required to confirm your appointment.' };
    case 'policy':
      return { level: 'confirmation_blocking', action: 'release_slot', mode: 'auto',
        message: 'Please review and accept the policy to confirm your appointment.' };
    case 'consent_form':
      return { level: 'confirmation_blocking', action: 'flag', mode: 'flag',
        message: 'This form must be completed before we can begin your service.' };
    case 'file_upload':
      return { level: 'service_blocking', action: 'artist_choice', mode: 'flag',
        message: 'Please share your inspiration photos before your visit, or your design will be artist’s choice.' };
    case 'questionnaire':
      return { level: 'service_blocking', action: 'flag', mode: 'flag',
        message: 'Please complete the intake questions before your visit.' };
    default:
      return { level: 'advisory', action: 'none', mode: 'flag', message: '' };
  }
}

export function defaultDeadline(type: RequirementType): RequirementDeadline {
  switch (type) {
    case 'deposit':
    case 'card_on_file':
    case 'policy':
      return { kind: 'at_booking' };
    case 'file_upload':
    case 'questionnaire':
    case 'consent_form':
      return { kind: 'hours_before', hoursBefore: 24 };
    default:
      return { kind: 'none' };
  }
}

// ─── Status helpers ──────────────────────────────────────────────────────────
export function isRequirementMet(req: Requirement): boolean {
  return req.status === 'accepted' || req.status === 'waived';
}

// A submitted-but-not-yet-reviewed file requirement is "awaiting your review".
export function isAwaitingReview(req: Requirement): boolean {
  return req.type === 'file_upload' && req.status === 'submitted' && !!req.file?.needsReview;
}

export function outstandingRequirements(reqs: Requirement[] | undefined): Requirement[] {
  return (reqs || []).filter(r => r.required && !isRequirementMet(r));
}

export interface Readiness {
  total: number;
  met: number;
  outstanding: number;
  confirmationBlocking: number;  // outstanding & confirmation-blocking
  serviceBlocking: number;       // outstanding & service-blocking
  awaitingReview: number;
  isConfirmed: boolean;          // no confirmation-blocking requirement outstanding
  isReady: boolean;              // nothing required outstanding at all
}

export function appointmentReadiness(reqs: Requirement[] | undefined): Readiness {
  const list = reqs || [];
  const out = outstandingRequirements(list);
  const confirmationBlocking = out.filter(r => r.consequence.level === 'confirmation_blocking').length;
  const serviceBlocking      = out.filter(r => r.consequence.level === 'service_blocking').length;
  const awaitingReview       = list.filter(isAwaitingReview).length;
  const met = list.filter(isRequirementMet).length;
  return {
    total: list.length,
    met,
    outstanding: out.length,
    confirmationBlocking,
    serviceBlocking,
    awaitingReview,
    isConfirmed: confirmationBlocking === 0,
    isReady: out.length === 0,
  };
}

// ─── Deadline evaluation ─────────────────────────────────────────────────────
export interface DeadlineEvaluation {
  overdue: boolean;                 // past its deadline and not met
  shouldEnforce: boolean;           // overdue + required + mode 'auto'  → run the action
  shouldFlag: boolean;              // overdue + required + mode 'flag'   → surface for owner
  action: ConsequenceAction;
  level: ConsequenceLevel;
}

// hoursBefore is measured against the appointment start; at_booking is overdue
// immediately once unmet (it should have been satisfied during booking).
export function evaluateRequirement(
  req: Requirement,
  appointmentStart: any,
  now: Date = new Date()
): DeadlineEvaluation {
  const met = isRequirementMet(req);
  const idle: DeadlineEvaluation = { overdue: false, shouldEnforce: false, shouldFlag: false, action: 'none', level: req.consequence.level };
  if (met || !req.required) return idle;

  let overdue = false;
  if (req.deadline.kind === 'at_booking') {
    overdue = true; // unmet at-booking requirement is already past due
  } else if (req.deadline.kind === 'hours_before') {
    const start = toDate(appointmentStart);
    const dueAt = start.getTime() - (req.deadline.hoursBefore || 0) * 3_600_000;
    overdue = now.getTime() >= dueAt;
  } else {
    overdue = false; // 'none' never auto-triggers
  }

  if (!overdue) return idle;
  return {
    overdue: true,
    shouldEnforce: req.consequence.mode === 'auto',
    shouldFlag:    req.consequence.mode === 'flag',
    action: req.consequence.action,
    level:  req.consequence.level,
  };
}

// Instantiate an appointment's requirement list from a service's template,
// stamping each as pending. (Per-booking edits happen after this.)
export function instantiateRequirements(template: Requirement[] | undefined): Requirement[] {
  return (template || []).map(r => ({ ...r, status: 'pending', submittedAt: null, acceptedAt: null, waivedBy: null, files: [] }));
}

// ─── internals ───────────────────────────────────────────────────────────────
function toDate(val: any): Date {
  if (!val) return new Date(0);
  if (val instanceof Date) return val;
  if (typeof val === 'object' && typeof val.seconds === 'number') return new Date(val.seconds * 1000);
  const d = new Date(val);
  return isNaN(d.getTime()) ? new Date(0) : d;
}