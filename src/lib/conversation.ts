// src/lib/conversation.ts — ONE RECORD OF EVERY CONVERSATION WITH A CLIENT.
//
// Everything is sent from, and arrives at, the business (its number and its email), never a personal phone, so
// every word is on the record. This module links what arrives to the right client as it arrives, and assembles a
// client's whole history in one place:
//   • texts and emails we sent (messageLog: full text, who sent it, delivery status)
//   • texts and emails they sent (smsInbox: linked to the client on arrival, channel 'sms' | 'email')
//   • staff text threads (smsThreads/{id}/messages)
//   • calls (voiceCalls: recording, transcript, summary) and what the receptionist did (voiceInbox)
//   • notes (clientNotes), courtesies used (graceUses), cancellation decisions (cancellationEvents)
// Staff can read it and add to it; nobody can edit or delete it (firestore.rules: these are written by the server only).

const last10 = (v: any) => String(v || '').replace(/\D/g, '').slice(-10);
const rows = (snap: any) => (snap?.docs || []).map((d: any) => ({ id: d.id, ...(d.data() || {}) }));

/** The phone formats a client record might hold, for an exact-match lookup. */
export function phoneVariants(raw: any): string[] {
  const d = last10(raw); if (d.length !== 10) return [];
  return Array.from(new Set([d, `1${d}`, `+1${d}`, `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`, `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`, `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`, String(raw || '').trim()].filter(Boolean)));
}

/** Who is this number? The studio's own client book first (a renter's clients are the renter's). */
export async function clientByPhone(db: any, t: string, phone: any): Promise<{ id: string; name: string } | null> {
  const v = phoneVariants(phone); if (!v.length) return null;
  const found = rows(await db.collection(`tenants/${t}/clients`).where('phone', 'in', v.slice(0, 10)).limit(10).get())
    .filter((c: any) => last10(c.phone) === last10(phone) && c.status !== 'archived');
  const c = found.find((x: any) => !x.ownerRenterId) || found[0];
  return c ? { id: c.id, name: String(c.name || '') } : null;
}
export async function clientByEmail(db: any, t: string, email: any): Promise<{ id: string; name: string } | null> {
  const e = String(email || '').trim().toLowerCase(); if (!e.includes('@')) return null;
  const found = rows(await db.collection(`tenants/${t}/clients`).where('email', '==', e).limit(5).get());
  const c = found.find((x: any) => !x.ownerRenterId) || found[0];
  return c ? { id: c.id, name: String(c.name || '') } : null;
}

export type ConversationItem = {
  id: string; at: string; dir: 'in' | 'out' | 'note' | 'event';
  type: 'text' | 'email' | 'call' | 'note' | 'courtesy' | 'policy' | 'receptionist';
  who: string; text: string | null; subject?: string | null; status?: string | null; kind?: string | null;
  call?: { durationSeconds?: number | null; summary?: string | null; transcript?: string | null; recording?: boolean; sentiment?: string | null; direction?: string | null } | null;
  complaint?: any; meta?: any;
};

/** A client's whole history, oldest first. */
export async function conversationFor(db: any, t: string, client: any, o: { limit?: number; viewer?: { uid: string; manager: boolean } } = {}): Promise<ConversationItem[]> {
  const T = `tenants/${t}`; const id = String(client.id); const tel = last10(client.phone); const email = String(client.email || '').toLowerCase();
  const out: ConversationItem[] = [];
  const safe = async <X,>(f: () => Promise<X>, d: X) => { try { return await f(); } catch { return d; } };

  // What we sent.
  for (const m of await safe(async () => rows(await db.collection(`${T}/messageLog`).where('clientId', '==', id).limit(400).get()), [] as any[]))
    out.push({ id: `m_${m.id}`, at: m.sentAt || m.at, dir: 'out', type: m.channel === 'email' ? 'email' : 'text', meta: { channel: m.channel, seenAt: m.seenAt || null, pushedAt: m.pushedAt || null }, who: m.sentBy?.name || (m.kind === 'staff_message' ? 'Team' : 'Automatic'),
      text: m.body || m.preview || null, subject: m.subject || null, kind: m.kind || null,
      status: m.bouncedAt ? 'bounced' : m.openedAt ? 'opened' : m.deliveredAt ? 'delivered' : m.status || null });

  // What they sent: linked on arrival, plus older texts matched by number.
  const inbound = new Map<string, any>();
  for (const m of await safe(async () => rows(await db.collection(`${T}/smsInbox`).where('clientId', '==', id).limit(400).get()), [] as any[])) inbound.set(m.id, m);
  if (tel.length === 10) for (const m of await safe(async () => rows(await db.collection(`${T}/smsInbox`).orderBy('at', 'desc').limit(500).get()), [] as any[]))
    if (!m.clientId && last10(m.from) === tel) inbound.set(m.id, m);
  if (email) for (const m of await safe(async () => rows(await db.collection(`${T}/smsInbox`).where('fromEmail', '==', email).limit(200).get()), [] as any[])) inbound.set(m.id, m);
  for (const m of Array.from(inbound.values()))
    out.push({ id: `i_${m.id}`, at: m.at, dir: 'in', type: m.channel === 'email' ? 'email' : 'text', who: String(client.name || 'Client'), text: m.body || (m.mediaCount ? `${m.mediaCount} photo(s)` : null),
      subject: m.subject || null, complaint: m.complaint || null, meta: { inboxId: m.id, via: m.via || null, channel: m.channel || 'sms', unverified: !!m.unverifiedSender || !!m.webhookUnverified } });

  // Staff text threads.
  const threads = await safe(async () => {
    const a = rows(await db.collection(`${T}/smsThreads`).where('clientId', '==', id).limit(50).get());
    const b = tel.length === 10 ? rows(await db.collection(`${T}/smsThreads`).limit(300).get()).filter((x: any) => !x.clientId && last10(x.clientPhone) === tel) : [];
    return [...a, ...b];
  }, [] as any[]);
  for (const th of threads) for (const m of await safe(async () => rows(await db.collection(`${T}/smsThreads/${th.id}/messages`).limit(400).get()), [] as any[])) {
    if (m.loggedAs) continue;   // also in messageLog: shown once
    const inb = m.direction === 'inbound' || m.dir === 'in' || m.from === 'client';
    out.push({ id: `t_${th.id}_${m.id}`, at: m.at || m.createdAt || m.sentAt, dir: inb ? 'in' : 'out', type: 'text', who: inb ? String(client.name || 'Client') : (m.staffName || m.byName || m.by || 'Team'), text: m.body || m.text || null });
  }

  // Calls, and what the receptionist did.
  const calls = await safe(async () => {
    const a = rows(await db.collection(`${T}/voiceCalls`).where('clientId', '==', id).limit(200).get());
    const b = tel.length === 10 ? rows(await db.collection(`${T}/voiceCalls`).orderBy('startedAt', 'desc').limit(300).get()).filter((c: any) => !c.clientId && (last10(c.fromNumber) === tel || last10(c.toNumber) === tel)) : [];
    return [...a, ...b];
  }, [] as any[]);
  for (const c of calls)
    out.push({ id: `c_${c.id}`, at: c.startedAt || c.endedAt || c.createdAt, dir: c.direction === 'outbound' ? 'out' : 'in', type: 'call', who: c.direction === 'outbound' ? 'Receptionist' : String(client.name || 'Client'),
      text: c.summary || null, call: { durationSeconds: c.durationSeconds ?? null, summary: c.summary || null, transcript: c.transcript || null, recording: !!(c.recordingPath || c.recordingUrl), sentiment: c.sentiment || null, direction: c.direction || null }, meta: { callId: c.id } });
  for (const v of await safe(async () => rows(await db.collection(`${T}/voiceInbox`).where('clientId', '==', id).limit(200).get()), [] as any[]))
    out.push({ id: `v_${v.id}`, at: v.createdAt || v.at, dir: 'event', type: 'receptionist', who: 'Receptionist', text: [v.intent ? String(v.intent).replace(/_/g, ' ') : null, v.details || v.callSummary || null].filter(Boolean).join(': '), status: v.status || null, meta: { callId: v.retellCallId || null, autoApplied: !!v.autoApplied, policy: v.policySnapshot || null } });

  // Notes, courtesies and policy decisions.
  // Notes follow their visibility: private ones only for their author, managers-only for managers. Removed notes stay on
  // the record for managers.
  const mgr = !o.viewer || o.viewer.manager;
  for (const n of await safe(async () => rows(await db.collection(`${T}/clientNotes`).where('clientId', '==', id).limit(300).get()), [] as any[])) {
    if (n.visibility === 'private' && o.viewer && n.authorUid !== o.viewer.uid) continue;
    if (n.visibility === 'managers' && !mgr) continue;
    if (n.removedAt && !mgr) continue;
    out.push({ id: `n_${n.id}`, at: n.at, dir: 'note', type: 'note', who: n.authorName || 'Team', text: n.text || null, status: n.removedAt ? `removed by ${n.removedBy?.name || 'a team member'}` : null, meta: { visibility: n.visibility || null } });
  }
  for (const g of await safe(async () => rows(await db.collection(`${T}/graceUses`).where('clientId', '==', id).limit(100).get()), [] as any[]))
    out.push({ id: `g_${g.id}`, at: g.at, dir: 'event', type: 'courtesy', who: g.appliedBy || 'Team', text: `Courtesy used: ${String(g.event || '').replace(/_/g, ' ')}${g.reason ? ` (${g.reason})` : ''}${g.voidedAt ? `. Undone by ${g.voidedBy || 'a manager'}: ${g.voidReason || ''}` : ''}`, status: g.voidedAt ? 'undone' : 'used' });
  for (const e of await safe(async () => rows(await db.collection(`${T}/cancellationEvents`).where('clientId', '==', id).limit(200).get()), [] as any[]))
    out.push({ id: `p_${e.id}`, at: e.createdAt, dir: 'event', type: 'policy', who: e.selfService ? String(client.name || 'Client') : (e.cancellationAudit?.actorName || 'Team'),
      text: `${e.status === 'skipped_reschedule' ? 'Rescheduled' : 'Cancelled'}${e.serviceName ? ` ${e.serviceName}` : ''}${e.chargeFee ? `. Fee $${Number(e.feeAmount || 0).toFixed(2)} (${e.chargeStatus || 'pending'})` : '. No fee'}${e.cancellationAudit?.reason ? `. ${e.cancellationAudit.reason}` : ''}`, meta: { appointmentId: e.appointmentId || null } });

  const list = out.filter((x) => x.at).sort((a, b) => String(a.at).localeCompare(String(b.at)));
  return o.limit ? list.slice(-o.limit) : list;
}

/** A spreadsheet of a conversation (for an export or a dispute). */
export function conversationCsv(client: any, items: ConversationItem[]): string {
  const q = (v: any) => `"${String(v ?? '').replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`;
  const head = ['When', 'Type', 'Direction', 'Who', 'Subject', 'Message / summary', 'Status', 'Call length (s)', 'Transcript'];
  const lines = items.map((x) => [x.at, x.type, x.dir, x.who, x.subject || '', x.text || '', x.status || '', x.call?.durationSeconds ?? '', x.call?.transcript || ''].map(q).join(','));
  return [`${q(`Conversation record: ${client.name || 'Client'}`)}`, head.map(q).join(','), ...lines].join('\n');
}
