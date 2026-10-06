'use client';
// src/components/clients/ClientTimingCard.tsx — THIS CLIENT'S USUAL TIME, PER SERVICE.
// "Gel manicure · +20 min" (a private reason for the team). Bookings for this client reserve that length; the charge for
// extra time follows the business's rule (Settings → Extra time) unless a fixed amount is set here. Managers edit.
import * as React from 'react';
import { extraChargeCents, extraTimePolicy, minutesLabel, type ClientTiming } from '@/lib/client-timing';

const muted = { color: 'var(--muted, #6b635c)' } as React.CSSProperties;
const card = { background: 'var(--card, #fff)', border: '1px solid var(--line, #e7e2dc)' } as React.CSSProperties;
const money = (c: number) => `$${(c / 100).toFixed(2)}`;

export function ClientTimingCard({ tenant, client, services, canEdit, onSave }: { tenant: any; client: any; services: any[]; canEdit: boolean; onSave: (t: ClientTiming) => void }) {
  const timing: ClientTiming = client?.timing || {}; const entries = Object.entries(timing.services || {}).filter(([, e]) => Number(e?.extra));
  const [editing, setEditing] = React.useState<string | null>(null);
  const [sid, setSid] = React.useState('all'); const [mins, setMins] = React.useState(15); const [reason, setReason] = React.useState(''); const [fixed, setFixed] = React.useState('');
  const pol = extraTimePolicy(tenant); const first = String(client?.name || 'they').split(' ')[0];
  const bookable = services.filter((s) => s.isActive !== false && s.type !== 'addon' && !s.isAddon).sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const nameOf = (id: string) => services.find((s) => s.id === id)?.name || 'A service';
  const open = (key: string) => { setEditing(key); if (key === 'new') { setSid('all'); setMins(15); setReason(''); setFixed(''); return; }
    if (key === 'all') { setSid('all'); setMins(Number(timing.all) || 15); setReason(''); setFixed(''); return; }
    const e = timing.services?.[key]; setSid(key); setMins(Number(e?.extra) || 15); setReason(e?.reason || ''); setFixed(e?.chargeCents != null ? String((Number(e.chargeCents) / 100).toFixed(2)) : ''); };
  const save = () => { const next: ClientTiming = { all: timing.all ?? null, services: { ...(timing.services || {}) } }; const now = new Date().toISOString();
    if (sid === 'all') next.all = mins || null;
    else next.services![sid] = { extra: mins, reason: reason.trim().slice(0, 140) || null, setAt: now, setBy: null, chargeCents: fixed.trim() !== '' && Number(fixed) >= 0 ? Math.round(Number(fixed) * 100) : null };
    onSave(next); setEditing(null); };
  const remove = (key: string) => { const next: ClientTiming = { all: timing.all ?? null, services: { ...(timing.services || {}) } }; if (key === 'all') next.all = null; else delete next.services![key]; onSave(next); setEditing(null); };
  const previewSvc = sid === 'all' ? null : services.find((s) => s.id === sid);
  const preview = previewSvc ? extraChargeCents(tenant, previewSvc, { timing: { services: { [sid]: { extra: mins, chargeCents: fixed.trim() !== '' ? Math.round(Number(fixed) * 100) : null } } } }, sid) : (pol.mode === 'per15' && mins > 0 ? Math.ceil(mins / 15) * pol.centsPer15 : 0);
  const rows: [string, string, number, string | null][] = [...(Number(timing.all) ? [['all', 'Every service', Number(timing.all), null] as [string, string, number, string | null]] : []), ...entries.map(([id, e]) => [id, nameOf(id), Number(e.extra), e.reason || null] as [string, string, number, string | null])];
  return (
    <section className="space-y-2 rounded-3xl p-4" style={card} aria-label="Their usual time">
      <p className="text-[12px] font-semibold" style={muted}>THEIR USUAL TIME</p>
      {rows.length === 0 && editing !== 'new' && <p className="text-[14px]" style={muted}>Booked at each service’s normal length.</p>}
      {rows.map(([key, label, m, why]) => (
        <div key={key} className="flex items-start justify-between gap-2 text-[14px]">
          <span className="min-w-0"><b>{label}</b> · {minutesLabel(m)}{why ? <span className="block text-[12px]" style={muted}>{why} · only the team sees this</span> : null}</span>
          {canEdit && <button type="button" onClick={() => open(key)} className="shrink-0 text-[13px] font-semibold underline underline-offset-2">Change</button>}
        </div>))}
      {canEdit && !editing && <button type="button" onClick={() => open('new')} className="h-9 rounded-full px-3 text-[13px] font-semibold" style={{ background: 'var(--soft, #efebe6)' }}>+ Add usual time</button>}
      {editing && <div className="space-y-2 rounded-2xl p-3" style={{ background: 'var(--soft, #efebe6)' }}>
        <select value={sid} onChange={(e) => setSid(e.target.value)} disabled={editing !== 'new'} aria-label="Which service" className="h-10 w-full rounded-xl border px-2 text-[14px]" style={{ borderColor: 'var(--line, #e7e2dc)', background: 'var(--card, #fff)' }}>
          <option value="all">Every service</option>{bookable.map((s) => <option key={s.id} value={s.id}>{s.name}{s.duration ? ` · ${s.duration} min` : ''}</option>)}</select>
        <div className="flex items-center gap-2 text-[14px]">
          <button type="button" onClick={() => setMins((m) => Math.max(-60, m - 5))} aria-label="5 minutes less" className="h-9 w-9 rounded-full" style={{ background: 'var(--card, #fff)' }}>−</button>
          <b className="w-20 text-center">{minutesLabel(mins)}</b>
          <button type="button" onClick={() => setMins((m) => Math.min(240, m + 5))} aria-label="5 minutes more" className="h-9 w-9 rounded-full" style={{ background: 'var(--card, #fff)' }}>+</button>
          {previewSvc && <span style={muted}>→ {(Number(previewSvc.duration) || 60) + mins} min</span>}
        </div>
        {sid !== 'all' && <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why (for the team, e.g. longer, thicker hair)" aria-label="Why" className="h-10 w-full rounded-xl border px-3 text-[14px]" style={{ borderColor: 'var(--line, #e7e2dc)' }} />}
        {sid !== 'all' && mins > 0 && <label className="flex flex-wrap items-center gap-2 text-[13px]">Charge for the extra time: $<input value={fixed} onChange={(e) => setFixed(e.target.value.replace(/[^\d.]/g, ''))} placeholder={pol.mode === 'per15' ? 'business rate' : 'no charge'} aria-label="Fixed charge" className="h-9 w-28 rounded-xl border px-2" style={{ borderColor: 'var(--line, #e7e2dc)' }} /><span style={muted}>leave empty for the business rate</span></label>}
        <p className="text-[12px]" style={muted}>{mins > 0 ? (preview > 0 ? `${first} pays ${money(preview)} more for this time — shown to them before they confirm.` : `No extra charge${pol.mode === 'none' ? ' (Settings → Extra time is set to no charge)' : ''}.`) : mins < 0 ? `${first} is usually quicker; the price doesn’t change.` : ''} Base it on time taken, never on a personal label.</p>
        <div className="flex gap-2"><button type="button" onClick={save} className="h-9 rounded-full px-4 text-[13px] font-semibold" style={{ background: 'var(--ink, #1c1917)', color: '#fff' }}>Save</button>
          {editing !== 'new' && <button type="button" onClick={() => remove(editing)} className="h-9 rounded-full px-3 text-[13px]" style={muted}>Remove</button>}
          <button type="button" onClick={() => setEditing(null)} className="h-9 rounded-full px-3 text-[13px]" style={muted}>Cancel</button></div>
      </div>}
    </section>);
}
