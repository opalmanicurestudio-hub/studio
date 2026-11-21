'use client';
// src/components/staff-portal/HotFoodRun.tsx — HOT FOOD ON THE DRIVER'S PHONE, at the top of the staff app's Deliveries
// tab (design board "Hot food on the driver's phone"; api/counter/food-run, lib/food-delivery-server). Hot food goes
// first: the driver's own hot food out with them, then what's ready to take (Take it), then what's being made. A stop
// opens over the tab: where it's going, the note, when it should get there, the guest's tip for them, directions, a text
// that they're outside (from the business's number, never their own), Delivered, or Couldn't deliver and why.
import * as React from 'react';
import { staffAuthHeader } from '@/lib/staff-fetch';
import { mapsLink } from '@/lib/delivery-run';
import { formatTime } from '@/lib/tenant-time';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f7', OK = '#1f7a4d', WARN = '#b45309';
const card: React.CSSProperties = { border: `1px solid ${LINE}`, borderRadius: 20, background: '#fff' };
const RING = 'outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';
const REASONS = [
  { code: 'no_answer', label: 'No one answered' },
  { code: 'no_access', label: 'Couldn’t get in' },
  { code: 'bad_address', label: 'Wrong or missing address' },
  { code: 'other', label: 'Something else' },
];
type Row = { orderId: string; number: string; name: string | null; to: string; mapTo: string; note: string | null; arriveAt: string | null; driveMin: number;
  step: 'making' | 'ready' | 'out' | 'delivered' | 'failed'; readyFor: number | null; leaveAt: string | null; driverId: string | null; tip: number };
const usd = (n: number) => `$${(Math.round((Number(n) || 0) * 100) / 100).toFixed(2)}`;

function Btn({ kind = 'soft', children, className = '', ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { kind?: 'primary' | 'soft' | 'line' }) {
  const style: React.CSSProperties = kind === 'primary' ? { background: INK, color: '#fff' } : kind === 'line' ? { border: `1px solid ${LINE}`, color: INK, background: '#fff' } : { background: SOFT, color: INK };
  return <button type="button" {...rest} className={`flex h-12 items-center justify-center rounded-full px-5 text-[15px] font-semibold disabled:opacity-45 ${RING} ${className}`} style={{ ...style, ...(rest.style || {}) }}>{children}</button>;
}

export function HotFoodRun({ tenantId, tz, me, onCount }: { tenantId: string; tz: string; me: string; onCount?: (n: number) => void }) {
  const [rows, setRows] = React.useState<Row[]>([]); const [busy, setBusy] = React.useState('');
  const [open, setOpen] = React.useState<string | null>(null); const [failing, setFailing] = React.useState(false);
  const [say, setSay] = React.useState<{ text: string; bad?: boolean } | null>(null);
  const call = React.useCallback(async (body: any) => {
    try {
      const r = await fetch('/api/counter/food-run', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await staffAuthHeader()) }, body: JSON.stringify({ tenantId, ...body }) });
      return await r.json().catch(() => ({ ok: false, error: 'That didn’t go through. Try again.' }));
    } catch { return { ok: false, error: 'No connection. Try again.' }; }
  }, [tenantId]);
  const load = React.useCallback(async () => { const d = await call({ action: 'list' }); if (d?.ok) { setRows(d.rows || []); onCount?.((d.rows || []).length); } }, [call, onCount]);
  React.useEffect(() => {
    void load(); const i = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 15000);
    return () => clearInterval(i);
  }, [load]);
  React.useEffect(() => { if (!say) return; const t = setTimeout(() => setSay(null), 6000); return () => clearTimeout(t); }, [say]);
  const step = async (label: string, body: any, done: string | ((d: any) => { text: string; bad?: boolean }), after?: () => void) => {
    setBusy(label); const d = await call(body); setBusy('');
    if (d?.ok) { setSay(typeof done === 'function' ? done(d) : { text: d.already ? 'That was done already.' : done }); after?.(); } else setSay({ text: d?.error || 'That didn’t go through. Try again.', bad: true });
    void load();
  };
  // The text that they're outside: what actually happened.
  const outsideSaid = (who: string) => (d: any) => (d.sent ? { text: `${who} got a text that you’re outside.` }
    : d.why === 'soon' ? { text: 'They were texted a moment ago. Give them a minute.' }
    : d.why === 'no_phone' ? { text: 'There’s no number to text. Ask the counter to phone them.', bad: true }
    : { text: 'The text didn’t go. Try again, or ask the counter to phone them.', bad: true });
  // The stop opens over the tab: focus goes to its heading, stays inside it, Escape closes it, and focus goes back to
  // the stop that opened it.
  const dialog = React.useRef<HTMLDivElement>(null); const heading = React.useRef<HTMLHeadingElement>(null); const opener = React.useRef<HTMLElement | null>(null);
  const close = () => { setOpen(null); setFailing(false); };
  React.useEffect(() => {
    if (!open) { const back = opener.current; opener.current = null; if (back && document.contains(back)) back.focus(); return; }
    heading.current?.focus();
  }, [open]);
  const keys = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key !== 'Tab' || !dialog.current) return;
    const f = Array.from(dialog.current.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),[tabindex="-1"]')); if (!f.length) return;
    const firstEl = f[0], lastEl = f[f.length - 1];
    if (e.shiftKey && document.activeElement === firstEl) { e.preventDefault(); lastEl.focus(); } else if (!e.shiftKey && document.activeElement === lastEl) { e.preventDefault(); firstEl.focus(); }
  };
  const mine = rows.filter((r) => r.step === 'out' && r.driverId === me);
  const ready = rows.filter((r) => r.step === 'ready'); const making = rows.filter((r) => r.step === 'making');
  const stop = open ? mine.find((r) => r.orderId === open) || null : null;
  // The stop left the run (delivered, brought back, or done by a manager): back to the tab.
  React.useEffect(() => { if (open && rows.length && !stop) close(); }, [open, rows, stop]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!rows.length && !say) return null;
  const apple = typeof navigator !== 'undefined' && /iPhone|iPad|Macintosh/.test(navigator.userAgent);
  const at = (iso: string | null) => (iso ? formatTime(iso, tz) : '');
  const note = say && <p role={say.bad ? 'alert' : 'status'} className="rounded-2xl px-4 py-3 text-[15px]" style={{ background: say.bad ? '#fff7ed' : '#eaf6ef', color: say.bad ? WARN : OK }}>{say.text}</p>;

  if (stop) return (
    <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="hot-stop-h" onKeyDown={keys} className="fixed inset-0 z-50 overflow-y-auto" style={{ background: '#fff', color: INK }}>
      <div className="mx-auto max-w-lg space-y-4 px-4 pb-10 pt-4">
        <button type="button" onClick={close} className={`h-11 rounded-xl text-[15px] font-semibold ${RING}`} style={{ color: MUTED }}>Back to deliveries</button>
        <div>
          <p className="text-[13.5px] font-semibold" style={{ color: MUTED }}>Hot food, stop {mine.indexOf(stop) + 1} of {mine.length}</p>
          <h2 id="hot-stop-h" ref={heading} tabIndex={-1} className="text-[28px] font-semibold tracking-tight outline-none">{stop.number}{stop.name ? ` ${stop.name}` : ''}</h2>
          <p className="mt-1 text-[16px] leading-relaxed">{stop.to}</p>
        </div>
        {stop.note && <p className="rounded-2xl px-4 py-3 text-[15px]" style={{ background: SOFT }}>Note: {stop.note}</p>}
        <dl className="space-y-1.5 text-[15px]">
          {stop.arriveAt && <div className="flex justify-between gap-3"><dt style={{ color: MUTED }}>Arrive by</dt><dd className="font-semibold">{at(stop.arriveAt)}</dd></div>}
          {stop.tip > 0 && <div className="flex justify-between gap-3"><dt style={{ color: MUTED }}>Their tip for you</dt><dd className="font-semibold tabular-nums">{usd(stop.tip)}</dd></div>}
        </dl>
        {note}
        {failing ? (
          <div className="space-y-2" role="group" aria-labelledby="hot-why-h">
            <h3 id="hot-why-h" className="text-[16px] font-semibold">What happened?</h3>
            {REASONS.map((x) => <Btn key={x.code} kind="line" className="w-full" disabled={!!busy} onClick={() => void step('fail', { action: 'failed', orderId: stop.orderId, why: x.code }, 'Bring it back to the counter. A manager will refund it or send it out again.', close)}>{x.label}</Btn>)}
            <Btn className="w-full" onClick={() => setFailing(false)}>Back</Btn>
          </div>
        ) : (
          <div className="space-y-2">
            <a href={mapsLink(stop.mapTo || stop.to, apple)} target="_blank" rel="noreferrer" className={`flex h-12 items-center justify-center rounded-full text-[15px] font-semibold ${RING}`} style={{ border: `1px solid ${LINE}`, color: INK }}>Directions</a>
            <Btn kind="line" className="w-full" disabled={!!busy} onClick={() => void step('outside', { action: 'outside', orderId: stop.orderId }, outsideSaid(stop.name || 'They'))}>{busy === 'outside' ? 'Texting…' : 'Text them I’m outside'}</Btn>
            <Btn kind="primary" className="w-full" disabled={!!busy} onClick={() => void step('done', { action: 'done', orderId: stop.orderId }, `${stop.number} delivered.${stop.tip > 0 ? ` The ${usd(stop.tip)} tip is yours.` : ''}`, () => setOpen(null))}>{busy === 'done' ? 'One moment…' : 'Delivered'}</Btn>
            <button type="button" onClick={() => setFailing(true)} className={`h-12 w-full rounded-full text-[15px] font-semibold ${RING}`} style={{ color: MUTED }}>Couldn’t deliver</button>
          </div>)}
      </div>
    </div>);

  return (
    <section aria-labelledby="hot-h" className="space-y-2">
      <h3 id="hot-h" className="text-[13px] font-semibold" style={{ color: MUTED }}>Hot food goes first</h3>
      {note}
      {mine.map((r, i) => (
        <button key={r.orderId} type="button" onClick={(e) => { opener.current = e.currentTarget; setOpen(r.orderId); }} className={`flex w-full items-start gap-3 p-4 text-left ${RING}`} style={card}>
          <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full text-[14px] font-semibold text-white" style={{ background: INK }}>{i + 1}</span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center justify-between gap-2"><span className="text-[16px] font-semibold">{r.number}{r.name ? ` ${r.name}` : ''}</span><span className="rounded-full px-2.5 py-1 text-[12.5px] font-semibold" style={{ background: SOFT }}>Hot food</span></span>
            <span className="block text-[14px]" style={{ color: MUTED }}>{r.to}.{r.arriveAt ? ` Arrive by ${at(r.arriveAt)}.` : ''}</span>
          </span>
        </button>))}
      {ready.map((r) => (
        <div key={r.orderId} className="space-y-2 p-4" style={{ ...card, borderColor: WARN }}>
          <div className="flex items-center justify-between gap-2"><span className="text-[16px] font-semibold">{r.number}{r.name ? ` ${r.name}` : ''}</span>
            <span className="rounded-full px-2.5 py-1 text-[12.5px] font-semibold" style={{ background: '#fff7ed', color: WARN }}>Ready {r.readyFor ? `${r.readyFor} min` : 'now'}</span></div>
          <p className="text-[14px]" style={{ color: MUTED }}>{r.to}.{r.arriveAt ? ` Arrive by ${at(r.arriveAt)}.` : ''}{r.driveMin ? ` About a ${r.driveMin}-minute drive.` : ''}{r.tip > 0 ? ` Tip ${usd(r.tip)}.` : ''}</p>
          <Btn kind="primary" className="w-full" disabled={!!busy} onClick={() => void step(`take-${r.orderId}`, { action: 'take', orderId: r.orderId }, `${r.number} is out with you. ${r.name || 'They'} got a text that it’s on its way.`)}>{busy === `take-${r.orderId}` ? 'One moment…' : 'Take it'}</Btn>
        </div>))}
      {making.map((r) => (
        <div key={r.orderId} className="flex items-center justify-between gap-3 px-4 py-3" style={card}>
          <span className="text-[15px] font-semibold">{r.number}{r.name ? ` ${r.name}` : ''}</span>
          <span className="text-[13.5px]" style={{ color: MUTED }}>{r.leaveAt ? `Ready about ${at(r.leaveAt)}` : 'Being made'}</span>
        </div>))}
    </section>);
}
