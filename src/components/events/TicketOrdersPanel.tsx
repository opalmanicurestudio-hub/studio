'use client';
// src/components/events/TicketOrdersPanel.tsx — A PAID EVENT'S TICKET ORDERS, in its manifest (lib/event-tickets).
// Who bought, how many, what they paid, and a refund for any order (the money goes back to their card and their guests
// come off the list). When the event is canceled, every paid order can be refunded at once. Managers refund; the
// server checks that (api/events/tickets).
import * as React from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { useFirebase } from '@/firebase';
import { useToast } from '@/hooks/use-toast';
import { staffAuthHeader } from '@/lib/staff-fetch';
import { Button } from '@/components/ui/button';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';

const money = (c: number) => `$${(c / 100).toFixed(2).replace(/\.00$/, '')}`;
const STATUS: Record<string, string> = { paid: 'Paid', refunded: 'Refunded', pending: 'Paying now', expired: 'Not paid' };

export function TicketOrdersPanel({ tenantId, event, guests = [] }: { tenantId: string; event: any; guests?: any[] }) {
  const { firestore } = useFirebase(); const { toast } = useToast();
  const [orders, setOrders] = React.useState<any[]>([]);
  const [ask, setAsk] = React.useState<{ kind: 'one'; order: any } | { kind: 'all' } | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!firestore || !tenantId || !event?.id) return;
    return onSnapshot(query(collection(firestore, `tenants/${tenantId}/eventTicketOrders`), where('eventId', '==', event.id)),
      (s) => setOrders(s.docs.map((d) => ({ ...d.data(), id: d.id })).sort((a: any, b: any) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))),
      () => setOrders([]));
  }, [firestore, tenantId, event?.id]);

  const shown = orders.filter((o) => o.status === 'paid' || o.status === 'refunded' || (o.status === 'pending' && Date.parse(o.holdUntil || '') > Date.now()));
  const paid = orders.filter((o) => o.status === 'paid');
  const sold = paid.reduce((n, o) => n + (Number(o.qty) || 0), 0);
  const takings = paid.reduce((n, o) => n + (Number(o.paidCents) || 0), 0);
  const canceled = String(event?.status || '') === 'cancelled';
  const cap = Math.max(0, Math.floor(Number(event?.ticketingConfig?.capacity || event?.capacity) || 0));
  // What a refund would take off the list besides the places: a check-in, a meal order.
  const onList = (orderIds: string[]) => guests.filter((g: any) => orderIds.includes(String(g.ticketOrderId || '')));
  const lost = (orderIds: string[]) => { const gs = onList(orderIds); const inn = gs.filter((g: any) => g.checkedIn).length; const meals = gs.filter((g: any) => g.mealChoiceId || g.orderedAt).length;
    return [inn ? `${inn === 1 ? 'One guest has' : `${inn} guests have`} already checked in.` : '', meals ? `${meals === 1 ? 'One guest’s meal order' : `${meals} guests’ meal orders`} will go too.` : ''].filter(Boolean).join(' '); };

  const refund = async () => {
    if (!ask) return; setBusy(true);
    try {
      const r = await fetch('/api/events/tickets', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await staffAuthHeader()) },
        body: JSON.stringify(ask.kind === 'one' ? { tenantId, action: 'refund', orderId: ask.order.id } : { tenantId, action: 'refund-all', eventId: event.id }) });
      const j: any = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(j.error || 'The refund didn’t go through.');
      toast({ title: ask.kind === 'one' ? `Refunded ${money(j.refundedCents || 0)}` : `Refunded ${j.refunded} ${j.refunded === 1 ? 'order' : 'orders'} (${money(j.refundedCents || 0)})` });
      setAsk(null);
    } catch (e: any) { toast({ variant: 'destructive', title: 'Not refunded', description: String(e?.message || '') }); }
    finally { setBusy(false); }
  };

  return <div className="space-y-4">
    <div className="grid grid-cols-2 gap-3">
      <div className="rounded-2xl border bg-card p-4"><p className="text-[13px] text-muted-foreground">Tickets sold</p><p className="mt-1 text-[26px] font-semibold tabular-nums">{sold}{cap > 0 ? <span className="text-[15px] font-normal text-muted-foreground"> of {cap}</span> : null}</p></div>
      <div className="rounded-2xl border bg-card p-4"><p className="text-[13px] text-muted-foreground">Taken</p><p className="mt-1 text-[26px] font-semibold tabular-nums">{money(takings)}</p></div>
    </div>
    {canceled && paid.length > 0 && <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/30">
      <p className="text-[14.5px]">This event is canceled. {paid.length === 1 ? 'One order is' : `${paid.length} orders are`} still paid.</p>
      <Button variant="destructive" className="h-11 rounded-xl text-[14px] font-medium" onClick={() => setAsk({ kind: 'all' })}>Refund all tickets</Button>
    </div>}
    {shown.length === 0
      ? <p className="rounded-2xl border border-dashed py-10 text-center text-[14.5px] text-muted-foreground">No tickets sold yet. They show here as guests buy them on the event’s page.</p>
      : <ul className="divide-y rounded-2xl border bg-card">{shown.map((o) => <li key={o.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-medium">{o.name}<span className="font-normal text-muted-foreground"> · {o.qty} {Number(o.qty) === 1 ? 'ticket' : 'tickets'}</span></p>
            <p className="truncate text-[13px] text-muted-foreground">{o.email}{o.paidAt ? ` · ${new Date(o.paidAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : ''}</p>
          </div>
          <span className="text-[14.5px] font-medium tabular-nums">{money(Number(o.paidCents ?? o.totalCents) || 0)}</span>
          <span className={`rounded-full px-2.5 py-1 text-[12.5px] ${o.status === 'paid' ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300' : 'bg-muted text-muted-foreground'}`}>{STATUS[o.status] || o.status}</span>
          {o.status === 'paid' && <Button variant="outline" className="h-11 rounded-xl text-[14px]" onClick={() => setAsk({ kind: 'one', order: o })}>Refund</Button>}
        </li>)}</ul>}

    <AlertDialog open={!!ask} onOpenChange={(v) => { if (!v && !busy) setAsk(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{ask?.kind === 'all' ? 'Refund every ticket?' : `Refund ${ask?.kind === 'one' ? ask.order.name : ''}?`}</AlertDialogTitle>
          <AlertDialogDescription>
            {ask?.kind === 'all'
              ? `${paid.length === 1 ? 'One order' : `${paid.length} orders`} (${money(takings)}) ${paid.length === 1 ? 'goes back to the card it was' : 'go back to the cards they were'} paid with, and those guests come off the list.`
              : ask?.kind === 'one' ? `${money(Number(ask.order.paidCents) || 0)} goes back to the card they paid with, and their ${Number(ask.order.qty) === 1 ? 'place comes' : `${ask.order.qty} places come`} off the guest list.` : ''}
            {ask ? ` ${lost(ask.kind === 'all' ? paid.map((o) => String(o.id)) : [String(ask.order.id)])}` : ''}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy} className="h-11">Keep</AlertDialogCancel>
          <AlertDialogAction disabled={busy} onClick={(e) => { e.preventDefault(); refund(); }} className="h-11 bg-[#b42318] text-white hover:bg-[#9a1e14]">{busy ? 'Refunding…' : 'Refund'}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>;
}
