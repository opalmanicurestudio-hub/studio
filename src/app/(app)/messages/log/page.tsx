'use client';

/**
 * Delivery log — /messages/log
 *
 * Every message the shop sends already writes a row to tenants/{t}/messageLog:
 * who it went to, what kind it was, whether the provider took it, and then —
 * filled in later by the Resend and SMS webhooks — whether it was delivered,
 * opened, clicked or bounced. All of that existed with nowhere to read it.
 * This is that screen.
 *
 * It answers the three questions that actually get asked:
 *   "did it go?"          — status, with the provider's own words on failure
 *   "did they see it?"    — delivered / opened / clicked, with times
 *   "why didn't it go?"   — a suppressed send logs skipped_by_policy WITH the
 *                            reason; a missing provider logs skipped_no_provider
 *
 * Addresses are shown unmasked on purpose. The commonest cause of "they swear
 * they never got it" is a typo, and you cannot spot gmial.com behind asterisks.
 */

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore';
import { ArrowLeft, CheckCheck, Eye, MailWarning, MousePointerClick, Search, Send, ShieldOff } from 'lucide-react';
import { useFirebase } from '@/firebase';
import { useTenant } from '@/context/TenantContext';
import { AppHeader } from '@/components/shared/AppHeader';
import { cn } from '@/lib/utils';

type LogRow = {
  id: string;
  channel: string;
  kind: string;
  to: string;
  subject: string | null;
  preview: string | null;
  status: string;
  error: string | null;
  recipientType: string | null;
  recipientName: string | null;
  addressRelease: string | null;
  sentAt: string;
  deliveredAt: string | null;
  openedAt: string | null;
  clickedAt: string | null;
  bouncedAt: string | null;
  failureDetail: string | null;
};

const when = (iso: string | null): string => {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

const exactly = (iso: string | null): string => {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
};

/** The furthest a message got — the one thing worth reading at a glance. */
const journeyOf = (r: LogRow) => {
  if (r.bouncedAt) return { label: 'Bounced', tone: 'bg-red-100 text-red-800', at: r.bouncedAt };
  if (r.status === 'failed') return { label: 'Failed', tone: 'bg-red-100 text-red-800', at: r.sentAt };
  if (String(r.status).startsWith('skipped')) return { label: 'Not sent', tone: 'bg-amber-100 text-amber-900', at: r.sentAt };
  if (r.clickedAt) return { label: 'Clicked', tone: 'bg-indigo-200 text-indigo-900', at: r.clickedAt };
  if (r.openedAt) return { label: 'Opened', tone: 'bg-emerald-200 text-emerald-900', at: r.openedAt };
  if (r.deliveredAt) return { label: 'Delivered', tone: 'bg-sky-100 text-sky-800', at: r.deliveredAt };
  return { label: 'Sent', tone: 'bg-slate-100 text-slate-600', at: r.sentAt };
};

/** Why a message never left, in the owner's words rather than a status code. */
const notSentReason = (r: LogRow): string => {
  const s = String(r.status || '');
  if (s === 'skipped_no_provider') return 'No email or SMS provider is configured — check RESEND_API_KEY and RESEND_FROM.';
  if (s === 'skipped_by_policy') return r.error || 'Switched off in message settings.';
  if (s === 'skipped_quiet_hours') return 'Held back by quiet hours.';
  if (s.startsWith('skipped')) return r.error || s.replace(/_/g, ' ');
  return r.failureDetail || r.error || 'The provider rejected it.';
};

const FILTERS = [
  ['all', 'Everything'],
  ['attention', 'Needs attention'],
  ['opened', 'Opened'],
  ['notsent', 'Not sent'],
] as const;

export default function MessageLogPage() {
  const { firestore } = useFirebase();
  const { selectedTenant } = useTenant();
  const tenantId = selectedTenant?.id ?? null;

  const [rows, setRows] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<typeof FILTERS[number][0]>('all');
  const [search, setSearch] = useState('');
  const [openRow, setOpenRow] = useState<string>('');

  useEffect(() => {
    if (!firestore || !tenantId) return;
    const q = query(
      collection(firestore, 'tenants', tenantId, 'messageLog'),
      orderBy('sentAt', 'desc'),
      limit(300),
    );
    const unsub = onSnapshot(q,
      (snap) => {
        setRows(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as LogRow[]);
        setLoading(false);
      },
      () => setLoading(false));
    return () => unsub();
  }, [firestore, tenantId]);

  const counts = useMemo(() => ({
    total: rows.length,
    opened: rows.filter((r) => r.openedAt || r.clickedAt).length,
    trouble: rows.filter((r) => r.bouncedAt || r.status === 'failed' || String(r.status).startsWith('skipped')).length,
  }), [rows]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter === 'attention' && !(r.bouncedAt || r.status === 'failed')) return false;
      if (filter === 'opened' && !(r.openedAt || r.clickedAt)) return false;
      if (filter === 'notsent' && !String(r.status).startsWith('skipped')) return false;
      if (!q) return true;
      return [r.to, r.recipientName, r.kind, r.subject].some((v) => String(v || '').toLowerCase().includes(q));
    });
  }, [rows, filter, search]);

  return (
    <div className="flex min-h-screen w-full flex-col bg-slate-50/50">
      <AppHeader title="Delivery log" />
      <div className="flex-1 w-full max-w-[900px] mx-auto min-w-0 p-4 sm:p-6 md:p-8 space-y-6"
        style={{ paddingBottom: 'calc(6rem + env(safe-area-inset-bottom))' }}>

        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-1 min-w-0">
            <p className="text-[10px] font-black uppercase tracking-[0.25em] text-muted-foreground opacity-60">
              Communications
            </p>
            <h1 className="flex items-center gap-2.5 text-3xl md:text-4xl font-black uppercase tracking-tighter leading-none">
              <span className="grid h-9 w-9 place-items-center rounded-2xl border-2 border-primary/15 bg-primary/5 shrink-0">
                <Send className="h-4 w-4 text-primary" />
              </span>
              Delivery log
            </h1>
            <p className="text-xs font-bold text-muted-foreground max-w-prose">
              Every message that went out, whether it arrived, and whether anyone opened it.
            </p>
          </div>
          <Link href="/settings/messages"
            className="shrink-0 h-10 px-3 inline-flex items-center rounded-xl border-2 bg-white text-[10px] font-black uppercase tracking-widest text-slate-600">
            <ArrowLeft className="h-3 w-3 mr-1.5" /> Message settings
          </Link>
        </header>

        <div className="grid grid-cols-3 gap-2">
          {[
            ['Sent', counts.total, CheckCheck],
            ['Opened', counts.opened, Eye],
            ['Trouble', counts.trouble, MailWarning],
          ].map(([label, n, Icon]: any) => (
            <div key={label} className="rounded-2xl border-2 bg-white p-3">
              <p className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest text-muted-foreground">
                <Icon className="h-3 w-3" /> {label}
              </p>
              <p className="text-2xl font-black tabular-nums leading-none mt-1">{n}</p>
            </div>
          ))}
        </div>

        <div className="space-y-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by address, name or message type"
              aria-label="Search the delivery log"
              className="w-full h-12 pl-9 pr-3 rounded-2xl border-2 bg-white text-sm font-bold" />
          </div>
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {FILTERS.map(([id, label]) => (
              <button key={id} type="button" onClick={() => setFilter(id)}
                aria-pressed={filter === id}
                className={cn('h-9 shrink-0 rounded-full border-2 px-3 text-[9px] font-black uppercase tracking-widest transition-all',
                  filter === id ? 'border-foreground bg-foreground text-background' : 'bg-white')}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <p className="text-[11px] font-black uppercase tracking-widest text-muted-foreground py-10">Loading…</p>
        ) : visible.length === 0 ? (
          <div className="rounded-2xl border-2 border-dashed p-8 text-center space-y-1">
            <p className="text-sm font-black">Nothing here yet.</p>
            <p className="text-[11px] font-bold text-muted-foreground">
              {rows.length === 0
                ? 'No messages have been sent from this shop yet — or the email provider has never been configured.'
                : 'Nothing matches that filter.'}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {visible.map((r) => {
              const j = journeyOf(r);
              const isOpen = openRow === r.id;
              const trouble = !!r.bouncedAt || r.status === 'failed' || String(r.status).startsWith('skipped');
              return (
                <div key={r.id} className="rounded-2xl border-2 bg-white overflow-hidden">
                  <button type="button" onClick={() => setOpenRow(isOpen ? '' : r.id)}
                    aria-expanded={isOpen}
                    className="w-full p-4 text-left space-y-1.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-black text-sm truncate">
                          {r.recipientName || r.to}
                        </p>
                        <p className="text-[11px] font-bold text-muted-foreground truncate">
                          {r.subject || r.kind.replace(/_/g, ' ')}
                        </p>
                      </div>
                      <span className={cn('shrink-0 rounded-full px-2.5 py-1 text-[9px] font-black uppercase tracking-widest', j.tone)}>
                        {j.label}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] font-bold text-muted-foreground">
                      <span className="uppercase tracking-widest">{r.channel}</span>
                      <span>{r.kind.replace(/_/g, ' ')}</span>
                      {r.recipientType && <span>{r.recipientType}</span>}
                      <span>{when(r.sentAt)}</span>
                    </div>
                    {trouble && (
                      <p className="text-[11px] font-bold text-red-700">{notSentReason(r)}</p>
                    )}
                  </button>

                  {isOpen && (
                    <div className="border-t-2 bg-slate-50/60 p-4 space-y-2">
                      <p className="text-[11px] font-bold break-all">
                        <span className="text-muted-foreground">To </span>{r.to}
                      </p>
                      {r.preview && (
                        <p className="text-[11px] font-medium text-slate-600">{r.preview}</p>
                      )}
                      <div className="grid gap-1">
                        {([
                          ['Sent', r.sentAt, Send],
                          ['Delivered', r.deliveredAt, CheckCheck],
                          ['Opened', r.openedAt, Eye],
                          ['Clicked', r.clickedAt, MousePointerClick],
                          ['Bounced', r.bouncedAt, MailWarning],
                        ] as const).map(([label, at, Icon]) => at ? (
                          <p key={label} className="flex items-center gap-1.5 text-[11px] font-bold">
                            <Icon className="h-3 w-3 text-muted-foreground" />
                            {label}
                            <span className="text-muted-foreground font-medium">{exactly(at)}</span>
                          </p>
                        ) : null)}
                      </div>
                      {r.addressRelease && (
                        <p className="flex items-center gap-1.5 text-[10px] font-bold text-muted-foreground">
                          <ShieldOff className="h-3 w-3" /> Address: {r.addressRelease}
                        </p>
                      )}
                      {(r.failureDetail || r.error) && (
                        <p className="text-[11px] font-bold text-red-700">{r.failureDetail || r.error}</p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            {rows.length >= 300 && (
              <p className="text-[10px] font-bold text-muted-foreground text-center">
                Showing the 300 most recent — search to narrow.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
