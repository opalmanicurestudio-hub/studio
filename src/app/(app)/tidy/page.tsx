'use client';
// src/app/(app)/tidy/page.tsx — TIDY MY DAY in the main app (design canvas TD1): pick a provider and a day — the gap,
// the ways to close it by moving their own clients up (no new gaps), light days to clear, what's being asked — and,
// for managers, what happens when a gap opens (ask the provider / tidy first / the waitlist). /api/tidy.
import * as React from 'react';
import { useTenant } from '@/context/TenantContext';
import { AppHeader } from '@/components/shared/AppHeader';
import { TidyPanel } from '@/components/tidy/TidyPanel';
import { payPost } from '@/components/pay/pay-client';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', GREEN = '#1f7a4d', RED = '#b42318';
const MODES: [string, string, string][] = [['ask', 'Ask the provider each time', 'They get a card with both choices; the waitlist waits up to 30 minutes'], ['tidy', 'Tidy their day first', 'The waitlist only if nobody can move up without leaving a gap'], ['waitlist', 'Offer it to the waitlist', 'Fill it with someone new, straight away']];

export default function TidyPage() {
  const { selectedTenant } = useTenant() as any; const tenantId = selectedTenant?.id || '';
  const [s, setS] = React.useState<any>(null); const [staffId, setStaffId] = React.useState(''); const [date, setDate] = React.useState(() => new Date().toLocaleDateString('en-CA'));
  const [msg, setMsg] = React.useState<{ ok: boolean; t: string } | null>(null);
  React.useEffect(() => { if (tenantId) payPost('/api/tidy', { tenantId, action: 'settings' }).then((r) => { setS(r); if (r.ok) setStaffId((cur) => cur || (r.staff.some((m: any) => m.id === r.me) ? r.me : r.staff[0]?.id || '')); }); }, [tenantId]);
  const save = async (patch: any) => { setMsg(null); const r = await payPost('/api/tidy', { tenantId, action: 'save_settings', ...patch }); if (r.ok) { setS({ ...s, settings: r.settings, byStaff: r.byStaff }); setMsg({ ok: true, t: 'Saved.' }); } else setMsg({ ok: false, t: r.error }); };
  return (
    <div className="min-h-full p-4 md:p-8" style={{ color: INK }}><AppHeader title="Tidy my day" />
      <div className="mx-auto mt-4 max-w-[1100px] space-y-4">
        <div><p className="text-[12px] tracking-[0.1em]" style={{ color: MUTED }}>tidy my day</p><h1 className="text-[30px] font-light tracking-[-0.02em]">Close a gap without making another</h1>
          <p className="max-w-[760px] text-[13.5px]" style={{ color: MUTED }}>Moves a provider’s own clients earlier so the free time ends up at the end of the day — or against a break — never as a new hole. Only the people a plan needs are asked, and nobody moves until all of them say yes.</p></div>
        {s?.ok && <div className="flex flex-wrap items-center gap-2">
          {s.boss ? <select aria-label="Provider" value={staffId} onChange={(e) => setStaffId(e.target.value)} className="h-10 rounded-full border bg-white px-4 text-[14px]" style={{ borderColor: LINE }}>{s.staff.map((m: any) => <option key={m.id} value={m.id}>{m.name}</option>)}</select> : null}
          <input type="date" aria-label="Day" value={date} onChange={(e) => setDate(e.target.value)} className="h-10 rounded-full border bg-white px-4 text-[14px]" style={{ borderColor: LINE }} /></div>}
        <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
          <div>{tenantId && staffId ? <TidyPanel key={`${staffId}${date}`} tenantId={tenantId} staffId={staffId} date={date} /> : <p style={{ color: MUTED }}>Loading…</p>}</div>
          {s?.ok && <div className="space-y-3">
            <div className="rounded-[18px] border bg-white p-4" style={{ borderColor: LINE }}>
              <p className="text-[15px] font-semibold">When a gap opens</p><p className="text-[12.5px]" style={{ color: MUTED }}>For everyone{s.boss ? '' : ' (your manager sets this)'}</p>
              <div className="mt-2 space-y-2">{MODES.map(([k, l, d]) => <button key={k} type="button" disabled={!s.boss} onClick={() => save({ gapMode: k })} className="w-full rounded-2xl border p-3 text-left disabled:cursor-default" style={{ borderColor: s.settings.gapMode === k ? GREEN : LINE, background: s.settings.gapMode === k ? '#f6fbf8' : '#fff' }}>
                <span className="block text-[14px] font-semibold">{l}</span><span className="block text-[12px]" style={{ color: MUTED }}>{d}</span></button>)}</div>
              {s.boss && staffId && <label className="mt-3 flex items-center justify-between gap-2 text-[13px]"><span>For {s.staff.find((m: any) => m.id === staffId)?.name?.split(' ')[0] || 'this provider'}</span>
                <select aria-label="This provider's choice" value={s.byStaff?.[staffId]?.gapMode || ''} onChange={(e) => save({ byStaff: { [staffId]: { gapMode: e.target.value || null } } })} className="h-9 rounded-full border bg-white px-3 text-[13px]" style={{ borderColor: LINE }}>
                  <option value="">Same as everyone</option>{MODES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>}
            </div>
            <div className="rounded-[18px] border bg-white p-4 text-[13px]" style={{ borderColor: LINE }}>
              <p className="text-[15px] font-semibold">Limits</p>
              {[['maxEarlierMin', 'Never ask anyone to come more than', [[60, '1 hour'], [120, '2 hours'], [180, '3 hours'], [240, '4 hours'], [360, '6 hours']], 'earlier'], ['minNoticeMin', 'or with less than', [[60, '1 hour'], [90, '90 minutes'], [120, '2 hours'], [180, '3 hours']], 'notice'], ['lightMax', 'A “light day” has at most', [[1, '1 visit'], [2, '2 visits'], [3, '3 visits']], '']].map(([k, l, opts, after]: any) =>
                <label key={k} className="mt-2 flex flex-wrap items-center gap-2"><span>{l}</span><select aria-label={l} disabled={!s.boss} value={s.settings[k]} onChange={(e) => save({ [k]: Number(e.target.value) })} className="h-9 rounded-full border bg-white px-3 text-[13px]" style={{ borderColor: LINE }}>{opts.map(([v, t]: any) => <option key={v} value={v}>{t}</option>)}</select><span>{after}</span></label>)}
            </div>
            {msg && <p className="text-[13px] font-semibold" style={{ color: msg.ok ? GREEN : RED }}>{msg.t}</p>}
          </div>}
        </div>
      </div>
    </div>);
}
