'use client';

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
} from 'date-fns';
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import {
  getStateProfile, suggestedAllocation, estimateEmployerPayrollTax,
  STATE_OPTIONS, GENERIC_US_PROFILE, RATES_VINTAGE, ratesAreStale,
} from '@/lib/state-tax-profiles';
import { COUNTRY_OPTIONS, getCountryOption } from '@/lib/tax-jurisdictions';
import { auditEntry } from '@/lib/audit';
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
import { useFirebase, useUser, addDocumentNonBlocking, updateDocumentNonBlocking } from '@/firebase';
import { resolveActiveStaffId } from '@/lib/staff-identity';
import { AddTransactionDialog } from '@/components/ledger/AddTransactionDialog';
import { BadDebtAgingCard } from '@/components/ledger/BadDebtAgingCard';
import { useToast } from '@/hooks/use-toast';
import { useTenant } from '@/context/TenantContext';
import { BankFeedSection } from '@/components/shared/BankFeedSection';
import { useInventory } from '@/context/InventoryContext';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useIsMobile } from '@/hooks/use-mobile';
import { collection, doc, writeBatch, increment, arrayUnion, getDoc, getDocs, query, where, onSnapshot, orderBy, limit } from 'firebase/firestore';
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

// ─── Sparkline ────────────────────────────────────────────────────────────────
// Minimal inline SVG bar chart showing daily revenue over the period.

const Sparkline = ({ data, color = '#22c55e' }: { data: number[]; color?: string }) => {
  if (!data.length) return null;
  const max = Math.max(...data, 1);
  const W = 120;
  const H = 32;
  const barW = Math.max(2, Math.floor((W - data.length) / data.length));
  const gap = Math.floor((W - barW * data.length) / Math.max(data.length - 1, 1));

  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="shrink-0 opacity-70">
      {data.map((v, i) => {
        const barH = Math.max(2, Math.round((v / max) * H));
        const x = i * (barW + gap);
        return (
          <rect
            key={i}
            x={x} y={H - barH}
            width={barW} height={barH}
            rx={1}
            fill={v === 0 ? '#e5e7eb' : color}
          />
        );
      })}
    </svg>
  );
};

// ─── KPI Stat Card ────────────────────────────────────────────────────────────

const StatCard = ({
  label, value, sub, trend, trendLabel, icon: Icon, accent, sparkData,
}: {
  label: string;
  value: string;
  sub?: string;
  trend?: 'up' | 'down' | 'flat';
  trendLabel?: string;
  icon: React.ElementType;
  accent: string;
  sparkData?: number[];
}) => {
  const TrendIcon = trend === 'up' ? ArrowUpRight : trend === 'down' ? ArrowDownRight : Minus;
  const trendColor = trend === 'up' ? 'text-green-600' : trend === 'down' ? 'text-red-500' : 'text-slate-400';

  return (
    <Card className="border-2 shadow-sm rounded-3xl overflow-hidden bg-white">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className={cn('p-2.5 rounded-2xl', accent)}>
            <Icon className="w-4 h-4" />
          </div>
          {sparkData && sparkData.length > 1 && (
            <Sparkline data={sparkData} color={trend === 'down' ? '#ef4444' : '#22c55e'} />
          )}
        </div>
        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground opacity-60 mb-1">{label}</p>
        <p className="text-2xl font-black font-mono tracking-tighter text-slate-900 leading-none">{value}</p>
        {(sub || trendLabel) && (
          <div className="flex items-center gap-1.5 mt-2">
            {trend && <TrendIcon className={cn('w-3 h-3', trendColor)} />}
            <p className={cn('text-[10px] font-bold uppercase tracking-widest', trendLabel ? trendColor : 'text-muted-foreground opacity-60')}>
              {trendLabel || sub}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

// ─── Color system (unchanged from original) ───────────────────────────────────

const TAX_BUCKET_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  'revenue':        { bg: '#dcfce7', text: '#166534', label: 'Revenue' },
  'gratuity':       { bg: '#fef9c3', text: '#854d0e', label: 'Gratuity' },
  'tax_collected':  { bg: '#f1f5f9', text: '#475569', label: 'Tax' },
  'adjustment':     { bg: '#dbeafe', text: '#1e40af', label: 'Adjustment' },
  'refund':         { bg: '#fee2e2', text: '#991b1b', label: 'Refund' },
  'processing_fee': { bg: '#ede9fe', text: '#5b21b6', label: 'Processing Fee' },
  'operating_cost': { bg: '#fff7ed', text: '#92400e', label: 'Operating Cost' },
  // v59 — color audit: Money Hub introduced Payroll payouts, Profit First
  // distributions (taxBucket 'transfer'), and Bill payments. Without these
  // entries they fell through to random hash-picked pastels in the print
  // report and legend — now semantically colored and auto-legended.
  'payroll':        { bg: '#e0f2fe', text: '#075985', label: 'Payroll' },
  'transfer':       { bg: '#ccfbf1', text: '#115e59', label: 'Transfer' },
};

const CATEGORY_TO_BUCKET: Record<string, string> = {
  'Service Revenue': 'revenue', 'Retail': 'revenue', 'Retail Product': 'revenue',
  'Membership Sales': 'revenue', 'Package Sales': 'revenue', 'Hospitality Revenue': 'revenue',
  'Card Processing Fee': 'revenue',
  'Tips': 'gratuity',
  'Tax Collected': 'tax_collected',
  'Discounts': 'adjustment', 'Protocol Recovery': 'adjustment', 'Strategic Adjustment': 'adjustment',
  'Fee Recovery': 'adjustment', 'Adjustment Fee': 'adjustment', 'Cancellation Fee': 'adjustment',
  'Deposit Applied': 'adjustment',
  'Refunds': 'refund', 'Void': 'refund',
  'Processing Fee': 'processing_fee',
  'Supplies': 'operating_cost', 'Cost of Goods Sold': 'operating_cost', 'Spoilage': 'operating_cost',
  'Payroll': 'payroll', 'Distribution': 'transfer', 'Bills': 'operating_cost',
};

const PRINT_CATEGORY_COLORS: Record<string, { bg: string; text: string; label: string }> = TAX_BUCKET_COLORS;

const AUTO_PALETTE = [
  { bg: '#fef3c7', text: '#92400e' }, { bg: '#d1fae5', text: '#065f46' },
  { bg: '#e0e7ff', text: '#3730a3' }, { bg: '#fce7f3', text: '#9d174d' },
  { bg: '#cffafe', text: '#164e63' }, { bg: '#fef9c3', text: '#713f12' },
  { bg: '#f0fdf4', text: '#14532d' }, { bg: '#fdf4ff', text: '#701a75' },
];
const hashStr = (s: string) => s.split('').reduce((a, c) => ((a << 5) - a + c.charCodeAt(0)) | 0, 0);
const getCatStyle = (cat: string, taxBucket?: string) => {
  const bucket = taxBucket || CATEGORY_TO_BUCKET[cat];
  if (bucket && PRINT_CATEGORY_COLORS[bucket]) return PRINT_CATEGORY_COLORS[bucket];
  if (PRINT_CATEGORY_COLORS[cat]) return PRINT_CATEGORY_COLORS[cat];
  const palette = AUTO_PALETTE[Math.abs(hashStr(cat)) % AUTO_PALETTE.length];
  return { ...palette, label: cat };
};

const sessionRefNum = (sid: string) => `REF-${sid.slice(-6).toUpperCase()}`;
const txnRefNum     = (id: string)  => `TXN-${id.slice(-6).toUpperCase()}`;
const FEE_CATEGORIES = new Set(['Processing Fee']);

// ─── buildPrintHtml (unchanged from original) ─────────────────────────────────

function buildPrintHtml(
  transactions: Transaction[],
  staff: Staff[],
  summary: {
    revenue: number; cogs: number; grossProfit: number; operatingExpenses: number; net: number;
    processingFeesPaid: number; processingFeesCollected: number; netFeeImpact: number;
    taxLiability: number;
  },
  dateRange: DateRange | undefined,
) {
  const staffInfo = (id?: string) => {
    const s = id ? staff.find((s: Staff) => s.id === id) : null;
    return { name: s?.name || '—', avatar: (s as any)?.avatarUrl || '', initials: (s?.name || '?').split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase() };
  };
  const staffName = (id?: string) => staffInfo(id).name;
  const staffChip = (id?: string) => {
    const { name, avatar, initials } = staffInfo(id);
    if (name === '—') return '—';
    const firstName = name.split(' ')[0];
    const imgTag = avatar
      ? `<img src="${avatar}" style="width:18px;height:18px;border-radius:4px;object-fit:cover;vertical-align:middle;margin-right:4px;" />`
      : `<span style="display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:4px;background:#e0e7ff;color:#3730a3;font-size:7px;font-weight:900;vertical-align:middle;margin-right:4px;">${initials}</span>`;
    return `${imgTag}<span style="vertical-align:middle;font-size:10px;color:#374151;">${firstName}</span>`;
  };
  const fmtD = (d: any, s: string) => { try { return format(new Date(d), s); } catch { return '—'; } };
  const periodLabel = dateRange?.from && dateRange?.to
    ? `${format(dateRange.from, 'MMM d, yyyy')} – ${format(dateRange.to, 'MMM d, yyyy')}`
    : 'All Dates';

  const sessionMap = new Map<string, Transaction[]>();
  const ungrouped: Transaction[] = [];
  transactions.forEach(t => {
    const sid = (t as any).checkoutSessionId;
    if (sid) { if (!sessionMap.has(sid)) sessionMap.set(sid, []); sessionMap.get(sid)!.push(t); }
    else ungrouped.push(t);
  });

  const sessions = Array.from(sessionMap.entries()).map(([sid, txns]) => {
    const first    = txns[0];
    const income   = txns.filter(t => t.type === 'income');
    const expense  = txns.filter(t => t.type === 'expense');
    const feeTxns       = expense.filter(t => FEE_CATEGORIES.has(t.category));
    const realExpense    = expense.filter(t => !FEE_CATEGORIES.has(t.category));
    const stripeFeeTotal = feeTxns.reduce((s, t) => s + t.amount, 0);
    const tax      = income.find(t => t.category === 'Tax Collected')?.amount || 0;
    const tips     = income.filter(t => t.category === 'Tips').reduce((s, t) => s + t.amount, 0);
    const cardFeeCollected = income.filter(t => t.category === 'Card Processing Fee').reduce((s, t) => s + t.amount, 0);
    const discounts= realExpense.filter(t => ['Discounts','Refunds'].includes(t.category)).reduce((s, t) => s + t.amount, 0);
    const subtotal = income.filter(t => !['Tax Collected','Tips','Card Processing Fee'].includes(t.category)).reduce((s, t) => s + t.amount, 0);
    const total    = income.reduce((s, t) => s + t.amount, 0) - realExpense.reduce((s, t) => s + t.amount, 0);
    return { sid, refNum: sessionRefNum(sid), first, txns, subtotal, tax, tips, cardFeeCollected, discounts, total, stripeFeeTotal };
  }).sort((a, b) => new Date(b.first.date).getTime() - new Date(a.first.date).getTime());

  const catMap = new Map<string, number>();
  transactions.filter(t => t.type === 'income').forEach(t => catMap.set(t.category, (catMap.get(t.category) || 0) + t.amount));
  const catTotals = Array.from(catMap.entries()).sort((a, b) => b[1] - a[1]);

  const expCatMap = new Map<string, number>();
  transactions.filter(t => t.type === 'expense').forEach(t => expCatMap.set(t.category, (expCatMap.get(t.category) || 0) + t.amount));
  const expCatTotals = Array.from(expCatMap.entries()).sort((a, b) => b[1] - a[1]);

  type AppendixItem = { refNum: string; imgNum: number; desc: string; date: string; client: string; url?: string };
  const appendix: AppendixItem[] = [];
  const imgNumMap = new Map<string, number>();
  let imgCounter = 1;

  sessions.forEach(s => {
    s.txns.filter(t => (t as any).receiptUrl).forEach(t => {
      imgNumMap.set(t.id, imgCounter);
      appendix.push({ refNum: s.refNum, imgNum: imgCounter, desc: t.description, date: fmtD(t.date, 'MMM d, yyyy · h:mm a'), client: s.first.clientOrVendor || 'Guest', url: (t as any).receiptUrl });
      imgCounter++;
    });
  });
  ungrouped.filter(t => (t as any).receiptUrl).forEach(t => {
    imgNumMap.set(t.id, imgCounter);
    appendix.push({ refNum: txnRefNum(t.id), imgNum: imgCounter, desc: t.description, date: fmtD(t.date, 'MMM d, yyyy · h:mm a'), client: t.clientOrVendor || 'Unknown', url: (t as any).receiptUrl });
    imgCounter++;
  });

  const legendHtml = (() => {
    const seen = new Set<string>();
    return Object.entries(PRINT_CATEGORY_COLORS)
      .filter(([, cs]) => { if (seen.has(cs.label)) return false; seen.add(cs.label); return true; })
      .map(([, cs]) => `<span style="background:${cs.bg};color:${cs.text};padding:2px 8px;border-radius:10px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;">${cs.label}</span>`)
      .join(' ');
  })();

  const sessionRows = sessions.map(s => {
    const lineItems = s.txns.map(t => {
      const cs = getCatStyle(t.category, (t as any).taxBucket);
      const sn = staffName((t as any).staffId);
      const amtColor = t.category === 'Tips' ? '#854d0e' : t.category === 'Tax Collected' ? '#374151' : t.type === 'reversal' ? '#64748b' : t.type === 'expense' ? '#991b1b' : '#166534';
      const imgNum = imgNumMap.get(t.id);
      const imgBadge = imgNum ? `<span style="background:#111;color:#fff;padding:1px 4px;border-radius:4px;font-size:7px;font-weight:900;font-family:monospace;margin-left:4px;">IMG-${imgNum}</span>` : '';
      return `<tr style="border-bottom:1px dashed #f3f4f6;">
        <td style="padding:5px 8px;font-size:10px;width:52%;">
          <span style="background:${cs.bg};color:${cs.text};padding:1px 5px;border-radius:8px;font-size:8px;font-weight:700;margin-right:4px;">${cs.label}</span>
          ${t.description}${sn !== '—' ? `<span style="color:#9ca3af;font-size:9px;"> · </span>${staffChip((t as any).staffId)}` : ''}${imgBadge}
        </td>
        <td style="padding:5px 8px;font-size:10px;color:#6b7280;">${fmtD(t.date, 'h:mm a')}</td>
        <td style="padding:5px 8px;font-size:10px;text-align:right;font-family:monospace;font-weight:700;color:${amtColor};">${t.type === 'expense' ? '-' : ''}$${t.amount.toFixed(2)}</td>
        <td style="padding:5px 8px;font-size:8px;color:#d1d5db;font-family:monospace;">${s.refNum}</td>
      </tr>`;
    }).join('');
    const totals = [
      s.subtotal > 0 ? `Services <strong style="font-family:monospace">$${s.subtotal.toFixed(2)}</strong>` : '',
      s.tax > 0 ? `Tax <strong style="font-family:monospace;color:#374151">$${s.tax.toFixed(2)}</strong>` : '',
      s.tips > 0 ? `Tip <strong style="font-family:monospace;color:#854d0e">$${s.tips.toFixed(2)}</strong>` : '',
      s.cardFeeCollected > 0 ? `Card Fee <strong style="font-family:monospace;color:#92400e">$${s.cardFeeCollected.toFixed(2)}</strong>` : '',
      s.discounts > 0 ? `Discount <strong style="font-family:monospace;color:#9d174d">-$${s.discounts.toFixed(2)}</strong>` : '',
      `<strong>Total <span style="font-family:monospace">$${s.total.toFixed(2)}</span></strong>`,
    ].filter(Boolean).join(' &nbsp;·&nbsp; ');
    const feeNote = s.stripeFeeTotal > 0
      ? `<div style="padding:4px 14px 8px;font-size:9px;color:#9ca3af;font-style:italic;">Stripe processing fee on this sale: $${s.stripeFeeTotal.toFixed(2)} (studio cost — not part of guest total)</div>`
      : '';
    return `<div style="margin-bottom:14px;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;page-break-inside:avoid;">
      <div style="background:#f8fafc;padding:10px 14px;border-bottom:1px solid #e5e7eb;display:flex;justify-content:space-between;align-items:flex-start;">
        <div>
          <div style="font-weight:900;font-size:12px;text-transform:uppercase;">${s.first.clientOrVendor || 'Guest'}</div>
          <div style="font-size:10px;color:#6b7280;">${fmtD(s.first.date, 'MMM d, yyyy · h:mm a')} · ${s.first.paymentMethod}</div>
        </div>
        <div style="text-align:right;">
          <div style="font-weight:900;font-size:15px;font-family:monospace;">$${s.total.toFixed(2)}</div>
          <div style="font-size:9px;color:#9ca3af;font-family:monospace;font-weight:700;">${s.refNum}</div>
        </div>
      </div>
      <table style="width:100%;border-collapse:collapse;"><tbody>${lineItems}</tbody></table>
      <div style="padding:8px 14px;background:#f8fafc;border-top:1px solid #e5e7eb;font-size:11px;color:#6b7280;">${totals}</div>
      ${feeNote}
    </div>`;
  }).join('');

  const ungroupedRows = ungrouped.map((t, i) => {
    const cs = getCatStyle(t.category, (t as any).taxBucket);
    // v59 — reversals previously rendered as red "-" expenses; they're
    // audit-trail entries, so render slate with no sign.
    const amtColor = t.type === 'income' ? '#166534' : t.type === 'reversal' ? '#64748b' : '#991b1b';
    const amtPrefix = t.type === 'income' ? '+' : t.type === 'reversal' ? '' : '-';
    const uImgNum = imgNumMap.get(t.id);
    const uImgBadge = uImgNum ? ` <span style="background:#111;color:#fff;padding:1px 4px;border-radius:4px;font-size:7px;font-weight:900;font-family:monospace;">IMG-${uImgNum}</span>` : '';
    return `<tr style="border-bottom:1px solid #f3f4f6;background:${i % 2 === 0 ? '#fff' : '#fafafa'};">
      <td style="padding:6px 8px;font-size:10px;font-family:monospace;color:#9ca3af;">${txnRefNum(t.id)}</td>
      <td style="padding:6px 8px;font-size:10px;color:#6b7280;">${fmtD(t.date, 'MMM d, h:mm a')}</td>
      <td style="padding:6px 8px;font-size:11px;"><div style="font-weight:600;">${t.description}${uImgBadge}</div><div style="font-size:9px;color:#9ca3af;">${t.clientOrVendor}</div></td>
      <td style="padding:6px 8px;"><span style="background:${cs.bg};color:${cs.text};padding:1px 6px;border-radius:10px;font-size:9px;font-weight:700;">${cs.label}</span></td>
      <td style="padding:6px 8px;font-size:10px;">${staffChip((t as any).staffId)}</td>
      <td style="padding:6px 8px;font-size:10px;color:#6b7280;">${t.paymentMethod}</td>
      <td style="padding:6px 8px;text-align:right;font-family:monospace;font-weight:700;color:${amtColor};">${amtPrefix}$${t.amount.toFixed(2)}</td>
    </tr>`;
  }).join('');

  const appendixHtml = appendix.length > 0 ? `
    <div style="page-break-before:always;margin-top:40px;">
      <h2>Appendix A — Receipt Documentation (${appendix.length} attachments)</h2>
      <p style="font-size:10px;color:#6b7280;margin-bottom:16px;">Images numbered IMG-1 through IMG-${appendix.length}.</p>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
        ${appendix.map(item => `
          <div style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;page-break-inside:avoid;">
            <div style="background:#111;padding:8px 12px;display:flex;justify-content:space-between;align-items:center;">
              <div>
                <div style="color:#fff;font-size:14px;font-weight:900;font-family:monospace;">IMG-${item.imgNum}</div>
                <div style="color:#9ca3af;font-size:9px;font-family:monospace;">${item.refNum}</div>
              </div>
              <div style="text-align:right;">
                <div style="color:#e5e7eb;font-size:11px;font-weight:600;">${item.desc}</div>
                <div style="color:#6b7280;font-size:9px;">${item.client} · ${item.date}</div>
              </div>
            </div>
            ${item.url
              ? `<div style="padding:8px;background:#fff;"><img src="${item.url}" alt="Receipt IMG-${item.imgNum}" style="width:100%;max-height:280px;object-fit:contain;display:block;" /></div>`
              : `<div style="padding:24px;text-align:center;color:#d1d5db;font-size:10px;font-weight:700;">POS receipt — view in ClarityFlow</div>`}
          </div>`).join('')}
      </div>
    </div>` : '';

  return `<!DOCTYPE html><html><head><title>Studio Ledger Report</title>
  <style>
    * { box-sizing:border-box; margin:0; padding:0; }
    body { font-family:-apple-system,sans-serif; color:#111; padding:32px; }
    h1 { font-size:26px; font-weight:900; text-transform:uppercase; letter-spacing:-0.03em; }
    h2 { font-size:12px; font-weight:900; text-transform:uppercase; letter-spacing:0.1em; margin:28px 0 10px; border-bottom:2px solid #111; padding-bottom:6px; }
    table { width:100%; border-collapse:collapse; }
    th { background:#f8fafc; text-align:left; padding:7px 8px; font-size:9px; font-weight:900; text-transform:uppercase; letter-spacing:0.08em; color:#6b7280; border-bottom:2px solid #e5e7eb; }
    @media print { @page { size:A4; margin:0.65in; } body { padding:0; } .no-print { display:none; } }
  </style></head><body>
  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:24px;padding-bottom:20px;border-bottom:3px solid #111;">
    <div>
      <h1>Studio Financial Report</h1>
      <div style="font-size:12px;color:#6b7280;font-weight:600;margin-top:4px;">Period: ${periodLabel}</div>
      <div style="font-size:10px;color:#9ca3af;margin-top:2px;">Generated ${format(new Date(), 'MMMM d, yyyy · h:mm a')}</div>
    </div>
    <div style="text-align:right;font-size:10px;color:#9ca3af;">
      <div style="font-weight:700;">ClarityFlow</div><div>Studio Management</div><div style="margin-top:4px;">Confidential</div>
    </div>
  </div>
  <div style="margin-bottom:20px;padding:12px 16px;border:1px solid #e5e7eb;border-radius:8px;background:#fafafa;">
    <div style="font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:8px;color:#374151;">Color Key</div>
    <div style="display:flex;flex-wrap:wrap;gap:6px;">${legendHtml}</div>
  </div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px;">
    <div style="padding:16px;border:1px solid #e5e7eb;border-radius:8px;background:#fafafa;">
      <div style="font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:12px;color:#374151;">Financial Summary</div>
      <div style="display:flex;justify-content:space-between;padding:3px 0;font-size:12px;border-bottom:1px solid #f3f4f6;"><span style="color:#555;">Gross Revenue</span><span style="font-family:monospace;color:#166534;font-weight:700;">$${(summary.revenue + summary.taxLiability).toFixed(2)}</span></div>
      <div style="display:flex;justify-content:space-between;padding:3px 0;font-size:12px;border-bottom:1px solid #f3f4f6;"><span style="color:#94a3b8;">Tax Liability (held)</span><span style="font-family:monospace;color:#64748b;">-$${summary.taxLiability.toFixed(2)}</span></div>
      <div style="display:flex;justify-content:space-between;padding:3px 0;font-size:12px;border-bottom:1px solid #f3f4f6;"><span style="color:#555;">Net Revenue</span><span style="font-family:monospace;color:#166534;font-weight:700;">$${summary.revenue.toFixed(2)}</span></div>
      <div style="display:flex;justify-content:space-between;padding:3px 0;font-size:12px;border-bottom:1px solid #f3f4f6;"><span style="color:#555;">COGS</span><span style="font-family:monospace;color:#991b1b;">-$${summary.cogs.toFixed(2)}</span></div>
      <div style="display:flex;justify-content:space-between;padding:6px 0 3px;font-size:12px;font-weight:700;border-bottom:1px solid #f3f4f6;"><span>Gross Profit</span><span style="font-family:monospace;">$${summary.grossProfit.toFixed(2)}</span></div>
      <div style="display:flex;justify-content:space-between;padding:3px 0;font-size:12px;border-bottom:1px solid #f3f4f6;"><span style="color:#7c3aed;">Card Fees Paid</span><span style="font-family:monospace;color:#991b1b;">-$${summary.processingFeesPaid.toFixed(2)}</span></div>
      <div style="display:flex;justify-content:space-between;padding:3px 0;font-size:12px;border-bottom:1px solid #f3f4f6;"><span style="color:#555;">Other Op. Expenses</span><span style="font-family:monospace;color:#991b1b;">-$${summary.operatingExpenses.toFixed(2)}</span></div>
      <div style="display:flex;justify-content:space-between;padding:8px 0 0;font-size:14px;font-weight:900;border-top:2px solid #111;margin-top:4px;"><span>Net Income</span><span style="font-family:monospace;color:${summary.net >= 0 ? '#166534' : '#991b1b'};">$${summary.net.toFixed(2)}</span></div>
    </div>
    <div style="padding:16px;border:1px solid #e5e7eb;border-radius:8px;background:#fafafa;">
      <div style="font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:12px;color:#374151;">Card Processing — Write-Off Summary</div>
      <div style="display:flex;justify-content:space-between;padding:3px 0;font-size:12px;border-bottom:1px solid #f3f4f6;"><span style="color:#555;">Collected from Clients</span><span style="font-family:monospace;color:#166534;font-weight:700;">$${summary.processingFeesCollected.toFixed(2)}</span></div>
      <div style="display:flex;justify-content:space-between;padding:3px 0;font-size:12px;border-bottom:1px solid #f3f4f6;"><span style="color:#555;">Paid to Stripe</span><span style="font-family:monospace;color:#991b1b;">-$${summary.processingFeesPaid.toFixed(2)}</span></div>
      <div style="display:flex;justify-content:space-between;padding:8px 0 0;font-size:14px;font-weight:900;border-top:2px solid #111;margin-top:4px;"><span>Net Fee Cost</span><span style="font-family:monospace;color:${summary.netFeeImpact >= 0 ? '#166534' : '#991b1b'};">${summary.netFeeImpact >= 0 ? '+' : ''}$${summary.netFeeImpact.toFixed(2)}</span></div>
      <p style="font-size:9px;color:#9ca3af;margin-top:10px;line-height:1.5;">Both figures should be reported to your accountant individually.</p>
    </div>
  </div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:28px;">
    <div style="padding:16px;border:1px solid #e5e7eb;border-radius:8px;background:#fafafa;">
      <div style="font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:12px;color:#374151;">Revenue by Category</div>
      ${catTotals.map(([cat, amt]) => { const cs = getCatStyle(cat); return `<div style="display:flex;justify-content:space-between;padding:3px 0;font-size:11px;border-bottom:1px solid #f9fafb;"><span><span style="background:${cs.bg};color:${cs.text};padding:1px 6px;border-radius:10px;font-size:8px;font-weight:700;">${cs.label}</span></span><span style="font-family:monospace;color:#166534;font-weight:600;">$${amt.toFixed(2)}</span></div>`; }).join('')}
    </div>
    <div style="padding:16px;border:1px solid #e5e7eb;border-radius:8px;background:#fafafa;">
      <div style="font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:12px;color:#374151;">Expenses by Category</div>
      ${expCatTotals.length > 0
        ? expCatTotals.map(([cat, amt]) => { const cs = getCatStyle(cat); return `<div style="display:flex;justify-content:space-between;padding:3px 0;font-size:11px;border-bottom:1px solid #f9fafb;"><span><span style="background:${cs.bg};color:${cs.text};padding:1px 6px;border-radius:10px;font-size:8px;font-weight:700;">${cs.label}</span></span><span style="font-family:monospace;color:#991b1b;font-weight:600;">$${amt.toFixed(2)}</span></div>`; }).join('')
        : `<p style="font-size:10px;color:#9ca3af;">No expenses this period.</p>`}
    </div>
  </div>
  ${sessions.length > 0 ? `<h2>Checkout Sessions (${sessions.length})</h2>${sessionRows}` : ''}
  ${ungrouped.length > 0 ? `
  <h2>Manual & Other Entries (${ungrouped.length})</h2>
  <table><thead><tr><th>Ref #</th><th>Date</th><th>Description</th><th>Category</th><th>Staff</th><th>Method</th><th style="text-align:right;">Amount</th></tr></thead>
  <tbody>${ungroupedRows}</tbody></table>` : ''}
  ${appendixHtml}
  <div style="margin-top:40px;border-top:2px solid #111;padding-top:16px;display:flex;justify-content:space-between;font-size:9px;color:#9ca3af;">
    <div><div style="font-weight:700;">ClarityFlow Studio Management</div><div>Confidential — Not for Distribution</div></div>
    <div style="text-align:right;"><div>${periodLabel}</div><div>Generated ${format(new Date(), 'MMMM d, yyyy · h:mm a')}</div><div>${transactions.length} records · ${sessions.length} sessions</div></div>
  </div>
  </body></html>`;
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
          <DialogTitle className="text-xl font-black uppercase tracking-tighter text-slate-900 truncate">{transaction.description}</DialogTitle>
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
                    <div className="flex-1 min-w-0"><span className="font-bold text-[12px] text-slate-900 block truncate">{item.label}</span>{item.staff && <span className="text-[10px] text-muted-foreground">· {item.staff}</span>}</div>
                    <span className="font-black text-slate-900 shrink-0">${item.amount.toFixed(2)}</span>
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

// ─── TransactionDossierSheet (unchanged) ─────────────────────────────────────

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
                    <Avatar className="h-10 w-10 border shadow-sm rounded-xl"><AvatarImage src={staffMember.avatarUrl} className="object-cover" /><AvatarFallback className="font-black text-xs bg-primary/10 text-primary">{(staffMember.name || 'S').charAt(0)}</AvatarFallback></Avatar>
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
      <CardHeader className="hidden md:block border-b bg-muted/5">
        <CardTitle className="text-sm font-black uppercase tracking-widest">Ledger Filters</CardTitle>
        <CardDescription className="text-xs font-bold uppercase tracking-tight opacity-60">Filter studio cash flow.</CardDescription>
      </CardHeader>
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

        {/* ── Period Performance panel — now includes tax liability ── */}
        <div className="p-5 rounded-[2rem] bg-primary/[0.03] border-2 border-primary/10 space-y-3">
          <p className="text-[10px] font-black uppercase tracking-widest text-primary text-center">Period Performance</p>
          <div className="space-y-2 text-xs">
            {[
              ['Gross Revenue', financialSummary.revenue + financialSummary.taxLiability, 'text-green-600'],
              ['Tax Liability', -financialSummary.taxLiability, 'text-slate-400'],
              ['Net Revenue', financialSummary.revenue, 'text-green-600'],
              ['COGS', -financialSummary.cogs, 'text-destructive'],
              ['Gross Profit', financialSummary.grossProfit, 'text-slate-900'],
              ['Card Fees Paid', -financialSummary.processingFeesPaid, 'text-purple-700'],
              ['Op. Expenses', -financialSummary.operatingExpenses, 'text-destructive'],
            ].map(([label, val, cls]) => (
              <div key={label as string} className="flex justify-between font-bold">
                <span className={label === 'Tax Liability' ? 'text-slate-400 italic text-[10px]' : ''}>{label as string}</span>
                <span className={cn('font-mono', cls as string)}>
                  {(val as number) < 0 ? '-' : ''}${Math.abs(val as number).toFixed(2)}
                  {label === 'Tax Liability' && <span className="text-[8px] ml-1 opacity-50">(held)</span>}
                </span>
              </div>
            ))}
            <div className="flex justify-between border-t-4 border-primary/20 pt-3 mt-3">
              <span className="font-black uppercase text-[11px] text-primary">Net Income</span>
              <span className={cn('font-black text-xl tracking-tighter font-mono', financialSummary.net >= 0 ? 'text-primary' : 'text-destructive')}>
                ${financialSummary.net.toFixed(2)}
              </span>
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
      {/* v66 — was opacity-0 group-hover:opacity-100, which made the
          revert/refund menu INVISIBLE on touch devices (no hover on
          phones). Now always visible on mobile, hover-reveal on desktop. */}
      <Button aria-haspopup="true" size="icon" variant="ghost" className="h-8 w-8 rounded-full opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity shrink-0" onClick={stopProp}>
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

// v66 — compacted for mobile: single tighter block, badges inline with the
// meta row, ~35% less vertical space per card so more entries fit on screen.
const TransactionCard = ({ transaction, staffMember, onRevertClick, onPreviewReceipt, onViewDetails, onRefundClick }: any) => (
  <Card className="border-2 shadow-sm rounded-2xl overflow-hidden group cursor-pointer active:scale-[0.99] transition-transform" onClick={() => onViewDetails(transaction)}>
    <CardContent className="p-3.5 space-y-2">
      <div className="flex items-start gap-3">
        <div className={cn('p-2 rounded-xl shadow-inner shrink-0', transaction.type === 'income' ? 'bg-green-500/10' : transaction.type === 'expense' ? 'bg-destructive/10' : 'bg-muted')}>
          <TransactionIcon type={transaction.type} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-black text-[13px] uppercase tracking-tight text-slate-900 truncate leading-tight">{transaction.description}</p>
          <p className="text-[9px] text-muted-foreground font-black uppercase tracking-widest opacity-60 truncate">
            {transaction.clientOrVendor} · {fmt(transaction.date, 'MMM d, p')}
            {staffMember ? <span className="text-primary opacity-100"> · {staffMember.name.split(' ')[0]}</span> : null}
          </p>
        </div>
        <div className="text-right shrink-0 flex items-center gap-1">
          {(transaction as any).receiptId && (
            <Button variant="ghost" size="icon" className="h-7 w-7 rounded-full hover:bg-primary/10 shrink-0" onClick={e => { e.stopPropagation(); onPreviewReceipt(transaction); }}>
              <Receipt className="h-3.5 w-3.5 text-primary opacity-40" />
            </Button>
          )}
          <p className={cn('font-black font-mono text-base tracking-tighter', amountColor(transaction))}>{amountPrefix(transaction)}${transaction.amount.toFixed(2)}</p>
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 pt-2 border-t border-dashed">
        <div className="flex items-center gap-1.5 min-w-0 overflow-hidden">
          <Badge className={cn('text-[8px] h-4.5 px-1.5 font-black uppercase tracking-widest border-none shrink-0', transaction.context === 'Business' ? 'bg-indigo-100 text-indigo-800' : 'bg-purple-100 text-purple-800')}>{transaction.context}</Badge>
          <Badge variant="outline" className="text-[8px] h-4.5 px-1.5 uppercase font-black tracking-widest text-muted-foreground/60 border-2 truncate">{transaction.category}</Badge>
          <span className="text-[8px] text-muted-foreground font-black uppercase tracking-widest opacity-50 flex items-center gap-1 truncate"><CreditCard className="w-3 h-3 shrink-0" />{transaction.paymentMethod}</span>
        </div>
        <TxnActions transaction={transaction} onRevertClick={onRevertClick} onPreviewReceipt={onPreviewReceipt} onRefundClick={onRefundClick} stopProp={(e: any) => e.stopPropagation()} />
      </div>
    </CardContent>
  </Card>
);

// ─── LedgerTab (formerly LedgerPage) ──────────────────────────────────────────

const LedgerTab = () => {
  const { firestore } = useFirebase();
  const { selectedTenant } = useTenant();
  const tenantId = selectedTenant?.id;
  const isMobile = useIsMobile();
  const { toast } = useToast();

  const { transactions: rawTransactions, staff, tillSessions, services, appointments, inventory, clients, isLoading } = useInventory();
  const auditActor = useAuditActor();
  // v58 — intake normalization: every consumer below assumes `amount`
  // (dollars) and `type` exist. Entries written with amountCents or a
  // missing type (early day-rental payments) are healed here instead of
  // crashing the page.
  const transactions = useMemo(() => (rawTransactions || []).map((t: any) => ({
    ...t,
    amount:        typeof t.amount === 'number' ? t.amount : (Number(t.amountCents) || 0) / 100,
    type:          t.type || 'income',
    context:       t.context || 'Business',
    category:      t.category || 'Uncategorized',
    description:   t.description || '',
    clientOrVendor: t.clientOrVendor || '',
    taxBucket:     t.taxBucket || 'revenue',
  })), [rawTransactions]);

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

  // ── Financial summary — Tax Collected is now a liability, not revenue ──────
  const financialSummary = useMemo(() => {
    const cogs_cats = ['spoilage', 'supplies', 'cost of goods', 'comp'];

    // Tax collected is held on behalf of the government — not studio income
    const taxLiability = filteredTransactions
      .filter(t => t.type === 'income' && t.category === 'Tax Collected')
      .reduce((s, t) => s + t.amount, 0);

    const revenue = filteredTransactions
      .filter(t => t.type === 'income' && t.category !== 'Tax Collected')
      .reduce((s, t) => s + t.amount, 0);

    const cogs = filteredTransactions
      .filter(t => t.type === 'expense' && cogs_cats.some(c => t.category.toLowerCase().includes(c)))
      .reduce((s, t) => s + t.amount, 0);

    const processingFeesPaid = filteredTransactions
      .filter(t => t.type === 'expense' && t.category === 'Processing Fee')
      .reduce((s, t) => s + t.amount, 0);

    const processingFeesCollected = filteredTransactions
      .filter(t => t.type === 'income' && t.category === 'Card Processing Fee')
      .reduce((s, t) => s + t.amount, 0);

    const operatingExpenses = filteredTransactions
      .filter(t => t.type === 'expense' && !cogs_cats.some(c => t.category.toLowerCase().includes(c)) && t.category !== 'Processing Fee')
      .reduce((s, t) => s + t.amount, 0);

    const grossProfit = revenue - cogs;
    const net = grossProfit - processingFeesPaid - operatingExpenses;

    return {
      revenue, cogs, grossProfit, operatingExpenses, net, taxLiability,
      processingFeesPaid, processingFeesCollected,
      netFeeImpact: processingFeesCollected - processingFeesPaid,
    };
  }, [filteredTransactions]);

  // ── Daily revenue sparkline data ──────────────────────────────────────────
  const dailyRevenueData = useMemo(() => {
    if (!date?.from || !date?.to) return [];
    const days = eachDayOfInterval({ start: date.from, end: date.to });
    if (days.length > 60) return []; // too many days — skip sparkline
    return days.map(day =>
      filteredTransactions
        .filter(t => t.type === 'income' && t.category !== 'Tax Collected' && isSameDay(safeDate(t.date), day))
        .reduce((s, t) => s + t.amount, 0)
    );
  }, [filteredTransactions, date]);

  // ── KPI stats ─────────────────────────────────────────────────────────────
  const kpiStats = useMemo(() => {
    const txnCount = filteredTransactions.filter(t => t.type === 'income').length;
    const avgTicket = txnCount > 0 ? financialSummary.revenue / txnCount : 0;
    const totalTips = filteredTransactions.filter(t => t.category === 'Tips').reduce((s, t) => s + t.amount, 0);
    const refundTotal = filteredTransactions.filter(t => t.type === 'reversal' || t.category === 'Refunds').reduce((s, t) => s + t.amount, 0);
    const margin = financialSummary.revenue > 0 ? (financialSummary.net / financialSummary.revenue) * 100 : 0;
    return { txnCount, avgTicket, totalTips, refundTotal, margin };
  }, [filteredTransactions, financialSummary]);

  const openPrintWindow = useCallback((html: string) => {
    const win = window.open('', '_blank', 'width=900,height=700');
    if (!win) { toast({ variant: 'destructive', title: 'Pop-up blocked', description: 'Allow pop-ups for this site to print.' }); return; }
    win.document.write(html);
    win.document.close();
    setTimeout(() => { win.focus(); win.print(); }, 400);
  }, [toast]);

  const handlePrint = useCallback(() => {
    openPrintWindow(buildPrintHtml(filteredTransactions, staff || [], financialSummary, date));
  }, [filteredTransactions, staff, financialSummary, date, openPrintWindow]);

  // v63 — the Reports menu: P&L, Schedule C tax summary, payroll register,
  // and the printable audit trail, all over the currently filtered period.
  const openReport = useCallback(async (kind: 'pnl' | 'tax' | 'payroll' | 'audit') => {
    let html = '';
    if (kind === 'pnl') html = buildPnlHtml(filteredTransactions, date);
    if (kind === 'tax') html = buildTaxSummaryHtml(filteredTransactions, date);
    if (kind === 'payroll') {
      const tState = (selectedTenant as any)?.taxState || null;
      const profile = tState ? getStateProfile(tState) : GENERIC_US_PROFILE;
      html = buildPayrollRegisterHtml(filteredTransactions, staff || [], profile, date, !!tState);
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
      html = buildAuditTrailHtml(entries, date);
    }
    if (html) openPrintWindow(html);
  }, [filteredTransactions, date, staff, selectedTenant, firestore, tenantId, openPrintWindow]);

  const handleAddTransaction = (data: Omit<Transaction, 'id'>) => {
    if (!firestore || !tenantId) return;
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

  const handleRevertTransaction = (target?: Transaction) => {
    const t = target || transactionToRevert;
    if (!t || !firestore || !tenantId) return;
    if (t.type === 'reversal') { toast({ variant: 'destructive', title: 'Cannot revert a reversal.' }); setTransactionToRevert(null); return; }
    handleAddTransaction({ ...t, date: new Date().toISOString(), description: `Reversal of: ${t.description}`, type: 'reversal', reversalOf: t.id });
    writeAudit(firestore, tenantId, {
      action: 'transaction.revert', targetType: 'transaction', targetId: t.id,
      summary: `Reverted: ${t.description}`, amount: t.amount, actor: auditActor,
    });
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
    try {
      await batch.commit();
      toast({ title: 'Refund Authorized', description: `$${refundTotal.toFixed(2)} reversed.` });
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
    <div className="w-full overflow-x-hidden">
      <div className="p-4 md:p-10 w-full max-w-7xl mx-auto">

        {/* ── Section header — v66: one compact row on mobile (icon buttons)
               instead of two stacked 56px full-width buttons ─────────────── */}
        <div className="flex flex-row items-center justify-between gap-3 mb-5 md:mb-8">
          <div className="min-w-0">
            <h1 className="text-2xl md:text-4xl font-black uppercase tracking-tighter text-slate-900 leading-none truncate">The Ledger</h1>
            <p className="hidden sm:block text-sm text-muted-foreground font-black uppercase tracking-[0.2em] opacity-60">Official financial audit trail</p>
          </div>
          <div className="flex items-center gap-2 md:gap-3 shrink-0">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" aria-label="Reports" className="h-11 w-11 p-0 md:h-14 md:w-auto md:px-8 rounded-2xl border-2 font-black uppercase text-[10px] tracking-widest shadow-sm bg-white">
                  <Printer className="h-4 w-4 md:mr-2" /><span className="hidden md:inline">Reports</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="rounded-2xl shadow-xl border-2 p-1 w-72">
                <DropdownMenuItem onClick={handlePrint} className="font-bold uppercase text-[10px] tracking-widest rounded-xl h-10 px-3">
                  <BookOpen className="w-3.5 h-3.5 mr-2 text-primary opacity-60" /> Studio Report — Full Detail
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => openReport('pnl')} className="font-bold uppercase text-[10px] tracking-widest rounded-xl h-10 px-3">
                  <TrendingUp className="w-3.5 h-3.5 mr-2 text-green-600 opacity-60" /> Profit &amp; Loss
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => openReport('tax')} className="font-bold uppercase text-[10px] tracking-widest rounded-xl h-10 px-3">
                  <Landmark className="w-3.5 h-3.5 mr-2 text-orange-600 opacity-60" /> Tax Summary (Schedule C)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => openReport('payroll')} className="font-bold uppercase text-[10px] tracking-widest rounded-xl h-10 px-3">
                  <Users className="w-3.5 h-3.5 mr-2 text-sky-600 opacity-60" /> Payroll Register
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => openReport('audit')} className="font-bold uppercase text-[10px] tracking-widest rounded-xl h-10 px-3">
                  <ShieldCheck className="w-3.5 h-3.5 mr-2 text-slate-500 opacity-60" /> Audit Trail
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button onClick={() => setIsAddTxnOpen(true)} aria-label="New Entry" className="h-11 w-11 p-0 md:h-14 md:w-auto md:px-8 rounded-2xl shadow-xl font-black uppercase tracking-widest text-[10px] shadow-primary/20">
              <PlusCircle className="h-4 w-4 md:mr-2" /><span className="hidden md:inline">New Entry</span>
            </Button>
          </div>
        </div>

        {/* ── Bank feed & reconciliation (Plaid) ── */}
        {tenantId && firestore && (
          <div className="mb-8">
            <BankFeedSection tenantId={tenantId} firestore={firestore} actor={auditActor} />
          </div>
        )}

        {/* ── KPI stat bar — v66: horizontal snap-scroll strip on mobile
               (one row, thumb-swipeable), grid on desktop ───────────────── */}
        <div className="flex md:grid md:grid-cols-4 gap-3 md:gap-4 mb-5 md:mb-8 overflow-x-auto md:overflow-visible snap-x snap-mandatory -mx-4 px-4 md:mx-0 md:px-0 pb-1 md:pb-0 [&>*]:min-w-[190px] [&>*]:snap-start [&>*]:shrink-0 md:[&>*]:min-w-0 md:[&>*]:shrink">
          <StatCard
            label="Net Revenue"
            value={fmtCurrency(financialSummary.revenue)}
            icon={TrendingUp}
            accent="bg-green-100 text-green-700"
            sparkData={dailyRevenueData}
            trend={financialSummary.net >= 0 ? 'up' : 'down'}
            trendLabel={`${kpiStats.margin.toFixed(1)}% margin`}
          />
          <StatCard
            label="Net Income"
            value={fmtCurrency(financialSummary.net)}
            icon={DollarSign}
            accent={financialSummary.net >= 0 ? 'bg-primary/10 text-primary' : 'bg-destructive/10 text-destructive'}
            trend={financialSummary.net >= 0 ? 'up' : 'down'}
            trendLabel={financialSummary.net >= 0 ? 'Profitable' : 'Net loss'}
          />
          <StatCard
            label="Avg. Ticket"
            value={fmtCurrency(kpiStats.avgTicket)}
            icon={Receipt}
            accent="bg-indigo-100 text-indigo-700"
            sub={`${kpiStats.txnCount} income entries`}
          />
          <StatCard
            label="Tax Liability"
            value={fmtCurrency(financialSummary.taxLiability)}
            icon={AlertCircle}
            accent="bg-slate-100 text-slate-500"
            sub="Held — not your income"
          />
        </div>

        {/* ── Quick period chips — v66: the #1 ledger action (switching the
               period) is now one tap on mobile, no accordion trip ────────── */}
        <div className="md:hidden flex gap-1.5 p-1.5 bg-muted border-2 border-muted rounded-2xl shadow-inner mb-5 overflow-x-auto">
          {([['today', 'Today'], ['7days', '7D'], ['30days', '30D'], ['thisMonth', 'Month'], ['lastMonth', 'Last Mo']] as [string, string][]).map(([v, l]) => (
            <Button key={v} variant="ghost" size="sm" onClick={() => setPeriodPreset(v)}
              className={cn('flex-1 text-[9px] font-black uppercase h-8 px-3 rounded-xl transition-all whitespace-nowrap',
                periodPreset === v ? 'bg-white shadow-sm border border-border/50' : 'hover:bg-white/50')}>
              {l}
            </Button>
          ))}
        </div>

        {/* ── Main grid ───────────────────────────────────────────────────── */}
        <div className="grid md:grid-cols-3 lg:grid-cols-4 gap-8 items-start">

          {/* Sidebar filters */}
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

          {/* Main content column */}
          <div className="md:col-span-2 lg:col-span-3 space-y-5 min-w-0">

            {/* ── Bad debt aging — now uses BadDebtAgingCard ───────────────── */}
            <BadDebtAgingCard clients={clients || []} tenantId={tenantId || ''} actor={auditActor} />

            {/* ── Tips + refunds — v66: one compact chip row instead of two
                   full-width strips ────────────────────────────────────────── */}
            {(kpiStats.totalTips > 0 || kpiStats.refundTotal > 0) && (
              <div className="flex gap-2.5 overflow-x-auto pb-1">
                {kpiStats.totalTips > 0 && (
                  <div className="flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-amber-50 border-2 border-amber-200 shrink-0">
                    <DollarSign className="w-3.5 h-3.5 text-amber-800" />
                    <span className="text-[10px] font-black uppercase tracking-widest text-amber-800">Tips</span>
                    <span className="font-mono font-black text-sm text-amber-800">{fmtCurrency(kpiStats.totalTips)}</span>
                  </div>
                )}
                {kpiStats.refundTotal > 0 && (
                  <div className="flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-red-50 border-2 border-red-200 shrink-0">
                    <Undo2 className="w-3.5 h-3.5 text-red-700" />
                    <span className="text-[10px] font-black uppercase tracking-widest text-red-700">Refunds</span>
                    <span className="font-mono font-black text-sm text-red-700">-{fmtCurrency(kpiStats.refundTotal)}</span>
                  </div>
                )}
              </div>
            )}

            {/* ── Desktop table ─────────────────────────────────────────────── */}
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
                    {isLoading && (
                      <TableRow>
                        <TableCell colSpan={8} className="h-64 text-center">
                          <div className="flex flex-col items-center gap-4">
                            <Loader className="w-10 h-10 animate-spin text-primary" />
                            <p className="font-black uppercase text-[10px] tracking-widest text-primary opacity-60">Synchronizing Ledger...</p>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                    {!isLoading && filteredTransactions.map(t => <TransactionRow key={t.id} {...sharedRowProps(t)} />)}
                    {!isLoading && filteredTransactions.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={8} className="h-64 text-center">
                          <div className="space-y-2 opacity-30"><BookOpen className="w-12 h-12 mx-auto" /><p className="uppercase font-black tracking-widest text-xs">No records found</p></div>
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            {/* ── Mobile cards ──────────────────────────────────────────────── */}
            <div className="md:hidden space-y-4">
              {isLoading && (
                <div className="flex flex-col items-center justify-center py-24">
                  <Loader className="w-10 h-10 animate-spin text-primary mb-4" />
                  <p className="text-[10px] font-black uppercase tracking-widest text-primary">Syncing...</p>
                </div>
              )}
              {!isLoading && filteredTransactions.length > 0 && (
                <div className="grid gap-4">{filteredTransactions.map(t => <TransactionCard key={t.id} {...sharedRowProps(t)} />)}</div>
              )}
              {!isLoading && filteredTransactions.length === 0 && (
                <div className="text-center py-24 opacity-30 border-4 border-dashed rounded-[3rem] flex flex-col items-center gap-4">
                  <BookOpen className="w-16 h-16" />
                  <p className="text-sm font-black uppercase tracking-widest">No entries found</p>
                </div>
              )}
            </div>

          </div>
        </div>
      </div>

      {/* ── Dialogs ────────────────────────────────────────────────────────── */}

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

      <TransactionDossierSheet
        open={!!selectedDossier}
        onOpenChange={o => { if (!o) setSelectedDossier(null); }}
        transaction={selectedDossier}
        staff={staff || []}
        onRevert={handleRevertTransaction}
      />

      <RefundProtocolDialog
        open={!!transactionToRefund}
        onOpenChange={(v: boolean) => { if (!v) setTransactionToRefund(null); }}
        transaction={transactionToRefund}
        staff={staff || []}
        services={services || []}
        appointments={appointments || []}
        inventory={inventory || []}
        tenant={selectedTenant}
        onConfirm={handleRefundConfirm}
      />
    </div>
  );
};

// ─── PaydayTab (formerly PaydayPage) ──────────────────────────────────────────

const AllocationItem = ({ label, percentage, amount, color }: { label: string, percentage: number, amount: number, color: string }) => (
    <div className="flex items-center justify-between p-3 rounded-xl bg-muted/30 border shadow-sm">
        <div className="flex items-center gap-3">
            <div className={cn("w-2 h-8 rounded-full", color)} />
            <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{label}</p>
                <p className="text-[8px] font-bold text-muted-foreground opacity-60">{percentage}% Allocation</p>
            </div>
        </div>
        <p className="text-base md:text-lg font-black font-mono tracking-tighter text-slate-900">${amount.toFixed(2)}</p>
    </div>
);

type Cadence = 'weekly' | 'bi-weekly' | 'monthly' | 'custom';

const PaydayTab = () => {
  const { billDefinitions, billInstances, transactions, staff, activityLogs, isLoading } = useInventory();
  const auditActor = useAuditActor();
  const { firestore } = useFirebase();
  const { selectedTenant } = useTenant();
  const { toast } = useToast();
  const tenantId = selectedTenant?.id;

  const [allocationAmount, setAllocationAmount] = useState<number>(0);
  const [cadence, setCadence] = useState<Cadence>('bi-weekly');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [dateRange, setDateRange] = useState<{ from: Date, to: Date }>(() => {
      const now = new Date();
      return {
          from: startOfDay(subDays(now, 13)),
          to: endOfDay(now)
      };
  });

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
      if (newCadence === 'weekly') {
          setDateRange({ from: startOfDay(subDays(now, 6)), to: endOfDay(now) });
      } else if (newCadence === 'bi-weekly') {
          setDateRange({ from: startOfDay(subDays(now, 13)), to: endOfDay(now) });
      } else if (newCadence === 'monthly') {
          setDateRange({ from: startOfMonth(now), to: endOfMonth(now) });
      }
  };

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

  const staffObligations = useMemo(() => {
    if (!staff || !filteredTransactions || !activityLogs) return [];

    return staff.map(member => {
        const staffTransactions = filteredTransactions.filter(t => t.staffId === member.id && t.type === 'income');

        const serviceRevenue = staffTransactions
            .filter(t => t.category === 'Service Revenue')
            .reduce((acc, t) => acc + t.amount, 0);

        const retailSales = staffTransactions
            .filter(t => t.category === 'Retail')
            .reduce((acc, t) => acc + t.amount, 0);

        const tips = staffTransactions
            .filter(t => t.category === 'Tips' || t.tipAmount)
            .reduce((acc, t) => acc + (t.tipAmount || t.amount), 0);

        let earnings = 0;
        let hoursWorked = 0;
        if (member.payStructure === 'commission') {
            earnings = (serviceRevenue * ((member.commissionRate || 40) / 100)) +
                       (member.retailCommissionRate ? (retailSales * (member.retailCommissionRate / 100)) : 0);
        } else if (member.payStructure === 'hourly' && member.hourlyRate) {
            const logs = activityLogs.filter(l =>
                l.staffId === member.id &&
                safeDate(l.timestamp) >= dateRange.from &&
                safeDate(l.timestamp) <= dateRange.to
            );
            const totalMinutes = logs.reduce((acc, l) => acc + (l.durationMinutes || 0), 0);
            hoursWorked = totalMinutes / 60;
            earnings = hoursWorked * member.hourlyRate;
        }

        const totalOwed = earnings + tips;

        return {
            id: member.id,
            name: member.name,
            avatarUrl: member.avatarUrl,
            amount: totalOwed,
            // v60 — broken out for the Gusto payroll draft
            earnings,
            tips,
            hours: hoursWorked,
            payStructure: member.payStructure,
            details: `${member.payStructure === 'commission' ? 'Comm' : 'Hr'} + Tips`
        };
    }).filter(o => o.amount > 0);
  }, [staff, filteredTransactions, activityLogs, dateRange]);

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
                regularHours: o.payStructure === 'hourly' ? Number((o.hours || 0).toFixed(2)) : 0,
                overtimeHours: 0,
                commission: o.payStructure === 'commission' ? Number((o.earnings || 0).toFixed(2)) : 0,
                tips: Number((o.tips || 0).toFixed(2)),
                bonus: 0,
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
                <h1 className="text-2xl md:text-3xl font-black uppercase tracking-tighter text-slate-900">Run Payday</h1>
                <p className="text-[10px] md:text-sm text-muted-foreground font-medium uppercase tracking-widest opacity-70">
                    Reconcile Period & Allocate Revenue
                </p>
            </div>

            <div className="space-y-6">
                <div className="max-w-[340px] mx-auto flex gap-1.5 p-2 bg-muted border-2 border-muted rounded-2xl shadow-inner">
                    {(['weekly', 'bi-weekly', 'monthly', 'custom'] as Cadence[]).map(c => (
                        <Button key={c} variant="ghost" size="sm" onClick={() => handleCadenceChange(c)} className={cn("flex-1 text-[9px] font-black uppercase h-8 rounded-xl transition-all", cadence === c ? "bg-white shadow-sm border border-border/50" : "hover:bg-white/50")}>{c.replace('-', ' ')}</Button>
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
                            className="h-10 w-10 md:h-12 md:w-12 hover:bg-white rounded-full shadow-sm"
                        >
                            <ChevronLeft className="w-5 h-5 md:w-6 md:h-6"/>
                        </Button>

                        <div className="text-center px-2">
                            <p className="text-[9px] md:text-[10px] font-black uppercase tracking-widest text-primary mb-1">Reconciling Period</p>
                            <p className="text-sm md:text-xl font-black text-slate-900 leading-none">
                                {format(dateRange.from, 'MMM d')} – {format(dateRange.to, 'MMM d, yyyy')}
                            </p>
                        </div>

                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={handleNextPeriod}
                            className="h-10 w-10 md:h-12 md:w-12 hover:bg-white rounded-full shadow-sm"
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

            {/* ── Auto-draft banner — from the daily payroll-draft cron ── */}
            {pendingDraft && (
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-4 md:p-5 rounded-2xl bg-primary/5 border-2 border-primary/20 shadow-sm animate-in fade-in slide-in-from-top-2 duration-300">
                    <div className="text-left">
                        <p className="text-[9px] font-black uppercase tracking-widest text-primary mb-1 flex items-center gap-1.5">
                            <CalendarRange className="w-3.5 h-3.5" /> Payroll draft ready
                        </p>
                        <p className="text-xs md:text-sm font-black text-slate-900">
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

            {/* ── Payroll Ready (Gusto) ─────────────────────────────────── */}
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

                    {/* ── Level 2 automation: auto-draft on the pay cadence ── */}
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
                    {/* ── Tax location — per tenant, drives the Tax bucket % ── */}
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
                                        {staffObligations.length > 0 ? staffObligations.map((owed, idx) => (
                                            <div key={idx} className='flex items-center justify-between bg-background p-2.5 rounded-xl border shadow-sm'>
                                                <div className="flex items-center gap-2 min-w-0">
                                                    <Avatar className="h-7 w-7 rounded-lg border">
                                                        <AvatarImage src={owed.avatarUrl} className="object-cover" />
                                                        <AvatarFallback className="text-[8px] font-black">{(owed.name || 'S').charAt(0)}</AvatarFallback>
                                                    </Avatar>
                                                    <div className="min-w-0">
                                                        <p className="text-[10px] font-black uppercase tracking-tight truncate">{owed.name}</p>
                                                        <p className="text-[8px] text-muted-foreground uppercase font-bold tracking-widest mt-0.5">{owed.details}</p>
                                                    </div>
                                                </div>
                                                <span className="font-mono font-black text-xs md:text-sm ml-2">${owed.amount.toFixed(2)}</span>
                                            </div>
                                        )) : <p className="text-[9px] text-muted-foreground uppercase font-bold text-center py-4 border-2 border-dashed rounded-xl opacity-40">No staff earnings</p>}
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
        <p className="text-xs font-black uppercase tracking-tight text-slate-900 truncate">{bill.definition?.name || 'Unknown Bill'}</p>
        <div className="flex items-center gap-2 mt-0.5">
          <span className={cn('text-[9px] font-black uppercase tracking-widest', bill.overdue ? 'text-destructive' : 'text-muted-foreground opacity-60')}>
            {bill.overdue
              ? `Overdue ${Math.abs(bill.daysUntil)}d`
              : bill.daysUntil === 0 ? 'Due today' : `Due ${fmt(bill.due, 'MMM d')}`}
          </span>
          <Badge className={cn('text-[8px] h-4 px-1.5 font-black uppercase tracking-widest border-none', bill.definition?.context === 'Business' ? 'bg-indigo-100 text-indigo-800' : 'bg-purple-100 text-purple-800')}>
            {bill.definition?.context || '—'}
          </Badge>
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
          <h1 className="text-2xl md:text-3xl font-black uppercase tracking-tighter text-slate-900">Bills & Obligations</h1>
          <p className="text-[10px] md:text-sm text-muted-foreground font-medium uppercase tracking-widest opacity-70">
            Every unpaid instance across business & personal
          </p>
        </div>

        {/* ── Summary cards ── */}
        <div className="grid grid-cols-3 gap-3 md:gap-4">
          <Card className={cn('border-2 shadow-sm', overdueTotal > 0 ? 'bg-destructive/5 border-destructive/20' : 'bg-muted/20')}>
            <CardContent className="p-4 md:p-5">
              <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground mb-1">Overdue</p>
              <p className={cn('text-lg md:text-2xl font-black font-mono tracking-tighter', overdueTotal > 0 ? 'text-destructive' : 'text-slate-900')}>${overdueTotal.toFixed(2)}</p>
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

        {/* ── Business vs Personal strip ── */}
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

        {/* ── Bill groups ── */}
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

      {/* ── Pay confirmation dialog ── */}
      <AlertDialog open={!!billToPay} onOpenChange={o => { if (!o) setBillToPay(null); }}>
        <AlertDialogContent className="rounded-[3rem] border-4 shadow-3xl bg-background">
          <AlertDialogHeader className="p-6 pb-0">
            <AlertDialogTitle className="font-black uppercase tracking-tighter text-2xl">Mark Bill Paid</AlertDialogTitle>
            <AlertDialogDescription className="font-bold text-sm text-slate-600 leading-relaxed uppercase tracking-tight">
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

type HubTab = 'overview' | 'ledger' | 'payday' | 'bills' | 'activity';

type OverviewPreset = '7days' | '30days' | 'thisMonth';

const OverviewTab = ({ onNavigate }: { onNavigate: (tab: HubTab) => void }) => {
  const { billDefinitions, billInstances, transactions: rawTransactions, staff, activityLogs, isLoading } = useInventory();
  const { firestore } = useFirebase();
  const { selectedTenant } = useTenant();
  const tenantId = selectedTenant?.id;

  // Latest audit entries for the "what just happened" card
  const [recentActivity, setRecentActivity] = useState<any[]>([]);
  useEffect(() => {
    if (!firestore || !tenantId) return;
    const q = query(collection(firestore, `tenants/${tenantId}/auditLogs`), orderBy('at', 'desc'), limit(3));
    const unsub = onSnapshot(q, snap => setRecentActivity(snap.docs.map(d => d.data() as any)), () => setRecentActivity([]));
    return () => unsub();
  }, [firestore, tenantId]);

  const transactions = useMemo(() => (rawTransactions || []).map((t: any) => ({
    ...t,
    amount:   typeof t.amount === 'number' ? t.amount : (Number(t.amountCents) || 0) / 100,
    type:     t.type || 'income',
    context:  t.context || 'Business',
    category: t.category || 'Uncategorized',
  })), [rawTransactions]);

  const [preset, setPreset] = useState<OverviewPreset>('thisMonth');

  const range = useMemo(() => {
    const now = new Date();
    if (preset === '7days')  return { from: startOfDay(subDays(now, 6)),  to: endOfDay(now) };
    if (preset === '30days') return { from: startOfDay(subDays(now, 29)), to: endOfDay(now) };
    return { from: startOfMonth(now), to: endOfMonth(now) };
  }, [preset]);

  const periodTxns = useMemo(() => transactions.filter((t: any) => {
    const d = safeDate(t.date);
    return d >= range.from && d <= range.to;
  }), [transactions, range]);

  const summary = useMemo(() => {
    const taxLiability = periodTxns.filter((t: any) => t.type === 'income' && t.category === 'Tax Collected').reduce((s: number, t: any) => s + t.amount, 0);
    const revenue      = periodTxns.filter((t: any) => t.type === 'income' && t.category !== 'Tax Collected').reduce((s: number, t: any) => s + t.amount, 0);
    const expenses     = periodTxns.filter((t: any) => t.type === 'expense' || t.type === 'payment').reduce((s: number, t: any) => s + t.amount, 0);
    const tips         = periodTxns.filter((t: any) => t.category === 'Tips').reduce((s: number, t: any) => s + t.amount, 0);
    const net = revenue - expenses;
    return { revenue, expenses, net, taxLiability, tips };
  }, [periodTxns]);

  const dailyRevenueData = useMemo(() => {
    const days = eachDayOfInterval({ start: range.from, end: range.to });
    if (days.length > 60) return [];
    return days.map(day =>
      periodTxns
        .filter((t: any) => t.type === 'income' && t.category !== 'Tax Collected' && isSameDay(safeDate(t.date), day))
        .reduce((s: number, t: any) => s + t.amount, 0)
    );
  }, [periodTxns, range]);

  // ── Staff owed this period (same math as Payday tab) ──
  const staffTotalOwed = useMemo(() => {
    if (!staff) return 0;
    return staff.reduce((total: number, member: any) => {
      const staffTxns = periodTxns.filter((t: any) => t.staffId === member.id && t.type === 'income');
      const serviceRevenue = staffTxns.filter((t: any) => t.category === 'Service Revenue').reduce((s: number, t: any) => s + t.amount, 0);
      const retailSales    = staffTxns.filter((t: any) => t.category === 'Retail').reduce((s: number, t: any) => s + t.amount, 0);
      const tips           = staffTxns.filter((t: any) => t.category === 'Tips' || t.tipAmount).reduce((s: number, t: any) => s + (t.tipAmount || t.amount), 0);
      let earnings = 0;
      if (member.payStructure === 'commission') {
        earnings = (serviceRevenue * ((member.commissionRate || 40) / 100)) +
                   (member.retailCommissionRate ? (retailSales * (member.retailCommissionRate / 100)) : 0);
      } else if (member.payStructure === 'hourly' && member.hourlyRate) {
        const logs = (activityLogs || []).filter((l: any) =>
          l.staffId === member.id && safeDate(l.timestamp) >= range.from && safeDate(l.timestamp) <= range.to);
        const totalMinutes = logs.reduce((acc: number, l: any) => acc + (l.durationMinutes || 0), 0);
        earnings = (totalMinutes / 60) * member.hourlyRate;
      }
      return total + earnings + tips;
    }, 0);
  }, [staff, periodTxns, activityLogs, range]);

  // ── Bills snapshot (all unpaid, not just this period) ──
  const billsSnapshot = useMemo(() => {
    const today = startOfDay(new Date());
    const unpaid = (billInstances || [])
      .filter((i: any) => i.status !== 'paid')
      .map((i: any) => ({ i, def: (billDefinitions || []).find((d: any) => d.id === i.billDefinitionId), due: safeDate(i.dueDate) }))
      .filter((x: any) => x.def);
    const total   = unpaid.reduce((s: number, x: any) => s + (x.def.amount || 0), 0);
    const overdue = unpaid.filter((x: any) => x.due < today);
    const overdueTotal = overdue.reduce((s: number, x: any) => s + (x.def.amount || 0), 0);
    const business = unpaid.filter((x: any) => x.def.context === 'Business').reduce((s: number, x: any) => s + (x.def.amount || 0), 0);
    const personal = unpaid.filter((x: any) => x.def.context === 'Personal').reduce((s: number, x: any) => s + (x.def.amount || 0), 0);
    return { count: unpaid.length, total, overdueCount: overdue.length, overdueTotal, business, personal };
  }, [billInstances, billDefinitions]);

  const totalObligations = staffTotalOwed + billsSnapshot.total;
  const safeToAllocate = Math.max(0, summary.net - totalObligations);

  if (isLoading) {
    return (
      <div className="p-4 md:p-8 flex items-center justify-center min-h-[50vh]">
        <Loader className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8">
      <div className="max-w-4xl mx-auto space-y-8">

        {/* ── Header + period pills ── */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl md:text-3xl font-black uppercase tracking-tighter text-slate-900 leading-none">Money Overview</h1>
            <p className="text-[10px] md:text-sm text-muted-foreground font-medium uppercase tracking-widest opacity-70 mt-1">
              {format(range.from, 'MMM d')} – {format(range.to, 'MMM d, yyyy')}
            </p>
          </div>
          <div className="flex gap-1.5 p-1.5 bg-muted border-2 border-muted rounded-2xl shadow-inner">
            {([['7days', '7 Days'], ['30days', '30 Days'], ['thisMonth', 'This Month']] as [OverviewPreset, string][]).map(([v, l]) => (
              <Button key={v} variant="ghost" size="sm" onClick={() => setPreset(v)} className={cn('text-[9px] font-black uppercase h-8 px-3 rounded-xl transition-all', preset === v ? 'bg-white shadow-sm border border-border/50' : 'hover:bg-white/50')}>{l}</Button>
            ))}
          </div>
        </div>

        {/* ── KPI grid ── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard
            label="Money In"
            value={fmtCurrency(summary.revenue)}
            icon={TrendingUp}
            accent="bg-green-100 text-green-700"
            sparkData={dailyRevenueData}
            trend="up"
            trendLabel="Net revenue"
          />
          <StatCard
            label="Money Out"
            value={fmtCurrency(summary.expenses)}
            icon={TrendingDown}
            accent="bg-red-100 text-red-600"
            sub="Expenses & payments"
          />
          <StatCard
            label="Net Income"
            value={fmtCurrency(summary.net)}
            icon={DollarSign}
            accent={summary.net >= 0 ? 'bg-primary/10 text-primary' : 'bg-destructive/10 text-destructive'}
            trend={summary.net >= 0 ? 'up' : 'down'}
            trendLabel={summary.net >= 0 ? 'Profitable' : 'Net loss'}
          />
          <StatCard
            label="Tax Held"
            value={fmtCurrency(summary.taxLiability)}
            icon={AlertCircle}
            accent="bg-slate-100 text-slate-500"
            sub="Not your income"
          />
        </div>

        {/* ── Safe to allocate banner ── */}
        <Card className={cn('border-2 shadow-xl overflow-hidden', safeToAllocate > 0 ? 'bg-primary/5 border-primary/20' : 'bg-destructive/5 border-destructive/20')}>
          <CardContent className="p-6 md:p-8 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className={cn('p-3.5 rounded-2xl', safeToAllocate > 0 ? 'bg-primary/10' : 'bg-destructive/10')}>
                <PiggyBank className={cn('w-6 h-6', safeToAllocate > 0 ? 'text-primary' : 'text-destructive')} />
              </div>
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-60">Safe to Allocate</p>
                <p className={cn('text-3xl md:text-4xl font-black font-mono tracking-tighter', safeToAllocate > 0 ? 'text-primary' : 'text-destructive')}>
                  {fmtCurrency(safeToAllocate)}
                </p>
                <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground opacity-60 mt-1">
                  Period net {fmtCurrency(summary.net)} − obligations {fmtCurrency(totalObligations)}
                </p>
              </div>
            </div>
            <Button onClick={() => onNavigate('payday')} className="h-12 px-6 rounded-2xl font-black uppercase text-[10px] tracking-widest shadow-xl shadow-primary/20 w-full md:w-auto">
              Run Payday <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </CardContent>
        </Card>

        {/* ── Obligations + Bills snapshot ── */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card className="border-2 shadow-sm rounded-3xl overflow-hidden">
            <CardHeader className="p-5 border-b bg-muted/5">
              <CardTitle className="text-xs font-black uppercase tracking-widest flex items-center gap-2">
                <Users className="w-4 h-4 text-primary" /> Obligations
              </CardTitle>
            </CardHeader>
            <CardContent className="p-5 space-y-3">
              {[
                ['Staff earnings owed', staffTotalOwed, 'text-primary'],
                ['Business bills', billsSnapshot.business, 'text-blue-600'],
                ['Personal needs', billsSnapshot.personal, 'text-purple-600'],
              ].map(([label, val, cls]) => (
                <div key={label as string} className="flex justify-between items-center text-xs font-bold">
                  <span className="uppercase tracking-widest text-muted-foreground opacity-70 text-[10px]">{label as string}</span>
                  <span className={cn('font-mono font-black', cls as string)}>{fmtCurrency(val as number)}</span>
                </div>
              ))}
              <div className="flex justify-between items-center pt-3 border-t-2 border-dashed">
                <span className="font-black uppercase text-[10px] tracking-widest">Total</span>
                <span className="font-mono font-black text-lg tracking-tighter">{fmtCurrency(totalObligations)}</span>
              </div>
            </CardContent>
            <CardFooter className="p-5 pt-0">
              <Button variant="outline" onClick={() => onNavigate('payday')} className="w-full h-11 rounded-2xl border-2 font-black uppercase text-[9px] tracking-widest">
                <Banknote className="w-4 h-4 mr-2 text-primary" /> Reconcile & Pay Out
              </Button>
            </CardFooter>
          </Card>

          <Card className={cn('border-2 shadow-sm rounded-3xl overflow-hidden', billsSnapshot.overdueCount > 0 && 'border-destructive/30')}>
            <CardHeader className="p-5 border-b bg-muted/5">
              <CardTitle className="text-xs font-black uppercase tracking-widest flex items-center gap-2">
                <Landmark className="w-4 h-4 text-primary" /> Bills
              </CardTitle>
            </CardHeader>
            <CardContent className="p-5 space-y-3">
              {billsSnapshot.overdueCount > 0 ? (
                <div className="flex items-center justify-between px-4 py-3 rounded-2xl bg-destructive/5 border-2 border-destructive/20">
                  <div className="flex items-center gap-2 text-destructive">
                    <AlertCircle className="w-4 h-4" />
                    <span className="text-[10px] font-black uppercase tracking-widest">{billsSnapshot.overdueCount} overdue</span>
                  </div>
                  <span className="font-mono font-black text-destructive">{fmtCurrency(billsSnapshot.overdueTotal)}</span>
                </div>
              ) : (
                <div className="flex items-center gap-2 px-4 py-3 rounded-2xl bg-green-50 border-2 border-green-200 text-green-700">
                  <CheckCircle2 className="w-4 h-4" />
                  <span className="text-[10px] font-black uppercase tracking-widest">Nothing overdue</span>
                </div>
              )}
              <div className="flex justify-between items-center pt-3 border-t-2 border-dashed">
                <span className="font-black uppercase text-[10px] tracking-widest">{billsSnapshot.count} unpaid</span>
                <span className="font-mono font-black text-lg tracking-tighter">{fmtCurrency(billsSnapshot.total)}</span>
              </div>
            </CardContent>
            <CardFooter className="p-5 pt-0">
              <Button variant="outline" onClick={() => onNavigate('bills')} className="w-full h-11 rounded-2xl border-2 font-black uppercase text-[9px] tracking-widest">
                <Landmark className="w-4 h-4 mr-2 text-primary" /> View All Bills
              </Button>
            </CardFooter>
          </Card>
        </div>

        {/* ── Tips strip + ledger shortcut ── */}
        {summary.tips > 0 && (
          <div className="flex items-center justify-between px-5 py-3.5 rounded-2xl bg-amber-50 border-2 border-amber-200">
            <div className="flex items-center gap-2 text-amber-800">
              <DollarSign className="w-4 h-4" />
              <span className="text-xs font-black uppercase tracking-widest">Tips this period</span>
            </div>
            <span className="font-mono font-black text-lg text-amber-800">{fmtCurrency(summary.tips)}</span>
          </div>
        )}

        {/* ── What just happened — live pulse of the business ── */}
        {recentActivity.length > 0 && (
          <Card className="border-2 shadow-sm rounded-3xl overflow-hidden">
            <CardHeader className="p-5 border-b bg-muted/5">
              <div className="flex items-center justify-between">
                <CardTitle className="text-xs font-black uppercase tracking-widest flex items-center gap-2">
                  <History className="w-4 h-4 text-primary" /> Latest Activity
                </CardTitle>
                <Button variant="link" onClick={() => onNavigate('activity')} className="h-auto p-0 text-[9px] font-black uppercase text-primary underline underline-offset-4">
                  View All
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-4 space-y-2">
              {recentActivity.map((e, i) => <ActivityRow key={e.id || i} e={e} />)}
            </CardContent>
          </Card>
        )}

        <Button variant="ghost" onClick={() => onNavigate('ledger')} className="w-full h-14 rounded-2xl border-2 border-dashed font-black uppercase text-[10px] tracking-widest text-muted-foreground hover:text-primary hover:border-primary/30">
          <BookOpen className="w-4 h-4 mr-2" /> Open the Full Ledger <ArrowRight className="w-4 h-4 ml-2" />
        </Button>
      </div>
    </div>
  );
};

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
  ACTIVITY_KINDS[(action || '').split('.')[0]] || { icon: ShieldCheck, cls: 'bg-slate-100 text-slate-600', label: 'Other' };

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
        <p className="text-xs font-bold text-slate-800 mt-1 leading-relaxed">{e.summary}</p>
      </div>
      {typeof e.amount === 'number' && (
        <span className="font-mono font-black text-sm tracking-tighter text-slate-900 shrink-0 mt-0.5">
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
          <h1 className="text-2xl md:text-3xl font-black uppercase tracking-tighter text-slate-900">Activity</h1>
          <p className="text-[10px] md:text-sm text-muted-foreground font-medium uppercase tracking-widest opacity-70">
            Everything happening in your business — people & automations
          </p>
        </div>

        {/* ── Filters: team member + kind pills ── */}
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
                  kindFilter === k ? 'bg-white shadow-sm border border-border/50' : 'hover:bg-white/50')}>
                {k === 'all' ? 'All' : ACTIVITY_KINDS[k].label}
              </Button>
            ))}
          </div>
        </div>

        {/* ── Feed ── */}
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

const HUB_TABS: { key: HubTab; label: string; icon: React.ElementType }[] = [
  { key: 'overview', label: 'Overview', icon: LayoutDashboard },
  { key: 'ledger',   label: 'Ledger',   icon: BookOpen },
  { key: 'payday',   label: 'Payday',   icon: Banknote },
  { key: 'bills',    label: 'Bills',    icon: Landmark },
  { key: 'activity', label: 'Activity', icon: History },
];

const VALID_TABS: HubTab[] = ['overview', 'ledger', 'payday', 'bills', 'activity'];

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

  const handleTabChange = (tab: HubTab) => {
    setActiveTab(tab);
    setVisitedTabs(prev => (prev.has(tab) ? prev : new Set(prev).add(tab)));
    // Keep the URL shareable without triggering a Next.js navigation
    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', tab === 'overview' ? '/money' : `/money?tab=${tab}`);
    }
  };

  return (
    <div className="flex min-h-screen w-full flex-col overflow-x-hidden bg-background">
      <AppHeader title="Money Hub" />

      {/* ── Tab bar ── */}
      <div className="sticky top-0 z-30 bg-background/95 backdrop-blur border-b-2 px-4 py-3">
        <div className="max-w-lg mx-auto flex gap-1.5 p-1.5 bg-muted border-2 border-muted rounded-2xl shadow-inner">
          {HUB_TABS.map(({ key, label, icon: Icon }) => (
            <Button
              key={key}
              variant="ghost"
              size="sm"
              onClick={() => handleTabChange(key)}
              className={cn(
                'flex-1 h-9 rounded-xl text-[9px] md:text-[10px] font-black uppercase tracking-widest transition-all gap-1.5',
                activeTab === key ? 'bg-white shadow-sm border border-border/50 text-primary' : 'hover:bg-white/50 text-muted-foreground'
              )}
            >
              <Icon className="w-3.5 h-3.5 shrink-0" />
              <span className="hidden sm:inline">{label}</span>
            </Button>
          ))}
        </div>
      </div>

      {/* ── Tab panels — lazy-mounted on first visit, then kept alive so
             filters & state survive tab switches ── */}
      <main className="flex-1 w-full">
        {visitedTabs.has('overview') && <div className={cn(activeTab !== 'overview' && 'hidden')}><OverviewTab onNavigate={handleTabChange} /></div>}
        {visitedTabs.has('ledger')   && <div className={cn(activeTab !== 'ledger'   && 'hidden')}><LedgerTab /></div>}
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
