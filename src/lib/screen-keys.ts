// src/lib/screen-keys.ts — A TEAM SCREEN'S OWN KEY (server): the kitchen screen and the floor board run on tablets nobody
// stays signed in on. A manager sets one up once (api/kitchen 'pair'); from then on it carries a key, kept here only as
// its fingerprint in kitchenScreens/{sha256(key)} at the top of the database, where no browser can read or write. A PIN
// on the screen gives a pass (api/kitchen 'pin') that puts a name on what's done for 12 hours. A team member signed in on
// their own device can use the same steps with no key, under their own name.
import { createHash } from 'crypto';
import { requireRole } from '@/lib/route-guard';

export const screenHash = (k: string) => createHash('sha256').update(String(k)).digest('hex');
const ID = /^[A-Za-z0-9_-]{1,160}$/;

/** What a screen was set up as: the kitchen screen, a floor board, a drive-thru lane, or the drive-thru's outdoor order
 *  board (which only ever shows the order at the speaker). A screen set up before kinds existed is a kitchen screen. */
export type ScreenKind = 'kitchen' | 'floor' | 'drive-thru' | 'drive-thru-board';
export type Screen = { ref: any; name: string; kind: ScreenKind; passes: Record<string, { id: string; name: string; exp: number }> };

/** The screen this key belongs to (for this business only), or null. Seen-at is kept, at most every few minutes. */
export async function screenOf(db: any, tenantId: string, key: unknown): Promise<Screen | null> {
  const k = String(key || '');
  if (k.length < 32 || k.length > 200) return null;
  const ref = db.doc(`kitchenScreens/${screenHash(k)}`);
  const s: any = (await ref.get()).data();
  if (!s || s.revokedAt || s.tenantId !== tenantId) return null;
  if (!s.lastSeenAt || Date.now() - Date.parse(s.lastSeenAt) > 5 * 60000) await ref.set({ lastSeenAt: new Date().toISOString() }, { merge: true }).catch(() => {});
  const kind: ScreenKind = ['floor', 'drive-thru', 'drive-thru-board'].includes(s.kind) ? s.kind : 'kitchen';
  return { ref, name: String(s.name || 'Kitchen'), kind, passes: (s.passes && typeof s.passes === 'object' ? s.passes : {}) as Screen['passes'] };
}

/** Who a pass (from 'pin') says is working, while it's good; otherwise nobody. */
export function staffOf(screen: { passes: Screen['passes'] }, pass: unknown): { id: string; name: string } | null {
  const p = String(pass || ''); if (p.length < 32 || p.length > 200) return null;
  const x = screen.passes[screenHash(p)];
  return x && Number(x.exp) > Date.now() ? { id: String(x.id), name: String(x.name) } : null;
}

/** Someone no longer on the team: switched off, or archived (either way it's written). */
export const offTeam = (st: any) => !st || st.isActive === false || st.status === 'archived' || st.archived === true;

/** A team member signed in on their own device, in place of a screen key: the business's own team only (not a renter,
 *  not someone switched off). The deny reply when they can't. */
export async function teamInstead(req: any, db: any, tenantId: string): Promise<{ member: { id: string; name: string } } | { deny: any; renter?: boolean }> {
  const g: any = await requireRole(req, tenantId, 'staff'); if (g.deny) return { deny: g.deny };
  if (g.actor?.isRenter) return { deny: null, renter: true };
  const me: any = ID.test(String(g.actor?.uid || '')) ? (await db.doc(`tenants/${tenantId}/staff/${g.actor.uid}`).get()).data() : null;
  if (me && offTeam(me)) return { deny: null, renter: true };
  return { member: { id: String(g.actor?.uid || ''), name: String(g.actor?.name || 'A team member').slice(0, 60) } };
}

/** Who's working, from a pass this server gave, and only while they're still on the team. */
export async function workingNow(db: any, tenantId: string, screen: Screen, pass: unknown): Promise<{ id: string; name: string } | null> {
  const s = staffOf(screen, pass); if (!s) return null;
  const st: any = ID.test(s.id) ? (await db.doc(`tenants/${tenantId}/staff/${s.id}`).get()).data() : null;
  return offTeam(st) ? null : s;
}
