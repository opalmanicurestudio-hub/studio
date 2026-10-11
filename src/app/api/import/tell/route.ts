// /api/import/tell — MOVING IN → TELL YOUR CLIENTS. One text on switch-over day with each client's own welcome link
// (lib/welcome). Sent through the campaign engine, so every rule holds: texts only to people who said yes to texts
// (in the old app or here), never to anyone who unsubscribed, 9am–8pm their time, small batches, the monthly cap.
// People who didn't say yes to texts but have an email get it by email instead. Managers only.
//   preview  → who gets a text, who gets an email, who can't be reached; the suggested message; anything already scheduled
//   test     { body, to? } → the text to the manager's own phone
//   schedule { body, sendAt | now } → makes the text and email campaigns (status scheduled)
//   cancel   → takes back a scheduled one that hasn't started
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { requireRole } from '@/lib/route-guard';

export const dynamic = 'force-dynamic';
const j = (b: any, status = 200) => NextResponse.json(b, { status });

async function audience(db: any, T: string) {
  const s = await db.collection(`${T}/clients`).get(); const sms: string[] = [], email: string[] = []; let none = 0;
  for (const d of s.docs) { const c: any = d.data() || {}; if (c.ownerRenterId || c.status === 'archived' || c.archived === true) continue;
    if (c.marketingOptOut === true) { none++; continue; }
    if (c.phone && c.smsMarketingOptIn === true) sms.push(d.id); else if (c.email) email.push(d.id); else none++; }
  return { sms, email, none };
}

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({})); const tenantId = String(b.tenantId || '');
  const g = await requireRole(req, tenantId, 'manager'); if (g.deny) return g.deny;
  const db = getAdminDb(); const T = `tenants/${tenantId}`; const t: any = (await db.doc(T).get()).data() || {}; const action = String(b.action || '');
  const biz = t.name || 'We';
  if (action === 'preview') {
    const a = await audience(db, T); const tell = t.movingIn?.tell || null;
    const camp = async (id?: string) => (id ? (await db.doc(`${T}/campaigns/${id}`).get()).data() || null : null);
    const [cs, ce] = await Promise.all([camp(tell?.smsCampaignId), camp(tell?.emailCampaignId)]);
    const { smsConfigured } = await import('@/lib/sms');
    return j({ ok: true, sms: a.sms.length, email: a.email.length, none: a.none, switchDate: t.movingIn?.switchDate || null, timeZone: t.timezone || 'America/New_York',
      body: `Hi {first}! ${biz} has a new way to book. Your history and any gift cards came with you. Book here: {link}`,
      textsReady: smsConfigured(),
      scheduled: tell ? { at: tell.sendAt, sms: cs ? { status: cs.status, sent: cs.recipientCount || 0 } : null, email: ce ? { status: ce.status, sent: ce.recipientCount || 0 } : null, body: tell.body } : null });
  }
  const body = String(b.body || '').trim().slice(0, 480);
  if (action === 'test') {
    if (!body.includes('{link}')) return j({ ok: false, error: 'Keep {link} in the message — it’s each person’s own booking page.' }, 400);
    const me: any = g.actor?.uid ? (await db.doc(`${T}/staff/${g.actor.uid}`).get()).data() : null;
    const to = String(b.to || me?.phone || t.phone || '').trim(); if (to.replace(/\D/g, '').length < 10) return j({ ok: false, error: 'Add your mobile number to send yourself a test.' }, 400);
    const { origin } = req.nextUrl; const { linkOrigin } = await import('@/lib/app-origin');
    const text = `${biz}: ${body.replace(/\{first\}/g, String(g.actor?.name || 'there').split(' ')[0]).replace(/\{business\}/g, biz).replace(/\{link\}/g, `${linkOrigin(t, origin)}/book/${encodeURIComponent(tenantId)}`)}\nReply STOP to opt out.`;
    const { sendNotification } = await import('@/lib/notify');
    const r: any = await sendNotification(db, { tenantId, channel: 'sms', to, text: `[Test] ${text}`, kind: 'campaign_test', recipientType: 'staff' } as any).catch((e: any) => ({ ok: false, error: e?.message }));
    return j(r?.ok ? { ok: true, to: `•••${to.replace(/\D/g, '').slice(-4)}` } : { ok: false, error: 'The test didn’t send — check the number, and that texting is set up.' }, r?.ok ? 200 : 400);
  }
  if (action === 'schedule') {
    if (!body.includes('{link}')) return j({ ok: false, error: 'Keep {link} in the message — it’s each person’s own booking page.' }, 400);
    const at = b.now === true ? Date.now() : Date.parse(String(b.sendAt || ''));
    if (!Number.isFinite(at) || at < Date.now() - 60000 || at > Date.now() + 180 * 864e5) return j({ ok: false, error: 'Choose a day in the next six months.' }, 400);
    if (t.movingIn?.tell?.smsCampaignId) { const cur: any = (await db.doc(`${T}/campaigns/${t.movingIn.tell.smsCampaignId}`).get()).data(); if (cur && ['sending', 'sent'].includes(cur.status)) return j({ ok: false, error: 'It’s already gone out.' }, 400); }
    const a = await audience(db, T); const iso = new Date(at).toISOString();
    // Texting not set up yet: everyone it can reach goes by email (the text people who have an email too).
    if (!(await import('@/lib/sms')).smsConfigured()) { const s2 = await db.collection(`${T}/clients`).get(); const has = new Set(s2.docs.filter((d: any) => (d.data() as any)?.email).map((d: any) => d.id));
      a.email.push(...a.sms.filter((id) => has.has(id))); a.sms = []; } const nowIso = new Date().toISOString(); const ids: Record<string, string | null> = { sms: null, email: null };
    for (const ch of ['sms', 'email'] as const) { const list = ch === 'sms' ? a.sms : a.email; if (!list.length) continue;
      const ref = db.collection(`${T}/campaigns`).doc(); ids[ch] = ref.id;
      await ref.set({ id: ref.id, name: ch === 'sms' ? 'We’ve moved — text' : 'We’ve moved — email', type: ch, body, subject: `${biz} has a new way to book`, targetAudience: 'specific', targetClientIds: list.slice(0, 20000),
        welcomeLink: true, movingIn: true, status: 'scheduled', scheduledFor: iso, scheduledBy: g.actor?.name || 'Manager', createdAt: nowIso, updatedAt: nowIso }); }
    // A tell that was scheduled before (and hasn't started) is replaced.
    for (const k of ['smsCampaignId', 'emailCampaignId']) { const old = t.movingIn?.tell?.[k]; if (old) await db.doc(`${T}/campaigns/${old}`).set({ status: 'draft', scheduledFor: null, replacedAt: nowIso }, { merge: true }).catch(() => {}); }
    await db.doc(T).set({ movingIn: { tell: { smsCampaignId: ids.sms, emailCampaignId: ids.email, sendAt: iso, body, by: g.actor?.name || null, at: nowIso }, switch: { tell: true } } }, { merge: true });
    let started = false;
    if (b.now === true) { const { sendCampaignBatch } = await import('@/lib/campaign-engine');
      for (const id of [ids.sms, ids.email].filter(Boolean) as string[]) { try { await sendCampaignBatch(db, tenantId, id, { actorName: g.actor?.name || 'Manager', fallbackOrigin: req.nextUrl.origin }); started = true; } catch { /* the hourly run carries on (quiet hours, or a hiccup) */ } } }
    return j({ ok: true, sms: a.sms.length, email: a.email.length, sendAt: iso, started });
  }
  if (action === 'cancel') {
    const tell = t.movingIn?.tell; if (!tell) return j({ ok: true });
    for (const k of ['smsCampaignId', 'emailCampaignId']) { const id = tell[k]; if (!id) continue; const cur: any = (await db.doc(`${T}/campaigns/${id}`).get()).data();
      if (cur && ['sending', 'sent'].includes(cur.status)) return j({ ok: false, error: 'It’s already started going out — it can’t be taken back.' }, 400);
      await db.doc(`${T}/campaigns/${id}`).set({ status: 'draft', scheduledFor: null }, { merge: true }); }
    const { FieldValue } = await import('firebase-admin/firestore');
    await db.doc(T).update({ 'movingIn.tell': FieldValue.delete(), 'movingIn.switch.tell': false });
    return j({ ok: true });
  }
  return j({ ok: false, error: 'Unknown action.' }, 400);
}
