'use client';
// src/app/(app)/food-cost/report/page.tsx — FOOD COST, AS A REPORT (lib/food-cost-report, components/reports/ReportView;
// api/food-cost 'view' and 'csv'). This week so far, last week or the last 30 days: what it is, the numbers that matter,
// sales by day against the aim, what's worth a look, every item sold and how to read it; printed or saved as a PDF, or
// downloaded as a spreadsheet. Opened from Food cost. Managers.
import { useCallback, useEffect, useRef, useState } from 'react';
import { getAuth } from 'firebase/auth';
import { useTenant } from '@/context/TenantContext';
import { cleanPeriod, PERIODS, type Period } from '@/lib/food-cost';
import type { Report } from '@/lib/report-kit';
import { ReportView } from '@/components/reports/ReportView';

const INK = '#16171a', SOFT = '#f5f5f7', AMBER = '#b45309', AMBER_TINT = '#fff7ed';
const RING = 'outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';

async function post(body: any) {
  const tk = await getAuth().currentUser?.getIdToken().catch(() => '') || '';
  try { const r = await fetch('/api/food-cost', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) }, body: JSON.stringify(body) }); return await r.json(); }
  catch { return { ok: false, error: 'No connection. Try again.' }; }
}

export default function FoodCostReportPage() {
  const { selectedTenant } = useTenant() as any;
  const tenantId: string | null = selectedTenant?.id || null;
  const [period, setPeriod] = useState<Period>(() => { try { return cleanPeriod(new URLSearchParams(window.location.search).get('period')); } catch { return 'week'; } });
  const [r, setR] = useState<Report | null>(null);
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [loading, setLoading] = useState(false);

  // Only the latest stretch asked for is shown (a slow answer for an earlier pick is let go).
  const asked = useRef(0);
  const load = useCallback(async () => {
    if (!tenantId) return; setLoading(true); const n = ++asked.current;
    const d = await post({ tenantId, action: 'view', period }); if (n !== asked.current) return; setLoading(false);
    if (d.ok) { setR(d.report); setErr(''); } else setErr(d.error || 'That didn’t load. Try again.');
  }, [tenantId, period]);
  useEffect(() => { void load(); }, [load]);
  // The stretch in the address, so a printed or shared link opens the same one.
  useEffect(() => { try { const u = new URL(window.location.href); u.searchParams.set('period', period); window.history.replaceState(null, '', u.toString()); } catch { /* the address stays as it was */ } }, [period]);

  const csv = async () => {
    if (!tenantId || !r) return; setBusy(true); setErr('');
    const d = await post({ tenantId, action: 'csv', period }); setBusy(false);
    if (!d.ok) { setErr(d.error || 'That didn’t download. Try again.'); return; }
    try {
      const url = URL.createObjectURL(new Blob([d.csv], { type: 'text/csv;charset=utf-8' }));
      const a = document.createElement('a'); a.href = url; a.download = d.name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch { setErr('That didn’t download. Try again.'); }
  };

  const picker = (
    <label className="block"><span className="sr-only">Which stretch</span>
      <select value={period} onChange={(e) => setPeriod(cleanPeriod(e.target.value))} disabled={loading} className={`min-h-[44px] rounded-full border bg-[#fff] px-4 text-[14px] font-semibold ${RING}`} style={{ borderColor: '#ececee', color: INK }}>
        {PERIODS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
      </select></label>);

  return (
    <>
      {err && <p role="alert" className="mx-auto mt-4 max-w-6xl rounded-2xl px-4 py-3 text-[14.5px] print:hidden" style={{ background: AMBER_TINT, color: AMBER }}>{err}</p>}
      {!r ? <div className="min-h-dvh px-4 py-6 sm:px-6" style={{ background: SOFT }}><div className="mx-auto h-64 max-w-6xl rounded-3xl bg-[#fff]" aria-busy="true" /></div>
        : <div aria-busy={loading}><ReportView report={r} onCsv={() => void csv()} csvBusy={busy || loading} back={{ href: '/food-cost', label: 'Food cost' }} picker={picker} /></div>}
    </>
  );
}
