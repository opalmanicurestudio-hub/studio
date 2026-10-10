'use client';
// src/components/staff/ClockFixReview.tsx — FORGOTTEN CLOCK-OUTS WAITING FOR A MANAGER (Timesheets). Each shows who,
// which day, when they clocked in and when they say they left; approve as sent, change the time first, or decline.
import * as React from 'react';
import { collection, query, where } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { useCollection, useMemoFirebase } from '@/firebase';
import { useToast } from '@/hooks/use-toast';

const t = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const d = (iso: string) => new Date(iso).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
const hhmm = (iso: string) => { const x = new Date(iso); return `${String(x.getHours()).padStart(2, '0')}:${String(x.getMinutes()).padStart(2, '0')}`; };

export function ClockFixReview({ firestore, tenantId }: { firestore: any; tenantId: string }) {
  const q = useMemoFirebase(() => (!firestore || !tenantId) ? null : query(collection(firestore, `tenants/${tenantId}/clockFixes`), where('status', '==', 'pending')), [firestore, tenantId]);
  const { data } = useCollection<any>(q); const { toast } = useToast();
  const [edit, setEdit] = React.useState<Record<string, string>>({}); const [busy, setBusy] = React.useState<string | null>(null);
  const list = (data || []).slice().sort((a: any, b: any) => String(a.inAt).localeCompare(String(b.inAt)));
  if (!list.length) return null;
  const decide = async (f: any, approve: boolean) => {
    setBusy(f.id);
    try {
      let outAt = f.outAt; const e = edit[f.id];
      if (approve && e) { const [h, m] = e.split(':').map(Number); const x = new Date(f.inAt); x.setHours(h, m, 0, 0); if (x.getTime() <= Date.parse(f.inAt)) x.setDate(x.getDate() + 1); outAt = x.toISOString(); }
      const note = approve ? '' : (window.prompt('Why isn’t it approved? (they’ll see this)') || '');
      const tk = await getAuth().currentUser?.getIdToken().catch(() => '');
      const r = await fetch('/api/timeclock/fix', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) }, body: JSON.stringify({ tenantId, action: 'decide', id: f.id, approve, outAt, note }) }).then((x) => x.json()).catch(() => ({ ok: false, error: 'No connection.' }));
      toast(r.ok ? { title: r.message } : { variant: 'destructive', title: 'Not saved', description: r.error });
    } finally { setBusy(null); }
  };
  return (
    <section aria-label="Forgotten clock-outs" className="space-y-3 rounded-2xl border p-4 md:p-5" style={{ borderColor: '#f3dfb8', background: '#fdf8ef' }}>
      <div><p className="text-[17px] font-semibold">Forgotten clock-outs · {list.length}</p><p className="text-[13.5px] text-muted-foreground">They’ve said when they left. Those hours count once you approve.</p></div>
      {list.map((f: any) => (
        <div key={f.id} className="flex flex-wrap items-center gap-3 rounded-xl border bg-white p-3">
          <div className="min-w-[12rem] flex-1">
            <p className="text-[15px] font-semibold">{f.staffName} · {d(f.inAt)}</p>
            <p className="text-[13.5px] text-muted-foreground">In {t(f.inAt)} · says they left {t(f.outAt)}{f.note ? ` · “${f.note}”` : ''}</p>
          </div>
          <label className="flex items-center gap-2 text-[13px] text-muted-foreground">Out at
            <input type="time" defaultValue={hhmm(f.outAt)} onChange={(e) => setEdit((x) => ({ ...x, [f.id]: e.target.value }))} className="h-10 rounded-lg border px-2 text-[15px] text-foreground" aria-label={`Clock-out time for ${f.staffName}`} /></label>
          <button type="button" disabled={busy === f.id} onClick={() => decide(f, true)} className="h-10 rounded-full bg-foreground px-4 text-[14px] font-semibold text-background disabled:opacity-50">Approve</button>
          <button type="button" disabled={busy === f.id} onClick={() => decide(f, false)} className="h-10 rounded-full border px-4 text-[14px] font-medium">Decline</button>
        </div>))}
    </section>);
}
