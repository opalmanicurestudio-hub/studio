// src/lib/renter-inbox.ts — A RENTER'S CLIENTS' REPLIES GO TO THE RENTER (design canvas RF5).
// Texts to a renter's clients go from the studio's number, signed by the renter. A reply finds its way back by:
//   1. whoever texted that number last in the past 14 days (a renter's text carries renterId in the message log, or is
//      about one of their bookings, or is one of their own kinds of message);
//   2. otherwise, whose client it is: a number that only belongs to a renter's own client goes to that renter;
//   3. otherwise, the studio.
// Routed replies are kept in tenants/{t}/renterInbox (server-only) with the renter's own sent texts, so the renter sees
// one conversation. The studio never reads them; it only keeps a daily count. STOP and HELP always stay with the studio.
const DAY = 864e5;
const ms = (v: any) => (typeof v === 'string' ? Date.parse(v) || 0 : v?.toDate ? v.toDate().getTime() : Number(v) || 0);
export const last10 = (v: any) => String(v || '').replace(/\D+/g, '').slice(-10);
const e164 = (v: any) => { const d = last10(v); return d.length === 10 ? `+1${d}` : ''; };

export type ReplyOwner = { owner: 'studio' } | { owner: 'renter'; renterId: string; staffId: string | null; clientId: string | null; clientName: string | null };

async function renterOfStaff(db: any, t: string, staffId: string): Promise<string | null> {
  try { const st: any = (await db.doc(`tenants/${t}/staff/${staffId}`).get()).data() || {}; return (st.role === 'renter' || st.isRenter) && st.renterId ? String(st.renterId) : null; } catch { return null; }
}
async function staffOfRenter(db: any, t: string, renterId: string): Promise<string | null> {
  try { const s = await db.collection(`tenants/${t}/staff`).where('renterId', '==', renterId).limit(1).get(); return s.empty ? null : s.docs[0].id; } catch { return null; }
}

/** Who a reply from this number belongs to. */
export async function replyOwner(db: any, t: string, phone: string, now = Date.now()): Promise<ReplyOwner> {
  const to = e164(phone); if (!to) return { owner: 'studio' };
  const T = `tenants/${t}`;
  const logs = (await db.collection(`${T}/messageLog`).where('to', '==', to).get().catch(() => ({ docs: [] }))).docs
    .map((d: any) => d.data() || {}).filter((m: any) => m.channel !== 'email' && now - ms(m.sentAt) < 14 * DAY && !String(m.kind || '').startsWith('renter_self_'))
    .sort((a: any, b: any) => ms(b.sentAt) - ms(a.sentAt));
  const lastMsg = logs[0];
  if (lastMsg) {
    let renterId: string | null = lastMsg.renterId ? String(lastMsg.renterId) : null;
    if (!renterId && lastMsg.appointmentId) {
      try { const a: any = (await db.doc(`${T}/appointments/${lastMsg.appointmentId}`).get()).data() || {}; if (a.isRenterBooking && a.staffId) renterId = await renterOfStaff(db, t, String(a.staffId)); } catch { /* studio */ }
    }
    if (!renterId && String(lastMsg.kind || '').startsWith('renter_') && lastMsg.recipientId) {
      try { const c: any = (await db.doc(`${T}/clients/${lastMsg.recipientId}`).get()).data() || {}; if (c.ownerRenterId) renterId = String(c.ownerRenterId); } catch { /* studio */ }
    }
    if (!renterId) return { owner: 'studio' };
    const c = await clientFor(db, t, to, renterId);
    return { owner: 'renter', renterId, staffId: await staffOfRenter(db, t, renterId), clientId: c?.id || null, clientName: c?.name || null };
  }
  // Nobody wrote lately: whose client is it? Only when the number belongs to a renter's client and not the studio's.
  const all = await clientsByPhone(db, t, to);
  if (!all.length || all.some((c: any) => !c.ownerRenterId)) return { owner: 'studio' };
  const owners = [...new Set(all.map((c: any) => String(c.ownerRenterId)))]; if (owners.length !== 1) return { owner: 'studio' };
  const c = all[0];
  return { owner: 'renter', renterId: owners[0], staffId: await staffOfRenter(db, t, owners[0]), clientId: String(c.id), clientName: c.name || null };
}
async function clientsByPhone(db: any, t: string, to: string): Promise<any[]> {
  const d = last10(to); const variants = [to, d, `1${d}`, `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`, `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`];
  const s = await db.collection(`tenants/${t}/clients`).where('phone', 'in', variants).get().catch(() => ({ docs: [] }));
  return s.docs.map((x: any) => ({ id: x.id, ...(x.data() || {}) })).filter((c: any) => !c.archived && c.status !== 'archived');
}
async function clientFor(db: any, t: string, to: string, renterId: string) {
  const all = await clientsByPhone(db, t, to); return all.find((c: any) => String(c.ownerRenterId || '') === renterId) || null;
}

/** A reply that belongs to a renter: into their inbox, and a short alert by the channel they chose (at most one every
 * 20 minutes per client, so a chatty conversation doesn't buzz them for every line). */
export async function routeToRenter(db: any, t: string, o: Extract<ReplyOwner, { owner: 'renter' }>, phone: string, body: string, mediaCount: number, now = Date.now()) {
  const T = `tenants/${t}`; const at = new Date(now).toISOString();
  const ref = db.collection(`${T}/renterInbox`).doc();
  await ref.set({ id: ref.id, renterId: o.renterId, staffId: o.staffId, clientId: o.clientId, clientName: o.clientName, phone: e164(phone), direction: 'in', body: body || null, mediaCount, at, read: false });
  const day = at.slice(0, 10);
  await db.doc(`${T}/private/renterRouting`).set({ [day]: (await db.doc(`${T}/private/renterRouting`).get().then((s: any) => Number((s.data() || {})[day]) || 0).catch(() => 0)) + 1 }, { merge: true }).catch(() => {});
  const key = `${o.renterId}_${last10(phone)}`; const mark = db.doc(`${T}/private/renterInboxAlerts`);
  const seen: any = (await mark.get().catch(() => null))?.data?.() || {};
  if (now - ms(seen[key]) < 20 * 60e3) return { ok: true, alerted: false };
  await mark.set({ [key]: at }, { merge: true });
  const { notifyRenter, renterPortalUrl } = await import('@/lib/renter-comms');
  const who = o.clientName ? String(o.clientName).split(' ')[0] : 'A client';
  await notifyRenter(db, t, o.renterId, 'client_replies', `${who} replied: “${String(body || 'a photo').slice(0, 120)}”`, { tone: 'slate', tab: 'book', link: (await renterPortalUrl(db, t)) || undefined });
  return { ok: true, alerted: true };
}

/** A text sent on a renter's behalf: kept in their conversation too. Called by the sender (lib/sms) when meta.renterId is set. */
export async function recordRenterSent(db: any, t: string, renterId: string, to: string, body: string, meta: { clientId?: string | null; clientName?: string | null; kind?: string | null }, now = Date.now()) {
  try {
    const ref = db.collection(`tenants/${t}/renterInbox`).doc();
    await ref.set({ id: ref.id, renterId, clientId: meta.clientId || null, clientName: meta.clientName || null, phone: e164(to), direction: 'out', kind: meta.kind || null, body: String(body || '').slice(0, 1600), at: new Date(now).toISOString(), read: true });
  } catch { /* the text itself already went */ }
}

/** The renter's conversations: newest first, one per number, with the messages. */
export async function renterThreads(db: any, t: string, renterId: string, now = Date.now()) {
  const rows = (await db.collection(`tenants/${t}/renterInbox`).where('renterId', '==', renterId).get()).docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) }))
    .filter((m: any) => now - ms(m.at) < 120 * DAY).sort((a: any, b: any) => ms(a.at) - ms(b.at));
  const by = new Map<string, any>();
  for (const m of rows) { const k = last10(m.phone); if (!k) continue; const th = by.get(k) || { key: k, phone: m.phone, clientId: null, clientName: null, messages: [], unread: 0, lastAt: '' };
    th.clientId = th.clientId || m.clientId || null; th.clientName = th.clientName || m.clientName || null;
    th.messages.push({ id: m.id, direction: m.direction, body: m.body, at: m.at, kind: m.kind || null }); if (m.direction === 'in' && !m.read) th.unread++; th.lastAt = m.at; by.set(k, th); }
  return [...by.values()].sort((a, b) => ms(b.lastAt) - ms(a.lastAt)).map((th) => ({ ...th, messages: th.messages.slice(-60) }));
}
