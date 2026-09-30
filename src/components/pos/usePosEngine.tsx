'use client';
// src/components/pos/usePosEngine.tsx
//
// THE POS ENGINE — every piece of POS state and every action (start service,
// checkout, assign, cancel, till, void, scan …), moved here UNCHANGED from
// src/app/(app)/pos/page.tsx so that more than one POS layout can run on the
// exact same behaviour. The classic POS page reads everything from here; the
// new POS will too. Do not fork logic into a layout — add it here.


import { openVisit } from '@/lib/visit-client';
import { identifyPosScan, onHand } from '@/lib/pos-scan';
import { momentsFor, bestMomentReward, prebookMoment } from '@/lib/moments';
import { groupDiscountFor, groupDiscountAmount } from '@/lib/team-discount';
import { ToastAction } from '@/components/ui/toast';
import { staffAuthHeader } from '@/lib/staff-fetch';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import React, { useState, useEffect, useMemo, useCallback, Suspense, useRef } from 'react';
import { useInventory } from '@/context/InventoryContext';
import { type Appointment, type Service, type Client, type WalkIn, type Staff, getServicePrice, type AppointmentCheckoutState, type Redemption, type TillSession, type Membership, type Package } from '@/lib/data';
import { RetailCatalog } from '@/components/pos/RetailCatalog';
import { CheckoutHub } from '@/components/pos/CheckoutHub';
import { WalkInQueue } from '@/components/pos/WalkInQueue';
import { DeskAvailabilityPanel } from '@/components/pos/DeskAvailabilityPanel';
import { GuestsTodayPanel } from '@/components/pos/GuestsTodayPanel';
import { TeamStatus } from '@/components/pos/TeamStatus';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { useFirebase, useCollection, useMemoFirebase, addDocumentNonBlocking, updateDocumentNonBlocking, setDocumentNonBlocking, deleteDocumentNonBlocking } from '@/firebase';
import { collection, doc, writeBatch, increment, arrayUnion, getDocs, query, where, deleteField, limit } from 'firebase/firestore';
import { offerProblem, offerLine, offerAmount, walletStatus } from '@/lib/offers';
import { useTenant } from '@/context/TenantContext';
import { useToast } from '@/hooks/use-toast';
import { nanoid } from 'nanoid';
import { differenceInMinutes, parseISO, addMinutes, isToday, isSameDay, startOfDay, endOfDay, format, subMinutes } from 'date-fns';
import { AppHeader } from '@/components/shared/AppHeader';
import { AddClientDialog, type ClientFormData } from '@/components/clients/AddClientDialog';
import { useIsMobile } from '@/hooks/use-mobile';
import { useCancellationConfirm } from '@/hooks/useCancellationConfirm';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Clock, Users, DollarSign, QrCode, Loader, Play, XCircle, Fingerprint, UserPlus, Sparkles, ChevronRight, ChevronLeft, ShoppingCart, Square, Wallet, AlertTriangle, MapPin, ShieldCheck, ArrowRight, Info, CheckCircle2, Ban, ShieldAlert, Landmark, Smartphone, Cake, Printer, Trash2, Lock, Calendar, BookOpen, Copy, Link2, Armchair } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { cn, safeNumber } from '@/lib/utils';
import { buildEntry } from '@/lib/stock-ledger';
// parseScan / codeVariants are what make a scanned ticket resolve at all: they
// keep a mixed-case check-in token intact, pull the token out of a scanned
// check-in URL, and hand back every spelling of a short code worth trying,
// because Firestore equality is case-sensitive.
import { parseScan, codeVariants } from '@/lib/scan-codes';
import { type Transaction } from '@/lib/financial-data';
import { posTaxAmount, posTaxLabel } from '@/lib/pos-tax';
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
export function printTicketInNewWindow(ticketHtml: string, studioName: string) {
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


export const sanitizeForFirestore = (obj: any): any => {
  if (obj === null || typeof obj !== 'object') return obj;
  if (obj._methodName !== undefined || (obj.constructor && obj.constructor.name === 'FieldValue')) return obj;
  if (typeof obj.isEqual === 'function' && typeof obj._methodName !== undefined) return obj;
  if (Array.isArray(obj)) return obj.map(sanitizeForFirestore);
  return Object.fromEntries(
    Object.entries(obj).filter(([_, v]) => v !== undefined).map(([k, v]) => [k, sanitizeForFirestore(v)])
  );
};

export const safeDate = (val: any): Date => {
  if (!val) return new Date();
  if (val instanceof Date) return val;
  if (typeof val === 'string') return parseISO(val);
  if (typeof val?.toDate === 'function') return val.toDate();
  return new Date(val);
};

export const computeServiceCost = (service: any, apt: any, staffMember: any, inventory: any[], tmhr: number): { overhead: number; materials: number; labor: number; total: number } => {
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

export const KpiCard = ({ title, value, icon, description, iconBgColor }: { title: string; value: string; icon: React.ReactNode, description: string, iconBgColor: string }) => (
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

export const RecoveryOverrideDialog = ({ open, onOpenChange, staff, onConfirm, tenantId }: any) => {
  const [pin, setPin] = useState('');
  const [reason, setReason] = useState('');
  const { toast } = useToast();
  const pinInputRef = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => { if (open) { setTimeout(() => pinInputRef.current?.focus(), 150); } else { setPin(''); setReason(''); } }, [open]);
  const handleConfirm = async () => {
    // Checked on the server (PINs are never on this device).
    const { approveWithPin } = await import('@/lib/approve-client');
    const r = await approveWithPin(String(tenantId || ''), pin, { kind: 'recovery', reason: reason || 'Service recovery override', requireReason: false });
    if (!r.ok || !r.approver) { toast({ variant: 'destructive', title: 'Not approved', description: r.error || 'Manager PIN not recognized.' }); return; }
    const authorizedStaff: any = { ...r.approver, approvalToken: r.token };
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
            <input ref={pinInputRef} aria-label="Manager PIN, four digits" type="number" inputMode="numeric" pattern="[0-9]*" placeholder="0000" maxLength={4} value={pin} onChange={e => setPin(e.target.value.slice(0, 4).replace(/\D/g, ''))} style={{ width: '100%', textAlign: 'center', fontSize: '2rem', fontWeight: 900, height: '5rem', letterSpacing: '0.4em', backgroundColor: '#f8fafc', border: '4px solid #e2e8f0', borderRadius: '1.5rem', outline: 'none', padding: '0 1rem' }} />
          </div>
          <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <label style={{ fontSize: '0.6rem', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#94a3b8' }}>Override Reason</label>
            <textarea aria-label="Override reason" value={reason} onChange={e => setReason(e.target.value)} placeholder="Detail the justification..." rows={3} style={{ width: '100%', borderRadius: '1rem', border: '2px solid #e2e8f0', padding: '0.75rem', fontSize: '0.875rem', fontFamily: 'inherit', resize: 'none', outline: 'none', boxSizing: 'border-box' }} />
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

export const IdentityMatchDialog = ({ open, onOpenChange, walkIn, matchedClient, onLinkSession, onMerge, onKeepSeparate }: any) => {
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
          <Input aria-label="Manager PIN, four digits" type="password" inputMode="numeric" maxLength={4} value={pin} onChange={e => setPin(e.target.value.replace(/\D/g,'').slice(0,4))} placeholder="••••" className="h-10 rounded-xl text-center font-black text-lg tracking-widest border-2" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Reason</Label>
          <Input aria-label="Reason for voiding" value={reason} onChange={e => setReason(e.target.value)} placeholder="Describe void reason" className="h-10 rounded-xl border-2" />
        </div>
      </div>
      <div className="flex gap-2">
        <Button onClick={() => onConfirm(pin, reason)} disabled={pin.length < 4 || !reason.trim()} variant="destructive" className="flex-1 h-10 rounded-xl font-black uppercase text-[10px] tracking-widest">Authorize Void</Button>
        <Button onClick={onCancel} variant="ghost" className="flex-1 h-10 rounded-xl font-black uppercase text-[10px] tracking-widest">Cancel</Button>
      </div>
    </div>
  );
}

export function usePosEngine() {
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
  // The sheet shows the LIVE row, so an Accept/Decline (or any change) shows at once.
  const liveSelectedAppointment = useMemo(() => (selectedAppointment ? ((appointmentsFromInventory || []).find((a: any) => a.id === selectedAppointment.id) || selectedAppointment) : null), [selectedAppointment, appointmentsFromInventory]);
  const [appointmentToReview, setAppointmentToReview] = useState<Appointment | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [assignmentMode, setAssignmentMode] = useState<'fair_play' | 'ordered_list'>('ordered_list');
  const [pendingCheckInItem, setPendingCheckInItem] = useState<any | null>(null);
  const [ticketToPrint, setTicketToPrint] = useState<any | null>(null);
  const [isPrintDialogOpen, setIsPrintDialogOpen] = useState(false);
  const [appliedDiscountCodes, setAppliedDiscountCodes] = useState<string[]>([]);
  const [appliedAdjustments, setAppliedAdjustments] = useState<Set<string>>(new Set());
  // An owed balance is ADDED at checkout, not left for staff to remember: when a client comes to the till,
  // their unpaid fees start ticked (staff can untick). Once per client, so an untick sticks.
  const preTickedFor = useRef<Set<string>>(new Set());
  useEffect(() => {
    const id = (selectedClientId as any) || null;
    if (!id || preTickedFor.current.has(id)) return;
    const c: any = (clients || []).find((x: any) => x.id === id);
    const ids: string[] = (c?.unpaidFees || []).map((f: any) => f?.feeId).filter(Boolean);
    preTickedFor.current.add(id);
    if (ids.length) setAppliedAdjustments((prev) => new Set([...Array.from(prev), ...ids]));
  }, [selectedClientId, clients]); // eslint-disable-line react-hooks/exhaustive-deps
  const [redeemedOffer, setRedeemedOffer] = useState<{ type: 'membership' | 'package'; id: string; itemId?: string } | null>(null);
  const [waivedAppointmentFees, setWaivedAppointmentFees] = useState<Map<string, { authorizerId: string; reason: string }>>(new Map());
  const [isRecoveryOverrideOpen, setIsRecoveryOverrideOpen] = useState(false);
  const [pendingIdentityMatch, setPendingIdentityMatch] = useState<any | null>(null);
  const [voidTransactionId, setVoidTransactionId] = useState<string | null>(null);
  const [isVoidDialogOpen, setIsVoidDialogOpen] = useState(false);
  const [isQuickBookOpen, setIsQuickBookOpen] = useState(false);
  // Layout — Floor Ops (Team/Queue/Waitlist) vs Retail & Add-ons, so staff
  // aren't scrolling past the whole queue every time they need retail, and
  // vice versa. Persisted only for the session (not saved), defaults to
  // Floor since that's the higher-frequency screen.
  const [activeFloorTab, setActiveFloorTab] = useState<'floor' | 'retail' | 'waitlist' | 'spaces'>('floor');
  // Notifications about day guests deep-link here with ?tab=spaces.
  useEffect(() => {
    try { if (new URLSearchParams(window.location.search).get('tab') === 'spaces') setActiveFloorTab('spaces'); } catch { /* ssr */ }
  }, []);
  const [isScanLookupOpen, setIsScanLookupOpen] = useState(false);
  const [isCameraScanOpen, setIsCameraScanOpen] = useState(false);
  const [scanQuery, setScanQuery] = useState('');
  const [scanResult, setScanResult] = useState<any | null>(null);
  const [scanNotFound, setScanNotFound] = useState(false);
  const [isScanResolving, setIsScanResolving] = useState(false);
  // Which surface triggered the scanner — routes the result differently:
  // 'checkin'/'checkout' both resolve against appointments and open the
  // lookup dialog; 'retail' resolves against inventory and drops straight
  // into the cart with no dialog at all.
  const [scanMode, setScanMode] = useState<'checkin' | 'checkout' | 'retail'>('checkin');
  const scanInputRef = React.useRef<HTMLInputElement>(null);
  const [pendingRefund, setPendingRefund] = useState<any | null>(null);
  const [storeCreditApplied, setStoreCreditApplied] = useState(0);
  const [newWalkInAlert, setNewWalkInAlert] = useState<string | null>(null);
  const prevWalkInCountRef = useRef<number>(0);

  // ── The waiting list ───────────────────────────────────────────────────────
  // tenants/{id}/waitlist — the notify-me list, the one /api/waitlist already
  // writes when the kiosk finds nobody free, and the one the planner's
  // WaitlistSheet already reads.
  //
  // useWaitlist used to be pointed at `walkIns` instead, with its own header
  // calling that a feature ("No new collection needed"). It is not a feature:
  // walkIns is the live queue of people physically in the studio, and the two
  // lists then shared the status word `notified`. A walk-in called to a chair
  // was picked up as a waitlist entry and rendered a SECOND time in the panel
  // under the floor board; a waitlist client offered a Thursday slot was
  // rendered ON the floor board as though she were standing in the lobby.
  // Separate lists, separate collections.
  const { data: waitlistRaw } = useCollection<any>(useMemoFirebase(
    () => (!firestore || !tenantId) ? null : collection(firestore, 'tenants', tenantId, 'waitlist'),
    [firestore, tenantId],
  ));
  const waitlistEntries = useMemo(() => waitlistRaw || [], [waitlistRaw]);

  // ── Waitlist hook ──────────────────────────────────────────────────────────
  // Auto-assign walk-ins that arrived with a pre-matched provider.
  //
  // The kiosk shows the guest "Maya is free now" and lets them confirm.
  // The route records `staffId` and `readyNow: true` on the row, then
  // creates it as `waiting` (never `notified`). Until now nothing in the
  // POS read either field — the desk still had to press Assign Session or
  // AUTO-TURN manually, and AUTO-TURN would pick whoever was at the front
  // of the rotation, ignoring the specific provider the guest already
  // chose on screen. This effect closes that gap.
  //
  // Guarded by a ref so each row is only auto-assigned once per session,
  // and only when every dependency is ready — a row arriving before the
  // staff list loads simply waits for the next walkIns change.
  const waitlist = useWaitlist({
    tenantId,
    firestore,
    waitlist: waitlistEntries,
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

        // ── WHY THIS FALLBACK EXISTS ───────────────────────────────────────────
        // This used to end in .filter(a => !!(a.client && a.service)) — any
        // appointment whose client or service record could not be resolved was
        // DROPPED from the checkout queue entirely.
        //
        // That is a hole you lose money through. A walk-in's mirror appointment
        // is written with clientId: walkIn.clientId || walkIn.id, so a guest who
        // has no client record yet gets a clientId that matches no document.
        // clients.find(...) returns undefined, the row is filtered away, and the
        // guest who is standing at your counter after the tech pressed Finished
        // simply is not in the queue. Nothing errors. There is just nobody to
        // ring up. Same story if a service was deleted from the menu after the
        // appointment was written.
        //
        // So instead of dropping her, stand in a minimal record built from what
        // the appointment itself already carries. She reaches the till, you can
        // add the correct service and price by hand, and the sale happens.
        // A placeholder service is priced at 0 on purpose: an invented price
        // would be worse than an obvious blank you have to fill in.
        const safeClient = client || ({
          id: apt.clientId || apt.id,
          name: (apt as any).clientName || 'Walk-in Guest',
          phone: (apt as any).clientPhone || '',
          email: '',
          isPlaceholder: true,
        } as any);
        const safeService = service || ({
          id: apt.serviceId || 'unlisted',
          name: (apt as any).serviceName || 'Service (add price)',
          price: 0,
          duration: 0,
          isPlaceholder: true,
        } as any);

        return { id: apt.id, appointment: apt, client: safeClient, service: safeService, addOnServices, staff: staffMember };
      });
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

  const taxPartsRef = useRef<{ services: number; products: number }>({ services: 0, products: 0 });
  const eligibleServicesRef = useRef(0);   // services + add-ons + counter services (what a team / family discount applies to)   // what's taxable (fees never are)
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
    // Taxable amounts — the same rules as lib/checkout-calc (the server): fees never (incl. the reschedule fee), only real products as products.
    const rescheduleFees = readyForCheckoutAppointments.filter(a => selectedAppointmentIds.has(a.id)).reduce((acc, d) => acc + (waivedAppointmentFees.has(d.appointment.id) ? 0 : safeNumber(d.appointment.checkoutState?.adjustments?.rescheduleFee)), 0);
    const itemSum = (t: string) => retailItems.filter((it: any) => it.type === t).reduce((acc, it: any) => acc + (safeNumber(it.price) * safeNumber(it.quantity)), 0);
    taxPartsRef.current = { services: safeNumber(servicesSub - rescheduleFees + itemSum('service')), products: safeNumber(itemSum('product')) };
    eligibleServicesRef.current = readyForCheckoutAppointments.filter(a => selectedAppointmentIds.has(a.id)).reduce((acc, d) => { const o = d.appointment.checkoutState?.serviceStaffOverrides || {}; const who = (id: string) => (staff || []).find((m: any) => m.id === (o[id] || d.appointment.staffId));
      return acc + (redeemedOffer?.itemId === d.service?.id ? 0 : safeNumber(getServicePrice(d.service, who(d.service?.id)))) + (d.appointment.addOnIds || []).reduce((x: number, id: string) => { const ad = (services || []).find((sv: any) => sv.id === id); return x + (ad && redeemedOffer?.itemId !== id ? safeNumber(getServicePrice(ad, who(id))) : 0); }, 0); }, 0) + itemSum('service');
    return safeNumber(servicesSub + retailSub + adjustmentSub);
  }, [readyForCheckoutAppointments, selectedAppointmentIds, retailItems, appliedAdjustments, clients, waivedAppointmentFees, staff, redeemedOffer]);

  // ── OFFERS at checkout ────────────────────────────────────────────────
  // (1) A booking that came with an offer (pendingDiscountCode) gets it
  //     applied as soon as the appointment is in the cart.
  // (2) The client's WALLET — offers they were sent and haven't used — is
  //     shown with an Apply button, however they booked.
  // Every code goes through the same rules as online booking (dates, usage,
  // once per client, services) — src/lib/offers.ts.
  const offerClientId = selectedClientId ?? readyForCheckoutAppointments.find((a: any) => selectedAppointmentIds.has(a.id))?.appointment?.clientId ?? null;
  const offerServiceIds = useMemo(() => readyForCheckoutAppointments.filter((a: any) => selectedAppointmentIds.has(a.id)).map((a: any) => String(a.appointment?.serviceId || '')).filter(Boolean), [readyForCheckoutAppointments, selectedAppointmentIds]);
  const [walletOffers, setWalletOffers] = useState<any[]>([]);
  useEffect(() => {
    let alive = true;
    if (!firestore || !tenantId || !offerClientId) { setWalletOffers([]); return; }
    getDocs(query(collection(firestore, `tenants/${tenantId}/clientOffers`), where('clientId', '==', String(offerClientId))))
      .then((snap) => { if (!alive) return; setWalletOffers(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })).filter((w: any) => !w.ownerRenterId && w.code && walletStatus(w) === 'available')); })
      .catch(() => { if (alive) setWalletOffers([]); });
    return () => { alive = false; };
  }, [firestore, tenantId, offerClientId]);
  const autoAppliedOfferRef = useRef<string>('');
  useEffect(() => {
    const appts = readyForCheckoutAppointments.filter((a: any) => selectedAppointmentIds.has(a.id)).map((a: any) => a.appointment);
    const code = appts.map((a: any) => a?.pendingDiscountCode).find(Boolean);
    const key = `${[...selectedAppointmentIds].sort().join(',')}|${code || ''}`;
    if (!code || autoAppliedOfferRef.current === key) return;
    autoAppliedOfferRef.current = key;
    const d: any = (discounts || []).find((x: any) => String(x.code || '').toUpperCase() === String(code).toUpperCase());
    const problem = offerProblem(d, { clientId: offerClientId, serviceIds: offerServiceIds });
    if (problem) { toast({ variant: 'destructive', title: 'Booked with an offer that can’t be used', description: `${String(code)}: ${problem}` }); return; }
    setAppliedDiscountCodes((prev) => (prev.map((c) => c.toUpperCase()).includes(String(code).toUpperCase()) ? prev : [...prev, d.code]));
    toast({ title: 'Offer applied', description: `${offerLine(d)} — they booked with it.` });
  }, [selectedAppointmentIds, readyForCheckoutAppointments, discounts]); // eslint-disable-line react-hooks/exhaustive-deps

  // A staff discount (% or $, with a reason; a manager approves over the staff limit) — never a price change.
  const [staffDiscount, setStaffDiscount] = useState<{ kind: 'pct' | 'amt'; value: number; reason: string; approvalToken?: string | null; approvedBy?: string | null } | null>(null);
  const staffDiscountValue = useMemo(() => !staffDiscount ? 0 : Math.round(Math.min(subtotalCalc, staffDiscount.kind === 'pct' ? subtotalCalc * (safeNumber(staffDiscount.value) / 100) : safeNumber(staffDiscount.value)) * 100) / 100, [staffDiscount, subtotalCalc]);
  const codeDiscountRaw = useMemo(() => safeNumber(appliedDiscountCodes.reduce((acc, code) => { const d = (discounts || []).find((dis: any) => dis.code.toUpperCase() === code.toUpperCase()); if (!d) return acc; return acc + (d.type === 'percentage' ? subtotalCalc * (d.value / 100) : d.value); }, 0)), [appliedDiscountCodes, discounts, subtotalCalc]);
  // Team / family & friends discount — the same rules as the server (lib/team-discount): automatic, can be skipped for one sale.
  const [skipGroupDiscount, setSkipGroupDiscount] = useState(false);
  const groupClient = useMemo(() => (clients || []).find((c: any) => c.id === (selectedClientId ?? readyForCheckoutAppointments.find(a => selectedAppointmentIds.has(a.id))?.appointment?.clientId)) || null, [clients, selectedClientId, readyForCheckoutAppointments, selectedAppointmentIds]);
  const groupInfo = useMemo(() => groupDiscountFor(selectedTenant, groupClient), [selectedTenant, groupClient]);
  const groupDiscountRaw = useMemo(() => (skipGroupDiscount ? 0 : groupDiscountAmount(groupInfo, { services: eligibleServicesRef.current, products: taxPartsRef.current.products })), [groupInfo, skipGroupDiscount, subtotalCalc]); // eslint-disable-line react-hooks/exhaustive-deps
  const groupWins = !!groupInfo && groupDiscountRaw > 0 && (groupInfo.stackWithCodes || groupDiscountRaw >= codeDiscountRaw);
  const groupDiscountValue = groupWins ? groupDiscountRaw : 0;
  // Moments (birthday / first visit / milestone) — the same rules as the server (lib/moments).
  const momentVisits = useMemo(() => !groupClient ? 0 : (appointmentsFromInventory || []).filter((a: any) => a.clientId === groupClient.id && a.status === 'completed' && !selectedAppointmentIds.has(a.id)).length, [groupClient, appointmentsFromInventory, selectedAppointmentIds]);
  const moments = useMemo(() => { const pre = prebookMoment((appointmentsFromInventory || []).filter((a: any) => selectedAppointmentIds.has(a.id)));
    return [...momentsFor(selectedTenant, groupClient, momentVisits, new Date(), selectedAppointmentIds.size > 0), ...(pre ? [pre] : [])]; }, [selectedTenant, groupClient, momentVisits, selectedAppointmentIds, appointmentsFromInventory]);
  const momentReward = bestMomentReward(moments);
  const codeAndGroup = (groupInfo && !groupInfo.stackWithCodes && groupWins ? 0 : codeDiscountRaw) + groupDiscountValue;
  const momentRaw = momentReward ? Math.round(eligibleServicesRef.current * momentReward.rewardPct) / 100 : 0;
  const momentDiscountValue = momentRaw > codeAndGroup ? momentRaw : 0;   // never combines — the bigger applies
  const discountValue = useMemo(() => safeNumber((momentDiscountValue ? 0 : codeAndGroup) + staffDiscountValue + momentDiscountValue), [codeAndGroup, staffDiscountValue, momentDiscountValue]);

  const membershipDiscountValue = useMemo(() => {
    if (!selectedClient || !memberships || !packages) return 0;
    const mId = selectedClient.activeMembershipId || selectedClient?.subscription?.membershipId;
    if (selectedClient?.subscription?.status && selectedClient.subscription.status !== 'active') return 0;
    let bestDiscountPct = 0; let eligibleProductIds: string[] = [];
    if (mId) { const membership = memberships.find(m => m.id === mId); if (membership?.retailDiscount) { bestDiscountPct = membership.retailDiscount; eligibleProductIds = membership.applicableProductIds || []; } }
    if (bestDiscountPct === 0) return 0;
    return retailItems.reduce((acc, item) => { const isEligible = eligibleProductIds.length === 0 || eligibleProductIds.includes(item.id); return isEligible ? acc + (item.price * item.quantity * (bestDiscountPct / 100)) : acc; }, 0);
  }, [selectedClient, memberships, packages, retailItems]);

  const taxCalc = posTaxAmount(selectedTenant, taxPartsRef.current);   // Settings → Payments → Sales tax
  const taxLabel = posTaxLabel(selectedTenant);
  const totalCalc = Math.max(0, subtotalCalc + taxCalc + tipAmount - discountValue - membershipDiscountValue - storeCreditApplied);

  const payerOptions = useMemo(() => { const clientIds = new Set<string>(); readyForCheckoutAppointments.filter(a => selectedAppointmentIds.has(a.id)).forEach(data => { if (data.client?.id) clientIds.add(data.client.id); }); return (clients || []).filter(c => clientIds.has(c.id)); }, [readyForCheckoutAppointments, selectedAppointmentIds, clients]);

  const handleSelectAppointment = useCallback((id: string) => {
    const nextIds = new Set(selectedAppointmentIds);
    if (nextIds.has(id)) { nextIds.delete(id); if (nextIds.size === 0) setSelectedClientId(null); }
    else {
      const aptData = readyForCheckoutAppointments.find(a => a.id === id);
      // Student salon: an instructor must sign the service off before it can be paid for.
      const provider = (staff || []).find((s: any) => s.id === (aptData as any)?.appointment?.staffId) as any;
      if (provider?.isStudent && !(aptData as any)?.appointment?.clinicCheckoff?.signedOff) { toast({ variant: 'destructive', title: 'Instructor check-off needed', description: `An instructor must sign off ${provider.name}’s service (Academy → Student salon) before checkout.` }); return; }
      nextIds.add(id); if (aptData?.client?.id) setSelectedClientId(aptData.client.id);
    }
    setSelectedAppointmentIds(nextIds);
  }, [readyForCheckoutAppointments, selectedAppointmentIds, staff, toast]);

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

  /**
   * "Start service" — the single most load-bearing write in the walk-in flow,
   * because the LOBBY BOARD reads its result.
   *
   * The lobby's "Ready for you now" list is every walkIns row whose status is
   * still one of waiting/notified/arrived; its "In the chair" list is every row
   * whose status is in_service/servicing. So if this handler fails to move the
   * walkIns ROW to 'servicing', the guest is shouted at forever and the in-service
   * panel stays empty. That is exactly what was happening, for two reasons:
   *
   * 1. `batch.update(doc(firestore, 'appointmentCheckIns', token), ...)` — an
   *    UPDATE against a TOP-LEVEL doc that usually does not exist. The walk-in
   *    engine writes `tenants/{t}/appointmentCheckIns/{token}` (and the legacy
   *    top-level copy) only for a seat that got a provider at kiosk time. A
   *    Firestore update against a missing document rejects the ENTIRE batch — so
   *    the walkIns write on the next line never landed either. Every write here
   *    is now `set(..., { merge: true })`, which creates-or-updates and cannot
   *    reject for that reason, and both paths are written so whichever one the
   *    guest's check-in screen is watching stays in step.
   *
   * 2. `if (!appointment) return;` — a silent no-op. A guest who is still
   *    unassigned has NO mirror appointment at all (the engine gates that write
   *    on a provider being seated), and a just-assigned one may not have streamed
   *    into the local cache yet. Pressing Start did nothing and said nothing.
   *    Now the walkIns row is found on its own, the mirror appointment is created
   *    from it if missing (so the In Service lane and checkout still work), and a
   *    genuinely unknown id says so out loud instead of swallowing the press.
   */
  // Starting well before the booked time asks first (walk-ins never do).
  const [earlyStart, setEarlyStart] = useState<{ id: string; who: string; at: string; mins: number } | null>(null);
  /** THE VISIT TICKET: record what the desk just did on the visit's timeline (and keep the client's copies in step). Best-effort. */
  const logVisit = (appointmentId: string, text: string) => { if (!tenantId) return;
    staffAuthHeader().then((h: any) => fetch('/api/visits', { method: 'POST', headers: { 'Content-Type': 'application/json', ...h }, body: JSON.stringify({ tenantId, action: 'log', appointmentId, stage: true, text, via: 'desk' }) })).catch(() => {}); };
  const handleStartService = (appointmentId: string, confirmedEarly = false) => {
    if (!firestore || !tenantId) return;
    const nowISO = new Date().toISOString();
    const now = new Date();
    const apts = appointmentsFromInventory || [];
    const rows: any[] = (walkIns as any[]) || [];

    const appointment: any =
      apts.find(a => a.id === appointmentId) ||
      apts.find(a => a.id === `apt-walkin-${appointmentId}`) ||
      null;

    // Work out the walk-in row id from whichever handle we were given.
    const bareId = String(appointmentId).startsWith('apt-walkin-')
      ? String(appointmentId).replace('apt-walkin-', '')
      : String(appointmentId);
    const row: any =
      rows.find(w => w && w.id === bareId) ||
      (appointment?.isWalkIn ? rows.find(w => w && w.id === String(appointment.id).replace('apt-walkin-', '')) : null) ||
      null;

    if (!appointment && !row) {
      toast({ variant: 'destructive', title: 'Could not start service', description: 'That ticket is no longer on this terminal. Refresh the queue and try again.' });
      return;
    }
    if (!confirmedEarly && appointment && !appointment.isWalkIn && appointment.startTime) {
      const st = safeDate(appointment.startTime); const mins = Math.round((st.getTime() - Date.now()) / 60000);
      if (mins > 10) { setEarlyStart({ id: appointmentId, who: appointment.clientName || 'This client', at: format(st, 'h:mm a'), mins }); return; }
    }

    const walkInId: string | null = row ? String(row.id) : (appointment?.isWalkIn ? String(appointment.id).replace('apt-walkin-', '') : null);
    const staffId: string | undefined = appointment?.staffId || row?.staffId || row?.assignedStaffId || undefined;
    const token: string | undefined = appointment?.checkInToken || row?.checkInToken || undefined;
    const aptId = appointment?.id || (walkInId ? `apt-walkin-${walkInId}` : null);
    if (!aptId) return;

    const batch = writeBatch(firestore);

    if (appointment) {
      batch.set(doc(firestore, 'tenants', tenantId, 'appointments', aptId), { status: 'servicing', actualStartTime: nowISO }, { merge: true });
    } else if (row) {
      // No mirror appointment exists (unassigned kiosk guest, or the mirror has
      // not reached this browser yet). Create it from the row, otherwise the POS
      // In Service lane — which filters APPOINTMENTS on status 'servicing' — and
      // the checkout queue after it would both never see this guest.
      const ids: string[] = Array.isArray(row.serviceIds) ? row.serviceIds : (row.serviceId ? [row.serviceId] : []);
      const picked = ids.map((id: string) => (services || []).find((s: Service) => s.id === id)).filter(Boolean) as Service[];
      const dur = picked.reduce((acc, s) => acc + (s.duration || 0) + (s.padBefore || 0) + (s.padAfter || 0), 0) || safeNumber(row.estimatedDuration) || 30;
      batch.set(doc(firestore, 'tenants', tenantId, 'appointments', aptId), sanitizeForFirestore({
        id: aptId,
        tenantId,
        clientId: row.clientId || row.id,
        clientName: row.clientName || row.customerName || 'Walk-in guest',
        serviceId: ids[0],
        serviceIds: ids,
        ...(staffId ? { staffId } : {}),
        status: 'servicing',
        source: 'walk-in',
        isWalkIn: true,
        startTime: now.toISOString(),
        endTime: addMinutes(now, dur).toISOString(),
        actualStartTime: nowISO,
        ...(row.checkInToken ? { checkInToken: row.checkInToken } : {}),
        ...(row.shortCode ? { shortCode: row.shortCode } : {}),
        ...(row.groupId ? { groupId: row.groupId } : {}),
      }), { merge: true });
    }

    // set/merge, not update: these two documents may legitimately not exist yet,
    // and an update against a missing doc would reject every write above.
    if (token) {
      batch.set(doc(firestore, 'tenants', tenantId, 'appointmentCheckIns', token), { status: 'servicing', tenantId, appointmentId: aptId, updatedAt: nowISO }, { merge: true });
      batch.set(doc(firestore, 'appointmentCheckIns', token), { status: 'servicing', tenantId, appointmentId: aptId, updatedAt: nowISO }, { merge: true });
    }

    if (staffId) batch.set(doc(firestore, 'tenants', tenantId, 'staff', staffId), { status: 'busy' }, { merge: true });

    // The walk-in ROW, not just the mirror appointment. staffId is stamped here
    // too: handleAssignStaff below only ever wrote `assignedStaffId`, which
    // nothing in the app reads — the staff portal, the lobby board and
    // /api/walkins all read `staffId` — so a Terminal-assigned guest showed as
    // Unassigned on every other screen and the lobby board had no provider name
    // to put next to her.
    if (walkInId && row) {
      batch.set(doc(firestore, 'tenants', tenantId, 'walkIns', walkInId), sanitizeForFirestore({
        status: 'servicing',
        serviceStartTime: nowISO,
        needsFrontDesk: false,
        ...(staffId ? { staffId, assignedStaffId: staffId } : {}),
      }), { merge: true });
    }

    batch.commit()
      .then(() => { toast({ title: 'Service Started' }); logVisit(aptId, 'Service started'); })
      .catch((e) => { console.error('[handleStartService]', e); toast({ variant: 'destructive', title: 'Could not start service', description: 'Nothing was changed. Try again in a moment.' }); });
  };

  /**
   * "Finished" — the technician review dialog's Send to Front Desk.
   *
   * Lifted out of the JSX (it was one 900-character prop) because it now has to
   * close TWO records, and getting that wrong is invisible until the next day.
   *
   * What was missing: this handler closed the mirror APPOINTMENT
   * (apt-walkin-{id} -> ready_for_checkout) and freed the provider, but never
   * wrote back to the walkIns document. Neither does checkout, which stamps
   * 'completed' on the appointment alone. So the walk-in ROW sat at 'servicing'
   * forever: yesterday's guests never cleared the floor, the lobby board kept
   * showing them in a chair, and the provider stayed on the busy list for the
   * next guest's assignment.
   *
   * Closing the row here is safe: readyForCheckoutAppointments (above) filters
   * APPOINTMENTS on status === 'ready_for_checkout' and never looks at walkIns,
   * so the guest still lands in the checkout queue exactly as before.
   *
   * The row is only touched if we can actually see it in the loaded list — a
   * batch.update against a deleted document rejects the WHOLE batch, which would
   * mean pressing Finished silently failed and the guest never reached the till.
   */
  const handleSendToFrontDesk = useCallback(async (id: string, state: any) => {
    if (!firestore || !tenantId) return;
    const apt = (appointmentsFromInventory || []).find(a => a.id === id);
    const nowISO = new Date().toISOString();
    const batch = writeBatch(firestore);
    batch.update(doc(firestore, `tenants/${tenantId}/appointments`, id),
      sanitizeForFirestore({ status: 'ready_for_checkout', checkoutState: state, actualEndTime: nowISO }));
    if (apt?.staffId) batch.update(doc(firestore, 'tenants', tenantId, 'staff', apt.staffId),
      { status: 'available', lastWalkInCompletedAt: nowISO });
    const walkInId = id.startsWith('apt-walkin-') ? id.replace('apt-walkin-', '') : null;
    if (walkInId && (walkIns || []).some((w: any) => w.id === walkInId)) {
      batch.update(doc(firestore, 'tenants', tenantId, 'walkIns', walkInId),
        sanitizeForFirestore({ status: 'completed', completedAt: nowISO, serviceEndTime: nowISO }));
    }
    await batch.commit();
    logVisit(id, 'Finished — sent to the front desk');
    setIsTechnicianReviewOpen(false);
  }, [firestore, tenantId, appointmentsFromInventory, walkIns]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleAssignStaff = useCallback((walkIn: WalkIn, staffId: string) => {
    if (!firestore || !tenantId || !services) return;
    const personServices = (walkIn.serviceIds || []).map(id => (services || []).find(s => s.id === id)).filter(Boolean) as Service[];
    const estimatedDuration = personServices.reduce((acc, s) => acc + (s.duration || 0) + (s.padBefore || 0) + (s.padAfter || 0), 0);
    const now = new Date(); const walkInEndsAt = addMinutes(now, estimatedDuration);
    const upcomingConflict = (appointmentsFromInventory || []).find(a => a.staffId === staffId && (a.status === 'confirmed' || a.status === 'deposit_pending') && safeDate(a.startTime) > now && safeDate(a.startTime) < walkInEndsAt);
    if (upcomingConflict) { const conflictTime = format(safeDate(upcomingConflict.startTime), 'h:mm a'); const conflictClient = clients?.find(c => c.id === upcomingConflict.clientId); toast({ variant: 'destructive', title: 'Scheduling Conflict', description: `This provider has ${conflictClient?.name || 'a client'} booked at ${conflictTime} — ${estimatedDuration}m service may overlap.` }); }
    const appointmentId = `apt-walkin-${walkIn.id}`;
    const w = walkIn as any;

    // ONE BATCH. These were two separate fire-and-forget writes —
    // updateDocumentNonBlocking on the walkIn row and setDocumentNonBlocking on
    // the mirror appointment — with nothing tying them together. Either could
    // land without the other, leaving a guest marked `notified` with no
    // appointment for the desk to start, or an appointment on a provider's
    // calendar for a guest still sitting in the waiting lane. handleStartService
    // in this same file already uses a batch for exactly this reason; assignment
    // was the one step that did not.
    //
    // `staffId` is the field every OTHER screen reads (staff portal walk-in
    // board, lobby board, /api/walkins). This once wrote only `assignedStaffId`,
    // which has no reader anywhere — so assigning a provider here left the guest
    // reading "Unassigned" everywhere else, and made the Called card render
    // blank. `assignedStaffId` is kept so any row already stored under it is
    // undisturbed.
    //
    // checkInToken / shortCode are carried onto the mirror. Without them, a
    // guest assigned at the desk had a printed ticket that nothing could look
    // up: the scan searches these two fields, and the row's copy of them never
    // reached the appointment the scan lands on.
    const batch = writeBatch(firestore);
    batch.set(doc(firestore, 'tenants', tenantId, 'walkIns', walkIn.id), sanitizeForFirestore({
      assignedStaffId: staffId,
      staffId,
      status: 'notified',
      notifiedTimestamp: now.toISOString(),
      notifiedAt: now.toISOString(),
    }), { merge: true });
    batch.set(doc(firestore, 'tenants', tenantId, 'appointments', appointmentId), sanitizeForFirestore({
      id: appointmentId,
      tenantId,
      clientId: walkIn.clientId || walkIn.id,
      clientName: w.clientName || w.customerName || 'Walk-in guest',
      serviceId: (walkIn.serviceIds || [])[0],
      serviceIds: walkIn.serviceIds || [],
      staffId,
      status: 'confirmed',
      source: 'walk-in',
      isWalkIn: true,
      startTime: now.toISOString(),
      endTime: addMinutes(now, estimatedDuration).toISOString(),
      ...(w.checkInToken ? { checkInToken: w.checkInToken } : {}),
      ...(w.shortCode ? { shortCode: w.shortCode } : {}),
      ...(w.groupId ? { groupId: w.groupId } : {}),
      ...((w.customerPhone || w.phone) ? { clientPhone: w.customerPhone || w.phone } : {}),
      ...((w.customerEmail || w.email) ? { clientEmail: w.customerEmail || w.email } : {}),
    }), { merge: true });

    batch.commit()
      .then(() => toast({ title: "Staff Assigned" + (upcomingConflict ? " \u26a0 Conflict detected" : "") }))
      .catch((e: any) => toast({ variant: 'destructive', title: 'Assignment failed', description: e?.message || 'Nothing was changed — the guest is still waiting.' }));
  }, [firestore, tenantId, services, appointmentsFromInventory, clients, toast]);

  // Expire held slots that were never claimed.
  //
  // When a waitlist client is offered a slot they get a hold (holdExpiresAt).
  // If they don't confirm within the window — default 15 minutes — that slot
  // sits indefinitely as 'notified' and the guest behind them waits forever.
  // The route's healStale only clears in-service rows, not held waitlist rows.
  // This sweep runs whenever walkIns updates and sends expired holds back to
  // waiting so they re-enter the queue. Belt-and-suspenders alongside the
  // route-level expiry that fires on each board poll.
  useEffect(() => {
    if (!walkIns || !firestore || !tenantId) return;
    const nowMs = Date.now();
    for (const w of walkIns) {
      const ww = w as any;
      if (ww.status !== 'notified') continue;
      if (!ww.holdExpiresAt) continue;
      const expiry = new Date(ww.holdExpiresAt).getTime();
      if (!expiry || expiry > nowMs) continue;
      // Return to waiting so they stay in the queue rather than disappearing.
      updateDocumentNonBlocking(
        doc(firestore, 'tenants', tenantId, 'walkIns', w.id),
        { status: 'waiting', holdExpiresAt: null, notifiedAt: null, notifiedTimestamp: null },
      );
      toast({ title: 'Hold expired', description: `${ww.customerName || ww.clientName || 'Guest'} did not claim their slot — returned to the queue.` });
    }
  }, [walkIns, firestore, tenantId, toast]);

  const autoAssignedIds = React.useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!walkIns || !staff || !services || !firestore || !tenantId) return;
    for (const w of walkIns) {
      const ww = w as any;
      if (ww.status !== 'waiting') continue;
      if (!ww.readyNow || !ww.staffId) continue;
      if (autoAssignedIds.current.has(w.id)) continue;
      // Confirm the provider is still on the floor before assigning.
      const provider = (staff as any[]).find(s => s.id === ww.staffId);
      if (!provider || provider.onBreak || provider.acceptingWalkIns === false) continue;
      autoAssignedIds.current.add(w.id);
      handleAssignStaff(w, ww.staffId);
    }
  }, [walkIns, staff, services, firestore, tenantId, handleAssignStaff]);


  const handleAssignNext = useCallback(() => {
    if (!firestore || !tenantId || !walkIns || !staff || !services) return;

    // ONE comparator, matching the floor board's exactly. This used to be a
    // second, independent sort, and BOTH of them mixed `queueOrder` (a small
    // counting number: 1, 2, 3) with `checkInTime` epoch milliseconds
    // (~1.75e12) inside a single expression:
    //
    //     (a.queueOrder || safeDate(a.checkInTime).getTime())
    //
    // Any row that had ever been manually reordered therefore sorted a
    // trillion places ahead of every row that had not — and because the board
    // ran its own copy of this, the board and this button could disagree about
    // who was next. That is the worst disagreement a queue can have.
    const OVERRIDE_CEILING = 1000000;
    const overrideRank = (val: any): number => {
      const n = Number(val);
      return Number.isFinite(n) && n > 0 && n < OVERRIDE_CEILING ? n : Number.MAX_SAFE_INTEGER;
    };
    const waitingQueue = [...walkIns]
      .filter(w => w.status === 'waiting')
      .sort((a, b) => {
        const oa = overrideRank((a as any).queueOrder);
        const ob = overrideRank((b as any).queueOrder);
        if (oa !== ob) return oa - ob;
        return safeDate(a.checkInTime).getTime() - safeDate(b.checkInTime).getTime();
      });
    if (waitingQueue.length === 0) return;

    const idleStaff = staff.filter((s: any) => s.active && !s.onBreak && (s.status === 'idle' || s.status === 'available' || !s.status) && s.acceptingWalkIns !== false);
    if (idleStaff.length === 0) {
      toast({ title: 'Nobody is free', description: 'Every provider is mid-service, on a break, or not taking walk-ins.' });
      return;
    }

    const now = new Date();

    // WALK the queue instead of stopping at its head. The old version read
    // waitingQueue[0] and returned outright if nobody could serve HER — so a
    // single guest needing a skill nobody on the floor had blocked every guest
    // behind her, indefinitely, and the button just did nothing when pressed.
    for (const guest of waitingQueue) {
      const g = guest as any;
      const duration = (guest.serviceIds || []).reduce((acc: number, sid: string) => {
        const svc = services.find((ser: Service) => ser.id === sid);
        return acc + (svc?.duration || 0) + (svc?.padBefore || 0) + (svc?.padAfter || 0);
      }, 0);
      const endsAt = addMinutes(now, duration);

      let qualified = idleStaff.filter((s: any) => {
        const hasSkills = (guest.serviceIds || []).every((sid: string) => {
          const svc = services.find((ser: Service) => ser.id === sid);
          return !svc?.requiredSkills?.length || svc.requiredSkills.every((skill: string) => (s.skillSet || []).includes(skill));
        });
        if (!hasSkills) return false;
        const hasConflict = (appointmentsFromInventory || []).some(a => a.staffId === s.id && (a.status === 'confirmed' || a.status === 'deposit_pending') && safeDate(a.startTime) > now && safeDate(a.startTime) < endsAt);
        return !hasConflict;
      });

      // The kiosk has recorded these two fields since v14 and nothing in the
      // application has ever read either one. A guest who chose to wait for one
      // particular provider must not be handed to somebody else by an automatic
      // turn — choosing to wait IS the decision she made. She stays in line
      // until her person is free, and the loop moves on to the next guest.
      const requestedId = g.requestedStaffId || g.preferredStaffId || null;
      const holdingOut = !!requestedId && (g.waitingForRequested === true || g.waitForPreferred === true);
      if (holdingOut) qualified = qualified.filter((s: any) => String(s.id) === String(requestedId));

      if (qualified.length === 0) continue;

      const selected = [...qualified].sort((a: any, b: any) => {
        if (assignmentMode === 'ordered_list') return (a.turnOrder || 999) - (b.turnOrder || 999);
        const aTime = a.lastWalkInCompletedAt ? safeDate(a.lastWalkInCompletedAt).getTime() : a.lastServedTimestamp ? safeDate(a.lastServedTimestamp).getTime() : 0;
        const bTime = b.lastWalkInCompletedAt ? safeDate(b.lastWalkInCompletedAt).getTime() : b.lastServedTimestamp ? safeDate(b.lastServedTimestamp).getTime() : 0;
        return aTime - bTime;
      })[0];

      // Seat the lead.
      handleAssignStaff(guest, selected.id);

      // Seat the rest of the party in the same press.
      //
      // A party of four with four free techs used to require four presses of
      // AUTO-TURN. Each press seated the lead and left the others waiting,
      // which the next press treated as separate unrelated guests and seated
      // the next lead. At a Saturday-morning rush with three groups checking
      // in at once, that is twelve presses of a button that should be one.
      //
      // The group reads: same groupId, status still 'waiting', still in the
      // rotation. `takenIds` prevents doubling up on a provider that was just
      // used. We sort the remaining pool the same way the lead selection did.
      const groupId = (guest as any).groupId;
      if (groupId) {
        const groupMembers = waitingQueue.filter(
          w => (w as any).groupId === groupId && w.id !== guest.id && w.status === 'waiting',
        );
        if (groupMembers.length > 0) {
          const takenIds = new Set<string>([selected.id]);
          let remainingPool = [...qualified.filter((s: any) => !takenIds.has(String(s.id)))];
          // Refresh to include any staff that was excluded for the lead's
          // service specifically but may be fine for a party member with a
          // different service.
          remainingPool = [...idleStaff.filter((s: any) => !takenIds.has(String(s.id)))];

          for (const member of groupMembers) {
            const m = member as any;
            const mDuration = (member.serviceIds || []).reduce((acc: number, sid: string) => {
              const svc = services.find((ser: Service) => ser.id === sid);
              return acc + (svc?.duration || 0) + (svc?.padBefore || 0) + (svc?.padAfter || 0);
            }, 0);
            const mEndsAt = addMinutes(now, mDuration);
            const mQualified = remainingPool.filter((s: any) => {
              const hasSkills = (member.serviceIds || []).every((sid: string) => {
                const svc = services.find((ser: Service) => ser.id === sid);
                return !svc?.requiredSkills?.length || svc.requiredSkills.every((skill: string) => (s.skillSet || []).includes(skill));
              });
              if (!hasSkills) return false;
              const hasConflict = (appointmentsFromInventory || []).some(a => a.staffId === s.id && (a.status === 'confirmed' || a.status === 'deposit_pending') && safeDate(a.startTime) > now && safeDate(a.startTime) < mEndsAt);
              return !hasConflict;
            });
            const mHoldingOut = !!(m.preferredStaffId && (m.waitForPreferred === true || m.waitingForRequested === true));
            const mPool = mHoldingOut ? mQualified.filter((s: any) => String(s.id) === String(m.preferredStaffId)) : mQualified;
            if (mPool.length === 0) continue;
            const mSelected = [...mPool].sort((a: any, b: any) => {
              if (assignmentMode === 'ordered_list') return (a.turnOrder || 999) - (b.turnOrder || 999);
              const aT = a.lastWalkInCompletedAt ? safeDate(a.lastWalkInCompletedAt).getTime() : 0;
              const bT = b.lastWalkInCompletedAt ? safeDate(b.lastWalkInCompletedAt).getTime() : 0;
              return aT - bT;
            })[0];
            takenIds.add(String(mSelected.id));
            remainingPool = remainingPool.filter((s: any) => !takenIds.has(String(s.id)));
            handleAssignStaff(member, mSelected.id);
          }
        }
      }
      return;
    }

    toast({ title: 'Nobody can be seated yet', description: 'Everyone waiting either needs a skill nobody free has, or is holding out for a provider who is still busy.' });
  }, [firestore, tenantId, walkIns, staff, services, assignmentMode, appointmentsFromInventory, handleAssignStaff, toast]);

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
          batch.update(docRef, sanitizeForFirestore({ checkInStatus: 'auto_cancelled', checkInStatusTimestamp: new Date().toISOString(), status: 'cancelled', lateTimeMinutes: lateMinutes, cancellationReason: cancelReason, cancellationFeeApplied: fee }));
          if (apt.checkInToken) batch.update(doc(firestore, 'appointmentCheckIns', apt.checkInToken), sanitizeForFirestore({ checkInStatus: 'auto_cancelled', status: 'cancelled', tenantId }));
          if (fee > 0 && apt.clientId) batch.update(doc(firestore, 'tenants', tenantId, 'clients', apt.clientId), { outstandingBalance: increment(fee), unpaidFees: arrayUnion(sanitizeForFirestore({ feeId: nanoid(), appointmentId: apt.id, appointmentDate: safeDate(apt.startTime).toISOString(), feeAmount: fee, reason: `Auto-Cancel: ${clash ? 'Clash' : 'Late'} (+${lateMinutes}m)` })) });
          batch.commit().then(() => toast({ title: clash ? "Clash: Auto-Cancelled" : "Late: Auto-Cancelled" })); return;
        } else if (lateMinutes > grace) {
          const fee = Number(((lateMinutes / 60) * tmhrValue + premium).toFixed(2));
          const batch = writeBatch(firestore);
          batch.update(docRef, sanitizeForFirestore({ checkInStatus: 'running_late', checkInStatusTimestamp: new Date().toISOString(), lateTimeMinutes: lateMinutes }));
          if (apt.checkInToken) batch.update(doc(firestore, 'appointmentCheckIns', apt.checkInToken), sanitizeForFirestore({ checkInStatus: 'running_late', lateTimeMinutes: lateMinutes, tenantId }));
          if (apt.clientId && fee > 0) batch.update(doc(firestore, 'tenants', tenantId, 'clients', apt.clientId), { outstandingBalance: increment(fee), unpaidFees: arrayUnion(sanitizeForFirestore({ feeId: nanoid(), appointmentId: apt.id, appointmentDate: safeDate(apt.startTime).toISOString(), feeAmount: fee, reason: `Late Penalty: +${lateMinutes}m` })) });
          batch.commit().then(() => toast({ title: "Status Updated: Fee Applied" })); return;
        }
      }
    }
    const updates: any = { checkInStatus: status, checkInStatusTimestamp: new Date().toISOString() };
    if (lateMinutes !== undefined) updates.lateTimeMinutes = lateMinutes;
    const batch = writeBatch(firestore);
    batch.set(docRef, sanitizeForFirestore(updates), { merge: true });
    const apt = !effectiveIsWalkIn ? appointmentsFromInventory?.find(a => a.id === id) : null;
    if (apt?.checkInToken) batch.set(doc(firestore, 'appointmentCheckIns', apt.checkInToken), sanitizeForFirestore({ ...updates, tenantId }), { merge: true });
    batch.commit().then(() => toast({ title: "Status Updated" }));
  };

  // Checkout is saved ON THE SERVER (/api/checkout/complete): prices, tax, fees, deposits, tips, stock, the till,
  // the receipt and memberships are all worked out and written there, together — never from this browser.
  const checkoutClientId = selectedClientId ?? readyForCheckoutAppointments.find(a => selectedAppointmentIds.has(a.id))?.appointment?.clientId ?? null;
  const buildCheckoutPayload = (paymentData?: any) => ({
    tenantId, clientId: checkoutClientId,
    appointmentIds: readyForCheckoutAppointments.filter(a => selectedAppointmentIds.has(a.id)).map(a => a.appointment.id),
    items: retailItems.map((it: any) => ({ id: it.id, type: it.type, quantity: it.quantity, price: it.price, name: it.name, reservationId: it.reservationId || null, depositForAppointmentId: it.depositForAppointmentId || null })),
    feeIds: Array.from(appliedAdjustments), discountCodes: appliedDiscountCodes, redeemedOffer: redeemedOffer || null, waivedAppointmentIds: Array.from(waivedAppointmentFees.keys()), waivers: Object.fromEntries(waivedAppointmentFees),   // who approved each waiver, and why
    // A tip chosen on the client screen together with the payment is recorded exactly (it goes to the provider(s) on the ticket).
    tipAllocations: paymentData?.tipOverride !== undefined ? {} : tipAllocations, tip: paymentData?.tipOverride !== undefined ? safeNumber(paymentData.tipOverride) : tipAmount, storeCredit: storeCreditApplied,
    skipGroupDiscount,
    staffDiscount: staffDiscount ? { kind: staffDiscount.kind, value: staffDiscount.value, reason: staffDiscount.reason, approvalToken: staffDiscount.approvalToken || null } : null,
    recovery: { amount: safeNumber(paymentData?.recoveryAmount), reason: paymentData?.recoveryReason || '', approvalToken: paymentData?.recoveryApprovalToken || recoveryApprovalRef.current || null },
    payment: { method: paymentData?.paymentMethod || 'card', amountTendered: safeNumber(paymentData?.amountTendered), stripePaymentIntentId: paymentData?.stripePaymentIntentId || null, cardSurcharge: safeNumber(paymentData?.cardSurcharge), skipLedger: paymentData?.skipLedger === true },
    tillId: paymentTab === 'cash' && activeTill ? activeTill.id : null,
    expectedTotal: paymentData?.tipOverride !== undefined ? Math.round((totalCalc - tipAmount + safeNumber(paymentData.tipOverride)) * 100) / 100 : totalCalc,
  });
  // Before any card is charged, the ticket is saved on the server as "started" — so if the sale then fails to save,
  // it can be recorded later (Needs attention → Sales not recorded) and never twice.
  const pendingIdRef = useRef<string | null>(null);
  const [splitActive, setSplitActive] = useState(false);
  const recoveryApprovalRef = useRef<string | null>(null);
  const [lastSale, setLastSale] = useState<any>(null);   // the sale just finished — shown until New sale / Done   // set by the POS recovery-override prompt (manager approval)
  const lastCheckoutRef = useRef<any>(null);
  useEffect(() => {
    if ((paymentTab !== 'card' && !splitActive) || !tenantId || !checkoutClientId || (!selectedAppointmentIds.size && !retailItems.length)) return;   // a split keeps its started ticket in step too
    const t = setTimeout(async () => {
      try { const auth = await staffAuthHeader();
        const r = await fetch('/api/checkout/complete', { method: 'POST', headers: { 'Content-Type': 'application/json', ...auth }, body: JSON.stringify({ ...buildCheckoutPayload(), action: 'prepare', pendingId: pendingIdRef.current }) }).then((x) => x.json()).catch(() => ({}));
        if (r?.pendingId) pendingIdRef.current = r.pendingId;
      } catch { /* best-effort: the sale itself still saves normally */ }
    }, 600);
    return () => clearTimeout(t);
  }, [paymentTab, splitActive, tenantId, checkoutClientId, selectedAppointmentIds, retailItems, appliedAdjustments, appliedDiscountCodes, tipAmount, totalCalc]); // eslint-disable-line react-hooks/exhaustive-deps
  // SPLIT THE BILL — the started ticket is saved at once, so each share can be recorded against it as it's paid.
  const prepareNow = useCallback(async (): Promise<string | null> => {
    if (!tenantId || !checkoutClientId) return null;
    try { const auth = await staffAuthHeader();
      const r = await fetch('/api/checkout/complete', { method: 'POST', headers: { 'Content-Type': 'application/json', ...auth }, body: JSON.stringify({ ...buildCheckoutPayload(), action: 'prepare', pendingId: pendingIdRef.current }) }).then((x) => x.json()).catch(() => null);
      if (r?.pendingId) pendingIdRef.current = r.pendingId; return pendingIdRef.current;
    } catch { return pendingIdRef.current; }
  }, [tenantId, checkoutClientId]); // eslint-disable-line react-hooks/exhaustive-deps

  const sendCheckout = async (payload: any, charged: boolean): Promise<boolean> => {
    try {
      const auth = await staffAuthHeader();
      const res = await fetch('/api/checkout/complete', { method: 'POST', headers: { 'Content-Type': 'application/json', ...auth }, body: JSON.stringify(payload) });
      const out = await res.json().catch(() => ({}));
      if (!res.ok || !out?.ok) throw new Error(out?.error || 'save failed');
      toast({ title: out.already ? 'Already recorded' : 'Checkout successful', description: out.already ? 'This sale was already saved — nothing was added twice.' : undefined });
      if (out.mismatch) toast({ title: 'Total recorded differently', description: `Recorded $${Number(out.total).toFixed(2)} (the screen showed $${safeNumber(payload.expectedTotal).toFixed(2)}) — it’s flagged on the receipt for review.` });
      for (const w of (out.warnings || [])) toast({ variant: 'destructive', title: 'Needs a look', description: w });
      pendingIdRef.current = null; lastCheckoutRef.current = null;
      { const payer: any = (clients || []).find((c: any) => c.id === payload.clientId) || {}; const firstVisit = readyForCheckoutAppointments.find((a: any) => (payload.appointmentIds || []).includes(a.appointment.id));
        const tendered = safeNumber(payload.payment?.amountTendered); const collected = safeNumber(out.collected ?? out.total);
        setLastSale({ receiptId: out.receiptId || null, total: safeNumber(out.total), collected, depositUsed: safeNumber(out.depositUsed), method: payload.payment?.method === 'cash' ? 'cash' : payload.payment?.method === 'other' ? 'other' : 'card',
          tendered, change: payload.payment?.method === 'cash' ? Math.max(0, Math.round((tendered - collected) * 100) / 100) : 0, clientId: payload.clientId || null, clientName: payer.name || null, email: payer.email || '', phone: payer.phone || '',
          serviceId: firstVisit?.service?.id || firstVisit?.appointment?.serviceId || null, staffId: firstVisit?.appointment?.staffId || null, addOnIds: firstVisit?.appointment?.addOnIds || [], appointmentId: firstVisit?.appointment?.id || null,
          warnings: out.warnings || [], at: new Date().toISOString() }); }
      setRetailItems([]); setSelectedAppointmentIds(new Set()); setTipAmount(0); setIsCartSheetOpen(false); setRedeemedOffer(null); setAppliedDiscountCodes([]); setAppliedAdjustments(new Set()); setStoreCreditApplied(0); setStaffDiscount(null); setSkipGroupDiscount(false); setSelectedClientId(null); setSplitActive(false);   // the next sale starts fresh (the client screen goes back to your logo)
      return true;
    } catch (e: any) {
      console.error('[checkout] failed', e);
      if (charged) {
        lastCheckoutRef.current = payload;
        toast({ variant: 'destructive', title: 'Paid — but the sale didn’t save', duration: 60000,
          description: `The card payment went through (ref ${String(payload.payment?.stripePaymentIntentId || '').slice(-8)}). Don’t charge again. Tap “Save again” — it won’t charge the card. If it still won’t save, it’s in Needs attention → Sales not recorded.`,
          action: <ToastAction altText="Save the sale again without charging" onClick={() => { if (lastCheckoutRef.current) sendCheckout(lastCheckoutRef.current, true); }}>Save again</ToastAction> as any });
      } else toast({ variant: 'destructive', title: 'Checkout didn’t save', description: `${e?.message && e.message !== 'save failed' ? `${e.message} ` : ''}Nothing was recorded — please try again.` });
      return false;
    }
  };
  const handleCheckout = async (paymentData: { tipOverride?: number, paymentMethod: string, amountTendered: number, recoveryAmount?: number, recoveryReason?: string, skipLedger?: boolean, stripePaymentIntentId?: string, cardSurcharge?: number }) => {
    if (!checkoutClientId || !tenantId) return;
    setIsSubmitting(true);
    try { await sendCheckout({ ...buildCheckoutPayload(paymentData), pendingId: pendingIdRef.current }, !!paymentData.stripePaymentIntentId); }
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

    // When a booked appointment frees a slot, check the notify-me list for
    // the best-matching candidate and toast the desk. The hook already does
    // the scoring (service match, provider preference, time-of-day, wait
    // length); all we do here is read the result and surface it.
    //
    // Only fires for booked appointments that had a staffId and a startTime —
    // a walk-in cancellation frees a provider but not a specific slot, and
    // a front-desk add-back handles that naturally via the queue.
    const cancelled = selectedAppointment as any;
    if (cancelled && !cancelled.isWalkIn && cancelled.staffId && cancelled.startTime) {
      const d = safeDate(cancelled.startTime);
      const freedSlot = {
        staffId: String(cancelled.staffId),
        date: d.toISOString().slice(0, 10),
        time: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
        serviceId: String(cancelled.serviceId || ''),
      };
      const candidate = waitlist.autoFillOnCancellation(freedSlot);
      if (candidate) {
        toast({
          title: 'Slot opened — waitlist match',
          description: `${candidate.clientName} is waiting for this exact time. Book them in?`,
        });
      }
    }
  }, [onCancellationConfirm, clients, selectedAppointment, waitlist, toast]);

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
    const updates: any = { serviceId: data.serviceId, addOnIds: data.addOnIds, checkInStatus: 'arrived', checkInStatusTimestamp: new Date().toISOString(), notes: data.notes };
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
  /**
   * Why this was rewritten: a printed walk-in ticket scanned here always said
   * "No appointment found". Three separate reasons, all of them fatal on their own.
   *
   * 1. THE CODE WAS BEING DESTROYED BEFORE THE LOOKUP RAN. The old first line was
   *    `raw.trim().toUpperCase()`, and the input box uppercased every keystroke on
   *    top of that. A check-in token is a 16-character nanoid — MIXED case, and it
   *    can contain `-` and `_`. Firestore equality is case-sensitive, so a token
   *    like `k9pQjOjvKnqZc-hY` went to the database as `K9PQJOJVKNQZC-HY` and
   *    matched nothing, ever. `parseScan` + `codeVariants` from lib/scan-codes
   *    exist precisely for this and are now used, exactly as the planner's scan
   *    dialog already does. A pasted or scanned check-in URL also resolves now.
   *
   * 2. IT ONLY EVER SEARCHED APPOINTMENTS. A walk-in lives in `walkIns`. Both
   *    collections are searched now, appointments first.
   *
   * 3. AN UNASSIGNED WALK-IN HAS NO APPOINTMENT TO FIND. The walk-in engine writes
   *    the `apt-walkin-{id}` mirror only once a provider is seated, so a guest
   *    still waiting their turn had a ticket with no appointment behind it. Their
   *    walkIns row is the record, and it is now what the scan returns.
   *
   * A walk-in hit comes back flagged with `__walkIn: true` so the caller knows it
   * is a queue row rather than an appointment.
   */
  const resolveScanCode = React.useCallback(async (raw: string) => {
    const parsed = parseScan(raw);
    if (parsed.kind === 'empty') { setScanResult(null); setScanNotFound(false); return; }
    const value = parsed.value;
    const needle = value.toUpperCase();

    /** Does this record carry the scanned code, in any spelling? */
    const carries = (r: any): boolean => {
      if (!r) return false;
      const code = String(r.shortCode ?? '').trim().toUpperCase();
      const token = String(r.checkInToken ?? '').trim();
      if (parsed.kind === 'token') return token === value || token.toUpperCase() === needle || (!!code && code === needle);
      return (!!code && code === needle) || token.toUpperCase() === needle;
    };

    // 1. In-memory (instant) — appointments first, then the walk-in queue.
    const localApt = (appointmentsFromInventory || []).find(carries);
    if (localApt) { setScanResult({ ...(localApt as any) }); setScanNotFound(false); return; }
    const localRow = ((walkIns as any[]) || []).find(carries);
    if (localRow) { setScanResult({ ...(localRow as any), __walkIn: true }); setScanNotFound(false); return; }

    // 2. Firestore.
    if (!firestore || !tenantId) { setScanResult(null); setScanNotFound(true); return; }

    setIsScanResolving(true);
    try {
      const variants = codeVariants(value);
      const hit = async (collectionName: 'appointments' | 'walkIns') => {
        const col = collection(firestore, 'tenants', tenantId, collectionName);
        // A token is exact and unique, so try it first when that is what we have.
        if (parsed.kind === 'token') {
          const byToken = await getDocs(query(col, where('checkInToken', '==', value), limit(1)));
          if (!byToken.empty) return byToken.docs[0];
        }
        if (variants.length) {
          // `in` accepts up to 30 values; codeVariants returns at most three.
          const byCode = await getDocs(query(col, where('shortCode', 'in', variants), limit(1)));
          if (!byCode.empty) return byCode.docs[0];
        }
        if (parsed.kind !== 'token') {
          const byTokenExact = await getDocs(query(col, where('checkInToken', 'in', variants), limit(1)));
          if (!byTokenExact.empty) return byTokenExact.docs[0];
        }
        return null;
      };

      const aptDoc = await hit('appointments');
      if (aptDoc) {
        const data = aptDoc.data() as any;
        setScanResult({ id: aptDoc.id, ...data, checkInStatus: data.checkInStatus || 'pending' });
        setScanNotFound(false);
        return;
      }

      const rowDoc = await hit('walkIns');
      if (rowDoc) {
        const data = rowDoc.data() as any;
        setScanResult({ id: rowDoc.id, ...data, __walkIn: true, checkInStatus: data.checkInStatus || 'pending' });
        setScanNotFound(false);
        return;
      }

      setScanResult(null);
      setScanNotFound(true);
    } catch (e) {
      console.error('[resolveScanCode] lookup failed:', e);
      setScanResult(null);
      setScanNotFound(true);
    } finally {
      setIsScanResolving(false);
    }
  }, [appointmentsFromInventory, walkIns, firestore, tenantId]);

  // A wedge scanner types the whole code then stops, so a short idle window is a
  // reliable end-of-scan signal. 80ms was too tight for anyone typing by hand: it
  // fired a lookup on their half-typed code and flashed "not found" at them while
  // they were still going. 300ms is still imperceptible after a scan.
  const scanTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleScanInput = React.useCallback((val: string) => {
    setScanQuery(val); setScanNotFound(false); setScanResult(null);
    if (scanTimerRef.current) clearTimeout(scanTimerRef.current);
    if (val.trim().length >= 6) scanTimerRef.current = setTimeout(() => resolveScanCode(val), 300);
  }, [resolveScanCode]);

  const handleScanConfirm = React.useCallback(() => {
    if (!scanResult) return;
    const hit = scanResult;
    setIsScanLookupOpen(false);
    setScanQuery(''); setScanResult(null); setScanNotFound(false);

    // A walk-in queue row. If they are already in a chair or done, open the mirror
    // appointment instead so the desk sees the live record; otherwise send them
    // through the same arrival confirmation an appointment gets — that dialog
    // already handles walk-in rows (it branches on `serviceIds`).
    if (hit.__walkIn) {
      const status = String(hit.status || '').toLowerCase();
      if (status === 'servicing' || status === 'in_service' || status === 'ready_for_checkout' || status === 'completed') {
        const mirror = (appointmentsFromInventory || []).find((a: any) => a.id === `apt-walkin-${hit.id}`);
        if (mirror) { setSelectedAppointment(mirror as any); setIsDetailsOpen(true); return; }
        toast({ title: 'Already in service', description: `${hit.clientName || hit.customerName || 'This guest'} is with a provider — find them in the In Service lane.` });
        return;
      }
      setPendingCheckInItem(hit);
      return;
    }

    const notYetArrived = !hit.checkInStatus || hit.checkInStatus === 'pending' || hit.checkInStatus === 'confirmed';
    if (notYetArrived) { setPendingCheckInItem(hit); }
    else { setSelectedAppointment(hit); setIsDetailsOpen(true); }
  }, [scanResult, appointmentsFromInventory, toast]);
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
    const { approveWithPin } = await import('@/lib/approve-client');
    const ap = await approveWithPin(tenantId, authorizerPin, { kind: 'void', ref: txId, reason });
    if (!ap.ok || !ap.approver) { toast({ variant: 'destructive', title: 'Not approved', description: ap.error || 'Manager PIN required to void transactions.' }); return; }
    const authorizer = { id: ap.approver.id, data: () => ({ name: ap.approver!.name, role: ap.approver!.role }) };
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

  // ── Retail QR / barcode resolution ──────────────────────────────────────────
  // Matches a scanned code against inventory. Adjust the field names below
  // (`barcode` / `sku`) to whatever InventoryItem actually uses if it
  // differs — this assumes those fields exist on the type; if they don't
  // yet, this needs a schema addition plus a way to assign/print codes per
  // product before retail scanning can work end-to-end.
  const resolveRetailScan = useCallback((raw: string) => {
    const code = raw.trim().toUpperCase();
    const item = (inventory || []).find((i: any) =>
      (i.barcode && String(i.barcode).toUpperCase() === code) ||
      (i.sku && String(i.sku).toUpperCase() === code)
    );
    if (item) {
      handleAddToCart(item);
      toast({ title: 'Added to Cart', description: item.name });
    } else {
      toast({ variant: 'destructive', title: 'Product Not Found', description: `No item matches code ${code}.` });
    }
  }, [inventory, handleAddToCart, toast]);

  // ── One scan, anywhere on the POS (lib/pos-scan): products first, then tickets ──
  const [variantChoice, setVariantChoice] = useState<{ parent: any; variants: any[] } | null>(null);
  const addProductChecked = useCallback((item: any) => {
    const inCart = (retailItems || []).find((i: any) => i.id === item.id)?.quantity || 0;
    const left = onHand(item) - inCart;
    handleAddToCart(item);
    if (item.type === 'retail' || item.msrp) {
      if (left <= 0) toast({ variant: 'destructive', title: `${item.name} added`, description: 'None on the shelf on record — check the shelf, and receive stock if it’s there.' });
      else if (left <= 2) toast({ title: `${item.name} added`, description: `Only ${left - 1 <= 0 ? 'this one' : `${left - 1} more`} on the shelf after this.` });
      else toast({ title: `${item.name} added` });
    }
  }, [retailItems, handleAddToCart, toast]);
  const handlePosScan = useCallback((raw: string) => {
    const hit = identifyPosScan(raw, { inventory: inventory || [], appointments: appointmentsFromInventory || [], walkIns: (walkIns as any[]) || [] });
    if (hit.kind === 'empty') return;
    if (hit.kind === 'product') { addProductChecked(hit.item); return; }
    if (hit.kind === 'choose') { if (!hit.variants.length) { toast({ variant: 'destructive', title: `${hit.parent.name} has no sizes set up`, description: 'Add its variants in Inventory.' }); return; } setVariantChoice({ parent: hit.parent, variants: hit.variants }); return; }
    if (hit.kind === 'ticket') {
      const r: any = hit.record;
      const ready = !hit.walkIn && (readyForCheckoutAppointments || []).some((a: any) => a.id === r.id);
      if (ready) { if (!selectedAppointmentIds.has(r.id)) handleSelectAppointment(r.id); window.dispatchEvent(new CustomEvent('cf:open-checkout')); toast({ title: `${r.clientName || 'Visit'} added to checkout` }); return; }
      if (!hit.walkIn && r.id) { openVisit(r.id); return; }   // a booked visit → its ticket (Check in / Start / Ready to pay are one tap away)
      setScanMode('checkin'); setScanQuery(String(r.shortCode || r.checkInToken || '')); setScanResult(hit.walkIn ? { ...r, __walkIn: true } : { ...r }); setScanNotFound(false); setIsScanLookupOpen(true); return;
    }
    setScanMode('checkin'); setScanQuery(hit.value); resolveScanCode(hit.value); setIsScanLookupOpen(true);   // not in today's list — ask the server
  }, [inventory, appointmentsFromInventory, walkIns, addProductChecked, readyForCheckoutAppointments, selectedAppointmentIds, handleSelectAppointment, resolveScanCode, toast]);

  const checkoutHubProps = {
    cart: retailItems, onCartChange: setRetailItems, appointmentsData: readyForCheckoutAppointments.filter(a => selectedAppointmentIds.has(a.id)), onSelectAppointment: handleSelectAppointment,
    clients: clients || [], isGroupCheckout: selectedAppointmentIds.size > 1, payerOptions: payerOptions || [], selectedClientId, setSelectedClientId,
    onAddClientClick: () => setIsAddClientOpen(true),
    onScanClick: () => { setScanMode('checkout'); setScanQuery(''); setScanResult(null); setScanNotFound(false); setIsCameraScanOpen(true); },
    onAddItem: addProductChecked, onPosScan: handlePosScan, variantChoice, setVariantChoice, getPendingId: () => pendingIdRef.current, prepareNow, splitActive, setSplitActive,
    subtotal: subtotalCalc, tax: taxCalc, taxLabel, total: totalCalc, lastSale, clearLastSale: () => setLastSale(null), moments, momentReward, momentDiscountValue, staffDiscount, setStaffDiscount, staffDiscountValue, groupInfo, groupDiscountRaw, groupDiscountValue, skipGroupDiscount, setSkipGroupDiscount, tipAmount, setTipAmount, onCheckout: handleCheckout,
    appliedDiscountCodes, setAppliedDiscountCodes, discount: discountValue, membershipDiscount: membershipDiscountValue,
    walletOffers, offerClientId, offerServiceIds,
    isSubmitting, paymentTab, setPaymentTab, discounts: discounts || [], amountTendered, setAmountTendered,
    appliedAdjustments, onApplyAdjustmentToggle: (id: string, apply: boolean) => { const next = new Set(appliedAdjustments); if (apply) next.add(id); else next.delete(id); setAppliedAdjustments(next); },
    redeemedOffer, setRedeemedOffer, memberships: memberships || [], packages: packages || [],
    allowStacking: selectedTenant?.allowDiscountStacking || false, showTitle: false,
    waivedAppointmentFees, onWaiveFeeToggle: (id: string, waive: boolean, authorizerId?: string, reason?: string, approvalToken?: string) => { setWaivedAppointmentFees(prev => { const next = new Map(prev); if (waive && authorizerId && reason) next.set(id, { authorizerId, reason, approvalToken } as any); else next.delete(id); return next; }); },
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

  // Live "waiting right now" count for the sticky Floor/Retail tab bar —
  // distinct from kpiData.totalWalkIns, which is today's cumulative total.
  const waitingNowCount = useMemo(
    () => (walkIns || []).filter((w: any) => w.status === 'waiting').length,
    [walkIns],
  );
  const cartItemCount = retailItems.length + selectedAppointmentIds.size;

  // FIX: this was previously an inline `useMemo()` call directly inside the
  // WalkInQueue JSX prop, at a point in the tree unconditionally rendered.
  // Wrapping the whole Floor Ops section in `{activeFloorTab === 'floor' &&
  // (...)}` made that hook conditional — it only executed on renders where
  // the Floor tab was active, changing the hook count between renders and
  // throwing React error #300 ("rendered fewer hooks than expected") the
  // moment someone switched to the Retail tab. Hoisted here so it's called
  // unconditionally on every render, like every other hook in this component.
  const walkInGroupSizes = useMemo(() => {
    const sizes = new Map<string, number>();
    (walkIns || []).forEach((w: any) => {
      if (w.groupId && w.groupSize) sizes.set(w.groupId, w.groupSize);
      else if (w.groupId) sizes.set(w.groupId, (sizes.get(w.groupId) || 0) + 1);
    });
    return sizes;
  }, [walkIns]);

  return {
    isMobile, inventory, services, appointmentsFromInventory, clients, walkIns, staff, transactions,
    memberships, packages, resources, discounts, tillSessions, isInventoryLoading, firestore, currentUser,
    selectedTenant, role, tenantId, toast, selectedAppointmentIds, setSelectedAppointmentIds, selectedClientId, setSelectedClientId,
    retailItems, setRetailItems, tipAmount, setTipAmount, tipAllocations, setTipAllocations, paymentTab, setPaymentTab,
    amountTendered, setAmountTendered, isAddClientOpen, setIsAddClientOpen, isDetailsOpen, setIsDetailsOpen, isCancelDialogOpen, setIsCancelDialogOpen,
    isOverrideOpen, setIsOverrideOpen, isCartSheetOpen, setIsCartSheetOpen, isTechnicianReviewOpen, setIsTechnicianReviewOpen, isCartCollapsed, setIsCartCollapsed,
    isTillManagementOpen, setIsTillManagementOpen, selectedAppointment, setSelectedAppointment, liveSelectedAppointment, appointmentToReview, setAppointmentToReview, isSubmitting,
    setIsSubmitting, assignmentMode, setAssignmentMode, pendingCheckInItem, setPendingCheckInItem, ticketToPrint, setTicketToPrint, isPrintDialogOpen,
    setIsPrintDialogOpen, appliedDiscountCodes, setAppliedDiscountCodes, appliedAdjustments, setAppliedAdjustments, redeemedOffer, setRedeemedOffer, waivedAppointmentFees,
    setWaivedAppointmentFees, isRecoveryOverrideOpen, setIsRecoveryOverrideOpen, pendingIdentityMatch, setPendingIdentityMatch, voidTransactionId, setVoidTransactionId, isVoidDialogOpen,
    setIsVoidDialogOpen, isQuickBookOpen, setIsQuickBookOpen, activeFloorTab, setActiveFloorTab, isScanLookupOpen, setIsScanLookupOpen, isCameraScanOpen,
    setIsCameraScanOpen, scanQuery, setScanQuery, scanResult, setScanResult, scanNotFound, setScanNotFound, isScanResolving,
    setIsScanResolving, scanMode, setScanMode, scanInputRef, pendingRefund, setPendingRefund, storeCreditApplied, setStoreCreditApplied,
    newWalkInAlert, setNewWalkInAlert, prevWalkInCountRef, waitlistRaw, waitlistEntries, waitlist, isOwnerOrAdminUser, activeTill,
    readyForCheckoutAppointments, kpiData, selectedClient, subtotalCalc, offerClientId, offerServiceIds, walletOffers, setWalletOffers,
    autoAppliedOfferRef, discountValue, membershipDiscountValue, taxCalc, totalCalc, payerOptions, handleSelectAppointment, handleAddToCart,
    earlyStart, setEarlyStart, handleStartService, handleSendToFrontDesk, handleAssignStaff, autoAssignedIds, handleAssignNext, handleUpdateStatus,
    handleCheckout, recoveryApprovalRef, handleCancelAction, onCancellationConfirm, handleCancellationConfirm, handleConfirmRefund, handleResolveCheckInConfirmation, handleRevertToService, handleRevertToReady,
    handlePosScan, addProductChecked, variantChoice, setVariantChoice,
    resolveScanCode, scanTimerRef, handleScanInput, handleScanConfirm, handleOpenTill, handleCloseTill, handleVoidTransaction, resolveRetailScan,
    checkoutHubProps, getPreviousFormula, getVisitCount, waitingNowCount, cartItemCount, walkInGroupSizes,
  };
}
