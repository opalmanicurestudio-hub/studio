// src/lib/academy-applicant-comms.ts
//
// KEEPING APPLICANTS INFORMED — every step, by email (the school's branded
// design, with a button to their application page) and, if they ticked
// "Text me updates", a short text. Every message is logged on their record
// (admissions/{id}.comms) so staff can see what the applicant was told.
//
// INTERVIEWS — admissions/{id}.interview
//   status  offered   staff offered up to 3 times; the applicant picks one
//           scheduled a time is set (booked by staff or picked by the applicant)
//           reschedule_requested  the applicant suggested other times (+ note)
//           cancelled done no_show
// Each change tells the other side.

import { getAdminDb } from '@/lib/firebase-admin';
import { appendAudit } from '@/lib/academy-compliance';
import { issueApplicationLink } from '@/lib/academy-admissions';
import { sendAcademyEmail } from '@/lib/academy-email';
import { sendNotification } from '@/lib/notify';
import { getIdentity } from '@/lib/school-identity';
import { tenantTimeZone } from '@/lib/tenant-time';

// Times are shown in the SCHOOL's time zone (set on the business).
const whenIn = (iso: string, tz: string) => new Date(iso).toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: tz });
const tzCache = new Map<string, string>();
async function tzOf(tenantId: string) { if (!tzCache.has(tenantId)) { const t = ((await getAdminDb().doc(`tenants/${tenantId}`).get()).data() as any) || {}; tzCache.set(tenantId, tenantTimeZone(t)); } return tzCache.get(tenantId)!; }
export const appLink = async (tenantId: string, id: string, origin: string) => `${origin}/learn/${tenantId}/application/${await issueApplicationLink(tenantId, id)}`;

async function schoolName(tenantId: string) {
  const t = ((await getAdminDb().doc(`tenants/${tenantId}`).get()).data() as any) || {};
  const id = await getIdentity(tenantId, t).catch(() => null);
  return { name: id?.displayName || t.name || 'Our school', alertTo: t.notificationEmail || id?.email || t.email || '' };
}

/** Email (+ text if they opted in) an update to an applicant, and log it. */
export async function notifyApplicant(tenantId: string, a: any, m: { kind: string; subject: string; body: string; sms?: string; origin: string; link?: boolean; official?: boolean }) {
  const { name } = await schoolName(tenantId);
  const first = String(a.name || '').split(' ')[0] || 'there';
  const link = m.link === false ? '' : await appLink(tenantId, a.id, m.origin);
  const text = `Hi ${first},\n\n${m.body}${link ? `\n\n${link}` : ''}\n\n— ${name}`;
  const emailed = a.email ? await sendAcademyEmail(tenantId, a.email, `${m.subject} — ${name}`, text, { official: m.official }) : false;
  let texted = false;
  if (m.sms && a.textOk && a.phone) {
    const r = await sendNotification(getAdminDb(), { tenantId, channel: 'sms', to: a.phone, text: `${name}: ${m.sms}${link ? ` ${link}` : ''}`.slice(0, 480), kind: 'admissions_update', recipientType: 'contact', recipientId: a.id, recipientName: a.name || null }).catch(() => null);
    texted = r?.status === 'sent';
  }
  const ref = getAdminDb().doc(`tenants/${tenantId}/admissions/${a.id}`);
  const cur = ((await ref.get()).data() as any) || {};
  await ref.set({ comms: [...(cur.comms || []), { at: new Date().toISOString(), kind: m.kind, subject: m.subject, emailed, texted }].slice(-60) }, { merge: true });
  return { emailed, texted };
}

/** Tell the school (the admissions inbox) that an applicant did something. */
export async function alertSchool(tenantId: string, subject: string, body: string, origin: string) {
  const { alertTo } = await schoolName(tenantId); if (!alertTo) return false;
  return sendAcademyEmail(tenantId, alertTo, subject, `${body}\n\n${origin}/academy?section=admissions`);
}

const cleanSlots = (xs: any[]) => [...new Set((Array.isArray(xs) ? xs : []).map((v) => String(v || '')).filter((v) => v && !isNaN(Date.parse(v))).map((v) => new Date(v).toISOString()))]
  .filter((v) => Date.parse(v) > Date.now()).sort().slice(0, 3);

// ── Staff ────────────────────────────────────────────────────────────────
export async function offerInterviewTimes(tenantId: string, id: string, v: { slots: any[]; where?: string; with?: string }, by: string, origin: string) {
  const tz = await tzOf(tenantId); const when = (iso: string) => whenIn(iso, tz);
  const ref = getAdminDb().doc(`tenants/${tenantId}/admissions/${id}`); const a = ((await ref.get()).data() as any) || null; if (!a) throw new Error('Not found.');
  const slots = cleanSlots(v.slots); if (!slots.length) throw new Error('Add at least one future time.');
  const interview = { status: 'offered', offers: slots, where: String(v.where || '').slice(0, 200), with: String(v.with || by).slice(0, 80), by, at: null, proposals: [], note: null, updatedAt: new Date().toISOString() };
  await ref.set({ interview }, { merge: true });
  await appendAudit(tenantId, { type: 'admissions.interview_offered', by, summary: `${a.name}: ${slots.length} interview time${slots.length === 1 ? '' : 's'} offered` });
  return notifyApplicant(tenantId, { id, ...a }, { kind: 'interview_offered', origin, subject: 'Choose your interview time',
    body: `We’d like to meet you. Please choose one of these interview times on your application page:\n\n${slots.map((s) => `- ${when(s)}`).join('\n')}${interview.where ? `\n\nWhere: ${interview.where}` : ''}\n\nIf none of them work, you can suggest other times there.`,
    sms: 'please choose an interview time:' });
}
export async function bookInterview(tenantId: string, id: string, v: { at: string; where?: string; with?: string; whenText?: string; notify?: boolean }, by: string, origin: string) {
  const tz = await tzOf(tenantId); const when = (iso: string) => whenIn(iso, tz);
  const ref = getAdminDb().doc(`tenants/${tenantId}/admissions/${id}`); const a = ((await ref.get()).data() as any) || null; if (!a) throw new Error('Not found.');
  if (!v.at || isNaN(Date.parse(v.at))) throw new Error('Choose a date and time.');
  // Moving an existing interview (including one the applicant asked to change) reads as a move, not a new booking.
  const prev = a.interview?.status === 'scheduled' ? a.interview.at : a.interview?.status === 'reschedule_requested' ? (a.interview.previousAt || null) : null;
  const interview = { status: 'scheduled', at: new Date(v.at).toISOString(), where: String(v.where || '').slice(0, 200), with: String(v.with || by).slice(0, 80), by, offers: [], proposals: [], note: null, updatedAt: new Date().toISOString() };
  await ref.set({ interview }, { merge: true });
  await appendAudit(tenantId, { type: 'admissions.interview', by, summary: `${a.name}: interview ${prev ? 'moved to' : 'booked for'} ${when(interview.at)}` });
  if (v.notify === false) return { emailed: false, texted: false };
  const w = v.whenText || when(interview.at);
  return notifyApplicant(tenantId, { id, ...a }, { kind: prev ? 'interview_moved' : 'interview_booked', origin, subject: prev ? 'Your interview has moved' : 'Your admissions interview',
    body: `${prev ? 'Your interview has a new time' : 'Your admissions interview is booked'}:\n\n**${w}**${interview.where ? `\nWhere: ${interview.where}` : ''}\nWith: ${interview.with}\n\nNeed a different time? You can ask for one on your application page.`,
    sms: `${prev ? 'your interview has moved to' : 'your interview is booked for'} ${w}.` });
}
export async function acceptProposal(tenantId: string, id: string, index: number, by: string, origin: string) {
  const a = ((await getAdminDb().doc(`tenants/${tenantId}/admissions/${id}`).get()).data() as any) || null;
  const p = a?.interview?.proposals?.[index]; if (!p) throw new Error('That time isn’t available.');
  return bookInterview(tenantId, id, { at: p, where: a.interview.where, with: a.interview.with || by }, by, origin);
}
export async function cancelInterview(tenantId: string, id: string, by: string, origin: string, reason?: string) {
  const tz = await tzOf(tenantId); const when = (iso: string) => whenIn(iso, tz);
  const ref = getAdminDb().doc(`tenants/${tenantId}/admissions/${id}`); const a = ((await ref.get()).data() as any) || null; if (!a?.interview) throw new Error('No interview to cancel.');
  await ref.set({ interview: { ...a.interview, status: 'cancelled', cancelledBy: by, note: reason || null, updatedAt: new Date().toISOString() } }, { merge: true });
  await appendAudit(tenantId, { type: 'admissions.interview_cancelled', by, summary: `${a.name}: interview cancelled${reason ? ` — ${reason}` : ''}` });
  return notifyApplicant(tenantId, { id, ...a }, { kind: 'interview_cancelled', origin, subject: 'Your interview was cancelled',
    body: `We’ve had to cancel your interview${a.interview.at ? ` on ${when(a.interview.at)}` : ''}. This isn’t a reflection on your application — we’ll be in touch with a new time.${reason ? `\n\n${reason}` : ''}`, sms: 'your interview was cancelled — we’ll be in touch with a new time.' });
}

// ── Applicant (from their private page) ──────────────────────────────────
export async function pickOfferedTime(tenantId: string, a: any, slot: string, origin: string) {
  const tz = await tzOf(tenantId); const when = (iso: string) => whenIn(iso, tz);
  const iv = a.interview; if (iv?.status !== 'offered') throw new Error('There are no times to choose from right now.');
  const at = (iv.offers || []).find((s: string) => s === slot); if (!at) throw new Error('Please choose one of the offered times.');
  if (Date.parse(at) < Date.now()) throw new Error('That time has passed — please suggest another.');
  await getAdminDb().doc(`tenants/${tenantId}/admissions/${a.id}`).set({ interview: { ...iv, status: 'scheduled', at, offers: [], updatedAt: new Date().toISOString() } }, { merge: true });
  await appendAudit(tenantId, { type: 'admissions.interview', by: a.email || 'applicant', summary: `${a.name} chose an interview time: ${when(at)}` });
  await alertSchool(tenantId, `Interview booked: ${a.name}`, `${a.name} chose ${when(at)} for their admissions interview.`, origin);
  return notifyApplicant(tenantId, a, { kind: 'interview_booked', origin, subject: 'Your interview is booked', body: `Thanks — your interview is booked for **${when(at)}**${iv.where ? ` (${iv.where})` : ''}.`, sms: `your interview is booked for ${when(at)}.` });
}
export async function requestReschedule(tenantId: string, a: any, v: { proposals: any[]; note?: string; cantAttend?: boolean }, origin: string) {
  const tz = await tzOf(tenantId); const when = (iso: string) => whenIn(iso, tz);
  const iv = a.interview; if (!iv || !['scheduled', 'offered', 'reschedule_requested'].includes(iv.status)) throw new Error('There’s no interview to change.');
  const proposals = cleanSlots(v.proposals); const note = String(v.note || '').trim().slice(0, 500);
  if (!v.cantAttend && !proposals.length) throw new Error('Suggest at least one time that works for you.');
  await getAdminDb().doc(`tenants/${tenantId}/admissions/${a.id}`).set({ interview: { ...iv, status: 'reschedule_requested', proposals, note: note || (v.cantAttend ? 'Can’t attend at the moment' : null), previousAt: iv.at || null, updatedAt: new Date().toISOString() } }, { merge: true });
  await appendAudit(tenantId, { type: 'admissions.interview_reschedule', by: a.email || 'applicant', summary: `${a.name} asked to change their interview${proposals.length ? ` (${proposals.length} time${proposals.length === 1 ? '' : 's'} suggested)` : ''}` });
  await alertSchool(tenantId, `Interview change requested: ${a.name}`, `${a.name} asked for a different interview time.${proposals.length ? `\n\nTimes that work for them:\n${proposals.map((p) => `- ${when(p)}`).join('\n')}` : ''}${note ? `\n\n“${note}”` : ''}\n\nPick one in their admissions record and they’ll be told straight away.`, origin);
  return { ok: true };
}

/** A text only (the email went separately) — for applicants who opted in. */
export async function textApplicant(tenantId: string, a: any, msg: string, kind: string) {
  if (!a?.textOk || !a?.phone) return false;
  const { name } = await schoolName(tenantId);
  const r = await sendNotification(getAdminDb(), { tenantId, channel: 'sms', to: a.phone, text: `${name}: ${msg}`.slice(0, 480), kind: 'admissions_update', recipientType: 'contact', recipientId: a.id, recipientName: a.name || null }).catch(() => null);
  const ok = r?.status === 'sent';
  const ref = getAdminDb().doc(`tenants/${tenantId}/admissions/${a.id}`); const cur = ((await ref.get()).data() as any) || {};
  await ref.set({ comms: [...(cur.comms || []), { at: new Date().toISOString(), kind, subject: msg.slice(0, 80), emailed: false, texted: ok }].slice(-60) }, { merge: true });
  return ok;
}
