'use client';

import { hourlyRate, planCost, stationMinutes } from '@/lib/product-cost';
import { getAuth } from 'firebase/auth';
import { payPost } from '@/components/pay/pay-client';
import { PayStatement } from '@/components/staff/PayStatement';
import { serviceCommission, earnsCommission, rateFor, serviceEarnings, paidPerService, payExtras, reversalsFor } from '@/lib/commission';
import { periodPay, payrollFields, paidOnPayday } from '@/lib/pay-period';
import { periodOf, periodToPay, periodBefore, periodAfter, periodRange, cadenceWords, todayIn, type PayPeriod } from '@/lib/pay-periods';
import { sessionsFrom, clockPolicy } from '@/lib/timeclock';
import { useTransactionsInRange, usePunchesInRange } from '@/hooks/use-transactions';
import { useAppointmentsByIds } from '@/hooks/use-appointments';
import { RestockingFundCard } from '@/components/money/RestockingFundCard';
import { AppPayoutsCard } from '@/components/money/AppPayoutsCard';
import { MonthCloseCard } from '@/components/money/MonthCloseCard';
import { MoneyOverview } from '@/components/money/MoneyOverview';
import { closeOf, inClosedMonth, monthName } from '@/lib/books-close';
import { MilesCard } from '@/components/money/MilesCard';
import { WriteOffsScreen } from '@/components/money/WriteOffsScreen';
import { OwnerTaxes, OwnerTaxDueCard } from '@/components/money/OwnerTaxes';
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
import { payrollExportRows } from '@/lib/payroll-export';
import { GustoMatchCard, type GustoPerson, type GustoRun } from '@/components/money/GustoMatchCard';
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
import { staffAuthHeader } from '@/lib/staff-fetch';
import { BadDebtAgingCard } from '@/components/ledger/BadDebtAgingCard';
import { useToast } from '@/hooks/use-toast';
import { useTenant } from '@/context/TenantContext';
import { OwedToClients } from '@/components/money/OwedToClients';
import { BankScreen } from '@/components/money/BankScreen';
import { BooksScreen, wayOf, type BooksFilters } from '@/components/money/BooksScreen';
import { ReportsScreen } from '@/components/money/ReportsScreen';
import { PaydayScreen, spanWords, type SelfRun, type PersonTax, type PayMethod, type OwedProps } from '@/components/money/PaydayScreen';
import { PayrollFormsDialog } from '@/components/money/PayrollFormsDialog';
import { owedItems } from '@/lib/payroll-owed';
import { stateSpec } from '@/lib/state-payroll';
import { TaxFormsDialog } from '@/components/staff/TaxFormsDialog';
import { BonusDialog, type BonusBody } from '@/components/money/BonusDialog';
import { YearEndDialog, type YearEndTab } from '@/components/money/YearEndDialog';
import { PrintChecksDialog } from '@/components/money/PrintChecksDialog';
import { addressLines, checksHtml, type CheckData, type CheckLayout, type Nudge } from '@/lib/payroll-checks';
import { w2sFor, form940, stateAnnual, form1099s, yearEndDue } from '@/lib/payroll-yearend';
import { runByOf, runByChosen, paydayTaxes, ytdFrom, payDateFor, dueDates, owedRunsFrom, quarterWords, stateFilingOf, stubTaxes } from '@/lib/payroll-taxes';
import { NO_WAGE_TAX, staleNote, tablesInfo, type TaxForms } from '@/lib/withholding';
import { payrollTerms, PAYROLL_TERMS_ALSO, PAYROLL_TERMS_HREF, PAYROLL_TERMS_VERSION, payrollTermsOk, canAgreeFor } from '@/lib/payroll-terms';
import { saveStaffPay } from '@/lib/staff-pay-client';
import { payOverlayReady } from '@/firebase/firestore/pay-overlay';
import { BillsScreen, PAY_WAYS } from '@/components/money/BillsScreen';
import { ActivityScreen } from '@/components/money/ActivityScreen';
import { ReceiptDialog } from '@/components/money/ReceiptDialog';
import { RefundDialog } from '@/components/money/RefundDialog';
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
  // (Snap a receipt: the same Add a line, the photo first and read for what's on it: api/money/receipt-read.)
  const [snapOpen, setSnapOpen] = useState(false);
  const readReceipt = useCallback(async (url: string) => {
    if (!tenantId) return null;
    const h = await staffAuthHeader();
    const d: any = await fetch('/api/money/receipt-read', { method: 'POST', headers: { 'Content-Type': 'application/json', ...h }, body: JSON.stringify({ tenantId, url }) }).then((r) => r.json()).catch(() => null);
    return d?.ok && d.reading ? d.reading : null;
  }, [tenantId]);
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
      toast({ title: 'Refund set up', description: r.sent ? 'We’ve texted them to choose how. It’s on Refunds to give.' : 'We couldn’t text them. Share the link from Refunds to give.' });
      setTransactionToRefund(null); return;
    }
    if (isCash && !activeTill) { toast({ variant: 'destructive', title: 'Open the till first', description: 'A cash refund comes out of an open till. Or pick “They’re not here” to let them choose how.' }); return; }
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
          toast({ title: r.already ? 'Already refunded' : 'Refunded', description: `$${(Number(r.refundedCents) / 100).toFixed(2)} ${r.already ? 'went' : 'sent'} back to the card${r.shortCents > 0 ? ` ($${(Number(r.shortCents) / 100).toFixed(2)} couldn’t go back to a card)` : ''}. It shows on their statement in 5–10 days.` });
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
      toast({ title: 'Refunded', description: toCard.card ? `$${refundTotal.toFixed(2)} sent back to the card. It shows on their statement in 5–10 days.` : `$${refundTotal.toFixed(2)} reversed.` });
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
    // (A line from the bank put under payroll goes through the bank's own change, so a payroll company's withdrawal after
    // payday was recorded is matched to payday's pay, never counted twice: api/plaid recategorize.)
    if (type === 'expense' && t.bankTransactionId && String(t.paymentMethod || '') === 'Bank feed' && /^payroll( taxes)?$/i.test(category) && !/^payroll( taxes)?$/i.test(String(t.category || ''))) {
      const r = await fetch('/api/plaid', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, action: 'recategorize', bankTxnId: String(t.bankTransactionId), category }) }).then((x) => x.json()).catch(() => null);
      if (r?.ok) { if (r.payday) toast({ title: 'Matched to payday', description: 'The team’s pay for these dates was in your books already, so it isn’t counted twice.' }); return true; }
      if (r?.error) toast({ variant: 'destructive', title: 'Not changed', description: r.error });
      if (r) return false;
    }
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
      <div className="mx-auto w-full max-w-[1180px] px-4 py-5 md:px-6">
        <OwedToClientsCard />
        <BooksScreen lines={filteredTransactions} byId={ledgerById} loading={isLoading} biz={selectedTenant} staff={staff || []} tenantId={tenantId || ''}
          filters={booksFilters} reports={reportsMenu} onNew={() => { setSnapOpen(false); setIsAddTxnOpen(true); }} onSnap={() => { setSnapOpen(true); setIsAddTxnOpen(true); }}
          onChangeCategory={changeCategory} onReceipt={attachReceipt} onPreviewReceipt={(t) => setPreviewTransaction(t)} onRefund={(t) => setTransactionToRefund(t)}
          onUndo={undoLine} isUndone={isUndone} onCorrect={correct} onDisputePack={disputePack}
          summary={{ netSales: financialSummary.netSales, returns: financialSummary.returns, tips: financialSummary.tips, net: financialSummary.net }} />
        <div className="mt-5 space-y-5">
          <OwedToClients tenantId={tenantId} />
          <BadDebtAgingCard clients={clients || []} tenantId={tenantId || ''} actor={auditActor} />
        </div>
      </div>

      <AddTransactionDialog open={isAddTxnOpen} onOpenChange={setIsAddTxnOpen} staff={staff || []} onConfirm={handleAddTransaction} snap={snapOpen} readReceipt={readReceipt} />

      <ReceiptDialog
        transaction={previewTransaction}
        tenantId={tenantId || ''}
        firestore={firestore || null}
        open={!!previewTransaction}
        onOpenChange={o => { if (!o) setPreviewTransaction(null); }}
      />

      <RefundDialog
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
      {tenantId && firestore && <ReportsScreen tenantId={tenantId} firestore={firestore} tenant={selectedTenant} staff={staff || []} payroll={payroll} canManage={['owner', 'admin', 'manager'].includes(String(role || ''))} isOwner={String(role || '') === 'owner'} />}
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


const PaydayTab = ({ onNavigate }: { onNavigate?: (tab: HubTab) => void }) => {
  const { billDefinitions, billInstances, staff, isLoading: ctxLoading, services } = useInventory();
  const auditActor = useAuditActor();
  const { firestore } = useFirebase();
  const { selectedTenant, role: payRole } = useTenant() as any;
  const { toast } = useToast();
  const tenantId = selectedTenant?.id;

  const [allocationAmount, setAllocationAmount] = useState<number>(0);
  const [statementFor, setStatementFor] = useState<string | null>(null);   // whose pay statement is open
  const [isSubmitting, setIsSubmitting] = useState(false);

  // The business's own pay periods (lib/pay-periods: Settings > Time clock > Pay periods), the same ones the stubs and the
  // payroll draft use. It opens on the period to pay now; the arrows step a period at a time. "Pick dates" is for a one-off.
  const [period, setPeriod] = useState<PayPeriod | null>(null);
  const [custom, setCustom] = useState<{ from: string; to: string } | null>(null);
  const periodKeyOf = (t: any) => JSON.stringify([t?.payroll?.cadence, t?.payroll?.periodAnchor, t?.payroll?.paydayAfterDays, t?.timezone, t?.workweekStartsOn]);
  const periodSettingsKey = periodKeyOf(selectedTenant);
  useEffect(() => { if (selectedTenant) { setPeriod(periodToPay(selectedTenant)); setCustom(null); } }, [selectedTenant?.id, periodSettingsKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const dateRange = useMemo(() => {
      if (custom) return { from: startOfDay(new Date(`${custom.from}T00:00:00`)), to: endOfDay(new Date(`${custom.to}T00:00:00`)) };
      if (period && selectedTenant) { const r = periodRange(selectedTenant, period); return { from: new Date(r.fromIso), to: new Date(r.toIso) }; }
      const now = new Date(); return { from: startOfDay(subDays(now, 13)), to: endOfDay(now) };
  }, [custom, period, selectedTenant]);
  // (The period's own first and last day, in the business's time zone: what's recorded and sent.)
  const dayFrom = custom ? custom.from : period ? period.from : format(dateRange.from, 'yyyy-MM-dd');
  const dayTo = custom ? custom.to : period ? period.to : format(dateRange.to, 'yyyy-MM-dd');
  // Only this pay period's sales and clock punches are read.
  const payFrom = useMemo(() => new Date(dateRange.from.getTime()), [dateRange.from.getTime()]);
  const payTo = useMemo(() => new Date(dateRange.to.getTime() + 1), [dateRange.to.getTime()]);
  const { transactions, isLoading: txLoading } = useTransactionsInRange(payFrom, payTo);
  const { activityLogs, isLoading: punchLoading } = usePunchesInRange(payFrom, payTo);
  const isLoading = ctxLoading || txLoading || punchLoading;

  const handlePrevPeriod = () => { if (custom || !period || !selectedTenant) return; setPeriod(periodBefore(selectedTenant, period)); };
  const handleNextPeriod = () => { if (custom || !period || !selectedTenant) return; setPeriod(periodAfter(selectedTenant, period)); };
  const handlePickDates = (on: boolean) => setCustom(on ? { from: dayFrom, to: dayTo } : null);

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
      const s = booksSummary(ls, { lookup: ls, businessOnly: true }); const byId = lookupOf(ls);
      // (Payroll, and anything Payday recorded: the team's pay worked out here. Other contract labor stays a cost.)
      const booked = ls.reduce((n: number, t: any) => { const e = effectOf(t, byId); return e.side === 'opex' && ((isTeamPay(e.category) && !/contract/i.test(e.category)) || t.paydayPeriod) ? n + e.amount : n; }, 0);
      return Math.round((s.net + booked) * 100) / 100;
  }, [filteredTransactions]);

  // The visits this period's payments belong to, read by id (who did the work), not every visit ever.
  const periodVisitIds = useMemo(() => (filteredTransactions || []).map((t: any) => String(t.appointmentId || '')).filter(Boolean), [filteredTransactions]);
  const { appointments } = useAppointmentsByIds(periodVisitIds);
  const apptStaff = useMemo(() => Object.fromEntries((appointments || []).filter((a: any) => a?.id && a.staffId).map((a: any) => [a.id, String(a.staffId)])) as Record<string, string>, [appointments]);
  // Pay corrections a manager approved (Pay questions > Add to next pay), dated in these dates: on the stub, the draft and
  // what's paid alike.
  const fromIso = dateRange.from.toISOString(), toIso = dateRange.to.toISOString();
  const { data: periodAdjustments, error: adjustmentsError } = useCollection<any>(useMemoFirebase(() => (firestore && tenantId ? query(collection(firestore, 'tenants', tenantId, 'payAdjustments'), where('date', '>=', fromIso), where('date', '<=', toIso)) : null), [firestore, tenantId, fromIso, toIso]));
  const adjustmentsBy = useMemo(() => { const m = new Map<string, number>(); for (const a of periodAdjustments || []) if (a?.staffId) m.set(a.staffId, (m.get(a.staffId) || 0) + (Number(a.amountCents) || 0) / 100); return m; }, [periodAdjustments]);
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
        const adj = Math.round((adjustmentsBy.get(member.id) || 0) * 100) / 100;
        return {
            id: member.id,
            name: member.name,
            avatarUrl: member.avatarUrl,
            // What's paid on payday: what they earned and any approved correction, less cash tips they already took home.
            amount: Math.round((paidOnPayday(l) + adj) * 100) / 100,
            earned: Math.round((l.total + adj) * 100) / 100,
            adjustments: adj,
            contractor: l.contractor,
            tipsInHand: l.tipsInHand,
            commissionPay: f.commission,
            bonus: Math.round((f.bonus + adj) * 100) / 100,
            regularHours: f.regularHours,
            overtimeHours: f.overtimeHours,
            doubleOvertimeHours: f.doubleOvertimeHours,
            tips: f.tips,
            cashTips: f.cashTips,
            hours: l.hours,
            missingClockOuts: l.missingClockOuts,
            unapprovedSessions: l.unapprovedSessions,
            noHours: l.noHours,
            line: l,
            payStructure: member.payStructure,
        };
    }).filter(o => o.earned > 0 || o.missingClockOuts > 0);
  }, [staff, filteredTransactions, activityLogs, dateRange, services, apptStaff, selectedTenant, sharedTips, periodShifts, adjustmentsBy]);

  const staffTotalOwed = useMemo(() => staffObligations.reduce((sum, o) => sum + o.amount, 0), [staffObligations]);
  // (Cash tips taken home the same day: what's booked for them, never more than the person earned.)
  const cashLineOf = (o: { tipsInHand?: number; earned: number }) => Math.round(Math.min(Number(o.tipsInHand) || 0, Math.max(0, o.earned)) * 100) / 100;
  const cashTipsOut = useMemo(() => staffObligations.reduce((sum, o) => sum + cashLineOf(o), 0), [staffObligations]);
  // (Employer payroll taxes are on employees' wages, cash tips taken home included; never on contractors.)
  const employeeWages = useMemo(() => staffObligations.filter((o) => !o.contractor).reduce((sum, o) => sum + o.earned, 0), [staffObligations]);
  const employees = useMemo(() => staffObligations.filter((o) => !o.contractor), [staffObligations]);

  // ── Jurisdiction-aware tax profile — PER TENANT, never assumed. ──
  // v63 — multi-tenancy fix: no hardcoded state default. Until this tenant
  // picks their location, a federal-only generic applies and the UI prompts.
  const taxCountry = ((selectedTenant as any)?.taxCountry || 'US') as string;
  const countryOption = getCountryOption(taxCountry);
  // (The state picked here, or the one in the pay rules: the same state either way.)
  const taxState: string | null = (selectedTenant as any)?.taxState || (selectedTenant as any)?.payRules?.state || null;
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
  // Who's who in Gusto (api/gusto/employees: saved, the same email, or a likely name to confirm), and the payrolls sent
  // to it (payrollRuns, newest first: a recorded payday has no submittedAt, so it isn't one of them).
  const [gustoPeople, setGustoPeople] = useState<GustoPerson[] | null>(null);
  const [gustoLoading, setGustoLoading] = useState(false); const [gustoError, setGustoError] = useState<string | null>(null); const [gustoBusy, setGustoBusy] = useState<string | null>(null);
  const loadGusto = useCallback(async () => {
      if (!tenantId || !gusto.connected) return;
      setGustoLoading(true); setGustoError(null);
      try {
          const r: any = await fetch(`/api/gusto/employees?tenantId=${encodeURIComponent(tenantId)}`).then(x => x.json()).catch(() => null);
          if (!r?.ok) { setGustoError(r?.error || 'Gusto didn’t answer. Try again in a minute.'); setGustoPeople(null); return; }
          setGustoPeople((r.employees || []).map((e: any) => ({ gustoEmployeeId: String(e.gustoEmployeeId), name: `${e.firstName || ''} ${e.lastName || ''}`.trim() || 'Someone', email: e.email || null,
              terminated: !!e.terminated, staffId: e.staffId || undefined, suggestedStaffId: e.suggestedStaffId || undefined, how: e.how })));
      } finally { setGustoLoading(false); }
  }, [tenantId, gusto.connected]);
  useEffect(() => { void loadGusto(); }, [loadGusto]);
  const matchGusto = async (staffId: string, gustoEmployeeId: string) => {
      if (!tenantId) return; setGustoBusy(staffId);
      try {
          const r: any = await fetch('/api/gusto/employees', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, staffId, gustoEmployeeId }) }).then(x => x.json()).catch(() => null);
          if (!r?.ok) toast({ variant: 'destructive', title: 'Not matched', description: r?.error || 'Nothing changed. Try again.' }); else await loadGusto();
      } finally { setGustoBusy(null); }
  };
  const { data: runDocs } = useCollection<any>(useMemoFirebase(() => (firestore && tenantId && gusto.connected ? query(collection(firestore, `tenants/${tenantId}/payrollRuns`), orderBy('submittedAt', 'desc'), limit(6)) : null), [firestore, tenantId, gusto.connected]));
  const gustoRuns: GustoRun[] = useMemo(() => (runDocs || []).filter((d: any) => d.kind !== 'payday').map((d: any) => ({ id: String(d.payrollId || d.id), from: String(d.fromDay || d.periodStart || '').slice(0, 10), to: String(d.toDay || d.periodEnd || '').slice(0, 10),
      people: Number(d.people) || 0, gross: d.grossTotal == null ? null : Number(d.grossTotal), status: String(d.status || ''), checkDate: d.checkDate || null, sentAt: d.submittedAt || null })), [runDocs]);
  // (Employees with pay for these dates who aren't matched to anyone in Gusto yet: payroll waits for them.)
  // (Matched to someone who has left in Gusto counts as not matched.)
  const gustoUnmatched = useMemo(() => (gustoPeople ? employees.filter((o) => o.earned > 0 && !gustoPeople.some((g) => g.staffId === o.id && !g.terminated)).map((o) => o.name) : []), [gustoPeople, employees]);
  const checkRun = async (payrollId: string) => {
      if (!tenantId) return; setGustoBusy(payrollId);
      try {
          const r: any = await fetch(`/api/gusto/payroll?tenantId=${encodeURIComponent(tenantId)}&payrollId=${encodeURIComponent(payrollId)}`).then(x => x.json()).catch(() => null);
          if (!r || r.status === 'failed') toast({ variant: 'destructive', title: 'Couldn’t check Gusto', description: r?.error || 'Try again in a minute.' });
      } finally { setGustoBusy(null); }
  };
  const employerTaxes = estimateEmployerPayrollTax(employeeWages, stateProfile);
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
      // (How often is the pay period setting's own; the draft follows it.)
      updateDocumentNonBlocking(doc(firestore, 'tenants', tenantId), { 'payroll.autoDraft': on });
  };

  // (A draft's dates: its pay period, or for an older draft, its own first and last instant as local days.)
  const draftPeriod = (d: any): { from: string; to: string } => d?.periodKey && selectedTenant ? periodOf(selectedTenant, String(d.periodKey)) : { from: format(safeDate(d?.periodStart), 'yyyy-MM-dd'), to: format(safeDate(d?.periodEnd), 'yyyy-MM-dd') };

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
  const payFromYmd = dayFrom, payToYmd = dayTo;
  const periodKey = `${payFromYmd}_${payToYmd}`;

  // ── Payroll run in ClarityFlow (Settings > Payroll; design board "Payroll run in ClarityFlow"). Each employee's taxes
  // from their tax forms and what they've been taxed on so far this year (lib/withholding, lib/payroll-taxes), worked out
  // again on the server when payday is recorded, so the two always agree. ──
  const runBy = runByOf(selectedTenant);
  const selfRunOn = runBy === 'clarityflow';
  const payDate = selectedTenant ? payDateFor(selectedTenant, payFromYmd, payToYmd, todayIn(selectedTenant)) : payToYmd;
  const taxYear = Number(payDate.slice(0, 4));
  // (From January of last year: the year so far for the taxes, and what's owed and the forms, last year's fourth quarter
  // and federal unemployment too while it's January.)
  const runsYear = Math.min(taxYear, Number((selectedTenant ? todayIn(selectedTenant) : payToYmd).slice(0, 4)) || taxYear);
  const { data: yearRuns } = useCollection<any>(useMemoFirebase(() => (firestore && tenantId && selfRunOn ? query(collection(firestore, `tenants/${tenantId}/payrollRuns`), where('recordedAt', '>=', owedRunsFrom(runsYear)), limit(1500)) : null), [firestore, tenantId, selfRunOn, runsYear]));
  const selfTaxes = useMemo(() => {
      if (!selfRunOn || !selectedTenant) return null;
      const forms: Record<string, TaxForms | null> = Object.fromEntries((staff || []).map((m: any) => [m.id, m.taxForms || null]));
      return paydayTaxes({ tenant: selectedTenant, payDate, forms, ytd: ytdFrom(yearRuns || [], selectedTenant, taxYear, periodKey),
          people: employees.map((o) => ({ staffId: o.id, gross: Math.max(0, Math.round((o.amount + cashLineOf(o)) * 100) / 100), inHand: cashLineOf(o) })) });
  }, [selfRunOn, selectedTenant, staff, payDate, yearRuns, taxYear, periodKey, employees]); // eslint-disable-line react-hooks/exhaustive-deps
  // How each person is paid this payday: what their forms say, unless picked otherwise here.
  const [methods, setMethods] = useState<Record<string, { method: PayMethod; checkNo: string }>>({});
  // (Kept for these dates on this device until payday is recorded: check numbers printed first aren't lost on a reload.)
  const methodsKey = tenantId ? `cf_paymethods_${tenantId}_${periodKey}` : '';
  useEffect(() => { let kept = {}; try { kept = JSON.parse(sessionStorage.getItem(methodsKey) || '{}') || {}; } catch { kept = {}; } setMethods(kept); }, [methodsKey]);
  useEffect(() => { if (!methodsKey) return; try { if (Object.keys(methods).length) sessionStorage.setItem(methodsKey, JSON.stringify(methods)); else sessionStorage.removeItem(methodsKey); } catch { /* private browsing */ } }, [methods, methodsKey]);
  // Payroll run here waits for the business to agree to how it works (lib/payroll-terms), once; and a payday worked out
  // with another year's tax tables, for the tick that they'll be checked with the accountant (for these dates only).
  // (Agreed just now, for this business: until its record says so. Another business picked here starts over.)
  const [termsAgreedFor, setTermsAgreedFor] = useState<string | null>(null);
  const termsOk = !selfRunOn || payrollTermsOk(selectedTenant) || (!!tenantId && termsAgreedFor === tenantId);
  const [staleOk, setStaleOk] = useState(false);
  useEffect(() => { setStaleOk(false); }, [periodKey, tenantId]);
  const methodsNow = useMemo(() => Object.fromEntries(staffObligations.map((o) => { const m: any = (staff || []).find((x: any) => x.id === o.id);
      return [o.id, methods[o.id] || { method: (m?.taxForms?.payMethod || 'transfer') as PayMethod, checkNo: '' }]; })), [staffObligations, staff, methods]);
  const [formsFor, setFormsFor] = useState<string | null>(null);   // whose tax forms are open
  const formsPerson: any = formsFor ? (staff || []).find((m: any) => m.id === formsFor) : null;
  const canEditForms = ['owner', 'admin', 'manager'].includes(String(payRole || '').toLowerCase());
  const stateName = hasTaxLocation ? stateProfile.name : 'your state';
  const selfRun: SelfRun | null = useMemo(() => {
      if (!selfTaxes || !selectedTenant) return null;
      const r2 = (n: number) => Math.round(n * 100) / 100;
      const people: Record<string, PersonTax> = {};
      for (const [id, w] of Object.entries(selfTaxes.by)) people[id] = {
          gross: w.gross, takeHome: w.takeHome, employeeTotal: w.employeeTotal, federal: w.employee.federal,
          fica: r2(w.employee.socialSecurity + w.employee.medicare + w.employee.additionalMedicare), state: w.employee.state,
          other: w.employee.other.map((o) => ({ name: o.name, amount: o.amount })), pretax: r2(w.pretax.retirement + w.pretax.health),
          short: r2(w.short.socialSecurity + w.short.medicare + w.short.federal + w.short.state), stateHow: w.stateHow,
          noW4: w.flags.includes('no_w4'), noStateForm: w.flags.includes('no_state_form'), exempt: w.flags.includes('exempt'), countyMissing: w.flags.includes('county_missing'),
      };
      const due = dueDates(payDate, selectedTenant);
      const on = (d: string | null) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { month: 'long', day: 'numeric' }) : '');
      const o = selfTaxes.owed; const spec = stateSpec(taxState);
      const progOf = (id: string) => (spec?.programs || []).find((x) => x.id === id.replace(/_er$/, ''));
      const owed: SelfRun['owed'] = [];
      if (o.irs > 0) owed.push({ key: 'irs', name: 'IRS', sub: `Federal income tax, Social Security and Medicare. Due ${on(due.irs)}`, amount: o.irs });
      // (New York's: 5 business days after the payday that brings what's unpaid to $700, else with the quarter's NYS-45.)
      const nyFreq = stateFilingOf(selectedTenant); const ny = nyFreq === 'ny5' || nyFreq === 'ny3';
      if (o.state > 0) owed.push({ key: 'state', name: `${stateName} income tax`, amount: o.state,
          sub: ny ? `Due ${nyFreq === 'ny3' ? 3 : 5} business days after the payday that brings what’s unpaid to $700, or with the NYS-45 by ${on(due.state)}` : due.state ? `${spec?.filing?.deposit ? `Form ${spec.filing.deposit}. ` : ''}Due ${on(due.state)}` : `Due when ${stateName} says, for how often you file` });
      if (o.sui > 0) owed.push({ key: 'sui', name: `${stateName} unemployment`, sub: `With the quarter’s wage report. Due ${on(due.sui)}`, amount: o.sui });
      if (o.futa > 0) owed.push({ key: 'futa', name: 'Federal unemployment', sub: `Paid by ${on(due.futa)} once it passes $500 for the year, or with Form 940 in January`, amount: o.futa });
      // (A state program: with the quarter's wage report, with state withholding, or to an insurance company.)
      for (const x of o.other) { const pg = progOf(x.id);
        owed.push({ key: `other_${x.id}`, name: x.name, amount: x.amount, sub: pg?.paid === 'withholding' && due.state ? `Paid with ${stateName} income tax. Due ${on(due.state)}` : pg?.paid === 'quarterly' ? `With the quarter’s report. Due ${on(due.sui)}` : pg?.paid === 'carrier' ? 'Paid to your insurance company' : 'Due when it’s filed' }); }
      return {
          people, takeHome: selfTaxes.takeHome, employeeTaxes: selfTaxes.employeeTotal, employerTaxes: selfTaxes.employerTotal, pretax: selfTaxes.pretax,
          owed, owedTotal: o.total, stateName: hasTaxLocation ? stateProfile.name : '', stateForm: spec && !spec.noTax && spec.form?.name && !spec.form.federal ? spec.form.name : null, stateTax: !!spec && !spec.noTax,
          methods: methodsNow, onMethod: (id, method, checkNo) => setMethods((m) => ({ ...m, [id]: { method, checkNo } })),
          onForms: canEditForms ? (id) => setFormsFor(id) : undefined, payrollHref: '/settings?tab=payroll',
          tablesYear: (() => { const ti = tablesInfo(taxYear); return ti.federal === ti.state ? ti.federal : undefined; })(),
          stale: Object.values(selfTaxes.by).some((w) => w.flags.includes('stale_tables')) ? { ...staleNote(taxYear), ok: staleOk, onOk: setStaleOk } : null,
          suiMissing: Object.values(selfTaxes.by).some((w) => w.flags.includes('sui_rate_missing')),
          teamSizeMissing: Object.values(selfTaxes.by).some((w) => w.flags.includes('team_size_missing')),
      };
  }, [selfTaxes, selectedTenant, payDate, taxState, stateName, hasTaxLocation, stateProfile, methodsNow, canEditForms, taxYear, staleOk]);
  // Payroll taxes owed and paid across paydays, and the quarter's forms (lib/payroll-owed).
  const todayBiz = selectedTenant ? todayIn(selectedTenant) : payToYmd;
  const owedList = useMemo(() => (selfRunOn && selectedTenant ? owedItems(yearRuns || [], selectedTenant, todayBiz, stateName) : []), [selfRunOn, selectedTenant, yearRuns, todayBiz, stateName]);
  const [taxFormsOpen, setTaxFormsOpen] = useState(false);
  // The year's forms, from November to April: the year ending, then the year just over.
  const [yearEndAt, setYearEndAt] = useState<{ tab: YearEndTab; person?: string | null } | null>(null);
  const yeYear = (() => { const m = Number(todayBiz.slice(5, 7)); const y = Number(todayBiz.slice(0, 4)); return m >= 11 ? y : m <= 4 ? y - 1 : null; })();
  const yearEnd = useMemo(() => {
      if (!selfRunOn || !selectedTenant || !yeYear) return null;
      const runs = yearRuns || []; const w2s = w2sFor(runs, selectedTenant, yeYear); const necs = form1099s(runs, selectedTenant, yeYear).filter((x) => x.due);
      if (!w2s.length && !necs.length) return null;
      const due = new Date(`${yearEndDue(yeYear)}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' });
      const st = stateAnnual(runs, selectedTenant, yeYear, w2s); const f940 = form940(runs, selectedTenant, yeYear);
      const so = todayBiz <= `${yeYear}-12-31`; const names = w2s.map((w) => w.name); const who = names.length <= 3 ? (names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0]) : `${names.length} people`;
      const open = (tab: YearEndTab, person?: string | null) => () => setYearEndAt({ tab, person });
      return { title: `${yeYear}’s year-end forms${so ? ', so far' : ''}`, sub: so ? 'From the year’s paydays so far: final once December’s are recorded.' : 'From the year’s paydays, ready now. Copy them onto the forms, or download them all for your accountant.',
        rows: [
          ...(w2s.length ? [{ key: 'w2', name: `W-2s for ${who}`, sub: `Hand each person theirs by ${due}: print them on plain paper`, action: 'See the W-2s', onOpen: open('w2') },
            { key: 'w3', name: 'W-2s and W-3 to Social Security', sub: `Type them into Social Security’s Business Services Online. It’s free. Due ${due}`, action: 'See the numbers', onOpen: open('w3') }] : []),
          ...(st ? [{ key: 'st', name: `${st.form}, with the W-2s`, sub: `${stateName}’s withholding for the year. Due ${new Date(`${st.due}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' })}`, action: 'See the numbers', onOpen: open('st') }] : []),
          ...(w2s.length ? [{ key: '940', name: 'Form 940', sub: `Federal unemployment for the year: ${fmtCurrency(f940.total)}. Due ${due}`, action: 'See the numbers', onOpen: open('940') }] : []),
          ...necs.map((x) => ({ key: `nec_${x.staffId}`, name: `1099-NEC for ${x.name}`, sub: `${fmtCurrency(x.amount)} paid as a contractor in ${yeYear}: $${(yeYear >= 2026 ? 2000 : 600).toLocaleString('en-US')} or more, so one is due ${due}. Their tax ID goes on the form`, action: 'See the numbers', onOpen: open('nec') })),
        ] };
  }, [selfRunOn, selectedTenant, yeYear, yearRuns, todayBiz, stateName]); // eslint-disable-line react-hooks/exhaustive-deps
  const owed: OwedProps | null = useMemo(() => {
      if (!selfRunOn) return null;
      const on = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
      const days = (d: string) => Math.round((Date.parse(`${d}T12:00:00Z`) - Date.parse(`${todayBiz}T12:00:00Z`)) / 86400000);
      const subOf = (i: typeof owedList[number]) => i.carries ? `Under $500 for the year so far, so it carries over. Paid by ${on(i.due!)} once it passes $500, or with Form 940`
          : i.open ? `${i.due ? `Due ${on(i.due)}` : 'Due when it’s filed'}. Still adding up: later paydays add to it`
          : !i.due ? 'Due when it’s filed' : i.due < todayBiz ? `Was due ${on(i.due)}` : `Due ${on(i.due)}${days(i.due) <= 30 ? `, in ${days(i.due)} day${days(i.due) === 1 ? '' : 's'}` : ''}`;
      const call = async (method: 'POST' | 'DELETE', b: any) => { const r: any = await fetch('/api/payroll/taxes', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, ...b }) }).then((x) => x.json()).catch(() => null); return r?.ok ? null : (r?.error || 'Not saved. Try again.'); };
      return {
          // (One paid in part, a payday recorded late having added to it: the rest is still to pay.)
          toPay: owedList.filter((i) => i.left >= 0.01).map((i) => ({ key: i.key, name: i.paid ? `${i.name}, the rest` : i.name, amount: i.left, sub: i.paid ? `${subOf(i)}. ${fmtCurrency(i.paid.amount)} of it is paid` : subOf(i),
              late: !!i.due && i.due < todayBiz && !i.open, payable: !i.open && !i.carries })),
          paid: owedList.filter((i) => i.paid).sort((a, b) => String(b.paid!.paidOn).localeCompare(String(a.paid!.paidOn))).slice(0, 3)
              .map((i) => ({ key: i.key, name: i.name, amount: i.paid!.amount, undo: true,
                  sub: `${i.paid!.bankTransactionId ? 'Paid' : 'Marked paid'} ${on(i.paid!.paidOn)}${i.paid!.bankTransactionId ? ', from your bank' : ''}${i.due && i.paid!.paidOn > i.due ? `, after it was due ${on(i.due)}` : ''}` })),
          onPaid: (key, amount, paidOn) => call('POST', { key, amount, paidOn }),
          onUnpaid: async (key) => { const e = await call('DELETE', { key }); if (e) toast({ variant: 'destructive', title: 'Not changed', description: e }); },
          formsNames: (() => { const sp = stateSpec(taxState); const n = [...new Set(['Form 941', ...(sp && !sp.noTax && sp.filing ? [sp.filing.quarterly] : []), ...(sp ? [sp.sui.report] : [])])]; return n.length > 1 ? `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}` : n[0]; })(),
          yearEnd,
          onForms: () => setTaxFormsOpen(true), formsWords: `Forms for ${quarterWords((Number(todayBiz.slice(5, 7)) - 1) % 3 === 0 ? new Date(Date.parse(`${todayBiz.slice(0, 8)}01T12:00:00Z`) - 86400000).toISOString().slice(0, 10) : todayBiz)}`, today: todayBiz,
      };
  }, [selfRunOn, owedList, todayBiz, tenantId, taxState, yearEnd]); // eslint-disable-line react-hooks/exhaustive-deps
  const saveForms = async (forms: TaxForms) => {
      if (!firestore || !tenantId || !formsFor) return 'Not saved. Try again.';
      try { await saveStaffPay(firestore as any, tenantId, formsFor, { taxForms: forms }); return null; }
      catch { return 'Not saved: only a manager can change someone’s tax forms.'; }
  };
  // Checks for the people paid by check this payday (lib/payroll-checks): their take-home, the stub with the year so far
  // (lib/payroll-taxes stubTaxes), and the business's own payroll taxes on the stub it keeps.
  // (Once payday is recorded, from what was recorded: the check always matches its stub and the books.)
  const [checksOpen, setChecksOpen] = useState(false);
  const recordedRun: any = useMemo(() => (yearRuns || []).find((r: any) => r?.kind === 'payday' && r.periodKey === periodKey && r.runBy === 'clarityflow') || null, [yearRuns, periodKey]);
  const checkPeople = useMemo((): any[] => {
      if (!selfRunOn) return [];
      if (recordedRun) return (recordedRun.people || []).filter((p: any) => p?.method === 'check' && (p.contractor ? Number(p.paid) > 0 : Number(p.takeHome) > 0))
          .map((p: any) => ({ id: String(p.staffId), name: String(p.name || 'Team member'), contractor: !!p.contractor, amount: Number(p.paid) || 0, tips: Number(p.tips) || 0, cashTips: 0, recorded: p }));
      return staffObligations.filter((o) => (o.amount > 0 || cashLineOf(o) > 0) && methodsNow[o.id]?.method === 'check' && (o.contractor || (selfTaxes?.by[o.id]?.takeHome || 0) > 0));
  }, [selfRunOn, recordedRun, staffObligations, methodsNow, selfTaxes]); // eslint-disable-line react-hooks/exhaustive-deps
  const checks = useMemo((): (CheckData & { id: string })[] => {
      if (!checksOpen || !selectedTenant) return [];
      const span = spanWords(new Date(`${payFromYmd}T00:00:00`), new Date(`${payToYmd}T00:00:00`));
      const paid = new Date(`${payDate}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
      const r2 = (n: number) => Math.round(n * 100) / 100;
      return checkPeople.map((o: any) => {
          const base = { id: o.id, no: o.recorded ? String(o.recorded.checkNo || '') : methodsNow[o.id]?.checkNo || '', date: payDate, payee: o.name, memo: `Pay for ${span}`, span: `Pay for ${span}, paid ${paid}` };
          const w: any = o.recorded ? (o.recorded.taxes ? { ...o.recorded.taxes, takeHome: Number(o.recorded.takeHome) || 0 } : null) : selfTaxes?.by[o.id];
          if (o.contractor || !w) return { ...base, amount: r2(o.amount), earned: [{ label: 'Paid for services', now: r2(o.amount) }], taxes: [], employer: [] };
          const m: any = (staff || []).find((x: any) => x.id === o.id);
          const st = stubTaxes({ tenant: selectedTenant, staffId: o.id, periodKey, payDate, runs: yearRuns || [], forms: m?.taxForms || null, gross: w.gross, inHand: w.inHand, stateName });
          const tips = r2((Number(o.tips) || 0) + (Number(o.cashTips) || 0)); const pretax = r2(w.pretax.retirement + w.pretax.health);
          const er = w.employer || { socialSecurity: 0, medicare: 0, futa: 0, sui: 0, other: [] };
          return { ...base, amount: w.takeHome,
              earned: [{ label: 'Pay', now: r2(Math.max(0, w.gross - tips)) }, ...(tips > 0 ? [{ label: 'Tips', now: tips }] : []),
                ...(w.inHand > 0 ? [{ label: 'Of the tips, cash you took home', now: w.inHand, minus: true }] : []), ...(pretax > 0 ? [{ label: 'Taken out before taxes', now: pretax, minus: true }] : [])],
              taxes: st.lines.map((l) => ({ label: l.label, now: l.amount, year: l.ytd })),
              employer: [{ label: 'Your Social Security', now: er.socialSecurity }, { label: 'Your Medicare', now: er.medicare }, ...(er.futa > 0 ? [{ label: 'Federal unemployment', now: er.futa }] : []),
                ...(er.sui > 0 ? [{ label: `${stateName} unemployment`, now: er.sui }] : []), ...(er.other || []).filter((x: any) => x.amount > 0).map((x: any) => ({ label: x.name, now: x.amount }))],
              note: `Earned this year: $${st.ytd.earned.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}.${w.inHand > 0 ? ' Everything you earned is taxed, the cash tips you took home too.' : ''}` };
      });
  }, [checksOpen, selectedTenant, checkPeople, selfTaxes, methodsNow, staff, periodKey, payDate, yearRuns, stateName, payFromYmd, payToYmd]); // eslint-disable-line react-hooks/exhaustive-deps
  const checkSetup: any = (selectedTenant as any)?.payrollTax || {};
  // (Saved by the server, for anyone who runs payroll: api/payroll/forms.)
  const payrollForms = async (body: any) => { const r: any = await fetch('/api/payroll/forms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, ...body }) }).then((x) => x.json()).catch(() => null); return r; };
  // Pay between paydays (a bonus): recorded the same way as payday, on its own day and key (api/payroll/record).
  const [bonusOpen, setBonusOpen] = useState(false);
  // (Someone who's left too: a last paycheck.)
  const bonusPeople = useMemo(() => (staff || []).filter((m: any) => m.isRenter !== true)
      .map((m: any) => ({ id: String(m.id), name: String(m.name || 'Team member'), contractor: m.employmentType === 'contractor', forms: m.taxForms || null, left: m.archived === true }))
      .sort((a: any, b: any) => Number(a.left) - Number(b.left) || a.name.localeCompare(b.name)), [staff]);
  const recordBonus = async (body: BonusBody): Promise<string | null> => {
      if (!tenantId) return 'Not recorded. Try again.';
      const res = await fetch('/api/payroll/record', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, ...body }) }).catch(() => null);
      const r: any = res ? await res.json().catch(() => ({})) : {};
      if (r?.code === 'payroll_terms') setTermsAgreedFor(null);
      if (!res || !res.ok || !r?.ok) return r?.error || 'Not recorded. Nothing was added to your books. Try again.';
      const who = body.people[0]; const day = new Date(`${body.offCycle.date}T12:00:00`).toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
      toast({ title: body.offCycle.supplemental || who.contractor ? 'Bonus recorded' : 'Pay recorded', description: r.taxes
          ? `${who.name}’s ${fmtCurrency(who.amount)}, paid ${day}, is in your books with ${fmtCurrency(r.taxes.employer)} in employer payroll taxes. ${fmtCurrency(r.taxes.owed)} in payroll taxes is kept to pay later.`
          : `${who.name}’s ${fmtCurrency(who.amount)}, paid ${day}, is in your books.` });
      return null;
  };
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
    if (!firestore || !tenantId || recorded || adjustmentsError) return;
    // Recorded on the server (api/payroll/record, lib/payday-record): once per pay period, the team's pay as one line for
    // employees, one for contractors and one for cash tips taken home (who was paid what is kept where only payroll
    // reads it), and pay the bank already booked from a payroll company isn't booked again.
    const people = staffObligations.filter(o => o.amount > 0 || cashLineOf(o) > 0)
        .map(o => { const m = methodsNow[o.id]; return { staffId: o.id, name: o.name, amount: Math.round(o.amount * 100) / 100, cash: cashLineOf(o), contractor: !!o.contractor,
            ...(selfRunOn && m ? { method: m.method, ...(m.method === 'check' && m.checkNo ? { checkNo: m.checkNo } : {}) } : {}),
            tips: Math.round(((Number(o.tips) || 0) + (Number(o.cashTips) || 0)) * 100) / 100,
            // (Hours, when the time clock has them: the tip credit's minimum wage test, lib/tip-credit.)
            ...(!o.noHours && Number(o.hours) > 0 ? { hours: Math.round(Number(o.hours) * 100) / 100 } : {}),
            // (The overtime the federal law requires, for the W-2's code TT: lib/pay-period, lib/payroll-yearend.)
            ...(Number(o.line?.qualifiedOvertime) > 0 ? { otQualified: Math.round(Number(o.line.qualifiedOvertime) * 100) / 100,
              ...(Number(o.line?.qualifiedOvertime7i) > 0 ? { otMaybeExempt: Math.round(Number(o.line.qualifiedOvertime7i) * 100) / 100 } : {}) } : {}) }; });
    const setAsides = suggestions.filter(b => b.amount > 0 && b.key !== 'opex').map(b => ({ key: b.key, label: b.label, amount: Number(b.amount.toFixed(2)) }));
    if (!people.length && !setAsides.length) return;
    setIsSubmitting(true);
    try {
        const res = await fetch('/api/payroll/record', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tenantId, periodKey, from: payFromYmd, to: payToYmd, people, setAsides, ...(selfRun?.stale?.ok ? { staleOk: true } : {}) }) });
        const r: any = await res.json().catch(() => ({}));
        if (res.status === 409) {
            toast({ title: 'Payday for these dates is already in your books', description: 'Nothing was added twice.' });
            if (r?.recorded) setRecorded(r.recorded); else recordedFor().then(x => setRecorded(x)).catch(() => {});
            return;
        }
        if (r?.code === 'payroll_terms') setTermsAgreedFor(null);
        if (!res.ok || !r?.ok) { toast({ variant: 'destructive', title: 'Payday wasn’t recorded', description: r?.error || 'Nothing was added to your books. Try again.' }); return; }
        setRecorded({ on: String(r.recordedAt || new Date().toISOString()), from: payFromYmd, to: payToYmd });
        const viaBank = Number(r.viaBankCents) || 0;
        if (r.taxes) toast({ title: 'Payday recorded', description: `Each person’s pay and ${fmtCurrency(r.taxes.employer)} in employer payroll taxes are in your books. ${fmtCurrency(r.taxes.owed)} in payroll taxes is kept to pay later, and each pay stub shows what was withheld.` });
        else toast({ title: 'Payday recorded', description: viaBank > 0
            ? `Your bank already shows ${fmtCurrency(viaBank / 100)} paid through your payroll company for these dates, so the team’s pay wasn’t added twice. Contractors, cash tips and the set-asides are in your books.`
            : 'The team’s pay and the set-asides are in your books.' });
        setAllocationAmount(0);
        markDraftApproved();
    } catch (e: any) {
        console.error('Payday not recorded:', e);
        toast({ variant: 'destructive', title: 'Payday wasn’t recorded', description: 'Nothing was added to your books. Try again.' });
    } finally {
        setIsSubmitting(false);
    }
  };

  // ── Gusto: build the payroll draft from this period's obligations and
  // submit it. Gusto handles exact taxes, withholdings, deposits & filings.
  const handleApprovePayroll = async () => {
    // (Employees with pay for these dates only: contractors aren't on the employee payroll.)
    const payees = employees.filter(o => o.earned > 0);
    if (payees.length === 0 || !tenantId || adjustmentsError || gustoUnmatched.length) return;
    setIsSubmittingPayroll(true);
    try {
        const draft: GustoPayrollDraft & { periodEndDay: string; periodStartDay: string } = {
            tenantId,
            periodStart: dateRange.from.toISOString(),
            periodEnd: dateRange.to.toISOString(),
            periodStartDay: dayFrom, periodEndDay: dayTo,
            lines: payees.map(o => ({
                staffId: o.id,
                name: o.name,
                payStructure: o.payStructure,
                regularHours: Number(((o as any).regularHours || 0).toFixed(2)),
                overtimeHours: Number(((o as any).overtimeHours || 0).toFixed(2)),
                doubleOvertimeHours: Number(((o as any).doubleOvertimeHours || 0).toFixed(2)),
                commission: Number(((o as any).commissionPay || 0).toFixed(2)),   // commission, per service pay and extras (hours are paid from regularHours)
                tips: Number((o.tips || 0).toFixed(2)),                       // paycheck tips
                cashTips: Number((o.cashTips || 0).toFixed(2)),               // cash tips they took home: reported, not paid again
                bonus: Number(((o as any).bonus || 0).toFixed(2)),   // overtime on commission / per service pay + minimum-wage top-ups + approved corrections
                reimbursements: 0,
                deductions: 0,
            })),
            grossTotal: Number(payees.reduce((n, o) => n + o.amount, 0).toFixed(2)),
            estimatedEmployerTaxes: Number(employerTaxes.toFixed(2)),
        };
        const result = await submitGustoPayroll(draft);
        const people = `${payees.length} ${payees.length === 1 ? 'person' : 'people'}`;
        if (result.status === 'submitted' || result.status === 'processing') {
            toast({ title: 'Payroll sent to Gusto', description: `${people}. Gusto works out the taxes and withholding and sends the deposits.` });
            markDraftApproved();
            writeAudit(firestore, tenantId, {
                action: 'payroll.submit_gusto', targetType: 'payroll',
                summary: `Sent payroll to Gusto: ${people}, ${fmtCurrency(draft.grossTotal)} in pay, about ${fmtCurrency(employerTaxes)} in payroll taxes`,
                amount: draft.grossTotal, actor: auditActor,
            });
        } else if (result.status === 'synced_not_submitted') {
            toast({ title: 'The numbers are in Gusto', description: 'Gusto didn’t let the app press Submit. Open Gusto and submit this payroll there: everything is filled in.' });
            markDraftApproved();
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

  // The pay period for another payroll company (lib/payroll-export): each employee's hours and pay as Gusto is sent it,
  // then the contractors.
  const handleExport = () => {
      if (adjustmentsError) return;
      const emailOf = (id: string) => String((staff || []).find((m: any) => m.id === id)?.email || '');
      const rows = payrollExportRows(staffObligations.map((o: any) => ({ name: o.name, email: emailOf(o.id), contractor: !!o.contractor, payStructure: o.payStructure,
          regularHours: o.regularHours, overtimeHours: o.overtimeHours, doubleOvertimeHours: o.doubleOvertimeHours, commission: o.commissionPay, bonus: o.bonus,
          salary: o.line?.salaryPay, tips: o.tips, cashTips: o.cashTips, adjustments: o.adjustments, amount: o.amount, hours: o.hours, earned: o.earned })), { from: dayFrom, to: dayTo, payday: !custom && period ? period.payday : null });
      downloadCsv(csvName(String((selectedTenant as any)?.name || ''), 'payroll', `${dayFrom} to ${dayTo}`), rows);
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
        from={new Date(`${dayFrom}T00:00:00`)} to={new Date(`${dayTo}T00:00:00`)}
        payday={!custom && period ? new Date(`${period.payday}T00:00:00`) : null} cadenceWords={cadenceWords(selectedTenant)} settingsHref="/settings?tab=timeclock"
        onEarlier={handlePrevPeriod} onLater={handleNextPeriod}
        custom={!!custom} onPickDates={handlePickDates}
        onFirstDay={(v) => { if (/^\d{4}-\d{2}-\d{2}$/.test(v)) setCustom(c => ({ from: v, to: c && c.to >= v ? c.to : v })); }}
        onLastDay={(v) => { if (/^\d{4}-\d{2}-\d{2}$/.test(v)) setCustom(c => ({ from: c && c.from <= v ? c.from : v, to: v })); }}
        cameIn={currentBalance}
        team={staffObligations} teamTotal={staffTotalOwed} employerTaxes={selfTaxes ? selfTaxes.employerTotal : employerTaxes} cashTipsOut={cashTipsOut}
        runBy={runBy} selfRun={selfRun} owed={owed}
        askRunBy={selectedTenant && !runByChosen(selectedTenant) && !gusto.connected ? { onPick: String(payRole || '').toLowerCase() === 'owner' && firestore && tenantId ? (v) => updateDocumentNonBlocking(doc(firestore, 'tenants', tenantId), { 'payrollTax.runBy': v }) : undefined } : null}
        blocked={adjustmentsError ? 'Approved pay corrections couldn’t be read with your access, so payday can’t be recorded or sent from here. The owner can do it.' : null}
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
        onSendToGusto={handleApprovePayroll} sendingToGusto={isSubmittingPayroll} gustoUnmatched={gustoUnmatched} onExport={staffObligations.length ? handleExport : undefined}
        gustoSlot={gusto.connected && runBy === 'gusto' ? <GustoMatchCard companyName={gusto.companyName} loading={gustoLoading} error={gustoError} busy={gustoBusy} gusto={gustoPeople}
          team={(staff || []).filter((m: any) => m.isRenter !== true && m.archived !== true).map((m: any) => ({ id: m.id, name: String(m.name || 'Team member'), contractor: m.employmentType === 'contractor', hasPay: staffObligations.some((o) => o.id === m.id && o.earned > 0) }))}
          onMatch={matchGusto} onLookAgain={() => { void loadGusto(); }} runs={gustoRuns} onCheckRun={checkRun} /> : null}
        autoDraft={autoDraftEnabled} onAutoDraft={handleAutoDraftToggle}
        draft={pendingDraft ? (() => { const dp = draftPeriod(pendingDraft); return { from: new Date(`${dp.from}T00:00:00`), to: new Date(`${dp.to}T00:00:00`), people: pendingDraft.lines?.length || 0, gross: Number(pendingDraft.grossTotal || 0), taxes: Number(pendingDraft.estimatedEmployerTaxes || 0) }; })() : null}
        onOpenDraft={() => {
          if (!pendingDraft || !selectedTenant) return;
          // (A draft is for one of the business's pay periods: it opens that period. An older one, from its dates.)
          if (pendingDraft.periodKey) { setCustom(null); setPeriod(periodOf(selectedTenant, String(pendingDraft.periodKey))); }
          else { const dp = draftPeriod(pendingDraft); setCustom({ from: dp.from, to: dp.to }); }
        }}
        setAside={allocationAmount} onSetAside={setAllocationAmount} parts={suggestions}
        onRecord={handleConfirmDistributions} recording={isSubmitting} recordedOn={recorded ? safeDate(recorded.on) : null}
        recordedSpan={recorded && (recorded.from !== payFromYmd || recorded.to !== payToYmd) ? spanWords(new Date(`${recorded.from}T00:00:00`), new Date(`${recorded.to}T00:00:00`)) : null}
        statementFor={statementFor} onStatement={setStatementFor}
        statement={(o) => tenantId ? <PayStatement tenantId={tenantId} staffId={o.id} from={dateRange.from.toISOString()} to={dateRange.to.toISOString()} title={`${o.name}, pay statement`} /> : null}
        onSeeBills={onNavigate ? () => { onNavigate('bills'); if (typeof window !== 'undefined') window.scrollTo({ top: 0 }); } : undefined}
        onBonus={selfRunOn && termsOk && !adjustmentsError ? () => setBonusOpen(true) : undefined}
        terms={selfRunOn && selectedTenant && !termsOk ? { terms: payrollTerms(hasTaxLocation ? stateProfile.name : '', hasTaxLocation && NO_WAGE_TAX.includes(String(taxState))), href: PAYROLL_TERMS_HREF, business: String((selectedTenant as any)?.name || 'your business'), also: PAYROLL_TERMS_ALSO,
          onAgree: canAgreeFor({ role: payRole }) && tenantId ? async () => {
            const r: any = await payrollForms({ action: 'agreeTerms', version: PAYROLL_TERMS_VERSION });
            if (!r?.ok) return r?.error || 'Not saved. Try again.';
            setTermsAgreedFor(tenantId); toast({ title: 'Agreed', description: 'Payroll can be run here now. Have your accountant check your first payday.' }); return null;
          } : undefined } : null}
        onPrintChecks={selfRunOn ? () => setChecksOpen(true) : undefined} checks={checkPeople.length}
      />
      {formsPerson && <TaxFormsDialog open={!!formsFor} onOpenChange={(o) => { if (!o) setFormsFor(null); }} name={String(formsPerson.name || 'Team member')} forms={formsPerson.taxForms || null}
        state={taxState} stateName={stateName} onSave={saveForms} notReady={!!tenantId && !payOverlayReady(tenantId)} />}
      {selfRunOn && selectedTenant && <BonusDialog open={bonusOpen} onOpenChange={setBonusOpen} people={bonusPeople} tenant={selectedTenant} runs={yearRuns || []}
        state={taxState || null} stateName={stateName} today={todayBiz} onRecord={recordBonus}
        onCheck={async (body, w, win) => {
            // (Numbered by the server onto the run just recorded; the amounts as recorded; its stub's year so far as the
            // pay stub's.)
            const who = body.people[0]; const fail = (e?: string) => { win?.close(); toast({ variant: 'destructive', title: 'The check wasn’t printed', description: `${e ? `${e} ` : ''}The pay is recorded: write this check by hand, ${fmtCurrency(w ? w.takeHome : who.amount)} to ${who.name}.` }); };
            try {
            const r = await payrollForms({ action: 'checkNumbers', count: 1, first: who.checkNo || '', periodKey: body.periodKey, people: [who.staffId] });
            if (!r?.ok || !selectedTenant || !firestore) { fail(r?.error); return; }
            const kept: any = (await getDoc(doc(firestore, `tenants/${tenantId}/payrollRuns/payday_${body.periodKey}`)).catch(() => null))?.data()?.people?.find((x: any) => x?.staffId === who.staffId);
            if (kept?.taxes) w = { ...kept.taxes, takeHome: Number(kept.takeHome) || 0 };
            const d = body.offCycle.date; const r2 = (n: number) => Math.round(n * 100) / 100;
            const paidOn = new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
            const run = { kind: 'payday', runBy: 'clarityflow', periodKey: body.periodKey, payDate: d, from: d, to: d, offCycle: true, people: w ? [{ staffId: who.staffId, taxes: w, takeHome: w.takeHome }] : [] };
            const m: any = (staff || []).find((x: any) => x.id === who.staffId);
            const st = w ? stubTaxes({ tenant: selectedTenant, staffId: who.staffId, periodKey: body.periodKey, payDate: d, runs: [...(yearRuns || []), run], forms: m?.taxForms || null, gross: w.gross, inHand: 0, stateName }) : null;
            const label = body.offCycle.supplemental || who.contractor ? 'Bonus' : 'Pay';
            const c: CheckData = { no: String(r.numbers[0]), date: d, payee: who.name, amount: w ? w.takeHome : r2(who.amount), memo: label === 'Bonus' ? 'Bonus' : 'Pay between paydays', span: `${label}, paid ${paidOn}`,
              earned: [{ label, now: r2(who.amount) }], taxes: st ? st.lines.map((l) => ({ label: l.label, now: l.amount, year: l.ytd })) : [],
              employer: w ? [{ label: 'Your Social Security', now: w.employer.socialSecurity }, { label: 'Your Medicare', now: w.employer.medicare }, ...(w.employer.futa > 0 ? [{ label: 'Federal unemployment', now: w.employer.futa }] : []),
                ...(w.employer.sui > 0 ? [{ label: `${stateName} unemployment`, now: w.employer.sui }] : []), ...w.employer.other.filter((x) => x.amount > 0).map((x) => ({ label: x.name, now: x.amount }))] : [],
              ...(st ? { note: `Earned this year: $${st.ytd.earned.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}.` } : {}) };
            const html = checksHtml({ business: { name: String((selectedTenant as any)?.name || ''), lines: addressLines((selectedTenant as any)?.address) }, checks: [c],
              layout: (checkSetup.checkLayout === 'middle' ? 'middle' : 'top') as CheckLayout, nudge: { x: Number(checkSetup.checkNudge?.x) || 0, y: Number(checkSetup.checkNudge?.y) || 0 } });
            if (win) { win.document.open(); win.document.write(html); win.document.close(); win.focus(); }
            } catch { fail(); }
        }} />}
      {selfRunOn && selectedTenant && <PrintChecksDialog open={checksOpen} onOpenChange={setChecksOpen} title={`${payDate ? new Date(`${payDate}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' }) : 'This'} payday`}
        checks={checks} business={{ name: String((selectedTenant as any)?.name || ''), lines: addressLines((selectedTenant as any)?.address) }}
        layout={(checkSetup.checkLayout === 'middle' ? 'middle' : 'top') as CheckLayout} nudge={{ x: Number(checkSetup.checkNudge?.x) || 0, y: Number(checkSetup.checkNudge?.y) || 0 } as Nudge} nextNo={checkSetup.nextCheckNo ? String(checkSetup.nextCheckNo) : ''}
        onSettings={(s) => { void payrollForms({ action: 'checkSettings', layout: s.layout, nudge: s.nudge }); }}
        onNumbers={async (count, first) => {
            const r = await payrollForms({ action: 'checkNumbers', count, first, people: checks.map((c) => c.id), ...(recordedRun ? { periodKey } : {}) });
            if (!r?.ok || !Array.isArray(r.numbers)) return r?.error || 'Not printed. Try again.';
            // (Before payday is recorded, the numbers go with it when it is; after, they're on the payday already.)
            if (!recordedRun) setMethods((cur) => { const out = { ...cur }; checks.forEach((c, i) => { out[c.id] = { method: 'check', checkNo: r.numbers[i] }; }); return out; });
            return r.numbers as string[]; }} />}
      {selfRunOn && selectedTenant && yeYear && <YearEndDialog open={!!yearEndAt} onOpenChange={(o) => { if (!o) setYearEndAt(null); }} runs={yearRuns || []} tenant={selectedTenant}
        year={yeYear} today={todayBiz} businessName={String((selectedTenant as any)?.name || '')} tab={yearEndAt?.tab} person={yearEndAt?.person}
        onGiveW2s={async (year, given) => { const r = await payrollForms({ action: 'giveW2s', year, given }); return r?.ok ? null : (r?.error || 'Not saved. Try again.'); }}
        onTtoc={async (staffId, code, notListed) => { const r = await payrollForms({ action: 'ttoc', staffId, code, notListed }); return r?.ok ? null : (r?.error || 'Not saved. Try again.'); }}
        onOtBackfill={async (year) => { const r: any = await payrollForms({ action: 'otBackfill', year });
          if (!r?.ok) return { error: r?.error || 'That didn’t go through. Try again: what’s done is kept.' };
          return { note: r.left ? `Worked out ${r.paydays}. ${r.left} more to go: tap again.` : `Worked out ${r.paydays} payday${r.paydays === 1 ? '' : 's'}.` }; }} />}
      {selfRunOn && selectedTenant && <PayrollFormsDialog open={taxFormsOpen} onOpenChange={setTaxFormsOpen} runs={yearRuns || []} tenant={selectedTenant} state={taxState || null} today={todayBiz} businessName={String((selectedTenant as any)?.name || '')} />}
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

type HubTab = 'overview' | 'ledger' | 'bank' | 'payday' | 'bills' | 'writeoffs' | 'taxes' | 'reports' | 'activity';

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
  { key: 'writeoffs', label: 'Write-offs' },
  { key: 'taxes',    label: 'Taxes' },
  { key: 'reports',  label: 'Reports' },
  { key: 'activity', label: 'Activity' },
];

const VALID_TABS: HubTab[] = ['overview', 'ledger', 'bank', 'payday', 'bills', 'writeoffs', 'taxes', 'reports', 'activity'];

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
  const { selectedTenant: hubTenant, role: hubRole, can } = useTenant();
  const hubTenantId = hubTenant?.id;
  // Who sees what: the owner and anyone whose role includes the books see every tab; someone who only runs payroll (a
  // manager, by default) sees Payday.
  // (Payday only with payroll: it works out each person's pay, which the books alone don't show.)
  const seesAll = can('money.view'); const pays = can('money.payroll'); const paysOnly = !seesAll && pays;
  // (Booking a personal-account line as the business's, from Write-offs, names who did it, as the Bank tab does.)
  const writeOffsActor = useAuditActor();
  // (Taxes is the owner's own: their tax set-aside, about their own return.)
  const isOwner = hubRole === 'owner';
  const tabs = seesAll ? HUB_TABS.filter((t) => (t.key !== 'payday' || pays) && (t.key !== 'taxes' || isOwner)) : paysOnly ? HUB_TABS.filter((t) => t.key === 'payday') : [];
  const [latestAuditAt, setLatestAuditAt] = useState<string | null>(null);
  const [seenAuditAt, setSeenAuditAt] = useState<string | null>(null);
  useEffect(() => {
    if (!hubFirestore || !hubTenantId || !seesAll) return;
    const q = query(collection(hubFirestore, `tenants/${hubTenantId}/auditLogs`), orderBy('at', 'desc'), limit(1));
    const unsub = onSnapshot(q,
      snap => setLatestAuditAt((snap.docs[0]?.data() as any)?.at || null),
      () => { /* non-fatal */ });
    return () => unsub();
  }, [hubFirestore, hubTenantId, seesAll]);
  useEffect(() => {
    if (latestAuditAt && seenAuditAt === null) setSeenAuditAt(latestAuditAt);       // baseline on load
    if (activeTab === 'activity' && latestAuditAt) setSeenAuditAt(latestAuditAt);   // viewing clears it
  }, [latestAuditAt, seenAuditAt, activeTab]);
  const hasNewActivity = !!latestAuditAt && !!seenAuditAt && latestAuditAt !== seenAuditAt && activeTab !== 'activity';

  const handleTabChange = (tab: HubTab) => {
    if (tab === 'payday' && !pays) return;
    if (tab === 'taxes' && !isOwner) return;
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
    if (!hubFirestore || !hubTenantId || !seesAll) return; let on = true;
    const count = () => getCountFromServer(query(collection(hubFirestore, `tenants/${hubTenantId}/bankTransactions`), where('status', '==', 'unmatched')))
      .then((x: any) => { if (on) setBankWaiting(x.data().count); }).catch(() => {});
    count(); const vis = () => { if (document.visibilityState === 'visible') count(); };
    document.addEventListener('visibilitychange', vis);
    return () => { on = false; document.removeEventListener('visibilitychange', vis); };
  }, [hubFirestore, hubTenantId, activeTab, seesAll]);
  // (Someone who only runs payroll lands on Payday, whatever the address asked for.)
  useEffect(() => { if (paysOnly && activeTab !== 'payday') handleTabChange('payday'); }, [paysOnly, activeTab]); // eslint-disable-line react-hooks/exhaustive-deps

  const tenantId = hubTenantId;
  if (hubRole && !seesAll && !paysOnly) return (
    <div className="flex min-h-screen w-full flex-col" style={{ background: '#f5f5f7' }}>
      <AppHeader title="Money" />
      <main className="flex flex-1 items-center justify-center px-6"><p className="max-w-sm text-center text-[15px]" style={{ color: '#6d7075' }}>Money is for the owner and people whose role includes the books or payroll.</p></main>
    </div>
  );
  return (
    <div className="flex min-h-screen w-full flex-col overflow-x-hidden" style={{ background: '#f5f5f7' }}>
      <AppHeader title="Money" />

      <nav aria-label="Money" className="sticky top-0 z-30 border-b px-4 py-2.5 backdrop-blur" style={{ background: 'rgba(245,245,247,0.94)', borderColor: '#ececee' }}>
        <div className="mx-auto flex max-w-[1180px] gap-1.5 overflow-x-auto md:px-2">
          {tabs.map(({ key, label }) => (
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
        {seesAll && visitedTabs.has('overview') && <div className={cn(activeTab !== 'overview' && 'hidden')}>
          <MoneyOverview bankCount={bankWaiting} onNavigate={(t) => handleTabChange(t as HubTab)} more={tenantId ? <>
            {isOwner && <OwnerTaxDueCard tenantId={tenantId} onOpen={() => handleTabChange('taxes')} />}
            <MonthCloseCard tenantId={tenantId} />
            <AppPayoutsCard tenantId={tenantId} />
            <MilesCard tenantId={tenantId} />
            <RestockingFundCard tenantId={tenantId} />
            <TipShareCard tenantId={tenantId} mode={String((hubTenant as any)?.tipSharing?.mode || 'direct')} period={(hubTenant as any)?.tipSharing?.period === 'week' ? 'week' : 'day'} />
          </> : null} />
        </div>}
        {seesAll && visitedTabs.has('ledger')   && <div className={cn(activeTab !== 'ledger'   && 'hidden')}><LedgerTab /></div>}
        {seesAll && visitedTabs.has('bank')     && <div className={cn(activeTab !== 'bank'     && 'hidden')}><BankTab /></div>}
        {pays && visitedTabs.has('payday')   && <div className={cn(activeTab !== 'payday'   && 'hidden')}><PaydayTab onNavigate={seesAll ? handleTabChange : undefined} /></div>}
        {seesAll && visitedTabs.has('bills')    && <div className={cn(activeTab !== 'bills'    && 'hidden')}><BillsTab /></div>}
        {isOwner && visitedTabs.has('taxes') && tenantId && <div className={cn(activeTab !== 'taxes' && 'hidden')}><OwnerTaxes tenantId={tenantId} onWriteOffs={() => handleTabChange('writeoffs')} /></div>}
        {seesAll && visitedTabs.has('writeoffs') && tenantId && <div className={cn(activeTab !== 'writeoffs' && 'hidden')}><WriteOffsScreen tenantId={tenantId} canLog={can('money.manage')} business={String((hubTenant as any)?.name || '')} actor={writeOffsActor} /></div>}
        {seesAll && visitedTabs.has('reports')  && <div className={cn(activeTab !== 'reports'  && 'hidden')}><ReportsTab /></div>}
        {seesAll && visitedTabs.has('activity') && <div className={cn(activeTab !== 'activity' && 'hidden')}><ActivityTab onNavigate={handleTabChange} /></div>}
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
