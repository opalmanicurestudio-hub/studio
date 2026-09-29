// src/app/api/appointments/provider-offer/route.ts
//
// OFFER ANOTHER PROVIDER — with the PROVIDER's say and the client's consent.
// Staff (a manager — provider changes are a manager's call) offer a late
// client a different provider and time; the client accepts or declines from
// their visit link (/api/appt 'provider_offer_reply'). Nothing changes until
// they accept. The new provider must be free for the whole service.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { logAuditAdmin } from '@/lib/audit';
import { verifyStaffActor } from '@/lib/staff-auth';
import { linkOrigin } from '@/lib/app-origin';
import { opsCan, opsLevelOf } from '@/lib/appointment-ops';
import { providerFree } from '@/lib/provider-availability';

export const dynamic = 'force-dynamic';
import { suggestProviders, offerSettingsOf, mustAsk } from '@/lib/provider-suggest';

// Actions (staff unless noted):
//   suggest        — the ranked shortlist (lib/provider-suggest): eligible first, then fair turn, with reasons
//   offer          — renters (always) and employees (if "ask first") are ASKED before the client sees anything;
//                    otherwise it goes straight to the client, as before
//   provider_reply — PUBLIC, key-gated: the provider accepts or declines from their private link
//   tick           — expire unanswered asks (no answer = a decline → next suggestion, or tell the manager)
// GET ?tenantId&apptId&k — PUBLIC: what the provider is being asked (their private link).

const iso = () => new Date().toISOString();
const firstOf = (n: any) => String(n || '').split(' ')[0];
const mintToken = () => `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;

async function mirror(db: any, T: string, ap: any, offer: any) {
  // The client's visit link sees the offer (but never the provider's private key).
  if (ap.checkInToken) await Promise.all([db.doc(`appointmentCheckIns/${ap.checkInToken}`).set({ providerOffer: offer }, { merge: true }).catch(() => {}), db.doc(`${T}/appointmentCheckIns/${ap.checkInToken}`).set({ providerOffer: offer }, { merge: true }).catch(() => {})]);
}

async function tellClient(db: any, tenantId: string, tenant: any, ap: any, appointmentId: string, offer: any, origin: string) {
  const T = `tenants/${tenantId}`;
  const when = new Date(offer.startAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tenant.timezone || undefined });
  const msg = `Hi ${firstOf(ap.clientName) || 'there'} — to fit you in, ${firstOf(offer.toStaffName) || 'another of our team'} can see you at ${when}${offer.fromStaffName ? ` instead of ${firstOf(offer.fromStaffName)}` : ''}. Would that work? Accept or decline with the link below.`;
  let told = false;
  try {
    const base = linkOrigin(tenant, origin); const link = ap.checkInToken ? `${base}/check-in/${ap.checkInToken}` : null;
    const cl: any = ap.clientId ? (((await db.doc(`${T}/clients/${ap.clientId}`).get()).data() as any) || {}) : {};
    const email = String(cl.email || ap.clientEmail || '').trim(), phone = String(cl.phone || ap.clientPhone || '').trim();
    const { sendNotification } = await import('@/lib/notify'); const { brandedEmailHtml } = await import('@/lib/email-template');
    const studio = tenant.name || tenant.businessName || 'the studio';
    if (email.includes('@')) told = !!(await sendNotification(db, { tenantId, channel: 'email', to: email, subject: `Another time option for today — ${studio}`, kind: 'provider_offer',
      html: brandedEmailHtml({ studioName: studio, title: 'Another option for today', bodyLines: [msg], cta: link ? { label: 'Accept or decline', url: link } : null }), appointmentId, clientId: ap.clientId || null, clientName: ap.clientName || null } as any))?.ok;
    if (phone) told = !!(await sendNotification(db, { tenantId, channel: 'sms', to: phone, kind: 'provider_offer', text: `${studio}: ${msg}${link ? ` ${link}` : ''}`, appointmentId, clientId: ap.clientId || null, clientName: ap.clientName || null } as any))?.ok || told;
  } catch (e) { console.error('[provider-offer] client message failed', e); }
  return told;
}

/** Ask the provider first (renters always; employees if the business chose "ask first"). */
async function askProvider(db: any, tenantId: string, tenant: any, ap: any, appointmentId: string, to: any, offer: any, origin: string) {
  const T = `tenants/${tenantId}`; const s = offerSettingsOf(tenant);
  const token = mintToken(); const answerBy = new Date(Date.now() + s.answerMinutes * 60000).toISOString();
  const asking = { ...offer, status: 'asking_provider', answerBy };
  await db.doc(`${T}/appointments/${appointmentId}`).set({ providerOffer: asking, providerAsk: { staffId: to.id, token, answerBy, askedAt: iso() } }, { merge: true });
  await mirror(db, T, ap, asking);
  const svc: any = ap.serviceId ? (((await db.doc(`${T}/services/${ap.serviceId}`).get()).data() as any) || {}) : {};
  const tz = tenant.timezone || undefined; const at = new Date(offer.startAt);
  const dayOf = (x: Date) => x.toLocaleDateString('en-US', { timeZone: tz });
  const time = at.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz });
  const when = dayOf(at) === dayOf(new Date()) ? `today at ${time}` : dayOf(at) === dayOf(new Date(Date.now() + 864e5)) ? `tomorrow at ${time}` : `${at.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: tz })} at ${time}`;
  const price = Number(ap.price ?? svc.price) || 0;
  const link = `${linkOrigin(tenant, origin)}/offer/${tenantId}/${appointmentId}?k=${token}`;
  const text = `Can you take ${firstOf(ap.clientName) || 'a client'}’s ${svc.name || ap.serviceName || 'appointment'} ${when} (${offer.minutes || 60} min${price ? ` · $${price.toFixed(0)}` : ''})? Please answer within ${s.answerMinutes} minutes.`;
  try {
    if (to.isRenter || to.renterId) {
      const { notifyRenter } = await import('@/lib/renter-comms');
      if (to.renterId) await notifyRenter(db, tenantId, String(to.renterId), 'offers', text, { tone: 'amber', link, subject: 'A client offer from the front desk' } as any);
    } else {
      const n = db.collection(`${T}/notifications`).doc();
      await n.set({ id: n.id, userId: to.id, read: false, createdAt: iso(), type: 'provider_ask', appointmentId, message: `${text} Accept or decline: ${link}`, link });
      if (String(to.phone || '').trim()) { const { sendNotification } = await import('@/lib/notify');
        await sendNotification(db, { tenantId, channel: 'sms', to: String(to.phone), kind: 'provider_ask', text: `${tenant.name || 'Front desk'}: ${text} ${link}`, appointmentId, recipientType: 'staff', recipientId: to.id } as any); }
    }
  } catch (e) { console.error('[provider-offer] ask failed', e); }
  return asking;
}

/** Make the offer: ask the provider first, or go straight to the client. */
async function makeOffer(db: any, tenantId: string, tenant: any, ap: any, appointmentId: string, toStaffId: string, startMs: number, by: string, origin: string, declined: string[] = [], tell = true) {
  const T = `tenants/${tenantId}`; const s = offerSettingsOf(tenant);
  const to: any = { id: toStaffId, ...(((await db.doc(`${T}/staff/${toStaffId}`).get()).data() as any) || {}) };
  const from: any = ap.staffId ? (((await db.doc(`${T}/staff/${ap.staffId}`).get()).data() as any) || {}) : {};
  const sug = (await suggestProviders(db, tenantId, ap, appointmentId, startMs, declined)).find((x) => x.staffId === toStaffId);
  const durMs = Math.max(15 * 60000, (Date.parse(ap.endTime || ap.startTime) - Date.parse(ap.startTime)) || 60 * 60000);
  const minutes = sug?.minutes || Math.round(durMs / 60000);
  const offer: any = { toStaffId, toStaffName: to.name || null, fromStaffId: ap.staffId || null, fromStaffName: from.name || null, startAt: new Date(startMs).toISOString(), minutes, at: iso(), by, declinedBy: declined };
  if (mustAsk(to, s)) return { offer: await askProvider(db, tenantId, tenant, ap, appointmentId, to, offer, origin), asked: true, told: false };
  const pending = { ...offer, status: 'pending' };
  await db.doc(`${T}/appointments/${appointmentId}`).set({ providerOffer: pending, providerAsk: null }, { merge: true });
  await mirror(db, T, ap, pending);
  const told = tell ? await tellClient(db, tenantId, tenant, ap, appointmentId, pending, origin) : false;
  return { offer: pending, asked: false, told };
}

/** The asked provider declined (or didn't answer): try the next suggestion, or tell the manager. */
async function advance(db: any, tenantId: string, tenant: any, ap: any, appointmentId: string, why: 'declined' | 'no_answer', origin: string) {
  const T = `tenants/${tenantId}`; const s = offerSettingsOf(tenant); const po = ap.providerOffer || {};
  const declined = Array.from(new Set([...(po.declinedBy || []), po.toStaffId].filter(Boolean)));
  const startMs = Date.parse(po.startAt || ap.etaAt || ap.startTime);
  const who = firstOf(po.toStaffName) || 'The provider';
  const note = why === 'declined' ? `${who} declined` : `${who} didn’t answer in time`;
  await logAuditAdmin(db, tenantId, { action: 'appointment.provider_ask_' + why, targetType: 'appointment', targetId: appointmentId, summary: `${note} — offer for ${ap.clientName || 'the client'}`, actor: { type: 'system', name: 'Provider offers' } } as any).catch(() => {});
  if (s.onNoAnswer === 'next') {
    const next = (await suggestProviders(db, tenantId, ap, appointmentId, startMs, declined))[0];
    if (next) return { next: next.name, ...(await makeOffer(db, tenantId, tenant, ap, appointmentId, next.staffId, startMs, 'Provider offers (next suggestion)', origin, declined)) };
  }
  const closed = { ...po, status: 'provider_declined', declinedBy: declined, closedAt: iso(), note };
  await db.doc(`${T}/appointments/${appointmentId}`).set({ providerOffer: closed, providerAsk: null }, { merge: true });
  await mirror(db, T, ap, closed);
  const n = db.collection(`${T}/notifications`).doc();
  await n.set({ id: n.id, userId: null, forRoles: ['owner', 'admin', 'manager'], read: false, createdAt: iso(), type: 'provider_offer_closed', appointmentId, link: 'pos',
    message: `${note}${s.onNoAnswer === 'next' ? ' — and nobody else is free' : ''}. Decide what happens for ${ap.clientName || 'the client'}.` }).catch(() => {});
  return { closed: true };
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const tenantId = String(sp.get('tenantId') || ''), appointmentId = String(sp.get('apptId') || ''), k = String(sp.get('k') || '');
  const db = getAdminDb(); const T = `tenants/${tenantId}`;
  const ap: any = tenantId && appointmentId ? (((await db.doc(`${T}/appointments/${appointmentId}`).get()).data() as any) || null) : null;
  if (!ap || !k || ap.providerAsk?.token !== k) return NextResponse.json({ ok: false, error: 'This offer isn’t open any more.' }, { status: 404 });
  const tenant: any = ((await db.doc(T).get()).data() as any) || {};
  const svc: any = ap.serviceId ? (((await db.doc(`${T}/services/${ap.serviceId}`).get()).data() as any) || {}) : {};
  const po = ap.providerOffer || {};
  return NextResponse.json({ ok: true, business: tenant.name || 'The front desk', client: firstOf(ap.clientName) || 'A client', service: svc.name || ap.serviceName || 'Appointment',
    startAt: po.startAt, minutes: po.minutes || null, price: Number(ap.price ?? svc.price) || null, answerBy: ap.providerAsk.answerBy, open: po.status === 'asking_provider' && Date.parse(ap.providerAsk.answerBy) > Date.now(),
    accent: tenant.bookingPageSettings?.cfPageConfig?.accentColor || tenant.brandColor || null, timezone: tenant.timezone || null });
}

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const action = String(b.action || 'offer');
  const tenantId = String(b.tenantId || ''), appointmentId = String(b.appointmentId || '');
  if (!tenantId || !appointmentId) return NextResponse.json({ ok: false, error: 'Missing details.' }, { status: 400 });
  const db = getAdminDb(); const T = `tenants/${tenantId}`;
  const tenant: any = ((await db.doc(T).get()).data() as any) || {};
  const ref = db.doc(`${T}/appointments/${appointmentId}`);
  const ap: any = ((await ref.get()).data() as any) || null;
  if (!ap) return NextResponse.json({ ok: false, error: 'That booking wasn’t found.' }, { status: 404 });
  const origin = req.nextUrl.origin;

  // ── The provider answers from their private link (no sign-in) ──
  if (action === 'provider_reply') {
    const ask = ap.providerAsk; const po = ap.providerOffer || {};
    if (!ask?.token || ask.token !== String(b.k || '') || po.status !== 'asking_provider') return NextResponse.json({ ok: false, error: 'This offer isn’t open any more.' }, { status: 409 });
    if (Date.parse(ask.answerBy) <= Date.now()) { await advance(db, tenantId, tenant, ap, appointmentId, 'no_answer', origin); return NextResponse.json({ ok: false, error: 'Sorry — the time to answer has passed, so it went to someone else.' }, { status: 409 }); }
    if (b.choice === 'accept') {
      if (!(await providerFree(db, T, ask.staffId, Date.parse(po.startAt), Date.parse(po.startAt) + (po.minutes || 60) * 60000, appointmentId)))
        return NextResponse.json({ ok: false, error: 'Your calendar changed and that time isn’t free any more.' }, { status: 409 });
      const pending = { ...po, status: 'pending', providerAcceptedAt: iso() };
      await ref.set({ providerOffer: pending, providerAsk: null }, { merge: true });
      await mirror(db, T, ap, pending);
      const told = await tellClient(db, tenantId, tenant, ap, appointmentId, pending, origin);
      await logAuditAdmin(db, tenantId, { action: 'appointment.provider_ask_accepted', targetType: 'appointment', targetId: appointmentId, summary: `${po.toStaffName || 'The provider'} accepted — ${ap.clientName || 'the client'} has been offered the change`, actor: { type: 'user', name: po.toStaffName || 'Provider' } } as any).catch(() => {});
      return NextResponse.json({ ok: true, accepted: true, clientTold: told });
    }
    const r = await advance(db, tenantId, tenant, ap, appointmentId, 'declined', origin);
    return NextResponse.json({ ok: true, declined: true, ...r });
  }

  const auth: any = await verifyStaffActor(req, tenantId);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error || 'Sign in to do that.' }, { status: auth.status || 401 });
  const s = offerSettingsOf(tenant);
  const allowed = s.who === 'desk' || opsCan(auth.actor.role, opsLevelOf(tenant), ap.staffId === auth.actor.uid, 'switch');

  if (action === 'tick') {
    const po = ap.providerOffer || {};
    if (po.status === 'asking_provider' && ap.providerAsk?.answerBy && Date.parse(ap.providerAsk.answerBy) <= Date.now())
      return NextResponse.json({ ok: true, expired: true, ...(await advance(db, tenantId, tenant, ap, appointmentId, 'no_answer', origin)) });
    return NextResponse.json({ ok: true, expired: false });
  }
  const startMs = Date.parse(String(b.startAt || ap.etaAt || ap.startTime));
  if (!Number.isFinite(startMs)) return NextResponse.json({ ok: false, error: 'Pick a start time.' }, { status: 400 });
  if (action === 'suggest') return NextResponse.json({ ok: true, settings: { employees: s.employees, answerMinutes: s.answerMinutes }, suggestions: await suggestProviders(db, tenantId, ap, appointmentId, startMs, ap.providerOffer?.declinedBy || []) });

  // offer
  if (!allowed) return NextResponse.json({ ok: false, error: 'Provider changes are a manager’s call.' }, { status: 403 });
  const toStaffId = String(b.toStaffId || '');
  if (!toStaffId || toStaffId === ap.staffId) return NextResponse.json({ ok: false, error: toStaffId ? 'That’s already their provider.' : 'Choose who to offer.' }, { status: 400 });
  const durMs = Math.max(15 * 60000, (Date.parse(ap.endTime || ap.startTime) - Date.parse(ap.startTime)) || 60 * 60000);
  if (!(await providerFree(db, T, toStaffId, startMs, startMs + durMs, appointmentId))) return NextResponse.json({ ok: false, error: 'They aren’t free then.' }, { status: 409 });
  const r = await makeOffer(db, tenantId, tenant, ap, appointmentId, toStaffId, startMs, auth.actor.name, origin, ap.providerOffer?.declinedBy || [], b.tell !== false);
  await logAuditAdmin(db, tenantId, { action: r.asked ? 'appointment.provider_asked' : 'appointment.provider_offered', targetType: 'appointment', targetId: appointmentId,
    summary: r.asked ? `Asked ${r.offer.toStaffName || 'a provider'} to take ${ap.clientName || 'the client'} (${s.answerMinutes} min to answer)` : `Offered ${r.offer.toStaffName || 'another provider'} — waiting for ${ap.clientName || 'the client'} to accept${r.told ? '' : ' (not messaged)'}`,
    actor: { type: 'user', id: auth.actor.uid, name: auth.actor.name, role: auth.actor.role } }).catch(() => {});
  return NextResponse.json({ ok: true, offer: r.offer, asked: r.asked, told: r.told });
}
