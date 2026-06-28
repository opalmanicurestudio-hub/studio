'use client';

import React, { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import { format, differenceInMinutes, parseISO, differenceInSeconds, formatDistanceToNow } from 'date-fns';
import {
  Award, DollarSign, Clock, FileText, Edit, Trash2, Mail, Phone,
  User as UserIcon, Play, Square, Link as LinkIcon, MapPin, PlusCircle,
  ShieldCheck, Ban, Wallet, ShieldAlert, Sparkles, Loader, Users,
  AlertTriangle, Undo2, FileSignature, CheckCircle2, ArrowRight, MessageSquare,
  Ear, Unlock, Scale, FileImage, Maximize2, Zap, FlaskConical, Target,
  RefreshCw, History, HeartHandshake, AlertCircle, BookMarked, Heart,
  CreditCard, CalendarClock, MoreHorizontal, HeartPulse,
  Calendar, Camera, UserX, Globe, Receipt, Send, Bell, Copy, Check,
  Printer, StickyNote, TrendingUp, Gift, ChevronRight, Star, ExternalLink,
  PenLine, ImagePlus, Expand, X, Hash, Info, BadgePercent, ArrowUpRight,
  BarChart2, Repeat2, UserCheck, Clock3, Activity,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter,
} from '@/components/ui/sheet';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Label } from '../ui/label';
import { cn, safeNumber } from '@/lib/utils';
import { useIsMobile } from '@/hooks/use-mobile';
import { type Appointment, type Client, type Service, type Staff, type AppointmentCheckoutState, type ConsentForm } from '@/lib/data';
import { ScrollArea } from '@/components/ui/scroll-area';
import Link from 'next/link';
import { useInventory } from '@/context/InventoryContext';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import { useTenant } from '@/context/TenantContext';
import { useToast } from '@/hooks/use-toast';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { useFirebase, updateDocumentNonBlocking, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { collection, doc, increment, writeBatch, arrayUnion, deleteField, query, where, orderBy, limit } from 'firebase/firestore';
import { motion, AnimatePresence } from 'framer-motion';
import { AddAndConfigurePartsDialog } from './AddAndConfigurePartsDialog';
import { RescheduleAppointmentDialog } from './RescheduleAppointmentDialog';
import { formatPhoneNumber } from 'react-phone-number-input';
import { nanoid } from 'nanoid';
import { Separator } from '../ui/separator';
import { Switch } from '../ui/switch';
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { Textarea } from '../ui/textarea';
import { Input } from '../ui/input';
import NextImage from 'next/image';
import { ImageMarkupDialog } from '../shared/ImageMarkupDialog';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { computeDepositCents } from '@/lib/deposit-policy';
import { StoreCreditBadge } from '@/components/StoreCreditBadge';
import { StoreCreditSection } from '@/components/appointments/StoreCreditSection';
import { useStoreCredit } from '@/hooks/useStoreCredit';
import { useDepositCredit } from '@/hooks/useDepositCredit';

// ─── Utility helpers ──────────────────────────────────────────────────────────

const safeDate = (val: any): Date => {
  if (!val) return new Date();
  if (val instanceof Date) return val;
  if (typeof val === 'string') return parseISO(val);
  if (typeof val === 'object' && 'seconds' in val) return new Date(val.seconds * 1000);
  if (typeof val === 'object' && typeof val.toDate === 'function') return val.toDate();
  return new Date(val);
};

const safeFormatPhone = (phone: any): string => {
  if (!phone || typeof phone !== 'string') return String(phone || '');
  try { return formatPhoneNumber(phone) || phone; } catch { return phone; }
};

const safeTicketId = (id: any): string => {
  if (typeof id === 'string' && id.length > 0) return id.slice(-6).toUpperCase();
  if (typeof id === 'number') return String(id).slice(-6).toUpperCase();
  return 'N/A';
};

const staffName = (staffId: any, staffList: any[], fallback = 'Staff'): string => {
  if (!staffId) return fallback;
  if (staffId === 'client') return 'Client';
  if (staffId === 'system') return 'System';
  const match = (staffList || []).find((s: any) => s.id === staffId);
  return match?.name || String(staffId).slice(-4).toUpperCase();
};

const isValidDate = (d: Date) => d instanceof Date && !isNaN(d.getTime());

// Single source of truth for "was this visit a no-show" — checks the modern
// audit trail first, falls back to the legacy flat fields for older records.
const isNoShowVisit = (a: any): boolean => {
  if (a?.cancellationAudit?.actorType === 'no_show') return true;
  if (a?.status === 'cancelled' && a?.cancellationReason === 'no-show') return true;
  if (a?.noShowConfirmedAt) return true;
  return false;
};

// ─── Copy-to-clipboard hook ────────────────────────────────────────────────────
const useCopyToClipboard = (timeout = 2000) => {
  const [copied, setCopied] = useState(false);
  const copy = useCallback((text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), timeout);
    });
  }, [timeout]);
  return { copied, copy };
};

// ─── Visit frequency sparkline ────────────────────────────────────────────────
const VisitSparkline = ({ visits }: { visits: any[] }) => {
  if (!visits || visits.length < 2) return null;
  const sorted = [...visits].sort((a, b) => safeDate(a.startTime).getTime() - safeDate(b.startTime).getTime());
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const diff = differenceInMinutes(safeDate(sorted[i].startTime), safeDate(sorted[i - 1].startTime));
    gaps.push(diff);
  }
  const max = Math.max(...gaps);
  const w = 80, h = 24;
  const pts = gaps.map((g, i) => {
    const x = (i / (gaps.length - 1 || 1)) * w;
    const y = h - (g / max) * (h - 4);
    return `${x},${y}`;
  }).join(' ');
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="opacity-60">
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-primary" />
      {gaps.map((_, i) => {
        const x = (i / (gaps.length - 1 || 1)) * w;
        const y = h - (gaps[i] / max) * (h - 4);
        return <circle key={i} cx={x} cy={y} r="2" fill="currentColor" className="text-primary" />;
      })}
    </svg>
  );
};

// ─── Multi-provider resolution ────────────────────────────────────────────────
// Resolves the full set of staff involved in an appointment right now —
// the lead provider plus anyone assigned to add-ons via serviceStaffOverrides.
// Because lead handoffs write straight to appointment.staffId, this always
// reflects the *current* lead without needing to know handoff history.
type ProviderInfo = {
  staffId: string;
  staffMember: any;
  services: { id: string; name: string; isConcurrent: boolean }[];
  isMain: boolean;
};

const resolveProviders = (appointment: any, service: any, addOns: Service[], staffList: any[]): ProviderInfo[] => {
  if (!appointment || !service) return [];
  const overrides = appointment.checkoutState?.serviceStaffOverrides || {};
  const concurrentIds: string[] = appointment.checkoutState?.concurrentServiceIds || [];
  const map = new Map<string, ProviderInfo>();

  const addService = (svcId: string, svcName: string, staffId: string) => {
    if (!staffId) return;
    const isConcurrent = concurrentIds.includes(svcId);
    const entry = map.get(staffId) || {
      staffId,
      staffMember: (staffList || []).find((s: any) => s.id === staffId),
      services: [],
      isMain: false,
    };
    entry.services.push({ id: svcId, name: svcName, isConcurrent });
    map.set(staffId, entry);
  };

  addService(service.id, service.name, appointment.staffId);
  const mainEntry = map.get(appointment.staffId);
  if (mainEntry) mainEntry.isMain = true;

  (addOns || []).forEach((s) => {
    const assignedStaffId = overrides[s.id] || appointment.staffId;
    addService(s.id, s.name, assignedStaffId);
  });

  return Array.from(map.values());
};

// ─── Timeline builder ─────────────────────────────────────────────────────────
type TimelineEvent = {
  id: string; timestamp: string; icon: any;
  label: string; detail?: string; tone?: 'good' | 'warn' | 'bad';
};
const TIMELINE_TONE: Record<string, string> = {
  good: 'text-green-600', warn: 'text-amber-600', bad: 'text-destructive', default: 'text-slate-600',
};
const TIMELINE_BG: Record<string, string> = {
  good: 'bg-green-500', warn: 'bg-amber-500', bad: 'bg-destructive', default: 'bg-slate-400',
};

const buildTimelineEvents = (opts: {
  appointment: any; transactions: any[]; cancellationEvent: any;
  depositDecision: any; auditLogEntries: any[]; staff: any[];
}): TimelineEvent[] => {
  const { appointment, transactions, cancellationEvent, depositDecision, auditLogEntries, staff } = opts;
  if (!appointment) return [];
  const events: TimelineEvent[] = [];
  const push = (ts: any, icon: any, label: string, detail?: string, tone?: 'good' | 'warn' | 'bad') => {
    if (!ts) return;
    let iso: string;
    try { iso = typeof ts === 'string' ? ts : safeDate(ts).toISOString(); } catch { return; }
    events.push({ id: `${label}-${iso}-${events.length}`, timestamp: iso, icon, label, detail, tone });
  };

  // Resolve whether this appointment involves more than one staff member at
  // all, so we can annotate session start/finish with who the lead was —
  // useful once a mid-session handoff has happened and "the staff member"
  // is no longer a single unambiguous answer.
  const allStaffIdsInvolved = new Set<string>([
    appointment.staffId,
    ...Object.values(appointment.checkoutState?.serviceStaffOverrides || {}),
  ].filter(Boolean) as string[]);
  const isMultiProvider = allStaffIdsInvolved.size > 1;

  if (appointment.createdAt) push(appointment.createdAt, Calendar, 'Appointment booked',
    appointment.source === 'online' ? 'Online booking' : (appointment.isWalkIn || appointment.source === 'walk-in') ? 'Walk-in' : 'Manual entry');

  const auto = appointment.automationState || {};
  if (auto.depositReminderSentAt) push(auto.depositReminderSentAt, Bell, 'Deposit reminder sent');
  if (auto.formReminderSentAt) push(auto.formReminderSentAt, Bell, 'Consent form reminder sent');
  if (auto.cardReminderSentAt) push(auto.cardReminderSentAt, Bell, 'Card-on-file reminder sent');
  if (auto.photoReminderSentAt) push(auto.photoReminderSentAt, Bell, 'Reference photo reminder sent');
  if (auto.balanceNotifiedAt) push(auto.balanceNotifiedAt, Bell, 'Outstanding balance notice sent');
  if (appointment.healthDisclosedAt) push(appointment.healthDisclosedAt, HeartPulse, 'Health disclosure completed');

  // Provider assignments — both booking-time add-on assignments and
  // mid-session handoffs, each carrying its own real timestamp so the
  // timeline can reconstruct who actually worked the session and when,
  // rather than only reflecting whatever the current-state overrides say.
  (appointment.providerAssignments || []).forEach((pa: any) => {
    if (pa.isMidServiceHandoff) {
      push(
        pa.assignedAt,
        Repeat2,
        `Mid-session handoff — ${pa.serviceName || 'Service'} to ${staffName(pa.staffId, staff)}`,
        [pa.previousStaffId ? `From ${staffName(pa.previousStaffId, staff)}` : null, pa.reason ? `"${pa.reason}"` : null]
          .filter(Boolean).join(' · ') || undefined,
        'warn',
      );
    } else {
      push(
        pa.assignedAt,
        Users,
        `${pa.serviceName || 'Add-on'} assigned to ${staffName(pa.staffId, staff)}`,
        pa.isConcurrent ? 'Running concurrently with lead service' : undefined,
      );
    }
  });

  const depositTxn = (transactions || []).find((t: any) =>
    t.appointmentId === appointment.id && (t.category === 'Retainers' || /deposit/i.test(String(t.description || ''))));
  if (depositTxn) push(depositTxn.date || depositTxn.createdAt, Wallet, 'Deposit collected', `$${safeNumber(depositTxn.amount).toFixed(2)}`, 'good');

  if (appointment.checkInStatusTimestamp) push(appointment.checkInStatusTimestamp, MapPin, `Checked in — ${String(appointment.checkInStatus || '').replace(/_/g, ' ')}`);
  if (appointment.suspectedNoShowAt) push(appointment.suspectedNoShowAt, AlertCircle, 'Flagged as suspected no-show', appointment.lateTimeMinutes ? `${appointment.lateTimeMinutes}m past start` : undefined, 'warn');
  if (appointment.noShowEscalatedAt) push(appointment.noShowEscalatedAt, ShieldAlert, 'No-show escalated to manager', undefined, 'warn');
  if (appointment.suspectedNoShowClearedAt) push(appointment.suspectedNoShowClearedAt, CheckCircle2, 'No-show flag cleared', appointment.suspectedNoShowClearedBy ? `by ${staffName(appointment.suspectedNoShowClearedBy, staff)}` : undefined, 'good');
  if (appointment.noShowConfirmedAt) push(appointment.noShowConfirmedAt, UserX, 'No-show confirmed', appointment.noShowConfirmedBy ? `by ${staffName(appointment.noShowConfirmedBy, staff)}` : undefined, 'bad');

  if (appointment.actualStartTime) push(appointment.actualStartTime, Play, 'Session started',
    isMultiProvider ? `Lead: ${staffName(appointment.staffId, staff)}` : undefined);
  if (appointment.actualEndTime) push(appointment.actualEndTime, Square, 'Session finished',
    isMultiProvider ? `Lead: ${staffName(appointment.staffId, staff)}` : undefined, 'good');

  if (appointment.lastRescheduledAt) push(appointment.lastRescheduledAt, RefreshCw,
    `Rescheduled${appointment.rescheduleCount ? ` (×${appointment.rescheduleCount})` : ''}`,
    appointment.lastRescheduledBy ? `by ${staffName(appointment.lastRescheduledBy, staff)}` : undefined);
  if (appointment.incident?.date) push(appointment.incident.date, AlertCircle,
    `Incident logged — ${appointment.incident.type}`, appointment.incident.severity,
    appointment.incident.severity === 'Severe' ? 'bad' : 'warn');

  const cancelAuditEntry = (auditLogEntries || []).find((a: any) => a.entityType === 'appointment_cancellation');
  if (cancelAuditEntry) {
    push(cancelAuditEntry.timestamp, Ban, cancelAuditEntry.summary || 'Appointment cancelled', undefined, 'bad');
  } else if (appointment.cancelledAt) {
    push(appointment.cancelledAt, Ban,
      `Cancelled${appointment.cancellationReason ? ` — ${String(appointment.cancellationReason).replace(/_/g, ' ')}` : ''}`,
      undefined, 'bad');
  }

  const chargeOutcomeKnown = !!cancellationEvent?.chargeStatus;
  if (cancellationEvent) {
    if (cancellationEvent.createdAt) push(cancellationEvent.createdAt, Send, 'Cancellation pipeline started');
    if (cancellationEvent.processedAt) {
      const map: Record<string, string> = { charged: 'Card charged', failed: 'Card charge failed', uncollected: 'No card on file — added to balance', waived: 'Fee waived', balance: 'Added to balance' };
      push(cancellationEvent.processedAt,
        cancellationEvent.chargeStatus === 'charged' ? CheckCircle2 : AlertTriangle,
        map[cancellationEvent.chargeStatus] || 'Cancellation pipeline processed',
        undefined,
        cancellationEvent.chargeStatus === 'charged' ? 'good' : (cancellationEvent.chargeStatus === 'failed' || cancellationEvent.chargeStatus === 'uncollected') ? 'bad' : undefined);
    }
  }

  if (appointment.depositForfeitedAt) push(appointment.depositForfeitedAt, Ban, 'Deposit forfeited', appointment.depositForfeitedReason, 'bad');
  if (appointment.depositConvertedToCreditAt) push(appointment.depositConvertedToCreditAt, HeartHandshake, 'Deposit converted to store credit', undefined, 'good');
  if (appointment.depositRefundedAt) push(appointment.depositRefundedAt, Wallet, 'Deposit refunded', `$${(safeNumber(appointment.depositRefundedAmountCents) / 100).toFixed(2)}`, 'good');
  if (depositDecision?.decidedAt) push(depositDecision.decidedAt, Wallet, `Deposit decision: ${String(depositDecision.outcome || '').replace(/_/g, ' ')}`, depositDecision.amountDollars ? `$${safeNumber(depositDecision.amountDollars).toFixed(2)}` : undefined);
  if (depositDecision?.resolvedAt) push(depositDecision.resolvedAt, CheckCircle2, `Refund decision resolved — ${String(depositDecision.outcome || '').replace(/_/g, ' ')}`, depositDecision.resolvedBy ? `by ${staffName(depositDecision.resolvedBy, staff)}` : undefined, 'good');
  if (appointment.waivedAt) push(appointment.waivedAt, HeartHandshake, 'Cancellation fee waived', appointment.waivedBy ? `by ${staffName(appointment.waivedBy, staff)}` : undefined, 'good');
  if (!appointment.isEscalated && appointment.resolvedAt) push(appointment.resolvedAt, CheckCircle2, 'Escalation resolved', appointment.resolvedBy ? `by ${staffName(appointment.resolvedBy, staff)}` : undefined, 'good');

  // Session notes added inline
  if (appointment.sessionNote?.addedAt) push(appointment.sessionNote.addedAt, StickyNote, 'Session note added', appointment.sessionNote.addedBy ? `by ${staffName(appointment.sessionNote.addedBy, staff)}` : undefined);

  (transactions || []).forEach((t: any) => {
    if (t.appointmentId !== appointment.id) return;
    if (t === depositTxn) return;
    const isCancellationFeeTxn = String(t.category || '').toLowerCase().includes('cancellation');
    if (isCancellationFeeTxn && chargeOutcomeKnown) return;
    push(t.date || t.createdAt, DollarSign, t.description || t.category || 'Transaction',
      `${t.type === 'income' ? '+' : (t.type === 'refund' || t.type === 'reversal') ? '−' : ''}$${Math.abs(safeNumber(t.amount)).toFixed(2)}`);
  });

  return events
    .filter(e => e.timestamp)
    .sort((a, b) => safeDate(a.timestamp).getTime() - safeDate(b.timestamp).getTime());
};

// ─── Requirement row ───────────────────────────────────────────────────────────
type RowStatus = 'good' | 'warn' | 'bad' | 'neutral';
const STATUS_TEXT: Record<RowStatus, string> = {
  good: 'text-green-600', warn: 'text-amber-600', bad: 'text-destructive', neutral: 'text-muted-foreground opacity-50',
};
const RequirementRow = ({ icon, label, value, status, action }: {
  icon: React.ReactNode; label: string; value: React.ReactNode; status: RowStatus; action?: React.ReactNode;
}) => (
  <div className="flex items-center justify-between gap-3 py-2.5">
    <span className="flex items-center gap-2 text-[10px] font-black uppercase tracking-wide text-muted-foreground">
      <span className="opacity-50">{icon}</span>{label}
    </span>
    <div className="flex items-center gap-2 shrink-0">
      <span className={cn('text-[10px] font-black uppercase tracking-tight font-mono', STATUS_TEXT[status])}>{value}</span>
      {action}
    </div>
  </div>
);

// ─── Client stats bar ─────────────────────────────────────────────────────────
const ClientStatsBar = ({ client, recentVisits, allVisits }: { client: any; recentVisits: any[]; allVisits: any[] }) => {
  const visits = allVisits || [];
  const lifetimeSpend = safeNumber(client?.lifetimeValue || client?.lifetimeSpend);
  const visitCount = safeNumber(client?.totalVisits || visits.length);
  const noShowCount = visits.filter(isNoShowVisit).length;
  const avgSpend = visitCount > 0 && lifetimeSpend > 0 ? lifetimeSpend / visitCount : 0;

  const stats = [
    { label: 'Total visits', value: visitCount || '—', icon: <Calendar className="w-3 h-3" /> },
    { label: 'Lifetime spend', value: lifetimeSpend > 0 ? `$${lifetimeSpend.toLocaleString()}` : '—', icon: <TrendingUp className="w-3 h-3" /> },
    { label: 'Avg per visit', value: avgSpend > 0 ? `$${avgSpend.toFixed(0)}` : '—', icon: <BarChart2 className="w-3 h-3" /> },
    { label: 'No-shows', value: noShowCount > 0 ? noShowCount : '0', icon: <UserX className="w-3 h-3" />, warn: noShowCount > 1 },
  ];

  return (
    <div className="grid grid-cols-4 gap-2">
      {stats.map((s, i) => (
        <div key={i} className={cn(
          'rounded-xl p-2.5 text-center border-2',
          s.warn ? 'bg-red-50 border-red-100' : 'bg-muted/5 border-transparent'
        )}>
          <div className={cn('flex justify-center mb-1', s.warn ? 'text-destructive' : 'text-muted-foreground opacity-40')}>{s.icon}</div>
          <p className={cn('text-[12px] font-black font-mono leading-none', s.warn ? 'text-destructive' : 'text-slate-800')}>{s.value}</p>
          <p className="text-[8px] font-bold uppercase tracking-widest text-muted-foreground opacity-50 mt-0.5 leading-tight">{s.label}</p>
        </div>
      ))}
    </div>
  );
};

// ─── Session Note inline panel ────────────────────────────────────────────────
const SessionNotePanel = ({
  appointment, tenantId, firestore, currentUser, staff, onSaved,
}: { appointment: any; tenantId: string; firestore: any; currentUser: any; staff: any[]; onSaved?: () => void }) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(appointment?.sessionNote?.text || '');
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();
  const existing = appointment?.sessionNote?.text;

  const handleSave = async () => {
    if (!draft.trim() || !firestore || !tenantId || !appointment?.id) return;
    setSaving(true);
    try {
      await updateDocumentNonBlocking(
        doc(firestore, 'tenants', tenantId, 'appointments', appointment.id),
        {
          sessionNote: {
            text: draft.trim(),
            addedAt: new Date().toISOString(),
            addedBy: currentUser?.uid || 'staff',
          },
        }
      );
      toast({ title: 'Note saved' });
      setEditing(false);
      onSaved?.();
    } catch {
      toast({ variant: 'destructive', title: 'Could not save note' });
    } finally { setSaving(false); }
  };

  return (
    <div className="space-y-2">
      {existing && !editing ? (
        <div className="rounded-2xl border-2 border-primary/10 bg-primary/[0.02] p-4 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2">
              <StickyNote className="w-3.5 h-3.5 text-primary/50 shrink-0" />
              <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground opacity-60">
                Session note
                {appointment.sessionNote?.addedAt && ` · ${format(safeDate(appointment.sessionNote.addedAt), 'MMM d')}`}
                {appointment.sessionNote?.addedBy && ` · ${staffName(appointment.sessionNote.addedBy, staff)}`}
              </span>
            </div>
            <Button variant="ghost" size="sm" onClick={() => { setDraft(existing); setEditing(true); }}
              className="h-6 px-2 text-[8px] font-black uppercase tracking-widest rounded-lg">
              <Edit className="w-2.5 h-2.5 mr-1" /> Edit
            </Button>
          </div>
          <p className="text-[11px] font-medium text-slate-700 leading-relaxed pl-5">{existing}</p>
        </div>
      ) : editing ? (
        <div className="space-y-2.5 p-4 rounded-2xl border-2 border-primary/20 bg-primary/[0.02]">
          <Textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            placeholder="Add a session note visible to all staff…"
            className="min-h-[80px] rounded-xl text-[11px] resize-none"
            autoFocus
          />
          <div className="flex gap-2">
            <Button size="sm" onClick={handleSave} disabled={saving || !draft.trim()}
              className="h-8 flex-1 rounded-lg text-[9px] font-black uppercase tracking-widest">
              {saving ? <Loader className="w-3 h-3 animate-spin" /> : 'Save Note'}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setEditing(false)}
              className="h-8 px-3 rounded-lg text-[9px] font-black uppercase tracking-widest border-2">
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <button onClick={() => setEditing(true)}
          className="w-full flex items-center gap-2.5 px-4 py-3 rounded-2xl border-2 border-dashed border-primary/15 bg-primary/[0.015] hover:bg-primary/[0.04] hover:border-primary/30 transition-all text-left">
          <PenLine className="w-3.5 h-3.5 text-primary/40" />
          <span className="text-[10px] font-black uppercase tracking-widest text-primary/40">Add session note</span>
        </button>
      )}
    </div>
  );
};

// ─── After-photo capture panel ────────────────────────────────────────────────
const AfterPhotoPanel = ({ appointment, tenantId, firestore }: { appointment: any; tenantId: string; firestore: any }) => {
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const afterPhotos: string[] = appointment?.afterPhotoUrls || [];

  const handleFiles = async (files: FileList | null) => {
    if (!files || !files.length) return;
    setUploading(true);
    try {
      const formData = new FormData();
      Array.from(files).forEach(f => formData.append('files', f));
      formData.append('tenantId', tenantId);
      formData.append('appointmentId', appointment.id);
      const res = await fetch('/api/upload/appointment-photos', { method: 'POST', body: formData });
      const { urls } = await res.json();
      if (urls?.length) {
        await updateDocumentNonBlocking(
          doc(firestore, 'tenants', tenantId, 'appointments', appointment.id),
          { afterPhotoUrls: [...afterPhotos, ...urls] }
        );
        toast({ title: `${urls.length} photo${urls.length !== 1 ? 's' : ''} attached` });
      }
    } catch {
      toast({ variant: 'destructive', title: 'Upload failed' });
    } finally { setUploading(false); }
  };

  return (
    <div className="space-y-3">
      {afterPhotos.length > 0 && (
        <div className="grid grid-cols-4 gap-2">
          {afterPhotos.map((url, i) => (
            <div key={i} className="relative aspect-square rounded-xl overflow-hidden border-2 border-green-100 bg-muted/5">
              <img src={url} alt="After photo" className="w-full h-full object-cover" />
            </div>
          ))}
        </div>
      )}
      <input ref={inputRef} type="file" accept="image/*" multiple className="hidden" onChange={e => handleFiles(e.target.files)} />
      <button
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className={cn(
          'w-full flex items-center justify-center gap-2.5 px-4 py-3 rounded-2xl border-2 border-dashed transition-all',
          afterPhotos.length > 0 ? 'border-green-200 bg-green-50/50 hover:bg-green-50' : 'border-primary/15 bg-primary/[0.015] hover:bg-primary/[0.04] hover:border-primary/30'
        )}>
        {uploading ? <Loader className="w-4 h-4 animate-spin text-primary/40" /> : <ImagePlus className="w-3.5 h-3.5 text-primary/40" />}
        <span className="text-[10px] font-black uppercase tracking-widest text-primary/40">
          {uploading ? 'Uploading…' : afterPhotos.length > 0 ? 'Add more after photos' : 'Attach after photos'}
        </span>
      </button>
    </div>
  );
};

// ─── Cancellation record ───────────────────────────────────────────────────────
const CancellationRecord = ({
  appointment, transactions, staff, cancellationEvent, depositDecision,
  onProcessRefund, onKeepAsCredit, isProcessingRefund,
}: {
  appointment: any; transactions: any[]; staff: any[];
  cancellationEvent: any; depositDecision: any;
  onProcessRefund: () => void; onKeepAsCredit: () => void; isProcessingRefund: boolean;
}) => {
  const realAudit = appointment?.cancellationAudit;
  const hasLegacyData = !!(appointment?.cancellationReason || appointment?.cancellationFeeApplied != null || appointment?.cancelledAt);
  const audit = realAudit || (hasLegacyData ? {
    actorType: appointment.studioCancelled ? 'studio'
      : appointment.cancellationReason === 'no-show' ? 'no_show'
      : appointment.cancellationReason === 'automation' ? 'system'
      : 'client',
    reason: appointment.cancellationReason,
    studioReason: appointment.cancellationStudioReason,
    clientReason: appointment.cancellationClientReason,
    feeAmount: safeNumber(appointment.cancellationFeeApplied ?? appointment.cancellationFeeCharged),
    feeWaived: !!appointment.cancellationFeeWaived,
    paymentStatus: appointment.cancellationPaymentStatus,
    timestamp: appointment.cancelledAt,
    _legacy: true,
  } : null);

  const aptTxns = (transactions || [])
    .filter((t: any) => t.appointmentId === appointment.id)
    .sort((a: any, b: any) => safeDate(a.createdAt || a.date || 0).getTime() - safeDate(b.createdAt || b.date || 0).getTime());

  const feeAmount = safeNumber(audit?.feeAmount);
  const feeWaived = !!audit?.feeWaived && feeAmount > 0;
  const feeCharged = audit && !audit.feeWaived ? feeAmount : 0;
  const refunded = safeNumber(appointment.depositRefundedAmountCents) / 100;
  const creditFromDeposit = safeNumber(appointment.depositConvertedAmountCents) / 100;
  const depositPaid = appointment.depositStatus === 'paid' ? safeNumber(appointment.depositAmountCents) / 100 : 0;
  const storeCreditIssued = aptTxns.filter((t: any) => t.type === 'store_credit_issued' || t.category === 'Store Credit').reduce((s: number, t: any) => s + safeNumber(t.amount), 0);
  const feeChargeRecorded = aptTxns.some((t: any) => t.type === 'income' && (String(t.category || '').toLowerCase().includes('cancellation') || String(t.description || '').toLowerCase().includes('cancellation')));
  const chargeOutcomeKnown = !!cancellationEvent?.chargeStatus;
  const feeMarkedButMissing = feeCharged > 0 && !feeChargeRecorded && (!chargeOutcomeKnown || cancellationEvent.chargeStatus === 'uncollected' || cancellationEvent.chargeStatus === 'failed');
  const actorLabel = audit?.actorType === 'studio' ? `Studio / ${staffName(audit.actorId, staff, 'Staff')}` : audit?.actorType === 'no_show' ? 'No-Show (automatic)' : audit?.actorType === 'system' ? 'System (automation)' : audit ? 'Client' : 'Unknown';
  const reasonText = (audit?.studioReason || audit?.clientReason || audit?.reason || '').toString().replace(/_/g, ' ');
  const dispositionLabel = appointment.depositDisposition === 'refunded' ? `Refunded to card${refunded > 0 ? ` · $${refunded.toFixed(2)}` : ''}` : appointment.depositDisposition === 'store_credit' ? `Converted to credit${creditFromDeposit > 0 ? ` · $${creditFromDeposit.toFixed(2)}` : ''}` : appointment.depositDisposition === 'forfeited' || appointment.depositForfeited ? 'Forfeited (studio kept it)' : null;

  const rows: { label: string; value: string; tone: string }[] = [];
  if (depositPaid > 0) rows.push({ label: 'Deposit collected', value: `$${depositPaid.toFixed(2)}`, tone: 'text-slate-700' });
  rows.push({ label: 'Cancellation fee', value: feeWaived ? 'Waived' : feeCharged > 0 ? `$${feeCharged.toFixed(2)}` : 'None', tone: feeWaived ? 'text-green-600' : feeCharged > 0 ? 'text-amber-600' : 'text-muted-foreground opacity-50' });
  if (dispositionLabel) rows.push({ label: 'Deposit outcome', value: dispositionLabel, tone: 'text-primary/80' });
  if (storeCreditIssued > 0) rows.push({ label: 'Store credit issued', value: `$${storeCreditIssued.toFixed(2)}`, tone: 'text-green-600' });
  if (chargeOutcomeKnown) {
    const chargeLabelMap: Record<string, string> = { charged: 'Charged successfully', failed: 'Card declined', uncollected: 'No card — added to balance', waived: 'Waived', balance: 'Added to balance' };
    rows.push({ label: 'Charge outcome', value: chargeLabelMap[cancellationEvent.chargeStatus] || cancellationEvent.chargeStatus, tone: cancellationEvent.chargeStatus === 'charged' ? 'text-green-600' : cancellationEvent.chargeStatus === 'failed' || cancellationEvent.chargeStatus === 'uncollected' ? 'text-destructive' : 'text-amber-600' });
  }

  const isNoShow = audit?.actorType === 'no_show';
  const showWaiverRow = (feeWaived || appointment.cancellationFeeWaived) && appointment.waivedBy;
  const refundPending = depositDecision?.outcome === 'refund_pending';

  if (!audit) {
    return (
      <div className="rounded-[1.75rem] bg-destructive/5 border-2 border-destructive/20 overflow-hidden p-5">
        <div className="flex items-center gap-2.5">
          <Ban className="w-5 h-5 text-destructive shrink-0" />
          <p className="text-[11px] font-black uppercase tracking-widest text-destructive leading-tight">Cancelled</p>
        </div>
        <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-tight mt-2 pl-7 opacity-60">No further cancellation detail was recorded for this appointment.</p>
      </div>
    );
  }

  return (
    <div className="rounded-[1.75rem] bg-destructive/5 border-2 border-destructive/20 overflow-hidden">
      <div className="p-5 space-y-2.5">
        <div className="flex items-center gap-2.5">
          {isNoShow ? <UserX className="w-5 h-5 text-destructive shrink-0" /> : <Ban className="w-5 h-5 text-destructive shrink-0" />}
          <div className="min-w-0">
            <p className="text-[11px] font-black uppercase tracking-widest text-destructive leading-tight">
              {isNoShow ? 'No-Show' : `Cancelled by ${actorLabel}`}
            </p>
            {audit?.timestamp && <p className="text-[9px] font-bold text-destructive/60 uppercase tracking-wide">{format(safeDate(audit.timestamp), 'MMM d, yyyy · h:mm a')}</p>}
          </div>
        </div>
        {reasonText && <p className="text-[10px] font-bold text-slate-600 uppercase tracking-tight leading-relaxed pl-7">{reasonText}{audit?.reasonDetail ? ` — "${audit.reasonDetail}"` : ''}</p>}
        {isNoShow && safeNumber(appointment.lateTimeMinutes) > 0 && (
          <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-tight pl-7 opacity-70">
            {appointment.noShowConfirmedBy ? `Confirmed by ${staffName(appointment.noShowConfirmedBy, staff)}` : `Automatically flagged after ${appointment.lateTimeMinutes}m past start`}
          </p>
        )}
      </div>
      <div className="px-5 pb-5 space-y-2">
        <div className="rounded-2xl bg-white border-2 border-destructive/10 divide-y divide-dashed divide-muted/40">
          {rows.map((r, i) => (
            <div key={i} className="flex items-center justify-between px-4 py-3">
              <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">{r.label}</span>
              <span className={cn('text-[11px] font-black uppercase tracking-tight font-mono', r.tone)}>{r.value}</span>
            </div>
          ))}
        </div>
        {showWaiverRow && (
          <div className="flex items-start gap-2 p-3 rounded-xl bg-green-50 border-2 border-green-200">
            <HeartHandshake className="w-3.5 h-3.5 text-green-600 shrink-0 mt-0.5" />
            <p className="text-[9px] font-black uppercase tracking-wide text-green-700 leading-relaxed">
              Fee waived by {staffName(appointment.waivedBy, staff)}{appointment.waivedReason ? ` — "${appointment.waivedReason}"` : ''}
            </p>
          </div>
        )}
        {chargeOutcomeKnown && cancellationEvent.errorMessage && (
          <div className="flex items-start gap-2 p-3 rounded-xl bg-red-50 border-2 border-red-200">
            <AlertCircle className="w-3.5 h-3.5 text-destructive shrink-0 mt-0.5" />
            <p className="text-[9px] font-black uppercase tracking-wide text-destructive leading-relaxed">Stripe error: {cancellationEvent.errorMessage}</p>
          </div>
        )}
        {feeMarkedButMissing && (
          <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-50 border-2 border-amber-200">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
            <p className="text-[9px] font-black uppercase tracking-wide text-amber-700 leading-relaxed">A ${feeCharged.toFixed(2)} fee was marked but no matching charge is in the ledger — verify the card was actually run.</p>
          </div>
        )}
        {refundPending && (
          <div className="p-3.5 rounded-xl bg-blue-50 border-2 border-blue-200 space-y-2.5">
            <p className="text-[9px] font-black uppercase tracking-wide text-blue-800 flex items-center gap-1.5">
              <Wallet className="w-3.5 h-3.5" /> Deposit refund pending — ${safeNumber(depositDecision.amountDollars).toFixed(2)}
            </p>
            <div className="flex gap-2">
              <Button size="sm" onClick={onProcessRefund} disabled={isProcessingRefund} className="h-8 flex-1 rounded-lg text-[8px] font-black uppercase tracking-widest">
                {isProcessingRefund ? <Loader className="w-3 h-3 animate-spin" /> : 'Refund to Card'}
              </Button>
              <Button size="sm" variant="outline" onClick={onKeepAsCredit} disabled={isProcessingRefund} className="h-8 flex-1 rounded-lg text-[8px] font-black uppercase tracking-widest border-2">
                Keep as Credit
              </Button>
            </div>
          </div>
        )}
        {aptTxns.length > 0 && (
          <div className="space-y-1.5 pt-1">
            <p className="text-[8px] font-black uppercase tracking-widest text-muted-foreground opacity-50 pl-1">Ledger Receipts</p>
            {aptTxns.map((t: any) => (
              <div key={t.id} className="flex items-center justify-between px-3 py-2 rounded-lg bg-muted/10 border border-muted/30">
                <div className="min-w-0 flex items-center gap-2">
                  <History className="w-3 h-3 text-muted-foreground opacity-40 shrink-0" />
                  <span className="text-[9px] font-bold uppercase tracking-tight text-slate-600 truncate">{String(t.description || t.category || 'Transaction')}</span>
                </div>
                <span className={cn('text-[10px] font-black font-mono shrink-0 ml-2', t.type === 'income' ? 'text-green-600' : t.type === 'refund' || t.type === 'reversal' ? 'text-slate-400' : t.type === 'store_credit_issued' ? 'text-primary' : 'text-amber-600')}>
                  {t.type === 'income' ? '+' : t.type === 'refund' || t.type === 'reversal' ? '−' : ''}${Math.abs(safeNumber(t.amount)).toFixed(2)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

// ─── Completion receipt ────────────────────────────────────────────────────────
const CompletionReceipt = ({ appointment, transactions, staff, providers }: { appointment: any; transactions: any[]; staff: any[]; providers?: ProviderInfo[] }) => {
  const aptTxns = (transactions || []).filter((t: any) => t.appointmentId === appointment.id);
  const serviceRevenue = aptTxns.filter((t: any) => t.category === 'Service Revenue').reduce((s: number, t: any) => s + safeNumber(t.amount), 0);
  const tips = aptTxns.filter((t: any) => t.category === 'Tips').reduce((s: number, t: any) => s + safeNumber(t.amount), 0);
  const discounts = aptTxns.filter((t: any) => t.category === 'Discounts').reduce((s: number, t: any) => s + safeNumber(t.amount), 0);
  const tax = aptTxns.filter((t: any) => t.category === 'Tax').reduce((s: number, t: any) => s + safeNumber(t.amount), 0);
  const giftCardUsed = aptTxns.filter((t: any) => t.paymentMethod === 'gift_card' || t.category === 'Gift Card').reduce((s: number, t: any) => s + safeNumber(t.amount), 0);
  const adjustments = aptTxns.filter((t: any) => ['Protocol Recovery', 'Strategic Adjustment', 'Adjustment Fee'].includes(t.category)).reduce((s: number, t: any) => s + safeNumber(t.amount), 0);
  const promoCode = aptTxns.find((t: any) => t.promoCode)?.promoCode || appointment.promoCode;

  // Break down payment methods for split payments
  const paymentMethods: Record<string, number> = {};
  aptTxns.filter((t: any) => t.category === 'Service Revenue' && t.paymentMethod).forEach((t: any) => {
    paymentMethods[t.paymentMethod] = (paymentMethods[t.paymentMethod] || 0) + safeNumber(t.amount);
  });
  const singleMethod = Object.keys(paymentMethods).length <= 1
    ? (Object.keys(paymentMethods)[0] || aptTxns[0]?.paymentMethod || '—')
    : null;

  const total = serviceRevenue + tips + adjustments - discounts;
  const completedByName = staffName(appointment.staffId, staff, 'Unassigned');
  const otherProviders = (providers || []).filter(p => !p.isMain);
  const duration = appointment.actualStartTime && appointment.actualEndTime
    ? differenceInMinutes(safeDate(appointment.actualEndTime), safeDate(appointment.actualStartTime))
    : null;

  return (
    <div className="rounded-[1.75rem] bg-green-50 border-2 border-green-200 overflow-hidden">
      <div className="p-5 flex items-center gap-2.5">
        <Receipt className="w-5 h-5 text-green-600 shrink-0" />
        <div>
          <p className="text-[11px] font-black uppercase tracking-widest text-green-700 leading-tight">Session Completed</p>
          {appointment.actualEndTime && <p className="text-[9px] font-bold text-green-700/60 uppercase tracking-wide">{format(safeDate(appointment.actualEndTime), 'MMM d, yyyy · h:mm a')}</p>}
        </div>
        {duration && (
          <div className="ml-auto flex items-center gap-1 text-[9px] font-black uppercase tracking-widest text-green-600/60">
            <Clock className="w-3 h-3" /> {duration}m
          </div>
        )}
      </div>
      <div className="px-5 pb-5">
        <div className="rounded-2xl bg-white border-2 border-green-100 divide-y divide-dashed divide-muted/30">
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Service Revenue</span>
            <span className="text-[11px] font-black font-mono">${serviceRevenue.toFixed(2)}</span>
          </div>
          {adjustments > 0 && (
            <div className="flex items-center justify-between px-4 py-3">
              <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Adjustments</span>
              <span className="text-[11px] font-black font-mono text-amber-600">${adjustments.toFixed(2)}</span>
            </div>
          )}
          {discounts > 0 && (
            <div className="flex items-center justify-between px-4 py-3">
              <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">
                Discount{promoCode ? ` · ${promoCode}` : ''}
              </span>
              <span className="text-[11px] font-black font-mono text-amber-600">-${discounts.toFixed(2)}</span>
            </div>
          )}
          {tips > 0 && (
            <div className="flex items-center justify-between px-4 py-3">
              <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Gratuity</span>
              <span className="text-[11px] font-black font-mono text-green-600">${tips.toFixed(2)}</span>
            </div>
          )}
          {tax > 0 && (
            <div className="flex items-center justify-between px-4 py-3">
              <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Tax</span>
              <span className="text-[11px] font-black font-mono">${tax.toFixed(2)}</span>
            </div>
          )}
          {giftCardUsed > 0 && (
            <div className="flex items-center justify-between px-4 py-3">
              <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-1"><Gift className="w-3 h-3" /> Gift Card</span>
              <span className="text-[11px] font-black font-mono text-primary">-${giftCardUsed.toFixed(2)}</span>
            </div>
          )}
          {/* Payment method breakdown for split payments */}
          {singleMethod ? (
            <div className="flex items-center justify-between px-4 py-3">
              <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Payment</span>
              <span className="text-[11px] font-black font-mono">{singleMethod}</span>
            </div>
          ) : (
            Object.entries(paymentMethods).map(([method, amount]) => (
              <div key={method} className="flex items-center justify-between px-4 py-3">
                <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">{method}</span>
                <span className="text-[11px] font-black font-mono">${amount.toFixed(2)}</span>
              </div>
            ))
          )}
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Performed By</span>
            <span className="text-[11px] font-black font-mono">{completedByName}</span>
          </div>
          {otherProviders.length > 0 && (
            <div className="flex items-center justify-between px-4 py-3">
              <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Also Worked By</span>
              <span className="text-[10px] font-black font-mono text-right">
                {otherProviders.map(p => p.staffMember?.name || 'Staff').join(', ')}
              </span>
            </div>
          )}
          <div className="flex items-center justify-between px-4 py-3 bg-green-50/50">
            <span className="text-[9px] font-black uppercase tracking-widest text-slate-700">Total Collected</span>
            <span className="text-[13px] font-black font-mono text-primary">${total.toFixed(2)}</span>
          </div>
        </div>
      </div>
    </div>
  );
};

// ─── Readiness banner ──────────────────────────────────────────────────────────
const ReadinessBanner = ({ appointment, client, complianceInfo, hasDeposit, isLoadingDeposit, cardSecured }: {
  appointment: any; client: any;
  complianceInfo: { healthPendingForms: ConsentForm[]; otherPendingForms: ConsentForm[]; allCertified: boolean };
  hasDeposit: boolean; isLoadingDeposit: boolean; cardSecured: boolean;
}) => {
  const flags = appointment?.readinessFlags || {};
  const hasBan = client?.status === 'banned';
  const hasDispute = client?.hasOpenDispute === true;
  const hasAllergy = !!(client?.allergyNotes || client?.medicalNotes);
  const outstandingBalance = safeNumber(client?.outstandingBalance);
  const depositRequiredButMissing = !!flags.depositRequired && !hasDeposit && !isLoadingDeposit;
  const healthFormsPending = complianceInfo.healthPendingForms.length > 0;
  const otherFormsPending = complianceInfo.otherPendingForms.length > 0;
  const cardActuallyMissing = !!flags.cardRequired && !cardSecured;

  // No-show history warning
  const noShowCount = safeNumber(client?.noShowCount);

  const blockers = [
    hasBan && { level: 'banned', msg: `Banned — ${client?.banMessage || 'No service permitted'}` },
    hasDispute && { level: 'dispute', msg: `Open chargeback dispute on file — verify before service` },
    healthFormsPending && { level: 'danger', msg: `Health disclosure required: ${complianceInfo.healthPendingForms.map(f => f.title).join(', ')}` },
    hasAllergy && { level: 'allergy', msg: [client.allergyNotes ? `Allergy: ${client.allergyNotes}` : '', client.medicalNotes ? `Medical: ${client.medicalNotes}` : ''].filter(Boolean).join(' · ') },
    noShowCount > 1 && { level: 'warn', msg: `${noShowCount} previous no-shows — collect deposit or card before starting` },
    otherFormsPending && { level: 'warn', msg: `${complianceInfo.otherPendingForms.length} consent form${complianceInfo.otherPendingForms.length !== 1 ? 's' : ''} not yet signed` },
    depositRequiredButMissing && { level: 'danger', msg: `Deposit not received — collect below before starting` },
    cardActuallyMissing && { level: 'warn', msg: `No card on file — collect at check-in` },
    outstandingBalance > 0 && { level: 'warn', msg: `Outstanding $${outstandingBalance.toFixed(2)} — settle at checkout` },
    flags.needsConsultationBuffer && { level: 'info', msg: `No reference photos — allow 15 min design consultation` },
  ].filter(Boolean) as { level: string; msg: string }[];

  if (flags.depositRequired && isLoadingDeposit) {
    return (
      <div className="flex items-center gap-2.5 p-4 rounded-2xl bg-muted/10 border-2 border-muted/30">
        <Loader className="w-4 h-4 text-muted-foreground animate-spin shrink-0" />
        <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Verifying deposit status…</p>
      </div>
    );
  }

  if (blockers.length === 0) {
    return (
      <div className="flex items-center gap-2.5 p-4 rounded-2xl bg-green-50 border-2 border-green-200">
        <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
        <p className="text-[10px] font-black uppercase tracking-widest text-green-700">Ready to start — all requirements met</p>
      </div>
    );
  }

  const BG: Record<string, string> = { banned: 'bg-slate-900 border-slate-900', dispute: 'bg-purple-50 border-purple-300', danger: 'bg-red-50 border-red-300', allergy: 'bg-red-50 border-red-400', warn: 'bg-amber-50 border-amber-200', info: 'bg-blue-50 border-blue-200' };
  const TX: Record<string, string> = { banned: 'text-white', dispute: 'text-purple-900', danger: 'text-red-900', allergy: 'text-red-900', warn: 'text-amber-900', info: 'text-blue-800' };
  const IC: Record<string, string> = { banned: 'text-white', dispute: 'text-purple-600', danger: 'text-red-600', allergy: 'text-red-600', warn: 'text-amber-600', info: 'text-blue-500' };

  return (
    <div className="space-y-2">
      {blockers.map((b, i) => (
        <div key={i} className={cn('flex items-start gap-3 p-4 rounded-2xl border-2', BG[b.level])}>
          <AlertTriangle className={cn('w-4 h-4 shrink-0 mt-0.5', IC[b.level])} />
          <p className={cn('text-[10px] font-black uppercase tracking-wide leading-snug', TX[b.level])}>{b.msg}</p>
        </div>
      ))}
    </div>
  );
};

// ─── Mid-session handoff dialog ────────────────────────────────────────────────
// Lets staff reassign the lead service or a specific add-on to a different
// provider while the session is already underway — e.g. the client asks for
// a different artist halfway through. Writes a providerAssignments entry
// tagged isMidServiceHandoff so the timeline renders it distinctly from
// booking-time add-on assignments, and (for lead handoffs) updates
// appointment.staffId directly so the rest of the app picks up the new lead.
const MidServiceHandoffDialog = ({
  open, onOpenChange, appointment, service, currentAddOns, staff,
  tenantId, firestore, currentUser,
}: {
  open: boolean; onOpenChange: (v: boolean) => void; appointment: any; service: Service;
  currentAddOns: Service[]; staff: any[]; tenantId: string; firestore: any; currentUser: any;
}) => {
  const { toast } = useToast();
  const [selectedServiceId, setSelectedServiceId] = useState('');
  const [selectedStaffId, setSelectedStaffId] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setSelectedServiceId(service?.id || '');
      setSelectedStaffId('');
      setReason('');
    }
  }, [open, service?.id]);

  const assignableServices = useMemo(() => {
    if (!appointment || !service) return [];
    const overrides = appointment.checkoutState?.serviceStaffOverrides || {};
    return [
      { id: service.id, name: service.name, currentStaffId: appointment.staffId, isLead: true },
      ...(currentAddOns || []).map((s) => ({
        id: s.id,
        name: s.name,
        currentStaffId: overrides[s.id] || appointment.staffId,
        isLead: false,
      })),
    ];
  }, [appointment, service, currentAddOns]);

  const selectedTarget = assignableServices.find((s) => s.id === selectedServiceId);
  const eligibleStaff = (staff || []).filter((s: any) => s.id !== selectedTarget?.currentStaffId);

  const handleSubmit = async () => {
    if (!selectedServiceId || !selectedStaffId || !firestore || !tenantId || !appointment?.id || !selectedTarget) return;
    setSubmitting(true);
    try {
      const now = new Date().toISOString();
      const appointmentRef = doc(firestore, 'tenants', tenantId, 'appointments', appointment.id);
      const logEntry: any = {
        serviceId: selectedServiceId,
        serviceName: selectedTarget.name,
        staffId: selectedStaffId,
        previousStaffId: selectedTarget.currentStaffId,
        isConcurrent: (appointment.checkoutState?.concurrentServiceIds || []).includes(selectedServiceId),
        isMidServiceHandoff: true,
        assignedAt: now,
        assignedBy: currentUser?.uid || 'staff',
      };
      if (reason.trim()) logEntry.reason = reason.trim();

      const updates: any = { providerAssignments: arrayUnion(logEntry) };
      if (selectedTarget.isLead) {
        updates.staffId = selectedStaffId;
      } else {
        const newOverrides = { ...(appointment.checkoutState?.serviceStaffOverrides || {}) };
        newOverrides[selectedServiceId] = selectedStaffId;
        updates.checkoutState = { ...(appointment.checkoutState || {}), serviceStaffOverrides: newOverrides };
      }
      await updateDocumentNonBlocking(appointmentRef, updates);
      toast({ title: 'Handoff recorded', description: `${selectedTarget.name} reassigned to ${staffName(selectedStaffId, staff)}` });
      onOpenChange(false);
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Could not record handoff', description: e?.message || 'Unknown error' });
    } finally { setSubmitting(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-3xl border-2 max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm font-black uppercase tracking-tight flex items-center gap-2">
            <Repeat2 className="w-4 h-4 text-primary" /> Mid-Session Handoff
          </DialogTitle>
          <DialogDescription className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground leading-relaxed">
            Reassign a provider while the session is already underway. This is logged with its own timestamp on the activity timeline.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label className="text-[9px] font-black uppercase text-muted-foreground">Which part of the service?</Label>
            <div className="grid gap-2">
              {assignableServices.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => { setSelectedServiceId(s.id); setSelectedStaffId(''); }}
                  className={cn(
                    'flex items-center justify-between p-3 rounded-xl border-2 text-left transition-all',
                    selectedServiceId === s.id ? 'border-primary bg-primary/5' : 'border-border bg-white'
                  )}
                >
                  <span className="text-[10px] font-black uppercase tracking-tight flex items-center gap-2 min-w-0">
                    {s.isLead && <Badge className="h-4 px-1.5 text-[7px] bg-primary text-white border-none shrink-0">LEAD</Badge>}
                    <span className="truncate">{s.name}</span>
                  </span>
                  <span className="text-[9px] font-bold text-muted-foreground uppercase shrink-0 ml-2">
                    Now: {staffName(s.currentStaffId, staff)}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-[9px] font-black uppercase text-muted-foreground">Hand off to</Label>
            <div className="grid gap-2 max-h-40 overflow-y-auto">
              {eligibleStaff.map((s: any) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSelectedStaffId(s.id)}
                  className={cn(
                    'flex items-center gap-2.5 p-2.5 rounded-xl border-2 text-left transition-all',
                    selectedStaffId === s.id ? 'border-primary bg-primary/5' : 'border-border bg-white'
                  )}
                >
                  <Avatar className="h-6 w-6 border shrink-0">
                    <AvatarImage src={s.avatarUrl} className="object-cover" />
                    <AvatarFallback className="text-[8px] font-black bg-primary/10 text-primary">{(s.name || 'S')[0]}</AvatarFallback>
                  </Avatar>
                  <span className="text-[10px] font-black uppercase tracking-tight truncate">{s.name}</span>
                </button>
              ))}
              {eligibleStaff.length === 0 && (
                <p className="text-[9px] font-bold text-muted-foreground uppercase opacity-50 text-center py-2">No other staff available</p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-[9px] font-black uppercase text-muted-foreground">Reason (optional)</Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. client requested a different artist for nail art"
              className="min-h-[60px] rounded-xl text-[11px] resize-none"
            />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="rounded-xl font-black uppercase text-[9px] tracking-widest border-2">
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!selectedServiceId || !selectedStaffId || submitting} className="rounded-xl font-black uppercase text-[9px] tracking-widest">
            {submitting ? <Loader className="w-3.5 h-3.5 animate-spin" /> : 'Confirm Handoff'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

// ─── Main component ────────────────────────────────────────────────────────────
export const AppointmentDetailsSheet: React.FC<any> = ({
  open, onOpenChange, appointment: initialAppointment, client, service, tmhr,
  transactions, onStartService, onFinishService, onEdit, onDelete, onCancel,
  onReschedule, onRebook, onBookNewForClient, onPrintTicket, onOverride, onWaiveFee,
}) => {
  const isMobile = useIsMobile();
  const [mounted, setMounted] = useState(false);
  const { inventory, services: allServices, staff, appointments: allAppointments, consentForms } = useInventory();
  const { role, selectedTenant } = useTenant();
  const { user: currentUser } = useUser();
  const tenantId = selectedTenant?.id;
  const { toast } = useToast();
  const { firestore } = useFirebase();
  const { copied: ticketCopied, copy: copyTicket } = useCopyToClipboard();

  useEffect(() => { setMounted(true); }, []);

  const [isAddAndConfigureOpen, setIsAddAndConfigureOpen] = useState(false);
  const [isRescheduleOpen, setIsRescheduleOpen] = useState(false);
  const [isHandoffOpen, setIsHandoffOpen] = useState(false);
  const [elapsedTime, setElapsedTime] = useState<string | null>(null);
  const [isRunningOver, setIsRunningOver] = useState(false);
  const [expandedImage, setExpandedImage] = useState<string | null>(null);
  const [isMarkupOpen, setIsMarkupOpen] = useState(false);
  const [isEscalating, setIsEscalating] = useState(false);
  const [isResolving, setIsResolving] = useState(false);
  const [resolutionNote, setResolutionNote] = useState('');
  const [isRequestOpen, setIsRequestOpen] = useState(false);
  const [requestPhotos, setRequestPhotos] = useState(false);
  const [reqLink, setReqLink] = useState<string | null>(null);
  const [reqSending, setReqSending] = useState(false);
  const [reqCopied, setReqCopied] = useState(false);
  const [isCollectingDeposit, setIsCollectingDeposit] = useState(false);
  const [isProcessingRefund, setIsProcessingRefund] = useState(false);
  const [isSendingSMS, setIsSendingSMS] = useState(false);
  const [openAccordions, setOpenAccordions] = useState<string[]>(['timeline']);

  // Live appointment from store
  const appointment = useMemo(() => {
    if (!initialAppointment || !allAppointments) return initialAppointment;
    return allAppointments.find((a: any) => a.id === initialAppointment.id) || initialAppointment;
  }, [initialAppointment, allAppointments]);

  const currentAddOns = useMemo(() => {
    if (!appointment?.addOnIds || !allServices) return [];
    return appointment.addOnIds.map((id: string) => allServices.find(s => s.id === id)).filter((s): s is Service => !!s);
  }, [appointment?.addOnIds, allServices]);

  // Resolved set of every staff member currently involved in this appointment
  // (lead + any add-on overrides), kept in sync automatically whenever a
  // booking-time assignment or a mid-session handoff updates the appointment.
  const providers = useMemo(
    () => resolveProviders(appointment, service, currentAddOns, staff || []),
    [appointment, service, currentAddOns, staff]
  );

  // Cancellation event (only fetch when cancelled)
  const cancellationEventQuery = useMemoFirebase(() => {
    if (!firestore || !tenantId || !appointment?.cancellationEventId) return null;
    return query(collection(firestore, `tenants/${tenantId}/cancellationEvents`), where('id', '==', appointment.cancellationEventId));
  }, [firestore, tenantId, appointment?.cancellationEventId]);
  const { data: cancellationEventDocs } = useCollection<any>(cancellationEventQuery);
  const cancellationEvent = cancellationEventDocs?.[0] || null;

  // Deposit decisions (only when cancelled)
  const depositDecisionsQuery = useMemoFirebase(() => {
    if (!firestore || !tenantId || !appointment?.id || appointment.status !== 'cancelled') return null;
    return query(collection(firestore, `tenants/${tenantId}/depositDecisions`), where('appointmentId', '==', appointment.id));
  }, [firestore, tenantId, appointment?.id, appointment?.status]);
  const { data: depositDecisionDocs } = useCollection<any>(depositDecisionsQuery);
  const latestDepositDecision = useMemo(() => {
    if (!depositDecisionDocs || depositDecisionDocs.length === 0) return null;
    return [...depositDecisionDocs].sort((a: any, b: any) => safeDate(b.decidedAt || 0).getTime() - safeDate(a.decidedAt || 0).getTime())[0];
  }, [depositDecisionDocs]);

  // Audit log for timeline
  const auditLogQuery = useMemoFirebase(() => {
    if (!firestore || !tenantId || !appointment?.id) return null;
    return query(collection(firestore, `tenants/${tenantId}/auditLog`), where('entityId', '==', appointment.id));
  }, [firestore, tenantId, appointment?.id]);
  const { data: auditLogDocs } = useCollection<any>(auditLogQuery);

  const timelineEvents = useMemo(() => buildTimelineEvents({
    appointment, transactions: transactions || [], cancellationEvent,
    depositDecision: latestDepositDecision, auditLogEntries: auditLogDocs || [], staff: staff || [],
  }), [appointment, transactions, cancellationEvent, latestDepositDecision, auditLogDocs, staff]);

  // Full client visit history (for stats + frequency)
  const clientHistoryQuery = useMemoFirebase(() => {
    if (!firestore || !tenantId || !client?.id) return null;
    return query(collection(firestore, `tenants/${tenantId}/appointments`), where('clientId', '==', client.id), orderBy('startTime', 'desc'), limit(50));
  }, [firestore, tenantId, client?.id]);
  const { data: clientHistoryDocs } = useCollection<any>(clientHistoryQuery);
  const allClientVisits = useMemo(() => (clientHistoryDocs || []), [clientHistoryDocs]);
  const recentVisits = useMemo(() => (clientHistoryDocs || []).filter((a: any) => a.id !== appointment?.id).slice(0, 5), [clientHistoryDocs, appointment?.id]);

  // Consent forms
  const signedConsentsQuery = useMemoFirebase(() => {
    if (!firestore || !tenantId || !client?.id) return null;
    return collection(firestore, `tenants/${tenantId}/clients/${client.id}/signedConsents`);
  }, [firestore, tenantId, client?.id]);
  const { data: signedConsents } = useCollection<any>(signedConsentsQuery);

  const complianceInfo = useMemo(() => {
    if (!service || !consentForms) return { requiredForms: [], pendingForms: [], healthPendingForms: [], otherPendingForms: [], allCertified: true };
    const requiredIds = service.requiredFormIds || [];
    const requiredForms = (consentForms || []).filter(f => requiredIds.includes(f.id));
    const aptSignedIds = (appointment?.signedForms || []).map((f: any) => f.formId);
    const pendingForms = requiredForms.filter(rf => !signedConsents?.some(sc => sc.formId === rf.id) && !aptSignedIds.includes(rf.id));
    const healthPendingForms = pendingForms.filter(f => f.category === 'Intake');
    const otherPendingForms = pendingForms.filter(f => f.category !== 'Intake');
    return { requiredForms, pendingForms, healthPendingForms, otherPendingForms, allCertified: pendingForms.length === 0 };
  }, [service, consentForms, signedConsents, appointment?.signedForms]);

  const { availableCredits, totalAvailable: totalStoreCreditAvailable } = useStoreCredit(client);
  const { hasDeposit: hasLiveDeposit, isLoadingDeposit: isLoadingLiveDeposit } = useDepositCredit(appointment?.clientId, client?.email, tenantId, true);
  const cardSecured = !!(appointment?.cardOnFileSecured || client?.cardOnFile?.token || client?.cardOnFile?.paymentMethodId);
  const depositOwedCents = safeNumber(appointment?.depositAmountCents);
  const depositUnpaid = depositOwedCents > 0 && appointment?.depositStatus !== 'paid' && !hasLiveDeposit && !isLoadingLiveDeposit;
  const depositActuallyMissing = !!appointment?.readinessFlags?.depositRequired && depositUnpaid;
  const canCollectDepositNow = !!appointment && appointment.status !== 'cancelled' && cardSecured && depositUnpaid;

  // ── Financial data (fixed: guard Invalid Date) ─────────────────────────────
  const financialData = useMemo(() => {
    if (!appointment || !service) return null;
    try {
      const isCompleted = appointment.status === 'completed';
      const addOns = (appointment.addOnIds || []).map((id: string) => (allServices || []).find((s) => s.id === id)).filter((s): s is Service => !!s);
      const allServicesInApt = [service, ...addOns];
      const assignedStaffMember = (staff || []).find((s) => s.id === appointment.staffId);
      const productCost = allServicesInApt.flatMap((s) => s?.products || []).reduce((acc: number, p: any) => {
        const product = (inventory || []).find((i) => i.id === p.id);
        if (!product) return acc;
        let costPerBaseUnit = 0;
        if (product.costingMethod === 'size' && product.size) costPerBaseUnit = (product.costPerUnit || 0) / product.size;
        else if (product.costingMethod === 'uses' && product.estimatedUses) costPerBaseUnit = (product.costPerUnit || 0) / product.estimatedUses;
        else costPerBaseUnit = product.costPerUnit || 0;
        return acc + costPerBaseUnit * (p.quantityUsed || 1);
      }, 0);

      // ← BUG FIX: guard Invalid Date before calling differenceInMinutes
      const start = safeDate(appointment.actualStartTime || appointment.startTime);
      const end = safeDate(appointment.actualEndTime || appointment.endTime);
      const actualDuration = appointment.actualEndTime && isValidDate(start) && isValidDate(end)
        ? differenceInMinutes(end, start)
        : allServicesInApt.reduce((acc, s) => acc + (s?.duration || 0), 0);

      const timeCost = ((actualDuration + (service.padBefore || 0) + (service.padAfter || 0)) / 60) * (tmhr || 0);
      const breakEven = timeCost + productCost;
      const baseRevenue = allServicesInApt.reduce((acc, s) => {
        const tierPrice = s.serviceTiers?.find((t: any) => t.tierId === assignedStaffMember?.pricingTierId)?.price;
        return acc + (tierPrice ?? s.price ?? 0);
      }, 0);
      const adjustmentCharge = safeNumber(appointment.checkoutState?.additionalCharge);
      const revenue = isCompleted
        ? (transactions || []).filter((t: any) => t.appointmentId === appointment.id && t.category === 'Service Revenue').reduce((acc: number, t: any) => acc + t.amount, 0)
        : baseRevenue;

      // Spend vs average comparison
      const clientAvgSpend = safeNumber(client?.averageSpend);
      const vsAverage = clientAvgSpend > 0 ? ((revenue - clientAvgSpend) / clientAvgSpend) * 100 : null;

      return { revenue, breakEven, profit: revenue - breakEven, adjustmentCharge, vsAverage, productCost, timeCost };
    } catch {
      return { revenue: 0, breakEven: 0, profit: 0, adjustmentCharge: 0, vsAverage: null, productCost: 0, timeCost: 0 };
    }
  }, [appointment, service, tmhr, inventory, transactions, allServices, staff, client]);

  // ── Derived flags used by the keyboard-shortcut effect below ───────────────
  // NOTE: these must be declared BEFORE the keyboard-shortcut useEffect (and
  // before the early-return guard), since that effect's dependency array
  // reads them on every render — including the very first one during SSR /
  // static generation. Declaring them further down with `const` caused a
  // ReferenceError ("Cannot access 'canStart' before initialization") because
  // `const` bindings are in the temporal dead zone until their own
  // declaration line runs, and that effect's deps array was evaluated before
  // this line was ever reached.
  const canStart = !!appointment && !['servicing', 'completed', 'cancelled'].includes(appointment.status);
  const canFinish = !!appointment && appointment.status === 'servicing';
  const startDisabled = !!(complianceInfo.healthPendingForms.length > 0 || complianceInfo.otherPendingForms.length > 0 || depositActuallyMissing);

  // ── Live session timer ──────────────────────────────────────────────────────
  useEffect(() => {
    let timer: NodeJS.Timeout | undefined;
    if (appointment?.status === 'servicing' && appointment.actualStartTime) {
      const startTime = safeDate(appointment.actualStartTime);
      const update = () => {
        const diff = differenceInSeconds(new Date(), startTime);
        const h = Math.floor(diff / 3600);
        const m = Math.floor((diff % 3600) / 60);
        const s = diff % 60;
        setElapsedTime(h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`);
        setIsRunningOver(Math.floor(diff / 60) > (service?.duration || 0));
      };
      update();
      timer = setInterval(update, 1000);
    }
    return () => { if (timer) clearInterval(timer); };
  }, [appointment?.status, appointment?.actualStartTime, service?.duration]);

  // ── Keyboard shortcuts ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'Escape') onOpenChange(false);
      if (e.key === 'k' && canStart && !startDisabled) onStartService(appointment.id);
      if (e.key === 'f' && canFinish) onFinishService(appointment);
      if (e.key === 'p' && onPrintTicket) onPrintTicket(appointment);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, appointment, canStart, canFinish]);

  const handleAddAndConfigureConfirm = (selectedAddOns: Service[], configs: any) => {
    if (!firestore || !tenantId || !appointment?.id) return;
    const appointmentRef = doc(firestore, 'tenants', tenantId, 'appointments', appointment.id);
    const currentCheckoutState = appointment.checkoutState || {};
    const newStaffOverrides = { ...(currentCheckoutState.serviceStaffOverrides || {}) };
    const newConcurrentIds = [...(currentCheckoutState.concurrentServiceIds || [])];
    const existingAssignments: any[] = appointment.providerAssignments || [];
    const newAssignmentLogEntries: any[] = [];
    const now = new Date().toISOString();

    selectedAddOns.forEach((s) => {
      const config = configs[s.id];
      if (config) {
        const previousStaffId = newStaffOverrides[s.id];
        newStaffOverrides[s.id] = config.staffId;
        if (config.isConcurrent) newConcurrentIds.push(s.id);

        // Only log genuine cross-provider assignments that are new or
        // changed — this is the only place a booking-time staff handoff gets
        // a real timestamp, so the timeline can later reconstruct who
        // actually worked a multi-provider session and when, instead of
        // just reflecting current-state overrides.
        const isCrossProvider = !!config.staffId && config.staffId !== appointment.staffId;
        const alreadyLogged = existingAssignments.some(
          (a) => a.serviceId === s.id && a.staffId === config.staffId
        );
        if (isCrossProvider && config.staffId !== previousStaffId && !alreadyLogged) {
          newAssignmentLogEntries.push({
            serviceId: s.id,
            serviceName: s.name,
            staffId: config.staffId,
            isConcurrent: !!config.isConcurrent,
            assignedAt: now,
            assignedBy: currentUser?.uid || 'staff',
          });
        }
      }
    });

    updateDocumentNonBlocking(appointmentRef, {
      addOnIds: selectedAddOns.map(s => s.id),
      checkoutState: {
        ...currentCheckoutState,
        serviceStaffOverrides: newStaffOverrides,
        concurrentServiceIds: Array.from(new Set(newConcurrentIds)),
      },
      ...(newAssignmentLogEntries.length > 0 && {
        providerAssignments: arrayUnion(...newAssignmentLogEntries),
      }),
    });
    setIsAddAndConfigureOpen(false);
  };

  const handleCopyLink = useCallback(() => {
    if (appointment?.checkInToken) {
      const link = `${window.location.origin}/check-in/${appointment.checkInToken}`;
      navigator.clipboard.writeText(link);
      toast({ title: 'Link Copied' });
    }
  }, [appointment?.checkInToken, toast]);

  const handleMarkupSave = (markedUpUrl: string) => {
    if (!firestore || !tenantId || !appointment?.id) return;
    updateDocumentNonBlocking(doc(firestore, 'tenants', tenantId, 'appointments', appointment.id), { inspirationPhotoUrl: markedUpUrl });
    toast({ title: 'Technical Mapping Archived' });
  };

  const handleSendSMS = async (message: string) => {
    if (!client?.phone) { toast({ variant: 'destructive', title: 'No phone number on file' }); return; }
    setIsSendingSMS(true);
    try {
      await fetch('/api/notifications/send-sms', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: client.phone, message, tenantId }),
      });
      toast({ title: 'SMS sent', description: `Message sent to ${safeFormatPhone(client.phone)}` });
    } catch {
      toast({ variant: 'destructive', title: 'SMS failed' });
    } finally { setIsSendingSMS(false); }
  };

  const handleSendRequirements = async () => {
    if (!firestore || !tenantId || !appointment?.id || !service) return;
    if (!client?.email) { toast({ variant: 'destructive', title: 'Email needed', description: 'Add an email to this client first.' }); return; }
    setReqSending(true);
    try {
      const token = nanoid();
      const price = service.serviceTiers?.find((t: any) => t.tierId === (staff || []).find((s: any) => s.id === appointment.staffId)?.pricingTierId)?.price ?? service.price ?? 0;
      const depositCents = (() => { try { return computeDepositCents({ service, price, depositsLive: selectedTenant?.depositsLive === true }); } catch { return 0; } })();
      const requiredFormIds = service.requiredFormIds || [];
      const expiresAt = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
      const batch = writeBatch(firestore);
      batch.set(doc(firestore, `tenants/${tenantId}/bookingCompletions`, token), {
        token, tenantId, appointmentId: appointment.id, clientId: client.id, clientName: client.name,
        clientEmail: String(client.email).toLowerCase().trim(), serviceId: service.id, serviceName: service.name,
        depositAmountCents: depositCents, requiredConsentFormIds: requiredFormIds,
        skipCardStep: !!(client?.cardOnFile?.paymentMethodId || client?.cardOnFile?.token),
        cardAlreadyOnFile: !!(client?.cardOnFile?.paymentMethodId || client?.cardOnFile?.token),
        fileRequirements: requestPhotos ? [{ id: 'inspo', type: 'file_upload', label: 'Inspiration photos', required: true, prompt: 'Share your inspiration photos', minCount: 1, maxCount: 5, acceptedTypes: ['image/*'] }] : [],
        status: 'pending', createdAt: new Date().toISOString(), expiresAt,
      });
      batch.update(doc(firestore, `tenants/${tenantId}/appointments`, appointment.id), { completionStatus: 'pending', depositAmountCents: depositCents });
      const auditRef = doc(collection(firestore, `tenants/${tenantId}/completionRequests`));
      batch.set(auditRef, {
        id: auditRef.id, tenantId, appointmentId: appointment.id, clientId: client.id, clientName: client.name, token,
        requested: { deposit: depositCents > 0, card: true, consentForms: requiredFormIds.length, photos: requestPhotos },
        depositAmountCents: depositCents, channel: 'link', status: 'sent',
        source: 'appointment_details', requestedBy: currentUser?.uid || null,
        requestedAt: new Date().toISOString(), expiresAt,
      });
      await batch.commit();
      const link = `${window.location.origin}/complete/${tenantId}/${token}`;
      setReqLink(link);
      try {
        await fetch('/api/notifications/send-completion-link', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ link, clientName: client.name, clientEmail: client.email, clientPhone: client.phone, studioName: selectedTenant?.name }),
        });
      } catch {}
      toast({ title: 'Requirements sent', description: 'Secure link generated and sent to the client.' });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Could not send', description: e?.message || 'Unknown error' });
    } finally { setReqSending(false); }
  };

  const handleCollectDepositNow = async () => {
    if (!firestore || !tenantId || !appointment?.id || !client?.id || !service) return;
    setIsCollectingDeposit(true);
    try {
      const staffIdForPricing = appointment.checkoutState?.serviceStaffOverrides?.[service.id] || appointment.staffId;
      const staffForPricing = (staff || []).find((s: any) => s.id === staffIdForPricing);
      const price = service.serviceTiers?.find((t: any) => t.tierId === staffForPricing?.pricingTierId)?.price ?? service.price ?? 0;
      const depositCents = depositOwedCents > 0 ? depositOwedCents : (() => { try { return computeDepositCents({ service, price, depositsLive: selectedTenant?.depositsLive === true }); } catch { return 0; } })();
      if (!depositCents || depositCents <= 0) { toast({ variant: 'destructive', title: 'No deposit amount set' }); return; }
      const res = await fetch('/api/stripe/charge-card', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, clientId: client.id, amountCents: depositCents, description: `Deposit — ${service.name}`, category: 'Retainers', appointmentId: appointment.id, reason: 'Deposit collection (card on file)', mode: 'pos' }),
      });
      const out = await res.json().catch(() => null);
      if (!out?.ok) {
        if (out?.requiresAction) toast({ variant: 'destructive', title: 'Card needs verification', description: out.reason || 'Ask the client to verify their card.' });
        else toast({ variant: 'destructive', title: 'Could not collect deposit', description: out?.reason || 'Card charge failed.' });
        return;
      }
      const batch = writeBatch(firestore);
      batch.update(doc(firestore, 'tenants', tenantId, 'appointments', appointment.id), { depositStatus: 'paid', depositAmountCents: depositCents, depositStripePaymentIntentId: out.paymentIntentId });
      const creditRef = doc(collection(firestore, `tenants/${tenantId}/depositCredits`));
      batch.set(creditRef, { id: creditRef.id, tenantId, clientId: client.id, clientEmail: String(client.email || '').toLowerCase().trim(), clientName: client.name || 'Client', amountCents: depositCents, status: 'available', sourceAppointmentId: appointment.id, createdAt: new Date().toISOString(), stripeChargeId: out.paymentIntentId });
      await batch.commit();
      toast({ title: 'Deposit collected', description: `$${(depositCents / 100).toFixed(2)} charged to card on file.` });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Could not collect deposit', description: e?.message || 'Unknown error' });
    } finally { setIsCollectingDeposit(false); }
  };

  const handleProcessPendingRefund = async () => {
    if (!latestDepositDecision || !tenantId || !firestore) return;
    setIsProcessingRefund(true);
    try {
      const res = await fetch('/api/stripe/deposit-refund', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, creditId: latestDepositDecision.creditId }) });
      const out = await res.json().catch(() => null);
      if (!res.ok || !out?.ok) { toast({ variant: 'destructive', title: 'Refund failed', description: out?.error || 'Could not refund the deposit.' }); return; }
      const batch = writeBatch(firestore);
      batch.update(doc(firestore, 'tenants', tenantId, 'appointments', appointment.id), { depositDisposition: 'refunded', depositRefunded: true, depositRefundedAt: new Date().toISOString(), depositRefundedAmountCents: Math.round(safeNumber(latestDepositDecision.amountDollars) * 100) });
      batch.update(doc(firestore, `tenants/${tenantId}/depositDecisions`, latestDepositDecision.id), { outcome: 'refunded', resolvedAt: new Date().toISOString(), resolvedBy: currentUser?.uid || 'staff' });
      await batch.commit();
      toast({ title: 'Deposit refunded', description: `$${safeNumber(latestDepositDecision.amountDollars).toFixed(2)} returned to ${client?.name || 'the client'}.` });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Refund failed', description: e?.message || 'Unknown error' });
    } finally { setIsProcessingRefund(false); }
  };

  const handleKeepAsCredit = async () => {
    if (!latestDepositDecision || !tenantId || !firestore) return;
    setIsProcessingRefund(true);
    try {
      await updateDocumentNonBlocking(doc(firestore, `tenants/${tenantId}/depositDecisions`, latestDepositDecision.id), { outcome: 'kept_as_credit', resolvedAt: new Date().toISOString(), resolvedBy: currentUser?.uid || 'staff' });
      toast({ title: 'Kept as store credit' });
    } finally { setIsProcessingRefund(false); }
  };

  const handleEscalate = async () => {
    if (!firestore || !tenantId || !appointment?.id) return;
    setIsEscalating(true);
    const batch = writeBatch(firestore);
    const adminsAndOwners = (staff || []).filter(s => s.role === 'admin' || s.role === 'owner');
    const now = new Date().toISOString();
    const appointmentRef = doc(firestore, `tenants/${tenantId}/appointments`, appointment.id);
    batch.update(appointmentRef, { isEscalated: true });
    if (appointment.isWalkIn) {
      const walkInRef = doc(firestore, `tenants/${tenantId}/walkIns`, String(appointment.id).replace('apt-walkin-', ''));
      batch.update(walkInRef, { isEscalated: true });
    }
    adminsAndOwners.forEach(admin => {
      const notifRef = doc(collection(firestore, `tenants/${tenantId}/notifications`));
      batch.set(notifRef, { id: notifRef.id, userId: admin.id, type: 'escalation', message: `URGENT ESCALATION: Service Issue for ${client?.name || 'Guest'} at ${safeTicketId(appointment.id)}`, link: `/pos?checkout_id=${appointment.id}`, createdAt: now, read: false });
    });
    try { await batch.commit(); toast({ title: 'Manager Notified', description: 'Escalation sequence initiated.' }); }
    catch { toast({ variant: 'destructive', title: 'Escalation Failed' }); }
    finally { setIsEscalating(false); }
  };

  const handleResolveEscalation = async () => {
    if (!firestore || !tenantId || !appointment?.id) return;
    setIsResolving(true);
    const batch = writeBatch(firestore);
    const now = new Date().toISOString();
    batch.update(doc(firestore, `tenants/${tenantId}/appointments`, appointment.id), { isEscalated: false, resolutionNotes: resolutionNote, resolvedAt: now, resolvedBy: currentUser?.uid });
    if (appointment.isWalkIn) {
      batch.update(doc(firestore, `tenants/${tenantId}/walkIns`, String(appointment.id).replace('apt-walkin-', '')), { isEscalated: false });
    }
    try { await batch.commit(); toast({ title: 'Escalation Resolved' }); setResolutionNote(''); }
    catch { toast({ variant: 'destructive', title: 'Resolution Failed' }); }
    finally { setIsResolving(false); }
  };

  // ── All hooks done — safe to early-return ──────────────────────────────────
  if (!mounted || !open || !appointment || !client || !service) return null;

  const isOwnerOrAdminUser = role === 'owner' || role === 'admin';
  const ticketId = safeTicketId(appointment.id);
  const mainStaffId = appointment.checkoutState?.serviceStaffOverrides?.[service.id] || appointment.staffId;
  const mainStaffMember = (staff || []).find((s: Staff) => s.id === mainStaffId);
  const reqFiles = appointment.requirementFiles || [];
  const isCancelled = appointment.status === 'cancelled';
  const isCompleted = appointment.status === 'completed';
  const outstandingBalance = safeNumber(client.outstandingBalance);
  const adjustmentCharge = financialData?.adjustmentCharge ?? 0;

  const SourceIcon = appointment.source === 'online' ? Globe : appointment.isWalkIn || appointment.source === 'walk-in' ? MapPin : Edit;
  const sourceLabel = appointment.source === 'online' ? 'Online' : appointment.isWalkIn || appointment.source === 'walk-in' ? 'Walk-in' : 'Manual';

  const statusLabel: Record<string, string> = {
    confirmed: 'Confirmed', deposit_pending: 'Awaiting Deposit', ready_for_checkout: 'Ready',
    servicing: 'In Session', completed: 'Completed', cancelled: 'Cancelled',
  };

  // Preferred staff detection
  const staffFreq: Record<string, number> = {};
  allClientVisits.forEach((a: any) => { if (a.staffId) staffFreq[a.staffId] = (staffFreq[a.staffId] || 0) + 1; });
  const preferredStaffId = Object.entries(staffFreq).sort((a, b) => b[1] - a[1])[0]?.[0];
  const isPreferredStaff = preferredStaffId === mainStaffId && allClientVisits.length > 1;
  const isFirstTimeWithStaff = allClientVisits.filter((a: any) => a.staffId === mainStaffId).length === 0;

  // ── Identity header ────────────────────────────────────────────────────────
  const IdentityHeader = (
    <div className="flex items-center gap-3 min-w-0">
      <Link href={`/clients/${client.id}`} className="shrink-0 transition-opacity hover:opacity-80">
        <Avatar className="w-11 h-11 border-2 border-background shadow-lg rounded-2xl shrink-0">
          <AvatarImage src={client.avatarUrl} className="object-cover" />
          <AvatarFallback className="text-sm font-black bg-primary/10 text-primary uppercase">
            {(client?.name || 'G').substring(0, 2).toUpperCase()}
          </AvatarFallback>
        </Avatar>
      </Link>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 flex-wrap">
          <Link href={`/clients/${client.id}`} className="hover:underline">
            <h2 className="font-black uppercase tracking-tighter text-slate-900 truncate text-base leading-none">{client.name}</h2>
          </Link>
          {client.activeMembershipId && <Badge className="h-[16px] px-1.5 rounded-full font-black uppercase text-[7px] tracking-widest bg-indigo-600 text-white border-none shrink-0"><Award className="w-2 h-2 mr-0.5" />Member</Badge>}
          {client.status === 'banned' && <Badge className="h-[16px] px-1.5 rounded-full font-black uppercase text-[7px] tracking-widest bg-black text-white border-none shrink-0"><Ban className="w-2 h-2 mr-0.5" />Banned</Badge>}
          {client.hasOpenDispute && <Badge className="h-[16px] px-1.5 rounded-full font-black uppercase text-[7px] tracking-widest bg-purple-600 text-white border-none shrink-0"><AlertTriangle className="w-2 h-2 mr-0.5" />Dispute</Badge>}
          <StoreCreditBadge credits={Array.isArray(availableCredits) ? availableCredits : []} totalAvailable={totalStoreCreditAvailable} />
        </div>
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          {client.phone && (
            <span className="flex items-center gap-1 shrink-0">
              <a href={`tel:${client.phone}`} className="text-[9px] font-bold text-primary uppercase tracking-widest flex items-center gap-1 hover:underline">
                <Phone className="w-2.5 h-2.5" /> {safeFormatPhone(client.phone)}
              </a>
              <a href={`sms:${client.phone}`} title="Text" className="text-primary/40 hover:text-primary transition-colors"><MessageSquare className="w-3 h-3" /></a>
            </span>
          )}
          {client.email && (
            <a href={`mailto:${client.email}`} className="text-[9px] font-bold text-primary uppercase tracking-widest truncate flex items-center gap-1 hover:underline min-w-0 max-w-[140px]">
              <Mail className="w-2.5 h-2.5 shrink-0" /><span className="truncate">{client.email}</span>
            </a>
          )}
          {/* Copyable ticket ID */}
          <button
            onClick={() => copyTicket(appointment.id)}
            className="flex items-center gap-1 text-[9px] font-bold text-muted-foreground uppercase tracking-widest opacity-50 hover:opacity-80 transition-opacity shrink-0"
            title="Copy ticket ID"
          >
            {ticketCopied ? <Check className="w-2.5 h-2.5 text-green-600" /> : <Hash className="w-2.5 h-2.5" />}
            {ticketId}
          </button>
        </div>
      </div>
      <Badge variant="outline" className={cn(
        'h-6 px-2 rounded-full font-black uppercase text-[8px] tracking-widest border-2 shrink-0',
        isCancelled ? 'border-destructive/30 text-destructive bg-destructive/5'
        : isCompleted ? 'border-green-300 text-green-700 bg-green-50'
        : canFinish ? 'border-primary/30 text-primary bg-primary/5'
        : 'border-muted text-muted-foreground'
      )}>
        {statusLabel[appointment.status] || appointment.status}
      </Badge>
    </div>
  );

  // ── Sheet body ─────────────────────────────────────────────────────────────
  const SheetBody = (
    <ScrollArea className="flex-1 overflow-y-auto">
      <div className="space-y-5 p-4 md:p-6 pb-6">

        {/* ── Status section ─────────────────────────────────────────────── */}
        {isCancelled
          ? <CancellationRecord appointment={appointment} transactions={transactions} staff={staff || []} cancellationEvent={cancellationEvent} depositDecision={latestDepositDecision} onProcessRefund={handleProcessPendingRefund} onKeepAsCredit={handleKeepAsCredit} isProcessingRefund={isProcessingRefund} />
          : isCompleted
            ? <CompletionReceipt appointment={appointment} transactions={transactions} staff={staff || []} providers={providers} />
            : <ReadinessBanner appointment={appointment} client={client} complianceInfo={complianceInfo} hasDeposit={hasLiveDeposit} isLoadingDeposit={isLoadingLiveDeposit} cardSecured={cardSecured} />}

        {/* ── Live timer ─────────────────────────────────────────────────── */}
        {appointment.status === 'servicing' && elapsedTime && (
          <div className={cn('rounded-2xl border-4 text-center p-4 transition-all', isRunningOver ? 'bg-destructive/5 border-destructive animate-pulse' : 'bg-primary/5 border-primary/20')}>
            <p className="text-[9px] font-black uppercase tracking-[0.2em] text-primary mb-1">Live Session Time</p>
            <p className={cn('font-black font-mono tracking-tighter text-4xl', isRunningOver ? 'text-destructive' : 'text-primary')}>{elapsedTime}</p>
            {isRunningOver && <p className="text-[8px] font-black uppercase tracking-widest text-destructive/60 mt-1">Running over by {Math.floor(differenceInSeconds(new Date(), safeDate(appointment.actualStartTime)) / 60) - (service?.duration || 0)}m</p>}
            <button
              onClick={() => setIsHandoffOpen(true)}
              className="mt-3 w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl border-2 border-dashed border-primary/20 bg-white/60 hover:bg-white hover:border-primary/40 transition-all"
            >
              <Repeat2 className="w-3 h-3 text-primary/60" />
              <span className="text-[8px] font-black uppercase tracking-widest text-primary/60">Client wants a different artist? Hand off now</span>
            </button>
          </div>
        )}

        {/* ── Reschedule badge ────────────────────────────────────────────── */}
        {safeNumber(appointment.rescheduleCount) > 0 && (
          <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-blue-50 border-2 border-blue-200 text-[9px] font-bold uppercase text-blue-700">
            <RefreshCw className="w-3 h-3 shrink-0" />
            Rescheduled {appointment.rescheduleCount}×
            {appointment.lastRescheduledAt && ` · last moved ${format(safeDate(appointment.lastRescheduledAt), 'MMM d, h:mm a')}`}
            {appointment.lastRescheduledBy && ` by ${staffName(appointment.lastRescheduledBy, staff)}`}
          </div>
        )}

        {/* ── Client intelligence ─────────────────────────────────────────── */}
        <div className="space-y-3">
          <h3 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-60 flex items-center gap-1.5">
            <Activity className="w-3 h-3" /> Client Intelligence
          </h3>
          <ClientStatsBar client={client} recentVisits={recentVisits} allVisits={allClientVisits} />
          {/* Staff relationship signal */}
          {(isPreferredStaff || isFirstTimeWithStaff) && (
            <div className={cn('flex items-center gap-2 px-3.5 py-2.5 rounded-xl border-2 text-[9px] font-bold uppercase', isPreferredStaff ? 'bg-indigo-50 border-indigo-200 text-indigo-700' : 'bg-amber-50 border-amber-200 text-amber-700')}>
              {isPreferredStaff ? <><Star className="w-3 h-3 shrink-0" /> Preferred artist — {allClientVisits.filter((a: any) => a.staffId === mainStaffId).length} visits together</> : <><UserCheck className="w-3 h-3 shrink-0" /> First time with {mainStaffMember?.name || 'this artist'}</>}
            </div>
          )}
          {/* Referral source */}
          {client.referralSource && (
            <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-muted/5 border-2 border-transparent text-[9px] font-bold uppercase text-muted-foreground">
              <ArrowUpRight className="w-3 h-3 shrink-0 opacity-50" /> Referred via {client.referralSource}
            </div>
          )}
        </div>

        {/* ── Service card ─────────────────────────────────────────────────── */}
        <Card className="rounded-[1.5rem] border-2 bg-muted/5 shadow-inner overflow-hidden">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-[10px] font-black uppercase text-slate-700 tracking-tight">
                <Calendar className="w-3.5 h-3.5 text-primary shrink-0" />
                {format(safeDate(appointment.startTime), 'EEE, MMM d · h:mm a')}
                {appointment.rescheduledFromTime && (
                  <span className="text-[9px] font-bold text-muted-foreground line-through opacity-50">
                    {format(safeDate(appointment.rescheduledFromTime), 'MMM d, h:mm a')}
                  </span>
                )}
              </div>
              <span className="flex items-center gap-1 text-[8px] font-black uppercase tracking-widest text-muted-foreground opacity-60 shrink-0">
                <SourceIcon className="w-3 h-3" /> {sourceLabel}
              </span>
            </div>

            {/* Multi-provider strip — shows everyone currently involved */}
            {providers.length > 1 && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-indigo-50 border-2 border-indigo-200">
                <Users className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                  <span className="text-[8px] font-black uppercase tracking-widest text-indigo-700 shrink-0">Multi-Provider:</span>
                  {providers.map((p) => (
                    <span key={p.staffId} className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-white border border-indigo-200">
                      <Avatar className="h-3.5 w-3.5">
                        <AvatarImage src={p.staffMember?.avatarUrl} className="object-cover" />
                        <AvatarFallback className="text-[6px] font-black bg-primary/10 text-primary">
                          {(p.staffMember?.name || 'S')[0]}
                        </AvatarFallback>
                      </Avatar>
                      <span className="text-[8px] font-black uppercase text-indigo-700">
                        {p.staffMember?.name || 'Staff'}
                        {p.isMain ? ' (Lead)' : p.services.some(sv => sv.isConcurrent) ? ' (Concurrent)' : ''}
                      </span>
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className="flex justify-between items-start gap-4">
              <div className="space-y-1 min-w-0 flex-1">
                <p className="font-black text-base uppercase tracking-tight text-slate-900 truncate leading-tight">{service.name}</p>
                <div className="flex items-center gap-2 text-[9px] font-bold text-muted-foreground uppercase tracking-widest">
                  <Clock className="w-2.5 h-2.5" /> {service.duration}m
                  {(appointment.addOnIds || []).length > 0 && <span className="opacity-60">· {(appointment.addOnIds || []).length} add-on{(appointment.addOnIds || []).length !== 1 ? 's' : ''}</span>}
                </div>
                <div className="flex items-center gap-2 pt-1.5 mt-1 border-t border-dashed border-primary/10">
                  <Avatar className="h-5 w-5 border shadow-sm">
                    <AvatarImage src={mainStaffMember?.avatarUrl} className="object-cover" />
                    <AvatarFallback className="text-[8px] font-black bg-primary/10 text-primary">{(mainStaffMember?.name || 'S')[0]}</AvatarFallback>
                  </Avatar>
                  <span className="text-[9px] font-black uppercase text-primary tracking-widest truncate">{mainStaffMember?.name || 'Unassigned'}</span>
                </div>
              </div>
              <div className="text-right shrink-0">
                <p className="text-2xl font-black text-primary tracking-tighter font-mono">${(financialData?.revenue ?? 0).toFixed(2)}</p>
                {financialData?.vsAverage !== null && financialData?.vsAverage !== undefined && (
                  <p className={cn('text-[8px] font-black uppercase tracking-widest', financialData.vsAverage >= 0 ? 'text-green-600' : 'text-amber-600')}>
                    {financialData.vsAverage >= 0 ? '↑' : '↓'} {Math.abs(financialData.vsAverage).toFixed(0)}% vs avg
                  </p>
                )}
              </div>
            </div>
            {(appointment.addOnIds || []).length > 0 && (
              <div className="space-y-2 pt-2 border-t border-dashed">
                {(appointment.addOnIds || []).map((id: string) => {
                  const s = (allServices || []).find((svc) => svc.id === id);
                  if (!s) return null;
                  const assignedStaffId = appointment.checkoutState?.serviceStaffOverrides?.[id];
                  const isDifferentProvider = !!assignedStaffId && assignedStaffId !== appointment.staffId;
                  const isConcurrent = (appointment.checkoutState?.concurrentServiceIds || []).includes(id);
                  const assignedStaffMember = isDifferentProvider ? (staff || []).find((st: any) => st.id === assignedStaffId) : null;
                  return (
                    <div key={id} className="flex items-center justify-between text-[10px] font-bold uppercase text-muted-foreground bg-white p-2 rounded-lg border border-muted/20">
                      <span className="truncate flex items-center gap-2 min-w-0">
                        <Sparkles className="w-3 h-3 shrink-0" />
                        <span className="truncate">{s.name}</span>
                        {isDifferentProvider && (
                          <span className="flex items-center gap-1 shrink-0 text-primary/70 normal-case">
                            <Avatar className="h-3.5 w-3.5 border shrink-0">
                              <AvatarImage src={assignedStaffMember?.avatarUrl} className="object-cover" />
                              <AvatarFallback className="text-[6px] font-black bg-primary/10 text-primary">
                                {(assignedStaffMember?.name || 'S')[0]}
                              </AvatarFallback>
                            </Avatar>
                            {assignedStaffMember?.name || 'Staff'}
                            {isConcurrent && <span className="text-[7px] font-black px-1 rounded bg-indigo-100 text-indigo-700 shrink-0">CONCURRENT</span>}
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 text-primary font-mono">${(s.price ?? 0).toFixed(2)}</span>
                    </div>
                  );
                })}
              </div>
            )}
            {/* Promo code if applied */}
            {appointment.promoCode && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200">
                <BadgePercent className="w-3 h-3 text-amber-600 shrink-0" />
                <span className="text-[9px] font-black uppercase tracking-widest text-amber-700">Promo: {appointment.promoCode}</span>
              </div>
            )}
            {!isCancelled && (
              <Button variant="ghost" size="sm" onClick={() => setIsAddAndConfigureOpen(true)} className="h-7 px-2 text-[8px] font-black uppercase tracking-widest text-primary border border-primary/20 rounded-lg hover:bg-primary/5 w-fit">
                <PlusCircle className="w-3 h-3 mr-1" /> Add Part
              </Button>
            )}
          </CardContent>
        </Card>

        {/* ── Financial summary (active appointments only) ──────────────── */}
        {!isCancelled && !isCompleted && (
          <div className="space-y-3">
            <h3 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-60 flex items-center gap-1.5">
              <DollarSign className="w-3 h-3" /> Financial Summary
            </h3>
            <div className="rounded-2xl border-2 bg-white shadow-inner divide-y divide-dashed divide-muted/30 px-4">
              <RequirementRow
                icon={<Wallet className="w-3.5 h-3.5" />} label="Deposit"
                status={appointment.depositStatus === 'paid' ? 'good' : depositOwedCents > 0 ? 'bad' : 'neutral'}
                value={appointment.depositStatus === 'paid' ? `Paid $${(depositOwedCents / 100).toFixed(2)}` : depositOwedCents > 0 ? `Due $${(depositOwedCents / 100).toFixed(2)}` : '—'}
                action={canCollectDepositNow && (
                  <Button size="sm" onClick={handleCollectDepositNow} disabled={isCollectingDeposit}
                    className="h-7 px-2.5 rounded-lg text-[8px] font-black uppercase tracking-widest shadow-md shadow-primary/20">
                    {isCollectingDeposit ? <Loader className="w-3 h-3 animate-spin" /> : <><CreditCard className="w-3 h-3 mr-1" />Collect</>}
                  </Button>
                )}
              />
              <RequirementRow icon={<ShieldCheck className="w-3.5 h-3.5" />} label="Card on File" status={cardSecured ? 'good' : 'neutral'} value={cardSecured ? 'Secured' : 'Not on file'} />
              {outstandingBalance > 0 && (
                <RequirementRow icon={<AlertTriangle className="w-3.5 h-3.5" />} label="Outstanding Balance" status="bad" value={`$${outstandingBalance.toFixed(2)}`} />
              )}
              {adjustmentCharge > 0 && (
                <RequirementRow icon={<Scale className="w-3.5 h-3.5" />} label="Adjustment Fee" status="warn" value={`$${adjustmentCharge.toFixed(2)} at checkout`} />
              )}
              {/* Profit margin indicator for owner/admin */}
              {isOwnerOrAdminUser && financialData && financialData.breakEven > 0 && (
                <RequirementRow
                  icon={<TrendingUp className="w-3.5 h-3.5" />} label="Margin"
                  status={financialData.profit > 0 ? 'good' : financialData.profit === 0 ? 'warn' : 'bad'}
                  value={`$${financialData.profit.toFixed(2)} (${financialData.revenue > 0 ? ((financialData.profit / financialData.revenue) * 100).toFixed(0) : 0}%)`}
                />
              )}
              <div className="py-2">
                <StoreCreditSection client={client} />
              </div>
            </div>
            {canCollectDepositNow && (
              <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-tight opacity-60 leading-relaxed pl-1">
                Card on file but no deposit was collected — charge it now instead of waiting on a link.
              </p>
            )}
          </div>
        )}

        {/* ── Session note ────────────────────────────────────────────────── */}
        <div className="space-y-2">
          <h3 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-60 flex items-center gap-1.5">
            <StickyNote className="w-3 h-3" /> Session Note
          </h3>
          <SessionNotePanel
            appointment={appointment} tenantId={tenantId!} firestore={firestore}
            currentUser={currentUser} staff={staff || []}
          />
        </div>

        {/* ── After photos (completed only) ───────────────────────────────── */}
        {isCompleted && (
          <div className="space-y-2">
            <h3 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-60 flex items-center gap-1.5">
              <Camera className="w-3 h-3" /> After Photos
            </h3>
            <AfterPhotoPanel appointment={appointment} tenantId={tenantId!} firestore={firestore} />
          </div>
        )}

        {/* ── Requirements & intake ───────────────────────────────────────── */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-60">Requirements & Intake</h3>
            <Badge className={cn('text-[8px] font-black uppercase h-5 px-2 border-none text-white shadow-sm', appointment.completionStatus === 'complete' ? 'bg-green-500' : appointment.completionStatus === 'pending' ? 'bg-amber-500' : 'bg-slate-400')}>
              {appointment.completionStatus === 'complete' ? <><CheckCircle2 className="w-2 h-2 mr-1" /> Complete</> : appointment.completionStatus === 'pending' ? <><Clock className="w-2 h-2 mr-1" /> Awaiting Client</> : 'None Requested'}
            </Badge>
          </div>

          {complianceInfo.healthPendingForms.length > 0 && (
            <div className="rounded-2xl bg-red-50 border-2 border-red-300 p-3.5 space-y-2">
              <p className="text-[9px] font-black uppercase tracking-widest text-red-700 flex items-center gap-1.5"><HeartPulse className="w-3 h-3" /> Health Disclosure Required</p>
              {complianceInfo.healthPendingForms.map(f => (
                <div key={f.id} className="flex items-center justify-between text-[10px] font-bold uppercase text-red-700 bg-white/70 p-2 rounded-lg border border-red-200">
                  <span className="flex items-center gap-2 truncate"><FileSignature className="w-3 h-3 opacity-50" /> {f.title}</span>
                  <span className="shrink-0 ml-4 opacity-70">Unsigned</span>
                </div>
              ))}
            </div>
          )}

          <div className="p-4 rounded-2xl bg-muted/10 border-2 space-y-1 shadow-inner divide-y divide-dashed divide-muted/30">
            {complianceInfo.otherPendingForms.map(f => (
              <div key={f.id} className="flex items-center justify-between text-[10px] font-bold uppercase text-amber-700 py-2">
                <span className="flex items-center gap-2 truncate"><FileSignature className="w-3 h-3 opacity-40" /> {f.title}</span>
                <span className="shrink-0 ml-4">Required</span>
              </div>
            ))}
            {complianceInfo.allCertified && (
              <div className="flex items-center gap-2 text-[10px] font-black uppercase text-green-600 py-1">
                <CheckCircle2 className="w-3 h-3" /> All consent forms signed
              </div>
            )}
            <div className="pt-2">
              <Button variant="ghost" className="w-full h-10 rounded-xl font-black uppercase text-[10px] tracking-widest text-primary hover:bg-primary/5 border border-primary/10" onClick={handleCopyLink}>
                <LinkIcon className="w-3 h-3 mr-2" /> Dispatch Guest Link
              </Button>
            </div>
            {reqFiles.map((rf: any) => (
              <div key={rf.requirementId} className="space-y-2 pt-2">
                <div className="flex items-center justify-between text-[10px] font-black uppercase">
                  <span className="flex items-center gap-2 text-muted-foreground"><FileImage className="w-3 h-3 opacity-40" /> {rf.label || 'Files'}</span>
                  <span className="text-green-600">{(rf.files || []).length} received</span>
                </div>
                {(rf.files || []).length > 0 && (
                  <div className="grid grid-cols-4 gap-2">
                    {(rf.files || []).map((f: any, i: number) =>
                      /\.(png|jpe?g|gif|webp)$/i.test(f.name || '')
                        ? <button key={i} onClick={() => setExpandedImage(f.url)} className="relative aspect-square rounded-lg overflow-hidden border bg-muted/5 cursor-zoom-in"><img src={f.url} alt={f.name} className="w-full h-full object-cover" /></button>
                        : <a key={i} href={f.url} target="_blank" rel="noreferrer" className="flex items-center justify-center aspect-square rounded-lg border bg-muted/5 text-[8px] p-1 text-center text-muted-foreground break-all">{f.name}</a>
                    )}
                  </div>
                )}
              </div>
            ))}
            {!reqLink ? (
              !isRequestOpen ? (
                <Button variant="ghost" className="w-full h-10 rounded-xl font-black uppercase text-[10px] tracking-widest text-primary hover:bg-primary/5 border border-primary/10 mt-1" onClick={() => setIsRequestOpen(true)}>
                  <ArrowRight className="w-3 h-3 mr-2" /> Request from Client
                </Button>
              ) : (
                <div className="space-y-3 pt-2">
                  <button type="button" onClick={() => setRequestPhotos(v => !v)} className={cn('w-full flex items-center justify-between p-3 rounded-xl border-2 text-left transition-all', requestPhotos ? 'border-primary bg-primary/5' : 'border-border bg-white')}>
                    <span className="text-[10px] font-black uppercase tracking-widest flex items-center gap-2"><FileImage className="w-3.5 h-3.5 text-primary" /> Request inspo photos</span>
                    <div className={cn('w-9 h-5 rounded-full relative transition-colors shrink-0', requestPhotos ? 'bg-primary' : 'bg-slate-200')}>
                      <div className={cn('absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all', requestPhotos ? 'left-[18px]' : 'left-0.5')} />
                    </div>
                  </button>
                  <Button onClick={handleSendRequirements} disabled={reqSending} className="w-full h-11 rounded-xl font-black uppercase text-[10px] tracking-widest shadow-lg shadow-primary/20">
                    {reqSending ? <Loader className="w-4 h-4 animate-spin" /> : 'Generate & Send Link'}
                  </Button>
                </div>
              )
            ) : (
              <div className="space-y-2 pt-2">
                <div className="flex items-center gap-2">
                  <input readOnly value={reqLink} onFocus={e => e.currentTarget.select()} className="flex-1 h-10 rounded-xl border-2 px-3 text-[10px] font-mono bg-white" />
                  <Button onClick={() => { navigator.clipboard.writeText(reqLink!); setReqCopied(true); setTimeout(() => setReqCopied(false), 2000); }} className="h-10 px-3 rounded-xl font-black uppercase text-[9px] tracking-widest shrink-0">
                    {reqCopied ? 'Copied' : 'Copy'}
                  </Button>
                </div>
                <p className="text-[9px] font-black text-green-600 uppercase tracking-tight">Sent to {client.name} · valid 7 days</p>
              </div>
            )}
          </div>
        </div>

        {/* ── Inspiration photo & markup ───────────────────────────────────── */}
        {appointment.inspirationPhotoUrl && (
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <h3 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-60">Inspiration & Mapping</h3>
              <Button variant="ghost" size="sm" onClick={() => setIsMarkupOpen(true)} className="h-7 px-3 text-[9px] font-black uppercase tracking-widest text-primary border border-primary/20 rounded-lg hover:bg-primary/5">
                <Edit className="w-3 h-3 mr-1.5" /> Markup Tool
              </Button>
            </div>
            <div className="relative aspect-video w-full rounded-[2rem] overflow-hidden border-2 border-primary/10 bg-muted/5 group shadow-inner cursor-zoom-in" onClick={() => setExpandedImage(appointment.inspirationPhotoUrl)}>
              <NextImage src={appointment.inspirationPhotoUrl} alt="Inspiration" fill className="object-cover transition-transform duration-700 hover:scale-105" />
              <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                <Maximize2 className="w-8 h-8 text-white" />
              </div>
              <div className="absolute top-4 right-4">
                <Badge className="bg-primary/90 backdrop-blur-md text-white border-none font-black text-[8px] uppercase h-6 px-3 shadow-xl">Guest Choice</Badge>
              </div>
            </div>
          </div>
        )}

        {/* ── Incident report ──────────────────────────────────────────────── */}
        {appointment.incident && (
          <div className="space-y-3">
            <h3 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-60">Incident Report</h3>
            <div className={cn('rounded-2xl border-2 p-4 space-y-2.5', appointment.incident.severity === 'Severe' ? 'bg-red-50 border-red-300' : appointment.incident.severity === 'Moderate' ? 'bg-amber-50 border-amber-300' : 'bg-slate-50 border-slate-200')}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-black uppercase tracking-wide flex items-center gap-2 text-slate-800"><AlertCircle className="w-3.5 h-3.5" /> {appointment.incident.type}</span>
                <Badge className={cn('text-[8px] font-black uppercase border-none text-white shrink-0', appointment.incident.severity === 'Severe' ? 'bg-red-600' : appointment.incident.severity === 'Moderate' ? 'bg-amber-600' : 'bg-slate-500')}>{appointment.incident.severity}</Badge>
              </div>
              {appointment.incident.date && <p className="text-[8px] font-bold uppercase tracking-widest text-muted-foreground opacity-60">{format(safeDate(appointment.incident.date), 'MMM d, yyyy · h:mm a')}</p>}
              <p className="text-[10px] font-medium text-slate-700 leading-relaxed">{appointment.incident.description}</p>
              {appointment.incident.actionsTaken && <p className="text-[9px] font-bold uppercase text-muted-foreground"><span className="opacity-60">Action taken: </span>{appointment.incident.actionsTaken}</p>}
              {appointment.incident.photoUrls?.length > 0 && (
                <div className="grid grid-cols-4 gap-2 pt-1">
                  {appointment.incident.photoUrls.map((url: string, i: number) => (
                    <button key={i} onClick={() => setExpandedImage(url)} className="relative aspect-square rounded-lg overflow-hidden border bg-white cursor-zoom-in">
                      <img src={url} alt="Incident documentation" className="w-full h-full object-cover" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Activity timeline ────────────────────────────────────────────── */}
        <Accordion type="single" collapsible className="w-full">
          <AccordionItem value="timeline" className="border-2 rounded-2xl overflow-hidden bg-white shadow-inner">
            <AccordionTrigger className="px-4 py-3 hover:no-underline">
              <span className="flex items-center gap-2 font-black uppercase text-[10px] tracking-widest text-slate-700">
                <History className="w-3.5 h-3.5 text-primary" /> Activity Timeline
                <Badge variant="outline" className="h-5 px-2 rounded-full text-[8px] font-black border-2 ml-1">{timelineEvents.length}</Badge>
              </span>
            </AccordionTrigger>
            <AccordionContent className="px-4 pb-4 pt-1">
              {timelineEvents.length === 0 ? (
                <p className="text-[9px] font-bold text-muted-foreground uppercase opacity-40 text-center py-3">No recorded activity yet</p>
              ) : (
                <div className="border-l-2 border-dashed border-muted/40 ml-1.5 pl-4">
                  {timelineEvents.map((ev) => {
                    const Icon = ev.icon;
                    const tone = TIMELINE_TONE[ev.tone || 'default'];
                    const bg = TIMELINE_BG[ev.tone || 'default'];
                    return (
                      <div key={ev.id} className="relative pb-4 last:pb-0">
                        <span className={cn('absolute -left-[1.45rem] top-0.5 w-3 h-3 rounded-full border-2 border-white', bg)} />
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className={cn('text-[10px] font-black uppercase tracking-tight flex items-center gap-1.5', tone)}>
                              <Icon className="w-3 h-3 shrink-0" /> {ev.label}
                            </p>
                            {ev.detail && <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-tight opacity-60 mt-0.5">{ev.detail}</p>}
                          </div>
                          <span className="text-[8px] font-bold text-muted-foreground uppercase tracking-wide opacity-50 shrink-0 whitespace-nowrap">
                            {format(safeDate(ev.timestamp), 'MMM d, h:mm a')}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </AccordionContent>
          </AccordionItem>
        </Accordion>

        {/* ── Dossier intelligence ─────────────────────────────────────────── */}
        <div className="space-y-3">
          <h3 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-60">Dossier Intelligence</h3>
          <Accordion type="multiple" className="w-full space-y-2">

            <AccordionItem value="pref-notes" className="border-2 rounded-2xl overflow-hidden bg-muted/5 shadow-inner">
              <AccordionTrigger className="px-4 py-3 hover:no-underline font-black uppercase text-[9px] tracking-[0.2em] text-slate-600">
                <Sparkles className="w-3.5 h-3.5 mr-2 opacity-40" /> Preferences & Notes
              </AccordionTrigger>
              <AccordionContent className="px-4 pb-4 pt-2 space-y-4">
                {client.notes?.goals && <div className="space-y-1"><p className="text-[8px] font-black uppercase text-primary/60">Strategic Goals</p><p className="text-[10px] font-medium leading-relaxed italic">"{client.notes.goals}"</p></div>}
                {client.sensoryNeeds && <div className="space-y-1"><p className="text-[8px] font-black uppercase text-blue-600/60">Sensory Needs</p><p className="text-[10px] font-medium leading-relaxed italic">"{client.sensoryNeeds}"</p></div>}
                {client.allergyNotes && <div className="space-y-1"><p className="text-[8px] font-black uppercase text-red-600">Allergy / Medical</p><p className="text-[10px] font-medium leading-relaxed text-red-700">"{client.allergyNotes}"</p></div>}
                {client.notes?.history && <div className="space-y-1"><p className="text-[8px] font-black uppercase text-muted-foreground opacity-60">History Alert</p><p className="text-[10px] font-medium leading-relaxed italic">"{client.notes.history}"</p></div>}
                {!client.notes?.goals && !client.sensoryNeeds && !client.allergyNotes && !client.notes?.history && (
                  <p className="text-[9px] font-bold text-muted-foreground uppercase opacity-40 text-center py-2">No preference data archived</p>
                )}
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="prev-formulas" className="border-2 rounded-2xl overflow-hidden bg-muted/5 shadow-inner">
              <AccordionTrigger className="px-4 py-3 hover:no-underline font-black uppercase text-[9px] tracking-[0.2em] text-slate-600">
                <FlaskConical className="w-3.5 h-3.5 mr-2 opacity-40" /> Technical Formulas
              </AccordionTrigger>
              <AccordionContent className="px-4 pb-4 pt-2 space-y-3">
                {client.customFormulas && client.customFormulas.length > 0 ? (
                  <div className="grid gap-2">
                    {client.customFormulas.map((f: any) => (
                      <div key={f.id} className="p-3 rounded-xl bg-white border-2 border-transparent hover:border-primary/10 transition-all flex justify-between items-center shadow-sm">
                        <div className="min-w-0">
                          <span className="text-[10px] font-black uppercase tracking-tight truncate block">{f.name}</span>
                          <span className="text-[8px] font-bold text-muted-foreground uppercase opacity-60">{format(safeDate(f.date), 'MMM d, yyyy')}</span>
                        </div>
                        <ArrowRight className="w-3 h-3 text-primary opacity-20" />
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-[9px] font-bold text-muted-foreground uppercase opacity-40 text-center py-2">No historical formulas found</p>
                )}
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="recent-visits" className="border-2 rounded-2xl overflow-hidden bg-muted/5 shadow-inner">
              <AccordionTrigger className="px-4 py-3 hover:no-underline font-black uppercase text-[9px] tracking-[0.2em] text-slate-600">
                <Calendar className="w-3.5 h-3.5 mr-2 opacity-40" /> Recent Visits
                <Badge variant="outline" className="h-4 px-1.5 rounded-full text-[7px] font-black border ml-2">{allClientVisits.length}</Badge>
              </AccordionTrigger>
              <AccordionContent className="px-4 pb-4 pt-2 space-y-2">
                {/* Visit frequency sparkline */}
                {allClientVisits.length > 1 && (
                  <div className="flex items-center gap-3 px-3 py-2 rounded-xl bg-white border border-muted/20 mb-2">
                    <div className="min-w-0">
                      <p className="text-[8px] font-black uppercase tracking-widest text-muted-foreground opacity-60 mb-1">Visit frequency</p>
                      <VisitSparkline visits={allClientVisits} />
                    </div>
                  </div>
                )}
                {recentVisits.length > 0 ? recentVisits.map((a: any) => {
                  const svc = (allServices || []).find((s: any) => s.id === a.serviceId);
                  const staffMember = (staff || []).find((s: any) => s.id === a.staffId);
                  return (
                    <div key={a.id} className="flex items-center justify-between p-2.5 rounded-xl bg-white border border-muted/20">
                      <div className="min-w-0">
                        <p className="text-[10px] font-black uppercase tracking-tight truncate">{svc?.name || 'Service'}</p>
                        <p className="text-[8px] font-bold text-muted-foreground uppercase opacity-60">
                          {format(safeDate(a.startTime), 'MMM d, yyyy')}
                          {staffMember && ` · ${staffMember.name}`}
                        </p>
                      </div>
                      <Badge className={cn('text-[7px] font-black uppercase border-none text-white shrink-0', a.status === 'cancelled' ? 'bg-destructive' : a.status === 'completed' ? 'bg-green-500' : 'bg-slate-400')}>{a.status}</Badge>
                    </div>
                  );
                }) : (
                  <p className="text-[9px] font-bold text-muted-foreground uppercase opacity-40 text-center py-2">No other visits on record</p>
                )}
                <Link href={`/clients/${client.id}`} className="flex items-center justify-center gap-1 text-[8px] font-bold text-primary uppercase tracking-tight opacity-60 hover:opacity-100 pt-1">
                  Full history on profile <ExternalLink className="w-2.5 h-2.5" />
                </Link>
              </AccordionContent>
            </AccordionItem>

          </Accordion>
        </div>

        {/* ── Escalation panel ─────────────────────────────────────────────── */}
        <div className="space-y-3">
          {appointment.isEscalated ? (
            <div className="flex flex-col gap-4 p-5 rounded-[2rem] border-4 bg-destructive text-white border-destructive shadow-xl shadow-destructive/20">
              <div className="flex items-center justify-between gap-4">
                <div className="space-y-1">
                  <Label className="text-sm font-black uppercase tracking-tight flex items-center gap-2 text-white"><ShieldAlert className="w-4 h-4" /> Priority Escalated</Label>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-white/80">Manager dispatch active</p>
                </div>
              </div>
              {isOwnerOrAdminUser && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="space-y-4 pt-4 border-t border-white/20">
                  <div className="space-y-2">
                    <Label className="text-[10px] font-black uppercase text-white/60 ml-1">Resolution Protocol Summary</Label>
                    <Textarea value={resolutionNote} onChange={e => setResolutionNote(e.target.value)} placeholder="Detail the manager intervention..." className="bg-white/10 border-white/20 text-white placeholder:text-white/40 min-h-[80px] rounded-xl focus-visible:ring-white/20" />
                  </div>
                  <Button onClick={handleResolveEscalation} disabled={isResolving || !resolutionNote.trim()} className="w-full h-12 bg-white text-destructive hover:bg-white/90 rounded-xl font-black uppercase text-[10px] tracking-widest">
                    {isResolving ? <Loader className="animate-spin" /> : 'Certify Resolution & Clear Alert'}
                  </Button>
                </motion.div>
              )}
            </div>
          ) : (
            <>
              {appointment.resolutionNotes && (
                <div className="rounded-xl border-2 border-muted/30 bg-muted/5 p-3.5 space-y-1">
                  <p className="text-[8px] font-black uppercase tracking-widest text-muted-foreground opacity-60 flex items-center gap-1.5">
                    <CheckCircle2 className="w-3 h-3 text-green-500" /> Escalation resolved
                    {appointment.resolvedAt && ` · ${format(safeDate(appointment.resolvedAt), 'MMM d, h:mm a')}`}
                    {appointment.resolvedBy && ` · ${staffName(appointment.resolvedBy, staff)}`}
                  </p>
                  <p className="text-[10px] font-medium text-slate-600 leading-relaxed">{appointment.resolutionNotes}</p>
                </div>
              )}
              <button onClick={handleEscalate} disabled={isEscalating} className="w-full flex items-center justify-between gap-3 p-3.5 rounded-2xl border-2 border-destructive/15 bg-destructive/[0.02] hover:bg-destructive/5 transition-all text-left">
                <span className="flex items-center gap-2.5 text-[10px] font-black uppercase tracking-widest text-destructive/70"><ShieldAlert className="w-3.5 h-3.5" /> Report an issue / escalate to manager</span>
                {isEscalating ? <Loader className="w-3.5 h-3.5 animate-spin text-destructive/50" /> : <ArrowRight className="w-3.5 h-3.5 text-destructive/30" />}
              </button>
            </>
          )}
        </div>

        {/* ── Keyboard shortcut hint ───────────────────────────────────────── */}
        {!isMobile && (canStart || canFinish) && (
          <p className="text-center text-[8px] font-bold text-muted-foreground uppercase tracking-widest opacity-30 pb-2">
            {canStart ? 'K' : 'F'} to {canStart ? 'start' : 'finish'} · P to print · Esc to close
          </p>
        )}

      </div>
    </ScrollArea>
  );

  // ── Action bar ─────────────────────────────────────────────────────────────
  const ActionBar = (
    <div className="border-t bg-white/95 backdrop-blur-md flex-shrink-0 p-3 md:px-6 flex items-center gap-2">
      {canStart && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                onClick={() => onStartService(appointment.id)}
                disabled={startDisabled}
                className="flex-1 h-11 rounded-2xl font-black uppercase shadow-xl shadow-primary/20 text-sm"
              >
                <Play className="mr-2 h-4 w-4" /> Start Session
              </Button>
            </TooltipTrigger>
            {startDisabled && (
              <TooltipContent>
                <p className="text-xs">
                  {complianceInfo.healthPendingForms.length > 0 ? 'Health disclosure required' : depositActuallyMissing ? 'Deposit required' : 'Forms pending'}
                </p>
              </TooltipContent>
            )}
          </Tooltip>
        </TooltipProvider>
      )}
      {canFinish && (
        <Button onClick={() => onFinishService(appointment)} className="flex-1 h-11 rounded-2xl font-black uppercase shadow-xl shadow-primary/20 text-sm">
          <Square className="mr-2 h-4 w-4" /> Finish Service
        </Button>
      )}
      {isCancelled && (
        <Button onClick={() => onRebook?.(appointment)} className="flex-1 h-11 rounded-2xl font-black uppercase shadow-xl shadow-primary/20 text-sm">
          <Undo2 className="mr-2 h-4 w-4" /> Rebook
        </Button>
      )}
      {isCompleted && (
        <Button onClick={() => onBookNewForClient?.(client)} variant="outline" className="flex-1 h-11 rounded-2xl font-bold uppercase border-2 text-sm">
          <Calendar className="mr-2 h-4 w-4" /> Book Next
        </Button>
      )}
      {!canStart && !canFinish && !isCancelled && !isCompleted && (
        <Button variant="outline" className="flex-1 h-11 rounded-2xl font-bold uppercase border-2" asChild>
          <Link href={`/clients/${client.id}`}><UserIcon className="mr-2 h-4 w-4" /> View Profile</Link>
        </Button>
      )}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="icon" className="h-11 w-11 rounded-2xl border-2 shrink-0">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="rounded-2xl border-2 w-60">
          <DropdownMenuItem asChild className="font-bold uppercase text-[10px] tracking-wide">
            <Link href={`/clients/${client.id}`}><UserIcon className="mr-2 h-3.5 w-3.5" /> View Client Profile</Link>
          </DropdownMenuItem>
          {onPrintTicket && (
            <DropdownMenuItem onClick={() => onPrintTicket(appointment)} className="font-bold uppercase text-[10px] tracking-wide">
              <Printer className="mr-2 h-3.5 w-3.5" /> Print Ticket
            </DropdownMenuItem>
          )}
          {client.phone && (
            <DropdownMenuItem asChild className="font-bold uppercase text-[10px] tracking-wide">
              <a href={`sms:${client.phone}`}><MessageSquare className="mr-2 h-3.5 w-3.5" /> Send SMS</a>
            </DropdownMenuItem>
          )}
          {client.email && (
            <DropdownMenuItem asChild className="font-bold uppercase text-[10px] tracking-wide">
              <a href={`mailto:${client.email}`}><Mail className="mr-2 h-3.5 w-3.5" /> Email Client</a>
            </DropdownMenuItem>
          )}
          {!isCancelled && (
            <DropdownMenuItem onClick={() => setIsRescheduleOpen(true)} className="font-bold uppercase text-[10px] tracking-wide">
              <CalendarClock className="mr-2 h-3.5 w-3.5" /> Reschedule
            </DropdownMenuItem>
          )}
          {appointment.status === 'servicing' && (
            <DropdownMenuItem onClick={() => setIsHandoffOpen(true)} className="font-bold uppercase text-[10px] tracking-wide text-indigo-700 focus:text-indigo-700">
              <Repeat2 className="mr-2 h-3.5 w-3.5" /> Mid-Session Handoff
            </DropdownMenuItem>
          )}
          {isCompleted && onBookNewForClient && (
            <DropdownMenuItem onClick={() => onBookNewForClient(client)} className="font-bold uppercase text-[10px] tracking-wide">
              <Calendar className="mr-2 h-3.5 w-3.5" /> Book Next Appointment
            </DropdownMenuItem>
          )}
          {onWaiveFee && !isCancelled && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => onWaiveFee(appointment)} className="font-bold uppercase text-[10px] tracking-wide text-amber-700 focus:text-amber-700">
                <HeartHandshake className="mr-2 h-3.5 w-3.5" /> Waive Fee
              </DropdownMenuItem>
            </>
          )}
          {!isCancelled && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => { onOpenChange(false); onCancel(appointment.id, !!appointment.isWalkIn); }} className="font-bold uppercase text-[10px] tracking-wide text-destructive focus:text-destructive">
                <AlertTriangle className="mr-2 h-3.5 w-3.5" /> Cancel Appointment
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side={isMobile ? 'bottom' : 'right'}
          className={cn(
            'flex flex-col p-0 border-none bg-background shadow-2xl overflow-hidden',
            isMobile ? 'h-[94dvh] rounded-t-[2.5rem] w-full' : 'sm:max-w-lg md:max-w-xl'
          )}
        >
          <SheetHeader className="border-b bg-muted/5 flex-shrink-0 p-4 md:p-5">
            {isMobile && <div className="w-10 h-1 bg-muted-foreground/20 rounded-full mx-auto mb-3" />}
            <SheetTitle className="sr-only">Session Details for {client.name}</SheetTitle>
            <SheetDescription className="sr-only">Appointment {ticketId}</SheetDescription>
            {IdentityHeader}
          </SheetHeader>
          {SheetBody}
          {ActionBar}
        </SheetContent>
      </Sheet>

      <AddAndConfigurePartsDialog
        open={isAddAndConfigureOpen}
        onOpenChange={setIsAddAndConfigureOpen}
        onConfirm={handleAddAndConfigureConfirm}
        allAddOns={(allServices || []).filter(s => s.type === 'addon' && (service?.compatibleAddOnIds || []).includes(s.id))}
        initialSelected={currentAddOns}
        staff={staff || []}
        defaultStaffId={appointment.staffId || ''}
      />

      <RescheduleAppointmentDialog
        open={isRescheduleOpen}
        onOpenChange={setIsRescheduleOpen}
        appointment={appointment}
        client={client}
        tenant={selectedTenant}
        tenantId={tenantId}
        actorName={currentUser?.displayName || 'Staff'}
        actorId={currentUser?.uid || 'system'}
        isMobile={isMobile}
        onRescheduled={() => onOpenChange(false)}
      />

      <MidServiceHandoffDialog
        open={isHandoffOpen}
        onOpenChange={setIsHandoffOpen}
        appointment={appointment}
        service={service}
        currentAddOns={currentAddOns}
        staff={staff || []}
        tenantId={tenantId!}
        firestore={firestore}
        currentUser={currentUser}
      />

      {appointment.inspirationPhotoUrl && isMarkupOpen && (
        <ImageMarkupDialog
          open={isMarkupOpen}
          onOpenChange={setIsMarkupOpen}
          imageUrl={appointment.inspirationPhotoUrl}
          onSave={handleMarkupSave}
          title={`Mapping for ${client.name}`}
        />
      )}

      <Dialog open={!!expandedImage} onOpenChange={(val) => !val && setExpandedImage(null)}>
        <DialogContent className="max-w-fit p-0 border-none bg-transparent shadow-none overflow-hidden flex items-center justify-center">
          <DialogHeader className="sr-only">
            <DialogTitle>Full Size Image</DialogTitle>
            <DialogDescription>Full screen preview</DialogDescription>
          </DialogHeader>
          <div className="relative rounded-[2.5rem] overflow-hidden border-4 border-white/20 shadow-2xl bg-black/40 backdrop-blur-xl max-w-[95vw] max-h-[95vh]">
            {expandedImage && <img src={expandedImage} alt="Expanded" className="block max-w-full max-h-[90vh] object-contain" />}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};
