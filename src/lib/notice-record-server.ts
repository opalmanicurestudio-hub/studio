// src/lib/notice-record-server.ts — LOADS A RENTER'S NOTICE RECORD (lib/notice-record) ON THE SERVER, and records when
// they open a notice in their portal. Server only.
import { buildNoticeRecord, belongsToRenter, type NoticeItem } from './notice-record';

/** Their message log entries (by id, and by their email or phone for a renter message), and their conversation. */
export async function loadRenterNotices(db: any, tenantId: string, renterId: string, renter?: any): Promise<{ items: NoticeItem[]; rows: any[]; thread: any[]; renter: any }> {
  const r = renter || ((await db.doc(`tenants/${tenantId}/renters/${renterId}`).get()).data() || {});
  const col = db.collection(`tenants/${tenantId}/messageLog`);
  // Each pull is capped: a renter's record is hundreds of messages at most, and this runs on every portal visit.
  const CAP = 600;
  const pulls: Promise<any>[] = [col.where('recipientId', '==', renterId).limit(CAP).get()];
  const email = String(r.email || '').trim();
  const addrs = new Set<string>();
  if (email) { addrs.add(email); addrs.add(email.toLowerCase()); }
  const d = String(r.phone || '').replace(/\D/g, '');
  if (d.length >= 10) { addrs.add(d.length === 10 ? `+1${d}` : `+${d}`); addrs.add(String(r.phone)); }
  for (const a of addrs) pulls.push(col.where('to', '==', a).limit(CAP).get());
  const [threadSnap, ...snaps] = await Promise.all([
    db.collection(`tenants/${tenantId}/renterThreads/${renterId}/messages`).limit(CAP).get().catch(() => ({ docs: [] })),
    ...pulls.map((p) => p.catch(() => ({ docs: [] }))),
  ]);
  const found = new Map<string, any>();
  for (const s of snaps) for (const doc of s.docs) found.set(doc.id, { id: doc.id, ...(doc.data() || {}) });
  // Someone else who shares their email or phone (another renter) never has their messages shown here: an entry at
  // their address that names someone else is checked against the business's renters (usually none to check).
  const named = [...new Set([...found.values()].map((x) => String(x.recipientId || '')).filter((id) => id && id !== String(renterId)))].slice(0, 50);
  const others = new Set<string>();
  await Promise.all(named.map(async (id) => { try { if ((await db.doc(`tenants/${tenantId}/renters/${id}`).get()).exists) others.add(id); } catch { others.add(id); } }));
  const byId = new Map<string, any>();
  for (const x of found.values()) if (belongsToRenter(x, renterId, r, others)) byId.set(String(x.id), x);
  const rows = [...byId.values()];
  const thread = threadSnap.docs.map((doc: any) => ({ id: doc.id, ...(doc.data() || {}) }));
  const name = `${String(r.firstName || '').trim()} ${String(r.lastName || '').trim()}`.trim() || null;
  return { items: buildNoticeRecord({ rows, thread, renterName: name }), rows, thread, renter: r };
}

/** They opened it in their portal: the first time is kept on each copy (message log entries keep their words; only
 *  the time they were seen is added). Only an item on their own record. */
export async function markNoticeSeen(db: any, tenantId: string, renterId: string, itemId: string, now = new Date()): Promise<{ ok: boolean; seenAt?: string }> {
  const { items } = await loadRenterNotices(db, tenantId, renterId);
  const { forRenter } = await import('./notice-record');
  const item = forRenter(items).find((i) => i.id === String(itemId || ''));
  if (!item) return { ok: false };
  if (item.portalSeenAt) return { ok: true, seenAt: item.portalSeenAt };
  const at = now.toISOString();
  for (const c of item.copies) {
    if (!c.logId) continue;
    const ref = db.doc(`tenants/${tenantId}/messageLog/${c.logId}`);
    try {
      await db.runTransaction(async (tx: any) => {
        const cur: any = (await tx.get(ref)).data() || null;
        if (cur && !cur.portalSeenAt) tx.set(ref, { portalSeenAt: at }, { merge: true });
      });
    } catch { /* the next open records it */ }
  }
  return { ok: true, seenAt: at };
}
