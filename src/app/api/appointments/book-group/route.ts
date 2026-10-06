// src/app/api/appointments/book-group/route.ts — ONLINE GROUPS AND "ANOTHER SERVICE", THROUGH THE ENGINE.
// POST { tenantId, organizer: { name, email, phone, smsConsent? }, parts: [{ serviceId, staffId?, startTime, addOnIds?,
//        guest?: { name, email?, phone? } }], groupName?, notes?, signedForms?, channel? }
// Every part is booked by the shared booking engine (/api/appointments/book) AS A PUBLIC BOOKING — notice, horizon,
// prices and availability all apply — and as a REQUEST (groupRequest): each part holds its slot until the studio
// answers, and the studio accepts the group together; accepting is when the deposit is asked for. All or nothing: if
// any part can't be booked, the parts already made are removed and nothing is sent.
// Business rules (Settings → Group bookings): on/off · most guests · who pays the deposits (the organiser, or each guest
// who gave contact details) · "another service" side by side or straight after. Renters' services can't be part of a
// group (their money is their own), and every part must be at the same location.
import { limitPublic } from '@/lib/rate-limit';
import { createHmac } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { internalOrigin } from '@/lib/message-policy';
import { groupPolicy } from '@/lib/group-policy';
export const dynamic = 'force-dynamic';
const s = (v: any, n = 200) => String(v ?? '').trim().slice(0, n);

/** Signs each per-guest call to the booking engine so it skips the per-visitor count (this route already counted the visitor). */
function groupSigFor(tenantId: string) { return (p: any) => process.env.CRON_SECRET ? createHmac('sha256', process.env.CRON_SECRET).update(`${tenantId}|${s(p.serviceId, 120)}|${s(p.startTime, 40)}`).digest('hex') : ''; }

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({})); const tenantId = s(b.tenantId, 80);
  { const limited = await limitPublic(req, 'book-group', String(tenantId || ''), { perHour: 6, perDay: 150 }); if (limited) return limited; }
  const groupSig = groupSigFor(tenantId);
  const parts: any[] = Array.isArray(b.parts) ? b.parts.slice(0, 13) : [];
  if (!tenantId || parts.length < 2) return NextResponse.json({ ok: false, error: 'Missing details.' }, { status: 400 });
  const db = getAdminDb(); const T = `tenants/${tenantId}`; const tenant: any = (await db.doc(T).get()).data();
  if (!tenant) return NextResponse.json({ ok: false, error: 'Unknown business.' }, { status: 404 });
  const pol = groupPolicy(tenant);
  if (!pol.enabled) return NextResponse.json({ ok: false, error: 'Group bookings aren’t taken online here — please call us.' }, { status: 400 });
  const guests = parts.filter((p) => p.guest).length;
  if (guests > pol.maxGuests) return NextResponse.json({ ok: false, error: `Up to ${pol.maxGuests} guest${pol.maxGuests === 1 ? '' : 's'} can be booked online — please call us for a bigger group.` }, { status: 400 });
  const organizer = { name: s(b.organizer?.name, 120), email: s(b.organizer?.email, 160), phone: s(b.organizer?.phone, 40) };
  if (!organizer.name || (!organizer.email && !organizer.phone)) return NextResponse.json({ ok: false, error: 'Your name and an email or phone number, please.' }, { status: 400 });
  // Renters' services never join a group (their money is separate), and every part is at one location.
  const svcs = await Promise.all(parts.map((p) => db.doc(`${T}/services/${s(p.serviceId, 120)}`).get().then((d: any) => d.data()).catch(() => null)));
  if (svcs.some((x: any) => !x)) return NextResponse.json({ ok: false, error: 'One of those services isn’t available online.' }, { status: 400 });
  if (svcs.some((x: any) => x.renterProviderId || x.renterId || x.ownerType === 'renter')) return NextResponse.json({ ok: false, error: 'That service is booked directly with its provider — book it on its own.' }, { status: 400 });
  const locs = new Set(parts.map((p) => s(p.locationId, 80)).filter(Boolean)); if (locs.size > 1) return NextResponse.json({ ok: false, error: 'Everything in one booking has to be at the same location.' }, { status: 400 });
  if (!pol.sideBySide && parts.some((p, i) => i > 0 && !p.guest && p.startTime === parts[0].startTime)) return NextResponse.json({ ok: false, error: 'Two services at once isn’t offered here — choose “straight after”.' }, { status: 400 });

  const origin = internalOrigin(tenant, req.nextUrl.origin); const linkId = `grp_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  const isGroup = guests > 0; const made: { appointmentId: string; checkInToken?: string; clientId?: string; guest: boolean; hasContact: boolean; depositCents: number }[] = [];
  const undo = async () => { for (const m of made) { await db.doc(`${T}/appointments/${m.appointmentId}`).delete().catch(() => {}); if (m.checkInToken) await Promise.all([db.doc(`appointmentCheckIns/${m.checkInToken}`).delete().catch(() => {}), db.doc(`${T}/appointmentCheckIns/${m.checkInToken}`).delete().catch(() => {})]); } };
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]; const g = p.guest ? { name: s(p.guest.name, 120), email: s(p.guest.email, 160), phone: s(p.guest.phone, 40) } : null;
    if (p.guest && !g!.name) { await undo(); return NextResponse.json({ ok: false, error: `Guest ${i} needs a name.` }, { status: 400 }); }
    const client = g ? { name: g.name, ...(g.email ? { email: g.email } : {}), ...(g.phone ? { phone: g.phone } : {}) } : { ...organizer, smsConsent: b.organizer?.smsConsent === true, smsConsentText: b.organizer?.smsConsentText || null };
    let r: any = null;
    try { const res = await fetch(`${origin}/api/appointments/book`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(groupSig(p) ? { 'x-cf-group-sig': groupSig(p) } : {}) },   // NO staff or internal credentials: a public booking
        body: JSON.stringify({ tenantId, source: 'booking-page', channel: s(b.channel, 24) || undefined, serviceId: s(p.serviceId, 120), addOnIds: Array.isArray(p.addOnIds) ? p.addOnIds.slice(0, 8) : [], staffId: s(p.staffId, 120) || 'any', startTime: s(p.startTime, 40),
          client, notes: i === 0 ? s(b.notes, 1000) : (g ? `Guest of ${organizer.name}` : `Part of ${organizer.name}’s visit`), signedForms: i === 0 && Array.isArray(b.signedForms) ? b.signedForms : [], groupRequest: true, quiet: i > 0 }) });
      r = { status: res.status, data: await res.json().catch(() => ({})) }; } catch { r = { status: 0, data: { error: 'Couldn’t reach the booking system.' } }; }
    if (!r.data?.ok) { await undo(); const who = g ? g.name : i === 0 ? 'you' : `the ${i === 1 ? 'second' : 'next'} service`; const why = s(r.data?.error || 'that time isn’t free', 200).replace(/[.!]+$/, '');
      return NextResponse.json({ ok: false, failedIndex: i, error: `Couldn’t book ${who}: ${why}. Nothing was booked.` }, { status: r.status === 409 ? 409 : 400 }); }
    made.push({ appointmentId: r.data.appointmentId, checkInToken: r.data.checkInToken, clientId: r.data.clientId, guest: !!g, hasContact: !!(g ? g.email || g.phone : true), depositCents: Number(r.data.depositCents) || 0 });
  }
  // Link the parts; settle who pays the deposits; mark name-only guests as the organiser's guests.
  const lead = made[0]; const batch = db.batch(); let movedCents = 0;
  made.forEach((m, i) => { const link: any = isGroup ? { groupId: linkId, groupRole: i === 0 ? 'organizer' : 'guest', groupName: s(b.groupName, 80) || null, groupSize: made.length } : { visitId: linkId, visitStep: i };
    const organiserPays = i > 0 && m.depositCents > 0 && (pol.deposits === 'organizer' || !m.hasContact || !m.guest);
    if (organiserPays) { movedCents += m.depositCents; Object.assign(link, { depositAmountCents: 0, depositCoveredBy: linkId, depositPaidBy: 'organizer' }); }
    batch.set(db.doc(`${T}/appointments/${m.appointmentId}`), { ...link, onlineGroupRequest: true }, { merge: true });
    if (m.guest && !m.hasContact && m.clientId && lead.clientId) batch.set(db.doc(`${T}/clients/${m.clientId}`), { guestOf: lead.clientId, guestOnly: true }, { merge: true });
    // Every guest is linked to the organiser ("Organises for" / "Guest of"), with an organiser's limited permissions.
    if (m.guest && m.clientId && lead.clientId && m.clientId !== lead.clientId) batch.set(db.collection(`${T}/clientRelationships`).doc(`org_${linkId}_${i}`), { fromId: lead.clientId, toId: m.clientId, kind: 'organizer', permissions: ['book', 'readiness', 'reminders'], note: s(b.groupName, 80) || 'Booked together online', createdAt: new Date().toISOString(), createdBy: 'online booking', endedAt: null, startsAt: null, endsAt: null }, { merge: true }); });
  if (movedCents > 0) batch.set(db.doc(`${T}/appointments/${lead.appointmentId}`), { depositAmountCents: lead.depositCents + movedCents, groupDepositCents: lead.depositCents + movedCents }, { merge: true });
  await batch.commit();
  return NextResponse.json({ ok: true, linkId, kind: isGroup ? 'group' : 'visit', booked: made.length, status: 'requested', depositCents: lead.depositCents + movedCents,
    clientNotice: `Your request for ${made.length} ${isGroup ? 'people' : 'services'} is in — we’ll confirm shortly${lead.depositCents + movedCents > 0 ? `, and the deposit is only asked for once we do` : ''}.` });
}
