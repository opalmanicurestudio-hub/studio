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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getAuth } from 'firebase/auth';
import { Loader, ArrowUp, ArrowDown, Pencil, Trash2, ExternalLink, Video, FileText, Download, Plus } from 'lucide-react';
import { AppHeader } from '@/components/shared/AppHeader';
import { PrivateImg } from '@/components/shared/private-file';
import { SchoolPrograms } from '@/components/academy/SchoolPrograms';
import { StudentSalon } from '@/components/academy/StudentSalon';
import { AdmissionsBoard } from '@/components/academy/AdmissionsBoard';
import { useTenant } from '@/context/TenantContext';

async function api(body: any) {
  const u = getAuth().currentUser; const tk = u ? await u.getIdToken() : '';
  const r = await fetch('/api/academy/admin', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tk}` }, body: JSON.stringify(body) });
  return r.json().catch(() => ({ ok: false, error: 'No response' }));
}
const money = (c: number) => (c ? `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: c % 100 ? 2 : 0 })}` : 'Free');
const field = 'h-11 w-full rounded-xl border-2 border-border/60 bg-background px-3 text-sm';
const KIND_ICON: Record<string, any> = { video: Video, text: FileText, download: Download };
const blankLesson = (moduleTitle = 'Module 1') => ({ id: '', title: '', moduleTitle, kind: 'video', body: '', videoUrl: '', downloadUrl: '', downloadName: '', preview: false, minMinutes: 0, quiz: null as any });
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
  const [tab, setTab] = useState<'details' | 'curriculum' | 'students' | 'attendance'>('details');
  const [att, setAtt] = useState<any>(null);
  const [trx, setTrx] = useState<any>(null);
  const [audit, setAudit] = useState<any>(null);
  const [form, setForm] = useState<any>(null);
  const [lesson, setLesson] = useState<any>(null);   // the lesson being edited
  const [students, setStudents] = useState<any[] | null>(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState('');
  const [upload, setUpload] = useState<{ lessonId: string; pct: number; status: string } | null>(null);
  const poll = useRef<number | null>(null);
  // Online courses only, or a licensed school (programs + student salon too).
  const [mode, setMode] = useState<'courses' | 'school' | null>(null);
  const [section, setSection] = useState<'courses' | 'programs' | 'admissions' | 'salon'>('courses');
  useEffect(() => { if (!tenantId) return; (async () => { const u = getAuth().currentUser; const tk = u ? await u.getIdToken() : ''; const r = await fetch('/api/academy/school', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tk}` }, body: JSON.stringify({ action: 'overview', tenantId }) }).then((x) => x.json()).catch(() => null); setMode(r?.mode || 'courses'); })(); }, [tenantId]);
  const changeMode = async (m: 'courses' | 'school') => { const u = getAuth().currentUser; const tk = u ? await u.getIdToken() : ''; const r = await fetch('/api/academy/school', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tk}` }, body: JSON.stringify({ action: 'mode', tenantId, mode: m }) }).then((x) => x.json()).catch(() => null); if (r?.ok) { setMode(m); if (m === 'courses') setSection('courses'); } else setMsg(r?.error || 'Couldn’t change the mode.'); };

  const loadList = useCallback(async () => { if (!tenantId) return; const r = await api({ action: 'list', tenantId }); if (r.ok) setCourses(r.courses); else setMsg(r.error); }, [tenantId]);
  const loadCourse = useCallback(async (id: string) => {
    const r = await api({ action: 'course-get', tenantId, courseId: id });
    if (!r.ok) { setMsg(r.error); return; }
    setD(r);
    const c = r.course;
    setForm({ id: c.id, title: c.title, subtitle: c.subtitle || '', priceDollars: (c.priceCents || 0) / 100, level: c.level || '', instructorName: c.instructorName || '', coverUrl: c.coverUrl || '', whatYouLearn: (c.whatYouLearn || []).join('\n'), description: c.description || '', status: c.status || 'draft',
      compliance: !!c.compliance, requiredOnlineHours: c.requiredOnlineHours || '', requiredInPersonHours: c.requiredInPersonHours || '', minEngagementPct: c.minEngagementPct ?? 80, minWatchPct: c.minWatchPct ?? 90, attentionCheckMinutes: c.attentionCheckMinutes ?? 10 });
  }, [tenantId]);
  useEffect(() => { void loadList(); }, [loadList]);
  useEffect(() => { if (sel) { void loadCourse(sel); setStudents(null); setLesson(null); } }, [sel, loadCourse]);
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
    if (r.ok) { await loadList(); setSel(r.id); setTab('details'); } else setMsg(r.error);
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

  return (
    <div className="min-h-screen bg-background">
      <AppHeader title="Academy" />
      <main className="mx-auto max-w-6xl space-y-4 px-4 pb-24 pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div><h1 className="text-2xl font-black tracking-tight">Academy</h1><p className="text-sm text-muted-foreground">Build courses, sell them online, and see how students are doing.</p></div>
          <div className="flex gap-2">
            {tenantId && <a href={`/learn/${tenantId}`} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center gap-1.5 rounded-xl border-2 px-3 text-sm font-bold">Your academy page <ExternalLink className="h-3.5 w-3.5" /></a>}
            <button type="button" onClick={newCourse} className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-foreground px-4 text-sm font-bold text-background"><Plus className="h-4 w-4" />New course</button>
          </div>
        </div>
        {mode && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-muted/40 p-2">
            <div className="flex gap-1">
              {([['courses', 'Courses'], ...(mode === 'school' ? [['programs', 'Programs'], ['admissions', 'Admissions'], ['salon', 'Student salon']] : [])] as [string, string][]).map(([k, l]) => <button key={k} type="button" onClick={() => setSection(k as any)} className={`h-9 rounded-full px-4 text-sm font-bold ${section === k ? 'bg-foreground text-background' : ''}`}>{l}</button>)}
            </div>
            <div className="flex items-center gap-1 text-[12px]">
              <span className="font-bold text-muted-foreground">Academy type:</span>
              <button type="button" onClick={() => changeMode('courses')} className={`rounded-full px-3 py-1.5 font-bold ${mode === 'courses' ? 'bg-foreground text-background' : 'bg-background'}`}>Online courses</button>
              <button type="button" onClick={() => { if (mode !== 'school' && !window.confirm('Switch on licensed-school tools? Programs, hours requirements, the student salon and check-offs become available. Your online courses keep working as they are.')) return; void changeMode('school'); }} className={`rounded-full px-3 py-1.5 font-bold ${mode === 'school' ? 'bg-foreground text-background' : 'bg-background'}`}>Licensed school</button>
            </div>
          </div>
        )}
        {msg && <p className="rounded-2xl border-2 border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">{msg}</p>}
        {section === 'programs' && mode === 'school' && <SchoolPrograms tenantId={tenantId} courses={courses || []} />}
        {section === 'salon' && mode === 'school' && <StudentSalon tenantId={tenantId} />}
        {section === 'admissions' && mode === 'school' && <AdmissionsBoard tenantId={tenantId} />}
        {d && !d.mux && <p className="rounded-2xl border-2 border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Video hosting isn’t connected yet — you can paste a private Vimeo or unlisted YouTube link for now. Add MUX_TOKEN_ID, MUX_TOKEN_SECRET, MUX_SIGNING_KEY_ID and MUX_SIGNING_KEY_PRIVATE in Vercel to upload protected videos.</p>}

        {section === 'courses' && <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
          <div className="space-y-2">
            {!courses && <Loader className="h-5 w-5 animate-spin" />}
            {courses?.length === 0 && <p className="rounded-2xl border-2 border-dashed p-6 text-center text-sm text-muted-foreground">No courses yet. Start with the one you teach most.</p>}
            {courses?.map((c) => (
              <button key={c.id} type="button" onClick={() => setSel(c.id)} className={`block w-full rounded-2xl border-2 p-3 text-left ${sel === c.id ? 'border-foreground' : 'border-border/60'}`}>
                <p className="truncate font-bold">{c.title}</p>
                <p className="text-[12px] text-muted-foreground">{c.status === 'published' ? '● Live' : '○ Draft'} · {money(c.priceCents || 0)} · {c.lessonCount || 0} lessons · {c.enrolledCount || 0} students</p>
              </button>
            ))}
          </div>

          {!d || !form ? <div className="rounded-3xl border-2 border-dashed p-10 text-center text-muted-foreground">Choose a course, or create your first one.</div> : (
            <div className="space-y-4 rounded-3xl border-2 border-border/60 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap gap-1">{(['details', 'curriculum', 'students', 'attendance'] as const).map((k) => <button key={k} type="button" onClick={() => { setTab(k); if (k === 'students' && !students) api({ action: 'students', tenantId, courseId: sel }).then((r) => r.ok && setStudents(r.students)); if (k === 'attendance') api({ action: 'attendance', tenantId }).then((r) => r.ok && setAtt(r)); }} className={`h-9 rounded-full px-4 text-sm font-bold capitalize ${tab === k ? 'bg-foreground text-background' : 'bg-muted/50'}`}>{k}</button>)}</div>
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

              {tab === 'curriculum' && (
                <div className="space-y-4">
                  {modules.map((m) => (
                    <div key={m.title} className="space-y-1.5">
                      <p className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">{m.title}</p>
                      {m.lessons.map((l: any) => { const I = KIND_ICON[l.kind] || FileText; return (
                        <div key={l.id} className="flex items-center gap-2 rounded-2xl bg-muted/40 px-3 py-2 text-sm">
                          <I className="h-4 w-4 shrink-0" />
                          <span className="min-w-0 flex-1 truncate">{l.title}{l.preview && <span className="ml-2 rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-bold text-sky-800">free preview</span>}
                            {l.kind === 'video' && <span className="ml-2 text-[11px] text-muted-foreground">{l.muxStatus === 'ready' ? `✓ video${l.durationSec ? ` · ${Math.round(l.durationSec / 60)} min` : ''}` : l.muxStatus ? l.muxStatus : l.videoUrl ? '✓ link' : '⚠ no video yet'}</span>}</span>
                          <button type="button" aria-label="Move up" onClick={async () => { await api({ action: 'lesson-move', tenantId, courseId: sel, lessonId: l.id, direction: 'up' }); await loadCourse(sel!); }} className="p-1"><ArrowUp className="h-4 w-4" /></button>
                          <button type="button" aria-label="Move down" onClick={async () => { await api({ action: 'lesson-move', tenantId, courseId: sel, lessonId: l.id, direction: 'down' }); await loadCourse(sel!); }} className="p-1"><ArrowDown className="h-4 w-4" /></button>
                          <button type="button" aria-label="Edit" onClick={() => setLesson({ ...blankLesson(), ...l, videoUrl: l.videoUrl || '', downloadUrl: l.downloadUrl || '', downloadName: l.downloadName || '', minMinutes: l.minMinutes || 0, releaseAfterDays: l.releaseAfterDays || 0, quiz: l.quiz || null })} className="p-1"><Pencil className="h-4 w-4" /></button>
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
                        {(['video', 'text', 'download'] as const).map((k) => <button key={k} type="button" onClick={() => setLesson({ ...lesson, kind: k })} className={`h-9 rounded-full px-4 text-sm font-bold capitalize ${lesson.kind === k ? 'bg-foreground text-background' : 'bg-muted/50'}`}>{k}</button>)}
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

              {tab === 'attendance' && (
                <div className="space-y-4">
                  {!att ? <Loader className="h-5 w-5 animate-spin" /> : (
                    <>
                      <div className="flex flex-wrap items-center gap-2">
                        <a href="/academy-screen" target="_blank" rel="noreferrer" className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-foreground px-4 text-sm font-bold text-background">Open the clock-in screen <ExternalLink className="h-3.5 w-3.5" /></a>
                        <button type="button" onClick={async () => { setAudit({ loading: true }); setAudit(await api({ action: 'audit-verify', tenantId })); }} className="h-10 rounded-xl border-2 px-4 text-sm font-bold">Verify records</button>
                        <button type="button" onClick={async () => setAtt(await api({ action: 'attendance', tenantId }))} className="h-10 rounded-xl px-3 text-sm font-bold text-muted-foreground">Refresh</button>
                      </div>
                      {audit && !audit.loading && (
                        <div className={`rounded-2xl p-3 text-sm ${audit.verified ? 'bg-emerald-50 text-emerald-900' : 'bg-red-50 text-red-900'}`}>
                          <p className="font-black">{audit.verified ? `✓ Records intact — all ${audit.checked} entries verified` : `✕ ${audit.problem}`}</p>
                          <details className="mt-1"><summary className="cursor-pointer text-[12px]">Latest entries</summary>{(audit.recent || []).map((e: any) => <p key={e.seq} className="text-[12px]">#{e.seq} · {dt(e.at)} · {e.by} · {e.summary}</p>)}</details>
                        </div>
                      )}
                      <div className="grid gap-2 rounded-2xl bg-muted/40 p-3 text-sm sm:grid-cols-3">
                        <label className="flex items-center gap-2"><input type="checkbox" checked={!!att.settings.requireGeo} onChange={async (e) => { const r = await api({ action: 'academy-settings', tenantId, requireGeo: e.target.checked }); if (r.ok) setAtt({ ...att, settings: r.settings }); else setMsg(r.error); }} />Require being on site (location)</label>
                        <label className="flex items-center gap-2"><input type="checkbox" checked={!!att.settings.requirePhoto} onChange={async (e) => { const r = await api({ action: 'academy-settings', tenantId, requirePhoto: e.target.checked }); if (r.ok) setAtt({ ...att, settings: r.settings }); else setMsg(r.error); }} />Require a photo at clock-in and out</label>
                        <label className="flex items-center gap-2"><input type="checkbox" checked={!!att.settings.requireApproval} onChange={async (e) => { const r = await api({ action: 'academy-settings', tenantId, requireApproval: e.target.checked }); if (r.ok) setAtt({ ...att, settings: r.settings }); else setMsg(r.error); }} />Instructor approves every day’s hours</label>
                        <button type="button" onClick={() => navigator.geolocation?.getCurrentPosition(async (p) => { const r = await api({ action: 'academy-settings', tenantId, geo: { lat: p.coords.latitude, lng: p.coords.longitude, radiusM: 150 } }); if (r.ok) { setAtt({ ...att, settings: r.settings }); setMsg('Academy location saved (150 m radius). Do this while standing at the academy.'); } }, () => setMsg('Allow location to set the academy’s position.'), { enableHighAccuracy: true })} className="rounded-xl border-2 px-3 py-2 text-left text-[12px] font-bold">{att.settings.geo ? `✓ Location set (${att.settings.geo.radiusM} m) — reset here` : 'Set the academy’s location (do this on site)'}</button>
                      </div>
                      {(() => { const need = att.punches.filter((p: any) => ['open', 'flagged', 'pending'].includes(p.status)); return (
                        <div className="space-y-1.5">
                          <p className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">Needs attention · {need.length}</p>
                          {need.length === 0 && <p className="text-sm text-muted-foreground">Nothing to resolve.</p>}
                          {need.map((p: any) => (
                            <div key={p.id} className={`flex flex-wrap items-center gap-2 rounded-2xl px-3 py-2 text-sm ${p.status === 'flagged' ? 'bg-red-50' : p.status === 'open' ? 'bg-sky-50' : 'bg-amber-50'}`}>
                              {(p.in?.photo?.ref || p.out?.photo?.ref) && (
                                <span className="flex shrink-0 items-center gap-1" title="Today’s photos beside the student’s reference photo">
                                  {att.referencePhotos?.[p.studentId] && <PrivateImg src={att.referencePhotos[p.studentId]} alt="Reference" className="h-11 w-11 rounded-full border-2 border-white object-cover opacity-70" />}
                                  {p.in?.photo?.ref && <PrivateImg src={p.in.photo.ref} alt="Clock-in" className="h-11 w-11 rounded-full border-2 border-white object-cover" />}
                                  {p.out?.photo?.ref && <PrivateImg src={p.out.photo.ref} alt="Clock-out" className="h-11 w-11 rounded-full border-2 border-white object-cover" />}
                                </span>
                              )}
                              <span className="min-w-0 flex-1">{p.name || p.email} · in {dt(p.clockInAt)}{p.clockOutAt ? ` · out ${new Date(p.clockOutAt).toLocaleTimeString()} · ${hm(p.minutes)}` : ''} · <span className="font-bold">{p.status === 'open' ? 'on the floor now' : p.status === 'flagged' ? 'no clock-out — no hours until resolved' : 'awaiting approval'}</span></span>
                              {p.in?.photo?.ref && !p.photoCheck && <>
                                <button type="button" onClick={async () => { const r = await api({ action: 'attendance-photo-check', tenantId, id: p.id, match: true }); if (r.ok) setAtt(await api({ action: 'attendance', tenantId })); else setMsg(r.error); }} className="h-8 rounded-lg border-2 border-emerald-300 px-2 text-[12px] font-bold text-emerald-800">Photo matches</button>
                                <button type="button" onClick={async () => { const note = window.prompt('What doesn’t match? (kept on the record)'); if (!note) return; const r = await api({ action: 'attendance-photo-check', tenantId, id: p.id, match: false, note }); if (r.ok) setAtt(await api({ action: 'attendance', tenantId })); else setMsg(r.error); }} className="h-8 rounded-lg border-2 border-red-200 px-2 text-[12px] font-bold text-red-700">Doesn’t match</button>
                              </>}
                              {p.photoCheck && <span className={`text-[11px] font-bold ${p.photoCheck.match ? 'text-emerald-700' : 'text-red-700'}`}>{p.photoCheck.match ? '✓ photo checked' : '✕ photo mismatch'}</span>}
                              {p.status === 'pending' && <button type="button" onClick={async () => { const r = await api({ action: 'attendance-approve', tenantId, id: p.id }); if (r.ok) setAtt(await api({ action: 'attendance', tenantId })); else setMsg(r.error); }} className="h-8 rounded-lg bg-foreground px-3 text-[12px] font-bold text-background">Approve</button>}
                              {p.status !== 'open' && <button type="button" onClick={async () => { const outIn = window.prompt('Clock-out time (YYYY-MM-DDTHH:MM, your local time):', toLocalInput(p.clockOutAt || p.clockInAt)); if (!outIn) return; const reason = window.prompt('Reason for this correction (required — it’s kept on the record):'); if (!reason) return; const r = await api({ action: 'attendance-resolve', tenantId, id: p.id, clockOutAt: new Date(outIn).toISOString(), reason }); if (r.ok) setAtt(await api({ action: 'attendance', tenantId })); else setMsg(r.error); }} className="h-8 rounded-lg border-2 px-3 text-[12px] font-bold">Correct</button>}
                            </div>
                          ))}
                        </div>
                      ); })()}
                      <details className="text-sm"><summary className="cursor-pointer font-bold">Recent attendance ({att.punches.length})</summary>
                        <div className="mt-1 space-y-0.5">{att.punches.map((p: any) => <p key={p.id} className="text-[12px]">{p.name || p.email} · {dt(p.clockInAt)} → {p.clockOutAt ? new Date(p.clockOutAt).toLocaleTimeString() : '—'} · {hm(p.minutes)} · {p.status}{p.corrections?.length ? ` · corrected ${p.corrections.length}×` : ''}</p>)}</div></details>
                    </>
                  )}
                </div>
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
      </main>
    </div>
  );
}
