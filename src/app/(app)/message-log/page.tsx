'use client';

// src/app/(app)/message-log/page.tsx
//
// v17 — THE MESSAGE LOG: every email and text the platform sends, to
// ANYONE — clients, staff, renters, maintenance workers — in one live
// screen, each with its delivery journey (Sent → Delivered → Opened →
// Clicked) or its failure reason in plain English. This is the owner's
// "did it actually go out?" answer for the whole business, not just
// client appointments.
//
// Filters: audience chips (All / Clients / Staff / Renters / Maintenance /
// Other), channel (All / Email / Text), needs-attention toggle, and a
// search box that matches name, address, number, subject, and content.

import React, { useMemo, useState } from 'react';
import {
  Mail, MessageSquare, Send, Search, AlertCircle, CheckCircle2,
  Users, User, Armchair, HardHat, HelpCircle, RefreshCw,
} from 'lucide-react';
import { collection, query, orderBy, limit } from 'firebase/firestore';
import { useFirebase, useCollection, useMemoFirebase } from '@/firebase';
import { useTenant } from '@/context/TenantContext';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const AUDIENCES = [
  { key: 'all', label: 'All', icon: Users },
  { key: 'client', label: 'Clients', icon: User },
  { key: 'staff', label: 'Staff', icon: Users },
  { key: 'renter', label: 'Renters', icon: Armchair },
  { key: 'contact', label: 'Guests', icon: User },
  { key: 'maintenance', label: 'Maintenance', icon: HardHat },
  { key: 'other', label: 'Other', icon: HelpCircle },
] as const;

const fmtDT = (iso: any) => {
  try {
    const d = new Date(iso);
    return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
  } catch { return ''; }
};

export default function MessageLogPage() {
  const { firestore } = useFirebase();
  const { selectedTenant } = useTenant();
  const tenantId = selectedTenant?.id ?? null;

  const [audience, setAudience] = useState<string>('all');
  const [channel, setChannel] = useState<'all' | 'email' | 'sms'>('all');
  const [needsAttention, setNeedsAttention] = useState(false);
  const [search, setSearch] = useState('');

  // Latest 300 sends, live. Single orderBy — no composite index needed.
  const logQuery = useMemoFirebase(() => {
    if (!firestore || !tenantId) return null;
    return query(collection(firestore, `tenants/${tenantId}/messageLog`), orderBy('sentAt', 'desc'), limit(300));
  }, [firestore, tenantId]);
  const { data: docs } = useCollection<any>(logQuery);

  const messages = useMemo(() => {
    let list = [...(docs || [])];
    if (audience !== 'all') {
      list = list.filter((m) => (m.recipientType || (m.clientId ? 'client' : 'other')) === audience);
    }
    if (channel !== 'all') list = list.filter((m) => m.channel === channel);
    if (needsAttention) list = list.filter((m) => m.bouncedAt || m.status === 'failed' || m.status === 'skipped_no_provider');
    const s = search.trim().toLowerCase();
    if (s) {
      list = list.filter((m) => [m.recipientName, m.clientName, m.to, m.subject, m.preview, m.kind]
        .some((v) => String(v || '').toLowerCase().includes(s)));
    }
    return list;
  }, [docs, audience, channel, needsAttention, search]);

  const attentionCount = useMemo(
    () => (docs || []).filter((m: any) => m.bouncedAt || m.status === 'failed').length,
    [docs],
  );

  const STEPS = ['Sent', 'Delivered', 'Opened', 'Clicked'];

  return (
    // min-w-0 + overflow-x-clip: the app shell's content pane is a flex
    // child — without these, any wide row inflates the WHOLE page past the
    // phone's edge (the "broken screen" bug). Chips WRAP instead of
    // scrolling sideways for the same reason.
    <div className="p-3 sm:p-6 w-full max-w-4xl mx-auto space-y-3 sm:space-y-4 min-w-0 overflow-x-clip"
      style={{ paddingBottom: 'max(24px, env(safe-area-inset-bottom))' }}>
      {/* Header */}
      <div className="rounded-3xl bg-slate-900 text-white p-4 sm:p-6 shadow-xl">
        <p className="text-[10px] font-black uppercase tracking-[0.25em] text-slate-400 flex items-center gap-2">
          <Send className="w-3.5 h-3.5" /> Communications
        </p>
        <h1 className="text-xl sm:text-2xl font-black tracking-tight mt-1">Message Log</h1>
        <p className="text-[11px] sm:text-xs font-bold text-slate-300 mt-1.5 break-words">
          Every email and text the platform sends — clients, staff, renters, maintenance — with delivery, opens, and failures.
        </p>
        {attentionCount > 0 && (
          <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-red-500/20 border-2 border-red-400/40 px-3 h-8">
            <AlertCircle className="w-3.5 h-3.5 text-red-300" />
            <span className="text-[10px] font-black uppercase tracking-widest text-red-200">{attentionCount} not delivered</span>
          </div>
        )}
      </div>

      {/* Filters — chips WRAP (never sideways-scroll) so the page can
          never be forced wider than the phone. */}
      <div className="space-y-2">
        <div className="flex flex-wrap gap-1.5">
          {AUDIENCES.map((a) => {
            const Icon = a.icon;
            return (
              <button key={a.key} onClick={() => setAudience(a.key)}
                className={cn(
                  'h-9 px-3 rounded-full border-2 text-[10px] font-black uppercase tracking-widest inline-flex items-center gap-1.5 transition-colors',
                  audience === a.key ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600',
                )}>
                <Icon className="w-3 h-3" /> {a.label}
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {(['all', 'email', 'sms'] as const).map((c) => (
            <button key={c} onClick={() => setChannel(c)}
              className={cn(
                'h-9 px-3 rounded-full border-2 text-[9px] font-black uppercase tracking-widest inline-flex items-center gap-1.5',
                channel === c ? 'bg-slate-100 border-slate-300 text-slate-900' : 'bg-white text-slate-400',
              )}>
              {c === 'email' ? <Mail className="w-3 h-3" /> : c === 'sms' ? <MessageSquare className="w-3 h-3" /> : null}
              {c === 'all' ? 'All channels' : c === 'email' ? 'Email' : 'Text'}
            </button>
          ))}
          <button onClick={() => setNeedsAttention((v) => !v)}
            className={cn(
              'h-9 px-3 rounded-full border-2 text-[9px] font-black uppercase tracking-widest inline-flex items-center gap-1.5',
              needsAttention ? 'bg-red-50 border-red-300 text-red-700' : 'bg-white text-slate-400',
            )}>
            <AlertCircle className="w-3 h-3" /> Needs attention
          </button>
        </div>
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, number, email, content…"
            className="h-11 pl-9 text-sm rounded-2xl border-2 w-full" />
        </div>
      </div>

      {/* List */}
      <div className="space-y-2">
        {!docs && (
          <div className="rounded-2xl border-2 bg-white p-8 text-center">
            <RefreshCw className="w-5 h-5 mx-auto animate-spin text-slate-300" />
          </div>
        )}
        {docs && messages.length === 0 && (
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest text-center py-8">
            Nothing here yet — sends will appear the moment they happen
          </p>
        )}
        {messages.map((m: any) => {
          const failed = !!(m.bouncedAt || m.status === 'failed');
          const skipped = m.status === 'skipped_no_provider';
          const stage = failed ? 'Failed' : m.clickedAt ? 'Clicked' : m.openedAt ? 'Opened' : m.deliveredAt ? 'Delivered' : skipped ? 'Skipped' : 'Sent';
          const reached = STEPS.indexOf(stage);
          const rType = m.recipientType || (m.clientId ? 'client' : 'other');
          return (
            <div key={m.id} className={cn('rounded-2xl border-2 bg-white p-3.5', failed && 'border-red-200 bg-red-50/40')}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[11px] font-black uppercase tracking-tight flex items-center gap-1.5 flex-wrap">
                    {m.channel === 'sms' ? <MessageSquare className="w-3.5 h-3.5 text-primary shrink-0" /> : <Mail className="w-3.5 h-3.5 text-primary shrink-0" />}
                    <span className="truncate">{m.recipientName || m.clientName || m.to || 'Unknown'}</span>
                    <Badge variant="outline" className="h-4 px-1.5 rounded-full text-[7px] font-black border-2 uppercase">{rType}</Badge>
                  </p>
                  <p className="text-[9px] font-bold text-slate-500 mt-0.5 break-all">
                    {String(m.kind || 'message').replace(/_/g, ' ')} · {m.to || '—'}
                  </p>
                  {(m.subject || m.preview) && (
                    <p className="text-[9px] font-medium text-slate-400 mt-0.5 line-clamp-1 italic">{m.subject || m.preview}</p>
                  )}
                </div>
                <span className="text-[8px] font-bold text-slate-400 uppercase tracking-wide shrink-0 whitespace-nowrap">
                  {m.sentAt ? fmtDT(m.sentAt) : ''}
                </span>
              </div>
              {!failed && !skipped && (
                <div className="flex items-center gap-1 mt-2 flex-wrap">
                  {(m.channel === 'sms' ? STEPS.slice(0, 2) : STEPS).map((s, i) => (
                    <span key={s} className={cn(
                      'px-2 h-5 inline-flex items-center rounded-full text-[8px] font-black uppercase tracking-wide border-2',
                      i <= reached ? 'bg-emerald-100 text-emerald-700 border-emerald-200' : 'bg-white text-slate-300 border-slate-100',
                    )}>
                      {i <= reached ? <CheckCircle2 className="w-2.5 h-2.5 mr-0.5" /> : null}{s}
                    </span>
                  ))}
                </div>
              )}
              {failed && (
                <p className="text-[9px] font-black text-red-700 mt-2">
                  {m.failureDetail || m.error || 'Not delivered — check the address or number.'}
                </p>
              )}
              {skipped && (
                <p className="text-[9px] font-black text-amber-700 mt-2">
                  Skipped — the {m.channel === 'sms' ? 'texting' : 'email'} provider isn't configured yet.
                </p>
              )}
            </div>
          );
        })}
      </div>
      {docs && docs.length >= 300 && (
        <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest text-center">Showing the latest 300 sends</p>
      )}
    </div>
  );
}
