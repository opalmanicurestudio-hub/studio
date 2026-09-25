'use client';
// src/components/campaigns/AudienceList.tsx
//
// WHO is in a campaign's audience — names, not just a number. Two tabs:
//   Getting it  — each client and where it goes (email or last 4 digits)
//   Left out    — each client who matched but won't get it, and why
// Searchable, compact on phones. Used by the business's campaign editor and
// by renters in their portal.

import { useMemo, useState } from 'react';
import { cn } from '@/lib/utils';

const REASON: Record<string, string> = {
  no_consent: 'hasn’t said yes to offers by text',
  no_contact: 'no contact on file',
  unsubscribed: 'unsubscribed',
  monthly_cap: 'already had 4 marketing texts this month',
};

export function AudienceList({ recipients = [], skipped = [], channel, total, compact = false }: {
  recipients?: { id: string; name: string; to?: string }[];
  skipped?: { id: string; name: string; reason: string }[];
  channel: 'email' | 'sms'; total?: number; compact?: boolean;
}) {
  const [tab, setTab] = useState<'in' | 'out'>('in');
  const [q, setQ] = useState('');
  const [showAll, setShowAll] = useState(false);
  const list = useMemo(() => {
    const src: any[] = tab === 'in' ? recipients : skipped;
    const f = q.trim().toLowerCase();
    return f ? src.filter((x) => String(x.name).toLowerCase().includes(f)) : src;
  }, [tab, q, recipients, skipped]);
  const limit = showAll ? list.length : (compact ? 8 : 12);
  const inCount = total ?? recipients.length;

  return (
    <div className="space-y-2">
      <div className="flex gap-1 rounded-xl bg-slate-100 p-1">
        {([['in', `Getting it · ${inCount}`], ['out', `Left out · ${skipped.length}`]] as const).map(([k, l]) => (
          <button key={k} type="button" onClick={() => { setTab(k); setShowAll(false); }} aria-pressed={tab === k}
            className={cn('h-9 flex-1 rounded-lg text-[11px] font-black uppercase tracking-widest', tab === k ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500')}>{l}</button>
        ))}
      </div>
      {(tab === 'in' ? recipients.length : skipped.length) > 8 && (
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search names" aria-label="Search names"
          className="h-10 w-full rounded-xl border-2 border-slate-200 bg-white px-3 text-sm" />
      )}
      {list.length === 0 ? (
        <p className="py-3 text-center text-xs font-bold text-slate-400">{tab === 'in' ? 'Nobody in this audience yet.' : 'Nobody left out.'}</p>
      ) : (
        <ul className="divide-y rounded-2xl border-2 border-slate-100 bg-white">
          {list.slice(0, limit).map((x: any) => (
            <li key={x.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <span className="flex min-w-0 items-center gap-2">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[10px] font-black text-slate-600">{String(x.name || '?').split(/\s+/).map((p: string) => p[0]).slice(0, 2).join('').toUpperCase()}</span>
                <span className="truncate text-sm font-bold text-slate-800">{x.name}</span>
              </span>
              <span className="shrink-0 text-right text-[11px] font-medium text-slate-400">{tab === 'in' ? (x.to || (channel === 'sms' ? 'text' : 'email')) : REASON[x.reason] || x.reason}</span>
            </li>
          ))}
        </ul>
      )}
      {list.length > limit && (
        <button type="button" onClick={() => setShowAll(true)} className="w-full text-center text-[11px] font-black uppercase tracking-widest text-slate-500 underline">Show all {list.length}</button>
      )}
      {tab === 'out' && skipped.some((x) => x.reason === 'no_consent') && (
        <p className="text-[11px] text-slate-500">Clients can say yes to offers by text when they book, or you can record a yes they gave you on their profile.</p>
      )}
    </div>
  );
}
