'use client';
// src/components/academy/LiveClass.tsx
//
// LIVE CLASS — run a class students join on their phones (in the room or at
// home). Big join code + QR; who's here; ask a quick question and watch the
// answers come in; reveal; next; end class → everyone's verified minutes are
// recorded (they count toward online hours) and kept in the audit log.

import { useCallback, useEffect, useRef, useState } from 'react';
import { getAuth } from 'firebase/auth';
import QRCode from 'qrcode';
import { Loader } from 'lucide-react';

async function api(body: any) {
  const u = getAuth().currentUser; const tk = u ? await u.getIdToken() : '';
  const r = await fetch('/api/academy/live', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tk}` }, body: JSON.stringify(body) });
  return r.json().catch(() => ({ ok: false, error: 'No response' }));
}
const field = 'h-11 w-full rounded-xl border-2 border-border/60 bg-background px-3 text-sm';

export function LiveClass({ tenantId }: { tenantId: string }) {
  const [list, setList] = useState<any[] | null>(null);
  const [programs, setPrograms] = useState<any[]>([]);
  useEffect(() => { (async () => { const u = getAuth().currentUser; const tk = u ? await u.getIdToken() : ''; const r = await fetch('/api/academy/school', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tk}` }, body: JSON.stringify({ action: 'overview', tenantId }) }).then((x) => x.json()).catch(() => null); if (r?.ok) setPrograms(r.programs || []); })(); }, [tenantId]);
  const [live, setLive] = useState<string | null>(null);
  const [st, setSt] = useState<any>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [start, setStart] = useState({ title: '', programId: '' });
  const [q, setQ] = useState({ q: '', options: ['', ''], correct: -1 });
  const [msg, setMsg] = useState('');
  const timer = useRef<number | null>(null);
  const loadList = useCallback(async () => { const r = await api({ action: 'list', tenantId }); if (r.ok) { setList(r.sessions); const cur = r.sessions.find((s: any) => s.status === 'live'); if (cur && !live) setLive(cur.id); } }, [tenantId, live]);
  useEffect(() => { void loadList(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!live) return;
    const tick = async () => { const r = await api({ action: 'state', tenantId, id: live }); if (r.ok) { setSt(r); if (!qr && r.joinUrl) setQr(await QRCode.toDataURL(r.joinUrl, { margin: 1, width: 360 })); } };
    void tick(); timer.current = window.setInterval(tick, 2500);
    return () => { if (timer.current) window.clearInterval(timer.current); };
  }, [live, tenantId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (live && st) {
    const s = st.session; const cur = s.current; const max = Math.max(1, ...(st.counts || [0]));
    return (
      <div className="space-y-4">
        {s.status === 'ended' ? (
          <div className="space-y-2 rounded-2xl bg-emerald-50 p-4"><p className="text-lg font-black">Class ended — {s.summary?.participants || 0} students, {s.summary?.minutes || 0} verified minutes recorded.</p>
            <button type="button" onClick={() => { setLive(null); setSt(null); setQr(null); void loadList(); }} className="h-10 rounded-xl bg-foreground px-4 text-sm font-bold text-background">Back to classes</button></div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xl font-black">{s.title}</p>
                <button type="button" onClick={async () => { if (!window.confirm('End the class? Everyone’s minutes are recorded now.')) return; const r = await api({ action: 'end', tenantId, id: live }); if (!r.ok) setMsg(r.error); }} className="h-10 rounded-xl border-2 border-red-200 px-4 text-sm font-bold text-red-700">End class</button></div>
              {cur ? (
                <div className="space-y-3 rounded-2xl border-2 border-foreground/30 p-4">
                  <p className="text-lg font-black">{cur.q}</p>
                  {cur.options.map((o: string, i: number) => (
                    <div key={i}><div className="flex justify-between text-sm"><span className={cur.reveal && cur.correct === i ? 'font-black text-emerald-700' : ''}>{cur.reveal && cur.correct === i ? '✓ ' : ''}{o}</span><span className="font-bold">{st.counts[i] || 0}</span></div>
                      <div className="mt-1 h-3 rounded-full bg-muted"><div className={`h-3 rounded-full transition-all ${cur.reveal && cur.correct === i ? 'bg-emerald-600' : 'bg-foreground'}`} style={{ width: `${((st.counts[i] || 0) / max) * 100}%` }} /></div></div>
                  ))}
                  <p className="text-[12px] text-muted-foreground">{st.answered} of {st.here} answered{cur.open ? ' · answers open' : ' · closed'}</p>
                  <div className="flex flex-wrap gap-2">
                    {cur.open && <button type="button" onClick={() => api({ action: 'close', tenantId, id: live })} className="h-10 rounded-xl border-2 px-4 text-sm font-bold">Close answers</button>}
                    {!cur.reveal && cur.correct != null && <button type="button" onClick={() => api({ action: 'reveal', tenantId, id: live })} className="h-10 rounded-xl bg-emerald-600 px-4 text-sm font-bold text-white">Reveal answer</button>}
                  </div>
                </div>
              ) : <p className="rounded-2xl border-2 border-dashed p-6 text-center text-sm text-muted-foreground">Ask a quick question whenever you like — students answer on their phones.</p>}
              <div className="space-y-2 rounded-2xl bg-muted/40 p-4">
                <p className="font-black">{cur ? 'Next question' : 'Ask a question'}</p>
                <input className={field} value={q.q} onChange={(e) => setQ({ ...q, q: e.target.value })} placeholder="e.g. Where should the apex sit?" />
                {q.options.map((o, i) => <div key={i} className="flex items-center gap-2"><input type="radio" name="live-correct" checked={q.correct === i} onChange={() => setQ({ ...q, correct: i })} title="Correct answer (optional)" /><input className={field} value={o} onChange={(e) => { const os = [...q.options]; os[i] = e.target.value; setQ({ ...q, options: os }); }} placeholder={`Answer ${i + 1}`} /></div>)}
                <div className="flex flex-wrap gap-2">
                  {q.options.length < 4 && <button type="button" onClick={() => setQ({ ...q, options: [...q.options, ''] })} className="h-9 rounded-full bg-background px-3 text-[12px] font-bold">+ Answer</button>}
                  <button type="button" onClick={() => setQ({ q: 'Ready to move on?', options: ['Yes', 'Not yet'], correct: -1 })} className="h-9 rounded-full bg-background px-3 text-[12px] font-bold">Quick check-in</button>
                  <button type="button" disabled={!q.q.trim() || q.options.filter((x) => x.trim()).length < 2} onClick={async () => { const r = await api({ action: 'ask', tenantId, id: live, q: q.q, options: q.options.filter((x) => x.trim()), correct: q.correct >= 0 ? q.correct : null }); if (r.ok) setQ({ q: '', options: ['', ''], correct: -1 }); else setMsg(r.error); }} className="ml-auto h-10 rounded-xl bg-foreground px-5 text-sm font-bold text-background disabled:opacity-40">Send to students</button>
                </div>
                <p className="text-[11px] text-muted-foreground">Tick the right answer if there is one — you can reveal it after.</p>
              </div>
              {msg && <p className="text-sm text-red-700">{msg}</p>}
            </div>
            <div className="space-y-3">
              <div className="rounded-2xl bg-foreground p-5 text-center text-background">
                <p className="text-[11px] uppercase tracking-widest opacity-70">Join on your phone</p>
                <p className="font-mono text-5xl font-black tracking-widest">{s.code}</p>
                {qr && <img src={qr} alt="Scan to join" className="mx-auto mt-3 w-48 rounded-xl bg-white p-2" />}
                <p className="mt-2 text-[12px] opacity-70">Scan, or open your student portal → Live class</p>
              </div>
              <div className="rounded-2xl bg-muted/40 p-3"><p className="font-black">{st.here} here now</p>
                <div className="mt-1 max-h-72 space-y-0.5 overflow-y-auto">{st.people.map((p: any) => <p key={p.email} className={`text-sm ${p.here ? '' : 'text-muted-foreground'}`}>{p.here ? '●' : '○'} {p.name} <span className="text-[11px] text-muted-foreground">· {p.minutes} min</span></p>)}</div></div>
            </div>
          </div>
        )}
      </div>
    );
  }
  if (live && !st) return <Loader className="h-5 w-5 animate-spin" />;

  return (
    <div className="space-y-4">
      <div className="space-y-2 rounded-2xl border-2 border-foreground/30 p-4">
        <p className="font-black">Start a live class</p>
        <div className="grid gap-2 sm:grid-cols-[1fr_220px_auto]">
          <input className={field} value={start.title} onChange={(e) => setStart({ ...start, title: e.target.value })} placeholder="e.g. Theory — infection control" />
          <select className={field} value={start.programId} onChange={(e) => setStart({ ...start, programId: e.target.value })}><option value="">Any students</option>{programs.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
          <button type="button" onClick={async () => { const r = await api({ action: 'start', tenantId, ...start }); if (r.ok) { setLive(r.id); setStart({ title: '', programId: '' }); } else setMsg(r.error); }} className="h-11 rounded-xl bg-foreground px-5 text-sm font-bold text-background">Start class</button>
        </div>
        <p className="text-[12px] text-muted-foreground">Put this screen on the classroom TV. Students join with a code on their own phones — in the room or from home — and their minutes are recorded when you end the class.</p>
      </div>
      <p className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">Past classes</p>
      {!list ? <Loader className="h-5 w-5 animate-spin" /> : list.length === 0 ? <p className="text-sm text-muted-foreground">None yet.</p> : list.map((s) => (
        <div key={s.id} className="flex items-center justify-between rounded-2xl bg-muted/40 px-3 py-2 text-sm"><span><span className="font-bold">{s.title}</span> <span className="text-muted-foreground">· {new Date(s.startedAt).toLocaleString()}</span></span>
          {s.status === 'live' ? <button type="button" onClick={() => setLive(s.id)} className="rounded-full bg-red-500 px-3 py-1 text-[12px] font-bold text-white">● Live — open</button> : <span className="text-[12px]">{s.summary?.participants || 0} students · {s.summary?.minutes || 0} min</span>}</div>
      ))}
    </div>
  );
}
