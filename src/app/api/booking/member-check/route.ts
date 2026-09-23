// src/app/api/booking/member-check/route.ts
//
// "I'm a member" on the STUDIO's booking page.
//
// Clients aren't publicly readable, so the page can't look a membership up
// itself. This answers one question — does an active studio membership sit
// behind this email or phone? — and returns only true/false: no name, no
// plan, nothing else about the client. It only changes what the calendar
// SHOWS; /api/appointments/book re-checks at confirm, so it isn't the gate.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const tenantId = String(body.tenantId || '').trim();
  const contact = String(body.contact || '').trim().slice(0, 160);
  if (!tenantId || !contact) return NextResponse.json({ ok: false, member: false }, { status: 400 });
  const db = getAdminDb();

  // Light throttle per tenant+contact: 10 checks an hour is plenty for a real person.
  try {
    const key = contact.toLowerCase().replace(/[^a-z0-9@.]/g, '').slice(0, 80) || 'x';
    const ref = db.doc(`tenants/${tenantId}/rateLimits/member-check-${key}`);
    const cur = ((await ref.get()).data() as any) || {};
    const hourAgo = Date.now() - 3600000;
    const stamps: number[] = (Array.isArray(cur.at) ? cur.at : []).filter((t: number) => t > hourAgo);
    if (stamps.length >= 10) return NextResponse.json({ ok: true, member: false, throttled: true });
    await ref.set({ at: [...stamps, Date.now()] }, { merge: true });
  } catch { /* throttle is best-effort */ }

  const col = db.collection(`tenants/${tenantId}/clients`);
  const docs: any[] = [];
  try {
    if (contact.includes('@')) {
      docs.push(...(await col.where('email', '==', contact.toLowerCase()).limit(5).get()).docs);
    } else {
      const d = contact.replace(/\D/g, '').slice(-10);
      if (d.length === 10) {
        for (const f of [d, `+1${d}`, `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`, `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`]) {
          const q = await col.where('phone', '==', f).limit(3).get();
          docs.push(...q.docs); if (docs.length) break;
        }
      }
    }
  } catch { /* no match */ }
  const member = docs.some((d: any) => { const c = d.data() as any; return !c.ownerRenterId && !!c.activeMembershipId && c.subscription?.status === 'active'; });
  return NextResponse.json({ ok: true, member });
}
