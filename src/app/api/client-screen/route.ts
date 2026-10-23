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
import { clientScreenSettingsOf, rebookSettingsOf } from '@/lib/client-screen';
import { rebookStart, rebookDay, rebookBook, rebookWaitlist } from '@/lib/rebook-actions';
import { readerStripe, safeId, ticketBlocks } from '@/lib/reader-sale';
import { closeOpenPayment, closedAnswer, paidOnScreen, recordCardShare } from '@/lib/screen-pay';

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
  // ── Book the next visit (from the thank-you screen). Who / what / with whom comes from the desk's thank-you
  //    request — the iPad never decides that. Booking goes through the booking engine (same rules, same
  //    double-booking guard); the deposit is settled through the desk-deposit route (recorded like online). ──
  if (action.startsWith('rebook_')) {
    if (screenId.length < 30) return NextResponse.json({ ok: false, error: 'Unknown screen.' }, { status: 404 });
    const ref = db.doc(`clientScreens/${screenId}`); const s: any = (await ref.get()).data(); const q = s?.request;
    const rc = q?.rebookCtx;
    if (!s?.tenantId || q?.kind !== 'thanks' || q.id !== String(b.requestId || '') || !rc) return NextResponse.json({ ok: false, error: 'This request is no longer open.' }, { status: 409 });
    const t: any = ((await db.doc(`tenants/${s.tenantId}`).get()).data() as any) || {};
    const ctx = { tenantId: s.tenantId, clientId: rc.clientId, serviceId: rc.serviceId, staffId: rc.staffId, addOnIds: rc.addOnIds, appointmentId: rc.appointmentId };
    const internal = async (path: string, body: any) => { const secret = process.env.CRON_SECRET; if (!secret) return { ok: false, error: 'Booking from the client screen needs the CRON_SECRET setting.' };
      return fetch(`${req.nextUrl.origin}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-cf-internal': secret }, body: JSON.stringify(body) }).then((r) => r.json()).catch(() => ({ ok: false, error: 'We could not reach the booking service. Please try again.' })); };
    const post = (path: string, body: any) => fetch(`${req.nextUrl.origin}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json()).catch(() => ({ ok: false }));
    const rb = q.rebook || {};
    if (action === 'rebook_decline') { await ref.update({ 'request.rebook': { stage: 'declined' } });
      // “Not now” in person: quiet for checkout suggestions, and no rebooking texts that week (lib/opportunities).
      if (rc.clientId) await db.doc(`tenants/${s.tenantId}/clients/${rc.clientId}`).set({ nudgeDeclines: { rebook: new Date().toISOString() } }, { merge: true }).catch(() => {});
      return NextResponse.json({ ok: true }); }
    if (action === 'rebook_start') { const r: any = await rebookStart(db, ctx, 'client_screen'); if (!r.ok) return NextResponse.json(r, { status: 400 }); await ref.update({ 'request.rebook': r.rebook }); return NextResponse.json(r); }
    if (action === 'rebook_day') { const r: any = await rebookDay(db, s.tenantId, rb, String(b.date || ''), b.anyone === true); return NextResponse.json(r, { status: r.ok ? 200 : 400 }); }
    if (action === 'rebook_book') {
      const r: any = await rebookBook(db, ctx, rb, { startIso: String(b.startIso || ''), staffId: b.staffId ? String(b.staffId) : null, deposit: b.deposit ? String(b.deposit) : null, standing: b.standing === true }, internal, linkOrigin(t, req.nextUrl.origin));
      if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: r.status || 400 });
      await ref.update({ 'request.rebook': r.rebook, response: { requestId: q.id, kind: 'rebook', booked: true, label: r.rebook.label, at: now() } });
      return NextResponse.json(r);
    }
    if (action === 'rebook_status') {
      if (!rb.appointmentId) return NextResponse.json({ ok: true, stage: rb.stage });
      const ap: any = (await db.doc(`tenants/${s.tenantId}/appointments/${rb.appointmentId}`).get()).data() || {};
      if (rb.stage === 'pay' && (ap.depositStatus === 'paid' || ap.status === 'confirmed')) { await ref.update({ 'request.rebook.stage': 'done', 'request.rebook.depositNote': 'Your deposit has been received.' }); return NextResponse.json({ ok: true, stage: 'done' }); }
      return NextResponse.json({ ok: true, stage: rb.stage });
    }
    if (action === 'rebook_waitlist') { const r: any = await rebookWaitlist(db, ctx, rb, String(b.note || ''), post); if (!r.ok) return NextResponse.json(r, { status: 400 }); await ref.update({ 'request.rebook': { ...rb, stage: 'waitlisted' } }); return NextResponse.json({ ok: true }); }
    return NextResponse.json({ ok: false, error: 'Unknown action.' }, { status: 400 });
  }
  if (action === 'pay_view' || action === 'pay_save' || action === 'pay_done' || action === 'pay_tip') {
    if (screenId.length < 30) return NextResponse.json({ ok: false, error: 'Unknown screen.' }, { status: 404 });
    const ref = db.doc(`clientScreens/${screenId}`); const s: any = (await ref.get()).data();
    const q = s?.request;
    if (!s?.tenantId || q?.kind !== 'pay' || q.id !== String(b.requestId || '')) return NextResponse.json({ ok: false, error: 'This payment is no longer open.' }, { status: 409 });
    const T = `tenants/${s.tenantId}`; const t: any = ((await db.doc(T).get()).data() as any) || {};
    const acct = t.stripeAccountId; if (!acct || !process.env.STRIPE_SECRET_KEY) return NextResponse.json({ ok: false, error: 'Card payments are not set up for this business.' }, { status: 400 });
    const stripe: any = readerStripe();   // the same card payments client as the rest of the desk (lib/reader-sale)
    if (action === 'pay_view') return NextResponse.json({ ok: true, clientSecret: q.clientSecret, publishableKey: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || '', stripeAccount: acct,
      amount: num(q.amount), business: t.name || 'Payment', allowSave: !!q.allowSave, paid: !!q.answeredAt, accent: t.bookingPageSettings?.cfPageConfig?.accentColor || t.brandColor || null });
    if (q.answeredAt) return NextResponse.json({ ok: true, already: true });
    if (action === 'pay_tip') {   // the tip they chose on the iPad → added to the payment (server-side) before they pay
      const tip = Math.max(0, Math.round(num(b.tip) * 100) / 100);
      if (tip > Math.max(100, num(q.tipBase))) return NextResponse.json({ ok: false, error: 'That tip amount appears too large. Please check it.' }, { status: 400 });   // up to the bill itself, or $100 — catches an extra zero
      const total = Math.round((num(q.amountBase) + tip) * 100) / 100;
      // Who the client wants the tip to go to (only the people offered); checked again at checkout.
      const offered = new Set<string>(((q.providers || []) as any[]).map((p: any) => String(p.id)));
      const split = b.tipAllocations && typeof b.tipAllocations === 'object' ? Object.fromEntries(Object.entries(b.tipAllocations).filter(([k, v]) => offered.has(k) && num(v) >= 0).slice(0, 10).map(([k, v]) => [k, Math.round(num(v) * 100) / 100])) : null;
      // The tip goes on the payment itself too, so a sale recorded from Stripe's notice alone still has it.
      await stripe.paymentIntents.update(q.paymentIntentId, { amount: Math.round(total * 100), metadata: { tipCents: String(Math.round(tip * 100)), tipAllocations: split ? JSON.stringify(split).slice(0, 480) : '' } } as any, { stripeAccount: acct } as any);
      await ref.update({ 'request.tip': tip, 'request.amount': total, 'request.tipChosen': true, 'request.tipAllocations': split });
      return NextResponse.json({ ok: true, amount: total });
    }
    if (action === 'pay_save') {   // the client's own "save my card for next time" — applied before they pay
      if (!q.allowSave) return NextResponse.json({ ok: false, error: 'Saving a card is not available here.' }, { status: 400 });
      await stripe.paymentIntents.update(q.paymentIntentId, { setup_future_usage: b.save === true ? 'off_session' : ('' as any) } as any, { stripeAccount: acct } as any);
      await ref.update({ 'request.saveCard': b.save === true });
      return NextResponse.json({ ok: true });
    }
    // pay_done — trust Stripe, never the screen
    const pi: any = await stripe.paymentIntents.retrieve(q.paymentIntentId, { stripeAccount: acct } as any);
    if (pi.status !== 'succeeded') return NextResponse.json({ ok: false, error: pi.status === 'processing' ? 'Your payment is still processing. Thank you for your patience.' : 'The payment was not completed.' }, { status: 409 });
    if (pi.amount !== Math.round(num(q.amount) * 100)) return NextResponse.json({ ok: false, error: 'The payment amount does not match.' }, { status: 409 });
    let saved = false;
    if (q.saveCard && q.clientId && pi.payment_method) {   // their card, saved because THEY ticked the box
      try { const pm: any = await stripe.paymentMethods.retrieve(String(pi.payment_method), { stripeAccount: acct } as any);
        await db.doc(`${T}/clients/${q.clientId}`).set({ cardOnFile: { customerId: typeof pi.customer === 'string' ? pi.customer : q.customerId || null, paymentMethodId: pm.id, brand: pm.card?.brand || null, last4: pm.card?.last4 || null,
          expMonth: pm.card?.exp_month || null, expYear: pm.card?.exp_year || null, savedAt: now(), savedVia: 'client_screen', consent: 'Client ticked “Save my card for next time”' } }, { merge: true }); saved = true; } catch (e) { console.error('[client-screen] save card', e); }
    }
    await ref.update({ request: { ...q, answeredAt: now() }, response: { requestId: q.id, kind: 'pay', paid: true, paymentIntentId: pi.id, amount: num(q.amount), tip: num(q.tip), tipAllocations: q.tipAllocations || null, saved, at: now() }, lastSeen: now() });
    // One share of a split bill: on the started ticket right here (safe even if the desk is interrupted); a share that
    // lands on a sale already finished or paid in full is kept apart for a manager (lib/screen-pay).
    if (q.splitPendingId) await recordCardShare(db, s.tenantId, String(q.splitPendingId), pi, { amount: num(q.amount) - num(q.tip), tip: num(q.tip), label: q.shareLabel || null, via: 'client_screen', payerClientId: q.clientId || null, by: 'Client screen' }).catch(() => null);
    else if (q.pendingId) await paidOnScreen(db, s.tenantId, String(q.pendingId), pi, q).catch(() => {});   // if the desk misses it, a manager can still record it
    return NextResponse.json({ ok: true, saved });
  }
  if (action === 'hold') {
    if (screenId.length < 30) return NextResponse.json({ ok: false }, { status: 404 });
    const ref = db.doc(`clientScreens/${screenId}`); const s: any = (await ref.get()).data();
    if (s?.request?.kind === 'thanks' && s.request.id === String(b.requestId || '')) await ref.update({ 'request.holdUntil': new Date(Date.now() + 90000).toISOString() });
    return NextResponse.json({ ok: true });
  }
  if (action === 'pay_abandon') {
    if (screenId.length < 30) return NextResponse.json({ ok: false, error: 'Unknown screen.' }, { status: 404 });
    const ref = db.doc(`clientScreens/${screenId}`); const s: any = (await ref.get()).data();
    if (!s?.tenantId || s.request?.kind !== 'pay' || s.request.id !== String(b.requestId || '')) return NextResponse.json({ ok: true });
    const r = await closeOpenPayment(db, s, 'it timed out on the screen');
    // Paid just as it timed out: the desk hears with the payment itself, so it saves the sale with it (never charges again).
    await ref.update({ request: null, phase: 'ticket', response: closedAnswer(s.request, r) });
    return NextResponse.json({ ok: true, result: r });
  }
  if (action === 'respond' || action === 'receipt' || action === 'ping') {
    if (screenId.length < 30) return NextResponse.json({ ok: false, error: 'Unknown screen.' }, { status: 404 });
    const ref = db.doc(`clientScreens/${screenId}`); const s: any = (await ref.get()).data();
    if (!s?.tenantId) return NextResponse.json({ ok: false, error: 'This screen is not paired.' }, { status: 404 });
    if (action === 'ping') {
      const pt: any = ((await db.doc(`tenants/${s.tenantId}`).get()).data() as any) || {}; const ps = clientScreenSettingsOf(pt);
      await ref.update({ lastSeen: now(), brand: { name: pt.name || pt.businessName || '', logo: pt.logoUrl || pt.bookingPageSettings?.cfPageConfig?.logoUrl || null, accent: pt.bookingPageSettings?.cfPageConfig?.accentColor || pt.brandColor || null },
        settings: { welcome: ps.welcome, reviewTicket: ps.reviewTicket, motion: ps.motion, confetti: ps.confetti } });
      return NextResponse.json({ ok: true }); }
    const T = `tenants/${s.tenantId}`;
    if (action === 'receipt') {
      const receiptId = s.request?.kind === 'thanks' ? s.request.receiptId : null;
      if (!receiptId) return NextResponse.json({ ok: false, error: 'There is no receipt to send.' }, { status: 409 });
      const channel = b.channel === 'sms' ? 'sms' : 'email'; const to = String(b.to || '').trim();
      if (!to || (channel === 'email' && !to.includes('@'))) return NextResponse.json({ ok: false, error: channel === 'email' ? 'Please enter your email address.' : 'Please enter your mobile number.' }, { status: 400 });
      const rRef = db.doc(`${T}/receipts/${receiptId}`); const r: any = (await rRef.get()).data();
      if (!r) return NextResponse.json({ ok: false, error: 'We could not find that receipt.' }, { status: 404 });
      let viewKey = r.viewKey; if (!viewKey) { viewKey = `${Date.now().toString(36)}${rid()}${rid()}`; await rRef.set({ viewKey }, { merge: true }); }
      const t: any = ((await db.doc(T).get()).data() as any) || {};
      const url = `${linkOrigin(t, req.nextUrl.origin)}/r/${s.tenantId}/${receiptId}?k=${viewKey}`;
      const studio = t.name || 'Us'; const { sendNotification } = await import('@/lib/notify');
      let sent: any;
      if (channel === 'email') { const { brandedEmailHtml } = await import('@/lib/email-template');
        sent = await sendNotification(db, { tenantId: s.tenantId, channel: 'email', to, subject: `Your receipt from ${studio}`, kind: 'receipt', html: brandedEmailHtml({ studioName: studio, title: 'Your receipt', bodyLines: [`Hi ${String(r.clientName || '').split(' ')[0] || 'there'},`, `Thank you for visiting us.${r.total ? ` Your total was $${num(r.total).toFixed(2)}.` : ''} You can view your receipt using the link below.`, 'Kind regards,', studio], cta: { label: 'View your receipt', url } } as any), clientId: r.clientId || null, clientName: r.clientName || null } as any);
      } else sent = await sendNotification(db, { tenantId: s.tenantId, channel: 'sms', to, kind: 'receipt', text: `Hi ${String(r.clientName || '').split(' ')[0] || 'there'}, thank you for visiting. Here is your receipt: ${url}`, clientId: r.clientId || null, clientName: r.clientName || null } as any);
      await rRef.set({ sends: [...(r.sends || []), { at: now(), channel, to, by: 'Client screen', ok: !!sent?.ok }].slice(-20) }, { merge: true });
      return sent?.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ ok: false, error: 'The receipt could not be sent. Please check the details and try again.' }, { status: 502 });
    }
    const q = s.request || {};
    if (!q.id || String(b.requestId || '') !== q.id || q.answeredAt) return NextResponse.json({ ok: false, error: 'This request has already been answered.' }, { status: 409 });
    const answer: any = { requestId: q.id, kind: q.kind, at: now() };
    if (q.kind === 'tip') {
      const tip = Math.max(0, Math.round(num(b.tip) * 100) / 100);
      if (tip > Math.max(100, num(q.base))) return NextResponse.json({ ok: false, error: 'That tip amount appears too large. Please check it.' }, { status: 400 });
      answer.tip = tip; answer.tipLabel = String(b.tipLabel || '').slice(0, 40) || null;
      // Who the client wants it to go to — only the people offered; the checkout and the server check it adds up.
      const offered = new Set<string>(((q.providers || []) as any[]).map((p: any) => String(p.id)));
      if (b.tipAllocations && typeof b.tipAllocations === 'object') answer.tipAllocations = Object.fromEntries(Object.entries(b.tipAllocations).filter(([k, v]) => offered.has(k) && num(v) >= 0).slice(0, 10).map(([k, v]) => [k, Math.round(num(v) * 100) / 100]));
    } else if (q.kind === 'approve') {
      answer.approved = b.approved === true;
      if (answer.approved && q.signature) {
        const sig = String(b.signature || '');
        if (!sig.startsWith('data:image/png;base64,') || sig.length < 400) return NextResponse.json({ ok: false, error: 'Please sign before approving.' }, { status: 400 });
        if (sig.length > 350_000) return NextResponse.json({ ok: false, error: 'That signature is too large. Please clear it and sign again.' }, { status: 400 });
        const cRef = db.collection(`${T}/chargeConsents`).doc();
        await cRef.set({ id: cRef.id, kind: 'card_on_file_charge', clientId: q.clientId || null, clientName: q.clientName || null, amount: num(q.amount), cardLabel: q.cardLabel || null,
          text: q.text || null, signature: sig, signedAt: now(), via: 'client_screen', screenId, screenName: s.name || null, requestedBy: q.requestedBy || null });
        answer.consentId = cRef.id;
      }
    } else if (q.kind === 'giftuse') { answer.use = b.use === true;
    } else if (q.kind === 'gift') {   // the buyer chose the design, the note and when it arrives (a gift card they're buying)
      const design = String(b.design || ''); if (!(q.designs || []).includes(design)) return NextResponse.json({ ok: false, error: 'Please choose a design.' }, { status: 400 });
      let sendAt: string | null = null; if (b.sendAt) { const at = Date.parse(String(b.sendAt)); if (!Number.isFinite(at) || at < Date.now() + 5 * 60000 || at > Date.now() + 366 * 864e5) return NextResponse.json({ ok: false, error: 'Please choose a time later today or within the next year.' }, { status: 400 }); sendAt = new Date(at).toISOString(); }
      answer.design = design; answer.line = String(b.line ?? '').slice(0, 30); answer.message = String(b.message || '').trim().slice(0, 400) || null; answer.sendAt = sendAt;
    } else if (q.kind === 'sign') {
      const sig = String(b.signature || '');
      if (!sig.startsWith('data:image/png;base64,') || sig.length < 400) return NextResponse.json({ ok: false, error: 'Please sign before continuing.' }, { status: 400 });
      if (sig.length > 350_000) return NextResponse.json({ ok: false, error: 'That signature is too large. Please clear it and sign again.' }, { status: 400 });
      const cRef = db.collection(`${T}/chargeConsents`).doc();
      await cRef.set({ id: cRef.id, kind: q.what === 'membership' ? 'membership_terms' : q.what === 'pickup' ? 'pickup_signature' : 'signed_terms', title: q.title, text: q.text, ref: q.ref || null, clientId: q.clientId || null, clientName: q.clientName || null,
        signature: sig, signedAt: now(), via: 'client_screen', screenId, screenName: s.name || null, requestedBy: q.requestedBy || null });
      answer.signed = true; answer.consentId = cRef.id;
    } else if (q.kind === 'change') { const ch = num(q.change); const keepAmount = Math.max(0, Math.min(ch, Math.round(num(b.keepAmount ?? (b.keep === true ? ch : 0)) * 100) / 100)); answer.keep = keepAmount > 0; answer.keepAmount = keepAmount; answer.change = ch; }
    else return NextResponse.json({ ok: false, error: 'There is nothing to answer.' }, { status: 409 });
    await ref.update({ request: { ...q, answeredAt: now() }, response: answer, lastSeen: now() });   // replace, never merge
    return NextResponse.json({ ok: true });
  }

  // ── Staff ──
  const tenantId = String(b.tenantId || '');
  const auth: any = await verifyStaffActor(req, tenantId);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error || 'Please sign in to continue.' }, { status: auth.status || 401 });
  if (action === 'pair_confirm') {
    const code = String(b.code || '').replace(/\D/g, '');
    if (code.length !== 6) return NextResponse.json({ ok: false, error: 'Please enter the 6-digit code shown on the screen.' }, { status: 400 });
    const hit = (await db.collection('clientScreens').where('code', '==', code).get()).docs.find((d: any) => !(d.data() as any).tenantId && Date.parse((d.data() as any).codeExpiresAt) > Date.now());
    if (!hit) return NextResponse.json({ ok: false, error: 'That code is no longer valid. Please refresh the screen for a new one.' }, { status: 404 });
    const name = String(b.name || '').trim().slice(0, 40) || 'Client screen';
    const pt: any = ((await db.doc(`tenants/${tenantId}`).get()).data() as any) || {}; const ps = clientScreenSettingsOf(pt);
    await hit.ref.set({ tenantId, name, code: null, codeExpiresAt: null, pairedAt: now(), pairedBy: auth.actor.name || 'Staff', phase: 'idle', request: null, response: null, ticket: null,
      brand: { name: pt.name || pt.businessName || '', logo: pt.logoUrl || pt.bookingPageSettings?.cfPageConfig?.logoUrl || null, accent: pt.bookingPageSettings?.cfPageConfig?.accentColor || pt.brandColor || null },
      settings: { welcome: ps.welcome, reviewTicket: ps.reviewTicket, motion: ps.motion, confetti: ps.confetti } }, { merge: true });   // the iPad shows your name, logo and welcome at once
    await logAuditAdmin(db, tenantId, { action: 'client_screen.paired', targetType: 'client_screen', targetId: hit.id, summary: `Client screen “${name}” paired by ${auth.actor.name}`, actor: { type: 'user', id: auth.actor.uid, name: auth.actor.name, role: auth.actor.role } } as any).catch(() => {});
    return NextResponse.json({ ok: true, screenId: hit.id, name });
  }
  if (action === 'list') {
    const rows = (await db.collection('clientScreens').where('tenantId', '==', tenantId).get()).docs.map((d: any) => { const x: any = d.data(); return { id: d.id, name: x.name, lastSeen: x.lastSeen || null, pairedAt: x.pairedAt || null }; });
    return NextResponse.json({ ok: true, screens: rows });
  }
  const ref = db.doc(`clientScreens/${screenId}`); const s: any = (await ref.get()).data();
  if (!s || s.tenantId !== tenantId) return NextResponse.json({ ok: false, error: 'That screen is not paired with this business.' }, { status: 404 });
  const t: any = ((await db.doc(`tenants/${tenantId}`).get()).data() as any) || {};
  const brand = { name: t.name || t.businessName || '', logo: t.logoUrl || t.bookingPageSettings?.cfPageConfig?.logoUrl || null, accent: t.bookingPageSettings?.cfPageConfig?.accentColor || t.brandColor || null };
  const settings = clientScreenSettingsOf(t);
  if (action === 'alive') { await ref.update({ deskAliveAt: now() }); return NextResponse.json({ ok: true }); }
  if (action === 'push') {
    const tk = b.ticket || null;
    const ticket = tk ? { clientFirst: String(tk.clientFirst || '').slice(0, 40), moments: (Array.isArray(tk.moments) ? tk.moments : []).slice(0, 2).map((m: any) => String(m).slice(0, 90)), context: (Array.isArray(tk.context) ? tk.context : []).slice(0, 3).map((c: any) => String(c).slice(0, 90)), lines: (Array.isArray(tk.lines) ? tk.lines : []).slice(0, 40).map((l: any) => ({ label: String(l.label || '').slice(0, 80), amount: num(l.amount), note: l.note ? String(l.note).slice(0, 60) : null, ...(l.gift && typeof l.gift === 'object' ? { gift: { design: /^[a-z0-9-]{2,30}$/.test(String(l.gift.design || '')) ? String(l.gift.design) : null, line: l.gift.line ? String(l.gift.line).slice(0, 30) : null, to: l.gift.to ? String(l.gift.to).slice(0, 60) : null, amount: num(l.gift.amount) } } : {}) })),
      subtotal: num(tk.subtotal), discount: num(tk.discount), tax: num(tk.tax), taxLabel: String(tk.taxLabel || 'Tax').slice(0, 60), tip: num(tk.tip), giftCard: num(tk.giftCard), total: num(tk.total), paid: num(tk.paid), due: num(tk.due) } : null;
    // A new ticket replaces a finished sale's thank-you screen.
    await ref.update({ deskAliveAt: now(), ticket, brand, settings: { welcome: settings.welcome, reviewTicket: settings.reviewTicket, motion: settings.motion, confetti: settings.confetti }, updatedAt: now(), ...(ticket ? (s.request?.kind === 'thanks' ? { request: null, response: null, phase: 'ticket' } : {}) : { phase: 'idle' }) });
    return NextResponse.json({ ok: true });
  }
  if (action === 'request') {
    const kind = String(b.kind || '');
    if (!['tip', 'approve', 'thanks', 'idle', 'cash', 'change', 'pay', 'sign', 'gift', 'giftuse'].includes(kind)) return NextResponse.json({ ok: false, error: 'Unknown request.' }, { status: 400 });
    if (kind === 'idle' && b.soft === true && s.request?.kind === 'thanks' && (['choose', 'pay'].includes(s.request.rebook?.stage) || Date.parse(s.request.holdUntil || '') > Date.now())) {
      await ref.update({ 'request.idleWhenDone': true, ticket: null });   // they're still busy — finish, then back to the logo
      return NextResponse.json({ ok: true, requestId: s.request.id, deferred: true });
    }
    // A payment on the screen names its sale's ticket (or the split it's a share of): never started without one, nor for a
    // sale already paid, finished, discarded, being split (for the whole bill), or with a card reader payment still going.
    // Checked before anything on the screen changes.
    const payTicket = kind === 'pay' ? safeId(b.pendingId) || safeId(b.splitPendingId) : ''; const payShare = kind === 'pay' && !safeId(b.pendingId) && !!safeId(b.splitPendingId);
    if (kind === 'pay') {
      if (!payTicket) return NextResponse.json({ ok: false, code: 'no_ticket', error: 'The sale wasn’t saved before the payment. Try again; nothing was charged.' }, { status: 400 });
      if (t.stripeAccountId && process.env.STRIPE_SECRET_KEY) {
        const block = await ticketBlocks(db, tenantId, payTicket, { share: payShare, stripe: readerStripe(), acct: t.stripeAccountId });
        if (block) return NextResponse.json({ ok: false, code: block.code, error: block.error, ...(block.paidWith ? { paidWith: block.paidWith, paidPayload: block.paidPayload } : {}) }, { status: block.status });
      }
    }
    const closed = await closeOpenPayment(db, s, kind === 'idle' ? 'the desk cancelled it' : 'the desk moved on');
    // What the desk hears about the payment just closed: paid (with the payment), so the desk never takes it again.
    const closedResp = closed === 'paid' && s.request ? closedAnswer(s.request, closed) : null;
    // The payment just closed went through, and it paid for this very sale: it isn't asked for again.
    if (kind === 'pay' && closed === 'paid' && t.stripeAccountId && process.env.STRIPE_SECRET_KEY) {
      const again = await ticketBlocks(db, tenantId, payTicket, { share: payShare, stripe: readerStripe(), acct: t.stripeAccountId });
      if (again) {
        await ref.update({ phase: 'ticket', request: null, response: closedResp, updatedAt: now() });
        return NextResponse.json({ ok: false, code: again.code, paymentClosed: closed, error: again.error, ...(again.paidWith ? { paidWith: again.paidWith, paidPayload: again.paidPayload } : {}) }, { status: again.status });
      }
    }
    const q: any = { id: rid(), kind, at: now(), requestedBy: auth.actor.name || 'Staff' };
    if (kind === 'tip') { q.providers = Array.isArray(b.providers) ? b.providers.slice(0, 8).map((p: any) => ({ id: String(p.id), name: String(p.name || 'Team member').slice(0, 40) })) : []; q.base = Math.max(0, num(b.base)); q.presets = settings.tipPresets; q.allowCustom = settings.allowCustomTip; q.showNoTip = settings.showNoTip; q.tipOn = settings.tipOn; }
    if (kind === 'approve') { q.amount = num(b.amount); q.cardLabel = String(b.cardLabel || '').slice(0, 40) || 'your card on file'; q.clientId = b.clientId || null; q.clientName = b.clientName || null;
      q.signature = settings.signCardOnFile && (!settings.signOver || q.amount >= settings.signOver);
      q.text = `I authorize ${brand.name || 'the business'} to charge $${q.amount.toFixed(2)} to ${q.cardLabel}.`; }
    if (kind === 'cash') { q.due = num(b.due); }
    if (kind === 'giftuse') { q.clientFirst = String(b.clientFirst || '').slice(0, 40) || null;   // "You have a gift card" — use it today or save it
      q.cards = (Array.isArray(b.cards) ? b.cards : []).slice(0, 3).map((c: any) => ({ design: /^[a-z0-9-]{2,30}$/.test(String(c?.design || '')) ? String(c.design) : null, line: c?.line ? String(c.line).slice(0, 30) : null, cents: Math.max(0, Math.round(num(c?.cents))), from: c?.from ? String(c.from).split(' ')[0].slice(0, 30) : null, last4: String(c?.last4 || '').replace(/[^A-Z0-9]/gi, '').slice(-4) })); }
    if (kind === 'gift') { q.amount = num(b.amount); q.to = String(b.to || '').slice(0, 60) || null; q.via = ['text', 'email', 'print', 'code'].includes(b.via) ? b.via : 'code';
      q.designs = (Array.isArray(b.designs) ? b.designs : []).map(String).filter((x: string) => /^[a-z0-9-]{2,30}$/.test(x)).slice(0, 40); q.design = q.designs.includes(String(b.design)) ? String(b.design) : q.designs[0] || 'frost';
      if (!q.designs.length) q.designs = ['frost']; }
    if (kind === 'sign') { q.title = String(b.title || 'Please sign').slice(0, 80); q.text = String(b.text || '').slice(0, 4000); q.clientId = b.clientId || null; q.clientName = b.clientName || null; q.what = String(b.what || 'terms').slice(0, 40); q.ref = b.ref ? String(b.ref).slice(0, 80) : null; }
    if (kind === 'pay') {   // the client pays on the iPad (card form) or their phone (QR) — a payment made on this business's account
      q.providers = Array.isArray(b.providers) ? b.providers.slice(0, 8).map((p: any) => ({ id: String(p.id), name: String(p.name || 'Team member').slice(0, 40) })) : [];
      const acct = t.stripeAccountId; if (!acct || !process.env.STRIPE_SECRET_KEY) return NextResponse.json({ ok: false, error: 'Please connect Stripe first (Settings → Payments).' }, { status: 400 });
      const amountCents = Math.round(num(b.amount) * 100); if (amountCents < 50) return NextResponse.json({ ok: false, error: 'There is nothing to charge.' }, { status: 400 });
      const stripe: any = readerStripe();   // the same card payments client as the rest of the desk (lib/reader-sale)
      const forTicket = payTicket; const isShare = payShare;
      let customerId: string | undefined;
      const cid = b.clientId ? String(b.clientId) : null; const cl: any = cid ? (((await db.doc(`tenants/${tenantId}/clients/${cid}`).get()).data() as any) || null) : null;
      if (cl) { customerId = cl.cardOnFile?.customerId || undefined;
        if (!customerId) { const c = await stripe.customers.create({ name: cl.name || undefined, email: cl.email || undefined, phone: cl.phone || undefined, metadata: { tenantId, clientId: cid! } } as any, { stripeAccount: acct } as any); customerId = c.id; } }
      const pi: any = await stripe.paymentIntents.create({ amount: amountCents, currency: 'usd', automatic_payment_methods: { enabled: true }, ...(customerId ? { customer: customerId } : {}),
        description: `${t.name || 'Sale'} — ${cl?.name || 'client'}`, metadata: { tenantId, clientId: cid || '', source: 'client_screen', screenId, pendingCheckoutId: forTicket, ...(isShare ? { split: '1', shareLabel: String(b.shareLabel || '').slice(0, 60) } : {}) } } as any, { stripeAccount: acct } as any);
      q.amount = amountCents / 100; q.amountBase = amountCents / 100; q.tip = 0; q.tipBase = Math.max(0, num(b.tipBase)); q.askTip = b.askTip === true; q.review = settings.reviewTicket !== false;
      q.presets = settings.tipPresets; q.allowCustom = settings.allowCustomTip; q.showNoTip = settings.showNoTip; q.paymentIntentId = pi.id; q.clientSecret = pi.client_secret; q.clientId = cid; q.customerId = customerId || null; q.allowSave = !!cl && settings.offerSaveCard !== false; q.saveCard = false; q.pendingId = b.pendingId ? String(b.pendingId) : null;
      q.phoneUrl = `${linkOrigin(t, req.nextUrl.origin)}/pay/${screenId}?r=${q.id}`;
      q.payOnScreen = settings.payOnScreen; q.payOnPhone = settings.payOnPhone; q.timeoutMin = settings.payTimeoutMin;
      q.shareLabel = b.shareLabel ? String(b.shareLabel).slice(0, 60) : null; q.splitPendingId = b.splitPendingId ? String(b.splitPendingId) : null; if (q.splitPendingId) q.pendingId = null;
    }
    if (kind === 'change') { q.due = num(b.due); q.tendered = num(b.tendered); q.change = num(b.change); q.offerKeep = (t?.clientScreen?.offerKeepChange !== false); }
    if (kind === 'thanks') { const rs = rebookSettingsOf(t); q.rebookCtx = rs.on && b.rebook?.clientId && b.rebook?.serviceId ? { clientId: String(b.rebook.clientId), serviceId: String(b.rebook.serviceId), staffId: b.rebook.staffId ? String(b.rebook.staffId) : null, addOnIds: Array.isArray(b.rebook.addOnIds) ? b.rebook.addOnIds.slice(0, 6).map(String) : [], appointmentId: b.rebook.appointmentId ? String(b.rebook.appointmentId) : null } : null; q.rebookFirst = b.rebookFirst === true; q.returnAfter = Math.max(5, Math.min(120, Number(t?.clientScreen?.returnAfter) || 20)); q.receiptId = b.receiptId || null; q.offerReceipt = settings.offerReceipt; q.total = num(b.total); q.clientFirst = String(b.clientFirst || '').slice(0, 40); }
    await ref.update({ phase: kind === 'idle' ? 'idle' : kind, request: kind === 'idle' ? null : q, response: closedResp, brand, ...(kind === 'idle' || kind === 'thanks' ? { ticket: null } : {}), updatedAt: now() });   // replace, never merge
    return NextResponse.json({ ok: true, requestId: q.id, paymentClosed: closed, ...(closedResp ? { closedAnswer: closedResp } : {}) });
  }
  if (action === 'unpair') {
    await ref.set({ tenantId: null, name: null, phase: 'unpaired', request: null, response: null, ticket: null }, { merge: true });
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ ok: false, error: 'Unknown action.' }, { status: 400 });
}
