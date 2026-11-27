'use client';
// src/components/money/ReceiptDialog.tsx — A SALE'S RECEIPT (the Books tab's See the receipt): the receipt kept at
// checkout (tenants/{t}/receipts/{receiptId}), shown as it was given, with Print it again. A line with no receipt kept
// says so.
import * as React from 'react';
import { doc, getDoc, type Firestore } from 'firebase/firestore';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { esc } from '@/lib/print-style';
import { useToast } from '@/hooks/use-toast';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', GREEN = '#1f7a4d';
const RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';
const btn = `inline-flex min-h-[44px] items-center justify-center rounded-full px-5 text-[14px] font-semibold disabled:opacity-50 ${RING}`;
const usd = (n: number) => `${n < 0 ? '−' : ''}$${Math.abs(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const when = (iso?: string) => { const d = iso ? new Date(iso) : null; return d && !Number.isNaN(d.getTime()) ? `${d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })} at ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` : ''; };

type ReceiptLineItem = { label: string; amount: number; type?: string; staff?: string };
export type ReceiptDoc = {
  id: string; checkoutSessionId: string; clientName: string; cashierName?: string;
  studioName?: string; businessName?: string; date: string; paymentMethod: string; lineItems: ReceiptLineItem[];
  subtotal: number; tax: number; tip: number; discount: number; total: number;
  tendered: number; change: number;
};

/** The receipt as a page to print (a narrow slip, its words escaped). */
export function receiptPrintHtml(r: ReceiptDoc): string {
  const name = r.businessName || r.studioName || 'Receipt';
  const row = (a: string, b: string, cls = '') => `<div class="row ${cls}"><span>${a}</span><span>${b}</span></div>`;
  const lines = (r.lineItems || []).map((l) => row(`${esc(l.label)}${l.staff ? `<br><small>${esc(l.staff)}</small>` : ''}`, esc(usd(l.amount)))).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Receipt</title><style>
*{box-sizing:border-box;margin:0;padding:0}body{font-family:'Plus Jakarta Sans',system-ui,sans-serif;font-size:13px;color:#16171a;padding:20px 16px;max-width:300px;margin:0 auto}
h1{font-size:16px;text-align:center;font-weight:600;margin-bottom:2px}.sub{text-align:center;color:#6d7075;font-size:12px;margin-bottom:12px;line-height:1.5}
hr{border:none;border-top:1px dashed #c8c9cc;margin:10px 0}.row{display:flex;justify-content:space-between;gap:12px;margin:4px 0}.row span:last-child{font-variant-numeric:tabular-nums;white-space:nowrap}
small{color:#6d7075}.muted{color:#6d7075}.total{font-size:15px;font-weight:600;border-top:1px solid #16171a;padding-top:8px;margin-top:6px}.foot{text-align:center;margin-top:18px;color:#6d7075;font-size:12px}
@media print{body{padding:0}}</style></head><body>
<h1>${esc(name)}</h1><div class="sub">${esc(when(r.date))}<br>${esc(r.clientName || 'Guest')}${r.cashierName ? `<br>Served by ${esc(r.cashierName)}` : ''}</div>
<hr>${lines}<hr>
${row('Subtotal', esc(usd(r.subtotal || 0)), 'muted')}
${(r.discount || 0) > 0 ? row('Discount', esc(usd(-(r.discount || 0))), 'muted') : ''}
${row('Tax', esc(usd(r.tax || 0)), 'muted')}
${(r.tip || 0) > 0 ? row('Tip', esc(usd(r.tip || 0)), 'muted') : ''}
${row('Total', esc(usd(r.total || 0)), 'total')}
<hr>${row(esc(r.paymentMethod || 'Paid'), esc(usd(r.tendered || r.total || 0)))}
${(r.change || 0) > 0.005 ? row('Change', esc(usd(r.change || 0))) : ''}
<div class="foot">Thank you, ${esc((r.clientName || 'Guest').split(' ')[0])}.</div></body></html>`;
}

export function ReceiptDialog({ transaction, tenantId, firestore, open, onOpenChange }: {
  transaction: any | null; tenantId: string; firestore: Firestore | null; open: boolean; onOpenChange: (o: boolean) => void;
}) {
  const [receipt, setReceipt] = React.useState<ReceiptDoc | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [notFound, setNotFound] = React.useState(false);
  const { toast } = useToast();

  React.useEffect(() => {
    if (!open || !transaction || !firestore || !tenantId) return;
    const rid = transaction.receiptId;
    setReceipt(null); setNotFound(false);
    if (!rid) { setNotFound(true); return; }
    let on = true; setLoading(true);
    getDoc(doc(firestore, `tenants/${tenantId}/receipts`, String(rid)))
      .then((snap) => { if (on) { if (snap.exists()) setReceipt(snap.data() as ReceiptDoc); else setNotFound(true); } })
      .catch(() => { if (on) setNotFound(true); })
      .finally(() => { if (on) setLoading(false); });
    return () => { on = false; };
  }, [open, transaction?.id, tenantId, firestore]); // eslint-disable-line react-hooks/exhaustive-deps

  const print = () => {
    if (!receipt) return;
    const win = window.open('', '_blank', 'width=360,height=700');
    if (!win) { toast({ title: 'The receipt couldn’t open', description: 'Your browser blocked its window. Allow pop-ups for this site, then try again.' }); return; }
    win.document.write(receiptPrintHtml(receipt)); win.document.close();
    setTimeout(() => win.print(), 300);
  };

  if (!transaction) return null;
  const row = (a: React.ReactNode, b: React.ReactNode, o: { muted?: boolean; total?: boolean; good?: boolean } = {}) => (
    <div className="flex items-start justify-between gap-3 py-1" style={{ color: o.good ? GREEN : o.muted ? MUTED : INK, fontWeight: o.total ? 600 : undefined, ...(o.total ? { borderTop: `1px solid ${INK}`, marginTop: 6, paddingTop: 8 } : {}) }}>
      <span className="min-w-0">{a}</span><span className="shrink-0 tabular-nums">{b}</span>
    </div>
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-hidden rounded-3xl border-0 bg-[#fff] p-0 sm:max-w-md">
        <div className="flex max-h-[90dvh] flex-col" style={{ color: INK }}>
          <div className="shrink-0 px-6 pb-2 pt-6 text-left">
            <DialogTitle className="truncate pr-8 text-[20px] font-semibold leading-tight" style={{ color: INK }}>{transaction.description || 'Receipt'}</DialogTitle>
            <DialogDescription className="text-[14px]" style={{ color: MUTED }}>The receipt given at checkout.</DialogDescription>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-4">
            {loading && <p role="status" className="py-10 text-center text-[14px]" style={{ color: MUTED }}>Getting the receipt</p>}
            {!loading && notFound && <p className="rounded-2xl px-4 py-6 text-center text-[14px]" style={{ background: '#f5f5f7', color: MUTED }}>There’s no receipt kept for this line. Receipts are kept for sales taken at checkout.</p>}
            {!loading && receipt && (
              <div className="rounded-2xl px-4 py-4 text-[14px]" style={{ border: `1px solid ${LINE}` }}>
                <div className="pb-3 text-center" style={{ borderBottom: `1px dashed ${LINE}` }}>
                  <p className="text-[16px] font-semibold">{receipt.businessName || receipt.studioName || 'Receipt'}</p>
                  <p className="text-[13px]" style={{ color: MUTED }}>{when(receipt.date)}</p>
                  <p className="text-[13px]" style={{ color: MUTED }}>{receipt.clientName || 'Guest'}{receipt.cashierName ? `, served by ${receipt.cashierName}` : ''}</p>
                </div>
                <div className="py-2" style={{ borderBottom: `1px dashed ${LINE}` }}>
                  {(receipt.lineItems || []).map((l, i) => <React.Fragment key={i}>{row(<><span className="block">{l.label}</span>{l.staff && <span className="block text-[12px]" style={{ color: MUTED }}>{l.staff}</span>}</>, usd(l.amount))}</React.Fragment>)}
                </div>
                <div className="py-2" style={{ borderBottom: `1px dashed ${LINE}` }}>
                  {row('Subtotal', usd(receipt.subtotal || 0), { muted: true })}
                  {(receipt.discount || 0) > 0 && row('Discount', usd(-(receipt.discount || 0)), { muted: true })}
                  {row('Tax', usd(receipt.tax || 0), { muted: true })}
                  {(receipt.tip || 0) > 0 && row('Tip', usd(receipt.tip || 0), { muted: true })}
                  {row('Total', usd(receipt.total || 0), { total: true })}
                </div>
                <div className="pt-2">
                  {row(receipt.paymentMethod || 'Paid', usd(receipt.tendered || receipt.total || 0))}
                  {(receipt.change || 0) > 0.005 && row('Change', usd(receipt.change || 0), { good: true })}
                </div>
              </div>
            )}
          </div>
          <div className="flex shrink-0 flex-wrap gap-2 px-6 py-4" style={{ borderTop: `1px solid ${LINE}` }}>
            {receipt && <button type="button" onClick={print} className={btn} style={{ background: INK, color: '#fff' }}>Print it again</button>}
            <button type="button" onClick={() => onOpenChange(false)} className={btn} style={{ background: '#fff', color: INK, border: `1px solid ${LINE}` }}>Close</button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
