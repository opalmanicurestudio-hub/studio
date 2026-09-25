'use client';
// src/components/academy/AttendancePanel.tsx
//
// ATTENDANCE (licensed-school mode) — academy-wide, not per course.
// Open the clock-in screen, verify the records, set location / photo /
// approval rules, and resolve anything that needs attention: people on the
// floor now, missing clock-outs, punches awaiting approval, photo checks,
// corrections (reason required — never overwritten).

import { useEffect, useState } from 'react';
import { getAuth } from 'firebase/auth';
import { Loader, ExternalLink } from 'lucide-react';
import { PrivateImg } from '@/components/shared/private-file';

async function api(body: any) {
  const u = getAuth().currentUser; const tk = u ? await u.getIdToken() : '';
  const r = await fetch('/api/academy/admin', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tk}` }, body: JSON.stringify(body) });
  return r.json().catch(() => ({ ok: false, error: 'No response' }));
}
const hm = (min: number) => `${Math.floor((min || 0) / 60)}h ${(min || 0) % 60}m`;
const dt = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');
const toLocalInput = (iso?: string | null) => { if (!iso) return ''; const d = new Date(iso); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };

export function AttendancePanel({ tenantId }: { tenantId: string }) {
  const [att, setAtt] = useState<any>(null);
  const [audit, setAudit] = useState<any>(null);
  const [msg, setMsg] = useState('');
  useEffect(() => { if (tenantId) api({ action: 'attendance', tenantId }).then((r) => (r.ok ? setAtt(r) : setMsg(r.error))); }, [tenantId]);
  return (
    <div className="space-y-4">
      {msg && <p className="rounded-2xl border-2 border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">{msg}</p>}
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
    </div>
  );
}
