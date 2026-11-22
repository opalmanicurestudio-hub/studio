// src/lib/money-rules-server.ts — WHO OKAYS IT, BY THE OWNER'S RULES (server; lib/money-rules; api/counter). For a money
// moment that takes someone (a manager, or only the owner), the person signed in counts when they're one; otherwise
// their PIN, typed on this screen, okays it for that moment only (it never changes who's signed in). Too many wrong PINs
// lock PINs here for a while (lib/pin), and that's a line in Activity, worth a look.
import { beginPinAttempt, endPinAttempt, findStaffByPin, validPin } from '@/lib/pin';
import { logMoney } from '@/lib/activity-server';
import type { ActivityWhere } from '@/lib/activity';
import type { Need } from '@/lib/money-rules';

const ID = /^[A-Za-z0-9_-]{1,160}$/;
const MANAGER_ROLES = ['owner', 'admin', 'manager'];
/** How long PINs stay locked after too many wrong ones (lib/pin). */
const LOCK_MS = 15 * 60000;
export type Okayer = { id: string; name: string };
export type OkayResult = { approver: Okayer | null; error?: string; status?: number; notEnough?: boolean };

/** What someone on the team is here: the owner, a manager, or neither (inactive or put away: neither). */
export async function rankOf(db: any, tenantId: string, staffId: string | null | undefined, tenant?: any): Promise<'owner' | 'manager' | null> {
  if (!staffId || !ID.test(staffId)) return null;
  const [st, t] = await Promise.all([db.doc(`tenants/${tenantId}/staff/${staffId}`).get(), tenant ? Promise.resolve(null) : db.doc(`tenants/${tenantId}`).get()]);
  const s: any = st.data() || {}; const tn: any = tenant || t?.data() || {};
  const owner = (tn.ownerId && tn.ownerId === staffId) || String(s.role || '') === 'owner';
  if (owner && s.isActive !== false) return 'owner';
  if (s.isActive === false || s.archived === true || s.status === 'archived') return null;
  return MANAGER_ROLES.includes(String(s.role || '')) || s.isManager === true ? 'manager' : null;
}
const enough = (rank: 'owner' | 'manager' | null, need: Need) => need === 'anyone' || (need === 'manager' ? rank === 'owner' || rank === 'manager' : rank === 'owner');

/** Who okays it: nobody needed (approver null, no error); the person signed in, when they're enough; or the one whose PIN
 *  was typed. `notEnough`: a right PIN, but not someone this takes. `where`: for a lockout's line in Activity. */
export async function okayFor(db: any, tenantId: string, staff: { id: string | null; name: string } | null, pinIn: unknown, need: Need, o: { where?: ActivityWhere; tenant?: any } = {}): Promise<OkayResult> {
  if (need === 'anyone') return { approver: null };
  if (staff?.id && enough(await rankOf(db, tenantId, staff.id, o.tenant), need)) return { approver: { id: staff.id, name: staff.name } };
  if (pinIn === undefined || pinIn === null || pinIn === '') return { approver: null, notEnough: true };
  const pin = String(pinIn); if (!validPin(pin)) return { approver: null, error: 'Enter a 4-digit PIN.', status: 400 };
  const ticket = await beginPinAttempt(db, tenantId);
  if (ticket === null) {
    // (One line for the lock, not one for each try while it's locked.)
    const noteRef = db.doc(`tenants/${tenantId}/private/pinLockNoted`); const nowMs = Date.now();
    const fresh = await db.runTransaction(async (tx: any) => {
      const last = Number(((await tx.get(noteRef)).data() || {}).at) || 0;
      if (nowMs - last < LOCK_MS) return false;
      tx.set(noteRef, { at: nowMs }); return true;
    }).catch(() => false);
    if (fresh) await logMoney(db, tenantId, { action: 'counter.pin_lockout', kind: 'pin', targetType: 'screen', summary: `PINs locked for 15 minutes after too many wrong ones${staff?.name ? `, at ${staff.name}’s screen` : ''}.`,
      where: o.where || 'counter', by: { id: staff?.id || null, name: staff?.name || 'A screen' } }, o.tenant);
    return { approver: null, error: 'Too many wrong PINs. Wait 15 minutes, or ask a manager.', status: 423 };
  }
  // (A right PIN of someone this doesn't take counts as a wrong one, so nobody can guess and then clear the count with their own.)
  const hit = await findStaffByPin(db, tenantId, pin); const ok = !!hit && enough(await rankOf(db, tenantId, hit.id, o.tenant), need);
  await endPinAttempt(db, tenantId, ticket, ok);
  if (!hit) return { approver: null, error: 'That PIN isn’t right.', status: 403 };
  if (!ok) return { approver: null, error: need === 'owner' ? 'That isn’t the owner’s PIN.' : 'That isn’t a manager’s PIN.', notEnough: true };
  return { approver: { id: hit.id, name: String(hit.name || (need === 'owner' ? 'The owner' : 'A manager')).slice(0, 60) } };
}
