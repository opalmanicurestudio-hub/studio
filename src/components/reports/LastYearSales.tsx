'use client';
// src/components/reports/LastYearSales.tsx — "SAME TIME LAST YEAR" on Reports, from sales totals brought over from
// another app (Moving in → Past sales totals). Shown only when there are totals for the same months a year earlier.
// Those totals sit apart from the books; this only compares.
import * as React from 'react';
import { payPost } from '@/components/pay/pay-client';

const ym = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const $ = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
export function LastYearSales({ tenantId, from, to, current }: { tenantId: string; from: Date; to: Date; current: number }) {
  const [d, setD] = React.useState<any>(null);
  React.useEffect(() => { if (!tenantId) return; payPost('/api/import', { tenantId, action: 'sales-history', from: ym(from), to: ym(to) }).then((r) => setD(r.ok ? r : null)).catch(() => setD(null)); }, [tenantId, from, to]);
  if (!d?.any || !(d.total > 0)) return null;
  const pct = Math.round(((current - d.total) / d.total) * 100); const up = pct >= 0;
  const part = Object.keys(d.months).length < (Number(to.getFullYear()) * 12 + to.getMonth() - (Number(from.getFullYear()) * 12 + from.getMonth()) + 1);
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-[18px] border bg-card p-5" style={{ borderColor: 'hsl(var(--border))', color: 'hsl(var(--foreground))' }}>
      <div><p className="text-[13px]" style={{ color: 'hsl(var(--muted-foreground))' }}>Same time last year{part ? ' (the months we have)' : ''} · from your old app</p>
        <p className="mt-0.5 text-[26px] font-normal tracking-[-0.02em]">{$(d.total)} <span className="text-[15px]" style={{ color: 'hsl(var(--muted-foreground))' }}>then · {$(current)} now</span></p></div>
      <span className="rounded-full px-3 py-1 text-[14px] font-semibold" style={{ background: up ? '#e9f3ed' : '#fdecea', color: up ? '#1f7a4d' : '#b42318' }}>{up ? '+' : ''}{pct}%</span>
    </div>);
}
