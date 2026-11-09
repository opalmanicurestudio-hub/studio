'use client';
// RenterRefundDialog — refund part or all of something a renter paid by card from their account (rent online, autopay,
// an agreed charge from the card on file), back to the same card (api/rent/refund, lib/renter-refund). The renter is
// told by email or text and in their portal. Used on the Rent page and in a renter's profile.
import { useEffect, useMemo, useState } from 'react';
import { nanoid } from 'nanoid';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

type Payment = {
  id: string; kind: 'online' | 'autopay' | 'agreed'; label: string; date: string; cents: number;
  refundedCents: number; pendingCents: number; refundableCents: number; card: { brand: string | null; last4: string | null } | null;
};

const money = (c: number) => `$${(Math.max(0, c) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (iso: string) => { try { return new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }); } catch { return iso; } };
const cardText = (c: Payment['card']) => (c?.last4 ? `${c.brand ? `${c.brand.charAt(0).toUpperCase()}${c.brand.slice(1)} ` : 'Card '}ending ${c.last4}` : 'the card it was paid with');

export function RenterRefundDialog({ open, onOpenChange, tenantId, renter, onDone }: {
  open: boolean; onOpenChange: (o: boolean) => void; tenantId: string;
  renter: { id: string; firstName?: string; lastName?: string } | null;
  onDone?: (message: string) => void;
}) {
  const [payments, setPayments] = useState<Payment[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sel, setSel] = useState<string>('');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [stillOwed, setStillOwed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requestId, setRequestId] = useState('');
  // After no answer (from Stripe, or the network), the same refund is asked again as it was, so nothing can change.
  const [locked, setLocked] = useState(false);
  // One tap arms Refund, the next sends it: money going back can't be taken back.
  const [armed, setArmed] = useState(false);
  const first = (renter?.firstName || 'the renter').trim();

  useEffect(() => {
    if (!open) { setLocked(false); setArmed(false); return; }
    if (!renter?.id || !tenantId) return;
    let gone = false;
    setPayments(null); setLoadError(null); setSel(''); setAmount(''); setReason(''); setStillOwed(false); setError(null); setLocked(false); setArmed(false);
    fetch(`/api/rent/refund?tenantId=${encodeURIComponent(tenantId)}&renterId=${encodeURIComponent(renter.id)}`)
      .then((r) => r.json()).catch(() => null)
      .then((d: any) => {
        if (gone) return;
        if (!d?.ok) { setLoadError(d?.error || 'Their payments couldn’t be loaded. Try again.'); setPayments([]); return; }
        const list: Payment[] = d.payments || [];
        setPayments(list);
        const firstOpen = list.find((p) => p.refundableCents > 0);
        if (firstOpen) { setSel(firstOpen.id); setAmount((firstOpen.refundableCents / 100).toFixed(2)); }
      });
    return () => { gone = true; };
  }, [open, renter?.id, tenantId]);

  const chosen = useMemo(() => (payments || []).find((p) => p.id === sel) || null, [payments, sel]);
  const cents = Math.round((parseFloat(amount) || 0) * 100);
  const tooMuch = !!chosen && cents > chosen.refundableCents;
  // A new request whenever what's asked changes; the same one when Refund is pressed again unchanged (after Stripe
  // didn't answer), so it can never go back twice.
  useEffect(() => { if (!locked) setRequestId(nanoid(16)); setArmed(false); }, [sel, cents, reason, stillOwed, open]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!armed) return; const t = setTimeout(() => setArmed(false), 5000); return () => clearTimeout(t); }, [armed]);

  const pick = (p: Payment) => { if (p.refundableCents <= 0 || locked) return; setSel(p.id); setAmount((p.refundableCents / 100).toFixed(2)); setError(null); if (p.kind === 'agreed') setStillOwed(false); };

  const submit = async () => {
    if (!chosen || !renter || !(cents > 0) || tooMuch || busy) return;
    if (!armed && !locked) { setArmed(true); return; }
    setBusy(true); setError(null); setArmed(false);
    try {
      const d: any = await fetch('/api/rent/refund', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, renterId: renter.id, transactionId: chosen.id, amountCents: cents, reason: reason.trim(), stillOwed: chosen.kind !== 'agreed' && stillOwed, requestId }) })
        .then((r) => r.json()).catch(() => null);
      if (!d) { setLocked(true); setError('We couldn’t tell whether the refund went through. Press Refund again: it won’t refund twice.'); return; }
      // No answer: asked again as it was. A plain no: the next press is a new request (Stripe remembers a refused one).
      if (!d.ok) { if (d.retry) setLocked(true); else setRequestId(nanoid(16)); setError(d.error || 'Nothing was refunded. Try again.'); return; }
      onOpenChange(false);
      const c = d.card || chosen.card;
      onDone?.(`Refunded ${money(d.refundedCents)} to ${first}’s ${c?.last4 ? cardText(c) : 'card'}.${d.stillOwed ? ' It stays on their account as owed.' : ''}${d.recordPending ? ' Their account will show it in a few minutes.' : ''}${d.sentTo ? ` Notice sent to ${d.sentTo}.` : ''}`);
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy) onOpenChange(o); }}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Refund a payment</DialogTitle>
          <DialogDescription>
            Back to the card it was paid with, through your payments account. {first} gets a refund notice by email or text and in their portal.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 text-[#16171a]">
          {payments === null ? (
            <p className="text-[13px] text-[#6d7075]">Loading their card payments…</p>
          ) : loadError ? (
            <p role="alert" className="text-[13px] text-[#b45309]">{loadError}</p>
          ) : payments.length === 0 ? (
            <p className="text-[13px] text-[#6d7075]">{first} hasn’t paid anything by card from their account yet. Cash, check and transfer payments are given back by hand.</p>
          ) : (
            <div role="radiogroup" aria-label="Payment to refund" className="max-h-64 space-y-2 overflow-y-auto pr-0.5">
              {payments.map((p) => {
                const on = p.id === sel; const none = p.refundableCents <= 0;
                return (
                  <button key={p.id} type="button" role="radio" aria-checked={on} disabled={none || locked} onClick={() => pick(p)}
                    className={cn('flex min-h-[44px] w-full items-start justify-between gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors',
                      on ? 'border-[#16171a] bg-[#f5f5f7]' : 'border-[#ececee] bg-white hover:bg-[#f5f5f7]', none && 'cursor-not-allowed opacity-60 hover:bg-white')}>
                    <span className="min-w-0">
                      <span className="block text-[14px] font-medium leading-snug">{p.label}</span>
                      <span className="block text-[12px] text-[#6d7075]">
                        {day(p.date)}{p.card?.last4 ? ` · ${cardText(p.card)}` : ''}
                        {p.refundedCents > 0 ? ` · ${money(p.refundedCents)} refunded` : ''}{p.pendingCents > 0 ? ` · ${money(p.pendingCents)} on its way back` : ''}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block text-[14px] font-medium tabular-nums">{money(p.cents)}</span>
                      <span className="block text-[12px] text-[#6d7075]">{none ? 'Refunded in full' : p.refundableCents < p.cents ? `${money(p.refundableCents)} left` : ''}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {chosen && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="refund-amount">Amount</Label>
                <Input id="refund-amount" type="number" inputMode="decimal" min="0.01" step="0.01" value={amount} disabled={locked} onChange={(e) => { setAmount(e.target.value); setError(null); }}
                  className="h-11" aria-describedby="refund-amount-help" />
                <p id="refund-amount-help" className={cn('text-[12px]', tooMuch ? 'text-[#b45309]' : 'text-[#6d7075]')}>
                  {tooMuch ? `That’s more than can go back. Up to ${money(chosen.refundableCents)}.` : `Up to ${money(chosen.refundableCents)}.`}
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="refund-reason">Reason</Label>
                <Input id="refund-reason" value={reason} maxLength={300} disabled={locked} onChange={(e) => setReason(e.target.value)} className="h-11"
                  placeholder="For example: the water was off on Nov 25" aria-describedby="refund-reason-help" />
                <p id="refund-reason-help" className="text-[12px] text-[#6d7075]">Shown to {first} in their notice and on their account.</p>
              </div>
              {chosen.kind !== 'agreed' && (
                <fieldset className="space-y-2">
                  <legend className="mb-1.5 text-[14px] font-medium">Do they still owe this amount?</legend>
                  {([[false, 'No, the refund settles it', 'Their balance doesn’t change.'], [true, 'Yes, they still owe it', 'It stays on their account to pay another way, like an agreed charge.']] as const).map(([v, t, h]) => (
                    <label key={String(v)} className={cn('flex min-h-[44px] cursor-pointer items-start gap-3 rounded-xl border px-3 py-2.5', stillOwed === v ? 'border-[#16171a] bg-[#f5f5f7]' : 'border-[#ececee]')}>
                      <input type="radio" name="refund-owed" className="mt-1 h-4 w-4 shrink-0 accent-[#16171a]" checked={stillOwed === v} disabled={locked} onChange={() => setStillOwed(v)} />
                      <span><span className="block text-[14px]">{t}</span><span className="block text-[12px] text-[#6d7075]">{h}</span></span>
                    </label>
                  ))}
                </fieldset>
              )}
              <p className="text-[12px] text-[#6d7075]">Goes back to {cardText(chosen.card)}. Refunds usually show on their statement within 5 to 10 business days.</p>
            </>
          )}
          {error && <p role="alert" className="text-[13px] text-[#b45309]">{error}</p>}
        </div>
        <DialogFooter className="gap-2">
          {payments !== null && !payments.some((p) => p.refundableCents > 0) ? (
            <Button variant="outline" className="h-11" onClick={() => onOpenChange(false)}>Close</Button>
          ) : (
            <>
              <Button variant="outline" className="h-11" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
              <Button className="h-11 bg-[#16171a] text-white hover:bg-[#16171a]/90" onClick={submit} disabled={!chosen || !(cents > 0) || tooMuch || busy}>
                {busy ? 'Refunding…' : armed ? `Tap again to refund ${money(cents)}` : `Refund ${cents > 0 ? money(cents) : ''}`.trim()}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
