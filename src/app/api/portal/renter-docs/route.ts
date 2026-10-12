// src/app/api/portal/renter-docs/route.ts — PART 6: a renter's own documents, from their portal (lib/renter-docs).
// Signed in with the renter portal's session token. Private to them — the studio's app can't read renterDocs.
//   list                         → their documents, their services (for aftercare links), their aftercare choices, starters
//   save { doc, publish? }       → save a draft or publish (a changed published document becomes the next version)
//   remove { id }                → delete one of theirs
//   care { care }                → their aftercare choices (on, when, check-in days, show products, their note)
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { renterSession } from '@/lib/renter-session';
import { renterLibrary, saveRenterDoc, removeRenterDoc, saveRenterCare, RENTER_STARTERS } from '@/lib/renter-docs';

export const dynamic = 'force-dynamic';
const j = (b: any, status = 200) => NextResponse.json(b, { status });

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({})); const tenantId = String(b.tenantId || '').slice(0, 120);
  const db = getAdminDb(); const s = await renterSession(db, tenantId, b.token);
  if (!s) return j({ ok: false, error: 'Please sign in again.' }, 401);
  const action = String(b.action || 'list'); let r: any;
  if (action === 'list') { r = await renterLibrary(db, tenantId, s.renterId); if (r.ok) r.starters = RENTER_STARTERS; }
  else if (action === 'save') r = await saveRenterDoc(db, tenantId, s.renterId, { ...(b.doc || {}), publish: b.publish === true });
  else if (action === 'remove') r = await removeRenterDoc(db, tenantId, s.renterId, String(b.id || ''));
  else if (action === 'care') r = await saveRenterCare(db, tenantId, s.renterId, b.care || {});
  else r = { ok: false, error: 'Unknown action.' };
  return j(r, r.ok ? 200 : 409);
}
