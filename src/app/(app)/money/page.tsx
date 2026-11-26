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
import { booksSummary, effectOf, lookupOf, netSalesOf, normalizeLine, type BooksSummary } from '@/lib/books-summary';
import { esc, printLine, printMoney, printPage } from '@/lib/print-style';
import {
  buildPnlHtml, buildTaxSummaryHtml, buildPayrollRegisterHtml, buildAuditTrailHtml,
} from '@/lib/report-builders';
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

// ─── buildPrintHtml — the ledger report, in the app's print look (lib/print-style) ─────────────────────────────
// The same figures as the screen (lib/books-summary), then every checkout and online order with its lines, the other
// entries, and the receipt pictures at the back. Each line says what it is in the books (a sale, a refund, a tip, the
// sales tax, a card fee…) in a quiet pill rather than a rainbow of colors.

const SIDE_LABEL: Record<string, { label: string; tone?: 'ok' | 'warn' }> = {
  sales: { label: 'Sale', tone: 'ok' }, returns: { label: 'Refund', tone: 'warn' }, discounts: { label: 'Discount' }, tax: { label: 'Sales tax' },
  tips: { label: 'Tip' }, other: { label: 'Other income' }, held: { label: 'Held' }, transfer: { label: 'Transfer' }, cogs: { label: 'Cost of goods' },
  fees: { label: 'Card fee' }, opex: { label: 'Expense' }, skip: { label: 'Note' },
};
const INCOME_SIDES = new Set(['sales', 'tips', 'other', 'tax', 'held']);
const refOf = (id: string) => String(id || '').slice(-6).toUpperCase();

function buildPrintHtml(
  transactions: Transaction[],
  staff: Staff[],
  summary: BooksSummary,
  dateRange: DateRange | undefined,
  opts: { lookup?: any[]; shopName?: string } = {},
) {
  const byId = lookupOf(opts.lookup, transactions as any[]);
  const fmtD = (d: any, f: string) => { try { return format(new Date(d), f); } catch { return '—'; } };
  const period = dateRange?.from && dateRange?.to ? `${format(dateRange.from, 'MMM d, yyyy')} – ${format(dateRange.to, 'MMM d, yyyy')}` : 'All dates';
  const staffName = (id?: string) => (id ? staff.find((m: Staff) => m.id === id)?.name : '') || '';
  const shown = (t: any) => {
    const e = effectOf(t, byId);
    const value = e.side === 'transfer' || e.side === 'skip' ? Math.abs(Number(t.amount) || 0) : INCOME_SIDES.has(e.side) ? e.amount : -e.amount;
    return { e, value, pill: SIDE_LABEL[e.side] || SIDE_LABEL.skip };
  };
  const pillHtml = (p: { label: string; tone?: string }) => `<span class="pill ${p.tone || ''}">${p.label}</span>`;

  // Checkouts at the desk and online orders, each with its lines; everything else on its own.
  const groups = new Map<string, any[]>(); const loose: any[] = [];
  for (const t of transactions as any[]) {
    const key = t.checkoutSessionId ? `cs:${t.checkoutSessionId}` : t.retailOrderId ? `ro:${t.retailOrderId}` : '';
    if (key) { if (!groups.has(key)) groups.set(key, []); groups.get(key)!.push(t); } else loose.push(t);
  }
  const sessions = [...groups.entries()].map(([key, lines]) => {
    const first = lines[0];
    const sum = (side: string) => lines.reduce((a, t) => { const x = shown(t); return x.e.side === side ? a + x.value : a; }, 0);
    const fees = sum('fees');
    const total = lines.reduce((a, t) => { const x = shown(t); return x.e.side === 'fees' || x.e.side === 'transfer' || x.e.side === 'skip' ? a : a + x.value; }, 0);
    return { key, first, lines, items: sum('sales'), tax: sum('tax'), tips: sum('tips'), off: sum('discounts') + sum('returns'), fees, total };
  }).sort((a, b) => new Date(b.first.date).getTime() - new Date(a.first.date).getTime());

  const appendix: { n: number; ref: string; desc: string; when: string; who: string; url: string }[] = [];
  const picOf = new Map<string, number>();
  for (const t of [...sessions.flatMap((x) => x.lines), ...loose]) {
    if (!t.receiptUrl || picOf.has(t.id)) continue;
    picOf.set(t.id, appendix.length + 1);
    appendix.push({ n: appendix.length + 1, ref: refOf(t.checkoutSessionId || t.retailOrderId || t.id), desc: String(t.description || ''), when: fmtD(t.date, 'MMM d, yyyy · h:mm a'), who: String(t.clientOrVendor || ''), url: String(t.receiptUrl) });
  }
  const picTag = (t: any) => (picOf.get(t.id) ? ` <span class="pill">Receipt ${picOf.get(t.id)}</span>` : '');

  const sessionHtml = sessions.map((x) => {
    const lineRows = x.lines.map((t) => {
      const v = shown(t); const who = staffName(t.staffId);
      return `<tr><td>${pillHtml(v.pill)} ${esc(t.description || t.category || '')}${who ? ` <span class="muted">· ${esc(who.split(' ')[0])}</span>` : ''}${picTag(t)}</td>
        <td class="muted nowrap">${fmtD(t.date, 'h:mm a')}</td><td class="r">${printMoney(v.value)}</td></tr>`;
    }).join('');
    const parts = [
      x.items ? `Items ${printMoney(x.items)}` : '', x.tax ? `Tax ${printMoney(x.tax)}` : '', x.tips ? `Tip ${printMoney(x.tips)}` : '',
      x.off ? `Off ${printMoney(x.off)}` : '', `<b>Total ${printMoney(x.total)}</b>`,
    ].filter(Boolean).join(' · ');
    return `<div class="box keep" style="margin-bottom:12px;padding:0;overflow:hidden">
      <div style="display:flex;justify-content:space-between;gap:12px;padding:10px 14px;background:#f5f5f7">
        <div><b>${esc(x.first.clientOrVendor || 'Guest')}</b><div class="muted">${fmtD(x.first.date, 'MMM d, yyyy · h:mm a')} · ${esc(x.first.paymentMethod || '')}</div></div>
        <div class="r"><b>${printMoney(x.total)}</b><div class="faint">${x.key.startsWith('ro:') ? 'Online order' : 'Checkout'} ${refOf(x.key.slice(3))}</div></div>
      </div>
      <table><tbody>${lineRows}</tbody></table>
      <div class="muted" style="padding:8px 14px">${parts}${x.fees ? ` <span class="faint">· Card fee ${printMoney(-x.fees)} (the shop’s cost, not the client’s)</span>` : ''}</div>
    </div>`;
  }).join('');

  const looseHtml = loose.map((t) => {
    const v = shown(t);
    return `<tr><td class="faint">${refOf(t.id)}</td><td class="muted nowrap">${fmtD(t.date, 'MMM d, h:mm a')}</td>
      <td>${esc(t.description || '')}${picTag(t)}<div class="muted">${esc(t.clientOrVendor || '')}</div></td>
      <td>${pillHtml(v.pill)} <span class="muted">${esc(t.category || '')}</span></td><td class="muted">${esc(staffName(t.staffId))}</td>
      <td class="muted">${esc(t.paymentMethod || '')}</td><td class="r">${printMoney(v.value)}</td></tr>`;
  }).join('');

  const cats = (list: [string, number][], none: string) => list.length ? list.map(([c, a]) => printLine(esc(c), a, 'sub')).join('') : `<p class="faint">${none}</p>`;
  const body = `
  <div class="grid2">
    <div class="box">
      <h3 style="margin-top:0">Summary</h3>
      ${printLine('Sales', summary.sales)}
      ${summary.returns ? printLine('Returns and refunds', -summary.returns, 'sub') : ''}
      ${summary.discounts ? printLine('Discounts and deposits used', -summary.discounts, 'sub') : ''}
      ${printLine('Net sales', summary.netSales, 'total')}
      ${summary.tips ? printLine('Tips for the team', summary.tips) : ''}
      ${summary.otherIncome ? printLine('Other income', summary.otherIncome) : ''}
      ${printLine('Cost of goods', -summary.cogs)}
      ${printLine('Card fees', -summary.netFees)}
      ${printLine('Other expenses', -summary.operatingExpenses)}
      ${printLine('Net income', summary.net, 'total', summary.net >= 0 ? 'ok' : 'bad')}
    </div>
    <div class="box">
      <h3 style="margin-top:0">Held, not income</h3>
      ${printLine('Sales tax collected', summary.taxCollected)}
      ${summary.taxRefunded ? printLine('Given back on refunds and voids', -summary.taxRefunded, 'sub') : ''}
      ${printLine('Sales tax owed', summary.taxOwed, 'total')}
      ${summary.taxPaid ? printLine('Paid to the state', summary.taxPaid, 'sub') : ''}
      ${summary.taxFreeSales ? printLine('Sold tax free to resellers', summary.taxFreeSales, 'sub') : ''}
      ${summary.giftCardsSold ? printLine('Gift cards sold', summary.giftCardsSold) : ''}
      ${summary.heldForRenters ? printLine('Taken for renters', summary.heldForRenters) : ''}
      <h3>Card fees</h3>
      ${printLine('Passed on to clients', summary.feesPassedOn)}
      ${printLine('Paid to Stripe', -summary.feesPaid)}
      ${summary.feesBack ? printLine('Returned by Stripe', summary.feesBack, 'sub') : ''}
      ${printLine('Card fees, net', summary.feesPassedOn - summary.netFees, 'total')}
    </div>
  </div>
  <div class="grid2" style="margin-top:12px">
    <div class="box"><h3 style="margin-top:0">Sales by category</h3>${cats(summary.byCategory.sales, 'No sales this period.')}</div>
    <div class="box"><h3 style="margin-top:0">Expenses by category</h3>${cats([...summary.byCategory.cogs, ...summary.byCategory.opex].sort((a, b) => b[1] - a[1]), 'No expenses this period.')}</div>
  </div>
  ${sessions.length ? `<h2>Checkouts and online orders · ${sessions.length}</h2>${sessionHtml}` : ''}
  ${loose.length ? `<h2>Other entries · ${loose.length}</h2>
  <table><thead><tr><th>Ref</th><th>Date</th><th>Description</th><th>In the books</th><th>Team</th><th>Paid by</th><th class="r">Amount</th></tr></thead><tbody>${looseHtml}</tbody></table>` : ''}
  ${appendix.length ? `<div class="break"></div><h2>Receipts · ${appendix.length}</h2>
  <div class="grid2">${appendix.map((a) => `<div class="box keep"><div style="display:flex;justify-content:space-between;gap:10px;margin-bottom:8px"><b>Receipt ${a.n}</b><span class="muted r">${esc(a.desc)}<br>${esc(a.who)} · ${a.when}</span></div>
    <img src="${esc(a.url)}" alt="Receipt ${a.n}" style="width:100%;max-height:280px;object-fit:contain;display:block;border-radius:10px" /></div>`).join('')}</div>` : ''}`;

  return printPage({
    title: 'Ledger report', heading: 'Ledger <b>report</b>', subtitle: period, shopName: opts.shopName, body,
    footNote: `${transactions.length} entries · ${sessions.length} checkouts and orders. Sales tax and gift cards sold are held, not income.`,
    footRight: period,
  });
}

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

  if (!transaction) return null;
  const isCard = transaction.paymentMethod?.toLowerCase().includes('card') || transaction.paymentMethod?.toLowerCase().includes('visa');
  const tipToRefund = refundTip ? (transaction.tipAmount || 0) : 0;
  const totalOutlay = refundAmount + tipToRefund;

  // v79 — manager PIN verified server-side (rate-limited; works after
  // PINs move out of client-readable staff docs). Client compare remains
  // only as a pre-deploy fallback.
  const [verifying, setVerifying] = useState(false);
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

  const handlePrint = useCallback(() => {
    openPrintWindow(buildPrintHtml(filteredTransactions, staff || [], financialSummary, date, { lookup: transactions || [], shopName: String((selectedTenant as any)?.name || '') || undefined }));
  }, [filteredTransactions, transactions, staff, financialSummary, date, openPrintWindow, selectedTenant]);

  // v63 — the Reports menu: P&L, Schedule C tax summary, payroll register,
  // and the printable audit trail, all over the currently filtered period.
  const openReport = useCallback(async (kind: 'pnl' | 'tax' | 'payroll' | 'audit') => {
    let html = '';
    const reportOpts = { lookup: transactions || [], shopName: String((selectedTenant as any)?.name || '') || undefined };
    if (kind === 'pnl') html = buildPnlHtml(filteredTransactions, date, 'USD', reportOpts);
    if (kind === 'tax') html = buildTaxSummaryHtml(filteredTransactions, date, 'USD', reportOpts);
    if (kind === 'payroll') {
      const tState = (selectedTenant as any)?.taxState || null;
      const profile = tState ? getStateProfile(tState) : GENERIC_US_PROFILE;
      html = buildPayrollRegisterHtml(filteredTransactions, staff || [], profile, date, !!tState, 'USD', reportOpts);
    }
    if (kind === 'audit') {
      if (!firestore || !tenantId) return;
      const snap = await getDocs(query(
        collection(firestore, `tenants/${tenantId}/auditLogs`),
        orderBy('at', 'desc'), limit(500),
      ));
      const entries = snap.docs.map(d => d.data() as any).filter(e => {
        if (!e.at) return true;
        const t = new Date(e.at).getTime();
        if (date?.from && t < startOfDay(date.from).getTime()) return false;
        if (date?.to && t > endOfDay(date.to).getTime()) return false;
        return true;
      });
      html = buildAuditTrailHtml(entries, date, 'USD', reportOpts);
    }
    if (html) openPrintWindow(html);
  }, [filteredTransactions, transactions, date, staff, selectedTenant, firestore, tenantId, openPrintWindow]);

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
        <button type="button" className="inline-flex min-h-[44px] items-center justify-center rounded-full border border-[#ececee] bg-white px-4 text-[14px] font-semibold text-[#16171a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2">Print or export</button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 rounded-2xl p-1">
        <DropdownMenuItem asChild className="min-h-[44px] rounded-xl px-3 text-[14px] font-semibold">
          <Link href="/records/pnl">Profit and loss, month by month</Link>
        </DropdownMenuItem>
        <p className="px-3 pb-1 pt-2 text-[12px] text-muted-foreground">For the dates picked here, to print:</p>
        <DropdownMenuItem onClick={handlePrint} className="min-h-[44px] rounded-xl px-3 text-[14px] font-medium">Every line, in full detail</DropdownMenuItem>
        <DropdownMenuItem onClick={() => openReport('pnl')} className="min-h-[44px] rounded-xl px-3 text-[14px] font-medium">Profit and loss for these dates</DropdownMenuItem>
        <DropdownMenuItem onClick={() => openReport('tax')} className="min-h-[44px] rounded-xl px-3 text-[14px] font-medium">Tax summary (Schedule C)</DropdownMenuItem>
        <DropdownMenuItem onClick={() => openReport('payroll')} className="min-h-[44px] rounded-xl px-3 text-[14px] font-medium">Payroll register</DropdownMenuItem>
        <DropdownMenuItem onClick={() => openReport('audit')} className="min-h-[44px] rounded-xl px-3 text-[14px] font-medium">Audit trail</DropdownMenuItem>
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

/** The Bank tab: lines from the connected bank to sort, sorted for you, and matched (components/money/BankScreen). */
const BankTab = () => {
  const { firestore } = useFirebase();
  const { selectedTenant } = useTenant();
  const auditActor = useAuditActor();
  const tenantId = selectedTenant?.id;
  return (
    <div className="mx-auto w-full max-w-[1180px] px-4 py-5 md:px-6" style={{ color: '#16171a' }}>
      <h1 className="px-1 text-[30px] font-semibold leading-tight md:text-[34px]" style={{ letterSpacing: '-0.02em' }}>Bank</h1>
      <p className="mt-1 px-1 text-[14px]" style={{ color: '#6d7075' }}>Each line from your connected bank: sorted for you when it’s plain what it is, matched when it’s money already in your books, and the rest waiting for you with a category picked.</p>
      <div className="mt-5">{tenantId && firestore && <BankScreen tenantId={tenantId} firestore={firestore} actor={auditActor} />}</div>
    </div>
  );
};

const AllocationItem = ({ label, percentage, amount, color }: { label: string, percentage: number, amount: number, color: string }) => (
    <div className="flex items-center justify-between p-3 rounded-xl bg-muted/30 border shadow-sm">
        <div className="flex items-center gap-3">
            <div className={cn("w-2 h-8 rounded-full", color)} />
            <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{label}</p>
                <p className="text-[8px] font-bold text-muted-foreground opacity-60">{percentage}% Allocation</p>
            </div>
        </div>
        <p className="text-base md:text-lg font-black font-mono tracking-tighter text-foreground">${amount.toFixed(2)}</p>
    </div>
);

type Cadence = 'weekly' | 'bi-weekly' | 'monthly' | 'custom';

const PaydayTab = () => {
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
  // Shared tips: pay each person's APPROVED share (the same as the payroll draft), not the tips taken at their chair.
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

  const currentBalance = useMemo(() => {
      const income = filteredTransactions.filter(t => t.type === 'income').reduce((acc, t) => acc + t.amount, 0);
      const expenses = filteredTransactions.filter(t => t.type === 'expense' || t.type === 'payment').reduce((acc, t) => acc + t.amount, 0);
      return Math.max(0, income - expenses);
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

    // Booth renters are not on payroll — they rent the chair and keep their
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

  // v60 — Tax bucket is no longer a flat 15%: it's driven by the studio's
  // state profile (federal + SE base + state effective rate). Owner Comp
  // absorbs the difference so the split always totals 100%.
  const suggestions = useMemo(() => {
      const amt = allocationAmount || 0;
      const alloc = suggestedAllocation(stateProfile);
      return [
          { label: 'Profit', pct: alloc.profit, amount: Number((amt * alloc.profit / 100).toFixed(2)), color: 'bg-green-500' },
          { label: 'Owner Comp', pct: alloc.ownerComp, amount: Number((amt * alloc.ownerComp / 100).toFixed(2)), color: 'bg-primary' },
          { label: `Tax (${stateProfile.code})`, pct: alloc.tax, amount: Number((amt * alloc.tax / 100).toFixed(2)), color: 'bg-orange-500' },
          { label: 'OpEx / Bills', pct: alloc.opex, amount: Number((amt * alloc.opex / 100).toFixed(2)), color: 'bg-blue-500' },
      ];
  }, [allocationAmount, stateProfile]);

  const handleSetMaxBalance = () => {
      setAllocationAmount(Number(currentBalance.toFixed(2)));
  };

  const handleConfirmDistributions = async () => {
    if (!firestore || !tenantId) return;
    setIsSubmitting(true);

    const batch = writeBatch(firestore);
    const now = new Date().toISOString();

    staffObligations.forEach(obligation => {
        const txnRef = doc(collection(firestore, `tenants/${tenantId}/transactions`));
        const newTxn: Omit<Transaction, 'id'> = {
            date: now,
            description: `Payroll Payout: ${obligation.name}`,
            clientOrVendor: obligation.name,
            type: 'expense',
            context: 'Business',
            taxBucket: 'payroll',
            category: 'Payroll',
            amount: Number(obligation.amount.toFixed(2)),
            paymentMethod: 'Distribution',
            hasReceipt: false,
            staffId: obligation.id,
        };
        batch.set(txnRef, { ...newTxn, id: txnRef.id });
    });

    suggestions.forEach(bucket => {
        if (bucket.amount > 0 && bucket.label !== 'OpEx / Bills') {
            const txnRef = doc(collection(firestore, `tenants/${tenantId}/transactions`));
            const newTxn: Omit<Transaction, 'id'> = {
                date: now,
                description: `Profit First Allocation: ${bucket.label}`,
                clientOrVendor: 'Internal Distribution',
                type: 'expense',
                context: 'Business',
                taxBucket: 'transfer',
                category: 'Distribution',
                amount: Number(bucket.amount.toFixed(2)),
                paymentMethod: 'Internal Transfer',
                hasReceipt: false,
            };
            batch.set(txnRef, { ...newTxn, id: txnRef.id });
        }
    });

    try {
        await batch.commit();
        toast({
            title: "Distributions Confirmed",
            description: `Logged distributions successfully.`
        });
        setAllocationAmount(0);
        markDraftApproved();
        writeAudit(firestore, tenantId, {
            action: 'payroll.distribute', targetType: 'payroll',
            summary: `Confirmed payouts: ${staffObligations.length} staff ($${staffTotalOwed.toFixed(2)}) + Profit First allocations of $${allocationAmount.toFixed(2)}`,
            amount: staffTotalOwed, actor: auditActor,
        });
    } catch (e) {
        console.error("Distributions failed:", e);
        toast({ variant: 'destructive', title: "Distribution Failed" });
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
                title: 'Payroll Submitted to Gusto',
                description: `${staffObligations.length} employee${staffObligations.length === 1 ? '' : 's'} — Gusto is handling taxes, withholdings & direct deposits.`,
            });
            markDraftApproved();
            writeAudit(firestore, tenantId, {
                action: 'payroll.submit_gusto', targetType: 'payroll',
                summary: `Submitted payroll to Gusto: ${staffObligations.length} staff, gross $${staffTotalOwed.toFixed(2)}, est. employer taxes $${employerTaxes.toFixed(2)}`,
                amount: staffTotalOwed, actor: auditActor,
            });
        } else {
            toast({ variant: 'destructive', title: 'Gusto Submission Issue', description: result.message || 'The payroll draft was not accepted.' });
        }
    } catch (e) {
        console.error('Gusto submission failed:', e);
        toast({ variant: 'destructive', title: 'Gusto Submission Failed' });
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
    <div className="p-4 md:p-8">
        <div className="max-w-2xl mx-auto px-2 md:px-0 space-y-8 md:space-y-10">
            <div className="text-center space-y-1">
                <h1 className="text-2xl md:text-3xl font-black uppercase tracking-tighter text-foreground">Run Payday</h1>
                <p className="text-[10px] md:text-sm text-muted-foreground font-medium uppercase tracking-widest opacity-70">
                    Reconcile Period & Allocate Revenue
                </p>
            </div>

            <div className="space-y-6">
                <div className="max-w-[340px] mx-auto flex gap-1.5 p-2 bg-muted border-2 border-muted rounded-2xl shadow-inner">
                    {(['weekly', 'bi-weekly', 'monthly', 'custom'] as Cadence[]).map(c => (
                        <Button key={c} variant="ghost" size="sm" onClick={() => handleCadenceChange(c)} className={cn("flex-1 text-[9px] font-black uppercase h-8 rounded-xl transition-all", cadence === c ? "bg-card shadow-sm border border-border/50" : "hover:bg-card/50")}>{c.replace('-', ' ')}</Button>
                    ))}
                </div>

                {cadence === 'custom' ? (
                    <div className="p-6 md:p-16 bg-muted/30 rounded-[2.5rem] md:rounded-[3rem] border-2 border-dashed border-muted-foreground/20 space-y-6 md:space-y-8 shadow-inner">
                        <div className="flex items-center gap-3 justify-center text-[10px] md:text-[11px] font-black uppercase tracking-widest text-primary">
                            <CalendarRange className="w-4 h-4" /> Select Custom Window
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 md:gap-8 px-2 md:px-4">
                            <div className="space-y-2 text-left">
                                <Label className="text-[9px] uppercase font-black text-muted-foreground ml-2">Start Date</Label>
                                <input
                                    type="date"
                                    value={format(dateRange.from, 'yyyy-MM-dd')}
                                    onChange={(e) => {
                                        const newDate = e.target.value ? startOfDay(new Date(e.target.value.replace(/-/g, '/'))) : dateRange.from;
                                        setDateRange(prev => ({ ...prev, from: newDate }));
                                    }}
                                    className="w-full h-12 sm:h-16 rounded-2xl border-2 bg-background px-4 font-black text-sm sm:text-lg text-center focus:border-primary focus:ring-4 focus:ring-primary/10 transition-all outline-none shadow-md"
                                />
                            </div>
                            <div className="space-y-2 text-left">
                                <Label className="text-[9px] uppercase font-black text-muted-foreground ml-2">End Date</Label>
                                <input
                                    type="date"
                                    value={format(dateRange.to, 'yyyy-MM-dd')}
                                    onChange={(e) => {
                                        const newDate = e.target.value ? endOfDay(new Date(e.target.value.replace(/-/g, '/'))) : dateRange.to;
                                        setDateRange(prev => ({ ...prev, to: newDate }));
                                    }}
                                    className="w-full h-12 sm:h-16 rounded-2xl border-2 bg-background px-4 font-black text-sm sm:text-lg text-center focus:border-primary focus:ring-4 focus:ring-primary/10 transition-all outline-none shadow-md"
                                />
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="flex items-center justify-between p-4 md:p-6 bg-muted/30 rounded-2xl border-2 border-dashed border-muted-foreground/20 mx-1 md:mx-0 shadow-inner">
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={handlePrevPeriod}
                            className="h-10 w-10 md:h-12 md:w-12 hover:bg-card rounded-full shadow-sm"
                        >
                            <ChevronLeft className="w-5 h-5 md:w-6 md:h-6"/>
                        </Button>

                        <div className="text-center px-2">
                            <p className="text-[9px] md:text-[10px] font-black uppercase tracking-widest text-primary mb-1">Reconciling Period</p>
                            <p className="text-sm md:text-xl font-black text-foreground leading-none">
                                {format(dateRange.from, 'MMM d')} – {format(dateRange.to, 'MMM d, yyyy')}
                            </p>
                        </div>

                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={handleNextPeriod}
                            className="h-10 w-10 md:h-12 md:w-12 hover:bg-card rounded-full shadow-sm"
                        >
                            <ChevronRight className="w-5 h-5 md:w-6 md:h-6"/>
                        </Button>
                    </div>
                )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Card className="border-2 shadow-sm bg-primary/5 border-primary/10">
                    <CardContent className="p-5 md:p-6 flex flex-col justify-center text-left">
                        <p className="text-[9px] md:text-[10px] font-black uppercase text-primary tracking-widest mb-1">Period Net Income</p>
                        <p className="text-2xl md:text-3xl font-black tracking-tighter text-primary font-mono">${currentBalance.toFixed(2)}</p>
                    </CardContent>
                </Card>
                <Card className={cn("border-2 shadow-sm", totalHardObligations > currentBalance ? "bg-destructive/5 border-destructive/20" : "bg-muted/20")}>
                    <CardContent className="p-5 md:p-6 flex flex-col justify-center text-left">
                        <p className="text-[9px] md:text-[10px] font-black uppercase text-muted-foreground tracking-widest mb-1">Obligations Total</p>
                        <div className="flex items-center justify-between">
                            <p className={cn("text-2xl md:text-3xl font-black tracking-tighter font-mono", totalHardObligations > currentBalance && "text-destructive")}>
                                ${totalHardObligations.toFixed(2)}
                            </p>
                            {totalHardObligations > currentBalance && (
                                <TooltipProvider>
                                    <Tooltip>
                                        <TooltipTrigger><AlertCircle className="w-5 h-5 text-destructive animate-pulse" /></TooltipTrigger>
                                        <TooltipContent className="border-2 rounded-xl font-black uppercase text-[9px]">Warning: Obligations exceed period income.</TooltipContent>
                                    </Tooltip>
                                </TooltipProvider>
                            )}
                        </div>
                    </CardContent>
                </Card>
            </div>

            {pendingDraft && (
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-4 md:p-5 rounded-2xl bg-primary/5 border-2 border-primary/20 shadow-sm animate-in fade-in slide-in-from-top-2 duration-300">
                    <div className="text-left">
                        <p className="text-[9px] font-black uppercase tracking-widest text-primary mb-1 flex items-center gap-1.5">
                            <CalendarRange className="w-3.5 h-3.5" /> Payroll draft ready
                        </p>
                        <p className="text-xs md:text-sm font-black text-foreground">
                            {format(safeDate(pendingDraft.periodStart), 'MMM d')} – {format(safeDate(pendingDraft.periodEnd), 'MMM d')} · {pendingDraft.lines?.length || 0} staff · gross ${Number(pendingDraft.grossTotal || 0).toFixed(2)} + est. taxes ${Number(pendingDraft.estimatedEmployerTaxes || 0).toFixed(2)}
                        </p>
                        <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground opacity-60 mt-0.5">
                            Preview only — numbers recompute live when you approve below
                        </p>
                    </div>
                    <Button
                        variant="outline"
                        size="sm"
                        className="h-10 px-4 rounded-xl border-2 font-black uppercase text-[9px] tracking-widest shrink-0"
                        onClick={() => {
                            setCadence('custom');
                            setDateRange({ from: startOfDay(safeDate(pendingDraft.periodStart)), to: endOfDay(safeDate(pendingDraft.periodEnd)) });
                        }}
                    >
                        Load Period
                    </Button>
                </div>
            )}

            <Card className="border-2 shadow-xl overflow-hidden">
                <CardHeader className="p-5 md:p-6 text-left border-b bg-muted/5">
                    <div className="flex items-center justify-between gap-2">
                        <CardTitle className="text-sm md:text-lg font-black uppercase tracking-tight flex items-center gap-2">
                            <Users className="w-4 h-4 md:w-5 md:h-5 text-primary" />
                            Payroll Ready
                        </CardTitle>
                        {gusto.connected ? (
                            <Badge className="bg-green-100 text-green-800 border-none font-black text-[9px] uppercase tracking-widest h-6 px-3">Gusto Connected</Badge>
                        ) : (
                            <Badge variant="outline" className="border-2 font-black text-[9px] uppercase tracking-widest text-muted-foreground h-6 px-3">Not Connected</Badge>
                        )}
                    </div>
                    <CardDescription className="text-[10px] font-bold uppercase tracking-widest opacity-60">
                        {gusto.connected
                            ? `Submits to ${gusto.companyName || 'Gusto'} — taxes, filings & direct deposit handled there`
                            : 'Connect Gusto to run compliant payroll from this screen'}
                    </CardDescription>
                </CardHeader>
                <CardContent className="p-5 md:p-6 space-y-4">
                    <div className="space-y-2">
                        {[
                            { label: `Employees with earnings: ${staffObligations.length}`, ok: staffObligations.length > 0 },
                            { label: 'Hours & commissions calculated', ok: staffObligations.length > 0 },
                            ...(() => { const n = staffObligations.reduce((x: number, o: any) => x + (o.missingClockOuts || 0), 0); return [{ label: n ? `${n} forgotten clock-out${n === 1 ? '' : 's'} — not paid until fixed on Timesheets` : 'No forgotten clock-outs', ok: n === 0 }]; })(),
                            { label: 'Tips reconciled from ledger', ok: true },
                            { label: `Payroll reserve funded (${fmtCurrency(payrollCashNeeded)} needed)`, ok: currentBalance >= payrollCashNeeded },
                        ].map(item => (
                            <div key={item.label} className="flex items-center justify-between p-3 rounded-xl bg-muted/30 border shadow-sm">
                                <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground text-left">{item.label}</span>
                                {item.ok
                                    ? <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
                                    : <AlertCircle className="w-4 h-4 text-destructive shrink-0" />}
                            </div>
                        ))}
                    </div>
                    <div className="p-4 rounded-xl border-2 border-dashed bg-muted/10 space-y-2 text-left">
                        <div className="flex justify-between text-[10px] font-black uppercase tracking-widest">
                            <span className="text-muted-foreground opacity-70">Gross payroll</span>
                            <span className="font-mono">{fmtCurrency(staffTotalOwed)}</span>
                        </div>
                        <div className="flex justify-between text-[10px] font-black uppercase tracking-widest">
                            <span className="text-muted-foreground opacity-70">Est. employer taxes ({stateProfile.code} · {stateProfile.employerPayrollTaxPct}%)</span>
                            <span className="font-mono text-orange-600">{fmtCurrency(employerTaxes)}</span>
                        </div>
                        <div className="flex justify-between text-xs font-black uppercase tracking-widest border-t pt-2">
                            <span>Total cash needed</span>
                            <span className="font-mono text-primary">{fmtCurrency(payrollCashNeeded)}</span>
                        </div>
                    </div>

                    <div className="flex items-center justify-between gap-3 p-3.5 rounded-xl border-2 border-dashed bg-muted/5">
                        <div className="text-left">
                            <Label className="text-[10px] font-black uppercase tracking-widest flex items-center gap-2">
                                <CalendarRange className="w-3.5 h-3.5 text-primary" /> Auto-draft payroll
                            </Label>
                            <p className="text-[9px] text-muted-foreground uppercase font-bold opacity-60 mt-0.5">
                                Drafts assemble {cadence === 'custom' ? 'bi-weekly' : cadence} & notify you — approval is always yours
                            </p>
                        </div>
                        <Switch checked={autoDraftEnabled} onCheckedChange={handleAutoDraftToggle} />
                    </div>
                </CardContent>
                <CardFooter className="p-5 md:p-6 pt-0 flex flex-col gap-2">
                    {gusto.connected ? (
                        <Button
                            size="lg"
                            className="w-full h-14 rounded-2xl text-base font-black uppercase tracking-tight shadow-xl shadow-primary/20 transition-all active:scale-95"
                            disabled={staffObligations.length === 0 || isSubmittingPayroll}
                            onClick={handleApprovePayroll}
                        >
                            {isSubmittingPayroll ? <Loader className="animate-spin h-6 w-6" /> : (
                                <><CheckCircle2 className="mr-2 h-5 w-5" /> Approve Payroll → Gusto</>
                            )}
                        </Button>
                    ) : (
                        <>
                            <Button
                                size="lg"
                                variant="outline"
                                className="w-full h-14 rounded-2xl text-sm font-black uppercase tracking-tight border-2"
                                onClick={() => tenantId && beginGustoConnect(tenantId)}
                            >
                                <Landmark className="mr-2 h-5 w-5 text-primary" /> Connect Gusto
                            </Button>
                            <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground opacity-60 text-center">
                                Until connected, &quot;Confirm Payouts&quot; below logs payroll internally.
                            </p>
                        </>
                    )}
                </CardFooter>
            </Card>

            <Card className="border-2 shadow-xl overflow-hidden">
                <CardHeader className="p-5 md:p-6 text-left border-b bg-muted/5">
                    <CardTitle className="text-sm md:text-lg font-black uppercase tracking-tight flex items-center gap-2">
                        <Calculator className="w-4 h-4 md:w-5 md:h-5 text-primary" />
                        Allocation Engine
                    </CardTitle>
                    <CardDescription className="text-[10px] font-bold uppercase tracking-widest opacity-60">Profit First methodology suggestions</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6 md:space-y-8 p-5 md:p-6">
                    <div className="space-y-2 text-left">
                        <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Tax Location</Label>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            <Select value={taxCountry} onValueChange={handleCountryChange}>
                                <SelectTrigger className="h-12 rounded-2xl border-2 font-black uppercase text-[10px] tracking-widest bg-muted/5 shadow-sm"><SelectValue placeholder="COUNTRY" /></SelectTrigger>
                                <SelectContent className="rounded-xl border-2 shadow-2xl">
                                    {COUNTRY_OPTIONS.map(c => (
                                        <SelectItem key={c.code} value={c.code} disabled={!c.enabled} className="font-bold">
                                            {c.name}{c.enabled ? '' : ' — coming soon'}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <Select value={taxState ?? undefined} onValueChange={handleStateChange} disabled={!countryOption.enabled}>
                                <SelectTrigger className="h-12 rounded-2xl border-2 font-black uppercase text-[10px] tracking-widest bg-muted/5 shadow-sm"><SelectValue placeholder={`SELECT ${countryOption.regionLabel.toUpperCase()}`} /></SelectTrigger>
                                <SelectContent className="rounded-xl border-2 shadow-2xl max-h-72">
                                    {STATE_OPTIONS.map(s => (
                                        <SelectItem key={s.code} value={s.code} className="font-bold">
                                            {s.name} — {s.taxType === 'none' ? 'No income tax' : `${s.stateRate}% ${s.taxType === 'graduated' ? 'top' : 'flat'}`}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        {!hasTaxLocation && (
                            <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-50 border-2 border-amber-200">
                                <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                                <p className="text-[9px] font-black uppercase tracking-widest text-amber-700 leading-relaxed text-left">
                                    Set your {countryOption.regionLabel.toLowerCase()} — until then, a federal-only baseline ({GENERIC_US_PROFILE.suggestedTaxPct}%) applies and payroll tax estimates are approximate.
                                </p>
                            </div>
                        )}
                        <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground opacity-60 leading-relaxed px-1">
                            Suggested tax bucket: {stateProfile.suggestedTaxPct}% (federal + self-employment{stateProfile.taxType === 'none' ? (hasTaxLocation ? ', no state income tax' : '') : ` + ~${stateProfile.effectiveStateRate}% state`}). Estimates only — confirm with your accountant.
                        </p>
                        {stateProfile.note && (
                            <p className="text-[9px] text-muted-foreground leading-relaxed font-bold px-1 opacity-70">{stateProfile.note}</p>
                        )}
                        {ratesAreStale() && (
                            <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-50 border-2 border-amber-200">
                                <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                                <p className="text-[9px] font-black uppercase tracking-widest text-amber-700 leading-relaxed text-left">
                                    These tax rates are from {RATES_VINTAGE} and may be out of date — refresh the state tax library before relying on this split.
                                </p>
                            </div>
                        )}
                    </div>

                    <Separator className="border-dashed" />

                    <div className="space-y-2 text-left">
                        <div className="relative">
                            <DollarSign className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 md:h-6 md:w-6 text-muted-foreground opacity-40" />
                            <Input
                                id="allocation-amount"
                                type="number"
                                placeholder="0.00"
                                className="pl-12 text-2xl md:text-3xl font-black h-16 md:h-20 border-2 rounded-2xl tracking-tighter focus-visible:ring-primary/20 bg-muted/5 shadow-inner"
                                value={allocationAmount || ''}
                                onChange={(e) => setAllocationAmount(parseFloat(e.target.value) || 0)}
                            />
                        </div>
                        <div className="flex justify-between items-center px-1">
                            <p className="text-[9px] font-black uppercase text-muted-foreground">Amount to Distribute</p>
                            <Button variant="link" className="h-auto p-0 text-[9px] font-black uppercase text-primary underline underline-offset-4" onClick={handleSetMaxBalance}>Use Period Income</Button>
                        </div>
                    </div>

                    {allocationAmount > 0 && (
                        <div className="space-y-4 animate-in fade-in slide-in-from-top-2 duration-500">
                            <Separator className="border-dashed" />
                            <p className="text-[9px] font-black uppercase tracking-widest text-primary text-center">Suggested Distribution</p>
                            <div className="grid gap-3">
                                {suggestions.map(s => (
                                    <AllocationItem key={s.label} label={s.label} percentage={s.pct} amount={s.amount} color={s.color} />
                                ))}
                            </div>
                            <div className="p-4 rounded-xl border-2 border-dashed bg-muted/10 flex items-start gap-3 text-left">
                                <Info className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5 opacity-40" />
                                <p className="text-[10px] text-muted-foreground leading-relaxed font-bold uppercase tracking-tight">
                                    The <strong>OpEx Allocation</strong> of ${suggestions[3].amount.toFixed(2)} stays in your studio account to cover the ${totalHardObligations.toFixed(2)} in period obligations.
                                </p>
                            </div>
                        </div>
                    )}

                     <Accordion type="single" collapsible className="w-full border-t pt-6">
                        <AccordionItem value="obligations-summary" className="border-none">
                            <AccordionTrigger className="p-4 md:p-5 bg-muted/30 rounded-2xl border-2 hover:no-underline shadow-sm">
                                <div className="flex items-center gap-2">
                                    <Receipt className="w-4 h-4 text-primary" />
                                    <span className="font-black uppercase text-[10px] md:text-xs tracking-widest">Unpaid Obligations Detail</span>
                                </div>
                            </AccordionTrigger>
                            <AccordionContent className="pt-6 space-y-6 text-left">
                                <div className='p-4 md:p-5 bg-muted/50 rounded-2xl border-2 space-y-4 shadow-inner'>
                                    <h4 className='font-black text-[9px] md:text-[10px] uppercase tracking-widest flex items-center gap-2 text-primary'><Users className='w-3 h-3'/>Staff Earnings</h4>
                                    <div className="space-y-2">
                                        {staffObligations.length > 0 ? staffObligations.map((owed, idx) => (<React.Fragment key={idx}>
                                            <div className='flex items-center justify-between bg-background p-2.5 rounded-xl border shadow-sm'>
                                                <div className="flex items-center gap-2 min-w-0">
                                                    <Avatar className="h-7 w-7 rounded-lg border">
                                                        <AvatarImage src={owed.avatarUrl} className="object-cover" />
                                                        <AvatarFallback className="text-[8px] font-black">{(owed.name || 'S').charAt(0)}</AvatarFallback>
                                                    </Avatar>
                                                    <div className="min-w-0">
                                                        <p className="text-[10px] font-black uppercase tracking-tight truncate">{owed.name}</p>
                                                        <p className="text-[8px] text-muted-foreground uppercase font-bold tracking-widest mt-0.5">{owed.details}</p>
                                                        {(owed as any).missingClockOuts > 0 && <a href="/timesheets" className="text-[11px] font-semibold text-destructive">{(owed as any).missingClockOuts} forgotten clock-out{(owed as any).missingClockOuts === 1 ? '' : 's'} — fix on Timesheets</a>}
                                                        {(owed as any).unapprovedSessions > 0 && <a href="/timesheets" className="block text-[11px] font-semibold text-amber-700">{(owed as any).unapprovedSessions} shift{(owed as any).unapprovedSessions === 1 ? '' : 's'} waiting for approval — not paid yet</a>}
                                                        {(owed as any).noHours && <p className="text-[11px] font-semibold text-amber-700">No hours on the clock — minimum wage and overtime can’t be checked</p>}
                                                        <button type="button" onClick={() => setStatementFor(statementFor === owed.id ? null : owed.id)} className="text-[11px] font-semibold underline underline-offset-2">{statementFor === owed.id ? 'Hide' : 'See how it’s worked out'}</button>
                                                    </div>
                                                </div>
                                                <span className="font-mono font-black text-xs md:text-sm ml-2">${owed.amount.toFixed(2)}</span>
                                            </div>
                                            {statementFor === owed.id && tenantId && <PayStatement tenantId={tenantId} staffId={owed.id} from={dateRange.from.toISOString()} to={dateRange.to.toISOString()} title={`${owed.name} — pay statement`} />}
                                        </React.Fragment>)) : <p className="text-[9px] text-muted-foreground uppercase font-bold text-center py-4 border-2 border-dashed rounded-xl opacity-40">No staff earnings</p>}
                                    </div>
                                    <div className='flex justify-between text-xs border-t border-primary/20 pt-3 font-black uppercase'>
                                        <span className="tracking-widest opacity-60">Total Staff</span>
                                        <span className="text-primary tracking-tighter">${staffTotalOwed.toFixed(2)}</span>
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <div className='p-4 bg-muted/50 rounded-2xl border-2 space-y-4 shadow-inner'>
                                        <h4 className='font-black text-[9px] uppercase tracking-widest flex items-center gap-2 text-blue-600'><Building className='w-3 h-3'/>Business Bills</h4>
                                        <div className="space-y-1.5">
                                            {upcomingBusiness.length > 0 ? upcomingBusiness.map((item, idx) => (
                                                <div key={idx} className='flex justify-between text-[9px] font-black uppercase'>
                                                    <span className="text-muted-foreground truncate mr-2">{item.definition?.name}</span>
                                                    <span className="font-mono">${item.definition?.amount.toFixed(2)}</span>
                                                </div>
                                            )) : <p className="text-[8px] text-muted-foreground uppercase font-bold italic opacity-40">No entries</p>}
                                        </div>
                                        <div className='flex justify-between text-[10px] border-t border-blue-500/20 pt-2 font-black uppercase'>
                                            <span className="tracking-widest opacity-60">Total</span>
                                            <span className="text-blue-600">${businessBillsTotal.toFixed(2)}</span>
                                        </div>
                                    </div>

                                    <div className='p-4 bg-muted/50 rounded-2xl border-2 space-y-4 shadow-inner'>
                                        <h4 className='font-black text-[9px] uppercase tracking-widest flex items-center gap-2 text-purple-600'><User className='w-3 h-3'/>Personal Needs</h4>
                                        <div className="space-y-1.5">
                                            {upcomingPersonal.length > 0 ? upcomingPersonal.map((item, idx) => (
                                                <div key={idx} className='flex justify-between text-[9px] font-black uppercase'>
                                                    <span className="text-muted-foreground truncate mr-2">{item.definition?.name}</span>
                                                    <span className="font-mono">${item.definition?.amount.toFixed(2)}</span>
                                                </div>
                                            )) : <p className="text-[8px] text-muted-foreground uppercase font-bold italic opacity-40">No entries</p>}
                                        </div>
                                        <div className='flex justify-between text-[10px] border-t border-purple-500/20 pt-2 font-black uppercase'>
                                            <span className="tracking-widest opacity-60">Total</span>
                                            <span className="text-purple-600">${personalBillsTotal.toFixed(2)}</span>
                                        </div>
                                    </div>
                                </div>
                            </AccordionContent>
                        </AccordionItem>
                    </Accordion>
                </CardContent>
                <CardFooter className="p-5 md:p-6 pt-0">
                    <Button
                        size="lg"
                        className="w-full h-14 md:h-16 rounded-2xl text-base md:text-xl font-black uppercase tracking-tight shadow-xl shadow-primary/20 transition-all active:scale-95"
                        disabled={allocationAmount <= 0 || isSubmitting}
                        onClick={handleConfirmDistributions}
                    >
                        {isSubmitting ? <Loader className="animate-spin h-6 w-6 md:h-7 md:w-7" /> : (
                            <>
                                <CheckCircle2 className="mr-2 md:mr-3 h-5 w-5 md:h-7 md:w-7" />
                                Confirm Payouts
                            </>
                        )}
                    </Button>
                </CardFooter>
            </Card>
        </div>
    </div>
  );
};

// ─── BillsTab (new) ───────────────────────────────────────────────────────────

type EnrichedBill = {
  instance: any;
  definition: any;
  due: Date;
  overdue: boolean;
  daysUntil: number;
};

const BillRow = ({ bill, onMarkPaid }: { bill: EnrichedBill; onMarkPaid: (b: EnrichedBill) => void }) => (
  <div className="flex items-center justify-between gap-3 p-3.5 rounded-2xl bg-background border-2 shadow-sm">
    <div className="flex items-center gap-3 min-w-0">
      <div className={cn('p-2.5 rounded-xl shrink-0', bill.overdue ? 'bg-destructive/10' : bill.definition?.context === 'Business' ? 'bg-blue-100' : 'bg-purple-100')}>
        {bill.definition?.context === 'Business'
          ? <Building className={cn('w-4 h-4', bill.overdue ? 'text-destructive' : 'text-blue-600')} />
          : <User className={cn('w-4 h-4', bill.overdue ? 'text-destructive' : 'text-purple-600')} />}
      </div>
      <div className="min-w-0">
        <p className="text-xs font-black uppercase tracking-tight text-foreground truncate">{bill.definition?.name || 'Unknown Bill'}</p>
        <div className="flex items-center gap-2 mt-0.5">
          <span className={cn('text-[9px] font-black uppercase tracking-widest', bill.overdue ? 'text-destructive' : 'text-muted-foreground opacity-60')}>
            {bill.overdue
              ? `Overdue ${Math.abs(bill.daysUntil)}d`
              : bill.daysUntil === 0 ? 'Due today' : `Due ${fmt(bill.due, 'MMM d')}`}
          </span>
          <Badge className={cn('text-[8px] h-4 px-1.5 font-black uppercase tracking-widest border-none', bill.definition?.context === 'Business' ? 'bg-indigo-100 text-indigo-800' : 'bg-purple-100 text-purple-800')}>
            {bill.definition?.context || '—'}
          </Badge>
          {bill.definition?.cadence && bill.definition.cadence !== 'monthly' && (
            <Badge variant="outline" className="text-[8px] h-4 px-1.5 font-black uppercase tracking-widest border-2 text-muted-foreground">
              {bill.definition.cadence}
            </Badge>
          )}
        </div>
      </div>
    </div>
    <div className="flex items-center gap-3 shrink-0">
      <span className={cn('font-mono font-black text-sm md:text-base tracking-tighter', bill.overdue && 'text-destructive')}>
        ${(bill.definition?.amount || 0).toFixed(2)}
      </span>
      <Button size="sm" variant="outline" onClick={() => onMarkPaid(bill)} className="h-9 px-3 rounded-xl border-2 font-black uppercase text-[9px] tracking-widest">
        <CheckCircle2 className="w-3.5 h-3.5 mr-1.5 text-green-600" /> Pay
      </Button>
    </div>
  </div>
);

const BillsTab = () => {
  const { billDefinitions, billInstances, isLoading } = useInventory();
  const auditActor = useAuditActor();
  const { firestore } = useFirebase();
  const { selectedTenant } = useTenant();
  const { toast } = useToast();
  const tenantId = selectedTenant?.id;

  const [billToPay, setBillToPay] = useState<EnrichedBill | null>(null);
  const [payMethod, setPayMethod] = useState('Bank Transfer');
  const [isPaying, setIsPaying] = useState(false);

  const unpaidBills = useMemo<EnrichedBill[]>(() => {
    const today = startOfDay(new Date());
    return (billInstances || [])
      .filter((i: any) => i.status !== 'paid')
      .map((i: any) => {
        const definition = (billDefinitions || []).find((d: any) => d.id === i.billDefinitionId);
        const due = safeDate(i.dueDate);
        return {
          instance: i,
          definition,
          due,
          overdue: due < today,
          daysUntil: differenceInDays(startOfDay(due), today),
        };
      })
      .filter(b => b.definition)
      .sort((a, b) => a.due.getTime() - b.due.getTime());
  }, [billInstances, billDefinitions]);

  const overdueBills  = unpaidBills.filter(b => b.overdue);
  const dueSoonBills  = unpaidBills.filter(b => !b.overdue && b.daysUntil <= 7);
  const laterBills    = unpaidBills.filter(b => !b.overdue && b.daysUntil > 7);

  const totalOf = (list: EnrichedBill[]) => list.reduce((s, b) => s + (b.definition?.amount || 0), 0);
  const overdueTotal     = totalOf(overdueBills);
  const dueSoonTotal     = totalOf(dueSoonBills);
  const outstandingTotal = totalOf(unpaidBills);
  const businessTotal    = totalOf(unpaidBills.filter(b => b.definition?.context === 'Business'));
  const personalTotal    = totalOf(unpaidBills.filter(b => b.definition?.context === 'Personal'));

  const handleConfirmPay = async () => {
    if (!billToPay || !firestore || !tenantId) return;
    setIsPaying(true);
    const { instance, definition } = billToPay;
    const now = new Date().toISOString();
    const batch = writeBatch(firestore);

    // v66 — merge-set instead of strict update: a strict update throws if
    // the instance doc is missing/renamed, failing the WHOLE payment with a
    // generic error. Merge can't fail that way.
    batch.set(doc(firestore, `tenants/${tenantId}/billInstances`, instance.id), {
      status: 'paid',
      paidDate: now,
      paidAmount: definition.amount || 0,
    }, { merge: true });

    const txnRef = doc(collection(firestore, `tenants/${tenantId}/transactions`));
    batch.set(txnRef, {
      id: txnRef.id,
      date: now,
      description: `Bill Payment: ${definition.name}`,
      clientOrVendor: definition.name,
      type: 'expense',
      context: definition.context || 'Business',
      taxBucket: 'operating_cost',
      category: definition.category || 'Bills',
      amount: Number((definition.amount || 0).toFixed(2)),
      paymentMethod: payMethod,
      hasReceipt: false,
      relatedBillInstanceId: instance.id,
    });

    try {
      await batch.commit();
      toast({ title: 'Bill Paid', description: `${definition.name} — $${(definition.amount || 0).toFixed(2)} logged to the ledger.` });
      writeAudit(firestore, tenantId, {
        action: 'bill.pay', targetType: 'bill', targetId: instance.id,
        summary: `Marked paid: ${definition.name} via ${payMethod}`,
        amount: definition.amount || 0, actor: auditActor,
      });
      setBillToPay(null);
    } catch (e) {
      console.error('Bill payment failed:', e);
      toast({ variant: 'destructive', title: 'Payment Failed' });
    } finally {
      setIsPaying(false);
    }
  };

  if (isLoading) {
    return (
      <div className="p-4 md:p-8 flex items-center justify-center min-h-[50vh]">
        <Loader className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8">
      <div className="max-w-3xl mx-auto space-y-8">
        <div className="text-center space-y-1">
          <h1 className="text-2xl md:text-3xl font-black uppercase tracking-tighter text-foreground">Bills & Obligations</h1>
          <p className="text-[10px] md:text-sm text-muted-foreground font-medium uppercase tracking-widest opacity-70">
            Every unpaid instance across business & personal
          </p>
        </div>

        <div className="grid grid-cols-3 gap-3 md:gap-4">
          <Card className={cn('border-2 shadow-sm', overdueTotal > 0 ? 'bg-destructive/5 border-destructive/20' : 'bg-muted/20')}>
            <CardContent className="p-4 md:p-5">
              <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground mb-1">Overdue</p>
              <p className={cn('text-lg md:text-2xl font-black font-mono tracking-tighter', overdueTotal > 0 ? 'text-destructive' : 'text-foreground')}>${overdueTotal.toFixed(2)}</p>
              <p className="text-[8px] font-bold uppercase text-muted-foreground opacity-60 mt-1">{overdueBills.length} bill{overdueBills.length === 1 ? '' : 's'}</p>
            </CardContent>
          </Card>
          <Card className="border-2 shadow-sm bg-amber-50/60 border-amber-200">
            <CardContent className="p-4 md:p-5">
              <p className="text-[9px] font-black uppercase tracking-widest text-amber-700 mb-1">Next 7 Days</p>
              <p className="text-lg md:text-2xl font-black font-mono tracking-tighter text-amber-800">${dueSoonTotal.toFixed(2)}</p>
              <p className="text-[8px] font-bold uppercase text-amber-700/60 mt-1">{dueSoonBills.length} bill{dueSoonBills.length === 1 ? '' : 's'}</p>
            </CardContent>
          </Card>
          <Card className="border-2 shadow-sm bg-primary/5 border-primary/10">
            <CardContent className="p-4 md:p-5">
              <p className="text-[9px] font-black uppercase tracking-widest text-primary mb-1">Outstanding</p>
              <p className="text-lg md:text-2xl font-black font-mono tracking-tighter text-primary">${outstandingTotal.toFixed(2)}</p>
              <p className="text-[8px] font-bold uppercase text-muted-foreground opacity-60 mt-1">{unpaidBills.length} total</p>
            </CardContent>
          </Card>
        </div>

        <div className="flex items-center justify-between px-5 py-3.5 rounded-2xl bg-muted/30 border-2 border-dashed border-muted-foreground/20 shadow-inner">
          <div className="flex items-center gap-2">
            <Building className="w-4 h-4 text-blue-600" />
            <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Business</span>
            <span className="font-mono font-black text-sm text-blue-600">${businessTotal.toFixed(2)}</span>
          </div>
          <Separator orientation="vertical" className="h-6" />
          <div className="flex items-center gap-2">
            <User className="w-4 h-4 text-purple-600" />
            <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Personal</span>
            <span className="font-mono font-black text-sm text-purple-600">${personalTotal.toFixed(2)}</span>
          </div>
        </div>

        {unpaidBills.length === 0 && (
          <div className="text-center py-24 opacity-30 border-4 border-dashed rounded-[3rem] flex flex-col items-center gap-4">
            <CheckCircle2 className="w-16 h-16" />
            <p className="text-sm font-black uppercase tracking-widest">All bills are paid</p>
          </div>
        )}

        {overdueBills.length > 0 && (
          <div className="space-y-3">
            <h4 className="font-black text-[10px] uppercase tracking-widest flex items-center gap-2 text-destructive"><AlertCircle className="w-3.5 h-3.5" />Overdue</h4>
            <div className="space-y-2">{overdueBills.map(b => <BillRow key={b.instance.id} bill={b} onMarkPaid={setBillToPay} />)}</div>
          </div>
        )}

        {dueSoonBills.length > 0 && (
          <div className="space-y-3">
            <h4 className="font-black text-[10px] uppercase tracking-widest flex items-center gap-2 text-amber-700"><Clock className="w-3.5 h-3.5" />Due This Week</h4>
            <div className="space-y-2">{dueSoonBills.map(b => <BillRow key={b.instance.id} bill={b} onMarkPaid={setBillToPay} />)}</div>
          </div>
        )}

        {laterBills.length > 0 && (
          <div className="space-y-3">
            <h4 className="font-black text-[10px] uppercase tracking-widest flex items-center gap-2 text-muted-foreground"><CalendarCheck className="w-3.5 h-3.5" />Upcoming</h4>
            <div className="space-y-2">{laterBills.map(b => <BillRow key={b.instance.id} bill={b} onMarkPaid={setBillToPay} />)}</div>
          </div>
        )}
      </div>

      <AlertDialog open={!!billToPay} onOpenChange={o => { if (!o) setBillToPay(null); }}>
        <AlertDialogContent className="rounded-[3rem] border-4 shadow-3xl bg-background">
          <AlertDialogHeader className="p-6 pb-0">
            <AlertDialogTitle className="font-black uppercase tracking-tighter text-2xl">Mark Bill Paid</AlertDialogTitle>
            <AlertDialogDescription className="font-bold text-sm text-foreground/80 leading-relaxed uppercase tracking-tight">
              Log ${(billToPay?.definition?.amount || 0).toFixed(2)} for &quot;{billToPay?.definition?.name}&quot; as paid? An expense entry will be added to the ledger.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="px-6 pt-4 space-y-2">
            <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Payment Method</Label>
            <Select value={payMethod} onValueChange={setPayMethod}>
              <SelectTrigger className="h-12 rounded-2xl border-2 font-bold"><SelectValue /></SelectTrigger>
              <SelectContent className="rounded-xl border-2 shadow-2xl">
                {['Bank Transfer', 'Card', 'Cash', 'Check', 'Auto-Pay'].map(m => (
                  <SelectItem key={m} value={m} className="font-bold">{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <AlertDialogFooter className="p-6 pt-4 flex flex-col gap-3">
            <Button onClick={handleConfirmPay} disabled={isPaying} className="w-full h-16 rounded-2xl font-black uppercase tracking-widest shadow-2xl shadow-primary/20">
              {isPaying ? <Loader className="animate-spin h-5 w-5" /> : 'Confirm Payment'}
            </Button>
            <AlertDialogCancel onClick={() => setBillToPay(null)} className="w-full h-12 rounded-xl font-bold uppercase text-[10px] tracking-widest border-none bg-transparent">Cancel</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

// ─── OverviewTab (new) ────────────────────────────────────────────────────────

type HubTab = 'overview' | 'ledger' | 'bank' | 'payday' | 'bills' | 'activity';

// ─── ActivityTab — live audit feed for the whole business ────────────────────

const ACTIVITY_KINDS: Record<string, { icon: React.ElementType; cls: string; label: string }> = {
  transaction: { icon: Receipt,    cls: 'bg-green-100 text-green-700',   label: 'Ledger' },
  payroll:     { icon: Banknote,   cls: 'bg-sky-100 text-sky-700',       label: 'Payroll' },
  bill:        { icon: Landmark,   cls: 'bg-purple-100 text-purple-700', label: 'Bills' },
  bank:        { icon: CreditCard, cls: 'bg-indigo-100 text-indigo-700', label: 'Bank' },
  rule:        { icon: BookOpen,   cls: 'bg-amber-100 text-amber-700',   label: 'Rules' },
  debt:        { icon: FileWarning, cls: 'bg-orange-100 text-orange-700', label: 'Debt' },
};
const kindOf = (action?: string) =>
  ACTIVITY_KINDS[(action || '').split('.')[0]] || { icon: ShieldCheck, cls: 'bg-muted text-foreground/80', label: 'Other' };

const dayLabel = (d: Date) => {
  const now = new Date();
  if (isSameDay(d, now)) return 'Today';
  if (isSameDay(d, subDays(now, 1))) return 'Yesterday';
  return format(d, 'EEEE, MMM d');
};

const ActivityRow = ({ e }: { e: any }) => {
  const kind = kindOf(e.action);
  const Icon = kind.icon;
  const isSystem = e.actor?.type === 'system';
  return (
    <div className="flex items-start gap-3 p-3.5 rounded-2xl bg-background border-2 shadow-sm">
      <div className={cn('p-2.5 rounded-xl shrink-0', kind.cls)}>
        <Icon className="w-4 h-4" />
      </div>
      <div className="flex-1 min-w-0 text-left">
        <div className="flex items-center gap-2 flex-wrap">
          {isSystem ? (
            <Badge className="bg-sky-100 text-sky-800 border-none font-black text-[8px] h-4 px-1.5 uppercase tracking-widest">⚙ {e.actor?.name || 'system'}</Badge>
          ) : (
            <Badge variant="outline" className="border-2 font-black text-[8px] h-4 px-1.5 uppercase tracking-widest">
              {e.actor?.name || 'Team member'}{e.actor?.role ? ` · ${e.actor.role}` : ''}
            </Badge>
          )}
          {e.actor?.via === 'manager-pin' && (
            <Badge className="bg-amber-100 text-amber-800 border-none font-black text-[8px] h-4 px-1.5 uppercase tracking-widest">PIN authorized</Badge>
          )}
          <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground opacity-50 ml-auto shrink-0">
            {e.at ? format(safeDate(e.at), 'h:mm a') : ''}
          </span>
        </div>
        <p className="text-xs font-bold text-foreground mt-1 leading-relaxed">{e.summary}</p>
      </div>
      {typeof e.amount === 'number' && (
        <span className="font-mono font-black text-sm tracking-tighter text-foreground shrink-0 mt-0.5">
          {fmtCurrency(e.amount)}
        </span>
      )}
    </div>
  );
};

const ActivityTab = () => {
  const { staff, isLoading } = useInventory();
  const { firestore } = useFirebase();
  const { selectedTenant } = useTenant();
  const tenantId = selectedTenant?.id;

  const [entries, setEntries] = useState<any[]>([]);
  const [feedLoading, setFeedLoading] = useState(true);
  const [memberFilter, setMemberFilter] = useState('all');   // all | system | <staff name>
  const [kindFilter, setKindFilter] = useState('all');       // all | transaction | payroll | ...

  useEffect(() => {
    if (!firestore || !tenantId) return;
    const q = query(collection(firestore, `tenants/${tenantId}/auditLogs`), orderBy('at', 'desc'), limit(200));
    const unsub = onSnapshot(q,
      snap => { setEntries(snap.docs.map(d => d.data() as any)); setFeedLoading(false); },
      () => setFeedLoading(false));
    return () => unsub();
  }, [firestore, tenantId]);

  const filtered = useMemo(() => entries.filter(e => {
    if (memberFilter === 'system' && e.actor?.type !== 'system') return false;
    if (memberFilter !== 'all' && memberFilter !== 'system') {
      if (e.actor?.type !== 'user' || (e.actor?.name || '') !== memberFilter) return false;
    }
    if (kindFilter !== 'all' && (e.action || '').split('.')[0] !== kindFilter) return false;
    return true;
  }), [entries, memberFilter, kindFilter]);

  // Group by day for scannable headers
  const grouped = useMemo(() => {
    const groups: { label: string; items: any[] }[] = [];
    filtered.forEach(e => {
      const label = e.at ? dayLabel(safeDate(e.at)) : 'Unknown date';
      const last = groups[groups.length - 1];
      if (last && last.label === label) last.items.push(e);
      else groups.push({ label, items: [e] });
    });
    return groups;
  }, [filtered]);

  const memberNames = useMemo(
    () => [...new Set((staff || []).map((s: any) => s.name).filter(Boolean))] as string[],
    [staff],
  );

  if (isLoading || feedLoading) {
    return (
      <div className="p-4 md:p-8 flex items-center justify-center min-h-[50vh]">
        <Loader className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8">
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="text-center space-y-1">
          <h1 className="text-2xl md:text-3xl font-black uppercase tracking-tighter text-foreground">Activity</h1>
          <p className="text-[10px] md:text-sm text-muted-foreground font-medium uppercase tracking-widest opacity-70">
            Everything happening in your business — people & automations
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
          <Select value={memberFilter} onValueChange={setMemberFilter}>
            <SelectTrigger className="h-11 sm:w-56 rounded-2xl border-2 font-black uppercase text-[10px] tracking-widest bg-muted/5 shadow-sm"><SelectValue /></SelectTrigger>
            <SelectContent className="rounded-xl border-2 shadow-2xl">
              <SelectItem value="all" className="font-bold">Whole team</SelectItem>
              <SelectItem value="system" className="font-bold">⚙ Automations only</SelectItem>
              {memberNames.map(n => <SelectItem key={n} value={n} className="font-bold">{n}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="flex gap-1.5 p-1.5 bg-muted border-2 border-muted rounded-2xl shadow-inner overflow-x-auto">
            {['all', ...Object.keys(ACTIVITY_KINDS)].map(k => (
              <Button key={k} variant="ghost" size="sm" onClick={() => setKindFilter(k)}
                className={cn('flex-1 text-[9px] font-black uppercase h-8 px-3 rounded-xl transition-all whitespace-nowrap',
                  kindFilter === k ? 'bg-card shadow-sm border border-border/50' : 'hover:bg-card/50')}>
                {k === 'all' ? 'All' : ACTIVITY_KINDS[k].label}
              </Button>
            ))}
          </div>
        </div>

        {grouped.length === 0 ? (
          <div className="text-center py-24 opacity-30 border-4 border-dashed rounded-[3rem] flex flex-col items-center gap-4">
            <History className="w-16 h-16" />
            <p className="text-sm font-black uppercase tracking-widest">No activity yet</p>
            <p className="text-[10px] font-bold uppercase tracking-widest max-w-xs">Actions your team and automations take will appear here the moment they happen</p>
          </div>
        ) : (
          <div className="space-y-6">
            {grouped.map(g => (
              <div key={g.label} className="space-y-2">
                <h4 className="font-black text-[10px] uppercase tracking-widest text-muted-foreground opacity-60 flex items-center gap-2 px-1">
                  <History className="w-3.5 h-3.5" /> {g.label}
                  <span className="opacity-50">· {g.items.length}</span>
                </h4>
                {g.items.map((e, i) => <ActivityRow key={e.id || `${g.label}-${i}`} e={e} />)}
              </div>
            ))}
            {entries.length >= 200 && (
              <p className="text-center text-[9px] font-bold uppercase tracking-widest text-muted-foreground opacity-50">
                Showing the latest 200 actions — print the Audit Trail report for full history
              </p>
            )}
          </div>
        )}
      </div>
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
  { key: 'activity', label: 'Activity' },
];

const VALID_TABS: HubTab[] = ['overview', 'ledger', 'bank', 'payday', 'bills', 'activity'];

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
        {visitedTabs.has('payday')   && <div className={cn(activeTab !== 'payday'   && 'hidden')}><PaydayTab /></div>}
        {visitedTabs.has('bills')    && <div className={cn(activeTab !== 'bills'    && 'hidden')}><BillsTab /></div>}
        {visitedTabs.has('activity') && <div className={cn(activeTab !== 'activity' && 'hidden')}><ActivityTab /></div>}
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
