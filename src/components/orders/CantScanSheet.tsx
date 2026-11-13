'use client';
// src/components/orders/CantScanSheet.tsx — AN ITEM THAT WON'T SCAN. While the shop scans every item (lib/scan-rule),
// tapping an item on the packing screen opens this instead of counting it. Three ways on: type the number under the
// barcode (counted as a scan when it matches), print the product's label and scan that, or have someone the shop lets
// approve (a manager, or anyone who packs) approve one unit with their PIN and a reason. The PIN is checked on the
// server (api/retail/fulfil approveUnit); the approval is kept on the order with who and why.
import * as React from 'react';
import { APPROVE_REASONS, type ApproveReason, type Approvers } from '@/lib/scan-rule';
import { lineProductId } from '@/lib/product-codes';
import { Btn, C, Sheet, feel, muted } from './ui';

type Answer = { ok: boolean; message: string };

export function CantScanSheet({ line, left, shelf, approvers, onTyped, onApprove, onClose }: {
  line: any; left: number; shelf?: string; approvers: Approvers;
  onTyped: (code: string) => Promise<Answer>; onApprove: (reason: ApproveReason, pin: string) => Promise<Answer>; onClose: () => void;
}) {
  const [code, setCode] = React.useState('');
  const [reason, setReason] = React.useState<ApproveReason>(APPROVE_REASONS[0]);
  const [pin, setPin] = React.useState('');
  const [busy, setBusy] = React.useState<'' | 'typed' | 'approve'>('');
  const [err, setErr] = React.useState<{ where: 'typed' | 'approve'; text: string } | null>(null);
  const productId = lineProductId(line);
  const typed = async (e: React.FormEvent) => {
    e.preventDefault(); const v = code.trim(); if (!v || busy) return;
    setBusy('typed'); setErr(null);
    const r = await onTyped(v); setBusy('');
    if (r.ok) { onClose(); return; }
    setErr({ where: 'typed', text: r.message });
  };
  const approve = async (e: React.FormEvent) => {
    e.preventDefault(); if (pin.length !== 4 || busy) return;
    setBusy('approve'); setErr(null);
    const r = await onApprove(reason, pin); setBusy(''); setPin('');
    if (r.ok) { feel(true); onClose(); return; }
    feel(false); setErr({ where: 'approve', text: r.message });
  };
  const field = 'h-12 min-w-0 flex-1 rounded-xl px-4 outline-none';
  return (
    <Sheet title={`${line.name} won’t scan`} sub={[line.optionsLabel, shelf ? `Shelf ${shelf}` : '', left > 0 ? `${left} to count` : ''].filter(Boolean).join(' · ')} onClose={onClose} closeLabel="Close">
      <form onSubmit={(e) => void typed(e)} className="mt-2 rounded-2xl border px-4 py-3.5" style={{ borderColor: C.line }}>
        <label htmlFor="cant-code" className="block text-[16px] font-semibold">Type the number under the barcode</label>
        <div className="mt-2 flex gap-2">
          <input id="cant-code" value={code} onChange={(e) => { setCode(e.target.value); setErr(null); }} inputMode="numeric" autoComplete="off" autoCapitalize="off" spellCheck={false}
            placeholder="Barcode number" className={`${field} text-[16px]`} style={{ border: `1px solid ${C.line}`, background: C.paper, color: C.ink }} />
          <Btn kind="primary" type="submit" className="shrink-0" disabled={!code.trim() || !!busy}>{busy === 'typed' ? 'Checking…' : 'Check'}</Btn>
        </div>
        {err?.where === 'typed' ? <p role="alert" className="m-0 mt-2 text-[14px]" style={{ color: C.warn }}>{err.text}</p>
          : <p className="m-0 mt-2 text-[14px]" style={muted}>Counts as scanned when the number matches this item.</p>}
      </form>

      <div className="mt-3 flex flex-wrap items-center gap-3 rounded-2xl border px-4 py-3.5" style={{ borderColor: C.line }}>
        <div className="min-w-[220px] flex-1">
          <p className="m-0 text-[16px] font-semibold">No barcode on it?</p>
          <p className="m-0 mt-1 text-[14px] leading-snug" style={muted}>Print its label, stick it on and scan it. From then on it scans like everything else.</p>
        </div>
        {productId && !productId.startsWith('test-')
          ? <a href={`/inventory/labels?ids=${encodeURIComponent(productId)}`} target="_blank" rel="noreferrer" className="cf-press inline-flex h-12 shrink-0 items-center rounded-full px-5 text-[15px] font-semibold" style={{ background: C.soft, color: C.ink }}>Print its label</a>
          : null}
      </div>

      <form onSubmit={(e) => void approve(e)} className="mt-3 rounded-2xl px-4 py-4" style={{ background: C.soft }}>
        <p className="m-0 text-[16px] font-semibold">Or {approvers === 'managers' ? 'a manager approves' : 'approve'} this one</p>
        <p className="m-0 mt-1 text-[14px] leading-snug" style={muted}>It’s counted as approved, not scanned. Who approved it and why go on the order.</p>
        <div role="group" aria-label="Why it won’t scan" className="mt-3 flex flex-wrap gap-2">
          {APPROVE_REASONS.map((r) => (
            <button key={r} type="button" aria-pressed={reason === r} onClick={() => setReason(r)} className="cf-press h-11 rounded-full px-4 text-[14.5px] font-semibold"
              style={reason === r ? { background: C.ink, color: C.paper } : { background: C.paper, color: C.ink, border: `1px solid ${C.line}` }}>{r}</button>))}
        </div>
        <label htmlFor="cant-pin" className="mt-3.5 block text-[14px] font-semibold">{approvers === 'managers' ? 'Manager PIN' : 'Your PIN, or a manager’s'}</label>
        <div className="mt-1.5 flex gap-2">
          <input id="cant-pin" type="password" inputMode="numeric" pattern="[0-9]*" maxLength={4} autoComplete="off" value={pin} onChange={(e) => { setPin(e.target.value.replace(/\D/g, '').slice(0, 4)); setErr(null); }}
            placeholder="4 digits" className={`${field} text-[20px] tabular-nums`} style={{ border: `1px solid ${C.line}`, background: C.paper, color: C.ink, letterSpacing: pin ? '0.3em' : undefined }} />
          <Btn kind="primary" type="submit" className="shrink-0" disabled={pin.length !== 4 || !!busy}>{busy === 'approve' ? 'Approving…' : 'Approve one'}</Btn>
        </div>
        {err?.where === 'approve' ? <p role="alert" className="m-0 mt-2 text-[14px]" style={{ color: C.warn }}>{err.text}</p>
          : <p className="m-0 mt-2 text-[13.5px]" style={muted}>One at a time: two of the same need two approvals.</p>}
      </form>
    </Sheet>);
}
