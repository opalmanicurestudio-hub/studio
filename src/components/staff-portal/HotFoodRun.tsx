'use client';
// src/components/staff-portal/HotFoodRun.tsx — HOT FOOD ON THE DRIVER'S PHONE, at the top of the staff app's Deliveries
// tab (design board "Hot food on the driver's phone"; api/counter/food-run, lib/food-delivery-server). Hot food goes
// first: the driver's own hot food out with them, then what's ready to take (Take it), then what's being made. A stop
// opens over the tab: where it's going, the note, when it should get there, the guest's tip for them, directions, a text
// that they're outside (from the business's number, never their own), Delivered, or Couldn't deliver and why.
// Delivered (design board "At the door with no signal"): handed to them or left at the door, with the photo the business
// asks for (Delivery settings' proof). With no signal it's kept on this phone with when it was tapped (lib/outbox), and
// goes by itself once the signal's back.
import * as React from 'react';
import { staffAuthHeader } from '@/lib/staff-fetch';
import { mapsLink } from '@/lib/delivery-run';
import { formatTime } from '@/lib/tenant-time';
import { dismissMissed, keptNow, send, useOutbox } from '@/lib/outbox';
import { downscaleImageToDataUrl } from '@/lib/client-image';
const RUN_URL = '/api/counter/food-run';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f7', OK = '#1f7a4d', WARN = '#b45309';
const card: React.CSSProperties = { border: `1px solid ${LINE}`, borderRadius: 20, background: '#fff' };
const RING = 'outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';
const REASONS = [
  { code: 'no_answer', label: 'No one answered' },
  { code: 'no_access', label: 'Couldn’t get in' },
  { code: 'bad_address', label: 'Wrong or missing address' },
  { code: 'other', label: 'Something else' },
];
export type HotRow = { orderId: string; number: string; name: string | null; to: string; mapTo: string; note: string | null; arriveAt: string | null; driveMin: number; outAt?: string | null;
  step: 'making' | 'ready' | 'out' | 'delivered' | 'failed'; readyFor: number | null; leaveAt: string | null; driverId: string | null; tip: number;
  /** Its place in the driver's planned route, and when it should get there (lib/route-server). */
  route?: { id: string; seq: number; eta: string | null; late: boolean } | null;
  /** Another ready one going the same way (lib/route-plan goesWith). */
  with?: { orderId: string; number: string; addMin: number } | null };
type Row = HotRow;
const usd = (n: number) => `$${(Math.round((Number(n) || 0) * 100) / 100).toFixed(2)}`;

function Btn({ kind = 'soft', children, className = '', ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { kind?: 'primary' | 'soft' | 'line' }) {
  const style: React.CSSProperties = kind === 'primary' ? { background: INK, color: '#fff' } : kind === 'line' ? { border: `1px solid ${LINE}`, color: INK, background: '#fff' } : { background: SOFT, color: INK };
  return <button type="button" {...rest} className={`flex h-12 items-center justify-center rounded-full px-5 text-[15px] font-semibold disabled:opacity-45 ${RING} ${className}`} style={{ ...style, ...(rest.style || {}) }}>{children}</button>;
}

export function HotFoodRun({ tenantId, tz, me, onRows }: { tenantId: string; tz: string; me: string; onRows?: (rows: HotRow[]) => void }) {
  const [rows, setRows] = React.useState<Row[]>([]); const [busy, setBusy] = React.useState('');
  const [open, setOpen] = React.useState<string | null>(null); const [failing, setFailing] = React.useState(false);
  const [say, setSay] = React.useState<{ text: string; bad?: boolean } | null>(null);
  // Delivered: handed over or left (null: not asked yet), and the photo, by the business's proof setting.
  const [proof, setProof] = React.useState<'always' | 'left' | 'off'>('left');
  const [left, setLeft] = React.useState<boolean | null>(null); const [photo, setPhoto] = React.useState<string | null>(null);
  const box = useOutbox(tenantId);
  // Delivered taps kept on this phone (no signal), still to go: off the list until they do.
  const saved = keptNow().filter((k) => k.url === RUN_URL && k.tenantId === tenantId && k.body?.action === 'done').map((k) => String(k.body.orderId));
  const call = React.useCallback(async (body: any) => {
    try {
      const r = await fetch('/api/counter/food-run', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await staffAuthHeader()) }, body: JSON.stringify({ tenantId, ...body }) });
      return await r.json().catch(() => ({ ok: false, error: 'That didn’t go through. Try again.' }));
    } catch { return { ok: false, error: 'No connection. Try again.' }; }
  }, [tenantId]);
  const load = React.useCallback(async () => { const d = await call({ action: 'list' }); if (d?.ok) { setRows(d.rows || []); onRows?.(d.rows || []); if (['always', 'left', 'off'].includes(d.photo)) setProof(d.photo); } }, [call, onRows]);
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
  const close = () => { setOpen(null); setFailing(false); setLeft(null); setPhoto(null); };
  const needPhoto = (l: boolean) => proof === 'always' || (l && proof === 'left');
  // Delivered, kept on this phone when there's no signal (with when it was tapped), sent by itself when it's back.
  const deliver = async (r: Row, l: boolean, dataUrl: string | null) => {
    setBusy('done');
    const res = await send(RUN_URL, { tenantId, action: 'done', orderId: r.orderId, left: l, ...(r.outAt ? { outAt: r.outAt } : {}), ...(dataUrl ? { dataUrl } : {}) }, { label: `${r.number} delivered`, auth: 'user', keep: true, tenantId, maxAgeMs: 2 * 3600000, stamp: 'tappedAt' });
    setBusy('');
    if (res.kept) {
      // (Kept only if this phone had room for it: a full phone says so, and the stop stays to tap again.)
      const held = keptNow().some((k) => k.url === RUN_URL && k.body?.action === 'done' && k.body?.orderId === r.orderId);
      if (!held) { setSay({ text: `${r.number} couldn’t be saved on this phone: it’s full. Tap Delivered again when you have signal.`, bad: true }); return; }
      setSay({ text: `${r.number} is saved on this phone as delivered at ${formatTime(new Date().toISOString(), tz)}. It goes as soon as you have signal.` }); close(); return;
    }
    const d = res.d || {};
    if (d.ok) { setSay({ text: d.already ? 'That was done already.' : `${r.number} delivered.${r.tip > 0 ? ` The ${usd(r.tip)} tip is yours.` : ''}` }); close(); void load(); }
    else setSay({ text: d.error || 'That didn’t go through. Try again.', bad: true });
  };
  const pick = (r: Row, l: boolean) => { if (needPhoto(l)) { setLeft(l); setPhoto(null); } else void deliver(r, l, null); };
  const takePhoto = async (f: File | undefined) => {
    if (!f) return; setBusy('photo');
    // (Small enough to keep a few on the phone when there's no signal.)
    try { setPhoto(await downscaleImageToDataUrl(f, { maxDim: 1024, quality: 0.6 })); } catch { setSay({ text: 'That photo couldn’t be read. Try again.', bad: true }); }
    finally { setBusy(''); }
  };
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
  const take = (r: Row) => step(`take-${r.orderId}`, { action: 'take', orderId: r.orderId }, `${r.number} is out with you. ${r.name || 'They'} got a text that it’s on its way.`);
  // Both, one after the other: the second only once the first is theirs.
  const takeBoth = async (r: Row, w: { orderId: string; number: string }) => {
    setBusy(`both-${r.orderId}`);
    const a = await call({ action: 'take', orderId: r.orderId }); const b = a?.ok ? await call({ action: 'take', orderId: w.orderId }) : null;
    setBusy('');
    setSay(a?.ok && b?.ok ? { text: `${r.number} and ${w.number} are out with you. Both got a text that it’s on its way.` } : a?.ok ? { text: `${r.number} is out with you. ${w.number}: ${b?.error || 'it didn’t go through.'}`, bad: true } : { text: a?.error || 'That didn’t go through. Try again.', bad: true });
    void load();
  };
  const mine = rows.filter((r) => r.step === 'out' && r.driverId === me && !saved.includes(r.orderId));
  const missed = box.missed.filter((m) => / delivered$/.test(m.label));
  const ready = rows.filter((r) => r.step === 'ready'); const making = rows.filter((r) => r.step === 'making');
  const stop = open ? mine.find((r) => r.orderId === open) || null : null;
  // The stop left the run (delivered, brought back, or done by a manager): back to the tab.
  React.useEffect(() => { if (open && rows.length && !stop) close(); }, [open, rows, stop]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!rows.length && !say && !saved.length && !missed.length) return null;
  const apple = typeof navigator !== 'undefined' && /iPhone|iPad|Macintosh/.test(navigator.userAgent);
  const at = (iso: string | null) => (iso ? formatTime(iso, tz) : '');
  const note = say && <p role={say.bad ? 'alert' : 'status'} className="rounded-2xl px-4 py-3 text-[15px]" style={{ background: say.bad ? '#fff7ed' : '#eaf6ef', color: say.bad ? WARN : OK }}>{say.text}</p>;
  // Kept on this phone, and any the server turned down when they arrived (delivered by someone else meanwhile, say).
  const waiting = (saved.length > 0 || missed.length > 0) && <div className="space-y-1.5">
    {saved.length > 0 && <p role="status" className="rounded-2xl px-4 py-3 text-[15px]" style={{ background: '#fff7ed', color: WARN }}><b className="font-semibold">{box.down ? 'No signal. ' : 'Sending. '}</b>{saved.length === 1 ? '1 delivery is' : `${saved.length} deliveries are`} saved on this phone. {saved.length === 1 ? 'It goes' : 'They go'} as soon as you have signal.</p>}
    {missed.map((m) => <p key={m.id} role="alert" className="rounded-2xl px-4 py-3 text-[15px]" style={{ background: '#fff7ed', color: WARN }}>{m.label} didn’t go through: {m.error}</p>)}
    {missed.length > 0 && <Btn kind="line" className="w-full" onClick={() => dismissMissed(tenantId)}>Got it</Btn>}
  </div>;

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
            {left === null ? <div className="space-y-2 pt-2" role="group" aria-labelledby="hot-how-h">
              <h3 id="hot-how-h" className="text-[16px] font-semibold">How did it go?</h3>
              <Btn kind="primary" className="w-full" disabled={!!busy} onClick={() => pick(stop, false)}>{busy === 'done' ? 'One moment…' : 'Handed it to them'}</Btn>
              <Btn kind="line" className="w-full" disabled={!!busy} onClick={() => pick(stop, true)}>Left it at the door</Btn>
            </div> : <div className="space-y-2 pt-2" role="group" aria-labelledby="hot-photo-h">
              <h3 id="hot-photo-h" className="text-[16px] font-semibold">{left ? 'A photo of where you left it' : 'A photo of the delivery'}</h3>
              <p className="text-[13.5px]" style={{ color: MUTED }}>{proof === 'always' ? 'The business asks for one on every delivery.' : 'The business asks for one when it’s left.'} {stop.name || 'They'} see{stop.name ? 's' : ''} it on their order page.</p>
              {photo ? <img src={photo} alt="The delivery photo" className="h-48 w-full rounded-2xl object-cover" /> : null}
              <label className={`flex h-12 w-full cursor-pointer items-center justify-center rounded-full text-[15px] font-semibold ${RING}`} style={{ border: `1px solid ${LINE}`, color: INK }}>
                {busy === 'photo' ? 'One moment…' : photo ? 'Take it again' : 'Take a photo'}
                <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => void takePhoto(e.target.files?.[0])} />
              </label>
              <Btn kind="primary" className="w-full" disabled={!!busy || !photo} onClick={() => void deliver(stop, left, photo)}>{busy === 'done' ? 'One moment…' : 'Delivered'}</Btn>
              <Btn className="w-full" onClick={() => { setLeft(null); setPhoto(null); }}>Back</Btn>
            </div>}
            {left === null && <button type="button" onClick={() => setFailing(true)} className={`h-12 w-full rounded-full text-[15px] font-semibold ${RING}`} style={{ color: MUTED }}>Couldn’t deliver</button>}
          </div>)}
      </div>
    </div>);

  return (
    <section aria-labelledby="hot-h" className="space-y-2">
      <h3 id="hot-h" className="text-[13px] font-semibold" style={{ color: MUTED }}>Hot food goes first</h3>
      {note}
      {waiting}
      {mine.map((r, i) => (
        <button key={r.orderId} type="button" onClick={(e) => { opener.current = e.currentTarget; setOpen(r.orderId); }} className={`flex w-full items-start gap-3 p-4 text-left ${RING}`} style={card}>
          <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full text-[14px] font-semibold text-white" style={{ background: INK }}>{i + 1}</span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center justify-between gap-2"><span className="text-[16px] font-semibold">{r.number}{r.name ? ` ${r.name}` : ''}</span><span className="rounded-full px-2.5 py-1 text-[12.5px] font-semibold" style={{ background: SOFT }}>Hot food</span></span>
            <span className="block text-[14px]" style={{ color: MUTED }}>{r.to}.{r.arriveAt ? ` Arrive by ${at(r.arriveAt)}.` : ''}</span>
            {r.route?.eta && <span className="block text-[13.5px]" style={{ color: r.route.late ? WARN : MUTED }}>{r.route.late ? `Around ${at(r.route.eta)}, after its time. Let them know.` : `Around ${at(r.route.eta)}.`}</span>}
            {r.route && !r.route.eta && <span className="block text-[13.5px]" style={{ color: MUTED }}>Not found on the map.</span>}
          </span>
        </button>))}
      {ready.map((r) => (
        <div key={r.orderId} className="space-y-2 p-4" style={{ ...card, borderColor: WARN }}>
          <div className="flex items-center justify-between gap-2"><span className="text-[16px] font-semibold">{r.number}{r.name ? ` ${r.name}` : ''}</span>
            <span className="rounded-full px-2.5 py-1 text-[12.5px] font-semibold" style={{ background: '#fff7ed', color: WARN }}>Ready {r.readyFor ? `${r.readyFor} min` : 'now'}</span></div>
          <p className="text-[14px]" style={{ color: MUTED }}>{r.to}.{r.arriveAt ? ` Arrive by ${at(r.arriveAt)}.` : ''}{r.driveMin ? ` About a ${r.driveMin}-minute drive.` : ''}{r.tip > 0 ? ` Tip ${usd(r.tip)}.` : ''}</p>
          {(() => {
            // Offered once, on the first of the two; the other says so.
            const pi = r.with ? ready.findIndex((x) => x.orderId === r.with!.orderId) : -1; const ri = ready.indexOf(r);
            const w = pi >= 0 && (pi > ri || ready[pi].with?.orderId !== r.orderId) ? r.with : null;
            if (!w && pi >= 0) return (<><p className="text-[13.5px] font-semibold" style={{ color: OK }}>Goes with {ready[pi].number}, above.</p>
              <Btn kind="line" className="w-full" disabled={!!busy} onClick={() => void take(r)}>{busy === `take-${r.orderId}` ? 'One moment…' : `Take ${r.number} only`}</Btn></>);
            return w ? (<>
            <p className="rounded-xl px-3 py-2 text-[14px] font-semibold" style={{ background: '#eaf6ef', color: OK }}>Goes with {w.number}: adds about {Math.max(1, w.addMin)} min, both on time</p>
            <Btn kind="primary" className="w-full" disabled={!!busy} onClick={() => void takeBoth(r, w)}>{busy === `both-${r.orderId}` ? 'One moment…' : 'Take both'}</Btn>
            <Btn kind="line" className="w-full" disabled={!!busy} onClick={() => void take(r)}>{busy === `take-${r.orderId}` ? 'One moment…' : `Take ${r.number} only`}</Btn>
          </>) : <Btn kind="primary" className="w-full" disabled={!!busy} onClick={() => void take(r)}>{busy === `take-${r.orderId}` ? 'One moment…' : 'Take it'}</Btn>; })()}
        </div>))}
      {making.map((r) => (
        <div key={r.orderId} className="flex items-center justify-between gap-3 px-4 py-3" style={card}>
          <span className="text-[15px] font-semibold">{r.number}{r.name ? ` ${r.name}` : ''}</span>
          <span className="text-[13.5px]" style={{ color: MUTED }}>{r.leaveAt ? `Ready about ${at(r.leaveAt)}` : 'Being made'}</span>
        </div>))}
    </section>);
}
