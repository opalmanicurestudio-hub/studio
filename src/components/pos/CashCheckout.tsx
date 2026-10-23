'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { safeNumber } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { useTenant } from '@/context/TenantContext';
import { staffAuthHeader } from '@/lib/staff-fetch';
import { Icon } from '@/components/pos/desk/kit';
import { PRINT_FONT_HREF, PRINT_FONT_STACK } from '@/lib/print-style';

const esc =(v: any) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

const BILLS = [1, 5, 10, 20, 50, 100];

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
  taxLabel?:          string;
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
  taxLabel = 'Sales tax',
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
  const [fromChange,     setFromChange]     = useState(0);      // how much of the tip came out of their change
  const [partOpen,       setPartOpen]       = useState(false);
  const [partAmt,        setPartAmt]        = useState('');
  const [noReceipt,      setNoReceipt]      = useState(false);

  const change      = Math.max(0, amountTendered - finalTotal);
  const hasChange   = change > 0.005;
  const isExact     = Math.abs(amountTendered - finalTotal) < 0.01 && amountTendered > 0;
  const isUnderpaid = amountTendered > 0 && amountTendered < finalTotal - 0.005;
  const stillOwed   = Math.max(0, finalTotal - amountTendered);
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

  // Cash tips: the total comes first; then the client chooses — their change, all of it as a tip, or part of it.
  const keepAsTip = useCallback((amt: number) => {
    const a = Math.round(Math.min(change, Math.max(0, amt)) * 100) / 100; if (a <= 0) return;
    onTipChange(Number((safeNumber(tipAmount) + a).toFixed(2))); setFromChange((f) => Math.round((f + a) * 100) / 100); setPartOpen(false); setPartAmt('');
  }, [change, tipAmount, onTipChange]);
  const undoTip = useCallback(() => { onTipChange(Math.max(0, Number((safeNumber(tipAmount) - fromChange).toFixed(2)))); setFromChange(0); }, [tipAmount, fromChange, onTipChange]);
  useEffect(() => { if (amountTendered === 0 && fromChange > 0) undoTip(); }, [amountTendered]); // eslint-disable-line react-hooks/exhaustive-deps

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
      const res = await fetch('/api/notifications/send-receipt', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', ...(await staffAuthHeader()) },
        body:    JSON.stringify({
          contact: receiptContact.trim(),
          type:    isEmail ? 'email' : 'sms',
          receipt: buildReceiptPayload(),
          // Lets the receipt wear the shop's own brand color, like every
          // other email the business sends.
          tenantId: selectedTenant?.id || undefined,
        }),
      });
      if (!res.ok) throw new Error('not sent');
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
    // A narrow receipt in the app's print look (lib/print-style), kept to solid black ink so it also prints cleanly
    // on a thermal receipt printer: hierarchy comes from weight and size, never from grey.
    win.document.write(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Receipt</title>
      <link rel="preconnect" href="https://fonts.googleapis.com"><link href="${PRINT_FONT_HREF}" rel="stylesheet">
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: ${PRINT_FONT_STACK}; font-size: 12.5px; line-height: 1.45; font-weight: 400; color: #000; background: #fff; font-variant-numeric: tabular-nums; padding: 20px 16px; max-width: 300px; margin: 0 auto; }
        h1 { font-size: 15px; text-align: center; font-weight: 600; margin-bottom: 3px; }
        .sub { text-align: center; font-size: 11px; line-height: 1.6; margin-bottom: 12px; }
        hr { border: none; border-top: 1px dashed #000; margin: 10px 0; }
        .row { display: flex; justify-content: space-between; gap: 12px; margin: 3px 0; }
        .row span:last-child { white-space: nowrap; }
        .muted { font-size: 12px; }
        .bold { font-weight: 600; }
        .total { font-size: 14px; font-weight: 600; border-top: 1px solid #000; padding-top: 7px; margin-top: 6px; }
        .footer { text-align: center; margin-top: 18px; font-size: 11px; line-height: 1.8; }
        @media print { body { padding: 0; } }
      </style></head><body>
      <h1>${esc(r.studioName)}</h1>
      <div class="sub">${r.date}<br>Guest: ${esc(r.clientName)}${r.cashierName ? `<br>Served by: ${esc(r.cashierName)}` : ''}</div>
      <hr>
      ${r.lineItems.map(l => `<div class="row"><span>${esc(l.label)}${l.staff ? ` · ${esc(l.staff)}` : ''}</span><span>$${l.amount.toFixed(2)}</span></div>`).join('')}
      <hr>
      <div class="row muted"><span>Subtotal</span><span>$${r.subtotal.toFixed(2)}</span></div>
      ${r.discount > 0 ? `<div class="row muted"><span>Discount</span><span>-$${r.discount.toFixed(2)}</span></div>` : ''}
      ${r.recovery > 0 ? `<div class="row muted"><span>Service adjustment</span><span>-$${r.recovery.toFixed(2)}</span></div>` : ''}
      <div class="row muted"><span>${esc(taxLabel)}</span><span>$${r.tax.toFixed(2)}</span></div>
      ${r.tip > 0 ? `<div class="row muted"><span>Tip</span><span>$${r.tip.toFixed(2)}</span></div>` : ''}
      <div class="row total"><span>Total</span><span>$${r.total.toFixed(2)}</span></div>
      <hr>
      <div class="row bold"><span>Cash tendered</span><span>$${r.tendered.toFixed(2)}</span></div>
      ${r.change > 0.005 ? `<div class="row bold"><span>Change returned</span><span>$${r.change.toFixed(2)}</span></div>` : ''}
      <div class="footer">Thank you, ${esc(r.clientName.split(' ')[0])}.${r.studioPhone ? `<br>${esc(r.studioPhone)}` : ''}</div>
      </body></html>`);
    win.document.close();
    setTimeout(() => { win.print(); }, 300);
  };

  const muted = { color: 'var(--muted)' } as React.CSSProperties;
  const tile = 'flex h-14 items-center justify-center rounded-2xl text-[16px] font-semibold tabular-nums transition active:scale-[.97]';
  const money = (n: number) => `$${n % 1 === 0 ? n.toFixed(0) : n.toFixed(2)}`;
  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3">
        <div><p className="text-[12px]" style={muted}>Total due</p><p className="text-[34px] font-light leading-none tracking-tight tabular-nums">${finalTotal.toFixed(2)}</p></div>
        {lineItems.length > 0 && <button type="button" onClick={() => setShowLines((v) => !v)} aria-expanded={showLines} className="flex items-center gap-1 text-[13px] font-semibold" style={muted}>
          {showLines ? 'Hide' : 'Show'} items<Icon name="chevron" size={14} className={showLines ? '-rotate-90' : 'rotate-90'} /></button>}
      </div>
      <AnimatePresence>{showLines && lineItems.length > 0 && (
        <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
          <div className="space-y-1.5 rounded-2xl p-3.5 text-[13.5px]" style={{ background: 'var(--soft)' }}>
            {lineItems.map((item, i) => <div key={i} className="flex justify-between gap-3"><span className="min-w-0 truncate">{item.label}{item.staff ? <span style={muted}> · {item.staff}</span> : null}</span><span className="tabular-nums">${item.amount.toFixed(2)}</span></div>)}
            <div className="space-y-1 pt-1.5" style={{ borderTop: '1px solid var(--line)' }}>
              <div className="flex justify-between" style={muted}><span>Subtotal</span><span className="tabular-nums">${subtotal.toFixed(2)}</span></div>
              {discountValue > 0 && <div className="flex justify-between" style={muted}><span>Discount</span><span className="tabular-nums">−${discountValue.toFixed(2)}</span></div>}
              {recoveryAmount > 0 && <div className="flex justify-between" style={muted}><span>Service recovery</span><span className="tabular-nums">−${recoveryAmount.toFixed(2)}</span></div>}
              <div className="flex justify-between" style={muted}><span>{taxLabel}</span><span className="tabular-nums">${tax.toFixed(2)}</span></div>
              {tipAmount > 0 && <div className="flex justify-between" style={muted}><span>Tip</span><span className="tabular-nums">${tipAmount.toFixed(2)}</span></div>}
            </div>
          </div>
        </motion.div>)}</AnimatePresence>

      <div className="space-y-2">
        <div className="flex items-center justify-between"><p className="text-[13px] font-semibold">Cash given</p>
          <div className="flex gap-3 text-[13px] font-semibold">
            <button type="button" onClick={() => setAmountTendered(finalTotal)} className="underline underline-offset-4">Exact</button>
            {amountTendered > 0 && <button type="button" onClick={() => setAmountTendered(0)} className="underline underline-offset-4" style={muted}>Clear</button>}</div></div>
        <div className="grid grid-cols-3 gap-2">{quickAmounts.map((amt) => { const on = Math.abs(amountTendered - amt) < 0.01;
          return <button key={amt} type="button" aria-pressed={on} onClick={() => setAmountTendered(amt)} className={tile} style={on ? { background: 'var(--accent)', color: 'var(--accent-ink)' } : { background: 'var(--soft)' }}>{money(amt)}</button>; })}</div>
        <div className="grid grid-cols-6 gap-1.5">{BILLS.map((bill) => (
          <button key={bill} type="button" onClick={() => setAmountTendered(Number((amountTendered + bill).toFixed(2)))} aria-label={`Add a $${bill} bill`} className="h-11 rounded-xl text-[14px] font-semibold tabular-nums transition active:scale-[.96]" style={{ border: '1px solid var(--line)' }}>+${bill}</button>))}</div>
        <input aria-label="Cash amount received from the client" type="number" inputMode="decimal" value={amountTendered || ''} onChange={(e) => setAmountTendered(parseFloat(e.target.value) || 0)} onFocus={(e) => e.currentTarget.select()}
          placeholder={`Or type the amount (${finalTotal.toFixed(2)})`} className="h-12 w-full rounded-xl px-4 text-[18px] tabular-nums outline-none" style={{ background: 'var(--paper)', border: '1px solid var(--line)', color: 'var(--ink)' }} />
      </div>

      <AnimatePresence mode="popLayout">
        {isUnderpaid && <motion.div key="owed" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex items-center justify-between rounded-2xl px-4 py-3" style={{ background: 'color-mix(in srgb, var(--warn) 10%, transparent)' }}>
          <span className="text-[14px] font-semibold" style={{ color: 'var(--warn)' }}>Still to pay</span><span className="text-[22px] font-light tabular-nums" style={{ color: 'var(--warn)' }}>${stillOwed.toFixed(2)}</span></motion.div>}
        {(hasChange || fromChange > 0) && <motion.section key="change" aria-label="Change" initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="space-y-3 rounded-2xl p-4" style={{ background: 'color-mix(in srgb, var(--ok) 9%, var(--card))', border: '1px solid color-mix(in srgb, var(--ok) 30%, transparent)' }}>
          <div className="flex items-end justify-between gap-3">
            <div><p className="text-[12px]" style={{ color: 'var(--ok)' }}>{hasChange ? 'Change to give back' : 'No change to give back'}</p><p className="text-[38px] font-light leading-none tracking-tight tabular-nums">${change.toFixed(2)}</p></div>
            {fromChange > 0 && <div className="text-right text-[13px]"><p>${fromChange.toFixed(2)} kept as a tip</p><button type="button" onClick={undoTip} className="font-semibold underline underline-offset-4">Undo</button></div>}
          </div>
          {hasChange && <>
            <p className="text-[13px]" style={muted}>Ask what they’d like to do with their change.</p>
            <div className="grid grid-cols-3 gap-2">
              <button type="button" onClick={() => { setPartOpen(false); }} className="rounded-2xl px-2 py-3 text-[13px] font-semibold" style={{ background: 'var(--card)', border: '1px solid var(--line)' }}>Give change</button>
              <button type="button" onClick={() => keepAsTip(change)} className="rounded-2xl px-2 py-3 text-[13px] font-semibold" style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}>Keep as tip</button>
              <button type="button" onClick={() => setPartOpen((v) => !v)} aria-expanded={partOpen} className="rounded-2xl px-2 py-3 text-[13px] font-semibold" style={{ background: 'var(--card)', border: '1px solid var(--line)' }}>Keep part</button>
            </div>
            {partOpen && <div className="flex gap-2">
              <input autoFocus type="number" inputMode="decimal" value={partAmt} onChange={(e) => setPartAmt(e.target.value)} placeholder={`Up to ${change.toFixed(2)}`} aria-label="How much of the change to keep as a tip" className="h-11 min-w-0 flex-1 rounded-xl px-3.5 text-[16px] tabular-nums outline-none" style={{ background: 'var(--paper)', border: '1px solid var(--line)', color: 'var(--ink)' }} />
              <button type="button" disabled={!(parseFloat(partAmt) > 0)} onClick={() => keepAsTip(parseFloat(partAmt) || 0)} className="h-11 rounded-full px-5 text-[14px] font-semibold disabled:opacity-40" style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}>Keep</button>
            </div>}
          </>}
        </motion.section>}
        {isExact && !fromChange && <motion.p key="exact" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex items-center justify-center gap-1.5 text-[13px] font-semibold" style={{ color: 'var(--ok)' }}><Icon name="check" size={16} />Exact amount</motion.p>}
      </AnimatePresence>

      <div className="space-y-2">
        <p className="text-[13px] font-semibold">Receipt{cashierName ? <span className="font-normal" style={muted}> · served by {cashierName}</span> : null}</p>
        <div className="grid grid-cols-4 gap-1.5">{([['print', 'Print', 'printer'], ['email', 'Email', 'mail'], ['sms', 'Text', 'message'], ['none', 'None', 'close']] as const).map(([k, l, ic]) => {
          const on = k === 'none' ? noReceipt : k === 'print' ? false : !noReceipt && receiptMode === k;
          return <button key={k} type="button" aria-pressed={on} onClick={() => { if (k === 'print') { setNoReceipt(false); handlePrint(); } else if (k === 'none') { setNoReceipt((v) => !v); setReceiptMode('none'); } else { setNoReceipt(false); setReceiptMode(receiptMode === k ? 'none' : k); setReceiptSent(false); } }}
            className="flex h-16 flex-col items-center justify-center gap-1 rounded-2xl text-[12.5px] font-semibold" style={on ? { background: 'var(--accent)', color: 'var(--accent-ink)' } : { background: 'var(--soft)' }}><Icon name={ic} size={18} />{l}</button>; })}</div>
        {!noReceipt && (receiptMode === 'email' || receiptMode === 'sms') && <div className="flex gap-2">
          <input aria-label={receiptMode === 'email' ? 'Email address for the receipt' : 'Phone number for the receipt'} autoComplete={receiptMode === 'email' ? 'email' : 'tel'} type={receiptMode === 'email' ? 'email' : 'tel'}
            placeholder={receiptMode === 'email' ? 'name@email.com' : '(555) 000-0000'} value={receiptContact} onChange={(e) => setReceiptContact(e.target.value)} className="h-11 min-w-0 flex-1 rounded-xl px-3.5 text-[15px] outline-none" style={{ background: 'var(--paper)', border: '1px solid var(--line)', color: 'var(--ink)' }} />
          <button type="button" onClick={handleSendReceipt} disabled={!receiptContact.trim() || isSending || receiptSent} className="h-11 shrink-0 rounded-full px-4 text-[14px] font-semibold disabled:opacity-50" style={{ background: 'var(--soft)' }}>{isSending ? 'Sending…' : receiptSent ? 'Sent' : 'Send'}</button>
        </div>}
      </div>

      <button type="button" onClick={onCheckout} disabled={!canCheckout || isSubmitting} className="flex h-14 w-full items-center justify-center gap-2 rounded-full text-[16px] font-semibold transition active:scale-[.99] disabled:opacity-40" style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}>
        {isSubmitting ? 'Saving…' : finalTotal <= 0 ? 'Complete (nothing to pay)' : <><Icon name="cash" size={20} />{hasChange ? `Take $${amountTendered.toFixed(2)} · give $${change.toFixed(2)} back` : `Take $${finalTotal.toFixed(2)}`}</>}
      </button>
      {!canCheckout && !isSubmitting && isUnderpaid && <p className="text-center text-[13px]" style={{ color: 'var(--warn)' }}>${stillOwed.toFixed(2)} more needed</p>}
    </div>
  );
}
