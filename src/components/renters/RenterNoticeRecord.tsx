'use client';
// src/components/renters/RenterNoticeRecord.tsx — A RENTER'S MESSAGES AND NOTICES, on their profile.
// Every email, text and conversation message, each notice once with every copy of it and how far each got, when they
// saw it in their portal, or why it didn't arrive; the exact words, which can't be edited; and a printed record of one
// notice or all of them (api/booths/notice-record). Built from the message log and their conversation by
// lib/notice-record.
import React, { useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { PrintLink } from '@/components/shared/PrintLink';
import { buildNoticeRecord, belongsToRenter, copyWords, CATEGORY_LABEL, type NoticeItem } from '@/lib/notice-record';

type Filter = 'all' | 'notice' | 'money' | 'conversation' | 'trouble';

const dateOf = (iso: string) => { const d = new Date(iso); return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); };
const timeOf = (iso: string) => { const d = new Date(iso); return isNaN(d.getTime()) ? '' : d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }); };
const short = (iso: string) => {
  const d = new Date(iso); if (isNaN(d.getTime())) return '';
  const today = new Date(); const same = d.toDateString() === today.toDateString();
  return same ? timeOf(iso) : `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${timeOf(iso)}`;
};

export function RenterNoticeRecord({ tenantId, renter, rows, thread }: { tenantId: string; renter: any; rows: any[] | null; thread: any[] | null }) {
  const [filter, setFilter] = useState<Filter>('all');
  const [open, setOpen] = useState<string | null>(null);
  const name = `${String(renter?.firstName || '').trim()} ${String(renter?.lastName || '').trim()}`.trim() || 'Renter';
  const items = useMemo<NoticeItem[] | null>(() => {
    if (rows === null || thread === null) return null;
    return buildNoticeRecord({ rows: rows.filter((r) => belongsToRenter(r, renter.id, renter)), thread, renterName: name });
  }, [rows, thread, renter, name]);
  const counts = useMemo(() => ({
    all: (items || []).length,
    notice: (items || []).filter((i) => i.formal).length,
    money: (items || []).filter((i) => i.category === 'money').length,
    conversation: (items || []).filter((i) => i.category === 'conversation').length,
    trouble: (items || []).filter((i) => i.trouble).length,
  }), [items]);
  const shown = useMemo(() => (items || []).filter((i) =>
    filter === 'all' ? true : filter === 'notice' ? i.formal : filter === 'trouble' ? i.trouble : i.category === filter), [items, filter]);

  const FILTERS: [Filter, string][] = [['all', 'Everything'], ['notice', 'Written notices'], ['money', 'Money'], ['conversation', 'Conversations'], ['trouble', 'Didn’t arrive']];

  return (
    <section className="space-y-3" aria-labelledby="notice-record-title">
      <div className="flex items-center justify-between gap-3">
        <h3 id="notice-record-title" className="text-[15px] font-semibold text-[#16171a]">Messages and notices</h3>
        <PrintLink path="/api/booths/notice-record" params={{ tenantId, renterId: renter.id }}
          className="inline-flex h-11 items-center rounded-full border border-[#ececee] px-4 text-[13px] font-medium text-[#16171a] hover:bg-[#f5f5f7]">
          Print notice record
        </PrintLink>
      </div>
      <p className="text-[13px] leading-relaxed text-[#6d7075]">Every email, text and message to {renter?.firstName || 'them'}, kept word for word as it was sent. Nothing here can be edited.</p>
      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1" role="tablist" aria-label="Show">
        {FILTERS.map(([id, label]) => (counts[id] > 0 || id === 'all' || id === filter) && (
          <button key={id} type="button" role="tab" aria-selected={filter === id} onClick={() => setFilter(id)}
            className={cn('h-11 shrink-0 rounded-full border px-3.5 text-[13px] font-medium transition-colors',
              filter === id ? 'border-[#16171a] bg-[#16171a] text-white'
                : id === 'trouble' ? 'border-[#f3d9bd] bg-white text-[#b45309] hover:bg-[#fdf3e7]' : 'border-[#ececee] bg-white text-[#16171a] hover:bg-[#f5f5f7]')}>
            {label} <span className={cn(filter === id ? 'text-white/70' : id === 'trouble' ? 'text-[#b45309]' : 'text-[#6d7075]')}>{counts[id]}</span>
          </button>
        ))}
      </div>

      <div className="overflow-hidden rounded-2xl border border-[#ececee] bg-white">
        {items === null ? <p className="px-4 py-5 text-[14px] text-[#6d7075]">Reading the record…</p>
          : shown.length === 0 ? <p className="px-4 py-5 text-[14px] text-[#6d7075]">{filter === 'all' ? 'Nothing sent yet. A message you write below starts the record.' : 'Nothing here.'}</p>
          : shown.map((i, n) => {
            const isOpen = open === i.id;
            const status = [
              ...i.copies.map((c) => `${copyWords(c, short)}${c.state === 'not_sent' && /message settings/i.test(String(c.why || '')) ? ', switched off in message settings' : ''}`),
              ...(i.portalSeenAt ? [`Seen in portal ${short(i.portalSeenAt)}`] : i.formal ? ['In their portal'] : []),
            ];
            const quoted = i.threadId ? `${i.direction === 'in' ? `${i.sentBy || name}` : 'You'}: “${i.title}”` : i.title;
            return (
              <div key={i.id} className={cn(n > 0 && 'border-t border-[#ececee]')}>
                <button type="button" onClick={() => setOpen(isOpen ? null : i.id)} aria-expanded={isOpen}
                  className="flex w-full min-h-[44px] gap-3 px-4 py-3 text-left hover:bg-[#f5f5f7]">
                  <span className="w-[92px] shrink-0 pt-0.5 text-[12px] leading-snug text-[#6d7075]">{dateOf(i.at)}<br />{timeOf(i.at)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-[14px] font-medium leading-snug text-[#16171a]">{quoted}</span>
                      <span className="rounded-full border border-[#ececee] bg-white px-2 py-0.5 text-[12px] font-medium text-[#6d7075]">{i.formal ? 'Written notice' : CATEGORY_LABEL[i.category]}</span>
                    </span>
                    {status.length > 0 && (
                      <span className="mt-1 block text-[12px] leading-snug">
                        {status.map((w, k) => (
                          <span key={k} className={cn(/bounced|didn’t go|not sent/.test(w) && !/switched off/.test(w) ? 'text-[#b45309]' : 'text-[#6d7075]')}>{k > 0 ? ' · ' : ''}{w}</span>
                        ))}
                      </span>
                    )}
                    {i.sentBy && i.direction === 'out' && <span className="mt-0.5 block text-[12px] text-[#6d7075]">{i.sentBy === 'automatic' ? 'Sent automatically' : `Sent by ${i.sentBy}`}</span>}
                  </span>
                </button>
                {isOpen && <NoticeDetail tenantId={tenantId} renterId={renter.id} item={i} name={name} />}
              </div>
            );
          })}
      </div>
    </section>
  );
}

function NoticeDetail({ tenantId, renterId, item: i, name }: { tenantId: string; renterId: string; item: NoticeItem; name: string }) {
  const email = i.copies.find((c) => c.channel === 'email');
  const text = i.copies.find((c) => c.channel === 'sms');
  const same = !!email && !!text && email.body.trim() === text.body.trim();
  const full = (iso: string | null) => (iso ? `${dateOf(iso)}, ${timeOf(iso)}` : '');
  const Box = ({ label, subject, body }: { label: string; subject?: string | null; body: string }) => (
    <div className="rounded-xl bg-[#f5f5f7] px-3.5 py-3">
      <p className="text-[12px] font-medium text-[#6d7075]">{label}</p>
      {subject && <p className="mt-1 text-[14px] font-semibold text-[#16171a]">{subject}</p>}
      <p className="mt-1 whitespace-pre-wrap text-[14px] leading-relaxed text-[#16171a]">{body || 'No words were kept for this one.'}</p>
    </div>
  );
  return (
    <div className="space-y-3 px-4 pb-4">
      <dl className="grid grid-cols-[72px_1fr] gap-x-3 gap-y-1.5 text-[13px]">
        {i.copies.map((c) => (
          <React.Fragment key={c.logId}>
            <dt className="text-[#6d7075]">{c.channel === 'sms' ? 'Text' : 'Email'}</dt>
            <dd className="min-w-0 text-[#16171a]">
              <span className="break-all">{c.to || '—'}</span>
              <span className={cn(['bounced', 'failed', 'not_sent'].includes(c.state) ? 'text-[#b45309]' : 'text-[#6d7075]')}>
                {' · '}{c.state === 'opened' ? `opened ${full(c.openedAt)}` : c.state === 'delivered' ? `delivered ${full(c.deliveredAt)}` : c.state === 'sent' ? `sent ${full(c.sentAt)}`
                  : c.state === 'held' ? 'held until quiet hours end' : c.state === 'bounced' ? 'bounced' : c.state === 'failed' ? 'didn’t go' : 'not sent'}
              </span>
              {c.why && <span className="block text-[12px] text-[#b45309]">{c.why}</span>}
            </dd>
          </React.Fragment>
        ))}
        {!i.threadId && (
          <>
            <dt className="text-[#6d7075]">Portal</dt>
            <dd className="text-[#16171a]">{i.portalSeenAt ? `Seen ${full(i.portalSeenAt)}` : i.formal || i.went ? 'In their portal, not opened yet' : 'Not shown: it didn’t go out'}</dd>
          </>
        )}
        {i.threadId && (
          <>
            <dt className="text-[#6d7075]">Portal</dt>
            <dd className="text-[#16171a]">{i.direction === 'in' ? 'Written in their portal' : i.copies.length ? 'In their conversation' : 'In their conversation only: no email or phone on file'}</dd>
          </>
        )}
      </dl>
      {i.threadId ? (
        <>
          <Box label={i.direction === 'in' ? `What ${name.split(' ')[0]} wrote` : 'What you wrote'} body={i.body} />
          {i.copies.filter((c) => c.body && c.body.trim() !== i.body.trim()).map((c) => (
            <Box key={c.logId} label={c.channel === 'sms' ? 'The text said' : 'The email said'} subject={c.subject} body={c.body} />
          ))}
        </>
      ) : (
        <>
          {email && <Box label={same || !text ? 'Exactly what was sent' : 'The email said'} subject={email.subject} body={email.body} />}
          {text && !same && <Box label={email ? 'The text said' : 'Exactly what was sent'} body={text.body} />}
        </>
      )}
      <p className="text-[12px] leading-relaxed text-[#6d7075]">This copy was kept when it was sent and can’t be edited.{i.fingerprint ? ` Fingerprint ${i.fingerprint.slice(0, 16).replace(/(.{4})(?=.)/g, '$1 ')}.` : ''}</p>
      <PrintLink path="/api/booths/notice-record" params={{ tenantId, renterId, id: i.id }}
        className="inline-flex h-11 items-center rounded-full border border-[#ececee] px-4 text-[13px] font-medium text-[#16171a] hover:bg-[#f5f5f7]">
        Print this notice
      </PrintLink>
    </div>
  );
}
