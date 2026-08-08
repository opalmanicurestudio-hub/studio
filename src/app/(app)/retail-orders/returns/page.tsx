'use client';

import { collection, doc, getDoc, onSnapshot, query, where, type Firestore } from 'firebase/firestore';
import {
  ArrowLeft, Check, Loader, PackageX, QrCode, RotateCcw, ScanLine, Undo2,
} from 'lucide-react';
import Link from 'next/link';
import React, { useCallback, useEffect, useMemo, useState } from 'react';

import { ScanGate, scanFeedback } from '@/components/retail/ScanGate';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useTenant } from '@/context/TenantContext';
import { useFirebase, useUser } from '@/firebase';
import { useToast } from '@/hooks/use-toast';
import {
  RETURN_REASONS, codesMatch, type OrderLine, type RetailOrder, type RetailReturn,
  type ReturnReason, type ReturnResolution,
} from '@/lib/retail-orders';
import {
  findReturnableOrder, openReturn, receiveReturnLine, resolveReturn,
  type Actor, type ReturnableOrder, type ReturnDoc, type ReturnSelection,
} from '@/lib/retail-returns';
import { cn } from '@/lib/utils';

// ─── Returns / RMA ────────────────────────────────────────────────────────────
// Two panels: open a return (scan the customer's pickup QR or type the order
// number), and receive open returns (scan each item, choose restock or
// write-off — resolve stays locked until every line has a disposition).

const fmt = (cents: number) =>
  (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

const REASON_LABELS: Record<ReturnReason, string> = {
  damaged_in_transit: 'Damaged in transit',
  defective: 'Defective',
  wrong_item: 'Wrong item',
  changed_mind: 'Changed mind',
  other: 'Other',
};

export default function RetailReturnsPage() {
  const { firestore } = useFirebase();
  const { selectedTenant } = useTenant();
  const tenantId = selectedTenant?.id || '';
  const { user } = useUser();
  const { toast } = useToast();

  const actor: Actor = useMemo(
    () => ({ id: user?.uid || 'staff', name: user?.displayName || user?.email || 'Staff' }),
    [user]
  );

  const [lookupOpen, setLookupOpen] = useState(false);
  const [lookupKey, setLookupKey] = useState('');
  const [lookingUp, setLookingUp] = useState(false);
  const [target, setTarget] = useState<ReturnableOrder | null>(null);
  const [qtys, setQtys] = useState<Record<string, number>>({});
  const [reasons, setReasons] = useState<Record<string, ReturnReason>>({});
  const [resolution, setResolution] = useState<ReturnResolution>('refund');
  const [notes, setNotes] = useState('');
  const [opening, setOpening] = useState(false);

  const [returns, setReturns] = useState<ReturnDoc[]>([]);
  const [activeReturn, setActiveReturn] = useState<ReturnDoc | null>(null);
  const [labelBusy, setLabelBusy] = useState<string | null>(null);

  const emailReturnLabel = async (r: ReturnDoc) => {
    if (!firestore || !tenantId || labelBusy) return;
    setLabelBusy(r.id);
    try {
      const orderSnap = await getDoc(doc(firestore as Firestore, `tenants/${tenantId}/retailOrders`, r.orderId));
      const qrToken = orderSnap.exists() ? String((orderSnap.data() as any).qrToken || '') : '';
      if (!qrToken) throw new Error('Order record not found');
      const res = await fetch('/api/retail/return-label', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, orderId: r.orderId, returnId: r.id, qrToken }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not buy the label');
      toast({ title: data.alreadySent ? 'Label already sent' : 'Return label emailed', description: data.message });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Return label', description: e?.message || 'Try again.' });
    } finally {
      setLabelBusy(null);
    }
  };
  const [parentOrder, setParentOrder] = useState<(RetailOrder & { id: string }) | null>(null);
  const [verifiedLineId, setVerifiedLineId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!firestore || !tenantId) return;
    const q = query(
      collection(firestore as Firestore, `tenants/${tenantId}/retailReturns`),
      where('status', 'in', ['open', 'received'])
    );
    return onSnapshot(q, (snap: any) => {
      const list = snap.docs.map((d: any) => ({ ...(d.data() as RetailReturn), id: d.id as string }));
      setReturns(list);
      setActiveReturn((cur: ReturnDoc | null) =>
        cur ? list.find((r: ReturnDoc) => r.id === cur.id) || null : cur);
    });
  }, [firestore, tenantId]);

  useEffect(() => {
    if (!firestore || !tenantId || !activeReturn) { setParentOrder(null); return; }
    getDoc(doc(firestore as Firestore, `tenants/${tenantId}/retailOrders`, activeReturn.orderId))
      .then((s: any) => setParentOrder(s.exists() ? { ...(s.data() as RetailOrder), id: s.id } : null));
    setVerifiedLineId(null);
  }, [firestore, tenantId, activeReturn?.id]);

  const doLookup = async (key: string) => {
    if (!firestore || !tenantId || lookingUp) return;
    setLookingUp(true);
    const res = await findReturnableOrder(firestore as Firestore, tenantId, key);
    setLookingUp(false);
    if (res.error || !res.order) {
      scanFeedback(false);
      toast({ variant: 'destructive', title: 'Not found', description: res.error });
      return;
    }
    scanFeedback(true);
    setTarget(res.order);
    setQtys({});
    setReasons({});
    setNotes('');
    setLookupOpen(false);
  };

  const returnableQty = (l: OrderLine) => l.qtyOrdered - l.qtyShorted - (l.qtyReturned || 0);

  const startOpen = async () => {
    if (!firestore || !tenantId || !target || opening) return;
    const selections: ReturnSelection[] = Object.entries(qtys)
      .filter(([, q]) => q > 0)
      .map(([lineId, qty]) => ({ lineId, qty, reason: reasons[lineId] || 'other' }));
    setOpening(true);
    const res = await openReturn(firestore as Firestore, tenantId, target, selections, resolution, notes.trim(), actor);
    setOpening(false);
    toast({ variant: res.ok ? 'default' : 'destructive', title: res.ok ? 'Return opened' : 'Problem', description: res.message });
    if (res.ok) setTarget(null);
  };

  const onReceiveScan = useCallback((value: string) => {
    if (!activeReturn || !parentOrder) return;
    const raw = value.trim();
    const productId = raw.startsWith('clarityflow://product/') ? raw.split('/').pop() : null;
    const match = activeReturn.lines.find((rl) => {
      if (rl.disposition) return false;
      const orig = parentOrder.lines.find((ol) => ol.lineId === rl.lineId);
      if (!orig) return false;
      if (productId) return orig.productId === productId;
      return codesMatch(orig.barcode, raw) || codesMatch(orig.sku, raw);
    });
    if (!match) {
      scanFeedback(false);
      toast({ variant: 'destructive', title: 'Not on this return', description: 'That code does not match an unverified line.' });
      return;
    }
    scanFeedback(true);
    setVerifiedLineId(match.lineId);
    toast({ title: `${match.name} verified`, description: 'Choose: restock or write off.' });
  }, [activeReturn, parentOrder, toast]);

  const disposition = async (lineId: string, d: 'restock' | 'write_off') => {
    if (!firestore || !tenantId || !activeReturn || busy) return;
    setBusy(lineId);
    const res = await receiveReturnLine(firestore as Firestore, tenantId, activeReturn, lineId, d, actor);
    setBusy(null);
    toast({ variant: res.ok ? 'default' : 'destructive', title: res.ok ? res.message : 'Problem', description: res.ok ? undefined : res.message });
    if (res.ok) setVerifiedLineId(null);
  };

  const finish = async () => {
    if (!firestore || !tenantId || !activeReturn || busy) return;
    setBusy('resolve');
    const res = await resolveReturn(firestore as Firestore, tenantId, activeReturn, actor);
    setBusy(null);
    toast({ variant: res.ok ? 'default' : 'destructive', title: res.ok ? 'Return resolved' : 'Not yet', description: res.message });
    if (res.ok) setActiveReturn(null);
  };

  const allDispositioned = activeReturn ? activeReturn.lines.every((l) => !!l.disposition) : false;

  return (
    <div className="min-h-dvh bg-muted/5 pb-24">
      <header className="sticky top-0 z-30 bg-white/90 backdrop-blur border-b-2">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center gap-3">
          <Button asChild variant="ghost" size="icon" className="h-10 w-10 rounded-xl">
            <Link href="/retail-orders"><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <div className="flex-1 min-w-0">
            <h1 className="font-black uppercase tracking-tighter text-xl leading-none">Returns</h1>
            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mt-0.5">
              {returns.length} open
            </p>
          </div>
          <Button
            onClick={() => { setLookupOpen(true); setLookupKey(''); }}
            className="h-11 rounded-xl font-black uppercase text-[10px] tracking-widest shadow-md shadow-primary/20"
          >
            <RotateCcw className="mr-1.5 h-4 w-4" /> New return
          </Button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-6 space-y-5">
        {lookupOpen && !target && (
          <Card className="border-2 border-primary rounded-[2rem] overflow-hidden bg-white">
            <CardContent className="p-6 space-y-4">
              <div className="flex items-center gap-2">
                <QrCode className="w-4 h-4 text-primary" />
                <p className="text-[10px] font-black uppercase tracking-widest">Scan the customer&apos;s pickup QR — or enter the order number</p>
              </div>
              <ScanGate onScan={doLookup} label="Customer's order QR from their phone or packing slip" />
              <div className="flex gap-2">
                <Input
                  placeholder="Order # (e.g. 1042)"
                  value={lookupKey}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setLookupKey(e.target.value)}
                  className="h-12 rounded-xl border-2 font-black font-mono text-sm"
                />
                <Button disabled={!lookupKey.trim() || lookingUp} onClick={() => doLookup(lookupKey)}
                  className="h-12 rounded-xl font-black uppercase text-[10px] tracking-widest px-6">
                  {lookingUp ? <Loader className="h-4 w-4 animate-spin" /> : 'Find'}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {target && (
          <Card className="border-2 border-primary rounded-[2rem] overflow-hidden bg-white">
            <CardContent className="p-6 space-y-4">
              <div className="flex items-center justify-between gap-2">
                <p className="font-black uppercase tracking-tight text-sm">
                  Return for #{String(target.orderNumber).padStart(4, '0')} · {target.customerName}
                </p>
                <Button variant="ghost" size="sm" className="h-8 font-black uppercase text-[9px] tracking-widest" onClick={() => setTarget(null)}>
                  Cancel
                </Button>
              </div>
              <div className="space-y-3">
                {target.lines.map((l) => {
                  const max = returnableQty(l);
                  const q = qtys[l.lineId] || 0;
                  if (max <= 0) return null;
                  return (
                    <div key={l.lineId} className="rounded-2xl border-2 p-3 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-black uppercase tracking-tight text-xs">{l.name}</p>
                        <div className="flex items-center gap-1.5">
                          <Button variant="outline" size="icon" className="h-8 w-8 rounded-lg border-2"
                            onClick={() => setQtys({ ...qtys, [l.lineId]: Math.max(0, q - 1) })}>−</Button>
                          <span className="w-10 text-center font-black font-mono text-sm">{q}/{max}</span>
                          <Button variant="outline" size="icon" className="h-8 w-8 rounded-lg border-2"
                            onClick={() => setQtys({ ...qtys, [l.lineId]: Math.min(max, q + 1) })}>+</Button>
                        </div>
                      </div>
                      {q > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {RETURN_REASONS.map((r) => (
                            <button key={r} type="button"
                              onClick={() => setReasons({ ...reasons, [l.lineId]: r })}
                              className={cn('h-8 px-3 rounded-full border-2 text-[9px] font-black uppercase tracking-widest',
                                (reasons[l.lineId] || 'other') === r ? 'bg-foreground text-background border-foreground' : 'bg-white')}>
                              {REASON_LABELS[r]}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="space-y-2">
                <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Resolution</Label>
                <div className="grid grid-cols-3 gap-2">
                  {(['refund', 'replacement', 'store_credit'] as ReturnResolution[]).map((r) => (
                    <button key={r} type="button" onClick={() => setResolution(r)}
                      className={cn('rounded-2xl border-2 p-3 text-[9px] font-black uppercase tracking-widest transition-all',
                        resolution === r ? 'border-primary bg-primary/5 text-primary' : 'hover:border-primary/30')}>
                      {r === 'store_credit' ? 'Store credit' : r}
                    </button>
                  ))}
                </div>
              </div>
              <Textarea placeholder="Notes (optional)" value={notes}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setNotes(e.target.value)}
                className="rounded-2xl border-2 min-h-[70px] font-bold text-sm" />
              <Button disabled={opening || Object.values(qtys).every((q) => !q)} onClick={startOpen}
                className="w-full h-12 rounded-2xl font-black uppercase text-[10px] tracking-widest shadow-lg shadow-primary/20">
                {opening ? <Loader className="h-4 w-4 animate-spin" /> : 'Open return'}
              </Button>
            </CardContent>
          </Card>
        )}

        <div className="space-y-3">
          {returns.length === 0 && !lookupOpen && (
            <div className="rounded-2xl border-2 border-dashed py-16 text-center space-y-2">
              <PackageX className="w-8 h-8 mx-auto opacity-20" />
              <p className="text-[10px] font-black uppercase tracking-widest opacity-30">No open returns</p>
            </div>
          )}
          {returns.map((r) => (
            <Card key={r.id} className={cn('border-2 rounded-[2rem] overflow-hidden bg-white',
              activeReturn?.id === r.id && 'border-primary shadow-lg shadow-primary/10')}>
              <CardContent className="p-5 space-y-3">
                <button type="button" className="w-full text-left" onClick={() => setActiveReturn(activeReturn?.id === r.id ? null : r)}>
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="font-black uppercase tracking-tight text-sm">Return · Order #{String(r.orderNumber).padStart(4, '0')}</p>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                        {r.lines.reduce((a, l) => a + l.qty, 0)} unit(s) · {r.resolution === 'store_credit' ? 'Store credit' : r.resolution}
                        {r.refundCents ? ` · ${fmt(r.refundCents)}` : ''}{r.storeCreditCents ? ` · ${fmt(r.storeCreditCents)}` : ''}
                      </p>
                    </div>
                    <Badge variant="outline" className="h-6 px-3 font-black text-[8px] uppercase tracking-widest border-2">
                      {r.lines.filter((l) => l.disposition).length}/{r.lines.length} received
                    </Badge>
                  </div>
                </button>

                {(r as any).labelUrl ? (
                  <p className="text-[10px] font-black uppercase tracking-widest text-primary">
                    Label sent · {(r as any).labelCarrier} {(r as any).labelTrackingNumber}
                    {(r as any).labelDeductCents ? ` · $${(((r as any).labelDeductCents || 0) / 100).toFixed(2)} off refund` : ' · shop pays'}
                  </p>
                ) : r.status === 'open' ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={labelBusy === r.id}
                    onClick={() => emailReturnLabel(r)}
                    className="h-9 rounded-xl border-2 font-black uppercase text-[10px] tracking-widest"
                  >
                    {labelBusy === r.id ? <Loader className="h-3.5 w-3.5 animate-spin" /> : 'Email return label'}
                  </Button>
                ) : null}

                {activeReturn?.id === r.id && (
                  <div className="pt-2 border-t-2 border-dashed space-y-4">
                    <div className="grid md:grid-cols-2 gap-4">
                      <ScanGate onScan={onReceiveScan} label="Scan each returned item to verify it" />
                      <div className="space-y-2">
                        {r.lines.map((l) => (
                          <div key={l.lineId} className={cn('rounded-2xl border-2 p-3 space-y-2',
                            verifiedLineId === l.lineId && 'border-primary bg-primary/5')}>
                            <div className="flex items-center justify-between gap-2">
                              <div className="min-w-0">
                                <p className="font-black uppercase tracking-tight text-xs truncate">{l.qty} × {l.name}</p>
                                <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">{REASON_LABELS[l.reason]}</p>
                              </div>
                              {l.disposition ? (
                                <Badge className={cn('h-6 px-2 font-black text-[8px] uppercase tracking-widest border-2',
                                  l.disposition === 'restock' ? 'bg-green-50 border-green-100 text-green-700' : 'bg-destructive/5 border-destructive/10 text-destructive')}>
                                  {l.disposition === 'restock' ? 'Restocked' : 'Written off'}
                                </Badge>
                              ) : verifiedLineId === l.lineId ? (
                                <Check className="w-4 h-4 text-primary shrink-0" />
                              ) : (
                                <button type="button" className="text-[8px] font-black uppercase tracking-widest text-muted-foreground/60 shrink-0"
                                  onClick={() => setVerifiedLineId(l.lineId)}>
                                  no scan
                                </button>
                              )}
                            </div>
                            {!l.disposition && verifiedLineId === l.lineId && (
                              <div className="grid grid-cols-2 gap-2">
                                <Button disabled={busy === l.lineId} onClick={() => disposition(l.lineId, 'restock')}
                                  className="h-9 rounded-xl font-black uppercase text-[9px] tracking-widest">
                                  <Undo2 className="mr-1 h-3 w-3" /> Restock
                                </Button>
                                <Button disabled={busy === l.lineId} variant="destructive" onClick={() => disposition(l.lineId, 'write_off')}
                                  className="h-9 rounded-xl font-black uppercase text-[9px] tracking-widest">
                                  Write off
                                </Button>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                    <Button disabled={!allDispositioned || busy === 'resolve'} onClick={finish}
                      className="w-full h-12 rounded-2xl font-black uppercase text-[10px] tracking-widest shadow-lg shadow-primary/20">
                      {busy === 'resolve' ? <Loader className="h-4 w-4 animate-spin" />
                        : allDispositioned ? `Resolve — ${r.resolution === 'store_credit' ? 'issue store credit' : r.resolution}`
                        : 'Scan every line to resolve'}
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </main>
    </div>
  );
}
