'use client';
// src/app/(app)/records/[kind]/page.tsx — ONE RECORD, AS A REPORT (lib/records-reports, components/reports/ReportView;
// api/records 'report' and 'csv'). Opened from Records for a month: what it is, the numbers that matter, a picture, what's
// worth a look, the table and how to read it; printed or saved as a PDF, or downloaded as a spreadsheet. Managers.
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { getAuth } from 'firebase/auth';
import { useTenant } from '@/context/TenantContext';
import { cleanMonth, monthWords, recentMonths } from '@/lib/records';
import { isRecordReport, RECORD_REPORTS, type Report } from '@/lib/report-kit';
import { ReportView } from '@/components/reports/ReportView';

const INK = '#16171a', MUTED = '#6d7075', SOFT = '#f5f5f7', AMBER = '#b45309', AMBER_TINT = '#fff7ed';
const RING = 'outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';

async function post(body: any) {
  const tk = await getAuth().currentUser?.getIdToken().catch(() => '') || '';
  try { const r = await fetch('/api/records', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) }, body: JSON.stringify(body) }); return await r.json(); }
  catch { return { ok: false, error: 'No connection. Try again.' }; }
}

export default function RecordReportPage() {
  const { selectedTenant } = useTenant() as any;
  const tenantId: string | null = selectedTenant?.id || null;
  const params = useParams() as any; const kind = String(params?.kind || '');
  const [month, setMonth] = useState<string>(() => { try { return cleanMonth(new URLSearchParams(window.location.search).get('month')) || ''; } catch { return ''; } });
  const [r, setR] = useState<Report | null>(null); const [today, setToday] = useState('');
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [loading, setLoading] = useState(false);

  // Only the latest month asked for is shown (a slow answer for an earlier pick is let go).
  const asked = useRef(0);
  const load = useCallback(async () => {
    if (!tenantId || !isRecordReport(kind)) return; setLoading(true); const n = ++asked.current;
    const d = await post({ tenantId, action: 'report', kind, ...(month ? { month } : {}) }); if (n !== asked.current) return; setLoading(false);
    if (d.ok) { setR(d.report); setErr(''); if (!month) setMonth(d.report.month); setToday(String(d.today || '')); }
    else setErr(d.error || 'That didn’t load. Try again.');
  }, [tenantId, kind, month]);
  useEffect(() => { void load(); }, [load]);
  // The month in the address, so a printed or shared link opens the same one.
  useEffect(() => { if (!month) return; try { const u = new URL(window.location.href); u.searchParams.set('month', month); window.history.replaceState(null, '', u.toString()); } catch { /* the address stays as it was */ } }, [month]);

  const csv = async () => {
    if (!tenantId || !r) return; setBusy(true); setErr('');
    const d = await post({ tenantId, action: 'csv', kind, month: r.month }); setBusy(false);
    if (!d.ok) { setErr(d.error || 'That didn’t download. Try again.'); return; }
    try {
      const url = URL.createObjectURL(new Blob([d.csv], { type: 'text/csv;charset=utf-8' }));
      const a = document.createElement('a'); a.href = url; a.download = d.name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch { setErr('That didn’t download. Try again.'); }
  };

  if (!isRecordReport(kind)) return (
    <div className="min-h-dvh px-4 py-10 sm:px-6" style={{ background: SOFT, color: INK }}>
      <div className="mx-auto max-w-xl rounded-3xl bg-[#fff] p-6"><h1 className="text-[22px] font-semibold">There’s no record by that name</h1>
        <p className="mt-2 text-[15px]" style={{ color: MUTED }}>These are the ones kept: {RECORD_REPORTS.map((x) => x.title).join(', ')}.</p>
        <Link href="/records" className={`mt-3 inline-flex min-h-[44px] items-center font-semibold underline underline-offset-4 ${RING}`}>Back to Records</Link></div>
    </div>);

  const picker = r && (
    <label className="block"><span className="sr-only">Which month</span>
      <select value={r.month} onChange={(e) => setMonth(e.target.value)} disabled={loading} className={`min-h-[44px] rounded-full border bg-[#fff] px-4 text-[14px] font-semibold ${RING}`} style={{ borderColor: '#ececee', color: INK }}>
        {recentMonths(today || r.madeAt.slice(0, 10)).map((m) => <option key={m} value={m}>{monthWords(m)}</option>)}
      </select></label>);

  return (
    <>
      {err && <p role="alert" className="mx-auto mt-4 max-w-6xl rounded-2xl px-4 py-3 text-[14.5px] print:hidden" style={{ background: AMBER_TINT, color: AMBER }}>{err}</p>}
      {!r ? <div className="min-h-dvh px-4 py-6 sm:px-6" style={{ background: SOFT }}><div className="mx-auto h-64 max-w-6xl rounded-3xl bg-[#fff]" aria-busy="true" /></div>
        : <div aria-busy={loading}><ReportView report={r} onCsv={() => void csv()} csvBusy={busy} back={{ href: `/records`, label: `Records, ${r.group}` }} picker={picker} /></div>}
    </>
  );
}
