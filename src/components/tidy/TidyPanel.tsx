'use client';
// src/components/tidy/TidyPanel.tsx — TIDY MY DAY (design canvas TD1). A provider's gaps waiting on their call, the
// ways to close a gap by moving their own clients up (with no new holes), what's being asked and how it went, and a
// light day that could be cleared. Used on the staff phone (Today — the signed-in provider's own day) and in the main
// app (Tidy my day — any provider, for managers). /api/tidy, lib/tidy-server.
import * as React from 'react';
import { payPost } from '@/components/pay/pay-client';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f3f3f5', GREEN = '#1f7a4d', AMBER = '#b45309', RED = '#b42318', BLUE = '#3d5a99';
const chip = (t: string, c = INK, bg = SOFT) => <span className="inline-flex h-6 items-center whitespace-nowrap rounded-full px-2.5 text-[11.5px] font-semibold" style={{ color: c, background: bg }}>{t}</span>;
const names = (ms: any[]) => (ms.length === 1 ? ms[0].name : ms.length === 2 ? `${ms[0].name} and ${ms[1].name}` : `${ms.length} clients`);

/** Before and after, to scale: who moves (blue), and where the free time ends up (green). */
function Strip({ day, plan, tz }: { day: any[]; plan: any; tz: string }) {
  if (!day?.length) return null;
  const lo = Math.min(...day.map((v) => v.start)), hi = Math.max(...day.map((v) => v.end), plan?.finishFrom || 0); const W = (n: number) => `${((n) / (hi - lo)) * 100}%`;
  const moved = new Map((plan?.moves || []).map((m: any) => [m.id, m]));
  const row = (after: boolean) => <div className="relative h-7 w-full rounded-lg" style={{ background: SOFT }}>
    {day.map((v) => { const m: any = moved.get(v.id); const s = after && m ? m.to : v.start; const len = v.end - v.start;
      return <span key={v.id + String(after)} className="absolute top-0 flex h-7 items-center overflow-hidden rounded-md px-1.5 text-[10.5px] font-semibold" style={{ left: W(s - lo), width: W(len), background: after && m ? '#e6ecf7' : '#fff', color: after && m ? BLUE : INK, border: `1px solid ${after && m ? '#c9d4ea' : LINE}` }}>{v.name}</span>; })}
    {after && plan && plan.freeAt === 'end' && <span className="absolute top-0 flex h-7 items-center rounded-md px-1.5 text-[10.5px] font-semibold" style={{ left: W(plan.finishTo - lo), width: W(plan.finishFrom - plan.finishTo), background: '#e7f3ec', color: GREEN, border: '1px dashed #bfe0cc' }}>free</span>}
  </div>;
  return <div className="space-y-1.5"><div className="flex items-center gap-2 text-[11px]" style={{ color: MUTED }}><span className="w-10">now</span>{row(false)}</div>{plan && <div className="flex items-center gap-2 text-[11px]" style={{ color: MUTED }}><span className="w-10">after</span>{row(true)}</div>}</div>;
}

export function TidyPanel({ tenantId, staffId, date, compact = false, onChanged }: { tenantId: string; staffId?: string | null; date?: string | null; compact?: boolean; onChanged?: () => void }) {
  const [d, setD] = React.useState<any>(null); const [busy, setBusy] = React.useState(''); const [msg, setMsg] = React.useState<{ ok: boolean; t: string } | null>(null); const [more, setMore] = React.useState(false);
  const load = React.useCallback(async () => {
    if (!tenantId) return;
    if (!staffId) { setD(await payPost('/api/tidy', { tenantId, action: 'mine' })); return; }
    const [p, c, a] = await Promise.all([payPost('/api/tidy', { tenantId, action: 'plans', staffId, date }), payPost('/api/tidy', { tenantId, action: 'clear', staffId }), payPost('/api/tidy', { tenantId, action: 'asks' })]);
    setD({ ok: p.ok !== false, error: p.error, days: p.gap || p.asking?.length ? [p] : [], dayAll: p, clear: (c.days || []).slice(0, 3), asks: (a.asks || []).filter((x: any) => x.staffId === staffId), gaps: (a.gaps || []).filter((g: any) => g.staffId === staffId) });
  }, [tenantId, staffId, date]);
  React.useEffect(() => { void load(); const t = setInterval(() => void load(), 30000); return () => clearInterval(t); }, [load]);
  const act = async (body: any, ok: string) => { setBusy(JSON.stringify(body)); setMsg(null); const r = await payPost('/api/tidy', { tenantId, ...body }); setBusy(''); setMsg(r.ok ? { ok: true, t: ok } : { ok: false, t: r.error || 'That didn’t work.' }); await load(); onChanged?.(); };
  if (!d) return compact ? null : <p className="mt-4 text-[14px]" style={{ color: MUTED }}>Loading…</p>;
  if (!d.ok) return compact ? null : <p className="mt-4 text-[14px]" style={{ color: RED }}>{d.error}</p>;
  const live = (d.asks || []).filter((a: any) => a.status === 'asking'); const recent = (d.asks || []).filter((a: any) => a.status !== 'asking').slice(0, 3);
  const days = (d.days || []).filter((x: any) => x.gap && !(x.asking || []).length);
  const nothing = !d.gaps?.length && !days.length && !live.length && !recent.length && !d.clear?.length;
  if (compact && nothing) return null;
  const card = 'rounded-[18px] border bg-white p-4 space-y-3';
  return (
    <section className="space-y-3" style={{ color: INK }} aria-label="Tidy my day">
      {compact && <div className="px-1"><p className="text-[18px] font-semibold">Tidy my day</p><p className="text-[12.5px]" style={{ color: MUTED }}>Close a gap by moving your own clients up — no new gaps</p></div>}
      {msg && <p className="px-1 text-[13.5px] font-semibold" style={{ color: msg.ok ? GREEN : RED }}>{msg.t}</p>}

      {(d.gaps || []).map((g: any) => <div key={g.id} className={card} style={{ borderColor: '#f5c9c4', background: '#fffafa' }}>
        <div><p className="text-[16px] font-bold">{g.when} is free</p><p className="text-[12.5px]" style={{ color: MUTED }}>A cancellation · {g.minutes} min · goes to the waitlist at {g.until} unless you choose</p></div>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={!!busy} onClick={() => act({ action: 'decide', openingId: g.id, choice: 'waitlist' }, 'Offered to the waitlist.')} className="h-10 rounded-full border bg-white px-4 text-[13.5px] font-semibold" style={{ borderColor: LINE }}>Offer it to the waitlist</button>
          <button type="button" disabled={!!busy} onClick={() => act({ action: 'decide', openingId: g.id, choice: 'leave' }, 'Left free.')} className="h-10 px-2 text-[13px] underline" style={{ color: MUTED }}>Leave it free</button></div>
        {g.plans ? <p className="text-[12.5px]" style={{ color: GREEN }}>Or tidy your day below — finish at {g.finish}.</p> : <p className="text-[12.5px]" style={{ color: MUTED }}>Nobody can move up to close it without leaving another gap.</p>}
      </div>)}

      {live.map((a: any) => <div key={a.id} className={card} style={{ borderColor: '#f1d6b0', background: '#fffaf3' }}>
        <div className="flex items-start justify-between gap-2"><div><p className="text-[15px] font-bold">Asked {names(a.moves)} · waiting</p><p className="text-[12.5px]" style={{ color: MUTED }}>Answer by {new Date(a.deadline).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}. Their new times are held — nobody else can book them.</p></div>
          <button type="button" disabled={!!busy} onClick={() => act({ action: 'cancel', askId: a.id }, 'Cancelled — nobody was moved.')} className="text-[12.5px] underline" style={{ color: MUTED }}>Cancel</button></div>
        {a.moves.map((m: any, i: number) => <p key={i} className="flex items-center justify-between gap-2 text-[13.5px]"><span><b>{m.name}</b> {m.fromLabel} → {m.toLabel}</span>{m.answer === 'yes' ? chip('said yes', GREEN, '#e7f3ec') : m.answer === 'no' ? chip('keeping their time', RED, '#fdecec') : chip('asked', AMBER, '#fdf3e6')}</p>)}
        <p className="text-[12px]" style={{ color: MUTED }}>Nobody moves until everyone says yes.</p>
      </div>)}

      {days.map((x: any) => <div key={x.date} className={card} style={{ borderColor: LINE }}>
        <div><p className="text-[16px] font-bold">Close the gap at {x.gap.label}</p><p className="text-[12.5px]" style={{ color: MUTED }}>{x.gap.minutes} min free · {new Date(`${x.date}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long', month: 'short', day: 'numeric' })}</p></div>
        {x.plans.length ? <>
          {x.plans.slice(0, more ? 3 : 1).map((p: any, i: number) => <div key={p.key} className="space-y-2.5 rounded-2xl border p-3" style={{ borderColor: i === 0 ? '#bfe0cc' : LINE }}>
            {p.moves.map((m: any) => <p key={m.id} className="text-[14.5px]">Ask <b>{m.name}</b> to come at <b>{m.toLabel}</b> instead of {m.fromLabel}{m.keen ? <span className="ml-1">{chip('asked to come in sooner', BLUE, '#e6ecf7')}</span> : null}</p>)}
            <Strip day={x.day} plan={p} tz={x.tz} />
            <div className="flex flex-wrap items-center justify-between gap-2">{chip(p.freeAt === 'end' ? `You finish at ${p.finishLabel} instead of ${p.fromLabel}` : 'The gap joins your break', GREEN, '#e7f3ec')}
              <button type="button" disabled={!!busy} onClick={() => act({ action: 'ask', staffId: staffId || undefined, date: x.date, key: p.key }, `Asked ${names(p.moves)}. You’ll hear as they answer.`)} className="h-10 rounded-full px-5 text-[14px] font-semibold disabled:opacity-40" style={{ background: INK, color: '#fff' }}>Ask {names(p.moves)}</button></div>
          </div>)}
          {x.plans.length > 1 && <button type="button" onClick={() => setMore(!more)} className="text-[12.5px] font-semibold" style={{ color: MUTED }}>{more ? 'Fewer' : `Other ways (${x.plans.length - 1})`}</button>}
        </> : <><Strip day={x.day} plan={null} tz={x.tz} /><p className="text-[13.5px]" style={{ color: MUTED }}>Nobody later can move up to close it without leaving another gap{x.day.some((v: any) => v.fixed) ? ` (${x.day.filter((v: any) => v.fixed).map((v: any) => `${v.name}: ${v.fixed}`).join(' · ')})` : ''}.</p></>}
        <p className="text-[12px]" style={{ color: MUTED }}>Only earlier, never later. Nobody is moved until everyone you ask says yes.</p>
      </div>)}

      {(d.clear || []).map((c: any) => <div key={c.key} className={card} style={{ borderColor: LINE }}>
        <div><p className="text-[16px] font-bold">Clear {c.dayLabel}?</p><p className="text-[12.5px]" style={{ color: MUTED }}>{c.moves.length === 1 ? 'It has one visit' : `It has ${c.moves.length} visits`} — and {c.moves.length === 1 ? 'it fits' : 'they fit'} into gaps on your other days.</p></div>
        {c.moves.map((m: any) => <p key={m.id} className="text-[14px]">Ask <b>{m.name}</b> to move from {m.fromLabel} to <b>{m.toLabel}</b>{m.exact ? <span className="ml-1">{chip('fills a gap exactly', GREEN, '#e7f3ec')}</span> : null}</p>)}
        <button type="button" disabled={!!busy} onClick={() => act({ action: 'ask', staffId: staffId || undefined, key: c.key, kind: 'clear' }, `Asked ${names(c.moves)}.`)} className="h-10 rounded-full px-5 text-[14px] font-semibold disabled:opacity-40" style={{ background: INK, color: '#fff' }}>Ask {names(c.moves)}</button>
      </div>)}

      {recent.map((a: any) => <div key={a.id} className={card} style={{ borderColor: a.status === 'done' ? '#bfe0cc' : LINE, background: a.status === 'done' ? '#f6fbf8' : '#fff' }}>
        {a.status === 'done' ? <><p className="text-[15px] font-bold" style={{ color: GREEN }}>✓ {a.kind === 'clear' ? `${a.dayFreed} is clear` : 'Tidied'}</p>
          <p className="text-[13px]">{a.moves.map((m: any) => `${m.name} → ${m.toLabel}`).join(' · ')}{a.finishLabel ? ` · you finish at ${a.finishLabel}` : ''}</p>
          {a.kind === 'clear' && !a.blocked && <button type="button" disabled={!!busy} onClick={() => act({ action: 'block_day', askId: a.id }, `${a.dayFreed} is blocked — nobody can book it.`)} className="h-10 rounded-full border bg-white px-4 text-[13.5px] font-semibold" style={{ borderColor: LINE }}>Block {a.dayFreed} off</button>}</>
          : <><p className="text-[15px] font-bold">Nobody was moved</p><p className="text-[13px]" style={{ color: MUTED }}>{a.why || 'Not everyone said yes.'}</p></>}
      </div>)}

      {!compact && nothing && <div className={card} style={{ borderColor: LINE }}><p className="text-[14px]" style={{ color: MUTED }}>{d.dayAll?.why === 'no gap to close' || !d.dayAll ? 'No gaps to close on this day.' : d.dayAll.why}</p></div>}
    </section>);
}
