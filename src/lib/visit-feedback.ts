// src/lib/visit-feedback.ts — "HOW WAS YOUR VISIT?" — the client's private page for one visit (/how/{tenant}/{visit}).
// Reached from the thank-you text the day after (signed link, ?k=) or from the visit link ("Not quite right?", ?t= the
// visit's check-in token). Three answers: loved it (→ the business's public review link), it was okay, or something
// wasn't right (→ a Making it right case: what went wrong, their words, photos, a voice note — translated for the team
// when they wrote or spoke in another language). Once a case exists the same page shows where it is, the team's replies,
// and "Did we make it right?". One case per visit; only finished visits; only within the business's window.
import { createHmac } from 'crypto';
import { settingsOf, FIX_LABEL, wantsFor, aftercareFor } from '@/lib/making-it-right';
import { brandAccent } from '@/lib/brand-accent';

const T = (t: string) => `tenants/${t}`;
const SECRET = () => process.env.LINK_SECRET || process.env.FIREBASE_ADMIN_PRIVATE_KEY || process.env.FIREBASE_ADMIN_CLIENT_EMAIL || 'clarityflow-links';
export const feedbackKey = (tenantId: string, appointmentId: string) => createHmac('sha256', SECRET()).update(`how:${tenantId}:${appointmentId}`).digest('base64url').slice(0, 16);
export const feedbackPath = (tenantId: string, appointmentId: string) => `/how/${tenantId}/${appointmentId}?k=${feedbackKey(tenantId, appointmentId)}`;
/** The visit's aftercare page (lib/aftercare) — the same key, so either link opens both pages. */
export const aftercarePath = (tenantId: string, appointmentId: string) => `/aftercare/${tenantId}/${appointmentId}?k=${feedbackKey(tenantId, appointmentId)}`;
const FINISHED = ['completed', 'checked_out', 'paid', 'ready_for_checkout'];
const MAX_DAYS = 120;

/** The visit, if this link is allowed to speak for it. */
export async function feedbackVisit(db: any, tenantId: string, appointmentId: string, k?: string | null, t?: string | null) {
  if (!/^[A-Za-z0-9_-]{4,80}$/.test(tenantId) || !/^[A-Za-z0-9_-]{4,80}$/.test(appointmentId)) return null;
  const snap = await db.doc(`${T(tenantId)}/appointments/${appointmentId}`).get(); if (!snap.exists) return null; const a: any = snap.data() || {};
  const okK = !!k && k === feedbackKey(tenantId, appointmentId); const okT = !!t && !!a.checkInToken && t === a.checkInToken;
  if (!okK && !okT) return null;
  return { id: snap.id, ref: snap.ref, a };
}

const firstOf = (n: any) => String(n || '').trim().split(/\s+/)[0] || '';

/** A visit's aftercare: the aftercare document for its service (lib/aftercare — a renter's own for a renter's visit),
 *  else the older plain-text aftercare from Making it right settings. */
export async function visitAftercare(db: any, tenantId: string, a: any, tenant: any, isRenterVisit: boolean, textFallback: string) {
  const { aftercareDocFor, clientView } = await import('@/lib/aftercare');
  // A renter's visit: the renter's own aftercare, from their private library (lib/renter-docs) — never the studio's.
  if (isRenterVisit) { const { renterDocsOf, renterAftercareFor } = await import('@/lib/renter-docs'); let mine: any[] = [];
    try { mine = a.staffId ? await renterDocsOf(db, tenantId, String(a.staffId)) : []; } catch { /* none */ }
    const pinned = a.aftercareDocId ? mine.find((x: any) => x.id === a.aftercareDocId && x.status === 'published') : null;
    const d = pinned || renterAftercareFor(mine, a.serviceId); return { doc: clientView(d), text: d ? null : (textFallback || null) }; }
  let docs: any[] = [];
  try { docs = (await db.collection(`${T(tenantId)}/documents`).where('category', '==', 'aftercare').get()).docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) })); } catch { /* none */ }
  const d = aftercareDocFor(docs, a.serviceId, isRenterVisit ? a.staffId : null);
  return { doc: clientView(d), text: d ? null : (textFallback || null) };
}

/** What the page shows. Never anything private: first names, the service, the day, and the case in plain words. */
export async function feedbackInfo(db: any, tenantId: string, v: { id: string; a: any }) {
  const tenant: any = (await db.doc(T(tenantId)).get()).data() || {}; const a = v.a;
  // A renter's visit follows the renter's own Making it right settings, and only the renter can fix it.
  const prov: any = a.staffId ? (await db.doc(`${T(tenantId)}/staff/${a.staffId}`).get()).data() || null : null;
  const isRenterVisit = !!prov && (prov.isRenter === true || prov.role === 'renter');
  const { renterSettingsOf, renterSettingsRaw } = await import('@/lib/renter-cases');
  const S = isRenterVisit ? renterSettingsOf(tenant, await renterSettingsRaw(db, tenantId, a.staffId)) : settingsOf(tenant);
  const tz = tenant.timezone || 'America/New_York';
  const caseSnap = (await db.collection(`${T(tenantId)}/cases`).where('visit.appointmentId', '==', v.id).limit(1).get()).docs[0];
  const c: any = caseSnap ? caseSnap.data() : null;
  const daysSince = a.startTime ? Math.floor((Date.now() - Date.parse(a.startTime)) / 86400000) : 0;
  const window = S.serviceWindows[a.serviceId] ?? S.redoWindowDays;
  const brand = { name: tenant.name || tenant.businessName || 'Your visit', accent: brandAccent(tenant), logo: tenant.logoUrl || tenant.logo || null };
  // The client's language on their record ('Spanish' or 'es') — the page opens in it unless they pick another.
  const cl: any = a.clientId ? (await db.doc(`${T(tenantId)}/clients/${a.clientId}`).get()).data() || {} : {};
  const LN: Record<string, string> = { english: 'en', spanish: 'es', español: 'es', vietnamese: 'vi', korean: 'ko', chinese: 'zh', portuguese: 'pt', french: 'fr', 'haitian creole': 'ht', arabic: 'ar', russian: 'ru' };
  const rawLang = String(cl.preferredLanguage || cl.language || '').trim().toLowerCase(); const clientLang = LN[rawLang] || (rawLang.length === 2 ? rawLang : null);
  const base = { ok: true as const, clientLang, brand, visit: { service: a.serviceName || 'Your visit', provider: firstOf(a.staffName), day: a.startTime ? new Date(a.startTime).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: tz }) : '', clientFirst: firstOf(a.clientName) },
    answered: a.feedback?.rating || null, team: !isRenterVisit && (await db.collection(`${T(tenantId)}/staff`).get()).docs.filter((d: any) => { const m: any = d.data() || {}; return m.archived !== true && m.isActive !== false && m.role !== 'renter'; }).length > 1, ...(await (async () => { const { aftercareSettingsOf } = await import('@/lib/aftercare'); if (!isRenterVisit && !aftercareSettingsOf(tenant).on) return { aftercare: null, aftercareDoc: null };   // switched off in Settings → Aftercare
      const c = await visitAftercare(db, tenantId, a, tenant, isRenterVisit, aftercareFor(S, a.serviceId)); return { aftercare: c.text, aftercareDoc: c.doc }; })()), surveyOn: S.channels.survey !== false, reviewUrl: (tenant.clientNotify || {}).reviewUrl || tenant.reviewUrl || null,
    open: FINISHED.includes(String(a.status)) && daysSince <= MAX_DAYS && S.channels.survey !== false,
    reasons: S.reasons.filter((r) => r.on !== false).map((r) => ({ id: r.id, label: r.label, safety: !!r.safety })),
    wants: wantsFor(S).map((w) => ({ id: w.id, label: w.client })),
    policy: { windowDays: window, withinWindow: daysSince <= window, photos: S.fairUse.requirePhotos, redo: !!S.fixes.redo, refund: !!S.fixes.refund, refundToCard: S.fairUse.refundToOriginalCard, replyHours: S.replyHours } };
  if (!c) return { ...base, case: null };
  const stage = c.locked ? 'closed' : c.status === 'done' ? 'check' : c.fix ? 'fixing' : 'heard';
  const due = c.replyDueAt ? new Date(c.replyDueAt).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: tz }) : '';
  let fixLine = '';
  const rd = c.fix?.kind === 'redo' ? (c.fix.redo || {}) : null;
  const redo = rd && !c.renterCase ? { state: c.fix.redoAppointmentId ? 'booked' : rd.state || 'choosing', provider: firstOf(c.visit?.providerName), canChange: !c.locked && c.status !== 'done' && (!c.fix.redoAppointmentId || (Number(rd.changes) || 0) < S.redoChanges), note: rd.note || null,
    plan: rd.plan ? { names: rd.plan.names || [], priceCents: Number(rd.plan.priceCents) || 0, note: rd.plan.note || null, minutes: rd.plan.minutes || null } : null } : null;
  if (c.fix && c.renterCase) fixLine = c.fix.kind === 'redo' ? (rd?.bookedText ? `A free fix with ${firstOf(c.visit?.providerName) || 'your provider'}: ${rd.bookedText}.` : `A free fix — ${firstOf(c.visit?.providerName) || 'your provider'} will be in touch to set a time.`)
    : c.fix.kind === 'refund' ? `A refund of $${(c.fix.amountCents / 100).toFixed(2)} from ${firstOf(c.visit?.providerName) || 'your provider'}.` : c.fix.kind === 'note' ? 'It’s been noted, thank you for telling us.' : `${FIX_LABEL[c.fix.kind as keyof typeof FIX_LABEL] || 'A fix'}.`;
  else if (c.fix) { fixLine = c.fix.kind === 'redo' && !c.fix.redoAppointmentId ? (() => { const what = rd?.plan ? `${rd.plan.names.join(', then ')}${rd.plan.priceCents ? ` ($${(rd.plan.priceCents / 100).toFixed(2)})` : ', no charge'}` : 'A free redo';
      return rd?.state === 'needs_time' ? `${what} — we’ll be in touch to find a time that works.` : `${what} — pick a time below.`; })() : c.fix.kind === 'redo' && c.fix.redoAppointmentId ? await (async () => { const r: any = (await db.doc(`${T(tenantId)}/appointments/${c.fix.redoAppointmentId}`).get()).data() || {};
      return `${rd?.plan ? rd.plan.names.join(', then ') : 'A free redo'}${r.staffName ? ` with ${firstOf(r.staffName)}` : ''}${r.startTime ? `, ${new Date(r.startTime).toLocaleString('en-US', { weekday: 'long', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: tz })}` : ''}.`; })()
    : c.fix.kind === 'refund' ? `A refund of $${(c.fix.amountCents / 100).toFixed(2)} back to your card${c.visit?.cardLast4 ? ` ending ${c.visit.cardLast4}` : ''}. Banks usually take 5–10 days to show it.`
    : c.fix.kind === 'credit' ? `$${(c.fix.amountCents / 100).toFixed(2)} off your next visit.`
    : c.fix.kind === 'note' ? 'We’ve noted it and shared it with the team.' : `${FIX_LABEL[c.fix.kind as keyof typeof FIX_LABEL] || 'A fix'}.`; }
  return { ...base, case: { number: c.number, stage, owner: firstOf(c.ownerName), replyBy: !c.firstReplyAt ? due : '', fix: fixLine, safety: !!c.safety,
    replies: (c.messages || []).map((m: any) => ({ by: firstOf(m.by), text: m.text, at: m.at })), confirmed: !!c.clientConfirmed, redo, createdAt: c.createdAt, id: caseSnap.id } };
}
