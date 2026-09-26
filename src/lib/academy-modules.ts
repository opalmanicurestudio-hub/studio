// src/lib/academy-modules.ts
//
// MODULES — how a course unfolds for a student.
// A module is the group of lessons sharing a module name; its settings live on
// the course (course.modules[key]):
//   release  'open'      open from the start (default — existing courses unchanged)
//            'previous'  opens when the previous module is finished
//            'date'      opens on a date
//            'manual'    opens when the instructor presses Release now
//   intro    a short welcome shown on the module's intro card
//   badge    { name, emoji } — earned on finishing the module (if points are on)
// moduleStates() is the single source of truth: the course page, the lesson
// loader (locks enforced on the server) and lesson completion all use it.
//
// POINTS, STREAKS & BADGES — optional per academy (tenant.academy.gamify).
// Awarded on the server, each exactly once: lesson finished +10, module
// finished +50 and its badge, course finished +100 and a course badge. A streak
// counts consecutive days with a finished lesson.

import { getAdminDb } from '@/lib/firebase-admin';

export const modKey = (t: string) => String(t || 'Module').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'module';
export const RELEASES = ['open', 'previous', 'date', 'manual'] as const;

export function moduleList(lessons: any[]) {
  const out: { key: string; title: string; lessonIds: string[]; lessonTitles: string[]; minutes: number }[] = [];
  for (const l of lessons) {
    const title = l.moduleTitle || 'Module'; const key = modKey(title);
    let m = out.find((x) => x.key === key);
    if (!m) { m = { key, title, lessonIds: [], lessonTitles: [], minutes: 0 }; out.push(m); }
    m.lessonIds.push(l.id); m.lessonTitles.push(l.title || ''); m.minutes += Math.round((Number(l.durationSec) || 0) / 60) || Number(l.minMinutes) || 0;
  }
  return out;
}

export interface ModuleState { key: string; title: string; release: string; open: boolean; reason: string | null; opensAt: string | null; done: number; total: number; complete: boolean; lessonIds: string[]; lessonTitles: string[]; minutes: number; intro: string | null; badge: { name: string; emoji: string } | null }

export function moduleStates(course: any, lessons: any[], progress: Record<string, any>, now = Date.now()): ModuleState[] {
  const cfg = course?.modules || {};
  const out: ModuleState[] = [];
  moduleList(lessons).forEach((m, i) => {
    const s = cfg[m.key] || {};
    const release = (RELEASES as readonly string[]).includes(s.release) ? s.release : 'open';
    const done = m.lessonIds.filter((id) => progress?.[id]).length;
    const prev = out[i - 1];
    let open = true, reason: string | null = null, opensAt: string | null = null;
    if (i > 0 && release === 'previous' && !(prev?.open && prev.complete)) { open = false; reason = `Opens when you finish “${prev?.title}”`; }
    if (release === 'date') { const t = s.date ? new Date(s.date).getTime() : NaN; if (!(t <= now)) { open = false; opensAt = s.date || null; reason = s.date ? `Opens ${new Date(s.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}` : 'Opening date to be announced'; } }
    if (release === 'manual' && !s.releasedAt) { open = false; reason = 'Your instructor will open this module'; }
    out.push({ key: m.key, title: m.title, release, open, reason, opensAt, done, total: m.lessonIds.length, complete: m.lessonIds.length > 0 && done === m.lessonIds.length,
      lessonIds: m.lessonIds, lessonTitles: m.lessonTitles, minutes: m.minutes, intro: s.intro || null, badge: s.badge?.name ? { name: String(s.badge.name).slice(0, 40), emoji: String(s.badge.emoji || '🏅').slice(0, 4) } : null });
  });
  return out;
}

/** What finishing a lesson changed: modules newly opened / completed, course completed. */
export function whatChanged(before: ModuleState[], after: ModuleState[]) {
  const unlocked = after.filter((m, i) => m.open && !before[i]?.open).map((m) => ({ key: m.key, title: m.title }));
  const completed = after.find((m, i) => m.complete && !before[i]?.complete) || null;
  const courseDone = after.length > 0 && after.every((m) => m.complete) && !before.every((m) => m.complete);
  return { unlocked, completed, courseDone };
}

const day = (d = new Date()) => d.toISOString().slice(0, 10);

/** Award points/badges once each (only when the academy has them switched on). */
export async function award(tenantId: string, studentId: string, items: { key: string; points: number; badge?: { id: string; name: string; emoji: string } }[]) {
  const db = getAdminDb();
  const t = ((await db.doc(`tenants/${tenantId}`).get()).data() as any) || {};
  if (!t.academy?.gamify || !items.length) return null;
  const ref = db.doc(`tenants/${tenantId}/students/${studentId}`);
  return db.runTransaction(async (tx: any) => {
    const s = ((await tx.get(ref)).data() as any) || {};
    const g = s.game || { points: 0, badges: [], awarded: {}, streak: { count: 0, last: null } };
    let gained = 0; const newBadges: any[] = [];
    for (const it of items) {
      if (g.awarded?.[it.key]) continue;
      g.awarded = { ...(g.awarded || {}), [it.key]: true }; g.points = (g.points || 0) + it.points; gained += it.points;
      if (it.badge && !(g.badges || []).some((b: any) => b.id === it.badge!.id)) { const b = { ...it.badge, at: new Date().toISOString() }; g.badges = [...(g.badges || []), b]; newBadges.push(b); }
    }
    // Streak: consecutive days with a finished lesson.
    const today = day(); const y = new Date(); y.setDate(y.getDate() - 1);
    const last = g.streak?.last;
    if (last !== today) g.streak = { count: last === day(y) ? (g.streak?.count || 0) + 1 : 1, last: today };
    tx.set(ref, { game: g }, { merge: true });
    return { points: g.points, gained, streak: g.streak.count, newBadges, badges: g.badges };
  });
}

/** The student's points/streak/badges for display (null when switched off). */
export function gameView(tenant: any, student: any) {
  if (!tenant?.academy?.gamify) return null;
  const g = student?.game || {};
  const today = day(); const y = new Date(); y.setDate(y.getDate() - 1);
  const live = g.streak?.last === today || g.streak?.last === day(y);
  return { points: g.points || 0, streak: live ? g.streak?.count || 0 : 0, badges: (g.badges || []).slice(-24) };
}

/** Tell every enrolled student a module is open — in each student's language. */
export async function notifyModuleOpen(tenantId: string, courseId: string, moduleTitle: string) {
  const db = getAdminDb();
  const [t, c, enr] = await Promise.all([db.doc(`tenants/${tenantId}`).get(), db.doc(`tenants/${tenantId}/courses/${courseId}`).get(), db.collection(`tenants/${tenantId}/enrollments`).where('courseId', '==', courseId).limit(2000).get()]);
  const school = (t.data() as any)?.name || 'your academy'; const course = (c.data() as any) || {};
  const origin = process.env.NEXT_PUBLIC_APP_URL || 'https://clarityflow.app';
  const { sendEmail } = await import('@/lib/academy-journey');
  const { translateTexts } = await import('@/lib/translate');
  let sent = 0;
  for (const d of enr.docs) {
    const e = d.data() as any; if (!e.email) continue;
    const st = ((await db.doc(`tenants/${tenantId}/students/${e.studentId}`).get()).data() as any) || {};
    let subject = `New module open: ${moduleTitle}`; let body = `“${moduleTitle}” in ${course.title || 'your course'} is now open. Jump back in:\n${origin}/learn/${tenantId}/${course.slug || ''}\n\n— ${school}`;
    if (st.language && st.language !== 'en') { try { [subject, body] = await translateTexts(tenantId, [subject, body], st.language); } catch { /* English */ } }
    try { await sendEmail(e.email, subject, body); sent++; } catch { /* skip */ }
  }
  return sent;
}

/** Daily: announce modules whose opening date has arrived (once each). */
export async function announceDateReleases() {
  const db = getAdminDb(); let announced = 0;
  const tenants = await db.collection('tenants').select('modules', 'academy').limit(2000).get();
  for (const t of tenants.docs) {
    const courses = await db.collection(`tenants/${t.id}/courses`).where('status', '==', 'published').limit(200).get().catch(() => null);
    for (const c of courses?.docs || []) {
      const mods = (c.data() as any).modules || {};
      for (const [key, m] of Object.entries(mods) as any) {
        if (m.release !== 'date' || !m.date || m.notifiedAt || new Date(m.date).getTime() > Date.now()) continue;
        await c.ref.set({ modules: { [key]: { notifiedAt: new Date().toISOString() } } }, { merge: true });
        await notifyModuleOpen(t.id, c.id, m.title || key); announced++;
      }
    }
  }
  return announced;
}
