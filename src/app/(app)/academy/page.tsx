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
import { useTenant } from '@/context/TenantContext';

async function api(body: any) {
  const u = getAuth().currentUser; const tk = u ? await u.getIdToken() : '';
  const r = await fetch('/api/academy/admin', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tk}` }, body: JSON.stringify(body) });
  return r.json().catch(() => ({ ok: false, error: 'No response' }));
}
const money = (c: number) => (c ? `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: c % 100 ? 2 : 0 })}` : 'Free');
const field = 'h-11 w-full rounded-xl border-2 border-border/60 bg-background px-3 text-sm';
const KIND_ICON: Record<string, any> = { video: Video, text: FileText, download: Download };
const blankLesson = (moduleTitle = 'Module 1') => ({ id: '', title: '', moduleTitle, kind: 'video', body: '', videoUrl: '', downloadUrl: '', downloadName: '', preview: false });

export default function AcademyBuilderPage() {
  const { selectedTenant } = useTenant();
  const tenantId = String(selectedTenant?.id || '');
  const [courses, setCourses] = useState<any[] | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [d, setD] = useState<any>(null);            // { course, lessons, mux, muxSigning }
  const [tab, setTab] = useState<'details' | 'curriculum' | 'students'>('details');
  const [form, setForm] = useState<any>(null);
  const [lesson, setLesson] = useState<any>(null);   // the lesson being edited
  const [students, setStudents] = useState<any[] | null>(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState('');
  const [upload, setUpload] = useState<{ lessonId: string; pct: number; status: string } | null>(null);
  const poll = useRef<number | null>(null);

  const loadList = useCallback(async () => { if (!tenantId) return; const r = await api({ action: 'list', tenantId }); if (r.ok) setCourses(r.courses); else setMsg(r.error); }, [tenantId]);
  const loadCourse = useCallback(async (id: string) => {
    const r = await api({ action: 'course-get', tenantId, courseId: id });
    if (!r.ok) { setMsg(r.error); return; }
    setD(r);
    const c = r.course;
    setForm({ id: c.id, title: c.title, subtitle: c.subtitle || '', priceDollars: (c.priceCents || 0) / 100, level: c.level || '', instructorName: c.instructorName || '', coverUrl: c.coverUrl || '', whatYouLearn: (c.whatYouLearn || []).join('\n'), description: c.description || '', status: c.status || 'draft' });
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
        {msg && <p className="rounded-2xl border-2 border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">{msg}</p>}
        {d && !d.mux && <p className="rounded-2xl border-2 border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Video hosting isn’t connected yet — you can paste a private Vimeo or unlisted YouTube link for now. Add MUX_TOKEN_ID, MUX_TOKEN_SECRET, MUX_SIGNING_KEY_ID and MUX_SIGNING_KEY_PRIVATE in Vercel to upload protected videos.</p>}

        <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
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
                <div className="flex gap-1">{(['details', 'curriculum', 'students'] as const).map((k) => <button key={k} type="button" onClick={() => { setTab(k); if (k === 'students' && !students) api({ action: 'students', tenantId, courseId: sel }).then((r) => r.ok && setStudents(r.students)); }} className={`h-9 rounded-full px-4 text-sm font-bold capitalize ${tab === k ? 'bg-foreground text-background' : 'bg-muted/50'}`}>{k}</button>)}</div>
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
                          <button type="button" aria-label="Edit" onClick={() => setLesson({ ...blankLesson(), ...l, videoUrl: l.videoUrl || '', downloadUrl: l.downloadUrl || '', downloadName: l.downloadName || '' })} className="p-1"><Pencil className="h-4 w-4" /></button>
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
                      <div className="flex gap-2">
                        <button type="button" disabled={!!busy || !lesson.title.trim()} onClick={async () => { const id = await saveLesson(); if (id) { setLesson(null); setMsg('Lesson saved.'); } }} className="h-10 rounded-xl bg-foreground px-5 text-sm font-bold text-background disabled:opacity-50">{busy === 'lesson' ? 'Saving…' : 'Save lesson'}</button>
                        <button type="button" onClick={() => setLesson(null)} className="h-10 rounded-xl px-4 text-sm font-bold text-muted-foreground">Close</button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {tab === 'students' && (
                <div className="space-y-1.5">
                  {!students && <Loader className="h-5 w-5 animate-spin" />}
                  {students?.length === 0 && <p className="text-sm text-muted-foreground">No students yet. Share your course page to get your first.</p>}
                  {students?.map((s) => (
                    <div key={s.email} className="flex items-center justify-between gap-3 rounded-2xl bg-muted/40 px-3 py-2 text-sm">
                      <span className="min-w-0 truncate">{s.email} <span className="text-muted-foreground">· since {new Date(s.since).toLocaleDateString()} · {money(s.paidCents)}</span></span>
                      <span className="flex w-40 shrink-0 items-center gap-2"><span className="h-1.5 flex-1 rounded-full bg-background"><span className="block h-1.5 rounded-full bg-foreground" style={{ width: `${s.pct || 0}%` }} /></span><span className="text-[12px] font-bold">{s.pct || 0}%</span></span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
