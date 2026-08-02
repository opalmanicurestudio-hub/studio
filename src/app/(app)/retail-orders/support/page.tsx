'use client';

import {
  collection, doc, onSnapshot, query, updateDoc, where, type Firestore,
} from 'firebase/firestore';
import { ArrowLeft, Check, ClipboardCopy, Inbox, LifeBuoy, Loader } from 'lucide-react';
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
  autoReply?: string;
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
      setTickets(list);
      setLoading(false);
    });
  }, [firestore, tenantId, showResolved]);

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
              {tickets.length} {showResolved ? 'resolved' : 'open'}
            </p>
          </div>
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
          <Card key={t.id} className="border-2 rounded-[2rem] overflow-hidden bg-white">
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
                    {when(t.createdAt)} · order was {t.stageAtRequest}
                    {t.resolvedBy ? ` · resolved by ${t.resolvedBy}` : ''}
                  </p>
                </div>
                <Badge variant="outline" className={cn('h-6 px-2.5 font-black text-[8px] uppercase tracking-widest border-2 shrink-0',
                  t.status === 'open' ? 'bg-amber-50 border-amber-100 text-amber-700' : 'bg-green-50 border-green-100 text-green-700')}>
                  {t.status}
                </Badge>
              </div>
              <p className="text-sm font-bold text-muted-foreground leading-relaxed rounded-2xl border-2 border-dashed p-3">
                {t.message}
              </p>
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
              <div className="flex flex-wrap gap-2">
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
      </main>
    </div>
  );
}
