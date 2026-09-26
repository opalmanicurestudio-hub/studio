'use client';
// src/app/(app)/academy/page.tsx
//
// ACADEMY — build and sell online courses.
//   Courses      list + "New course"
//   Details      title, price, level, instructor, cover, what they'll learn,
//                description, Draft/Published, link to the public page
//   Curriculum   lessons grouped by module: video (upload to Mux with a
//                progress bar, or paste a Vimeo/YouTube link), text or a
//                download; free-preview switch; reorder; edit; delete
//   Students     who's enrolled, since when, how far they've got

import { ModuleSettings, GamifySetting, modKey } from '@/components/academy/ModuleSettings';
import { AiCreditsMeter } from '@/components/academy/AiCreditsMeter';
import { deviceId } from '@/lib/device';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getAuth } from 'firebase/auth';
import { Loader, ArrowUp, ArrowDown, Pencil, Trash2, ExternalLink, Video, FileText, Download, Plus, Home as HomeIcon, BookOpen, Sparkles, Users, Clock, ClipboardList, GraduationCap, Settings as SettingsIcon, Radio, Printer } from 'lucide-react';
import { AppHeader } from '@/components/shared/AppHeader';
import { PrivateImg } from '@/components/shared/private-file';
import { SchoolPrograms } from '@/components/academy/SchoolPrograms';
import { StudentSalon } from '@/components/academy/StudentSalon';
import { AdmissionsBoard } from '@/components/academy/AdmissionsBoard';
import { StudentJourney } from '@/components/academy/StudentJourney';
import { AttendancePanel } from '@/components/academy/AttendancePanel';
import { LiveClass } from '@/components/academy/LiveClass';
import { AcademyReports } from '@/components/academy/AcademyReports';
import { BlocksEditor, PlanEditor, CasesEditor, VideoQuestionsEditor } from '@/components/academy/LessonStudio';
import { CourseMaterials } from '@/components/academy/CourseMaterials';
import { Grading } from '@/components/academy/Grading';
import { AiCourseBuilder } from '@/components/academy/AiCourseBuilder';
import { DevicesPanel } from '@/components/academy/DevicesPanel';
import { AcademyHome, academyHome, type Section } from '@/components/academy/AcademyHome';
import { useTenant } from '@/context/TenantContext';

async function api(body: any) {
  const u = getAuth().currentUser; const tk = u ? await u.getIdToken() : '';
  const r = await fetch('/api/academy/admin', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tk}`, 'x-cf-device': deviceId() }, body: JSON.stringify(body) });
  return r.json().catch(() => ({ ok: false, error: 'No response' }));
}
const money = (c: number) => (c ? `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: c % 100 ? 2 : 0 })}` : 'Free');
const field = 'h-11 w-full rounded-xl border-2 border-border/60 bg-background px-3 text-sm';
const KIND_ICON: Record<string, any> = { video: Video, text: FileText, download: Download };
const blankLesson = (moduleTitle = 'Module 1') => ({ id: '', title: '', moduleTitle, kind: 'video', body: '', videoUrl: '', downloadUrl: '', downloadName: '', preview: false, minMinutes: 0, quiz: null as any, flashcards: [] as any[], activity: null as any, blocks: [] as any[], plan: null as any });
const hm = (min: number) => `${Math.floor((min || 0) / 60)}h ${(min || 0) % 60}m`;
const dt = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');
const toLocalInput = (iso?: string | null) => { if (!iso) return ''; const d = new Date(iso); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
const csv = (rows: any[][]) => rows.map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');

export default function AcademyBuilderPage() {
  const { selectedTenant } = useTenant();
  const tenantId = String(selectedTenant?.id || '');
  const [courses, setCourses] = useState<any[] | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [d, setD] = useState<any>(null);            // { course, lessons, mux, muxSigning }
  const [tab, setTab] = useState<'details' | 'curriculum' | 'grading' | 'students' | 'attendance'>('details');
  const [aiBuild, setAiBuild] = useState(false);
  // Phones: bottom tabs open a hub of big tiles; courses open one at a time.
  const [hub, setHub] = useState<string | null>(null);
  const [picked, setPicked] = useState(false);
  const [att, setAtt] = useState<any>(null);
  const [trx, setTrx] = useState<any>(null);
  const [audit, setAudit] = useState<any>(null);
  const [drafting, setDrafting] = useState('');
  const [tutorLog, setTutorLog] = useState<any[] | null>(null);
  /** Ask AI for a draft from the lesson's own text; it fills the editor — nothing is saved until you press Save. */
  const draft = async (kind: 'quiz' | 'flashcards' | 'match' | 'order' | 'scenario') => {
    setDrafting(kind); setMsg('');
    const r = await api({ action: 'ai-draft', tenantId, courseId: sel, lessonId: lesson.id || undefined, kind, title: lesson.title, text: lesson.body });
    setDrafting('');
    if (!r.ok) { setMsg(r.error); return; }
    if (kind === 'quiz' && r.draft.questions) setLesson({ ...lesson, quiz: { passPct: lesson.quiz?.passPct || 80, questions: r.draft.questions } });
    else if (kind === 'flashcards' && r.draft.flashcards) setLesson({ ...lesson, flashcards: r.draft.flashcards });
    else if (r.draft.activity) setLesson({ ...lesson, activity: r.draft.activity });
    setMsg('Draft added below — read it through, change anything, then Save lesson.');
  };
  const [form, setForm] = useState<any>(null);
  const [lesson, setLesson] = useState<any>(null);   // the lesson being edited
  const [students, setStudents] = useState<any[] | null>(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState('');
  const [upload, setUpload] = useState<{ lessonId: string; pct: number; status: string } | null>(null);
  const poll = useRef<number | null>(null);
  // Online courses only, or a licensed school (programs + student salon too).
  const [mode, setMode] = useState<'courses' | 'school' | null>(null);
  const [section, setSection] = useState<Section>('home');
  const [home, setHome] = useState<any>(null);
  useEffect(() => { if (tenantId) academyHome(tenantId).then((r) => r?.ok && setHome(r)); }, [tenantId, section]);
  useEffect(() => { if (!tenantId) return; (async () => { const u = getAuth().currentUser; const tk = u ? await u.getIdToken() : ''; const r = await fetch('/api/academy/school', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tk}`, 'x-cf-device': deviceId() }, body: JSON.stringify({ action: 'overview', tenantId }) }).then((x) => x.json()).catch(() => null); setMode(r?.mode || 'courses'); })(); }, [tenantId]);
  const changeMode = async (m: 'courses' | 'school') => { const u = getAuth().currentUser; const tk = u ? await u.getIdToken() : ''; const r = await fetch('/api/academy/school', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tk}`, 'x-cf-device': deviceId() }, body: JSON.stringify({ action: 'mode', tenantId, mode: m }) }).then((x) => x.json()).catch(() => null); if (r?.ok) { setMode(m); academyHome(tenantId).then((h) => h?.ok && setHome(h)); } else setMsg(r?.error || 'Couldn’t change the mode.'); };

  const loadList = useCallback(async () => { if (!tenantId) return; const r = await api({ action: 'list', tenantId }); if (r.ok) setCourses(r.courses); else setMsg(r.error); }, [tenantId]);
  const loadCourse = useCallback(async (id: string) => {
    const r = await api({ action: 'course-get', tenantId, courseId: id });
    if (!r.ok) { setMsg(r.error); return; }
    setD(r);
    const c = r.course;
    setForm({ id: c.id, title: c.title, subtitle: c.subtitle || '', priceDollars: (c.priceCents || 0) / 100, level: c.level || '', instructorName: c.instructorName || '', coverUrl: c.coverUrl || '', whatYouLearn: (c.whatYouLearn || []).join('\n'), description: c.description || '', status: c.status || 'draft',
      aiTutor: c.aiTutor !== false, captionLanguage: c.captionLanguage || 'en', compliance: !!c.compliance, requiredOnlineHours: c.requiredOnlineHours || '', requiredInPersonHours: c.requiredInPersonHours || '', minEngagementPct: c.minEngagementPct ?? 80, minWatchPct: c.minWatchPct ?? 90, attentionCheckMinutes: c.attentionCheckMinutes ?? 10 });
  }, [tenantId]);
  useEffect(() => { void loadList(); }, [loadList]);
  useEffect(() => { if (sel) { void loadCourse(sel); setStudents(null); setLesson(null); setTutorLog(null); } }, [sel, loadCourse]);
  useEffect(() => () => { if (poll.current) window.clearInterval(poll.current); }, []);

  const saveCourse = async (extra: any = {}) => {
    setBusy('course'); setMsg('');
    const f = { ...form, ...extra };
    const r = await api({ action: 'course-save', tenantId, course: { ...f, whatYouLearn: String(f.whatYouLearn || '').split('\n').map((x: string) => x.trim()).filter(Boolean) } });
    setBusy('');
    if (!r.ok) { setMsg(r.error); return; }
    setMsg(extra.status === 'published' ? 'Published — it’s live on your academy page.' : 'Saved.');
    setSel(r.id); await loadList(); await loadCourse(r.id);
  };
  const newCourse = async () => {
    const title = window.prompt('Course title'); if (!title) return;
    const r = await api({ action: 'course-save', tenantId, course: { title, priceDollars: 0, status: 'draft' } });
    if (r.ok) { await loadList(); setSel(r.id); setTab('details'); setPicked(true); } else setMsg(r.error);
  };
  const saveLesson = async () => {
    setBusy('lesson'); setMsg('');
    const r = await api({ action: 'lesson-save', tenantId, courseId: sel, lesson });
    setBusy('');
    if (!r.ok) { setMsg(r.error); return; }
    setLesson({ ...lesson, id: r.id }); await loadCourse(sel!);
    return r.id as string;
  };
  const uploadVideo = async (file: File) => {
    let lessonId = lesson.id;
    if (!lessonId) { lessonId = await saveLesson(); if (!lessonId) return; }
    const r = await api({ action: 'upload-create', tenantId, courseId: sel, lessonId });
    if (!r.ok) { setMsg(r.error); return; }
    setUpload({ lessonId, pct: 0, status: 'uploading' });
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', r.url);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) setUpload({ lessonId, pct: Math.round((e.loaded / e.total) * 100), status: 'uploading' }); };
    xhr.onload = () => {
      setUpload({ lessonId, pct: 100, status: 'processing' });
      if (poll.current) window.clearInterval(poll.current);
      poll.current = window.setInterval(async () => {
        const s = await api({ action: 'video-status', tenantId, courseId: sel, lessonId });
        if (s.status === 'ready' || s.status === 'errored') {
          if (poll.current) window.clearInterval(poll.current);
          setUpload(null); setMsg(s.status === 'ready' ? 'Video ready ✓' : 'Mux couldn’t process that video — try another file.');
          await loadCourse(sel!);
        }
      }, 4000);
    };
    xhr.onerror = () => { setUpload(null); setMsg('Upload failed — check your connection and try again.'); };
    xhr.send(file);
  };

  const modules = useMemo(() => {
    const out: { title: string; lessons: any[] }[] = [];
    for (const l of d?.lessons || []) { const m = out.find((x) => x.title === l.moduleTitle); if (m) m.lessons.push(l); else out.push({ title: l.moduleTitle, lessons: [l] }); }
    return out;
  }, [d]);
  const publicUrl = d?.course ? `/learn/${tenantId}/${d.course.slug}` : '';

  const NAV: { group: string; items: { key: Section; label: string; hint: string; icon: any; school?: boolean; badge?: number }[] }[] = [
    { group: '', items: [{ key: 'home', label: 'Home', hint: 'What needs you today', icon: HomeIcon }] },
    { group: 'Teach', items: [
      { key: 'courses', label: 'Courses', hint: 'Lessons, videos, quizzes', icon: BookOpen },
      { key: 'live', label: 'Live class', hint: 'Join code, questions, minutes', icon: Radio },
      { key: 'materials', label: 'Tests & worksheets', hint: 'Question bank, printables', icon: Printer },
      { key: 'salon', label: 'Student salon', hint: 'Sign off students’ services', icon: Sparkles, school: true, badge: home?.school?.checkoffsToday } ] },
    { group: 'Students', items: [
      { key: 'students', label: 'Students', hint: 'Progress, risk, messages', icon: Users, school: true, badge: (home?.school?.atRisk || 0) + (home?.school?.unread || 0) },
      { key: 'attendance', label: 'Attendance', hint: 'Clock-ins, photos, fixes', icon: Clock, school: true, badge: home?.school?.attendanceToFix },
      { key: 'reports', label: 'Reports', hint: 'Hours letters, attendance, outcomes', icon: FileText, school: true } ] },
    { group: 'Enrol', items: [
      { key: 'admissions', label: 'Admissions', hint: 'Applicants, tuition, cohorts', icon: ClipboardList, school: true, badge: (home?.school?.docsToCheck || 0) + (home?.school?.toCountersign || 0) + (home?.school?.newInquiries || 0) } ] },
    { group: 'Set up', items: [
      { key: 'programs', label: 'Programs', hint: 'Hours, services, tuition rules', icon: GraduationCap, school: true },
      { key: 'settings', label: 'Settings', hint: 'Academy type and your links', icon: SettingsIcon } ] },
  ];
  const docBrand = { name: String((selectedTenant as any)?.name || home?.name || 'Academy'), logoUrl: (selectedTenant as any)?.logoUrl || (selectedTenant as any)?.bookingPageSettings?.logoUrl || null, color: (selectedTenant as any)?.bookingPageSettings?.primaryColor || null };
  const visible = NAV.map((g) => ({ ...g, items: g.items.filter((i) => !i.school || mode === 'school') })).filter((g) => g.items.length);
  const current = visible.flatMap((g) => g.items).find((i) => i.key === section) || visible[0].items[0];
  const go = (k: Section) => { setSection(k); setHub(null); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  // Phone tabs: Today + the groups (Set up becomes “More”, with your links).
  const TABS = [{ key: 'today', label: 'Today', icon: HomeIcon, items: [] as any[] }, ...visible.filter((g) => g.group).map((g) => ({ key: g.group === 'Set up' ? 'More' : g.group, label: g.group === 'Set up' ? 'More' : g.group, icon: g.group === 'Teach' ? BookOpen : g.group === 'Students' ? Users : g.group === 'Enrol' ? ClipboardList : SettingsIcon, items: g.items }))];
  const groupOf = (k: Section) => TABS.find((t) => t.items.some((i: any) => i.key === k));
  const activeTab = hub || (section === 'home' ? 'today' : groupOf(section)?.key || 'today');
  const badgeOf = (t: any) => t.items.reduce((n: number, i: any) => n + (i.badge || 0), 0);
  const links = tenantId ? [['Your academy page', `/learn/${tenantId}`, 'Where people browse and buy your courses'], ...(mode === 'school' ? [['Apply page', `/learn/${tenantId}/apply`, 'Share this with future students'], ['Clock-in screen', '/academy-screen', 'Open on a tablet at the front desk'], ['Student portal', `/learn/${tenantId}/my`, 'Where students sign in']] : [])] : [];

  return (
    <div className="min-h-screen bg-background">
      <AppHeader title="Academy" />
      <main className="mx-auto max-w-7xl px-3 pb-32 pt-4 sm:px-4 lg:pb-24">
        <div className="grid gap-6 lg:grid-cols-[230px_1fr]">
          {/* The menu: grouped by job, in plain words. A strip of buttons on phones. */}
          <nav aria-label="Academy" className="hidden lg:sticky lg:top-20 lg:block lg:self-start">
            <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-2 lg:mx-0 lg:block lg:space-y-4 lg:overflow-visible lg:px-0">
              {visible.map((g) => (
                <div key={g.group || 'top'} className="contents lg:block lg:space-y-1">
                  {g.group && <p className="hidden px-3 text-[10px] font-black uppercase tracking-widest text-muted-foreground lg:block">{g.group}</p>}
                  {g.items.map((i) => { const I = i.icon; const on = section === i.key; return (
                    <button key={i.key} type="button" onClick={() => go(i.key)} aria-current={on ? 'page' : undefined} className={`flex shrink-0 items-center gap-2.5 rounded-xl px-3 py-2 text-left transition lg:w-full ${on ? 'bg-foreground text-background' : 'bg-muted/40 hover:bg-muted lg:bg-transparent'}`}>
                      <I className="h-4 w-4 shrink-0" />
                      <span className="min-w-0 flex-1"><span className="block whitespace-nowrap text-sm font-bold">{i.label}</span><span className={`hidden text-[11px] lg:block ${on ? 'opacity-70' : 'text-muted-foreground'}`}>{i.hint}</span></span>
                      {!!i.badge && <span className={`rounded-full px-1.5 text-[11px] font-black ${on ? 'bg-background text-foreground' : 'bg-red-500 text-white'}`}>{i.badge}</span>}
                    </button>
                  ); })}
                </div>
              ))}
            </div>
          </nav>

          <div className="min-w-0 space-y-4">
            {hub && (() => { const t = TABS.find((x) => x.key === hub)!; return (
              <div className="space-y-3 lg:hidden">
                <h1 className="text-2xl font-black tracking-tight">{t.label}</h1>
                <div className="grid grid-cols-2 gap-3">{t.items.map((i: any) => { const I = i.icon; return (
                  <button key={i.key} type="button" onClick={() => go(i.key)} className="relative flex min-h-32 flex-col justify-between rounded-3xl border-2 border-border/60 bg-muted/30 p-4 text-left active:scale-[0.98]">
                    <I className="h-7 w-7" />
                    <span><span className="block text-base font-black leading-tight">{i.label}</span><span className="mt-0.5 block text-[12px] leading-snug text-muted-foreground">{i.hint}</span></span>
                    {!!i.badge && <span className="absolute right-3 top-3 rounded-full bg-red-500 px-2 py-0.5 text-[12px] font-black text-white">{i.badge}</span>}
                  </button>
                ); })}</div>
                {hub === 'More' && links.length > 0 && <div className="space-y-1.5 pt-2"><p className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">Your links</p>{links.map(([l, href, h]) => <a key={href} href={href} target="_blank" rel="noreferrer" className="flex items-center justify-between rounded-2xl bg-muted/40 px-4 py-3 text-sm"><span><b className="block">{l}</b><span className="text-[12px] text-muted-foreground">{h}</span></span><ExternalLink className="h-4 w-4 shrink-0" /></a>)}</div>}
              </div>
            ); })()}
            <div className={hub ? 'hidden space-y-4 lg:block' : 'space-y-4'}>
            {section !== 'home' && groupOf(section) && <button type="button" onClick={() => { setHub(groupOf(section)!.key); setPicked(false); }} className="-mb-2 text-sm font-bold text-muted-foreground lg:hidden">‹ {groupOf(section)!.label}</button>}
            {section !== 'home' && (
              <div className="flex flex-wrap items-end justify-between gap-2">
                <div><h1 className="text-2xl font-black tracking-tight">{current.label}</h1><p className="text-sm text-muted-foreground">{current.hint}</p></div>
                {section === 'courses' && <div className="flex flex-wrap gap-2">
                  {tenantId && <a href={`/learn/${tenantId}`} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center gap-1.5 rounded-xl border-2 px-3 text-sm font-bold">Your academy page <ExternalLink className="h-3.5 w-3.5" /></a>}
                  <button type="button" onClick={() => setAiBuild(true)} className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-violet-700 px-4 text-sm font-bold text-white">✨ Build with AI</button>
                  <button type="button" onClick={newCourse} className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-foreground px-4 text-sm font-bold text-background"><Plus className="h-4 w-4" />New course</button>
                </div>}
                {aiBuild && <AiCourseBuilder tenantId={tenantId} onClose={() => setAiBuild(false)} onCreated={async (id: string) => { setAiBuild(false); await loadList(); setSel(id); setTab('curriculum'); setPicked(true); setMsg('Course drafted — open each lesson to add content, or use ✨ Draft with AI inside it. It stays a draft until you publish.'); }} />}
              </div>
            )}
            {msg && <p className="rounded-2xl border-2 border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">{msg}</p>}
            {section === 'home' && <AcademyHome tenantId={tenantId} data={home} go={go} />}
            {section === 'programs' && mode === 'school' && <SchoolPrograms tenantId={tenantId} courses={courses || []} brand={docBrand} />}
            {section === 'salon' && mode === 'school' && <StudentSalon tenantId={tenantId} />}
            {section === 'admissions' && mode === 'school' && <AdmissionsBoard tenantId={tenantId} />}
            {section === 'students' && mode === 'school' && <StudentJourney tenantId={tenantId} brand={docBrand} />}
            {section === 'attendance' && mode === 'school' && <AttendancePanel tenantId={tenantId} />}
            {section === 'live' && <LiveClass tenantId={tenantId} />}
            {section === 'materials' && <CourseMaterials tenantId={tenantId} courses={courses || []} brand={docBrand} />}
            {section === 'reports' && mode === 'school' && <AcademyReports tenantId={tenantId} />}
            {section === 'settings' && (
              <div className="space-y-4">
                <section className="space-y-2 rounded-2xl bg-muted/40 p-4">
                  <p className="font-black">What kind of academy is this?</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {([['courses', 'Online courses', 'Sell classes online. Students buy, watch and earn a certificate.'], ['school', 'Licensed school', 'Everything in online courses, plus programs, hours, attendance, admissions, tuition and a student salon.']] as const).map(([k, l, h]) => (
                      <button key={k} type="button" onClick={() => { if (k === mode) return; if (k === 'school' && !window.confirm('Switch on licensed-school tools? Your online courses keep working as they are.')) return; void changeMode(k); }} className={`rounded-2xl border-2 p-4 text-left ${mode === k ? 'border-foreground bg-background' : 'border-transparent bg-background/60'}`}>
                        <p className="font-black">{mode === k ? '● ' : '○ '}{l}</p><p className="text-[13px] text-muted-foreground">{h}</p></button>
                    ))}
                  </div>
                </section>
                <section className="space-y-2 rounded-2xl bg-muted/40 p-4">
                  <p className="font-black">Your links</p>
                  {links.map(([l, href, h]) => (
                    <div key={l} className="flex flex-wrap items-center gap-2 rounded-xl bg-background px-3 py-2 text-sm">
                      <span className="min-w-0 flex-1"><span className="font-bold">{l}</span> <span className="text-muted-foreground">· {h}</span></span>
                      <a href={href} target="_blank" rel="noreferrer" className="text-[12px] font-bold underline">Open</a>
                      <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(`${window.location.origin}${href}`); setMsg(`${l} link copied.`); } catch { /* ignore */ } }} className="text-[12px] font-bold underline">Copy link</button>
                    </div>
                  ))}
                </section>
                <GamifySetting tenantId={tenantId} />
                <AiCreditsMeter tenantId={tenantId} />
                {mode === 'school' && <DevicesPanel tenantId={tenantId} />}
                {mode === 'school' && (
                  <section className="space-y-1 rounded-2xl bg-muted/40 p-4 text-sm">
                    <p className="font-black">Who can do what</p>
                    <p><span className="font-bold">Owners & managers</span> — everything, including admissions, tuition and courses.</p>
                    <p><span className="font-bold">Instructors</span> (Staff → role “instructor”) — student salon sign-offs, attendance, students and messages. Not money, documents or course editing.</p>
                    <p><span className="font-bold">Students</span> — their own courses, hours, messages and clock-in, through the student portal.</p>
                  </section>
                )}
              </div>
            )}
            {section === 'courses' && d && !d.mux && <p className="rounded-2xl border-2 border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Video hosting isn’t connected yet — you can paste a private Vimeo or unlisted YouTube link for now. Add MUX_TOKEN_ID, MUX_TOKEN_SECRET, MUX_SIGNING_KEY_ID and MUX_SIGNING_KEY_PRIVATE in Vercel to upload protected videos.</p>}

        {section === 'courses' && <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
          <div className={`space-y-2 ${picked ? 'hidden lg:block' : ''}`}>
            {!courses && <Loader className="h-5 w-5 animate-spin" />}
            {courses?.length === 0 && <p className="rounded-2xl border-2 border-dashed p-6 text-center text-sm text-muted-foreground">No courses yet. Start with the one you teach most.</p>}
            {courses?.map((c) => (
              <button key={c.id} type="button" onClick={() => { setSel(c.id); setPicked(true); window.scrollTo({ top: 0 }); }} className={`flex w-full items-center gap-3 rounded-2xl border-2 p-2 text-left transition ${sel === c.id ? 'border-foreground bg-muted/40' : 'border-border/60 hover:bg-muted/30'}`}>
                {c.coverUrl ? <img src={c.coverUrl} alt="" className="h-14 w-14 shrink-0 rounded-xl object-cover" /> : <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl text-xl font-black text-white" style={{ background: `linear-gradient(135deg, ${docBrand.color || '#1c1917'}, ${docBrand.color || '#1c1917'}99)` }}>{String(c.title || '?').trim()[0]}</span>}
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-bold">{c.title}</span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground"><span className={`rounded-full px-2 py-0.5 font-bold ${c.status === 'published' ? 'bg-emerald-100 text-emerald-800' : 'bg-stone-200 text-stone-700'}`}>{c.status === 'published' ? 'Live' : 'Draft'}</span>{money(c.priceCents || 0)} · {c.lessonCount || 0} lessons · {c.enrolledCount || 0} students</span>
                </span>
              </button>
            ))}
          </div>

          {!d || !form ? <div className={`rounded-3xl border-2 border-dashed p-10 text-center text-muted-foreground ${picked ? '' : 'hidden lg:block'}`}>Choose a course, or create your first one.</div> : (
            <div className={`space-y-4 rounded-3xl border-2 border-border/60 p-3 sm:p-4 ${picked ? '' : 'hidden lg:block'}`}>
              <button type="button" onClick={() => setPicked(false)} className="text-sm font-bold text-muted-foreground lg:hidden">‹ All courses</button>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap gap-1">{(['details', 'curriculum', 'grading', 'students'] as const).map((k) => <button key={k} type="button" onClick={() => { setTab(k); if (k === 'students' && !students) api({ action: 'students', tenantId, courseId: sel }).then((r) => r.ok && setStudents(r.students)); }} className={`h-9 rounded-full px-4 text-sm font-bold capitalize ${tab === k ? 'bg-foreground text-background' : 'bg-muted/50'}`}>{k}</button>)}</div>
                <div className="flex items-center gap-2">
                  {d.course.status === 'published' && <a href={publicUrl} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-1 rounded-full border-2 px-3 text-[13px] font-bold">View page <ExternalLink className="h-3.5 w-3.5" /></a>}
                  <button type="button" disabled={!!busy} onClick={() => saveCourse({ status: d.course.status === 'published' ? 'draft' : 'published' })} className={`h-9 rounded-full px-4 text-[13px] font-bold ${d.course.status === 'published' ? 'border-2' : 'bg-emerald-600 text-white'}`}>{d.course.status === 'published' ? 'Unpublish' : 'Publish'}</button>
                </div>
              </div>

              {tab === 'details' && (
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="text-sm font-bold md:col-span-2">Title<input className={field} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>
                  <label className="text-sm font-bold md:col-span-2">Subtitle<input className={field} value={form.subtitle} onChange={(e) => setForm({ ...form, subtitle: e.target.value })} placeholder="One line on what they’ll be able to do" /></label>
                  <label className="text-sm font-bold">Price (USD — 0 for free)<input className={field} type="number" min={0} value={form.priceDollars} onChange={(e) => setForm({ ...form, priceDollars: e.target.value })} /></label>
                  <label className="text-sm font-bold">Level<input className={field} value={form.level} onChange={(e) => setForm({ ...form, level: e.target.value })} placeholder="Beginner, Advanced…" /></label>
                  <label className="text-sm font-bold">Instructor<input className={field} value={form.instructorName} onChange={(e) => setForm({ ...form, instructorName: e.target.value })} /></label>
                  <label className="text-sm font-bold">Cover image link<input className={field} value={form.coverUrl} onChange={(e) => setForm({ ...form, coverUrl: e.target.value })} placeholder="https://…" /></label>
                  <label className="text-sm font-bold md:col-span-2">What they’ll learn (one per line)<textarea className={field + ' h-28 py-2'} value={form.whatYouLearn} onChange={(e) => setForm({ ...form, whatYouLearn: e.target.value })} /></label>
                  <label className="text-sm font-bold md:col-span-2">Description<textarea className={field + ' h-40 py-2'} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
                  <label className="text-sm font-bold">Language spoken in the videos (for automatic captions)<select className={field} value={form.captionLanguage || 'en'} onChange={(e) => setForm({ ...form, captionLanguage: e.target.value })}>{Object.entries({ en: 'English', es: 'Spanish', pt: 'Portuguese', fr: 'French', it: 'Italian', de: 'German', auto: 'Detect automatically' }).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
                  <label className="flex items-start gap-3 rounded-2xl bg-muted/40 p-4 md:col-span-2"><input type="checkbox" className="mt-1" checked={form.aiTutor !== false} onChange={(e) => setForm({ ...form, aiTutor: e.target.checked })} />
                    <span><span className="block font-black">✨ AI tutor for students</span><span className="text-[12px] text-muted-foreground">Students can ask questions on any lesson. Answers come only from this course’s written lessons; anything else is sent back to you. You can read every question in Students.</span></span></label>
                  <div className="space-y-3 rounded-2xl border-2 border-dashed border-border/60 p-4 md:col-span-2">
                    <label className="flex items-start gap-3"><input type="checkbox" className="mt-1" checked={form.compliance} onChange={(e) => setForm({ ...form, compliance: e.target.checked })} />
                      <span><span className="block font-black">Track hours for a state board</span><span className="text-[12px] text-muted-foreground">Only active time counts, “Still with us?” checks run, lessons can’t be marked complete until the rules below are met, and every record is kept in a tamper-evident log. Set these to match your state’s rules.</span></span></label>
                    {form.compliance && (
                      <div className="grid gap-2 sm:grid-cols-3">
                        <label className="text-[12px] font-bold">Online hours required<input className={field} type="number" min={0} value={form.requiredOnlineHours} onChange={(e) => setForm({ ...form, requiredOnlineHours: e.target.value })} /></label>
                        <label className="text-[12px] font-bold">In-person hours required<input className={field} type="number" min={0} value={form.requiredInPersonHours} onChange={(e) => setForm({ ...form, requiredInPersonHours: e.target.value })} /></label>
                        <label className="text-[12px] font-bold">“Still with us?” every (min)<input className={field} type="number" min={0} max={60} value={form.attentionCheckMinutes} onChange={(e) => setForm({ ...form, attentionCheckMinutes: e.target.value })} /></label>
                        <label className="text-[12px] font-bold">Active time needed (% of video)<input className={field} type="number" min={0} max={100} value={form.minEngagementPct} onChange={(e) => setForm({ ...form, minEngagementPct: e.target.value })} /></label>
                        <label className="text-[12px] font-bold">Video actually watched (%)<input className={field} type="number" min={0} max={100} value={form.minWatchPct} onChange={(e) => setForm({ ...form, minWatchPct: e.target.value })} /></label>
                      </div>
                    )}
                  </div>
                  <button type="button" disabled={!!busy} onClick={() => saveCourse()} className="h-11 rounded-xl bg-foreground text-sm font-bold text-background disabled:opacity-50 md:col-span-2">{busy === 'course' ? 'Saving…' : 'Save details'}</button>
                </div>
              )}

              {tab === 'grading' && <Grading tenantId={tenantId} courseId={sel!} courseTitle={d.course.title} brand={docBrand} />}
              {tab === 'curriculum' && (
                <div className="space-y-4">
                  {modules.map((m) => (
                    <div key={m.title} className="space-y-1.5">
                      <ModuleSettings tenantId={tenantId} courseId={sel!} title={m.title} first={modules[0]?.title === m.title} cfg={(d.course.modules || {})[modKey(m.title)] || null} onSaved={() => loadCourse(sel!)} />
                      {m.lessons.map((l: any) => { const I = KIND_ICON[l.kind] || FileText; return (
                        <div key={l.id} className="flex items-center gap-2 rounded-2xl bg-muted/40 px-3 py-2 text-sm">
                          <I className="h-4 w-4 shrink-0" />
                          <span className="min-w-0 flex-1 truncate">{l.title}{l.preview && <span className="ml-2 rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-bold text-sky-800">free preview</span>}
                            {l.kind === 'video' && <span className="ml-2 text-[11px] text-muted-foreground">{l.muxStatus === 'ready' ? `✓ video${l.durationSec ? ` · ${Math.round(l.durationSec / 60)} min` : ''}` : l.muxStatus ? l.muxStatus : l.videoUrl ? '✓ link' : '⚠ no video yet'}</span>}</span>
                          <button type="button" aria-label="Move up" onClick={async () => { await api({ action: 'lesson-move', tenantId, courseId: sel, lessonId: l.id, direction: 'up' }); await loadCourse(sel!); }} className="p-1"><ArrowUp className="h-4 w-4" /></button>
                          <button type="button" aria-label="Move down" onClick={async () => { await api({ action: 'lesson-move', tenantId, courseId: sel, lessonId: l.id, direction: 'down' }); await loadCourse(sel!); }} className="p-1"><ArrowDown className="h-4 w-4" /></button>
                          <button type="button" aria-label="Edit" onClick={() => setLesson({ ...blankLesson(), ...l, videoUrl: l.videoUrl || '', downloadUrl: l.downloadUrl || '', downloadName: l.downloadName || '', minMinutes: l.minMinutes || 0, releaseAfterDays: l.releaseAfterDays || 0, quiz: l.quiz || null, flashcards: l.flashcards || [], activity: l.activity || null, blocks: l.blocks || [], plan: l.plan || null, assignment: l.assignment || null, cases: l.cases || null, videoQuestions: l.videoQuestions || [], transcript: l.transcript || null })} className="p-1"><Pencil className="h-4 w-4" /></button>
                          <button type="button" aria-label="Delete" onClick={async () => { if (window.confirm(`Delete “${l.title}”?`)) { await api({ action: 'lesson-delete', tenantId, courseId: sel, lessonId: l.id }); await loadCourse(sel!); } }} className="p-1 text-red-600"><Trash2 className="h-4 w-4" /></button>
                        </div>
                      ); })}
                    </div>
                  ))}
                  {!lesson && <button type="button" onClick={() => setLesson(blankLesson(modules[modules.length - 1]?.title))} className="inline-flex h-10 items-center gap-1.5 rounded-xl border-2 border-dashed px-4 text-sm font-bold"><Plus className="h-4 w-4" />Add a lesson</button>}

                  {lesson && (
                    <div className="space-y-3 rounded-2xl border-2 border-foreground/30 p-4">
                      <p className="font-black">{lesson.id ? 'Edit lesson' : 'New lesson'}</p>
                      <div className="grid gap-2 md:grid-cols-2">
                        <label className="text-sm font-bold">Module<input className={field} value={lesson.moduleTitle} onChange={(e) => setLesson({ ...lesson, moduleTitle: e.target.value })} list="cf-modules" /></label>
                        <datalist id="cf-modules">{modules.map((m) => <option key={m.title} value={m.title} />)}</datalist>
                        <label className="text-sm font-bold">Lesson title<input className={field} value={lesson.title} onChange={(e) => setLesson({ ...lesson, title: e.target.value })} /></label>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {(['video', 'text', 'download', 'assignment'] as const).map((k) => <button key={k} type="button" onClick={() => setLesson({ ...lesson, kind: k, ...(k === 'assignment' && !lesson.assignment ? { assignment: { prompt: '', type: 'any', rubric: [{ criterion: 'Accuracy', points: 40 }, { criterion: 'Infection control & safety', points: 30 }, { criterion: 'Presentation', points: 30 }], dueDays: 7, resubmit: true } } : {}) })} className={`h-9 rounded-full px-4 text-sm font-bold capitalize ${lesson.kind === k ? 'bg-foreground text-background' : 'bg-muted/50'}`}>{k}</button>)}
                        <label className="ml-auto inline-flex items-center gap-2 text-sm font-bold"><input type="checkbox" checked={lesson.preview} onChange={(e) => setLesson({ ...lesson, preview: e.target.checked })} />Free preview</label>
                      </div>
                      {lesson.kind === 'video' && (
                        <div className="space-y-2 rounded-2xl bg-muted/40 p-3">
                          {d.mux ? (
                            <div>
                              <p className="text-sm font-bold">Upload a video (protected — only enrolled students can watch)</p>
                              <input type="file" accept="video/*" disabled={!!upload || !lesson.title.trim()} onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadVideo(f); }} className="mt-1 text-sm" />
                              {!lesson.title.trim() && <p className="text-[12px] text-muted-foreground">Give the lesson a title first.</p>}
                              {upload && <div className="mt-2"><div className="h-2 rounded-full bg-background"><div className="h-2 rounded-full bg-foreground transition-all" style={{ width: `${upload.pct}%` }} /></div><p className="mt-1 text-[12px]">{upload.status === 'uploading' ? `Uploading… ${upload.pct}%` : 'Processing on Mux — you can keep working; it finishes on its own.'}</p></div>}
                            </div>
                          ) : null}
                          {lesson.id && (d.lessons || []).find((x: any) => x.id === lesson.id)?.muxAssetId && (() => { const lx = (d.lessons || []).find((x: any) => x.id === lesson.id); return (
                            <div className="flex flex-wrap items-center gap-2 rounded-xl bg-background px-3 py-2 text-[12px]">
                              <span className="font-bold">Captions: {lx.transcript ? '✓ ready (transcript saved)' : lx.captions?.status === 'ready' ? '✓ ready' : lx.captions ? 'being made — usually a few minutes' : 'none yet'}</span>
                              {!lx.captions && <button type="button" onClick={async () => { const r = await api({ action: 'captions-add', tenantId, courseId: sel, lessonId: lesson.id }); setMsg(r.ok ? 'Captions requested — check back in a few minutes.' : r.error); await loadCourse(sel!); }} className="rounded-full border-2 px-2 py-0.5 font-bold">Add captions</button>}
                              {lx.captions && !lx.transcript && <button type="button" onClick={async () => { await api({ action: 'video-status', tenantId, courseId: sel, lessonId: lesson.id }); await loadCourse(sel!); }} className="rounded-full border-2 px-2 py-0.5 font-bold">Check again</button>}
                              {lx.transcript && <details className="w-full"><summary className="cursor-pointer font-bold">Read the transcript</summary><p className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap">{lx.transcript}</p></details>}
                            </div>
                          ); })()}
                          <label className="text-sm font-bold">{d.mux ? '…or a video link' : 'Video link (private Vimeo or unlisted YouTube)'}<input className={field} value={lesson.videoUrl} onChange={(e) => setLesson({ ...lesson, videoUrl: e.target.value })} placeholder="https://vimeo.com/…" /></label>
                        </div>
                      )}
                      <label className="text-sm font-bold">{lesson.kind === 'text' ? 'Lesson' : 'Notes (optional)'}<textarea className={field + ' h-40 py-2'} value={lesson.body} onChange={(e) => setLesson({ ...lesson, body: e.target.value })} placeholder="Write the lesson. Blank lines make paragraphs; a line starting with # is a heading." /></label>
                      {(lesson.kind === 'download' || lesson.downloadUrl) && (
                        <div className="grid gap-2 md:grid-cols-2">
                          <label className="text-sm font-bold">Download link<input className={field} value={lesson.downloadUrl} onChange={(e) => setLesson({ ...lesson, downloadUrl: e.target.value })} placeholder="https://… (PDF, worksheet…)" /></label>
                          <label className="text-sm font-bold">Download name<input className={field} value={lesson.downloadName} onChange={(e) => setLesson({ ...lesson, downloadName: e.target.value })} placeholder="Nail anatomy worksheet" /></label>
                        </div>
                      )}
                      <div className="grid gap-2 md:grid-cols-2">
                        <label className="text-sm font-bold">Minimum active minutes (optional — e.g. for reading lessons)<input className={field} type="number" min={0} value={lesson.minMinutes || 0} onChange={(e) => setLesson({ ...lesson, minMinutes: Number(e.target.value) || 0 })} /></label>
                        <label className="text-sm font-bold">Unlocks after (days from the student’s start — 0 = straight away)<input className={field} type="number" min={0} value={lesson.releaseAfterDays || 0} onChange={(e) => setLesson({ ...lesson, releaseAfterDays: Number(e.target.value) || 0 })} /></label>
                      </div>
                      {lesson.kind === 'assignment' && lesson.assignment && (
                        <div className="space-y-2 rounded-2xl border-2 border-amber-200 bg-amber-50/60 p-3">
                          <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-black">Assignment</p>
                            <button type="button" onClick={async () => { const focus = window.prompt('Anything to focus on? (optional — e.g. “photograph each stage of a basic manicure”)') ?? ''; setMsg('Drafting the assignment…'); const r = await api({ action: 'ai-assignment', tenantId, courseId: sel, lessonId: lesson.id || null, type: lesson.assignment.type, focus }); if (r.ok) { setLesson({ ...lesson, assignment: r.assignment }); setMsg('Assignment drafted — read it through, adjust, then Save lesson.'); } else setMsg(r.error); }} className="h-8 rounded-full bg-violet-100 px-3 text-[12px] font-bold text-violet-900">✨ Draft assignment</button></div>
                          <textarea rows={4} className={field + ' h-auto py-2'} value={lesson.assignment.prompt} onChange={(e) => setLesson({ ...lesson, assignment: { ...lesson.assignment, prompt: e.target.value } })} placeholder="What should the student do and hand in? e.g. Perform a basic manicure on a mannequin hand; photograph each stage; explain your infection-control steps." />
                          <div className="grid gap-2 sm:grid-cols-3">
                            <label className="text-[12px] font-bold">They hand in<select className={field} value={lesson.assignment.type} onChange={(e) => setLesson({ ...lesson, assignment: { ...lesson.assignment, type: e.target.value } })}><option value="any">Writing and/or photos & files</option><option value="written">Writing</option><option value="photo">Photos</option><option value="file">A file</option></select></label>
                            <label className="text-[12px] font-bold">Due (days after starting — blank = none)<input type="number" className={field} value={lesson.assignment.dueDays || ''} onChange={(e) => setLesson({ ...lesson, assignment: { ...lesson.assignment, dueDays: e.target.value } })} /></label>
                            <label className="flex items-center gap-2 text-[12px] font-bold"><input type="checkbox" checked={lesson.assignment.resubmit !== false} onChange={(e) => setLesson({ ...lesson, assignment: { ...lesson.assignment, resubmit: e.target.checked } })} />Can be resubmitted after grading</label>
                          </div>
                          <p className="text-[12px] font-black">Rubric <span className="font-normal text-muted-foreground">· {(lesson.assignment.rubric || []).reduce((n: number, r: any) => n + (Number(r.points) || 0), 0)} points</span></p>
                          {(lesson.assignment.rubric || []).map((r: any, i: number) => <div key={i} className="flex gap-2"><input className={field} value={r.criterion} onChange={(e) => { const rb = [...lesson.assignment.rubric]; rb[i] = { ...r, criterion: e.target.value }; setLesson({ ...lesson, assignment: { ...lesson.assignment, rubric: rb } }); }} placeholder="Criterion" /><input type="number" className={`${field} w-24`} value={r.points} onChange={(e) => { const rb = [...lesson.assignment.rubric]; rb[i] = { ...r, points: e.target.value }; setLesson({ ...lesson, assignment: { ...lesson.assignment, rubric: rb } }); }} title="Points" /><button type="button" onClick={() => setLesson({ ...lesson, assignment: { ...lesson.assignment, rubric: lesson.assignment.rubric.filter((_: any, k: number) => k !== i) } })} className="text-red-600" aria-label="Remove"><Trash2 className="h-4 w-4" /></button></div>)}
                          <button type="button" onClick={() => setLesson({ ...lesson, assignment: { ...lesson.assignment, rubric: [...(lesson.assignment.rubric || []), { criterion: '', points: 10 }] } })} className="rounded-full bg-background px-3 py-1 text-[12px] font-bold">+ Criterion</button>
                        </div>
                      )}
                      <BlocksEditor tenantId={tenantId} courseId={sel!} lessonId={lesson.id || null} accent={docBrand.color} value={lesson.blocks || []} onChange={(blocks) => setLesson({ ...lesson, blocks })} />
                      <CasesEditor tenantId={tenantId} courseId={sel!} lesson={lesson} onChange={(cases) => setLesson({ ...lesson, cases })} />
                      {lesson.kind === 'video' && <VideoQuestionsEditor tenantId={tenantId} courseId={sel!} lesson={lesson} onChange={(videoQuestions) => setLesson({ ...lesson, videoQuestions })} />}
                      <PlanEditor tenantId={tenantId} courseId={sel!} lesson={lesson} value={lesson.plan} onChange={(plan) => setLesson({ ...lesson, plan })} brand={docBrand} courseTitle={d.course.title} />
                      <div className="flex flex-wrap items-center gap-1.5 rounded-2xl border-2 border-dashed border-violet-200 bg-violet-50/60 p-3">
                        <span className="mr-1 text-sm font-black">✨ Draft with AI from this lesson’s text:</span>
                        {([['quiz', 'Quiz'], ['flashcards', 'Flashcards'], ['match', 'Matching'], ['order', 'Put in order'], ['scenario', 'Client scenario']] as const).map(([k, l]) => (
                          <button key={k} type="button" disabled={!!drafting || (String(lesson.body || '').length < 120 && !lesson.transcript)} onClick={() => draft(k)} className="h-8 rounded-full bg-background px-3 text-[12px] font-bold disabled:opacity-40">{drafting === k ? 'Drafting…' : l}</button>
                        ))}
                        {String(lesson.body || '').length < 120 && !lesson.transcript && <span className="w-full text-[11px] text-muted-foreground">Write a few paragraphs of lesson text first — drafts use only what you’ve written.</span>}
                      </div>
                      <div className="space-y-2 rounded-2xl bg-muted/40 p-3">
                        <div className="flex items-center justify-between"><p className="text-sm font-black">Flashcards {lesson.flashcards?.length ? `· ${lesson.flashcards.length}` : '(optional)'}</p>
                          <button type="button" onClick={() => setLesson({ ...lesson, flashcards: [...(lesson.flashcards || []), { front: '', back: '' }] })} className="rounded-full bg-background px-3 py-1 text-[12px] font-bold">+ Card</button></div>
                        {(lesson.flashcards || []).map((f: any, i: number) => (
                          <div key={i} className="flex gap-2"><input className={field} value={f.front} placeholder="Front (term or question)" onChange={(e) => { const fs = [...lesson.flashcards]; fs[i] = { ...fs[i], front: e.target.value }; setLesson({ ...lesson, flashcards: fs }); }} /><input className={field} value={f.back} placeholder="Back (answer)" onChange={(e) => { const fs = [...lesson.flashcards]; fs[i] = { ...fs[i], back: e.target.value }; setLesson({ ...lesson, flashcards: fs }); }} /><button type="button" onClick={() => setLesson({ ...lesson, flashcards: lesson.flashcards.filter((_: any, k: number) => k !== i) })} className="p-2 text-red-600" aria-label="Remove card"><Trash2 className="h-4 w-4" /></button></div>
                        ))}
                      </div>
                      <div className="space-y-2 rounded-2xl bg-muted/40 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-black">Activity (optional)</p>
                          <select className="h-8 rounded-lg border px-2 text-[12px]" value={lesson.activity?.type || ''} onChange={(e) => { const t = e.target.value; setLesson({ ...lesson, activity: !t ? null : t === 'label' ? { type: 'label', prompt: 'Label the diagram', imageUrl: '', points: [] } : t === 'match' ? { type: 'match', prompt: 'Match each item to its pair', pairs: [{ left: '', right: '' }, { left: '', right: '' }] } : t === 'order' ? { type: 'order', prompt: 'Put these steps in order', steps: ['', ''] } : { type: 'scenario', prompt: '', options: [{ text: '', correct: true, feedback: '' }, { text: '', correct: false, feedback: '' }] } }); }}>
                            <option value="">None</option><option value="match">Match the pairs</option><option value="order">Put in order</option><option value="scenario">Client scenario</option><option value="label">Label the diagram</option></select></div>
                        {lesson.activity && <input className={field} value={lesson.activity.prompt} placeholder={lesson.activity.type === 'scenario' ? 'Describe the client situation…' : 'Instruction'} onChange={(e) => setLesson({ ...lesson, activity: { ...lesson.activity, prompt: e.target.value } })} />}
                        {lesson.activity?.type === 'label' && (
                          <div className="space-y-2">
                            <input className={field} value={lesson.activity.imageUrl} placeholder="Image link (https://…) — e.g. a nail anatomy diagram" onChange={(e) => setLesson({ ...lesson, activity: { ...lesson.activity, imageUrl: e.target.value } })} />
                            {/^https:\/\//.test(lesson.activity.imageUrl) && (
                              <>
                                <p className="text-[12px] text-muted-foreground">Click on the picture where each label belongs.</p>
                                <div className="relative inline-block max-w-full cursor-crosshair" onClick={(e) => { const r = (e.currentTarget as HTMLDivElement).getBoundingClientRect(); const label = window.prompt('Label for this spot:'); if (!label) return; setLesson({ ...lesson, activity: { ...lesson.activity, points: [...lesson.activity.points, { x: Math.round(((e.clientX - r.left) / r.width) * 1000) / 10, y: Math.round(((e.clientY - r.top) / r.height) * 1000) / 10, label }] } }); }}>
                                  <img src={lesson.activity.imageUrl} alt="Diagram" className="max-h-96 rounded-xl" />
                                  {lesson.activity.points.map((p: any, i: number) => <span key={i} className="absolute flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-foreground text-[11px] font-black text-background ring-2 ring-white" style={{ left: `${p.x}%`, top: `${p.y}%` }}>{i + 1}</span>)}
                                </div>
                                {lesson.activity.points.map((p: any, i: number) => <div key={i} className="flex items-center gap-2 text-sm"><span className="w-6 font-bold">{i + 1}</span><span className="flex-1">{p.label}</span><button type="button" onClick={() => setLesson({ ...lesson, activity: { ...lesson.activity, points: lesson.activity.points.filter((_: any, k: number) => k !== i) } })} className="text-red-600" aria-label="Remove point"><Trash2 className="h-4 w-4" /></button></div>)}
                              </>
                            )}
                          </div>
                        )}
                        {lesson.activity?.type === 'match' && lesson.activity.pairs.map((p: any, i: number) => <div key={i} className="flex gap-2"><input className={field} value={p.left} placeholder="Item" onChange={(e) => { const ps = [...lesson.activity.pairs]; ps[i] = { ...ps[i], left: e.target.value }; setLesson({ ...lesson, activity: { ...lesson.activity, pairs: ps } }); }} /><input className={field} value={p.right} placeholder="Its match" onChange={(e) => { const ps = [...lesson.activity.pairs]; ps[i] = { ...ps[i], right: e.target.value }; setLesson({ ...lesson, activity: { ...lesson.activity, pairs: ps } }); }} /></div>)}
                        {lesson.activity?.type === 'order' && lesson.activity.steps.map((x: string, i: number) => <div key={i} className="flex items-center gap-2"><span className="w-5 text-sm font-bold">{i + 1}</span><input className={field} value={x} placeholder={`Step ${i + 1} (in the correct order)`} onChange={(e) => { const st = [...lesson.activity.steps]; st[i] = e.target.value; setLesson({ ...lesson, activity: { ...lesson.activity, steps: st } }); }} /></div>)}
                        {lesson.activity?.type === 'scenario' && lesson.activity.options.map((o: any, i: number) => <div key={i} className="space-y-1 rounded-xl bg-background p-2"><div className="flex items-center gap-2"><input type="radio" name="scn-correct" checked={o.correct} onChange={() => setLesson({ ...lesson, activity: { ...lesson.activity, options: lesson.activity.options.map((x: any, k: number) => ({ ...x, correct: k === i })) } })} title="The right answer" /><input className={field} value={o.text} placeholder={`Choice ${i + 1}`} onChange={(e) => { const os = [...lesson.activity.options]; os[i] = { ...os[i], text: e.target.value }; setLesson({ ...lesson, activity: { ...lesson.activity, options: os } }); }} /></div><input className={field} value={o.feedback} placeholder="Feedback when chosen (why it’s right or wrong)" onChange={(e) => { const os = [...lesson.activity.options]; os[i] = { ...os[i], feedback: e.target.value }; setLesson({ ...lesson, activity: { ...lesson.activity, options: os } }); }} /></div>)}
                        {lesson.activity && !['scenario', 'label'].includes(lesson.activity.type) && <button type="button" onClick={() => setLesson({ ...lesson, activity: lesson.activity.type === 'match' ? { ...lesson.activity, pairs: [...lesson.activity.pairs, { left: '', right: '' }] } : { ...lesson.activity, steps: [...lesson.activity.steps, ''] } })} className="rounded-full bg-background px-3 py-1 text-[12px] font-bold">+ Add</button>}
                        {lesson.activity?.type === 'scenario' && <button type="button" onClick={() => setLesson({ ...lesson, activity: { ...lesson.activity, options: [...lesson.activity.options, { text: '', correct: false, feedback: '' }] } })} className="rounded-full bg-background px-3 py-1 text-[12px] font-bold">+ Choice</button>}
                      </div>
                      <div className="space-y-2 rounded-2xl bg-muted/40 p-3">
                        <div className="flex items-center justify-between"><p className="text-sm font-black">Quiz {lesson.quiz?.questions?.length ? `· ${lesson.quiz.questions.length} questions` : '(optional)'}</p>
                          <button type="button" onClick={() => setLesson({ ...lesson, quiz: { passPct: lesson.quiz?.passPct || 80, questions: [...(lesson.quiz?.questions || []), { q: '', options: ['', '', '', ''], answer: 0 }] } })} className="rounded-full bg-background px-3 py-1 text-[12px] font-bold">+ Question</button></div>
                        {lesson.quiz?.questions?.length > 0 && <label className="text-[12px] font-bold">Pass mark (%)<input className={field} type="number" min={1} max={100} value={lesson.quiz.passPct} onChange={(e) => setLesson({ ...lesson, quiz: { ...lesson.quiz, passPct: Number(e.target.value) || 80 } })} /></label>}
                        {(lesson.quiz?.questions || []).map((q: any, qi: number) => {
                          const setQ = (patch: any) => { const qs = [...lesson.quiz.questions]; qs[qi] = { ...qs[qi], ...patch }; setLesson({ ...lesson, quiz: { ...lesson.quiz, questions: qs } }); };
                          return (
                            <div key={qi} className="space-y-1.5 rounded-xl bg-background p-3">
                              <div className="flex gap-2"><input className={field} value={q.q} onChange={(e) => setQ({ q: e.target.value })} placeholder={`Question ${qi + 1}`} /><button type="button" onClick={() => setLesson({ ...lesson, quiz: { ...lesson.quiz, questions: lesson.quiz.questions.filter((_: any, k: number) => k !== qi) } })} className="p-2 text-red-600" aria-label="Remove question"><Trash2 className="h-4 w-4" /></button></div>
                              {q.options.map((o: string, oi: number) => (
                                <label key={oi} className="flex items-center gap-2 text-sm"><input type="radio" name={`ans-${qi}`} checked={q.answer === oi} onChange={() => setQ({ answer: oi })} title="Correct answer" />
                                  <input className="h-9 flex-1 rounded-lg border px-2 text-sm" value={o} onChange={(e) => { const os = [...q.options]; os[oi] = e.target.value; setQ({ options: os }); }} placeholder={`Option ${oi + 1}${oi === q.answer ? ' (correct)' : ''}`} /></label>
                              ))}
                              <p className="text-[11px] text-muted-foreground">Tick the correct answer. Students never see it — marking happens on the server.</p>
                            </div>
                          );
                        })}
                      </div>
                      <div className="flex gap-2">
                        <button type="button" disabled={!!busy || !lesson.title.trim()} onClick={async () => { const id = await saveLesson(); if (id) { setLesson(null); setMsg('Lesson saved.'); } }} className="h-10 rounded-xl bg-foreground px-5 text-sm font-bold text-background disabled:opacity-50">{busy === 'lesson' ? 'Saving…' : 'Save lesson'}</button>
                        <button type="button" onClick={() => setLesson(null)} className="h-10 rounded-xl px-4 text-sm font-bold text-muted-foreground">Close</button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {trx && (
                <div className="space-y-3 rounded-2xl border-2 border-foreground/40 p-4" id="cf-transcript">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div><p className="text-lg font-black">Transcript · {trx.transcript.student.name || trx.transcript.student.email}</p><p className="text-[12px] text-muted-foreground">{trx.course?.title} · generated {new Date().toLocaleString()}</p></div>
                    <div className="flex gap-2 print:hidden">
                      <button type="button" onClick={() => window.print()} className="h-9 rounded-full border-2 px-3 text-[12px] font-bold">Print</button>
                      <button type="button" onClick={() => { const T = trx.transcript; const rows = [['Type', 'Date', 'Detail', 'Minutes', 'Status / checks'], ...T.sessions.map((x: any) => ['Online', x.startedAt, x.lessonId, Math.round((x.engagedSec || 0) / 60), `checks ${x.checksPassed || 0}/${x.checksIssued || 0}`]), ...T.punches.map((p: any) => ['In person', p.clockInAt, `out ${p.clockOutAt || '—'}`, p.minutes || 0, `${p.status}${p.corrections?.length ? ` (corrected ${p.corrections.length}×)` : ''}`])]; const blob = new Blob([csv(rows)], { type: 'text/csv' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `transcript-${T.student.email}.csv`; a.click(); }} className="h-9 rounded-full border-2 px-3 text-[12px] font-bold">CSV</button>
                      <button type="button" onClick={() => setTrx(null)} className="h-9 rounded-full px-3 text-[12px] font-bold text-muted-foreground">Close</button>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
                    {[['Online (verified)', `${trx.transcript.totals.onlineHours} h${trx.course?.requiredOnlineHours ? ` / ${trx.course.requiredOnlineHours}` : ''}`], ['In person (approved)', `${trx.transcript.totals.inPersonHours} h${trx.course?.requiredInPersonHours ? ` / ${trx.course.requiredInPersonHours}` : ''}`], ['Attention checks missed', `${trx.transcript.totals.checksMissed} of ${trx.transcript.totals.checksIssued}`], ['Punches to resolve', trx.transcript.totals.flaggedPunches]].map(([l, v]) => (
                      <div key={String(l)} className="rounded-2xl bg-muted/40 p-3"><p className="text-lg font-black">{v}</p><p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{l}</p></div>
                    ))}
                  </div>
                  <details open className="text-sm"><summary className="cursor-pointer font-bold">Online sessions ({trx.transcript.sessions.length})</summary>
                    <div className="mt-1 space-y-0.5">{trx.transcript.sessions.map((x: any) => <p key={x.id} className="text-[12px]">{dt(x.startedAt)} · {(d?.lessons || []).find((l: any) => l.id === x.lessonId)?.title || x.lessonId} · <span className="font-bold">{Math.round((x.engagedSec || 0) / 60)} active min</span> ({Math.round((x.idleSec || 0) / 60)} idle) · checks {x.checksPassed || 0}/{x.checksIssued || 0}{x.checksMissed ? ` · ${x.checksMissed} missed` : ''}</p>)}</div></details>
                  <details open className="text-sm"><summary className="cursor-pointer font-bold">In-person attendance ({trx.transcript.punches.length})</summary>
                    <div className="mt-1 space-y-0.5">{trx.transcript.punches.map((p: any) => <p key={p.id} className="text-[12px]">{dt(p.clockInAt)} → {p.clockOutAt ? new Date(p.clockOutAt).toLocaleTimeString() : '—'} · <span className="font-bold">{hm(p.minutes)}</span> · {p.status}{p.approvedBy ? ` by ${p.approvedBy}` : ''}{p.corrections?.length ? ` · corrected: ${p.corrections.map((c: any) => `“${c.reason}” (${c.by})`).join('; ')}` : ''}{p.in?.distanceM != null ? ` · ${p.in.distanceM} m away` : ''}</p>)}</div></details>
                  <p className="text-[11px] text-muted-foreground">Every entry above is also in the tamper-evident audit log (Attendance → Verify records).</p>
                </div>
              )}

              {tab === 'students' && (
                <details className="rounded-2xl bg-muted/40 p-3 text-sm" onToggle={(e) => { if ((e.target as HTMLDetailsElement).open && !tutorLog) api({ action: 'tutor-log', tenantId, courseId: sel }).then((r) => r.ok && setTutorLog(r.log)); }}>
                  <summary className="cursor-pointer font-bold">✨ What students asked the tutor</summary>
                  {!tutorLog ? <Loader className="mt-2 h-4 w-4 animate-spin" /> : tutorLog.length === 0 ? <p className="mt-1 text-muted-foreground">No questions yet.</p> : (
                    <div className="mt-2 max-h-80 space-y-2 overflow-y-auto">{tutorLog.map((x, i) => <div key={i} className="rounded-xl bg-background p-2"><p className="font-bold">{x.question}</p><p className="whitespace-pre-wrap text-[12px] text-muted-foreground">{x.answer}</p><p className="text-[10px] text-muted-foreground">{x.email} · {new Date(x.at).toLocaleString()}</p></div>)}</div>
                  )}
                </details>
              )}
              {tab === 'students' && (
                <div className="space-y-1.5">
                  {!students && <Loader className="h-5 w-5 animate-spin" />}
                  {students?.length === 0 && <p className="text-sm text-muted-foreground">No students yet. Share your course page to get your first.</p>}
                  {students?.map((s) => (
                    <div key={s.email} className="flex items-center justify-between gap-3 rounded-2xl bg-muted/40 px-3 py-2 text-sm">
                      <button type="button" onClick={async () => { const r = await api({ action: 'transcript', tenantId, studentId: s.studentId, courseId: sel }); if (r.ok) setTrx(r); else setMsg(r.error); }} className="min-w-0 truncate text-left underline-offset-2 hover:underline">{s.email} <span className="text-muted-foreground">· since {new Date(s.since).toLocaleDateString()} · {money(s.paidCents)} · {s.onlineHours} h online{s.certificateCode ? ' · 🎓' : ''}</span></button>
                      <span className="flex w-40 shrink-0 items-center gap-2"><span className="h-1.5 flex-1 rounded-full bg-background"><span className="block h-1.5 rounded-full bg-foreground" style={{ width: `${s.pct || 0}%` }} /></span><span className="text-[12px] font-bold">{s.pct || 0}%</span></span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>}
            </div>
          </div>
        </div>
      </main>

      {/* Phones: the Academy's tab bar — every section is two taps away. */}
      <nav aria-label="Academy sections" className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
        <div className="mx-auto flex max-w-lg">{TABS.map((t) => { const I = t.icon; const on = activeTab === t.key; const n = badgeOf(t); return (
          <button key={t.key} type="button" onClick={() => { if (t.key === 'today') go('home'); else { setHub(t.key); setPicked(false); window.scrollTo({ top: 0 }); } }} aria-current={on ? 'page' : undefined}
            className={`relative flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[11px] font-bold ${on ? 'text-foreground' : 'text-muted-foreground'}`}>
            <span className={`flex h-8 w-12 items-center justify-center rounded-full ${on ? 'bg-foreground text-background' : ''}`}><I className="h-5 w-5" /></span>{t.label}
            {n > 0 && <span className="absolute right-[18%] top-1.5 min-w-[18px] rounded-full bg-red-500 px-1 text-[10px] font-black leading-[18px] text-white">{n > 99 ? '99+' : n}</span>}
          </button>
        ); })}</div>
      </nav>
    </div>
  );
}
