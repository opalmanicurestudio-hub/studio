'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn, safeNumber } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Banknote, DollarSign, CheckCircle2, Loader, Printer,
  Mail, Phone, Gift, RotateCcw, Zap, ChevronDown, ChevronUp,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useTenant } from '@/context/TenantContext';

const BILLS = [1, 5, 10, 20, 50, 100];
const COINS = [0.25, 0.50, 0.75, 1.00];

export type ReceiptLineItem = {
  label:   string;
  amount:  number;
  type:    'service' | 'addon' | 'retail' | 'adjustment' | 'refreshment';
  staff?:  string;
};

interface CashCheckoutProps {
  finalTotal:         number;
  subtotal:           number;
  tax:                number;
  amountTendered:     number;
  setAmountTendered:  (v: number) => void;
  tipAmount:          number;
  onTipChange:        (v: number) => void;
  onCheckout:         () => void;
  isSubmitting:       boolean;
  isCartEmpty:        boolean;
  isGroupCheckout:    boolean;
  selectedClientId:   string | null;
  isOverAutonomy:     boolean;
  isOverrideUnlocked: boolean;
  clientEmail?:       string;
  clientPhone?:       string;
  clientName?:        string;
  cashierName?:       string;
  lineItems?:         ReceiptLineItem[];
  discountValue?:     number;
  recoveryAmount?:    number;
}

export function CashCheckout({
  finalTotal,
  subtotal,
  tax,
  amountTendered,
  setAmountTendered,
  tipAmount,
  onTipChange,
  onCheckout,
  isSubmitting,
  isCartEmpty,
  isGroupCheckout,
  selectedClientId,
  isOverAutonomy,
  isOverrideUnlocked,
  clientEmail    = '',
  clientPhone    = '',
  clientName     = 'Guest',
  cashierName    = '',
  lineItems      = [],
  discountValue  = 0,
  recoveryAmount = 0,
}: CashCheckoutProps) {
  const { toast }          = useToast();
  const { selectedTenant } = useTenant();

  const [receiptMode,    setReceiptMode]    = useState<'none' | 'email' | 'sms'>('none');
  const [receiptContact, setReceiptContact] = useState('');
  const [receiptSent,    setReceiptSent]    = useState(false);
  const [isSending,      setIsSending]      = useState(false);
  const [showLines,      setShowLines]      = useState(false);
  const [noReceipt,      setNoReceipt]      = useState(false);

  const change      = Math.max(0, amountTendered - finalTotal);
  const hasChange   = change > 0.005;
  const isExact     = Math.abs(amountTendered - finalTotal) < 0.01 && amountTendered > 0;
  const isUnderpaid = amountTendered > 0 && amountTendered < finalTotal - 0.005;
  const stillOwed   = Math.max(0, finalTotal - amountTendered);
  const showCoins   = amountTendered > 0 || stillOwed < 1.5;
  const canCheckout = amountTendered >= finalTotal - 0.005 && finalTotal > 0 &&
    !isCartEmpty && !(isGroupCheckout && !selectedClientId) &&
    !(isOverAutonomy && !isOverrideUnlocked);

  useEffect(() => {
    if (clientEmail && !receiptContact) setReceiptContact(clientEmail);
    else if (clientPhone && !receiptContact) setReceiptContact(clientPhone);
  }, [clientEmail, clientPhone]);

  const quickAmounts = React.useMemo(() => {
    const results: number[] = [];
    for (const bill of BILLS) {
      const rounded = Math.ceil(finalTotal / bill) * bill;
      if (rounded >= finalTotal && !results.includes(rounded)) results.push(rounded);
      if (results.length >= 5) break;
    }
    return [...new Set(results)].sort((a, b) => a - b).slice(0, 3);
  }, [finalTotal]);

  const handleKeepChangeAsTip = useCallback(() => {
    if (change <= 0) return;
    const newTip = Number((safeNumber(tipAmount) + change).toFixed(2));
    onTipChange(newTip);
    toast({ title: `$${change.toFixed(2)} added as gratuity`, description: `Total tip: $${newTip.toFixed(2)}` });
  }, [change, tipAmount, onTipChange, toast]);

  const buildReceiptPayload = () => ({
    clientName,
    cashierName,
    studioName:    selectedTenant?.name || 'Studio',
    studioPhone:   selectedTenant?.twilioPhoneNumber || '',
    lineItems,
    subtotal,
    tax,
    tip:           tipAmount,
    discount:      discountValue,
    recovery:      recoveryAmount,
    total:         finalTotal,
    tendered:      amountTendered,
    change,
    paymentMethod: 'Cash',
    date:          new Date().toLocaleString(),
  });

  const handleSendReceipt = async () => {
    if (!receiptContact.trim()) return;
    setIsSending(true);
    try {
      const isEmail = receiptContact.includes('@');
      await fetch('/api/notifications/send-receipt', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          contact: receiptContact.trim(),
          type:    isEmail ? 'email' : 'sms',
          receipt: buildReceiptPayload(),
        }),
      });
      setReceiptSent(true);
      toast({ title: `Receipt sent ${isEmail ? 'by email' : 'by text'}` });
    } catch {
      toast({ variant: 'destructive', title: 'Could not send receipt' });
    } finally {
      setIsSending(false);
    }
  };

  const handlePrint = () => {
    const r = buildReceiptPayload();
    const win = window.open('', '_blank', 'width=340,height=700');
    if (!win) { window.print(); return; }
    win.document.write(`<!DOCTYPE html><html><head><title>Receipt</title>
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'Courier New', monospace; font-size: 13px; padding: 20px 16px; max-width: 300px; margin: 0 auto; }
        h1 { font-size: 16px; text-align: center; font-weight: bold; margin-bottom: 2px; }
        .sub { text-align: center; color: #666; font-size: 11px; margin-bottom: 14px; }
        hr { border: none; border-top: 1px dashed #bbb; margin: 10px 0; }
        .row { display: flex; justify-content: space-between; margin: 4px 0; }
        .muted { color: #555; }
        .bold { font-weight: bold; }
        .total { font-size: 15px; font-weight: bold; border-top: 1px solid #000; padding-top: 8px; margin-top: 6px; }
        .green { color: #2d6a0f; }
        .footer { text-align: center; margin-top: 20px; color: #666; font-size: 11px; line-height: 2; }
        @media print { body { padding: 0; } }
      </style></head><body>
      <h1>${r.studioName}</h1>
      <div class="sub">${r.date}<br>Guest: ${r.clientName}${r.cashierName ? `<br>Served by: ${r.cashierName}` : ''}</div>
      <hr>
      ${r.lineItems.map(l => `<div class="row"><span>${l.label}${l.staff ? ` · ${l.staff}` : ''}</span><span>$${l.amount.toFixed(2)}</span></div>`).join('')}
      <hr>
      <div class="row muted"><span>Subtotal</span><span>$${r.subtotal.toFixed(2)}</span></div>
      ${r.discount > 0 ? `<div class="row muted"><span>Discount</span><span>-$${r.discount.toFixed(2)}</span></div>` : ''}
      ${r.recovery > 0 ? `<div class="row muted"><span>Service adjustment</span><span>-$${r.recovery.toFixed(2)}</span></div>` : ''}
      <div class="row muted"><span>Tax (7%)</span><span>$${r.tax.toFixed(2)}</span></div>
      ${r.tip > 0 ? `<div class="row muted"><span>Gratuity</span><span>$${r.tip.toFixed(2)}</span></div>` : ''}
      <div class="row total"><span>TOTAL</span><span>$${r.total.toFixed(2)}</span></div>
      <hr>
      <div class="row bold"><span>Cash tendered</span><span>$${r.tendered.toFixed(2)}</span></div>
      ${r.change > 0.005 ? `<div class="row green bold"><span>Change returned</span><span>$${r.change.toFixed(2)}</span></div>` : ''}
      <div class="footer">Thank you, ${r.clientName.split(' ')[0]}!<br>We appreciate your business.${r.studioPhone ? `<br>${r.studioPhone}` : ''}</div>
      </body></html>`);
    win.document.close();
    setTimeout(() => { win.print(); }, 300);
  };

  return (
    <div className="space-y-4">

      {/* Amount due */}
      <div className="flex items-center justify-between px-1">
        <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Amount Due</span>
        <span className="text-2xl font-black font-mono text-primary tracking-tighter">${finalTotal.toFixed(2)}</span>
      </div>

      {/* Line items toggle */}
      {lineItems.length > 0 && (
        <button
          onClick={() => setShowLines(v => !v)}
          className="w-full flex items-center justify-between px-3 py-2 rounded-xl border border-dashed border-border text-[10px] font-black uppercase tracking-widest text-muted-foreground hover:bg-muted/20 transition-colors">
          <span>{showLines ? 'Hide' : 'Show'} line items ({lineItems.length})</span>
          {showLines ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>
      )}

      <AnimatePresence>
        {showLines && lineItems.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
            className="rounded-2xl border-2 border-border bg-muted/5 overflow-hidden">
            <div className="p-3 space-y-1.5">
              {lineItems.map((item, i) => (
                <div key={i} className="flex items-start justify-between text-[11px]">
                  <div className="flex-1 min-w-0 pr-2">
                    <span className="font-bold text-slate-900 block truncate">{item.label}</span>
                    {item.staff && <span className="text-muted-foreground text-[9px] uppercase">{item.staff}</span>}
                  </div>
                  <span className="font-black font-mono text-slate-900 shrink-0">${item.amount.toFixed(2)}</span>
                </div>
              ))}
              <div className="pt-2 border-t border-dashed space-y-1">
                <div className="flex justify-between text-[11px] text-muted-foreground">
                  <span>Subtotal</span><span>${subtotal.toFixed(2)}</span>
                </div>
                {discountValue > 0 && (
                  <div className="flex justify-between text-[11px] text-primary">
                    <span>Discount</span><span>-${discountValue.toFixed(2)}</span>
                  </div>
                )}
                {recoveryAmount > 0 && (
                  <div className="flex justify-between text-[11px] text-amber-600">
                    <span>Service adjustment</span><span>-${recoveryAmount.toFixed(2)}</span>
                  </div>
                )}
                <div className="flex justify-between text-[11px] text-muted-foreground">
                  <span>Tax (7%)</span><span>${tax.toFixed(2)}</span>
                </div>
                {tipAmount > 0 && (
                  <div className="flex justify-between text-[11px] text-muted-foreground">
                    <span>Gratuity</span><span>${tipAmount.toFixed(2)}</span>
                  </div>
                )}
                <div className="flex justify-between text-[12px] font-black pt-1 border-t border-dashed">
                  <span>Total</span><span>${finalTotal.toFixed(2)}</span>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Quick tender */}
      <div className="space-y-2">
        <div className="flex items-center justify-between px-1">
          <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Quick Tender</Label>
          <button
            onClick={() => setAmountTendered(finalTotal)}
            className="text-[9px] font-black uppercase tracking-widest text-primary hover:underline flex items-center gap-1">
            <Zap className="w-2.5 h-2.5" /> Exact
          </button>
        </div>

        {/* Bills */}
        <div className="grid grid-cols-6 gap-1.5">
          {BILLS.map(bill => (
            <button
              key={bill}
              onClick={() => setAmountTendered(Number((amountTendered + bill).toFixed(2)))}
              className={cn(
                'h-11 rounded-xl border-2 font-black text-xs tracking-tight transition-all active:scale-95',
                amountTendered === bill
                  ? 'border-primary bg-primary text-white shadow-lg shadow-primary/20'
                  : 'border-border bg-white text-slate-900 hover:border-primary/30 hover:bg-primary/5'
              )}>
              ${bill}
            </button>
          ))}
        </div>

        {/* Coins — appear when close to total or after tender starts */}
        {showCoins && (
          <div className="grid grid-cols-4 gap-1.5">
            {COINS.map(coin => (
              <button
                key={coin}
                onClick={() => setAmountTendered(Number((amountTendered + coin).toFixed(2)))}
                className="h-9 rounded-xl border-2 font-black text-[10px] tracking-tight transition-all active:scale-95 border-border bg-muted/20 text-muted-foreground hover:border-primary/30 hover:bg-primary/5 hover:text-primary">
                {coin === 1.00 ? '$1' : `¢${(coin * 100).toFixed(0)}`}
              </button>
            ))}
          </div>
        )}

        {/* Smart round-up amounts */}
        <div className="grid grid-cols-3 gap-1.5">
          {quickAmounts.map(amt => (
            <button
              key={amt}
              onClick={() => setAmountTendered(amt)}
              className={cn(
                'h-9 rounded-xl border-2 font-black text-[11px] tracking-tight transition-all active:scale-95',
                Math.abs(amountTendered - amt) < 0.01
                  ? 'border-primary bg-primary text-white'
                  : 'border-primary/20 bg-primary/5 text-primary hover:bg-primary/10'
              )}>
              ${amt % 1 === 0 ? amt : amt.toFixed(2)}
            </button>
          ))}
        </div>
      </div>

      {/* Manual entry */}
      <div className="relative">
        <DollarSign className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-primary opacity-40" />
        <Input
          type="number"
          inputMode="decimal"
          value={amountTendered || ''}
          onChange={e => setAmountTendered(parseFloat(e.target.value) || 0)}
          onFocus={e => e.currentTarget.select()}
          className="h-14 pl-10 text-2xl font-black font-mono border-2 rounded-2xl bg-white shadow-inner text-slate-900"
          placeholder={finalTotal.toFixed(2)}
        />
        {amountTendered > 0 && (
          <button
            onClick={() => setAmountTendered(0)}
            className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-destructive transition-colors">
            <RotateCcw className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Still owed */}
      <AnimatePresence>
        {isUnderpaid && (
          <motion.div
            initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
            className="flex items-center justify-between px-4 py-3 rounded-2xl bg-destructive/5 border-2 border-destructive/20">
            <span className="text-[10px] font-black uppercase text-destructive">Still Owed</span>
            <span className="text-xl font-black font-mono text-destructive">${stillOwed.toFixed(2)}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Change due */}
      <AnimatePresence>
        {hasChange && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
            className="rounded-2xl border-2 border-green-200 bg-green-50 overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4">
              <div>
                <p className="text-[9px] font-black uppercase tracking-widest text-green-700">Change Due</p>
                <p className="text-4xl font-black font-mono text-green-700 tracking-tighter leading-none mt-1">
                  ${change.toFixed(2)}
                </p>
              </div>
              <div className="text-right space-y-2">
                <button
                  onClick={handleKeepChangeAsTip}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-green-600 text-white font-black text-[10px] uppercase tracking-widest hover:bg-green-700 transition-colors active:scale-95 w-full justify-center">
                  <Gift className="w-3.5 h-3.5" /> Keep as Tip
                </button>
                <p className="text-[8px] font-bold text-green-600 opacity-70 uppercase text-center">
                  Tip becomes ${(safeNumber(tipAmount) + change).toFixed(2)}
                </p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Exact badge */}
      <AnimatePresence>
        {isExact && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="flex items-center justify-center gap-2 py-1">
            <CheckCircle2 className="w-4 h-4 text-green-600" />
            <span className="text-[10px] font-black uppercase tracking-widest text-green-700">Exact Change</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Receipt section */}
      <div className="space-y-2 pt-2 border-t border-dashed">
        <div className="flex items-center justify-between px-1">
          <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Receipt</Label>
          <button
            onClick={() => setNoReceipt(v => !v)}
            className={cn(
              'flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest transition-colors',
              noReceipt ? 'text-destructive' : 'text-muted-foreground hover:text-slate-700'
            )}>
            <div className={cn('w-7 h-4 rounded-full relative transition-colors', noReceipt ? 'bg-destructive/20' : 'bg-muted')}>
              <div className={cn('absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-all border',
                noReceipt ? 'left-[14px] border-destructive/40' : 'left-0.5 border-border')} />
            </div>
            No receipt
          </button>
        </div>

        {cashierName && (
          <p className="text-[9px] font-bold text-muted-foreground uppercase px-1">
            <span className="opacity-40">Cashier:</span> {cashierName}
          </p>
        )}

        {!noReceipt && (
          <div className="space-y-2">
            <div className="grid grid-cols-3 gap-2">
              <button
                onClick={handlePrint}
                className="flex flex-col items-center gap-1.5 p-3 rounded-2xl border-2 border-border bg-white hover:border-primary/20 hover:bg-primary/5 transition-all active:scale-95">
                <Printer className="w-5 h-5 text-slate-500" />
                <span className="text-[9px] font-black uppercase">Print</span>
              </button>
              <button
                onClick={() => { setReceiptMode(receiptMode === 'email' ? 'none' : 'email'); setReceiptSent(false); }}
                className={cn(
                  'flex flex-col items-center gap-1.5 p-3 rounded-2xl border-2 transition-all active:scale-95',
                  receiptMode === 'email'
                    ? 'border-primary bg-primary/5 text-primary'
                    : 'border-border bg-white text-slate-500 hover:border-primary/20'
                )}>
                <Mail className="w-5 h-5" />
                <span className="text-[9px] font-black uppercase">Email</span>
              </button>
              <button
                onClick={() => { setReceiptMode(receiptMode === 'sms' ? 'none' : 'sms'); setReceiptSent(false); }}
                className={cn(
                  'flex flex-col items-center gap-1.5 p-3 rounded-2xl border-2 transition-all active:scale-95',
                  receiptMode === 'sms'
                    ? 'border-primary bg-primary/5 text-primary'
                    : 'border-border bg-white text-slate-500 hover:border-primary/20'
                )}>
                <Phone className="w-5 h-5" />
                <span className="text-[9px] font-black uppercase">Text</span>
              </button>
            </div>

            <AnimatePresence>
              {(receiptMode === 'email' || receiptMode === 'sms') && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                  className="space-y-2">
                  <Input
                    type={receiptMode === 'email' ? 'email' : 'tel'}
                    placeholder={receiptMode === 'email' ? 'client@email.com' : '+1 (555) 000-0000'}
                    value={receiptContact}
                    onChange={e => setReceiptContact(e.target.value)}
                    className="h-11 rounded-xl border-2"
                  />
                  <Button
                    onClick={handleSendReceipt}
                    disabled={!receiptContact.trim() || isSending || receiptSent}
                    variant="outline"
                    className="w-full h-10 rounded-xl font-black uppercase text-[10px] tracking-widest border-2">
                    {isSending
                      ? <><Loader className="w-3.5 h-3.5 animate-spin mr-2" /> Sending...</>
                      : receiptSent
                      ? <><CheckCircle2 className="w-3.5 h-3.5 mr-2 text-green-600" /> Sent</>
                      : receiptMode === 'email'
                      ? <><Mail className="w-3.5 h-3.5 mr-2" /> Send Email Receipt</>
                      : <><Phone className="w-3.5 h-3.5 mr-2" /> Send Text Receipt</>}
                  </Button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {noReceipt && (
          <p className="text-[9px] font-bold text-destructive/60 uppercase text-center py-1">
            No receipt — guest declined
          </p>
        )}
      </div>

      {/* Collect button */}
      <Button
        className="w-full h-16 text-xl font-black rounded-3xl shadow-2xl shadow-primary/30 transition-all hover:scale-105 active:scale-95 uppercase tracking-tight"
        onClick={onCheckout}
        disabled={!canCheckout || isSubmitting}>
        {isSubmitting
          ? <Loader className="animate-spin h-7 w-7" />
          : finalTotal <= 0
          ? 'Finalize Free Session'
          : hasChange
          ? <span className="flex items-center"><Banknote className="w-6 h-6 mr-2" /> Collect ${amountTendered.toFixed(2)} · Change ${change.toFixed(2)}</span>
          : isExact
          ? <span className="flex items-center"><Banknote className="w-6 h-6 mr-2" /> Collect ${finalTotal.toFixed(2)} · Exact</span>
          : <span className="flex items-center"><Banknote className="w-6 h-6 mr-2" /> Collect ${finalTotal.toFixed(2)}</span>}
      </Button>

      {!canCheckout && !isSubmitting && isUnderpaid && (
        <p className="text-center text-[9px] font-black uppercase tracking-widest text-destructive opacity-70">
          ${stillOwed.toFixed(2)} more needed
        </p>
      )}
    </div>
  );
}
