// src/app/api/client-screen/route.ts — THE CLIENT SCREEN (an iPad at the desk).
// The screen's id is a long random secret (the capability); its document (clientScreens/{id}) is readable by that
// screen only in practice and written ONLY here.
//   pair_start  (public)       — a new screen asks for a 6-digit code
//   pair_confirm { code, name } (staff) — the desk enters the code → the screen belongs to this business
//   push { screenId, ticket }   (staff) — the live ticket (lines + totals), shown as they ring up
//   request { screenId, kind, … } (staff) — ask the client: 'tip' | 'approve' (card on file, maybe sign) | 'thanks' | 'idle'
//   respond { screenId, requestId, … } (public, from the screen) — the client's answer; a signature is saved as a consent record
//   receipt { screenId, channel, to } (public, from the screen) — "text / email my receipt" after a sale
//   unpair { screenId } (staff)
import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyStaffActor } from '@/lib/staff-auth';
import { logAuditAdmin } from '@/lib/audit';
import { linkOrigin } from '@/lib/app-origin';
import { clientScreenSettingsOf } from '@/lib/client-screen';

export const dynamic = 'force-dynamic';
const now = () => new Date().toISOString();
const rid = () => crypto.randomBytes(8).toString('hex');
const num = (v: any) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const action = String(b.action || '');
  const db = getAdminDb();

  // ── Public: a new screen asks to be paired ──
  if (action === 'pair_start') {
    const id = crypto.randomBytes(20).toString('hex'); const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
    await db.doc(`clientScreens/${id}`).set({ id, code, codeExpiresAt: new Date(Date.now() + 15 * 60000).toISOString(), tenantId: null, createdAt: now(), phase: 'pairing' });
    return NextResponse.json({ ok: true, screenId: id, code });
  }
  const screenId = String(b.screenId || '');
  // ── Public: the client answers on the screen ──
  if (action === 'respond' || action === 'receipt' || action === 'ping') {
    if (screenId.length < 30) return NextResponse.json({ ok: false, error: 'Unknown screen.' }, { status: 404 });
    const ref = db.doc(`clientScreens/${screenId}`); const s: any = (await ref.get()).data();
    if (!s?.tenantId) return NextResponse.json({ ok: false, error: 'This screen isn’t paired.' }, { status: 404 });
    if (action === 'ping') { await ref.set({ lastSeen: now() }, { merge: true }); return NextResponse.json({ ok: true }); }
    const T = `tenants/${s.tenantId}`;
    if (action === 'receipt') {
      const receiptId = s.request?.kind === 'thanks' ? s.request.receiptId : null;
      if (!receiptId) return NextResponse.json({ ok: false, error: 'There’s no receipt to send.' }, { status: 409 });
      const channel = b.channel === 'sms' ? 'sms' : 'email'; const to = String(b.to || '').trim();
      if (!to || (channel === 'email' && !to.includes('@'))) return NextResponse.json({ ok: false, error: channel === 'email' ? 'Enter your email.' : 'Enter your mobile number.' }, { status: 400 });
      const rRef = db.doc(`${T}/receipts/${receiptId}`); const r: any = (await rRef.get()).data();
      if (!r) return NextResponse.json({ ok: false, error: 'That receipt wasn’t found.' }, { status: 404 });
      let viewKey = r.viewKey; if (!viewKey) { viewKey = `${Date.now().toString(36)}${rid()}${rid()}`; await rRef.set({ viewKey }, { merge: true }); }
      const t: any = ((await db.doc(T).get()).data() as any) || {};
      const url = `${linkOrigin(t, req.nextUrl.origin)}/r/${s.tenantId}/${receiptId}?k=${viewKey}`;
      const studio = t.name || 'Us'; const { sendNotification } = await import('@/lib/notify');
      let sent: any;
      if (channel === 'email') { const { brandedEmailHtml } = await import('@/lib/email-template');
        sent = await sendNotification(db, { tenantId: s.tenantId, channel: 'email', to, subject: `Your receipt — ${studio}`, kind: 'receipt', html: brandedEmailHtml({ studioName: studio, title: 'Your receipt', bodyLines: [`Thanks for visiting${r.total ? ` — $${num(r.total).toFixed(2)}` : ''}.`], cta: { label: 'View your receipt', url } } as any), clientId: r.clientId || null, clientName: r.clientName || null } as any);
      } else sent = await sendNotification(db, { tenantId: s.tenantId, channel: 'sms', to, kind: 'receipt', text: `${studio}: here’s your receipt — ${url}`, clientId: r.clientId || null, clientName: r.clientName || null } as any);
      await rRef.set({ sends: [...(r.sends || []), { at: now(), channel, to, by: 'Client screen', ok: !!sent?.ok }].slice(-20) }, { merge: true });
      return sent?.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ ok: false, error: 'It didn’t send — check it and try again.' }, { status: 502 });
    }
    const q = s.request || {};
    if (!q.id || String(b.requestId || '') !== q.id || q.answeredAt) return NextResponse.json({ ok: false, error: 'This request has already been answered.' }, { status: 409 });
    const answer: any = { requestId: q.id, kind: q.kind, at: now() };
    if (q.kind === 'tip') {
      const tip = Math.max(0, Math.round(num(b.tip) * 100) / 100);
      if (tip > Math.max(1000, num(q.base) * 2)) return NextResponse.json({ ok: false, error: 'That tip looks too large — please check it.' }, { status: 400 });
      answer.tip = tip; answer.tipLabel = String(b.tipLabel || '').slice(0, 40) || null;
    } else if (q.kind === 'approve') {
      answer.approved = b.approved === true;
      if (answer.approved && q.signature) {
        const sig = String(b.signature || '');
        if (!sig.startsWith('data:image/png;base64,') || sig.length < 400) return NextResponse.json({ ok: false, error: 'Please sign before approving.' }, { status: 400 });
        if (sig.length > 350_000) return NextResponse.json({ ok: false, error: 'That signature is too large — clear it and sign again.' }, { status: 400 });
        const cRef = db.collection(`${T}/chargeConsents`).doc();
        await cRef.set({ id: cRef.id, kind: 'card_on_file_charge', clientId: q.clientId || null, clientName: q.clientName || null, amount: num(q.amount), cardLabel: q.cardLabel || null,
          text: q.text || null, signature: sig, signedAt: now(), via: 'client_screen', screenId, screenName: s.name || null, requestedBy: q.requestedBy || null });
        answer.consentId = cRef.id;
      }
    } else if (q.kind === 'change') { answer.keep = b.keep === true; answer.change = num(q.change); }
    else return NextResponse.json({ ok: false, error: 'Nothing to answer.' }, { status: 409 });
    await ref.update({ request: { ...q, answeredAt: now() }, response: answer, lastSeen: now() });   // replace, never merge
    return NextResponse.json({ ok: true });
  }

  // ── Staff ──
  const tenantId = String(b.tenantId || '');
  const auth: any = await verifyStaffActor(req, tenantId);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error || 'Sign in to do that.' }, { status: auth.status || 401 });
  if (action === 'pair_confirm') {
    const code = String(b.code || '').replace(/\D/g, '');
    if (code.length !== 6) return NextResponse.json({ ok: false, error: 'Enter the 6-digit code shown on the screen.' }, { status: 400 });
    const hit = (await db.collection('clientScreens').where('code', '==', code).get()).docs.find((d: any) => !(d.data() as any).tenantId && Date.parse((d.data() as any).codeExpiresAt) > Date.now());
    if (!hit) return NextResponse.json({ ok: false, error: 'That code isn’t valid any more — refresh the screen for a new one.' }, { status: 404 });
    const name = String(b.name || '').trim().slice(0, 40) || 'Client screen';
    await hit.ref.set({ tenantId, name, code: null, codeExpiresAt: null, pairedAt: now(), pairedBy: auth.actor.name, phase: 'idle', request: null, response: null, ticket: null }, { merge: true });
    await logAuditAdmin(db, tenantId, { action: 'client_screen.paired', targetType: 'client_screen', targetId: hit.id, summary: `Client screen “${name}” paired by ${auth.actor.name}`, actor: { type: 'user', id: auth.actor.uid, name: auth.actor.name, role: auth.actor.role } } as any).catch(() => {});
    return NextResponse.json({ ok: true, screenId: hit.id, name });
  }
  if (action === 'list') {
    const rows = (await db.collection('clientScreens').where('tenantId', '==', tenantId).get()).docs.map((d: any) => { const x: any = d.data(); return { id: d.id, name: x.name, lastSeen: x.lastSeen || null, pairedAt: x.pairedAt || null }; });
    return NextResponse.json({ ok: true, screens: rows });
  }
  const ref = db.doc(`clientScreens/${screenId}`); const s: any = (await ref.get()).data();
  if (!s || s.tenantId !== tenantId) return NextResponse.json({ ok: false, error: 'That screen isn’t paired with this business.' }, { status: 404 });
  const t: any = ((await db.doc(`tenants/${tenantId}`).get()).data() as any) || {};
  const brand = { name: t.name || t.businessName || '', logo: t.logoUrl || t.bookingPageSettings?.cfPageConfig?.logoUrl || null, accent: t.bookingPageSettings?.cfPageConfig?.accentColor || t.brandColor || null };
  const settings = clientScreenSettingsOf(t);
  if (action === 'push') {
    const tk = b.ticket || null;
    const ticket = tk ? { clientFirst: String(tk.clientFirst || '').slice(0, 40), moments: (Array.isArray(tk.moments) ? tk.moments : []).slice(0, 2).map((m: any) => String(m).slice(0, 90)), lines: (Array.isArray(tk.lines) ? tk.lines : []).slice(0, 40).map((l: any) => ({ label: String(l.label || '').slice(0, 80), amount: num(l.amount), note: l.note ? String(l.note).slice(0, 60) : null })),
      subtotal: num(tk.subtotal), discount: num(tk.discount), tax: num(tk.tax), taxLabel: String(tk.taxLabel || 'Tax').slice(0, 60), tip: num(tk.tip), total: num(tk.total), paid: num(tk.paid), due: num(tk.due) } : null;
    // A new ticket replaces a finished sale's thank-you screen.
    await ref.update({ ticket, brand, settings: { welcome: settings.welcome, reviewTicket: settings.reviewTicket }, updatedAt: now(), ...(ticket ? (s.request?.kind === 'thanks' ? { request: null, response: null, phase: 'ticket' } : {}) : { phase: 'idle' }) });
    return NextResponse.json({ ok: true });
  }
  if (action === 'request') {
    const kind = String(b.kind || '');
    if (!['tip', 'approve', 'thanks', 'idle', 'cash', 'change'].includes(kind)) return NextResponse.json({ ok: false, error: 'Unknown request.' }, { status: 400 });
    const q: any = { id: rid(), kind, at: now(), requestedBy: auth.actor.name };
    if (kind === 'tip') { q.base = Math.max(0, num(b.base)); q.presets = settings.tipPresets; q.allowCustom = settings.allowCustomTip; q.showNoTip = settings.showNoTip; q.tipOn = settings.tipOn; }
    if (kind === 'approve') { q.amount = num(b.amount); q.cardLabel = String(b.cardLabel || '').slice(0, 40) || 'your card on file'; q.clientId = b.clientId || null; q.clientName = b.clientName || null;
      q.signature = settings.signCardOnFile && (!settings.signOver || q.amount >= settings.signOver);
      q.text = `I authorise ${brand.name || 'the business'} to charge $${q.amount.toFixed(2)} to ${q.cardLabel}.`; }
    if (kind === 'cash') { q.due = num(b.due); }
    if (kind === 'change') { q.due = num(b.due); q.tendered = num(b.tendered); q.change = num(b.change); q.offerKeep = (t?.clientScreen?.offerKeepChange !== false); }
    if (kind === 'thanks') { q.receiptId = b.receiptId || null; q.offerReceipt = settings.offerReceipt; q.total = num(b.total); q.clientFirst = String(b.clientFirst || '').slice(0, 40); }
    await ref.update({ phase: kind === 'idle' ? 'idle' : kind, request: kind === 'idle' ? null : q, response: null, brand, ...(kind === 'idle' || kind === 'thanks' ? { ticket: null } : {}), updatedAt: now() });   // replace, never merge
    return NextResponse.json({ ok: true, requestId: q.id });
  }
  if (action === 'unpair') {
    await ref.set({ tenantId: null, name: null, phase: 'unpaired', request: null, response: null, ticket: null }, { merge: true });
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ ok: false, error: 'Unknown action.' }, { status: 400 });
}
