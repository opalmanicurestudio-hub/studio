// src/app/api/portal/renter-prep/route.ts — PART 6: a renter's own Before the visit, from their portal (lib/prep-ctx).
// Signed in with the renter portal's session token. The renter is provider and desk: their clients' answers and every
// decision are theirs; the studio's desk never sees them.
//   get                                   → their rules, their services (with questions), their visits that need a look
//   settings { prep }                      → their rules: Up to / About, deposit top-up, on the day, fee, small changes
//   check { serviceId, check }             → one of their services' questions
//   decide { appointmentId, action }       → approve · keep · move (pick a new time, free) · cancel (no fee)
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { renterSession, renterStaff } from '@/lib/renter-session';
import { prepSettingsOf, cleanCheck } from '@/lib/prep-check';

export const dynamic = 'force-dynamic';
const j = (b: any, status = 200) => NextResponse.json(b, { status });
const ms = (v: any) => Date.parse(String(v || '')) || 0;
const DEAD = ['cancelled', 'canceled', 'no_show', 'declined', 'expired', 'completed', 'checked_out', 'paid'];

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({})); const tenantId = String(b.tenantId || '').slice(0, 120);
  const db = getAdminDb(); const s = await renterSession(db, tenantId, b.token);
  if (!s) return j({ ok: false, error: 'Please sign in again.' }, 401);
  const me = await renterStaff(db, tenantId, s.renterId); if (!me) return j({ ok: false, error: 'Your provider profile isn’t set up yet — ask the studio.' }, 409);
  const T = `tenants/${tenantId}`; const action = String(b.action || 'get');
  const mineAppt = (a: any) => !!a && (String(a.staffId || '') === me.id || String(a.renterProviderId || '') === me.id);

  if (action === 'get') {
    const [svc, set, ap] = await Promise.all([db.collection(`${T}/renterServices`).where('staffId', '==', me.id).get(), db.doc(`${T}/renterSettings/${me.id}`).get(), db.collection(`${T}/appointments`).where('staffId', '==', me.id).get()]);
    const services = svc.docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) })).filter((x: any) => x.isActive !== false).map((x: any) => ({ id: x.id, name: x.name, price: Number(x.price) || 0, duration: Number(x.duration) || 0, prepCheck: x.prepCheck || null }));
    const raw = set.exists ? (set.data() || {}).prep || null : null; const now = Date.now();
    const visits = ap.docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) })).filter((a: any) => ms(a.startTime) >= now - 3 * 3600e3 && ms(a.startTime) <= now + 8 * 864e5 && !DEAD.includes(String(a.status || '')) && (a.prep || a.prepSentAt))
      .sort((x: any, y: any) => ms(x.startTime) - ms(y.startTime))
      .map((a: any) => ({ id: a.id, clientName: String(a.clientName || 'Client').split(' ')[0], serviceName: a.serviceName || a.renterServiceName || 'Visit', startTime: a.startTime, prepSentAt: a.prepSentAt || null, suggestion: a.prepSuggestion || null,
        prep: a.prep ? { status: a.prep.status || null, quote: a.prep.quote || null, fits: a.prep.fits ?? null, freeMinutes: a.prep.freeMinutes ?? null, answeredAt: a.prep.answeredAt || null, photos: Object.values(a.prep.answers || {}).filter((v: any) => typeof v === 'string' && /^https:\/\//.test(v)), question: Array.isArray(a.prep.questions) && a.prep.questions.length ? a.prep.questions[a.prep.questions.length - 1].text : null } : null }));
    return j({ ok: true, settings: prepSettingsOf({ prepCheck: raw || {} }), services, visits });
  }
  if (action === 'settings') {
    const S = prepSettingsOf({ prepCheck: b.prep || {} }); await db.doc(`${T}/renterSettings/${me.id}`).set({ prep: S }, { merge: true }); return j({ ok: true, settings: S });
  }
  if (action === 'check') {
    const ref = db.doc(`${T}/renterServices/${String(b.serviceId || '').slice(0, 120)}`); const cur: any = (await ref.get()).data();
    if (!cur || cur.staffId !== me.id) return j({ ok: false, error: 'That isn’t one of your services.' }, 403);
    const check = cleanCheck(b.check || {}, Number(cur.prepCheck?.version) || 0); await ref.set({ prepCheck: check }, { merge: true }); return j({ ok: true, check });
  }
  if (action === 'decide') {
    const id = String(b.appointmentId || '').slice(0, 120); const a: any = (await db.doc(`${T}/appointments/${id}`).get()).data();
    if (!mineAppt(a)) return j({ ok: false, error: 'That isn’t one of your visits.' }, 403);
    const by = { name: me.name || 'Provider' }; const m = await import('@/lib/prep-actions'); const act = String(b.action2 || b.decision || '');
    const r: any = act === 'approve' ? await m.applyPrep(db, tenantId, id, by) : act === 'keep' ? await m.keepPrep(db, tenantId, id, by) : act === 'move' ? await m.askToMove(db, tenantId, id, by) : act === 'cancel' ? await m.cancelFree(db, tenantId, id, by) : { ok: false, error: 'Unknown decision.' };
    return j(r, r.ok ? 200 : 409);
  }
  return j({ ok: false, error: 'Unknown action.' }, 400);
}
