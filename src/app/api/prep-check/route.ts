// src/app/api/prep-check/route.ts — BEFORE THE VISIT, THE CLIENT'S SIDE (lib/prep-check, lib/prep-check-server).
// Public, but only with the visit's signed link (?k=) or its check-in token (?t=).
//   get                       → the questions, the business's prices for the quote, "Good to know", what they answered
//   photo    { dataUrl }      → a photo for a photo question (stored with the visit; up to 3)
//   answer   { answers }      → saves the answers and the quote they saw (a safety answer reaches the team at once)
//   agree                     → "Looks right"
//   question { text }         → "I have a question" (to the desk and the provider)
//   topup                     → a card payment link for the deposit top-up the business asked for
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { prepVisit, prepInfo, prepAnswer, prepAgree, prepQuestion, prepTopUpLink, prepDeskKey } from '@/lib/prep-check-server';
import { linkOrigin } from '@/lib/app-origin';

export const dynamic = 'force-dynamic';
const j = (b: any, status = 200) => NextResponse.json(b, { status });

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({}));
  const tenantId = String(b.tenantId || '').slice(0, 80); const appointmentId = String(b.appointmentId || '').slice(0, 80);
  const db = getAdminDb(); const v = await prepVisit(db, tenantId, appointmentId, b.k ? String(b.k) : null, b.t ? String(b.t) : null);
  if (!v) return j({ ok: false, error: 'This link isn’t valid.' }, 404);
  const action = String(b.action || 'get');
  const by = b.d && String(b.d) === prepDeskKey(tenantId, appointmentId) ? 'desk' as const : 'client' as const;   // the desk filling it in over the phone
  if (action === 'get') { const { stampLinkView } = await import('@/lib/link-views'); await stampLinkView(v.ref, v.a, 'before', { staff: by === 'desk' }); }
  if (action === 'get') return j({ ...(await prepInfo(db, tenantId, v)), desk: by === 'desk' });
  if (action === 'photo') {
    const n = Number(v.a.prepUploads || 0); if (n >= 3) return j({ ok: false, error: 'That’s the most photos we can take for one visit.' }, 400);
    const { uploadClaimPhotoFromDataUrl } = await import('@/lib/claim-photo-upload');
    const r = await uploadClaimPhotoFromDataUrl(tenantId, appointmentId, b.dataUrl, 'visit-photos');
    if (!r.url) return j({ ok: false, error: r.error || 'That didn’t upload.' }, 400);
    await v.ref.set({ prepUploads: n + 1 }, { merge: true }); return j({ ok: true, url: r.url });
  }
  if (action === 'answer') return j(await prepAnswer(db, tenantId, v, b.answers || {}, by));
  if (action === 'agree') return j(await prepAgree(db, tenantId, v, by));
  if (action === 'question') return j(await prepQuestion(db, tenantId, v, String(b.text || '')));
  if (action === 'topup') { const tenant: any = (await db.doc(`tenants/${tenantId}`).get()).data() || {}; const r: any = await prepTopUpLink(db, tenantId, v, linkOrigin(tenant, '') || req.nextUrl.origin).catch((e: any) => ({ ok: false, error: e?.message || 'That didn’t work.' })); return j(r, r.ok ? 200 : 409); }
  return j({ ok: false, error: 'Unknown action.' }, 400);
}
