// src/lib/request-actor.ts — WHO IS ASKING, for server routes the staff portal and the app both call.
// The app signs in with the person's own account (uid = their staff id, or the owner's account); the staff portal signs
// in as portal:{tenant}:{staffId}. Either way: their staff id, name, role and whether they manage the business.
import { getAdminAuth } from '@/lib/firebase-admin';

export type RequestActor = { staffId: string; name: string; role: string; isManager: boolean; isOwner: boolean; portal: boolean };
const MANAGERS = ['owner', 'admin', 'manager'];

export async function requestActor(db: any, authHeader: string | null, tenantId: string): Promise<{ ok: true; actor: RequestActor } | { ok: false; error: string; status: number }> {
  const token = String(authHeader || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return { ok: false, error: 'Please sign in again.', status: 401 };
  let uid = '';
  try { uid = (await getAdminAuth().verifyIdToken(token)).uid; } catch { return { ok: false, error: 'Please sign in again.', status: 401 }; }
  const portal = /^portal:([^:]+):(.+)$/.exec(uid);
  const selfId = portal ? (portal[1] === tenantId ? portal[2] : '') : uid;
  if (!selfId) return { ok: false, error: 'That sign-in is for another business.', status: 403 };
  const [tSnap, meSnap] = await Promise.all([db.doc(`tenants/${tenantId}`).get(), db.doc(`tenants/${tenantId}/staff/${selfId}`).get()]);
  const me: any = meSnap.exists ? meSnap.data() : null; const isOwner = !portal && (tSnap.data() as any)?.userId === uid;
  if (!me && !isOwner) return { ok: false, error: 'You’re not on this team.', status: 403 };
  const role = String(me?.role || (isOwner ? 'owner' : 'staff'));
  return { ok: true, actor: { staffId: selfId, name: String(me?.name || (isOwner ? 'The owner' : 'A team member')), role, isManager: isOwner || MANAGERS.includes(role), isOwner, portal: !!portal } };
}
