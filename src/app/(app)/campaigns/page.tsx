'use client';
// src/app/(app)/campaigns/page.tsx
//
// CAMPAIGNS — what you've sent and what it did.
//
// Top: the results that matter, for the last 30 days or all time — reached,
// booked (and the rate), revenue from those bookings, offers used, and
// automations running. Then every campaign as a card: status, who it went
// to, and its own numbers, with Open / Duplicate / Pause / Delete.
// Phone-first: cards stack, tiles scroll sideways, actions are big targets.
// Only the business's own campaigns — renters' live in their portal.

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { collection, doc, setDoc } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { AppHeader } from '@/components/shared/AppHeader';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { useCollection, useFirebase, useMemoFirebase, deleteDocumentNonBlocking } from '@/firebase';
import { useTenant } from '@/context/TenantContext';
import { cn } from '@/lib/utils';
import { Mail, MessageSquare, Plus, Repeat, Clock, Copy, Trash2, Pause, Play, ChevronRight, Users, CalendarCheck, DollarSign, Gift, Send } from 'lucide-react';

const AUDIENCE_LABEL: Record<string, string> = {
  all: 'Everyone', new: 'New clients', loyal: 'Regulars', inactive_90: 'Haven’t been in a while', one_and_done: 'Came once',
  cancelled_recent: 'Cancelled or missed', birthday: 'Birthdays this month', members: 'Members', service: 'Had a certain service',
  provider: 'Saw a certain team member', spent_over: 'Top spenders', specific: 'Hand-picked', first_visit_followup: 'After a first visit',
};
const n = (x: any) => Number(x) || 0;
const money = (cents: number) => `$${(cents / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
const when = (iso?: string | null) => { if (!iso) return ''; const d = new Date(iso); return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); };

type Filter = 'all' | 'draft' | 'scheduled' | 'automation' | 'sent';

export default function CampaignsPage() {
  const { firestore } = useFirebase();
  const { selectedTenant } = useTenant();
  const { toast } = useToast();
  const router = useRouter();
  const tenantId = selectedTenant?.id || '';
  const [filter, setFilter] = useState<Filter>('all');
  const [range, setRange] = useState<'30' | 'all'>('30');

  const q = useMemoFirebase(() => (firestore && tenantId ? collection(firestore, 'tenants', tenantId, 'campaigns') : null), [firestore, tenantId]);
  const { data: raw, isLoading } = useCollection<any>(q);
  const campaigns = useMemo(() => (raw || []).filter((c: any) => !c.ownerRenterId)
    .sort((a: any, b: any) => String(b.sentAt || b.scheduledFor || b.updatedAt || '').localeCompare(String(a.sentAt || a.scheduledFor || a.updatedAt || ''))), [raw]);

  // ── The results ──
  const kpi = useMemo(() => {
    const since = range === '30' ? new Date(Date.now() - 30 * 86400000).toISOString() : '';
    const sent = campaigns.filter((c: any) => (c.status === 'sent' || c.status === 'sending' || c.status === 'automation') && (!since || String(c.sentAt || c.automation?.lastRunAt || c.updatedAt || '') >= since));
    const reached = sent.reduce((a: number, c: any) => a + n(c.recipientCount), 0);
    const booked = sent.reduce((a: number, c: any) => a + n(c.convertedCount), 0);
    return {
      campaigns: sent.filter((c: any) => c.status !== 'automation').length,
      reached, booked, rate: reached ? Math.round((booked / reached) * 1000) / 10 : 0,
      revenue: sent.reduce((a: number, c: any) => a + n(c.convertedRevenueCents), 0),
      offers: sent.reduce((a: number, c: any) => a + n(c.offersRedeemed), 0),
      automations: campaigns.filter((c: any) => c.status === 'automation' && c.automation?.active).length,
    };
  }, [campaigns, range]);

  const counts = useMemo(() => ({
    all: campaigns.length,
    draft: campaigns.filter((c: any) => !c.status || c.status === 'draft').length,
    scheduled: campaigns.filter((c: any) => c.status === 'scheduled').length,
    automation: campaigns.filter((c: any) => c.status === 'automation').length,
    sent: campaigns.filter((c: any) => c.status === 'sent' || c.status === 'sending').length,
  }), [campaigns]);
  const shown = campaigns.filter((c: any) => filter === 'all' ? true : filter === 'draft' ? (!c.status || c.status === 'draft') : filter === 'sent' ? (c.status === 'sent' || c.status === 'sending') : c.status === filter);

  // ── Actions ──
  const duplicate = async (c: any) => {
    if (!firestore || !tenantId) return;
    const ref = doc(collection(firestore, 'tenants', tenantId, 'campaigns'));
    const keep = ['name', 'type', 'subject', 'subjectB', 'body', 'imageUrl', 'targetAudience', 'targetClientIds', 'targetServiceIds', 'targetStaffIds', 'targetMinSpend', 'discountId', 'templateId'];
    const copy: any = { id: ref.id, status: 'draft', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    for (const k of keep) if (c[k] !== undefined && c[k] !== null) copy[k] = c[k];
    copy.name = `${c.name || 'Campaign'} (copy)`;
    await setDoc(ref, copy);
    router.push(`/campaigns/new?id=${ref.id}`);
  };
  const remove = (c: any) => {
    if (!firestore || !tenantId) return;
    if (!window.confirm(`Delete “${c.name}”?${c.status === 'sent' ? ' Its results go with it.' : ''}`)) return;
    deleteDocumentNonBlocking(doc(firestore, 'tenants', tenantId, 'campaigns', c.id));
    toast({ title: 'Deleted', description: c.name });
  };
  const togglePause = async (c: any) => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    try { const u = getAuth().currentUser; const tk = u ? await u.getIdToken() : null; if (tk) headers.Authorization = `Bearer ${tk}`; } catch { /* 401 explains */ }
    const res = await fetch('/api/campaigns/send', { method: 'POST', headers, body: JSON.stringify({ tenantId, campaignId: c.id, mode: 'pause', active: !c.automation?.active }) });
    const d = await res.json().catch(() => null);
    toast(d?.ok ? { title: d.active ? 'Automation on' : 'Automation paused' } : { variant: 'destructive', title: 'Couldn’t change it', description: d?.error || 'Try again.' });
  };

  const Tile = ({ icon: Icon, label, value, sub }: any) => (
    <div className="min-w-[9.5rem] flex-1 rounded-3xl border-2 border-slate-200 bg-white p-4">
      <p className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-slate-400"><Icon className="h-3.5 w-3.5" />{label}</p>
      <p className="mt-1 text-2xl font-black tracking-tight text-slate-900">{value}</p>
      {sub && <p className="text-[11px] font-bold text-slate-500">{sub}</p>}
    </div>
  );

  const statusPill = (c: any) => {
    const s = c.status || 'draft';
    const map: Record<string, [string, string]> = {
      draft: ['Draft', 'bg-slate-100 text-slate-600'], scheduled: [`Scheduled · ${when(c.scheduledFor)}`, 'bg-sky-100 text-sky-800'],
      sending: ['Sending', 'bg-amber-100 text-amber-800'], sent: [`Sent · ${when(c.sentAt)}`, 'bg-emerald-100 text-emerald-800'],
      automation: [c.automation?.active ? 'Automation · on' : 'Automation · paused', c.automation?.active ? 'bg-violet-100 text-violet-800' : 'bg-slate-100 text-slate-600'],
    };
    const [l, cls] = map[s] || [s, 'bg-slate-100 text-slate-600'];
    return <span className={cn('rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-widest', cls)}>{l}</span>;
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <AppHeader title="Campaigns" />
      <main className="mx-auto max-w-4xl space-y-5 px-4 pb-28 pt-4">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-black tracking-tight text-slate-900">Campaigns</h1>
            <p className="text-sm text-slate-500">Emails and texts to your clients — and what they brought back.</p>
          </div>
          <Button asChild className="hidden h-11 rounded-2xl sm:inline-flex"><Link href="/campaigns/new"><Plus className="mr-1.5 h-4 w-4" />New campaign</Link></Button>
        </div>

        {/* Results */}
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Results</p>
            <div className="flex rounded-xl bg-white p-0.5 border">
              {([['30', 'Last 30 days'], ['all', 'All time']] as const).map(([k, l]) => (
                <button key={k} type="button" onClick={() => setRange(k)} className={cn('h-8 rounded-lg px-3 text-[11px] font-bold', range === k ? 'bg-slate-900 text-white' : 'text-slate-500')}>{l}</button>
              ))}
            </div>
          </div>
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0 lg:grid-cols-5">
            <Tile icon={Users} label="Reached" value={kpi.reached.toLocaleString()} sub={`${kpi.campaigns} campaign${kpi.campaigns === 1 ? '' : 's'}`} />
            <Tile icon={CalendarCheck} label="Booked" value={kpi.booked.toLocaleString()} sub={kpi.reached ? `${kpi.rate}% of reached` : 'within 14 days'} />
            <Tile icon={DollarSign} label="Revenue" value={money(kpi.revenue)} sub="from those bookings" />
            <Tile icon={Gift} label="Offers used" value={kpi.offers.toLocaleString()} sub="at checkout" />
            <Tile icon={Repeat} label="Automations" value={kpi.automations} sub="running now" />
          </div>
        </section>

        {/* Filters */}
        <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          {([['all', 'All'], ['draft', 'Drafts'], ['scheduled', 'Scheduled'], ['automation', 'Automations'], ['sent', 'Sent']] as const).map(([k, l]) => (
            <button key={k} type="button" onClick={() => setFilter(k)} aria-pressed={filter === k}
              className={cn('h-9 shrink-0 rounded-full border-2 px-3.5 text-xs font-bold', filter === k ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-600')}>
              {l} <span className="opacity-60">{counts[k]}</span>
            </button>
          ))}
        </div>

        {/* Campaigns */}
        {isLoading ? <p className="py-10 text-center text-sm text-slate-400">Loading…</p>
          : shown.length === 0 ? (
            <div className="rounded-3xl border-2 border-dashed border-slate-300 bg-white p-8 text-center space-y-3">
              <p className="text-base font-black text-slate-900">{filter === 'all' ? 'No campaigns yet' : 'Nothing here'}</p>
              <p className="text-sm text-slate-500">Start from a template — welcome new clients, win back quiet ones, birthday wishes and more.</p>
              <Button asChild className="rounded-2xl"><Link href="/campaigns/new"><Plus className="mr-1.5 h-4 w-4" />New campaign</Link></Button>
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {shown.map((c: any) => {
                const reached = n(c.recipientCount), booked = n(c.convertedCount);
                const isSent = c.status === 'sent' || c.status === 'sending' || c.status === 'automation';
                return (
                  <article key={c.id} className="rounded-3xl border-2 border-slate-200 bg-white p-4 space-y-3">
                    <button type="button" onClick={() => router.push(`/campaigns/new?id=${encodeURIComponent(c.id)}`)} className="block w-full text-left">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="flex items-center gap-1.5 truncate text-base font-black text-slate-900">
                            {c.type === 'sms' ? <MessageSquare className="h-4 w-4 shrink-0 text-slate-400" /> : <Mail className="h-4 w-4 shrink-0 text-slate-400" />}{c.name || 'Untitled'}
                          </p>
                          <p className="mt-0.5 truncate text-xs text-slate-500">
                            {c.status === 'automation' ? (c.automation?.trigger === 'birthday' ? 'Each client’s birthday month' : `${c.automation?.daysAfter || 7} days after a first visit`) : AUDIENCE_LABEL[c.targetAudience] || c.targetAudience}
                            {c.discountId ? ' · with an offer' : ''}
                          </p>
                        </div>
                        <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-slate-300" />
                      </div>
                      <div className="mt-2">{statusPill(c)}</div>
                    </button>

                    {isSent ? (
                      <div className="grid grid-cols-3 gap-2 rounded-2xl bg-slate-50 p-3 text-center">
                        <div><p className="text-lg font-black text-slate-900">{reached}</p><p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Reached</p></div>
                        <div><p className="text-lg font-black text-slate-900">{booked}</p><p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{reached ? `Booked · ${Math.round((booked / reached) * 100)}%` : 'Booked'}</p></div>
                        <div><p className="text-lg font-black text-slate-900">{money(n(c.convertedRevenueCents))}</p><p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Revenue</p></div>
                      </div>
                    ) : (
                      <p className="line-clamp-2 rounded-2xl bg-slate-50 p-3 text-xs text-slate-500">{c.subject ? <span className="font-bold text-slate-700">{c.subject} — </span> : null}{String(c.body || '').replace(/\s+/g, ' ')}</p>
                    )}

                    {(n(c.offersRedeemed) > 0 || (c.subjectB && isSent) || n(c.failedCount) > 0) && (
                      <div className="flex flex-wrap gap-1.5 text-[11px] font-bold">
                        {n(c.offersRedeemed) > 0 && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-800">🎁 {n(c.offersRedeemed)} offer{n(c.offersRedeemed) === 1 ? '' : 's'} used</span>}
                        {c.subjectB && isSent && <span className="rounded-full bg-violet-50 px-2 py-0.5 text-violet-800">Subject A {n(c.convertedA)} · B {n(c.convertedB)} booked</span>}
                        {n(c.failedCount) > 0 && <span className="rounded-full bg-red-50 px-2 py-0.5 text-red-700">{n(c.failedCount)} didn’t send</span>}
                      </div>
                    )}

                    <div className="flex gap-2 border-t pt-3">
                      <Button type="button" size="sm" className="h-9 flex-1 rounded-xl" onClick={() => router.push(`/campaigns/new?id=${encodeURIComponent(c.id)}`)}>
                        {c.status === 'draft' || !c.status ? <><Send className="mr-1.5 h-3.5 w-3.5" />Finish &amp; send</> : 'Open'}
                      </Button>
                      {c.status === 'automation' && <Button type="button" size="sm" variant="outline" className="h-9 rounded-xl" onClick={() => togglePause(c)} aria-label={c.automation?.active ? 'Pause' : 'Resume'}>{c.automation?.active ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}</Button>}
                      <Button type="button" size="sm" variant="outline" className="h-9 rounded-xl" onClick={() => duplicate(c)} aria-label="Duplicate"><Copy className="h-3.5 w-3.5" /></Button>
                      <Button type="button" size="sm" variant="outline" className="h-9 rounded-xl text-red-600" onClick={() => remove(c)} aria-label="Delete"><Trash2 className="h-3.5 w-3.5" /></Button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
      </main>

      {/* Phone: the main action stays in reach */}
      <Link href="/campaigns/new" className="fixed bottom-5 right-5 z-30 flex h-14 items-center gap-2 rounded-full bg-slate-900 px-5 text-sm font-black text-white shadow-xl sm:hidden" style={{ marginBottom: 'env(safe-area-inset-bottom, 0px)' }}>
        <Plus className="h-5 w-5" />New
      </Link>
    </div>
  );
}
