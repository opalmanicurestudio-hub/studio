// src/lib/manager-pin.ts — A MANAGER OKAYS IT (server): one signed in or working at the screen, or their PIN typed there,
// checked with the same lockout as any PIN (lib/pin). Used by the counter and the drive-thru (api/counter) and the
// curbside screen (api/curbside) for what only a manager lets through: an allergy the kitchen hasn't noted, a bag that
// won't scan.
import { beginPinAttempt, endPinAttempt, findStaffByPin, validPin } from '@/lib/pin';

const ID = /^[A-Za-z0-9_-]{1,160}$/;
const MANAGER_ROLES = ['owner', 'admin', 'manager'];

/** A manager okays it: one signed in or working here, or their PIN typed on this screen (checked with the same lockout
 *  as any PIN, lib/pin). No PIN typed and no manager here: approver null, for the step to ask. */
export async function managerFor(db: any, tenantId: string, staff: { id: string; name: string } | null, pinIn: unknown):
  Promise<{ approver: { id: string; name: string } | null; error?: string; status?: number; notManager?: boolean }> {
  if (staff && await isManager(db, tenantId, staff.id)) return { approver: staff };
  if (pinIn === undefined || pinIn === null || pinIn === '') return { approver: null };
  const pin = String(pinIn); if (!validPin(pin)) return { approver: null, error: 'Enter a 4-digit PIN.', status: 400 };
  const ticket = await beginPinAttempt(db, tenantId); if (ticket === null) return { approver: null, error: 'Too many wrong PINs. Wait 15 minutes, or ask a manager.', status: 423 };
  const hit = await findStaffByPin(db, tenantId, pin); await endPinAttempt(db, tenantId, ticket, !!hit);
  if (!hit) return { approver: null, error: 'That PIN isn’t right.', status: 403 };
  if (!(await isManager(db, tenantId, hit.id))) return { approver: null, error: 'That isn’t a manager’s PIN.', notManager: true };
  return { approver: { id: hit.id, name: String(hit.name || 'A manager').slice(0, 60) } };
}

/** Someone a manager here (their own team record says so). */
export async function isManager(db: any, tenantId: string, staffId: string | null): Promise<boolean> {
  if (!staffId || !ID.test(staffId)) return false;
  const [st, t] = await Promise.all([db.doc(`tenants/${tenantId}/staff/${staffId}`).get(), db.doc(`tenants/${tenantId}`).get()]);
  const s: any = st.data() || {}; const tn: any = t.data() || {};
  if (s.isActive === false || s.archived === true || s.status === 'archived') return false;
  return MANAGER_ROLES.includes(String(s.role || '')) || s.isManager === true || (tn.ownerId && tn.ownerId === staffId);
}
