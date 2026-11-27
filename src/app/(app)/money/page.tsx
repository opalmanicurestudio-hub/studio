'use client';

import { hourlyRate, planCost, stationMinutes } from '@/lib/product-cost';
import { getAuth } from 'firebase/auth';
import { payPost } from '@/components/pay/pay-client';
import { PayStatement } from '@/components/staff/PayStatement';
import { serviceCommission, earnsCommission, rateFor, serviceEarnings, paidPerService, payExtras, reversalsFor } from '@/lib/commission';
import { periodPay, payrollFields } from '@/lib/pay-period';
import { sessionsFrom, clockPolicy } from '@/lib/timeclock';
import { useTransactionsInRange, usePunchesInRange } from '@/hooks/use-transactions';
import { useAppointmentsByIds } from '@/hooks/use-appointments';
import { RestockingFundCard } from '@/components/money/RestockingFundCard';
import { AppPayoutsCard } from '@/components/money/AppPayoutsCard';
import { MonthCloseCard } from '@/components/money/MonthCloseCard';
import { MoneyOverview } from '@/components/money/MoneyOverview';
import { closeOf, inClosedMonth, monthName } from '@/lib/books-close';
import { MilesCard } from '@/components/money/MilesCard';
import { TipShareCard } from '@/components/money/TipShareCard';
import { OwedToClientsCard } from '@/components/money/OwedToClientsCard';
import React, { useState, useMemo, useRef, useEffect, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { AppHeader } from '@/components/shared/AppHeader';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  MoreHorizontal, PlusCircle, TrendingUp, TrendingDown, RefreshCw, Paperclip,
  BookOpen, CreditCard, Printer, Filter, X, Loader, Search, ShieldCheck,
  Landmark, ShoppingCart, CalendarCheck, FileX, Undo2, Lock, FileWarning,
  Banknote, DollarSign, Scale, Clock, Package, Users, CheckCircle2, Receipt,
  ArrowUpRight, ArrowDownRight, Minus, BarChart3, AlertCircle,
  Building, User, PiggyBank, Wallet, Calculator, Info,
  ChevronLeft, ChevronRight, CalendarRange, LayoutDashboard, ArrowRight,
  History,
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
import {
  format, startOfDay, endOfDay, parseISO, subDays,
  startOfMonth, endOfMonth, subMonths, differenceInMinutes,
  differenceInDays, eachDayOfInterval, isSameDay,
  addDays, addMonths,
  startOfWeek, endOfWeek,
} from 'date-fns';
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import {
  getStateProfile, suggestedAllocation, estimateEmployerPayrollTax,
  STATE_OPTIONS, GENERIC_US_PROFILE, RATES_VINTAGE, ratesAreStale,
} from '@/lib/state-tax-profiles';
import { COUNTRY_OPTIONS, getCountryOption } from '@/lib/tax-jurisdictions';
import { auditEntry } from '@/lib/audit';
import { booksSummary, effectOf, isTeamPay, lookupOf, netSalesOf, normalizeLine, type BooksSummary } from '@/lib/books-summary';
import { esc, printLine, printMoney, printPage } from '@/lib/print-style';
import { buildLedgerHtml, ledgerCsv } from '@/lib/report-builders';
import { csvName, downloadCsv } from '@/lib/csv';
import {
  getGustoConnection, beginGustoConnect, submitGustoPayroll,
  type GustoPayrollDraft,
} from '@/lib/gusto';
import { Input } from '@/components/ui/input';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DateRange } from 'react-day-picker';
import { cn, safeNumber } from '@/lib/utils';
import { useFirebase, useUser, addDocumentNonBlocking, updateDocumentNonBlocking, useCollection, useMemoFirebase } from '@/firebase';
import { resolveActiveStaffId } from '@/lib/staff-identity';
import { AddTransactionDialog } from '@/components/ledger/AddTransactionDialog';
import { BadDebtAgingCard } from '@/components/ledger/BadDebtAgingCard';
import { useToast } from '@/hooks/use-toast';
import { useTenant } from '@/context/TenantContext';
import { OwedToClients } from '@/components/money/OwedToClients';
import { BankScreen } from '@/components/money/BankScreen';
import { BooksScreen, wayOf, type BooksFilters } from '@/components/money/BooksScreen';
import { ReportsScreen } from '@/components/money/ReportsScreen';
import { PaydayScreen, spanWords } from '@/components/money/PaydayScreen';
import { BillsScreen, PAY_WAYS } from '@/components/money/BillsScreen';
import { ActivityScreen } from '@/components/money/ActivityScreen';
import { bucketFor } from '@/lib/categories';
import { useInventory } from '@/context/InventoryContext';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { collection, doc, writeBatch, increment, arrayUnion, getDoc, getDocs, getCountFromServer, query, where, onSnapshot, orderBy, limit, runTransaction, setDoc } from 'firebase/firestore';
import { Separator } from '@/components/ui/separator';
import { motion, AnimatePresence } from 'framer-motion';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import Link from 'next/link';
import { nanoid } from 'nanoid';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useOpenTill } from '@/hooks/use-till';
import { useClientsOwing } from '@/hooks/use-clients';

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

const fmtCurrency = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(n);

// ── Audit trail (client writer) — appends to tenants/{id}/auditLogs.
// Logging must never break the action it describes.
const writeAudit = (firestore: any, tenantId: string | undefined | null, e: any) => {
  if (!firestore || !tenantId) return;
  try {
    addDocumentNonBlocking(collection(firestore, `tenants/${tenantId}/auditLogs`), auditEntry(e));
  } catch { /* non-fatal */ }
};

// ── Who is acting? Resolves the signed-in user to their staff identity so
// the audit trail names the TEAM MEMBER, not just "user". Owners can then
// see exactly who on their team did what across the business.
const useAuditActor = () => {
  const { user: currentUser } = useUser();
  const { staff } = useInventory();
  return useMemo(() => {
    const staffId = resolveActiveStaffId(currentUser?.uid);
    const member = (staff || []).find((s: any) => s.id === staffId);
    return {
      type: 'user' as const,
      id: member?.id || currentUser?.uid || undefined,
      name: member?.name || currentUser?.displayName || currentUser?.email || 'Unknown user',
      role: member?.role || undefined,
    };
  }, [currentUser?.uid, currentUser?.displayName, currentUser?.email, staff]);
};

// ─── ReceiptPreviewDialog (unchanged) ─────────────────────────────────────────

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
    <style>* { box-sizing:border-box; margin:0; padding:0; } body { font-family:'Courier New',monospace; font-size:13px; padding:20px 16px; max-width:300px; margin:0 auto; } h1 { font-size:16px; text-align:center; font-weight:bold; margin-bottom:2px; } .sub { text-align:center; color:#666; font-size:11px; margin-bottom:14px; } hr { border:none; border-top:1px dashed #bbb; margin:10px 0; } .row { display:flex; justify-content:space-between; margin:4px 0; } .muted { color:#555; } .bold { font-weight:bold; } .total { font-size:15px; font-weight:bold; border-top:1px solid #000; padding-top:8px; margin-top:6px; } .green { color:#2d6a0f; } .footer { text-align:center; margin-top:20px; color:#666; font-size:11px; line-height:2; } @media print { body { padding:0; } }</style></head><body>
    <h1>${receipt.studioName || 'Studio'}</h1>
    <div class="sub">${receipt.date ? format(new Date(receipt.date), 'MMM d, yyyy · h:mm a') : ''}<br>Guest: ${receipt.clientName || 'Guest'}${receipt.cashierName ? `<br>Served by: ${receipt.cashierName}` : ''}</div>
    <hr>${lines}<hr>
    <div class="row muted"><span>Subtotal</span><span>$${(receipt.subtotal || 0).toFixed(2)}</span></div>
    ${(receipt.discount || 0) > 0 ? `<div class="row muted"><span>Discount</span><span>-$${receipt.discount.toFixed(2)}</span></div>` : ''}
    <div class="row muted"><span>Tax</span><span>$${(receipt.tax || 0).toFixed(2)}</span></div>
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
          <DialogTitle className="text-xl font-black uppercase tracking-tighter text-foreground truncate">{transaction.description}</DialogTitle>
        </DialogHeader>
        <div className="p-6 max-h-[60vh] overflow-y-auto">
          {loading && <div className="flex flex-col items-center gap-3 py-12"><Loader className="w-8 h-8 animate-spin text-primary" /><p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Loading receipt...</p></div>}
          {!loading && notFound && <div className="flex flex-col items-center gap-3 py-12 opacity-30"><FileX className="w-12 h-12" /><p className="text-[10px] font-black uppercase tracking-widest text-center">Receipt not on file.<br />Receipts are generated from checkout v2+</p></div>}
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
                    <div className="flex-1 min-w-0"><span className="font-bold text-[12px] text-foreground block truncate">{item.label}</span>{item.staff && <span className="text-[10px] text-muted-foreground">· {item.staff}</span>}</div>
                    <span className="font-black text-foreground shrink-0">${item.amount.toFixed(2)}</span>
                  </div>
                ))}
              </div>
              <div className="pt-3 border-t border-dashed space-y-1.5">
                <div className="flex justify-between text-[12px] text-muted-foreground"><span>Subtotal</span><span>${(receipt.subtotal || 0).toFixed(2)}</span></div>
                {(receipt.discount || 0) > 0 && <div className="flex justify-between text-[12px] text-primary"><span>Discount</span><span>-${receipt.discount.toFixed(2)}</span></div>}
                <div className="flex justify-between text-[12px] text-muted-foreground"><span>Tax</span><span>${(receipt.tax || 0).toFixed(2)}</span></div>
                {(receipt.tip || 0) > 0 && <div className="flex justify-between text-[12px] text-muted-foreground"><span>Gratuity</span><span>${receipt.tip.toFixed(2)}</span></div>}
                <div className="flex justify-between text-[14px] font-black pt-2 border-t border-slate-900"><span>TOTAL</span><span>${(receipt.total || 0).toFixed(2)}</span></div>
              </div>
              <div className="pt-3 border-t border-dashed space-y-1.5">
                <div className="flex justify-between text-[12px] items-center">
                  <span className="flex items-center gap-1.5 font-bold">{receipt.paymentMethod?.toLowerCase().includes('cash') ? <Banknote className="w-3.5 h-3.5" /> : <CreditCard className="w-3.5 h-3.5" />}{receipt.paymentMethod}</span>
                  <span className="font-black">${(receipt.tendered || receipt.total || 0).toFixed(2)}</span>
                </div>
                {(receipt.change || 0) > 0.005 && <div className="flex justify-between text-[12px] text-green-700 font-black"><span className="flex items-center gap-1.5"><CheckCircle2 className="w-3.5 h-3.5" /> Change</span><span>${receipt.change.toFixed(2)}</span></div>}
              </div>
              <div className="text-center pt-2 text-[10px] text-muted-foreground opacity-50 border-t border-dashed">Thank you for your visit!</div>
            </div>
          )}
        </div>
        <DialogFooter className="p-6 pt-4 border-t bg-muted/5 flex flex-col gap-2">
          {receipt && <Button onClick={handlePrint} className="w-full h-12 rounded-2xl font-black uppercase text-[10px] tracking-widest shadow-xl shadow-primary/20"><Printer className="w-4 h-4 mr-2" /> Reprint Receipt</Button>}
          <Button variant="outline" className="w-full h-11 rounded-2xl font-black uppercase text-[10px] tracking-widest border-2" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

// ─── RefundProtocolDialog (unchanged) ────────────────────────────────────────

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
  const tmhr = hourlyRate(tenant);

  const costsBreakdown = useMemo(() => {
    if (!transaction || !services || !appointments || !staff) return { overhead: 0, materials: 0, labor: 0, staffMember: null };
    const apt = appointments.find((a: Appointment) => a.id === transaction.appointmentId);
    if (!apt) return { overhead: 0, materials: 0, labor: 0, staffMember: null };
    const svc = services.find((s: Service) => s.id === apt.serviceId);
    if (!svc) return { overhead: 0, materials: 0, labor: 0, staffMember: null };
    let materials = 0;
    if (apt.checkoutState?.formula?.length > 0) {
      materials = apt.checkoutState.formula.reduce((acc: number, item: any) => acc + item.quantity * item.costPerUnit, 0);
    } else {
      materials = planCost(svc, inventory).total;
    }
    const actualDuration = apt.actualStartTime && apt.actualEndTime
      ? differenceInMinutes(safeDate(apt.actualEndTime), safeDate(apt.actualStartTime))
      : (apt.checkoutState?.actualDuration || svc.duration || 60);
    // A finished visit: the real time plus the service's set-up and clean-up (lib/product-cost stationMinutes).
    const overhead = (stationMinutes(svc, { actualMin: actualDuration }) / 60) * tmhr;
    const staffMember = staff.find((s: Staff) => s.id === apt.staffId);
    let labor = 0;
    if (earnsCommission(staffMember)) labor = transaction.amount * (Number(transaction.commissionPct) >= 0 && transaction.commissionPct != null ? Number(transaction.commissionPct) : rateFor(staffMember, svc, 40)) / 100;
    else if (staffMember?.payStructure === 'hourly' && staffMember.hourlyRate) labor = (actualDuration / 60) * staffMember.hourlyRate;
    return { overhead, materials, labor, staffMember };
  }, [transaction, services, appointments, tmhr, staff, inventory]);

  // Commission on a refunded service: taken back (or kept) — the business's default, changeable here.
  const isServiceSale = transaction?.category === 'Service Revenue' && !!transaction?.staffId;
  const [takeBack, setTakeBack] = useState<boolean>(true);
  const [later, setLater] = useState(false);   // a cash sale with the client not here: they choose pickup, an app or credit
  useEffect(() => { setTakeBack(((tenant as any)?.payRules?.refundCommission || 'take_back') !== 'keep'); }, [transaction?.id, (tenant as any)?.payRules?.refundCommission]);
  useEffect(() => {
    if (transaction) { setRefundAmount(transaction.amount); setReason(''); setLogIncident(false); setWithholdOverhead(false); setWithholdMaterials(false); setWithholdLabor(costsBreakdown.staffMember?.payStructure === 'hourly'); }
  }, [transaction?.id]);

  useEffect(() => {
    if (!transaction) return;
    const withheld = (withholdOverhead ? costsBreakdown.overhead : 0) + (withholdMaterials ? costsBreakdown.materials : 0) + (withholdLabor ? costsBreakdown.labor : 0);
    setRefundAmount(Math.max(0, Number((transaction.amount - withheld).toFixed(2))));
  }, [withholdOverhead, withholdMaterials, withholdLabor, transaction, costsBreakdown]);

  // (Every hook before the early return: the dialog is mounted with no line, then given one.)
  const [verifying, setVerifying] = useState(false);
  if (!transaction) return null;
  const isCard = transaction.paymentMethod?.toLowerCase().includes('card') || transaction.paymentMethod?.toLowerCase().includes('visa');
  const tipToRefund = refundTip ? (transaction.tipAmount || 0) : 0;
  const totalOutlay = refundAmount + tipToRefund;

  // v79 — manager PIN verified server-side (rate-limited; works after
  // PINs move out of client-readable staff docs). Client compare remains
  // only as a pre-deploy fallback.
  const handleAction = async () => {
    if (verifying) return;
    if (!reason.trim()) { toast({ variant: 'destructive', title: 'Reason Required' }); return; }
    setVerifying(true);
    try {
      let authorizerId: string | null = null;
      try {
        const res = await fetch('/api/portal/auth', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'verify-manager', tenantId: tenant?.id, pin }),
        });
        if (res.status === 404) throw new Error('__legacy__');
        const d = await res.json();
        if (d.ok && d.manager?.id) authorizerId = d.manager.id;
        else { toast({ variant: 'destructive', title: 'Unauthorized', description: d.error }); return; }
      } catch {
        toast({ variant: 'destructive', title: 'No connection', description: 'PINs are checked online — try again.' }); return;   // never compared on this device
      }
      onConfirm({ amount: refundAmount, refundTip: refundTip && (transaction.tipAmount || 0) > 0, tipStrategy, reason, logIncident, authorizerId, takeBack: isServiceSale && takeBack, later: !isCard && later });
      setPin('');
    } finally { setVerifying(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md rounded-[3rem] border-4 shadow-3xl p-0 overflow-hidden bg-background">
        <DialogHeader className="p-8 pb-6 border-b bg-muted/5 text-left">
          <div className="flex items-center gap-3 mb-2"><Undo2 className="w-5 h-5 text-destructive" /><span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground opacity-60">Revenue Reversal</span></div>
          <DialogTitle className="text-2xl font-black uppercase tracking-tighter text-foreground leading-none">Refund Protocol</DialogTitle>
          <DialogDescription className="text-xs font-bold uppercase tracking-widest opacity-60 mt-1">Initiating reversal sequence.</DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[60vh]">
          <div className="p-8 space-y-6">
            <div className="p-6 rounded-[2rem] bg-destructive/5 border-2 border-destructive/10 text-center space-y-2">
              <p className="text-[9px] font-black uppercase text-destructive/60 tracking-widest">Reversal Value</p>
              <p className="text-5xl font-black text-destructive tracking-tighter font-mono">${totalOutlay.toFixed(2)}</p>
              <p className="text-[10px] font-bold text-foreground/80 uppercase flex items-center justify-center gap-2">
                {isCard ? <Lock className="w-3 h-3" /> : <Banknote className="w-3 h-3" />}
                {isCard ? 'Original Card (Locked)' : transaction.paymentMethod}
              </p>
            </div>
            {!isCard && (
              <div className="space-y-2 rounded-2xl border p-4 text-[14px]">
                <p className="font-semibold">How they get it back</p>
                <label className="flex items-center gap-2"><input type="radio" name="refund-when" checked={!later} onChange={() => setLater(false)} className="h-4 w-4" /> They’re here — give it from the till now</label>
                <label className="flex items-center gap-2"><input type="radio" name="refund-when" checked={later} onChange={() => setLater(true)} className="h-4 w-4" /> They’re not here — text them to choose (cash pickup, an app or credit)</label>
                {later && <p className="text-[12px] text-muted-foreground">It goes on Refunds to give. Money records it when they collect or it’s sent.</p>}
              </div>
            )}
            {isServiceSale && (
              <div className="space-y-2 rounded-2xl border p-4 text-[14px]">
                <p className="font-semibold">The provider’s commission on this service</p>
                <label className="flex items-center gap-2"><input type="radio" name="refund-commission" checked={takeBack} onChange={() => setTakeBack(true)} className="h-4 w-4" /> Take it back from their next pay</label>
                <label className="flex items-center gap-2"><input type="radio" name="refund-commission" checked={!takeBack} onChange={() => setTakeBack(false)} className="h-4 w-4" /> They keep it (e.g. they fixed it, or it wasn’t their fault)</label>
                <p className="text-[12px] text-muted-foreground">In proportion to the amount refunded. An assistant’s share goes the same way.</p>
              </div>
            )}
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
              <div className="flex items-center gap-3"><div className="p-2 bg-muted rounded-xl"><Lock className="w-4 h-4 text-muted-foreground" /></div><Label className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground">Manager PIN</Label></div>
              <Input type="password" maxLength={4} value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, ''))} className="h-16 text-center text-4xl font-black tracking-[0.5em] rounded-2xl border-4 shadow-inner bg-muted/5" placeholder="••••" />
            </div>
          </div>
        </ScrollArea>
        <DialogFooter className="p-8 pt-4 border-t bg-muted/5 flex flex-col gap-3">
          <Button onClick={handleAction} disabled={pin.length < 4 || !reason.trim()} className="w-full h-16 rounded-2xl text-xl font-black uppercase bg-destructive text-destructive-foreground hover:bg-destructive/90">Authorize Reversal</Button>
          <Button variant="ghost" onClick={() => onOpenChange(false)} className="w-full font-black uppercase text-[10px] tracking-widest text-muted-foreground">Abort</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

// ─── LedgerTab (formerly LedgerPage) ──────────────────────────────────────────

const LedgerTab = () => {
  const { firestore } = useFirebase();
  const { selectedTenant } = useTenant();
  const tenantId = selectedTenant?.id;
  const { toast } = useToast();

  const { staff, services, inventory, isLoading: ctxLoading } = useInventory();
  const { openTills: tillSessions } = useOpenTill();   // only the open till
  const { clients } = useClientsOwing();   // bad-debt aging needs only clients who owe
  const auditActor = useAuditActor();
  const [periodPreset, setPeriodPreset] = useState('30days');
  const [date, setDate] = useState<DateRange | undefined>(undefined);
  // Only the period on screen is read.
  const txFromMs = date?.from ? startOfDay(date.from).getTime() : 0;
  const txToMs = date?.from ? endOfDay(date.to || date.from).getTime() + 1 : 0;
  const txFrom = useMemo(() => (txFromMs ? new Date(txFromMs) : null), [txFromMs]);
  const txTo = useMemo(() => (txToMs ? new Date(txToMs) : null), [txToMs]);
  const { transactions: rawTransactions, isLoading: txLoading } = useTransactionsInRange(txFrom, txTo);
  const isLoading = ctxLoading || txLoading || !date;
  // v58 — intake normalization: every consumer below assumes `amount`
  // (dollars) and `type` exist. Entries written with amountCents or a
  // missing type (early day-rental payments) are healed here instead of
  // crashing the page.
  // (The same reading as the overview and the printed reports: lib/books-summary normalizeLine. A line with no tax bucket
  // goes where its category says.)
  const transactions = useMemo(() => (rawTransactions || []).map((t: any) => ({
    ...normalizeLine(t),
    description:   t.description || '',
    clientOrVendor: t.clientOrVendor || '',
  })), [rawTransactions]);

  const [searchTerm, setSearchTerm] = useState('');
  const [contextFilter, setContextFilter] = useState<'all' | 'Business' | 'Personal'>('all');
  const [way, setWay] = useState<'all' | 'in' | 'out'>('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [isAddTxnOpen, setIsAddTxnOpen] = useState(false);
  const [previewTransaction, setPreviewTransaction] = useState<Transaction | null>(null);
  const [transactionToRefund, setTransactionToRefund] = useState<Transaction | null>(null);
  const { appointments: refundVisit } = useAppointmentsByIds(transactionToRefund?.appointmentId ? [String(transactionToRefund.appointmentId)] : []);   // just the visit being refunded

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

  const ledgerById = useMemo(() => lookupOf(transactions || []), [transactions]);
  const filteredTransactions = useMemo(() => {
    if (!transactions) return [];
    return transactions.filter(t => {
      const d = safeDate(t.date);
      if (date?.from && d < startOfDay(date.from)) return false;
      if (date?.to && d > endOfDay(date.to)) return false;
      if (searchTerm && ![t.description, t.clientOrVendor, t.category, (t as any).notes].some((x) => String(x || '').toLowerCase().includes(searchTerm.toLowerCase()))) return false;
      if (contextFilter !== 'all' && t.context !== contextFilter) return false;
      if (categoryFilter !== 'all' && t.category !== categoryFilter) return false;
      if (way !== 'all' && wayOf(t, ledgerById) !== way) return false;
      return true;
    }).sort((a, b) => safeDate(b.date).getTime() - safeDate(a.date).getTime());
  }, [transactions, date, searchTerm, contextFilter, categoryFilter, way, ledgerById]);

  // ── Financial summary: one reading of the ledger (lib/books-summary), shared with the printed reports. Sales less
  // returns and discounts; tips beside them (the team's pay includes them); sales tax and gift cards held, never income.
  // Reversals and voids find the line they undo across the whole ledger, not just this period.
  const financialSummary = useMemo(() => {
    const b = booksSummary(filteredTransactions, { lookup: transactions || [] });
    return {
      ...b,
      // The names the print report and the cards below read.
      revenue: b.netSales, taxLiability: b.taxOwed,
      processingFeesPaid: b.netFees, processingFeesCollected: b.feesPassedOn, netFeeImpact: b.feesPassedOn - b.netFees,
    };
  }, [filteredTransactions, transactions]);

  const openPrintWindow = useCallback((html: string) => {
    const win = window.open('', '_blank', 'width=900,height=700');
    if (!win) { toast({ variant: 'destructive', title: 'Pop-up blocked', description: 'Allow pop-ups for this site to print.' }); return; }
    // The document opens its own print dialog once its font and pictures have loaded (lib/print-style).
    win.document.write(html);
    win.document.close();
    win.focus();
  }, [toast]);

  // The lines on screen, printed or downloaded as a spreadsheet; every other report is on the Reports tab.
  const shopName = String((selectedTenant as any)?.name || '') || undefined;
  const handlePrint = useCallback(() => {
    openPrintWindow(buildLedgerHtml(filteredTransactions, staff || [], financialSummary, date, { lookup: transactions || [], shopName }));
  }, [filteredTransactions, transactions, staff, financialSummary, date, openPrintWindow, shopName]);
  const handleDownload = useCallback(() => {
    const d = date?.from && date?.to ? `${format(date.from, 'yyyy-MM-dd')} to ${format(date.to, 'yyyy-MM-dd')}` : '';
    downloadCsv(csvName(shopName || '', 'books', d), ledgerCsv(filteredTransactions, staff || [], { lookup: transactions || [] }));
  }, [filteredTransactions, transactions, staff, date, shopName]);

  const handleAddTransaction = (data: Omit<Transaction, 'id'>) => {
    if (!firestore || !tenantId) return;
    // A closed month keeps its lines as they are (lib/books-close): a line for it goes in today, as a correction.
    if (inClosedMonth(selectedTenant, (data as any).date)) {
      const c = closeOf(selectedTenant);
      toast({ variant: 'destructive', title: `${c ? monthName(c.through, false) : 'That month'} is closed`, description: 'Date it today instead: it goes in as a correction, and the closed month stays as it was.' });
      return;
    }
    addDocumentNonBlocking(collection(firestore, 'tenants', tenantId, 'transactions'), data);
    if (data.type !== 'reversal') {
      writeAudit(firestore, tenantId, {
        action: 'transaction.create', targetType: 'transaction',
        summary: `Manual ${data.type}: ${data.description} (${data.category})`,
        amount: data.amount, actor: auditActor,
      });
    }
    setIsAddTxnOpen(false);
  };

  // Undo a line: a line taking it back goes in today (the line stays, so the books show both), once: it's written as
  // undo_{line}, refused when there is one already. It carries what the line was and where it was sold (so the books and
  // the sales tax report read it as the line taken back), never its links (its bank match, its refund, its payment, its
  // receipt).
  const UNDO_KEEP = ['context', 'category', 'taxBucket', 'clientOrVendor', 'clientId', 'staffId', 'appointmentId', 'locationId', 'taxLocationId', 'taxRates', 'taxedAmount', 'taxFree', 'appKey', 'appTaxCents', 'retailOrderId', 'paymentMethod'];
  const undoLine = async (t: any): Promise<boolean | string> => {
    if (!t || !firestore || !tenantId) return false;
    if (t.type === 'reversal') return 'A line that takes another back can’t be undone itself.';
    const ref = doc(firestore, `tenants/${tenantId}/transactions`, `undo_${String(t.id)}`);
    const nowIso = new Date().toISOString();
    const data: any = { ...Object.fromEntries(UNDO_KEEP.filter((k) => t[k] !== undefined && t[k] !== null).map((k) => [k, t[k]])),
      id: ref.id, type: 'reversal', undo: true, reversalOf: t.id, reversedType: t.type, amount: Number(t.amount) || 0,
      description: `Undo: ${t.description || t.category}`, hasReceipt: false, date: nowIso, createdAt: nowIso, enteredBy: auditActor?.name || null };
    try {
      await runTransaction(firestore, async (tx) => {
        if ((await tx.get(ref)).exists()) throw Object.assign(new Error('already'), { code: 'already' });
        tx.set(ref, data);
      });
    } catch (e: any) { return e?.code === 'already' ? 'It was undone already.' : false; }
    writeAudit(firestore, tenantId, { action: 'transaction.revert', targetType: 'transaction', targetId: t.id, summary: `Undone: ${t.description || t.category}`, amount: t.amount, actor: auditActor });
    return true;
  };
  // (An Undo from before they were written as undo_{line}: a line taking the whole of it back, found by what it takes back.)
  const isUndone = async (t: any) => {
    if (!firestore || !tenantId) return false;
    if ((await getDoc(doc(firestore, `tenants/${tenantId}/transactions`, `undo_${String(t.id)}`))).exists()) return true;
    const q = await getDocs(query(collection(firestore, `tenants/${tenantId}/transactions`), where('reversalOf', '==', String(t.id)), limit(20)));
    return q.docs.some((d) => { const u: any = d.data(); return u.type === 'reversal' && !u.correctionOf && (u.undo || /^reversal of:/i.test(String(u.description || ''))) && Math.round((Number(u.amount) || 0) * 100) >= Math.round((Number(t.amount) || 0) * 100); });
  };

  const handleRefundConfirm = async (data: any) => {
    if (!transactionToRefund || !firestore || !tenantId) return;
    const activeTill = tillSessions?.find(s => s.status === 'open');
    const isCash = transactionToRefund.paymentMethod?.toLowerCase() === 'cash';
    if ((transactionToRefund as any).refundedAt || (transactionToRefund as any).voided) { toast({ variant: 'destructive', title: 'Already refunded', description: 'This sale was already refunded or voided.' }); return; }
    if ((transactionToRefund as any).refundPendingId) { toast({ variant: 'destructive', title: 'Refund already set up', description: 'This sale has a refund on Refunds to give.' }); return; }
    if ((transactionToRefund as any).retailOrderId) { toast({ title: 'Refund it on the order', description: 'Online orders are refunded from the order, so the items, the sales tax and the customer’s email all follow.' }); window.location.href = `/retail-orders?order=${encodeURIComponent(String((transactionToRefund as any).retailOrderId))}`; return; }
    if (data.later) {   // not here: they choose how (Refunds to give); the books change when the money actually goes
      const t0: any = transactionToRefund; const total = data.amount + (data.refundTip ? (t0.tipAmount || 0) : 0);
      const pr = data.takeBack ? reversalsFor(t0, data.amount, staff || [], services || []) : [];
      const r = await payPost('/api/refund-payouts', { tenantId, action: 'create', mode: 'client', saleId: t0.id, clientId: t0.clientId || null, appointmentId: t0.appointmentId || null, amountCents: Math.round(total * 100), reason: data.reason,
        ledger: { ...(pr.length ? { payReversals: pr, staffId: t0.staffId } : {}), ...(data.refundTip && (t0.tipAmount || 0) > 0 && data.tipStrategy !== 'absorb' && t0.staffId ? { tipReversal: { staffId: t0.staffId, amount: Number(t0.tipAmount) || 0 } } : {}) } });
      if (!r.ok) { toast({ variant: 'destructive', title: 'Couldn’t set up the refund', description: r.error }); return; }
      toast({ title: 'Refund set up', description: r.sent ? 'We’ve texted them to choose how. It’s on Refunds to give.' : 'We couldn’t text them — share the link from Refunds to give.' });
      setTransactionToRefund(null); return;
    }
    if (isCash && !activeTill) { toast({ variant: 'destructive', title: 'Till Required' }); return; }
    let refundTotal = data.amount + (data.refundTip ? (transactionToRefund.tipAmount || 0) : 0);
    // Card sales go back to the card first; the books only change once the card refund went through. The server writes
    // the refund line for a card refund itself (with the reason and anything taken back), so it's never left out if this
    // screen doesn't hear back.
    let toCard: { card: boolean; cents?: number } = { card: false };
    const record = { reason: data.reason || null, refundTip: !!data.refundTip, tipStrategy: data.tipStrategy || null,
      payReversals: data.takeBack ? reversalsFor(transactionToRefund, data.amount, staff || [], services || []) : [] };
    const afterwards = (cardCents: number | null) => {
      if (data.logIncident && transactionToRefund.clientId) {
        const incident: Incident = { id: nanoid(), date: new Date().toISOString(), type: 'Refund Incident', severity: 'Moderate', description: `Auto-incident filed during refund. Original: ${transactionToRefund.id}. Reason: ${data.reason}`, actionsTaken: `Reversed: $${(cardCents != null ? cardCents / 100 : refundTotal).toFixed(2)} via ${transactionToRefund.paymentMethod}.` };
        const b = writeBatch(firestore); b.update(doc(firestore, `tenants/${tenantId}/clients`, transactionToRefund.clientId), { 'intel.incidents': arrayUnion(incident), 'intel.hasIncidents': true }); b.commit().catch(() => {});
      }
      const authorizer = (staff || []).find(s => s.id === data.authorizerId);
      writeAudit(firestore, tenantId, {
        action: 'transaction.refund', targetType: 'transaction', targetId: transactionToRefund.id,
        summary: `Refund authorized for "${transactionToRefund.description}" — reason: ${data.reason}`,
        amount: cardCents != null ? cardCents / 100 : refundTotal,
        actor: authorizer ? { type: 'user', id: authorizer.id, name: authorizer.name, role: (authorizer as any).role, via: 'manager-pin' } : auditActor,
      });
    };
    // A booking's deposit is closed on the server whichever way it was paid (so it can't also come off the next bill).
    const depositLine = ['retainers', 'deposits', 'deposit'].includes(String(transactionToRefund.category || '').trim().toLowerCase()) && String(transactionToRefund.type || 'income').toLowerCase() === 'income';
    if (!isCash || depositLine) {
      try {
        const tk = await getAuth().currentUser?.getIdToken().catch(() => '');
        const r = await fetch('/api/money/refund', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) }, body: JSON.stringify({ tenantId, transactionId: transactionToRefund.id, amountCents: Math.round(refundTotal * 100), record }) }).then((x) => x.json());
        if (!r?.ok) { toast({ variant: 'destructive', title: r?.unknown ? 'Stripe didn’t answer' : 'Card refund didn’t go through', description: r?.error || 'Nothing was changed. Try again.' }); return; }
        // A booking's deposit: refunded and recorded as a deposit on the server (its credit closed, the return in the books).
        if (r.deposit) { toast({ title: r.already ? 'Already refunded' : 'Deposit refunded', description: `$${(Number(r.refundedCents) / 100).toFixed(2)} ${r.already ? 'went' : 'is going'} back to the card. The deposit is closed, so it won’t come off their next bill.` }); setTransactionToRefund(null); return; }
        if (r.card) { toCard = { card: true, cents: r.refundedCents }; if (r.shortCents > 0) refundTotal = Math.round(r.refundedCents) / 100; }
        if (r.card && r.recorded) {
          afterwards(Math.round(Number(r.refundedCents) || 0));
          toast({ title: r.already ? 'Already refunded' : 'Refund Authorized', description: `$${(Number(r.refundedCents) / 100).toFixed(2)} ${r.already ? 'went' : 'sent'} back to the card${r.shortCents > 0 ? ` ($${(Number(r.shortCents) / 100).toFixed(2)} couldn’t go back to a card)` : ''}. It shows on their statement in 5–10 days.` });
          setTransactionToRefund(null); return;
        }
      } catch { toast({ variant: 'destructive', title: 'We didn’t hear back', description: 'The card may or may not have been refunded. Try again in a couple of minutes: it won’t refund twice.' }); return; }
    }
    // Written once, in one step that first checks the sale isn't refunded already: a double tap or a retry can't record
    // the refund twice or take it out of the till twice. The refund line is named after the sale.
    const now = new Date().toISOString();
    const saleRef = doc(firestore, `tenants/${tenantId}/transactions`, transactionToRefund.id);
    const txnRef = doc(firestore, `tenants/${tenantId}/transactions`, `refund_${transactionToRefund.id}`);
    const writes: ((b: any) => void)[] = [];
    const batch = { set: (r: any, v: any) => writes.push((b) => b.set(r, v)), update: (r: any, v: any) => writes.push((b) => b.update(r, v)) };
    batch.set(txnRef, { id: txnRef.id, date: now, description: `Refund for: ${transactionToRefund.description}`, clientOrVendor: transactionToRefund.clientOrVendor, clientId: transactionToRefund.clientId, type: 'reversal', context: transactionToRefund.context, category: 'Refunds', amount: refundTotal, paymentMethod: transactionToRefund.paymentMethod, reversalOf: transactionToRefund.id, appointmentId: transactionToRefund.appointmentId || null, hasReceipt: false, notes: `Refund Reason: ${data.reason}`, ...(toCard.card ? { refundedToCard: true } : {}), ...(data.refundTip && (transactionToRefund.tipAmount || 0) > 0 && data.tipStrategy !== 'absorb' && transactionToRefund.staffId ? { tipReversal: { staffId: transactionToRefund.staffId, amount: Number(transactionToRefund.tipAmount) || 0 } } : {}), ...(data.takeBack ? (() => { const r = reversalsFor(transactionToRefund, data.amount, staff || [], services || []); return r.length ? { payReversals: r, staffId: transactionToRefund.staffId } : {}; })() : {}) });
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
    batch.update(saleRef, { refundedAt: now, refundTransactionId: txnRef.id });
    try {
      await runTransaction(firestore, async (tx) => {
        const cur: any = (await tx.get(saleRef)).data() || {};
        if (cur.refundedAt || cur.voided) throw Object.assign(new Error('already'), { code: 'already' });
        for (const w of writes) w(tx);
      });
      toast({ title: 'Refund Authorized', description: toCard.card ? `$${refundTotal.toFixed(2)} sent back to the card. It shows on their statement in 5–10 days.` : `$${refundTotal.toFixed(2)} reversed.` });
      // Refunds are PIN-authorized — credit the authorizing manager by name.
      const authorizer = (staff || []).find(s => s.id === data.authorizerId);
      writeAudit(firestore, tenantId, {
        action: 'transaction.refund', targetType: 'transaction', targetId: transactionToRefund.id,
        summary: `Refund authorized for "${transactionToRefund.description}" — reason: ${data.reason}`,
        amount: refundTotal,
        actor: authorizer
          ? { type: 'user', id: authorizer.id, name: authorizer.name, role: (authorizer as any).role, via: 'manager-pin' }
          : auditActor,
      });
      setTransactionToRefund(null);
    }
    catch (e: any) {
      if (e?.code === 'already') { toast({ title: 'Already refunded', description: 'This refund was already recorded.' }); setTransactionToRefund(null); return; }
      console.error(e); toast({ variant: 'destructive', title: 'The refund wasn’t recorded', description: toCard.card ? 'The card was refunded. Try again to record it: it won’t refund the card twice.' : 'Nothing was changed. Try again.' });
    }
  };

  // The Books screen's writing (components/money/BooksScreen): a line's category (an open month), its receipt (any
  // month), undoing it, and a correction dated today for a line in a closed month.
  const lineRef = (t: any) => doc(firestore, `tenants/${tenantId}/transactions`, String(t.id));
  const changeCategory = async (t: any, category: string) => {
    if (!firestore || !tenantId || inClosedMonth(selectedTenant, t.date)) return false;
    const type = String(t.type) === 'income' ? 'income' : 'expense';
    await setDoc(lineRef(t), { category, taxBucket: bucketFor(category, type), updatedAt: new Date().toISOString() }, { merge: true });
    writeAudit(firestore, tenantId, { action: 'transaction.recategorize', targetType: 'transaction', targetId: t.id, summary: `${t.description || t.category} moved from ${t.category} to ${category}`, amount: t.amount, actor: auditActor });
    return true;
  };
  const attachReceipt = async (t: any, url: string) => {
    if (!firestore || !tenantId) return false;
    await setDoc(lineRef(t), { receiptUrl: url, hasReceipt: true, updatedAt: new Date().toISOString() }, { merge: true });
    return true;
  };
  const correct = async (t: any, lines: any[], summary: string) => {
    if (!firestore || !tenantId || !lines.length) return false;
    const nowIso = new Date().toISOString(); const b = writeBatch(firestore);
    for (const l of lines) { const r = doc(collection(firestore, `tenants/${tenantId}/transactions`)); b.set(r, { ...l, id: r.id, date: nowIso, createdAt: nowIso, enteredBy: auditActor?.name || null }); }
    await b.commit();
    writeAudit(firestore, tenantId, { action: 'transaction.correct', targetType: 'transaction', targetId: t.id, summary: `Correction dated today: ${summary}`, amount: t.amount, actor: auditActor });
    return true;
  };
  const disputePack = async (t: any) => {
    const tk = await getAuth().currentUser?.getIdToken().catch(() => ''); const r = await fetch(`/api/disputes/pack?tenantId=${encodeURIComponent(String(tenantId || ''))}&appointmentId=${encodeURIComponent(String(t.appointmentId))}`, { headers: tk ? { Authorization: `Bearer ${tk}` } : {} });
    if (!r.ok) { const j = await r.json().catch(() => ({})); toast({ variant: 'destructive', title: 'Couldn’t build the pack', description: j.error }); return; }
    const url = URL.createObjectURL(await r.blob()); const a = document.createElement('a'); a.href = url; a.download = 'dispute-pack.pdf'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
  };
  const categoriesUsed = useMemo(() => [...new Set((transactions || []).map((t: any) => String(t.category || '')).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [transactions]);
  const booksFilters: BooksFilters = {
    preset: periodPreset, setPreset: setPeriodPreset, from: date?.from, to: date?.to, setRange: (from, to) => setDate({ from, to }),
    search: searchTerm, setSearch: setSearchTerm, way, setWay, books: contextFilter, setBooks: setContextFilter,
    hasPersonal: (transactions || []).some((t: any) => t.context === 'Personal'), category: categoryFilter, setCategory: setCategoryFilter, categories: categoriesUsed,
  };
  const reportsMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="inline-flex min-h-[44px] items-center justify-center rounded-full border border-[#ececee] bg-white px-4 text-[14px] font-semibold text-[#16171a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2">Print or download</button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 rounded-2xl p-1">
        <p className="px-3 pb-1 pt-2 text-[12px] text-muted-foreground">The lines shown here, for these dates:</p>
        <DropdownMenuItem onClick={handlePrint} className="min-h-[44px] rounded-xl px-3 text-[14px] font-medium">Print these lines</DropdownMenuItem>
        <DropdownMenuItem onClick={handleDownload} className="min-h-[44px] rounded-xl px-3 text-[14px] font-medium">Download them as a spreadsheet</DropdownMenuItem>
        <DropdownMenuItem asChild className="min-h-[44px] rounded-xl px-3 text-[14px] font-semibold">
          <Link href="/money?tab=reports">All reports: profit and loss, taxes, payroll, closed months</Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <div className="w-full overflow-x-hidden">
      <div className="mx-auto w-full max-w-6xl p-4 md:p-8">
        <OwedToClientsCard />
        <BooksScreen lines={filteredTransactions} byId={ledgerById} loading={isLoading} biz={selectedTenant} staff={staff || []} tenantId={tenantId || ''}
          filters={booksFilters} reports={reportsMenu} onNew={() => setIsAddTxnOpen(true)}
          onChangeCategory={changeCategory} onReceipt={attachReceipt} onPreviewReceipt={(t) => setPreviewTransaction(t)} onRefund={(t) => setTransactionToRefund(t)}
          onUndo={undoLine} isUndone={isUndone} onCorrect={correct} onDisputePack={disputePack}
          summary={{ netSales: financialSummary.netSales, returns: financialSummary.returns, tips: financialSummary.tips, net: financialSummary.net }} />
        <div className="mt-5 space-y-5">
          <OwedToClients tenantId={tenantId} />
          <BadDebtAgingCard clients={clients || []} tenantId={tenantId || ''} actor={auditActor} />
        </div>
      </div>

      <AddTransactionDialog open={isAddTxnOpen} onOpenChange={setIsAddTxnOpen} staff={staff || []} onConfirm={handleAddTransaction} />

      <ReceiptPreviewDialog
        transaction={previewTransaction}
        tenantId={tenantId || ''}
        open={!!previewTransaction}
        onOpenChange={o => { if (!o) setPreviewTransaction(null); }}
      />

      <RefundProtocolDialog
        open={!!transactionToRefund}
        onOpenChange={(v: boolean) => { if (!v) setTransactionToRefund(null); }}
        transaction={transactionToRefund}
        staff={staff || []}
        services={services || []}
        appointments={refundVisit}
        inventory={inventory || []}
        tenant={selectedTenant}
        onConfirm={handleRefundConfirm}
      />
    </div>
  );
};

// ─── PaydayTab (formerly PaydayPage) ──────────────────────────────────────────

/** The Reports tab: every report in one place, to print or download (components/money/ReportsScreen). */
const ReportsTab = () => {
  const { firestore } = useFirebase();
  const { selectedTenant, role } = useTenant() as any;
  const { staff } = useInventory();
  const tenantId = selectedTenant?.id;
  const tState = (selectedTenant as any)?.taxState || null;
  const payroll = useMemo(() => ({ profile: tState ? getStateProfile(tState) : GENERIC_US_PROFILE, hasState: !!tState }), [tState]);
  return (
    <div className="mx-auto w-full max-w-[1180px] px-4 py-5 md:px-6" style={{ color: '#16171a' }}>
      {tenantId && firestore && <ReportsScreen tenantId={tenantId} firestore={firestore} tenant={selectedTenant} staff={staff || []} payroll={payroll} canManage={['owner', 'admin', 'manager'].includes(String(role || ''))} />}
    </div>
  );
};

/** The Bank tab: lines from the connected bank to sort, sorted for you, and matched (components/money/BankScreen). */
const BankTab = () => {
  const { firestore } = useFirebase();
  const { selectedTenant } = useTenant();
  const auditActor = useAuditActor();
  const tenantId = selectedTenant?.id;
  return (
    <div className="mx-auto w-full max-w-[1180px] px-4 py-5 md:px-6" style={{ color: '#16171a' }}>
      <h2 className="text-[24px] font-semibold leading-tight">Bank</h2>
      <p className="mb-4 text-[14px]" style={{ color: '#6d7075' }}>Each line from your connected bank: sorted for you when it’s plain what it is, matched when it’s money already in your books, and the rest waiting for you with a category picked.</p>
      <div>{tenantId && firestore && <BankScreen tenantId={tenantId} firestore={firestore} actor={auditActor} />}</div>
    </div>
  );
};

type Cadence = 'weekly' | 'bi-weekly' | 'monthly' | 'custom';

const PaydayTab = ({ onNavigate }: { onNavigate?: (tab: HubTab) => void }) => {
  const { billDefinitions, billInstances, staff, isLoading: ctxLoading, services } = useInventory();
  const auditActor = useAuditActor();
  const { firestore } = useFirebase();
  const { selectedTenant } = useTenant();
  const { toast } = useToast();
  const tenantId = selectedTenant?.id;

  const [allocationAmount, setAllocationAmount] = useState<number>(0);
  const [cadence, setCadence] = useState<Cadence>('bi-weekly');
  const [statementFor, setStatementFor] = useState<string | null>(null);   // whose pay statement is open
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [dateRange, setDateRange] = useState<{ from: Date, to: Date }>(() => {
      const now = new Date();
      return {
          from: startOfDay(subDays(now, 13)),
          to: endOfDay(now)
      };
  });
  // Only this pay period's sales and clock punches are read.
  const payFrom = useMemo(() => new Date(dateRange.from.getTime()), [dateRange.from.getTime()]);
  const payTo = useMemo(() => new Date(dateRange.to.getTime() + 1), [dateRange.to.getTime()]);
  const { transactions, isLoading: txLoading } = useTransactionsInRange(payFrom, payTo);
  const { activityLogs, isLoading: punchLoading } = usePunchesInRange(payFrom, payTo);
  const isLoading = ctxLoading || txLoading || punchLoading;

  const handlePrevPeriod = () => {
      if (cadence === 'custom') return;
      setDateRange(prev => {
          let daysToShift = 7;
          if (cadence === 'bi-weekly') daysToShift = 14;
          if (cadence === 'monthly') {
              const prevMonth = subMonths(prev.from, 1);
              return { from: startOfMonth(prevMonth), to: endOfMonth(prevMonth) };
          }
          return { from: startOfDay(subDays(prev.from, daysToShift)), to: endOfDay(subDays(prev.to, daysToShift)) };
      });
  };

  const handleNextPeriod = () => {
      if (cadence === 'custom') return;
      setDateRange(prev => {
          let daysToShift = 7;
          if (cadence === 'bi-weekly') daysToShift = 14;
          if (cadence === 'monthly') {
              const nextMonth = addMonths(prev.from, 1);
              return { from: startOfMonth(nextMonth), to: endOfMonth(nextMonth) };
          }
          return { from: startOfDay(addDays(prev.from, daysToShift)), to: endOfDay(addDays(prev.to, daysToShift)) };
      });
  };

  const handleCadenceChange = (newCadence: Cadence) => {
      setCadence(newCadence);
      const now = new Date();
      // Weekly / bi-weekly: whole workweeks up to the end of this one, so overtime is counted per complete week.
      const wso = ((selectedTenant as any)?.workweekStartsOn === 0 ? 0 : 1) as 0 | 1;
      if (newCadence === 'weekly') {
          setDateRange({ from: startOfWeek(now, { weekStartsOn: wso }), to: endOfDay(endOfWeek(now, { weekStartsOn: wso })) });
      } else if (newCadence === 'bi-weekly') {
          setDateRange({ from: startOfWeek(subDays(now, 7), { weekStartsOn: wso }), to: endOfDay(endOfWeek(now, { weekStartsOn: wso })) });
      } else if (newCadence === 'monthly') {
          setDateRange({ from: startOfMonth(now), to: endOfMonth(now) });
      }
  };
  // The business's own pay cadence (saved with the payroll settings), not always bi-weekly.
  const savedCadence = (selectedTenant as any)?.payroll?.cadence as Cadence | undefined;
  useEffect(() => { if (savedCadence && ['weekly', 'bi-weekly', 'monthly'].includes(savedCadence)) handleCadenceChange(savedCadence); }, [savedCadence]); // eslint-disable-line react-hooks/exhaustive-deps

  // The schedule for the period — paid non-service time (training, meetings) for commission / per service people.
  const shFrom = format(subDays(dateRange.from, 1), 'yyyy-MM-dd'), shTo = format(addDays(dateRange.to, 1), 'yyyy-MM-dd');
  const { data: periodShifts } = useCollection<any>(useMemoFirebase(() => (firestore && tenantId ? query(collection(firestore, 'tenants', tenantId, 'shifts'), where('date', '>=', shFrom), where('date', '<=', shTo)) : null), [firestore, tenantId, shFrom, shTo]));
  // Shared tips: pay each person's APPROVED share (the same as the payroll draft), not the tips taken at their own visits.
  const tipMode = String((selectedTenant as any)?.tipSharing?.mode || 'direct');
  const { data: tipRuns } = useCollection<any>(useMemoFirebase(() => (firestore && tenantId && tipMode !== 'direct' ? query(collection(firestore, 'tenants', tenantId, 'tipShareRuns'), where('status', '==', 'approved')) : null), [firestore, tenantId, tipMode]));
  const sharedTips = useMemo(() => { if (tipMode === 'direct') return null; const m = new Map<string, number>(); const a = dateRange.from.toISOString(), b = dateRange.to.toISOString();
    for (const r of tipRuns || []) { if (String(r.start || '') < a || String(r.start || '') > b) continue; for (const x of r.rows || []) m.set(x.staffId, (m.get(x.staffId) || 0) + (Number(x.shareCents) || 0) / 100); } return m; }, [tipRuns, tipMode, dateRange]);

  const filteredTransactions = useMemo(() => {
      if (!transactions) return [];
      return transactions.filter(t => {
          const d = safeDate(t.date);
          return d >= dateRange.from && d <= dateRange.to;
      });
  }, [transactions, dateRange]);

  // What came in, after costs: the books' own reading of these dates (lib/books-summary: sales, tips and other income,
  // less returns, discounts and costs), never the sales tax, money held for others or transfers. Team pay already booked
  // in these dates is added back, since the team's pay is taken off on the screen.
  const currentBalance = useMemo(() => {
      const ls = filteredTransactions.map((t: any) => normalizeLine(t));
      const s = booksSummary(ls, { lookup: ls, businessOnly: true });
      // (Payroll only: contract labor isn't in the team's pay worked out here, so it stays a cost.)
      const booked = s.byCategory.opex.filter(([c]) => isTeamPay(c) && !/contract/i.test(c)).reduce((n, [, v]) => n + v, 0);
      return Math.round((s.net + booked) * 100) / 100;
  }, [filteredTransactions]);

  // The visits this period's payments belong to, read by id (who did the work), not every visit ever.
  const periodVisitIds = useMemo(() => (filteredTransactions || []).map((t: any) => String(t.appointmentId || '')).filter(Boolean), [filteredTransactions]);
  const { appointments } = useAppointmentsByIds(periodVisitIds);
  const apptStaff = useMemo(() => Object.fromEntries((appointments || []).filter((a: any) => a?.id && a.staffId).map((a: any) => [a.id, String(a.staffId)])) as Record<string, string>, [appointments]);
  const staffObligations = useMemo(() => {
    if (!staff || !filteredTransactions || !activityLogs) return [];
    // One calculation for every pay setup (lib/pay-period) — hours from the time clock's punches, overtime per
    // workweek, minimum-wage top-ups, salary — the same one the payroll draft uses.
    const sessions = sessionsFrom(activityLogs as any, clockPolicy(selectedTenant));

    // Renters are not on payroll — they rent their space and keep their
    // own takings. Excluded here for the same reason the server draft
    // excludes them; if the two disagreed, the screen would be the lie.
    return staff.filter((m: any) => m.isRenter !== true).map(member => {
        const l = periodPay({ member, from: dateRange.from, to: dateRange.to, shifts: periodShifts || [], incomeTxns: filteredTransactions, services: services || [], tenant: selectedTenant, sessions, apptStaff, ...(sharedTips ? { tips: sharedTips.get(member.id) || 0 } : {}) });
        const f = payrollFields(l);
        const ps = String(member.payStructure || 'commission');
        const parts = [ps === 'commission' ? 'Comm' : ps === 'hourly_plus_commission' ? 'Hr + Comm' : ps === 'per_service' ? 'Per service' : ps === 'salary' ? 'Salary' : 'Hr'];
        if (l.overtimeHours) parts.push(`${l.overtimeHours}h OT`); if (l.doubleTimeHours) parts.push(`${l.doubleTimeHours}h double`); if (l.minWageTopUp) parts.push('min. wage top-up'); parts.push('Tips');
        return {
            id: member.id,
            name: member.name,
            avatarUrl: member.avatarUrl,
            amount: l.total,
            // v60 — broken out for the Gusto payroll draft
            earnings: l.total - l.tips,
            commissionPay: f.commission,
            bonus: f.bonus,
            regularHours: f.regularHours,
            overtimeHours: f.overtimeHours,
            doubleOvertimeHours: f.doubleOvertimeHours,
            tips: l.tips,
            hours: l.hours,
            missingClockOuts: l.missingClockOuts,
            unapprovedSessions: l.unapprovedSessions,
            noHours: l.noHours,
            line: l,
            payStructure: member.payStructure,
            details: parts.join(' + '),
        };
    }).filter(o => o.amount > 0 || o.missingClockOuts > 0);
  }, [staff, filteredTransactions, activityLogs, dateRange, services, apptStaff, selectedTenant, sharedTips, periodShifts]);

  const staffTotalOwed = useMemo(() => staffObligations.reduce((sum, o) => sum + o.amount, 0), [staffObligations]);

  // ── Jurisdiction-aware tax profile — PER TENANT, never assumed. ──
  // v63 — multi-tenancy fix: no hardcoded state default. Until this tenant
  // picks their location, a federal-only generic applies and the UI prompts.
  const taxCountry = ((selectedTenant as any)?.taxCountry || 'US') as string;
  const countryOption = getCountryOption(taxCountry);
  const taxState: string | null = (selectedTenant as any)?.taxState || null;
  const hasTaxLocation = countryOption.enabled && !!taxState;
  const stateProfile = hasTaxLocation ? getStateProfile(taxState) : GENERIC_US_PROFILE;
  const handleStateChange = (code: string) => {
      if (!firestore || !tenantId) return;
      updateDocumentNonBlocking(doc(firestore, 'tenants', tenantId), { taxState: code });
  };
  const handleCountryChange = (code: string) => {
      if (!firestore || !tenantId) return;
      updateDocumentNonBlocking(doc(firestore, 'tenants', tenantId), { taxCountry: code });
  };

  // ── Gusto payroll ──
  const gusto = getGustoConnection(selectedTenant);
  const [isSubmittingPayroll, setIsSubmittingPayroll] = useState(false);
  const employerTaxes = estimateEmployerPayrollTax(staffTotalOwed, stateProfile);
  const payrollCashNeeded = staffTotalOwed + employerTaxes;

  // ── Auto-draft (Level 2) — pending drafts from the daily cron. The
  // draft is a preview + reminder; approval always uses live numbers. ──
  const autoDraftEnabled = !!(selectedTenant as any)?.payroll?.autoDraft;
  const [pendingDraft, setPendingDraft] = useState<any | null>(null);
  useEffect(() => {
      if (!firestore || !tenantId) return;
      const q = query(collection(firestore, `tenants/${tenantId}/payrollDrafts`), where('status', '==', 'pending'), limit(1));
      const unsub = onSnapshot(q,
          snap => setPendingDraft(snap.empty ? null : { id: snap.docs[0].id, ...(snap.docs[0].data() as any) }),
          () => setPendingDraft(null));
      return () => unsub();
  }, [firestore, tenantId]);

  const handleAutoDraftToggle = (on: boolean) => {
      if (!firestore || !tenantId) return;
      updateDocumentNonBlocking(doc(firestore, 'tenants', tenantId), {
          'payroll.autoDraft': on,
          'payroll.cadence': cadence === 'custom' ? 'bi-weekly' : cadence,
      });
  };

  const markDraftApproved = () => {
      if (!firestore || !tenantId || !pendingDraft) return;
      updateDocumentNonBlocking(
          doc(firestore, 'tenants', tenantId, 'payrollDrafts', pendingDraft.id),
          { status: 'approved', approvedAt: new Date().toISOString() },
      );
  };

  const unpaidInstancesInPeriod = useMemo(() => {
      if (!billInstances) return [];
      return billInstances.filter(i => {
          const d = safeDate(i.dueDate);
          return i.status !== 'paid' && d >= dateRange.from && d <= dateRange.to;
      });
  }, [billInstances, dateRange]);

  const upcomingBusiness = useMemo(() => {
      return unpaidInstancesInPeriod
        .map(i => ({ instance: i, definition: billDefinitions.find(d => d.id === i.billDefinitionId) }))
        .filter(item => item.definition?.context === 'Business');
  }, [unpaidInstancesInPeriod, billDefinitions]);

  const upcomingPersonal = useMemo(() => {
      return unpaidInstancesInPeriod
        .map(i => ({ instance: i, definition: billDefinitions.find(d => d.id === i.billDefinitionId) }))
        .filter(item => item.definition?.context === 'Personal');
  }, [unpaidInstancesInPeriod, billDefinitions]);

  const businessBillsTotal = upcomingBusiness.reduce((sum, item) => sum + (item.definition?.amount || 0), 0);
  const personalBillsTotal = upcomingPersonal.reduce((sum, item) => sum + (item.definition?.amount || 0), 0);

  const totalHardObligations = staffTotalOwed + businessBillsTotal + personalBillsTotal;

  // v60 — Tax bucket is no longer a flat 15%: it's driven by the business's
  // state profile (federal + SE base + state effective rate). Owner Comp
  // absorbs the difference so the split always totals 100%.
  const suggestions = useMemo(() => {
      const amt = allocationAmount || 0;
      const alloc = suggestedAllocation(stateProfile);
      return [
          { key: 'profit' as const, label: 'Profit', pct: alloc.profit, amount: Number((amt * alloc.profit / 100).toFixed(2)) },
          { key: 'owner' as const, label: 'Your pay', pct: alloc.ownerComp, amount: Number((amt * alloc.ownerComp / 100).toFixed(2)) },
          { key: 'tax' as const, label: `Taxes (${stateProfile.code})`, pct: alloc.tax, amount: Number((amt * alloc.tax / 100).toFixed(2)) },
          // (What stays in the business account: nothing is booked for it.)
          { key: 'opex' as const, label: 'Running the business', pct: alloc.opex, amount: Number((amt * alloc.opex / 100).toFixed(2)) },
      ];
  }, [allocationAmount, stateProfile]);

  const handleSetMaxBalance = () => {
      setAllocationAmount(Number(currentBalance.toFixed(2)));
  };

  // Payday is recorded once for a pay period: each line has a fixed id for the period, written only if none is there,
  // and never for dates that overlap a payday already recorded (a custom period a day shorter is the same payday).
  const payFromYmd = format(dateRange.from, 'yyyy-MM-dd'), payToYmd = format(dateRange.to, 'yyyy-MM-dd');
  const periodKey = `${payFromYmd}_${payToYmd}`;
  const [recorded, setRecorded] = useState<{ on: string; from: string; to: string } | null>(null);
  const recordedFor = useCallback(async () => {
      if (!firestore || !tenantId) return null;
      const q = await getDocs(query(collection(firestore, `tenants/${tenantId}/transactions`), where('paydayTo', '>=', payFromYmd), limit(100)));
      const hit: any = q.docs.map(d => d.data() as any).find(t => String(t.paydayFrom || '') <= payToYmd);
      return hit ? { on: String(hit.date || new Date().toISOString()), from: String(hit.paydayFrom), to: String(hit.paydayTo) } : null;
  }, [firestore, tenantId, payFromYmd, payToYmd]);
  useEffect(() => {
      let on = true; setRecorded(null);
      recordedFor().then(r => { if (on) setRecorded(r); }).catch(() => {});
      return () => { on = false; };
  }, [recordedFor]);

  const handleConfirmDistributions = async () => {
    if (!firestore || !tenantId || recorded) return;
    setIsSubmitting(true);

    const now = new Date().toISOString();
    const lines: { ref: any; data: any }[] = [];

    staffObligations.forEach(obligation => {
        const txnRef = doc(firestore, `tenants/${tenantId}/transactions`, `payday_${periodKey}_${obligation.id}`);
        const newTxn: any = {
            date: now,
            description: `Payday: ${obligation.name}`,
            clientOrVendor: obligation.name,
            type: 'expense',
            context: 'Business',
            taxBucket: 'payroll',
            category: 'Payroll',
            amount: Number(obligation.amount.toFixed(2)),
            paymentMethod: 'Distribution',
            hasReceipt: false,
            staffId: obligation.id,
            paydayPeriod: periodKey, paydayFrom: payFromYmd, paydayTo: payToYmd,
        };
        lines.push({ ref: txnRef, data: { ...newTxn, id: txnRef.id } });
    });

    suggestions.forEach(bucket => {
        if (bucket.amount > 0 && bucket.key !== 'opex') {
            const txnRef = doc(firestore, `tenants/${tenantId}/transactions`, `setaside_${periodKey}_${bucket.key}`);
            const newTxn: any = {
                date: now,
                description: `Set aside: ${bucket.label}`,
                clientOrVendor: 'Internal Distribution',
                type: 'expense',
                context: 'Business',
                taxBucket: 'transfer',
                category: 'Distribution',
                amount: Number(bucket.amount.toFixed(2)),
                paymentMethod: 'Internal Transfer',
                hasReceipt: false,
                paydayPeriod: periodKey, paydayFrom: payFromYmd, paydayTo: payToYmd,
            };
            lines.push({ ref: txnRef, data: { ...newTxn, id: txnRef.id } });
        }
    });

    try {
        if (!lines.length) return;
        const before = await recordedFor();
        if (before) { setRecorded(before); throw new Error('already-recorded'); }
        await runTransaction(firestore, async (tx) => {
            const there = await Promise.all(lines.map(l => tx.get(l.ref)));
            if (there.some(d => d.exists())) throw new Error('already-recorded');
            lines.forEach(l => tx.set(l.ref, l.data));
        });
        setRecorded({ on: now, from: payFromYmd, to: payToYmd });
        toast({ title: 'Payday recorded', description: 'Each person’s pay and the set-asides are in your books.' });
        setAllocationAmount(0);
        markDraftApproved();
        writeAudit(firestore, tenantId, {
            action: 'payroll.distribute', targetType: 'payroll',
            summary: `Recorded payday: ${staffObligations.length} ${staffObligations.length === 1 ? 'person' : 'people'} paid ${fmtCurrency(staffTotalOwed)}, and ${fmtCurrency(allocationAmount)} split to set aside`,
            amount: staffTotalOwed, actor: auditActor,
        });
    } catch (e: any) {
        if (e?.message === 'already-recorded') {
            toast({ title: 'Payday for these dates is already in your books', description: 'Nothing was added twice.' });
            recordedFor().then(r => setRecorded(r)).catch(() => {});
        } else {
            console.error("Distributions failed:", e);
            toast({ variant: 'destructive', title: 'Payday wasn’t recorded', description: 'Nothing was added to your books. Try again.' });
        }
    } finally {
        setIsSubmitting(false);
    }
  };

  // ── Gusto: build the payroll draft from this period's obligations and
  // submit it. Gusto handles exact taxes, withholdings, deposits & filings.
  const handleApprovePayroll = async () => {
    if (staffObligations.length === 0 || !tenantId) return;
    setIsSubmittingPayroll(true);
    try {
        const draft: GustoPayrollDraft = {
            tenantId,
            periodStart: dateRange.from.toISOString(),
            periodEnd: dateRange.to.toISOString(),
            lines: staffObligations.map(o => ({
                staffId: o.id,
                name: o.name,
                payStructure: o.payStructure,
                regularHours: Number(((o as any).regularHours || 0).toFixed(2)),
                overtimeHours: Number(((o as any).overtimeHours || 0).toFixed(2)),
                doubleOvertimeHours: Number(((o as any).doubleOvertimeHours || 0).toFixed(2)),
                commission: Number(((o as any).commissionPay || 0).toFixed(2)),   // commission, per service pay and extras (hours are paid from regularHours)
                tips: Number((o.tips || 0).toFixed(2)),
                bonus: Number(((o as any).bonus || 0).toFixed(2)),   // overtime on commission / per service pay + minimum-wage top-ups
                reimbursements: 0,
                deductions: 0,
            })),
            grossTotal: Number(staffTotalOwed.toFixed(2)),
            estimatedEmployerTaxes: Number(employerTaxes.toFixed(2)),
        };
        const result = await submitGustoPayroll(draft);
        if (result.status === 'submitted' || result.status === 'processing') {
            toast({
                title: 'Payroll sent to Gusto',
                description: `${staffObligations.length} ${staffObligations.length === 1 ? 'person' : 'people'}. Gusto works out the taxes and withholding and sends the deposits.`,
            });
            markDraftApproved();
            writeAudit(firestore, tenantId, {
                action: 'payroll.submit_gusto', targetType: 'payroll',
                summary: `Sent payroll to Gusto: ${staffObligations.length} ${staffObligations.length === 1 ? 'person' : 'people'}, ${fmtCurrency(staffTotalOwed)} in pay, about ${fmtCurrency(employerTaxes)} in payroll taxes`,
                amount: staffTotalOwed, actor: auditActor,
            });
        } else {
            toast({ variant: 'destructive', title: 'Gusto didn’t take the payroll', description: result.message || 'Nothing was sent. Check the details in Gusto and try again.' });
        }
    } catch (e) {
        console.error('Gusto submission failed:', e);
        toast({ variant: 'destructive', title: 'Payroll wasn’t sent to Gusto', description: 'Nothing was sent. Try again in a moment.' });
    } finally {
        setIsSubmittingPayroll(false);
    }
  };

  if (isLoading) {
      return (
          <div className="p-4 md:p-8 flex items-center justify-center min-h-[50vh]">
              <Loader className="w-8 h-8 animate-spin text-primary" />
          </div>
      )
  }

  return (
    <div className="mx-auto w-full max-w-[1180px] px-4 py-5 md:px-6" style={{ color: '#16171a' }}>
      <PaydayScreen
        from={dateRange.from} to={dateRange.to} cadence={cadence}
        onCadence={handleCadenceChange} onEarlier={handlePrevPeriod} onLater={handleNextPeriod}
        onFirstDay={(v) => { if (v) setDateRange(prev => ({ ...prev, from: startOfDay(new Date(v.replace(/-/g, '/'))) })); }}
        onLastDay={(v) => { if (v) setDateRange(prev => ({ ...prev, to: endOfDay(new Date(v.replace(/-/g, '/'))) })); }}
        cameIn={currentBalance}
        team={staffObligations} teamTotal={staffTotalOwed} employerTaxes={employerTaxes}
        bills={[...upcomingBusiness, ...upcomingPersonal]
          .map(item => ({ id: String(item.instance.id), name: String(item.definition?.name || 'A bill'), amount: Number(item.definition?.amount) || 0, due: safeDate(item.instance.dueDate), personal: item.definition?.context === 'Personal' }))
          .sort((a, b) => a.due.getTime() - b.due.getTime())}
        tax={{
          hasState: hasTaxLocation, stateName: stateProfile.name, employerPct: stateProfile.employerPayrollTaxPct, regionLabel: countryOption.regionLabel,
          note: stateProfile.note, stale: ratesAreStale() ? `These tax rates are from ${RATES_VINTAGE} and may be out of date. Check with your accountant before relying on the split.` : undefined,
          state: taxState, onState: handleStateChange, canPickState: countryOption.enabled,
          states: STATE_OPTIONS.map(s => ({ code: s.code, label: `${s.name}, ${s.taxType === 'none' ? 'no income tax' : `${s.stateRate}% ${s.taxType === 'graduated' ? 'top rate' : 'flat'}`}` })),
          country: taxCountry, countries: COUNTRY_OPTIONS, onCountry: handleCountryChange,
        }}
        gusto={{ connected: !!gusto.connected, companyName: gusto.companyName }}
        onConnectGusto={() => { if (tenantId) beginGustoConnect(tenantId); }}
        onSendToGusto={handleApprovePayroll} sendingToGusto={isSubmittingPayroll}
        autoDraft={autoDraftEnabled} onAutoDraft={handleAutoDraftToggle}
        draft={pendingDraft ? { from: safeDate(pendingDraft.periodStart), to: safeDate(pendingDraft.periodEnd), people: pendingDraft.lines?.length || 0, gross: Number(pendingDraft.grossTotal || 0), taxes: Number(pendingDraft.estimatedEmployerTaxes || 0) } : null}
        onOpenDraft={() => {
          if (!pendingDraft) return;
          setCadence('custom');
          setDateRange({ from: startOfDay(safeDate(pendingDraft.periodStart)), to: endOfDay(safeDate(pendingDraft.periodEnd)) });
        }}
        setAside={allocationAmount} onSetAside={setAllocationAmount} parts={suggestions}
        onRecord={handleConfirmDistributions} recording={isSubmitting} recordedOn={recorded ? safeDate(recorded.on) : null}
        recordedSpan={recorded && (recorded.from !== payFromYmd || recorded.to !== payToYmd) ? spanWords(new Date(`${recorded.from}T00:00:00`), new Date(`${recorded.to}T00:00:00`)) : null}
        statementFor={statementFor} onStatement={setStatementFor}
        statement={(o) => tenantId ? <PayStatement tenantId={tenantId} staffId={o.id} from={dateRange.from.toISOString()} to={dateRange.to.toISOString()} title={`${o.name}, pay statement`} /> : null}
        onSeeBills={() => { onNavigate?.('bills'); if (typeof window !== 'undefined') window.scrollTo({ top: 0 }); }}
      />
    </div>
  );
};

// ─── BillsTab ─────────────────────────────────────────────────────────────────
// Reads the bills and writes a payment; components/money/BillsScreen lays them out.

const BillsTab = () => {
  const { billDefinitions, billInstances, isLoading } = useInventory();
  const auditActor = useAuditActor();
  const { firestore } = useFirebase();
  const { selectedTenant } = useTenant();
  const { toast } = useToast();
  const tenantId = selectedTenant?.id;

  const defOf = useCallback((i: any) => (billDefinitions || []).find((d: any) => d.id === i.billDefinitionId), [billDefinitions]);
  const unpaid = useMemo(() => (billInstances || [])
    .filter((i: any) => i.status !== 'paid')
    .map((i: any) => ({ instance: i, definition: defOf(i) }))
    .filter((b: any) => b.definition), [billInstances, defOf]);
  const view = useMemo(() => {
    const now = new Date(); const m0 = startOfMonth(now), m1 = endOfMonth(now), since = subDays(startOfDay(now), 30);
    const amountOf = (i: any, d: any) => Number(i.status === 'paid' && typeof i.paidAmount === 'number' ? i.paidAmount : d?.amount) || 0;
    let paidSum = 0, leftSum = 0, earlier = 0;
    for (const i of billInstances || []) {
      const d = defOf(i); if (!d) continue; const due = safeDate(i.dueDate);
      if (due < m0 && i.status !== 'paid') { earlier += amountOf(i, d); continue; }
      if (due < m0 || due > m1) continue;
      if (i.status === 'paid') paidSum += amountOf(i, d); else leftSum += amountOf(i, d);
    }
    const paid = (billInstances || []).filter((i: any) => i.status === 'paid' && i.paidDate && safeDate(i.paidDate) >= since)
      .map((i: any) => ({ id: String(i.id), name: String(defOf(i)?.name || 'A bill'), amount: amountOf(i, defOf(i)), paidOn: safeDate(i.paidDate) }))
      .sort((x: any, y: any) => y.paidOn.getTime() - x.paidOn.getTime());
    return { paid, month: { label: format(now, 'MMMM'), due: paidSum + leftSum, paid: paidSum, left: leftSum, earlier } };
  }, [billInstances, defOf]);

  const handlePay = async (id: string, payMethod: string): Promise<boolean> => {
    const bill: any = unpaid.find((b: any) => String(b.instance.id) === id);
    if (!bill || !firestore || !tenantId) return false;
    const { instance, definition } = bill;
    const now = new Date().toISOString();
    const instRef = doc(firestore, `tenants/${tenantId}/billInstances`, instance.id);
    const txnRef = doc(collection(firestore, `tenants/${tenantId}/transactions`));
    const line = {
      id: txnRef.id,
      date: now,
      description: `Bill paid: ${definition.name}`,
      clientOrVendor: definition.name,
      type: 'expense',
      context: definition.context || 'Business',
      taxBucket: 'operating_cost',
      category: definition.category || 'Bills',
      amount: Number((definition.amount || 0).toFixed(2)),
      paymentMethod: payMethod,
      hasReceipt: false,
      relatedBillInstanceId: instance.id,
    };

    const way = (PAY_WAYS.find(([v]) => v === payMethod)?.[1] || payMethod).toLowerCase();
    try {
      // Once: a bill paid meanwhile (on another device, or matched from the bank feed) isn't paid again. A merge-set, so
      // a missing instance never fails the whole payment (v66).
      const already = await runTransaction(firestore, async (tx) => {
        const cur: any = (await tx.get(instRef)).data();
        if (cur?.status === 'paid') return true;
        tx.set(instRef, { status: 'paid', paidDate: now, paidAmount: definition.amount || 0 }, { merge: true });
        tx.set(txnRef, line);
        return false;
      });
      if (already) { toast({ title: 'That bill is already paid', description: 'Nothing was added twice.' }); return true; }
      toast({ title: 'Bill paid', description: `${definition.name}, ${fmtCurrency(definition.amount || 0)}, is in your books.` });
      writeAudit(firestore, tenantId, {
        action: 'bill.pay', targetType: 'bill', targetId: instance.id,
        summary: `${definition.name}, paid by ${way}`,
        amount: definition.amount || 0, actor: auditActor,
      });
      return true;
    } catch (e) {
      console.error('Bill payment failed:', e);
      toast({ variant: 'destructive', title: 'The bill wasn’t marked paid', description: 'Nothing changed. Try again.' });
      return false;
    }
  };

  if (isLoading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center p-4 md:p-8">
        <Loader className="h-8 w-8 animate-spin" style={{ color: '#6d7075' }} />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1180px] px-4 py-5 md:px-6" style={{ color: '#16171a' }}>
      <BillsScreen
        bills={unpaid.map((b: any) => ({ id: String(b.instance.id), name: String(b.definition.name || 'A bill'), amount: Number(b.definition.amount) || 0, due: safeDate(b.instance.dueDate),
          personal: b.definition.context === 'Personal', cadence: b.definition.cadence, lateFee: Number(b.definition.lateFee) || 0, paymentUrl: b.definition.paymentUrl || '' }))}
        paid={view.paid} month={view.month} onPay={handlePay} />
    </div>
  );
};

// ─── OverviewTab (new) ────────────────────────────────────────────────────────

type HubTab = 'overview' | 'ledger' | 'bank' | 'payday' | 'bills' | 'reports' | 'activity';

// ─── ActivityTab — the latest actions, live (components/money/ActivityScreen lays them out) ──

const ACTIVITY_MAX = 200;
const ActivityTab = ({ onNavigate }: { onNavigate?: (tab: HubTab) => void }) => {
  const { staff, isLoading } = useInventory();
  const { firestore } = useFirebase();
  const { selectedTenant, role } = useTenant() as any;
  const tenantId = selectedTenant?.id;
  // (The activity log is the owner's and managers' to read.)
  const canSee = ['owner', 'admin', 'manager'].includes(String(role || ''));

  const [entries, setEntries] = useState<any[]>([]);
  const [feedLoading, setFeedLoading] = useState(true);
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    if (!firestore || !tenantId) return;
    if (!canSee) { setFeedLoading(false); return; }
    const q = query(collection(firestore, `tenants/${tenantId}/auditLogs`), orderBy('at', 'desc'), limit(ACTIVITY_MAX));
    const unsub = onSnapshot(q,
      snap => { setEntries(snap.docs.map(d => d.data() as any)); setDenied(false); setFeedLoading(false); },
      () => { setDenied(true); setFeedLoading(false); });
    return () => unsub();
  }, [firestore, tenantId, canSee]);

  // (The team's names, and anyone else who did something lately, so each can be picked.)
  const people = useMemo(() => [...new Set([
    ...(staff || []).map((s: any) => s.name),
    ...entries.filter((e: any) => e.actor?.type !== 'system').map((e: any) => e.actor?.name),
  ].filter(Boolean).map(String))].sort((x, y) => x.localeCompare(y)), [staff, entries]);

  if (isLoading || feedLoading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center p-4 md:p-8">
        <Loader className="h-8 w-8 animate-spin" style={{ color: '#6d7075' }} />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1180px] px-4 py-5 md:px-6" style={{ color: '#16171a' }}>
      <ActivityScreen entries={entries} people={people} capped={entries.length >= ACTIVITY_MAX} notYours={!canSee || denied}
        onReports={() => { onNavigate?.('reports'); if (typeof window !== 'undefined') window.scrollTo({ top: 0 }); }} />
    </div>
  );
};

// ─── MoneyHubPage ─────────────────────────────────────────────────────────────

const HUB_TABS: { key: HubTab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'ledger',   label: 'Books' },
  { key: 'bank',     label: 'Bank' },
  { key: 'payday',   label: 'Payday' },
  { key: 'bills',    label: 'Bills' },
  { key: 'reports',  label: 'Reports' },
  { key: 'activity', label: 'Activity' },
];

const VALID_TABS: HubTab[] = ['overview', 'ledger', 'bank', 'payday', 'bills', 'reports', 'activity'];

function MoneyHubContent() {
  // Deep-linking: /money?tab=payday opens the Payday tab directly, so old
  // /ledger, /bills, and /payday routes can redirect to the right tab.
  const searchParams = useSearchParams();
  const urlTab = searchParams.get('tab') as HubTab | null;
  const [activeTab, setActiveTab] = useState<HubTab>(
    urlTab && VALID_TABS.includes(urlTab) ? urlTab : 'overview'
  );

  // v65 — perf: mount each tab only on first visit. Once visited it stays
  // mounted (hidden), so filters/state persist without paying the cost of
  // rendering five screens on page load.
  const [visitedTabs, setVisitedTabs] = useState<Set<HubTab>>(
    () => new Set<HubTab>([urlTab && VALID_TABS.includes(urlTab) ? urlTab : 'overview'])
  );

  // v68 — "new activity" dot: a one-doc listener on the audit log lights a
  // dot on the Activity tab when something happens while you're on another
  // tab. First load counts as seen; only NEW entries during the session dot.
  const { firestore: hubFirestore } = useFirebase();
  const { selectedTenant: hubTenant } = useTenant();
  const hubTenantId = hubTenant?.id;
  const [latestAuditAt, setLatestAuditAt] = useState<string | null>(null);
  const [seenAuditAt, setSeenAuditAt] = useState<string | null>(null);
  useEffect(() => {
    if (!hubFirestore || !hubTenantId) return;
    const q = query(collection(hubFirestore, `tenants/${hubTenantId}/auditLogs`), orderBy('at', 'desc'), limit(1));
    const unsub = onSnapshot(q,
      snap => setLatestAuditAt((snap.docs[0]?.data() as any)?.at || null),
      () => { /* non-fatal */ });
    return () => unsub();
  }, [hubFirestore, hubTenantId]);
  useEffect(() => {
    if (latestAuditAt && seenAuditAt === null) setSeenAuditAt(latestAuditAt);       // baseline on load
    if (activeTab === 'activity' && latestAuditAt) setSeenAuditAt(latestAuditAt);   // viewing clears it
  }, [latestAuditAt, seenAuditAt, activeTab]);
  const hasNewActivity = !!latestAuditAt && !!seenAuditAt && latestAuditAt !== seenAuditAt && activeTab !== 'activity';

  const handleTabChange = (tab: HubTab) => {
    setActiveTab(tab);
    setVisitedTabs(prev => (prev.has(tab) ? prev : new Set(prev).add(tab)));
    // Keep the URL shareable without triggering a Next.js navigation
    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', tab === 'overview' ? '/money' : `/money?tab=${tab}`);
    }
  };

  // (A link inside the page that changes the address, such as Books' All reports, or the back button: the tab follows it.)
  useEffect(() => { if (urlTab && VALID_TABS.includes(urlTab) && urlTab !== activeTab) handleTabChange(urlTab); }, [urlTab]); // eslint-disable-line react-hooks/exhaustive-deps

  // (How many of the bank's lines wait to be sorted, on the Bank tab and the overview: counted, never read, again when
  // the tab changes or the page is looked at again. The owner's to read, so for anyone else it isn't shown.)
  const [bankWaiting, setBankWaiting] = useState<number | null>(null);
  useEffect(() => {
    if (!hubFirestore || !hubTenantId) return; let on = true;
    const count = () => getCountFromServer(query(collection(hubFirestore, `tenants/${hubTenantId}/bankTransactions`), where('status', '==', 'unmatched')))
      .then((x: any) => { if (on) setBankWaiting(x.data().count); }).catch(() => {});
    count(); const vis = () => { if (document.visibilityState === 'visible') count(); };
    document.addEventListener('visibilitychange', vis);
    return () => { on = false; document.removeEventListener('visibilitychange', vis); };
  }, [hubFirestore, hubTenantId, activeTab]);

  const tenantId = hubTenantId;
  return (
    <div className="flex min-h-screen w-full flex-col overflow-x-hidden" style={{ background: '#f5f5f7' }}>
      <AppHeader title="Money" />

      <nav aria-label="Money" className="sticky top-0 z-30 border-b px-4 py-2.5 backdrop-blur" style={{ background: 'rgba(245,245,247,0.94)', borderColor: '#ececee' }}>
        <div className="mx-auto flex max-w-[1180px] gap-1.5 overflow-x-auto md:px-2">
          {HUB_TABS.map(({ key, label }) => (
            <button key={key} type="button" aria-current={activeTab === key ? 'page' : undefined} onClick={() => handleTabChange(key)}
              className="relative flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-full px-4 text-[14px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2"
              style={activeTab === key ? { background: '#16171a', color: '#fff', fontWeight: 600 } : { background: '#fff', color: '#16171a', border: '1px solid #ececee' }}>
              {label}
              {key === 'bank' && !!bankWaiting && <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-[12px] font-semibold" style={{ background: '#fff7ed', color: '#b45309' }}>{bankWaiting}</span>}
              {key === 'activity' && hasNewActivity && <span className="h-2 w-2 rounded-full" style={{ background: '#b45309' }} aria-label="New activity" />}
            </button>
          ))}
        </div>
      </nav>

      <main className="flex-1 w-full">
        {visitedTabs.has('overview') && <div className={cn(activeTab !== 'overview' && 'hidden')}>
          <MoneyOverview bankCount={bankWaiting} onNavigate={(t) => handleTabChange(t as HubTab)} more={tenantId ? <>
            <MonthCloseCard tenantId={tenantId} />
            <AppPayoutsCard tenantId={tenantId} />
            <MilesCard tenantId={tenantId} />
            <RestockingFundCard tenantId={tenantId} />
            <TipShareCard tenantId={tenantId} mode={String((hubTenant as any)?.tipSharing?.mode || 'direct')} period={(hubTenant as any)?.tipSharing?.period === 'week' ? 'week' : 'day'} />
          </> : null} />
        </div>}
        {visitedTabs.has('ledger')   && <div className={cn(activeTab !== 'ledger'   && 'hidden')}><LedgerTab /></div>}
        {visitedTabs.has('bank')     && <div className={cn(activeTab !== 'bank'     && 'hidden')}><BankTab /></div>}
        {visitedTabs.has('payday')   && <div className={cn(activeTab !== 'payday'   && 'hidden')}><PaydayTab onNavigate={handleTabChange} /></div>}
        {visitedTabs.has('bills')    && <div className={cn(activeTab !== 'bills'    && 'hidden')}><BillsTab /></div>}
        {visitedTabs.has('reports')  && <div className={cn(activeTab !== 'reports'  && 'hidden')}><ReportsTab /></div>}
        {visitedTabs.has('activity') && <div className={cn(activeTab !== 'activity' && 'hidden')}><ActivityTab onNavigate={handleTabChange} /></div>}
      </main>
    </div>
  );
}

// useSearchParams requires a Suspense boundary in the App Router
export default function MoneyHubPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen w-full items-center justify-center bg-background">
          <Loader className="w-8 h-8 animate-spin text-primary" />
        </div>
      }
    >
      <MoneyHubContent />
    </Suspense>
  );
}
