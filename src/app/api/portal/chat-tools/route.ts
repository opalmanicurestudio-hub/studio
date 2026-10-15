// src/app/api/portal/chat-tools/route.ts — TEAM CHAT EXTRAS. Signed-in team members (and renters) only.
//   translate { tenantId, threadId, messageId, to } → the message in their language (worked out once, then kept on it)
//   language  { tenantId, to | null }                → the language they read team chat in
//   cc        { tenantId, threadId, messageId, staffId } → a copy of one message sent to a colleague who isn't in the
//                                                         conversation, in their direct thread with the sender
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { requestActor } from '@/lib/request-actor';
import { okLanguage, CHAT_LANGUAGE_EN } from '@/lib/chat-languages';
export const dynamic = 'force-dynamic';
const j = (b: any, s = 200) => NextResponse.json(b, { status: s, headers: { 'Cache-Control': 'no-store' } });
const id80 = (v: any) => String(v || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 120);

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({})); const tenantId = String(b.tenantId || '').slice(0, 80);
  if (!tenantId) return j({ ok: false, error: 'Missing details.' }, 400);
  const db = getAdminDb(); const who = await requestActor(db, req.headers.get('authorization'), tenantId);
  if (!who.ok) return j({ ok: false, error: who.error }, who.status);
  const me = who.actor; const T = `tenants/${tenantId}`;

  if (b.action === 'language') { const to = okLanguage(b.to);
    await db.doc(`${T}/staff/${me.staffId}`).set({ chatLanguage: to || null }, { merge: true }); return j({ ok: true, to }); }

  const threadId = id80(b.threadId); const messageId = id80(b.messageId);
  if (!threadId || !messageId) return j({ ok: false, error: 'Missing details.' }, 400);
  const tRef = db.doc(`${T}/staffThreads/${threadId}`); const t: any = (await tRef.get()).data();
  if (!t || !(t.participantIds || []).includes(me.staffId)) return j({ ok: false, error: 'You’re not in that conversation.' }, 403);
  const mRef = db.doc(`${T}/staffThreads/${threadId}/messages/${messageId}`); const m: any = (await mRef.get()).data();
  if (!m || m.deleted) return j({ ok: false, error: 'That message isn’t there any more.' }, 404);

  if (b.action === 'translate') {
    const to = okLanguage(b.to); if (!to) return j({ ok: false, error: 'Choose a language.' }, 400);
    if (m.translations?.[to]) return j({ ok: true, text: m.translations[to], same: m.translations[to] === m.body });
    const body = String(m.body || '').trim(); if (!body) return j({ ok: true, text: '', same: true });
    const { askAI } = await import('@/lib/ai');
    const r = await askAI({ tier: 'fast', purpose: 'team-chat-translate', tenantId, maxTokens: 700,
      system: `You translate short workplace chat messages between coworkers at a small business into ${CHAT_LANGUAGE_EN[to]}. Keep names, numbers, times, prices and emoji exactly as written. Keep the tone. If the message is already in ${CHAT_LANGUAGE_EN[to]}, reply with it unchanged. Reply with the translation only, nothing else.`,
      prompt: body.slice(0, 2000) });
    if (!r.ok || !r.text) return j({ ok: false, error: r.error === 'Off in health privacy mode.' ? 'Translation is off while health privacy mode is on.' : 'Translation isn’t available right now.' }, 503);
    const text = r.text.trim().slice(0, 4000); await mRef.set({ translations: { [to]: text } }, { merge: true });
    return j({ ok: true, text, same: text === body });
  }

  if (b.action === 'cc') {
    const to = id80(b.staffId); if (!to || to === me.staffId) return j({ ok: false, error: 'Choose a colleague.' }, 400);
    if ((t.participantIds || []).includes(to)) return j({ ok: false, error: 'They’re already in this conversation.' }, 400);
    const p: any = (await db.doc(`${T}/staff/${to}`).get()).data(); if (!p || p.archived === true) return j({ ok: false, error: 'That colleague wasn’t found.' }, 404);
    const meRenter = !!(await db.doc(`${T}/staff/${me.staffId}`).get()).data()?.isRenter; const theyRenter = !!p.isRenter || p.role === 'renter';
    if (meRenter && theyRenter === false && !['owner', 'admin', 'manager'].includes(String(p.role || ''))) return j({ ok: false, error: 'You can copy in managers and other renters.' }, 403);
    const sender: any = m.senderId === me.staffId ? { name: me.name } : (await db.doc(`${T}/staff/${m.senderId}`).get()).data() || {};
    const where = t.groupName || (t.type === 'team' ? (threadId === 'building_broadcast' ? 'Building announcements' : 'Team announcements') : t.type === 'group' ? 'a group conversation' : 'a direct conversation');
    const dm = `dm_${[me.staffId, to].sort().join('_')}`; const now = new Date().toISOString(); const preview = `Copied you in: ${String(m.body || (m.imageUrl || m.gifUrl ? 'a picture' : m.fileUrl ? 'a file' : 'a message')).slice(0, 110)}`;
    await db.doc(`${T}/staffThreads/${dm}`).set({ id: dm, tenantId, type: 'dm', participantIds: [me.staffId, to], lastMessageAt: now, lastMessagePreview: preview.slice(0, 140), lastMessageBy: me.staffId, readBy: [me.staffId] }, { merge: true });
    const nm = db.collection(`${T}/staffThreads/${dm}/messages`).doc();
    await nm.set({ id: nm.id, senderId: me.staffId, kind: 'cc', body: String(b.note || '').trim().slice(0, 500), sentAt: now, readBy: [me.staffId],
      quote: { from: String(sender.name || 'A teammate'), where, body: String(m.body || '').slice(0, 1200), sentAt: m.sentAt || null, imageUrl: m.imageUrl || m.gifUrl || null, fileUrl: m.fileUrl || null, fileName: m.fileName || null } });
    const { FieldValue } = await import('firebase-admin/firestore');
    await mRef.set({ ccTo: FieldValue.arrayUnion(String(p.name || 'a colleague')) }, { merge: true });
    const n = db.collection(`${T}/notifications`).doc();
    await n.set({ id: n.id, userId: to, type: 'chat_cc', message: `${me.name} copied you in on a message from ${String(sender.name || 'a teammate').split(' ')[0]}`, link: '/staff-portal?tab=messages', createdAt: now, read: false });
    return j({ ok: true, threadId: dm });
  }
  return j({ ok: false, error: 'Unknown action.' }, 400);
}
