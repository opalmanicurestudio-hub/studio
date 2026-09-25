// src/lib/academy-compliance.ts
//
// RECORDS A STATE BOARD CAN TRUST — for schools that must prove hours.
//
// 1. VERIFIED ONLINE TIME. The lesson player sends a heartbeat every 30s.
//    The SERVER (never the student's clock) credits time only when the page
//    is visible AND the student is active (video playing or interacting),
//    at most 35s per beat. Random "Still with us?" checks (every N minutes,
//    course setting) must be answered within 90s; while one is overdue no
//    time is credited, and misses are recorded. Video credit counts only
//    the parts actually watched (skipping ahead earns nothing).
//
// 2. ATTENDANCE. A screen at the academy shows a QR code that changes every
//    30s (an HMAC of the business + time window). Students scan it with
//    their own signed-in phone to clock in/out; location is checked when
//    the school turns that on. A punch left open past the day's end is
//    FLAGGED and earns nothing until an instructor resolves it.
//
// 3. CHECKS AND BALANCES. Corrections never overwrite: each keeps the
//    original, who changed it, when and why. Every hour record, correction,
//    approval, quiz attempt, completion and certificate is appended to a
//    CHAINED audit log — each entry carries a SHA-256 of the one before it,
//    so any later edit or deletion breaks the chain and "Verify records"
//    shows exactly where.
//
// Rules vary by state: requirements are per-course settings the school sets
// to match its own state board.

import { createHash, createHmac, randomBytes } from 'crypto';
import { getAdminDb } from '@/lib/firebase-admin';

const sha = (v: string) => createHash('sha256').update(v).digest('hex');
export const BEAT_MAX_CREDIT = 35;      // seconds credited per heartbeat, at most
export const BEAT_GAP_MAX = 75;         // a gap longer than this since the last beat earns nothing
export const CHECK_ANSWER_SEC = 90;     // time allowed to answer "Still with us?"
export const QR_WINDOW_SEC = 30;

// ── Audit chain ──────────────────────────────────────────────────────────
export async function appendAudit(tenantId: string, entry: { type: string; studentId?: string | null; courseId?: string | null; by?: string | null; summary: string; data?: any }) {
  const db = getAdminDb();
  const head = db.doc(`tenants/${tenantId}/academyAuditMeta/head`);
  return db.runTransaction(async (tx: any) => {
    const h = ((await tx.get(head)).data() as any) || { seq: 0, hash: 'GENESIS' };
    const seq = (h.seq || 0) + 1;
    const at = new Date().toISOString();
    const body = { seq, at, type: entry.type, studentId: entry.studentId || null, courseId: entry.courseId || null, by: entry.by || 'system', summary: entry.summary, data: entry.data ?? null };
    const hash = sha(`${h.hash}|${JSON.stringify(body)}`);
    tx.set(db.doc(`tenants/${tenantId}/academyAudit/${String(seq).padStart(10, '0')}`), { ...body, prevHash: h.hash, hash });
    tx.set(head, { seq, hash, at });
    return { seq, hash };
  });
}

/** Recompute the chain from the start; report the first entry that doesn't match. */
export async function verifyAudit(tenantId: string) {
  const db = getAdminDb();
  const snap = await db.collection(`tenants/${tenantId}/academyAudit`).orderBy('seq').limit(50000).get();
  let prev = 'GENESIS'; let expected = 1;
  for (const d of snap.docs) {
    const e = d.data() as any;
    if (e.seq !== expected) return { ok: false, checked: expected - 1, problem: `Entry ${expected} is missing (next found: ${e.seq}).` };
    const body = { seq: e.seq, at: e.at, type: e.type, studentId: e.studentId, courseId: e.courseId, by: e.by, summary: e.summary, data: e.data ?? null };
    if (e.prevHash !== prev || sha(`${prev}|${JSON.stringify(body)}`) !== e.hash) return { ok: false, checked: expected - 1, problem: `Entry ${e.seq} (${e.at}) has been altered.` };
    prev = e.hash; expected++;
  }
  const head = ((await db.doc(`tenants/${tenantId}/academyAuditMeta/head`).get()).data() as any) || { seq: 0, hash: 'GENESIS' };
  if ((head.seq || 0) !== expected - 1 || (head.hash || 'GENESIS') !== prev) return { ok: false, checked: expected - 1, problem: 'The latest entries were removed.' };
  // Daily anchors (kept outside the school's records): a chain rewritten
  // end-to-end would still disagree with the fingerprints taken each night.
  const byseq = new Map(snap.docs.map((d: any) => [(d.data() as any).seq, (d.data() as any).hash]));
  const anchors = await db.collection('platformAuditAnchors').where('tenantId', '==', tenantId).limit(2000).get().catch(() => null);
  for (const a of anchors?.docs || []) {
    const v = a.data() as any;
    if (v.seq && byseq.get(v.seq) !== v.hash) return { ok: false, checked: expected - 1, problem: `Records up to ${v.date} don’t match the fingerprint taken that night — history was rewritten.` };
  }
  return { ok: true, checked: expected - 1, anchors: anchors?.size || 0 };
}

// ── Watched ranges (video) ───────────────────────────────────────────────
export type Range = [number, number];
export function mergeRanges(a: Range[], b: Range[]): Range[] {
  const all = [...a, ...b].filter((r) => Array.isArray(r) && r[1] > r[0] && r[0] >= 0).map((r) => [Math.floor(r[0]), Math.ceil(r[1])] as Range).sort((x, y) => x[0] - y[0]);
  const out: Range[] = [];
  for (const r of all) { const last = out[out.length - 1]; if (last && r[0] <= last[1] + 1) last[1] = Math.max(last[1], r[1]); else out.push([r[0], r[1]]); }
  return out;
}
export const watchedSeconds = (r: Range[]) => r.reduce((n, [s, e]) => n + (e - s), 0);

// ── The engagement meter ─────────────────────────────────────────────────
export interface BeatInput { visible: boolean; playing: boolean; interacted: boolean; ranges?: Range[]; checkAnswer?: string | null }

/**
 * Apply one heartbeat to a learning session (server time only). Returns the
 * patch to save and what to tell the player (e.g. show an attention check).
 */
export function applyBeat(session: any, beat: BeatInput, opts: { checkEveryMin: number; videoDurationSec?: number | null }, nowMs = Date.now()) {
  const last = session.lastBeatAt ? new Date(session.lastBeatAt).getTime() : nowMs;
  const gap = Math.max(0, (nowMs - last) / 1000);
  const patch: any = { lastBeatAt: new Date(nowMs).toISOString(), beats: (session.beats || 0) + 1 };
  let showCheck: string | null = null;

  // An attention check: answered, pending, or overdue?
  let blocked = false;
  if (session.check && !session.check.answeredAt) {
    const deadline = new Date(session.check.issuedAt).getTime() + CHECK_ANSWER_SEC * 1000;
    if (beat.checkAnswer && beat.checkAnswer === session.check.id) {
      const late = nowMs > deadline;
      patch.check = { ...session.check, answeredAt: new Date(nowMs).toISOString(), late };
      patch[late ? 'checksMissed' : 'checksPassed'] = (session[late ? 'checksMissed' : 'checksPassed'] || 0) + 1;
      patch.nextCheckAt = new Date(nowMs + jitterMin(opts.checkEveryMin) * 60000).toISOString();
    } else if (nowMs > deadline) { blocked = true; showCheck = session.check.id; }
    else showCheck = session.check.id;
  }

  const active = beat.visible && (beat.playing || beat.interacted);
  const creditable = active && !blocked && gap <= BEAT_GAP_MAX;
  const credit = creditable ? Math.min(gap, BEAT_MAX_CREDIT) : 0;
  patch.engagedSec = (session.engagedSec || 0) + credit;
  patch.idleSec = (session.idleSec || 0) + (gap <= BEAT_GAP_MAX ? Math.max(0, gap - credit) : 0);

  // Time for a new check?
  const due = opts.checkEveryMin > 0 && session.nextCheckAt && nowMs >= new Date(session.nextCheckAt).getTime() && !(session.check && !session.check.answeredAt) && !patch.check;
  if (due && active) { const id = randomBytes(6).toString('hex'); patch.check = { id, issuedAt: new Date(nowMs).toISOString(), answeredAt: null }; patch.checksIssued = (session.checksIssued || 0) + 1; showCheck = id; }

  if (beat.ranges?.length && active && !blocked) {
    const dur = Math.max(0, Number(opts.videoDurationSec) || 0);
    const clean = beat.ranges.map(([s, e]) => [Math.max(0, s), dur ? Math.min(dur, e) : e] as Range).filter(([s, e]) => e > s && e - s <= gap + 5);   // can't claim more than elapsed
    patch.ranges = mergeRanges(session.ranges || [], clean);
    patch.watchedSec = watchedSeconds(patch.ranges);
  }
  return { patch, credit, showCheck, blocked };
}
export const jitterMin = (m: number) => Math.max(2, m - 2 + Math.random() * 5);   // m−2 … m+3 minutes, unpredictable

// ── Attendance codes ─────────────────────────────────────────────────────
const attendSecret = () => String(process.env.ACADEMY_ATTENDANCE_SECRET || process.env.CRON_SECRET || 'set-ACADEMY_ATTENDANCE_SECRET');
export const qrWindow = (ms = Date.now()) => Math.floor(ms / 1000 / QR_WINDOW_SEC);
export const qrCode = (tenantId: string, w: number) => createHmac('sha256', attendSecret()).update(`${tenantId}:${w}`).digest('base64url').slice(0, 16);
/** Accept the current window or the one before (a phone may take a few seconds). */
export function qrValid(tenantId: string, code: string, w: number, nowMs = Date.now()) {
  const cur = qrWindow(nowMs);
  return (w === cur || w === cur - 1) && code === qrCode(tenantId, w);
}
export function metersBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371000, toR = (x: number) => (x * Math.PI) / 180;
  const dLat = toR(b.lat - a.lat), dLng = toR(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// ── Completion rules ─────────────────────────────────────────────────────
export interface CourseRules { compliance?: boolean; minEngagementPct?: number; minWatchPct?: number; attentionCheckMinutes?: number; requiredOnlineHours?: number; requiredInPersonHours?: number }
export const DEFAULT_RULES = { minEngagementPct: 80, minWatchPct: 90, attentionCheckMinutes: 10 };

/** Has this lesson been genuinely done? (Only enforced when the course tracks hours.) */
export function lessonMet(course: CourseRules, lesson: any, agg: { engagedSec: number; watchedSec: number; quizPassed: boolean }) {
  if (!course.compliance) return { met: true, why: '' };
  const minEng = (course.minEngagementPct ?? DEFAULT_RULES.minEngagementPct) / 100;
  const minWatch = (course.minWatchPct ?? DEFAULT_RULES.minWatchPct) / 100;
  if (lesson.quiz?.questions?.length && !agg.quizPassed) return { met: false, why: 'Pass the quiz to complete this lesson.' };
  if (lesson.kind === 'video' && lesson.durationSec) {
    const d = lesson.durationSec;
    if (agg.watchedSec < d * minWatch) return { met: false, why: `Watch at least ${Math.round(minWatch * 100)}% of the video (${Math.round((agg.watchedSec / d) * 100)}% so far).` };
    if (agg.engagedSec < d * minEng) return { met: false, why: `More active time needed on this lesson (${Math.round(agg.engagedSec / 60)} of ${Math.ceil((d * minEng) / 60)} min).` };
  }
  const minMin = Number(lesson.minMinutes) || 0;
  if (minMin && agg.engagedSec < minMin * 60) return { met: false, why: `Spend at least ${minMin} active minutes on this lesson (${Math.round(agg.engagedSec / 60)} so far).` };
  return { met: true, why: '' };
}

// ── Transcript ───────────────────────────────────────────────────────────
export async function transcript(tenantId: string, studentId: string, courseId?: string | null) {
  const db = getAdminDb();
  const [stu, sess, att, enr] = await Promise.all([
    db.doc(`tenants/${tenantId}/students/${studentId}`).get(),
    db.collection(`tenants/${tenantId}/learningSessions`).where('studentId', '==', studentId).limit(5000).get(),
    db.collection(`tenants/${tenantId}/attendance`).where('studentId', '==', studentId).limit(5000).get(),
    db.collection(`tenants/${tenantId}/enrollments`).where('studentId', '==', studentId).limit(100).get(),
  ]);
  const sessions = sess.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) })).filter((s: any) => !courseId || s.courseId === courseId).sort((a: any, b: any) => String(a.startedAt).localeCompare(String(b.startedAt)));
  const punches = att.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) })).filter((p: any) => !courseId || !p.courseId || p.courseId === courseId).sort((a: any, b: any) => String(a.clockInAt).localeCompare(String(b.clockInAt)));
  const onlineSec = sessions.reduce((n: number, s: any) => n + (s.engagedSec || 0), 0);
  const approvedMin = punches.filter((p: any) => p.status === 'approved' || p.status === 'closed').reduce((n: number, p: any) => n + (p.minutes || 0), 0);
  const flagged = punches.filter((p: any) => p.status === 'flagged' || p.status === 'open').length;
  return {
    student: stu.exists ? { id: studentId, ...(stu.data() as any) } : { id: studentId },
    enrollments: enr.docs.map((d: any) => d.data()).filter((e: any) => !courseId || e.courseId === courseId),
    sessions, punches,
    totals: { onlineHours: Math.round((onlineSec / 3600) * 100) / 100, inPersonHours: Math.round((approvedMin / 60) * 100) / 100, flaggedPunches: flagged,
      checksIssued: sessions.reduce((n: number, s: any) => n + (s.checksIssued || 0), 0), checksMissed: sessions.reduce((n: number, s: any) => n + (s.checksMissed || 0), 0) },
  };
}

/**
 * Daily: close online sessions abandoned for 30+ minutes (their credited time
 * is recorded in the audit log), and FLAG attendance left open for 16+ hours
 * (no hours count until an instructor corrects it with a reason).
 */
export async function sweepAcademy() {
  const db = getAdminDb();
  const tenants = await db.collection('tenants').select('modules').limit(1000).get();
  let closed = 0, flagged = 0;
  const stale = Date.now() - 30 * 60000, lateOpen = Date.now() - 16 * 3600000;
  for (const t of tenants.docs) {
    if ((t.data() as any)?.modules?.academy === false) continue;
    const sess = await db.collection(`tenants/${t.id}/learningSessions`).where('status', '==', 'active').limit(500).get().catch(() => null);
    for (const d of sess?.docs || []) {
      const s = d.data() as any;
      if (new Date(s.lastBeatAt).getTime() > stale) continue;
      await d.ref.set({ status: 'closed', endedAt: s.lastBeatAt, closedBy: 'system' }, { merge: true });
      await appendAudit(t.id, { type: 'online.session', studentId: s.studentId, courseId: s.courseId, by: 'system', summary: `Online session (closed automatically): ${Math.round((s.engagedSec || 0) / 60)} active min, checks ${s.checksPassed || 0}/${s.checksIssued || 0} answered`, data: { sessionId: d.id, lessonId: s.lessonId, engagedSec: s.engagedSec || 0, checksMissed: s.checksMissed || 0 } });
      closed++;
    }
    const open = await db.collection(`tenants/${t.id}/attendance`).where('status', '==', 'open').limit(500).get().catch(() => null);
    for (const d of open?.docs || []) {
      const p = d.data() as any;
      if (new Date(p.clockInAt).getTime() > lateOpen) continue;
      await d.ref.set({ status: 'flagged', flaggedAt: new Date().toISOString(), flagReason: 'No clock-out' }, { merge: true });
      await appendAudit(t.id, { type: 'attendance.flagged', studentId: p.studentId, by: 'system', summary: `No clock-out for ${p.email} (in at ${new Date(p.clockInAt).toLocaleString()}) — no hours until an instructor resolves it`, data: { attendanceId: d.id } });
      flagged++;
    }
  }
  // Tonight's fingerprint of every academy's records (kept by the platform).
  const date = new Date().toISOString().slice(0, 10);
  for (const t of tenants.docs) {
    const h = ((await db.doc(`tenants/${t.id}/academyAuditMeta/head`).get()).data() as any) || null;
    if (h?.seq) await db.doc(`platformAuditAnchors/${t.id}_${date}`).set({ tenantId: t.id, date, seq: h.seq, hash: h.hash, at: new Date().toISOString() });
  }
  return { closed, flagged };
}
