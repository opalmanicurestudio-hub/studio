// src/lib/complaint-texts.ts — A CLIENT TEXTS IN AND IT SOUNDS LIKE A COMPLAINT. Called by both text listeners (the
// business's texting number and the voice/text agent's number). Finds the client by phone; if the words sound like a
// complaint (lib/complaint-detect) and they don't already have an open case, the desk and managers get a notice with
// "Start a case" — the case form opens with the client, their latest visit and their words filled in. Nothing is opened
// automatically. A renter's client goes to that renter instead.
import { soundsLikeComplaint } from '@/lib/complaint-detect';

const last10 = (v: any) => String(v || '').replace(/\D/g, '').slice(-10);
const MANAGERS = ['owner', 'admin', 'manager'];

/** Find the client a phone number belongs to (studio clients first; a renter's client is marked as theirs). */
export async function clientByPhone(db: any, tenantId: string, phone: string): Promise<any | null> {
  const d = last10(phone); if (d.length !== 10) return null;
  const variants = [...new Set([phone, `+1${d}`, d, `1${d}`, `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`, `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`])].slice(0, 10);
  const snap = await db.collection(`tenants/${tenantId}/clients`).where('phone', 'in', variants).limit(5).get();
  const rows = snap.docs.map((x: any) => ({ id: x.id, ...(x.data() || {}) }));
  return rows.find((c: any) => !c.ownerRenterId) || rows[0] || null;
}

/** Record what a client's text is about; returns the hint when it was flagged. */
export async function flagClientText(db: any, tenantId: string, tenant: any, o: { from: string; body: string; inboxId: string }) {
  const hint = soundsLikeComplaint(o.body); if (!hint.match) return null;
  const client = await clientByPhone(db, tenantId, o.from); if (!client) return null;
  const inbox = db.doc(`tenants/${tenantId}/smsInbox/${o.inboxId}`);
  await inbox.set({ clientId: client.id, clientName: client.name || null, complaint: { safety: hint.safety, words: hint.words } }, { merge: true });
  const open = (await db.collection(`tenants/${tenantId}/cases`).where('clientId', '==', client.id).get()).docs.map((x: any) => x.data() || {}).filter((c: any) => !c.locked);
  const first = String(client.name || 'A client').split(' ')[0];
  const staff = (await db.collection(`tenants/${tenantId}/staff`).get()).docs.map((x: any) => ({ id: x.id, ...(x.data() || {}) })).filter((s: any) => s.archived !== true && s.isActive !== false);
  const renterId = client.ownerRenterId ? staff.find((s: any) => s.id === client.ownerRenterId || s.renterId === client.ownerRenterId)?.id : null;
  const to: string[] = renterId ? [renterId] : [...new Set([tenant?.userId, ...staff.filter((s: any) => MANAGERS.includes(String(s.role)) || s.role === 'front_desk').map((s: any) => s.id)].filter(Boolean))] as string[];
  const quote = `“${String(o.body).slice(0, 120)}${o.body.length > 120 ? '…' : ''}”`;
  const msg = open.length ? `${first} texted about their open case: ${quote}` : `${first} texted something that sounds like a complaint${hint.safety ? ' — possibly a safety concern' : ''}: ${quote}`;
  const link = open.length && !renterId ? `/cases?id=${open[0].id || ''}` : renterId ? '' : `/cases?start=text&inbox=${o.inboxId}`;
  const b = db.batch(); const now = new Date().toISOString();
  for (const u of to) { const r = db.collection(`tenants/${tenantId}/notifications`).doc(); b.set(r, { id: r.id, userId: u, type: hint.safety ? 'case_safety' : 'case_hint', title: hint.safety ? 'Possible safety concern' : 'Sounds like a complaint', message: msg, link, clientId: client.id, inboxId: o.inboxId, createdAt: now, read: false }); }
  await b.commit();
  return { ...hint, clientId: client.id, openCase: open.length > 0 };
}
