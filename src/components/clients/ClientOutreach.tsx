'use client';
// "Why we reached out" on the client profile — every time the business contacted them on its own, why, how, and what
// came of it (lib/outreach-history, /api/clients/outreach). Check here before sending something.
import * as React from 'react';
import { payPost } from '@/components/pay/pay-client';

const MUTED = 'hsl(var(--muted-foreground))', LINE = 'hsl(var(--border))';
const TONE: Record<string, string> = { good: '#1f7a4d', bad: '#b42318', neutral: 'hsl(var(--foreground))' };
const when = (iso: string) => { const d = new Date(iso); return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(d.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) }); };

export function ClientOutreach({ tenantId, clientId }: { tenantId: string; clientId: string }) {
  const [d, setD] = React.useState<any>(null); const [all, setAll] = React.useState(false);
  React.useEffect(() => { if (tenantId && clientId) payPost('/api/clients/outreach', { tenantId, clientId }).then(setD); }, [tenantId, clientId]);
  if (!d?.ok) return null;
  const items: any[] = d.items || []; const shown = all ? items : items.slice(0, 5);
  const recent = items.find((i) => Date.now() - Date.parse(i.at) < 14 * 864e5);
  return (
    <section className="rounded-[18px] border bg-card p-4" style={{ borderColor: LINE }} aria-label="Why we reached out">
      <div className="flex flex-wrap items-baseline justify-between gap-2"><p className="text-[15px] font-semibold">Why we reached out</p>
        <p className="text-[12.5px]" style={{ color: MUTED }}>{d.optedOut ? 'Opted out of marketing texts' : d.marketing ? 'Said yes to marketing' : 'No marketing consent on file'}</p></div>
      {recent && <p className="mt-1 text-[13px] font-semibold" style={{ color: '#b45309' }}>Contacted {when(recent.at)}: {recent.why.split(':')[0].toLowerCase()}. Give it time before reaching out again.</p>}
      {!items.length && <p className="mt-2 text-[13.5px]" style={{ color: MUTED }}>We haven’t reached out to them on our own yet. Reminders and replies aren’t listed here.</p>}
      <ol className="mt-2">
        {shown.map((i, k) => <li key={k} className="grid grid-cols-[64px_1fr] gap-3 py-2 text-[13.5px]" style={{ borderTop: k ? `1px solid ${LINE}` : undefined }}>
          <span style={{ color: MUTED }}>{when(i.at)}</span>
          <span className="min-w-0"><span className="block font-semibold">{i.why}</span>
            <span className="block text-[12.5px]" style={{ color: MUTED }}>{[i.how, i.by].filter(Boolean).join(' · ')}</span>
            {i.result && <span className="block text-[12.5px] font-semibold" style={{ color: TONE[i.tone || 'neutral'] }}>{i.result}</span>}</span></li>)}
      </ol>
      {items.length > 5 && <button type="button" onClick={() => setAll(!all)} className="mt-1 text-[13px] font-semibold underline">{all ? 'Show fewer' : `Show all ${items.length}`}</button>}
    </section>);
}
