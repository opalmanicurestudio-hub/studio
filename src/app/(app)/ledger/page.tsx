'use client';

import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { AppHeader } from '@/components/shared/AppHeader';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  MoreHorizontal, PlusCircle, TrendingUp, TrendingDown, RefreshCw, Paperclip,
  BookOpen, CreditCard, Printer, Filter, X, Loader, Search, ShieldCheck,
  Landmark, ShoppingCart, CalendarCheck, FileX, Undo2, Lock, FileWarning,
  Banknote, DollarSign, Scale, Clock, Package, Users, CheckCircle2, Receipt,
} from 'lucide-react';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from '@/components/ui/sheet';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { type Transaction } from '@/lib/financial-data';
import { type Staff, type Incident, type Service, type Appointment } from '@/lib/data';
import { Badge } from '@/components/ui/badge';
import { format, startOfDay, endOfDay, parseISO, subDays, startOfMonth, endOfMonth, subMonths, differenceInMinutes } from 'date-fns';
import { Input } from '@/components/ui/input';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DateRange } from 'react-day-picker';
import { cn } from '@/lib/utils';
import { useFirebase, addDocumentNonBlocking, updateDocumentNonBlocking } from '@/firebase';
import { AddTransactionDialog } from '@/components/ledger/AddTransactionDialog';
import { useToast } from '@/hooks/use-toast';
import { useTenant } from '@/context/TenantContext';
import { useInventory } from '@/context/InventoryContext';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useIsMobile } from '@/hooks/use-mobile';
import { collection, doc, writeBatch, increment, arrayUnion, getDoc } from 'firebase/firestore';
import { Separator } from '@/components/ui/separator';
import { motion, AnimatePresence } from 'framer-motion';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import Link from 'next/link';
import { nanoid } from 'nanoid';
import { ScrollArea } from '@/components/ui/scroll-area';

// ─── Helpers ──────────────────────────────────────────────────────────────────
const safeDate = (val: any): Date => {
  if (!val) return new Date();
  if (val instanceof Date) return val;
  if (typeof val?.toDate === 'function') return val.toDate();
  if (typeof val === 'string') { try { return parseISO(val); } catch { return new Date(val); } }
  if (typeof val === 'object' && 'seconds' in val) return new Date(val.seconds * 1000);
  return new Date(val);
};

const fmt = (d: any, str: string) => { try { return format(safeDate(d), str); } catch { return '—'; } };

// ─── TransactionIcon ──────────────────────────────────────────────────────────
const TransactionIcon = ({ type }: { type: Transaction['type'] }) => {
  switch (type) {
    case 'income':  return <TrendingUp className="h-5 w-5 text-green-500" />;
    case 'expense': return <TrendingDown className="h-5 w-5 text-red-500" />;
    case 'payment': return <BookOpen className="h-5 w-5 text-primary" />;
    case 'reversal':return <RefreshCw className="h-5 w-5 text-slate-400" />;
    default:        return null;
  }
};

// ─── Fast Print ───────────────────────────────────────────────────────────────
// Opens a new window and writes pre-built HTML — no React re-render, no delay.
function buildPrintHtml(
  transactions: Transaction[],
  staff: Staff[],
  summary: { revenue: number; cogs: number; grossProfit: number; operatingExpenses: number; net: number },
  dateRange: DateRange | undefined,
) {
  const staffName = (id?: string) => id ? (staff.find(s => s.id === id)?.name || 'System') : 'System';
  const rows = transactions.map(t => `
    <tr style="border-bottom:1px solid #e5e7eb; ${t.type === 'expense' ? 'background:#fef2f2;' : ''}">
      <td style="padding:6px 8px; font-size:11px;">${fmt(t.date, 'MM/dd/yy h:mm a')}</td>
      <td style="padding:6px 8px; font-size:11px;">
        <div style="font-weight:600;">${t.description}</div>
        <div style="color:#6b7280; font-size:10px;">${t.clientOrVendor || ''}</div>
      </td>
      <td style="padding:6px 8px; font-size:11px;">${staffName(t.staffId)}</td>
      <td style="padding:6px 8px; font-size:11px;">${t.category}</td>
      <td style="padding:6px 8px; font-size:11px;">${t.paymentMethod || ''}</td>
      <td style="padding:6px 8px; font-size:11px; text-align:right; font-family:monospace; font-weight:700; color:${t.type === 'income' ? '#16a34a' : t.type === 'expense' ? '#dc2626' : '#9ca3af'};">
        ${t.type === 'income' ? '+' : t.type === 'expense' ? '-' : ''}$${t.amount.toFixed(2)}
      </td>
      <td style="padding:6px 8px; font-size:10px; color:#9ca3af;">${t.checkoutSessionId ? t.checkoutSessionId.slice(-6).toUpperCase() : '—'}</td>
    </tr>`).join('');

  return `<!DOCTYPE html><html><head><title>Studio Ledger Report</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, sans-serif; color: #111827; padding: 32px; }
    h1 { font-size: 24px; font-weight: 800; text-transform: uppercase; letter-spacing: -0.03em; }
    h2 { font-size: 14px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; margin: 24px 0 8px; border-bottom: 2px solid #111827; padding-bottom: 4px; }
    table { width: 100%; border-collapse: collapse; }
    th { background: #f9fafb; text-align: left; padding: 8px; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #374151; }
    .summary-row { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid #e5e7eb; font-size: 13px; }
    .summary-row.bold { font-weight: 700; }
    .summary-row.net { font-weight: 800; font-size: 16px; border-top: 3px solid #111827; border-bottom: none; margin-top: 4px; padding-top: 8px; }
    .green { color: #16a34a; } .red { color: #dc2626; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; }
    .date-range { font-size: 13px; color: #6b7280; margin-top: 4px; }
    .generated { font-size: 11px; color: #9ca3af; text-align: right; }
    @media print { @page { size: A4; margin: 0.75in; } body { padding: 0; } }
  </style></head><body>
  <div class="header">
    <div>
      <h1>Studio Ledger</h1>
      <div class="date-range">
        ${dateRange?.from ? format(dateRange.from, 'MMM d, yyyy') : 'All time'} — ${dateRange?.to ? format(dateRange.to, 'MMM d, yyyy') : 'Present'}
      </div>
    </div>
    <div class="generated">Generated ${format(new Date(), 'MMM d, yyyy h:mm a')}</div>
  </div>

  <h2>Financial Summary</h2>
  <div style="max-width:360px; margin-bottom:24px;">
    <div class="summary-row"><span>Total Revenue</span><span class="green">$${summary.revenue.toFixed(2)}</span></div>
    <div class="summary-row"><span>Cost of Goods (COGS)</span><span class="red">($${summary.cogs.toFixed(2)})</span></div>
    <div class="summary-row bold"><span>Gross Profit</span><span>$${summary.grossProfit.toFixed(2)}</span></div>
    <div class="summary-row"><span>Operating Expenses</span><span class="red">($${summary.operatingExpenses.toFixed(2)})</span></div>
    <div class="summary-row net"><span>Net Income</span><span class="${summary.net >= 0 ? 'green' : 'red'}">$${summary.net.toFixed(2)}</span></div>
  </div>

  <h2>Transaction Detail (${transactions.length} records)</h2>
  <table>
    <thead>
      <tr>
        <th>Date & Time</th><th>Description</th><th>Staff</th>
        <th>Category</th><th>Method</th><th style="text-align:right;">Amount</th><th>Session</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  </body></html>`;
}

// ─── ReceiptPreviewDialog ─────────────────────────────────────────────────────
type ReceiptLineItem = { label: string; amount: number; type?: string; staff?: string };
type ReceiptDoc = {
  id: string; checkoutSessionId: string; clientName: string; cashierName?: string;
  studioName?: string; date: string; paymentMethod: string; lineItems: ReceiptLineItem[];
  subtotal: number; tax: number; tip: number; discount: number; total: number;
  tendered: number; change: number;
};

const ReceiptPreviewDialog = ({
  transaction, tenantId, open, onOpenChange,
}: { transaction: Transaction | null; tenantId: string; open: boolean; onOpenChange: (o: boolean) => void }) => {
  const { firestore } = useFirebase();
  const [receipt,  setReceipt]  = useState<ReceiptDoc | null>(null);
  const [loading,  setLoading]  = useState(false);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!open || !transaction || !firestore || !tenantId) return;
    const rid = (transaction as any).receiptId;
    if (!rid) { setNotFound(true); return; }
    setLoading(true); setReceipt(null); setNotFound(false);
    getDoc(doc(firestore, `tenants/${tenantId}/receipts`, rid))
      .then(snap => snap.exists() ? setReceipt(snap.data() as ReceiptDoc) : setNotFound(true))
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [open, transaction?.id, tenantId, firestore]);

  const handlePrint = () => {
    if (!receipt) return;
    const win = window.open('', '_blank', 'width=340,height=700');
    if (!win) return;
    const lines = (receipt.lineItems || []).map(l =>
      `<div class="row"><span>${l.label}${l.staff ? ` · ${l.staff}` : ''}</span><span>$${l.amount.toFixed(2)}</span></div>`
    ).join('');
    win.document.write(`<!DOCTYPE html><html><head><title>Receipt</title>
    <style>
      * { box-sizing:border-box; margin:0; padding:0; }
      body { font-family:'Courier New',monospace; font-size:13px; padding:20px 16px; max-width:300px; margin:0 auto; }
      h1 { font-size:16px; text-align:center; font-weight:bold; margin-bottom:2px; }
      .sub { text-align:center; color:#666; font-size:11px; margin-bottom:14px; }
      hr { border:none; border-top:1px dashed #bbb; margin:10px 0; }
      .row { display:flex; justify-content:space-between; margin:4px 0; }
      .muted { color:#555; } .bold { font-weight:bold; }
      .total { font-size:15px; font-weight:bold; border-top:1px solid #000; padding-top:8px; margin-top:6px; }
      .green { color:#2d6a0f; }
      .footer { text-align:center; margin-top:20px; color:#666; font-size:11px; line-height:2; }
      @media print { body { padding:0; } }
    </style></head><body>
    <h1>${receipt.studioName || 'Studio'}</h1>
    <div class="sub">${receipt.date ? format(new Date(receipt.date), 'MMM d, yyyy · h:mm a') : ''}
      <br>Guest: ${receipt.clientName || 'Guest'}
      ${receipt.cashierName ? `<br>Served by: ${receipt.cashierName}` : ''}
    </div>
    <hr>
    ${lines}
    <hr>
    <div class="row muted"><span>Subtotal</span><span>$${(receipt.subtotal || 0).toFixed(2)}</span></div>
    ${(receipt.discount || 0) > 0 ? `<div class="row muted"><span>Discount</span><span>-$${receipt.discount.toFixed(2)}</span></div>` : ''}
    <div class="row muted"><span>Tax (7%)</span><span>$${(receipt.tax || 0).toFixed(2)}</span></div>
    ${(receipt.tip || 0) > 0 ? `<div class="row muted"><span>Gratuity</span><span>$${receipt.tip.toFixed(2)}</span></div>` : ''}
    <div class="row total"><span>TOTAL</span><span>$${(receipt.total || 0).toFixed(2)}</span></div>
    <hr>
    <div class="row bold"><span>${receipt.paymentMethod || 'Payment'}</span><span>$${(receipt.tendered || receipt.total || 0).toFixed(2)}</span></div>
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
                Receipt not on file.<br />Receipts are generated from checkout v2+
              </p>
            </div>
          )}
          {!loading && receipt && (
            <div className="space-y-4 font-mono text-sm">
              <div className="text-center space-y-1 pb-3 border-b border-dashed">
                <p className="font-black text-base uppercase">{receipt.studioName || 'Studio'}</p>
                <p className="text-[11px] text-muted-foreground">{receipt.date ? format(new Date(receipt.date), 'MMM d, yyyy · h:mm a') : ''}</p>
                <p className="text-[11px] text-muted-foreground">Guest: {receipt.clientName}</p>
                {receipt.cashierName && <p className="text-[10px] text-muted-foreground opacity-60">Served by {receipt.cashierName}</p>}
              </div>
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
              <div className="pt-3 border-t border-dashed space-y-1.5">
                <div className="flex justify-between text-[12px] text-muted-foreground"><span>Subtotal</span><span>${(receipt.subtotal || 0).toFixed(2)}</span></div>
                {(receipt.discount || 0) > 0 && <div className="flex justify-between text-[12px] text-primary"><span>Discount</span><span>-${receipt.discount.toFixed(2)}</span></div>}
                <div className="flex justify-between text-[12px] text-muted-foreground"><span>Tax (7%)</span><span>${(receipt.tax || 0).toFixed(2)}</span></div>
                {(receipt.tip || 0) > 0 && <div className="flex justify-between text-[12px] text-muted-foreground"><span>Gratuity</span><span>${receipt.tip.toFixed(2)}</span></div>}
                <div className="flex justify-between text-[14px] font-black pt-2 border-t border-slate-900"><span>TOTAL</span><span>${(receipt.total || 0).toFixed(2)}</span></div>
              </div>
              <div className="pt-3 border-t border-dashed space-y-1.5">
                <div className="flex justify-between text-[12px] items-center">
                  <span className="flex items-center gap-1.5 font-bold">
                    {receipt.paymentMethod?.toLowerCase().includes('cash') ? <Banknote className="w-3.5 h-3.5" /> : <CreditCard className="w-3.5 h-3.5" />}
                    {receipt.paymentMethod}
                  </span>
                  <span className="font-black">${(receipt.tendered || receipt.total || 0).toFixed(2)}</span>
                </div>
                {(receipt.change || 0) > 0.005 && (
                  <div className="flex justify-between text-[12px] text-green-700 font-black">
                    <span className="flex items-center gap-1.5"><CheckCircle2 className="w-3.5 h-3.5" /> Change</span>
                    <span>${receipt.change.toFixed(2)}</span>
                  </div>
                )}
              </div>
              <div className="text-center pt-2 text-[10px] text-muted-foreground opacity-50 border-t border-dashed">Thank you for your visit!</div>
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
};

// ─── RefundProtocolDialog ─────────────────────────────────────────────────────
const RefundProtocolDialog = ({ transaction, activeTill, staff, services, appointments, inventory, tenant, open, onOpenChange, onConfirm }: any) => {
  const [pin, setPin] = useState('');
  const [refundAmount, setRefundAmount] = useState(transaction?.amount || 0);
  const [refundTip, setRefundTip] = useState(true);
  const [tipStrategy, setTipStrategy] = useState<'clawback' | 'absorb'>('clawback');
  const [reason, setReason] = useState('');
  const [logIncident, setLogIncident] = useState(false);
  const [withholdOverhead, setWithholdOverhead] = useState(false);
  const [withholdMaterials, setWithholdMaterials] = useState(false);
  const [withholdLabor, setWithholdLabor] = useState(false);
  const { toast } = useToast();
  const tmhr = tenant?.tmhr || 50;

  const costsBreakdown = useMemo(() => {
    if (!transaction || !services || !appointments || !staff) return { overhead: 0, materials: 0, labor: 0, staffMember: null };
    const apt = appointments.find((a: Appointment) => a.id === transaction.appointmentId);
    if (!apt) return { overhead: 0, materials: 0, labor: 0, staffMember: null };
    const svc = services.find((s: Service) => s.id === apt.serviceId);
    if (!svc) return { overhead: 0, materials: 0, labor: 0, staffMember: null };
    let materials = 0;
    if (apt.checkoutState?.formula?.length > 0) {
      materials = apt.checkoutState.formula.reduce((acc: number, item: any) => acc + item.quantity * item.costPerUnit, 0);
    } else if (svc.products?.length > 0) {
      materials = svc.products.reduce((acc: number, p: any) => {
        const item = inventory.find((i: any) => i.id === p.id);
        if (!item) return acc;
        let cpu = item.costPerUnit || 0;
        if (item.costingMethod === 'size' && item.size) cpu /= item.size;
        else if (item.costingMethod === 'uses' && item.estimatedUses) cpu /= item.estimatedUses;
        return acc + p.quantityUsed * cpu;
      }, 0);
    }
    const actualDuration = apt.actualStartTime && apt.actualEndTime
      ? differenceInMinutes(safeDate(apt.actualEndTime), safeDate(apt.actualStartTime))
      : (apt.checkoutState?.actualDuration || svc.duration || 60);
    const overhead = (actualDuration / 60) * tmhr;
    const staffMember = staff.find((s: Staff) => s.id === apt.staffId);
    let labor = 0;
    if (staffMember?.payStructure === 'commission') labor = transaction.amount * ((staffMember.commissionRate || 40) / 100);
    else if (staffMember?.payStructure === 'hourly' && staffMember.hourlyRate) labor = (actualDuration / 60) * staffMember.hourlyRate;
    return { overhead, materials, labor, staffMember };
  }, [transaction, services, appointments, tmhr, staff, inventory]);

  useEffect(() => {
    if (transaction) { setRefundAmount(transaction.amount); setReason(''); setLogIncident(false); setWithholdOverhead(false); setWithholdMaterials(false); setWithholdLabor(costsBreakdown.staffMember?.payStructure === 'hourly'); }
  }, [transaction?.id]);

  useEffect(() => {
    if (!transaction) return;
    const withheld = (withholdOverhead ? costsBreakdown.overhead : 0) + (withholdMaterials ? costsBreakdown.materials : 0) + (withholdLabor ? costsBreakdown.labor : 0);
    setRefundAmount(Math.max(0, Number((transaction.amount - withheld).toFixed(2))));
  }, [withholdOverhead, withholdMaterials, withholdLabor, transaction, costsBreakdown]);

  if (!transaction) return null;
  const isCard = transaction.paymentMethod?.toLowerCase().includes('card') || transaction.paymentMethod?.toLowerCase().includes('visa');
  const tipToRefund = refundTip ? (transaction.tipAmount || 0) : 0;
  const totalOutlay = refundAmount + tipToRefund;

  const handleAction = () => {
    const authorized = staff.find((s: any) => s.pin === pin && (s.role === 'admin' || s.role === 'owner'));
    if (!authorized) { toast({ variant: 'destructive', title: 'Unauthorized' }); return; }
    if (!reason.trim()) { toast({ variant: 'destructive', title: 'Reason Required' }); return; }
    onConfirm({ amount: refundAmount, refundTip: refundTip && (transaction.tipAmount || 0) > 0, tipStrategy, reason, logIncident, authorizerId: authorized.id });
    setPin('');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md rounded-[3rem] border-4 shadow-3xl p-0 overflow-hidden bg-background">
        <DialogHeader className="p-8 pb-6 border-b bg-muted/5 text-left">
          <div className="flex items-center gap-3 mb-2"><Undo2 className="w-5 h-5 text-destructive" /><span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground opacity-60">Revenue Reversal</span></div>
          <DialogTitle className="text-2xl font-black uppercase tracking-tighter text-slate-900 leading-none">Refund Protocol</DialogTitle>
          <DialogDescription className="text-xs font-bold uppercase tracking-widest opacity-60 mt-1">Initiating reversal sequence.</DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[60vh]">
          <div className="p-8 space-y-6">
            <div className="p-6 rounded-[2rem] bg-destructive/5 border-2 border-destructive/10 text-center space-y-2">
              <p className="text-[9px] font-black uppercase text-destructive/60 tracking-widest">Reversal Value</p>
              <p className="text-5xl font-black text-destructive tracking-tighter font-mono">${totalOutlay.toFixed(2)}</p>
              <p className="text-[10px] font-bold text-slate-600 uppercase flex items-center justify-center gap-2">
                {isCard ? <Lock className="w-3 h-3" /> : <Banknote className="w-3 h-3" />}
                {isCard ? 'Original Card (Locked)' : transaction.paymentMethod}
              </p>
            </div>
            <div className="space-y-3">
              <p className="text-[10px] font-black uppercase tracking-widest text-primary flex items-center gap-2"><Scale className="w-3.5 h-3.5" /> Cost Recovery Matrix</p>
              <div className="rounded-2xl border-2 bg-muted/5 p-4 space-y-3">
                {[
                  { label: 'Overhead', icon: <Clock className="w-3 h-3" />, checked: withholdOverhead, set: setWithholdOverhead, val: costsBreakdown.overhead },
                  { label: 'Materials', icon: <Package className="w-3 h-3" />, checked: withholdMaterials, set: setWithholdMaterials, val: costsBreakdown.materials },
                  { label: 'Labor', icon: <Users className="w-3 h-3" />, checked: withholdLabor, set: setWithholdLabor, val: costsBreakdown.labor },
                ].map(row => (
                  <div key={row.label} className="flex justify-between items-center">
                    <div className="flex items-center gap-3">
                      <Switch checked={row.checked} onCheckedChange={row.set} />
                      <span className="text-[10px] font-bold uppercase opacity-60 flex items-center gap-2">{row.icon} {row.label}</span>
                    </div>
                    <span className="font-mono text-[10px]">${row.val.toFixed(2)}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="space-y-3">
              <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Justification Required</Label>
              <Textarea placeholder="Provide detailed reasoning..." value={reason} onChange={e => setReason(e.target.value)} className="rounded-2xl border-2 bg-muted/5" />
            </div>
            <div className="flex items-center justify-between p-4 rounded-2xl border-2 border-dashed bg-muted/5">
              <div><Label className="text-xs font-black uppercase flex items-center gap-2"><FileWarning className="w-4 h-4 text-amber-600" /> Log as Incident</Label><p className="text-[9px] text-muted-foreground uppercase opacity-60">File in guest dossier</p></div>
              <Switch checked={logIncident} onCheckedChange={setLogIncident} />
            </div>
            <div className="space-y-3 pt-4 border-t border-dashed">
              <div className="flex items-center gap-3"><div className="p-2 bg-muted rounded-xl"><Lock className="w-4 h-4 text-slate-400" /></div><Label className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground">Manager PIN</Label></div>
              <Input type="password" maxLength={4} value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, ''))} className="h-16 text-center text-4xl font-black tracking-[0.5em] rounded-2xl border-4 shadow-inner bg-muted/5" placeholder="••••" />
            </div>
          </div>
        </ScrollArea>
        <DialogFooter className="p-8 pt-4 border-t bg-muted/5 flex flex-col gap-3">
          <Button onClick={handleAction} disabled={pin.length < 4 || !reason.trim()} className="w-full h-16 rounded-2xl text-xl font-black uppercase bg-destructive text-destructive-foreground hover:bg-destructive/90">Authorize Reversal</Button>
          <Button variant="ghost" onClick={() => onOpenChange(false)} className="w-full font-black uppercase text-[10px] tracking-widest text-slate-400">Abort</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

// ─── TransactionDossierSheet ──────────────────────────────────────────────────
const TransactionDossierSheet = ({ transaction, staff, open, onOpenChange, onRevert }: { transaction: Transaction | null; staff: Staff[]; open: boolean; onOpenChange: (o: boolean) => void; onRevert: (t: Transaction) => void }) => {
  if (!transaction) return null;
  const staffMember = staff.find(s => s.id === transaction.staffId);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-xl p-0 flex flex-col bg-background overflow-hidden">
        <SheetHeader className="p-8 pb-6 border-b bg-muted/5 flex-shrink-0 text-left">
          <div className="flex items-center gap-3 mb-2"><ShieldCheck className="w-5 h-5 text-primary" /><span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground opacity-60">Audit Intelligence</span></div>
          <SheetTitle className="text-3xl font-black uppercase tracking-tighter text-slate-900 leading-none">Record Dossier</SheetTitle>
          <SheetDescription className="text-[10px] font-bold uppercase tracking-widest opacity-60 mt-1">Registry ID: {transaction.id.slice(-8).toUpperCase()}</SheetDescription>
        </SheetHeader>
        <ScrollArea className="flex-1">
          <div className="p-8 space-y-8">
            <div className="p-8 rounded-[2.5rem] bg-muted/10 border-4 border-border/50 text-center space-y-4 shadow-inner">
              <p className="text-[10px] font-black uppercase tracking-[0.3em] text-muted-foreground opacity-60">Accounting Entry</p>
              <p className={cn('text-5xl font-black font-mono tracking-tighter', transaction.type === 'income' ? 'text-green-600' : 'text-destructive')}>
                {transaction.type === 'income' ? '+' : '-'}${transaction.amount.toFixed(2)}
              </p>
              <div className="flex justify-center gap-2">
                <Badge variant="outline" className="font-black uppercase text-[9px] h-6 px-3 border-2">{transaction.type}</Badge>
                <Badge className="bg-primary text-white border-none font-black text-[9px] h-6 px-3 uppercase">{transaction.category}</Badge>
              </div>
            </div>
            <div className="space-y-4">
              <div><p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-60 mb-1">Entity Reference</p>
                <p className="text-xl font-black uppercase tracking-tight text-slate-900">{transaction.description}</p>
                <p className="text-xs font-bold text-slate-500 uppercase">{transaction.clientOrVendor}</p>
              </div>
              <div className="grid grid-cols-2 gap-6 pt-4 border-t border-dashed">
                <div><p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground opacity-60">Timestamp</p>
                  <p className="font-black text-sm uppercase tracking-tight">{fmt(transaction.date, 'MMMM d, yyyy')}</p>
                  <p className="text-[10px] font-bold text-primary uppercase">{fmt(transaction.date, 'h:mm a')}</p>
                </div>
                <div><p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground opacity-60">Settlement</p>
                  <p className="font-black text-sm uppercase tracking-tight">{transaction.paymentMethod}</p>
                  <p className="text-[10px] font-bold text-slate-500 uppercase">{transaction.context} Account</p>
                </div>
              </div>
              {staffMember && (
                <div className="pt-4 border-t border-dashed space-y-3">
                  <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground opacity-60">Authorized By</p>
                  <div className="flex items-center gap-3 p-3 rounded-2xl border-2 bg-white shadow-sm">
                    <Avatar className="h-10 w-10 border shadow-sm rounded-xl">
                      <AvatarImage src={staffMember.avatarUrl} className="object-cover" />
                      <AvatarFallback className="font-black text-xs bg-primary/10 text-primary">{(staffMember.name || 'S').charAt(0)}</AvatarFallback>
                    </Avatar>
                    <div><p className="font-black text-sm uppercase tracking-tight">{staffMember.name}</p><p className="text-[9px] font-bold text-muted-foreground uppercase opacity-60">{staffMember.role}</p></div>
                  </div>
                </div>
              )}
              {(transaction.relatedOrderId || transaction.relatedBillInstanceId || transaction.appointmentId) && (
                <div className="pt-4 border-t border-dashed space-y-3">
                  <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground opacity-60">Protocol Linkages</p>
                  {transaction.relatedOrderId && <Button variant="outline" asChild className="w-full h-12 rounded-xl border-2 justify-start font-black uppercase text-[10px]"><Link href="/inventory"><ShoppingCart className="mr-3 h-4 w-4 text-primary opacity-40" />View Purchase Order</Link></Button>}
                  {transaction.appointmentId && <Button variant="outline" asChild className="w-full h-12 rounded-xl border-2 justify-start font-black uppercase text-[10px]"><Link href="/planner"><CalendarCheck className="mr-3 h-4 w-4 text-primary opacity-40" />Examine Session</Link></Button>}
                  {transaction.relatedBillInstanceId && <Button variant="outline" asChild className="w-full h-12 rounded-xl border-2 justify-start font-black uppercase text-[10px]"><Link href="/bills"><Landmark className="mr-3 h-4 w-4 text-primary opacity-40" />View Bill Context</Link></Button>}
                </div>
              )}
            </div>
          </div>
        </ScrollArea>
        <SheetFooter className="p-8 pt-4 border-t bg-muted/5 flex-shrink-0">
          <div className="flex flex-col gap-3 w-full">
            <Button variant="destructive" disabled={transaction.type === 'reversal'} onClick={() => onRevert(transaction)} className="w-full h-14 rounded-2xl font-black uppercase text-[10px] tracking-widest shadow-xl shadow-destructive/20">
              <RefreshCw className="mr-2 h-4 w-4" /> {transaction.type === 'reversal' ? 'Already Reverted' : 'Revert Protocol Entry'}
            </Button>
            <Button variant="outline" onClick={() => onOpenChange(false)} className="w-full h-12 rounded-xl font-black uppercase text-[10px] tracking-widest border-2 bg-white">Close Archive</Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
};

// ─── TransactionFilters ───────────────────────────────────────────────────────
const TransactionFilters = ({ transactions, date, setDate, periodPreset, setPeriodPreset, searchTerm, setSearchTerm, contextFilter, setContextFilter, categoryFilter, setCategoryFilter, financialSummary }: any) => {
  const categories = useMemo(() => [...new Set((transactions || []).map((t: Transaction) => t.category))], [transactions]);
  return (
    <Card className="h-fit border-2 shadow-sm rounded-3xl overflow-hidden">
      <CardHeader className="hidden md:block border-b bg-muted/5"><CardTitle className="text-sm font-black uppercase tracking-widest">Ledger Filters</CardTitle><CardDescription className="text-xs font-bold uppercase tracking-tight opacity-60">Filter studio cash flow.</CardDescription></CardHeader>
      <CardContent className="space-y-6 pt-6">
        <div className="space-y-2">
          <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Analyze Period</Label>
          <Select value={periodPreset} onValueChange={setPeriodPreset}>
            <SelectTrigger className="h-12 rounded-2xl border-2 bg-background font-black uppercase text-[10px] tracking-widest shadow-sm"><SelectValue /></SelectTrigger>
            <SelectContent className="rounded-xl border-2 shadow-2xl">
              {[['today','Today'],['7days','Last 7 Days'],['30days','Last 30 Days'],['thisMonth','This Month'],['lastMonth','Last Month'],['custom','Custom Range...']].map(([v,l]) => (
                <SelectItem key={v} value={v} className="font-bold uppercase">{l}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <AnimatePresence>
          {periodPreset === 'custom' && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="grid grid-cols-1 gap-3 overflow-hidden">
              {['From','To'].map((label, i) => (
                <div key={label} className="space-y-1">
                  <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">{label}</Label>
                  <input type="date" value={i === 0 ? (date?.from ? format(date.from, 'yyyy-MM-dd') : '') : (date?.to ? format(date.to, 'yyyy-MM-dd') : '')}
                    onChange={e => { const d = e.target.value ? new Date(e.target.value.replace(/-/g, '/')) : undefined; setDate(i === 0 ? { from: d, to: date?.to } : { from: date?.from, to: d }); }}
                    className="w-full h-10 rounded-xl border-2 bg-background px-3 font-bold text-xs outline-none focus:border-primary shadow-inner" />
                </div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
        <div className="space-y-2">
          <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Search Records</Label>
          <div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" /><Input placeholder="Description or entity..." className="pl-9 h-12 rounded-2xl border-2" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} /></div>
        </div>
        <RadioGroup value={contextFilter} onValueChange={setContextFilter} className="grid grid-cols-3 gap-2">
          {[['all','All'],['Business','Biz'],['Personal','Personal']].map(([v,l]) => (
            <div key={v}><RadioGroupItem value={v} id={v} className="peer sr-only" /><Label htmlFor={v} className="flex items-center justify-center rounded-xl border-2 border-muted bg-popover p-2 h-11 text-[9px] font-black uppercase hover:bg-accent peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/5 peer-data-[state=checked]:text-primary transition-all cursor-pointer">{l}</Label></div>
          ))}
        </RadioGroup>
        <div className="space-y-2">
          <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Category</Label>
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="h-12 rounded-2xl border-2"><SelectValue placeholder="All Categories" /></SelectTrigger>
            <SelectContent className="rounded-xl border-2 shadow-2xl">
              <SelectItem value="all" className="font-bold">All Categories</SelectItem>
              {(categories as string[]).map(cat => <SelectItem key={cat} value={cat} className="font-bold">{cat}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <Separator />
        <div className="p-5 rounded-[2rem] bg-primary/[0.03] border-2 border-primary/10 space-y-3">
          <p className="text-[10px] font-black uppercase tracking-widest text-primary text-center">Period Performance</p>
          <div className="space-y-2 text-xs">
            {[['Total Revenue', financialSummary.revenue, 'text-green-600'],['COGS', -financialSummary.cogs, 'text-destructive'],['Gross Profit', financialSummary.grossProfit, 'text-slate-900'],['Op. Expenses', -financialSummary.operatingExpenses, 'text-destructive']].map(([label, val, cls]) => (
              <div key={label as string} className="flex justify-between font-bold"><span>{label as string}</span><span className={cn('font-mono', cls as string)}>{(val as number) < 0 ? '-' : ''}${Math.abs(val as number).toFixed(2)}</span></div>
            ))}
            <div className="flex justify-between border-t-4 border-primary/20 pt-3 mt-3">
              <span className="font-black uppercase text-[11px] text-primary">Net Income</span>
              <span className={cn('font-black text-xl tracking-tighter font-mono', financialSummary.net >= 0 ? 'text-primary' : 'text-destructive')}>${financialSummary.net.toFixed(2)}</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

// ─── TransactionRow / TransactionCard ─────────────────────────────────────────
const TxnActions = ({ transaction, onRevertClick, onPreviewReceipt, onRefundClick, stopProp }: any) => (
  <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button aria-haspopup="true" size="icon" variant="ghost" className="h-8 w-8 rounded-full opacity-0 group-hover:opacity-100 transition-opacity shrink-0" onClick={stopProp}>
        <MoreHorizontal className="h-4 w-4" />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="rounded-2xl shadow-xl border-2 p-1">
      {transaction.type === 'income' && (
        <DropdownMenuItem onClick={(e: any) => { e.stopPropagation(); onRefundClick(transaction); }} className="font-bold uppercase text-[10px] tracking-widest text-destructive rounded-xl h-10 px-3">
          <Undo2 className="w-3.5 h-3.5 mr-2" /> Protocol Refund
        </DropdownMenuItem>
      )}
      <DropdownMenuItem onClick={(e: any) => { e.stopPropagation(); onRevertClick(transaction); }} disabled={transaction.type === 'reversal'} className="font-bold uppercase text-[10px] tracking-widest rounded-xl h-10 px-3">
        <RefreshCw className="w-3.5 h-3.5 mr-2" /> Revert Entry
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
);

const amountColor = (t: Transaction) => t.type === 'income' ? 'text-green-600' : t.type === 'reversal' ? 'text-slate-400' : 'text-destructive';
const amountPrefix = (t: Transaction) => t.type === 'income' ? '+' : t.type === 'reversal' ? '' : '-';

const TransactionRow = ({ transaction, staffMember, onRevertClick, onPreviewReceipt, onViewDetails, onRefundClick }: any) => (
  <TableRow className="group hover:bg-primary/[0.02] cursor-pointer" onClick={() => onViewDetails(transaction)}>
    <TableCell>
      <div className="flex items-center gap-4 py-1">
        <div className={cn('p-2 rounded-full shrink-0', transaction.type === 'income' ? 'bg-green-500/10' : transaction.type === 'expense' ? 'bg-destructive/10' : 'bg-primary/10')}>
          <TransactionIcon type={transaction.type} />
        </div>
        <div className="min-w-0">
          <span className="font-black uppercase tracking-tight text-xs md:text-sm text-slate-900 truncate block">{transaction.description}</span>
          <span className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest opacity-60 truncate block">{transaction.clientOrVendor}</span>
        </div>
      </div>
    </TableCell>
    <TableCell className="text-[10px] font-black uppercase text-muted-foreground opacity-70">{fmt(transaction.date, 'MMM d, p')}</TableCell>
    <TableCell>
      {staffMember
        ? <div className="flex items-center gap-2"><Avatar className="h-7 w-7 border-2 shadow-sm rounded-xl shrink-0"><AvatarImage src={staffMember.avatarUrl} className="object-cover" /><AvatarFallback className="text-[9px] bg-primary/10 text-primary font-black">{(staffMember.name||'S').charAt(0)}</AvatarFallback></Avatar><span className="text-[10px] font-black uppercase tracking-tight text-slate-700 truncate">{staffMember.name.split(' ')[0]}</span></div>
        : <span className="text-[9px] font-black uppercase text-muted-foreground italic opacity-40">System</span>}
    </TableCell>
    <TableCell><Badge className={cn('text-[9px] h-5 px-2 font-black uppercase tracking-widest border-none', transaction.context === 'Business' ? 'bg-indigo-100 text-indigo-800' : 'bg-purple-100 text-purple-800')}>{transaction.context}</Badge></TableCell>
    <TableCell className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider"><div className="flex items-center gap-2"><CreditCard className="w-3.5 h-3.5 opacity-40 shrink-0" /><span className="truncate">{transaction.paymentMethod}</span></div></TableCell>
    <TableCell className="text-[10px] font-black text-muted-foreground uppercase tracking-widest opacity-60">{transaction.category}</TableCell>
    <TableCell className="text-right">
      <div className="flex items-center justify-end gap-2">
        {(transaction as any).receiptId && (
          <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full hover:bg-primary/10 shrink-0" onClick={e => { e.stopPropagation(); onPreviewReceipt(transaction); }}>
            <Receipt className="h-4 w-4 text-primary/40" />
          </Button>
        )}
        <span className={cn('font-mono text-sm md:text-base font-black tracking-tighter shrink-0', amountColor(transaction))}>
          {amountPrefix(transaction)}${transaction.amount.toFixed(2)}
        </span>
      </div>
    </TableCell>
    <TableCell><TxnActions transaction={transaction} onRevertClick={onRevertClick} onPreviewReceipt={onPreviewReceipt} onRefundClick={onRefundClick} stopProp={(e: any) => e.stopPropagation()} /></TableCell>
  </TableRow>
);

const TransactionCard = ({ transaction, staffMember, onRevertClick, onPreviewReceipt, onViewDetails, onRefundClick }: any) => (
  <Card className="border-2 shadow-sm rounded-3xl overflow-hidden group cursor-pointer" onClick={() => onViewDetails(transaction)}>
    <CardContent className="p-5 space-y-3">
      <div className="flex items-start gap-4">
        <div className={cn('p-2.5 rounded-2xl shadow-inner shrink-0', transaction.type === 'income' ? 'bg-green-500/10' : transaction.type === 'expense' ? 'bg-destructive/10' : 'bg-muted')}>
          <TransactionIcon type={transaction.type} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-black text-sm uppercase tracking-tight text-slate-900 truncate">{transaction.description}</p>
          <p className="text-[10px] text-muted-foreground font-black uppercase tracking-widest opacity-60">{transaction.clientOrVendor} · {fmt(transaction.date, 'MMM d, p')}</p>
          {staffMember && <div className="flex items-center gap-2 mt-1"><Avatar className="h-6 w-6 border rounded-xl shadow-sm shrink-0"><AvatarImage src={staffMember.avatarUrl} className="object-cover" /><AvatarFallback className="text-[8px] font-black bg-primary/10 text-primary">{(staffMember.name||'S').charAt(0)}</AvatarFallback></Avatar><span className="text-[10px] font-black uppercase text-primary tracking-tight truncate">{staffMember.name}</span></div>}
        </div>
        <div className="text-right shrink-0 flex flex-col items-end gap-1">
          <p className={cn('font-black font-mono text-lg tracking-tighter', amountColor(transaction))}>{amountPrefix(transaction)}${transaction.amount.toFixed(2)}</p>
          {(transaction as any).receiptId && (
            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full hover:bg-primary/10 shrink-0" onClick={e => { e.stopPropagation(); onPreviewReceipt(transaction); }}>
              <Receipt className="h-4 w-4 text-primary opacity-40" />
            </Button>
          )}
        </div>
      </div>
      <div className="flex items-center justify-between pt-3 border-t border-dashed">
        <div className="flex items-center gap-2">
          <Badge className={cn('text-[9px] h-5 px-2 font-black uppercase tracking-widest border-none', transaction.context === 'Business' ? 'bg-indigo-100 text-indigo-800' : 'bg-purple-100 text-purple-800')}>{transaction.context}</Badge>
          <Badge variant="outline" className="text-[9px] h-5 px-2 uppercase font-black tracking-widest text-muted-foreground/60 border-2">{transaction.category}</Badge>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[9px] text-muted-foreground font-black uppercase tracking-widest opacity-50 flex items-center gap-1 truncate max-w-[80px]"><CreditCard className="w-3 h-3 shrink-0" />{transaction.paymentMethod}</span>
          <TxnActions transaction={transaction} onRevertClick={onRevertClick} onPreviewReceipt={onPreviewReceipt} onRefundClick={onRefundClick} stopProp={(e: any) => e.stopPropagation()} />
        </div>
      </div>
    </CardContent>
  </Card>
);

// ─── LedgerPage ───────────────────────────────────────────────────────────────
const LedgerPage = () => {
  const { firestore } = useFirebase();
  const { selectedTenant } = useTenant();
  const tenantId = selectedTenant?.id;
  const isMobile = useIsMobile();
  const { toast } = useToast();

  const { transactions, staff, tillSessions, services, appointments, inventory, isLoading } = useInventory();

  const [periodPreset, setPeriodPreset] = useState('30days');
  const [date, setDate] = useState<DateRange | undefined>(undefined);
  const [searchTerm, setSearchTerm] = useState('');
  const [contextFilter, setContextFilter] = useState<'all' | 'Business' | 'Personal'>('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [isAddTxnOpen, setIsAddTxnOpen] = useState(false);
  const [transactionToRevert, setTransactionToRevert] = useState<Transaction | null>(null);
  const [previewTransaction, setPreviewTransaction] = useState<Transaction | null>(null);
  const [selectedDossier, setSelectedDossier] = useState<Transaction | null>(null);
  const [transactionToRefund, setTransactionToRefund] = useState<Transaction | null>(null);

  useEffect(() => {
    const now = new Date();
    const presets: Record<string, DateRange> = {
      today:     { from: startOfDay(now), to: endOfDay(now) },
      '7days':   { from: startOfDay(subDays(now, 6)), to: endOfDay(now) },
      '30days':  { from: startOfDay(subDays(now, 29)), to: endOfDay(now) },
      thisMonth: { from: startOfMonth(now), to: endOfMonth(now) },
      lastMonth: { from: startOfMonth(subMonths(now, 1)), to: endOfMonth(subMonths(now, 1)) },
    };
    if (periodPreset !== 'custom') setDate(presets[periodPreset]);
  }, [periodPreset]);

  const filteredTransactions = useMemo(() => {
    if (!transactions) return [];
    return transactions.filter(t => {
      const d = safeDate(t.date);
      if (date?.from && d < startOfDay(date.from)) return false;
      if (date?.to && d > endOfDay(date.to)) return false;
      if (searchTerm && !t.description.toLowerCase().includes(searchTerm.toLowerCase()) && !t.clientOrVendor.toLowerCase().includes(searchTerm.toLowerCase())) return false;
      if (contextFilter !== 'all' && t.context !== contextFilter) return false;
      if (categoryFilter !== 'all' && t.category !== categoryFilter) return false;
      return true;
    }).sort((a, b) => safeDate(b.date).getTime() - safeDate(a.date).getTime());
  }, [transactions, date, searchTerm, contextFilter, categoryFilter]);

  const financialSummary = useMemo(() => {
    const cogs_cats = ['spoilage', 'supplies', 'cost of goods', 'spoilage'];
    const revenue = filteredTransactions.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
    const cogs = filteredTransactions.filter(t => t.type === 'expense' && cogs_cats.some(c => t.category.toLowerCase().includes(c))).reduce((s, t) => s + t.amount, 0);
    const operatingExpenses = filteredTransactions.filter(t => t.type === 'expense' && !cogs_cats.some(c => t.category.toLowerCase().includes(c))).reduce((s, t) => s + t.amount, 0);
    return { revenue, cogs, grossProfit: revenue - cogs, operatingExpenses, net: revenue - cogs - operatingExpenses };
  }, [filteredTransactions]);

  // ── Fast print: build HTML in memory, open new window, print instantly ──────
  const handlePrint = useCallback(() => {
    const html = buildPrintHtml(filteredTransactions, staff || [], financialSummary, date);
    const win = window.open('', '_blank', 'width=900,height=700');
    if (!win) { toast({ variant: 'destructive', title: 'Pop-up blocked', description: 'Allow pop-ups for this site to print.' }); return; }
    win.document.write(html);
    win.document.close();
    // Small delay lets the browser finish layout before print dialog
    setTimeout(() => { win.focus(); win.print(); }, 400);
  }, [filteredTransactions, staff, financialSummary, date, toast]);

  const handleAddTransaction = (data: Omit<Transaction, 'id'>) => {
    if (!firestore || !tenantId) return;
    addDocumentNonBlocking(collection(firestore, 'tenants', tenantId, 'transactions'), data);
    setIsAddTxnOpen(false);
  };

  const handleRevertTransaction = (target?: Transaction) => {
    const t = target || transactionToRevert;
    if (!t || !firestore || !tenantId) return;
    if (t.type === 'reversal') { toast({ variant: 'destructive', title: 'Cannot revert a reversal.' }); setTransactionToRevert(null); return; }
    handleAddTransaction({ ...t, date: new Date().toISOString(), description: `Reversal of: ${t.description}`, type: 'reversal', reversalOf: t.id });
    toast({ title: 'Transaction Reverted' });
    setTransactionToRevert(null);
    setSelectedDossier(null);
  };

  const handleRefundConfirm = async (data: any) => {
    if (!transactionToRefund || !firestore || !tenantId) return;
    const activeTill = tillSessions?.find(s => s.status === 'open');
    const isCash = transactionToRefund.paymentMethod?.toLowerCase() === 'cash';
    if (isCash && !activeTill) { toast({ variant: 'destructive', title: 'Till Required' }); return; }
    const batch = writeBatch(firestore);
    const now = new Date().toISOString();
    const refundTotal = data.amount + (data.refundTip ? (transactionToRefund.tipAmount || 0) : 0);
    const txnRef = doc(collection(firestore, `tenants/${tenantId}/transactions`));
    batch.set(txnRef, { id: txnRef.id, date: now, description: `Refund for: ${transactionToRefund.description}`, clientOrVendor: transactionToRefund.clientOrVendor, clientId: transactionToRefund.clientId, type: 'reversal', context: transactionToRefund.context, category: 'Refunds', amount: refundTotal, paymentMethod: transactionToRefund.paymentMethod, reversalOf: transactionToRefund.id, hasReceipt: false, notes: `Refund Reason: ${data.reason}` });
    if (isCash && activeTill) {
      const updates: any = { expectedCash: increment(-refundTotal), totalCashRefunds: increment(refundTotal) };
      if (data.refundTip && data.tipStrategy === 'clawback' && transactionToRefund.staffId) { updates[`cashTipsByStaff.${transactionToRefund.staffId}`] = increment(-(transactionToRefund.tipAmount || 0)); updates.totalCashTips = increment(-(transactionToRefund.tipAmount || 0)); }
      batch.update(doc(firestore, `tenants/${tenantId}/tillSessions`, activeTill.id), updates);
    }
    if (data.logIncident && transactionToRefund.clientId) {
      const incidentId = nanoid();
      const incident: Incident = { id: incidentId, date: now, type: 'Refund Incident', severity: 'Moderate', description: `Auto-incident filed during refund. Original: ${transactionToRefund.id}. Reason: ${data.reason}`, actionsTaken: `Reversed: $${refundTotal.toFixed(2)} via ${transactionToRefund.paymentMethod}.` };
      batch.update(doc(firestore, `tenants/${tenantId}/clients`, transactionToRefund.clientId), { 'intel.incidents': arrayUnion(incident), 'intel.hasIncidents': true });
    }
    batch.update(doc(firestore, `tenants/${tenantId}/transactions`, transactionToRefund.id), { refundedAt: now, refundTransactionId: txnRef.id });
    try { await batch.commit(); toast({ title: 'Refund Authorized', description: `$${refundTotal.toFixed(2)} reversed.` }); setTransactionToRefund(null); }
    catch (e) { console.error(e); toast({ variant: 'destructive', title: 'Process Error' }); }
  };

  const sharedRowProps = (transaction: Transaction) => ({
    transaction, staffMember: (staff || []).find(s => s.id === transaction.staffId),
    onRevertClick: () => setTransactionToRevert(transaction),
    onPreviewReceipt: (t: Transaction) => setPreviewTransaction(t),
    onViewDetails: (t: Transaction) => setSelectedDossier(t),
    onRefundClick: setTransactionToRefund,
  });

  const filterProps = { transactions: transactions || [], date, setDate, periodPreset, setPeriodPreset, searchTerm, setSearchTerm, contextFilter, setContextFilter, categoryFilter, setCategoryFilter, financialSummary };

  return (
    <div className="flex min-h-screen w-full flex-col overflow-x-hidden bg-background">
      <AppHeader title="Studio Ledger" />
      <main className="flex-1 p-4 md:p-10 w-full max-w-7xl mx-auto">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6 mb-10">
          <div>
            <h1 className="text-3xl md:text-5xl font-black uppercase tracking-tighter text-slate-900 leading-none">The Ledger</h1>
            <p className="text-sm text-muted-foreground font-black uppercase tracking-[0.2em] opacity-60">Official financial audit trail</p>
          </div>
          <div className="flex items-center gap-3 w-full md:w-auto">
            <Button variant="outline" onClick={handlePrint} className="flex-1 md:flex-none h-14 px-8 rounded-2xl border-2 font-black uppercase text-[10px] tracking-widest shadow-sm bg-white">
              <Printer className="mr-2 h-4 w-4" /> Print Log
            </Button>
            <Button onClick={() => setIsAddTxnOpen(true)} className="flex-1 md:flex-none h-14 px-8 rounded-2xl shadow-xl font-black uppercase tracking-widest text-[10px] shadow-primary/20">
              <PlusCircle className="mr-2 h-4 w-4" /> New Entry
            </Button>
          </div>
        </div>

        <div className="grid md:grid-cols-3 lg:grid-cols-4 gap-8 items-start">
          <div className="md:col-span-1">
            {isMobile ? (
              <Accordion type="single" collapsible className="w-full mb-6">
                <AccordionItem value="filters" className="border-none">
                  <AccordionTrigger className="p-5 bg-primary/5 rounded-[2rem] border-2 border-primary/10 hover:no-underline shadow-sm">
                    <div className="flex items-center gap-3"><Filter className="w-5 h-5 text-primary" /><span className="font-black uppercase text-xs tracking-widest text-primary">Summary & Filters</span></div>
                  </AccordionTrigger>
                  <AccordionContent className="pt-6"><TransactionFilters {...filterProps} /></AccordionContent>
                </AccordionItem>
              </Accordion>
            ) : <TransactionFilters {...filterProps} />}
          </div>

          <div className="md:col-span-2 lg:col-span-3 space-y-6 min-w-0">
            <Card className="hidden md:block border-2 shadow-2xl rounded-[2.5rem] overflow-hidden bg-white">
              <CardContent className="p-0 overflow-x-auto">
                <Table>
                  <TableHeader className="bg-muted/30 border-b-2">
                    <TableRow>
                      {['Description & Entity','Timestamp','Provider','Context','Account','Category'].map(h => (
                        <TableHead key={h} className="font-black text-[10px] uppercase tracking-[0.2em] p-6 text-slate-900">{h}</TableHead>
                      ))}
                      <TableHead className="text-right font-black text-[10px] uppercase tracking-[0.2em] text-primary pr-10">Amount</TableHead>
                      <TableHead><span className="sr-only">Actions</span></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoading && <TableRow><TableCell colSpan={8} className="h-64 text-center"><div className="flex flex-col items-center gap-4"><Loader className="w-10 h-10 animate-spin text-primary" /><p className="font-black uppercase text-[10px] tracking-widest text-primary opacity-60">Synchronizing Ledger...</p></div></TableCell></TableRow>}
                    {!isLoading && filteredTransactions.map(t => <TransactionRow key={t.id} {...sharedRowProps(t)} />)}
                    {!isLoading && filteredTransactions.length === 0 && <TableRow><TableCell colSpan={8} className="h-64 text-center"><div className="space-y-2 opacity-30"><BookOpen className="w-12 h-12 mx-auto" /><p className="uppercase font-black tracking-widest text-xs">No records found</p></div></TableCell></TableRow>}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <div className="md:hidden space-y-4">
              {isLoading && <div className="flex flex-col items-center justify-center py-24"><Loader className="w-10 h-10 animate-spin text-primary mb-4" /><p className="text-[10px] font-black uppercase tracking-widest text-primary">Syncing...</p></div>}
              {!isLoading && filteredTransactions.length > 0 && <div className="grid gap-4">{filteredTransactions.map(t => <TransactionCard key={t.id} {...sharedRowProps(t)} />)}</div>}
              {!isLoading && filteredTransactions.length === 0 && <div className="text-center py-24 opacity-30 border-4 border-dashed rounded-[3rem] flex flex-col items-center gap-4"><BookOpen className="w-16 h-16" /><p className="text-sm font-black uppercase tracking-widest">No entries found</p></div>}
            </div>
          </div>
        </div>
      </main>

      <AddTransactionDialog open={isAddTxnOpen} onOpenChange={setIsAddTxnOpen} staff={staff || []} onConfirm={handleAddTransaction} />

      <AlertDialog open={!!transactionToRevert} onOpenChange={() => setTransactionToRevert(null)}>
        <AlertDialogContent className="rounded-[3rem] border-4 shadow-3xl bg-background">
          <AlertDialogHeader className="p-6 pb-0">
            <AlertDialogTitle className="font-black uppercase tracking-tighter text-2xl">Confirm Reversal</AlertDialogTitle>
            <AlertDialogDescription className="font-bold text-sm text-slate-600 leading-relaxed uppercase tracking-tight">
              Create an audit-trail reversal for &quot;{transactionToRevert?.description}&quot;?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="p-6 pt-4 flex flex-col gap-3">
            <Button onClick={() => handleRevertTransaction()} className="w-full h-16 rounded-2xl font-black uppercase tracking-widest shadow-2xl shadow-primary/20">Yes, Revert Entry</Button>
            <AlertDialogCancel onClick={() => setTransactionToRevert(null)} className="w-full h-12 rounded-xl font-bold uppercase text-[10px] tracking-widest border-none bg-transparent">Cancel</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ReceiptPreviewDialog
        transaction={previewTransaction}
        tenantId={tenantId || ''}
        open={!!previewTransaction}
        onOpenChange={o => { if (!o) setPreviewTransaction(null); }}
      />

      <TransactionDossierSheet open={!!selectedDossier} onOpenChange={o => { if (!o) setSelectedDossier(null); }} transaction={selectedDossier} staff={staff || []} onRevert={handleRevertTransaction} />

      <RefundProtocolDialog open={!!transactionToRefund} onOpenChange={(v: boolean) => { if (!v) setTransactionToRefund(null); }} transaction={transactionToRefund} staff={staff || []} services={services || []} appointments={appointments || []} inventory={inventory || []} tenant={selectedTenant} onConfirm={handleRefundConfirm} />
    </div>
  );
};

export default LedgerPage;
