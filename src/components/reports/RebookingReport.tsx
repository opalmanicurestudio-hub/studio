'use client';
// src/components/reports/RebookingReport.tsx — "Rebooked before leaving", by provider and by where it was booked.
import * as React from 'react';
import { rebookReport } from '@/lib/rebook-report';

export function RebookingReport({ appointments, staff, from, to }: { appointments: any[]; staff: any[]; from: Date; to: Date }) {
  const r = React.useMemo(() => rebookReport(appointments || [], staff || [], from, to), [appointments, staff, from, to]);
  const box = 'rounded-[2rem] border-2 bg-white p-6';
  if (!r.visits) return <div className={box}><p className="text-sm text-muted-foreground">No finished visits in this period yet.</p></div>;
  const bar = (p: number, c: string) => <div className="h-2 w-full overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full" style={{ width: `${p}%`, background: c }} /></div>;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className={box}><p className="text-xs font-bold uppercase text-muted-foreground">Rebooked before leaving</p><p className="text-4xl font-black">{r.beforePct}%</p><p className="text-sm text-muted-foreground">{r.before} of {r.visits} finished visits</p></div>
        <div className={box}><p className="text-xs font-bold uppercase text-muted-foreground">Rebooked later (30 days)</p><p className="text-4xl font-black">{r.laterPct}%</p><p className="text-sm text-muted-foreground">{r.later} more</p></div>
        <div className={box}><p className="text-xs font-bold uppercase text-muted-foreground">Where they booked</p>
          <p className="text-sm">Client screen (iPad): <b>{r.via.client_screen}</b></p><p className="text-sm">Their visit link: <b>{r.via.visit_link}</b></p><p className="text-sm">Desk or online: <b>{r.via.other}</b></p></div>
      </div>
      <div className={`${box} overflow-x-auto`}>
        <table className="w-full min-w-[520px] text-sm">
          <thead><tr className="text-left text-xs uppercase text-muted-foreground"><th className="py-2">Provider</th><th>Visits</th><th className="w-[30%]">Before leaving</th><th>Later</th><th>Not yet</th></tr></thead>
          <tbody>{r.rows.map((x) => <tr key={x.staffId} className="border-t"><td className="py-3 font-semibold">{x.name}</td><td>{x.visits}</td>
            <td><div className="flex items-center gap-2"><span className="w-10 font-bold">{x.beforePct}%</span>{bar(x.beforePct, 'hsl(var(--primary))')}</div></td><td>{x.laterPct}%</td><td>{x.none}</td></tr>)}</tbody>
        </table>
      </div>
    </div>
  );
}
