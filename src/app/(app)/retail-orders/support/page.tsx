'use client';

import {
  addDoc, collection, doc, onSnapshot, query, updateDoc, where, type Firestore,
} from 'firebase/firestore';
import { ArrowLeft, Check, ClipboardCopy, Coins, Flag, Inbox, LifeBuoy, Loader, Scale, ShieldAlert } from 'lucide-react';
import Link from 'next/link';
import React, { useEffect, useMemo, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { useTenant } from '@/context/TenantContext';
import { useFirebase, useUser } from '@/firebase';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

// ─── Shop Support inbox ───────────────────────────────────────────────────────
// Every "Need help with this order?" request lands here live, tied to a real
// order (the customer's tracking page is the only way to file one). Resolve
// closes the loop; the order's audit timeline already carries the request.

interface SupportTicket {
  id: string;
  orderId: string;
  orderNumber: number;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  stageAtRequest: string;
  message: string;
  status: 'open' | 'resolved';
  priority?: 'urgent' | 'normal';
  autoReply?: string;
  expectNote?: string;
  photoUrls?: string[];
  category?: string;
  caseRef?: string;
  followUps?: { at: string | null; message: string; kind: 'chaser' | 'evidence'; photoUrls?: string[] }[];
  customerMessagesSinceStaffReply?: number;
  replies?: { by: string; text: string; at: string; emailed: boolean }[];
  createdAt: string;
  resolvedBy?: string;
  resolvedAt?: string;
}

const when = (iso?: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
};

export default function RetailSupportPage() {
  const { firestore } = useFirebase();
  const { selectedTenant } = useTenant();
  const tenantId = selectedTenant?.id || '';
  const { user } = useUser();
  const { toast } = useToast();

  const staffName = useMemo(() => user?.displayName || user?.email || 'Staff', [user]);

  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [claims, setClaims] = useState<any[]>([]);
  const [creditDraft, setCreditDraft] = useState<Record<string, string>>({});

  /* CREDIT IS THE OWNER'S MONEY. Staff can grant up to the owner-set cap
   * (retailSettings.staffCreditCapCents, default $25); managers and the
   * owner are uncapped and set the cap right here. The database rule is the
   * real enforcement — this mirror just makes the refusal friendly. */
  const staffRole = String((selectedTenant as any)?.staffMember?.role || 'owner').toLowerCase();
  const isMgr = ['owner', 'admin'].includes(staffRole);
  const capCents = Math.max(0, Number((selectedTenant as any)?.retailSettings?.staffCreditCapCents) || 2500);
  const [capDraft, setCapDraft] = useState('');
  const saveCap = async () => {
    if (!firestore || !tenantId || !isMgr) return;
    const dollars = Number(capDraft);
    if (!Number.isFinite(dollars) || dollars < 0) { toast({ variant: 'destructive', title: 'Enter a cap in dollars' }); return; }
    try {
      await updateDoc(doc(firestore as Firestore, 'tenants', tenantId), {
        'retailSettings.staffCreditCapCents': Math.round(dollars * 100),
      });
      setCapDraft('');
      toast({ title: `Staff credit cap set to $${dollars.toFixed(2)}` });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Could not save the cap', description: e?.message });
    }
  };
  const [flags, setFlags] = useState<Record<string, any>>({});
  const [flagOpen, setFlagOpen] = useState<string | null>(null);
  const [flagNote, setFlagNote] = useState('');
  const [flagKind, setFlagKind] = useState<'fraud' | 'abuse' | 'chargeback' | 'other'>('fraud');
  const [loading, setLoading] = useState(true);
  const [showResolved, setShowResolved] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const template = (t: SupportTicket, kind: 'ready' | 'sorry' | 'refund') => {
    const num = `#${String(t.orderNumber).padStart(4, '0')}`;
    const map = {
      ready: `Hi ${t.customerName.split(' ')[0]} — good news, order ${num} is ready for you. See the order page for pickup details, and just reply here if anything else comes up.`,
      sorry: `Hi ${t.customerName.split(' ')[0]} — so sorry about the trouble with order ${num}. We're on it right now and will make it right. You'll see any updates on your order page.`,
      refund: `Hi ${t.customerName.split(' ')[0]} — your refund for order ${num} is being processed now. Card refunds typically appear within 5–10 business days. Thanks for your patience!`,
    };
    setDrafts({ ...drafts, [t.id]: map[kind] });
  };

  const draftAI = async (t: SupportTicket) => {
    if (busy) return;
    setBusy(`ai-${t.id}`);
    try {
      const res = await fetch('/api/retail/support-draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, ticketId: t.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Draft failed');
      setDrafts({ ...drafts, [t.id]: data.draft });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'AI draft unavailable', description: e?.message });
    } finally {
      setBusy(null);
    }
  };

  const sendReply = async (t: SupportTicket, alsoResolve: boolean) => {
    const reply = (drafts[t.id] || '').trim();
    if (!reply || busy) return;
    setBusy(t.id);
    try {
      const res = await fetch('/api/retail/support-reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, ticketId: t.id, reply, resolve: alsoResolve, staffName }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not send');
      toast({ title: data.emailed ? 'Reply emailed to customer' : 'Reply saved', description: data.emailed ? undefined : data.message });
      setDrafts({ ...drafts, [t.id]: '' });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Reply failed', description: e?.message });
    } finally {
      setBusy(null);
    }
  };

  useEffect(() => {
    if (!firestore || !tenantId) return;
    const q = query(
      collection(firestore as Firestore, `tenants/${tenantId}/retailSupport`),
      where('status', '==', showResolved ? 'resolved' : 'open')
    );
    return onSnapshot(q, (snap: any) => {
      const list = snap.docs
        .map((d: any) => ({ ...(d.data() as SupportTicket), id: d.id as string }))
        .sort((a: SupportTicket, b: SupportTicket) => (b.createdAt || '').localeCompare(a.createdAt || ''));
      list.sort((a: SupportTicket, b: SupportTicket) =>
        (a.priority === 'urgent' ? 0 : 1) - (b.priority === 'urgent' ? 0 : 1) ||
        String(b.createdAt).localeCompare(String(a.createdAt)));
      setTickets(list);
      setLoading(false);
    });
  }, [firestore, tenantId, showResolved]);

  /* CLAIMS IN THE SAME INBOX. One front door for "the customer needs
   * something": claims (missing / damaged / wrong item / never arrived)
   * appear alongside tickets with the same urgency treatment — decisions
   * still happen on the claims desk, which keeps its evidence and appeal
   * machinery; this list makes sure nothing waits unseen in a second queue. */
  useEffect(() => {
    if (!firestore || !tenantId) return;
    return onSnapshot(collection(firestore as Firestore, `tenants/${tenantId}/retailClaims`), (snap: any) => {
      setClaims(snap.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) })));
    });
  }, [firestore, tenantId]);

  /* THE FLAG BOARD. Internal-only, keyed by customer email: 'watch' informs
   * every ticket the person touches, 'banned' also refuses their checkout.
   * Notes are the institutional memory — the next staffer sees what happened
   * and how it was handled, before they type a word. Nothing here is ever
   * shown to the customer; the AI draft is coached by it but forbidden from
   * referencing it. */
  useEffect(() => {
    if (!firestore || !tenantId) return;
    return onSnapshot(collection(firestore as Firestore, `tenants/${tenantId}/customerFlags`), (snap: any) => {
      const map: Record<string, any> = {};
      snap.docs.forEach((d: any) => {
        const f = { id: d.id, ...(d.data() as any) };
        if (f.email) map[String(f.email).toLowerCase()] = f;
      });
      setFlags(map);
    });
  }, [firestore, tenantId]);

  const flagFor = (email?: string) => (email ? flags[email.toLowerCase().trim()] : undefined);

  const saveFlag = async (t: SupportTicket, level: 'watch' | 'banned') => {
    if (!firestore || !tenantId || busy) return;
    if (!t.customerEmail) { toast({ variant: 'destructive', title: 'No email on this order' }); return; }
    if (!flagNote.trim()) { toast({ variant: 'destructive', title: 'Write the note first', description: 'The note is what protects the next staffer.' }); return; }
    setBusy(`flag-${t.id}`);
    try {
      const email = t.customerEmail.toLowerCase().trim();
      const existing = flags[email];
      const reason = { at: new Date().toISOString(), by: staffName.split(' ')[0], kind: flagKind, note: flagNote.trim().slice(0, 400), orderId: t.orderId };
      if (existing?.id) {
        await updateDoc(doc(firestore as Firestore, `tenants/${tenantId}/customerFlags`, existing.id), {
          level, updatedAt: new Date().toISOString(),
          reasons: [...(existing.reasons || []), reason],
        });
      } else {
        await addDoc(collection(firestore as Firestore, `tenants/${tenantId}/customerFlags`), {
          tenantId, email, name: t.customerName || '',
          level, reasons: [reason],
          createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        });
      }
      setFlagOpen(null); setFlagNote('');
      toast({ title: level === 'banned' ? 'Customer banned from online checkout' : 'Watch flag saved', description: 'Internal only — the customer sees nothing.' });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Could not save the flag', description: e?.message });
    } finally { setBusy(null); }
  };

  const clearFlag = async (email: string) => {
    if (!firestore || !tenantId || busy) return;
    const f = flags[email.toLowerCase().trim()];
    if (!f?.id) return;
    setBusy(`flag-clear-${f.id}`);
    try {
      await updateDoc(doc(firestore as Firestore, `tenants/${tenantId}/customerFlags`, f.id), {
        level: 'watch', updatedAt: new Date().toISOString(),
      });
      toast({ title: 'Downgraded to watch', description: 'Delete history is deliberate — notes stay.' });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Could not update', description: e?.message });
    } finally { setBusy(null); }
  };

  const visibleClaims = useMemo(() => {
    const open = ['in_review'];
    return claims
      .filter((c) => (showResolved ? !open.includes(String(c.status)) : open.includes(String(c.status))))
      .sort((a, b) => String(b.openedAt || '').localeCompare(String(a.openedAt || '')));
  }, [claims, showResolved]);

  /* Load headline: the same honest clock the customer is quoted. */
  const loadNote = useMemo(() => {
    const n = tickets.filter((t) => t.status === 'open').length + visibleClaims.filter((c) => c.status === 'in_review').length;
    if (showResolved) return null;
    if (n >= 15) return `${n} waiting — customers are being told 1–2 days`;
    if (n >= 5) return `${n} waiting — customers are being told within a day`;
    return n > 0 ? `${n} waiting — customers are being told a few hours` : null;
  }, [tickets, visibleClaims, showResolved]);

  /* ISSUE CREDIT WITHOUT LEAVING THE TICKET. Writes the same depositCredits
   * doc the returns desk writes, fires the same grant email (with balance),
   * and prefills the reply so the customer hears it in both channels. */
  const issueCredit = async (t: SupportTicket) => {
    if (!firestore || !tenantId || busy) return;
    const dollars = Number(creditDraft[t.id]);
    if (!Number.isFinite(dollars) || dollars <= 0 || dollars > 5000) {
      toast({ variant: 'destructive', title: 'Enter a credit amount first' });
      return;
    }
    if (!isMgr && Math.round(dollars * 100) > capCents) {
      toast({
        variant: 'destructive',
        title: `Above your limit — $${(capCents / 100).toFixed(2)} max`,
        description: 'Larger credits are the owner\u2019s call. Draft your reply and flag a manager, or ask them to issue it.',
      });
      return;
    }
    if (!t.customerEmail) {
      toast({ variant: 'destructive', title: 'No email on this order', description: 'Store credit is keyed to the customer email — this order has none.' });
      return;
    }
    setBusy(`credit-${t.id}`);
    try {
      const cents = Math.round(dollars * 100);
      const ref = await addDoc(collection(firestore as Firestore, `tenants/${tenantId}/depositCredits`), {
        tenantId,
        clientEmail: t.customerEmail.toLowerCase().trim(),
        clientName: t.customerName || 'Guest',
        amountCents: cents, status: 'available',
        sourceSupportTicketId: t.id,
        createdAt: new Date().toISOString(),
      });
      void fetch('/api/retail/credit-notify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, creditId: ref.id }),
      }).catch(() => undefined);
      setCreditDraft({ ...creditDraft, [t.id]: '' });
      setDrafts({
        ...drafts,
        [t.id]: `Hi ${t.customerName.split(' ')[0]} — I've added $${dollars.toFixed(2)} in store credit to your account for the trouble. It's tied to this email and applies right at checkout. Thank you for your patience with us!`,
      });
      toast({ title: `$${dollars.toFixed(2)} credit issued`, description: 'The customer gets the balance email — a reply is drafted below.' });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Could not issue credit', description: e?.message });
    } finally {
      setBusy(null);
    }
  };

  const copy = (text: string, label: string) => {
    navigator.clipboard?.writeText(text)
      .then(() => toast({ title: `${label} copied` }))
      .catch(() => toast({ variant: 'destructive', title: 'Could not copy' }));
  };

  const resolve = async (t: SupportTicket) => {
    if (!firestore || !tenantId || busy) return;
    setBusy(t.id);
    try {
      await updateDoc(doc(firestore as Firestore, `tenants/${tenantId}/retailSupport`, t.id), {
        status: 'resolved', resolvedBy: staffName, resolvedAt: new Date().toISOString(),
      });
      toast({ title: `#${t.orderNumber} request resolved` });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Could not resolve', description: e?.message });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="min-h-dvh bg-muted/5 pb-24">
      <header className="sticky top-0 z-30 bg-white/90 backdrop-blur border-b-2">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center gap-3">
          <Button asChild variant="ghost" size="icon" className="h-10 w-10 rounded-xl">
            <Link href="/retail-orders"><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <div className="flex-1 min-w-0">
            <h1 className="font-black uppercase tracking-tighter text-xl leading-none">Shop Support</h1>
            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mt-0.5">
              {loadNote || `${tickets.length + visibleClaims.length} ${showResolved ? 'closed' : 'open'}`}
            </p>
          </div>
          {isMgr && (
            <span className="hidden items-center gap-1.5 md:flex">
              <span className="text-[8px] font-black uppercase tracking-widest text-muted-foreground">Staff credit cap $</span>
              <input
                inputMode="decimal"
                aria-label="Staff store-credit cap in dollars"
                placeholder={(capCents / 100).toFixed(2)}
                value={capDraft}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCapDraft(e.target.value.replace(/[^0-9.]/g, ''))}
                className="h-8 w-16 rounded-lg border-2 bg-white px-1.5 text-center font-mono text-[11px] font-bold outline-none focus:border-foreground/60"
              />
              <button type="button" onClick={() => void saveCap()} disabled={!capDraft}
                className="h-8 rounded-lg border-2 px-2 text-[8px] font-black uppercase tracking-widest transition-all hover:border-primary/40 disabled:opacity-40">
                Set
              </button>
            </span>
          )}
          <button type="button" onClick={() => setShowResolved(!showResolved)}
            className={cn('h-9 px-4 rounded-full border-2 text-[9px] font-black uppercase tracking-widest transition-all',
              showResolved ? 'bg-foreground text-background border-foreground' : 'bg-white hover:border-primary/40')}>
            {showResolved ? 'Showing resolved' : 'Show resolved'}
          </button>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6 space-y-3">
        {loading && <div className="py-24 text-center"><Loader className="w-7 h-7 mx-auto animate-spin text-primary" /></div>}
        {!loading && tickets.length === 0 && (
          <div className="rounded-2xl border-2 border-dashed py-20 text-center space-y-2">
            <Inbox className="w-8 h-8 mx-auto opacity-20" />
            <p className="text-[10px] font-black uppercase tracking-widest opacity-30">
              {showResolved ? 'Nothing resolved yet' : 'No open requests — all clear'}
            </p>
          </div>
        )}
        {tickets.map((t) => (
          <Card key={t.id} className={cn('border-2 rounded-[2rem] overflow-hidden bg-white', t.priority === 'urgent' && t.status === 'open' && 'border-destructive/50')}>
            <CardContent className="p-5 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <LifeBuoy className="w-4 h-4 text-primary shrink-0" />
                    <p className="font-black uppercase tracking-tight text-sm">
                      #{String(t.orderNumber).padStart(4, '0')} · {t.customerName}
                    </p>
                  </div>
                  <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground mt-0.5">
                    {t.caseRef ? `Case #${t.caseRef} · ` : ''}{when(t.createdAt)} · order was {t.stageAtRequest}
                    {t.resolvedBy ? ` · resolved by ${t.resolvedBy}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {t.priority === 'urgent' && t.status === 'open' && (
                    <Badge className="h-6 px-2.5 bg-destructive text-destructive-foreground font-black text-[8px] uppercase tracking-widest animate-pulse">
                      Urgent
                    </Badge>
                  )}
                  <Badge variant="outline" className={cn('h-6 px-2.5 font-black text-[8px] uppercase tracking-widest border-2',
                    t.status === 'open' ? 'bg-amber-50 border-amber-100 text-amber-700' : 'bg-green-50 border-green-100 text-green-700')}>
                    {t.status}
                  </Badge>
                </div>
              </div>
              {(() => {
                const f = flagFor(t.customerEmail);
                if (!f) return null;
                const last = (f.reasons || [])[Math.max(0, (f.reasons || []).length - 1)];
                return (
                  <div className={cn('flex items-start gap-2 rounded-2xl border-2 p-3',
                    f.level === 'banned' ? 'border-destructive/60 bg-destructive/5' : 'border-amber-400/60 bg-amber-500/5')}>
                    <ShieldAlert className={cn('mt-0.5 h-4 w-4 shrink-0', f.level === 'banned' ? 'text-destructive' : 'text-amber-600')} />
                    <div className="min-w-0">
                      <p className={cn('text-[9px] font-black uppercase tracking-widest', f.level === 'banned' ? 'text-destructive' : 'text-amber-700')}>
                        {f.level === 'banned' ? 'Banned from online checkout' : 'On watch'} · {(f.reasons || []).length} note{(f.reasons || []).length === 1 ? '' : 's'} · internal only
                      </p>
                      {last && (
                        <p className="mt-0.5 text-[11px] font-bold text-muted-foreground">
                          {last.by} · {String(last.kind).replace('_', ' ')}: {last.note}
                        </p>
                      )}
                      {f.level === 'banned' && (
                        <button type="button" onClick={() => clearFlag(t.customerEmail)}
                          className="mt-1 text-[9px] font-black uppercase tracking-widest text-muted-foreground underline-offset-4 hover:underline">
                          Downgrade to watch
                        </button>
                      )}
                    </div>
                  </div>
                );
              })()}
              <p className="text-sm font-bold text-muted-foreground leading-relaxed rounded-2xl border-2 border-dashed p-3">
                {t.message}
              </p>
              {(t.photoUrls || []).length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {(t.photoUrls || []).map((u, i) => (
                    <a key={i} href={u} target="_blank" rel="noreferrer" className="block">
                      <img src={u} alt={`Customer photo ${i + 1}`} className="h-20 w-20 rounded-xl border-2 object-cover" />
                    </a>
                  ))}
                </div>
              )}
              {/* SATURATION, NOT SPAM. Follow-ups landed on this case instead
                  of becoming new tickets; the chip is the consolidated truth —
                  "3 follow-ups, nothing new" reads in one glance — and the
                  messages sit inline with evidence marked apart from chasers. */}
              {(t.customerMessagesSinceStaffReply || 0) > 0 && t.status === 'open' && (
                <p className="rounded-xl border-2 border-amber-300 bg-amber-50 px-2.5 py-1.5 text-[9px] font-black uppercase tracking-widest text-amber-700">
                  {t.customerMessagesSinceStaffReply} follow-up{(t.customerMessagesSinceStaffReply || 0) === 1 ? '' : 's'} since your last reply
                  {(t.followUps || []).slice(-(t.customerMessagesSinceStaffReply || 0)).every((f) => f.kind === 'chaser') ? ' — no new info, just waiting' : ' — includes new evidence'}
                </p>
              )}
              {(t.followUps || []).length > 0 && (
                <div className="space-y-1.5 rounded-2xl border-2 border-dashed p-2.5">
                  {(t.followUps || []).slice(-6).map((f, i) => (
                    <div key={i} className="space-y-1">
                      <p className="text-sm font-bold text-muted-foreground leading-snug">
                        <span className={cn('mr-1.5 rounded-full border px-1.5 py-0.5 text-[7px] font-black uppercase tracking-widest align-middle',
                          f.kind === 'evidence' ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-slate-200 bg-slate-50 text-slate-500')}>
                          {f.kind === 'evidence' ? 'New info' : 'Follow-up'}
                        </span>
                        {f.message}
                      </p>
                      {(f.photoUrls || []).length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {(f.photoUrls || []).map((u, k) => (
                            <a key={k} href={u} target="_blank" rel="noreferrer">
                              <img src={u} alt={`Follow-up photo ${k + 1}`} className="h-16 w-16 rounded-lg border-2 object-cover" />
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {t.autoReply && (
                <div className="rounded-2xl border-2 border-primary/20 bg-primary/[0.03] p-3">
                  <p className="text-[8px] font-black uppercase tracking-widest text-primary mb-1">Auto-answered instantly by email</p>
                  <p className="text-xs font-bold text-muted-foreground leading-relaxed">{t.autoReply}</p>
                </div>
              )}
              {(t.replies || []).map((r, i) => (
                <div key={i} className="rounded-2xl border-2 p-3">
                  <p className="text-[8px] font-black uppercase tracking-widest text-muted-foreground mb-1">
                    {r.by} · {when(r.at)}{r.emailed ? ' · emailed' : ''}
                  </p>
                  <p className="text-xs font-bold leading-relaxed whitespace-pre-wrap">{r.text}</p>
                </div>
              ))}
              {t.status === 'open' && (
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-1.5">
                    <button type="button" disabled={busy === `ai-${t.id}`} onClick={() => draftAI(t)}
                      className="h-7 px-3 rounded-full border-2 border-primary/40 text-primary text-[8px] font-black uppercase tracking-widest bg-primary/5 hover:border-primary transition-all disabled:opacity-50">
                      {busy === `ai-${t.id}` ? 'Drafting\u2026' : '\u2728 Draft with AI'}
                    </button>
                    {([['ready', 'It\u2019s ready'], ['sorry', 'Apology'], ['refund', 'Refund info']] as const).map(([k, label]) => (
                      <button key={k} type="button" onClick={() => template(t, k)}
                        className="h-7 px-3 rounded-full border-2 text-[8px] font-black uppercase tracking-widest bg-white hover:border-primary/40 transition-all">
                        {label}
                      </button>
                    ))}
                  </div>
                  <Textarea
                    placeholder="Reply to the customer — sent straight to their email…"
                    value={drafts[t.id] || ''}
                    onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setDrafts({ ...drafts, [t.id]: e.target.value })}
                    className="rounded-2xl border-2 min-h-[70px] font-bold text-sm"
                  />
                  <div className="flex gap-2">
                    <Button size="sm" disabled={!(drafts[t.id] || '').trim() || busy === t.id}
                      onClick={() => sendReply(t, false)}
                      variant="outline"
                      className="h-9 flex-1 rounded-xl border-2 font-black uppercase text-[9px] tracking-widest">
                      Send reply
                    </Button>
                    <Button size="sm" disabled={!(drafts[t.id] || '').trim() || busy === t.id}
                      onClick={() => sendReply(t, true)}
                      className="h-9 flex-1 rounded-xl font-black uppercase text-[9px] tracking-widest">
                      Send &amp; resolve
                    </Button>
                  </div>
                </div>
              )}
              {t.status === 'open' && (
                <div className="flex items-center gap-2 rounded-2xl border-2 border-dashed p-2">
                  <Coins className="ml-1 h-4 w-4 shrink-0 text-primary" />
                  <span className="text-sm font-black">$</span>
                  <input
                    inputMode="decimal"
                    aria-label="Store credit amount in dollars"
                    placeholder="10.00"
                    value={creditDraft[t.id] || ''}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCreditDraft({ ...creditDraft, [t.id]: e.target.value.replace(/[^0-9.]/g, '') })}
                    className="h-9 w-24 rounded-xl border-2 bg-white px-2 text-center font-mono text-sm font-bold outline-none focus:border-foreground/60"
                  />
                  <Button size="sm" disabled={busy === `credit-${t.id}` || !(Number(creditDraft[t.id]) > 0)}
                    onClick={() => issueCredit(t)}
                    variant="outline"
                    className="h-9 rounded-xl border-2 font-black uppercase text-[9px] tracking-widest">
                    {busy === `credit-${t.id}` ? <Loader className="h-3.5 w-3.5 animate-spin" /> : 'Issue store credit'}
                  </Button>
                  <span className="hidden text-[9px] font-bold text-muted-foreground sm:block">
                    {isMgr ? 'balance email sends itself · reply drafts below' : `your limit: $${(capCents / 100).toFixed(2)} · balance email sends itself`}
                  </span>
                </div>
              )}
              {flagOpen === t.id && (
                <div className="space-y-2 rounded-2xl border-2 border-amber-400/50 bg-amber-500/5 p-3">
                  <p className="text-[9px] font-black uppercase tracking-widest text-amber-700">
                    Internal flag — the customer never sees this. The note is for the next staffer.
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {(['fraud', 'abuse', 'chargeback', 'other'] as const).map((k) => (
                      <button key={k} type="button" aria-pressed={flagKind === k}
                        onClick={() => setFlagKind(k)}
                        className={cn('h-7 px-3 rounded-full border-2 text-[8px] font-black uppercase tracking-widest transition-all',
                          flagKind === k ? 'bg-foreground text-background border-foreground' : 'bg-white')}>
                        {k}
                      </button>
                    ))}
                  </div>
                  <Textarea
                    placeholder="What happened, and how was it handled? e.g. Claimed package never arrived; tracking shows delivered + signed. Second attempt this month."
                    value={flagNote}
                    onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setFlagNote(e.target.value)}
                    className="rounded-2xl border-2 min-h-[60px] font-bold text-sm bg-white"
                  />
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" disabled={busy === `flag-${t.id}` || !flagNote.trim()}
                      onClick={() => saveFlag(t, 'watch')}
                      className="h-9 flex-1 rounded-xl border-2 font-black uppercase text-[9px] tracking-widest">
                      Watch — inform staff
                    </Button>
                    <Button size="sm" variant="destructive" disabled={busy === `flag-${t.id}` || !flagNote.trim()}
                      onClick={() => saveFlag(t, 'banned')}
                      className="h-9 flex-1 rounded-xl font-black uppercase text-[9px] tracking-widest">
                      Ban from checkout
                    </Button>
                  </div>
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <Button asChild variant="outline" size="sm" className="h-9 rounded-xl border-2 font-black uppercase text-[9px] tracking-widest">
                  <Link href={`/retail-orders/evidence/${t.orderId}`}>Evidence</Link>
                </Button>
                <Button asChild variant="outline" size="sm" className="h-9 rounded-xl border-2 font-black uppercase text-[9px] tracking-widest">
                  <Link href="/retail-orders/history">Open in history</Link>
                </Button>
                {t.customerEmail && (
                  <Button variant="outline" size="sm" className="h-9 rounded-xl border-2 font-black uppercase text-[9px] tracking-widest"
                    onClick={() => copy(t.customerEmail, 'Email')}>
                    <ClipboardCopy className="mr-1.5 h-3.5 w-3.5" /> Email
                  </Button>
                )}
                {t.customerPhone && (
                  <Button variant="outline" size="sm" className="h-9 rounded-xl border-2 font-black uppercase text-[9px] tracking-widest"
                    onClick={() => copy(t.customerPhone, 'Phone')}>
                    Phone
                  </Button>
                )}
                <Button variant="outline" size="sm" className="h-9 rounded-xl border-2 font-black uppercase text-[9px] tracking-widest"
                  onClick={() => copy(`${window.location.origin}/shop/${tenantId}/order/${t.orderId}`, 'Tracking link')}>
                  Tracking link
                </Button>
                {t.customerEmail && (
                  <Button variant="outline" size="sm"
                    className={cn('h-9 rounded-xl border-2 font-black uppercase text-[9px] tracking-widest',
                      flagFor(t.customerEmail) && 'border-amber-400/60 text-amber-700')}
                    onClick={() => { setFlagOpen(flagOpen === t.id ? null : t.id); setFlagNote(''); }}>
                    <Flag className="mr-1.5 h-3.5 w-3.5" /> {flagFor(t.customerEmail) ? 'Add note' : 'Flag customer'}
                  </Button>
                )}
                {t.status === 'open' && (
                  <Button size="sm" disabled={busy === t.id} onClick={() => resolve(t)}
                    className="h-9 rounded-xl font-black uppercase text-[9px] tracking-widest ml-auto">
                    <Check className="mr-1.5 h-3.5 w-3.5" /> Resolve
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
        {visibleClaims.map((c) => (
          <Card key={c.id} className={cn('border-2 rounded-[2rem] overflow-hidden bg-white', c.status === 'in_review' && 'border-amber-400/60')}>
            <CardContent className="p-5 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Scale className="w-4 h-4 text-amber-600 shrink-0" />
                    <p className="font-black uppercase tracking-tight text-sm">
                      #{String(c.orderNumber ?? '').padStart(4, '0')} · {c.customerName || 'Guest'}
                    </p>
                  </div>
                  <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground mt-0.5">
                    {when(c.openedAt)} · claim · {String(c.type || 'issue').replace('_', ' ')}{c.lineName ? ` · ${c.lineName}` : ''}
                  </p>
                </div>
                <Badge variant="outline" className={cn('h-6 px-2.5 font-black text-[8px] uppercase tracking-widest border-2 shrink-0',
                  c.status === 'in_review' ? 'bg-amber-50 border-amber-100 text-amber-700' : 'bg-green-50 border-green-100 text-green-700')}>
                  {String(c.status || '').replace('_', ' ')}
                </Badge>
              </div>
              {c.description && (
                <p className="text-sm font-bold text-muted-foreground leading-relaxed rounded-2xl border-2 border-dashed p-3">{c.description}</p>
              )}
              {(c.photoUrls || []).length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {(c.photoUrls || []).slice(0, 4).map((u: string, i: number) => (
                    <a key={i} href={u} target="_blank" rel="noreferrer" className="block">
                      <img src={u} alt={`Claim photo ${i + 1}`} className="h-20 w-20 rounded-xl border-2 object-cover" />
                    </a>
                  ))}
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <Button asChild size="sm" className="h-9 rounded-xl font-black uppercase text-[9px] tracking-widest">
                  <Link href="/retail-orders/claims">Decide on the claims desk</Link>
                </Button>
                <Button asChild variant="outline" size="sm" className="h-9 rounded-xl border-2 font-black uppercase text-[9px] tracking-widest">
                  <Link href={`/retail-orders/evidence/${c.orderId}`}>Evidence</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </main>
    </div>
  );
}
