'use client';
// src/components/staff-portal/AlertSettings.tsx — PORTAL → ME → ALERTS: each person decides which kinds of alert buzz
// their phone (the rest wait quietly in the app), sets quiet hours, or marks themselves away until a date. While
// they're clocked in everything buzzes as normal — these settings are for time off. Saved on their own staff record
// (the database lets them change only these fields), and the phone sender (lib/notify-prefs) follows them.
import * as React from 'react';
import { doc, updateDoc } from 'firebase/firestore';
import { useDoc, useMemoFirebase } from '@/firebase';
import { GROUPS, type NotifyGroup } from '@/lib/notify-prefs';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee';

function Switch({ on, onChange, label, accent }: { on: boolean; onChange: (v: boolean) => void; label: string; accent: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)}
      className="relative h-[30px] w-[50px] shrink-0 rounded-full transition-colors" style={{ background: on ? accent : '#d9dadd' }}>
      <span className="absolute top-[3px] h-6 w-6 rounded-full bg-white shadow transition-all" style={{ left: on ? 23 : 3 }} />
    </button>);
}

export function AlertSettings({ firestore, tenantId, staffId, isManager, isRenter, hasRent, accent = INK, onDone }:
  { firestore: any; tenantId: string; staffId: string; isManager: boolean; isRenter: boolean; hasRent: boolean; accent?: string; onDone: () => void }) {
  const ref = useMemoFirebase(() => (!firestore || !tenantId || !staffId) ? null : doc(firestore, `tenants/${tenantId}/staff/${staffId}`), [firestore, tenantId, staffId]);
  const { data } = useDoc<any>(ref);
  const [prefs, setPrefs] = React.useState<Record<string, string>>({});
  const [quiet, setQuiet] = React.useState({ on: false, start: '21:00', end: '08:00' });
  const [away, setAway] = React.useState(''); const [busy, setBusy] = React.useState(false); const [err, setErr] = React.useState('');
  const loaded = React.useRef(false);
  React.useEffect(() => { if (!data || loaded.current) return; loaded.current = true;
    setPrefs(data.notificationPrefs || {});
    setQuiet({ on: !!data.quietHours?.on, start: data.quietHours?.start || '21:00', end: data.quietHours?.end || '08:00' });
    const a = data.notificationAvailability; setAway(a?.mode === 'away' && a.awayUntil && Date.parse(a.awayUntil) > Date.now() ? String(a.awayUntil).slice(0, 10) : ''); }, [data]);

  const groups = GROUPS.filter((g) => isRenter ? ['clients', 'team', 'rent'].includes(g.id)
    : g.id === 'rent' ? hasRent : g.id === 'business' ? isManager : true);
  const today = new Date().toLocaleDateString('en-CA');

  const save = async () => {
    if (!ref) return; setBusy(true); setErr('');
    try {
      const prev = data?.notificationAvailability || {};
      await updateDoc(ref as any, {
        notificationPrefs: prefs, quietHours: quiet,
        notificationAvailability: away ? { ...prev, mode: 'away', awayUntil: `${away}T23:59:59` } : { ...prev, mode: prev.mode === 'away' ? 'business_hours_only' : (prev.mode || 'business_hours_only'), awayUntil: null },
        updatedAt: new Date().toISOString() });
      onDone();
    } catch { setErr('That didn’t save — check your connection and try again.'); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-4" style={{ color: INK }}>
      <div className="flex items-center gap-2">
        <button type="button" onClick={onDone} className="h-10 rounded-full px-3 text-[14px] font-semibold" style={{ background: '#f4f4f5' }} aria-label="Back to Me">Back</button>
        <p className="text-[20px] font-extrabold">Alerts</p>
      </div>
      <p className="text-[14px]" style={{ color: MUTED }}>Choose what buzzes your phone. Everything still shows up in the app. While you’re clocked in, everything buzzes as normal.</p>

      <section aria-label="What buzzes" className="overflow-hidden rounded-[24px] border bg-white divide-y" style={{ borderColor: LINE }}>
        {groups.map((g) => { const on = prefs[g.id] !== 'quiet'; return (
          <div key={g.id} className="flex items-center gap-3 px-4 py-3.5" style={{ borderColor: '#f0f0f2' }}>
            <span className="min-w-0 flex-1"><span className="block text-[15px] font-semibold">{g.label}</span><span className="block text-[13px]" style={{ color: MUTED }}>{g.hint}</span></span>
            <Switch on={on} label={g.label} accent={accent} onChange={(v) => setPrefs((p) => ({ ...p, [g.id as NotifyGroup]: v ? 'buzz' : 'quiet' }))} />
          </div>); })}
      </section>

      <section aria-label="Quiet hours" className="space-y-3 rounded-[24px] border bg-white p-4" style={{ borderColor: LINE }}>
        <div className="flex items-center gap-3">
          <span className="min-w-0 flex-1"><span className="block text-[15px] font-semibold">Quiet hours</span><span className="block text-[13px]" style={{ color: MUTED }}>No buzzing overnight or on your downtime</span></span>
          <Switch on={quiet.on} label="Quiet hours" accent={accent} onChange={(v) => setQuiet((q) => ({ ...q, on: v }))} />
        </div>
        {quiet.on && (
          <div className="grid grid-cols-2 gap-2">
            <label className="text-[13px] font-semibold" style={{ color: MUTED }}>From
              <input type="time" value={quiet.start} onChange={(e) => setQuiet((q) => ({ ...q, start: e.target.value }))} className="mt-1 h-12 w-full rounded-[14px] border px-3 text-[16px] font-semibold" style={{ borderColor: '#e6e6e8', color: INK }} /></label>
            <label className="text-[13px] font-semibold" style={{ color: MUTED }}>Until
              <input type="time" value={quiet.end} onChange={(e) => setQuiet((q) => ({ ...q, end: e.target.value }))} className="mt-1 h-12 w-full rounded-[14px] border px-3 text-[16px] font-semibold" style={{ borderColor: '#e6e6e8', color: INK }} /></label>
          </div>)}
      </section>

      <section aria-label="Away" className="space-y-3 rounded-[24px] border bg-white p-4" style={{ borderColor: LINE }}>
        <div className="flex items-center gap-3">
          <span className="min-w-0 flex-1"><span className="block text-[15px] font-semibold">I’m away</span><span className="block text-[13px]" style={{ color: MUTED }}>Holiday or time off — nothing buzzes until you’re back</span></span>
          <Switch on={!!away} label="I’m away" accent={accent} onChange={(v) => setAway(v ? new Date(Date.now() + 7 * 86400000).toLocaleDateString('en-CA') : '')} />
        </div>
        {!!away && <label className="block text-[13px] font-semibold" style={{ color: MUTED }}>Back after
          <input type="date" min={today} value={away} onChange={(e) => setAway(e.target.value)} className="mt-1 h-12 w-full rounded-[14px] border px-3 text-[16px] font-semibold" style={{ borderColor: '#e6e6e8', color: INK }} /></label>}
      </section>

      {err && <p role="alert" className="text-[13px] font-medium" style={{ color: '#b42318' }}>{err}</p>}
      <button type="button" disabled={busy || !data} onClick={save} className="h-12 w-full rounded-[16px] text-[16px] font-bold text-white disabled:opacity-50" style={{ background: INK }}>Save</button>
    </div>);
}
