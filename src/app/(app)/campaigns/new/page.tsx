'use client';
// src/app/(app)/campaigns/new/page.tsx
//
// THE CAMPAIGN EDITOR — a guided flow anyone can follow:
//
//   1 Start    pick a template (or a blank message)
//   2 Who      who it goes to, in plain words
//   3 Message  email or text, with a live preview
//   4 Offer    optional — one of your discounts; its code goes in the
//              message and is applied at checkout automatically when the
//              client books from it
//   5 When     send now, schedule, or repeat automatically
//   6 Review   everything in one place: the real message, how many it
//              reaches (and who's left out and why), the cost of texts,
//              a test send — and one button that does exactly what it says
//
// The draft saves itself between steps. Nothing is sent until the last step.
// Saves strip empty values first: the old editor wrote `undefined` fields
// (e.g. no offer picked), which the database rejects — that was the
// "setDoc() called with invalid data" error.

import React, { useEffect, useMemo, useRef, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { doc, setDoc, getDoc, collection } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { nanoid } from 'nanoid';
import { AppHeader } from '@/components/shared/AppHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { useFirebase } from '@/firebase';
import { useTenant } from '@/context/TenantContext';
import { useInventory } from '@/context/InventoryContext';
import { CAMPAIGN_TEMPLATES, TOKENS, fillTokens, type CampaignTemplate } from '@/lib/campaign-templates';
import { AudienceList } from '@/components/campaigns/AudienceList';
import { cn } from '@/lib/utils';
import { ArrowLeft, ArrowRight, Check, Loader, Mail, MessageSquare, Send, Sparkles, Tag, Clock, Repeat, Users, Search } from 'lucide-react';

type Step = 'start' | 'who' | 'message' | 'offer' | 'when' | 'review';
const STEPS: { id: Step; label: string }[] = [
  { id: 'start', label: 'Start' }, { id: 'who', label: 'Who' }, { id: 'message', label: 'Message' },
  { id: 'offer', label: 'Offer' }, { id: 'when', label: 'When' }, { id: 'review', label: 'Review' },
];

// Who it can go to — plain words, any kind of business.
const AUDIENCES: { id: string; label: string; hint: string; group: 'everyone' | 'visits' | 'pick' }[] = [
  { id: 'all', label: 'Everyone', hint: 'All your clients', group: 'everyone' },
  { id: 'new', label: 'New clients', hint: 'First visit in the last 30 days', group: 'visits' },
  { id: 'loyal', label: 'Regulars', hint: '5 or more visits in the last 12 months', group: 'visits' },
  { id: 'inactive_90', label: 'Haven’t been in a while', hint: 'No visit in 90+ days, nothing booked', group: 'visits' },
  { id: 'one_and_done', label: 'Came once', hint: 'One visit, 30+ days ago, never returned', group: 'visits' },
  { id: 'cancelled_recent', label: 'Cancelled or missed', hint: 'In the last 30 days, nothing booked since', group: 'visits' },
  { id: 'birthday', label: 'Birthdays this month', hint: 'Clients with a birthday this month', group: 'visits' },
  { id: 'members', label: 'Members', hint: 'Clients with an active membership', group: 'visits' },
  { id: 'service', label: 'Had a certain service', hint: 'Their last visit included it', group: 'pick' },
  { id: 'provider', label: 'Saw a certain team member', hint: 'Their last visit was with them', group: 'pick' },
  { id: 'spent_over', label: 'Top spenders', hint: 'Spent over an amount in 12 months', group: 'pick' },
  { id: 'specific', label: 'Hand-picked clients', hint: 'Choose them one by one', group: 'pick' },
];

type Draft = {
  name: string; type: 'email' | 'sms'; subject: string; subjectB: string; body: string; imageUrl: string;
  targetAudience: string; targetClientIds: string[]; targetServiceIds: string[]; targetStaffIds: string[]; targetMinSpend: number;
  discountId: string; templateId: string;
};
const EMPTY: Draft = { name: '', type: 'email', subject: '', subjectB: '', body: '', imageUrl: '', targetAudience: 'all', targetClientIds: [], targetServiceIds: [], targetStaffIds: [], targetMinSpend: 0, discountId: '', templateId: '' };

// The database rejects `undefined`; empty strings/arrays are fine. Strip the rest.
const clean = (o: any) => JSON.parse(JSON.stringify(o, (_k, v) => (v === undefined ? null : v)));

const segmentsOf = (t: string) => { const gsm = /^[\n\r\x20-\x7E]*$/.test(t); const per = gsm ? (t.length <= 160 ? 160 : 153) : (t.length <= 70 ? 70 : 67); return Math.max(1, Math.ceil(t.length / per)); };

// Layout pieces live OUTSIDE the editor: defined inside, they'd be new
// components on every keystroke and inputs would lose focus.
const Card = ({ children, className }: any) => <div className={cn('rounded-3xl border-2 border-slate-200 bg-white p-5 space-y-4', className)}>{children}</div>;
const H = ({ children, sub }: any) => <div><h2 className="text-lg font-black tracking-tight text-slate-900">{children}</h2>{sub && <p className="text-sm text-slate-500 mt-0.5">{sub}</p>}</div>;
const Choice = ({ on, onClick, title, hint, icon: Icon }: any) => (
  <button type="button" onClick={onClick} aria-pressed={on} className={cn('w-full rounded-2xl border-2 p-3.5 text-left transition-colors', on ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white hover:border-slate-400')}>
    <span className="flex items-center gap-2 text-sm font-black">{Icon && <Icon className="h-4 w-4 shrink-0" />}{title}{on && <Check className="ml-auto h-4 w-4" />}</span>
    {hint && <span className={cn('block text-xs mt-0.5', on ? 'text-white/70' : 'text-slate-500')}>{hint}</span>}
  </button>
);

function Editor() {
  const { firestore, user } = useFirebase();
  const { selectedTenant } = useTenant();
  const { discounts, clients, services, staff } = useInventory() as any;
  const router = useRouter();
  const { toast } = useToast();
  const search = useSearchParams();
  const editId = search?.get('id') || '';
  const [campaignId] = useState(() => editId || nanoid());
  const tenantId = selectedTenant?.id || '';
  const business = String(selectedTenant?.name || 'your business');

  const [step, setStep] = useState<Step>(editId ? 'review' : 'start');
  const [d, setD] = useState<Draft>(EMPTY);
  const [status, setStatus] = useState<string>('new');
  const [automation, setAutomation] = useState<any>(null);
  const [whenMode, setWhenMode] = useState<'now' | 'schedule' | 'automate'>('now');
  const [scheduleAt, setScheduleAt] = useState('');
  const [autoTrigger, setAutoTrigger] = useState<'birthday' | 'first_visit_followup'>('birthday');
  const [autoDays, setAutoDays] = useState(7);
  const [abOn, setAbOn] = useState(false);
  const [reach, setReach] = useState<any>(null);
  const [reachBusy, setReachBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [testTo, setTestTo] = useState('');
  const [testResult, setTestResult] = useState<{ ok: boolean; lines: string[] } | null>(null);
  const [clientQuery, setClientQuery] = useState('');
  const [newOffer, setNewOffer] = useState<{ open: boolean; kind: 'percentage' | 'fixed'; value: string; code: string; until: string; onePer: boolean }>({ open: false, kind: 'percentage', value: '15', code: '', until: '', onePer: true });
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const set = (p: Partial<Draft>) => { setD((x) => ({ ...x, ...p })); if ('targetAudience' in p || 'type' in p || 'targetServiceIds' in p || 'targetStaffIds' in p || 'targetMinSpend' in p || 'targetClientIds' in p) setReach(null); };

  // Open a saved campaign.
  useEffect(() => {
    if (!editId || !firestore || !tenantId) return;
    getDoc(doc(firestore, 'tenants', tenantId, 'campaigns', editId)).then((snap) => {
      if (!snap.exists()) { setStep('start'); return; }
      const x: any = snap.data();
      setD({ ...EMPTY, ...Object.fromEntries(Object.entries(x).filter(([k]) => k in EMPTY)), discountId: x.discountId || '', imageUrl: x.imageUrl || '', subjectB: x.subjectB || '' } as Draft);
      setStatus(x.status || 'draft');
      if (x.subjectB) setAbOn(true);
      if (x.status === 'scheduled' && x.scheduledFor) { setWhenMode('schedule'); setScheduleAt(String(x.scheduledFor).slice(0, 16)); }
      if (x.status === 'automation' && x.automation) { setWhenMode('automate'); setAutomation(x.automation); setAutoTrigger(x.automation.trigger); setAutoDays(Number(x.automation.daysAfter) || 7); }
    });
  }, [editId, firestore, tenantId]);

  useEffect(() => { if (user?.email && !testTo && d.type === 'email') setTestTo(user.email); }, [user?.email, d.type]); // eslint-disable-line react-hooks/exhaustive-deps

  const offers = useMemo(() => (discounts || []).filter((x: any) => x.isActive !== false && x.code), [discounts]);
  const chosenOffer: any = offers.find((x: any) => x.id === d.discountId) || null;
  const offerLine = chosenOffer ? `${chosenOffer.type === 'percentage' ? `${chosenOffer.value}% off` : `$${Number(chosenOffer.value).toFixed(0)} off`} with code ${chosenOffer.code}${chosenOffer.validUntil ? ` — until ${new Date(chosenOffer.validUntil).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}` : null;
  const audience = AUDIENCES.find((a) => a.id === d.targetAudience);
  const locked = status === 'sent' || status === 'sending';

  // ── Server calls ──
  const call = async (mode: string, extra: any = {}) => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    try { const u = getAuth().currentUser; const tk = u ? await u.getIdToken() : null; if (tk) headers.Authorization = `Bearer ${tk}`; } catch { /* 401 explains */ }
    const res = await fetch('/api/campaigns/send', { method: 'POST', headers, body: JSON.stringify({ tenantId, campaignId, mode, ...extra }) });
    return res.json().catch(() => ({ ok: false, error: 'No response' }));
  };
  const save = async (extra: any = {}) => {
    if (!firestore || !tenantId) return false;
    const payload = clean({
      ...d, id: campaignId, name: d.name.trim() || (CAMPAIGN_TEMPLATES.find((t) => t.id === d.templateId)?.title) || 'Untitled campaign',
      subjectB: abOn && d.type === 'email' ? d.subjectB : '', discountId: d.discountId || null, imageUrl: d.type === 'email' ? d.imageUrl : '',
      targetMinSpend: Number(d.targetMinSpend) || 0, updatedAt: new Date().toISOString(),
      ...(status === 'new' ? { status: 'draft', createdAt: new Date().toISOString() } : {}), ...extra,
    });
    try { await setDoc(doc(firestore, 'tenants', tenantId, 'campaigns', campaignId), payload, { merge: true }); if (status === 'new') setStatus('draft'); return true; }
    catch (e: any) { toast({ variant: 'destructive', title: 'Couldn’t save', description: String(e?.message || e) }); return false; }
  };
  const checkReach = async () => {
    setReachBusy(true);
    if (await save()) { const r = await call('preview'); setReach(r?.ok ? r : { error: r?.error || 'Couldn’t work it out.' }); }
    setReachBusy(false);
  };

  // ── Step rules ──
  const stepProblem = (s: Step): string | null => {
    if (s === 'who') {
      if (d.targetAudience === 'service' && !d.targetServiceIds.length) return 'Pick at least one service.';
      if (d.targetAudience === 'provider' && !d.targetStaffIds.length) return 'Pick at least one team member.';
      if (d.targetAudience === 'spent_over' && !(Number(d.targetMinSpend) > 0)) return 'Enter an amount.';
      if (d.targetAudience === 'specific' && !d.targetClientIds.length) return 'Pick at least one client.';
    }
    if (s === 'message') {
      if (d.type === 'email' && !d.subject.trim()) return 'Add a subject line.';
      if (d.body.trim().length < 10) return 'Write a message (at least a sentence).';
      if (/\[[^\]]+\]/.test(d.body)) return 'Replace the part in [square brackets] with your own words.';
    }
    if (s === 'when') {
      if (whenMode === 'schedule' && !scheduleAt) return 'Pick a date and time.';
    }
    return null;
  };
  const idx = STEPS.findIndex((x) => x.id === step);
  const go = async (to: Step) => {
    const toIdx = STEPS.findIndex((x) => x.id === to);
    if (toIdx > idx) { for (const s of STEPS.slice(0, toIdx)) { const p = stepProblem(s.id); if (p) { setStep(s.id); toast({ variant: 'destructive', title: 'One thing first', description: p }); return; } } }
    if (step !== 'start') await save();
    if (to === 'review') void checkReach();
    setStep(to);
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const pickTemplate = (t: CampaignTemplate | null) => {
    if (!t) { set({ ...EMPTY, templateId: '', name: '' }); setStep('who'); return; }
    set({ ...EMPTY, templateId: t.id, name: t.title, type: t.channel, subject: t.subject, body: t.body, targetAudience: t.audience === 'first_visit_followup' ? 'new' : t.audience });
    if (t.automation) { setWhenMode('automate'); setAutoTrigger(t.automation); } else setWhenMode('now');
    setStep('who');
  };
  const insertToken = (tok: string) => {
    const el = bodyRef.current; const v = d.body;
    if (!el) { set({ body: v + tok }); return; }
    const a = el.selectionStart ?? v.length, b = el.selectionEnd ?? v.length;
    set({ body: v.slice(0, a) + tok + v.slice(b) });
    setTimeout(() => { el.focus(); el.selectionStart = el.selectionEnd = a + tok.length; }, 0);
  };

  const createOffer = async () => {
    if (!firestore || !tenantId) return;
    const value = Number(newOffer.value);
    const code = newOffer.code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!(value > 0) || (newOffer.kind === 'percentage' && value > 100)) { toast({ variant: 'destructive', title: 'Check the amount' }); return; }
    if (code.length < 3) { toast({ variant: 'destructive', title: 'Pick a code', description: 'At least 3 letters or numbers.' }); return; }
    if ((discounts || []).some((x: any) => String(x.code || '').toUpperCase() === code)) { toast({ variant: 'destructive', title: 'That code is taken', description: 'Choose another.' }); return; }
    const ref = doc(collection(firestore, 'tenants', tenantId, 'discounts'));
    await setDoc(ref, clean({ id: ref.id, code, description: `Campaign offer${d.name ? ` — ${d.name}` : ''}`, type: newOffer.kind, value, usageLimit: 0, usageCount: 0, isActive: true,
      validFrom: new Date().toISOString(), ...(newOffer.until ? { validUntil: new Date(`${newOffer.until}T23:59:00`).toISOString() } : {}), limitOnePerCustomer: newOffer.onePer, createdAt: new Date().toISOString() }));
    set({ discountId: ref.id });
    setNewOffer((x) => ({ ...x, open: false }));
    toast({ title: 'Offer created', description: `${code} is live and attached to this campaign.` });
  };

  const runTest = async () => {
    setTestResult(null);
    if (!(await save())) return;
    const r = await call('test', { to: testTo });
    setTestResult(r?.ok ? { ok: true, lines: [`Sent to ${r.to || testTo}.`, ...(r.notes || [])] } : { ok: false, lines: [r?.error || 'Not sent.'] });
  };

  const finish = async () => {
    for (const s of STEPS) { const p = stepProblem(s.id); if (p) { setStep(s.id); toast({ variant: 'destructive', title: 'One thing first', description: p }); return; } }
    setBusy(true);
    try {
      if (!(await save())) return;
      if (whenMode === 'automate') {
        const r = await call('automate', { trigger: autoTrigger, daysAfter: autoDays });
        if (!r?.ok) { toast({ variant: 'destructive', title: 'Not started', description: r?.error || 'Try again.' }); return; }
        toast({ title: 'Automation is on', description: 'Each morning it sends to whoever is due.' }); router.push('/campaigns'); return;
      }
      if (whenMode === 'schedule') {
        const r = await call('schedule', { scheduledFor: new Date(scheduleAt).toISOString() });
        if (!r?.ok) { toast({ variant: 'destructive', title: 'Not scheduled', description: r?.error || 'Try again.' }); return; }
        toast({ title: 'Scheduled', description: 'It goes out with the first daily send after that time.' }); router.push('/campaigns'); return;
      }
      const pv = await call('preview');
      if (!pv?.ok) { toast({ variant: 'destructive', title: 'Couldn’t prepare it', description: pv?.error || 'Try again.' }); return; }
      if (!pv.summary.willReceive) { toast({ variant: 'destructive', title: 'Nobody to send to', description: 'See “Who it reaches” for why.' }); return; }
      let totals = { sent: 0, failed: 0 };
      for (let i = 0; i < 100; i++) {
        const r = await call('send');
        if (!r?.ok) { toast({ variant: 'destructive', title: r?.quietHours ? 'Outside texting hours' : 'Sending stopped', description: r?.quietHours ? r.error : `${r?.error || 'Something went wrong'} — ${totals.sent} sent so far. Open it again to finish; nobody gets it twice.` }); return; }
        totals = r.totals; setProgress(`${totals.sent} of ${pv.summary.willReceive} sent…`);
        if (r.done) { toast({ title: 'Sent', description: `${totals.sent} delivered${totals.failed ? `, ${totals.failed} failed` : ''}. Bookings in the next 14 days show on the campaign.` }); router.push('/campaigns'); return; }
      }
    } finally { setBusy(false); setProgress(''); }
  };

  // ── Preview text (client-side, instant) ──
  const previewBody = fillTokens(d.body, { first: 'Alexandra', business, offer: offerLine, link: 'your booking link' });
  const smsFull = `${business}: ${previewBody}${offerLine && !d.body.includes('{offer}') ? ` ${offerLine}.` : ''}\nReply STOP to opt out.`;
  const actionLabel = whenMode === 'automate' ? 'Turn on automation' : whenMode === 'schedule' ? 'Schedule it' : reach?.summary ? `Send to ${reach.summary.willReceive} client${reach.summary.willReceive === 1 ? '' : 's'}` : 'Send';

  const filteredClients = (clients || []).filter((c: any) => !c.ownerRenterId && (!clientQuery || String(c.name || '').toLowerCase().includes(clientQuery.toLowerCase()) || String(c.email || '').toLowerCase().includes(clientQuery.toLowerCase()))).slice(0, 60);

  return (
    <div className="min-h-screen bg-slate-50">
      <AppHeader title={editId ? 'Campaign' : 'New campaign'} />
      <main className="mx-auto max-w-2xl px-4 pb-40 pt-4 space-y-5">
        {/* Steps */}
        <nav className="flex gap-1 overflow-x-auto pb-1" aria-label="Steps">
          {STEPS.map((s, i) => (
            <button key={s.id} type="button" onClick={() => go(s.id)} disabled={locked && s.id !== 'review'}
              className={cn('shrink-0 rounded-full px-3 py-1.5 text-[11px] font-black uppercase tracking-widest', s.id === step ? 'bg-slate-900 text-white' : i < idx ? 'bg-emerald-100 text-emerald-800' : 'bg-white text-slate-400 border')}>
              {i < idx ? '✓ ' : `${i + 1} `}{s.label}
            </button>
          ))}
        </nav>

        {locked && <p className="rounded-2xl border-2 border-emerald-200 bg-emerald-50 p-3 text-sm font-bold text-emerald-900">This campaign has been sent. You can review it here; to send something similar, start a new one.</p>}

        {/* 1 · START */}
        {step === 'start' && (
          <Card>
            <H sub="Pick one to start from — you can change every word.">What do you want to do?</H>
            <div className="grid gap-2 sm:grid-cols-2">
              {CAMPAIGN_TEMPLATES.map((t) => (
                <button key={t.id} type="button" onClick={() => pickTemplate(t)} className="rounded-2xl border-2 border-slate-200 bg-white p-3.5 text-left hover:border-slate-900">
                  <span className="flex items-center gap-2 text-sm font-black text-slate-900">{t.channel === 'sms' ? <MessageSquare className="h-4 w-4" /> : <Mail className="h-4 w-4" />}{t.title}</span>
                  <span className="block text-xs text-slate-500 mt-0.5">{t.blurb}{t.automation ? ' · repeats automatically' : ''}</span>
                </button>
              ))}
              <button type="button" onClick={() => pickTemplate(null)} className="rounded-2xl border-2 border-dashed border-slate-300 p-3.5 text-left hover:border-slate-900">
                <span className="text-sm font-black text-slate-900">Start from a blank message</span>
                <span className="block text-xs text-slate-500 mt-0.5">Write your own.</span>
              </button>
            </div>
          </Card>
        )}

        {/* 2 · WHO */}
        {step === 'who' && (
          <Card>
            <H sub="Only clients who can receive it are counted — you’ll see the exact number on Review.">Who should get it?</H>
            {(['everyone', 'visits', 'pick'] as const).map((g) => (
              <div key={g} className="space-y-2">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{g === 'everyone' ? 'Everyone' : g === 'visits' ? 'Based on their visits' : 'You choose'}</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {AUDIENCES.filter((a) => a.group === g).map((a) => <Choice key={a.id} on={d.targetAudience === a.id} onClick={() => set({ targetAudience: a.id })} title={a.label} hint={a.hint} />)}
                </div>
              </div>
            ))}
            {d.targetAudience === 'service' && (
              <div className="flex flex-wrap gap-2">{(services || []).map((s: any) => { const on = d.targetServiceIds.includes(s.id); return <button key={s.id} type="button" onClick={() => set({ targetServiceIds: on ? d.targetServiceIds.filter((x) => x !== s.id) : [...d.targetServiceIds, s.id] })} className={cn('h-9 rounded-xl border-2 px-3 text-xs font-bold', on ? 'bg-slate-900 text-white border-slate-900' : 'border-slate-200')}>{s.name}</button>; })}</div>
            )}
            {d.targetAudience === 'provider' && (
              <div className="flex flex-wrap gap-2">{(staff || []).filter((s: any) => s.isActive !== false && !s.isRenter).map((s: any) => { const on = d.targetStaffIds.includes(s.id); return <button key={s.id} type="button" onClick={() => set({ targetStaffIds: on ? d.targetStaffIds.filter((x) => x !== s.id) : [...d.targetStaffIds, s.id] })} className={cn('h-9 rounded-xl border-2 px-3 text-xs font-bold', on ? 'bg-slate-900 text-white border-slate-900' : 'border-slate-200')}>{s.name || 'Team member'}</button>; })}</div>
            )}
            {d.targetAudience === 'spent_over' && (
              <label className="flex items-center gap-2 text-sm font-bold">Spent at least $<Input type="number" min={1} value={d.targetMinSpend || ''} onChange={(e) => set({ targetMinSpend: Number(e.target.value) || 0 })} className="h-10 w-32" /> in the last 12 months</label>
            )}
            <div className="rounded-2xl border-2 border-dashed border-slate-200 p-3 space-y-2">
              {!reach?.recipients || reachBusy
                ? <Button type="button" variant="outline" disabled={reachBusy || !!stepProblem('who')} onClick={checkReach} className="w-full">{reachBusy ? <><Loader className="h-4 w-4 mr-2 animate-spin" />Finding them…</> : <><Users className="h-4 w-4 mr-2" />See who’s in it</>}</Button>
                : <>
                    <div className="flex items-center justify-between"><p className="text-xs font-black uppercase tracking-widest text-slate-500">{audience?.label}</p><button type="button" onClick={checkReach} className="text-[11px] font-bold text-slate-500 underline">Refresh</button></div>
                    <AudienceList recipients={reach.recipients} skipped={reach.skipped} channel={d.type} total={reach.summary?.willReceive} compact />
                  </>}
            </div>
            {d.targetAudience === 'specific' && (
              <div className="space-y-2">
                <div className="relative"><Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" /><Input value={clientQuery} onChange={(e) => setClientQuery(e.target.value)} placeholder="Search clients" className="h-10 pl-9" /></div>
                <p className="text-xs font-bold text-slate-500">{d.targetClientIds.length} picked</p>
                <div className="max-h-64 overflow-y-auto rounded-xl border divide-y">
                  {filteredClients.map((c: any) => { const on = d.targetClientIds.includes(c.id); return (
                    <label key={c.id} className="flex items-center gap-3 px-3 py-2 text-sm cursor-pointer">
                      <input type="checkbox" checked={on} onChange={() => set({ targetClientIds: on ? d.targetClientIds.filter((x) => x !== c.id) : [...d.targetClientIds, c.id] })} className="h-4 w-4" />
                      <span className="font-bold">{c.name || 'Client'}</span><span className="text-xs text-slate-400 truncate">{c.email || c.phone || ''}</span>
                    </label>); })}
                </div>
              </div>
            )}
          </Card>
        )}

        {/* 3 · MESSAGE */}
        {step === 'message' && (
          <Card>
            <H sub="Emails are free. Texts only reach clients who said yes to offers by text.">Write your message</H>
            <div className="grid grid-cols-2 gap-2">
              <Choice on={d.type === 'email'} onClick={() => set({ type: 'email' })} title="Email" hint="Free · with a Book button" icon={Mail} />
              <Choice on={d.type === 'sms'} onClick={() => set({ type: 'sms' })} title="Text" hint="About 1–3¢ each" icon={MessageSquare} />
            </div>
            {d.type === 'email' && (
              <div className="space-y-2">
                <label className="block text-xs font-black uppercase tracking-widest text-slate-500">Subject</label>
                <Input value={d.subject} onChange={(e) => set({ subject: e.target.value.slice(0, 140) })} placeholder="What they see in their inbox" className="h-11" />
                <label className="flex items-center gap-2 text-xs font-bold text-slate-600"><input type="checkbox" checked={abOn} onChange={(e) => setAbOn(e.target.checked)} className="h-4 w-4" />Try a second subject (half get each — you’ll see which brought more bookings)</label>
                {abOn && <Input value={d.subjectB} onChange={(e) => set({ subjectB: e.target.value.slice(0, 140) })} placeholder="Second subject" className="h-11" />}
              </div>
            )}
            <div className="space-y-2">
              <label className="block text-xs font-black uppercase tracking-widest text-slate-500">Message</label>
              <div className="flex flex-wrap gap-1.5">{TOKENS.map((t) => <button key={t.token} type="button" onClick={() => insertToken(t.token)} className="rounded-full border-2 border-slate-200 px-2.5 py-1 text-[11px] font-bold text-slate-600 hover:border-slate-900">+ {t.label}</button>)}</div>
              <Textarea ref={bodyRef} value={d.body} onChange={(e) => set({ body: e.target.value.slice(0, 2000) })} rows={d.type === 'sms' ? 4 : 9} placeholder="Hi {first}, …" />
              {d.type === 'sms' && <p className="text-xs font-bold text-slate-500">{smsFull.length} characters · {segmentsOf(smsFull)} text{segmentsOf(smsFull) === 1 ? '' : 's'} each (your business name and “Reply STOP to opt out” are included){/[^\n\r\x20-\x7E]/.test(smsFull) ? ' · emoji make texts shorter and cost more' : ''}</p>}
              {/\[[^\]]+\]/.test(d.body) && <p className="text-xs font-bold text-amber-700">Replace the part in [square brackets] with your own words.</p>}
            </div>
            {d.type === 'email' && (
              <div className="space-y-1">
                <label className="block text-xs font-black uppercase tracking-widest text-slate-500">Picture (optional)</label>
                <Input value={d.imageUrl} onChange={(e) => set({ imageUrl: e.target.value.trim() })} placeholder="https://… link to an image" className="h-10" />
              </div>
            )}
            <div className="rounded-2xl bg-slate-100 p-4">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Preview · as Alexandra sees it</p>
              {d.type === 'sms'
                ? <div className="max-w-[85%] rounded-2xl rounded-bl-sm bg-white p-3 text-sm whitespace-pre-wrap shadow-sm">{smsFull}</div>
                : <div className="rounded-2xl bg-white p-4 shadow-sm space-y-2"><p className="text-sm font-black">{fillTokens(d.subject || '(no subject)', { first: 'Alexandra', business, offer: offerLine, link: null })}</p><p className="text-sm whitespace-pre-wrap text-slate-700">{previewBody}{offerLine && !d.body.includes('{offer}') ? `\n\n${offerLine}` : ''}</p><span className="inline-block rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-black text-white">Book now</span></div>}
            </div>
          </Card>
        )}

        {/* 4 · OFFER */}
        {step === 'offer' && (
          <Card>
            <H sub="An offer is one of your discounts. Its code goes into the message, and when a client books from it, the discount is applied at checkout automatically.">Add an offer? (optional)</H>
            <div className="grid gap-2">
              <Choice on={!d.discountId} onClick={() => set({ discountId: '' })} title="No offer" hint="Just the message." />
              {offers.map((o: any) => (
                <Choice key={o.id} on={d.discountId === o.id} onClick={() => set({ discountId: o.id })} icon={Tag}
                  title={`${o.type === 'percentage' ? `${o.value}% off` : `$${Number(o.value).toFixed(0)} off`} · ${o.code}`}
                  hint={[o.description, o.validUntil ? `until ${new Date(o.validUntil).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : 'no end date', o.limitOnePerCustomer ? 'once per client' : '', o.usageLimit > 0 ? `${o.usageCount || 0}/${o.usageLimit} used` : ''].filter(Boolean).join(' · ')} />
              ))}
            </div>
            {!newOffer.open
              ? <Button type="button" variant="outline" onClick={() => setNewOffer((x) => ({ ...x, open: true, code: x.code || (d.templateId ? `${d.templateId.replace(/_/g, '').toUpperCase().slice(0, 8)}${x.value}` : `OFFER${x.value}`) }))}>+ Create a new offer</Button>
              : (
                <div className="space-y-3 rounded-2xl border-2 border-dashed p-4">
                  <div className="grid grid-cols-2 gap-2">
                    <Choice on={newOffer.kind === 'percentage'} onClick={() => setNewOffer((x) => ({ ...x, kind: 'percentage' }))} title="% off" />
                    <Choice on={newOffer.kind === 'fixed'} onClick={() => setNewOffer((x) => ({ ...x, kind: 'fixed' }))} title="$ off" />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="text-xs font-bold text-slate-600">Amount<Input type="number" min={1} value={newOffer.value} onChange={(e) => setNewOffer((x) => ({ ...x, value: e.target.value }))} className="h-10 mt-1" /></label>
                    <label className="text-xs font-bold text-slate-600">Code<Input value={newOffer.code} onChange={(e) => setNewOffer((x) => ({ ...x, code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20) }))} className="h-10 mt-1" /></label>
                  </div>
                  <label className="block text-xs font-bold text-slate-600">Ends (optional)<Input type="date" value={newOffer.until} onChange={(e) => setNewOffer((x) => ({ ...x, until: e.target.value }))} className="h-10 mt-1" /></label>
                  <label className="flex items-center gap-2 text-xs font-bold text-slate-600"><input type="checkbox" checked={newOffer.onePer} onChange={(e) => setNewOffer((x) => ({ ...x, onePer: e.target.checked }))} className="h-4 w-4" />Once per client</label>
                  <div className="flex gap-2"><Button type="button" onClick={createOffer}>Create and attach</Button><Button type="button" variant="ghost" onClick={() => setNewOffer((x) => ({ ...x, open: false }))}>Cancel</Button></div>
                  <p className="text-[11px] text-slate-500">It also appears on your Discounts page, where you can pause or edit it.</p>
                </div>
              )}
            {chosenOffer && !d.body.includes('{offer}') && <p className="text-xs font-bold text-slate-500">Your message doesn’t mention the offer, so it’s added at the end. To place it yourself, add “The offer” in the message.</p>}
          </Card>
        )}

        {/* 5 · WHEN */}
        {step === 'when' && (
          <Card>
            <H sub="Texts only go out 9am–8pm.">When should it go out?</H>
            <div className="grid gap-2">
              <Choice on={whenMode === 'now'} onClick={() => setWhenMode('now')} title="Send now" hint="Right after you review it." icon={Send} />
              <Choice on={whenMode === 'schedule'} onClick={() => setWhenMode('schedule')} title="Schedule it" hint="Goes out with the first daily send after the time you pick." icon={Clock} />
              <Choice on={whenMode === 'automate'} onClick={() => setWhenMode('automate')} title="Repeat automatically" hint="Sends on its own to each client when they’re due." icon={Repeat} />
            </div>
            {whenMode === 'schedule' && <Input type="datetime-local" value={scheduleAt} onChange={(e) => setScheduleAt(e.target.value)} className="h-11" />}
            {whenMode === 'automate' && (
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <Choice on={autoTrigger === 'birthday'} onClick={() => setAutoTrigger('birthday')} title="Birthdays" hint="Once a year, in their birthday month" />
                  <Choice on={autoTrigger === 'first_visit_followup'} onClick={() => setAutoTrigger('first_visit_followup')} title="After a first visit" hint="Once, a few days later" />
                </div>
                {autoTrigger === 'first_visit_followup' && <label className="flex items-center gap-2 text-sm font-bold">Send <Input type="number" min={1} max={90} value={autoDays} onChange={(e) => setAutoDays(Number(e.target.value) || 7)} className="h-10 w-20" /> days after their first visit</label>}
                <p className="text-xs text-slate-500">With “Repeat automatically”, who gets it is decided by the choice above, not the Who step.</p>
                {automation && <p className="text-xs font-bold text-violet-700">This automation is {automation.active ? 'on' : 'paused'}. <button type="button" className="underline" onClick={async () => { const r = await call('pause', { active: !automation.active }); if (r?.ok) setAutomation({ ...automation, active: r.active }); }}>{automation.active ? 'Pause it' : 'Resume it'}</button></p>}
              </div>
            )}
          </Card>
        )}

        {/* 6 · REVIEW */}
        {step === 'review' && (
          <div className="space-y-4">
            <Card>
              <H>Review</H>
              <label className="block text-xs font-black uppercase tracking-widest text-slate-500">Name (only you see it)<Input value={d.name} onChange={(e) => set({ name: e.target.value.slice(0, 80) })} placeholder="e.g. September win-back" className="h-11 mt-1" disabled={locked} /></label>
              {[
                ['Who', whenMode === 'automate' ? (autoTrigger === 'birthday' ? 'Each client in their birthday month' : `Each new client, ${autoDays} days after their first visit`) : `${audience?.label || d.targetAudience}${d.targetAudience === 'specific' ? ` (${d.targetClientIds.length})` : ''}`, 'who'],
                ['How', d.type === 'sms' ? 'Text' : `Email${abOn && d.subjectB ? ' · two subjects' : ''}`, 'message'],
                ['Offer', offerLine || 'None', 'offer'],
                ['When', whenMode === 'now' ? 'Now' : whenMode === 'schedule' ? (scheduleAt ? new Date(scheduleAt).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—') : 'Repeats automatically', 'when'],
              ].map(([k, v, s]) => (
                <div key={k} className="flex items-center justify-between gap-3 border-t pt-3 text-sm">
                  <span className="text-slate-500 font-bold">{k}</span><span className="flex-1 text-right font-black text-slate-900">{v}</span>
                  {!locked && <button type="button" onClick={() => go(s as Step)} className="text-xs font-bold text-slate-500 underline">Edit</button>}
                </div>
              ))}
            </Card>

            <Card>
              <p className="text-xs font-black uppercase tracking-widest text-slate-500">Who it reaches{whenMode === 'automate' ? ' today' : ''}</p>
              {reachBusy ? <p className="text-sm text-slate-500 flex items-center gap-2"><Loader className="h-4 w-4 animate-spin" />Working it out…</p>
                : reach?.error ? <p className="text-sm font-bold text-red-700">{reach.error}</p>
                : reach?.summary ? (
                  <div className="space-y-1 text-sm">
                    <p className="flex items-center gap-2 font-black text-slate-900"><Users className="h-4 w-4" />{reach.summary.willReceive} client{reach.summary.willReceive === 1 ? '' : 's'}</p>
                    {reach.summary.skippedNoConsent > 0 && <p className="text-slate-500">{reach.summary.skippedNoConsent} left out — haven’t said yes to offers by text</p>}
                    {reach.summary.skippedMonthlyCap > 0 && <p className="text-slate-500">{reach.summary.skippedMonthlyCap} left out — already had 4 marketing texts this month</p>}
                    {reach.summary.skippedNoContact > 0 && <p className="text-slate-500">{reach.summary.skippedNoContact} left out — no {d.type === 'sms' ? 'mobile number' : 'email'} on file</p>}
                    {reach.summary.skippedUnsubscribed > 0 && <p className="text-slate-500">{reach.summary.skippedUnsubscribed} left out — unsubscribed</p>}
                    {d.type === 'sms' && reach.estCostCents > 0 && <p className="font-bold text-slate-700">Estimated text cost: about ${(reach.estCostCents / 100).toFixed(2)}</p>}
                    {reach.summary.willReceive === 0 && d.type === 'sms' && reach.summary.skippedNoConsent > 0 && <p className="text-xs font-bold text-amber-700">Tip: send it as an email instead — emails reach everyone with an address.</p>}
                    {reach.recipients && <div className="pt-2"><AudienceList recipients={reach.recipients} skipped={reach.skipped} channel={d.type} total={reach.summary.willReceive} /></div>}
                  </div>
                ) : <Button type="button" variant="outline" onClick={checkReach}>Check</Button>}
            </Card>

            {reach?.sampleText && (
              <Card>
                <p className="text-xs font-black uppercase tracking-widest text-slate-500">The message, exactly as sent</p>
                {reach.sampleSubject && <p className="text-sm font-black">{reach.sampleSubject}</p>}
                <p className="text-sm whitespace-pre-wrap text-slate-700">{d.type === 'sms' ? `${reach.senderName}: ${reach.sampleText}\nReply STOP to opt out.` : reach.sampleText}</p>
              </Card>
            )}

            {!locked && (
              <Card>
                <p className="text-xs font-black uppercase tracking-widest text-slate-500">Send yourself a test</p>
                <div className="flex gap-2">
                  <Input value={testTo} onChange={(e) => { setTestTo(e.target.value); setTestResult(null); }} type={d.type === 'sms' ? 'tel' : 'email'} placeholder={d.type === 'sms' ? 'Your mobile number' : 'Your email'} className="h-11" />
                  <Button type="button" variant="outline" onClick={runTest} className="h-11 shrink-0">Send test</Button>
                </div>
                {testResult && <div className={cn('rounded-2xl border-2 p-3 text-sm space-y-1', testResult.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-red-200 bg-red-50 text-red-900')}>{testResult.lines.map((l, i) => <p key={i} className={i === 0 ? 'font-black' : ''}>{l}</p>)}</div>}
              </Card>
            )}
          </div>
        )}
      </main>

      {/* Bottom bar */}
      {step !== 'start' && !locked && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-white/95 backdrop-blur px-4 pt-3" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 12px)' }}>
          <div className="mx-auto flex max-w-2xl gap-2">
            <Button type="button" variant="outline" className="h-12" onClick={() => go(STEPS[Math.max(0, idx - 1)].id)}><ArrowLeft className="h-4 w-4 mr-1" />Back</Button>
            {step !== 'review'
              ? <Button type="button" className="h-12 flex-1" onClick={() => go(STEPS[idx + 1].id)}>Next: {STEPS[idx + 1].label}<ArrowRight className="h-4 w-4 ml-1" /></Button>
              : <Button type="button" className="h-12 flex-1" disabled={busy} onClick={finish}>{busy ? <><Loader className="h-4 w-4 mr-2 animate-spin" />{progress || 'Working…'}</> : <><Sparkles className="h-4 w-4 mr-2" />{actionLabel}</>}</Button>}
          </div>
          <p className="mx-auto max-w-2xl pt-1 text-center text-[10px] font-bold text-slate-400">Saved automatically · nothing is sent until you press the last button</p>
        </div>
      )}
    </div>
  );
}

export default function NewCampaignPage() {
  return (
    <Suspense fallback={<div className="p-10 text-sm text-slate-500">Loading…</div>}>
      <Editor />
    </Suspense>
  );
}
