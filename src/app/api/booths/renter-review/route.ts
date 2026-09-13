// src/app/api/booths/renter-review/route.ts
//
// A REVIEW OF THE RENTER, FROM A CLIENT WHO ACTUALLY WENT.
//
// A testimonials textbox a renter fills in themselves is worth nothing to a
// client. This one proves the visit: the link carries the appointment id
// (the same bearer model /cancel uses), and a review is accepted only for a
// COMPLETED renter booking, once. It lands as 'pending' in the renter's own
// moderation list; nothing is public until they publish it. Published
// reviews are mirrored onto the provider record so the booking page reads
// them with no new rule.
//
// GET  ?tenantId&appointmentId  → what the page needs to show (name, service, already reviewed?)
// POST { tenantId, appointmentId, rating, text, name? } → writes renterReviews/{appointmentId}

import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';

async function loadAppt(db: FirebaseFirestore.Firestore, tenantId: string, appointmentId: string) {
  const snap = await db.doc(`tenants/${tenantId}/appointments/${appointmentId}`).get();
  const a = (snap.data() as any) || null;
  if (!snap.exists || !a?.isRenterBooking) return { a: null, error: 'That link is not for a booking we can find.' };
  if (a.status !== 'completed') return { a, error: 'This visit has not been completed yet.' };
  const stSnap = await db.doc(`tenants/${tenantId}/staff/${a.renterProviderId || a.staffId}`).get();
  const st = (stSnap.data() as any) || {};
  return { a, st, error: null as string | null };
}

export async function GET(req: NextRequest) {
  const tenantId = String(req.nextUrl.searchParams.get('tenantId') || '').trim();
  const appointmentId = String(req.nextUrl.searchParams.get('appointmentId') || '').trim();
  if (!tenantId || !appointmentId) return NextResponse.json({ ok: false, error: 'Missing link details.' }, { status: 400 });
  const db = getAdminDb();
  const { a, st, error } = await loadAppt(db, tenantId, appointmentId);
  if (!a || error) return NextResponse.json({ ok: false, error: error || 'Not found.' }, { status: 404 });
  const existing = await db.doc(`tenants/${tenantId}/renterReviews/${appointmentId}`).get();
  return NextResponse.json({
    ok: true,
    providerName: st?.name || 'your provider',
    serviceName: a.renterServiceName || a.serviceName || 'your visit',
    when: a.startTime,
    clientFirst: String(a.clientName || '').split(' ')[0] || '',
    alreadyReviewed: existing.exists,
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const tenantId = String(body.tenantId || '').trim();
  const appointmentId = String(body.appointmentId || '').trim();
  if (!tenantId || !appointmentId) return NextResponse.json({ ok: false, error: 'Missing link details.' }, { status: 400 });
  const rating = Math.max(1, Math.min(5, Math.round(Number(body.rating) || 0)));
  const text = String(body.text || '').trim().slice(0, 600);
  if (!Number.isFinite(Number(body.rating)) || Number(body.rating) < 1) return NextResponse.json({ ok: false, error: 'Pick a star rating.' }, { status: 400 });
  const db = getAdminDb();
  const { a, st, error } = await loadAppt(db, tenantId, appointmentId);
  if (!a || error) return NextResponse.json({ ok: false, error: error || 'Not found.' }, { status: 404 });
  const ref = db.doc(`tenants/${tenantId}/renterReviews/${appointmentId}`);
  if ((await ref.get()).exists) return NextResponse.json({ ok: false, error: 'You have already left a review for this visit — thank you!' }, { status: 409 });
  const nowIso = new Date().toISOString();
  const name = String(body.name || a.clientName || '').trim().slice(0, 60);
  await ref.set({
    id: appointmentId, appointmentId, tenantId,
    staffId: a.renterProviderId || a.staffId, renterId: st?.renterId || null,
    clientId: a.clientId || null, clientName: name,
    serviceName: a.renterServiceName || a.serviceName || '',
    visitedAt: a.startTime, rating, text,
    status: 'pending', createdAt: nowIso,
  });
  // Tell the renter, on the record.
  if (st?.renterId) {
    const nRef = db.collection(`tenants/${tenantId}/notifications`).doc();
    await nRef.set({ id: nRef.id, type: 'renter_review', read: false, createdAt: nowIso, link: '/renters',
      message: `${name || 'A client'} left ${st.name || 'a renter'} a ${rating}-star review — waiting in their portal to publish.` }).catch(() => null);
  }
  return NextResponse.json({ ok: true });
}
