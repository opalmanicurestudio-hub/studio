'use client';
// src/components/money/RefundDialog.tsx — REFUND A SALE (the Books tab's Refund): how much goes back and how (to the card
// it was paid with, or cash now or later), what's kept back for what the visit cost (the running costs for its time, the
// products used, the provider's pay), what happens to the provider's commission, why, and a manager's PIN (checked
// online, never on this device). The Books tab (money/page.tsx handleRefundConfirm) does the refund with what's picked.
import * as React from 'react';
import { differenceInMinutes, parseISO } from 'date-fns';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { hourlyRate, planCost, stationMinutes } from '@/lib/product-cost';
import { earnsCommission, rateFor } from '@/lib/commission';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f7', RED = '#b42318';
const RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';
const btn = `inline-flex min-h-[44px] items-center justify-center rounded-full px-5 text-[14px] font-semibold disabled:opacity-50 ${RING}`;
const usd = (n: number) => `$${Math.abs(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const asDate = (v: any): Date => {
  if (!v) return new Date(); if (v instanceof Date) return v; if (typeof v?.toDate === 'function') return v.toDate();
  if (typeof v === 'string') { try { return parseISO(v); } catch { return new Date(v); } }
  if (typeof v === 'object' && 'seconds' in v) return new Date(v.seconds * 1000);
  return new Date(v);
};

export type RefundChoice = { amount: number; refundTip: boolean; tipStrategy: 'clawback' | 'absorb'; reason: string; logIncident: boolean; authorizerId: string | null; takeBack: boolean; later: boolean };

/** What a visit cost, to keep back from a refund: the running costs for its time (with set-up and clean-up), the
 *  products used, and the provider's pay for it. */
export function visitCosts(transaction: any, o: { services: any[]; appointments: any[]; staff: any[]; inventory: any[]; tenant: any }) {
  const none = { overhead: 0, materials: 0, labor: 0, staffMember: null as any };
  if (!transaction || !o.services || !o.appointments || !o.staff) return none;
  const apt = o.appointments.find((a: any) => a.id === transaction.appointmentId); if (!apt) return none;
  const svc = o.services.find((s: any) => s.id === apt.serviceId); if (!svc) return none;
  const materials = apt.checkoutState?.formula?.length > 0
    ? apt.checkoutState.formula.reduce((acc: number, item: any) => acc + item.quantity * item.costPerUnit, 0)
    : planCost(svc, o.inventory).total;
  const actualDuration = apt.actualStartTime && apt.actualEndTime
    ? differenceInMinutes(asDate(apt.actualEndTime), asDate(apt.actualStartTime))
    : (apt.checkoutState?.actualDuration || svc.duration || 60);
  const overhead = (stationMinutes(svc, { actualMin: actualDuration }) / 60) * hourlyRate(o.tenant);
  const staffMember = o.staff.find((s: any) => s.id === apt.staffId);
  let labor = 0;
  if (earnsCommission(staffMember)) labor = transaction.amount * (Number(transaction.commissionPct) >= 0 && transaction.commissionPct != null ? Number(transaction.commissionPct) : rateFor(staffMember, svc, 40)) / 100;
  else if (staffMember?.payStructure === 'hourly' && staffMember.hourlyRate) labor = (actualDuration / 60) * staffMember.hourlyRate;
  return { overhead, materials, labor, staffMember };
}

export function RefundDialog({ transaction, staff, services, appointments, inventory, tenant, open, onOpenChange, onConfirm }: {
  transaction: any | null; staff: any[]; services: any[]; appointments: any[]; inventory: any[]; tenant: any;
  /** Does the refund; the button stays busy until it settles. */
  open: boolean; onOpenChange: (o: boolean) => void; onConfirm: (c: RefundChoice) => void | Promise<unknown>;
}) {
  const [pin, setPin] = React.useState('');
  const [refundAmount, setRefundAmount] = React.useState(transaction?.amount || 0);
  const [refundTip] = React.useState(true);
  const [tipStrategy] = React.useState<'clawback' | 'absorb'>('clawback');
  const [reason, setReason] = React.useState('');
  const [logIncident, setLogIncident] = React.useState(false);
  const [withholdOverhead, setWithholdOverhead] = React.useState(false);
  const [withholdMaterials, setWithholdMaterials] = React.useState(false);
  const [withholdLabor, setWithholdLabor] = React.useState(false);
  const [stage, setStage] = React.useState<'' | 'pin' | 'refund'>('');
  const { toast } = useToast();

  const costs = React.useMemo(() => visitCosts(transaction, { services, appointments, staff, inventory, tenant }), [transaction, services, appointments, staff, inventory, tenant]);

  // Commission on a refunded service: taken back (or kept), the business's default, changeable here.
  const isServiceSale = transaction?.category === 'Service Revenue' && !!transaction?.staffId;
  const [takeBack, setTakeBack] = React.useState<boolean>(true);
  const [later, setLater] = React.useState(false);   // a cash sale with the client not here: they choose pickup, an app or credit
  React.useEffect(() => { setTakeBack((tenant?.payRules?.refundCommission || 'take_back') !== 'keep'); }, [transaction?.id, tenant?.payRules?.refundCommission]);
  React.useEffect(() => {
    if (transaction) { setRefundAmount(transaction.amount); setReason(''); setPin(''); setLater(false); setLogIncident(false); setWithholdOverhead(false); setWithholdMaterials(false); setWithholdLabor(costs.staffMember?.payStructure === 'hourly'); }
  }, [transaction?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => {
    if (!transaction) return;
    const withheld = (withholdOverhead ? costs.overhead : 0) + (withholdMaterials ? costs.materials : 0) + (withholdLabor ? costs.labor : 0);
    setRefundAmount(Math.max(0, Number((transaction.amount - withheld).toFixed(2))));
  }, [withholdOverhead, withholdMaterials, withholdLabor, transaction, costs]);

  if (!transaction) return null;
  // (The same rule the Books tab refunds by: cash goes back from the till, or later however they choose; anything else
  // goes back the way it was paid, through the server.)
  const method = String(transaction.paymentMethod || '');
  const isCash = method.toLowerCase() === 'cash';
  const tip = refundTip ? (Number(transaction.tipAmount) || 0) : 0;
  const total = refundAmount + tip;

  // The manager's PIN is checked on the server (rate-limited), never on this device.
  const go = async () => {
    if (stage) return;
    if (!reason.trim()) { toast({ variant: 'destructive', title: 'Say why first', description: 'The reason is kept with the refund.' }); return; }
    setStage('pin');
    try {
      let authorizerId: string | null = null;
      try {
        const res = await fetch('/api/portal/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'verify-manager', tenantId: tenant?.id, pin }) });
        if (res.status === 404) throw new Error('__legacy__');
        const d = await res.json();
        if (d.ok && d.manager?.id) authorizerId = d.manager.id;
        else { toast({ variant: 'destructive', title: 'That PIN didn’t work', description: d.error || 'Ask a manager to put in theirs.' }); return; }
      } catch {
        toast({ variant: 'destructive', title: 'Can’t check the PIN offline', description: 'PINs are checked online. Try again when you’re connected.' }); return;
      }
      setStage('refund');
      await onConfirm({ amount: refundAmount, refundTip: refundTip && (Number(transaction.tipAmount) || 0) > 0, tipStrategy, reason, logIncident, authorizerId, takeBack: isServiceSale && takeBack, later: isCash && later });
      setPin('');
    } finally { setStage(''); }
  };

  const radio = (name: string, checked: boolean, set: () => void, label: string) => (
    <label className="flex min-h-[44px] cursor-pointer items-center gap-3 text-[14px]">
      <input type="radio" name={name} checked={checked} onChange={set} className="h-5 w-5 shrink-0 accent-[#16171a]" />
      <span>{label}</span>
    </label>
  );
  const keep = [
    { key: 'o', label: 'Running costs for the visit’s time', on: withholdOverhead, set: setWithholdOverhead, val: costs.overhead },
    { key: 'm', label: 'Products used', on: withholdMaterials, set: setWithholdMaterials, val: costs.materials },
    { key: 'l', label: 'The provider’s pay for it', on: withholdLabor, set: setWithholdLabor, val: costs.labor },
  ].filter((k) => k.val > 0.004);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (o || !stage) onOpenChange(o); }}>
      <DialogContent className="max-h-[92dvh] overflow-hidden rounded-3xl border-0 bg-[#fff] p-0 sm:max-w-md">
        <div className="flex max-h-[92dvh] flex-col" style={{ color: INK }}>
          <div className="shrink-0 px-6 pb-2 pt-6 text-left">
            <DialogTitle className="pr-8 text-[20px] font-semibold leading-tight" style={{ color: INK }}>Refund {transaction.description || 'this sale'}</DialogTitle>
            <DialogDescription className="text-[14px]" style={{ color: MUTED }}>{usd(transaction.amount)}{tip ? ` and a ${usd(tip)} tip` : ''}, paid {isCash ? 'in cash' : method ? `by ${method.toLowerCase()}` : 'by card'}.</DialogDescription>
          </div>
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 pb-4">
            <div className="rounded-2xl px-4 py-4 text-center" style={{ background: SOFT }}>
              <p className="text-[14px]" style={{ color: MUTED }}>They get back</p>
              <p className="text-[32px] font-semibold tabular-nums leading-tight">{usd(total)}</p>
              <p className="text-[13px]" style={{ color: MUTED }}>{!isCash ? 'Back the way they paid' : later ? 'However they choose' : 'In cash, from the till'}{tip ? `, the tip included` : ''}</p>
            </div>

            {isCash && (
              <fieldset className="space-y-1">
                <legend className="mb-1 text-[14px] font-semibold">How they get it back</legend>
                {radio('refund-when', !later, () => setLater(false), 'They’re here: give it from the till now')}
                {radio('refund-when', later, () => setLater(true), 'They’re not here: text them to choose (cash pickup, an app or credit)')}
                {later && <p className="text-[13px]" style={{ color: MUTED }}>It goes on Refunds to give. Your books show it when they collect it or it’s sent.</p>}
              </fieldset>
            )}

            {isServiceSale && (
              <fieldset className="space-y-1">
                <legend className="mb-1 text-[14px] font-semibold">The provider’s commission on it</legend>
                {radio('refund-commission', takeBack, () => setTakeBack(true), 'Take it back from their next pay')}
                {radio('refund-commission', !takeBack, () => setTakeBack(false), 'They keep it (they fixed it, or it wasn’t their fault)')}
                <p className="text-[13px]" style={{ color: MUTED }}>In proportion to what’s refunded. An assistant’s share goes the same way.</p>
              </fieldset>
            )}

            {keep.length > 0 && (
              <fieldset>
                <legend className="text-[14px] font-semibold">Keep back what the visit cost</legend>
                <p className="mb-1 text-[13px]" style={{ color: MUTED }}>Each one ticked comes off what they get back.</p>
                {keep.map((k) => (
                  <label key={k.key} className="flex min-h-[44px] cursor-pointer items-center justify-between gap-3 text-[14px]" style={{ borderTop: `1px solid ${LINE}` }}>
                    <span className="flex items-center gap-3"><input type="checkbox" checked={k.on} onChange={(e) => k.set(e.target.checked)} className="h-5 w-5 shrink-0 accent-[#16171a]" />{k.label}</span>
                    <span className="tabular-nums" style={{ color: MUTED }}>{usd(k.val)}</span>
                  </label>
                ))}
              </fieldset>
            )}

            <div className="space-y-1.5">
              <label htmlFor="refund-why" className="block text-[14px] font-semibold">Why</label>
              <textarea id="refund-why" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="What happened, in a few words"
                className={`w-full rounded-xl bg-[#fff] px-3 py-2 text-[15px] ${RING}`} style={{ border: `1px solid ${LINE}`, color: INK }} />
            </div>

            {transaction.clientId && (
              <label className="flex min-h-[44px] cursor-pointer items-center gap-3 text-[14px]">
                <input type="checkbox" checked={logIncident} onChange={(e) => setLogIncident(e.target.checked)} className="h-5 w-5 shrink-0 accent-[#16171a]" />
                <span>Note it on the client’s record as something that went wrong</span>
              </label>
            )}

            <div className="space-y-1.5">
              <label htmlFor="refund-pin" className="block text-[14px] font-semibold">A manager’s PIN</label>
              <input id="refund-pin" type="password" inputMode="numeric" autoComplete="off" maxLength={4} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} placeholder="4 digits"
                className={`h-12 w-40 rounded-xl bg-[#fff] px-3 text-center ${pin ? 'text-[22px] tracking-[0.4em]' : 'text-[15px]'} ${RING}`} style={{ border: `1px solid ${LINE}`, color: INK }} />
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2 px-6 py-4" style={{ borderTop: `1px solid ${LINE}` }}>
            <button type="button" onClick={go} disabled={pin.length < 4 || !reason.trim() || !!stage} className={btn} style={{ background: RED, color: '#fff' }}>{stage === 'pin' ? 'Checking the PIN' : stage === 'refund' ? 'Refunding' : `Refund ${usd(total)}`}</button>
            <button type="button" onClick={() => onOpenChange(false)} disabled={!!stage} className={btn} style={{ background: '#fff', color: INK, border: `1px solid ${LINE}` }}>Cancel</button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
