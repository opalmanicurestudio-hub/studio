// src/lib/visit-feedback.ts — "HOW WAS YOUR VISIT?" — the client's private page for one visit (/how/{tenant}/{visit}).
// Reached from the thank-you text the day after (signed link, ?k=) or from the visit link ("Not quite right?", ?t= the
// visit's check-in token). Three answers: loved it (→ the business's public review link), it was okay, or something
// wasn't right (→ a Making it right case: what went wrong, their words, photos, a voice note — translated for the team
// when they wrote or spoke in another language). Once a case exists the same page shows where it is, the team's replies,
// and "Did we make it right?". One case per visit; only finished visits; only within the business's window.
import { createHmac } from 'crypto';
import { settingsOf, FIX_LABEL, wantsFor } from '@/lib/making-it-right';
import { brandAccent } from '@/lib/brand-accent';

const T = (t: string) => `tenants/${t}`;
const SECRET = () => process.env.LINK_SECRET || process.env.FIREBASE_ADMIN_PRIVATE_KEY || process.env.FIREBASE_ADMIN_CLIENT_EMAIL || 'clarityflow-links';
export const feedbackKey = (tenantId: string, appointmentId: string) => createHmac('sha256', SECRET()).update(`how:${tenantId}:${appointmentId}`).digest('base64url').slice(0, 16);
export const feedbackPath = (tenantId: string, appointmentId: string) => `/how/${tenantId}/${appointmentId}?k=${feedbackKey(tenantId, appointmentId)}`;
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

/** What the page shows. Never anything private: first names, the service, the day, and the case in plain words. */
export async function feedbackInfo(db: any, tenantId: string, v: { id: string; a: any }) {
  const tenant: any = (await db.doc(T(tenantId)).get()).data() || {}; const S = settingsOf(tenant); const a = v.a;
  const tz = tenant.timezone || 'America/New_York';
  const caseSnap = (await db.collection(`${T(tenantId)}/cases`).where('visit.appointmentId', '==', v.id).limit(1).get()).docs[0];
  const c: any = caseSnap ? caseSnap.data() : null;
  const daysSince = a.startTime ? Math.floor((Date.now() - Date.parse(a.startTime)) / 86400000) : 0;
  const window = S.serviceWindows[a.serviceId] ?? S.redoWindowDays;
  const brand = { name: tenant.name || tenant.businessName || 'Your visit', accent: brandAccent(tenant), logo: tenant.logoUrl || tenant.logo || null };
  const base = { ok: true as const, brand, visit: { service: a.serviceName || 'Your visit', provider: firstOf(a.staffName), day: a.startTime ? new Date(a.startTime).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: tz }) : '', clientFirst: firstOf(a.clientName) },
    answered: a.feedback?.rating || null, reviewUrl: (tenant.clientNotify || {}).reviewUrl || tenant.reviewUrl || null,
    open: FINISHED.includes(String(a.status)) && daysSince <= MAX_DAYS && S.channels.survey !== false,
    reasons: S.reasons.filter((r) => r.on !== false).map((r) => ({ id: r.id, label: r.label, safety: !!r.safety })),
    wants: wantsFor(S).map((w) => ({ id: w.id, label: w.client })),
    policy: { windowDays: window, withinWindow: daysSince <= window, photos: S.fairUse.requirePhotos, redo: !!S.fixes.redo, refund: !!S.fixes.refund, refundToCard: S.fairUse.refundToOriginalCard, replyHours: S.replyHours } };
  if (!c) return { ...base, case: null };
  const stage = c.locked ? 'closed' : c.status === 'done' ? 'check' : c.fix ? 'fixing' : 'heard';
  const due = c.replyDueAt ? new Date(c.replyDueAt).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: tz }) : '';
  let fixLine = '';
  const rd = c.fix?.kind === 'redo' ? (c.fix.redo || {}) : null;
  const redo = rd ? { state: c.fix.redoAppointmentId ? 'booked' : rd.state || 'choosing', provider: firstOf(c.visit?.providerName), canChange: !c.locked && c.status !== 'done' && (!c.fix.redoAppointmentId || (Number(rd.changes) || 0) < S.redoChanges), note: rd.note || null } : null;
  if (c.fix) { fixLine = c.fix.kind === 'redo' && !c.fix.redoAppointmentId ? (rd?.state === 'needs_time' ? 'A free redo — we’ll be in touch to find a time that works.' : 'A free redo — pick a time below.') : c.fix.kind === 'redo' && c.fix.redoAppointmentId ? await (async () => { const r: any = (await db.doc(`${T(tenantId)}/appointments/${c.fix.redoAppointmentId}`).get()).data() || {};
      return `A free redo${r.staffName ? ` with ${firstOf(r.staffName)}` : ''}${r.startTime ? `, ${new Date(r.startTime).toLocaleString('en-US', { weekday: 'long', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: tz })}` : ''}.`; })()
    : c.fix.kind === 'refund' ? `A refund of $${(c.fix.amountCents / 100).toFixed(2)} back to your card${c.visit?.cardLast4 ? ` ending ${c.visit.cardLast4}` : ''}. Banks usually take 5–10 days to show it.`
    : c.fix.kind === 'credit' ? `$${(c.fix.amountCents / 100).toFixed(2)} off your next visit.`
    : c.fix.kind === 'note' ? 'We’ve noted it and shared it with the team.' : `${FIX_LABEL[c.fix.kind as keyof typeof FIX_LABEL] || 'A fix'}.`; }
  return { ...base, case: { number: c.number, stage, owner: firstOf(c.ownerName), replyBy: !c.firstReplyAt ? due : '', fix: fixLine, safety: !!c.safety,
    replies: (c.messages || []).map((m: any) => ({ by: firstOf(m.by), text: m.text, at: m.at })), confirmed: !!c.clientConfirmed, redo, createdAt: c.createdAt, id: caseSnap.id } };
}
