/**
 * staff-identity — v1: the ONE place "which staff member is this" gets
 * resolved for messaging.
 *
 * WHY THIS EXISTS: the staff portal identifies people by PIN entry against
 * staff docs — staff do NOT have individual Firebase logins; the whole
 * team shares one studio login. But messaging originally keyed sender
 * identity off currentUser.uid (the Firebase login), so every message
 * sent from the portal carried the SAME senderId regardless of who was
 * actually typing — the conversation dialog literally could not tell
 * people apart, because the data said one person sent everything.
 *
 * The fix: when someone PINs into the portal, their verified staff id is
 * stored PER-TAB (sessionStorage — survives navigation to /messages in
 * the same tab, but is NOT shared across tabs: two staff PIN'd into two
 * tabs of the same browser each keep their own identity. localStorage
 * was the v1 choice and caused exactly that bug — one browser, two
 * staff, whoever wrote last became everyone). The
 * messaging pages resolve identity as: stored PIN identity first,
 * Firebase uid as fallback. Owner/admin using their own desktop login
 * (whose staff doc id matches their auth uid) fall through to the uid
 * path unchanged.
 *
 * TRUST MODEL — being honest: sessionStorage identity is client-side trust,
 * spoofable by anyone with devtools. That is the SAME trust level as the
 * PIN system itself (a 4-digit code checked client-side) and the current
 * UI-only thread visibility. This does not weaken anything that exists;
 * it just doesn't strengthen it either. When Firestore security rules for
 * smsThreads/staffThreads get written (still pending), this is one of the
 * places to revisit.
 */

export const ACTIVE_STAFF_KEY = 'cf_active_staff_id';

export function resolveActiveStaffId(authUid?: string | null): string | null {
  if (typeof window !== 'undefined') {
    const stored = window.sessionStorage.getItem(ACTIVE_STAFF_KEY);
    if (stored) return stored;
  }
  return authUid || null;
}

export function setActiveStaffId(staffId: string) {
  if (typeof window !== 'undefined') window.sessionStorage.setItem(ACTIVE_STAFF_KEY, staffId);
}

export function clearActiveStaffId() {
  if (typeof window !== 'undefined') window.sessionStorage.removeItem(ACTIVE_STAFF_KEY);
}
