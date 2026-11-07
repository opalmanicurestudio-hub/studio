// src/app/api/visit-completion/route.ts — WHAT A CLIENT STILL HAS TO DO BEFORE THEIR VISIT, BY THEIR LINK.
//
// The booking completion record (tenants/{t}/bookingCompletions/{token}) holds the client's id, full name, email,
// the deposit and the forms/files the business asked for. It used to be readable by anyone from a browser; it is now
// team-only, and the two public pages that need it (the visit link /check-in/{token} and the completion link
// /complete/{tenantId}/{token}) ask here instead.
//
// GET ?token=...                 -> the visit link: the token must be an appointment's checkInToken
// GET ?token=...&tenantId=...    -> the completion link: the token must be the completion record's own token
//
// Returns { ok: true, completion: <safe projection> | null }. Never the client's id, email or full name — the
// first name only. Payment routes read the full record on the server themselves.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';

const TOKEN_RE = /^[A-Za-z0-9_-]{6,120}$/;
const str = (v: any, max = 200) => (typeof v === 'string' ? v.slice(0, max) : v == null ? null : String(v).slice(0, max));

/** Only the fields the completion gate, the completion link and the cancelled view actually read. */
function project(token: string, rec: any) {
  const first = String(rec?.clientName || '').trim().split(/\s+/)[0] || null;
  const list = (v: any) => (Array.isArray(v) ? v : []);
  return {
    id: token,
    token,
    status: str(rec?.status, 40),
    skipCardStep: rec?.skipCardStep === true,
    cardAlreadyOnFile: rec?.cardAlreadyOnFile === true,
    depositAmountCents: Math.max(0, Math.round(Number(rec?.depositAmountCents) || 0)),
    requiredConsentFormIds: list(rec?.requiredConsentFormIds).map((x: any) => String(x)).slice(0, 50),
    // Prompts, counts and ids of the files asked for — set by the team, no client data.
    fileRequirements: list(rec?.fileRequirements).slice(0, 30),
    requirements: list(rec?.requirements).filter((r: any) => r?.type === 'file_upload').slice(0, 30),
    requestMarketingConsent: rec?.requestMarketingConsent === true,
    requestEmergencyContact: rec?.requestEmergencyContact === true,
    acknowledgments: list(rec?.acknowledgments).map((a: any) => ({ id: str(a?.id, 80), text: str(a?.text, 2000) })).slice(0, 20),
    serviceName: str(rec?.serviceName, 120),
    clientFirstName: first ? first.slice(0, 40) : null,
    hasEmail: !!String(rec?.clientEmail || '').trim(),
    expiresAt: str(rec?.expiresAt, 40),
    appointmentStartTime: str(rec?.appointmentStartTime, 40),
  };
}

const ENDED = ['declined', 'expired', 'released', 'cancelled', 'canceled', 'no_show'];

/** The forms the record asked for, less any signed since (for this visit, at the desk or the kiosk, or on an earlier
 *  visit of a series): the one rule (lib/forms). The record is a snapshot; this keeps it current. */
async function stillAsked(db: any, tenantId: string, rec: any, appt: any) {
  const ids: string[] = (Array.isArray(rec?.requiredConsentFormIds) ? rec.requiredConsentFormIds : []).map(String);
  if (!ids.length || rec?.status === 'complete') return rec;
  try {
    const { formsStillNeeded, formRulesOf } = await import('@/lib/forms');
    const [t, c, ...defs] = await Promise.all([
      db.doc(`tenants/${tenantId}`).get(), rec.clientId ? db.doc(`tenants/${tenantId}/clients/${rec.clientId}`).get() : Promise.resolve(null),
      ...ids.map((id) => db.doc(`tenants/${tenantId}/consentForms/${id}`).get().catch(() => null)),
    ]);
    // A form that couldn't be read just now is still asked for (never taken as deleted).
    if (defs.some((d: any) => d === null)) { const { signedOnVisit, waivedOnVisit } = await import('@/lib/forms'); const here = signedOnVisit(appt || {}); const waived = waivedOnVisit(appt || {}); return { ...rec, requiredConsentFormIds: ids.filter((id) => !here.has(id) && !waived.has(id)) }; }
    const forms = defs.map((d: any, i: number) => (d?.exists ? { id: ids[i], ...(d.data() || {}) } : null)).filter(Boolean);
    // Only forms that still exist (a deleted one can't be shown or signed).
    const left = formsStillNeeded({ apt: appt || {}, ids: ids.filter((id) => forms.some((f: any) => f.id === id)), client: c?.data?.() || {}, forms, rules: formRulesOf(t?.data?.() || {}) });
    return { ...rec, requiredConsentFormIds: left };
  } catch { return rec; }
}

/** The visit's forms and documents for the visit link: titles, how long, done or not (never anyone's answers). */
async function visitSummary(db: any, tenantId: string, appt: any, rec: any) {
  try {
    const { visitForms } = await import('@/lib/forms-visit');
    const v = await visitForms(db, tenantId, appt, { rec: rec && (!rec.status || rec.status === 'pending') ? rec : null });
    return {
      asks: v.asks.map((a) => ({ formId: a.formId, title: String(a.title || 'Form').slice(0, 200), ask: a.ask, why: String(a.why || '').slice(0, 120), minutes: a.minutes, health: a.health, since: a.since || null })),
      files: v.files, left: v.left, dueAt: v.dueAt, release: v.release,
    };
  } catch (e: any) { console.error('[visit-completion] forms', e?.message); return null; }
}

export async function GET(req: NextRequest) {
  const token = String(req.nextUrl.searchParams.get('token') || '').slice(0, 120);
  const tenantParam = String(req.nextUrl.searchParams.get('tenantId') || '').slice(0, 120);
  if (!TOKEN_RE.test(token)) return NextResponse.json({ ok: false }, { status: 400 });
  const db = getAdminDb();
  const noStore = { headers: { 'Cache-Control': 'no-store' } };

  try {
    let tenantId = '';
    if (tenantParam) {
      // The completion link: /complete/{tenantId}/{token}. The record must carry this same token.
      if (!/^[A-Za-z0-9_-]{1,120}$/.test(tenantParam)) return NextResponse.json({ ok: false }, { status: 400 });
      tenantId = tenantParam;
      const snap = await db.doc(`tenants/${tenantId}/bookingCompletions/${token}`).get();
      if (!snap.exists) return NextResponse.json({ ok: true, completion: null }, noStore);
      const rec: any = snap.data() || {};
      if ((rec.token && rec.token !== token) || (rec.tenantId && rec.tenantId !== tenantId)) return NextResponse.json({ ok: false }, { status: 404 });
      const ap: any = rec.appointmentId ? (((await db.doc(`tenants/${tenantId}/appointments/${rec.appointmentId}`).get()).data() as any) || null) : null;
      if (ap && ENDED.includes(String(ap.status || ''))) return NextResponse.json({ ok: true, completion: null }, noStore);
      return NextResponse.json({ ok: true, completion: project(token, await stillAsked(db, tenantId, rec, ap)) }, noStore);
    }

    // The visit link: the token must be the appointment's own checkInToken.
    const copy: any = (await db.doc(`appointmentCheckIns/${token}`).get()).data();
    tenantId = String(copy?.tenantId || '');
    const apptId = String(copy?.id || copy?.appointmentId || '');
    if (!tenantId || !apptId) return NextResponse.json({ ok: false }, { status: 404 });
    const appt: any = (await db.doc(`tenants/${tenantId}/appointments/${apptId}`).get()).data();
    if (!appt || appt.checkInToken !== token) return NextResponse.json({ ok: false }, { status: 404 });
    // A visit that isn't happening (declined, lapsed, released, canceled) asks for nothing more.
    if (ENDED.includes(String(appt.status || ''))) return NextResponse.json({ ok: true, completion: null, visit: null }, noStore);
    // A link "Not you?" turned off, or one waiting on "Is this you?": nothing personal (lib/client-verify).
    { const { visitLinkOpen } = await import('@/lib/client-verify');
      if ((await visitLinkOpen(db, tenantId, appt, String(req.nextUrl.searchParams.get('device') || '').slice(0, 120))) !== 'ok') return NextResponse.json({ ok: true, completion: null, visit: null }, noStore); }
    const snap = await db.doc(`tenants/${tenantId}/bookingCompletions/${token}`).get();
    const raw: any = snap.exists ? snap.data() || {} : null;
    const rec: any = raw && (!raw.token || raw.token === token) ? raw : null;
    // What the visit's forms and documents look like from their side (lib/forms-visit): done or not, and when it's due.
    const visit = await visitSummary(db, tenantId, appt, rec);
    if (!rec) return NextResponse.json({ ok: true, completion: null, visit }, noStore);
    return NextResponse.json({ ok: true, completion: project(token, await stillAsked(db, tenantId, { ...rec, appointmentStartTime: rec.appointmentStartTime || appt.startTime || null }, appt)), visit }, noStore);
  } catch (e: any) {
    console.error('[visit-completion]', e?.message);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
