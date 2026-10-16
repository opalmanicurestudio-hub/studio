// src/app/api/agents/[tenantId]/hold/route.ts — AN ASSISTANT HOLDS A TIME FOR ITS CLIENT (lib/agent-holds).
//   POST { serviceId, providerId?: id | 'any', date: 'YYYY-MM-DD', time: 'HH:mm', client: { name, phone, email? }, addOnIds? }
//     → { ok, code: 'held', holdId, expiresAt, message } — the client gets one text to confirm; nothing is booked yet.
//     Refusals carry a code: holds_not_offered · service_not_found · service_needs_consultation · time_taken (with the
//     next open times) · too_many_requests · bad_request.
//   GET ?id=&k= — the booking page reads its own hold (service, provider, time, the client's details) to open on it.
// Needs the ClarityFlow Assistant add-on and the owner's switch (lib/agent-access).
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { linkOrigin } from '@/lib/app-origin';
import { agentErr, agentPolicy, holdable } from '@/lib/agent-access';
import { agentOpenTimes } from '@/lib/agent-feed';
import { holdKey, holdText, holdLive } from '@/lib/agent-holds';
import { smsConfigured, sendTenantSms } from '@/lib/sms';

export const dynamic = 'force-dynamic';
const H = { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' };
export async function OPTIONS() { return new NextResponse(null, { status: 204, headers: { ...H, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } }); }
const j = (b: any, status = 200) => NextResponse.json(b, { status, headers: H });
const digits = (p: string) => { const d = String(p || '').replace(/\D/g, ''); return d.length === 10 ? `+1${d}` : d.length === 11 && d.startsWith('1') ? `+${d}` : d.length >= 10 ? `+${d}` : ''; };

export async function GET(req: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params; const id = String(req.nextUrl.searchParams.get('id') || '').slice(0, 40), k = String(req.nextUrl.searchParams.get('k') || '');
  if (!/^[A-Za-z0-9_-]{2,80}$/.test(tenantId) || !id || !k) return j(agentErr('bad_request', 'This link isn’t complete.'), 400);
  const s = await getAdminDb().doc(`tenants/${tenantId}/agentHolds/${id}`).get(); const h: any = s.exists ? s.data() : null;
  if (!h || h.key !== k) return j(agentErr('bad_request', 'This link isn’t valid.'), 404);
  if (h.status === 'booked') return j({ ok: false, code: 'booked', message: 'This time is already booked. Check your messages for the confirmation.' }, 409);
  return j({ ok: true, code: holdLive(h) ? 'held' : 'hold_expired', live: holdLive(h), serviceId: h.serviceId, staffId: h.staffId, date: h.date, time: h.time, startTime: h.startTime, expiresAt: h.expiresAt,
    addOnIds: h.addOnIds || [], client: { name: h.clientName, phone: h.clientPhone, email: h.clientEmail || '' } });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params; const b: any = await req.json().catch(() => ({}));
  if (!/^[A-Za-z0-9_-]{2,80}$/.test(tenantId)) return j(agentErr('business_not_found', 'We couldn’t find that business.'), 404);
  const db = getAdminDb(); const T = `tenants/${tenantId}`; const t: any = (await db.doc(T).get()).data();
  if (!t) return j(agentErr('business_not_found', 'We couldn’t find that business.'), 404);
  const pol = agentPolicy(t); const book = `${linkOrigin(t, req.nextUrl.origin)}/book/${encodeURIComponent(tenantId)}`;
  if (!pol.holds) return j(agentErr('holds_not_offered', 'This business doesn’t take holds from assistants. Send the client its booking link instead.', { bookingUrl: book }), 403);
  const serviceId = String(b.serviceId || '').slice(0, 80), date = String(b.date || ''), time = String(b.time || '');
  const name = String(b.client?.name || '').trim().slice(0, 80), phone = digits(b.client?.phone), email = String(b.client?.email || '').trim().toLowerCase().slice(0, 120);
  if (!serviceId || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return j(agentErr('bad_request', 'Send serviceId, date (YYYY-MM-DD) and time (HH:mm, the business’s local time).'), 400);
  if (name.length < 2 || !phone) return j(agentErr('bad_request', 'Send the client’s name and mobile number: the client confirms the time from a text.'), 400);
  const svc: any = (await db.doc(`${T}/services/${serviceId}`).get()).data();
  if (!svc) return j(agentErr('service_not_found', 'That service isn’t on the menu. The ids are in the business feed.'), 404);
  if (!holdable(svc) || (pol.holdServices && !pol.holdServices.includes(serviceId))) return j(agentErr('service_needs_consultation', 'This service can’t be held by an assistant. Send the client the booking link so they can book or ask about it.', { bookingUrl: `${book}?service=${encodeURIComponent(serviceId)}` }), 409);
  // Limits: two live holds per number, thirty an hour per business.
  const now = Date.now(); const recent = (await db.collection(`${T}/agentHolds`).where('createdAt', '>=', new Date(now - 3600000).toISOString()).get().catch(() => ({ docs: [] as any[] }))).docs.map((d: any) => d.data());
  if (recent.length >= 30 || recent.filter((h: any) => h.clientPhone === phone && holdLive(h, now)).length >= 2) return j(agentErr('too_many_requests', 'Too many holds right now. Please try again later, or send the client the booking link.', { bookingUrl: book }), 429);
  // The time must be open right now, by the booking page's own rules.
  const providerId = b.providerId && b.providerId !== 'any' ? String(b.providerId) : null;
  const addOnIds = Array.isArray(b.addOnIds) ? b.addOnIds.slice(0, 8).map(String) : [];
  const ot: any = await agentOpenTimes(db, tenantId, { serviceId, providerId, from: date, days: 1, addOnIds });
  if (ot.status === 404) return j(ot.kind === 'provider' ? agentErr('provider_not_found', 'That person doesn’t do this service here. Use providerId any.') : agentErr('service_not_found', 'That service isn’t on the menu.'), 404);
  const slot = ot.times.find((x: any) => x.time === time);
  if (!slot) { const next: any = await agentOpenTimes(db, tenantId, { serviceId, providerId, from: date, days: 7, addOnIds });
    return j(agentErr('time_taken', 'That time isn’t open. Here are the next open times.', { next: (next.times || []).filter((x: any) => x.date > date || x.time > time).slice(0, 3) }), 409); }
  const staffId = providerId || slot.providers?.[0]?.id || null;
  const len = (Number(svc.duration) || 60) + (await Promise.all(addOnIds.map(async (id: string) => Number(((await db.doc(`${T}/services/${id}`).get()).data() as any)?.duration) || 0))).reduce((a, x) => a + x, 0);
  const startTime = slot.startsAt; const endTime = new Date(Date.parse(startTime) + len * 60000).toISOString();
  const ref = db.collection(`${T}/agentHolds`).doc(); const key = holdKey(); const expiresAt = new Date(now + pol.holdMinutes * 60000).toISOString();
  await ref.set({ id: ref.id, key, status: 'held', serviceId, serviceName: svc.name || null, staffId, addOnIds, date, time, startTime, endTime, durationMinutes: len,
    clientName: name, clientPhone: phone, clientEmail: email || null, createdAt: new Date(now).toISOString(), expiresAt, via: String(b.assistant || '').slice(0, 60) || null });
  // One text to the client, in the business's name.
  const link = `${book}?service=${encodeURIComponent(serviceId)}&hold=${ref.id}&k=${key}`;
  const when = new Date(startTime).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: ot.tz });
  let texted = false;
  if (smsConfigured()) { try { texted = !!(await sendTenantSms(db, tenantId, phone, holdText({ first: name.split(/\s+/)[0], studio: t.businessName || t.name || 'the studio', service: String(svc.name || 'appointment').toLowerCase(), when, minutes: pol.holdMinutes, link }), { email, subject: 'Confirm your time' }, { kind: 'agent_hold', recipientType: 'client', recipientName: name } as any)).ok; } catch { /* reported below */ } }
  if (!texted) { await ref.set({ status: 'released', releasedWhy: 'text_failed' }, { merge: true }); return j(agentErr('bad_request', 'We couldn’t text that number, so nothing was held. Check the number, or send the client the booking link.', { bookingUrl: book }), 422); }
  return j({ ok: true, code: 'held', holdId: ref.id, expiresAt, startsAt: startTime, providerId: staffId, message: `Held until ${new Date(expiresAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: ot.tz })}. ${name.split(/\s+/)[0]} has been texted a link to confirm it; it isn’t booked until they do.` }, 201);
}
