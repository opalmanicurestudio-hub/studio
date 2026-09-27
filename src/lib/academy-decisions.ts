// src/lib/academy-decisions.ts
//
// ADMISSION DECISIONS — applying is not acceptance.
//
//   applied ─(all documents in)─▶ review ─(a person decides)─▶
//        offer ─(applicant accepts)─▶ accepted ─(signs)─▶ agreement ─(pays)─▶ enrolled
//        waitlist ─(seat opens)─▶ offer (automatic, short deadline)
//        declined  = "Not accepted" (reason + message the applicant sees)
//        withdrawn = applicant declined the offer / offer expired / withdrew
//
// Review: required documents verified + the program's checks (minimum age,
// interview…) + optional rubric scores. "Accept" needs everything complete;
// otherwise "Accept with conditions" lists what's still owed.
// Seats: a cohort's capacity counts offer / accepted / agreement / enrolled.
// Every decision is audited, emailed as a letter (applicant's language + the
// English original) and kept on the record for printing with the seal.

import { textApplicant } from '@/lib/academy-applicant-comms';
import { getAdminDb } from '@/lib/firebase-admin';
import { appendAudit } from '@/lib/academy-compliance';
import { sendEmail } from '@/lib/academy-journey';
import { translateLong, LANGUAGES } from '@/lib/translate';
import { DEFAULT_DOCS, issueApplicationLink, setStage } from '@/lib/academy-admissions';

export const OUTCOMES: Record<string, string> = { accepted: 'Accepted', conditional: 'Accepted with conditions', waitlisted: 'Waitlisted', not_accepted: 'Not accepted' };
export const NOT_ACCEPTED_REASONS: Record<string, string> = {
  requirements: 'Admission requirements not met', incomplete: 'Application incomplete', full: 'No places available', other: 'Other',
};
export const SEAT_STAGES = ['offer', 'accepted', 'agreement', 'enrolled'];
export const DECIDABLE = ['applied', 'documents', 'review', 'waitlist'];
export const DEFAULT_CHECKS = ['Meets the minimum age requirement', 'Interview completed'];
export const OFFER_DAYS = 7, WAITLIST_OFFER_DAYS = 3;
const DAY = 86400000;
const iso = (ms: number) => new Date(ms).toISOString();
const niceDate = (v: string | null | undefined) => (v ? new Date(v).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : '');

/** The program's admission set-up: checks every applicant must meet, optional rubric. */
export function setupOf(p: any) {
  return { checks: Array.isArray(p?.admission?.checks) ? p.admission.checks : DEFAULT_CHECKS, rubric: Array.isArray(p?.admission?.rubric) ? p.admission.rubric : [] };
}

/** Where the review stands — what's complete and what's still missing. */
export function reviewState(a: any, p: any) {
  const req: string[] = a.requiredDocs || DEFAULT_DOCS; const setup = setupOf(p);
  const docs = req.map((k) => ({ key: k, status: a.documents?.[k]?.status || 'missing' }));
  const checks = setup.checks.map((label: string) => ({ label, ...(a.checks?.[label] || { done: false }) }));
  const scores = Object.values(a.rubric || {}) as Record<string, number>[];
  const rubric = setup.rubric.map((c: string) => { const v = scores.map((s) => s[c]).filter((n) => typeof n === 'number'); return { criterion: c, avg: v.length ? Math.round((v.reduce((x, y) => x + y, 0) / v.length) * 10) / 10 : null, count: v.length }; });
  const missing = [
    ...docs.filter((d) => d.status !== 'verified').map((d) => `${d.key} — ${d.status === 'missing' ? 'not uploaded' : d.status === 'rejected' ? 'sent back' : 'not verified yet'}`),
    ...checks.filter((c: any) => !c.done).map((c: any) => c.label),
  ];
  return { docs, checks, rubric, interview: a.interview || null, missing, ready: missing.length === 0 };
}

export async function seatsTaken(tenantId: string, cohortId: string, excludeId?: string) {
  const s = await getAdminDb().collection(`tenants/${tenantId}/admissions`).where('cohortId', '==', cohortId).limit(2000).get();
  return s.docs.filter((d: any) => d.id !== excludeId && SEAT_STAGES.includes((d.data() as any).stage)).length;
}

/** A link to the applicant's private page. Earlier links keep working. */
async function linkFor(tenantId: string, id: string, origin: string) {
  return `${origin}/learn/${tenantId}/application/${await issueApplicationLink(tenantId, id)}`;
}

/** The decision letter, in English (the official copy). */
export function decisionLetter(o: { a: any; program: string; school: string; contact: string; outcome: string; cohortName?: string | null; startDate?: string | null;
  expiresAt?: string | null; conditions?: string[]; message?: string | null; reasonCode?: string | null; reason?: string | null; reapplyAfter?: string | null; position?: number | null; link: string; fromWaitlist?: boolean }) {
  const first = String(o.a.name || '').split(' ')[0] || 'there';
  const start = o.startDate ? ` starting ${niceDate(o.startDate)}` : o.cohortName ? ` (${o.cohortName})` : '';
  const personal = o.message ? `\n\n${o.message}` : '';
  const sign = `\n\nWarm regards,\n${o.school}`;
  if (o.outcome === 'accepted' || o.outcome === 'conditional') {
    const cond = o.outcome === 'conditional' && o.conditions?.length ? `\n\n# Conditions of your offer\nYour place is offered on these conditions:\n${o.conditions.map((c) => `- ${c}`).join('\n')}\nPlease meet them before your program starts.` : '';
    return { title: o.fromWaitlist ? 'A place has opened for you' : 'Offer of admission', body:
`Dear ${first},

${o.fromWaitlist ? `Good news — a place has opened in **${o.program}**${start}, and it’s yours if you want it.` : `We’re pleased to offer you a place in **${o.program}**${start}.`}${cond}

# Accept your place
Please accept your offer by **${niceDate(o.expiresAt)}** on your application page:
${o.link}

Once you accept, you’ll sign your enrolment agreement and make your down payment there. If we don’t hear from you by ${niceDate(o.expiresAt)}, the place may be offered to someone else.${personal}${sign}` };
  }
  if (o.outcome === 'waitlisted') return { title: 'Your application — waitlist', body:
`Dear ${first},

Thank you for applying to **${o.program}**. Your application meets our requirements, but ${o.cohortName ? `${o.cohortName} is` : 'the program is'} currently full, so we’ve placed you on the waitlist${o.position ? ` (you’re number ${o.position})` : ''}.

If a place opens, we’ll email you an offer and you’ll have ${WAITLIST_OFFER_DAYS} days to accept it. You don’t need to do anything now. You can check your status any time:
${o.link}${personal}${sign}` };
  return { title: 'Your application', body:
`Dear ${first},

Thank you for applying to **${o.program}** and for the time you put into your application. After careful review, we’re not able to offer you a place at this time.

${o.reason || NOT_ACCEPTED_REASONS[o.reasonCode || 'other'] || ''}
${o.reapplyAfter ? `\nYou’re welcome to apply again from ${niceDate(o.reapplyAfter)}.` : ''}
If you have questions about this decision, please contact us${o.contact ? ` at ${o.contact}` : ''}.${personal}${sign}` };
}

/** Email a letter in the applicant's language with the English original below. */
async function sendLetter(tenantId: string, a: any, letter: { title: string; body: string }, school: string) {
  const plain = (s: string) => s.replace(/\*\*(.+?)\*\*/g, '$1').replace(/^#\s+/gm, '');
  const lang = a.language && a.language !== 'en' && LANGUAGES[a.language] ? a.language : null;
  let text = plain(letter.body);
  if (lang) { const tr = await translateLong(tenantId, letter.body, lang).catch(() => ''); if (tr && tr !== letter.body) text = `${plain(tr)}\n\n——— English (official copy) ———\n\n${plain(letter.body)}`; }
  return sendEmail(a.email, `${letter.title} — ${school}`, text, tenantId, { official: true });
}

async function context(tenantId: string, a: any) {
  const db = getAdminDb();
  const [t, p, c] = await Promise.all([
    db.doc(`tenants/${tenantId}`).get().then((s: any) => (s.data() as any) || {}),
    db.doc(`tenants/${tenantId}/programs/${a.programId}`).get().then((s: any) => (s.data() as any) || {}),
    a.cohortId ? db.doc(`tenants/${tenantId}/cohorts/${a.cohortId}`).get().then((s: any) => (s.data() as any) || null) : Promise.resolve(null),
  ]);
  const ident = ((await db.doc(`tenants/${tenantId}/schoolIdentity/main`).get()).data() as any) || {};
  const school = ident.displayName || t.name || 'Our school';
  const contact = [ident.email || t.email, ident.phone || t.phone].filter(Boolean).join(' or ');
  return { t, p, c, school, contact };
}

async function waitlistPosition(tenantId: string, a: any) {
  const s = await getAdminDb().collection(`tenants/${tenantId}/admissions`).where('stage', '==', 'waitlist').limit(2000).get();
  const same = s.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) })).filter((x: any) => x.programId === a.programId && (x.cohortId || null) === (a.cohortId || null))
    .sort((x: any, y: any) => String(x.waitlistedAt || '').localeCompare(String(y.waitlistedAt || '')));
  const i = same.findIndex((x: any) => x.id === a.id); return i >= 0 ? i + 1 : null;
}

export interface DecisionInput { outcome: string; cohortId?: string | null; offerDays?: number; conditions?: string[]; message?: string; reasonCode?: string; reason?: string; reapplyAfter?: string }

/** A person's decision. Throws a plain-language error when it can't be made. */
export async function decide(tenantId: string, id: string, input: DecisionInput, by: string, origin: string) {
  const db = getAdminDb(); const ref = db.doc(`tenants/${tenantId}/admissions/${id}`);
  const a = ((await ref.get()).data() as any) || null;
  if (!a) throw new Error('Applicant not found.');
  if (!OUTCOMES[input.outcome]) throw new Error('Choose a decision.');
  if (!DECIDABLE.includes(a.stage)) throw new Error(a.stage === 'offer' ? 'They already have an offer — extend it or wait for their answer.' : `A decision can’t be made at the “${a.stage}” stage.`);
  const cohortId = input.cohortId !== undefined ? (input.cohortId || null) : (a.cohortId || null);
  const { p, school, contact } = await context(tenantId, { ...a, cohortId });
  const c = cohortId ? (((await db.doc(`tenants/${tenantId}/cohorts/${cohortId}`).get()).data() as any) || null) : null;
  const rs = reviewState(a, p);
  const conditions = (input.conditions || []).map((x) => String(x).trim().slice(0, 200)).filter(Boolean).slice(0, 12);
  const message = String(input.message || '').trim().slice(0, 1500) || null;
  const now = new Date().toISOString();
  const patch: any = { cohortId, startDate: c?.startDate || a.startDate || null, updatedAt: now };

  if (input.outcome === 'accepted' && !rs.ready) throw new Error(`Not everything is complete (${rs.missing.length} item${rs.missing.length === 1 ? '' : 's'}). Choose “Accept with conditions” and list what’s still needed.`);
  if (input.outcome === 'conditional' && !conditions.length) throw new Error('List the conditions of the offer.');
  if ((input.outcome === 'accepted' || input.outcome === 'conditional') && c?.capacity) {
    const taken = await seatsTaken(tenantId, cohortId!, id);
    if (taken >= c.capacity) throw new Error(`${c.name || 'That cohort'} is full (${taken} of ${c.capacity} places taken). Waitlist them, or choose another cohort.`);
  }
  if (input.outcome === 'not_accepted') {
    if (!NOT_ACCEPTED_REASONS[input.reasonCode || '']) throw new Error('Choose a reason.');
    if (!String(input.reason || '').trim()) throw new Error('Write what you’ll tell the applicant — it goes in their letter.');
  }
  const offerDays = Math.min(30, Math.max(1, Number(input.offerDays) || OFFER_DAYS));
  const decision = { outcome: input.outcome, by, at: now, conditions, message, reasonCode: input.reasonCode || null, reason: input.outcome === 'not_accepted' ? String(input.reason).trim().slice(0, 1000) : null, reapplyAfter: input.outcome === 'not_accepted' ? (String(input.reapplyAfter || '').slice(0, 10) || null) : null };
  patch.decision = decision; patch.decisions = [...(a.decisions || []), decision];
  let stage = 'declined';
  if (input.outcome === 'accepted' || input.outcome === 'conditional') { stage = 'offer'; patch.offer = { expiresAt: iso(Date.now() + offerDays * DAY), conditions: conditions.map((text) => ({ text, met: false })), fromWaitlist: a.stage === 'waitlist', madeAt: now }; }
  if (input.outcome === 'waitlisted') { stage = 'waitlist'; patch.waitlistedAt = a.waitlistedAt || now; patch.waitlisted = true; } else patch.waitlisted = false;
  await ref.set(patch, { merge: true });
  await setStage(tenantId, id, stage as any, by, OUTCOMES[input.outcome]);
  await appendAudit(tenantId, { type: 'admissions.decision', by, summary: `${a.name}: ${OUTCOMES[input.outcome]}${decision.reasonCode ? ` — ${NOT_ACCEPTED_REASONS[decision.reasonCode]}` : ''}${conditions.length ? ` (${conditions.length} condition${conditions.length === 1 ? '' : 's'})` : ''}`, data: { admissionId: id } });

  const fresh = { ...a, ...patch, stage };
  const letter = decisionLetter({ a: fresh, program: p.name || 'the program', school, contact, outcome: input.outcome, cohortName: c?.name || null, startDate: patch.startDate,
    expiresAt: patch.offer?.expiresAt, conditions, message, reasonCode: decision.reasonCode, reason: decision.reason, reapplyAfter: decision.reapplyAfter,
    position: input.outcome === 'waitlisted' ? await waitlistPosition(tenantId, fresh) : null, link: await linkFor(tenantId, id, origin), fromWaitlist: patch.offer?.fromWaitlist });
  const emailed = await sendLetter(tenantId, fresh, letter, school);
  await ref.set({ letters: [...(a.letters || []), { ...letter, kind: input.outcome, at: now, by, emailed, language: a.language || 'en' }] }, { merge: true });
  // A short text for applicants who opted in — never the news of a "no" by text.
  await textApplicant(tenantId, { ...fresh, id }, input.outcome === 'accepted' || input.outcome === 'conditional' ? `good news — you’ve been offered a place! Check your email to accept by ${niceDate(patch.offer?.expiresAt)}.` : input.outcome === 'waitlisted' ? 'you’re on our waitlist — details are in your email.' : 'we’ve emailed you about your application.', `decision_${input.outcome}`).catch(() => null);
  // A place freed? (e.g. someone holding a seat was moved out)
  if (cohortId && input.outcome !== 'accepted' && input.outcome !== 'conditional') await promoteWaitlist(tenantId, cohortId, origin);
  return { stage, letter, emailed };
}

/** The applicant's answer to their offer. */
export async function respondOffer(tenantId: string, a: any, accept: boolean, origin: string, why?: string) {
  if (a.stage !== 'offer' || !a.offer) throw new Error('There’s no open offer on this application.');
  const now = new Date().toISOString();
  if (a.offer.expiresAt && a.offer.expiresAt < now) throw new Error('This offer has expired — please contact the school.');
  const ref = getAdminDb().doc(`tenants/${tenantId}/admissions/${a.id}`);
  await ref.set({ offer: { ...a.offer, response: accept ? 'accepted' : 'declined', respondedAt: now, declineReason: accept ? null : String(why || '').slice(0, 300) || null }, updatedAt: now }, { merge: true });
  await setStage(tenantId, a.id, accept ? 'accepted' : 'withdrawn', 'applicant', accept ? 'Accepted the offer' : `Declined the offer${why ? ` — ${String(why).slice(0, 120)}` : ''}`);
  await appendAudit(tenantId, { type: accept ? 'admissions.offer_accepted' : 'admissions.offer_declined', by: a.email, summary: `${a.name} ${accept ? 'accepted' : 'declined'} their offer`, data: { admissionId: a.id } });
  if (!accept && a.cohortId) await promoteWaitlist(tenantId, a.cohortId, origin);
}

/** Seats open in a cohort → automatic offers to the waitlist, first come first served. */
export async function promoteWaitlist(tenantId: string, cohortId: string, origin: string) {
  const db = getAdminDb();
  const c = ((await db.doc(`tenants/${tenantId}/cohorts/${cohortId}`).get()).data() as any) || null;
  if (!c?.capacity) return 0;
  let free = c.capacity - (await seatsTaken(tenantId, cohortId)); if (free <= 0) return 0;
  const s = await db.collection(`tenants/${tenantId}/admissions`).where('cohortId', '==', cohortId).limit(2000).get();
  const queue = s.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) })).filter((x: any) => x.stage === 'waitlist').sort((x: any, y: any) => String(x.waitlistedAt || '').localeCompare(String(y.waitlistedAt || '')));
  let offered = 0;
  for (const a of queue) {
    if (free <= 0) break;
    const now = new Date().toISOString(); const offer = { expiresAt: iso(Date.now() + WAITLIST_OFFER_DAYS * DAY), conditions: (a.decision?.conditions || []).map((text: string) => ({ text, met: false })), fromWaitlist: true, auto: true, madeAt: now };
    await db.doc(`tenants/${tenantId}/admissions/${a.id}`).set({ offer, waitlisted: false, updatedAt: now }, { merge: true });
    await setStage(tenantId, a.id, 'offer', 'automatic', 'A place opened — offered from the waitlist');
    await appendAudit(tenantId, { type: 'admissions.waitlist_offer', by: 'automatic', summary: `${a.name} offered a place in ${c.name || 'the cohort'} from the waitlist`, data: { admissionId: a.id } });
    const { p, school, contact } = await context(tenantId, a);
    const letter = decisionLetter({ a, program: p.name || 'the program', school, contact, outcome: 'accepted', cohortName: c.name, startDate: c.startDate, expiresAt: offer.expiresAt, conditions: offer.conditions.map((x: any) => x.text), link: await linkFor(tenantId, a.id, origin), fromWaitlist: true });
    const emailed = await sendLetter(tenantId, a, letter, school);
    await db.doc(`tenants/${tenantId}/admissions/${a.id}`).set({ letters: [...(a.letters || []), { ...letter, kind: 'waitlist_offer', at: now, by: 'automatic', emailed, language: a.language || 'en' }] }, { merge: true });
    await textApplicant(tenantId, a, `a place has opened for you! Check your email to accept by ${niceDate(offer.expiresAt)}.`, 'waitlist_offer').catch(() => null);
    free--; offered++;
  }
  return offered;
}

/** Daily: offer reminders + expiry, missing-document nudges. */
export async function admissionsDaily(originFor: (t: any) => string) {
  const db = getAdminDb(); const out = { reminded: 0, expired: 0, nudged: 0 };
  const tenants = await db.collection('tenants').select('name', 'publicOrigin').limit(2000).get();
  const now = Date.now();
  for (const td of tenants.docs) {
    const tenantId = td.id; const origin = originFor(td.data());
    const q = await db.collection(`tenants/${tenantId}/admissions`).where('stage', 'in', ['offer', 'applied']).limit(1000).get().catch(() => null);
    for (const d of q?.docs || []) {
      const a = { id: d.id, ...(d.data() as any) };
      try {
        if (a.stage === 'offer' && a.offer?.expiresAt) {
          const left = Date.parse(a.offer.expiresAt) - now;
          if (left <= 0) {
            await d.ref.set({ offer: { ...a.offer, response: 'expired', respondedAt: new Date().toISOString() } }, { merge: true });
            await setStage(tenantId, a.id, 'withdrawn', 'automatic', 'Offer expired');
            await appendAudit(tenantId, { type: 'admissions.offer_expired', by: 'automatic', summary: `${a.name}’s offer expired`, data: { admissionId: a.id } });
            const { school, contact } = await context(tenantId, a);
            await sendEmail(a.email, `Your offer has expired — ${school}`, `Hi ${String(a.name).split(' ')[0]},\n\nWe didn’t hear back, so your offer has now expired and the place has been released. If you’d still like to join, please contact us${contact ? ` at ${contact}` : ''} — we’ll do our best to help.\n\n— ${school}`, tenantId);
            await textApplicant(tenantId, a, 'your offer has expired and the place was released. Contact us if you’d still like to join.', 'offer_expired').catch(() => null);
            if (a.cohortId) await promoteWaitlist(tenantId, a.cohortId, origin);
            out.expired++;
          } else if (left < 2 * DAY && !a.offer.remindedAt) {
            await d.ref.set({ offer: { ...a.offer, remindedAt: new Date().toISOString() } }, { merge: true });
            const { school } = await context(tenantId, a);
            await sendEmail(a.email, `Reminder: accept your place by ${niceDate(a.offer.expiresAt)} — ${school}`, `Hi ${String(a.name).split(' ')[0]},\n\nJust a reminder that your offer to join us is open until ${niceDate(a.offer.expiresAt)}. You can accept (or let us know you won’t be joining) on your application page:\n\n${await linkFor(tenantId, a.id, origin)}\n\n— ${school}`, tenantId);
            await textApplicant(tenantId, a, `reminder — please accept your place by ${niceDate(a.offer.expiresAt)} (see your email).`, 'offer_reminder').catch(() => null);
            out.reminded++;
          }
        }
        if (a.stage === 'applied') {
          const missing = (a.requiredDocs || DEFAULT_DOCS).filter((k: string) => !a.documents?.[k]);
          const last = Date.parse(a.docsNudgedAt || a.createdAt || '') || now;
          if (missing.length && (a.docsNudges || 0) < 3 && now - last > 4 * DAY) {
            await d.ref.set({ docsNudges: (a.docsNudges || 0) + 1, docsNudgedAt: new Date().toISOString() }, { merge: true });
            const { school } = await context(tenantId, a);
            await sendEmail(a.email, `Your application — a few documents to go — ${school}`, `Hi ${String(a.name).split(' ')[0]},\n\nYour application is waiting on: ${missing.join(', ')}. Once they’re uploaded, our admissions team can review your application.\n\n${await linkFor(tenantId, a.id, origin)}\n\n— ${school}`, tenantId);
            out.nudged++;
          }
        }
      } catch { /* next applicant */ }
    }
  }
  return out;
}

/** Counts for the school's "today" list. */
export function homeCounts(A: any[]) {
  const now = Date.now();
  return {
    interviewChanges: A.filter((a) => a.interview?.status === 'reschedule_requested').length,
    reviewsWaiting: A.filter((a) => a.stage === 'review' || a.stage === 'documents').length,
    offersExpiring: A.filter((a) => a.stage === 'offer' && a.offer?.expiresAt && Date.parse(a.offer.expiresAt) - now < 2 * DAY).length,
    stalledInquiries: A.filter((a) => ['inquiry', 'tour'].includes(a.stage) && now - (Date.parse(a.updatedAt || a.createdAt || '') || now) > 3 * DAY).length,
    waitlist: A.filter((a) => a.stage === 'waitlist').length,
  };
}
