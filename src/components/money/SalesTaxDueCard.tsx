'use client';
// src/components/money/SalesTaxDueCard.tsx — SALES TAX DUE, on the Money page (api/money/sales-tax remind; lib/sales-tax-
// server taxReminder). From a week before it's due until it's recorded as paid, when the business wants reminding:
// the period, the amount and the day, with the way to its report and to record the payment. Managers only.
import * as React from 'react';
import { staffAuthHeader } from '@/lib/staff-fetch';

const INK = '#16171a', MUTED = '#6d7075', AMBER = '#b45309', AMBER_TINT = '#fff7ed';
const RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';

export function SalesTaxDueCard({ tenantId }: { tenantId: string }) {
  const [r, setR] = React.useState<{ text: string; due: string } | null>(null);
  React.useEffect(() => {
    let on = true;
    (async () => {
      try {
        const res = await fetch('/api/money/sales-tax', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await staffAuthHeader()) }, body: JSON.stringify({ tenantId, action: 'remind' }) });
        const d = await res.json().catch(() => null);
        if (on) setR(d?.ok && d.reminder ? d.reminder : null);
      } catch { /* shown next time */ }
    })();
    return () => { on = false; };
  }, [tenantId]);
  if (!r) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-3xl p-4" style={{ background: AMBER_TINT, color: INK }}>
      <div className="flex min-w-0 gap-3">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={AMBER} strokeWidth="2" strokeLinecap="round" aria-hidden="true" className="mt-0.5 shrink-0"><rect x="4" y="5" width="16" height="15" rx="3" /><path d="M4 10h16M9 3v4M15 3v4" /></svg>
        <div className="min-w-0"><p className="text-[15px] font-semibold">{r.text}</p>
          <p className="text-[13px]" style={{ color: MUTED }}>Its report has the figures your return asks for. Record the payment once it’s made.</p></div>
      </div>
      <a href="/settings?tab=payments#sales-tax" className={`inline-flex min-h-[44px] items-center rounded-full bg-[#fff] px-4 text-[14px] font-semibold ${RING}`} style={{ color: INK, border: '1px solid #ececee' }}>See the report</a>
    </div>
  );
}
