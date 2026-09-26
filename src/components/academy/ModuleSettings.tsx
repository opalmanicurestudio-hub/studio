"use client";
// src/components/academy/ModuleSettings.tsx
//
// MODULE SETTINGS (owners) — on each module header in the curriculum:
//   Opens: from the start · after the previous module · on a date · when I
//   release it (Release now — emails students in their own language);
//   an intro for the module's welcome card; a badge (if points are on).
// GAMIFY SETTING — points, streaks and badges for students, per academy.

import { useEffect, useState } from 'react';
import { getAuth } from 'firebase/auth';
import { deviceId } from '@/lib/device';

async function call(path: string, body: any) {
  const u = getAuth().currentUser; const tk = u ? await u.getIdToken() : '';
  const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tk}`, 'x-cf-device': deviceId() }, body: JSON.stringify(body) });
  return r.json().catch(() => ({ ok: false, error: 'No response' }));
}
// Same rule as lib/academy-modules (kept here so this browser file never loads server code).
export const modKey = (t: string) => String(t || 'Module').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'module';
const LABEL: Record<string, string> = { open: 'Open from the start', previous: 'After the previous module', date: 'On a date', manual: 'When I release it' };
const field = 'h-10 w-full rounded-xl border-2 border-border/60 bg-background px-3 text-sm';

export function ModuleSettings({ tenantId, courseId, title, first, cfg, onSaved }: { tenantId: string; courseId: string; title: string; first: boolean; cfg: any; onSaved: () => void }) {
  const [open, setOpen] = useState(false); const [busy, setBusy] = useState(''); const [msg, setMsg] = useState('');
  const [f, setF] = useState({ release: cfg?.release || 'open', date: cfg?.date ? String(cfg.date).slice(0, 10) : '', intro: cfg?.intro || '', badgeName: cfg?.badge?.name || '', badgeEmoji: cfg?.badge?.emoji || '🏅' });
  const rel = cfg?.release || 'open';
  const status = rel === 'manual' ? (cfg?.releasedAt ? 'Released' : 'Waiting for you to release') : rel === 'date' && cfg?.date ? `Opens ${new Date(cfg.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : LABEL[rel];
  const save = async () => { setBusy('save'); const r = await call('/api/academy/admin', { action: 'module-settings', tenantId, courseId, title, settings: { release: f.release, date: f.date || null, intro: f.intro, badge: f.badgeName ? { name: f.badgeName, emoji: f.badgeEmoji } : null } }); setBusy(''); if (r.ok) { setOpen(false); onSaved(); } else setMsg(r.error); };
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">{title}</p>
        <button type="button" onClick={() => setOpen(!open)} className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${rel === 'open' ? 'bg-muted text-muted-foreground' : 'bg-violet-100 text-violet-900'}`}>{rel === 'open' ? '🔓' : '🔒'} {status} ▾</button>
        {rel === 'manual' && !cfg?.releasedAt && <button type="button" disabled={!!busy} onClick={async () => { if (!window.confirm(`Release “${title}” to every student now? They’ll get a message.`)) return; setBusy('rel'); const r = await call('/api/academy/admin', { action: 'module-release-now', tenantId, courseId, title }); setBusy(''); setMsg(r.ok ? `Released — ${r.sent} student${r.sent === 1 ? '' : 's'} told.` : r.error); if (r.ok) onSaved(); }} className="rounded-full bg-violet-700 px-3 py-0.5 text-[11px] font-bold text-white disabled:opacity-50">{busy === 'rel' ? 'Releasing…' : 'Release now'}</button>}
      </div>
      {msg && <p className="mt-1 text-[12px] text-emerald-800">{msg}</p>}
      {open && (
        <div className="mt-2 space-y-2 rounded-2xl border-2 border-violet-200 bg-violet-50/50 p-3">
          <p className="text-[12px] font-black">When does this module open?</p>
          <div className="grid grid-cols-2 gap-1.5">{(['open', 'previous', 'date', 'manual'] as const).filter((k) => !(first && k === 'previous')).map((k) => <button key={k} type="button" onClick={() => setF({ ...f, release: k })} className={`rounded-xl px-3 py-2 text-left text-[12px] font-bold ${f.release === k ? 'bg-foreground text-background' : 'bg-background'}`}>{LABEL[k]}</button>)}</div>
          {f.release === 'date' && <input type="date" className={field} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />}
          <label className="block text-[12px] font-bold">Welcome message <span className="font-normal text-muted-foreground">(shown when students start this module)</span><textarea rows={2} className="mt-1 w-full rounded-xl border-2 border-border/60 bg-background p-2 text-sm" value={f.intro} onChange={(e) => setF({ ...f, intro: e.target.value })} placeholder="In this module you’ll learn to keep every client safe…" /></label>
          <div className="flex gap-2"><input className={`${field} w-16 text-center`} value={f.badgeEmoji} onChange={(e) => setF({ ...f, badgeEmoji: e.target.value })} aria-label="Badge emoji" /><input className={field} value={f.badgeName} onChange={(e) => setF({ ...f, badgeName: e.target.value })} placeholder="Badge for finishing (optional) — e.g. Safety star" /></div>
          <div className="flex gap-2"><button type="button" disabled={!!busy} onClick={save} className="h-10 rounded-xl bg-foreground px-4 text-sm font-bold text-background disabled:opacity-50">{busy === 'save' ? 'Saving…' : 'Save'}</button><button type="button" onClick={() => setOpen(false)} className="h-10 px-3 text-sm font-bold text-muted-foreground">Cancel</button></div>
          <p className="text-[11px] text-muted-foreground">Renaming a module starts its settings fresh. Locks are checked on the server — students can’t skip ahead.</p>
        </div>
      )}
    </div>
  );
}

export function GamifySetting({ tenantId }: { tenantId: string }) {
  const [d, setD] = useState<any>(null);
  useEffect(() => { call('/api/academy/school', { action: 'academy-prefs', tenantId }).then((r) => r.ok && setD(r)); }, [tenantId]);
  if (!d) return null;
  return (
    <section className="flex items-start justify-between gap-3 rounded-2xl bg-muted/40 p-4">
      <div><p className="font-black">⭐ Points, streaks and badges</p><p className="text-[12px] text-muted-foreground">Students earn points for lessons, a badge for each module, and a streak for learning on consecutive days. Great for motivation — switch off for a more formal feel.</p></div>
      {d.canChange && <button type="button" role="switch" aria-checked={d.gamify} onClick={async () => { const on = !d.gamify; setD({ ...d, gamify: on }); await call('/api/academy/school', { action: 'gamify-setting', tenantId, on }); }} className={`relative h-8 w-14 shrink-0 rounded-full ${d.gamify ? 'bg-emerald-600' : 'bg-stone-300'}`}><span className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow transition-all ${d.gamify ? 'left-7' : 'left-1'}`} /></button>}
    </section>
  );
}
