/**
 * staff-notify — one shape for "tell a person something happened to them".
 *
 * There was already a notifications collection and a bell in the portal, but
 * almost nothing wrote to it: three copies of a 'new_appointment' write inside
 * the client-portal booking pages, and nothing anywhere else. So accepting a
 * request never told the provider they now had a booking, raising an issue
 * never told a manager, and resolving one never told the provider who raised
 * it. People found out by happening to look.
 *
 * The shape below matches what the portal's bell already reads, so nothing
 * needs migrating — this only makes the writes exist.
 */

import { addDoc, collection, type Firestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';

export type StaffNotificationKind =
  | 'appointment_assigned'
  | 'appointment_released'
  | 'appointment_issue_raised'
  | 'appointment_issue_resolved'
  | 'appointment_awaiting_you'
  | 'appointment_overdue';

/**
 * The only two kinds that reach past the app into someone's pocket. Everything
 * else writes a row and waits to be seen, which is the right default: a
 * channel that pings on routine events is a channel muted in week one, and
 * then the one message that mattered is muted too.
 */
export const ESCALATING_KINDS: StaffNotificationKind[] = [
  'appointment_issue_raised',
  'appointment_overdue',
];

export type StaffNotification = {
  userId: string;
  type: StaffNotificationKind;
  message: string;
  link?: string;
  appointmentId?: string | null;
};

export function buildStaffNotification(n: StaffNotification) {
  return {
    userId: n.userId,
    type: n.type,
    message: String(n.message).slice(0, 240),
    link: n.link || '/planner',
    appointmentId: n.appointmentId || null,
    createdAt: new Date().toISOString(),
    read: false,
  };
}

/**
 * Never throws and never blocks. A notification that fails to send must not
 * unwind a decision that already stands — the decision is the fact, this is
 * the courtesy.
 */
async function escalate(
  tenantId: string,
  notifications: StaffNotification[],
): Promise<void> {
  const worth = notifications.filter(n => ESCALATING_KINDS.includes(n.type));
  if (worth.length === 0) return;
  /* Grouped by message so five managers hearing the same thing is one call,
   * not five. */
  const groups = new Map<string, StaffNotification[]>();
  worth.forEach(n => {
    const key = `${n.type}|${n.message}|${n.link || ''}`;
    groups.set(key, [...(groups.get(key) || []), n]);
  });

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  try {
    const user = getAuth().currentUser;
    const token = user ? await user.getIdToken() : null;
    if (token) headers.Authorization = `Bearer ${token}`;
  } catch {
    /* the route answers 401 and the in-app rows still stand */
  }

  await Promise.all(Array.from(groups.values()).map(group => fetch('/api/notifications/staff', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      tenantId,
      kind: group[0].type,
      message: group[0].message,
      link: group[0].link || '/planner',
      userIds: group.map(g => g.userId),
    }),
  }).catch(() => undefined)));
}

export async function notifyStaff(
  firestore: Firestore | null | undefined,
  tenantId: string | null | undefined,
  notifications: StaffNotification[],
): Promise<void> {
  if (!firestore || !tenantId || !notifications?.length) return;
  const valid = notifications.filter(n => n && n.userId);
  if (valid.length === 0) return;

  await Promise.all(valid.map(n => addDoc(
    collection(firestore, `tenants/${tenantId}/notifications`),
    buildStaffNotification(n),
  ).catch(() => undefined)));

  /* The in-app row is the record; the text is the courtesy. A failure to
   * interrupt someone must never undo the row that already exists. */
  await escalate(tenantId, valid).catch(() => undefined);
}

/**
 * Everyone who should hear about something needing a manager.
 *
 * THE OWNER MIGHT NOT BE IN THE STAFF LIST. verifyStaffActor explicitly
 * handles a tenant owner with no staff document, which is proof that case is
 * real — and for that shop this used to return an empty array, so an issue was
 * raised into the void and nobody was ever told. A solo owner is exactly the
 * person who cannot afford to miss it.
 */
export function managerIds(
  staff: any[],
  exceptUid?: string | null,
  ownerUid?: string | null,
): string[] {
  const found = (staff || [])
    .filter((s: any) => s && s.id && s.active !== false)
    .filter((s: any) => ['owner', 'admin', 'manager'].includes(String(s.role || '')))
    .map((s: any) => String(s.id));

  const owner = String(ownerUid || '');
  if (owner && !found.includes(owner)) found.push(owner);

  const except = String(exceptUid || '');
  const out = found.filter(id => id && id !== except);
  return Array.from(new Set(out));
}
