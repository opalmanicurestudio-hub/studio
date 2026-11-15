// src/lib/tell-managers.ts — A NOTICE FOR THE PEOPLE WHO RUN THE BUSINESS (server). The app's notification list shows a
// person the notices addressed to them, so one notice is written for each: the account's owner and every owner, admin
// and manager on the team who's still on it. A kind listed in lib/push-tier also buzzes their phones (each person's own
// settings decide: kinds turned off, quiet hours, away), at once for the kinds that need someone within minutes.
import { PUSH_TIER } from '@/lib/push-tier';

const ID = /^[A-Za-z0-9_-]{1,160}$/;
const off = (s: any) => !s || s.isActive === false || s.status === 'archived' || s.archived === true;

/** Who hears: the account's owner, and the team's owners, admins and managers. */
export async function managerIds(db: any, tenantId: string, tenant: any): Promise<string[]> {
  const ids = new Set<string>();
  if (ID.test(String(tenant?.userId || ''))) ids.add(String(tenant.userId));
  const snap = await db.collection(`tenants/${tenantId}/staff`).where('role', 'in', ['owner', 'admin', 'manager']).get().catch(() => ({ docs: [] as any[] }));
  for (const d of snap.docs) if (!off(d.data()) && ID.test(d.id)) ids.add(d.id);
  return Array.from(ids);
}

/** Writes the notice for each of them. Returns how many (-1 when the database didn't take them). Never throws: a
 *  notice must never undo what it's about. */
export async function tellManagers(db: any, tenantId: string, tenant: any, n: { type: string; message: string; link: string; priority?: 'high' | 'normal'; extra?: Record<string, unknown> }): Promise<number> {
  try {
    const ids = await managerIds(db, tenantId, tenant); if (!ids.length) return 0;
    const now = new Date().toISOString(); const b = db.batch();
    for (const userId of ids) {
      const r = db.collection(`tenants/${tenantId}/notifications`).doc();
      b.set(r, { id: r.id, userId, type: n.type, message: n.message.slice(0, 500), link: n.link, priority: n.priority || 'normal', read: false, createdAt: now, ...(n.extra || {}) });
    }
    try { await b.commit(); } catch { return -1; }
    if (PUSH_TIER[n.type] === 'now') { const { pushNow } = await import('@/lib/push'); await pushNow(db, tenantId).catch(() => undefined); }
    return ids.length;
  } catch { return -1; }
}
