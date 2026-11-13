'use client';
// src/components/orders/LoadBagsSheet.tsx — INTO THE VAN. While the shop scans bags, a delivery goes out only once each
// of its bags' tags has been scanned (lib/bag-tag bagsToLoad), so a bag left on the shelf is caught at the shop, not at
// the customer's door. The last bag scanned sends it out. A tag that won't scan (or a count that was wrong) goes out on
// the PIN of someone the shop lets approve, checked by the server and kept on the order. The server checks the bags'
// signed codes too, whatever screen sends them.
import * as React from 'react';
import { ScanGate } from '@/components/retail/ScanGate';
import { bagReply, bagWords } from '@/lib/bag-tag';
import type { Approvers } from '@/lib/scan-rule';
import { Btn, C, Sheet, feel, muted } from './ui';

type Answer = { ok: boolean; message: string; needBags?: boolean; badBagPin?: boolean };

export function LoadBagsSheet({ tenantId, order, need, approvers, lookup, onGo, onClose }: {
  tenantId: string; order: any; need: number; approvers: Approvers; lookup?: (orderId: string) => any;
  onGo: (codes: string[], bagPin?: string) => Promise<Answer>; onClose: () => void;
}) {
  const [bags, setBags] = React.useState<Map<number, string>>(new Map());
  const [err, setErr] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [skipOpen, setSkipOpen] = React.useState(false);
  const [pin, setPin] = React.useState('');
  const num = `#${String(order.orderNumber ?? '').padStart(4, '0')}`;
  const tagHref = order.qrToken ? `/print/label/${tenantId}/${order.id}?t=${encodeURIComponent(order.qrToken)}` : '';
  const next = Array.from({ length: need }, (_, i) => i + 1).find((n) => !bags.has(n));

  const go = async (codes: string[], bagPin?: string) => {
    setBusy(true); setErr('');
    const r = await onGo(codes, bagPin);
    setBusy(false); feel(r.ok);
    if (r.ok) return;
    setErr(r.message);
    if (r.needBags) setBags(new Map());
    if (r.badBagPin) setPin('');
  };
  const onBag = (v: string) => {
    if (busy) return;
    const r = bagReply(v, order, need, bags, lookup);
    if (!r.ok) { feel(false); setErr(r.message); return; }
    feel(true); setErr('');
    const m = new Map(bags).set(r.n, r.code); setBags(m);
    if (m.size >= need) void go([...m.values()]);
  };

  return (
    <Sheet title="Scan the bags into the van" sub={`${num} · ${order.customerName || 'Customer'} · ${need} ${need === 1 ? 'bag' : 'bags'}`} onClose={onClose}>
      <ul aria-label="Bags" className="m-0 mt-2 flex list-none flex-wrap gap-2 p-0">
        {Array.from({ length: need }, (_, i) => i + 1).map((n) => (
          <li key={n} className="flex h-11 items-center rounded-full px-4 text-[15px] font-semibold" style={bags.has(n) ? { background: C.okSoft, color: C.ok } : { background: C.soft, color: C.muted }}>
            {bagWords(n, need)}{bags.has(n) ? <span className="sr-only">, scanned</span> : null}
          </li>))}
      </ul>
      {bags.size > 0 && bags.size < need && <p role="status" className="m-0 mt-3 rounded-2xl px-4 py-3 text-[15px]" style={{ background: C.okSoft }}><b className="font-semibold" style={{ color: C.ok }}>Right {bags.size === 1 ? 'bag' : 'bags'}. </b>{need - bags.size} to go.</p>}
      {busy && <p role="status" className="m-0 mt-3 text-[15px]" style={muted}>Sending it out…</p>}
      {err && <p role="alert" className="m-0 mt-3 rounded-2xl px-4 py-3 text-[15px]" style={{ background: C.warnSoft, color: C.warn }}>{err}</p>}
      <div className="mt-3 overflow-hidden rounded-2xl"><ScanGate onScan={onBag} paused={busy} label={next ? (need > 1 ? `Point at the tag on bag ${next}` : 'Point at the tag on the bag') : 'All scanned'} /></div>
      {tagHref && (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-2xl border px-4 py-3" style={{ borderColor: C.line }}>
          <p className="m-0 min-w-[200px] flex-1 text-[15px] leading-snug">Tag torn or missing? Reprint {need > 1 ? 'the tags' : 'it'} for {num}.</p>
          <a href={tagHref} target="_blank" rel="noreferrer" className="cf-press inline-flex h-11 shrink-0 items-center rounded-full px-4 text-[15px] font-semibold" style={{ background: C.soft, color: C.ink }}>Reprint</a>
        </div>)}
      {!skipOpen ? <button type="button" onClick={() => setSkipOpen(true)} className="mt-2 h-11 text-[15px] font-semibold underline underline-offset-4" style={muted}>A tag won’t scan, or the count is wrong?</button> : (
        <form className="mt-3 rounded-2xl px-4 py-3.5" style={{ background: C.soft }} onSubmit={(e) => { e.preventDefault(); if (pin.length === 4 && !busy) void go([...bags.values()], pin); }}>
          <label htmlFor="load-skip-pin" className="block text-[15px] font-semibold">{approvers === 'managers' ? 'Manager PIN' : 'Your PIN, or a manager’s'}</label>
          <p className="m-0 mt-0.5 text-[13.5px]" style={muted}>Sends it out without every tag scanned. Who approved it goes on the order.</p>
          <div className="mt-2 flex gap-2">
            <input id="load-skip-pin" type="password" inputMode="numeric" pattern="[0-9]*" maxLength={4} autoComplete="off" value={pin} onChange={(e) => { setPin(e.target.value.replace(/\D/g, '').slice(0, 4)); setErr(''); }} placeholder="4 digits"
              className="h-12 min-w-0 flex-1 rounded-xl px-4 text-[20px] tabular-nums outline-none" style={{ border: `1px solid ${C.line}`, background: C.paper, color: C.ink, letterSpacing: pin ? '0.3em' : undefined }} />
            <Btn kind="primary" type="submit" className="shrink-0" disabled={pin.length !== 4 || busy}>Send it out</Btn>
          </div>
        </form>)}
    </Sheet>);
}
