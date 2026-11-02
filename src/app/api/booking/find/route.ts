// /api/booking/find — FIND MY BOOKING, from the booking page.
//   GET  ?tenantId=…                    → the business's name, color, mood and logo, for the page
//   POST { tenantId, contact }           → their upcoming visits' links, sent ONLY to that phone or email
// The answer is always the same ("if that has a booking, a link is on its way"), and it comes back before any lookup
// is done (the lookup and the sending happen after the answer), so neither what it says nor how long it takes tells
// anyone who has a booking here. A phone is a US number, matched and texted as the same number (+1 and its 10
// digits), so a link can never go to another number that merely ends the same way. Each link is the visit's own page.
import { NextRequest, NextResponse, after } from 'next/server';
import { createHash } from 'crypto';
import { getAdminDb } from '@/lib/firebase-admin';
import { limitPublic, bump } from '@/lib/rate-limit';
import { publicLook } from '@/lib/public-look';
import { linkOrigin } from '@/lib/app-origin';
import { tenantTimeZone } from '@/lib/tenant-time';
import { privacyOf } from '@/lib/health-privacy';
import { usPhone } from '@/lib/us-phone';
import { MESSAGE_KINDS, resolveMessagePolicy, renderMessage } from '@/lib/message-policy';
import { sendNotification } from '@/lib/notify';
import { brandedEmailHtml } from '@/lib/email-template';

export const dynamic = 'force-dynamic';
const ID = /^[A-Za-z0-9_-]{1,80}$/;
/** Visits that are over or not happening (the same list booking uses). */
const DEAD = new Set(['cancelled', 'canceled', 'declined', 'expired', 'completed', 'no_show', 'released']);

export async function GET(req: NextRequest) {
  const tenantId = String(req.nextUrl.searchParams.get('tenantId') || '');
  if (!ID.test(tenantId)) return NextResponse.json({ ok: false }, { status: 400 });
  const t: any = (await getAdminDb().doc(`tenants/${tenantId}`).get()).data();
  if (!t) return NextResponse.json({ ok: false }, { status: 404 });
  return NextResponse.json({ ok: true, ...publicLook(t) },
    { headers: { 'Cache-Control': 'public, max-age=60, s-maxage=60' } });
}

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({}));
  const tenantId = String(b?.tenantId || ''); const contact = String(b?.contact || '').trim().slice(0, 160);
  const isEmail = contact.includes('@'); const d10 = isEmail ? '' : usPhone(contact);
  if (!ID.test(tenantId) || (isEmail ? !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contact) : !d10)) return NextResponse.json({ ok: false, error: 'Enter the phone number (a US number) or email you booked with.' }, { status: 400 });
  const sent = NextResponse.json({ ok: true, channel: isEmail ? 'email' : 'text' }, { headers: { 'Cache-Control': 'no-store' } });
  const limited = await limitPublic(req, 'find-booking', tenantId, { perHour: 10, perDay: 300 }); if (limited) return limited;
  // Three per phone or email in any half hour (two hourly counts, half an hour apart, and both must allow it), so
  // nobody can flood someone with messages, even across the turn of an hour.
  const key = createHash('sha256').update(`${tenantId}|${isEmail ? contact.toLowerCase() : d10}`).digest('hex').slice(0, 32);
  for (const shift of [0, 1800000]) if (!(await bump(`find-booking-to_${key}_${shift ? 'b' : 'a'}${Math.floor((Date.now() + shift) / 3600000)}`, 3, 2 * 3600000).catch(() => true))) return sent;
  const origin = req.nextUrl.origin;
  after(() => sendLinks(tenantId, isEmail ? { email: contact } : { d10 }, origin));
  return sent;
}

/** The message as email paragraphs, every link a real one to tap (all text escaped). */
function linkedHtml(body: string): string {
  const esc = (x: string) => x.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
  return body.split('\n').filter((l) => l.trim()).map((l) => `<p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#334155;">${
    l.split(/(https?:\/\/[^\s<>"']+)/).map((part, i) => (i % 2 ? `<a href="${esc(part)}" style="color:#16171a;font-weight:600;word-break:break-all;">${esc(part)}</a>` : esc(part))).join('')}</p>`).join('');
}

async function sendLinks(tenantId: string, to: { email?: string; d10?: string }, origin: string) {
  const T = `tenants/${tenantId}`;
  try {
    const db = getAdminDb(); const t: any = (await db.doc(T).get()).data(); if (!t) return;
    // Their profiles in the business's own book (a renter's clients book on the renter's own link), by the email in
    // any case, or by the phone however it was saved.
    const col = db.collection(`${T}/clients`); const ids = new Map<string, any>();
    const add = (d: any) => { const c = d.data() || {}; if (!c.ownerRenterId) ids.set(d.id, c); };
    if (to.email) {
      const lower = to.email.toLowerCase();
      for (const e of [...new Set([to.email, lower])]) (await col.where('email', '==', e).limit(10).get()).docs.forEach(add);
      if (lower.length <= 40) (await col.where('searchKeys', 'array-contains', lower).limit(10).get()).docs.filter((d: any) => String(d.data()?.email || '').toLowerCase() === lower).forEach(add);
    } else if (to.d10) {
      const d = to.d10;
      for (const f of [`+1${d}`, d, `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`, `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`]) (await col.where('phone', '==', f).limit(10).get()).docs.forEach(add);
      (await col.where('searchKeys', 'array-contains', d).limit(10).get()).docs.filter((x: any) => usPhone(String(x.data()?.phone || '')) === d).forEach(add);
    }
    if (!ids.size) return;
    const now = Date.now(); const visits: any[] = [];
    for (const id of [...ids.keys()].slice(0, 5)) {
      // By client alone (no extra index needed), then the ones still to come or under way.
      (await db.collection(`${T}/appointments`).where('clientId', '==', id).limit(300).get()).docs
        .map((x: any) => ({ id: x.id, ...(x.data() || {}) }))
        .filter((a: any) => a.checkInToken && !DEAD.has(String(a.status || '').toLowerCase()) && Date.parse(a.endTime || a.startTime || '') >= now)
        .forEach((a: any) => visits.push(a));
    }
    if (!visits.length) return;
    visits.sort((a, c) => Date.parse(a.startTime) - Date.parse(c.startTime));
    const base = linkOrigin(t, origin); const tz = tenantTimeZone(t); const discreet = privacyOf(t).discreet;
    const when = (a: any) => new Date(a.startTime).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: tz }).replace(/ /g, ' ');
    // A business that keeps messages discreet: no service names, just the time. A text carries the next four, an email
    // the next ten; any after that come when they ask again once these have passed.
    const cap = to.email ? 10 : 4;
    const lines = visits.slice(0, cap).map((a) => `${discreet ? 'Your visit' : a.serviceName || 'Your visit'}, ${when(a)}: ${base}/check-in/${a.checkInToken}`);
    if (visits.length > cap) lines.push(`And ${visits.length - cap} more after these. Ask again once these have passed to get their links.`);
    // Letters only (as the page keeps it), so a name typed as a web address never becomes a link in the message.
    const named = String([...ids.values()][0]?.name || '').trim().split(/\s+/)[0].replace(/[^\p{L}\p{M}'-]/gu, '').slice(0, 40);
    const first = named ? named[0].toUpperCase() + named.slice(1) : 'there';
    const tokens = { client_first: first, visits: lines.join('\n'), studio: t.name || 'us' };
    const def: any = (MESSAGE_KINDS as any[]).find((k) => k.id === 'find_booking') || {};
    const channel = to.email ? 'email' : 'sms';
    const p: any = resolveMessagePolicy(t, 'find_booking', channel);
    const body = renderMessage(p.body || def.defaultBody || '', tokens);
    const clientId = [...ids.keys()][0];
    if (channel === 'sms') await sendNotification(db, { tenantId, channel, to: `+1${to.d10}`, kind: 'find_booking', tokens, essential: true, clientId, clientName: first, text: body } as any);
    else { const subject = renderMessage(p.subject || def.defaultSubject || 'Your visits', tokens);
      await sendNotification(db, { tenantId, channel, to: to.email, kind: 'find_booking', tokens, essential: true, clientId, clientName: first, subject, text: body, html: brandedEmailHtml({ studioName: t.name || 'The studio', title: subject, bodyHtml: linkedHtml(body) } as any) } as any); }
  } catch (e: any) { console.error('[booking/find]', tenantId, e?.message || e); }
}
