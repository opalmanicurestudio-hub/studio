// src/lib/school-docs.ts
//
// SCHOOL DOCUMENTS — tenants/{t}/schoolDocs/{id}
//   kinds    handbook · catalogue · policies (attendance, dress code, SAP, leave,
//            refunds, grievances, infection control, phones & social media) ·
//            syllabus (built from a course — no AI) · custom
//   draft    AI drafts handbooks/policies from the school's own facts, with
//            [[fill in]] markers where a detail is missing — the owner reviews
//   publish  versioned; if "students must sign", every student reads and signs
//            in the portal → tenants/{t}/docAcks/{docId}_{version}_{studentId}
//            (typed name, time, the text's fingerprint) → shown in the student file

import { createHash } from 'crypto';
import { getAdminDb } from '@/lib/firebase-admin';

export const DOC_KINDS: Record<string, { title: string; ack: boolean; ask: string }> = {
  handbook: { title: 'Student handbook', ack: true, ask: 'a complete student handbook: welcome, school mission, programs and hours, schedule and attendance, grading and satisfactory academic progress, conduct, dress code, infection control and safety, clinic floor rules, tuition and refunds (summarised, pointing to the refund policy), leave of absence, grievances, records and privacy, graduation and licensing, and acknowledgement' },
  catalogue: { title: 'School catalogue', ack: false, ask: 'a school catalogue: programs offered with hours and costs, admission requirements, calendar, facilities, staff, policies summary and contact details' },
  attendance: { title: 'Attendance policy', ack: true, ask: 'an attendance and tardiness policy, including how hours are recorded and verified, make-up hours, and consequences' },
  dress: { title: 'Dress code', ack: true, ask: 'a dress code and personal hygiene policy for a beauty school clinic floor, including name tags, closed-toe shoes and hair/nail standards' },
  sap: { title: 'Satisfactory academic progress policy', ack: true, ask: 'a satisfactory academic progress (SAP) policy: evaluation points, minimum attendance and grades, warning, probation, appeals and reinstatement' },
  leave: { title: 'Leave of absence policy', ack: true, ask: 'a leave of absence policy: how to request, documentation, maximum length, returning, and what happens if a student does not return' },
  refunds: { title: 'Refund and cancellation policy', ack: true, ask: 'a cancellation and refund policy for tuition, kits and fees' },
  grievance: { title: 'Grievance policy', ack: true, ask: 'a grievance and complaint procedure, with steps, timelines and how to reach the state licensing board' },
  safety: { title: 'Infection control and safety policy', ack: true, ask: 'an infection control, sanitation and safety policy: hand washing, cleaning and disinfection of implements and surfaces, blood exposure procedure, single-use items, chemical safety and emergencies' },
  phones: { title: 'Phones and social media policy', ack: true, ask: 'a phone, photo and social media policy, including client consent for photos and privacy of student records' },
  custom: { title: 'New document', ack: false, ask: '' },
};

/** The school's own facts, for AI drafts. */
export async function schoolFacts(tenantId: string) {
  const db = getAdminDb(); const T = `tenants/${tenantId}`;
  const [t, progs, courses] = await Promise.all([db.doc(T).get(), db.collection(`${T}/programs`).limit(50).get(), db.collection(`${T}/courses`).limit(100).get()]);
  const td = (t.data() as any) || {};
  const programs = progs.docs.map((d: any) => { const p = d.data() as any; return { name: p.name, hours: p.totalHours || null, state: p.state || null, rule: p.rule || null, passGrade: p.passGrade || 70, onlineMaxPct: p.limits?.onlineMaxPct ?? null, retention: p.retention || null, tuition: p.tuition || null }; });
  return { name: td.name || '[[school name]]', address: td.address || td.bookingPageSettings?.address || null, phone: td.phone || null, email: td.email || null, programs,
    courses: courses.docs.map((d: any) => (d.data() as any).title).filter(Boolean).slice(0, 30), grading: 'A 90–100 · B 80–89 · C 70–79 · F below 70' };
}

/** A syllabus built straight from the course (no AI): accurate and free. */
export async function syllabusFrom(tenantId: string, courseId: string) {
  const db = getAdminDb(); const T = `tenants/${tenantId}`;
  const c = ((await db.doc(`${T}/courses/${courseId}`).get()).data() as any) || {};
  const ls = (await db.collection(`${T}/courses/${courseId}/lessons`).orderBy('order').limit(500).get()).docs.map((d: any) => ({ id: d.id, ...(d.data() as any) }));
  const mods: { title: string; ls: any[] }[] = [];
  for (const l of ls) { const m = mods.find((x) => x.title === (l.moduleTitle || 'Module')); if (m) m.ls.push(l); else mods.push({ title: l.moduleTitle || 'Module', ls: [l] }); }
  const mins = (l: any) => Number(l.plan?.minutes) || Math.round((Number(l.durationSec) || 0) / 60) || Number(l.minMinutes) || 0;
  const total = ls.reduce((n, l) => n + mins(l), 0);
  const kind = (l: any) => l.kind === 'video' ? 'Video' : l.kind === 'assignment' ? 'Assignment' : l.kind === 'download' ? 'Download' : 'Reading';
  const out: string[] = [];
  out.push(`# ${c.title || 'Course'}`);
  if (c.subtitle) out.push(c.subtitle);
  out.push(`**Lessons:** ${ls.length}${total ? ` · **Approximate time:** ${Math.round(total / 6) / 10} hours` : ''}${c.instructorName ? ` · **Instructor:** ${c.instructorName}` : ''}`);
  if (c.description) { out.push('# About this course'); out.push(String(c.description).slice(0, 3000)); }
  if ((c.whatYouLearn || []).length) { out.push('# What you’ll learn'); for (const w of c.whatYouLearn) out.push(`- ${w}`); }
  out.push('# Course outline');
  mods.forEach((m, i) => {
    out.push(`## Module ${i + 1}: ${m.title}`);
    for (const l of m.ls) {
      const extras = [l.quiz?.questions?.length ? 'quiz' : '', l.kind === 'assignment' ? 'graded assignment' : '', (l.blocks || []).some((b: any) => b.type === 'game') ? 'game' : '', l.cases ? 'client cases' : ''].filter(Boolean);
      out.push(`- **${l.title}** — ${kind(l)}${mins(l) ? `, about ${mins(l)} min` : ''}${extras.length ? ` · ${extras.join(', ')}` : ''}`);
      for (const o of (l.plan?.objectives || []).slice(0, 4)) out.push(`- — ${o}`);
    }
  });
  const graded = ls.filter((l) => l.kind === 'assignment' || l.quiz?.questions?.length);
  out.push('# How you’re assessed');
  out.push(`Quizzes and assignments are graded on this scale: A 90–100 · B 80–89 · C 70–79 · F below 70. A passing grade is 70% or higher${c.compliance ? ', and verified learning time is recorded for your school' : ''}.`);
  if (graded.length) for (const l of graded) out.push(`- ${l.title} — ${l.kind === 'assignment' ? 'assignment (rubric-graded, returned with feedback)' : `quiz (pass mark ${l.quiz?.passPct || 80}%)`}`);
  const kit = ls.flatMap((l) => l.plan?.materials || []); const uniq = [...new Set(kit.map((x: string) => x.trim()).filter(Boolean))];
  if (uniq.length) { out.push('# What to bring'); for (const k of uniq.slice(0, 30)) out.push(`- ${k}`); }
  return { title: `Syllabus — ${c.title || 'Course'}`, body: out.join('\n\n').replace(/\n\n- /g, '\n- ') };
}

export const fingerprint = (text: string) => createHash('sha256').update(String(text || '')).digest('hex');
