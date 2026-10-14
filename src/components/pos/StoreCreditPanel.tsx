'use client';
// src/components/pos/StoreCreditPanel.tsx — STORE CREDIT AT THE POS (CheckoutHub). When the client has credit, it comes
// off by itself: the most it can (their balance or the bill, whichever is less). Staff can change the amount or choose
// not to use it. Nothing is used until the sale is paid — the server uses the credit only once the sale is recorded
// (/api/checkout/complete with lib/store-credit), so an abandoned sale never costs the client anything.
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Wallet } from 'lucide-react';
import { useStoreCredit, formatCreditExpiry, isCreditExpiringSoon } from '@/hooks/useStoreCredit';
import type { Client } from '@/lib/data';

interface Props {
  client: Client | null | undefined;
  totalOwed: number;         // what's owed before credit
  tenantId: string;
  appointmentId: string;
  staffId: string;
  onCreditApplied: (result: { appliedAmount: number; remainingBalance: number }) => void;
  appliedAmount?: number;
}

const money = (n: number) => `$${(Math.round(n * 100) / 100).toFixed(2)}`;

export const StoreCreditPanel: React.FC<Props> = ({ client, totalOwed, onCreditApplied, appliedAmount = 0 }) => {
  const { availableCredits, totalAvailable } = useStoreCredit(client);
  const maxApplicable = useMemo(() => Math.max(0, Math.round(Math.min(totalAvailable, totalOwed) * 100) / 100), [totalAvailable, totalOwed]);
  const [editing, setEditing] = useState(false); const [val, setVal] = useState('');
  const skipped = useRef<string>(''); const autoFor = useRef<string>('');
  const cid = String((client as any)?.id || '');
  const set = (n: number) => { const a = Math.max(0, Math.min(maxApplicable, Math.round(n * 100) / 100)); onCreditApplied({ appliedAmount: a, remainingBalance: Math.max(0, Math.round((totalOwed - a) * 100) / 100) }); };
  // Comes off by itself for each client (unless staff chose not to use it for this sale).
  useEffect(() => {
    if (!cid || maxApplicable <= 0 || skipped.current === cid) return;
    if (autoFor.current !== cid || (appliedAmount > maxApplicable + 0.004)) { autoFor.current = cid; set(maxApplicable); }
  }, [cid, maxApplicable]); // eslint-disable-line react-hooks/exhaustive-deps
  if (totalAvailable <= 0) return null;
  const soon = availableCredits.find((c) => isCreditExpiringSoon(c.expiresAt, 14));
  const on = appliedAmount > 0;
  return (
    <div className="space-y-3 rounded-2xl p-4" style={{ background: on ? '#e8f3ec' : 'var(--card, #f3f3f5)', border: `1px solid ${on ? '#cfe6d8' : 'var(--line, #ececee)'}` }}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full" style={{ background: on ? '#1f7a4d' : '#9a9ca3' }}><Wallet className="h-4 w-4 text-white" aria-hidden="true" /></span>
          <div className="min-w-0"><p className="text-[14px] font-semibold">{on ? `Store credit: −${money(appliedAmount)}` : `Store credit: ${money(totalAvailable)} available`}</p>
            <p className="text-[12.5px]" style={{ color: 'var(--muted, #6d7075)' }}>{on ? `Used when this sale is paid${totalAvailable - appliedAmount > 0.004 ? ` · ${money(totalAvailable - appliedAmount)} stays for next time` : ''}` : 'Not used on this sale'}{soon ? ` · ${formatCreditExpiry(soon.expiresAt)}` : ''}</p></div></div>
        <div className="flex shrink-0 gap-1.5">
          {on ? <>
            <button type="button" onClick={() => { setVal(appliedAmount.toFixed(2)); setEditing(!editing); }} className="h-9 rounded-full bg-white px-3 text-[13px] font-semibold">Change</button>
            <button type="button" onClick={() => { skipped.current = cid; setEditing(false); set(0); }} className="h-9 rounded-full bg-white px-3 text-[13px]">Don’t use</button></>
            : <button type="button" onClick={() => { skipped.current = ''; set(maxApplicable); }} disabled={maxApplicable <= 0} className="h-9 rounded-full px-3.5 text-[13px] font-semibold text-white disabled:opacity-40" style={{ background: '#1f7a4d' }}>Use {money(maxApplicable)}</button>}
        </div>
      </div>
      {editing && on && <div className="flex items-center gap-2">
        <label className="flex items-center gap-1 text-[14px]">$<input type="number" step="0.01" min={0} max={maxApplicable} value={val} onChange={(e) => setVal(e.target.value)} aria-label="Credit to use" className="h-10 w-28 rounded-xl border bg-white px-2 text-[14px]" style={{ borderColor: 'var(--line, #ececee)' }} /></label>
        <button type="button" onClick={() => { const n = parseFloat(val); if (Number.isFinite(n)) { if (n <= 0) skipped.current = cid; set(n); } setEditing(false); }} className="h-10 rounded-full px-4 text-[13px] font-semibold text-white" style={{ background: '#16171a' }}>Use this</button>
        <span className="text-[12px]" style={{ color: 'var(--muted, #6d7075)' }}>up to {money(maxApplicable)}</span></div>}
    </div>);
};
