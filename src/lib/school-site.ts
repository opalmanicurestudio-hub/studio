// src/lib/school-site.ts
//
// THE SCHOOL WEBSITE — /school/{tenantId}. Built from the school's real
// records on every visit, so costs, hours, dates and places left can never
// disagree with what the school charges and teaches.
//
//   tenants/{t}/schoolSite/main        the owner's words and choices (below)
//   tenants/{t}/schoolSite/img_{id}    a photo { dataUrl } (served by
//                                      /api/school/image)
//   tenants/{t}/websiteMessages/{id}   questions that aren't admissions
//                                      (donors, sponsors, general)
//
// Works WITH what already exists — nothing is duplicated:
//   Tours       the business's ONE tour calendar (tenants/{t}/tours, the same
//               schedule + clash check as booth tours; planner shows both).
//               A school tour lands in Admissions (stage "tour").
//   Inquiries   → Admissions (stage "inquiry"). Other questions → the inbox.
//   Clinic      the services linked to programs → the booking page
//               (/book/{t}?service=…) where students are bookable providers.
//   Careers     open job listings → the hiring funnel (/apply/{t}?job=…).
//   Apply       the admissions apply page (/learn/{t}/apply?program=…).
//   Identity    logo / name / licence from School identity.

import { getAdminDb } from '@/lib/firebase-admin';
import { getIdentity } from '@/lib/school-identity';
import { setupOf, SEAT_STAGES } from '@/lib/academy-decisions';
import { DEFAULT_DOCS } from '@/lib/academy-admissions';
import { mediaUrl } from '@/lib/academy';

export const usd = (c: number) => `$${(Math.round(c) / 100).toLocaleString('en-US', { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;

export interface CostLine { label: string; cents: number; note?: string }
export interface SiteSettings {
  published: boolean;
  headline: string; message: string; heroPhotoId: string | null;
  photos: { id: string; caption: string }[];
  whyUs: { title: string; text: string }[];
  stories: { name: string; program: string; year: string; quote: string; photoId: string | null }[];
  faq: { q: string; a: string }[];
  programExtras: Record<string, { examFees: CostLine[]; otherCosts: CostLine[]; licensing: string; schedule: string }>;
  scholarships: { name: string; amountCents: number; description: string; eligibility: string; deadline: string; fund: string }[];
  outsideScholarships: { name: string; url: string; amount: string; notes: string; lastChecked: string }[];
  workforce: { show: boolean; text: string };
  donors: { enabled: boolean; nonprofit: boolean; ein: string; funds: { name: string; text: string }[]; howAwarded: string; useReport: string };
  contact: { respondHours: number; hoursText: string; textOk: boolean };
  location: { directions: string; parking: string };
  social: { instagram: string; facebook: string; tiktok: string };
  disclosures: string;
}

export const DEFAULT_FAQ = [
  { q: 'Does applying mean I’m accepted?', a: 'No. Applying starts the process. Our admissions team reviews every application — documents, requirements and sometimes a short interview — and emails you a decision.' },
  { q: 'Can I visit before I apply?', a: 'Yes — book a tour and see the classroom and student clinic, meet instructors and ask anything.' },
  { q: 'Is there a payment plan?', a: 'Most programs have one: a down payment, then automatic payments. Each program page shows the exact amounts.' },
  { q: 'What happens after I graduate?', a: 'You’ll be eligible to sit your state board exam. We help you prepare and send the hours certification the board needs.' },
];
export function defaults(): SiteSettings {
  return {
    published: false, headline: '', message: '', heroPhotoId: null, photos: [], whyUs: [], stories: [], faq: DEFAULT_FAQ, programExtras: {},
    scholarships: [], outsideScholarships: [], workforce: { show: false, text: 'Some students qualify for workforce funding (for example through your local workforce board). Eligibility varies and funding isn’t guaranteed — we’re happy to help you find out what you may qualify for.' },
    donors: { enabled: false, nonprofit: false, ein: '', funds: [{ name: 'Tuition help', text: 'Helps a student with tuition.' }, { name: 'Student kits', text: 'Buys the professional kit a student needs.' }, { name: 'Exam fees', text: 'Covers state board exam fees.' }, { name: 'Emergency fund', text: 'Small grants for emergencies that could stop a student finishing.' }], howAwarded: '', useReport: '' },
    contact: { respondHours: 24, hoursText: '', textOk: true }, location: { directions: '', parking: '' }, social: { instagram: '', facebook: '', tiktok: '' }, disclosures: '',
  };
}

const s = (v: any, n: number) => String(v ?? '').trim().slice(0, n);
const cents = (v: any) => Math.max(0, Math.min(10_000_000, Math.round(Number(v) || 0)));
const lines = (a: any, n = 8): CostLine[] => (Array.isArray(a) ? a : []).map((x: any) => ({ label: s(x.label, 80), cents: cents(x.cents), note: s(x.note, 120) || undefined })).filter((x) => x.label).slice(0, n);
/** Clean everything the owner sends. */
export function sanitize(b: any): SiteSettings {
  const d = defaults(); const x = b || {};
  const pe: SiteSettings['programExtras'] = {};
  for (const [k, v] of Object.entries(x.programExtras || {}).slice(0, 30)) { const w: any = v || {}; pe[s(k, 40)] = { examFees: lines(w.examFees), otherCosts: lines(w.otherCosts), licensing: s(w.licensing, 1500), schedule: s(w.schedule, 400) }; }
  return {
    published: !!x.published, headline: s(x.headline, 140), message: s(x.message, 1500), heroPhotoId: x.heroPhotoId ? s(x.heroPhotoId, 40) : null,
    photos: (x.photos || []).map((p: any) => ({ id: s(p.id, 40), caption: s(p.caption, 140) })).filter((p: any) => p.id).slice(0, 24),
    whyUs: (x.whyUs || []).map((w: any) => ({ title: s(w.title, 60), text: s(w.text, 300) })).filter((w: any) => w.title).slice(0, 6),
    stories: (x.stories || []).map((w: any) => ({ name: s(w.name, 60), program: s(w.program, 80), year: s(w.year, 10), quote: s(w.quote, 800), photoId: w.photoId ? s(w.photoId, 40) : null })).filter((w: any) => w.name && w.quote).slice(0, 12),
    faq: Array.isArray(x.faq) ? x.faq.map((f: any) => ({ q: s(f.q, 200), a: s(f.a, 1500) })).filter((f: any) => f.q && f.a).slice(0, 20) : d.faq,
    programExtras: pe,
    scholarships: (x.scholarships || []).map((w: any) => ({ name: s(w.name, 100), amountCents: cents(w.amountCents), description: s(w.description, 800), eligibility: s(w.eligibility, 600), deadline: s(w.deadline, 10), fund: s(w.fund, 60) })).filter((w: any) => w.name).slice(0, 12),
    outsideScholarships: (x.outsideScholarships || []).map((w: any) => ({ name: s(w.name, 120), url: /^https?:\/\//.test(String(w.url || '')) ? s(w.url, 400) : '', amount: s(w.amount, 60), notes: s(w.notes, 400), lastChecked: s(w.lastChecked, 10) })).filter((w: any) => w.name).slice(0, 20),
    workforce: { show: !!x.workforce?.show, text: s(x.workforce?.text, 1500) || d.workforce.text },
    donors: { enabled: !!x.donors?.enabled, nonprofit: !!x.donors?.nonprofit, ein: s(x.donors?.ein, 20), funds: (x.donors?.funds || d.donors.funds).map((f: any) => ({ name: s(f.name, 60), text: s(f.text, 300) })).filter((f: any) => f.name).slice(0, 8), howAwarded: s(x.donors?.howAwarded, 1500), useReport: s(x.donors?.useReport, 2000) },
    contact: { respondHours: Math.max(1, Math.min(168, Math.round(Number(x.contact?.respondHours) || 24))), hoursText: s(x.contact?.hoursText, 300), textOk: x.contact?.textOk !== false },
    location: { directions: s(x.location?.directions, 600), parking: s(x.location?.parking, 300) },
    social: { instagram: s(x.social?.instagram, 200), facebook: s(x.social?.facebook, 200), tiktok: s(x.social?.tiktok, 200) },
    disclosures: s(x.disclosures, 8000),
  };
}
export async function getSettings(tenantId: string): Promise<SiteSettings> {
  const m = ((await getAdminDb().doc(`tenants/${tenantId}/schoolSite/main`).get()).data() as any) || null;
  return m ? { ...defaults(), ...sanitize(m), published: !!m.published } : defaults();
}
export const imgUrl = (tenantId: string, id: string | null | undefined) => (id ? `/api/school/image?t=${encodeURIComponent(tenantId)}&id=${encodeURIComponent(id)}` : null);

/** The full cost of a program — every line, and the total. */
export function costOf(p: any, extras?: { examFees: CostLine[]; otherCosts: CostLine[] }) {
  const t = p?.tuition || {};
  const school: CostLine[] = [
    { label: 'Tuition', cents: t.tuitionCents || 0 },
    ...(t.registrationFeeCents ? [{ label: 'Registration fee', cents: t.registrationFeeCents, note: 'Paid to the school' }] : []),
    ...(t.kitCents ? [{ label: 'Kit and supplies', cents: t.kitCents }] : []),
    ...(extras?.otherCosts || []),
  ].filter((l) => l.cents > 0 || l.label === 'Tuition');
  const exam = extras?.examFees || [];
  const schoolTotal = school.reduce((n, l) => n + l.cents, 0); const examTotal = exam.reduce((n, l) => n + l.cents, 0);
  const plan = t.installments && t.downPaymentCents != null ? (() => {
    const payable = (t.tuitionCents || 0) + (t.registrationFeeCents || 0) + (t.kitCents || 0);
    const rest = Math.max(0, payable - (t.downPaymentCents || 0));
    return { downCents: t.downPaymentCents || 0, count: t.installments, eachCents: Math.ceil(rest / t.installments), interval: t.interval === 'biweekly' ? 'every two weeks' : 'a month' };
  })() : null;
  return { school, exam, schoolTotal, examTotal, total: schoolTotal + examTotal, plan, hasPrice: !!t.tuitionCents };
}

/** Everything the site shows, gathered from real records. */
export async function loadSchoolSite(tenantId: string) {
  const db = getAdminDb(); const T = `tenants/${tenantId}`;
  const tSnap = await db.doc(T).get(); if (!tSnap.exists) return null;
  const t = tSnap.data() as any;
  if (t.modules?.academy === false) return null;
  const [settings, id, progS, cohS, staffS, jobsS, svcS, courseS] = await Promise.all([
    getSettings(tenantId), getIdentity(tenantId, t, { forPublic: true }),
    db.collection(`${T}/programs`).limit(50).get(), db.collection(`${T}/cohorts`).limit(200).get(),
    db.collection(`${T}/staff`).limit(300).get(), db.collection(`${T}/jobListings`).limit(50).get().catch(() => ({ docs: [] as any[] })),
    db.collection(`${T}/services`).limit(500).get(), db.collection(`${T}/courses`).where('status', '==', 'published').limit(100).get().catch(() => ({ docs: [] as any[] })),
  ]);
  const services = new Map(svcS.docs.map((d: any) => [d.id, { id: d.id, ...(d.data() as any) }]));
  const courses = new Map(courseS.docs.map((d: any) => [d.id, { id: d.id, ...(d.data() as any) }]));
  // Places taken per cohort (offers, accepted, signed, enrolled)
  const adm = await db.collection(`${T}/admissions`).where('stage', 'in', SEAT_STAGES).limit(3000).get().catch(() => ({ docs: [] as any[] }));
  const taken = new Map<string, number>(); for (const d of adm.docs) { const c = (d.data() as any).cohortId; if (c) taken.set(c, (taken.get(c) || 0) + 1); }
  const today = new Date().toISOString().slice(0, 10);
  const cohorts = cohS.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) })).filter((c: any) => !c.startDate || c.startDate >= today)
    .map((c: any) => ({ id: c.id, programId: c.programId, name: c.name, startDate: c.startDate || null, schedule: c.schedule || '', capacity: c.capacity || null, seatsLeft: c.capacity ? Math.max(0, c.capacity - (taken.get(c.id) || 0)) : null }))
    .sort((a: any, b: any) => String(a.startDate || '9').localeCompare(String(b.startDate || '9')));
  // Curriculum outline: each linked course's module names, in lesson order.
  const linked = [...new Set(progS.docs.flatMap((d: any) => ((d.data() as any).courseIds || []) as string[]))].filter((cid) => courses.has(cid)).slice(0, 20);
  const moduleNames = new Map<string, string[]>();
  await Promise.all(linked.map(async (cid) => {
    const ls = await db.collection(`${T}/courses/${cid}/lessons`).limit(400).get().catch(() => ({ docs: [] as any[] }));
    const rows = ls.docs.map((d: any) => d.data() as any).sort((a: any, b: any) => (a.order ?? 0) - (b.order ?? 0));
    moduleNames.set(cid, [...new Set(rows.map((l: any) => String(l.moduleTitle || '').trim()).filter(Boolean))].slice(0, 24) as string[]);
  }));
  const programs = progS.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) })).filter((p: any) => p.status !== 'archived' && p.name).map((p: any) => {
    const extras = settings.programExtras[p.id] || { examFees: [], otherCosts: [], licensing: '', schedule: '' };
    const clinicIds = [...new Set((p.requirements || []).flatMap((r: any) => r.serviceIds || []))] as string[];
    return {
      id: p.id, name: p.name, description: p.description || '', totalHours: p.totalHours || null, hoursPerWeek: p.scheduledHoursPerWeek || null,
      weeks: p.totalHours && p.scheduledHoursPerWeek ? Math.ceil(p.totalHours / p.scheduledHoursPerWeek) : null,
      requirements: (p.requirements || []).map((r: any) => ({ label: String(r.label), count: Number(r.count) || 0 })).filter((r: any) => r.count) as { label: string; count: number }[],
      clinic: clinicIds.map((sid) => services.get(sid)).filter((x: any) => x && x.isActive !== false).map((x: any) => ({ id: x.id, name: x.name, price: Number(x.price) || 0, duration: Number(x.duration) || null })),
      curriculum: (p.courseIds || []).map((cid: string) => courses.get(cid)).filter(Boolean).map((c: any) => ({ title: String(c.title || ''), summary: String(c.description || c.summary || ''), modules: moduleNames.get(c.id) || [] })) as { title: string; summary: string; modules: string[] }[],
      requiredDocs: (p.requiredDocs?.length ? p.requiredDocs : DEFAULT_DOCS) as string[], checks: setupOf(p).checks as string[],
      costs: costOf(p, extras), licensing: extras.licensing, schedule: extras.schedule,
      cohorts: cohorts.filter((c: any) => c.programId === p.id),
    };
  });
  const staff = staffS.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) }));
  const instructors = staff.filter((m: any) => !m.isStudent && !m.archived && m.active !== false && (String(m.role || '').toLowerCase() === 'instructor' || m.isInstructor) )
    .map((m: any) => ({ id: m.id, name: m.name, title: m.title || m.jobTitle || 'Instructor', bio: m.bio || '', photo: m.avatarUrl || m.photoURL || null, bookable: m.showOnPublicPage !== false }));
  const jobs = jobsS.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) })).filter((j: any) => j.status === 'open')
    .map((j: any) => ({ id: j.id, title: j.title, description: j.description || '', pay: j.pay || '', schedule: j.schedule || '', requirements: j.requirements || '' }));
  return {
    tenantId, settings, identity: id,
    name: id.displayName || t.name || 'Our school', color: t.bookingPageSettings?.cfPageConfig?.accentColor || t.bookingPageSettings?.primaryColor || '#7c3aed',
    address: id.address || '', phone: id.phone || '', email: id.email || '', programs, cohorts, instructors, jobs,
    hasOnlineCourses: courseS.docs.length > 0, logoUrl: id.logoUrl,
    canGive: !!t.stripeAccountId,
  };
}
export type SchoolSite = NonNullable<Awaited<ReturnType<typeof loadSchoolSite>>>;

/** Student work: approved, student sharing on, AND featured by staff. */
export async function featuredWork(tenantId: string, max = 12) {
  const db = getAdminDb();
  const q = await db.collection(`tenants/${tenantId}/portfolio`).where('featured', '==', true).limit(60).get().catch(() => ({ docs: [] as any[] }));
  const out: any[] = [];
  for (const d of q.docs) {
    const x = d.data() as any; if (x.status !== 'approved') continue;
    const st = ((await db.doc(`tenants/${tenantId}/students/${x.studentId}`).get()).data() as any) || {};
    if (!st.portfolio?.on) continue;
    out.push({ id: d.id, service: x.service || '', by: String(st.portfolio?.displayName || st.name || '').split(' ')[0], before: x.before?.path ? await mediaUrl(x.before.path, 60) : null, after: x.after?.path ? await mediaUrl(x.after.path, 60) : null });
    if (out.length >= max) break;
  }
  return out;
}

// ── Tours: the business's ONE tour calendar ───────────────────────────────
// Same schedule (bookingPageSettings.automationRules) and the same
// tenants/{t}/tours records the booth tour page uses — so a school tour and a
// booth tour can never be booked into the same time. Keep these two rules in
// step with /api/booths/kiosk tour-slots / tour-book.
const TOUR_DEFAULTS = { toursEnabled: true, tourAutoConfirm: true, tourDurationMins: 30, tourDays: [1, 2, 3, 4, 5], tourWindowStart: '10:00', tourWindowEnd: '17:00', bookingLeadHours: 2, bookingHorizonDays: 60 };
export async function tourRules(tenantId: string) {
  const t = ((await getAdminDb().doc(`tenants/${tenantId}`).get()).data() as any) || {};
  return { ...TOUR_DEFAULTS, ...(t.bookingPageSettings?.automationRules || {}) };
}
export async function tourSlots(tenantId: string, date: string) {
  const r = await tourRules(tenantId);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { slots: [], durationMins: r.tourDurationMins, autoConfirm: r.tourAutoConfirm !== false, off: false };
  if (!r.toursEnabled) return { slots: [], durationMins: r.tourDurationMins, autoConfirm: r.tourAutoConfirm !== false, off: true };
  const dow = new Date(date + 'T00:00:00Z').getUTCDay();
  if (!r.tourDays.includes(dow)) return { slots: [], durationMins: r.tourDurationMins, autoConfirm: r.tourAutoConfirm !== false, off: false };
  const toMin = (x: string) => { const [h, m] = x.split(':').map(Number); return h * 60 + m; }; const pad = (n: number) => String(n).padStart(2, '0');
  const dur = r.tourDurationMins || 30; const taken = new Set((await getAdminDb().collection(`tenants/${tenantId}/tours`).where('date', '==', date).get()).docs.map((d: any) => d.data() as any).filter((x: any) => ['requested', 'confirmed'].includes(x.status)).map((x: any) => x.time));
  const slots: string[] = []; const lead = (r.bookingLeadHours || 0) * 3600000;
  for (let m = toMin(r.tourWindowStart || '10:00'); m + dur <= toMin(r.tourWindowEnd || '17:00'); m += dur) {
    const hhmm = `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
    if (taken.has(hhmm)) continue; if (new Date(`${date}T${hhmm}:00`).getTime() - Date.now() < lead) continue;
    slots.push(hhmm);
  }
  return { slots, durationMins: dur, autoConfirm: r.tourAutoConfirm !== false, off: false };
}

/** Businesses and people who gave and asked to be thanked by name. */
export async function sponsorsList(tenantId: string, max = 40) {
  const q = await getAdminDb().collection(`tenants/${tenantId}/donations`).where('showName', '==', true).limit(300).get().catch(() => ({ docs: [] as any[] }));
  const names = q.docs.map((d: any) => d.data() as any).filter((g: any) => g.status === 'paid' && !g.anonymous).map((g: any) => String(g.business || g.name || '').trim()).filter(Boolean);
  return [...new Set(names)].slice(0, max) as string[];
}
