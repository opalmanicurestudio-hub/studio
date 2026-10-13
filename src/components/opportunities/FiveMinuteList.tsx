'use client';
// src/components/opportunities/FiveMinuteList.tsx — SOLO: YOUR 5-MINUTE LIST (decided Oct 13; design canvas OE4).
// For one person with no desk: the day's follow-ups as ready-to-send messages, one at a time — Send, Other wording or
// Skip, then the next. Ready at the hour they chose (6 PM by default), at most a few a day. Sending checks consent,
// texting hours and the per-person limit like everywhere else (lib/opportunities-server textCheck); a skipped one
// comes back tomorrow, and after three skips it's let go.
import * as React from 'react';
import { payPost } from '@/components/pay/pay-client';
import { PLAYBOOKS, type OppKind } from '@/lib/opportunities';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f3f3f5', GREEN = '#1f7a4d', RED = '#b42318';

export function FiveMinuteList({ tenantId, items, hour, reload, accent = INK, post, note }: { tenantId: string; items: any[]; hour: number; reload: () => void; accent?: string; post?: (body: any) => Promise<any>; note?: string }) {
  const ready = React.useMemo(() => items.filter((o) => o.status === 'open' && o.message && (Date.parse(o.dueAt || '') || 0) <= Date.now()), [items]);
  const later = items.filter((o) => o.status === 'open' && o.message && (Date.parse(o.dueAt || '') || 0) > Date.now()).length;
  const [list, setList] = React.useState<any[] | null>(null); const [i, setI] = React.useState(0);
  const [msg, setMsg] = React.useState<{ ok: boolean; t: string } | null>(null); const [busy, setBusy] = React.useState(''); const [text, setText] = React.useState('');
  const at = new Date(); at.setHours(hour, 0, 0, 0); const atLabel = at.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).replace(':00', '');
  const cur = list ? list[i] : null;
  React.useEffect(() => { if (cur) { setText(cur.message || ''); setMsg(null); } }, [cur]);
  const next = () => { if (!list) return; if (i + 1 >= list.length) { setList(null); setI(0); reload(); } else setI(i + 1); };
  const act = async (action: string) => {
    if (!cur) return; setBusy(action); setMsg(null);
    const r = await (post ? post({ action, id: cur.id }) : payPost('/api/opportunities', { tenantId, action, id: cur.id }));
    setBusy('');
    if (action === 'reword') { if (r?.ok) setText(r.message || text); else setMsg({ ok: false, t: r?.error || 'That didn’t work.' }); return; }
    if (!r?.ok) { setMsg({ ok: false, t: r?.error || 'That didn’t send.' }); return; }
    setMsg({ ok: true, t: action === 'text' ? 'Sent.' : 'Back on tomorrow’s list.' }); setTimeout(next, 650);
  };
  if (!list) {
    if (!ready.length && !later) return null;
    return (
      <section className="space-y-3 rounded-[20px] border bg-white p-4" style={{ borderColor: LINE, color: INK }} aria-label="Your 5-minute list">
        <div><p className="text-[22px] font-light tracking-[-0.02em]">Your 5-minute list</p>
          <p className="text-[13px]" style={{ color: MUTED }}>{ready.length ? `${ready.length} message${ready.length === 1 ? '' : 's'} ready · about ${Math.max(2, ready.length + 1)} minutes` : `${later} message${later === 1 ? '' : 's'} ready at ${atLabel}`}</p></div>
        {ready.slice(0, 4).map((o) => <div key={o.id} className="rounded-[14px] p-3" style={{ background: SOFT }}>
          <p className="text-[13.5px] font-semibold">{o.clientName} · <span style={{ color: MUTED, fontWeight: 500 }}>{PLAYBOOKS[o.kind as OppKind]?.label || 'Follow-up'}</span></p>
          <p className="mt-0.5 line-clamp-2 text-[13px] leading-snug" style={{ color: MUTED }}>“{o.message}”</p></div>)}
        {ready.length > 0 && <button type="button" onClick={() => { setList(ready); setI(0); }} className="h-11 w-full rounded-full text-[14.5px] font-semibold text-white" style={{ background: accent }}>Start · send → next</button>}
      </section>);
  }
  const tel = String(cur?.phone || '').replace(/[^\d+]/g, '');
  const many = (PLAYBOOKS[cur?.kind as OppKind]?.versions?.length || 0) > 1;
  return (
    <section className="space-y-3 rounded-[20px] border bg-white p-4" style={{ borderColor: LINE, color: INK }} aria-label="Your 5-minute list">
      <div className="flex items-center gap-3"><span className="text-[13px]" style={{ color: MUTED }}>{i + 1} of {list.length}</span>
        <div className="h-1.5 flex-1 overflow-hidden rounded-full" style={{ background: SOFT }}><div className="h-full rounded-full" style={{ width: `${((i + 1) / list.length) * 100}%`, background: INK }} /></div>
        <button type="button" onClick={() => { setList(null); setI(0); reload(); }} className="text-[13px] font-semibold" style={{ color: MUTED }}>Stop</button></div>
      <div><p className="text-[21px] font-light">{cur?.clientName}</p><p className="text-[12.5px] leading-snug" style={{ color: MUTED }}>{cur?.why}</p></div>
      <div className="rounded-[16px] border-[1.5px] px-3.5 py-3 text-[14px] leading-[1.5]" style={{ borderColor: INK }}>{text}</div>
      <div className="flex flex-wrap gap-1.5">
        <button type="button" disabled={!!busy} onClick={() => act('text')} className="h-10 rounded-full px-5 text-[14px] font-semibold text-white disabled:opacity-50" style={{ background: accent }}>{busy === 'text' ? 'Sending…' : 'Send'}</button>
        {many && <button type="button" disabled={!!busy} onClick={() => act('reword')} className="h-10 rounded-full border px-4 text-[13.5px] font-semibold" style={{ borderColor: LINE }}>Other wording</button>}
        <button type="button" disabled={!!busy} onClick={() => act('skip')} className="h-10 rounded-full border px-4 text-[13.5px]" style={{ borderColor: LINE }}>Skip</button>
        {tel && <a href={`tel:${tel}`} className="inline-flex h-10 items-center rounded-full border px-4 text-[13.5px]" style={{ borderColor: LINE }}>Call instead</a>}</div>
      {msg && <p className="text-[13px] font-semibold" style={{ color: msg.ok ? GREEN : RED }}>{msg.t}{!msg.ok && <button type="button" onClick={next} className="ml-2 underline">Next</button>}</p>}
      <p className="text-[12px] leading-snug" style={{ color: MUTED }}>{note || 'Texts go from your business number, written from you. A reply comes back to your To do list.'}</p>
    </section>);
}
