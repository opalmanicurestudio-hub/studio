// src/lib/academy-funding.ts
//
// FUNDING, SCHOLARSHIPS AND DONORS
//
//   donations/{checkoutSessionId}      a gift, paid through the school's OWN
//                                      Stripe account (like tuition). Recorded
//                                      once — by the return page or the webhook.
//   scholarshipApplications/{id}       kind 'application' (from the website) or
//                                      'direct' (an award staff make, e.g. an
//                                      emergency grant). status: new → reviewing
//                                      → awarded | declined | withdrawn.
//
// Awards reach students as a credit on their tuition (a negative ledger
// adjustment, exactly how refunds already work). If the student hasn't signed
// yet, the award waits and is applied the moment their tuition plan exists.
// Funds: the names on the Support page ("Student kits", …) plus "General".
// A fund's balance = gifts to it − awards from it.
// Receipts only use tax-deductible wording when the school says the receiving
// organisation is a tax-exempt nonprofit AND gives its EIN.

import Stripe from 'stripe';
import { getAdminDb } from '@/lib/firebase-admin';
import { appendAudit } from '@/lib/academy-compliance';
import { ledger } from '@/lib/academy-admissions';
import { studentIdFor } from '@/lib/academy';
import { getSettings, usd } from '@/lib/school-site';
import { getIdentity } from '@/lib/school-identity';
import { brandedEmailHtml } from '@/lib/email-template';
import { sendAcademyEmail } from '@/lib/academy-email';
import { thankYouLetter, yearStatement, taxLine, type DonorWho } from '@/lib/donor-letters';
import { sendNotification } from '@/lib/notify';

const stripe = () => new Stripe(process.env.STRIPE_SECRET_KEY || '', { apiVersion: '2025-04-30.basil' as any });
export const GENERAL = 'General (where it’s needed most)';
const niceDay = (v: string) => new Date(v).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

export async function fundNames(tenantId: string) {
  const s = await getSettings(tenantId);
  return [...s.donors.funds.map((f) => f.name), GENERAL];
}
async function who(tenantId: string) {
  const db = getAdminDb(); const t = ((await db.doc(`tenants/${tenantId}`).get()).data() as any) || {};
  const id = await getIdentity(tenantId, t).catch(() => null); const s = await getSettings(tenantId);
  return { t, school: id?.displayName || t.name || 'Our school', legal: id?.legalName || id?.displayName || t.name || 'Our school', nonprofit: s.donors.nonprofit && !!s.donors.ein, ein: s.donors.ein, settings: s };
}
async function mail(tenantId: string, to: string, subject: string, school: string, title: string, lines: string[], kind: string, footer?: string) {
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to || '')) return false;
  const html = brandedEmailHtml({ studioName: school, title, bodyLines: lines, footerNote: footer || `Sent by ${school}.` });
  const r = await sendNotification(getAdminDb(), { tenantId, channel: 'email', to, subject, html, kind, recipientType: 'contact', recipientId: tenantId, recipientName: null }).catch(() => null);
  return r?.status === 'sent';
}

// ── Gifts ────────────────────────────────────────────────────────────────
export interface GiftInput { amountCents: number; fund: string; name: string; email: string; anonymous: boolean; business: boolean; businessName: string; showName: boolean; message: string }
export async function donationSession(tenantId: string, g: GiftInput, origin: string) {
  const { t, school } = await who(tenantId);
  if (!t.stripeAccountId) throw new Error('Online giving isn’t set up yet — please contact the school.');
  if (!(g.amountCents >= 500 && g.amountCents <= 5_000_000)) throw new Error('Choose an amount between $5 and $50,000.');
  const funds = await fundNames(tenantId); const fund = funds.includes(g.fund) ? g.fund : GENERAL;
  const meta = { type: 'academy_donation', fund: fund.slice(0, 100), name: g.name.slice(0, 80), anonymous: g.anonymous ? '1' : '', business: g.business ? g.businessName.slice(0, 100) || g.name.slice(0, 80) : '', showName: g.showName ? '1' : '', message: g.message.slice(0, 450) };
  const session = await stripe().checkout.sessions.create({
    mode: 'payment', payment_method_types: ['card'], customer_email: g.email || undefined, submit_type: 'donate',
    line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: Math.round(g.amountCents), product_data: { name: `Gift to ${school} — ${fund}` } } }],
    payment_intent_data: { metadata: meta, description: `Gift — ${fund}` }, metadata: meta,
    success_url: `${origin}/school/${tenantId}/support?gift={CHECKOUT_SESSION_ID}`, cancel_url: `${origin}/school/${tenantId}/support`,
  } as any, { stripeAccount: t.stripeAccountId });
  return session.url as string;
}

/** Record a paid gift and send the receipt. Safe to run twice (return page + webhook). */
export async function completeDonation(tenantId: string, session: any) {
  if (session?.metadata?.type !== 'academy_donation' || session.payment_status !== 'paid') return null;
  const db = getAdminDb(); const ref = db.doc(`tenants/${tenantId}/donations/${session.id}`);
  const made = await db.runTransaction(async (tx: any) => { const s = await tx.get(ref); if (s.exists) return null; const m = session.metadata || {};
    const rec = { id: session.id, amountCents: Number(session.amount_total) || 0, fund: m.fund || GENERAL, name: m.name || session.customer_details?.name || '', email: String(session.customer_details?.email || session.customer_email || '').toLowerCase() || null,
      anonymous: !!m.anonymous, business: m.business || null, showName: !!m.showName, message: m.message || null, status: 'paid', createdAt: new Date().toISOString(), paymentIntent: typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id || null,
      receiptNo: `G-${new Date().getFullYear()}-${session.id.slice(-6).toUpperCase()}` };
    tx.set(ref, rec); return rec; });
  if (!made) return { already: true };
  await appendAudit(tenantId, { type: 'funding.gift', by: made.email || 'donor', summary: `Gift ${usd(made.amountCents)} to “${made.fund}”${made.business ? ` from ${made.business}` : ''}` });
  const sent = await sendReceipt(tenantId, made);
  await ref.set({ receiptSent: sent }, { merge: true });
  return { ok: true, gift: made };
}

export function receiptLines(g: any, w: DonorWho) {
  // Kept for the thank-you screen and older callers: the plain receipt lines.
  return [`Thank you${g.name ? `, ${String(g.name).split(' ')[0]}` : ''}! Your gift of ${usd(g.amountCents)} to ${w.school} (${g.fund}) was received on ${niceDay(g.createdAt)}.`, `Receipt number: ${g.receiptNo}`, taxLine(w)];
}
/** The thank-you letter with the receipt — branded, signed, with the seal. */
export async function sendReceipt(tenantId: string, g: any) {
  if (!g.email) return false; const w = await who(tenantId);
  return sendAcademyEmail(tenantId, g.email, `Thank you for your gift — ${w.school}`, thankYouLetter(g, w, w.settings.donors.thankYou), { official: true });
}
/** A donor's gifts for one year (matched by email). */
export async function giftsFor(tenantId: string, email: string, year: number) {
  const q = await getAdminDb().collection(`tenants/${tenantId}/donations`).where('email', '==', String(email || '').toLowerCase()).limit(500).get();
  return q.docs.map((d: any) => d.data() as any).filter((g: any) => g.status === 'paid' && String(g.createdAt).startsWith(String(year)));
}
export async function sendStatement(tenantId: string, email: string, year: number) {
  const gifts = await giftsFor(tenantId, email, year); if (!gifts.length) throw new Error('No gifts from that donor that year.');
  const w = await who(tenantId);
  return sendAcademyEmail(tenantId, email, `Your ${year} giving statement — ${w.school}`, yearStatement(gifts, w, year), { official: true });
}
export async function letterWho(tenantId: string) { const w = await who(tenantId); return { school: w.school, legal: w.legal, nonprofit: w.nonprofit, ein: w.ein, thankYou: w.settings.donors.thankYou || '' }; }

// ── Sponsor logos ────────────────────────────────────────────────────────
//   sponsors/{id}  { name, url, logo (data URL), status pending|approved|hidden,
//                    source gift|manual, email, totalCents, giftIds }
// A business donor can add a logo after giving; it shows only once approved.
const LOGO_OK = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;
const cleanUrl = (u: any) => { const v = String(u || '').trim().slice(0, 300); if (!v) return ''; const w = /^https?:\/\//.test(v) ? v : `https://${v}`; try { const x = new URL(w); return /^https?:$/.test(x.protocol) && x.hostname.includes('.') ? x.toString() : ''; } catch { return ''; } };
export async function sponsorFromGift(tenantId: string, sessionId: string, logo: string, url: string) {
  const db = getAdminDb(); const g = ((await db.doc(`tenants/${tenantId}/donations/${sessionId}`).get()).data() as any) || null;
  if (!g || g.status !== 'paid') throw new Error('We couldn’t find that gift.');
  if (!g.business || g.anonymous || !g.showName) throw new Error('Logos are for business gifts that asked to be thanked by name.');
  if (!LOGO_OK.test(logo) || logo.length > 400_000) throw new Error('Please use a PNG, JPG or WebP logo under 300 KB.');
  const q = await db.collection(`tenants/${tenantId}/sponsors`).where('email', '==', g.email || '').limit(5).get();
  const ref = q.docs[0]?.ref || db.collection(`tenants/${tenantId}/sponsors`).doc(); const cur = q.docs[0] ? (q.docs[0].data() as any) : null;
  const giftIds = [...new Set([...(cur?.giftIds || []), g.id])];
  const all = await Promise.all(giftIds.map(async (id) => ((await db.doc(`tenants/${tenantId}/donations/${id}`).get()).data() as any)?.amountCents || 0));
  await ref.set({ id: ref.id, name: g.business, url: cleanUrl(url), logo, email: g.email || null, source: 'gift', giftIds, totalCents: all.reduce((n: number, c: number) => n + c, 0), status: cur?.status === 'approved' ? 'pending' : 'pending', updatedAt: new Date().toISOString(), createdAt: cur?.createdAt || new Date().toISOString() }, { merge: true });
  await appendAudit(tenantId, { type: 'funding.sponsor_logo', by: g.email || 'donor', summary: `${g.business} added a logo for the sponsor wall (waiting for approval)` });
  return ref.id;
}
export async function saveSponsor(tenantId: string, v: any, by: string) {
  const db = getAdminDb(); const ref = v.id ? db.doc(`tenants/${tenantId}/sponsors/${String(v.id)}`) : db.collection(`tenants/${tenantId}/sponsors`).doc();
  const cur = ((await ref.get()).data() as any) || {};
  const name = String(v.name ?? cur.name ?? '').trim().slice(0, 100); if (!name) throw new Error('Add the sponsor’s name.');
  const logo = v.logo === undefined ? cur.logo : v.logo;
  if (logo && (!LOGO_OK.test(logo) || logo.length > 400_000)) throw new Error('Please use a PNG, JPG or WebP logo under 300 KB.');
  const status = ['pending', 'approved', 'hidden'].includes(v.status) ? v.status : (cur.status || 'approved');
  await ref.set({ id: ref.id, name, url: v.url === undefined ? (cur.url || '') : cleanUrl(v.url), logo: logo || null, status, source: cur.source || 'manual', email: cur.email || null,
    totalCents: v.totalCents !== undefined ? Math.max(0, Math.round(Number(v.totalCents) || 0)) : (cur.totalCents || 0), tier: String(v.tier ?? cur.tier ?? '').slice(0, 40) || null, updatedAt: new Date().toISOString(), createdAt: cur.createdAt || new Date().toISOString() }, { merge: true });
  if (cur.status !== status || !cur.name) await appendAudit(tenantId, { type: 'funding.sponsor', by, summary: `Sponsor “${name}” ${status === 'approved' ? 'shown on the website' : status === 'hidden' ? 'hidden' : 'saved'}` });
  return ref.id;
}
/** The approved sponsor wall, biggest supporters first, with tiers. */
export async function sponsorWall(tenantId: string, tiers: { name: string; minCents: number }[]) {
  const q = await getAdminDb().collection(`tenants/${tenantId}/sponsors`).where('status', '==', 'approved').limit(200).get().catch(() => ({ docs: [] as any[] }));
  const tierOf = (s: any) => s.tier || tiers.find((t) => (s.totalCents || 0) >= t.minCents)?.name || tiers[tiers.length - 1]?.name || '';
  return q.docs.map((d: any) => d.data() as any).sort((a: any, b: any) => (b.totalCents || 0) - (a.totalCents || 0))
    .map((s: any) => ({ id: s.id, name: s.name, url: s.url || null, hasLogo: !!s.logo, tier: tierOf(s), rank: Math.max(0, tiers.findIndex((t) => t.name === tierOf(s))) }));
}

// ── Scholarships ─────────────────────────────────────────────────────────
export async function scholarshipApply(tenantId: string, v: { scholarship: string; name: string; email: string; phone: string; programId: string; why: string; need: string; goals: string }) {
  const w = await who(tenantId); const s = w.settings.scholarships.find((x) => x.name === v.scholarship);
  if (!s) throw new Error('That scholarship isn’t open.');
  if (s.deadline && s.deadline < new Date().toISOString().slice(0, 10)) throw new Error('Applications for this scholarship have closed.');
  if (!v.name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.email)) throw new Error('Add your name and email.');
  if (v.why.trim().length < 30) throw new Error('Tell us a little more about why you’re applying (a few sentences).');
  const db = getAdminDb(); const T = `tenants/${tenantId}`;
  const dupe = (await db.collection(`${T}/scholarshipApplications`).where('email', '==', v.email).limit(20).get()).docs.find((d: any) => (d.data() as any).scholarship === s.name && !['declined', 'withdrawn'].includes((d.data() as any).status));
  if (dupe) throw new Error('You’ve already applied for this scholarship — we’ll be in touch.');
  const adm = (await db.collection(`${T}/admissions`).where('email', '==', v.email).limit(5).get()).docs[0];
  const ref = db.collection(`${T}/scholarshipApplications`).doc(); const now = new Date().toISOString();
  await ref.set({ id: ref.id, kind: 'application', scholarship: s.name, fund: (s as any).fund || GENERAL, maxCents: s.amountCents || 0, name: v.name, email: v.email, phone: v.phone || null, programId: v.programId || adm?.data()?.programId || null, admissionId: adm?.id || null,
    answers: { why: v.why.slice(0, 3000), need: v.need.slice(0, 3000), goals: v.goals.slice(0, 3000) }, status: 'new', notes: [], createdAt: now, updatedAt: now });
  await appendAudit(tenantId, { type: 'funding.scholarship_applied', by: v.email, summary: `${v.name} applied for “${s.name}”` });
  await mail(tenantId, v.email, `Your scholarship application — ${w.school}`, w.school, 'We got your application', [`Hi ${v.name.split(' ')[0]} — thanks for applying for the ${s.name}.`, `Our team reviews every application${s.deadline ? ` after the deadline (${niceDay(s.deadline + 'T12:00:00')})` : ''} and will email you the decision. Applying doesn’t guarantee an award.`], 'scholarship_receipt');
  return ref.id;
}

/** A person's decision on an application. */
export async function decideScholarship(tenantId: string, id: string, d: { outcome: string; amountCents?: number; fund?: string; message?: string }, by: string) {
  const db = getAdminDb(); const ref = db.doc(`tenants/${tenantId}/scholarshipApplications/${id}`);
  const a = ((await ref.get()).data() as any) || null; if (!a) throw new Error('Not found.');
  if (!['awarded', 'declined'].includes(d.outcome)) throw new Error('Choose award or decline.');
  if (['awarded', 'declined'].includes(a.status)) throw new Error('A decision has already been made.');
  const w = await who(tenantId); const now = new Date().toISOString(); const funds = await fundNames(tenantId);
  const amt = Math.round(Number(d.amountCents) || 0);
  if (d.outcome === 'awarded') {
    if (amt <= 0) throw new Error('Enter the award amount.');
    if (a.maxCents && amt > a.maxCents) throw new Error(`This scholarship awards up to ${usd(a.maxCents)}.`);
  }
  const fund = funds.includes(String(d.fund)) ? String(d.fund) : (a.fund || GENERAL);
  const message = String(d.message || '').trim().slice(0, 1500) || null;
  await ref.set({ status: d.outcome, decision: { outcome: d.outcome, amountCents: d.outcome === 'awarded' ? amt : 0, fund, message, by, at: now }, awardCents: d.outcome === 'awarded' ? amt : 0, fund, updatedAt: now }, { merge: true });
  await appendAudit(tenantId, { type: 'funding.scholarship_decision', by, summary: `${a.name}: “${a.scholarship}” ${d.outcome === 'awarded' ? `awarded ${usd(amt)} from ${fund}` : 'not awarded'}` });
  const first = String(a.name).split(' ')[0];
  const lines = d.outcome === 'awarded'
    ? [`Congratulations, ${first}! You’ve been awarded ${usd(amt)} from the ${a.scholarship}.`, 'It will be applied to your tuition as a credit — you’ll see it on your tuition balance once your enrolment agreement is signed.', ...(message ? [message] : [])]
    : [`Hi ${first} — thank you for applying for the ${a.scholarship}. We had more applications than awards available, and we’re not able to offer you this scholarship this time.`, ...(message ? [message] : []), 'Please ask us about other funding options — we’re glad to help.'];
  const emailed = await mail(tenantId, a.email, d.outcome === 'awarded' ? `You’ve been awarded a scholarship — ${w.school}` : `Your scholarship application — ${w.school}`, w.school, d.outcome === 'awarded' ? 'Scholarship awarded' : 'About your application', lines, 'scholarship_decision');
  await ref.set({ letterEmailed: emailed }, { merge: true });
  if (d.outcome === 'awarded') await applyAward(tenantId, id, by).catch(() => null);
  return { emailed };
}

/** An award staff make directly (e.g. an emergency grant or kit). */
export async function directAward(tenantId: string, v: { admissionId: string; amountCents: number; fund: string; reason: string }, by: string) {
  const db = getAdminDb(); const T = `tenants/${tenantId}`;
  const a = ((await db.doc(`${T}/admissions/${v.admissionId}`).get()).data() as any) || null; if (!a) throw new Error('Choose a student.');
  const amt = Math.round(Number(v.amountCents) || 0); if (amt <= 0) throw new Error('Enter the amount.');
  const funds = await fundNames(tenantId); const fund = funds.includes(v.fund) ? v.fund : GENERAL; const now = new Date().toISOString();
  const ref = db.collection(`${T}/scholarshipApplications`).doc();
  await ref.set({ id: ref.id, kind: 'direct', scholarship: String(v.reason || 'Award').slice(0, 100), fund, name: a.name, email: a.email, programId: a.programId || null, admissionId: v.admissionId,
    status: 'awarded', awardCents: amt, decision: { outcome: 'awarded', amountCents: amt, fund, message: null, by, at: now }, notes: [], createdAt: now, updatedAt: now });
  await appendAudit(tenantId, { type: 'funding.direct_award', by, summary: `${a.name}: ${usd(amt)} from ${fund} — ${v.reason || 'award'}` });
  await applyAward(tenantId, ref.id, by).catch(() => null);
  return ref.id;
}

/** Put an award on the student's tuition — once. Waits if there's no plan yet. */
export async function applyAward(tenantId: string, id: string, by: string) {
  const db = getAdminDb(); const ref = db.doc(`tenants/${tenantId}/scholarshipApplications/${id}`);
  const a = ((await ref.get()).data() as any) || null; if (!a || a.status !== 'awarded' || a.appliedAt) return { applied: false };
  const programId = a.programId; if (!programId || !a.email) return { applied: false, waiting: true };
  const planId = `${programId}_${studentIdFor(a.email)}`;
  const plan = ((await db.doc(`tenants/${tenantId}/tuitionPlans/${planId}`).get()).data() as any) || null;
  if (!plan) { await ref.set({ waitingForPlan: true }, { merge: true }); return { applied: false, waiting: true }; }
  const claimed = await db.runTransaction(async (tx: any) => { const s = await tx.get(ref); if ((s.data() as any)?.appliedAt) return false; tx.set(ref, { appliedAt: new Date().toISOString(), planId, waitingForPlan: false }, { merge: true }); return true; });
  if (!claimed) return { applied: false };
  await ledger(tenantId, planId, plan.studentId, 'adjustment', -a.awardCents, `Scholarship: ${a.scholarship} (${a.fund})`, by, `award:${id}`);
  return { applied: true, planId };
}
/** Called when a tuition plan is created: any awards waiting for this student are applied. */
export async function applyPendingAwards(tenantId: string, email: string, by = 'automatic') {
  const q = await getAdminDb().collection(`tenants/${tenantId}/scholarshipApplications`).where('email', '==', String(email || '').toLowerCase()).limit(50).get();
  let n = 0; for (const d of q.docs) { const a = d.data() as any; if (a.status === 'awarded' && !a.appliedAt) { const r = await applyAward(tenantId, d.id, by); if (r.applied) n++; } }
  return n;
}

// ── Funds and the report ─────────────────────────────────────────────────
export async function fundSummary(tenantId: string, year?: number) {
  const db = getAdminDb(); const T = `tenants/${tenantId}`; const y = year || new Date().getFullYear();
  const [gifts, awards, funds] = await Promise.all([db.collection(`${T}/donations`).limit(5000).get(), db.collection(`${T}/scholarshipApplications`).where('status', '==', 'awarded').limit(5000).get(), fundNames(tenantId)]);
  const G = gifts.docs.map((d: any) => d.data() as any).filter((g: any) => g.status === 'paid'); const A = awards.docs.map((d: any) => d.data() as any);
  const inYear = (v: string) => String(v || '').startsWith(String(y));
  const byFund = [...new Set([...funds, ...G.map((g: any) => g.fund), ...A.map((a: any) => a.fund)])].map((f) => {
    const raised = G.filter((g: any) => g.fund === f).reduce((n: number, g: any) => n + g.amountCents, 0); const awarded = A.filter((a: any) => a.fund === f).reduce((n: number, a: any) => n + (a.awardCents || 0), 0);
    return { fund: f, raised, awarded, balance: raised - awarded, raisedYear: G.filter((g: any) => g.fund === f && inYear(g.createdAt)).reduce((n: number, g: any) => n + g.amountCents, 0), awardedYear: A.filter((a: any) => a.fund === f && inYear(a.decision?.at)).reduce((n: number, a: any) => n + (a.awardCents || 0), 0) };
  });
  const gy = G.filter((g: any) => inYear(g.createdAt)); const ay = A.filter((a: any) => inYear(a.decision?.at));
  return { year: y, byFund, year_: { gifts: gy.length, raised: gy.reduce((n: number, g: any) => n + g.amountCents, 0), donors: new Set(gy.map((g: any) => g.email || g.name)).size, businesses: new Set(gy.filter((g: any) => g.business).map((g: any) => g.business)).size,
    awards: ay.length, awarded: ay.reduce((n: number, a: any) => n + (a.awardCents || 0), 0), students: new Set(ay.map((a: any) => a.email)).size } };
}
/** A first draft of "How gifts have been used" — totals only, never names. */
export function useReportDraft(s: Awaited<ReturnType<typeof fundSummary>>, school: string) {
  const y = s.year_; if (!y.gifts && !y.awards) return '';
  const lines = [`In ${s.year}, ${y.donors} supporter${y.donors === 1 ? '' : 's'}${y.businesses ? ` (including ${y.businesses} local business${y.businesses === 1 ? '' : 'es'})` : ''} gave ${usd(y.raised)} to ${school} students.`];
  if (y.awards) lines.push(`We made ${y.awards} award${y.awards === 1 ? '' : 's'} totalling ${usd(y.awarded)} to ${y.students} student${y.students === 1 ? '' : 's'}.`);
  const used = s.byFund.filter((f) => f.awardedYear > 0).map((f) => `${f.fund}: ${usd(f.awardedYear)}`);
  if (used.length) lines.push(`By fund — ${used.join(' · ')}.`);
  const held = s.byFund.filter((f) => f.balance > 0).reduce((n, f) => n + f.balance, 0);
  if (held) lines.push(`${usd(held)} is held for future awards.`);
  lines.push('Every award is decided by our review team using the criteria above. Students’ names are never shared without their permission.');
  return lines.join('\n\n');
}
