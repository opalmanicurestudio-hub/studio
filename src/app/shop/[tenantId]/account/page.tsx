'use client';

import {
  ArrowLeft, Car, CircleUserRound, Loader, LogOut, Mail, Package, RefreshCw, Store, Truck, Wallet,
} from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import React, { Suspense, useCallback, useEffect, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

// ─── /shop/[tenantId]/account ─────────────────────────────────────────────────
// The customer's home: every order for their email with live stages, plus
// their store-credit balance. Passwordless — a signed link (from the magic
// email or one tap on any order page) IS the session, stored per tenant so
// return visits go straight in. Signed-out visitors get the email form and
// the "open any order confirmation" tip, and the response to the email form
// never reveals whether an address has orders here.

interface AccountOrder {
  id: string;
  orderNumber: number;
  stage: string;
  stageLabel: string;
  active: boolean;
  method: string;
  totalCents: number;
  placedAt: string;
  itemCount: number;
}

interface Session { e: string; x: number; s: string; }

const fmt = (cents: number) =>
  ((cents || 0) / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

const when = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

const sessionKey = (tid: string) => `cfshop-acct-${tid}`;

function readSession(tid: string): Session | null {
  try {
    const raw = localStorage.getItem(sessionKey(tid));
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s?.e || !s?.x || !s?.s || Date.now() > s.x) return null;
    return s;
  } catch { return null; }
}

function AccountInner() {
  const params = useParams<{ tenantId: string }>();
  const tenantId = String(params?.tenantId || '');
  const search = useSearchParams();
  const router = useRouter();
  const { toast } = useToast();

  const [session, setSession] = useState<Session | null>(null);
  const [checkedStorage, setCheckedStorage] = useState(false);
  const [orders, setOrders] = useState<AccountOrder[]>([]);
  const [creditCents, setCreditCents] = useState(0);
  const [loading, setLoading] = useState(false);
  const [emailInput, setEmailInput] = useState('');
  const [requesting, setRequesting] = useState(false);
  const [requested, setRequested] = useState(false);

  useEffect(() => {
    if (!tenantId) return;
    const e = search?.get('e'); const x = Number(search?.get('x')); const s = search?.get('s');
    if (e && s && Number.isFinite(x)) {
      const fresh: Session = { e, x, s };
      try { localStorage.setItem(sessionKey(tenantId), JSON.stringify(fresh)); } catch { /* noop */ }
      setSession(fresh);
      router.replace(`/shop/${tenantId}/account`);
    } else {
      setSession(readSession(tenantId));
    }
    setCheckedStorage(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  const load = useCallback(async (s: Session) => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ tenantId, e: s.e, x: String(s.x), s: s.s });
      const res = await fetch(`/api/retail/account/orders?${qs.toString()}`);
      const data = await res.json();
      if (!res.ok) {
        try { localStorage.removeItem(sessionKey(tenantId)); } catch { /* noop */ }
        setSession(null);
        toast({ variant: 'destructive', title: 'Session expired', description: data.error || 'Request a fresh link below.' });
        return;
      }
      setOrders(data.orders || []);
      setCreditCents(data.creditCents || 0);
    } finally {
      setLoading(false);
    }
  }, [tenantId, toast]);

  useEffect(() => {
    if (session) load(session);
  }, [session, load]);

  const requestLink = async () => {
    if (!emailInput.trim() || requesting) return;
    setRequesting(true);
    try {
      const res = await fetch('/api/retail/account/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, email: emailInput.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not send');
      setRequested(true);
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Could not send', description: e?.message });
    } finally {
      setRequesting(false);
    }
  };

  const signOut = () => {
    try { localStorage.removeItem(sessionKey(tenantId)); } catch { /* noop */ }
    setSession(null);
    setOrders([]);
    setCreditCents(0);
  };

  const methodIcon = (m: string) => (m === 'curbside' ? Car : m === 'ship' ? Truck : Store);

  return (
    <div className="min-h-dvh bg-muted/5 pb-24">
      <header className="sticky top-0 z-30 bg-white/90 backdrop-blur border-b-2">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center gap-3">
          <Button asChild variant="ghost" size="icon" aria-label="Back to shop" className="h-10 w-10 rounded-xl">
            <Link href={`/shop/${tenantId}`}><ArrowLeft className="h-4 w-4" aria-hidden="true" /></Link>
          </Button>
          <div className="flex-1 min-w-0">
            <h1 className="font-black uppercase tracking-tighter text-xl leading-none">My Orders</h1>
            {session && (
              <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mt-0.5 truncate">{session.e}</p>
            )}
          </div>
          {session && (
            <>
              <Button variant="ghost" size="icon" aria-label="Refresh orders" className="h-10 w-10 rounded-xl" disabled={loading} onClick={() => load(session)}>
                <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} aria-hidden="true" />
              </Button>
              <Button variant="ghost" size="icon" aria-label="Sign out" className="h-10 w-10 rounded-xl text-muted-foreground" onClick={signOut}>
                <LogOut className="h-4 w-4" aria-hidden="true" />
              </Button>
            </>
          )}
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        {!checkedStorage ? (
          <div className="py-24 text-center"><Loader className="w-7 h-7 mx-auto animate-spin text-primary" /></div>
        ) : !session ? (
          <Card className="border-2 rounded-[2.5rem] overflow-hidden bg-white">
            <CardContent className="p-8 space-y-5 text-center">
              <div className="w-16 h-16 mx-auto rounded-2xl border-2 bg-primary/5 flex items-center justify-center">
                <CircleUserRound className="w-7 h-7 text-primary" />
              </div>
              <div className="space-y-1">
                <p className="font-black uppercase tracking-tighter text-xl">See all your orders</p>
                <p className="text-sm font-bold text-muted-foreground">
                  No passwords here — we email you a secure link.
                </p>
              </div>
              {requested ? (
                <div className="rounded-2xl border-2 border-primary/30 bg-primary/5 p-4">
                  <p className="text-sm font-bold text-primary">
                    If that email has orders here, a sign-in link is on its way. Check your inbox.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  <Input type="email" placeholder="you@example.com" aria-label="Email address" autoComplete="email" value={emailInput}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmailInput(e.target.value)}
                    className="h-12 rounded-xl border-2 font-bold text-sm text-center" />
                  <Button disabled={!emailInput.trim() || requesting} onClick={requestLink}
                    className="w-full h-12 rounded-2xl font-black uppercase text-[10px] tracking-widest shadow-lg shadow-primary/20">
                    {requesting ? <Loader className="h-4 w-4 animate-spin" /> : (<><Mail className="mr-1.5 h-4 w-4" /> Email me a sign-in link</>)}
                  </Button>
                </div>
              )}
              <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/50 leading-relaxed">
                Even faster: open any order confirmation and tap &ldquo;View all my orders&rdquo;
              </p>
            </CardContent>
          </Card>
        ) : (
          <>
            {creditCents > 0 && (
              <Card className="border-2 border-primary rounded-[2rem] overflow-hidden bg-primary text-primary-foreground">
                <CardContent className="p-5 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-primary-foreground/15 flex items-center justify-center">
                      <Wallet className="w-4 h-4" />
                    </div>
                    <div>
                      <p className="text-[9px] font-black uppercase tracking-widest opacity-80">Store credit</p>
                      <p className="font-black font-mono text-xl leading-none">{fmt(creditCents)}</p>
                    </div>
                  </div>
                  <p className="text-[9px] font-black uppercase tracking-widest opacity-80 text-right max-w-[140px]">
                    Redeemable in store at checkout
                  </p>
                </CardContent>
              </Card>
            )}

            {loading && orders.length === 0 && (
              <div className="py-20 text-center"><Loader className="w-7 h-7 mx-auto animate-spin text-primary" /></div>
            )}
            {!loading && orders.length === 0 && (
              <div className="rounded-2xl border-2 border-dashed py-20 text-center space-y-3">
                <Package className="w-8 h-8 mx-auto opacity-20" />
                <p className="text-[10px] font-black uppercase tracking-widest opacity-30">No orders yet</p>
                <Button asChild variant="outline" className="rounded-xl border-2 font-black uppercase text-[10px] tracking-widest">
                  <Link href={`/shop/${tenantId}`}>Start shopping</Link>
                </Button>
              </div>
            )}

            <div className="space-y-2.5">
              {orders.map((o) => {
                const Icon = methodIcon(o.method);
                return (
                  <Link key={o.id} href={`/shop/${tenantId}/order/${o.id}`} className="block">
                    <Card className={cn('border-2 rounded-2xl overflow-hidden bg-white hover:border-primary/40 transition-all',
                      o.active && 'border-primary/30')}>
                      <CardContent className="p-4 flex items-center gap-3">
                        <div className={cn('w-10 h-10 rounded-xl border-2 flex items-center justify-center shrink-0',
                          o.active ? 'bg-primary/5 border-primary/20' : 'bg-muted/10')}>
                          <Icon className={cn('w-4 h-4', o.active ? 'text-primary' : 'text-muted-foreground')} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="font-black uppercase tracking-tight text-sm">#{String(o.orderNumber).padStart(4, '0')}</p>
                          <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
                            {when(o.placedAt)} · {o.itemCount} item{o.itemCount === 1 ? '' : 's'}
                          </p>
                        </div>
                        <div className="text-right shrink-0 space-y-1">
                          <Badge variant="outline" className={cn('h-6 px-2.5 font-black text-[8px] uppercase tracking-widest border-2',
                            o.active ? 'bg-primary/5 border-primary/20 text-primary' : 'bg-muted/20 text-muted-foreground')}>
                            {o.stageLabel}
                          </Badge>
                          <p className="font-black font-mono text-xs">{fmt(o.totalCents)}</p>
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                );
              })}
            </div>
          </>
        )}
      </main>
    </div>
  );
}

export default function AccountPage() {
  return (
    <Suspense fallback={<div className="min-h-dvh flex items-center justify-center bg-muted/5"><Loader className="w-8 h-8 animate-spin text-primary" /></div>}>
      <AccountInner />
    </Suspense>
  );
}
