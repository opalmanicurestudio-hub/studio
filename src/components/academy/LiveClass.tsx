'use client';
// src/components/academy/LiveClass.tsx
//
// LIVE CLASS 2.0 — the instructor's classroom screen (TV, laptop or phone).
//   Send:   Quick quiz (timer + points) · Poll · Word cloud · Rate this set ·
//           Tap the photo · Confidence check · Exit ticket (→ gradebook)
//   See:    live results for each · the room's pulse (🟢🟡🔴, "too fast") ·
//           Room vs Home teams + leaderboard · the question queue · who's here
//   End:    everyone's verified minutes recorded; exit ticket saved to grades

import { useCallback, useEffect, useRef, useState } from 'react';
import { getAuth } from 'firebase/auth';
import QRCode from 'qrcode';
import { Loader } from 'lucide-react';
import { deviceId } from '@/lib/device';

async function call(path: string, body: any) {
  const u = getAuth().currentUser; const tk = u ? await u.getIdToken() : '';
  const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tk}`, 'x-cf-device': deviceId() }, body: JSON.stringify(body) });
  return r.json().catch(() => ({ ok: false, error: 'No response' }));
}
const api = (body: any) => call('/api/academy/live', body);
const field = 'h-11 w-full rounded-xl border-2 border-border/60 bg-background px-3 text-sm';
const KINDS: [string, string, string][] = [['quiz', '⚡ Quick quiz', 'Timer + points'], ['poll', '📊 Poll', 'No right answer'], ['word', '☁️ Word cloud', 'One word each'], ['rate', '⭐ Rate this set', 'Score a photo 1–5'], ['tap', '👆 Tap the photo', 'Where would you…?'], ['confidence', '🚦 Confidence', '🟢🟡🔴'], ['exit', '🎟 Exit ticket', 'Saved to grades']];
const shrink = (file: File) => new Promise<string>((res) => { const r = new FileReader(); const img = new Image(); r.onload = () => { img.onload = () => { const k = Math.min(1, 1400 / Math.max(img.width, img.height)); const c = document.createElement('canvas'); c.width = img.width * k; c.height = img.height * k; c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height); res(c.toDataURL('image/jpeg', 0.82)); }; img.src = String(r.result); }; r.readAsDataURL(file); });
const blankQ = () => ({ q: '', options: ['', ''], answer: 0 });

function Bars({ labels, counts, correct, reveal }: { labels: string[]; counts: number[]; correct?: number | null; reveal?: boolean }) {
  const max = Math.max(1, ...counts);
  return <div className="space-y-2">{labels.map((l, i) => { const ok = reveal && correct === i; return (
    <div key={i}><div className="flex justify-between gap-2 text-sm"><span className={ok ? 'font-black text-emerald-700' : ''}>{ok ? '✓ ' : ''}{l}</span><span className="font-bold tabular-nums">{counts[i] || 0}</span></div>
      <div className="mt-1 h-4 rounded-full bg-muted"><div className={`h-4 rounded-full transition-all duration-500 ${ok ? 'bg-emerald-600' : 'bg-foreground'}`} style={{ width: `${((counts[i] || 0) / max) * 100}%` }} /></div></div>
  ); })}</div>;
}

export function LiveClass({ tenantId }: { tenantId: string }) {
  const [list, setList] = useState<any[] | null>(null);
  const [programs, setPrograms] = useState<any[]>([]);
  const [courses, setCourses] = useState<any[]>([]);
  const [live, setLive] = useState<string | null>(null);
  const [st, setSt] = useState<any>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [start, setStart] = useState({ title: '', programId: '', courseId: '' });
  const [kind, setKind] = useState('quiz');
  const [c, setC] = useState<any>({ q: '', options: ['', ''], correct: -1, timerSec: 20, instructorRating: 4, photo: null, target: null, questions: [blankQ()] });
  const [now, setNow] = useState(Date.now());
  const [msg, setMsg] = useState(''); const [busy, setBusy] = useState(false);
  const timer = useRef<number | null>(null);
  const loadList = useCallback(async () => { const r = await api({ action: 'list', tenantId }); if (r.ok) { setList(r.sessions); const cur = r.sessions.find((s: any) => s.status === 'live'); if (cur) setLive((x) => x || cur.id); } }, [tenantId]);
  useEffect(() => { void loadList(); call('/api/academy/school', { action: 'overview', tenantId }).then((r) => r?.ok && setPrograms(r.programs || [])); call('/api/academy/admin', { action: 'list', tenantId }).then((r) => r?.ok && setCourses(r.courses || [])); }, [tenantId, loadList]);
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 500); return () => window.clearInterval(t); }, []);
  useEffect(() => {
    if (!live) return;
    const tick = async () => { const r = await api({ action: 'state', tenantId, id: live }); if (r.ok) { setSt(r); if (r.joinUrl) setQr((q) => q || null); if (!qr && r.joinUrl) setQr(await QRCode.toDataURL(r.joinUrl, { margin: 1, width: 360 })); } };
    void tick(); timer.current = window.setInterval(tick, 2000);
    return () => { if (timer.current) window.clearInterval(timer.current); };
  }, [live, tenantId]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = async () => {
    setBusy(true); setMsg('');
    const body: any = { action: 'ask', tenantId, id: live, kind, q: c.q };
    if (kind === 'quiz' || kind === 'poll') { body.options = c.options.filter((x: string) => x.trim()); if (kind === 'quiz') { body.correct = c.correct >= 0 ? c.correct : null; body.timerSec = c.timerSec || 0; } }
    if (kind === 'rate' || kind === 'tap') { body.photo = c.photo; if (kind === 'rate') body.instructorRating = c.instructorRating; if (kind === 'tap' && c.target) body.target = c.target; }
    if (kind === 'exit') body.questions = c.questions;
    const r = await api(body); setBusy(false);
    if (!r.ok) { setMsg(r.error); return; }
    setC({ ...c, q: '', options: ['', ''], correct: -1, photo: null, target: null, questions: [blankQ()] });
  };
  const fillExit = async () => {
    const cid = st?.session?.courseId; if (!cid) { setMsg('Link this class to a course (when starting it) to use its question bank.'); return; }
    const r = await call('/api/academy/admin', { action: 'qbank-list', tenantId, courseId: cid });
    const qs = (r.questions || []).sort(() => Math.random() - 0.5).slice(0, 3).map((q: any) => ({ q: q.q, options: q.options.slice(0, 4), answer: Math.min(q.answer, 3) }));
    if (!qs.length) { setMsg('The course’s question bank is empty — add questions in Tests & worksheets.'); return; }
    setC({ ...c, questions: qs });
  };

  if (live && st) {
    const s = st.session; const cur = s.current; const R = st.results || {};
    const left = cur?.endsAt ? Math.max(0, Math.ceil((new Date(cur.endsAt).getTime() - now) / 1000)) : null;
    const maxW = Math.max(1, ...((R.words || []).map((w: any) => w.n)));
    if (s.status === 'ended') return (
      <div className="space-y-3 rounded-3xl bg-emerald-50 p-6"><p className="text-2xl font-black">Class ended 🎉</p><p>{s.summary?.participants || 0} students · {s.summary?.minutes || 0} verified minutes · {s.summary?.activities || 0} activities{s.courseId ? ' · exit ticket saved to the gradebook' : ''}.</p>
        <button type="button" onClick={() => { setLive(null); setSt(null); setQr(null); void loadList(); }} className="h-11 rounded-xl bg-foreground px-5 text-sm font-bold text-background">Back to classes</button></div>
    );
    return (
      <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
        <div className="min-w-0 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xl font-black">{s.title} <span className="ml-1 rounded-full bg-red-500 px-2 py-0.5 align-middle text-[11px] text-white">● LIVE</span></p>
            <button type="button" onClick={async () => { if (!window.confirm('End the class? Everyone’s minutes are recorded now.')) return; const r = await api({ action: 'end', tenantId, id: live }); if (!r.ok) setMsg(r.error); }} className="h-10 rounded-xl border-2 border-red-200 px-4 text-sm font-bold text-red-700">End class</button></div>

          {cur ? (
            <div className="space-y-3 rounded-3xl border-2 border-foreground/20 p-4 sm:p-5">
              <div className="flex items-start justify-between gap-3"><div><p className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">{KINDS.find(([k]) => k === (cur.kind || 'quiz'))?.[1]}</p><p className="text-xl font-black sm:text-2xl">{cur.q}</p></div>
                {left != null && cur.open && <span className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-xl font-black ${left <= 5 ? 'bg-red-500 text-white' : 'bg-muted'}`}>{left}</span>}</div>
              {['quiz', 'poll', 'confidence'].includes(cur.kind || 'quiz') && <Bars labels={cur.options || []} counts={R.counts || []} correct={cur.correct} reveal={cur.reveal} />}
              {cur.kind === 'word' && <div className="flex min-h-32 flex-wrap items-center justify-center gap-x-4 gap-y-1 rounded-2xl bg-muted/40 p-4">{(R.words || []).length === 0 ? <p className="text-muted-foreground">Words appear here as they come in…</p> : R.words.map((w: any, i: number) => <span key={w.w} className="font-black leading-tight" style={{ fontSize: `${14 + (w.n / maxW) * 30}px`, opacity: 0.55 + (w.n / maxW) * 0.45, color: i % 3 === 0 ? 'hsl(var(--foreground))' : i % 3 === 1 ? '#7c3aed' : '#0f766e' }}>{w.w}</span>)}</div>}
              {cur.kind === 'rate' && <div className="grid gap-3 sm:grid-cols-2">{cur.image && <img src={cur.image} alt="" className="w-full rounded-2xl" />}<div className="space-y-2"><p className="text-4xl font-black">{R.avg ?? '—'}<span className="text-lg text-muted-foreground"> / 5 class average</span></p><Bars labels={['1', '2', '3', '4', '5'].map((n) => `${'⭐'.repeat(Number(n))}`)} counts={R.dist || []} />{cur.reveal && cur.instructorRating && <p className="rounded-xl bg-emerald-50 p-2 font-black text-emerald-800">Your score: {cur.instructorRating} / 5</p>}</div></div>}
              {cur.kind === 'tap' && cur.image && <div className="relative mx-auto max-w-xl"><img src={cur.image} alt="" className="w-full rounded-2xl" />{(R.points || []).map((p: any, i: number) => <span key={i} className="absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-red-500/60 ring-2 ring-white" style={{ left: `${p.x}%`, top: `${p.y}%` }} />)}{cur.reveal && cur.target && <span className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-4 border-emerald-500" style={{ left: `${cur.target.x}%`, top: `${cur.target.y}%`, width: `${cur.target.r * 2}%`, aspectRatio: '1' }} />}</div>}
              {cur.kind === 'exit' && <div className="space-y-1"><p className="text-3xl font-black">{R.avg ?? '—'}{R.avg != null ? '%' : ''} <span className="text-base text-muted-foreground">average</span></p>{(cur.questions || []).map((q: any, i: number) => <p key={i} className="text-sm">{i + 1}. {q.q} — <b>{R.perQuestion?.[i] || 0}</b> right</p>)}</div>}
              <p className="text-sm text-muted-foreground">{R.answered || 0} of {st.here} answered{cur.open ? '' : ' · closed'}</p>
              <div className="flex flex-wrap gap-2">
                {cur.open && <button type="button" onClick={() => api({ action: 'close', tenantId, id: live })} className="h-10 rounded-xl border-2 px-4 text-sm font-bold">Close answers</button>}
                {!cur.reveal && (cur.correct != null || cur.instructorRating || cur.target) && <button type="button" onClick={() => api({ action: 'reveal', tenantId, id: live })} className="h-10 rounded-xl bg-emerald-600 px-4 text-sm font-bold text-white">Reveal</button>}
              </div>
            </div>
          ) : <p className="rounded-3xl border-2 border-dashed p-8 text-center text-muted-foreground">Send an activity whenever you like — students answer on their phones.</p>}

          <div className="space-y-3 rounded-3xl bg-muted/40 p-4">
            <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">{KINDS.map(([k, l, h]) => <button key={k} type="button" onClick={() => setKind(k)} className={`shrink-0 rounded-2xl px-3 py-2 text-left ${kind === k ? 'bg-foreground text-background' : 'bg-background'}`}><span className="block whitespace-nowrap text-sm font-black">{l}</span><span className="block whitespace-nowrap text-[11px] opacity-70">{h}</span></button>)}</div>
            {kind !== 'confidence' && kind !== 'exit' && <input className={field} value={c.q} onChange={(e) => setC({ ...c, q: e.target.value })} placeholder={kind === 'word' ? 'e.g. One word: what causes lifting?' : kind === 'rate' ? 'e.g. How clean is this cuticle work?' : kind === 'tap' ? 'e.g. Tap where the apex should sit' : 'Question'} />}
            {kind === 'confidence' && <input className={field} value={c.q} onChange={(e) => setC({ ...c, q: e.target.value })} placeholder="How confident are you with this? (optional)" />}
            {(kind === 'quiz' || kind === 'poll') && <>{c.options.map((o: string, i: number) => <div key={i} className="flex items-center gap-2">{kind === 'quiz' && <input type="radio" name="lc" checked={c.correct === i} onChange={() => setC({ ...c, correct: i })} title="Right answer" className="h-5 w-5" />}<input className={field} value={o} onChange={(e) => { const os = [...c.options]; os[i] = e.target.value; setC({ ...c, options: os }); }} placeholder={`Answer ${i + 1}`} /></div>)}
              <div className="flex flex-wrap items-center gap-2">{c.options.length < 4 && <button type="button" onClick={() => setC({ ...c, options: [...c.options, ''] })} className="h-9 rounded-full bg-background px-3 text-[12px] font-bold">+ Answer</button>}
                {kind === 'quiz' && <label className="flex items-center gap-2 text-[12px] font-bold">Timer<select className="h-9 rounded-lg border-2 px-2" value={c.timerSec} onChange={(e) => setC({ ...c, timerSec: Number(e.target.value) })}><option value={0}>None</option><option value={10}>10 s</option><option value={20}>20 s</option><option value={30}>30 s</option><option value={60}>60 s</option></select></label>}
                {kind === 'quiz' && <span className="text-[11px] text-muted-foreground">Tick the right answer — faster right answers score more.</span>}</div></>}
            {(kind === 'rate' || kind === 'tap') && (
              <div className="space-y-2">
                {!c.photo ? <label className="flex h-24 cursor-pointer items-center justify-center rounded-2xl border-2 border-dashed text-sm font-bold">📷 Take or choose a photo<input type="file" accept="image/*" capture="environment" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setC({ ...c, photo: await shrink(f) }); }} /></label>
                  : <div className="relative mx-auto max-w-md" onClick={(e) => { if (kind !== 'tap') return; const r = (e.currentTarget as HTMLDivElement).getBoundingClientRect(); setC({ ...c, target: { x: ((e.clientX - r.left) / r.width) * 100, y: ((e.clientY - r.top) / r.height) * 100, r: 10 } }); }}>
                    <img src={c.photo} alt="" className={`w-full rounded-2xl ${kind === 'tap' ? 'cursor-crosshair' : ''}`} />{c.target && <span className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-4 border-emerald-500" style={{ left: `${c.target.x}%`, top: `${c.target.y}%`, width: '20%', aspectRatio: '1' }} />}</div>}
                {kind === 'tap' && c.photo && <p className="text-[11px] text-muted-foreground">Optional: tap the photo to mark the right area — revealed at the end.</p>}
                {kind === 'rate' && <label className="flex items-center gap-2 text-sm font-bold">Your score (revealed after){[1, 2, 3, 4, 5].map((n) => <button key={n} type="button" onClick={() => setC({ ...c, instructorRating: n })} className={`h-9 w-9 rounded-full ${c.instructorRating >= n ? 'bg-amber-400' : 'bg-background'}`}>⭐</button>)}</label>}
              </div>
            )}
            {kind === 'exit' && (
              <div className="space-y-2">
                <div className="flex flex-wrap gap-2"><button type="button" onClick={fillExit} className="h-9 rounded-full bg-violet-100 px-3 text-[12px] font-bold text-violet-900">Fill 3 from the question bank</button><span className="text-[11px] text-muted-foreground">Scores go to the course gradebook when you end the class.</span></div>
                {c.questions.map((q: any, qi: number) => <div key={qi} className="space-y-1 rounded-2xl bg-background p-3"><input className={field} value={q.q} onChange={(e) => { const qs = [...c.questions]; qs[qi] = { ...q, q: e.target.value }; setC({ ...c, questions: qs }); }} placeholder={`Question ${qi + 1}`} />
                  {q.options.map((o: string, oi: number) => <div key={oi} className="flex items-center gap-2"><input type="radio" name={`ex${qi}`} checked={q.answer === oi} onChange={() => { const qs = [...c.questions]; qs[qi] = { ...q, answer: oi }; setC({ ...c, questions: qs }); }} /><input className={field} value={o} onChange={(e) => { const qs = [...c.questions]; const os = [...q.options]; os[oi] = e.target.value; qs[qi] = { ...q, options: os }; setC({ ...c, questions: qs }); }} placeholder={`Answer ${oi + 1}`} /></div>)}
                  {q.options.length < 4 && <button type="button" onClick={() => { const qs = [...c.questions]; qs[qi] = { ...q, options: [...q.options, ''] }; setC({ ...c, questions: qs }); }} className="text-[12px] font-bold underline">+ answer</button>}</div>)}
                {c.questions.length < 5 && <button type="button" onClick={() => setC({ ...c, questions: [...c.questions, blankQ()] })} className="h-9 rounded-full bg-background px-3 text-[12px] font-bold">+ Question</button>}
              </div>
            )}
            {msg && <p className="text-sm text-red-700">{msg}</p>}
            <button type="button" disabled={busy} onClick={send} className="h-12 w-full rounded-xl bg-foreground text-sm font-black text-background disabled:opacity-40">{busy ? 'Sending…' : 'Send to students'}</button>
          </div>
        </div>

        <div className="space-y-3">
          <div className="rounded-3xl bg-foreground p-5 text-center text-background"><p className="text-[11px] uppercase tracking-widest opacity-70">Join on your phone</p><p className="font-mono text-5xl font-black tracking-widest">{s.code}</p>{qr && <img src={qr} alt="Scan to join" className="mx-auto mt-3 w-44 rounded-xl bg-white p-2" />}<p className="mt-2 text-[12px] opacity-70">{st.here} here now</p></div>
          <div className="rounded-3xl bg-muted/40 p-4"><p className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">The room’s pulse</p>
            <div className="mt-2 flex h-5 overflow-hidden rounded-full bg-background">{(['green', 'yellow', 'red'] as const).map((k) => { const n = st.pulse[k]; const t = Math.max(1, st.pulse.green + st.pulse.yellow + st.pulse.red); return n ? <div key={k} className={k === 'green' ? 'bg-emerald-500' : k === 'yellow' ? 'bg-amber-400' : 'bg-red-500'} style={{ width: `${(n / t) * 100}%` }} /> : null; })}</div>
            <p className="mt-1 text-sm">🟢 {st.pulse.green} · 🟡 {st.pulse.yellow} · 🔴 {st.pulse.red}{st.pulse.fast ? <b className="ml-2 text-red-700">· {st.pulse.fast} say “too fast”</b> : ''}</p></div>
          <div className="rounded-3xl bg-muted/40 p-4"><p className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">Teams</p>
            <div className="mt-1 grid grid-cols-2 gap-2 text-center"><div className="rounded-2xl bg-background p-2"><p className="text-2xl font-black">{st.teams.room}</p><p className="text-[11px]">🏫 Room</p></div><div className="rounded-2xl bg-background p-2"><p className="text-2xl font-black">{st.teams.home}</p><p className="text-[11px]">🏠 Home</p></div></div>
            {st.board.filter((x: any) => x.points).slice(0, 5).map((x: any, i: number) => <p key={i} className="mt-1 flex justify-between text-sm"><span>{['🥇', '🥈', '🥉', '4.', '5.'][i]} {x.name}</span><b>{x.points}</b></p>)}</div>
          <div className="rounded-3xl bg-muted/40 p-4"><p className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">Questions from students · {st.queue.filter((x: any) => !x.answered).length}</p>
            <div className="mt-2 max-h-72 space-y-1.5 overflow-y-auto">{st.queue.length === 0 ? <p className="text-sm text-muted-foreground">None yet.</p> : st.queue.map((x: any) => <div key={x.id} className={`rounded-xl bg-background p-2 text-sm ${x.answered ? 'opacity-40' : ''}`}><p><b>▲ {x.votes}</b> {x.text}</p><p className="flex justify-between text-[11px] text-muted-foreground"><span>{x.name}</span>{!x.answered && <button type="button" onClick={() => api({ action: 'answered', tenantId, id: live, qid: x.id })} className="font-bold underline">Answered</button>}</p></div>)}</div></div>
          <details className="rounded-3xl bg-muted/40 p-4"><summary className="cursor-pointer text-sm font-black">Who’s here ({st.here})</summary><div className="mt-2 max-h-60 space-y-0.5 overflow-y-auto">{st.people.map((p: any) => <p key={p.email} className={`text-sm ${p.here ? '' : 'text-muted-foreground'}`}>{p.here ? '●' : '○'} {p.name} <span className="text-[11px] text-muted-foreground">· {p.team === 'home' ? '🏠' : '🏫'} · {p.minutes} min {p.pulse === 'red' ? '🔴' : p.pulse === 'yellow' ? '🟡' : p.pulse === 'green' ? '🟢' : ''}</span></p>)}</div></details>
        </div>
      </div>
    );
  }
  if (live && !st) return <Loader className="h-5 w-5 animate-spin" />;

  return (
    <div className="space-y-4">
      <div className="space-y-2 rounded-3xl border-2 border-foreground/20 p-4">
        <p className="font-black">Start a live class</p>
        <div className="grid gap-2 sm:grid-cols-[1fr_200px_200px_auto]">
          <input className={field} value={start.title} onChange={(e) => setStart({ ...start, title: e.target.value })} placeholder="e.g. Theory — infection control" />
          <select className={field} value={start.programId} onChange={(e) => setStart({ ...start, programId: e.target.value })}><option value="">Any program</option>{programs.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
          <select className={field} value={start.courseId} onChange={(e) => setStart({ ...start, courseId: e.target.value })}><option value="">No course</option>{courses.map((x: any) => <option key={x.id} value={x.id}>{x.title}</option>)}</select>
          <button type="button" onClick={async () => { const r = await api({ action: 'start', tenantId, ...start }); if (r.ok) { setLive(r.id); setStart({ title: '', programId: '', courseId: '' }); } else setMsg(r.error); }} className="h-11 rounded-xl bg-foreground px-5 text-sm font-bold text-background">Start class</button>
        </div>
        <p className="text-[12px] text-muted-foreground">Put this screen on the classroom TV. Students join with the code on their phones — in the room or from home. Link a course to use its question bank and save the exit ticket to its gradebook.</p>
      </div>
      <p className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">Past classes</p>
      {!list ? <Loader className="h-5 w-5 animate-spin" /> : list.length === 0 ? <p className="text-sm text-muted-foreground">None yet.</p> : list.map((s) => (
        <div key={s.id} className="flex items-center justify-between rounded-2xl bg-muted/40 px-3 py-2 text-sm"><span><span className="font-bold">{s.title}</span> <span className="text-muted-foreground">· {new Date(s.startedAt).toLocaleString()}</span></span>
          {s.status === 'live' ? <button type="button" onClick={() => setLive(s.id)} className="rounded-full bg-red-500 px-3 py-1 text-[12px] font-bold text-white">● Live — open</button> : <span className="text-[12px]">{s.summary?.participants || 0} students · {s.summary?.minutes || 0} min</span>}</div>
      ))}
      {msg && <p className="text-sm text-red-700">{msg}</p>}
    </div>
  );
}
