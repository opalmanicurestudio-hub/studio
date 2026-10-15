'use client';
// "Hold automatic offers today" — the same switch wherever it's shown (waitlist, opportunities, loyalty). /api/outreach-pause.
import * as React from 'react';
import { payPost } from '@/components/pay/pay-client';

export function OutreachPause({ tenantId, compact }: { tenantId: string; compact?: boolean }) {
  const [s, setS] = React.useState<any>(null); const [busy, setBusy] = React.useState(false); const [err, setErr] = React.useState('');
  const load = React.useCallback(() => { if (tenantId) payPost('/api/outreach-pause', { tenantId, action: 'status' }).then((r: any) => r?.ok && setS(r)); }, [tenantId]);
  React.useEffect(() => { load(); }, [load]);
  if (!s) return null;
  const flip = async () => { setBusy(true); setErr(''); const r: any = await payPost('/api/outreach-pause', { tenantId, action: s.paused ? 'resume' : 'pause' }); setBusy(false); if (r?.ok) load(); else setErr(r?.error || 'That didn’t work.'); };
  return (
    <div className={`flex flex-wrap items-center gap-3 rounded-[18px] border p-3 ${compact ? '' : 'sm:p-4'}`} style={{ borderColor: s.paused ? '#b45309' : 'hsl(var(--border))', background: 'hsl(var(--card))' }}>
      <div className="min-w-0 flex-1">
        <p className="text-[14.5px] font-semibold">{s.paused ? 'Automatic offers are on hold today' : 'Busy day?'}</p>
        <p className="text-[12.5px] leading-snug" style={{ color: 'hsl(var(--muted-foreground))' }}>{s.paused ? `Nothing goes out on its own until midnight${s.by ? ` (held by ${s.by})` : ''}. Reminders and receipts still go.` : 'Hold waitlist offers, opportunity texts, reward texts and campaigns until midnight.'}</p>
        {err && <p className="text-[12.5px] font-semibold" style={{ color: '#b42318' }}>{err}</p>}
      </div>
      {s.canChange && <button type="button" disabled={busy} onClick={flip} className="h-10 shrink-0 rounded-full px-4 text-[13.5px] font-semibold disabled:opacity-50" style={s.paused ? { background: '#16171a', color: '#fff' } : { border: '1px solid hsl(var(--border))' }}>{busy ? 'One moment…' : s.paused ? 'Turn back on' : 'Hold for today'}</button>}
    </div>);
}
