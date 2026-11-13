'use client';
// src/components/menu/OrderAheadCard.tsx — ORDERING AHEAD, on the Menu page (a manager): on or off, how guests can pick
// up (the drive-thru, inside), how far ahead they can order, and the link (with a code to print) guests order from.
// Orders are paid when they're placed, so payments must be connected first. api/menu 'ahead'; lib/counter-ahead.
import { useEffect, useState } from 'react';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f7', GREEN = '#1f7a4d', AMBER = '#b45309', AMBER_TINT = '#fff7ed';
const RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';
const BTN = `inline-flex min-h-[44px] items-center justify-center rounded-xl px-4 text-[15px] font-semibold disabled:opacity-50 ${RING}`;
export type AheadSettings = { on: boolean; driveThru: boolean; inside: boolean; laterHours: number; payments: boolean; link: string };

export function OrderAheadCard({ start, call }: { start: AheadSettings; call: (body: any) => Promise<any> }) {
  const [a, setA] = useState<AheadSettings>(start);
  const [busy, setBusy] = useState(''); const [err, setErr] = useState(''); const [copied, setCopied] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  useEffect(() => {
    if (!a.on) return; let live = true;
    void import('qrcode').then((Q: any) => Q.toDataURL(a.link, { margin: 1, width: 480, color: { dark: INK, light: '#ffffff' } })).then((img: string) => { if (live) setQr(img); }).catch(() => null);
    return () => { live = false; };
  }, [a.on, a.link]);
  const save = async (k: string, patch: Partial<AheadSettings>) => {
    setBusy(k); setErr('');
    const d = await call({ action: 'ahead', ...patch });
    setBusy('');
    if (d.ok) setA(d.ahead); else setErr(d.error || 'That didn’t save. Try again.');
  };
  const copy = async () => { try { await navigator.clipboard.writeText(a.link); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { setErr('Copy didn’t work. Select the link and copy it.'); } };
  const check = (on: boolean, label: string, k: 'driveThru' | 'inside') => (
    <label className="flex min-h-[44px] items-center gap-3 text-[15px]">
      <input type="checkbox" checked={on} disabled={!!busy} onChange={(e) => save(k, { [k]: e.target.checked })} className="h-5 w-5 accent-[#16171a]" />{label}
    </label>);
  return (
    <section aria-labelledby="ahead-title" className="space-y-4 rounded-3xl border bg-[#fff] p-5" style={{ borderColor: LINE, color: INK }}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="ahead-title" className="text-[16px] font-semibold">Order ahead</h2>
          <p className="mt-1 text-[13.5px] leading-relaxed" style={{ color: MUTED }}>Guests order and pay on their phone, then pick it up at the drive-thru or inside with a 4-digit code. A later order waits on the kitchen screen until it’s time to start.</p>
        </div>
        <button type="button" role="switch" aria-checked={a.on} aria-label="Order ahead" disabled={!!busy || (!a.on && !a.payments)} onClick={() => save('on', { on: !a.on })}
          className={`relative h-8 w-14 shrink-0 rounded-full transition-colors disabled:opacity-50 ${RING}`} style={{ background: a.on ? GREEN : LINE }}>
          <span className="absolute top-1 h-6 w-6 rounded-full bg-[#fff] shadow transition-all" style={{ left: a.on ? 28 : 4 }} />
        </button>
      </div>
      {!a.payments && <p className="rounded-2xl px-4 py-3 text-[14px]" style={{ background: AMBER_TINT, color: AMBER }}>Connect payments in Settings first: orders placed ahead are paid when they’re placed.</p>}
      <div className="grid gap-1 sm:grid-cols-2">
        <div><p className="text-[14px] font-semibold">How guests pick up</p>{check(a.driveThru, 'At the drive-thru', 'driveThru')}{check(a.inside, 'Inside', 'inside')}</div>
        <label className="block"><span className="text-[14px] font-semibold">How far ahead</span>
          <select value={a.laterHours} disabled={!!busy} onChange={(e) => save('hours', { laterHours: Number(e.target.value) })} className={`mt-2 h-11 w-full rounded-xl bg-[#fff] px-3 text-[15px] ${RING}`} style={{ border: `1px solid ${LINE}` }}>
            <option value={0}>As soon as it’s ready only</option>
            {[1, 2, 3, 4, 6, 8, 12].map((h) => <option key={h} value={h}>Up to {h} hour{h === 1 ? '' : 's'} ahead</option>)}
          </select></label>
      </div>
      {a.on && (
        <div className="flex flex-wrap items-center gap-4 rounded-2xl p-4" style={{ background: SOFT }}>
          {qr && <img src={qr} alt="Code guests scan to order ahead" className="h-28 w-28 shrink-0 rounded-xl bg-[#fff] p-1.5" />}
          <div className="min-w-0 flex-1 space-y-2">
            <p className="text-[14px] font-semibold">Where guests order</p>
            <p className="break-all text-[13.5px]" style={{ color: MUTED }}>{a.link}</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={copy} className={BTN} style={{ background: INK, color: '#fff' }}>{copied ? 'Copied' : 'Copy the link'}</button>
              <a href={a.link} target="_blank" rel="noreferrer" className={BTN} style={{ border: `1px solid ${LINE}`, background: '#fff', color: INK }}>Open it</a>
              {qr && <a href={qr} download="order-ahead-code.png" className={BTN} style={{ border: `1px solid ${LINE}`, background: '#fff', color: INK }}>Save the code</a>}
            </div>
          </div>
        </div>)}
      {err && <p role="alert" className="rounded-2xl px-4 py-3 text-[14px] font-medium" style={{ background: AMBER_TINT, color: AMBER }}>{err}</p>}
    </section>
  );
}
