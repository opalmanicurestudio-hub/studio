'use client';
// src/components/pos/RegisterScanSheet.tsx — SCAN IT TO ADD IT (lib/register-scan). Tapping a product with a barcode at
// the register opens this instead of adding it: scan the item in their hand (a handheld scanner, or the camera), and
// that's what's added; a different product scanned is added instead, and said. The number under the barcode can be
// typed. An item that won't scan is added on a manager's PIN with a reason, checked on the server (api/approvals) and
// kept in the audit log. A product with no barcode yet can have its label printed from here.
import * as React from 'react';
import { ScanGate } from '@/components/retail/ScanGate';
import { approveWithPin } from '@/lib/approve-client';
import { APPROVE_REASONS, type ApproveReason } from '@/lib/scan-rule';
import { registerMatch } from '@/lib/register-scan';
import type { CodeBook } from '@/lib/code-lookup';
import { Btn, C, Sheet, feel, muted } from '@/components/orders/ui';

export type RegisterAdd = { item: any; how: 'scanned' | 'typed' | 'approved'; note?: string; approver?: { id: string; name: string }; reason?: string; token?: string };
/** An item added on a manager's PIN, carried on its sale line: the approval is used by the sale on the server and kept
 *  on that item's record (api/checkout/complete). */
export type NoScan = { token: string; by: string; reason: string };

export function RegisterScanSheet({ tenantId, item, label, book, onAdd, onClose }: {
  tenantId: string; item: any; label: string; book: CodeBook; onAdd: (a: RegisterAdd) => void; onClose: () => void;
}) {
  const [err, setErr] = React.useState<{ where: 'scan' | 'typed' | 'approve'; text: string } | null>(null);
  const [code, setCode] = React.useState('');
  const [reason, setReason] = React.useState<ApproveReason>(APPROVE_REASONS[0]);
  const [pin, setPin] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const id = String(item?.id ?? '');

  const take = (raw: string, typed: boolean) => {
    const m = registerMatch(book, raw, item, { typed });
    if (m.kind === 'none') { feel(false); setErr({ where: typed ? 'typed' : 'scan', text: m.message }); return; }
    feel(true);
    onAdd({ item: m.item, how: typed ? 'typed' : 'scanned', ...(m.kind === 'other' ? { note: `You scanned ${m.item?.name || 'another product'}, so that’s what was added.` } : {}) });
  };
  const approve = async (e: React.FormEvent) => {
    e.preventDefault(); if (pin.length !== 4 || busy) return;
    setBusy(true); setErr(null);
    const r = await approveWithPin(tenantId, pin, { kind: 'item_without_scan', ref: id, reason: `${label}: ${reason}` });
    setBusy(false); setPin('');
    if (!r.ok || !r.approver) { feel(false); setErr({ where: 'approve', text: r.error || 'That PIN didn’t approve it.' }); return; }
    feel(true); onAdd({ item, how: 'approved', approver: { id: r.approver.id, name: r.approver.name }, reason, token: r.token });
  };
  const field = 'h-12 min-w-0 flex-1 rounded-xl px-4 outline-none';
  return (
    <Sheet title={`Scan ${label}`} sub="Scan the item in their hand. That’s what goes on the sale." onClose={onClose}>
      {err?.where === 'scan' && <p role="alert" className="m-0 mt-2 rounded-2xl px-4 py-3 text-[15px]" style={{ background: C.warnSoft, color: C.warn }}>{err.text}</p>}
      <div className="mt-3 overflow-hidden rounded-2xl"><ScanGate onScan={(v) => take(v, false)} paused={busy} label="Point at the barcode on the item" /></div>

      <form onSubmit={(e) => { e.preventDefault(); if (code.trim()) take(code.trim(), true); }} className="mt-3 rounded-2xl border px-4 py-3.5" style={{ borderColor: C.line }}>
        <label htmlFor="reg-code" className="block text-[16px] font-semibold">Or type the number under the barcode</label>
        <div className="mt-2 flex gap-2">
          <input id="reg-code" value={code} onChange={(e) => { setCode(e.target.value); setErr(null); }} inputMode="numeric" autoComplete="off" autoCapitalize="off" spellCheck={false}
            placeholder="Barcode number" className={`${field} text-[16px]`} style={{ border: `1px solid ${C.line}`, background: C.paper, color: C.ink }} />
          <Btn kind="primary" type="submit" className="shrink-0" disabled={!code.trim()}>Add</Btn>
        </div>
        {err?.where === 'typed' && <p role="alert" className="m-0 mt-2 text-[14px]" style={{ color: C.warn }}>{err.text}</p>}
      </form>

      <form onSubmit={(e) => void approve(e)} className="mt-3 rounded-2xl px-4 py-4" style={{ background: C.soft }}>
        <p className="m-0 text-[16px] font-semibold">Won’t scan? A manager approves this one</p>
        <p className="m-0 mt-1 text-[14px] leading-snug" style={muted}>It’s added without a scan. Who approved it and why are kept.</p>
        <div role="group" aria-label="Why it won’t scan" className="mt-3 flex flex-wrap gap-2">
          {APPROVE_REASONS.map((r) => (
            <button key={r} type="button" aria-pressed={reason === r} onClick={() => setReason(r)} className="cf-press h-11 rounded-full px-4 text-[14.5px] font-semibold"
              style={reason === r ? { background: C.ink, color: C.paper } : { background: C.paper, color: C.ink, border: `1px solid ${C.line}` }}>{r}</button>))}
        </div>
        <label htmlFor="reg-pin" className="mt-3.5 block text-[14px] font-semibold">Manager PIN</label>
        <div className="mt-1.5 flex gap-2">
          <input id="reg-pin" type="password" inputMode="numeric" pattern="[0-9]*" maxLength={4} autoComplete="off" value={pin} onChange={(e) => { setPin(e.target.value.replace(/\D/g, '').slice(0, 4)); setErr(null); }}
            placeholder="4 digits" className={`${field} text-[20px] tabular-nums`} style={{ border: `1px solid ${C.line}`, background: C.paper, color: C.ink, letterSpacing: pin ? '0.3em' : undefined }} />
          <Btn kind="primary" type="submit" className="shrink-0" disabled={pin.length !== 4 || busy}>{busy ? 'Checking…' : 'Approve one'}</Btn>
        </div>
        {err?.where === 'approve' && <p role="alert" className="m-0 mt-2 text-[14px]" style={{ color: C.warn }}>{err.text}</p>}
      </form>

      {id && !id.startsWith('test-') && (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-2xl border px-4 py-3.5" style={{ borderColor: C.line }}>
          <p className="m-0 min-w-[200px] flex-1 text-[14.5px] leading-snug">Label missing or torn? Print a new one, stick it on, and it scans from then on.</p>
          <a href={`/inventory/labels?ids=${encodeURIComponent(id)}`} target="_blank" rel="noreferrer" className="cf-press inline-flex h-12 shrink-0 items-center rounded-full px-5 text-[15px] font-semibold" style={{ background: C.soft, color: C.ink }}>Print its label</a>
        </div>)}
    </Sheet>);
}
