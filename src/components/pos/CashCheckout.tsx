'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn, safeNumber } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Banknote, DollarSign, CheckCircle2, Loader, Printer,
  Mail, Phone, Gift, ArrowRight, RotateCcw, Zap,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useTenant } from '@/context/TenantContext';

// ─── Bill denominations ───────────────────────────────────────────────────────
const BILLS = [1, 5, 10, 20, 50, 100];

// ─── Receipt dialog ───────────────────────────────────────────────────────────
type ReceiptMode = 'none' | 'print' | 'email' | 'sms';

interface CashCheckoutProps {
  finalTotal:       number;
  amountTendered:   number;
  setAmountTendered:(v: number) => void;
  tipAmount:        number;
  onTipChange:      (v: number) => void;
  onCheckout:       () => void;
  isSubmitting:     boolean;
  isCartEmpty:      boolean;
  isGroupCheckout:  boolean;
  selectedClientId: string | null;
  isOverAutonomy:   boolean;
  isOverrideUnlocked: boolean;
  clientEmail?:     string;
  clientPhone?:     string;
}

export function CashCheckout({
  finalTotal,
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
  clientEmail,
  clientPhone,
}: CashCheckoutProps) {
  const { toast }            = useToast();
  const { selectedTenant }   = useTenant();
  const [receiptMode,  setReceiptMode]  = useState<ReceiptMode>('none');
  const [receiptSent,  setReceiptSent]  = useState(false);
  const [isSending,    setIsSending]    = useState(false);
  const [receiptContact, setReceiptContact] = useState('');

  const change         = Math.max(0, amountTendered - finalTotal);
  const hasChange      = change > 0;
  const isExact        = amountTendered === finalTotal;
  const isUnderpaid    = amountTendered > 0 && amountTendered < finalTotal;
  const stillOwed      = Math.max(0, finalTotal - amountTendered);
  const canCheckout    = amountTendered >= finalTotal && finalTotal > 0 && !isCartEmpty && !(isGroupCheckout && !selectedClientId) && !(isOverAutonomy && !isOverrideUnlocked);

  // Auto-fill contact from client profile
  useEffect(() => {
    if (clientEmail && !receiptContact) setReceiptContact(clientEmail);
  }, [clientEmail]);

  // Quick tender amounts — smart set of bills that covers the total
  const quickAmounts = React.useMemo(() => {
    const results: number[] = [];
    // Exact (if total is clean)
    if (Number.isInteger(finalTotal)) results.push(finalTotal);
    // Round up to nearest bill denominations
    for (const bill of BILLS) {
      const rounded = Math.ceil(finalTotal / bill) * bill;
      if (rounded >= finalTotal && !results.includes(rounded)) results.push(rounded);
      if (results.length >= 5) break;
    }
    return [...new Set(results)].sort((a, b) => a - b).slice(0, 5);
  }, [finalTotal]);

  const handleKeepChangeAsTip = useCallback(() => {
    if (change <= 0) return;
    onTipChange(safeNumber(tipAmount) + change);
    setAmountTendered(finalTotal + safeNumber(tipAmount) + change);
    toast({ title: `$${change.toFixed(2)} added to tip` });
  }, [change, tipAmount, onTipChange, setAmountTendered, finalTotal, toast]);

  const handleSendReceipt = async () => {
    if (!receiptContact.trim()) return;
    setIsSending(true);
    try {
      const isEmail = receiptContact.includes('@');
      await fetch('/api/notifications/send-receipt', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          contact:     receiptContact.trim(),
          type:        isEmail ? 'email' : 'sms',
          total:       finalTotal,
          tendered:    amountTendered,
          change,
          tip:         tipAmount,
          studioName:  selectedTenant?.name || 'Studio',
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
    window.print();
    toast({ title: 'Print dialog opened' });
  };

  return (
    <div className="space-y-4">

      {/* ── Amount Due banner ── */}
      <div className="flex items-center justify-between px-1">
        <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Amount Due</span>
        <span className="text-2xl font-black font-mono text-primary tracking-tighter">${finalTotal.toFixed(2)}</span>
      </div>

      {/* ── Quick tender bill buttons ── */}
      <div className="space-y-2">
        <div className="flex items-center justify-between px-1">
          <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Quick Tender</Label>
          <button
            onClick={() => setAmountTendered(finalTotal)}
            className="text-[9px] font-black uppercase tracking-widest text-primary hover:underline flex items-center gap-1">
            <Zap className="w-2.5 h-2.5" /> Exact
          </button>
        </div>
        <div className="grid grid-cols-5 gap-1.5">
          {BILLS.map(bill => {
            const isSelected = amountTendered === bill;
            const canUse     = bill >= finalTotal || amountTendered > 0;
            return (
              <button
                key={bill}
                onClick={() => setAmountTendered(prev => {
                  // First tap sets to bill, subsequent taps add bills
                  if (prev === 0 || prev === bill) return bill;
                  return prev + bill;
                })}
                className={cn(
                  'h-12 rounded-2xl border-2 font-black text-sm tracking-tight transition-all active:scale-95',
                  amountTendered === bill
                    ? 'border-primary bg-primary text-white shadow-lg shadow-primary/20'
                    : 'border-border bg-white text-slate-900 hover:border-primary/30 hover:bg-primary/5'
                )}>
                ${bill}
              </button>
            );
          })}
        </div>
        {/* Common combos row */}
        <div className="grid grid-cols-3 gap-1.5">
          {quickAmounts.filter(a => a > finalTotal || a === finalTotal).slice(0, 3).map(amt => (
            <button
              key={amt}
              onClick={() => setAmountTendered(amt)}
              className={cn(
                'h-9 rounded-xl border-2 font-black text-[11px] tracking-tight transition-all active:scale-95',
                amountTendered === amt
                  ? 'border-primary bg-primary text-white'
                  : 'border-primary/20 bg-primary/5 text-primary hover:bg-primary/10'
              )}>
              ${amt.toFixed(amt % 1 === 0 ? 0 : 2)}
            </button>
          ))}
        </div>
      </div>

      {/* ── Manual entry ── */}
      <div className="relative">
        <DollarSign className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-primary opacity-40" />
        <Input
          type="number"
          inputMode="decimal"
          value={amountTendered || ''}
          onChange={e => setAmountTendered(parseFloat(e.target.value) || 0)}
          onFocus={e => e.currentTarget.select()}
          className="h-14 pl-10 text-2xl font-black font-mono border-2 rounded-2xl bg-white shadow-inner text-slate-900"
          placeholder={`${finalTotal.toFixed(2)}`}
        />
        {amountTendered > 0 && (
          <button
            onClick={() => setAmountTendered(0)}
            className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-destructive transition-colors">
            <RotateCcw className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* ── Still owed warning ── */}
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

      {/* ── Change due — big display ── */}
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

      {/* ── Exact change badge ── */}
      <AnimatePresence>
        {isExact && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="flex items-center justify-center gap-2 py-2">
            <CheckCircle2 className="w-4 h-4 text-green-600" />
            <span className="text-[10px] font-black uppercase tracking-widest text-green-700">Exact Change</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Receipt options ── */}
      <div className="space-y-2 pt-2 border-t border-dashed">
        <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground px-1">Receipt</Label>
        <div className="grid grid-cols-3 gap-2">
          <button
            onClick={handlePrint}
            className="flex flex-col items-center gap-1.5 p-3 rounded-2xl border-2 border-border bg-white hover:border-primary/20 hover:bg-primary/5 transition-all active:scale-95">
            <Printer className="w-5 h-5 text-slate-500" />
            <span className="text-[9px] font-black uppercase">Print</span>
          </button>
          <button
            onClick={() => setReceiptMode(receiptMode === 'email' ? 'none' : 'email')}
            className={cn('flex flex-col items-center gap-1.5 p-3 rounded-2xl border-2 transition-all active:scale-95',
              receiptMode === 'email'
                ? 'border-primary bg-primary/5 text-primary'
                : 'border-border bg-white text-slate-500 hover:border-primary/20')}>
            <Mail className="w-5 h-5" />
            <span className="text-[9px] font-black uppercase">Email</span>
          </button>
          <button
            onClick={() => setReceiptMode(receiptMode === 'sms' ? 'none' : 'sms')}
            className={cn('flex flex-col items-center gap-1.5 p-3 rounded-2xl border-2 transition-all active:scale-95',
              receiptMode === 'sms'
                ? 'border-primary bg-primary/5 text-primary'
                : 'border-border bg-white text-slate-500 hover:border-primary/20')}>
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
                  : <>{receiptMode === 'email' ? <Mail className="w-3.5 h-3.5 mr-2" /> : <Phone className="w-3.5 h-3.5 mr-2" />} Send Receipt</>}
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── Collect button ── */}
      <Button
        className="w-full h-16 text-xl font-black rounded-3xl shadow-2xl shadow-primary/30 transition-all hover:scale-105 active:scale-95 uppercase tracking-tight"
        onClick={onCheckout}
        disabled={!canCheckout || isSubmitting}>
        {isSubmitting
          ? <Loader className="animate-spin h-7 w-7" />
          : finalTotal <= 0
          ? 'Finalize Free Session'
          : amountTendered > finalTotal
          ? <><Banknote className="w-6 h-6 mr-2" /> Collect ${amountTendered.toFixed(2)} · Change ${change.toFixed(2)}</>
          : <><Banknote className="w-6 h-6 mr-2" /> Collect ${finalTotal.toFixed(2)}{isExact ? ' · Exact' : ''}</>}
      </Button>

      {!canCheckout && !isSubmitting && amountTendered > 0 && amountTendered < finalTotal && (
        <p className="text-center text-[9px] font-black uppercase tracking-widest text-destructive opacity-70">
          ${stillOwed.toFixed(2)} more needed to complete
        </p>
      )}
    </div>
  );
}