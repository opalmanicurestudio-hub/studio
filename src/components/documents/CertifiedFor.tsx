'use client';
// src/components/documents/CertifiedFor.tsx — ONE PERSON'S CERTIFICATIONS (lib/certification): what they're certified
// for (with renew-by dates) and what they're working toward, step by step. On the Team profile (Training & tasks) and,
// for themselves, on the staff app's Handbook and SOPs — where a step's document opens straight from here.
import * as React from 'react';
import { payPost } from '@/components/pay/pay-client';
import { isCurrent, renewSoon, certId } from '@/lib/certification';
import { Ico, IC } from '@/components/documents/DocBlocks';

const INK = 'hsl(var(--foreground))', MUTED = 'hsl(var(--muted-foreground))', LINE = 'hsl(var(--border))', SOFT = 'hsl(var(--secondary))', GREEN = '#1f7a4d', AMBER = '#b45309', RED = '#b42318';
const day = (iso?: string | null) => (iso ? new Date(`${String(iso).slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '');

export function CertifiedFor({ tenantId, staffId, onOpenDoc, title = 'Certified for', manageHref }: { tenantId: string; staffId?: string; onOpenDoc?: (id: string) => void; title?: string; manageHref?: string }) {
  const [data, setData] = React.useState<any>(null);
  React.useEffect(() => { let stop = false; void payPost('/api/certifications', { tenantId, action: 'list', ...(staffId ? { staffId } : {}) }).then((r) => { if (!stop && r.ok) setData(r); }); return () => { stop = true; }; }, [tenantId, staffId]);
  if (!data) return null;
  const me = staffId || data.staff[0]?.id; if (!me) return null;
  const needed = data.services.filter((s: any) => s.rule.required);
  const recOf = (sid: string) => data.recs.find((r: any) => r.serviceId === sid && r.staffId === me) || null;
  const certified = needed.filter((s: any) => isCurrent(recOf(s.id), data.today));
  const lapsed = needed.filter((s: any) => { const r = recOf(s.id); return r && (r.status === 'lapsed' || (r.status === 'certified' && !isCurrent(r, data.today))); });
  const working = needed.filter((s: any) => !certified.includes(s) && !lapsed.includes(s) && recOf(s.id)?.status !== 'removed' && (data.progress[certId(me, s.id)] || []).length);
  if (!certified.length && !lapsed.length && !working.length) return null;
  return (
    <div className="space-y-2.5" style={{ color: INK }}>
      <div className="flex items-center justify-between gap-2"><p className="text-[16px] font-bold">{title}</p>{manageHref && <a href={manageHref} className="text-[13px] underline underline-offset-2" style={{ color: MUTED }}>Certification settings</a>}</div>
      {(certified.length > 0 || lapsed.length > 0) && <div className="overflow-hidden rounded-[18px] border bg-card" style={{ borderColor: LINE }}>
        {[...certified, ...lapsed].map((s: any, i: number) => { const r = recOf(s.id); const cur = isCurrent(r, data.today); const soon = renewSoon(r, data.today);
          return <div key={s.id} className="flex items-center gap-3 px-3.5 py-3" style={{ borderTop: i ? `1px solid ${LINE}` : undefined }}>
            <span className="min-w-0 flex-1"><span className="block truncate text-[14.5px] font-semibold">{s.name}</span><span className="block text-[12.5px]" style={{ color: MUTED }}>{cur ? `Since ${day(r.certifiedAt)}${r.renewBy ? ` · renew by ${day(r.renewBy)}` : ''}` : `Ran out ${day(r.renewBy)} — ask a manager to renew it`}</span></span>
            <span className="inline-flex h-7 items-center rounded-full px-2.5 text-[12px] font-semibold" style={!cur ? { background: 'color-mix(in srgb, #b42318 10%, transparent)', color: RED } : soon ? { background: 'color-mix(in srgb, #b45309 10%, transparent)', color: AMBER } : { background: 'color-mix(in srgb, #1f7a4d 11%, transparent)', color: GREEN }}>{!cur ? 'Lapsed' : soon ? 'Renew soon' : 'Certified'}</span></div>; })}</div>}
      {working.map((s: any) => { const steps: any[] = data.progress[certId(me, s.id)] || []; const done = steps.filter((x) => x.done).length;
        return <div key={s.id} className="space-y-2 rounded-[18px] p-3.5" style={{ background: SOFT }}>
          <div className="flex items-center justify-between gap-2"><p className="text-[14.5px] font-semibold">Working toward {s.name}</p><span className="text-[12.5px] font-semibold" style={{ color: MUTED }}>{done} of {steps.length}</span></div>
          <div className="h-1.5 overflow-hidden rounded-full bg-card"><div className="h-full rounded-full" style={{ width: `${(done / steps.length) * 100}%`, background: GREEN }} /></div>
          {steps.map((st: any) => { const docId = st.kind === 'doc' ? st.key.slice(4) : ''; const tap = !st.done && docId && onOpenDoc;
            return <div key={st.key} className="flex items-start gap-2.5 text-[13.5px]">
              <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full" style={st.done ? { background: GREEN } : { border: '2px solid hsl(var(--border))', background: 'hsl(var(--card))' }}>{st.done && <Ico d={IC.check} s={11} c="#fff" w={3} />}</span>
              <span className="min-w-0 flex-1"><span className="block">{st.label}</span><span className="block text-[12px]" style={{ color: MUTED }}>{st.detail}</span></span>
              {tap && <button type="button" onClick={() => onOpenDoc!(docId)} className="h-8 rounded-full bg-card px-3 text-[12.5px] font-semibold">Open</button>}</div>; })}
        </div>; })}
    </div>);
}
