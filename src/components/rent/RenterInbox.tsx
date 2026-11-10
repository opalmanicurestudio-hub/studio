'use client';
// src/components/rent/RenterInbox.tsx — THE RENTER'S MESSAGES AND NOTICES, in their portal.
// Everything the business sends them by email or text, kept here word for word, and every formal notice even when the
// email or text didn't reach them (lib/notice-record). Opening a notice records that they've seen it, on the record the
// business keeps. Their conversation with the business is its own section below (RenterThread).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { api } from '@/components/rent/studio';

type Item = { id: string; at: string; kind: string; category: string; formal: boolean; title: string; body: string; seenAt: string | null; channels: string[] };
type Filter = 'all' | 'notices' | 'receipts';

const day = (iso: string) => { const d = new Date(iso); return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); };
const full = (iso: string) => { const d = new Date(iso); return isNaN(d.getTime()) ? '' : d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }); };
const preview = (s: string) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > 110 ? `${t.slice(0, 107).trimEnd()}…` : t; };

export function RenterInbox({ tenantId, token, businessName }: { tenantId: string; token: string; businessName: string }) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [open, setOpen] = useState<string | null>(null);
  const load = useCallback(async () => {
    const d = await api({ action: 'notices', tenantId, token });
    if (d?.ok) { setItems(d.items || []); setFailed(false); } else { setFailed(true); setItems((cur) => cur || []); }
  }, [tenantId, token]);
  useEffect(() => { void load(); }, [load]);

  const counts = useMemo(() => ({
    all: (items || []).length,
    notices: (items || []).filter((i) => i.formal).length,
    receipts: (items || []).filter((i) => i.category === 'money').length,
  }), [items]);
  const shown = useMemo(() => (items || []).filter((i) => filter === 'all' || (filter === 'notices' ? i.formal : i.category === 'money')), [items, filter]);
  const unseen = (items || []).filter((i) => i.formal && !i.seenAt).length;

  const toggle = async (i: Item) => {
    const next = open === i.id ? null : i.id;
    setOpen(next);
    // Opening a notice is what records that they've seen it.
    if (next && i.formal && !i.seenAt) {
      const d = await api({ action: 'notice-seen', tenantId, token, id: i.id });
      if (d?.ok) setItems((cur) => (cur || []).map((x) => (x.id === i.id ? { ...x, seenAt: d.seenAt || new Date().toISOString() } : x)));
    }
  };

  return (
    <section className="space-y-3" aria-labelledby="renter-inbox-title">
      <h2 id="renter-inbox-title" className="sr-only">Messages and notices</h2>
      {unseen > 0 && <p className="px-1 text-[14px] font-medium text-[#b45309]">{unseen === 1 ? '1 notice to read' : `${unseen} notices to read`}</p>}
      <div className="flex gap-2" role="tablist" aria-label="Show">
        {([['all', 'All'], ['notices', 'Notices'], ['receipts', 'Receipts']] as const).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={filter === id} onClick={() => setFilter(id)}
            className={cn('h-11 rounded-full border px-4 text-[14px] font-medium transition-colors',
              filter === id ? 'border-[#16171a] bg-[#16171a] text-white' : 'border-[#ececee] bg-white text-[#16171a] hover:bg-[#f5f5f7]')}>
            {label}{counts[id] ? <span className={cn('ml-1.5', filter === id ? 'text-white/70' : 'text-[#6d7075]')}>{counts[id]}</span> : null}
          </button>
        ))}
      </div>
      <div className="overflow-hidden rounded-2xl border border-[#ececee] bg-white">
        {items === null ? <p className="px-4 py-5 text-[14px] text-[#6d7075]">Loading…</p>
          : failed && shown.length === 0 ? (
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <p className="text-[14px] text-[#b45309]">Your messages didn’t load.</p>
              <button type="button" onClick={() => void load()} className="h-11 rounded-full border border-[#ececee] px-4 text-[14px] font-medium text-[#16171a] hover:bg-[#f5f5f7]">Try again</button>
            </div>
          ) : shown.length === 0 ? (
            <p className="px-4 py-5 text-[14px] text-[#6d7075]">
              {filter === 'notices' ? 'No notices.' : filter === 'receipts' ? 'No receipts yet.' : `Nothing from ${businessName} yet.`}
            </p>
          ) : shown.map((i, n) => {
            const isOpen = open === i.id;
            return (
              <div key={i.id} className={cn(n > 0 && 'border-t border-[#ececee]')}>
                <button type="button" onClick={() => toggle(i)} aria-expanded={isOpen}
                  className="flex w-full min-h-[44px] items-start gap-3 px-4 py-3.5 text-left hover:bg-[#f5f5f7]">
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      {i.formal && !i.seenAt && <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-[#b45309]" />}
                      <span className={cn('truncate text-[15px] text-[#16171a]', i.formal && !i.seenAt ? 'font-semibold' : 'font-medium')}>{i.title}</span>
                      {i.formal && <span className="shrink-0 rounded-full border border-[#ececee] bg-white px-2 py-0.5 text-[12px] font-medium text-[#6d7075]">Notice</span>}
                    </span>
                    {!isOpen && <span className="mt-0.5 block truncate text-[13px] text-[#6d7075]">{preview(i.body)}</span>}
                  </span>
                  <span className="shrink-0 pt-0.5 text-[13px] text-[#6d7075]">{day(i.at)}</span>
                </button>
                {isOpen && (
                  <div className="space-y-3 px-4 pb-4">
                    <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-[#16171a]">{i.body || 'This message had no words to show.'}</p>
                    <p className="text-[13px] text-[#6d7075]">
                      {full(i.at)}{i.channels.length ? ` · sent by ${i.channels.join(' and ')}` : ' · kept here for you'}
                      {i.formal ? (i.seenAt ? ` · you opened it ${full(i.seenAt)}` : '') : ''}
                    </p>
                  </div>
                )}
              </div>
            );
          })}
      </div>
      <p className="text-[13px] leading-relaxed text-[#6d7075]">
        Everything {businessName} sends you by email or text is also kept here, word for word. Notices are formal messages your lease relies on; opening one here records that you’ve seen it.
      </p>
    </section>
  );
}
