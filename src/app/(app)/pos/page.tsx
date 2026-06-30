'use client';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import React, { useState, useEffect, useMemo, useCallback, Suspense, useRef } from 'react';
import { useInventory } from '@/context/InventoryContext';
import { type Appointment, type Service, type Client, type WalkIn, type Staff, getServicePrice, type AppointmentCheckoutState, type Redemption, type TillSession, type Membership, type Package } from '@/lib/data';
import { RetailCatalog } from '@/components/pos/RetailCatalog';
import { CheckoutHub } from '@/components/pos/CheckoutHub';
import { WalkInQueue } from '@/components/pos/WalkInQueue';
import { TeamStatus } from '@/components/pos/TeamStatus';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { useFirebase, addDocumentNonBlocking, updateDocumentNonBlocking, setDocumentNonBlocking, deleteDocumentNonBlocking } from '@/firebase';
import { collection, doc, writeBatch, increment, arrayUnion, getDocs, query, where, deleteField } from 'firebase/firestore';
import { useTenant } from '@/context/TenantContext';
import { useToast } from '@/hooks/use-toast';
import { nanoid } from 'nanoid';
import { differenceInMinutes, parseISO, addMinutes, isToday, isSameDay, startOfDay, endOfDay, format, subMinutes } from 'date-fns';
import { AppHeader } from '@/components/shared/AppHeader';
import { AddClientDialog, type ClientFormData } from '@/components/clients/AddClientDialog';
import { useIsMobile } from '@/hooks/use-mobile';
import { useCancellationConfirm } from '@/hooks/useCancellationConfirm';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Clock, Users, DollarSign, QrCode, Loader, Play, XCircle, Fingerprint, UserPlus, Sparkles, ChevronRight, ChevronLeft, ShoppingCart, Square, Wallet, AlertTriangle, MapPin, ShieldCheck, ArrowRight, Info, CheckCircle2, Ban, ShieldAlert, Landmark, Smartphone, Cake, Printer, Trash2, Lock, Calendar, BookOpen, Copy, Link2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { cn, safeNumber } from '@/lib/utils';
import { type Transaction } from '@/lib/financial-data';
import { resolveDepositPolicy, resolveDepositOutcome, hoursUntilStart, rolloverExpiryISO, isCreditExpired, computeDepositCents } from '@/lib/deposit-policy';
import { useSearchParams, useRouter } from 'next/navigation';
import { AppointmentDetailsSheet } from '@/components/planner/AppointmentDetailsSheet';
import { TechnicianReviewDialog } from '@/components/planner/TechnicianReviewDialog';
import { CancelAppointmentDialog } from '@/components/planner/CancelAppointmentDialog';
import { OverrideCancellationDialog } from '@/components/planner/OverrideCancellationDialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { TillManagement } from '@/components/pos/TillManagement';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { CheckInConfirmationDialog } from '@/components/pos/CheckInConfirmationDialog';
import { PrintTicket } from '@/components/planner/PrintTicket';
import { motion, AnimatePresence } from 'framer-motion';

// ── NEW IMPORTS — four feature additions ──────────────────────────────────────
import { QuickBookForm } from '@/components/pos/QuickBookForm';
import { WaitlistManager } from '@/components/pos/WaitlistManager';
import { useWaitlist } from '@/hooks/useWaitlist';
import { QRScanner } from '@/components/pos/QRScanner';

// Opens the ticket in a fresh, chrome-free browser window and auto-prints.
// This sidesteps the core mobile print problem: window.print() from inside
// a shadcn Dialog (a React Portal, outside the main body DOM tree) is
// unreliable on mobile Safari/Chrome — the print CSS fires, hides
// everything, but the portal content may not be reachable by the
// visibility:visible restore, producing a blank page. A new window has no
// app chrome, no portals, no overlapping z-index — just the ticket.
function printTicketInNewWindow(ticketHtml: string, studioName: string) {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Print Ticket — ${studioName}</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: white; }
    @media print {
      body { margin: 0; }
      button { display: none !important; }
    }
  </style>
</head>
<body>
  ${ticketHtml}
  <script>
    window.addEventListener('load', function() {
      setTimeout(function() { window.print(); }, 400);
    });
  </script>
</body>
</html>`;
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const win = window.open(url, '_blank');
  if (!win) {
    // Popup blocked — fall back to sharing or copying the URL
    navigator.clipboard?.writeText(url).catch(() => {});
    alert('Pop-up blocked. Please allow pop-ups for this site to print tickets, or use the Share / copy link option.');
  }
  // Revoke after a delay to allow the window to load
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}


const sanitizeForFirestore = (obj: any): any => {
  if (obj === null || typeof obj !== 'object') return obj;
  if (obj._methodName !== undefined || (obj.constructor && obj.constructor.name === 'FieldValue')) return obj;
  if (typeof obj.isEqual === 'function' && typeof obj._methodName !== undefined) return obj;
  if (Array.isArray(obj)) return obj.map(sanitizeForFirestore);
  return Object.fromEntries(
    Object.entries(obj).filter(([_, v]) => v !== undefined).map(([k, v]) => [k, sanitizeForFirestore(v)])
  );
};

const safeDate = (val: any): Date => {
  if (!val) return new Date();
  if (val instanceof Date) return val;
  if (typeof val === 'string') return parseISO(val);
  if (typeof val?.toDate === 'function') return val.toDate();
  return new Date(val);
};

const computeServiceCost = (service: any, apt: any, staffMember: any, inventory: any[], tmhr: number): { overhead: number; materials: number; labor: number; total: number } => {
  if (!service) return { overhead: 0, materials: 0, labor: 0, total: 0 };
  let materials = 0;
  if (apt?.checkoutState?.formula?.length > 0) {
    materials = apt.checkoutState.formula.reduce((acc: number, item: any) => acc + (item.quantity || 0) * (item.costPerUnit || 0), 0);
  } else if (service.products?.length > 0) {
    materials = service.products.reduce((acc: number, p: any) => {
      const item = (inventory || []).find((i: any) => i.id === p.id);
      if (!item) return acc;
      let cpu = item.costPerUnit || 0;
      if (item.costingMethod === 'size' && item.size) cpu /= item.size;
      else if (item.costingMethod === 'uses' && item.estimatedUses) cpu /= item.estimatedUses;
      return acc + (p.quantityUsed || 1) * cpu;
    }, 0);
  }
  const duration = service.duration || 60;
  const overhead = (duration / 60) * (tmhr || 0);
  let labor = 0;
  if (staffMember?.payStructure === 'commission') labor = (service.price || 0) * ((staffMember.commissionRate || 40) / 100);
  else if (staffMember?.payStructure === 'hourly' && staffMember.hourlyRate) labor = (duration / 60) * staffMember.hourlyRate;
  return { overhead, materials, labor, total: Number((overhead + materials + labor).toFixed(2)) };
};

const KpiCard = ({ title, value, icon, description, iconBgColor }: { title: string; value: string; icon: React.ReactNode, description: string, iconBgColor: string }) => (
  <Card className="border-2 shadow-sm overflow-hidden bg-white/50 backdrop-blur-sm">
    <CardHeader className="flex flex-row items-center justify-between space-y-0 p-3 md:p-4 pb-2">
      <CardTitle className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{title}</CardTitle>
      <div className={cn("p-1.5 md:p-2 rounded-xl", iconBgColor)}>{React.cloneElement(icon as React.ReactElement, { className: 'w-3.5 h-3.5 md:w-4 md:h-4' })}</div>
    </CardHeader>
    <CardContent className="p-3 md:p-4 pt-0 text-left">
      <div className="text-xl md:text-3xl font-black tracking-tighter text-slate-900">{value}</div>
      <p className="text-[9px] font-bold text-muted-foreground uppercase mt-1 opacity-60 truncate">{description}</p>
    </CardContent>
  </Card>
);

const RecoveryOverrideDialog = ({ open, onOpenChange, staff, onConfirm }: any) => {
  const [pin, setPin] = useState('');
  const [reason, setReason] = useState('');
  const { toast } = useToast();
  const pinInputRef = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => { if (open) { setTimeout(() => pinInputRef.current?.focus(), 150); } else { setPin(''); setReason(''); } }, [open]);
  const handleConfirm = () => {
    const authorizedStaff = (staff || []).find((s: any) => s.pin === pin && (s.role === 'admin' || s.role === 'owner'));
    if (!authorizedStaff) { toast({ variant: 'destructive', title: 'Unauthorized', description: 'Manager PIN not recognized.' }); return; }
    if (!reason.trim()) { toast({ variant: 'destructive', title: 'Reason Required' }); return; }
    onConfirm(authorizedStaff, reason); setPin(''); setReason('');
  };
  const handleOpenChange = (val: boolean) => { if (!val) { setPin(''); setReason(''); } onOpenChange(val); };
  if (!open) return null;
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem', pointerEvents: 'all' }}>
      <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.6)', zIndex: 0 }} onClick={() => handleOpenChange(false)} />
      <div style={{ position: 'relative', zIndex: 1, backgroundColor: 'white', borderRadius: '2rem', border: '4px solid #e2e8f0', boxShadow: '0 25px 50px rgba(0,0,0,0.25)', width: '100%', maxWidth: '440px', overflow: 'hidden' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ padding: '1.5rem 1.5rem 0', borderBottom: '1px solid #f1f5f9' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
            <ShieldCheck style={{ width: '1.5rem', height: '1.5rem', color: 'var(--primary, #6366f1)' }} />
            <h2 style={{ fontSize: '1.25rem', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '-0.05em', color: '#0f172a', margin: 0 }}>Recovery Override</h2>
          </div>
          <p style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#94a3b8', marginBottom: '1rem' }}>Manager PIN required to authorize this adjustment.</p>
        </div>
        <div style={{ padding: '2rem 1.5rem', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1.5rem' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem', width: '12rem' }}>
            <label style={{ fontSize: '0.6rem', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.2em', color: '#94a3b8' }}>Manager PIN</label>
            <input ref={pinInputRef} type="number" inputMode="numeric" pattern="[0-9]*" placeholder="0000" maxLength={4} value={pin} onChange={e => setPin(e.target.value.slice(0, 4).replace(/\D/g, ''))} style={{ width: '100%', textAlign: 'center', fontSize: '2rem', fontWeight: 900, height: '5rem', letterSpacing: '0.4em', backgroundColor: '#f8fafc', border: '4px solid #e2e8f0', borderRadius: '1.5rem', outline: 'none', padding: '0 1rem' }} />
          </div>
          <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <label style={{ fontSize: '0.6rem', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#94a3b8' }}>Override Reason</label>
            <textarea value={reason} onChange={e => setReason(e.target.value)} placeholder="Detail the justification..." rows={3} style={{ width: '100%', borderRadius: '1rem', border: '2px solid #e2e8f0', padding: '0.75rem', fontSize: '0.875rem', fontFamily: 'inherit', resize: 'none', outline: 'none', boxSizing: 'border-box' }} />
          </div>
        </div>
        <div style={{ padding: '0 1.5rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <button onClick={handleConfirm} disabled={pin.length < 4 || !reason.trim()} style={{ width: '100%', height: '4rem', borderRadius: '1rem', border: 'none', backgroundColor: pin.length < 4 || !reason.trim() ? '#cbd5e1' : '#6366f1', color: 'white', fontSize: '0.75rem', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.1em', cursor: pin.length < 4 || !reason.trim() ? 'not-allowed' : 'pointer' }}>Authorize Override</button>
          <button onClick={() => handleOpenChange(false)} style={{ width: '100%', height: '2.5rem', borderRadius: '1rem', border: 'none', backgroundColor: 'transparent', color: '#94a3b8', fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', cursor: 'pointer' }}>Cancel</button>
        </div>
      </div>
    </div>
  );
};

const IdentityMatchDialog = ({ open, onOpenChange, walkIn, matchedClient, onLinkSession, onMerge, onKeepSeparate }: any) => {
  const walkInPhone = walkIn?.customerPhone || walkIn?.phone || '';
  const walkInEmail = walkIn?.customerEmail || walkIn?.email || '';
  const hasNewContact = (walkInPhone && walkInPhone !== matchedClient?.phone) || (walkInEmail && walkInEmail !== matchedClient?.email);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg rounded-[3rem] border-4 shadow-3xl bg-background">
        <DialogHeader className="p-6 pb-0 text-left">
          <DialogTitle className="flex items-center gap-3 text-2xl font-black uppercase tracking-tighter text-slate-900"><Fingerprint className="w-6 h-6 text-primary" />Identity Match Found</DialogTitle>
          <DialogDescription className="text-xs font-bold uppercase tracking-widest opacity-60 mt-1">This walk-in shares contact info with an existing client record.</DialogDescription>
        </DialogHeader>
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="p-4 rounded-2xl bg-primary/5 border-2 border-primary/10 space-y-2">
              <p className="text-[8px] font-black uppercase tracking-widest text-primary/60">Existing Record</p>
              <p className="text-sm font-black uppercase tracking-tight text-slate-900 leading-tight">{matchedClient?.name}</p>
              {matchedClient?.phone && <p className="text-[9px] font-bold text-slate-500 uppercase truncate">{matchedClient.phone}</p>}
              {matchedClient?.email && <p className="text-[9px] font-bold text-slate-500 uppercase truncate">{matchedClient.email}</p>}
              {matchedClient?.lifetimeValue > 0 && <p className="text-[8px] font-black text-primary uppercase">LTV: ${matchedClient.lifetimeValue.toFixed(0)}</p>}
            </div>
            <div className="p-4 rounded-2xl bg-amber-50 border-2 border-amber-200 space-y-2">
              <p className="text-[8px] font-black uppercase tracking-widest text-amber-600">Walk-in Guest</p>
              <p className="text-sm font-black uppercase tracking-tight text-slate-900 leading-tight">{walkIn?.customerName}</p>
              {walkInPhone && <p className={`text-[9px] font-bold uppercase truncate ${walkInPhone !== matchedClient?.phone ? 'text-amber-600' : 'text-slate-500'}`}>{walkInPhone}</p>}
              {walkInEmail && <p className={`text-[9px] font-bold uppercase truncate ${walkInEmail !== matchedClient?.email ? 'text-amber-600' : 'text-slate-500'}`}>{walkInEmail}</p>}
              {hasNewContact && <p className="text-[8px] font-black text-amber-600 uppercase">New contact info detected</p>}
            </div>
          </div>
        </div>
        <div className="px-6 pb-6 space-y-3">
          <button onClick={() => onLinkSession(matchedClient)} className="w-full p-4 rounded-2xl border-2 border-primary/20 bg-primary/5 hover:bg-primary/10 hover:border-primary/40 transition-all text-left group">
            <div className="flex items-center justify-between"><div className="space-y-0.5"><p className="text-[11px] font-black uppercase tracking-widest text-primary">Link This Session Only</p><p className="text-[9px] font-bold text-slate-500 uppercase">Connect today's visit to existing profile. No other changes.</p></div><ArrowRight className="w-4 h-4 text-primary opacity-40 group-hover:opacity-100 transition-opacity shrink-0 ml-3" /></div>
          </button>
          <button onClick={() => onMerge(matchedClient)} className="w-full p-4 rounded-2xl border-2 border-green-500/20 bg-green-50/50 hover:bg-green-50 hover:border-green-500/40 transition-all text-left group">
            <div className="flex items-center justify-between"><div className="space-y-0.5"><p className="text-[11px] font-black uppercase tracking-widest text-green-700">Merge & Update Profile</p><p className="text-[9px] font-bold text-slate-500 uppercase">{hasNewContact ? 'Link session and update profile with new contact info.' : 'Link session and confirm this is the same person.'}</p></div><ShieldCheck className="w-4 h-4 text-green-600 opacity-40 group-hover:opacity-100 transition-opacity shrink-0 ml-3" /></div>
          </button>
          <button onClick={() => onKeepSeparate()} className="w-full p-3 rounded-2xl border-2 border-transparent hover:border-muted hover:bg-muted/20 transition-all text-left group">
            <div className="flex items-center justify-between"><div className="space-y-0.5"><p className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">Keep as New Guest</p><p className="text-[9px] font-bold text-slate-400 uppercase">Different person with similar contact info. No changes.</p></div><XCircle className="w-4 h-4 text-muted-foreground opacity-40 group-hover:opacity-60 transition-opacity shrink-0 ml-3" /></div>
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export function VoidAuthForm({ onConfirm, onCancel }: { onConfirm: (pin: string, reason: string) => void; onCancel: () => void }) {
  const [pin, setPin] = React.useState('');
  const [reason, setReason] = React.useState('');
  return (
    <div className="mt-4 p-4 rounded-2xl border-2 border-destructive/20 bg-destructive/5 space-y-4">
      <p className="text-[10px] font-black uppercase tracking-widest text-destructive">Manager Authorization Required</p>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Manager PIN</Label>
          <Input type="password" inputMode="numeric" maxLength={4} value={pin} onChange={e => setPin(e.target.value.replace(/\D/g,'').slice(0,4))} placeholder="••••" className="h-10 rounded-xl text-center font-black text-lg tracking-widest border-2" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Reason</Label>
          <Input value={reason} onChange={e => setReason(e.target.value)} placeholder="Describe void reason" className="h-10 rounded-xl border-2" />
        </div>
      </div>
      <div className="flex gap-2">
        <Button onClick={() => onConfirm(pin, reason)} disabled={pin.length < 4 || !reason.trim()} variant="destructive" className="flex-1 h-10 rounded-xl font-black uppercase text-[10px] tracking-widest">Authorize Void</Button>
        <Button onClick={onCancel} variant="ghost" className="flex-1 h-10 rounded-xl font-black uppercase text-[10px] tracking-widest">Cancel</Button>
      </div>
    </div>
  );
}

function POSPage() {
  const isMobile = useIsMobile();
  const { inventory, services, appointments: appointmentsFromInventory, clients, walkIns, staff, transactions, memberships, packages, resources, discounts, tillSessions, isLoading: isInventoryLoading } = useInventory();
  const { firestore, user: currentUser } = useFirebase();
  const { selectedTenant, role } = useTenant();
  const tenantId = selectedTenant?.id;
  const { toast } = useToast();

  const [selectedAppointmentIds, setSelectedAppointmentIds] = useState<Set<string>>(new Set());
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [retailItems, setRetailItems] = useState<any[]>([]);
  const [tipAmount, setTipAmount] = useState(0);
  const [tipAllocations, setTipAllocations] = useState<Record<string, number>>({});
  const [paymentTab, setPaymentTab] = useState('card');
  const [amountTendered, setAmountTendered] = useState<number>(0);
  const [isAddClientOpen, setIsAddClientOpen] = useState(false);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [isCancelDialogOpen, setIsCancelDialogOpen] = useState(false);
  const [isOverrideOpen, setIsOverrideOpen] = useState(false);
  const [isCartSheetOpen, setIsCartSheetOpen] = useState(false);
  const [isTechnicianReviewOpen, setIsTechnicianReviewOpen] = useState(false);
  const [isCartCollapsed, setIsCartCollapsed] = useState(false);
  const [isTillManagementOpen, setIsTillManagementOpen] = useState(false);
  const [selectedAppointment, setSelectedAppointment] = useState<Appointment | null>(null);
  const [appointmentToReview, setAppointmentToReview] = useState<Appointment | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [assignmentMode, setAssignmentMode] = useState<'fair_play' | 'ordered_list'>('ordered_list');
  const [pendingCheckInItem, setPendingCheckInItem] = useState<any | null>(null);
  const [ticketToPrint, setTicketToPrint] = useState<any | null>(null);
  const [isPrintDialogOpen, setIsPrintDialogOpen] = useState(false);
  const [appliedDiscountCodes, setAppliedDiscountCodes] = useState<string[]>([]);
  const [appliedAdjustments, setAppliedAdjustments] = useState<Set<string>>(new Set());
  const [redeemedOffer, setRedeemedOffer] = useState<{ type: 'membership' | 'package'; id: string; itemId?: string } | null>(null);
  const [waivedAppointmentFees, setWaivedAppointmentFees] = useState<Map<string, { authorizerId: string; reason: string }>>(new Map());
  const [isRecoveryOverrideOpen, setIsRecoveryOverrideOpen] = useState(false);
  const [pendingIdentityMatch, setPendingIdentityMatch] = useState<any | null>(null);
  const [voidTransactionId, setVoidTransactionId] = useState<string | null>(null);
  const [isVoidDialogOpen, setIsVoidDialogOpen] = useState(false);
  const [isQuickBookOpen, setIsQuickBookOpen] = useState(false);
  const [isScanLookupOpen, setIsScanLookupOpen] = useState(false);
  const [isCameraScanOpen, setIsCameraScanOpen] = useState(false);
  const [scanQuery, setScanQuery] = useState('');
  const [scanResult, setScanResult] = useState<any | null>(null);
  const [scanNotFound, setScanNotFound] = useState(false);
  const scanInputRef = React.useRef<HTMLInputElement>(null);
  const [pendingRefund, setPendingRefund] = useState<any | null>(null);
  const [storeCreditApplied, setStoreCreditApplied] = useState(0);
  const [newWalkInAlert, setNewWalkInAlert] = useState<string | null>(null);
  const prevWalkInCountRef = useRef<number>(0);

  // ── Waitlist hook ──────────────────────────────────────────────────────────
  const waitlist = useWaitlist({
    tenantId,
    firestore,
    walkIns: walkIns || [],
    appointments: appointmentsFromInventory || [],
    services: services || [],
    staff: staff || [],
    tenant: selectedTenant,
    toast,
  });

  useEffect(() => {
    const waitingCount = (walkIns || []).filter(w => w.status === 'waiting').length;
    if (prevWalkInCountRef.current > 0 && waitingCount > prevWalkInCountRef.current) {
      const newest = [...(walkIns || [])].filter(w => w.status === 'waiting').sort((a, b) => safeDate(b.checkInTime).getTime() - safeDate(a.checkInTime).getTime())[0];
      if (newest) {
        setNewWalkInAlert(`${newest.customerName || 'New guest'} joined the queue`);
        try {
          const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
          const osc = ctx.createOscillator(); const gain = ctx.createGain();
          osc.connect(gain); gain.connect(ctx.destination);
          osc.frequency.value = 880;
          gain.gain.setValueAtTime(0.1, ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
          osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.4);
        } catch { }
        setTimeout(() => setNewWalkInAlert(null), 5000);
      }
    }
    prevWalkInCountRef.current = waitingCount;
  }, [walkIns]);

  const isOwnerOrAdminUser = role === 'owner' || role === 'admin';
  const activeTill = useMemo(() => tillSessions?.find(s => s.status === 'open') || null, [tillSessions]);

  const readyForCheckoutAppointments = useMemo(() => {
    if (!appointmentsFromInventory || !clients || !services || !staff) return [];
    return appointmentsFromInventory
      .filter(apt => apt.status === 'ready_for_checkout')
      .map(apt => {
        const client = clients.find(c => c.id === apt.clientId);
        const service = services.find(s => s.id === apt.serviceId);
        const addOnServices = (apt.addOnIds || []).map(id => services.find(s => s.id === id)).filter((s): s is Service => !!s);
        const staffMember = staff.find(s => s.id === apt.staffId);
        return { id: apt.id, appointment: apt, client, service, addOnServices, staff: staffMember };
      }).filter((a): a is any => !!(a.client && a.service));
  }, [appointmentsFromInventory, clients, services, staff]);

  const kpiData = useMemo(() => {
    const todayStart = startOfDay(new Date()); const todayEnd = endOfDay(new Date());
    const walkInsToday = (walkIns || []).filter(w => { const d = safeDate(w.checkInTime); return d >= todayStart && d <= todayEnd; });
    const walkInWithServiceStart = walkInsToday.filter(w => w.serviceStartTime);
    const waitTimes = walkInWithServiceStart.map(w => differenceInMinutes(safeDate(w.serviceStartTime), safeDate(w.checkInTime)));
    const avgWaitTime = waitTimes.length > 0 ? waitTimes.reduce((a, b) => a + b, 0) / waitTimes.length : 0;
    const dailyTransactions = (transactions || []).filter(t => { const d = safeDate(t.date); return d >= todayStart && d <= todayEnd && t.type === 'income'; });
    const totalDailyGrossRevenue = dailyTransactions.reduce((acc, t) => acc + safeNumber(t.amount), 0);
    const newGuestCount = walkInsToday.filter(w => !w.clientId || w.isNewGuest).length;
    const returningCount = walkInsToday.length - newGuestCount;
    const servicedCount = walkInsToday.filter(w => ['servicing','completed'].includes(w.status)).length;
    const conversionRate = walkInsToday.length > 0 ? (servicedCount / walkInsToday.length) * 100 : 0;
    const revenuePerGuest = servicedCount > 0 ? totalDailyGrossRevenue / servicedCount : 0;
    return { avgWaitTime, totalWalkIns: walkInsToday.length, totalDailyGrossRevenue, newGuestCount, returningCount, conversionRate, revenuePerGuest };
  }, [walkIns, transactions]);

  const selectedClient = useMemo(() => clients.find((c: Client) => c.id === selectedClientId), [selectedClientId, clients]);

  const subtotalCalc = useMemo(() => {
    const servicesSub = readyForCheckoutAppointments.filter(a => selectedAppointmentIds.has(a.id)).reduce((acc, data) => {
      const isServiceRedeemed = redeemedOffer?.itemId === data.service.id;
      const mainStaffId = data.appointment.checkoutState?.serviceStaffOverrides?.[data.service.id] || data.appointment.staffId;
      const mainStaff = staff.find(s => s.id === mainStaffId);
      const mainPrice = isServiceRedeemed ? 0 : getServicePrice(data.service, mainStaff);
      const addonsPrice = (data.addOnServices || []).reduce((sum: number, s: any) => { const isAddonRedeemed = redeemedOffer?.itemId === s.id; const addonStaffId = data.appointment.checkoutState?.serviceStaffOverrides?.[s.id] || data.appointment.staffId; const addonStaff = staff.find(st => st.id === addonStaffId); return sum + (isAddonRedeemed ? 0 : getServicePrice(s, addonStaff)); }, 0);
      const adjustments = data.appointment.checkoutState?.adjustments;
      let adjTotal = 0;
      if (adjustments) { const isWaived = waivedAppointmentFees.has(data.appointment.id); if (!isWaived) adjTotal = safeNumber(adjustments.rescheduleFee) + safeNumber(adjustments.timeOverage) + safeNumber(adjustments.materialOverage); }
      else { const isWaived = waivedAppointmentFees.has(data.appointment.id); adjTotal = isWaived ? 0 : safeNumber(data.appointment.checkoutState?.additionalCharge); }
      const refreshmentsSub = (data.appointment.checkoutState?.refreshments || []).reduce((sum: number, r: any) => sum + (safeNumber(r.price) * safeNumber(r.quantity || 1)), 0);
      return acc + mainPrice + addonsPrice + adjTotal + refreshmentsSub;
    }, 0);
    const retailSub = retailItems.reduce((acc, item) => acc + (item.price * item.quantity), 0);
    const adjustmentSub = Array.from(appliedAdjustments).reduce((acc, id) => { const fee = clients.flatMap(c => c.unpaidFees || []).find(f => f.feeId === id); return acc + safeNumber(fee?.feeAmount); }, 0);
    return safeNumber(servicesSub + retailSub + adjustmentSub);
  }, [readyForCheckoutAppointments, selectedAppointmentIds, retailItems, appliedAdjustments, clients, waivedAppointmentFees, staff, redeemedOffer]);

  const discountValue = useMemo(() => safeNumber(appliedDiscountCodes.reduce((acc, code) => { const d = (discounts || []).find((dis: any) => dis.code.toUpperCase() === code.toUpperCase()); if (!d) return acc; return acc + (d.type === 'percentage' ? subtotalCalc * (d.value / 100) : d.value); }, 0)), [appliedDiscountCodes, discounts, subtotalCalc]);

  const membershipDiscountValue = useMemo(() => {
    if (!selectedClient || !memberships || !packages) return 0;
    const mId = selectedClient.activeMembershipId || selectedClient?.subscription?.membershipId;
    if (selectedClient?.subscription?.status && selectedClient.subscription.status !== 'active') return 0;
    let bestDiscountPct = 0; let eligibleProductIds: string[] = [];
    if (mId) { const membership = memberships.find(m => m.id === mId); if (membership?.retailDiscount) { bestDiscountPct = membership.retailDiscount; eligibleProductIds = membership.applicableProductIds || []; } }
    if (bestDiscountPct === 0) return 0;
    return retailItems.reduce((acc, item) => { const isEligible = eligibleProductIds.length === 0 || eligibleProductIds.includes(item.id); return isEligible ? acc + (item.price * item.quantity * (bestDiscountPct / 100)) : acc; }, 0);
  }, [selectedClient, memberships, packages, retailItems]);

  const taxCalc = subtotalCalc * 0.07;
  const totalCalc = Math.max(0, subtotalCalc + taxCalc + tipAmount - discountValue - membershipDiscountValue - storeCreditApplied);

  const payerOptions = useMemo(() => { const clientIds = new Set<string>(); readyForCheckoutAppointments.filter(a => selectedAppointmentIds.has(a.id)).forEach(data => { if (data.client?.id) clientIds.add(data.client.id); }); return (clients || []).filter(c => clientIds.has(c.id)); }, [readyForCheckoutAppointments, selectedAppointmentIds, clients]);

  const handleSelectAppointment = useCallback((id: string) => {
    const nextIds = new Set(selectedAppointmentIds);
    if (nextIds.has(id)) { nextIds.delete(id); if (nextIds.size === 0) setSelectedClientId(null); }
    else { nextIds.add(id); const aptData = readyForCheckoutAppointments.find(a => a.id === id); if (aptData?.client?.id) setSelectedClientId(aptData.client.id); }
    setSelectedAppointmentIds(nextIds);
  }, [readyForCheckoutAppointments, selectedAppointmentIds]);

  const handleAddToCart = useCallback((item: any) => {
    setRetailItems(prev => {
      const existing = prev.find(i => i.id === item.id);
      if (existing) return prev.map(i => i.id === item.id ? { ...i, quantity: i.quantity + 1 } : i);
      let price = 0; let type: 'product' | 'service' | 'membership' | 'package' = 'product';
      if ('msrp' in item) { price = safeNumber(item.msrp || item.costPerUnit); type = 'product'; }
      else if ('duration' in item) { price = safeNumber(item.price); type = 'service'; }
      else if ('interval' in item) { price = safeNumber(item.price); type = 'membership'; }
      else if ('sessions' in item) { price = safeNumber(item.price); type = 'package'; }
      return [...prev, { id: item.id, name: item.name, quantity: 1, price, type, imageUrl: item.imageUrl, stock: item.totalStock }];
    });
  }, []);

  const handleStartService = (appointmentId: string) => {
    if (!firestore || !tenantId || !appointmentsFromInventory) return;
    const appointment = (appointmentsFromInventory || []).find(a => a.id === appointmentId) || (appointmentsFromInventory || []).find(a => a.id === `apt-walkin-${appointmentId}`);
    if (!appointment) return;
    const nowISO = new Date().toISOString();
    const batch = writeBatch(firestore);
    batch.update(doc(firestore, 'tenants', tenantId, 'appointments', appointment.id), { status: 'servicing', actualStartTime: nowISO });
    if (appointment.checkInToken) batch.update(doc(firestore, 'appointmentCheckIns', appointment.checkInToken), { status: 'servicing', tenantId });
    if (appointment.staffId) batch.set(doc(firestore, 'tenants', tenantId, 'staff', appointment.staffId), { status: 'busy' }, { merge: true });
    if (appointment.isWalkIn) batch.update(doc(firestore, 'tenants', tenantId, 'walkIns', appointment.id.replace('apt-walkin-', '')), { status: 'servicing', serviceStartTime: nowISO });
    batch.commit().then(() => toast({ title: "Service Started" }));
  };

  const handleAssignStaff = useCallback((walkIn: WalkIn, staffId: string) => {
    if (!firestore || !tenantId || !services) return;
    const personServices = (walkIn.serviceIds || []).map(id => (services || []).find(s => s.id === id)).filter(Boolean) as Service[];
    const estimatedDuration = personServices.reduce((acc, s) => acc + (s.duration || 0) + (s.padBefore || 0) + (s.padAfter || 0), 0);
    const now = new Date(); const walkInEndsAt = addMinutes(now, estimatedDuration);
    const upcomingConflict = (appointmentsFromInventory || []).find(a => a.staffId === staffId && (a.status === 'confirmed' || a.status === 'deposit_pending') && safeDate(a.startTime) > now && safeDate(a.startTime) < walkInEndsAt);
    if (upcomingConflict) { const conflictTime = format(safeDate(upcomingConflict.startTime), 'h:mm a'); const conflictClient = clients?.find(c => c.id === upcomingConflict.clientId); toast({ variant: 'destructive', title: 'Scheduling Conflict', description: `This provider has ${conflictClient?.name || 'a client'} booked at ${conflictTime} — ${estimatedDuration}m service may overlap.` }); }
    updateDocumentNonBlocking(doc(firestore, 'tenants', tenantId, 'walkIns', walkIn.id), { assignedStaffId: staffId, status: 'notified', notifiedTimestamp: now.toISOString() });
    const appointmentId = `apt-walkin-${walkIn.id}`;
    setDocumentNonBlocking(doc(firestore, 'tenants', tenantId, 'appointments', appointmentId), { id: appointmentId, tenantId, clientId: walkIn.clientId || walkIn.id, clientName: walkIn.customerName, serviceId: walkIn.serviceIds[0], staffId, status: 'confirmed', source: 'walk-in', isWalkIn: true, startTime: now.toISOString(), endTime: addMinutes(now, estimatedDuration).toISOString() }, {});
    toast({ title: "Staff Assigned" + (upcomingConflict ? " ⚠ Conflict detected" : "") });
  }, [firestore, tenantId, services, appointmentsFromInventory, clients, toast]);

  const handleAssignNext = useCallback(() => {
    if (!firestore || !tenantId || !walkIns || !staff || !services) return;
    const waitingQueue = [...walkIns].filter(w => w.status === 'waiting').sort((a, b) => (a.queueOrder || safeDate(a.checkInTime).getTime()) - (b.queueOrder || safeDate(b.checkInTime).getTime()));
    if (waitingQueue.length === 0) return;
    const nextGuest = waitingQueue[0];
    const idleStaff = staff.filter((s: any) => s.active && !s.onBreak && (s.status === 'idle' || s.status === 'available' || !s.status) && s.acceptingWalkIns !== false);
    if (idleStaff.length === 0) return;
    const walkInDuration = nextGuest.serviceIds.reduce((acc: number, sid: string) => { const svc = services.find((ser: Service) => ser.id === sid); return acc + (svc?.duration || 0) + (svc?.padBefore || 0) + (svc?.padAfter || 0); }, 0);
    const walkInEndsAt = addMinutes(new Date(), walkInDuration);
    const qualified = idleStaff.filter((s: any) => { const hasSkills = nextGuest.serviceIds.every((sid: string) => { const svc = services.find((ser: Service) => ser.id === sid); return !svc?.requiredSkills?.length || svc.requiredSkills.every((skill: string) => (s.skillSet || []).includes(skill)); }); if (!hasSkills) return false; const hasConflict = (appointmentsFromInventory || []).some(a => a.staffId === s.id && (a.status === 'confirmed' || a.status === 'deposit_pending') && safeDate(a.startTime) > new Date() && safeDate(a.startTime) < walkInEndsAt); return !hasConflict; });
    if (qualified.length === 0) return;
    const selected = [...qualified].sort((a: any, b: any) => { if (assignmentMode === 'ordered_list') return (a.turnOrder || 999) - (b.turnOrder || 999); const aTime = a.lastWalkInCompletedAt ? new Date(a.lastWalkInCompletedAt).getTime() : a.lastServedTimestamp ? parseISO(a.lastServedTimestamp).getTime() : 0; const bTime = b.lastWalkInCompletedAt ? new Date(b.lastWalkInCompletedAt).getTime() : b.lastServedTimestamp ? parseISO(b.lastServedTimestamp).getTime() : 0; return aTime - bTime; })[0];
    handleAssignStaff(nextGuest, selected.id);
  }, [firestore, tenantId, walkIns, staff, services, assignmentMode, appointmentsFromInventory, handleAssignStaff]);

  const handleUpdateStatus = (id: string, isWalkIn: boolean, status: string, lateMinutes?: number) => {
    if (!firestore || !tenantId || !selectedTenant) return;
    const isAssignedWalkIn = id.startsWith('apt-walkin-');
    const effectiveIsWalkIn = isWalkIn && !isAssignedWalkIn;
    const collectionName = effectiveIsWalkIn ? 'walkIns' : 'appointments';
    const docRef = doc(firestore, 'tenants', tenantId, collectionName, id);
    const tmhrValue = selectedTenant.tmhr || 50; const premium = selectedTenant.lateInconveniencePremium || 0;
    if (status === 'running_late' && lateMinutes && !effectiveIsWalkIn) {
      const apt = appointmentsFromInventory?.find(a => a.id === id);
      if (apt) {
        const grace = selectedTenant.lateArrivalGracePeriod || 15; const autoCancel = selectedTenant.autoCancelLateArrivals === true;
        const primarySvc = services?.find(s => s.id === apt.serviceId);
        const addOns = (apt.addOnIds || []).map(aid => services?.find(s => s.id === aid)).filter(Boolean) as Service[];
        const totalDur = (primarySvc?.duration || 0) + addOns.reduce((sum, a) => sum + a.duration, 0);
        const totalPadding = (primarySvc?.padBefore || 0) + (primarySvc?.padAfter || 0);
        const fullSessionBlock = totalDur + totalPadding; const staffId = apt.staffId;
        let clash = null;
        if (staffId) {
          const theoreticalStart = addMinutes(safeDate(apt.startTime), lateMinutes); const theoreticalEnd = addMinutes(theoreticalStart, fullSessionBlock);
          const nextApt = (appointmentsFromInventory || []).filter(a => a.staffId === staffId && a.id !== apt.id && (a.status === 'confirmed' || a.status === 'deposit_pending') && safeDate(a.startTime) > safeDate(apt.startTime)).sort((a, b) => a.startTime.getTime() - b.startTime.getTime())[0];
          if (nextApt) { const nextService = services?.find(s => s.id === nextApt.serviceId); const nextStartWithPad = subMinutes(safeDate(nextApt.startTime), nextService?.padBefore || 0); if (theoreticalEnd > nextStartWithPad) clash = { nextApt, clashTime: format(nextStartWithPad, 'h:mm a') }; }
        }
        if ((lateMinutes > grace && autoCancel) || clash) {
          const cancelReason = clash ? 'clash' : 'late';
          const fee = Number(((fullSessionBlock / 60) * tmhrValue + (primarySvc?.cost || 0) + addOns.reduce((sum, a) => sum + (a.cost || 0), 0)).toFixed(2));
          const batch = writeBatch(firestore);
          batch.update(docRef, sanitizeForFirestore({ checkInStatus: 'auto_cancelled', status: 'cancelled', lateTimeMinutes: lateMinutes, cancellationReason: cancelReason, cancellationFeeApplied: fee }));
          if (apt.checkInToken) batch.update(doc(firestore, 'appointmentCheckIns', apt.checkInToken), sanitizeForFirestore({ checkInStatus: 'auto_cancelled', status: 'cancelled', tenantId }));
          if (fee > 0 && apt.clientId) batch.update(doc(firestore, 'tenants', tenantId, 'clients', apt.clientId), { outstandingBalance: increment(fee), unpaidFees: arrayUnion(sanitizeForFirestore({ feeId: nanoid(), appointmentId: apt.id, appointmentDate: safeDate(apt.startTime).toISOString(), feeAmount: fee, reason: `Auto-Cancel: ${clash ? 'Clash' : 'Late'} (+${lateMinutes}m)` })) });
          batch.commit().then(() => toast({ title: clash ? "Clash: Auto-Cancelled" : "Late: Auto-Cancelled" })); return;
        } else if (lateMinutes > grace) {
          const fee = Number(((lateMinutes / 60) * tmhrValue + premium).toFixed(2));
          const batch = writeBatch(firestore);
          batch.update(docRef, sanitizeForFirestore({ checkInStatus: 'running_late', lateTimeMinutes: lateMinutes }));
          if (apt.checkInToken) batch.update(doc(firestore, 'appointmentCheckIns', apt.checkInToken), sanitizeForFirestore({ checkInStatus: 'running_late', lateTimeMinutes: lateMinutes, tenantId }));
          if (apt.clientId && fee > 0) batch.update(doc(firestore, 'tenants', tenantId, 'clients', apt.clientId), { outstandingBalance: increment(fee), unpaidFees: arrayUnion(sanitizeForFirestore({ feeId: nanoid(), appointmentId: apt.id, appointmentDate: safeDate(apt.startTime).toISOString(), feeAmount: fee, reason: `Late Penalty: +${lateMinutes}m` })) });
          batch.commit().then(() => toast({ title: "Status Updated: Fee Applied" })); return;
        }
      }
    }
    const updates: any = { checkInStatus: status };
    if (lateMinutes !== undefined) updates.lateTimeMinutes = lateMinutes;
    const batch = writeBatch(firestore);
    batch.set(docRef, sanitizeForFirestore(updates), { merge: true });
    const apt = !effectiveIsWalkIn ? appointmentsFromInventory?.find(a => a.id === id) : null;
    if (apt?.checkInToken) batch.set(doc(firestore, 'appointmentCheckIns', apt.checkInToken), sanitizeForFirestore({ ...updates, tenantId }), { merge: true });
    batch.commit().then(() => toast({ title: "Status Updated" }));
  };

  const handleCheckout = async (paymentData: { paymentMethod: string, amountTendered: number, recoveryAmount?: number, recoveryReason?: string, skipLedger?: boolean, stripePaymentIntentId?: string, cardSurcharge?: number }) => {
    const effectiveClientId = selectedClientId ?? readyForCheckoutAppointments.find(a => selectedAppointmentIds.has(a.id))?.appointment?.clientId ?? null;
    if (!effectiveClientId || !firestore || !tenantId) return;
    setIsSubmitting(true);
    const batch = writeBatch(firestore); const now = new Date().toISOString();
    const clientObj = (clients || []).find(c => c.id === effectiveClientId);
    const checkoutSessionId = nanoid();
    let depositCredit: { ref: any; amountCents?: number; amountDollars?: number; createdAt?: any } | null = null;
    try {
      const creditsCol = collection(firestore, `tenants/${tenantId}/depositCredits`);
      let creditSnap = await getDocs(query(creditsCol, where('status', '==', 'available'), where('clientId', '==', effectiveClientId)));
      if (creditSnap.empty && clientObj?.email) creditSnap = await getDocs(query(creditsCol, where('status', '==', 'available'), where('clientEmail', '==', String(clientObj.email).toLowerCase().trim())));
      if (!creditSnap.empty) { const found = creditSnap.docs.map(d => ({ ref: d.ref, ...(d.data() as any) })).filter((c: any) => !isCreditExpired(c.expiresAt)); found.sort((a, b) => safeDate(b.createdAt).getTime() - safeDate(a.createdAt).getTime()); depositCredit = found[0] || null; }
    } catch (e) { console.warn('[deposit-credit lookup]', e); }
    const depositCreditDollars = depositCredit ? safeNumber((depositCredit as any).amountDollars ?? ((depositCredit as any).amountCents || 0) / 100) : 0;
    const recoveryAmount = safeNumber(paymentData.recoveryAmount);
    const recoveryReason = paymentData.recoveryReason || 'Service Recovery Adjustment';
    let totalLtvIncrease = 0; let totalCashIncrease = 0; let cashTipsTotal = 0;
    const cashTipsByStaffUpdate: Record<string, number> = {};

    for (const aptData of readyForCheckoutAppointments.filter(a => selectedAppointmentIds.has(a.id))) {
      const { appointment: apt, service, addOnServices } = aptData;
      const appointmentRef = doc(firestore, 'tenants', tenantId, 'appointments', apt.id);
      const checkoutState = apt.checkoutState || {}; const overrides = checkoutState.serviceStaffOverrides || {};
      const isWaived = waivedAppointmentFees.has(apt.id);
      const mainStaffId = overrides[service.id] || apt.staffId;
      const isMainRedeemed = redeemedOffer?.itemId === service.id;
      const mainStaffMember = staff.find(s => s.id === mainStaffId);
      const mainPartRevenue = isMainRedeemed ? 0 : getServicePrice(service, mainStaffMember);
      totalLtvIncrease += mainPartRevenue; if (paymentData.paymentMethod === 'cash') totalCashIncrease += mainPartRevenue;
      if (!paymentData.skipLedger) batch.set(doc(collection(firestore, `tenants/${tenantId}/transactions`)), sanitizeForFirestore({ id: nanoid(), date: now, description: isMainRedeemed ? `Redemption: ${service.name}` : `Service: ${service.name}`, clientOrVendor: clientObj?.name || 'Client', clientId: effectiveClientId, type: 'income', context: 'Business', category: 'Service Revenue', taxBucket: 'revenue', amount: mainPartRevenue, paymentMethod: paymentData.paymentMethod, staffId: mainStaffId, appointmentId: apt.id, hasReceipt: true, tenantId, checkoutSessionId }));
      if (isMainRedeemed) { const redemptionCost = computeServiceCost(service, apt, mainStaffMember, inventory || [], selectedTenant?.tmhr || 50); if (redemptionCost.total > 0) batch.set(doc(collection(firestore, `tenants/${tenantId}/transactions`)), sanitizeForFirestore({ id: nanoid(), date: now, description: `Redemption Cost: ${service.name}`, clientOrVendor: clientObj?.name || 'Client', clientId: effectiveClientId, type: 'expense', context: 'Business', category: 'Comp & Redemption Cost', taxBucket: 'operating_cost', amount: redemptionCost.total, paymentMethod: 'Internal', staffId: mainStaffId, appointmentId: apt.id, hasReceipt: false, tenantId, checkoutSessionId, notes: `Materials $${redemptionCost.materials.toFixed(2)} · Overhead $${redemptionCost.overhead.toFixed(2)} · Labor $${redemptionCost.labor.toFixed(2)}` })); }
      addOnServices.forEach((addon: any) => { const isAddonRedeemedForCost = redeemedOffer?.itemId === addon.id; if (!isAddonRedeemedForCost) return; const addonStaffIdForCost = overrides[addon.id] || apt.staffId; const addonStaffForCost = staff.find((s: any) => s.id === addonStaffIdForCost); const addonCost = computeServiceCost(addon, apt, addonStaffForCost, inventory || [], selectedTenant?.tmhr || 50); if (addonCost.total > 0) batch.set(doc(collection(firestore, `tenants/${tenantId}/transactions`)), sanitizeForFirestore({ id: nanoid(), date: now, description: `Redemption Cost: ${addon.name}`, clientOrVendor: clientObj?.name || 'Client', clientId: effectiveClientId, type: 'expense', context: 'Business', category: 'Comp & Redemption Cost', taxBucket: 'operating_cost', amount: addonCost.total, paymentMethod: 'Internal', staffId: addonStaffIdForCost, appointmentId: apt.id, hasReceipt: false, tenantId, checkoutSessionId, notes: `Materials $${addonCost.materials.toFixed(2)} · Overhead $${addonCost.overhead.toFixed(2)} · Labor $${addonCost.labor.toFixed(2)}` })); });
      if (!paymentData.skipLedger) {
        if (!isWaived && checkoutState.adjustments) {
          const { rescheduleFee, timeOverage, materialOverage } = checkoutState.adjustments;
          if (safeNumber(rescheduleFee) > 0) { const amt = safeNumber(rescheduleFee); totalLtvIncrease += amt; if (paymentData.paymentMethod === 'cash') totalCashIncrease += amt; batch.set(doc(collection(firestore, `tenants/${tenantId}/transactions`)), sanitizeForFirestore({ id: nanoid(), date: now, description: `Reschedule Recovery: ${service.name}`, clientOrVendor: clientObj?.name || 'Client', clientId: effectiveClientId, type: 'income', context: 'Business', category: 'Protocol Recovery', taxBucket: 'adjustment', amount: amt, paymentMethod: paymentData.paymentMethod, staffId: mainStaffId, appointmentId: apt.id, hasReceipt: false, tenantId, checkoutSessionId })); }
          if (safeNumber(timeOverage) > 0) { const amt = safeNumber(timeOverage); totalLtvIncrease += amt; if (paymentData.paymentMethod === 'cash') totalCashIncrease += amt; batch.set(doc(collection(firestore, `tenants/${tenantId}/transactions`)), sanitizeForFirestore({ id: nanoid(), date: now, description: `Time Floor Overage: ${service.name}`, clientOrVendor: clientObj?.name || 'Client', clientId: effectiveClientId, type: 'income', context: 'Business', category: 'Strategic Adjustment', taxBucket: 'adjustment', amount: amt, paymentMethod: paymentData.paymentMethod, staffId: mainStaffId, appointmentId: apt.id, hasReceipt: false, tenantId, checkoutSessionId })); }
          if (safeNumber(materialOverage) > 0) { const amt = safeNumber(materialOverage); totalLtvIncrease += amt; if (paymentData.paymentMethod === 'cash') totalCashIncrease += amt; batch.set(doc(collection(firestore, `tenants/${tenantId}/transactions`)), sanitizeForFirestore({ id: nanoid(), date: now, description: `Material Protocol Overage: ${service.name}`, clientOrVendor: clientObj?.name || 'Client', clientId: effectiveClientId, type: 'income', context: 'Business', category: 'Strategic Adjustment', taxBucket: 'adjustment', amount: amt, paymentMethod: paymentData.paymentMethod, staffId: mainStaffId, appointmentId: apt.id, hasReceipt: false, tenantId, checkoutSessionId })); }
        } else if (!isWaived && safeNumber(checkoutState.additionalCharge) > 0) {
          const amt = safeNumber(checkoutState.additionalCharge); totalLtvIncrease += amt; if (paymentData.paymentMethod === 'cash') totalCashIncrease += amt;
          batch.set(doc(collection(firestore, `tenants/${tenantId}/transactions`)), sanitizeForFirestore({ id: nanoid(), date: now, description: `Strategic Adjustment Fee`, clientOrVendor: clientObj?.name || 'Client', clientId: effectiveClientId, type: 'income', context: 'Business', category: 'Adjustment Fee', taxBucket: 'adjustment', amount: amt, paymentMethod: paymentData.paymentMethod, staffId: mainStaffId, appointmentId: apt.id, hasReceipt: false, tenantId, checkoutSessionId }));
        }
        addOnServices.forEach((addon: any) => { const addonStaffId = overrides[addon.id] || apt.staffId; const isAddonRedeemed = redeemedOffer?.itemId === addon.id; const addonStaff = staff.find((s: any) => s.id === addonStaffId); const addonPrice = isAddonRedeemed ? 0 : getServicePrice(addon, addonStaff); totalLtvIncrease += addonPrice; if (paymentData.paymentMethod === 'cash') totalCashIncrease += addonPrice; batch.set(doc(collection(firestore, `tenants/${tenantId}/transactions`)), sanitizeForFirestore({ id: nanoid(), date: now, description: isAddonRedeemed ? `Redemption: ${addon.name}` : `Add-on: ${addon.name}`, clientOrVendor: clientObj?.name || 'Client', clientId: effectiveClientId, type: 'income', context: 'Business', category: 'Service Revenue', taxBucket: 'revenue', amount: addonPrice, paymentMethod: paymentData.paymentMethod, staffId: addonStaffId, appointmentId: apt.id, hasReceipt: true, tenantId, checkoutSessionId })); });
        (checkoutState.refreshments || []).forEach((amenity: any) => { const qty = safeNumber(amenity.quantity || 1); const amenityPrice = safeNumber(amenity.price) * qty; if (amenityPrice > 0) { totalLtvIncrease += amenityPrice; if (paymentData.paymentMethod === 'cash') totalCashIncrease += amenityPrice; batch.set(doc(collection(firestore, `tenants/${tenantId}/transactions`)), sanitizeForFirestore({ id: nanoid(), date: now, description: `Concierge: ${amenity.name} (x${qty})`, clientOrVendor: clientObj?.name || 'Client', clientId: effectiveClientId, type: 'income', context: 'Business', category: 'Hospitality Revenue', taxBucket: 'revenue', amount: amenityPrice, paymentMethod: paymentData.paymentMethod, appointmentId: apt.id, hasReceipt: false, tenantId, checkoutSessionId })); } });
      } else {
        if (!isWaived && checkoutState.adjustments) { const { rescheduleFee, timeOverage, materialOverage } = checkoutState.adjustments; totalLtvIncrease += safeNumber(rescheduleFee) + safeNumber(timeOverage) + safeNumber(materialOverage); }
        else if (!isWaived) totalLtvIncrease += safeNumber(checkoutState.additionalCharge);
        addOnServices.forEach((addon: any) => { const isAddonRedeemed = redeemedOffer?.itemId === addon.id; const addonStaff = staff.find((s: any) => s.id === (overrides[addon.id] || apt.staffId)); totalLtvIncrease += isAddonRedeemed ? 0 : getServicePrice(addon, addonStaff); });
      }
      batch.set(appointmentRef, sanitizeForFirestore({ status: 'completed', revenue: mainPartRevenue + addOnServices.reduce((s: number, a: any) => s + getServicePrice(a, staff.find(st => st.id === (overrides[a.id] || apt.staffId))), 0), actualEndTime: now }), { merge: true });
      if (apt.checkInToken) batch.set(doc(firestore, 'appointmentCheckIns', apt.checkInToken), sanitizeForFirestore({ status: 'completed', tenantId }), { merge: true });
      const involvedIds = new Set<string>(); if (apt.staffId) involvedIds.add(apt.staffId); if (overrides) Object.values(overrides).forEach((id: any) => { if (id && typeof id === 'string') involvedIds.add(id); }); involvedIds.forEach(sid => { if (sid) batch.set(doc(firestore, 'tenants', tenantId, 'staff', sid), { status: 'available', lastWalkInCompletedAt: now }, { merge: true }); });
    }

    retailItems.forEach(item => {
      const productValue = item.price * item.quantity;
      const itemCategory = item.type === 'service' ? 'Service Revenue' : item.type === 'membership' ? 'Membership Sales' : item.type === 'package' ? 'Package Sales' : 'Retail';
      const itemDescription = item.type === 'service' ? `Service (POS): ${item.quantity}x ${item.name}` : item.type === 'membership' ? `Membership: ${item.name}` : item.type === 'package' ? `Package: ${item.name}` : `Retail Product: ${item.quantity}x ${item.name}`;
      if (!paymentData.skipLedger) batch.set(doc(collection(firestore, `tenants/${tenantId}/transactions`)), sanitizeForFirestore({ id: nanoid(), date: now, description: itemDescription, clientOrVendor: clientObj?.name || 'Client', clientId: effectiveClientId, type: 'income', context: 'Business', category: itemCategory, amount: productValue, paymentMethod: paymentData.paymentMethod, hasReceipt: true, tenantId, checkoutSessionId }));
      if (item.type === 'product') { batch.set(doc(firestore, 'tenants', tenantId, 'inventory', item.id), { totalStock: increment(-item.quantity) }, { merge: true }); batch.set(doc(collection(firestore, `tenants/${tenantId}/stockCorrections`)), sanitizeForFirestore({ id: nanoid(), productId: item.id, date: now, change: -item.quantity, unit: 'units', reason: `Retail Sale: ${item.name} for ${clientObj?.name || 'Guest'}` })); }
      totalLtvIncrease += productValue; if (paymentData.paymentMethod === 'cash') totalCashIncrease += productValue;
    });

    if (clientObj && appliedAdjustments.size > 0) {
      const currentUnpaid = clientObj.unpaidFees || [];
      const settledTotal = Array.from(appliedAdjustments).reduce((sum, id) => { const fee = currentUnpaid.find(f => f.feeId === id); return sum + safeNumber(fee?.feeAmount); }, 0);
      batch.set(doc(firestore, `tenants/${tenantId}/clients`, clientObj.id), { unpaidFees: currentUnpaid.filter(f => !appliedAdjustments.has(f.feeId)), outstandingBalance: increment(-settledTotal) }, { merge: true });
      if (paymentData.paymentMethod === 'cash') totalCashIncrease += settledTotal;
      appliedAdjustments.forEach(id => { const fee = currentUnpaid.find(f => f.feeId === id); if (fee) batch.set(doc(collection(firestore, `tenants/${tenantId}/transactions`)), sanitizeForFirestore({ id: nanoid(), date: now, description: `Debt Settlement: ${fee.reason}`, clientOrVendor: clientObj.name, clientId: effectiveClientId, type: 'income', context: 'Business', category: 'Fee Recovery', taxBucket: 'adjustment', amount: fee.feeAmount, paymentMethod: paymentData.paymentMethod, hasReceipt: false, tenantId, checkoutSessionId })); });
      totalLtvIncrease += settledTotal;
    }

    if (clientObj) {
      const finalLtvDelta = Math.max(0, totalLtvIncrease - discountValue - membershipDiscountValue - recoveryAmount);
      const updates: any = { lifetimeValue: increment(finalLtvDelta), lastAppointment: now };
      if (redeemedOffer) {
        const redemptionRef = doc(collection(firestore, `tenants/${tenantId}/clients/${effectiveClientId}/redemptions`));
        const offeringName = redeemedOffer.type === 'membership' ? memberships?.find(m => m.id === redeemedOffer.id)?.name : packages?.find(p => p.id === redeemedOffer.id)?.name;
        batch.set(redemptionRef, sanitizeForFirestore({ id: redemptionRef.id, clientId: effectiveClientId, type: redeemedOffer.type, offeringId: redeemedOffer.id, offeringName: offeringName || 'Offer', serviceId: redeemedOffer.itemId, serviceName: services?.find(s => s.id === redeemedOffer.itemId)?.name || 'Service', date: now, staffId: currentUser?.uid, tenantId }));
        if (redeemedOffer.type === 'package') updates.activePackages = (clientObj.activePackages || []).map(p => p.packageId === redeemedOffer.id ? { ...p, sessionsRemaining: p.sessionsRemaining - 1 } : p).filter(p => p.sessionsRemaining > 0);
        else { updates[`subscription.perkUsage.${redeemedOffer.itemId}`] = increment(1); updates['subscription.perkLastUsed'] = now; }
      }
      batch.set(doc(firestore, `tenants/${tenantId}/clients`, clientObj.id), updates, { merge: true });
    }

    const effectiveTipAllocations = { ...tipAllocations };
    if (tipAmount > 0 && Object.keys(effectiveTipAllocations).length === 0) { const fallbackStaff = (staff || []).find((s: any) => s.active) || null; const fallbackId = fallbackStaff?.id || currentUser?.uid || 'unassigned'; effectiveTipAllocations[fallbackId] = tipAmount; }
    Object.entries(effectiveTipAllocations).forEach(([staffId, amount]) => {
      const finalAmount = safeNumber(amount);
      if (finalAmount > 0) {
        if (!paymentData.skipLedger) batch.set(doc(collection(firestore, `tenants/${tenantId}/transactions`)), sanitizeForFirestore({ id: nanoid(), date: now, description: 'Gratuity', clientOrVendor: clientObj?.name || 'Client', clientId: effectiveClientId, type: 'income', context: 'Business', category: 'Tips', taxBucket: 'gratuity', amount: finalAmount, paymentMethod: paymentData.paymentMethod, staffId, hasReceipt: true, tenantId, checkoutSessionId }));
        if (paymentData.paymentMethod === 'cash') { cashTipsTotal += finalAmount; cashTipsByStaffUpdate[`cashTipsByStaff.${staffId}`] = increment(finalAmount); }
      }
    });

    if (!paymentData.skipLedger) {
      if (discountValue > 0) batch.set(doc(collection(firestore, `tenants/${tenantId}/transactions`)), sanitizeForFirestore({ id: nanoid(), date: now, description: `Promotion Applied`, clientOrVendor: 'Internal', clientId: effectiveClientId, type: 'expense', context: 'Business', category: 'Discounts', taxBucket: 'adjustment', amount: discountValue, paymentMethod: 'Internal', hasReceipt: false, tenantId, checkoutSessionId }));
      if (recoveryAmount > 0) batch.set(doc(collection(firestore, `tenants/${tenantId}/transactions`)), sanitizeForFirestore({ id: nanoid(), date: now, description: `Service Recovery: ${recoveryReason}`, clientOrVendor: clientObj?.name || 'Client', clientId: effectiveClientId, type: 'expense', context: 'Business', category: 'Discounts', taxBucket: 'adjustment', amount: recoveryAmount, notes: recoveryReason, paymentMethod: 'Internal', hasReceipt: false, tenantId, checkoutSessionId }));
      const taxAmount = Number((subtotalCalc * 0.07).toFixed(2));
      if (taxAmount > 0) { batch.set(doc(collection(firestore, `tenants/${tenantId}/transactions`)), sanitizeForFirestore({ id: nanoid(), date: now, description: `Sales Tax (7%)`, clientOrVendor: clientObj?.name || 'Client', clientId: effectiveClientId, type: 'income', context: 'Business', category: 'Tax Collected', taxBucket: 'tax_collected', amount: taxAmount, paymentMethod: paymentData.paymentMethod, hasReceipt: false, tenantId, checkoutSessionId })); totalLtvIncrease += taxAmount; }
      const cardSurchargeAmt = safeNumber((paymentData as any).cardSurcharge);
      if (cardSurchargeAmt > 0) { batch.set(doc(collection(firestore, `tenants/${tenantId}/transactions`)), sanitizeForFirestore({ id: nanoid(), date: now, description: 'Card Processing Fee (passed to client)', clientOrVendor: clientObj?.name || 'Client', clientId: effectiveClientId, type: 'income', context: 'Business', category: 'Card Processing Fee', taxBucket: 'revenue', amount: cardSurchargeAmt, paymentMethod: paymentData.paymentMethod, hasReceipt: false, tenantId, checkoutSessionId })); totalLtvIncrease += cardSurchargeAmt; }
    }

    let cashDepositOffset = 0;
    if (depositCredit && depositCreditDollars > 0) {
      const firstAptId = readyForCheckoutAppointments.find(a => selectedAppointmentIds.has(a.id))?.appointment?.id || null;
      if (!paymentData.skipLedger) batch.set(doc(collection(firestore, `tenants/${tenantId}/transactions`)), sanitizeForFirestore({ id: nanoid(), date: now, description: 'Deposit applied (prepaid online)', clientOrVendor: clientObj?.name || 'Client', clientId: effectiveClientId, type: 'expense', context: 'Business', category: 'Deposit Applied', taxBucket: 'adjustment', amount: depositCreditDollars, paymentMethod: 'Deposit', hasReceipt: false, tenantId, checkoutSessionId }));
      batch.set((depositCredit as any).ref, sanitizeForFirestore({ status: 'consumed', consumedAt: now, appointmentId: firstAptId }), { merge: true });
      cashDepositOffset = Math.min(depositCreditDollars, totalCashIncrease);
    }
    if (paymentTab === 'cash' && activeTill) { const finalCashInput = totalCashIncrease + cashTipsTotal - cashDepositOffset; batch.set(doc(firestore, `tenants/${tenantId}/tillSessions`, activeTill.id), sanitizeForFirestore({ expectedCash: increment(finalCashInput), totalCashSales: increment(totalCashIncrease - cashDepositOffset), totalCashTips: increment(cashTipsTotal), ...cashTipsByStaffUpdate }), { merge: true }); }

    try {
      await batch.commit();
      toast({ title: "Checkout Successful" });
      try {
        const receiptRef = doc(collection(firestore, `tenants/${tenantId}/receipts`));
        const receiptData = { id: receiptRef.id, checkoutSessionId, clientId: effectiveClientId, clientName: clientObj?.name || 'Guest', tenantId, date: now, paymentMethod: paymentData.paymentMethod, amountTendered: safeNumber(paymentData.amountTendered), change: Math.max(0, safeNumber(paymentData.amountTendered) - totalCalc), subtotal: subtotalCalc, tax: taxCalc, tip: tipAmount, discount: discountValue + membershipDiscountValue, total: totalCalc, cashierName: (staff || []).find((s: any) => s.id === currentUser?.uid)?.name || '', stripePaymentIntentId: paymentData.stripePaymentIntentId || null, lineItems: [...readyForCheckoutAppointments.filter(a => selectedAppointmentIds.has(a.id)).flatMap(a => { const overrides = a.appointment.checkoutState?.serviceStaffOverrides || {}; const mainStaffMember = staff.find((s: any) => s.id === (overrides[a.service?.id] || a.appointment.staffId)); const lines: any[] = [{ label: a.service?.name || 'Service', amount: getServicePrice(a.service, a.staff), type: 'service', staff: mainStaffMember?.name?.split(' ')[0] }]; (a.addOnServices || []).forEach((addon: any) => { const addonStaff = staff.find((s: any) => s.id === (overrides[addon.id] || a.appointment.staffId)); lines.push({ label: `+ ${addon.name}`, amount: getServicePrice(addon, addonStaff), type: 'addon', staff: addonStaff?.name?.split(' ')[0] }); }); return lines; }), ...retailItems.map((item: any) => ({ label: item.name, amount: item.price * item.quantity, type: item.type || 'retail' }))] };
        setDocumentNonBlocking(doc(firestore, `tenants/${tenantId}/receipts`, receiptRef.id), receiptData, {});
      } catch (e) { console.warn('[receipt save]', e); }
      setRetailItems([]); setSelectedAppointmentIds(new Set()); setTipAmount(0); setIsCartSheetOpen(false); setRedeemedOffer(null); setAppliedDiscountCodes([]); setAppliedAdjustments(new Set()); setStoreCreditApplied(0);
    } catch (e: any) { console.error('[handleCheckout] batch.commit failed:', e?.message, e?.code, e); toast({ variant: 'destructive', title: 'Checkout Failed', description: e?.message || 'Firestore batch error' }); }
    finally { setIsSubmitting(false); }
  };

  const handleCancelAction = (id: string, isWalkIn: boolean) => {
    const isAssignedWalkIn = id.startsWith('apt-walkin-');
    const effectiveIsWalkIn = isWalkIn && !isAssignedWalkIn;
    const item = effectiveIsWalkIn ? walkIns?.find(w => w.id === id) : appointmentsFromInventory?.find(a => a.id === id);
    if (item) { setSelectedAppointment({ ...item, isWalkIn: effectiveIsWalkIn } as any); setIsCancelDialogOpen(true); }
  };

  const onCancellationConfirm = useCancellationConfirm(
    selectedAppointment,
    clients?.find(c => c.id === selectedAppointment?.clientId) ?? null,
  );

  const handleCancellationConfirm = useCallback(async (data: any) => {
    const result = await onCancellationConfirm(data);
    if (result?.pendingRefund) {
      setPendingRefund({
        creditId: result.pendingRefund.creditId,
        amount: result.pendingRefund.amount,
        clientName: clients?.find(c => c.id === selectedAppointment?.clientId)?.name || 'Client',
        reason: result.depositDisposition === 'refunded' ? 'Studio cancellation' : '',
        appointmentId: selectedAppointment?.id,
      });
    }
    setIsCancelDialogOpen(false);
    setIsDetailsOpen(false);
  }, [onCancellationConfirm, clients, selectedAppointment]);

  const handleConfirmRefund = useCallback(async () => {
    if (!pendingRefund || !tenantId) return;
    try {
      const res = await fetch('/api/stripe/deposit-refund', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, creditId: pendingRefund.creditId }) });
      const out = await res.json().catch(() => null);
      if (!res.ok || !out?.ok) toast({ variant: 'destructive', title: 'Refund failed', description: out?.error || 'Could not refund the deposit.' });
      else toast({ title: 'Deposit refunded', description: `$${safeNumber(pendingRefund.amount).toFixed(2)} returned to ${pendingRefund.clientName}.` });
    } catch (e: any) { toast({ variant: 'destructive', title: 'Refund failed', description: e.message }); }
    finally { setPendingRefund(null); }
  }, [pendingRefund, tenantId, toast]);

  const handleResolveCheckInConfirmation = async (data: any) => {
    if (!pendingCheckInItem || !firestore || !tenantId) return;
    const isWalkIn = !!pendingCheckInItem.serviceIds;
    const docRef = isWalkIn ? doc(firestore, 'tenants', tenantId, 'walkIns', pendingCheckInItem.id) : doc(firestore, 'tenants', tenantId, 'appointments', pendingCheckInItem.id);
    const batch = writeBatch(firestore);
    const updates: any = { serviceId: data.serviceId, addOnIds: data.addOnIds, checkInStatus: 'arrived', notes: data.notes };
    if (data.accommodations?.length) updates.sensoryNeeds = data.accommodations.join(', ');
    if (data.mustFinishBy) updates.mustFinishBy = data.mustFinishBy;
    batch.update(docRef, sanitizeForFirestore(updates));
    if (!isWalkIn && pendingCheckInItem.checkInToken) batch.update(doc(firestore, 'appointmentCheckIns', pendingCheckInItem.checkInToken), sanitizeForFirestore({ ...updates, tenantId }));
    if (pendingCheckInItem.clientId) batch.update(doc(firestore, `tenants/${tenantId}/clients`, pendingCheckInItem.clientId), sanitizeForFirestore({ email: data.email, phone: data.phone, ...(data.accommodations?.length ? { sensoryNeeds: data.accommodations.join(', ') } : {}) }));
    try { await batch.commit(); toast({ title: "Check-in Certified" }); setPendingCheckInItem(null); }
    catch (e) { console.error(e); toast({ variant: 'destructive', title: "Confirmation Failed" }); }
  };

  const handleRevertToService = (appointmentId: string) => { if (!firestore || !tenantId) return; updateDocumentNonBlocking(doc(firestore, `tenants/${tenantId}/appointments`, appointmentId), { status: 'servicing' }); toast({ title: "Status Reverted" }); };
  const handleRevertToReady = (appointmentId: string) => { if (!firestore || !tenantId) return; updateDocumentNonBlocking(doc(firestore, `tenants/${tenantId}/appointments`, appointmentId), { status: 'ready_for_checkout' }); toast({ title: "Status Reverted" }); };

  // ── Scan / code lookup ─────────────────────────────────────────────────────
  // Resolves an 8-char check-in code (or a full token) against appointments
  // already in memory — no extra Firestore read. The 8-char code is the last
  // 8 chars of checkInToken, uppercased (same value PrintTicket prints and
  // QuickBookForm's SuccessScreen shows). Full token also accepted so QR
  // scans work when/if QR is re-added to the confirmation email.
  const resolveScanCode = React.useCallback((raw: string) => {
    const code = raw.trim().toUpperCase();
    if (!code) return;
    const found = (appointmentsFromInventory || []).find((a: any) => {
      if (!a.checkInToken) return false;
      const full = a.checkInToken.toUpperCase();
      return full === code || full.slice(-8) === code.slice(-8);
    });
    if (found) { setScanResult(found); setScanNotFound(false); }
    else { setScanResult(null); setScanNotFound(true); }
  }, [appointmentsFromInventory]);

  // Barcode scanners emulate keyboard typing at ~50ms/char. When the whole
  // code arrives within 80ms of the 8th character, auto-resolve without
  // requiring the staff member to press Enter.
  const scanTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleScanInput = React.useCallback((val: string) => {
    setScanQuery(val); setScanNotFound(false); setScanResult(null);
    if (scanTimerRef.current) clearTimeout(scanTimerRef.current);
    if (val.length >= 8) scanTimerRef.current = setTimeout(() => resolveScanCode(val), 80);
  }, [resolveScanCode]);

  const handleScanConfirm = React.useCallback(() => {
    if (!scanResult) return;
    setIsScanLookupOpen(false);
    setScanQuery(''); setScanResult(null); setScanNotFound(false);
    const notYetArrived = !scanResult.checkInStatus || scanResult.checkInStatus === 'pending' || scanResult.checkInStatus === 'confirmed';
    if (notYetArrived) { setPendingCheckInItem(scanResult); }
    else { setSelectedAppointment(scanResult); setIsDetailsOpen(true); }
  }, [scanResult]);
  const handleOpenTill = (data: any) => { if (!firestore || !tenantId) return; const sessionRef = doc(collection(firestore, 'tenants', tenantId, 'tillSessions')); const newSession: any = { ...data, id: sessionRef.id, openedAt: new Date().toISOString(), status: 'open', expectedCash: data.openingFloat, totalCashSales: 0, totalCashTips: 0, totalCashRefunds: 0, cashTipsByStaff: {} }; setDocumentNonBlocking(sessionRef, sanitizeForFirestore(newSession), {}); toast({ title: "Till Session Initialized" }); };
  const handleCloseTill = (data: any) => {
    if (!firestore || !tenantId || !activeTill) return;
    const variance = Number((safeNumber(data.discrepancy)).toFixed(2));
    const batch = writeBatch(firestore);
    batch.update(doc(firestore, 'tenants', tenantId, 'tillSessions', activeTill.id), sanitizeForFirestore({ ...data, status: 'closed', closedAt: new Date().toISOString() }));
    let varianceDescription: string | undefined;
    if (Math.abs(variance) >= 0.01) {
      batch.set(doc(collection(firestore, `tenants/${tenantId}/transactions`)), sanitizeForFirestore({ id: nanoid(), date: new Date().toISOString(), description: variance >= 0 ? 'Till overage at close' : 'Till shortage at close', clientOrVendor: 'Internal', type: variance >= 0 ? 'income' : 'expense', context: 'Business', category: 'Cash Variance', taxBucket: 'operating_cost', amount: Math.abs(variance), paymentMethod: 'Cash', hasReceipt: false, tillSessionId: activeTill.id, tenantId }));
      varianceDescription = `${variance >= 0 ? 'Overage' : 'Shortage'} of $${Math.abs(variance).toFixed(2)} recorded.`;
    }
    batch.commit().then(() => toast({ title: "Till Session Finalized", description: varianceDescription }));
  };

  const handleVoidTransaction = async (txId: string, authorizerPin: string, reason: string) => {
    if (!firestore || !tenantId) return;
    const authSnap = await getDocs(query(collection(firestore, `tenants/${tenantId}/staff`), where('pin', '==', authorizerPin)));
    const authorizer = authSnap.docs[0];
    if (!authorizer || !['admin','owner'].includes(authorizer.data().role)) { toast({ variant: 'destructive', title: 'Unauthorized', description: 'Manager PIN required to void transactions.' }); return; }
    const txRef = doc(firestore, `tenants/${tenantId}/transactions`, txId);
    const batch = writeBatch(firestore);
    batch.update(txRef, sanitizeForFirestore({ voided: true, voidedAt: new Date().toISOString(), voidedBy: authorizer.id, voidReason: reason }));
    const reversalRef = doc(collection(firestore, `tenants/${tenantId}/transactions`));
    const originalTx = transactions?.find(t => t.id === txId);
    if (originalTx) batch.set(reversalRef, sanitizeForFirestore({ id: reversalRef.id, date: new Date().toISOString(), description: `VOID: ${originalTx.description}`, clientOrVendor: originalTx.clientOrVendor, clientId: originalTx.clientId, type: originalTx.type === 'income' ? 'expense' : 'income', context: 'Business', category: 'Void', taxBucket: 'refund', amount: originalTx.amount, paymentMethod: originalTx.paymentMethod, voidOf: txId, notes: reason, hasReceipt: false, tenantId }));
    await batch.commit();
    toast({ title: 'Transaction Voided', description: `Reversal recorded. Authorized by ${authorizer.data().name}.` });
    setIsVoidDialogOpen(false); setVoidTransactionId(null);
  };

  const checkoutHubProps = {
    cart: retailItems, onCartChange: setRetailItems, appointmentsData: readyForCheckoutAppointments.filter(a => selectedAppointmentIds.has(a.id)), onSelectAppointment: handleSelectAppointment,
    clients: clients || [], isGroupCheckout: selectedAppointmentIds.size > 1, payerOptions: payerOptions || [], selectedClientId, setSelectedClientId,
    onAddClientClick: () => setIsAddClientOpen(true), onScanClick: () => {},
    subtotal: subtotalCalc, tax: taxCalc, total: totalCalc, tipAmount, setTipAmount, onCheckout: handleCheckout,
    appliedDiscountCodes, setAppliedDiscountCodes, discount: discountValue, membershipDiscount: membershipDiscountValue,
    isSubmitting, paymentTab, setPaymentTab, discounts: discounts || [], amountTendered, setAmountTendered,
    appliedAdjustments, onApplyAdjustmentToggle: (id: string, apply: boolean) => { const next = new Set(appliedAdjustments); if (apply) next.add(id); else next.delete(id); setAppliedAdjustments(next); },
    redeemedOffer, setRedeemedOffer, memberships: memberships || [], packages: packages || [],
    allowStacking: selectedTenant?.allowDiscountStacking || false, showTitle: false,
    waivedAppointmentFees, onWaiveFeeToggle: (id: string, waive: boolean, authorizerId?: string, reason?: string) => { setWaivedAppointmentFees(prev => { const next = new Map(prev); if (waive && authorizerId && reason) next.set(id, { authorizerId, reason }); else next.delete(id); return next; }); },
    tipAllocations, setTipAllocations, activeTill, staff, role,
    onRequestOverride: () => { setIsCartSheetOpen(false); setTimeout(() => setIsRecoveryOverrideOpen(true), 300); },
    tenantId,
    cashierName: (staff || []).find((s: any) => s.id === currentUser?.uid)?.name || (staff || []).find((s: any) => s.role === 'owner')?.name || '',
    storeCreditApplied,
    onStoreCreditApplied: ({ appliedAmount }: { appliedAmount: number; remainingBalance: number }) => {
      setStoreCreditApplied(appliedAmount);
    },
  };

  // Looks up the most recent COMPLETED appointment for a client + service
  // and returns its formula, so PrintTicket can pre-check matching items.
  const getPreviousFormula = React.useCallback((clientId: string, serviceId: string) => {
    const past = (appointmentsFromInventory || [])
      .filter((a: any) => a.clientId === clientId && a.serviceId === serviceId && a.status === 'completed' && a.checkoutState?.formula?.length)
      .sort((a: any, b: any) => new Date(b.startTime || 0).getTime() - new Date(a.startTime || 0).getTime());
    return past[0]?.checkoutState?.formula || [];
  }, [appointmentsFromInventory]);

  const getVisitCount = React.useCallback((clientId: string) => {
    return (appointmentsFromInventory || [])
      .filter((a: any) => a.clientId === clientId && a.status !== 'cancelled').length;
  }, [appointmentsFromInventory]);

  if (isInventoryLoading) return <div className="h-screen w-full flex flex-col items-center justify-center gap-4 bg-background"><Loader className="h-10 w-10 animate-spin text-primary" /><p className="text-sm font-black uppercase tracking-[0.2em] text-muted-foreground animate-pulse">Initializing Terminal...</p></div>;

  return (
    <div className="h-[100dvh] w-full flex flex-col bg-background text-left">
      <AppHeader title="Studio POS" />
      <div className={cn("flex-1 grid transition-all duration-500 ease-in-out overflow-hidden", isCartCollapsed ? "lg:grid-cols-[1fr,80px]" : "lg:grid-cols-[1fr,400px] xl:grid-cols-[1fr,450px]")}>
        <main className="flex-1 flex flex-col overflow-auto p-4 md:p-10 gap-10 pb-32 lg:pb-10 text-left">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6 mb-2">
            <div className="grid gap-4 md:gap-6 grid-cols-2 lg:grid-cols-4 flex-1 w-full text-left">
              <KpiCard title="Avg Wait" value={`${kpiData.avgWaitTime.toFixed(0)}m`} icon={<Clock className="text-blue-500" />} iconBgColor="bg-blue-100" description="Check-in to chair." />
              <KpiCard title="Today's Guests" value={kpiData.totalWalkIns.toString()} icon={<Users className="text-purple-500" />} iconBgColor="bg-purple-100" description={`${kpiData.newGuestCount} new · ${kpiData.returningCount} returning`} />
              <KpiCard title="Daily Gross" value={`$${safeNumber(kpiData.totalDailyGrossRevenue).toFixed(2)}`} icon={<DollarSign className="text-amber-500" />} iconBgColor="bg-amber-100" description={`$${kpiData.revenuePerGuest.toFixed(0)}/guest`} />
              <KpiCard title="Conversion" value={`${kpiData.conversionRate.toFixed(0)}%`} icon={<Sparkles className="text-green-500" />} iconBgColor="bg-green-100" description="Walk-in → serviced" />
            </div>
            {isOwnerOrAdminUser && (<Button variant={activeTill ? "outline" : "default"} onClick={() => setIsTillManagementOpen(true)} className={cn("h-14 md:h-20 px-8 rounded-3xl font-black uppercase text-xs shadow-xl border-4 flex flex-col items-center justify-center gap-1", activeTill ? "border-green-500/20 bg-green-500/5 text-green-700" : "shadow-primary/20")}><Landmark className="w-5 h-5 mb-1" /> {activeTill ? `Till: $${safeNumber(activeTill.expectedCash).toFixed(2)}` : "Open Studio Till"}</Button>)}
          </div>

          <div className="grid gap-10 grid-cols-1">
            <div className="flex items-center gap-3 flex-wrap">
              <Button onClick={() => setIsQuickBookOpen(true)} variant="outline" className="h-10 px-4 rounded-xl border-2 border-primary/20 bg-primary/5 text-primary font-black uppercase text-[10px] tracking-widest hover:bg-primary/10 gap-2"><Calendar className="w-4 h-4" /> Quick Book</Button>
              {/* Scan / Check-In — opens full-screen camera scanner.
                  After a successful scan, resolves the code against in-memory
                  appointments and opens the appropriate dialog. */}
              <Button onClick={() => { setScanQuery(''); setScanResult(null); setScanNotFound(false); setIsCameraScanOpen(true); }} variant="outline" className="h-10 px-4 rounded-xl border-2 border-emerald-200 bg-emerald-50 text-emerald-700 font-black uppercase text-[10px] tracking-widest hover:bg-emerald-100 gap-2"><QrCode className="w-4 h-4" /> Scan / Check-In</Button>
              <Button onClick={() => setIsVoidDialogOpen(true)} variant="outline" className="h-10 px-4 rounded-xl border-2 border-red-200 bg-red-50 text-red-600 font-black uppercase text-[10px] tracking-widest hover:bg-red-100 gap-2" disabled={!transactions?.some(t => isToday(safeDate(t.date)) && !t.voided)}><XCircle className="w-4 h-4" /> Void Tx</Button>
            </div>

            <TeamStatus staff={staff} onStatusChange={(id: any, act: any) => {}} appointments={appointmentsFromInventory?.filter(a => isToday(safeDate(a.startTime)))} services={services} onReorder={(newOrder: any) => { if (!firestore || !tenantId) return; const batch = writeBatch(firestore); newOrder.forEach((s: any, idx: number) => { batch.set(doc(firestore, 'tenants', tenantId, 'staff', s.id), { turnOrder: idx }, { merge: true }); }); batch.commit(); }} assignmentMode={assignmentMode} onAssignmentModeChange={setAssignmentMode} resources={resources || []} onForceIdle={(staffId: string) => { if (!firestore || !tenantId) return; setDocumentNonBlocking(doc(firestore, 'tenants', tenantId, 'staff', staffId), { status: 'idle' }, { merge: true }); toast({ title: "Staff Reset" }); }} />

            <WalkInQueue walkIns={walkIns} appointments={appointmentsFromInventory?.filter(a => isToday(safeDate(a.startTime)))} readyForCheckoutAppointments={readyForCheckoutAppointments} selectedAppointmentIds={selectedAppointmentIds} onSelectAppointment={handleSelectAppointment} services={services} staff={staff} onAssignStaff={handleAssignStaff} onAssignNext={handleAssignNext} onCancel={handleCancelAction} onStartService={handleStartService} orderedWaitingQueue={[]} onReorder={() => {}} assignmentMode={assignmentMode} onPrintTicket={(id: string) => { const item = (walkIns || []).find(w => w.id === id) || (appointmentsFromInventory || []).find(a => a.id === id); if (item) { const client = clients?.find(c => c.id === item.clientId); const service = services?.find(s => s.id === (item.serviceId || item.serviceIds?.[0])); const addOnServices = (item.addOnIds || []).map((aid: string) => services?.find(s => s.id === aid)).filter(Boolean); const staffMember = staff?.find(s => s.id === item.staffId); if (client && service) { setTicketToPrint({ business: { name: selectedTenant?.name || 'Studio', phone: selectedTenant?.twilioPhoneNumber || '' }, client, service, appointment: item, addOnServices, staffName: staffMember?.name, previousFormula: getPreviousFormula(client.id, service.id), visitCount: getVisitCount(client.id), stationName: (item.stationName || (item.requiredResourceIds?.[0] ? (resources || []).find((r: any) => r.id === item.requiredResourceIds[0])?.name : undefined)) }); setIsPrintDialogOpen(true); } } }} onSkip={(id: string) => { if (!firestore || !tenantId) return; updateDocumentNonBlocking(doc(firestore, 'tenants', tenantId, 'walkIns', id), { status: 'skipped' }); }} onReturnToQueue={(id: string) => { if (!firestore || !tenantId) return; updateDocumentNonBlocking(doc(firestore, 'tenants', tenantId, 'walkIns', id), { status: 'waiting' }); }} groupSizes={useMemo(() => { const sizes = new Map<string, number>(); (walkIns || []).forEach((w: any) => { if (w.groupId && w.groupSize) sizes.set(w.groupId, w.groupSize); else if (w.groupId) sizes.set(w.groupId, (sizes.get(w.groupId) || 0) + 1); }); return sizes; }, [walkIns])} onToggleWaitForStaff={() => {}} onFinishService={(apt: any) => { setAppointmentToReview(apt); setIsTechnicianReviewOpen(true); }} onUpdateStatus={handleUpdateStatus} onRevertToReady={handleRevertToReady} onRevertToService={handleRevertToService} onResolve={(item: any) => { if (item.isPotentialAlias && item.matchedClient) { setPendingIdentityMatch(item); } else if (item.type === 'walk-in') { setPendingCheckInItem(item); } else { /* unarrived booked appointments go through check-in first; already-arrived skip straight to the full sheet */ const notYetArrived = !item.checkInStatus || item.checkInStatus === 'pending' || item.checkInStatus === 'confirmed'; if (notYetArrived) { setPendingCheckInItem(item); } else { setSelectedAppointment(item); setIsDetailsOpen(true); } } }} />

            {/* ── WAITLIST MANAGER — new feature ───────────────────────────── */}
            <WaitlistManager
              {...waitlist}
              services={services || []}
              staff={staff || []}
              appointments={appointmentsFromInventory || []}
            />

            <div className="space-y-4 text-left">
              <h3 className="text-sm font-black uppercase tracking-[0.2em] text-muted-foreground flex items-center gap-2"><Sparkles className="w-4 h-4 text-primary" />Retail & Additions</h3>
              <RetailCatalog services={services || []} inventory={inventory || []} memberships={memberships || []} packages={packages || []} onAddToCart={handleAddToCart} onScanClick={() => {}} />
            </div>
          </div>
        </main>

        <aside className={cn("hidden lg:flex border-l-4 border-muted/30 bg-white flex-col h-full transition-all duration-500 relative overflow-hidden", isCartCollapsed ? "w-20" : "w-full")}>
          {!isCartCollapsed ? (
            <div className="flex flex-col h-full w-full">
              <div className="absolute top-6 left-[-24px] z-50"><Button variant="outline" size="icon" onClick={() => setIsCartCollapsed(true)} className="h-12 w-12 rounded-2xl border-4 border-white bg-white shadow-xl hover:bg-muted text-slate-400 group transition-all"><ChevronRight className="h-6 w-6 group-hover:translate-x-0.5 transition-transform" /></Button></div>
              <div className="absolute inset-0 flex flex-col"><ScrollArea className="flex-1"><div className="p-6 pb-40"><CheckoutHub {...checkoutHubProps} /></div></ScrollArea></div>
            </div>
          ) : (
            <div className="flex flex-col items-center py-8 gap-8 h-full">
              <button onClick={() => setIsCartCollapsed(false)} className="h-12 w-12 rounded-2xl bg-primary/5 text-primary hover:bg-primary/10 shadow-sm flex items-center justify-center"><ChevronLeft className="h-6 w-6" /></button>
              <div className="flex flex-col items-center gap-1 [writing-mode:vertical-lr] rotate-180"><span className="font-black uppercase tracking-[0.3em] text-sm text-slate-900 opacity-40">Current Sale</span><span className="font-black text-primary text-xl mt-6 tracking-tighter">${totalCalc.toFixed(2)}</span></div>
              <div className="mt-auto pb-8"><Badge className="rounded-full h-8 w-8 flex items-center justify-center p-0 font-black bg-primary text-white border-none shadow-lg animate-in zoom-in duration-300">{retailItems.length + selectedAppointmentIds.size}</Badge></div>
            </div>
          )}
        </aside>
      </div>

      {isMobile && (
        <div className="fixed bottom-0 left-0 right-0 p-4 bg-background/80 border-t backdrop-blur-xl lg:hidden z-40">
          <Sheet open={isCartSheetOpen} onOpenChange={setIsCartSheetOpen}>
            <SheetTrigger asChild><Button className="w-full h-14 rounded-2xl text-lg font-black uppercase tracking-tight shadow-2xl shadow-primary/30">View Cart (${totalCalc.toFixed(2)})</Button></SheetTrigger>
            <SheetContent side="bottom" className="h-[95dvh] p-0 flex flex-col border-none rounded-t-[3rem] bg-background">
              <SheetHeader className="p-8 pb-4 border-b bg-muted/5 flex-shrink-0"><SheetTitle className="text-2xl font-black uppercase tracking-tighter">Current Sale</SheetTitle></SheetHeader>
              <div className="flex-1 overflow-y-auto"><div className="p-6 pb-24"><CheckoutHub {...checkoutHubProps} /></div></div>
            </SheetContent>
          </Sheet>
        </div>
      )}

      <AnimatePresence>
        {newWalkInAlert && (
          <motion.div initial={{ opacity: 0, y: 60, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 20, scale: 0.95 }} className="fixed bottom-24 lg:bottom-6 left-1/2 -translate-x-1/2 z-50 bg-primary text-primary-foreground px-6 py-4 rounded-2xl shadow-2xl shadow-primary/30 flex items-center gap-3 border border-primary/20 whitespace-nowrap">
            <div className="w-2 h-2 rounded-full bg-white animate-pulse" />
            <p className="font-black uppercase tracking-widest text-xs">{newWalkInAlert}</p>
          </motion.div>
        )}
      </AnimatePresence>

      <RecoveryOverrideDialog open={isRecoveryOverrideOpen} onOpenChange={setIsRecoveryOverrideOpen} staff={staff || []} onConfirm={(authorizer: any, reason: string) => { setIsRecoveryOverrideOpen(false); toast({ title: "Override Authorized", description: `Approved by ${authorizer.name}. Proceed with adjustment.` }); }} />
      <AddClientDialog open={isAddClientOpen} onOpenChange={setIsAddClientOpen} clients={clients || []} onSave={() => {}} />
      <AppointmentDetailsSheet open={isDetailsOpen} onOpenChange={setIsDetailsOpen} appointment={selectedAppointment} client={clients?.find(c => c.id === selectedAppointment?.clientId) || null} service={services?.find(s => s.id === selectedAppointment?.serviceId) || null} tmhr={selectedTenant?.tmhr || 50} transactions={transactions || []} onStartService={handleStartService} onFinishService={(apt: any) => { setAppointmentToReview(apt); setIsTechnicianReviewOpen(true); }} onEdit={() => {}} onDelete={(id: string) => deleteDocumentNonBlocking(doc(firestore!, 'tenants', tenantId!, 'appointments', id))} onCancel={handleCancelAction} onReschedule={() => {}} onRebook={() => {}} onBookNewForClient={() => {}} onPrintTicket={() => {}} onOverride={() => setIsOverrideOpen(true)} onWaiveFee={() => {}} />

      {selectedAppointment && (
        <CancelAppointmentDialog
          open={isCancelDialogOpen}
          onOpenChange={setIsCancelDialogOpen}
          appointment={selectedAppointment}
          tenant={selectedTenant}
          onConfirm={handleCancellationConfirm}
        />
      )}

      <OverrideCancellationDialog open={isOverrideOpen} onOpenChange={setIsOverrideOpen} staff={staff || []} onConfirm={async (sid: string, res: string) => { updateDocumentNonBlocking(doc(firestore!, 'tenants', tenantId!, 'appointments', selectedAppointment!.id), { status: 'confirmed', checkInStatus: 'pending', overrideReason: res, overriddenBy: sid }); setIsOverrideOpen(false); setIsDetailsOpen(false); }} />
      {appointmentToReview && <TechnicianReviewDialog open={isTechnicianReviewOpen} onOpenChange={setIsTechnicianReviewOpen} appointmentData={{ appointment: appointmentToReview, client: (clients || []).find(c => c.id === appointmentToReview.clientId), service: (services || []).find(s => s.id === appointmentToReview.serviceId) }} staff={staff || []} onSendToFrontDesk={async (id: string, state: any) => { if (!firestore || !tenantId) return; const apt = (appointmentsFromInventory || []).find(a => a.id === id); const batch = writeBatch(firestore); batch.update(doc(firestore, `tenants/${tenantId}/appointments`, id), sanitizeForFirestore({ status: 'ready_for_checkout', checkoutState: state, actualEndTime: new Date().toISOString() })); if (apt?.staffId) batch.update(doc(firestore, 'tenants', tenantId, 'staff', apt.staffId), { status: 'available', lastWalkInCompletedAt: new Date().toISOString() }); await batch.commit(); setIsTechnicianReviewOpen(false); }} />}
      <TillManagement open={isTillManagementOpen} onOpenChange={setIsTillManagementOpen} activeTill={activeTill} staff={staff || []} onOpenTill={handleOpenTill} onCloseTill={handleCloseTill} requireTillWitness={selectedTenant?.requireTillWitness !== false} />
      <CheckInConfirmationDialog
        open={!!pendingCheckInItem}
        onOpenChange={() => setPendingCheckInItem(null)}
        item={pendingCheckInItem}
        services={services || []}
        tenant={selectedTenant}
        onConfirm={handleResolveCheckInConfirmation}
        client={clients?.find(c => c.id === (pendingCheckInItem?.clientId)) || null}
        consentForms={(services || []).flatMap((s: any) => s.requiredFormIds || []).length > 0 ? (selectedTenant as any)?.consentForms || [] : []}
        tenantId={tenantId}
        firestore={firestore}
        appointments={appointmentsFromInventory || []}
        onPrintTicket={(currentState) => {
          const item = pendingCheckInItem;
          if (!item) return;
          const client = clients?.find(c => c.id === item.clientId);
          // Use confirmed serviceId from dialog (may differ from original booking)
          const resolvedServiceId = currentState?.serviceId || item.serviceId || item.serviceIds?.[0];
          const service = services?.find(s => s.id === resolvedServiceId);
          const resolvedAddOnIds = currentState?.addOnIds || item.addOnIds || [];
          const addOnServices = resolvedAddOnIds.map((aid: string) => services?.find(s => s.id === aid)).filter(Boolean);
          const staffMember = staff?.find(s => s.id === item.staffId);
          const station = item.stationName || ((item.requiredResourceIds || [])[0]
            ? (resources || []).find((r: any) => r.id === item.requiredResourceIds[0])?.name
            : undefined);
          if (client && service) {
            // Merge arrival notes from the dialog into the appointment object
            const enrichedItem = currentState?.notes
              ? { ...item, notes: currentState.notes, addOnIds: resolvedAddOnIds }
              : { ...item, addOnIds: resolvedAddOnIds };
            setTicketToPrint({
              business: { name: selectedTenant?.name || 'Studio', phone: selectedTenant?.twilioPhoneNumber || '' },
              client, service,
              appointment: enrichedItem,
              addOnServices,
              staffName: staffMember?.name,
              previousFormula: getPreviousFormula(client.id, service.id),
              visitCount: getVisitCount(client.id),
              stationName: station,
            });
            setIsPrintDialogOpen(true);
          }
        }}
      />

      <IdentityMatchDialog open={!!pendingIdentityMatch} onOpenChange={() => setPendingIdentityMatch(null)} walkIn={pendingIdentityMatch} matchedClient={pendingIdentityMatch?.matchedClient}
        onLinkSession={async (matchedClient: any) => { if (!firestore || !tenantId || !pendingIdentityMatch) return; if (pendingIdentityMatch.type !== 'walk-in') { toast({ title: 'Cannot link', description: 'Identity matching only applies to walk-in guests.' }); setPendingIdentityMatch(null); return; } updateDocumentNonBlocking(doc(firestore, `tenants/${tenantId}/walkIns`, pendingIdentityMatch.id), { clientId: matchedClient.id, customerName: matchedClient.name }); toast({ title: "Session Linked", description: `Today's visit linked to ${matchedClient.name}.` }); setPendingIdentityMatch(null); }}
        onMerge={async (matchedClient: any) => { if (!firestore || !tenantId || !pendingIdentityMatch) return; const walkInPhone = pendingIdentityMatch.customerPhone || pendingIdentityMatch.phone || ''; const walkInEmail = pendingIdentityMatch.customerEmail || pendingIdentityMatch.email || ''; updateDocumentNonBlocking(doc(firestore, `tenants/${tenantId}/walkIns`, pendingIdentityMatch.id), { clientId: matchedClient.id, customerName: matchedClient.name }); const clientUpdates: any = {}; if (walkInPhone && walkInPhone !== matchedClient.phone) clientUpdates.phone = walkInPhone; if (walkInEmail && walkInEmail !== matchedClient.email) clientUpdates.email = walkInEmail; if (Object.keys(clientUpdates).length > 0) updateDocumentNonBlocking(doc(firestore, `tenants/${tenantId}/clients`, matchedClient.id), clientUpdates); toast({ title: "Profile Merged", description: `${matchedClient.name}'s profile updated and session linked.` }); setPendingIdentityMatch(null); }}
        onKeepSeparate={() => { toast({ title: "Kept Separate", description: "Walk-in will be treated as a new guest." }); setPendingIdentityMatch(null); }}
      />

      <Dialog open={isVoidDialogOpen} onOpenChange={setIsVoidDialogOpen}>
        <DialogContent className="sm:max-w-lg rounded-[2rem] border-4 shadow-2xl">
          <DialogHeader className="p-6 pb-0">
            <DialogTitle className="text-xl font-black uppercase tracking-tighter text-destructive flex items-center gap-2"><XCircle className="w-5 h-5" /> Void Transaction</DialogTitle>
            <DialogDescription className="text-xs font-bold uppercase tracking-widest opacity-60 mt-1">Select today's transaction to void. Manager authorization required.</DialogDescription>
          </DialogHeader>
          <div className="p-6 space-y-4 max-h-[60vh] overflow-y-auto">
            {(transactions || []).filter(t => isToday(safeDate(t.date)) && !t.voided && t.type === 'income').sort((a, b) => safeDate(b.date).getTime() - safeDate(a.date).getTime()).map(tx => (
              <button key={tx.id} onClick={() => setVoidTransactionId(voidTransactionId === tx.id ? null : tx.id)} className={cn("w-full flex items-center justify-between p-4 rounded-2xl border-2 transition-all text-left", voidTransactionId === tx.id ? "border-destructive bg-destructive/5" : "border-border hover:border-destructive/30")}>
                <div><p className="text-[11px] font-black uppercase tracking-tight text-slate-900">{tx.description}</p><p className="text-[9px] font-bold text-muted-foreground uppercase mt-0.5">{format(safeDate(tx.date), 'h:mm a')} · {tx.paymentMethod}</p></div>
                <p className={cn("font-black text-lg", voidTransactionId === tx.id ? "text-destructive" : "text-slate-900")}>${safeNumber(tx.amount).toFixed(2)}</p>
              </button>
            ))}
            {voidTransactionId && <VoidAuthForm onConfirm={(pin, reason) => handleVoidTransaction(voidTransactionId, pin, reason)} onCancel={() => setVoidTransactionId(null)} />}
          </div>
        </DialogContent>
      </Dialog>

      {/* ── QUICK BOOK SHEET — now uses upgraded QuickBookForm ───────────────── */}
      <Sheet open={isQuickBookOpen} onOpenChange={setIsQuickBookOpen}>
        <SheetContent side="right" className="w-full sm:max-w-xl flex flex-col p-0 overflow-hidden">
          <SheetHeader className="p-6 border-b bg-muted/5 flex-shrink-0">
            <SheetTitle className="text-xl font-black uppercase tracking-tighter flex items-center gap-2"><BookOpen className="w-5 h-5 text-primary" /> Quick Book — Call-In</SheetTitle>
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground opacity-60 mt-1">Book an appointment directly from the POS for walk-in or call-in guests.</p>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {/* FIX: previously omitted currentStaffId, packages, memberships, and
                discounts — all four already exist in this component's own scope
                (useInventory() already destructures memberships/packages/discounts,
                and currentUser is right there from useFirebase()), so every
                package/membership nudge and auto-listed-discount feature built into
                QuickBookForm was silently inert: the data simply never arrived. */}
            <QuickBookForm
              clients={clients || []}
              services={services || []}
              staff={staff || []}
              tenantId={tenantId || ''}
              tenant={selectedTenant}
              firestore={firestore}
              appointments={appointmentsFromInventory || []}
              currentStaffId={currentUser?.uid}
              packages={packages || []}
              memberships={memberships || []}
              discounts={discounts || []}
              onSuccess={() => { setIsQuickBookOpen(false); toast({ title: "Appointment Booked" }); }}
              onCancel={() => setIsQuickBookOpen(false)}
            />
          </div>
        </SheetContent>
      </Sheet>

      <Dialog open={!!pendingRefund} onOpenChange={(o) => { if (!o) setPendingRefund(null); }}>
        <DialogContent className="sm:max-w-md rounded-[2rem] border-4 shadow-2xl">
          <DialogHeader className="p-6 pb-0">
            <DialogTitle className="text-xl font-black uppercase tracking-tighter flex items-center gap-2"><Wallet className="w-5 h-5 text-primary" /> Refund Deposit?</DialogTitle>
            <DialogDescription className="text-xs font-bold uppercase tracking-widest opacity-60 mt-1">{pendingRefund?.reason}</DialogDescription>
          </DialogHeader>
          <div className="p-6 space-y-5">
            <p className="text-sm font-medium text-slate-600 leading-relaxed">Return <strong className="text-slate-900">${safeNumber(pendingRefund?.amount).toFixed(2)}</strong> to {pendingRefund?.clientName}? This sends the money back through Stripe and can't be undone. Skip to keep it as a credit toward their next visit instead.</p>
            <div className="flex gap-3">
              <Button onClick={() => setPendingRefund(null)} variant="outline" className="flex-1 h-12 rounded-2xl font-black uppercase text-[10px] tracking-widest border-2">Skip · keep as credit</Button>
              <Button onClick={handleConfirmRefund} className="flex-1 h-12 rounded-2xl font-black uppercase text-[10px] tracking-widest shadow-xl shadow-primary/20">Refund ${safeNumber(pendingRefund?.amount).toFixed(2)}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── CAMERA QR SCANNER ─────────────────────────────────────────────── */}
      {isCameraScanOpen && (
        <QRScanner
          onClose={() => setIsCameraScanOpen(false)}
          onScan={(raw) => {
            setIsCameraScanOpen(false);
            const code = raw.trim().toUpperCase();
            setScanQuery(code);
            resolveScanCode(code);
            setIsScanLookupOpen(true);
          }}
        />
      )}

      {/* ── SCAN / CHECK-IN LOOKUP ───────────────────────────────────────────
          Shows after camera scan resolves, or can be opened directly for
          USB barcode scanners (keyboard emulation) or manual code entry. */}
      <Dialog open={isScanLookupOpen} onOpenChange={(o) => { if (!o) { setScanQuery(''); setScanResult(null); setScanNotFound(false); } setIsScanLookupOpen(o); }}>
        <DialogContent className="sm:max-w-sm rounded-[2rem] border-4 shadow-2xl p-0 overflow-hidden">
          <DialogHeader className="p-6 pb-0">
            <DialogTitle className="text-xl font-black uppercase tracking-tighter flex items-center gap-2">
              <QrCode className="w-5 h-5 text-emerald-600" /> Scan or Enter Code
            </DialogTitle>
            <DialogDescription className="text-[10px] font-bold uppercase tracking-widest opacity-60 mt-1">
              8-character code from the printed ticket or confirmation screen. Barcode scanner supported.
            </DialogDescription>
          </DialogHeader>
          <div className="p-6 space-y-4">
            <Input
              ref={scanInputRef}
              value={scanQuery}
              onChange={e => handleScanInput(e.target.value.toUpperCase())}
              onKeyDown={e => { if (e.key === 'Enter') resolveScanCode(scanQuery); }}
              placeholder="e.g. 7QX2K9LM"
              className={cn(
                'h-14 text-center text-2xl font-black font-mono tracking-[0.3em] rounded-2xl border-4 uppercase',
                scanResult ? 'border-emerald-400 bg-emerald-50' : scanNotFound ? 'border-red-300 bg-red-50' : 'border-slate-200',
              )}
              maxLength={21}
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
            />
            {scanResult && (() => {
              const c = clients?.find((cl: any) => cl.id === scanResult.clientId);
              const svc = services?.find((s: any) => s.id === scanResult.serviceId);
              const isArrived = scanResult.checkInStatus && !['pending','confirmed'].includes(scanResult.checkInStatus);
              return (
                <div className="rounded-2xl border-2 border-emerald-200 bg-emerald-50 p-4 space-y-1.5">
                  <p className="text-[10px] font-black uppercase text-emerald-700 tracking-widest">Match found</p>
                  <p className="text-sm font-black text-slate-900">{c?.name || scanResult.clientName || 'Unknown client'}</p>
                  <p className="text-xs text-slate-500">{svc?.name || 'Service'}</p>
                  <p className="text-[10px] text-slate-400">{scanResult.startTime ? format(new Date(scanResult.startTime), 'EEE MMM d · h:mm a') : ''}</p>
                  {isArrived && <Badge className="bg-blue-100 text-blue-700 border-none text-[9px]">Already checked in — opens full record</Badge>}
                  {!isArrived && <Badge className="bg-emerald-100 text-emerald-700 border-none text-[9px]">Not yet arrived — opens check-in</Badge>}
                </div>
              );
            })()}
            {scanNotFound && (
              <div className="rounded-2xl border-2 border-red-200 bg-red-50 p-4 flex items-center gap-3">
                <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" />
                <div>
                  <p className="text-[10px] font-black uppercase text-red-700">No appointment found</p>
                  <p className="text-[10px] text-red-500">Check the code and try again, or search by name in the queue.</p>
                </div>
              </div>
            )}
            <div className="flex gap-3">
              <Button variant="ghost" onClick={() => setIsScanLookupOpen(false)} className="flex-1 h-12 rounded-xl font-black uppercase text-[10px]">Cancel</Button>
              <Button
                onClick={handleScanConfirm}
                disabled={!scanResult}
                className="flex-[2] h-12 rounded-xl font-black uppercase text-[10px] shadow-lg shadow-emerald-500/20 bg-emerald-600 hover:bg-emerald-700 text-white"
              >
                {scanResult ? 'Open Appointment' : 'Scan or type code above'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={isPrintDialogOpen} onOpenChange={setIsPrintDialogOpen}>
        <DialogContent className="max-w-sm rounded-[2rem] border-2 shadow-3xl p-0 overflow-hidden text-center">
          <DialogHeader className="p-6 bg-muted/5 border-b"><DialogTitle className="text-xl font-bold uppercase tracking-tight text-center text-slate-900 leading-none">Ticket Issued</DialogTitle></DialogHeader>
          <div className="flex justify-center p-8 bg-white text-center">{ticketToPrint && <PrintTicket data={ticketToPrint} />}</div>
          <DialogFooter className="p-6 border-t bg-muted/5">
            <Button
              className="w-full h-12 rounded-xl text-lg font-bold uppercase tracking-widest shadow-xl shadow-primary/20"
              onClick={() => {
                const el = document.getElementById('ticket-area-content');
                const html = el?.innerHTML || '';
                if (html) {
                  printTicketInNewWindow(
                    `<div id="ticket-area-content" style="font-family:-apple-system,sans-serif;max-width:480px;margin:0 auto;">${html}</div>`,
                    selectedTenant?.name || 'Studio',
                  );
                } else {
                  window.print();
                }
                setIsPrintDialogOpen(false);
              }}
            >
              Authorize Print
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function POSPageWrapper() {
  return (
    <Suspense fallback={<div className="flex h-[100dvh] w-full flex-col items-center justify-center gap-4 bg-background"><Loader className="h-10 w-10 animate-spin text-primary" /><p className="text-sm font-black uppercase tracking-[0.2em] text-muted-foreground animate-pulse">Initializing Terminal...</p></div>}>
      <POSPage />
    </Suspense>
  );
}/Suspense>
  );
}
