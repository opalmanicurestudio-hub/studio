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

export type StaffNotificationKind =
  | 'appointment_assigned'
  | 'appointment_released'
  | 'appointment_issue_raised'
  | 'appointment_issue_resolved'
  | 'appointment_awaiting_you';

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
export async function notifyStaff(
  firestore: Firestore | null | undefined,
  tenantId: string | null | undefined,
  notifications: StaffNotification[],
): Promise<void> {
  if (!firestore || !tenantId || !notifications?.length) return;
  await Promise.all(notifications
    .filter(n => n && n.userId)
    .map(n => addDoc(
      collection(firestore, `tenants/${tenantId}/notifications`),
      buildStaffNotification(n),
    ).catch(() => undefined)));
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
