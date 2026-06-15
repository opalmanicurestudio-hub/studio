'use client';

// ─── ReceiptPreviewDialog ──────────────────────────────────────────────────────
// Drop-in replacement for the old image-based ReceiptPreviewDialog.
// Fetches the receipt doc from tenants/{tenantId}/receipts using the
// transaction's receiptId field, then renders it as a thermal-style receipt.
// Also provides a reprint button.
//
// USAGE in ledger/page.tsx:
//   1. Remove the old ReceiptPreviewDialog component at the top of the file
//   2. Import this instead:
//        import { ReceiptPreviewDialog } from '@/components/ledger/ReceiptPreviewDialog';
//   3. Change the dialog usage from:
//        <ReceiptPreviewDialog url={previewTransaction.receiptUrl || ''} ... />
//      to:
//        <ReceiptPreviewDialog transaction={previewTransaction} tenantId={tenantId || ''} ... />

import React, { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader, Printer, FileX, Receipt, CreditCard, Banknote, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { useFirebase } from '@/firebase';
import { doc, getDoc } from 'firebase/firestore';

type ReceiptLineItem = { label: string; amount: number; type?: string; staff?: string };

type ReceiptDoc = {
  id: string;
  checkoutSessionId: string;
  clientName: string;
  cashierName?: string;
  studioName?: string;
  date: string;
  paymentMethod: string;
  lineItems: ReceiptLineItem[];
  subtotal: number;
  tax: number;
  tip: number;
  discount: number;
  total: number;
  tendered: number;
  change: number;
};

interface ReceiptPreviewDialogProps {
  transaction:   { id: string; receiptId?: string; checkoutSessionId?: string; description: string; amount: number; paymentMethod?: string } | null;
  tenantId:      string;
  open:          boolean;
  onOpenChange:  (open: boolean) => void;
}

export function ReceiptPreviewDialog({ transaction, tenantId, open, onOpenChange }: ReceiptPreviewDialogProps) {
  const { firestore } = useFirebase();
  const [receipt,  setReceipt]  = useState<ReceiptDoc | null>(null);
  const [loading,  setLoading]  = useState(false);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!open || !transaction || !firestore || !tenantId) return;
    const receiptId = transaction.receiptId;
    if (!receiptId) { setNotFound(true); return; }
    setLoading(true);
    setReceipt(null);
    setNotFound(false);
    getDoc(doc(firestore, `tenants/${tenantId}/receipts`, receiptId))
      .then(snap => {
        if (snap.exists()) setReceipt(snap.data() as ReceiptDoc);
        else setNotFound(true);
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [open, transaction?.id, tenantId, firestore]);

  const handlePrint = () => {
    if (!receipt) return;
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
      <h1>${receipt.studioName || 'Studio'}</h1>
      <div class="sub">${receipt.date ? format(new Date(receipt.date), 'MMM d, yyyy · h:mm a') : ''}
        <br>Guest: ${receipt.clientName || 'Guest'}
        ${receipt.cashierName ? `<br>Served by: ${receipt.cashierName}` : ''}
      </div>
      <hr>
      ${(receipt.lineItems || []).map(l => `<div class="row"><span>${l.label}${l.staff ? ` · ${l.staff}` : ''}</span><span>$${l.amount.toFixed(2)}</span></div>`).join('')}
      <hr>
      <div class="row muted"><span>Subtotal</span><span>$${receipt.subtotal?.toFixed(2) || '0.00'}</span></div>
      ${(receipt.discount || 0) > 0 ? `<div class="row muted"><span>Discount</span><span>-$${receipt.discount.toFixed(2)}</span></div>` : ''}
      <div class="row muted"><span>Tax (7%)</span><span>$${receipt.tax?.toFixed(2) || '0.00'}</span></div>
      ${(receipt.tip || 0) > 0 ? `<div class="row muted"><span>Gratuity</span><span>$${receipt.tip.toFixed(2)}</span></div>` : ''}
      <div class="row total"><span>TOTAL</span><span>$${receipt.total?.toFixed(2) || '0.00'}</span></div>
      <hr>
      <div class="row bold"><span>${receipt.paymentMethod || 'Payment'}</span><span>$${receipt.tendered?.toFixed(2) || receipt.total?.toFixed(2) || '0.00'}</span></div>
      ${(receipt.change || 0) > 0.005 ? `<div class="row green bold"><span>Change</span><span>$${receipt.change.toFixed(2)}</span></div>` : ''}
      <div class="footer">Thank you, ${(receipt.clientName || 'Guest').split(' ')[0]}!<br>We appreciate your business.</div>
      </body></html>`);
    win.document.close();
    setTimeout(() => win.print(), 300);
  };

  if (!transaction) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md p-0 border-4 rounded-[3rem] overflow-hidden shadow-2xl bg-background">
        <DialogHeader className="p-8 pb-4 border-b bg-muted/5 text-left">
          <div className="flex items-center gap-3 mb-2">
            <Receipt className="w-5 h-5 text-primary" />
            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground opacity-60">Digital Receipt</span>
          </div>
          <DialogTitle className="text-xl font-black uppercase tracking-tighter text-slate-900 truncate">
            {transaction.description}
          </DialogTitle>
        </DialogHeader>

        <div className="p-6 max-h-[60vh] overflow-y-auto">
          {loading && (
            <div className="flex flex-col items-center gap-3 py-12">
              <Loader className="w-8 h-8 animate-spin text-primary" />
              <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Loading receipt...</p>
            </div>
          )}

          {!loading && notFound && (
            <div className="flex flex-col items-center gap-3 py-12 opacity-30">
              <FileX className="w-12 h-12" />
              <p className="text-[10px] font-black uppercase tracking-widest text-center">
                Receipt not on file.{'\n'}Receipts are generated from checkout version 2.0+
              </p>
            </div>
          )}

          {!loading && receipt && (
            <div className="space-y-4 font-mono text-sm">
              {/* Header */}
              <div className="text-center space-y-1 pb-3 border-b border-dashed">
                <p className="font-black text-base uppercase">{receipt.studioName || 'Studio'}</p>
                <p className="text-[11px] text-muted-foreground">
                  {receipt.date ? format(new Date(receipt.date), 'MMM d, yyyy · h:mm a') : ''}
                </p>
                <p className="text-[11px] text-muted-foreground">Guest: {receipt.clientName}</p>
                {receipt.cashierName && (
                  <p className="text-[10px] text-muted-foreground opacity-60">Served by {receipt.cashierName}</p>
                )}
              </div>

              {/* Line items */}
              <div className="space-y-1.5">
                {(receipt.lineItems || []).map((item, i) => (
                  <div key={i} className="flex justify-between items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <span className="font-bold text-[12px] text-slate-900 block truncate">{item.label}</span>
                      {item.staff && <span className="text-[10px] text-muted-foreground">· {item.staff}</span>}
                    </div>
                    <span className="font-black text-slate-900 shrink-0">${item.amount.toFixed(2)}</span>
                  </div>
                ))}
              </div>

              {/* Totals */}
              <div className="pt-3 border-t border-dashed space-y-1.5">
                <div className="flex justify-between text-[12px] text-muted-foreground">
                  <span>Subtotal</span><span>${receipt.subtotal?.toFixed(2)}</span>
                </div>
                {(receipt.discount || 0) > 0 && (
                  <div className="flex justify-between text-[12px] text-primary">
                    <span>Discount</span><span>-${receipt.discount.toFixed(2)}</span>
                  </div>
                )}
                <div className="flex justify-between text-[12px] text-muted-foreground">
                  <span>Tax (7%)</span><span>${receipt.tax?.toFixed(2)}</span>
                </div>
                {(receipt.tip || 0) > 0 && (
                  <div className="flex justify-between text-[12px] text-muted-foreground">
                    <span>Gratuity</span><span>${receipt.tip.toFixed(2)}</span>
                  </div>
                )}
                <div className="flex justify-between text-[14px] font-black pt-2 border-t border-slate-900">
                  <span>TOTAL</span><span>${receipt.total?.toFixed(2)}</span>
                </div>
              </div>

              {/* Payment */}
              <div className="pt-3 border-t border-dashed space-y-1.5">
                <div className="flex justify-between text-[12px] items-center">
                  <span className="flex items-center gap-1.5 font-bold">
                    {receipt.paymentMethod?.toLowerCase().includes('cash')
                      ? <Banknote className="w-3.5 h-3.5" />
                      : <CreditCard className="w-3.5 h-3.5" />}
                    {receipt.paymentMethod}
                  </span>
                  <span className="font-black">${receipt.tendered?.toFixed(2) || receipt.total?.toFixed(2)}</span>
                </div>
                {(receipt.change || 0) > 0.005 && (
                  <div className="flex justify-between text-[12px] text-green-700 font-black">
                    <span className="flex items-center gap-1.5"><CheckCircle2 className="w-3.5 h-3.5" /> Change</span>
                    <span>${receipt.change.toFixed(2)}</span>
                  </div>
                )}
              </div>

              <div className="text-center pt-2 text-[10px] text-muted-foreground opacity-50 border-t border-dashed">
                Thank you for your visit!
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="p-6 pt-4 border-t bg-muted/5 flex flex-col gap-2">
          {receipt && (
            <Button onClick={handlePrint} className="w-full h-12 rounded-2xl font-black uppercase text-[10px] tracking-widest shadow-xl shadow-primary/20">
              <Printer className="w-4 h-4 mr-2" /> Reprint Receipt
            </Button>
          )}
          <Button variant="outline" className="w-full h-11 rounded-2xl font-black uppercase text-[10px] tracking-widest border-2" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
