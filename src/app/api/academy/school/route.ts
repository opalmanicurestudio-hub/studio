// src/app/api/academy/school/route.ts
//
// LICENSED-SCHOOL TOOLS.
//   overview        mode, programs, the business's services (for mapping)
//   mode            { mode: 'courses' | 'school' }                    owner/manager
//   program-save    { program }                                       owner/manager
//   program-enroll  { programId, email, name, startDate }             owner/manager
//   program-status  { enrollmentId, status, reason }                  owner/manager
//   roster          { programId? }   students, status, service counts
//   progress        { enrollmentId } hours + service requirements
//   clinic-queue    { date? }        student-salon appointments for a day
//   checkoff        { appointmentId, scores[], notes, photoBefore?, photoAfter?, redo? }
// Instructors can use roster, progress, clinic-queue and checkoff.

import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyStaffActor } from '@/lib/staff-auth';
import { appendAudit } from '@/lib/academy-compliance';
import { enrollInProgram, setProgramStatus, programProgress, keyOf, DEFAULT_RUBRIC, allServiceIds, setClinicServices, syncStudentServices } from '@/lib/academy-school';
import { BUILT_IN, customProgram, US_STATES } from '@/lib/state-rules';
import { savePrivateImage } from '@/lib/private-storage';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const tenantId = String(b.tenantId || '');
  const auth = await verifyStaffActor(req, tenantId);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  const isInstructor = String(auth.actor.role || '').toLowerCase() === 'instructor';
  const isLead = auth.actor.isManager || auth.actor.isTenantOwner;
  if (!isLead && !isInstructor) return NextResponse.json({ ok: false, error: 'Owners, managers and instructors only.' }, { status: 403 });
  const LEAD_ONLY = ['mode', 'program-save', 'program-enroll', 'program-status', 'program-from-template', 'program-from-custom'];
  if (!isLead && LEAD_ONLY.includes(String(b.action))) return NextResponse.json({ ok: false, error: 'Owners and managers only.' }, { status: 403 });
  const db = getAdminDb();
  const who = auth.actor.name || auth.actor.uid;
  const now = new Date().toISOString();

  try {
    if (b.action === 'overview') {
      const [t, progs, svcs] = await Promise.all([db.doc(`tenants/${tenantId}`).get(), db.collection(`tenants/${tenantId}/programs`).limit(100).get(), db.collection(`tenants/${tenantId}/services`).limit(500).get()]);
      return NextResponse.json({ ok: true, mode: ((t.data() as any)?.academy?.mode) || 'courses', defaultRubric: DEFAULT_RUBRIC,
        programs: progs.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) })),
        services: svcs.docs.map((d: any) => { const s = d.data() as any; return { id: d.id, name: s.name, price: s.price ?? null, duration: s.duration ?? s.durationMinutes ?? null, isActive: s.isActive !== false }; }).filter((s: any) => s.isActive).sort((a: any, c: any) => String(a.name).localeCompare(String(c.name))) });
    }

    // ── Home: what needs attention, in one call ──
    if (b.action === 'home') {
      const T = `tenants/${tenantId}`;
      const month = new Date(); month.setDate(1); month.setHours(0, 0, 0, 0);
      const today = new Date().toISOString().slice(0, 10);
      const tdoc = ((await db.doc(T).get()).data() as any) || {};
      const mode = tdoc.academy?.mode || 'courses';
      const [courses, enr] = await Promise.all([db.collection(`${T}/courses`).limit(300).get(), db.collection(`${T}/enrollments`).where('createdAt', '>=', month.toISOString()).limit(5000).get()]);
      const out: any = { mode, name: tdoc.name || '', courses: { total: courses.size, published: courses.docs.filter((d: any) => (d.data() as any).status === 'published').length },
        month: { enrolments: enr.size, revenueCents: enr.docs.reduce((n: number, d: any) => n + ((d.data() as any).paidCents || 0), 0) } };
      if (mode === 'school') {
        const [adm, att, risk, threads, plans, progs, students, appts, forms] = await Promise.all([
          isLead ? db.collection(`${T}/admissions`).limit(3000).get() : Promise.resolve(null),
          db.collection(`${T}/attendance`).where('status', 'in', ['open', 'flagged', 'pending']).limit(1000).get(),
          db.collection(`${T}/programEnrollments`).where('status', '==', 'active').limit(3000).get(),
          db.collection(`${T}/academyThreads`).limit(1000).get(),
          isLead ? db.collection(`${T}/tuitionPlans`).where('status', '==', 'past_due').limit(1000).get() : Promise.resolve(null),
          db.collection(`${T}/programs`).limit(100).get(),
          db.collection(`${T}/staff`).where('isStudent', '==', true).limit(2000).get(),
          db.collection(`${T}/appointments`).where('startTime', '>=', new Date(`${today}T00:00:00`).toISOString()).where('startTime', '<', new Date(new Date(`${today}T00:00:00`).getTime() + 86400000).toISOString()).limit(2000).get(),
          isLead ? db.collection(`${T}/boardForms`).where('status', '==', 'due').limit(500).get() : Promise.resolve(null),
        ]);
        const A = adm ? adm.docs.map((d: any) => d.data() as any) : [];
        const studentIds = new Set(students.docs.map((d: any) => d.id));
        const P = att.docs.map((d: any) => d.data() as any);
        const R = risk.docs.map((d: any) => d.data() as any);
        out.school = {
          programs: progs.size, activeStudents: R.length,
          newInquiries: A.filter((a: any) => a.stage === 'inquiry').length,
          docsToCheck: A.reduce((n: number, a: any) => n + Object.values(a.documents || {}).filter((x: any) => x.status === 'submitted').length, 0),
          toCountersign: A.filter((a: any) => a.agreement?.signedAt && !a.agreement?.countersignedBy).length,
          checkoffsToday: appts.docs.map((d: any) => d.data() as any).filter((a: any) => studentIds.has(a.staffId) && !a.clinicCheckoff?.signedOff && !['cancelled', 'declined', 'no_show'].includes(a.status)).length,
          onFloor: P.filter((p: any) => p.status === 'open').length, attendanceToFix: P.filter((p: any) => p.status === 'flagged' || p.status === 'pending').length,
          atRisk: R.filter((e: any) => e.risk?.level === 'high').length, watch: R.filter((e: any) => e.risk?.level === 'watch').length,
          unread: threads.docs.reduce((n: number, d: any) => n + ((d.data() as any).unreadSchool || 0), 0),
          tuitionLate: plans ? plans.size : null, isLead,
          formsDue: forms ? forms.docs.filter((x: any) => new Date((x.data() as any).dueAt).getTime() < Date.now() + 5 * 86400000).length : null,
        };
      }
      return NextResponse.json({ ok: true, ...out });
    }

    // ── Rotation: weekly duty rota for the student salon ──
    if (b.action === 'rotation-get' || b.action === 'rotation-save') {
      const week = /^\d{4}-\d{2}-\d{2}$/.test(String(b.week || '')) ? String(b.week) : (() => { const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.toISOString().slice(0, 10); })();
      const ref = db.doc(`tenants/${tenantId}/rotations/${week}`);
      if (b.action === 'rotation-save') {
        if (!isLead && !isInstructor) return NextResponse.json({ ok: false, error: 'Not allowed.' }, { status: 403 });
        const stations = (Array.isArray(b.stations) ? b.stations : []).map((x: any) => String(x).trim().slice(0, 40)).filter(Boolean).slice(0, 10);
        const days = (Array.isArray(b.days) ? b.days : []).filter((x: any) => ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].includes(x));
        const clean: any = {};
        for (const dk of days) { clean[dk] = {}; for (const st of stations) clean[dk][st] = ((b.assignments?.[dk]?.[st]) || []).map(String).slice(0, 30); }
        await ref.set({ week, stations, days, assignments: clean, published: !!b.publish, updatedAt: now, updatedBy: who }, { merge: false });
        if (b.publish) await appendAudit(tenantId, { type: 'rotation.published', by: who, summary: `Rotation for the week of ${week} published (${stations.length} stations, ${days.length} days)` });
        return NextResponse.json({ ok: true });
      }
      const [r, prev, stu] = await Promise.all([ref.get(), db.collection(`tenants/${tenantId}/rotations`).orderBy('week', 'desc').limit(1).get(),
        db.collection(`tenants/${tenantId}/programEnrollments`).where('status', '==', 'active').limit(1000).get()]);
      const last = prev.docs[0]?.data() as any;
      return NextResponse.json({ ok: true, week, rotation: r.exists ? r.data() : null,
        defaults: { stations: last?.stations || ['Clinic floor', 'Dispensary', 'Front desk', 'Sanitation'], days: last?.days || ['tue', 'wed', 'thu', 'fri', 'sat'] },
        students: stu.docs.map((d: any) => { const e = d.data() as any; return { id: e.studentId, name: e.name }; }).sort((a: any, c: any) => String(a.name).localeCompare(String(c.name))) });
    }

    // ── Approved devices for student records ──
    if (['devices', 'device-request', 'device-approve', 'device-remove', 'devices-setting'].includes(b.action)) {
      const col = db.collection(`tenants/${tenantId}/approvedDevices`);
      const id = String(b.deviceId || '').slice(0, 80);
      const owner = auth.actor.isTenantOwner;
      if (b.action === 'device-request') {
        if (!id) return NextResponse.json({ ok: false, error: 'No device id.' }, { status: 400 });
        const cur = ((await col.doc(id).get()).data() as any) || null;
        if (!cur) await col.doc(id).set({ id, name: String(b.name || 'Device').slice(0, 80), status: 'pending', requestedBy: who, requestedAt: now });
        return NextResponse.json({ ok: true, status: cur?.status || 'pending' });
      }
      if (b.action === 'devices') {
        const [list, t] = await Promise.all([col.limit(200).get(), db.doc(`tenants/${tenantId}`).get()]);
        const all = list.docs.map((d: any) => d.data() as any);
        return NextResponse.json({ ok: true, on: !!((t.data() as any)?.academy?.approvedDevicesOnly), isOwner: owner, devices: isLead ? all : [], mine: all.find((x: any) => x.id === id)?.status || 'unknown' });
      }
      if (!owner) return NextResponse.json({ ok: false, error: 'Only the owner can approve devices.' }, { status: 403 });
      if (b.action === 'device-approve') { await col.doc(id).set({ id, name: String(b.name || 'Device').slice(0, 80), status: 'approved', approvedBy: who, approvedAt: now }, { merge: true }); await appendAudit(tenantId, { type: 'device.approved', by: who, summary: `Device approved for student records: ${String(b.name || id)}` }); return NextResponse.json({ ok: true }); }
      if (b.action === 'device-remove') { await col.doc(id).set({ status: 'removed', removedBy: who, removedAt: now }, { merge: true }); await appendAudit(tenantId, { type: 'device.removed', by: who, summary: `Device removed from student records: ${id}` }); return NextResponse.json({ ok: true }); }
      if (b.action === 'devices-setting') {
        if (b.on) { const mine = ((await col.doc(id).get()).data() as any) || null; if (mine?.status !== 'approved') await col.doc(id).set({ id, name: String(b.name || 'Owner device').slice(0, 80), status: 'approved', approvedBy: who, approvedAt: now }, { merge: true }); }
        await db.doc(`tenants/${tenantId}`).set({ academy: { approvedDevicesOnly: !!b.on } }, { merge: true });
        await appendAudit(tenantId, { type: 'settings.changed', by: who, summary: `Student records ${b.on ? 'limited to approved devices' : 'open on any signed-in device'}` });
        return NextResponse.json({ ok: true });
      }
    }

    if (b.action === 'mode') {
      const mode = b.mode === 'school' ? 'school' : 'courses';
      await db.doc(`tenants/${tenantId}`).set({ academy: { mode } }, { merge: true });
      await appendAudit(tenantId, { type: 'settings.changed', by: who, summary: `Academy mode: ${mode === 'school' ? 'Licensed school' : 'Online courses'}` });
      return NextResponse.json({ ok: true, mode });
    }

    // ── State templates (North Carolina, 21 NCAC 14T) ──
    if (b.action === 'templates') return NextResponse.json({ ok: true, states: US_STATES, templates: BUILT_IN.map((x) => ({ key: `${x.state}:${x.discipline}`, state: x.state, name: x.name, totalHours: x.totalHours, rule: x.rule, checkedAt: x.checkedAt, evaluations: x.evaluations.length, performances: x.performances.length })) });
    // "Set up for my state" — the school enters its own state's rules.
    if (b.action === 'program-from-custom') {
      const c = customProgram(b.custom || {});
      if (!c.totalHours) return NextResponse.json({ ok: false, error: 'Enter the total hours your state requires.' }, { status: 400 });
      const ref = db.collection(`tenants/${tenantId}/programs`).doc();
      await ref.set({ id: ref.id, ...c, requirements: c.performances.map((x) => ({ key: x.key, label: x.label, count: 1, serviceIds: [] })), rubric: DEFAULT_RUBRIC, courseIds: [], tipPolicy: 'school',
        sap: { checkpoints: [Math.round(c.totalHours / 2), c.totalHours], minAttendancePct: 67, minQuizAvg: c.passGrade, minPracticalAvg: 3 }, status: 'active', createdAt: now, updatedAt: now, fromTemplate: 'custom' });
      await appendAudit(tenantId, { type: 'program.saved', by: who, summary: `Program “${c.name}” set up from ${c.state ? US_STATES[c.state] : 'custom'} rules${c.rule ? ` (${c.rule})` : ''}`, data: { programId: ref.id } });
      return NextResponse.json({ ok: true, id: ref.id });
    }
    if (b.action === 'program-from-template') {
      const tp = BUILT_IN.find((x) => `${x.state}:${x.discipline}` === b.key);
      if (!tp) return NextResponse.json({ ok: false, error: 'Unknown template.' }, { status: 400 });
      const ref = db.collection(`tenants/${tenantId}/programs`).doc();
      await ref.set({ id: ref.id, name: tp.name, state: tp.state, discipline: tp.discipline, rule: tp.rule, totalHours: tp.totalHours, requiredOnlineHours: null, requiredInPersonHours: null,
        limits: tp.limits, passGrade: tp.passGrade, weeklyGuidedMinPct: tp.weeklyGuidedMinPct, evaluations: tp.evaluations,
        requirements: tp.performances.map((x) => ({ key: x.key, label: x.label, count: 1, serviceIds: [] })), rubric: DEFAULT_RUBRIC, courseIds: [], tipPolicy: 'school',
        requiredDocs: tp.requiredDocs, boardForms: tp.boardForms, retention: tp.retention, checkedAt: tp.checkedAt, sap: { checkpoints: [Math.round(tp.totalHours / 2), tp.totalHours], minAttendancePct: 67, minQuizAvg: tp.passGrade, minPracticalAvg: 3 },
        status: 'active', createdAt: now, updatedAt: now, fromTemplate: `${tp.state}:${tp.discipline}` });
      await appendAudit(tenantId, { type: 'program.saved', by: who, summary: `Program “${tp.name}” created from the North Carolina template (${tp.rule})`, data: { programId: ref.id } });
      return NextResponse.json({ ok: true, id: ref.id });
    }

    if (b.action === 'program-save') {
      const p = b.program || {};
      const name = String(p.name || '').trim().slice(0, 120);
      if (!name) return NextResponse.json({ ok: false, error: 'Name the program.' }, { status: 400 });
      const ref = p.id ? db.doc(`tenants/${tenantId}/programs/${String(p.id)}`) : db.collection(`tenants/${tenantId}/programs`).doc();
      const cur = ((await ref.get()).data() as any) || {};
      const requirements = (Array.isArray(p.requirements) ? p.requirements : []).slice(0, 60).map((r: any) => ({ key: keyOf(r.key || r.label), label: String(r.label || '').slice(0, 80), count: Math.max(0, Math.min(10000, Number(r.count) || 0)), serviceIds: (r.serviceIds || []).map(String).slice(0, 30) })).filter((r: any) => r.label);
      const rubric = p.rubric?.criteria?.length ? { criteria: p.rubric.criteria.map((c: any) => ({ label: String(c.label || '').slice(0, 80) })).filter((c: any) => c.label).slice(0, 12), passAvg: Math.max(1, Math.min(5, Number(p.rubric.passAvg) || 3)) } : (cur.rubric || DEFAULT_RUBRIC);
      const next = { id: ref.id, name, totalHours: Math.max(0, Number(p.totalHours) || 0) || null, requiredOnlineHours: Math.max(0, Number(p.requiredOnlineHours) || 0) || null, requiredInPersonHours: Math.max(0, Number(p.requiredInPersonHours) || 0) || null,
        requirements, rubric, courseIds: (p.courseIds || []).map(String).slice(0, 30),
        // Admissions & tuition (all optional): what applicants upload, what they sign, what it costs.
        description: String(p.description || '').slice(0, 2000) || null,
        scheduledHoursPerWeek: Math.max(0, Math.min(80, Number(p.scheduledHoursPerWeek) || 0)) || null,
        sap: p.sap ? { checkpoints: String(p.sap.checkpoints ?? '').split(/[ ,]+/).map(Number).filter((n: number) => n > 0).sort((a: number, c: number) => a - c).slice(0, 20),
          minAttendancePct: Math.max(0, Math.min(100, Number(p.sap.minAttendancePct) || 0)), minQuizAvg: Math.max(0, Math.min(100, Number(p.sap.minQuizAvg) || 0)), minPracticalAvg: Math.max(0, Math.min(5, Number(p.sap.minPracticalAvg) || 0)) } : (cur.sap || null),
        requiredDocs: (Array.isArray(p.requiredDocs) ? p.requiredDocs : []).map((x: any) => String(x).trim().slice(0, 80)).filter(Boolean).slice(0, 12),
        agreementTemplate: String(p.agreementTemplate || '').slice(0, 20000) || null,
        tuition: p.tuition ? { tuitionCents: Math.max(0, Math.round(Number(p.tuition.tuitionCents) || 0)), registrationFeeCents: Math.max(0, Math.round(Number(p.tuition.registrationFeeCents) || 0)), kitCents: Math.max(0, Math.round(Number(p.tuition.kitCents) || 0)),
          downPaymentCents: Math.max(0, Math.round(Number(p.tuition.downPaymentCents) || 0)), installments: Math.max(0, Math.min(60, Math.round(Number(p.tuition.installments) || 0))), interval: p.tuition.interval === 'biweekly' ? 'biweekly' : 'month' } : (cur.tuition || null),
        refundPolicy: p.refundPolicy?.tiers?.length ? { cancelDays: Math.max(0, Number(p.refundPolicy.cancelDays) || 0), registrationNonRefundable: !!p.refundPolicy.registrationNonRefundable, kitNonRefundable: !!p.refundPolicy.kitNonRefundable,
          tiers: p.refundPolicy.tiers.map((x: any) => ({ upToPct: Math.max(0, Math.min(100, Number(x.upToPct) || 0)), keepPct: Math.max(0, Math.min(100, Number(x.keepPct) || 0)) })).sort((a: any, c: any) => a.upToPct - c.upToPct) } : (cur.refundPolicy || null), tipPolicy: ['student', 'school', 'none'].includes(p.tipPolicy) ? p.tipPolicy : 'school',
        status: p.status === 'archived' ? 'archived' : 'active', createdAt: cur.createdAt || now, updatedAt: now,
        // State rules (from a template) — kept, and editable per the school's approved curriculum.
        ...(Array.isArray(p.evaluations) ? { evaluations: p.evaluations.map((x: any) => ({ key: String(x.key || keyOf(x.label)).slice(0, 60), label: String(x.label || '').slice(0, 160), passPct: Math.max(0, Math.min(100, Number(x.passPct) || 70)), infection: !!x.infection, gates: (x.gates || []).map(String).slice(0, 30) })).filter((x: any) => x.label) } : {}),
        ...(p.limits ? { limits: { onlineMaxPct: Math.max(0, Math.min(100, Number(p.limits.onlineMaxPct) || 0)), dailyCapHours: Math.max(1, Math.min(24, Number(p.limits.dailyCapHours) || 10)), weeklyCapHours: Math.max(1, Math.min(168, Number(p.limits.weeklyCapHours) || 48)), quarterHour: true, fieldTripMaxHours: Math.max(0, Number(p.limits.fieldTripMaxHours) || 0), internshipMaxPct: Math.max(0, Number(p.limits.internshipMaxPct) || 0) } } : {}),
        ...(p.passGrade != null ? { passGrade: Math.max(0, Math.min(100, Number(p.passGrade) || 70)) } : {}) };
      await ref.set(next, { merge: true });
      // Keep active students on the clinic services this program now uses.
      const added = allServiceIds(next).filter((x) => !allServiceIds(cur).includes(x)), removed = allServiceIds(cur).filter((x) => !allServiceIds(next).includes(x));
      if (cur.tipPolicy !== next.tipPolicy) {
        const act = await db.collection(`tenants/${tenantId}/programEnrollments`).where('programId', '==', ref.id).limit(2000).get();
        for (const d of act.docs) { const e = d.data() as any; if (e.staffId) await db.doc(`tenants/${tenantId}/staff/${e.staffId}`).set({ tipPolicy: next.tipPolicy }, { merge: true }); }
      }
      // Re-check every active student's cleared services against the updated program.
      const saved = { ...cur, ...next };
      const act = await db.collection(`tenants/${tenantId}/programEnrollments`).where('programId', '==', ref.id).where('status', '==', 'active').limit(1000).get();
      for (const d of act.docs) await syncStudentServices(tenantId, saved, d.data() as any);
      for (const sid of removed) { for (const d of act.docs) await setClinicServices(tenantId, (d.data() as any).staffId, [sid], false); }
      void added;
      await appendAudit(tenantId, { type: 'program.saved', by: who, summary: `Program “${name}”: ${next.totalHours || '—'} h, ${requirements.length} service requirements`, data: { programId: ref.id } });
      return NextResponse.json({ ok: true, id: ref.id });
    }

    if (b.action === 'program-enroll') {
      const email = String(b.email || '').trim().toLowerCase(), name = String(b.name || '').trim().slice(0, 80);
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !name) return NextResponse.json({ ok: false, error: 'A name and email are needed.' }, { status: 400 });
      const r = await enrollInProgram({ tenantId, programId: String(b.programId || ''), email, name, startDate: b.startDate || null, by: who });
      return NextResponse.json({ ok: true, ...r });
    }

    if (b.action === 'program-status') {
      const status = ['active', 'loa', 'withdrawn', 'graduated'].includes(b.status) ? b.status : null;
      if (!status) return NextResponse.json({ ok: false, error: 'Unknown status.' }, { status: 400 });
      if (['loa', 'withdrawn'].includes(status) && !String(b.reason || '').trim()) return NextResponse.json({ ok: false, error: 'A reason is required — it’s kept on the record.' }, { status: 400 });
      await setProgramStatus({ tenantId, enrollmentId: String(b.enrollmentId || ''), status, reason: String(b.reason || '').slice(0, 300), by: who });
      return NextResponse.json({ ok: true });
    }

    if (b.action === 'roster') {
      let q: any = db.collection(`tenants/${tenantId}/programEnrollments`);
      if (b.programId) q = q.where('programId', '==', String(b.programId));
      const s = await q.limit(1000).get();
      return NextResponse.json({ ok: true, students: s.docs.map((d: any) => { const e = d.data() as any; return { id: d.id, programId: e.programId, studentId: e.studentId, staffId: e.staffId, name: e.name, email: e.email, status: e.status, startDate: e.startDate, serviceCounts: e.serviceCounts || {}, checkoffs: e.checkoffs || 0 }; }).sort((a: any, c: any) => String(a.name).localeCompare(String(c.name))) });
    }

    if (b.action === 'progress') return NextResponse.json({ ok: true, progress: await programProgress(tenantId, String(b.enrollmentId || '')) });

    if (b.action === 'clinic-queue') {
      const day = /^\d{4}-\d{2}-\d{2}$/.test(String(b.date || '')) ? String(b.date) : new Date().toISOString().slice(0, 10);
      const from = new Date(`${day}T00:00:00`).toISOString(), to = new Date(new Date(`${day}T00:00:00`).getTime() + 36 * 3600000).toISOString();
      const [students, appts, svcs] = await Promise.all([
        db.collection(`tenants/${tenantId}/staff`).where('isStudent', '==', true).limit(1000).get(),
        db.collection(`tenants/${tenantId}/appointments`).where('startTime', '>=', from).where('startTime', '<', to).limit(2000).get(),
        db.collection(`tenants/${tenantId}/services`).limit(500).get(),
      ]);
      const studentIds = new Map(students.docs.map((d: any) => [d.id, d.data() as any]));
      const svcName = new Map(svcs.docs.map((d: any) => [d.id, (d.data() as any).name]));
      const queue = appts.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) })).filter((a: any) => studentIds.has(a.staffId) && !['cancelled', 'declined', 'no_show'].includes(a.status))
        .map((a: any) => ({ id: a.id, startTime: a.startTime, status: a.status, clientName: a.clientName || null, serviceId: a.serviceId, serviceName: a.serviceName || svcName.get(a.serviceId) || 'Service', staffId: a.staffId, studentName: studentIds.get(a.staffId)?.name, programId: studentIds.get(a.staffId)?.programId || null, checkoff: a.clinicCheckoff || null }))
        .sort((a: any, c: any) => String(a.startTime).localeCompare(String(c.startTime)));
      return NextResponse.json({ ok: true, day, queue });
    }

    if (b.action === 'checkoff') {
      const aRef = db.doc(`tenants/${tenantId}/appointments/${String(b.appointmentId || '')}`);
      const a = ((await aRef.get()).data() as any) || null;
      if (!a) return NextResponse.json({ ok: false, error: 'Appointment not found.' }, { status: 404 });
      if (a.clinicCheckoff?.signedOff) return NextResponse.json({ ok: false, error: `Already signed off by ${a.clinicCheckoff.by}.` }, { status: 400 });
      const st = ((await db.doc(`tenants/${tenantId}/staff/${a.staffId}`).get()).data() as any) || {};
      if (!st.isStudent) return NextResponse.json({ ok: false, error: 'This appointment isn’t with a student.' }, { status: 400 });
      const enrRef = db.doc(`tenants/${tenantId}/programEnrollments/${st.programId}_${st.studentId}`);
      const p = ((await db.doc(`tenants/${tenantId}/programs/${st.programId}`).get()).data() as any) || {};
      const rubric = p.rubric || DEFAULT_RUBRIC;
      const scores: number[] = (Array.isArray(b.scores) ? b.scores : []).slice(0, rubric.criteria.length).map((x: any) => Math.max(1, Math.min(5, Math.round(Number(x) || 0))));
      if (scores.length !== rubric.criteria.length) return NextResponse.json({ ok: false, error: 'Score every criterion.' }, { status: 400 });
      const avg = Math.round((scores.reduce((n, x) => n + x, 0) / scores.length) * 10) / 10;
      const passed = !b.redo && avg >= rubric.passAvg;
      const req = (p.requirements || []).find((r: any) => (r.serviceIds || []).includes(a.serviceId)) || null;
      const photos: any = {};
      for (const k of ['photoBefore', 'photoAfter'] as const) if (b[k]) { try { photos[k] = await savePrivateImage(tenantId, `tenants/${tenantId}/academy/clinic/${aRef.id}-${k === 'photoBefore' ? 'before' : 'after'}.jpg`, String(b[k])); } catch (e: any) { return NextResponse.json({ ok: false, error: String(e?.message || 'Photo upload failed.') }, { status: 400 }); } }
      const record = { appointmentId: aRef.id, studentId: st.studentId, staffId: a.staffId, programId: st.programId, serviceId: a.serviceId, requirementKey: req?.key || null,
        criteria: rubric.criteria.map((c: any, i: number) => ({ label: c.label, score: scores[i] })), avg, passAvg: rubric.passAvg, passed, redo: !!b.redo, notes: String(b.notes || '').slice(0, 1000) || null,
        photoBefore: photos.photoBefore?.ref || null, photoAfter: photos.photoAfter?.ref || null, by: who, byUid: auth.actor.uid, at: now };
      await db.doc(`tenants/${tenantId}/clinicCheckoffs/${aRef.id}`).set(record);
      await aRef.set({ clinicCheckoff: { signedOff: true, passed, avg, by: who, at: now, requirementKey: req?.key || null } }, { merge: true });
      if (passed && req) await enrRef.set({ serviceCounts: { [req.key]: FieldValue.increment(1) }, checkoffs: FieldValue.increment(1) }, { merge: true });
      else await enrRef.set({ checkoffs: FieldValue.increment(1) }, { merge: true });
      await appendAudit(tenantId, { type: passed ? 'clinic.passed' : 'clinic.redo', studentId: st.studentId, by: who,
        summary: `${st.name}: ${a.serviceName || 'service'} for ${a.clientName || 'client'} — ${avg}/5 ${passed ? `passed${req ? ` · counts toward ${req.label}` : ' (not a required service)'}` : 'needs redo — not counted'}`,
        data: { appointmentId: aRef.id, avg, passed, requirementKey: req?.key || null, photoSha: [photos.photoBefore?.sha256, photos.photoAfter?.sha256].filter(Boolean) } });
      return NextResponse.json({ ok: true, passed, avg, counted: passed && !!req, requirement: req?.label || null });
    }

    return NextResponse.json({ ok: false, error: 'Unknown action' }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 });
  }
}
