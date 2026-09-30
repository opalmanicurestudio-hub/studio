'use client';

import { SplitBill } from '@/components/pos/SplitBill';
import { saleProfileOf } from '@/lib/sale-profile';
import { PosCatalog } from '@/components/pos/PosCatalog';
import { useClientScreen } from '@/components/pos/ClientScreen';
import { SaleComplete } from '@/components/pos/SaleComplete';
import { DESK_CSS } from '@/components/pos/desk/kit';
import { approveWithPin } from '@/lib/approve-client';
import { CheckoutNudge } from '@/components/pos/CheckoutNudge';
import { hasRealCard } from '@/lib/card-on-file';
import { staffAuthHeader } from '@/lib/staff-fetch';
import { offerProblem } from '@/lib/offers';
import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import {
  Banknote,
  CreditCard,
  Trash2,
  DollarSign,
  Award,
  Loader,
  Tag,
  Wand2,
  X,
  ShoppingCart,
  CheckCircle,
  Percent,
  AlertTriangle,
  QrCode,
  ShieldCheck,
  Users,
  Repeat,
  Wallet,
  UserPlus,
  Cake,
  ChevronDown,
  Zap,
  Search,
  User,
  Plus,
  Minus,
  TicketIcon,
  XCircle,
  Fingerprint,
  Scan as ScanIcon,
  ArrowRight,
  Star,
  Check,
  Lock,
  Sparkles,
  Info,
  PartyPopper,
  Box,
  CheckCircle2,
  VolumeX,
  Ear,
  SunDim,
  Coffee,
  Landmark,
  Scale,
  ShieldAlert,
  Undo2,
  MessageSquare,
  AlertCircle,
  Radio,
  Wifi,
  WifiOff,
  Smartphone,
  Monitor,
  Receipt, Clock} from 'lucide-react';
import { type Client, type Service, type Staff, type Membership, type Package, getServicePrice, type RecoveryPreset } from '@/lib/data';
import { ScrollArea } from '../ui/scroll-area';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import { Label } from '../ui/label';
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from '../ui/tooltip';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BrowseDiscountsDialog } from '../discounts/BrowseDiscountsDialog';
import { useInventory } from '@/context/InventoryContext';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { cn, safeNumber } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import { useToast } from '@/hooks/use-toast';
import { subMonths, parseISO, isAfter, isSameMonth, differenceInDays, subYears } from 'date-fns';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog';
import { Textarea } from '../ui/textarea';
import { Switch } from '../ui/switch';
import { useTenant } from '@/context/TenantContext';
import { useFirebase, setDocumentNonBlocking } from '@/firebase';
import { CashCheckout } from './CashCheckout';
import { GuestSearch } from './GuestSearch';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { StoreCreditPanel } from '@/components/pos/StoreCreditPanel';

// ─── Try to use Terminal context if available (graceful fallback if provider not mounted) ──
let useTerminalSafe: () => any = () => null;
try {
  const mod = require('./StripeTerminalProvider');
  useTerminalSafe = () => {
    try { return mod.useTerminal(); } catch { return null; }
  };
} catch {}

const safeDate = (val: any): Date => {
  if (!val) return new Date();
  if (val instanceof Date) return val;
  if (typeof val === 'string') return parseISO(val);
  if (typeof val === 'object' && 'seconds' in val) return new Date(val.seconds * 1000);
  return new Date(val);
};

// ─── LineItem ─────────────────────────────────────────────────────────────────
// One consistent visual language for every cart sub-line (add-ons, amenities,
// adjustments, waived states) instead of each type having its own border/bg
// treatment. Differentiated by a leading icon + tone color, not by structure.
type LineItemTone = 'muted' | 'warning' | 'success' | 'primary';

const LineItem = ({ icon: Icon, label, sub, amount, tone = 'muted', strike = false }: {
  icon?: any;
  label: string;
  sub?: string;
  amount: number;
  tone?: LineItemTone;
  strike?: boolean;
}) => {
  const toneText: Record<LineItemTone, string> = {
    muted:   'text-muted-foreground',
    warning: 'text-amber-600',
    success: 'text-green-600',
    primary: 'text-primary',
  };
  return (
    <div className="flex items-center justify-between gap-3 py-0.5">
      <div className="flex items-center gap-2 min-w-0">
        {Icon && <Icon className={cn('w-3 h-3 shrink-0', toneText[tone])} />}
        <div className="min-w-0">
          <span className={cn('text-[10px] font-bold uppercase tracking-tight truncate', toneText[tone], strike && 'line-through opacity-40')}>{label}</span>
          {sub && <span className="block text-[8px] font-black uppercase tracking-widest opacity-50">{sub}</span>}
        </div>
      </div>
      <span className={cn('text-[10px] font-black font-mono shrink-0', toneText[tone], strike && 'line-through opacity-40')}>${amount.toFixed(2)}</span>
    </div>
  );
};

// ─── WaiveFeeDialog ───────────────────────────────────────────────────────────
const WaiveFeeDialog = ({ open, onOpenChange, staff, onConfirm, title = 'Admin Override', description = 'Authorize fee waiver with manager PIN.', tenantIdForApproval, approvalKind, approvalRef }: any) => {
  const [pin, setPin] = useState('');
  const [reason, setReason] = useState('');
  const { toast } = useToast();

  const handleConfirm = async () => {
    if (!reason.trim()) { toast({ variant: 'destructive', title: 'Reason Required' }); return; }
    // The PIN is checked on the server (PINs are never on this device); the approval is single-use.
    const r = await approveWithPin(tenantIdForApproval || '', pin, { kind: approvalKind || 'waive', ref: approvalRef || null, reason });
    if (!r.ok || !r.approver) { toast({ variant: 'destructive', title: 'Not approved', description: r.error || 'Manager authorization required.' }); return; }
    const authorizedStaff: any = { ...r.approver, approvalToken: r.token };
    onConfirm(authorizedStaff, reason);
    setPin(''); setReason('');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md rounded-[3rem] border-4 shadow-3xl bg-background">
        <DialogHeader className="p-6 pb-0 text-left">
          <DialogTitle className="flex items-center gap-3 text-2xl font-black uppercase tracking-tighter text-slate-900 text-left">
            <ShieldCheck className="w-6 h-6 text-primary" />{title}
          </DialogTitle>
          <DialogDescription className="text-xs font-bold uppercase tracking-widest opacity-60 text-left">{description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-8 py-8 flex flex-col items-center text-left">
          <div className="space-y-2 w-48 text-center">
            <Label className="text-[10px] font-black uppercase tracking-[0.3em] text-muted-foreground text-center block">Manager PIN</Label>
            <Input type="password" placeholder="****" aria-label="Staff PIN" maxLength={4} className="text-center text-4xl font-black h-20 tracking-[0.5em] bg-muted/30 border-4 rounded-3xl" value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, ''))} autoFocus />
          </div>
          <div className="space-y-2 w-full px-6 text-left">
            <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Reason</Label>
            <Textarea value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g., Client verified emergency..." aria-label="Reason" className="rounded-2xl border-2 bg-muted/5 focus-visible:ring-primary/20 font-medium" />
          </div>
        </div>
        <DialogFooter className="p-6 pt-0 flex flex-col gap-3">
          <Button onClick={handleConfirm} disabled={pin.length < 4 || !reason.trim()} className="w-full h-16 rounded-2xl font-black uppercase shadow-2xl shadow-primary/20">Confirm</Button>
          <Button variant="ghost" onClick={() => onOpenChange(false)} className="w-full font-bold uppercase text-[10px] tracking-widest">Cancel</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

// ─── CardOnFileConfirm ────────────────────────────────────────────────────────
const CardOnFileConfirm = ({ client, amount, surcharge, onConfirm, onCancel, isProcessing }: {
  client: Client;
  amount: number;
  surcharge?: number;
  onConfirm: () => void;
  onCancel: () => void;
  isProcessing: boolean;
}) => {
  const card = (client as any).cardOnFile;
  const hasSurcharge = safeNumber(surcharge) > 0;
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4 pt-4 border-t border-dashed">
      <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Confirm Card Charge</p>
      <div className="p-4 rounded-2xl border-2 border-primary/10 bg-primary/[0.02] flex items-center gap-3">
        <div className="p-2 bg-white rounded-xl shadow-sm border border-primary/10">
          <CreditCard className="w-5 h-5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-black uppercase tracking-tight text-slate-900">
            {String(card?.brand || 'Card')} •••• {String(card?.last4 || '****')}
          </p>
          <p className="text-[8px] font-bold text-muted-foreground uppercase">
            Exp {safeNumber(card?.expMonth ?? card?.expiryMonth)}/{safeNumber(card?.expYear ?? card?.expiryYear)}
          </p>
        </div>
        <p className="font-black text-lg font-mono text-primary tracking-tighter shrink-0">
          ${safeNumber(amount).toFixed(2)}
        </p>
      </div>
      {hasSurcharge && (
        <div className="flex items-center justify-between px-2 text-[10px] font-bold text-amber-700 uppercase">
          <span className="flex items-center gap-1.5"><Receipt className="w-3 h-3" /> Includes card processing fee</span>
          <span className="font-mono">${safeNumber(surcharge).toFixed(2)}</span>
        </div>
      )}
      <div className="flex gap-3">
        <Button variant="outline" onClick={onCancel} disabled={isProcessing}
          className="flex-1 h-12 rounded-2xl font-black uppercase text-[10px] tracking-widest border-2">
          Cancel
        </Button>
        <Button onClick={onConfirm} disabled={isProcessing}
          className="flex-[2] h-12 rounded-2xl font-black uppercase text-[10px] tracking-widest shadow-xl shadow-primary/20">
          {isProcessing
            ? <><Loader className="w-4 h-4 animate-spin mr-2" /> Charging...</>
            : <><Zap className="w-4 h-4 mr-2" /> Charge ${safeNumber(amount).toFixed(2)}</>}
        </Button>
      </div>
    </motion.div>
  );
};

// ─── TerminalPaymentUI ────────────────────────────────────────────────────────
const TerminalPaymentUI = ({ amount, onCancel, onSuccess }: {
  amount: number;
  onCancel: () => void;
  onSuccess: () => void;
}) => {
  const terminal = useTerminalSafe();

  const statusLabel: Record<string, string> = {
    idle:             'Ready',
    creating:         'Preparing...',
    waiting_for_card: 'Present card to reader',
    processing:       'Processing...',
    capturing:        'Finalizing...',
    succeeded:        'Payment Accepted',
    failed:           'Payment Failed',
    cancelled:        'Cancelled',
  };

  const status = terminal?.paymentStatus || 'idle';
  const error  = terminal?.paymentError;

  useEffect(() => {
    if (status === 'succeeded') { setTimeout(onSuccess, 800); }
  }, [status, onSuccess]);

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4 pt-4 border-t border-dashed">
      <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Terminal Payment</p>
      <div className={cn('p-6 rounded-2xl border-2 text-center space-y-4 transition-all',
        status === 'succeeded' ? 'border-green-200 bg-green-50' :
        status === 'failed'    ? 'border-destructive/20 bg-destructive/5' :
        status === 'waiting_for_card' ? 'border-primary/20 bg-primary/5 animate-pulse' :
        'border-border bg-muted/5')}>
        <div className="flex justify-center">
          {status === 'succeeded'          ? <CheckCircle2 className="w-10 h-10 text-green-500" /> :
           status === 'failed'             ? <XCircle className="w-10 h-10 text-destructive" /> :
           status === 'waiting_for_card'   ? <CreditCard className="w-10 h-10 text-primary animate-bounce" /> :
           <Loader className="w-10 h-10 text-primary animate-spin" />}
        </div>
        <div>
          <p className="font-black uppercase tracking-widest text-sm text-slate-900">
            {statusLabel[status] || status}
          </p>
          {status === 'waiting_for_card' && (
            <p className="text-[10px] font-bold text-muted-foreground uppercase mt-1">
              Tap, insert, or swipe on the reader
            </p>
          )}
          {error && (
            <p className="text-[10px] font-bold text-destructive uppercase mt-1">{error}</p>
          )}
        </div>
        <p className="font-black text-2xl font-mono text-primary tracking-tighter">
          ${safeNumber(amount).toFixed(2)}
        </p>
      </div>
      {(status === 'waiting_for_card' || status === 'idle') && (
        <Button variant="outline" onClick={() => { terminal?.cancelPayment(); onCancel(); }}
          className="w-full h-10 rounded-xl border-2 font-black uppercase text-[10px] tracking-widest text-destructive border-destructive/20 hover:bg-destructive/5">
          <XCircle className="w-3.5 h-3.5 mr-1.5" /> Cancel Payment
        </Button>
      )}
      {status === 'failed' && (
        <Button variant="outline" onClick={onCancel}
          className="w-full h-10 rounded-xl border-2 font-black uppercase text-[10px] tracking-widest">
          Try Again
        </Button>
      )}
    </motion.div>
  );
};

// ─── EmbeddedCardForm ─────────────────────────────────────────────────────────
// Uses Stripe.js to collect a new card, charge it, and optionally save to profile
const EmbeddedCardForm = ({ tenantId, clientId, clientEmail, amount, saveCard, onSuccess, onCancel }: {
  tenantId:    string;
  clientId?:   string;
  clientEmail?: string;
  amount:      number;
  saveCard:    boolean;
  onSuccess:   (paymentIntentId: string) => void;
  onCancel:    () => void;
}) => {
  const { toast } = useToast();
  const mountRef     = useRef<HTMLDivElement>(null);
  const stripeRef     = useRef<any>(null);
  const elementsRef  = useRef<any>(null);
  const cardRef      = useRef<any>(null);
  const [isReady,    setIsReady]    = useState(false);
  const [isLoading,  setIsLoading]  = useState(true);
  const [isCharging, setIsCharging] = useState(false);
  const [cardError,  setCardError]  = useState<string | null>(null);

  useEffect(() => {
    let stripe: any;
    let card: any;

    const init = async () => {
      // Load Stripe.js
      if (!(window as any).Stripe) {
        await new Promise<void>((resolve) => {
          const s = document.createElement('script');
          s.src = 'https://js.stripe.com/v3/';
          s.onload = () => resolve();
          document.head.appendChild(s);
        });
      }

      // Get publishable key + connected account from server
      const res = await fetch('/api/stripe/publishable-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId }),
      });
      const { publishableKey, stripeAccountId } = await res.json();
      if (!publishableKey) { setIsLoading(false); return; }

      stripe = (window as any).Stripe(publishableKey, { stripeAccount: stripeAccountId });
      stripeRef.current = stripe;
      const elements = stripe.elements();
      elementsRef.current = elements;

      card = elements.create('card', {
        style: {
          base: {
            fontSize:        '16px',
            color:           '#0f172a',
            fontFamily:      'inherit',
            '::placeholder': { color: '#94a3b8' },
          },
          invalid: { color: '#ef4444' },
        },
        hidePostalCode: false,
      });

      if (mountRef.current) {
        card.mount(mountRef.current);
        cardRef.current = card;
        card.on('ready', () => setIsReady(true));
        card.on('change', (e: any) => setCardError(e.error?.message || null));
        setIsLoading(false);
      }
    };

    init().catch(console.error);

    return () => {
      try { cardRef.current?.destroy(); } catch {}
    };
  }, [tenantId]);

  const handleCharge = async () => {
    if (!cardRef.current || !elementsRef.current) return;
    setIsCharging(true);
    setCardError(null);

    try {
      // 1. Create PaymentIntent on server
      const piRes = await fetch('/api/stripe/pos-payment-intent', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ tenantId, clientId, amountCents: Math.round(amount * 100), saveCard, description: 'Studio Services' }),
      });
      const piData = await piRes.json();
      if (!piData.clientSecret) throw new Error(piData.error || 'Could not create payment');

      // 2. Confirm on client
      const confirmResult = await stripeRef.current.confirmCardPayment(piData.clientSecret, {
        payment_method: {
          card: cardRef.current,
          billing_details: { email: clientEmail || undefined },
        },
        ...(saveCard ? { setup_future_usage: 'off_session' } : {}),
      });

      if (confirmResult.error) {
        setCardError(confirmResult.error.message || 'Card declined');
        setIsCharging(false);
        return;
      }

      // 3. If save requested, notify server to vault the card
      if (saveCard && clientId && confirmResult.paymentIntent?.payment_method) {
        await fetch('/api/stripe/vault-card', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            tenantId,
            clientId,
            paymentIntentId: confirmResult.paymentIntent.id,
            customerId:      piData.customerId,
          }),
        });
      }

      onSuccess(confirmResult.paymentIntent?.id || '');
    } catch (err: any) {
      setCardError(err.message);
      toast({ variant: 'destructive', title: 'Payment Failed', description: err.message });
    } finally {
      setIsCharging(false);
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4 pt-4 border-t border-dashed">
      <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">New Card</p>
      <div className="p-4 rounded-2xl border-2 border-border bg-white shadow-inner min-h-[52px] flex items-center">
        {isLoading && <Loader className="w-4 h-4 animate-spin text-muted-foreground mx-auto" />}
        <div ref={mountRef} className={cn('w-full', isLoading && 'hidden')} />
      </div>
      {cardError && (
        <p className="text-[10px] font-bold text-destructive uppercase flex items-center gap-1.5">
          <AlertTriangle className="w-3 h-3" /> {cardError}
        </p>
      )}
      <div className="flex gap-3">
        <Button variant="outline" onClick={onCancel} disabled={isCharging}
          className="flex-1 h-12 rounded-2xl font-black uppercase text-[10px] tracking-widest border-2">
          Cancel
        </Button>
        <Button onClick={handleCharge} disabled={!isReady || isCharging}
          className="flex-[2] h-12 rounded-2xl font-black uppercase text-[10px] tracking-widest shadow-xl shadow-primary/20">
          {isCharging
            ? <><Loader className="w-4 h-4 animate-spin mr-2" /> Processing...</>
            : <><CreditCard className="w-4 h-4 mr-2" /> Charge ${safeNumber(amount).toFixed(2)}</>}
        </Button>
      </div>
      {saveCard && (
        <p className="text-[9px] font-bold text-muted-foreground uppercase flex items-center gap-1.5 opacity-60">
          <Lock className="w-3 h-3" /> Card will be saved to client profile for future charges
        </p>
      )}
    </motion.div>
  );
};



// ─── CheckoutHub ──────────────────────────────────────────────────────────────
export const CheckoutHub = ({
  cart,
  onCartChange,
  appointmentsData,
  onSelectAppointment,
  clients,
  isGroupCheckout,
  payerOptions,
  selectedClientId,
  setSelectedClientId,
  onAddClientClick,
  onScanClick,
  subtotal,
  tax,
  taxLabel,
  lastSale,
  clearLastSale,
  onAddItem,
  onPosScan,
  getPendingId,
  prepareNow,
  splitActive,
  setSplitActive,
  moments,
  momentReward,
  momentDiscountValue,
  onDone,
  staffDiscount,
  setStaffDiscount,
  staffDiscountValue,
  groupInfo,
  groupDiscountRaw,
  groupDiscountValue,
  skipGroupDiscount,
  setSkipGroupDiscount,
  total,
  tipAmount,
  setTipAmount,
  onCheckout,
  appliedDiscountCodes,
  setAppliedDiscountCodes,
  discount,
  membershipDiscount,
  isSubmitting,
  paymentTab,
  setPaymentTab,
  discounts,
  amountTendered,
  setAmountTendered,
  appliedAdjustments,
  onApplyAdjustmentToggle,
  redeemedOffer,
  setRedeemedOffer,
  memberships,
  packages,
  allowStacking,
  waivedAppointmentFees,
  onWaiveFeeToggle,
  tipAllocations,
  setTipAllocations,
  activeTill,
  staff,
  role,
  onRequestOverride,
  tenantId,
  cashierName,
  storeCreditApplied,
  onStoreCreditApplied,
  walletOffers = [],
  offerClientId = null,
  offerServiceIds = [],
 }: any) => {

  const [promoCodeInput,        setPromoCodeInput]        = useState('');
  const [isDiscountBrowserOpen, setIsDiscountBrowserOpen] = useState(false);
  const [isPayerDialogOpen,     setIsPayerDialogOpen]     = useState(false);
  const { services, inventory }                           = useInventory();
  const { selectedTenant }                                = useTenant();
  const { toast }                                         = useToast();
  const { firestore }                                     = useFirebase();

  const [isWaiveAuthOpen,    setIsPointOfSaleWaiveAuthOpen] = useState(false);
  const [pendingWaiveAptId,  setPendingWaiveAptId]          = useState<string | null>(null);
  const [clientSearch,       setClientSearch]               = useState('');

  const [recoveryAmount,    setRecoveryAmount]    = useState<number>(0);
  const [recoveryReason,    setRecoveryReason]    = useState('');
  const [isRecoveryDialogOpen, setIsRecoveryDialogOpen] = useState(false);
  const [showPinEntry,      setShowPinEntry]       = useState(false);
  const [overridePin,       setOverridePin]        = useState('');
  const [overrideReason,    setOverrideReason]     = useState('');
  const [recoveryApprovalToken, setRecoveryApprovalToken] = useState<string | null>(null);   // a manager's approval for recovery above the limit
  const [addOpen, setAddOpen] = useState(false);   // "Add to this sale" — the catalog inside checkout
  const [sdOpen, setSdOpen] = useState(false); const [sdKind, setSdKind] = useState<'pct' | 'amt'>('pct'); const [sdValue, setSdValue] = useState(0); const [sdReason, setSdReason] = useState(''); const [sdPin, setSdPin] = useState('');
  const [isOverrideUnlocked,setIsOverrideUnlocked]= useState(false);

  // ── Card payment sub-mode ──────────────────────────────────────────────────
  // 'select'       = choose which card method
  // 'cof_confirm'  = confirming card-on-file charge
  // 'cof_charging' = actively charging card on file
  // 'terminal'     = terminal reader flow
  // 'new_card'     = embedded browser card form
  type CardMode = 'select' | 'cof_tip' | 'cof_confirm' | 'cof_charging' | 'terminal' | 'new_card';
  const [cardMode,        setCardMode]        = useState<CardMode>('select');
  const [isCofCharging,   setIsCofCharging]   = useState(false);
  const [saveNewCard,     setSaveNewCard]      = useState(true);
  const [stripePaymentId, setStripePaymentId] = useState<string | null>(null);

  const terminal = useTerminalSafe();

  const isOwnerOrAdmin = role === 'owner' || role === 'admin';

  const selectedClient = useMemo(
    () => clients.find((c: Client) => c.id === selectedClientId),
    [selectedClientId, clients]
  );

  const hasCardOnFile = !!hasRealCard(selectedClient);
  const readerConnected = terminal?.readerStatus === 'connected';

  const isBirthdayToday = useMemo(() => {
    if (!selectedClient?.birthday) return false;
    const birth = safeDate(selectedClient.birthday);
    const today = new Date();
    return birth.getDate() === today.getDate() && birth.getMonth() === today.getMonth();
  }, [selectedClient]);

  const isMember  = !!(selectedClient?.activeMembershipId || selectedClient?.subscription);

  const checkoutConsentForm = null;
  const hasPackage = (selectedClient?.activePackages?.length || 0) > 0;

  const filteredPayerOptions = useMemo(() => {
    // Group checkout: only show clients from selected appointments
    // Individual checkout: search the full client list
    const listToFilter = isGroupCheckout ? (payerOptions || []) : (clients || []);
    if (!clientSearch.trim()) return listToFilter.slice(0, 8);
    const search = clientSearch.toLowerCase();
    return listToFilter.filter((c: Client) =>
      c.name.toLowerCase().includes(search) ||
      (c.email && c.email.toLowerCase().includes(search)) ||
      (c.phone && c.phone.includes(search))
    ).slice(0, 20);
  }, [payerOptions, clients, clientSearch, isGroupCheckout]);

  const handleUpdateQuantity = (itemId: string, newQuantity: number) => {
    if (newQuantity <= 0) onCartChange(cart.filter((item: any) => item.id !== itemId));
    else onCartChange(cart.map((item: any) => item.id === itemId ? { ...item, quantity: newQuantity } : item));
  };

  const cartServiceIds = useMemo(() => {
    const appointmentServiceIds = (appointmentsData || []).map((a: any) => a.appointment.serviceId);
    const cartServices          = (cart || []).filter((item: any) => item.type === 'service').map((item: any) => item.id);
    const appointmentAddOnIds   = (appointmentsData || []).flatMap((a: any) => a.appointment.addOnIds || []);
    return [...new Set([...appointmentServiceIds, ...cartServices, ...appointmentAddOnIds])];
  }, [cart, appointmentsData]);

  const allInvolvedStaff = useMemo(() => {
    const staffIds = new Set<string>();
    (appointmentsData || []).forEach((data: any) => {
      if (data.appointment.staffId) staffIds.add(data.appointment.staffId);
      if (data.appointment.checkoutState?.serviceStaffOverrides) {
        Object.values(data.appointment.checkoutState.serviceStaffOverrides).forEach((id: any) => {
          if (id && typeof id === 'string') staffIds.add(id);
        });
      }
    });
    return (staff || []).filter((s: Staff) => staffIds.has(s.id));
  }, [appointmentsData, staff]);

  // Academy student-salon providers: their program decides tips —
  // 'student' (as normal), 'school' (goes to the school, not the student's pay), 'none'.
  const studentsNoTips = allInvolvedStaff.length > 0 && allInvolvedStaff.every((s: any) => s.isStudent && s.tipPolicy === 'none');
  const handleTotalTipChange = useCallback((value: number) => {
    let roundedValue = Number(safeNumber(value).toFixed(2));
    if (allInvolvedStaff.length > 0 && allInvolvedStaff.every((s: any) => s.isStudent && s.tipPolicy === 'none')) roundedValue = 0;
    setTipAmount(roundedValue);
    if (allInvolvedStaff.length > 0) {
      const splitAmount = Number((roundedValue / allInvolvedStaff.length).toFixed(2));
      const newAllocations: Record<string, number> = {};
      let currentTotal = 0;
      allInvolvedStaff.forEach((member: Staff, index: number) => {
        const policy = (member as any).isStudent ? ((member as any).tipPolicy || 'school') : 'staff';
        const key = policy === 'school' || policy === 'none' ? '__school' : member.id;   // school tips: kept by the business, never in a student's pay
        const share = index === allInvolvedStaff.length - 1 ? Number((roundedValue - currentTotal).toFixed(2)) : splitAmount;
        if (index !== allInvolvedStaff.length - 1) currentTotal += splitAmount;
        newAllocations[key] = Number(((newAllocations[key] || 0) + share).toFixed(2));
      });
      setTipAllocations(newAllocations);
    }
  }, [allInvolvedStaff, setTipAmount, setTipAllocations]);

  // Re-split the tip across staff only when the staff list changes —
  // NOT when tipAmount changes, since handleTotalTipChange itself sets
  // tipAmount, which would otherwise create an infinite render loop.
  const prevStaffCountRef = useRef(allInvolvedStaff.length);
  useEffect(() => {
    if (allInvolvedStaff.length !== prevStaffCountRef.current) {
      prevStaffCountRef.current = allInvolvedStaff.length;
      if (tipAmount > 0) handleTotalTipChange(tipAmount);
    }
  }, [allInvolvedStaff.length, handleTotalTipChange, tipAmount]);

  const handleApplyDiscount = (code: string) => {
    const codeUpper = code.trim().toUpperCase();
    if (!codeUpper) return;
    const d = discounts.find((d: any) => d.code.toUpperCase() === codeUpper);
    if (d) {
      // Same rules as online booking: switched on, within its dates, under its
      // usage limit, not already used by this client, covers these services.
      const problem = offerProblem(d, { clientId: offerClientId, serviceIds: cartServiceIds?.length ? cartServiceIds : offerServiceIds });
      if (problem) return toast({ variant: 'destructive', title: 'Can’t use that code', description: problem });
      if (appliedDiscountCodes.includes(d.code)) return;
      if (!allowStacking) setAppliedDiscountCodes([d.code]);
      else setAppliedDiscountCodes([...appliedDiscountCodes, d.code]);
      setPromoCodeInput('');
    } else toast({ variant: 'destructive', title: 'Invalid Code' });
  };

  const isPerkExhausted = (client: Client, perkId: string, membership: Membership) => {
    if (!client.subscription || client.subscription.status !== 'active') return true;
    const usageCount = safeNumber(client.subscription?.perkUsage?.[perkId]);
    const perkDef    = membership.includedServices?.find(s => s.id === perkId) || membership.includedAddOns?.find(a => a.id === perkId);
    const limit      = safeNumber(perkDef?.quantity || 1);
    if (usageCount >= limit) return true;
    if (!client.subscription?.nextBillingDate) return false;
    const lastUsedStr = client.subscription.perkLastUsed;
    if (!lastUsedStr) return false;
    const lastUsed   = safeDate(lastUsedStr);
    const nextBilling = safeDate(client.subscription.nextBillingDate);
    const cycleStart  = membership.interval === 'yearly' ? subYears(nextBilling, 1) : subMonths(nextBilling, 1);
    if (!isAfter(lastUsed, cycleStart)) return false;
    return usageCount >= limit;
  };

  const availableEntitlements = useMemo(() => {
    if (!selectedClient) return [];
    const items: any[] = [];
    if (selectedClient.activeMembershipId && memberships) {
      const membership = memberships.find((m: any) => m.id === selectedClient.activeMembershipId);
      if (membership) {
        membership.includedServices?.forEach((perk: any) => {
          if (cartServiceIds.includes(perk.id)) {
            const exhausted = isPerkExhausted(selectedClient, perk.id, membership);
            items.push({ type: 'membership', id: membership.id, itemId: perk.id, label: perk.name, subLabel: 'Membership Perk', exhausted, usage: `${safeNumber(selectedClient.subscription?.perkUsage?.[perk.id])}/${perk.quantity}` });
          }
        });
        membership.includedAddOns?.forEach((perk: any) => {
          if (cartServiceIds.includes(perk.id)) {
            const exhausted = isPerkExhausted(selectedClient, perk.id, membership);
            items.push({ type: 'membership', id: membership.id, itemId: perk.id, label: perk.name, subLabel: 'Membership Perk (Add-on)', exhausted, usage: `${safeNumber(selectedClient.subscription?.perkUsage?.[perk.id])}/${perk.quantity}` });
          }
        });
      }
    }
    selectedClient.activePackages?.forEach((p: any) => {
      const pkgDef = packages?.find((pkg: any) => pkg.id === p.packageId);
      if (pkgDef && cartServiceIds.includes(pkgDef.serviceId)) {
        items.push({ type: 'package', id: pkgDef.id, itemId: pkgDef.serviceId, label: pkgDef.name, subLabel: 'Prepaid Bundle', exhausted: p.sessionsRemaining <= 0, usage: `${p.sessionsRemaining} left` });
      }
    });
    return items;
  }, [selectedClient, memberships, packages, cartServiceIds]);

  const handleRedeem = (entitlement: any) => {
    if (entitlement.exhausted) return toast({ variant: 'destructive', title: 'Perk Exhausted', description: 'Usage limit reached for this cycle.' });
    setRedeemedOffer({ type: entitlement.type, id: entitlement.id, itemId: entitlement.itemId });
    toast({ title: 'Entitlement Applied', description: `${entitlement.label} redeemed.` });
  };

  const handleApplyRecoveryPreset = (preset: any) => {
    const amount = preset.type === 'percentage' ? subtotal * (preset.value / 100) : preset.value;
    setRecoveryAmount(Number(amount.toFixed(2)));
    setRecoveryReason(preset.label);
    toast({ title: 'Protocol Active', description: `${preset.label} applied.` });
  };

  const handleWaiveClick = (aptId: string) => {
    setPendingWaiveAptId(aptId);
    setIsPointOfSaleWaiveAuthOpen(true);
  };

  const handleConfirmWaive = (authorizer: Staff, reason: string) => {
    if (pendingWaiveAptId) {
      onWaiveFeeToggle(pendingWaiveAptId, true, authorizer.id, reason, (authorizer as any).approvalToken);
      setIsPointOfSaleWaiveAuthOpen(false);
      setPendingWaiveAptId(null);
      toast({ title: 'Fees Absorbed' });
    }
  };

  const isCartEmpty = appointmentsData.length === 0 && cart.length === 0 && appliedAdjustments.size === 0;
  const totalDiscount     = safeNumber(discount) + safeNumber(membershipDiscount);
  const totalWithRecovery = safeNumber(discount) + safeNumber(membershipDiscount) + safeNumber(recoveryAmount);
  const isFullyComped     = Math.round(recoveryAmount * 100) >= Math.round(subtotal * 100) && subtotal > 0;

  // ── Credit for already-paid deposits ────────────────────────────────────────
  // Only credits deposits whose service hasn't been explicitly marked
  // depositAppliesToBalance: false (e.g. non-refundable booking fees, or
  // deposits that belong to a booth renter rather than the studio).
  const totalPaidDeposits = useMemo(() => {
    return (appointmentsData || []).reduce((sum: number, data: any) => {
      const apt = data.appointment;
      const appliesToBalance = data.service?.depositAppliesToBalance !== false;
      if (apt?.depositStatus === 'paid' && apt?.depositAmountCents > 0 && appliesToBalance) {
        return sum + (apt.depositAmountCents / 100);
      }
      return sum;
    }, 0);
  }, [appointmentsData]);

  const finalTotal        = isFullyComped
    ? Math.max(0, tipAmount)
    : Math.max(0, subtotal - totalWithRecovery + (Number(tax) || 0) + tipAmount - totalPaidDeposits);

  // ── Card processing fee passthrough ─────────────────────────────────────────
  // Opt-in per studio via tenant.cardSurchargeEnabled. Rate defaults to 3% if
  // tenant.cardSurchargeRate isn't set. Only applies on the Card tab — cash
  // and "other" payment methods never carry a card processing fee.
  // NOTE: this is a flat estimate, not the exact Stripe fee for this specific
  // card (which varies by card type/region and isn't known until after the
  // charge settles). The estimate is charged to the client; the *actual* fee
  // Stripe takes is recorded separately via the connect-webhook's
  // charge.succeeded handler — the two are reported as separate ledger lines
  // (Card Processing Fee income vs. Processing Fee expense), not netted,
  // since they're each independently relevant for tax reporting.
  const cardSurchargeEnabled = !!selectedTenant?.cardSurchargeEnabled;
  const cardSurchargeRate    = safeNumber(selectedTenant?.cardSurchargeRate) || 0.03;
  const isCardTab             = paymentTab === 'card';
  const cardSurcharge = (cardSurchargeEnabled && isCardTab && finalTotal > 0)
    ? Number((finalTotal * cardSurchargeRate).toFixed(2))
    : 0;
  const amountToCharge = Number((finalTotal + cardSurcharge).toFixed(2));

  const autonomyLimit          = safeNumber(selectedTenant?.maxAutonomousRecoveryAmount) || 0;
  const autonomyPercent        = safeNumber(selectedTenant?.maxAutonomousRecoveryPercent) || 0;
  const currentRecoveryPercent = subtotal > 0 ? (recoveryAmount / subtotal) * 100 : 0;
  const isOverAutonomy         = (autonomyLimit > 0 && recoveryAmount > autonomyLimit) || (autonomyPercent > 0 && currentRecoveryPercent > autonomyPercent);

  // ── Card on file charge ────────────────────────────────────────────────────
  const handleCofCharge = async () => {
    if (!selectedClient || !tenantId) return;
    setIsCofCharging(true);
    try {
      const res = await fetch('/api/stripe/charge-card', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', ...(await staffAuthHeader()) },
        body:    JSON.stringify({
          tenantId,
          clientId:    selectedClient.id,
          amountCents: Math.round(amountToCharge * 100),
          surchargeAmountCents: Math.round(cardSurcharge * 100),
          description: 'Studio Services — POS Checkout',
          category:    'Service Revenue',
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setStripePaymentId(data.paymentIntentId);
        toast({ title: 'Card Charged', description: `$${amountToCharge.toFixed(2)} charged successfully.` });
        // Proceed with the rest of the checkout flow using 'card_on_file' as payment method
        // Save COF payment intent id for after signature
        await onCheckout({ paymentMethod: 'card_on_file', amountTendered: amountToCharge, recoveryAmount, recoveryReason, recoveryApprovalToken, stripePaymentIntentId: data.paymentIntentId, skipLedger: true, cardSurcharge });
        setCardMode('select');
      } else {
        toast({ variant: 'destructive', title: 'Charge Failed', description: data.reason || 'Could not charge card on file.' });
        setCardMode('select');
      }
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Charge Failed', description: err.message });
      setCardMode('select');
    } finally {
      setIsCofCharging(false);
    }
  };

  // ── Terminal payment ───────────────────────────────────────────────────────
  const handleTerminalPayment = async () => {
    if (!terminal || !readerConnected) {
      toast({ variant: 'destructive', title: 'No Reader', description: 'Connect a Terminal reader in Settings first.' });
      return;
    }
    setCardMode('terminal');
    const result = await terminal.collectPayment({
      tenantId,
      clientId:    selectedClient?.id,
      amountCents: Math.round(amountToCharge * 100),
      description: 'Studio Services',
      saveCard:    saveNewCard && !!selectedClient,
    });
    if (result.ok) {
      await onCheckout({ paymentMethod: 'terminal', amountTendered: amountToCharge, recoveryAmount, recoveryReason, recoveryApprovalToken, stripePaymentIntentId: result.paymentIntentId, skipLedger: false, cardSurcharge });
      setCardMode('select');
    }
  };

  // Reset card mode when payment tab changes
  // ── The client screen (an iPad at the desk): live ticket, tip, card-on-file approval, thank-you ──
  const cs = useClientScreen(tenantId);
  // ── What kind of sale is this? (lib/sale-profile) — tip, rebooking, moments and signatures follow it ──
  const profile = useMemo(() => {
    const csS = (selectedTenant as any)?.clientScreen || {};
    const visits = (appointmentsData || []).map((d: any) => ({ clientId: d.appointment?.clientId || null, clientName: d.appointment?.clientName || (clients || []).find((c: any) => c.id === d.appointment?.clientId)?.name || null,
      serviceId: d.service?.id || d.appointment?.serviceId || null, serviceName: d.service?.name || null, staffId: d.appointment?.staffId || null, addOnIds: d.appointment?.addOnIds || [], appointmentId: d.appointment?.id || null,
      amount: safeNumber(getServicePrice(d.service, d.staff)) }));
    const items = (cart || []).map((it: any) => ({ type: it.type || ((it as any).interval ? 'membership' : 'product'), name: it.name, id: it.id, interval: (it as any).interval, price: safeNumber(it.price), amount: safeNumber(it.price) * safeNumber(it.quantity || 1), depositForLabel: (it as any).depositForLabel || null }));
    const fees = Array.from(appliedAdjustments || []).map((id: any) => (clients || []).flatMap((c: any) => c.unpaidFees || []).find((x: any) => x.feeId === id)).filter(Boolean).map((f: any) => ({ name: f.reason, amount: safeNumber(f.feeAmount) }));
    return saleProfileOf({ visits, items, fees, payerId: selectedClientId || null, payerName: selectedClient?.name || null }, { tipScope: ['services_retail', 'everything'].includes(csS.tipScope) ? csS.tipScope : 'services', membershipTerms: csS.membershipTerms || '' });
  }, [appointmentsData, cart, appliedAdjustments, clients, selectedClientId, selectedClient, selectedTenant]);
  const splitLines = useMemo(() => {
    const out: any[] = [];
    for (const d of appointmentsData || []) { const who = d.appointment?.clientId || selectedClientId || null; const nm = d.appointment?.clientName || (clients || []).find((c: any) => c.id === who)?.name || null;
      out.push({ key: `v-${d.appointment?.id}`, label: d.service?.name || 'Service', amount: safeNumber(getServicePrice(d.service, d.staff)), personId: who, personName: nm });
      for (const id of d.appointment?.addOnIds || []) { const ad = (services || []).find((x: any) => x.id === id); if (ad) out.push({ key: `a-${d.appointment?.id}-${id}`, label: `+ ${ad.name}`, amount: safeNumber(getServicePrice(ad, d.staff)), personId: who, personName: nm }); } }
    for (const it of cart || []) out.push({ key: `i-${it.id}`, label: it.name, amount: safeNumber(it.price) * safeNumber(it.quantity || 1), personId: selectedClientId || null, personName: selectedClient?.name || null });
    return out.filter((l) => l.amount > 0);
  }, [appointmentsData, cart, services, clients, selectedClientId, selectedClient]);
  const splitPeople = useMemo(() => { const ids = new Set<string>([selectedClientId, ...splitLines.map((l: any) => l.personId)].filter(Boolean) as string[]);
    return [...ids].map((id) => { const c: any = (clients || []).find((x: any) => x.id === id); return { id, name: c?.name || 'Guest', card: c?.cardOnFile?.paymentMethodId ? `${String(c.cardOnFile.brand || 'card')} ${c.cardOnFile.last4 || ''}`.trim() : null }; }); }, [splitLines, clients, selectedClientId]);
  const lastProfileRef = useRef<any>(null); if (!isCartEmpty) lastProfileRef.current = profile;   // remembered for the thank-you (the cart is empty by then)
  const screenTicket = useMemo(() => {
    const momentLines = (moments || []).map((m: any) => m.screenLine).slice(0, 2);
    if (isCartEmpty) return selectedClient ? { clientFirst: String(selectedClient?.name || '').split(' ')[0], lines: [], moments: momentLines, subtotal: 0, discount: 0, tax: 0, tip: 0, total: 0, paid: 0, due: 0 } : null;
    const lines: any[] = [];
    for (const d of appointmentsData || []) {
      const o = d.appointment?.checkoutState?.serviceStaffOverrides || {};
      const forWho = d.appointment?.clientId && d.appointment.clientId !== selectedClientId ? String((clients || []).find((c: any) => c.id === d.appointment.clientId)?.name || d.appointment.clientName || '').split(' ')[0] : '';
      lines.push({ label: d.service?.name || 'Service', amount: redeemedOffer?.itemId === d.service?.id ? 0 : safeNumber(getServicePrice(d.service, d.staff)), note: forWho ? `for ${forWho}` : null });
      for (const id of d.appointment?.addOnIds || []) { const ad = (services || []).find((x: any) => x.id === id); if (ad) lines.push({ label: `+ ${ad.name}`, amount: redeemedOffer?.itemId === id ? 0 : safeNumber(getServicePrice(ad, (staff || []).find((m: any) => m.id === (o[id] || d.appointment.staffId)))) }); }
    }
    for (const it of cart || []) lines.push({ label: `${it.name}${it.quantity > 1 ? ` ×${it.quantity}` : ''}`, amount: safeNumber(it.price) * safeNumber(it.quantity) });
    for (const id of Array.from(appliedAdjustments || [])) { const f = (clients || []).flatMap((c: any) => c.unpaidFees || []).find((x: any) => x.feeId === id); if (f) lines.push({ label: f.reason || 'Owed balance', amount: safeNumber(f.feeAmount) }); }
    return { clientFirst: String(selectedClient?.name || '').split(' ')[0], lines, moments: profile.moments ? momentLines : [], context: profile.context, subtotal: safeNumber(subtotal), discount: safeNumber(totalDiscount) + safeNumber(recoveryAmount), tax: safeNumber(tax), taxLabel: taxLabel || 'Sales tax', tip: safeNumber(tipAmount), total: safeNumber(finalTotal) + safeNumber(totalPaidDeposits), paid: safeNumber(totalPaidDeposits), due: safeNumber(isCardTab ? amountToCharge : finalTotal) };
  }, [profile, moments, isCartEmpty, appointmentsData, cart, appliedAdjustments, clients, services, staff, redeemedOffer, selectedClient, selectedClientId, subtotal, totalDiscount, recoveryAmount, tax, taxLabel, tipAmount, finalTotal, totalPaidDeposits, isCardTab, amountToCharge]);
  const screenTicketKey = JSON.stringify(screenTicket);
  useEffect(() => { if (!cs.connected || (lastSale && isCartEmpty)) return; const t = setTimeout(() => { cs.push(screenTicket); }, 500); return () => clearTimeout(t); }, [cs.connected, screenTicketKey, !!lastSale]); // eslint-disable-line react-hooks/exhaustive-deps
  const thankedRef = useRef<string | null>(null);
  const rebookCtxOf = (_ls: any) => { const rb = lastProfileRef.current?.rebook; return rb ? { clientId: rb.clientId, serviceId: rb.serviceId, staffId: rb.staffId, addOnIds: rb.addOnIds || [], appointmentId: rb.appointmentId } : null; };   // retail-only, fees, memberships… → no rebooking
  useEffect(() => { if (cs.connected && lastSale?.receiptId && thankedRef.current !== lastSale.receiptId) { thankedRef.current = lastSale.receiptId; cs.ask('thanks', { receiptId: lastSale.receiptId, total: lastSale.collected ?? lastSale.total, clientFirst: String(lastSale.clientName || '').split(' ')[0], rebook: rebookCtxOf(lastSale) }); } }, [cs.connected, lastSale?.receiptId]); // eslint-disable-line react-hooks/exhaustive-deps
  const [tipReq, setTipReq] = useState<string | null>(null);
  const [cofReq, setCofReq] = useState<{ id: string | null; amount: number; status: 'waiting' | 'approved' | 'declined'; consentId?: string | null } | null>(null);
  const [cofSkip, setCofSkip] = useState(false);
  useEffect(() => {
    const r = cs.response; if (!r) return;
    if (tipReq && r.requestId === tipReq && r.kind === 'tip') { handleTotalTipChange(safeNumber(r.tip)); setTipReq(null); toast({ title: safeNumber(r.tip) > 0 ? `Tip added — ${'$'}${safeNumber(r.tip).toFixed(2)}` : 'No tip' }); }
    if (r.kind === 'rebook' && r.booked) toast({ title: `${String(lastSale?.clientName || '').split(' ')[0] || 'They'} booked their next visit`, description: r.label });
    if (cofReq?.id && r.requestId === cofReq.id && r.kind === 'approve') setCofReq({ ...cofReq, status: r.approved ? 'approved' : 'declined', consentId: r.consentId || null });
  }, [cs.response?.requestId]); // eslint-disable-line react-hooks/exhaustive-deps
  // ── The automatic flow (Settings → Client screen → "Run it automatically"): the iPad follows the checkout ──
  const csSet = (selectedTenant as any)?.clientScreen || {};
  const autoOn = cs.connected && csSet.auto !== false;
  const autoTipOn = autoOn && csSet.autoTip !== false && !studentsNoTips && profile.tip.ask;   // never on a fee / deposit / membership-only sale
  const ticketKey = `${selectedClientId || ''}|${(appointmentsData || []).map((d: any) => d.appointment?.id).join(',')}|${(cart || []).map((c: any) => `${c.id}x${c.quantity}`).join(',')}`;
  const tipAskedFor = useRef<string | null>(null);
  const tipBase = Math.round((profile.tip.base * (csSet.tipOn === 'after_tax' && safeNumber(subtotal) > 0 ? 1 + safeNumber(tax) / safeNumber(subtotal) : 1)) * 100) / 100;   // the tippable lines only
  const askTipAuto = async () => { if (tipAskedFor.current === ticketKey || tipReq) return; tipAskedFor.current = ticketKey; const id = await cs.ask('tip', { base: tipBase }); if (id) setTipReq(id); };
  // Card on file asks for the tip on the iPad first (once per ticket). Cash doesn't: the iPad shows the total, then
  // their change with "Keep it as a tip" / "My change, please" — that's the tip moment for cash.
  useEffect(() => { if (!autoTipOn || isCartEmpty) return; if (paymentTab === 'card' && cardMode === 'cof_tip') askTipAuto(); }, [autoTipOn, paymentTab, cardMode, ticketKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // Card on file: when the tip's chosen, move on; then the approval request goes to the iPad by itself.
  useEffect(() => { if (autoOn && paymentTab === 'card' && cardMode === 'cof_tip' && tipAskedFor.current === ticketKey && !tipReq) setCardMode('cof_confirm'); }, [autoOn, tipReq, cardMode, paymentTab, ticketKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const cofAutoSent = useRef<string | null>(null);
  // Cash: the iPad shows what's due, then their change — with "keep it as a tip".
  const cashShown = useRef<string>('');
  const changeDoneFor = useRef<number | null>(null);
  const [changeReq, setChangeReq] = useState<{ id: string; change: number } | null>(null);
  useEffect(() => {
    if (!autoOn || paymentTab !== 'cash' || isCartEmpty || tipReq || lastSale) return;
    const due = Math.round(safeNumber(finalTotal) * 100) / 100; const tendered = Math.round(safeNumber(amountTendered) * 100) / 100; const change = Math.round((tendered - due) * 100) / 100;
    const key = `${due}|${tendered}`; if (cashShown.current === key || (changeDoneFor.current !== null && changeDoneFor.current === tendered)) return;
    const t = setTimeout(async () => { cashShown.current = key;
      if (tendered > 0 && change > 0.009) { const id = await cs.ask('change', { due, tendered, change }); if (id) setChangeReq({ id, change }); }
      else cs.ask('cash', { due }); }, 600);
    return () => clearTimeout(t);
  }, [autoOn, paymentTab, finalTotal, amountTendered, tipReq, isCartEmpty, lastSale]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const r = cs.response; if (!r || !changeReq || r.requestId !== changeReq.id || r.kind !== 'change') return;
    const kept = Math.min(changeReq.change, safeNumber(r.keepAmount ?? (r.keep ? changeReq.change : 0)));
    changeDoneFor.current = Math.round(safeNumber(amountTendered) * 100) / 100;   // the total grows by the tip — don't ask again for the same cash
    if (kept > 0) { handleTotalTipChange(Math.round((safeNumber(tipAmount) + kept) * 100) / 100); const back = Math.round((changeReq.change - kept) * 100) / 100;
      toast({ title: `They kept ${'$'}${kept.toFixed(2)} as a tip`, description: back > 0 ? `Give them ${'$'}${back.toFixed(2)} change.` : 'No change to give.' }); }
    else toast({ title: `Give them ${'$'}${changeReq.change.toFixed(2)} change` });
    setChangeReq(null); }, [cs.response?.requestId]); // eslint-disable-line react-hooks/exhaustive-deps
  // The client pays on the iPad (card form) or their phone (QR). Tip first when automatic; then the sale completes by itself.
  const [payReq, setPayReq] = useState<{ id: string; amount: number } | null>(null);
  const [payAfterTip, setPayAfterTip] = useState(false);
  const payOnIpadOn = cs.connected && csSet.payOnScreen !== false || cs.connected && csSet.payOnPhone !== false;
  // One request: the iPad runs review → tip → pay by itself (the tip is added to the payment on the server).
  const sendPayToScreen = async () => { const amount = Math.round(safeNumber(amountToCharge) * 100) / 100; const askTip = autoTipOn && safeNumber(tipAmount) === 0;
    const id = await cs.ask('pay', { amount, clientId: selectedClient?.id || null, pendingId: getPendingId?.() || null, askTip, tipBase });
    if (id) setPayReq({ id, amount }); else toast({ variant: 'destructive', title: 'The client screen couldn’t start the payment', description: 'Check Stripe is connected, or take the card another way.' }); };
  const startPayOnIpad = () => { tipAskedFor.current = ticketKey; sendPayToScreen(); };
  useEffect(() => { const r = cs.response; if (!r || !payReq || r.requestId !== payReq.id || r.kind !== 'pay' || !r.paid) return;
    const amt = payReq.amount; setPayReq(null);
    if (r.saved) toast({ title: 'Card saved for next time' });
    onCheckout({ paymentMethod: 'card', amountTendered: safeNumber(r.amount) || amt, recoveryAmount, recoveryReason, recoveryApprovalToken, stripePaymentIntentId: r.paymentIntentId, cardSurcharge, tipOverride: Math.round((safeNumber(tipAmount) + safeNumber(r.tip)) * 100) / 100 });
  }, [cs.response?.requestId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setCofReq(null); setCofSkip(false); setTipReq(null); setChangeReq(null); setPayReq(null); setPayAfterTip(false); setSignReq(null); cashShown.current = ''; changeDoneFor.current = null; }, [selectedClientId, lastSale?.receiptId]);   // never carry one client's approval to the next
  // ── When things change, nothing is left hanging on the iPad ──
  // Another client → cancel whatever was waiting (a tip, an approval, a payment — cancelled at Stripe).
  const prevClientRef = useRef<string | null>(selectedClientId || null);
  useEffect(() => { const prev = prevClientRef.current; prevClientRef.current = selectedClientId || null;
    if (cs.connected && prev && prev !== (selectedClientId || null) && !lastSale) cs.ask('idle'); }, [selectedClientId]); // eslint-disable-line react-hooks/exhaustive-deps
  // Another payment type while they were paying on the iPad → cancel that payment (cash sends its own screen).
  useEffect(() => { if (!payReq) return; if (paymentTab !== 'card' || cardMode !== 'select') { setPayReq(null); if (paymentTab !== 'cash') cs.ask('idle'); } }, [paymentTab, cardMode]); // eslint-disable-line react-hooks/exhaustive-deps
  // What the iPad reports back: they walked away (cancelled), or a payment went through after the desk moved on.
  useEffect(() => { const r = cs.response; if (!r || r.kind !== 'pay') return;
    if (r.abandoned && payReq && r.requestId === payReq.id) { setPayReq(null); toast({ title: 'They didn’t finish paying', description: 'The payment on the iPad was cancelled — nothing was charged.' }); }
    if (r.late) toast({ variant: 'destructive', title: 'A payment went through on the iPad', description: 'It’s in Needs attention → Sales not recorded — record it there.' }); }, [cs.response?.requestId, cs.response?.abandoned, cs.response?.late]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const late = () => toast({ variant: 'destructive', title: 'A payment went through on the iPad before you switched', description: 'It’s in Needs attention → Sales not recorded — record it there.' });
    window.addEventListener('cf:screen-late-payment', late); return () => window.removeEventListener('cf:screen-late-payment', late); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // Membership terms: sent to the iPad to sign as soon as a membership is on the ticket.
  const [signReq, setSignReq] = useState<{ id: string | null; ref: string; status: 'waiting' | 'signed' | 'paper' } | null>(null);
  useEffect(() => { const sg = profile.sign; if (!autoOn || !sg || !selectedClient || csSet.signMembership === false || lastSale) return; if (signReq?.ref === sg.ref) return;
    cs.ask('sign', { title: sg.title, text: sg.text, what: sg.what, ref: sg.ref, clientId: selectedClient.id, clientName: selectedClient.name }).then((id: any) => setSignReq({ id: id || null, ref: sg.ref, status: 'waiting' })); }, [autoOn, profile.sign?.ref, selectedClient?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const r = cs.response; if (r?.kind === 'sign' && r.signed && signReq && signReq.id === r.requestId) setSignReq({ id: signReq.id, ref: signReq.ref, status: 'signed' }); }, [cs.response?.requestId]); // eslint-disable-line react-hooks/exhaustive-deps
  // Closing checkout (Done, closing the drawer, leaving the page) → the iPad goes back to the logo (unless they're mid-booking).
  const askRef = useRef(cs.ask); askRef.current = cs.ask; const connRef = useRef(cs.connected); connRef.current = cs.connected;
  useEffect(() => () => { if (connRef.current) askRef.current('idle', { soft: true }); }, []);
  // "Still here" — if the desk goes quiet (tablet asleep, browser closed), the iPad returns to the logo by itself.
  useEffect(() => { if (!cs.connected) return; const t = setInterval(() => { cs.alive?.(); }, 45000); return () => clearInterval(t); }, [cs.connected]); // eslint-disable-line react-hooks/exhaustive-deps
  const cofApproved = !cs.connected || cofSkip || (cofReq?.status === 'approved' && Math.abs(cofReq.amount - amountToCharge) < 0.005);
  useEffect(() => { if (!autoOn || paymentTab !== 'card' || cardMode !== 'cof_confirm' || !selectedClient || cofSkip) return;
    const k = `${ticketKey}|${amountToCharge}`; if (cofAutoSent.current === k || (cofReq && Math.abs(cofReq.amount - amountToCharge) < 0.005)) return; cofAutoSent.current = k;
    cs.ask('approve', { amount: amountToCharge, cardLabel: `${String(selectedClient?.cardOnFile?.brand || 'card')} ending ${String(selectedClient?.cardOnFile?.last4 || '••••')}`, clientId: selectedClient.id, clientName: selectedClient.name }).then((id: any) => { if (id) setCofReq({ id, amount: amountToCharge, status: 'waiting' }); });
  }, [autoOn, paymentTab, cardMode, amountToCharge, cofSkip, ticketKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setCardMode('select'); }, [paymentTab]);
  if (lastSale && isCartEmpty) return <div className="desk" style={{ background: 'transparent' }}><style>{DESK_CSS}</style><SaleComplete autoReturnSec={Number((selectedTenant as any)?.clientScreen?.deskReturnAfter ?? 10)} screenName={cs.connected ? cs.name : null} onBookOnScreen={cs.connected ? () => { cs.ask('thanks', { receiptId: lastSale.receiptId, total: lastSale.collected ?? lastSale.total, clientFirst: String(lastSale.clientName || '').split(' ')[0], rebook: rebookCtxOf(lastSale), rebookFirst: true }); toast({ title: `Booking their next visit on ${cs.name}` }); } : undefined} sale={lastSale} tenantId={tenantId} onNewSale={() => { clearLastSale?.(); if (cs.connected) cs.ask('idle', { soft: true }); }} onDone={onDone} /></div>;   // after the last hook



  const coMoney = (n: any) => `$${safeNumber(n).toFixed(2)}`;
  const firstOf = (n: any) => String(n || '').split(' ')[0];
  const sdLimitRaw = (selectedTenant as any)?.approvalRules?.staffDiscountLimitPct;
  const sdLimitPct = Number.isFinite(Number(sdLimitRaw)) && sdLimitRaw !== null && sdLimitRaw !== undefined ? Number(sdLimitRaw) : 10;
  const sdIsManager = ['owner', 'admin', 'manager'].includes(String(role || '').toLowerCase());
  const sdDraftDollars = !sdValue ? 0 : Math.min(safeNumber(subtotal), sdKind === 'pct' ? safeNumber(subtotal) * (safeNumber(sdValue) / 100) : safeNumber(sdValue));
  const sdDraftPct = safeNumber(subtotal) > 0 ? (sdDraftDollars / safeNumber(subtotal)) * 100 : 0;
  const sdNeedsApproval = !sdIsManager && sdDraftPct > sdLimitPct + 0.001;
  const applyStaffDiscount = async () => {
    if (!sdDraftDollars || !sdReason.trim()) { toast({ variant: 'destructive', title: 'Add an amount and a reason' }); return; }
    let approvalToken: string | null = null; let approvedBy: string | null = null;
    if (sdNeedsApproval) {
      const ap = await approveWithPin(tenantId, sdPin, { kind: 'discount', amount: Number(sdDraftDollars.toFixed(2)), reason: sdReason.trim() });
      if (!ap.ok || !ap.approver) { toast({ variant: 'destructive', title: 'Not approved', description: ap.error || 'A manager needs to approve this discount.' }); return; }
      approvalToken = ap.token || null; approvedBy = ap.approver.name;
    }
    setStaffDiscount?.({ kind: sdKind, value: safeNumber(sdValue), reason: sdReason.trim(), approvalToken, approvedBy });
    setSdOpen(false); setSdPin('');
  };
  const card = 'space-y-3 rounded-3xl p-4';
  const cardStyle = { background: 'var(--card)', border: '1px solid var(--line)' } as React.CSSProperties;
  const h = 'text-[15px] font-semibold';
  const muted = { color: 'var(--muted)' } as React.CSSProperties;
  const inputCls = 'h-11 w-full rounded-xl px-3.5 text-[16px] outline-none';
  const inputStyle = { background: 'var(--paper)', border: '1px solid var(--line)', color: 'var(--ink)' } as React.CSSProperties;
  const pill = (on: boolean) => `rounded-full px-3.5 py-2 text-[13px] font-medium transition ${on ? '' : ''}`;
  const pillStyle = (on: boolean) => (on ? { background: 'var(--accent)', color: 'var(--accent-ink)' } : { background: 'var(--soft)', color: 'var(--ink)' }) as React.CSSProperties;
  const rowBtn = 'flex w-full items-center justify-between gap-3 rounded-2xl p-4 text-left transition active:scale-[.99]';
  const dueNow = isCardTab ? amountToCharge : finalTotal;
  const payBlocked = isCartEmpty || (isGroupCheckout && !selectedClientId) || (isOverAutonomy && !isOverrideUnlocked);
  const accentVar = (selectedTenant as any)?.bookingPageSettings?.cfPageConfig?.accentColor || (selectedTenant as any)?.brandColor || null;
  return (
    <div className="desk co" style={{ background: 'transparent', ...(accentVar ? { ['--accent' as any]: accentVar } : {}) }}>
      <style>{DESK_CSS}{`.co{container-type:inline-size;container-name:co}.co-grid{display:grid;gap:12px;grid-template-columns:minmax(0,1fr)}@container co (min-width:700px){.co-grid{grid-template-columns:minmax(0,1fr) 340px}.co-right{position:sticky;top:0;align-self:start}}`}</style>
      <div className="co-grid">
        <div className="co-left min-w-0 space-y-3">
          <section className={card} style={cardStyle} aria-label="Who's paying">
            <p className={h}>Who’s paying</p>
            {isGroupCheckout && !selectedClientId && !isCartEmpty && <p className="text-[13px]" style={muted}>Anyone can pay — search any client. Each person’s visit still counts for them.</p>}
        <GuestSearch
          clients={clients || []}
          selectedClientId={selectedClientId}
          onSelect={(id) => setSelectedClientId(id)}
          onAddNew={onAddClientClick}
          isGroupCheckout={isGroupCheckout}
          payerOptions={payerOptions || []}
        />
          </section>
          {profile.sign && cs.connected && selectedClient && <section className={card} style={cardStyle} aria-label="Membership terms">
            <p className={h}>Membership terms</p>
            <p className="text-[14px]" style={muted}>{signReq?.status === 'signed' ? `Signed on ${cs.name} ✓` : signReq?.status === 'paper' ? 'Signed on paper.' : signReq ? `Waiting for ${firstOf(selectedClient.name)} to sign on ${cs.name}…` : `Ask ${firstOf(selectedClient.name)} to sign the ${profile.sign.title.replace(/ — terms$/, '')} terms on ${cs.name}.`}</p>
            {signReq?.status !== 'signed' && <div className="flex flex-wrap gap-2">
              <button type="button" onClick={async () => { const sg = profile.sign!; const id = await cs.ask('sign', { title: sg.title, text: sg.text, what: sg.what, ref: sg.ref, clientId: selectedClient.id, clientName: selectedClient.name }); setSignReq({ id: id || null, ref: sg.ref, status: 'waiting' }); }}
                className="h-10 rounded-full px-4 text-[13px] font-semibold" style={{ background: 'var(--soft)' }}>{signReq ? 'Ask again' : 'Send to sign'}</button>
              <button type="button" onClick={() => setSignReq({ id: null, ref: profile.sign!.ref, status: 'paper' })} className="h-10 rounded-full px-4 text-[13px]" style={{ background: 'var(--soft)' }}>Signed on paper</button>
            </div>}
          </section>}
          {selectedClient && tenantId && <CheckoutNudge tenantId={tenantId} client={selectedClient} cart={cart || []} onCartChange={onCartChange} />}
          {(moments || []).map((m: any) => <section key={m.key} className={card} style={{ ...cardStyle, background: 'color-mix(in srgb, var(--accent) 7%, var(--card))' }} aria-label={m.title}>
            <p className={h}>{m.kind === 'birthday' ? '🎂 ' : m.kind === 'first' ? '👋 ' : '✨ '}{m.title}</p>
            <p className="text-[14px]" style={muted}>{m.deskLine}{m.rewardPct > 0 && momentReward?.key === m.key ? (safeNumber(momentDiscountValue) > 0 ? ` −${coMoney(momentDiscountValue)} on this ticket.` : ' (A bigger discount is already applied, so this one isn’t.)') : ''}</p>
          </section>)}
          {selectedClient && availableEntitlements.length > 0 && (
            <section className={card} style={cardStyle} aria-label="Benefits">
              <p className={h}>Their benefits</p>
              <div className="grid gap-2">
                {availableEntitlements.map((ent: any, idx: number) => {
                  const on = redeemedOffer?.itemId === ent.itemId;
                  return <button key={idx} type="button" disabled={ent.exhausted || on} onClick={() => handleRedeem(ent)} className={rowBtn} style={{ background: on ? 'color-mix(in srgb, var(--ok) 10%, transparent)' : 'var(--soft)', opacity: ent.exhausted ? 0.55 : 1 }}>
                    <span><span className="block text-[15px] font-semibold">{ent.label}</span><span className="block text-[13px]" style={muted}>{ent.subLabel}{ent.usage ? ` · ${ent.usage}` : ''}</span></span>
                    <span className="text-[13px] font-semibold">{on ? 'Applied' : ent.exhausted ? 'Used up' : 'Use'}</span>
                  </button>;
                })}
              </div>
            </section>
          )}
          <section className={card} style={cardStyle} aria-label="On this ticket">
            <div className="flex flex-wrap items-center justify-between gap-2"><p className={h}>On this ticket</p>
              <div className="flex gap-1.5">
                {onAddItem && <button type="button" aria-expanded={addOpen} onClick={() => setAddOpen((v) => !v)} className="h-9 rounded-full px-3.5 text-[13px] font-semibold" style={addOpen ? { background: 'var(--accent)', color: 'var(--accent-ink)' } : { background: 'var(--soft)' }}>{addOpen ? 'Done adding' : 'Add to this sale'}</button>}
                {onScanClick && <button type="button" onClick={onScanClick} className="h-9 rounded-full px-3.5 text-[13px] font-semibold" style={{ background: 'var(--soft)' }}>Scan</button>}
              </div></div>
            {addOpen && onAddItem && <div className="rounded-2xl p-3" style={{ background: 'var(--paper)' }}>
              <PosCatalog compact inventory={inventory || []} services={services || []} memberships={memberships || []} packages={packages || []} cart={cart || []} onAdd={(i: any) => onAddItem(i)} onScan={onPosScan ? (c: string) => onPosScan(c) : undefined} />
            </div>}
            {isCartEmpty ? <p className="text-[14px]" style={muted}>Nothing yet — pick a visit, scan a ticket, or add items from the counter.</p> : <div className="space-y-2">
              {appointmentsData.map((data: any) => {
                const isRedeemed = redeemedOffer?.itemId === data.service.id;
                const addOns = (data.appointment.addOnIds || []).map((id: any) => services.find((s: any) => s.id === id)).filter(Boolean);
                const refreshmentsInSession = data.appointment.checkoutState?.refreshments || [];
                const overrides = data.appointment.checkoutState?.serviceStaffOverrides || {};
                const mainStaffMember = staff.find((s: any) => s.id === (overrides[data.service.id] || data.appointment.staffId));
                const adjustments = data.appointment.checkoutState?.adjustments;
                const additionalCharge = safeNumber(data.appointment.checkoutState?.additionalCharge);
                const isWaived = waivedAppointmentFees.has(data.appointment.id);
                const lateFeesForApt = Array.from(appliedAdjustments).map((id: any) => clients.flatMap((c: any) => c.unpaidFees || []).find((f: any) => f.feeId === id)).filter((fee: any) => fee && fee.appointmentId === data.appointment.id);
                const feeRows: [string, number][] = isWaived ? [] : [['Reschedule fee', safeNumber(adjustments?.rescheduleFee)], ['Extra time', safeNumber(adjustments?.timeOverage)], ['Extra materials', safeNumber(adjustments?.materialOverage)], ...(!adjustments && additionalCharge > 0 ? [['Adjustment', additionalCharge] as [string, number]] : [])].filter(([, v]) => Number(v) > 0) as [string, number][];
                const forWho = data.appointment.clientId && data.appointment.clientId !== selectedClientId ? (clients.find((c: any) => c.id === data.appointment.clientId)?.name || data.appointment.clientName) : null;
                return <div key={data.appointment.id} className="space-y-1.5 rounded-2xl p-3" style={{ background: 'var(--soft)' }}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0"><p className="text-[15px] font-semibold">{data.service.name}{isRedeemed ? ' · benefit' : ''}</p>
                      <p className="text-[13px]" style={muted}>{firstOf(mainStaffMember?.name) || 'Provider'} · {data.service.duration}m{forWho ? ` · for ${firstOf(forWho)}` : ''}</p></div>
                    <div className="flex shrink-0 items-center gap-1"><p className="text-[15px] font-semibold tabular-nums">{isRedeemed ? <s style={muted}>{coMoney(getServicePrice(data.service, data.staff))}</s> : coMoney(getServicePrice(data.service, data.staff))}</p>
                      <button type="button" onClick={() => onSelectAppointment(data.appointment.id)} aria-label={`Take ${data.service.name} off this ticket`} className="flex h-9 w-9 items-center justify-center rounded-full" style={{ background: 'var(--card)' }}>✕</button></div>
                  </div>
                  {addOns.map((addon: any) => { const as = staff.find((s: any) => s.id === (overrides[addon.id] || data.appointment.staffId)); const red = redeemedOffer?.itemId === addon.id;
                    return <div key={addon.id} className="flex justify-between gap-2 text-[14px]"><span>+ {addon.name}{as ? <span style={muted}> · {firstOf(as.name)}</span> : null}</span><span className="tabular-nums">{red ? <s style={muted}>{coMoney(getServicePrice(addon, data.staff))}</s> : coMoney(getServicePrice(addon, data.staff))}</span></div>; })}
                  {refreshmentsInSession.map((r: any, idx: number) => { const q = safeNumber(r.quantity || 1); return <div key={`ref-${idx}`} className="flex justify-between gap-2 text-[14px]"><span>{r.name}{q > 1 ? ` ×${q}` : ''}</span><span className="tabular-nums">{safeNumber(r.price) > 0 ? coMoney(safeNumber(r.price) * q) : 'Free'}</span></div>; })}
                  {!isWaived && lateFeesForApt.map((fee: any) => <div key={fee.feeId} className="flex items-center justify-between gap-2 text-[14px]" style={{ color: 'var(--warn)' }}><span>{fee.reason}</span><span className="flex items-center gap-1 tabular-nums">{coMoney(fee.feeAmount)}<button type="button" onClick={() => onApplyAdjustmentToggle(fee.feeId, false)} aria-label={`Remove ${fee.reason}`} className="h-8 w-8 rounded-full" style={{ background: 'var(--card)' }}>✕</button></span></div>)}
                  {feeRows.map(([l, v]) => <div key={l} className="flex justify-between gap-2 text-[14px]" style={{ color: 'var(--warn)' }}><span>{l}</span><span className="tabular-nums">{coMoney(v)}</span></div>)}
                  {!isWaived && (feeRows.length > 0) && <button type="button" onClick={() => handleWaiveClick(data.appointment.id)} className="text-[13px] font-semibold underline underline-offset-4">Waive these fees{isOwnerOrAdmin ? '' : ' (a manager approves)'}</button>}
                  {isWaived && <div className="flex items-center justify-between text-[13px]" style={{ color: 'var(--ok)' }}><span>Fees waived</span><button type="button" onClick={() => onWaiveFeeToggle(data.appointment.id, false)} className="font-semibold underline underline-offset-4">Undo</button></div>}
                </div>;
              })}
              {cart.map((item: any) => <div key={item.id} className="flex items-center justify-between gap-2 rounded-2xl p-3" style={{ background: 'var(--soft)' }}>
                <div className="min-w-0"><p className="truncate text-[15px] font-semibold">{item.name}</p><p className="text-[13px] capitalize" style={muted}>{item.type || 'item'} · {coMoney(item.price)} each</p></div>
                <div className="flex shrink-0 items-center gap-1">
                  <button type="button" onClick={() => handleUpdateQuantity(item.id, item.quantity - 1)} aria-label={`One fewer ${item.name}`} className="h-9 w-9 rounded-full text-[18px]" style={{ background: 'var(--card)' }}>−</button>
                  <span className="w-6 text-center text-[15px] font-semibold tabular-nums">{item.quantity}</span>
                  <button type="button" onClick={() => handleUpdateQuantity(item.id, item.quantity + 1)} aria-label={`One more ${item.name}`} className="h-9 w-9 rounded-full text-[18px]" style={{ background: 'var(--card)' }}>+</button>
                  <span className="w-16 text-right text-[15px] font-semibold tabular-nums">{coMoney(safeNumber(item.price) * item.quantity)}</span>
                  <button type="button" onClick={() => handleUpdateQuantity(item.id, 0)} aria-label={`Remove ${item.name}`} className="h-9 w-9 rounded-full" style={{ background: 'var(--card)' }}>✕</button>
                </div>
              </div>)}
              {Array.from(appliedAdjustments).filter((id: any) => { const fee = clients.flatMap((c: any) => c.unpaidFees || []).find((f: any) => f.feeId === id); return !fee || !appointmentsData.some((d: any) => d.appointment.id === fee.appointmentId); }).map((id: any) => {
                const fee = clients.flatMap((c: any) => c.unpaidFees || []).find((f: any) => f.feeId === id);
                return <div key={id} className="flex items-center justify-between gap-2 rounded-2xl p-3" style={{ background: 'var(--soft)' }}>
                  <div><p className="text-[15px] font-semibold">{fee?.reason || 'Owed balance'}</p><p className="text-[13px]" style={muted}>Owed from before</p></div>
                  <div className="flex items-center gap-1"><span className="text-[15px] font-semibold tabular-nums">{coMoney(fee?.feeAmount)}</span><button type="button" onClick={() => onApplyAdjustmentToggle(id, false)} aria-label="Leave this balance for later" className="h-9 w-9 rounded-full" style={{ background: 'var(--card)' }}>✕</button></div>
                </div>;
              })}
            </div>}
          </section>
          {!isCartEmpty && <section className={card} style={cardStyle} aria-label="Discounts">
            <p className={h}>Discounts</p>
            {walletOffers.filter((w: any) => !appliedDiscountCodes.map((c: string) => c.toUpperCase()).includes(String(w.code).toUpperCase())).map((w: any) => (
              <div key={w.id} className="flex items-center justify-between gap-2 rounded-2xl p-3" style={{ background: 'color-mix(in srgb, var(--accent) 8%, transparent)' }}>
                <p className="text-[14px]"><b>Offer waiting:</b> {w.line}{w.campaignName ? <span style={muted}> · {w.campaignName}</span> : null}</p>
                <button type="button" onClick={() => handleApplyDiscount(String(w.code))} className={pill(true)} style={pillStyle(true)}>Apply</button>
              </div>))}
            <div className="flex gap-2">
              <input value={promoCodeInput} onChange={(e) => setPromoCodeInput(e.target.value.toUpperCase())} onKeyDown={(e) => { if (e.key === 'Enter') handleApplyDiscount(promoCodeInput); }} placeholder="Discount code" aria-label="Discount code" autoCapitalize="characters" className={inputCls} style={inputStyle} />
              <button type="button" onClick={() => handleApplyDiscount(promoCodeInput)} className="shrink-0 rounded-full px-4 text-[14px] font-semibold" style={{ background: 'var(--soft)' }}>Apply</button>
              <button type="button" onClick={() => setIsDiscountBrowserOpen(true)} className="shrink-0 rounded-full px-4 text-[14px] font-semibold" style={{ background: 'var(--soft)' }}>Browse</button>
            </div>
            {appliedDiscountCodes.length > 0 && <div className="flex flex-wrap gap-1.5">{appliedDiscountCodes.map((code: string) => <span key={code} className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-semibold" style={{ background: 'var(--soft)' }}>{code}<button type="button" aria-label={`Remove code ${code}`} onClick={() => setAppliedDiscountCodes(appliedDiscountCodes.filter((c: string) => c !== code))}>✕</button></span>)}</div>}
            {groupInfo && (skipGroupDiscount || safeNumber(groupDiscountRaw) > 0 || groupInfo.remaining === 0) && <div className="flex items-center justify-between gap-2 rounded-2xl p-3" style={{ background: skipGroupDiscount ? 'var(--soft)' : 'color-mix(in srgb, var(--ok) 9%, transparent)' }}>
                <p className="text-[14px]"><b>{groupInfo.label}</b> · {groupInfo.servicesPct}% off services{groupInfo.productsPct ? ` · ${groupInfo.productsPct}% off products` : ''}
                  {skipGroupDiscount ? <span style={muted}> — not applied this time</span> : groupInfo.remaining === 0 ? <span style={muted}> — this month’s limit is used up</span> : safeNumber(groupDiscountValue) > 0 ? <> — <b>−{coMoney(groupDiscountValue)}</b>{Number.isFinite(groupInfo.remaining) ? <span style={muted}> ({coMoney(groupInfo.remaining)} left this month)</span> : null}</> : <span style={muted}> — a bigger discount code applies instead</span>}</p>
                <button type="button" onClick={() => setSkipGroupDiscount?.(!skipGroupDiscount)} className="shrink-0 text-[13px] font-semibold underline underline-offset-4">{skipGroupDiscount ? 'Apply it' : 'Don’t apply this time'}</button>
              </div>}
            {staffDiscount ? <div className="flex items-center justify-between gap-2 rounded-2xl p-3" style={{ background: 'var(--soft)' }}>
                <p className="text-[14px]"><b>Staff discount {staffDiscount.kind === 'pct' ? `${staffDiscount.value}%` : coMoney(staffDiscount.value)}</b> (−{coMoney(staffDiscountValue)}) · {staffDiscount.reason}{staffDiscount.approvedBy ? ` · approved by ${firstOf(staffDiscount.approvedBy)}` : ''}</p>
                <button type="button" onClick={() => setStaffDiscount?.(null)} className="shrink-0 text-[13px] font-semibold underline underline-offset-4">Remove</button></div>
              : !sdOpen ? <button type="button" onClick={() => setSdOpen(true)} className="text-[14px] font-semibold underline underline-offset-4">Give a staff discount</button>
              : <div className="space-y-2 rounded-2xl p-3" style={{ background: 'var(--soft)' }}>
                <div className="flex gap-2"><div className="flex shrink-0 gap-1 rounded-full p-1" style={{ background: 'var(--card)' }}>{(['pct', 'amt'] as const).map((k) => <button key={k} type="button" aria-pressed={sdKind === k} onClick={() => setSdKind(k)} className={pill(sdKind === k)} style={pillStyle(sdKind === k)}>{k === 'pct' ? '%' : '$'}</button>)}</div>
                  <input value={sdValue || ''} onChange={(e) => setSdValue(parseFloat(e.target.value) || 0)} inputMode="decimal" type="number" placeholder={sdKind === 'pct' ? 'e.g. 10' : 'e.g. 5.00'} aria-label="Discount amount" className={inputCls} style={inputStyle} /></div>
                <input value={sdReason} onChange={(e) => setSdReason(e.target.value)} placeholder="Reason (e.g. redo, loyalty, staff friend)" aria-label="Discount reason" className={inputCls} style={inputStyle} />
                {sdDraftDollars > 0 && <p className="text-[13px]" style={muted}>−{coMoney(sdDraftDollars)} ({sdDraftPct.toFixed(0)}% of the ticket){!sdIsManager ? ` · you can give up to ${sdLimitPct}% yourself` : ''}</p>}
                {sdNeedsApproval && <input value={sdPin} onChange={(e) => setSdPin(e.target.value.replace(/\D/g, '').slice(0, 8))} type="password" inputMode="numeric" placeholder="Manager PIN to approve" aria-label="Manager PIN" className={inputCls} style={inputStyle} />}
                <div className="flex gap-2"><button type="button" onClick={applyStaffDiscount} disabled={!sdDraftDollars || !sdReason.trim() || (sdNeedsApproval && sdPin.length < 4)} className="h-11 flex-1 rounded-full text-[14px] font-semibold disabled:opacity-40" style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}>{sdNeedsApproval ? 'Approve and apply' : 'Apply'}</button>
                  <button type="button" onClick={() => { setSdOpen(false); setSdPin(''); }} className="h-11 rounded-full px-4 text-[14px]" style={{ background: 'var(--card)' }}>Cancel</button></div>
              </div>}
            {!isRecoveryDialogOpen && recoveryAmount === 0 ? <button type="button" onClick={() => setIsRecoveryDialogOpen(true)} className="block text-[14px] font-semibold underline underline-offset-4">Make it right (service recovery)</button>
              : <div className="space-y-2 rounded-2xl p-3" style={{ background: recoveryAmount > 0 ? 'color-mix(in srgb, var(--warn) 8%, transparent)' : 'var(--soft)' }}>
                <p className="text-[14px] font-semibold">Service recovery{(autonomyLimit > 0 || autonomyPercent > 0) ? <span className="font-normal" style={muted}> · you can give up to {autonomyLimit > 0 ? coMoney(autonomyLimit) : ''}{autonomyLimit > 0 && autonomyPercent > 0 ? ' / ' : ''}{autonomyPercent > 0 ? `${autonomyPercent}%` : ''}</span> : null}</p>
                {(selectedTenant?.recoveryPresets || []).length > 0 && <div className="flex flex-wrap gap-1.5">{(selectedTenant?.recoveryPresets || []).map((preset: RecoveryPreset) => <button key={preset.id} type="button" onClick={() => handleApplyRecoveryPreset(preset)} className={pill(false)} style={pillStyle(false)}>{preset.label}</button>)}</div>}
                <input type="number" inputMode="decimal" value={recoveryAmount || ''} onChange={(e) => setRecoveryAmount(parseFloat(e.target.value) || 0)} placeholder="Amount ($)" aria-label="Recovery amount in dollars" className={inputCls} style={inputStyle} />
                <input value={recoveryReason} onChange={(e) => setRecoveryReason(e.target.value)} placeholder="What went wrong?" aria-label="Service issue details" className={inputCls} style={inputStyle} />
                {isOverAutonomy && !isOverrideUnlocked && <div className="space-y-2">
                  <p className="text-[13px] font-semibold" style={{ color: 'var(--warn)' }}>Over your limit — a manager approves.</p>
                  <input type="password" inputMode="numeric" placeholder="Manager PIN" aria-label="Manager PIN" value={overridePin} onChange={(e) => setOverridePin(e.target.value.replace(/\D/g, '').slice(0, 8))} className={inputCls} style={inputStyle} />
                  <input value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} placeholder="Why (recorded)" aria-label="Justification for this override" className={inputCls} style={inputStyle} />
                  <button type="button" disabled={overridePin.length < 4 || !overrideReason.trim()} onClick={async () => {
                    const finalReason = overrideReason.trim() || recoveryReason.trim() || 'Service Recovery Override';
                    const finalAmount = recoveryAmount > 0 ? recoveryAmount : Number(subtotal.toFixed(2));
                    const ap = await approveWithPin(tenantId, overridePin, { kind: 'recovery', amount: finalAmount, reason: finalReason });
                    if (!ap.ok || !ap.approver) { toast({ variant: 'destructive', title: 'Not approved', description: ap.error || 'PIN not recognized.' }); return; }
                    setRecoveryApprovalToken(ap.token || null); setIsOverrideUnlocked(true); setShowPinEntry(false); setRecoveryReason(finalReason); setRecoveryAmount(finalAmount);
                    toast({ title: 'Approved', description: `${ap.approver.name} approved ${coMoney(finalAmount)}.` });
                  }} className="h-11 w-full rounded-full text-[14px] font-semibold disabled:opacity-40" style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}>Approve</button>
                </div>}
                {isOverrideUnlocked && <p className="text-[13px] font-semibold" style={{ color: 'var(--ok)' }}>Approved — −{coMoney(recoveryAmount)}</p>}
                <div className="flex gap-2"><button type="button" onClick={() => setIsRecoveryDialogOpen(false)} className="h-10 flex-1 rounded-full text-[14px] font-semibold" style={{ background: 'var(--card)' }}>Done</button>
                  {recoveryAmount > 0 && <button type="button" onClick={() => { setRecoveryAmount(0); setRecoveryReason(''); setShowPinEntry(false); setOverridePin(''); setOverrideReason(''); setIsOverrideUnlocked(false); setIsRecoveryDialogOpen(false); }} className="h-10 rounded-full px-4 text-[14px]" style={{ background: 'var(--card)' }}>Remove</button>}</div>
              </div>}
          </section>}
       {selectedClient && !isCartEmpty && (
         <StoreCreditPanel
           client={selectedClient}
           totalOwed={finalTotal}
           tenantId={tenantId}
           appointmentId={appointmentsData[0]?.appointment?.id || ''}
           staffId={cashierName ? (staff || []).find((s: any) => s.name === cashierName)?.id || '' : ''}
           appliedAmount={storeCreditApplied}
           onCreditApplied={(result: { appliedAmount: number; remainingBalance: number }) => {
             onStoreCreditApplied?.(result);
           }}
         />
       )}
        </div>
        <div className="co-right min-w-0 space-y-3">
          {!isCartEmpty && !studentsNoTips && !(paymentTab === 'card' && cardMode !== 'select') && <section className={card} style={cardStyle} aria-label="Tip">
            <p className={h}>Tip</p>
            <div className="flex flex-wrap gap-1.5">{[0, 15, 18, 20, 25].map((pct) => { const amt = Number((safeNumber(subtotal) * pct / 100).toFixed(2)); const on = pct === 0 ? tipAmount === 0 : Math.abs(tipAmount - amt) < 0.01;
              return <button key={pct} type="button" aria-pressed={on} onClick={() => handleTotalTipChange(amt)} className={pill(on)} style={pillStyle(on)}>{pct === 0 ? 'No tip' : `${pct}% · ${coMoney(amt)}`}</button>; })}</div>
            <input type="number" inputMode="decimal" value={tipAmount || ''} onChange={(e) => handleTotalTipChange(parseFloat(e.target.value) || 0)} placeholder="Or an amount ($)" aria-label="Tip amount in dollars" className={inputCls} style={inputStyle} />
            {cs.connected && (tipReq ? <div className="flex items-center justify-between gap-2 rounded-2xl p-3 text-[14px]" style={{ background: 'var(--soft)' }}><span>Waiting for {firstOf(selectedClient?.name) || 'the client'} to choose on {cs.name}…</span><button type="button" onClick={() => { setTipReq(null); cs.ask('idle'); }} className="font-semibold underline underline-offset-4">Cancel</button></div>
              : <button type="button" onClick={async () => { const id = await cs.ask('tip', { base: (selectedTenant as any)?.clientScreen?.tipOn === 'after_tax' ? safeNumber(subtotal) - safeNumber(totalDiscount) + safeNumber(tax) : safeNumber(subtotal) - safeNumber(totalDiscount) }); if (id) setTipReq(id); else toast({ variant: 'destructive', title: 'The client screen didn’t respond' }); }}
                className="h-11 w-full rounded-full text-[14px] font-semibold" style={{ background: 'var(--soft)' }}>Ask for a tip on {cs.name}{cs.online ? '' : ' (offline?)'}</button>)}
          </section>}
          <section className={card} style={cardStyle} aria-label="Pay">
            <p className={h}>How they’re paying</p>
            {splitActive && prepareNow ? <SplitBill tenantId={tenantId} owed={safeNumber(finalTotal)} lines={splitLines} people={splitPeople} payerId={selectedClientId || null}
              prepare={async () => prepareNow()} onCancel={() => setSplitActive?.(false)} onFinish={(paid) => onCheckout({ paymentMethod: 'split', amountTendered: paid, recoveryAmount, recoveryReason, recoveryApprovalToken })}
              screen={cs.connected ? { connected: true, name: cs.name, ask: cs.ask, response: cs.response } : null} askTip={autoTipOn} tipBaseFor={(amt: number) => (safeNumber(finalTotal) > 0 ? Math.round(tipBase * (amt / safeNumber(finalTotal)) * 100) / 100 : 0)} />
            : <>
            <div role="tablist" aria-label="Payment method" className="grid grid-cols-3 gap-1 rounded-full p-1" style={{ background: 'var(--soft)' }}>
              {([['card', 'Card'], ['cash', 'Cash'], ['other', 'Other']] as const).map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={paymentTab === k} onClick={() => { setPaymentTab(k); setCardMode('select'); }} className="h-11 rounded-full text-[15px] font-semibold" style={paymentTab === k ? { background: 'var(--card)', boxShadow: '0 1px 2px rgba(0,0,0,.08)' } : { color: 'var(--muted)' }}>{l}</button>)}
            </div>
            {isCardTab && cardSurchargeEnabled && cardSurcharge > 0 && <p className="text-[13px]" style={muted}>Card fee {(cardSurchargeRate * 100).toFixed(1)}% · +{coMoney(cardSurcharge)}</p>}
            <AnimatePresence mode="wait">
              {paymentTab === 'card' && cardMode === 'select' && (payReq || payAfterTip) && <div className="space-y-2 rounded-2xl p-4" style={{ background: 'var(--soft)' }}>
                <p className="text-[15px] font-semibold">{`${firstOf(selectedClient?.name) || 'The client'} is paying on ${cs.name}…`}</p>
                <p className="text-[13px]" style={muted}>They check the total, choose a tip{safeNumber(tipAmount) > 0 ? ' (you’ve already set one, so they won’t be asked)' : ''}, then pay by card on the iPad or on their phone. The sale completes by itself once it’s paid.</p>
                <button type="button" onClick={() => { setPayReq(null); setPayAfterTip(false); setTipReq(null); cs.ask('idle'); }} className="h-11 rounded-full px-4 text-[14px]" style={{ background: 'var(--card)' }}>Cancel</button>
              </div>}
              {paymentTab === 'card' && cardMode === 'select' && !payReq && !payAfterTip && <div className="grid gap-2">
                {payOnIpadOn && <button type="button" onClick={startPayOnIpad} disabled={isCartEmpty || amountToCharge <= 0} className={rowBtn} style={{ background: 'color-mix(in srgb, var(--accent) 10%, var(--soft))' }}>
                  <span><span className="block text-[15px] font-semibold">Client pays on {cs.name}</span><span className="block text-[13px]" style={muted}>Card on the iPad, or Apple Pay / Google Pay on their phone{csSet.offerSaveCard !== false && selectedClient ? ' · they can save their card' : ''}</span></span><span aria-hidden>→</span></button>}
                {hasCardOnFile && <button type="button" onClick={() => setCardMode('cof_tip')} className={rowBtn} style={{ background: 'var(--soft)' }}>
                  <span><span className="block text-[15px] font-semibold">{String(selectedClient?.cardOnFile?.brand || 'Card')} ending {String(selectedClient?.cardOnFile?.last4 || '••••')}</span><span className="block text-[13px]" style={muted}>Card on file — they choose a tip, then you charge</span></span><span aria-hidden>→</span></button>}
                <button type="button" onClick={handleTerminalPayment} disabled={!readerConnected} className={rowBtn} style={{ background: 'var(--soft)', opacity: readerConnected ? 1 : 0.55 }}>
                  <span><span className="block text-[15px] font-semibold">{readerConnected ? terminal?.connectedReader?.label || 'Card reader' : 'Card reader'}</span><span className="block text-[13px]" style={muted}>{readerConnected ? 'Tap, insert or swipe' : 'No reader paired — set one up in Settings'}</span></span><span aria-hidden>{readerConnected ? '→' : ''}</span></button>
                <button type="button" onClick={() => setCardMode('new_card')} className={rowBtn} style={{ background: 'var(--soft)' }}>
                  <span><span className="block text-[15px] font-semibold">Type in a card</span><span className="block text-[13px]" style={muted}>Enter the card details</span></span><span aria-hidden>→</span></button>
                {selectedClient && <label className="flex items-center gap-2 px-1 text-[14px]"><input type="checkbox" checked={saveNewCard} onChange={() => setSaveNewCard((v: boolean) => !v)} /> Save a typed card to their profile</label>}
              </div>}
            {paymentTab === 'card' && cardMode === 'cof_tip' && selectedClient && autoTipOn && tipReq && <div className="space-y-2 rounded-2xl p-4" style={{ background: 'var(--soft)' }}>
              <p className="text-[15px] font-semibold">{firstOf(selectedClient.name)} is choosing a tip on {cs.name}…</p>
              <div className="flex gap-2"><button type="button" onClick={() => { setTipReq(null); cs.ask('idle'); setCardMode('cof_confirm'); }} className="h-11 rounded-full px-4 text-[14px] font-semibold" style={{ background: 'var(--card)' }}>Skip the tip</button>
                <button type="button" onClick={() => setCardMode('select')} className="h-11 rounded-full px-4 text-[14px]" style={{ background: 'var(--card)' }}>Back</button></div>
            </div>}
            {paymentTab === 'card' && cardMode === 'cof_tip' && selectedClient && !(autoTipOn && tipReq) && (() => {
              const presets = [0, 10, 18, 20, 25];
              const baseForTip = subtotal; // tip on pre-tax subtotal
              return (
                <motion.div key="cof-tip" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="pt-4 space-y-6">
                  <div className="text-center space-y-1 py-4">
                    <p className="text-[9px] font-black uppercase tracking-[0.25em] text-muted-foreground">Turn screen toward client</p>
                    <p className="text-2xl font-black uppercase tracking-tighter text-slate-900">Add a Gratuity?</p>
                    <p className="text-[10px] font-bold text-muted-foreground uppercase">Your technician appreciates your support</p>
                  </div>

                  {studentsNoTips && <p className="col-span-2 rounded-2xl bg-muted/40 p-3 text-center text-sm font-bold text-muted-foreground">Student-salon service — this school doesn’t accept tips for students.</p>}
                  <div className="grid grid-cols-2 gap-3">
                    {presets.filter(p => p > 0).map(pct => {
                      const tipAmt = Number((baseForTip * (pct / 100)).toFixed(2));
                      const isSelected = Math.abs(tipAmount - tipAmt) < 0.01;
                      return (
                        <button key={pct}
                          onClick={() => handleTotalTipChange(tipAmt)}
                          className={cn(
                            'h-20 rounded-2xl border-2 font-black transition-all active:scale-95 flex flex-col items-center justify-center gap-1',
                            isSelected
                              ? 'border-primary bg-primary text-white shadow-xl shadow-primary/30'
                              : 'border-border bg-white text-slate-900 hover:border-primary/30 hover:bg-primary/5'
                          )}>
                          <span className="text-2xl">{pct}%</span>
                          <span className={cn('text-[11px] font-black', isSelected ? 'text-white/80' : 'text-muted-foreground')}>
                            ${tipAmt.toFixed(2)}
                          </span>
                        </button>
                      );
                    })}
                    <button
                      onClick={() => handleTotalTipChange(0)}
                      className={cn(
                        'h-20 rounded-2xl border-2 font-black transition-all active:scale-95 flex flex-col items-center justify-center gap-1 col-span-2',
                        tipAmount === 0
                          ? 'border-slate-300 bg-slate-100 text-slate-500'
                          : 'border-dashed border-border bg-white text-muted-foreground hover:bg-muted/20'
                      )}>
                      <span className="text-base uppercase tracking-widest">No Tip</span>
                    </button>
                  </div>

                  <div className="space-y-2">
                    <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground text-center">Or enter custom amount</p>
                    <div className="relative">
                      <DollarSign className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-primary opacity-40" />
                      <Input
                        type="number"
                        inputMode="decimal"
                        aria-label="Custom tip amount in dollars"
                        value={tipAmount > 0 && ![10,18,20,25].map(p => Number((baseForTip * p / 100).toFixed(2))).includes(tipAmount) ? tipAmount : ''}
                        onChange={e => handleTotalTipChange(parseFloat(e.target.value) || 0)}
                        onFocus={e => e.currentTarget.select()}
                        placeholder="0.00"
                        className="h-14 pl-10 text-2xl font-black font-mono border-2 rounded-2xl bg-white"
                      />
                    </div>
                  </div>

                  <div className="p-4 rounded-2xl bg-primary/5 border-2 border-primary/10 space-y-2">
                    <div className="flex justify-between text-[11px] text-muted-foreground">
                      <span className="font-bold uppercase">Subtotal</span>
                      <span className="font-mono">${subtotal.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-[11px] text-muted-foreground">
                      <span className="font-bold uppercase">Tax</span>
                      <span className="font-mono">${(Number(tax) || 0).toFixed(2)}</span>
                    </div>
                    {tipAmount > 0 && (
                      <div className="flex justify-between text-[11px] text-primary">
                        <span className="font-black uppercase">Gratuity</span>
                        <span className="font-mono font-black">${tipAmount.toFixed(2)}</span>
                      </div>
                    )}
                    {cardSurcharge > 0 && (
                      <div className="flex justify-between text-[11px] text-amber-700">
                        <span className="font-black uppercase">Card Processing Fee</span>
                        <span className="font-mono font-black">${cardSurcharge.toFixed(2)}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-base font-black border-t border-primary/10 pt-2">
                      <span className="uppercase text-primary">Total</span>
                      <span className="font-mono text-primary">${amountToCharge.toFixed(2)}</span>
                    </div>
                  </div>

                  <Button
                    onClick={() => setCardMode('cof_confirm')}
                    className="w-full h-14 rounded-2xl font-black uppercase text-[11px] tracking-widest shadow-xl shadow-primary/20">
                    Continue to Charge →
                  </Button>
                </motion.div>
              );
            })()}
            {paymentTab === 'card' && cardMode === 'cof_confirm' && selectedClient && !cofApproved && <div className="space-y-2 rounded-2xl p-4" style={{ background: 'var(--soft)' }}>
              <p className="text-[15px] font-semibold">Ask {firstOf(selectedClient.name)} to approve {coMoney(amountToCharge)} on {cs.name}</p>
              {cofReq?.status === 'waiting' && Math.abs(cofReq.amount - amountToCharge) < 0.005 ? <p className="text-[14px]" style={muted}>Waiting for them to approve{(selectedTenant as any)?.clientScreen?.signCardOnFile === false ? '' : ' and sign'}…</p>
                : cofReq?.status === 'declined' ? <p className="text-[14px] font-semibold" style={{ color: 'var(--warn)' }}>They didn’t approve it. Ask how they’d like to pay.</p> : null}
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={async () => { const id = await cs.ask('approve', { amount: amountToCharge, cardLabel: `${String(selectedClient?.cardOnFile?.brand || 'card')} ending ${String(selectedClient?.cardOnFile?.last4 || '••••')}`, clientId: selectedClient.id, clientName: selectedClient.name }); if (id) setCofReq({ id, amount: amountToCharge, status: 'waiting' }); else toast({ variant: 'destructive', title: 'The client screen didn’t respond' }); }}
                  className="h-11 rounded-full px-4 text-[14px] font-semibold" style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}>{cofReq ? 'Ask again' : 'Send to the client screen'}</button>
                <button type="button" onClick={() => setCofSkip(true)} className="h-11 rounded-full px-4 text-[14px]" style={{ background: 'var(--card)' }}>Charge without the screen</button>
                <button type="button" onClick={() => setCardMode('cof_tip')} className="h-11 rounded-full px-4 text-[14px]" style={{ background: 'var(--card)' }}>Back</button>
              </div>
            </div>}
            {paymentTab === 'card' && cardMode === 'cof_confirm' && selectedClient && cofApproved && (
              <motion.div key="cof-confirm" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="pt-4">
                <CardOnFileConfirm
                  client={selectedClient}
                  amount={amountToCharge}
                  surcharge={cardSurcharge}
                  onConfirm={handleCofCharge}
                  onCancel={() => setCardMode('cof_tip')}
                  isProcessing={isCofCharging}
                />
              </motion.div>
            )}
            {paymentTab === 'card' && cardMode === 'terminal' && (
              <motion.div key="terminal" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <TerminalPaymentUI
                  amount={amountToCharge}
                  onCancel={() => setCardMode('select')}
                  onSuccess={() => setCardMode('select')}
                />
              </motion.div>
            )}
            {paymentTab === 'card' && cardMode === 'new_card' && tenantId && (
              <motion.div key="new-card" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <EmbeddedCardForm
                  tenantId={tenantId}
                  clientId={selectedClient?.id}
                  clientEmail={selectedClient?.email}
                  amount={amountToCharge}
                  saveCard={saveNewCard && !!selectedClient}
                  onSuccess={async (paymentIntentId) => {
                    toast({ title: 'Card Charged', description: `$${amountToCharge.toFixed(2)} collected.` });
                    await onCheckout({ paymentMethod: 'card', amountTendered: amountToCharge, recoveryAmount, recoveryReason, recoveryApprovalToken, stripePaymentIntentId: paymentIntentId, cardSurcharge });
                    setCardMode('select');
                  }}
                  onCancel={() => setCardMode('select')}
                />
              </motion.div>
            )}
            {paymentTab === 'cash' && (
              <motion.div key="cash" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="pt-4">
                <CashCheckout
                  finalTotal={finalTotal}
                  subtotal={subtotal}
                  tax={(Number(tax) || 0)}
                  amountTendered={amountTendered}
                  setAmountTendered={setAmountTendered}
                  tipAmount={tipAmount}
                  onTipChange={handleTotalTipChange}
                  onCheckout={() => onCheckout({ paymentMethod: 'cash', amountTendered, recoveryAmount, recoveryReason, recoveryApprovalToken, isEscalated: isOverrideUnlocked })}
                  isSubmitting={isSubmitting}
                  isCartEmpty={isCartEmpty}
                  isGroupCheckout={isGroupCheckout}
                  selectedClientId={selectedClientId}
                  isOverAutonomy={isOverAutonomy}
                  isOverrideUnlocked={isOverrideUnlocked}
                  clientEmail={selectedClient?.email || ''}
                  clientPhone={selectedClient?.phone || ''}
                  clientName={selectedClient?.name || 'Guest'}
                  discountValue={safeNumber(discount) + safeNumber(membershipDiscount)}
                  cashierName={cashierName || ''}
                  recoveryAmount={recoveryAmount}
                  lineItems={[
                    ...appointmentsData.flatMap((data: any) => {
                      const overrides = data.appointment.checkoutState?.serviceStaffOverrides || {};
                      const mainStaffId = overrides[data.service?.id] || data.appointment.staffId;
                      const mainStaff = staff?.find((s: any) => s.id === mainStaffId);
                      const lines = [];
                      if (data.service) {
                        lines.push({
                          label:  data.service.name,
                          amount: getServicePrice(data.service, data.staff),
                          type:   'service' as const,
                          staff:  mainStaff?.name?.split(' ')[0] || undefined,
                        });
                      }
                      (data.appointment.addOnIds || []).forEach((id: string) => {
                        const addon = services?.find((s: any) => s.id === id);
                        if (addon) {
                          const addonStaff = staff?.find((s: any) => s.id === (overrides[id] || data.appointment.staffId));
                          lines.push({ label: `+ ${addon.name}`, amount: getServicePrice(addon, addonStaff), type: 'addon' as const, staff: addonStaff?.name?.split(' ')[0] || undefined });
                        }
                      });
                      (data.appointment.checkoutState?.refreshments || []).forEach((r: any) => {
                        if (safeNumber(r.price) > 0) lines.push({ label: r.name, amount: safeNumber(r.price) * safeNumber(r.quantity || 1), type: 'refreshment' as const });
                      });
                      return lines;
                    }),
                    ...cart.map((item: any) => ({
                      label:  item.name,
                      amount: item.price * item.quantity,
                      type:   (item.type === 'service' ? 'service' : 'retail') as any,
                    })),
                  ]}
                />
              </motion.div>
            )}
            </AnimatePresence>
            {paymentTab === 'other' && <p className="text-[14px]" style={muted}>For payments taken outside the app (a bank transfer, a cheque, a voucher). Record it with the button below.</p>}
            {prepareNow && !isCartEmpty && safeNumber(finalTotal) > 0 && <button type="button" onClick={() => setSplitActive?.(true)} className="h-11 w-full rounded-full text-[14px] font-semibold" style={{ background: 'var(--soft)' }}>Split the bill</button>}
            </>}
          </section>
          <section className={card} style={cardStyle} aria-label="Totals">
            <div className="space-y-1.5 text-[14px]">
              <div className="flex justify-between"><span>Subtotal</span><span className="tabular-nums">{coMoney(subtotal)}</span></div>
              {totalDiscount > 0 && recoveryAmount === 0 && <div className="flex justify-between"><span>Discounts</span><span className="tabular-nums">−{coMoney(totalDiscount)}</span></div>}
              {totalDiscount > 0 && recoveryAmount > 0 && <div className="flex justify-between"><span>Discounts</span><span className="tabular-nums">−{coMoney(totalDiscount)}</span></div>}
              {recoveryAmount > 0 && <div className="flex justify-between"><span>Service recovery{recoveryReason ? <span style={muted}> · {recoveryReason.slice(0, 28)}{recoveryReason.length > 28 ? '…' : ''}</span> : null}</span><span className="tabular-nums">−{coMoney(recoveryAmount)}</span></div>}
              {finalTotal > 0 && <div className="flex justify-between"><span>{taxLabel || 'Sales tax'}</span><span className="tabular-nums">{coMoney(tax)}</span></div>}
              {tipAmount > 0 && <div className="flex justify-between"><span>Tip</span><span className="tabular-nums">{coMoney(tipAmount)}</span></div>}
              {totalPaidDeposits > 0 && <div className="flex justify-between" style={{ color: 'var(--ok)' }}><span>Deposit already paid</span><span className="tabular-nums">−{coMoney(totalPaidDeposits)}</span></div>}
              {safeNumber(storeCreditApplied) > 0 && <div className="flex justify-between" style={{ color: 'var(--ok)' }}><span>Store credit</span><span className="tabular-nums">−{coMoney(storeCreditApplied)}</span></div>}
              {cardSurcharge > 0 && <div className="flex justify-between"><span>Card fee ({(cardSurchargeRate * 100).toFixed(1)}%)</span><span className="tabular-nums">+{coMoney(cardSurcharge)}</span></div>}
            </div>
          </section>
        </div>
      </div>
      <div className="sticky bottom-0 z-10 -mx-5 mt-3 px-5 pb-1 pt-3" style={{ background: 'var(--paper)', borderTop: '1px solid var(--line)' }}>
        <div className="flex items-center justify-between gap-3">
          <div><p className="text-[12px]" style={muted}>{isCardTab ? 'To charge' : 'Due'}</p><p className="text-[26px] font-semibold tabular-nums leading-tight">{coMoney(dueNow)}</p></div>
          {splitActive ? <p className="max-w-[55%] text-right text-[13px]" style={muted}>Splitting the bill — finish it above.</p> : paymentTab === 'other' ? <button type="button" onClick={() => onCheckout({ paymentMethod: paymentTab, amountTendered, recoveryAmount, recoveryReason, recoveryApprovalToken, isEscalated: isOverrideUnlocked })} disabled={isSubmitting || payBlocked}
              className="h-12 rounded-full px-6 text-[15px] font-semibold disabled:opacity-40" style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}>{isSubmitting ? 'Saving…' : finalTotal <= 0 ? 'Complete (nothing to pay)' : `Record ${coMoney(finalTotal)}`}</button>
            : <p className="max-w-[55%] text-right text-[13px]" style={muted}>{payBlocked ? (isOverAutonomy && !isOverrideUnlocked ? 'A manager needs to approve the recovery first' : isGroupCheckout && !selectedClientId ? 'Choose who’s paying' : 'Add something to the ticket') : paymentTab === 'cash' ? 'Enter the cash given above to finish' : cardMode === 'select' ? 'Choose how they pay by card above' : 'Finish the card payment above'}</p>}
        </div>
      </div>
      <BrowseDiscountsDialog open={isDiscountBrowserOpen} onOpenChange={setIsDiscountBrowserOpen} allDiscounts={discounts || []} onSelect={handleApplyDiscount} cartServiceIds={cartServiceIds} />
      <WaiveFeeDialog open={isWaiveAuthOpen} onOpenChange={setIsPointOfSaleWaiveAuthOpen} staff={staff} onConfirm={handleConfirmWaive} tenantIdForApproval={tenantId} approvalKind="waive" approvalRef={pendingWaiveAptId} title="Admin Override" description="Authorize fee waiver with manager PIN." />
    </div>
  );

};
