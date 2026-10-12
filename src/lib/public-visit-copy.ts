// src/lib/public-visit-copy.ts — what the client's visit link is allowed to see.
//
// appointmentCheckIns/{token} (and tenants/{t}/appointmentCheckIns/{token}) can be read by anyone holding the visit
// token, so the copy must never carry the whole appointment. Several writers used to store the full booking there —
// signed form answers, staff notes, inspiration photos, the client's phone and email, prices, override reasons.
// publicVisitCopy() is the ONE gate: a whitelist of what the visit page (and the few server routes that resolve a
// token through the copy) actually read. Anything not listed here never reaches the copy.
//
// It works for whole appointments AND for merge patches: it only emits keys present on the input (undefined is
// skipped, null passes through so "clear this" patches still clear), and leaves Firestore sentinel values alone.

/** Fields copied through unchanged when present. */
export const PUBLIC_VISIT_FIELDS = [
  // which visit / which business — how the link resolves
  'id', 'appointmentId', 'tenantId', 'clientId', 'checkInToken', 'shortCode',
  'walkInId', 'isWalkIn', 'source', 'groupId', 'groupIndex', 'groupSize',
  // what and with whom
  'serviceId', 'serviceIds', 'serviceName', 'staffId', 'staffName',
  // when
  'startTime', 'endTime', 'duration', 'durationMinutes', 'estimatedDuration',
  // where it is up to (status, stage, the public timeline)
  'status', 'checkInStatus', 'checkInStatusTimestamp', 'checkedInAt', 'stage', 'stageLabel', 'label', 'flags',
  'paymentStatus', 'timelinePublic', 'timelineShowTimes', 'visitUpdatedAt', 'updatedAt', 'createdAt',
  // their own deposit
  'depositStatus', 'depositAmountCents',
  // running late / provider delay / disruptions — the cards the client answers
  'disruption', 'providerDelay', 'providerLateMinutes', 'providerOffer', 'lateReply', 'lateChoices', 'lateTimeMinutes',
  'etaAt', 'studioAskedToMove', 'studioAskedToMoveAt', 'soonerOn', 'clientConfirmedAt', 'clientConfirmedVia',
  // cancelled / moved
  'cancelledAt', 'cancellationReason', 'cancelledBy', 'studioCancelled', 'rescheduledAt',
  // in person / video / phone
  'place', 'meetingLink',
  // the completion gate, reviews, the waiting room
  'requiredFormIds', 'requiredResourceIds', 'completionLinkFirstViewedAt', 'reviewSubmittedAt',
] as const;

/** Keys the copy may hold: the fields above plus the derived ones publicVisitCopy writes itself. */
export const PUBLIC_VISIT_KEYS: ReadonlySet<string> = new Set<string>([...PUBLIC_VISIT_FIELDS, 'clientName', 'clientFirst', 'signedForms']);

const firstName = (v: any) => String(v ?? '').trim().split(/\s+/)[0] || '';

/** Signed forms, minus their answers: which form, and when. */
export function publicSignedForms(list: any): { formId: string; signedAt: string | null }[] {
  if (!Array.isArray(list)) return [];
  return list.filter((f) => f && typeof f === 'object' && (f.formId || f.id))
    .map((f) => ({ formId: String(f.formId || f.id).slice(0, 120), signedAt: f.signedAt ? String(f.signedAt) : null }))
    .slice(0, 20);
}

/** True when signedForms is already in the sanitized shape. */
const signedFormsClean = (list: any) => !Array.isArray(list)
  || list.every((f) => f && typeof f === 'object' && Object.keys(f).every((k) => k === 'formId' || k === 'signedAt'));

/** The visit-link-safe projection of an appointment (or of a patch to one). */
export function publicVisitCopy(a: any): Record<string, any> {
  const out: Record<string, any> = {};
  if (!a || typeof a !== 'object') return out;
  for (const k of PUBLIC_VISIT_FIELDS) if (a[k] !== undefined) out[k] = a[k];
  // Name: the first name only — it is all the page greets them with.
  if (a.clientName !== undefined || a.clientFirst !== undefined) {
    const first = firstName(a.clientFirst ?? a.clientName);
    out.clientFirst = first || null;
    out.clientName = first || null;
  }
  if (a.signedForms !== undefined) out.signedForms = a.signedForms === null ? null : publicSignedForms(a.signedForms);
  return out;
}

/** Keys on a stored copy that should not be there (anything outside the whitelist). */
export function strayVisitKeys(copy: any): string[] {
  if (!copy || typeof copy !== 'object') return [];
  return Object.keys(copy).filter((k) => !PUBLIC_VISIT_KEYS.has(k));
}

/**
 * The patch that cleans a stored copy: every stray key deleted, signed forms reduced to { formId, signedAt },
 * a full name cut to the first. Returns null when the copy is already clean.
 * `del` is the delete sentinel (FieldValue.delete() on the server).
 */
export function scrubVisitPatch(copy: any, del: () => any): Record<string, any> | null {
  if (!copy || typeof copy !== 'object') return null;
  const patch: Record<string, any> = {};
  for (const k of strayVisitKeys(copy)) patch[k] = del();
  if (copy.signedForms !== undefined && copy.signedForms !== null && !signedFormsClean(copy.signedForms)) patch.signedForms = publicSignedForms(copy.signedForms);
  if (typeof copy.clientName === 'string' && copy.clientName.trim() !== firstName(copy.clientName)) { patch.clientName = firstName(copy.clientName) || null; patch.clientFirst = firstName(copy.clientName) || null; }
  return Object.keys(patch).length ? patch : null;
}
