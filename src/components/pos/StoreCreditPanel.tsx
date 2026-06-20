'use client';

/**
 * StoreCreditPanel
 *
 * Surface 1: POS / CheckoutHub
 *
 * Appears automatically above the payment method buttons when the
 * client has available store credit. Staff see the balance and can:
 *   1. Tap "Apply Credit" → slider/input appears to choose amount
 *   2. Confirm → calls /api/stripe/apply-store-credit, updates UI
 *
 * The panel is self-contained — pass it the total owed and it
 * computes what's left to charge after credit is applied.
 *
 * Props:
 *   client           — full client object (reads storeCredits array)
 *   totalOwed        — current checkout total before credit
 *   tenantId
 *   appointmentId    — the appointment being checked out
 *   staffId          — who is applying the credit
 *   onCreditApplied  — called with { appliedAmount, remainingBalance }
 *                      so CheckoutHub can adjust its total display
 */

import React, { useState, useMemo } from 'react';
import { Wallet, ChevronDown, ChevronUp, Check, Loader } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useStoreCredit, formatCreditExpiry, isCreditExpiringSoon } from '@/hooks/useStoreCredit';
import { motion, AnimatePresence } from 'framer-motion';
import type { Client } from '@/lib/data';
import { useToast } from '@/hooks/use-toast';

interface Props {
  client: Client | null | undefined;
  totalOwed: number;
  tenantId: string;
  appointmentId: string;
  staffId: string;
  onCreditApplied: (result: { appliedAmount: number; remainingBalance: number }) => void;
  appliedAmount?: number; // controlled — if credit was already applied this session
}

export const StoreCreditPanel: React.FC<Props> = ({
  client,
  totalOwed,
  tenantId,
  appointmentId,
  staffId,
  onCreditApplied,
  appliedAmount = 0,
}) => {
  const { availableCredits, totalAvailable, applyCredit, isApplying } = useStoreCredit(client);
  const { toast } = useToast();

  const [isExpanded,      setIsExpanded]      = useState(false);
  const [chosenAmount,    setChosenAmount]     = useState(0);
  const [inputVal,        setInputVal]         = useState('');
  const [isApplied,       setIsApplied]        = useState(appliedAmount > 0);

  // Max we can apply = min(available credit, total owed)
  const maxApplicable = useMemo(
    () => parseFloat(Math.min(totalAvailable, totalOwed).toFixed(2)),
    [totalAvailable, totalOwed],
  );

  // Don't render if nothing available or already fully applied
  if (totalAvailable <= 0) return null;
  if (isApplied && appliedAmount > 0) {
    return (
      <div className="flex items-center justify-between p-4 rounded-2xl border-2 border-green-300 bg-green-50">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-green-500 flex items-center justify-center">
            <Check className="w-4 h-4 text-white" />
          </div>
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-green-700">Store Credit Applied</p>
            <p className="text-[9px] font-bold text-green-600 uppercase opacity-70">
              −${appliedAmount.toFixed(2)} · ${(totalAvailable - appliedAmount).toFixed(2)} remaining
            </p>
          </div>
        </div>
        <p className="text-xl font-black font-mono text-green-700">−${appliedAmount.toFixed(2)}</p>
      </div>
    );
  }

  const handleExpand = () => {
    setChosenAmount(maxApplicable);
    setInputVal(maxApplicable.toFixed(2));
    setIsExpanded(v => !v);
  };

  const handleSlider = (val: number[]) => {
    const v = parseFloat(val[0].toFixed(2));
    setChosenAmount(v);
    setInputVal(v.toFixed(2));
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputVal(e.target.value);
    const parsed = parseFloat(e.target.value);
    if (!isNaN(parsed)) setChosenAmount(Math.min(parsed, maxApplicable));
  };

  const handleApply = async () => {
    if (chosenAmount <= 0) return;
    const result = await applyCredit({ tenantId, appointmentId, amountToApply: chosenAmount, staffId });
    if (result.ok) {
      setIsApplied(true);
      setIsExpanded(false);
      onCreditApplied({ appliedAmount: result.appliedAmount, remainingBalance: result.remainingBalance });
      toast({ title: 'Credit Applied', description: `$${result.appliedAmount.toFixed(2)} applied — $${result.remainingBalance.toFixed(2)} remaining to charge.` });
    } else {
      toast({ variant: 'destructive', title: 'Could not apply credit', description: result.error });
    }
  };

  const expiringSoon = availableCredits.some(c => isCreditExpiringSoon(c.expiresAt, 14));

  return (
    <div className={cn(
      'rounded-2xl border-2 overflow-hidden transition-all',
      expiringSoon ? 'border-amber-300 bg-amber-50' : 'border-green-300 bg-green-50',
    )}>
      {/* ── Header — always visible ── */}
      <button
        onClick={handleExpand}
        className="w-full flex items-center justify-between p-4 text-left"
      >
        <div className="flex items-center gap-3">
          <div className={cn(
            'w-8 h-8 rounded-xl flex items-center justify-center shrink-0',
            expiringSoon ? 'bg-amber-400' : 'bg-green-500',
          )}>
            <Wallet className="w-4 h-4 text-white" />
          </div>
          <div>
            <p className={cn('text-[10px] font-black uppercase tracking-widest', expiringSoon ? 'text-amber-700' : 'text-green-700')}>
              Store Credit Available
            </p>
            <p className={cn('text-[9px] font-bold uppercase opacity-70', expiringSoon ? 'text-amber-600' : 'text-green-600')}>
              {availableCredits.length} credit{availableCredits.length !== 1 ? 's' : ''} ·{' '}
              {expiringSoon
                ? formatCreditExpiry(availableCredits.find(c => isCreditExpiringSoon(c.expiresAt, 14))?.expiresAt || null)
                : 'never expires'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <p className={cn('text-xl font-black font-mono', expiringSoon ? 'text-amber-700' : 'text-green-700')}>
            ${totalAvailable.toFixed(2)}
          </p>
          {isExpanded
            ? <ChevronUp className={cn('w-4 h-4', expiringSoon ? 'text-amber-500' : 'text-green-500')} />
            : <ChevronDown className={cn('w-4 h-4', expiringSoon ? 'text-amber-500' : 'text-green-500')} />}
        </div>
      </button>

      {/* ── Expanded: amount chooser ── */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 space-y-4 border-t border-green-200">
              <div className="pt-4 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-[9px] font-black uppercase tracking-widest text-green-700">Amount to apply</p>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold text-green-600">$</span>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      max={maxApplicable}
                      value={inputVal}
                      onChange={handleInputChange}
                      className="h-8 w-24 rounded-xl border-2 border-green-300 bg-white text-center font-black text-sm focus-visible:ring-green-400"
                    />
                  </div>
                </div>
                <Slider
                  min={0}
                  max={maxApplicable}
                  step={0.01}
                  value={[chosenAmount]}
                  onValueChange={handleSlider}
                  className="[&_.slider-thumb]:bg-green-500 [&_.slider-track]:bg-green-200 [&_.slider-range]:bg-green-500"
                />
                <div className="flex justify-between text-[8px] font-bold text-green-600 uppercase opacity-60">
                  <span>$0</span>
                  <span className="text-green-700 font-black">Max ${maxApplicable.toFixed(2)}</span>
                </div>
              </div>

              {/* Preview */}
              {chosenAmount > 0 && (
                <div className="p-3 rounded-xl bg-white border border-green-200 space-y-1.5">
                  <div className="flex justify-between text-[9px] font-bold uppercase text-slate-500">
                    <span>Credit applied</span>
                    <span className="text-green-600 font-black">−${chosenAmount.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-[10px] font-black uppercase text-slate-900">
                    <span>Remaining to charge</span>
                    <span>${Math.max(0, totalOwed - chosenAmount).toFixed(2)}</span>
                  </div>
                </div>
              )}

              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  onClick={() => setIsExpanded(false)}
                  className="flex-1 h-10 rounded-xl font-black uppercase text-[9px] tracking-widest text-green-700 hover:bg-green-100"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleApply}
                  disabled={chosenAmount <= 0 || isApplying}
                  className="flex-[2] h-10 rounded-xl font-black uppercase text-[9px] tracking-widest bg-green-600 hover:bg-green-700 text-white shadow-lg shadow-green-500/20"
                >
                  {isApplying
                    ? <Loader className="w-4 h-4 animate-spin" />
                    : `Apply $${chosenAmount.toFixed(2)}`}
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
