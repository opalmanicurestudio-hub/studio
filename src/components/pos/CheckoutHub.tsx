'use client';

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
} from 'lucide-react';
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
import { useFirebase, useCollection, useMemoFirebase, setDocumentNonBlocking } from '@/firebase';
import { CashCheckout } from './CashCheckout';
import { GuestSearch } from './GuestSearch';
import { ConsentSignatureDialog } from '@/components/consents/ConsentSignatureDialog';
import type { SignatureRecord } from '@/components/consents/ConsentSignatureDialog';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';

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

// ─── WaiveFeeDialog ───────────────────────────────────────────────────────────
const WaiveFeeDialog = ({ open, onOpenChange, staff, onConfirm, title = 'Admin Override', description = 'Authorize fee waiver with manager PIN.' }: any) => {
  const [pin, setPin] = useState('');
  const [reason, setReason] = useState('');
  const { toast } = useToast();

  const handleConfirm = () => {
    const authorizedStaff = staff.find((s: any) => s.pin === pin && (s.role === 'admin' || s.role === 'owner'));
    if (!authorizedStaff) { toast({ variant: 'destructive', title: 'Unauthorized', description: 'Manager authorization required.' }); return; }
    if (!reason.trim()) { toast({ variant: 'destructive', title: 'Reason Required' }); return; }
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
            <Input type="password" placeholder="****" maxLength={4} className="text-center text-4xl font-black h-20 tracking-[0.5em] bg-muted/30 border-4 rounded-3xl" value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, ''))} autoFocus />
          </div>
          <div className="space-y-2 w-full px-6 text-left">
            <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Reason</Label>
            <Textarea value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g., Client verified emergency..." className="rounded-2xl border-2 bg-muted/5 focus-visible:ring-primary/20 font-medium" />
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
const CardOnFileConfirm = ({ client, amount, onConfirm, onCancel, isProcessing }: {
  client: Client;
  amount: number;
  onConfirm: () => void;
  onCancel: () => void;
  isProcessing: boolean;
}) => {
  const card = (client as any).cardOnFile;
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
      const stripe = (window as any).Stripe;
      // Re-use the same instance we mounted with
      const confirmResult = await (elementsRef.current as any)._stripe.confirmCardPayment(piData.clientSecret, {
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
}: any) => {

  const [promoCodeInput,        setPromoCodeInput]        = useState('');
  const [isDiscountBrowserOpen, setIsDiscountBrowserOpen] = useState(false);
  const [isPayerDialogOpen,     setIsPayerDialogOpen]     = useState(false);
  const { services, inventory }                           = useInventory();
  const { selectedTenant }                                = useTenant();
  const { toast }                                         = useToast();
  const { firestore, firebaseApp }                        = useFirebase();

  const [isWaiveAuthOpen,    setIsPointOfSaleWaiveAuthOpen] = useState(false);
  const [pendingWaiveAptId,  setPendingWaiveAptId]          = useState<string | null>(null);
  const [clientSearch,       setClientSearch]               = useState('');

  const [recoveryAmount,    setRecoveryAmount]    = useState<number>(0);
  const [recoveryReason,    setRecoveryReason]    = useState('');
  const [isRecoveryActive,  setIsRecoveryActive]  = useState(false);
  const [showPinEntry,      setShowPinEntry]       = useState(false);
  const [overridePin,       setOverridePin]        = useState('');
  const [overrideReason,    setOverrideReason]     = useState('');
  const [isOverrideUnlocked,setIsOverrideUnlocked]= useState(false);

  // ── Card payment sub-mode ──────────────────────────────────────────────────
  // 'select'       = choose which card method
  // 'cof_confirm'  = confirming card-on-file charge
  // 'cof_charging' = actively charging card on file
  // 'terminal'     = terminal reader flow
  // 'new_card'     = embedded browser card form
  type CardMode = 'select' | 'cof_tip' | 'cof_confirm' | 'cof_charging' | 'terminal' | 'new_card';
  const [cardMode,        setCardMode]        = useState<CardMode>('select');
  const [pendingCheckout, setPendingCheckout] = useState<Parameters<typeof onCheckout>[0] | null>(null);
  const [signatureOpen,   setSignatureOpen]   = useState(false);
  const [activeConsentForm, setActiveConsentForm] = useState<any | null>(null);
  const [isCofCharging,   setIsCofCharging]   = useState(false);
  const [saveNewCard,     setSaveNewCard]      = useState(true);
  const [stripePaymentId, setStripePaymentId] = useState<string | null>(null);

  const terminal = useTerminalSafe();

  const isOwnerOrAdmin = role === 'owner' || role === 'admin';

  const selectedClient = useMemo(
    () => clients.find((c: Client) => c.id === selectedClientId),
    [selectedClientId, clients]
  );

  const hasCardOnFile = !!(selectedClient?.cardOnFile?.token || selectedClient?.cardOnFile?.paymentMethodId);
  const readerConnected = terminal?.readerStatus === 'connected';

  const isBirthdayToday = useMemo(() => {
    if (!selectedClient?.birthday) return false;
    const birth = safeDate(selectedClient.birthday);
    const today = new Date();
    return birth.getDate() === today.getDate() && birth.getMonth() === today.getMonth();
  }, [selectedClient]);

  const isMember  = !!(selectedClient?.activeMembershipId || selectedClient?.subscription);

  // Fetch consent forms for signature collection at checkout
  // Wrapped defensively — if collection isn't set up yet, returns null gracefully
  const consentFormsQuery = useMemoFirebase(() => {
    if (!firestore || !tenantId) return null;
    try { return collection(firestore, `tenants/${tenantId}/consentForms`); }
    catch { return null; }
  }, [firestore, tenantId]);
  const { data: consentForms = [] } = useCollection<any>(consentFormsQuery) || {};
  // Only auto-prompt for forms explicitly marked requiresSignature
  // If none are marked, don't interrupt checkout automatically
  const checkoutConsentForm = useMemo(() =>
    (consentForms || []).find((f: any) => f.requiresSignature) || null,
    [consentForms]
  );
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
    return staff.filter((s: Staff) => staffIds.has(s.id));
  }, [appointmentsData, staff]);

  const handleTotalTipChange = useCallback((value: number) => {
    const roundedValue = Number(safeNumber(value).toFixed(2));
    setTipAmount(roundedValue);
    if (allInvolvedStaff.length > 0) {
      const splitAmount = Number((roundedValue / allInvolvedStaff.length).toFixed(2));
      const newAllocations: Record<string, number> = {};
      let currentTotal = 0;
      allInvolvedStaff.forEach((member: Staff, index: number) => {
        if (index === allInvolvedStaff.length - 1) {
          newAllocations[member.id] = Number((roundedValue - currentTotal).toFixed(2));
        } else {
          newAllocations[member.id] = splitAmount;
          currentTotal += splitAmount;
        }
      });
      setTipAllocations(newAllocations);
    }
  }, [allInvolvedStaff, setTipAmount, setTipAllocations]);

  useEffect(() => {
    if (tipAmount > 0) handleTotalTipChange(tipAmount);
  }, [allInvolvedStaff.length, handleTotalTipChange, tipAmount]);

  const handleApplyDiscount = (code: string) => {
    const codeUpper = code.trim().toUpperCase();
    if (!codeUpper) return;
    const d = discounts.find((d: any) => d.code.toUpperCase() === codeUpper);
    if (d && d.isActive) {
      const isCompatible = !d.applicableServiceIds || d.applicableServiceIds.length === 0 || d.applicableServiceIds.some((id: string) => cartServiceIds.includes(id));
      if (!isCompatible) return toast({ variant: 'destructive', title: 'Incompatible Code' });
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
      onWaiveFeeToggle(pendingWaiveAptId, true, authorizer.id, reason);
      setIsPointOfSaleWaiveAuthOpen(false);
      setPendingWaiveAptId(null);
      toast({ title: 'Fees Absorbed' });
    }
  };

  // ── Card on file charge ────────────────────────────────────────────────────
  const handleCofCharge = async () => {
    if (!selectedClient || !tenantId) return;
    setIsCofCharging(true);
    try {
      const res = await fetch('/api/stripe/charge-card', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          tenantId,
          clientId:    selectedClient.id,
          amountCents: Math.round(finalTotal * 100),
          description: 'Studio Services — POS Checkout',
          category:    'Service Revenue',
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setStripePaymentId(data.paymentIntentId);
        toast({ title: 'Card Charged', description: `$${finalTotal.toFixed(2)} charged successfully.` });
        // Proceed with the rest of the checkout flow using 'card_on_file' as payment method
        // Save COF payment intent id for after signature
        setPendingCheckout({ paymentMethod: 'card_on_file', amountTendered: finalTotal, recoveryAmount, recoveryReason, stripePaymentIntentId: data.paymentIntentId, skipLedger: true });
        if (checkoutConsentForm && selectedClient) {
          setActiveConsentForm(checkoutConsentForm);
          setSignatureOpen(true);
        } else {
          await onCheckout({ paymentMethod: 'card_on_file', amountTendered: finalTotal, recoveryAmount, recoveryReason, stripePaymentIntentId: data.paymentIntentId, skipLedger: true });
          setCardMode('select');
        }
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
      amountCents: Math.round(finalTotal * 100),
      description: 'Studio Services',
      saveCard:    saveNewCard && !!selectedClient,
    });
    if (result.ok) {
      setPendingCheckout({ paymentMethod: 'terminal', amountTendered: finalTotal, recoveryAmount, recoveryReason, stripePaymentIntentId: result.paymentIntentId, skipLedger: false });
      if (checkoutConsentForm && selectedClient) {
        setActiveConsentForm(checkoutConsentForm);
        setSignatureOpen(true);
      } else {
        await onCheckout({ paymentMethod: 'terminal', amountTendered: finalTotal, recoveryAmount, recoveryReason, stripePaymentIntentId: result.paymentIntentId, skipLedger: false });
        setCardMode('select');
      }
    }
  };

  const isCartEmpty = appointmentsData.length === 0 && cart.length === 0 && appliedAdjustments.size === 0;
  const totalDiscount     = safeNumber(discount) + safeNumber(membershipDiscount);
  const totalWithRecovery = safeNumber(discount) + safeNumber(membershipDiscount) + safeNumber(recoveryAmount);
  const isFullyComped     = Math.round(recoveryAmount * 100) >= Math.round(subtotal * 100) && subtotal > 0;
  const finalTotal        = isFullyComped
    ? Math.max(0, tipAmount)
    : Math.max(0, subtotal - totalWithRecovery + (subtotal * 0.07) + tipAmount);

  const autonomyLimit          = safeNumber(selectedTenant?.maxAutonomousRecoveryAmount) || 0;
  const autonomyPercent        = safeNumber(selectedTenant?.maxAutonomousRecoveryPercent) || 0;
  const currentRecoveryPercent = subtotal > 0 ? (recoveryAmount / subtotal) * 100 : 0;
  const isOverAutonomy         = (autonomyLimit > 0 && recoveryAmount > autonomyLimit) || (autonomyPercent > 0 && currentRecoveryPercent > autonomyPercent);

  // Reset card mode when payment tab changes
  useEffect(() => { setCardMode('select'); }, [paymentTab]);

  const handleSignatureComplete = async (record: SignatureRecord) => {
    // Save signature to Firestore if available
    if (firestore && tenantId) {
      try {
        const sigRef = doc(firestore, `tenants/${tenantId}/signatures`, record.id);
        await setDoc(sigRef, record);
      } catch (err) {
        console.warn('[signature save]', err);
      }
    }
    // Always complete the checkout even if signature save failed
    if (pendingCheckout) {
      await onCheckout(pendingCheckout);
      setPendingCheckout(null);
    }
    setSignatureOpen(false);
    setActiveConsentForm(null);
    setCardMode('select');
  };

  const handleSignatureSkip = async () => {
    // Allow checkout without signature if owner skips
    if (pendingCheckout) {
      await onCheckout(pendingCheckout);
      setPendingCheckout(null);
    }
    setSignatureOpen(false);
    setActiveConsentForm(null);
    setCardMode('select');
  };

  return (
    <div className="flex flex-col space-y-6 md:space-y-10 text-left">

      {/* ── Payer selector ── */}
      <div className="flex-shrink-0 text-left">
        {isGroupCheckout && !selectedClientId && !isCartEmpty && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="mb-2">
            <div className="flex items-center gap-2 px-1 py-2 rounded-xl bg-primary/5 border border-primary/20">
              <Users className="w-3.5 h-3.5 text-primary shrink-0" />
              <p className="text-[9px] font-black uppercase tracking-widest text-primary">Select primary payer for this group</p>
            </div>
          </motion.div>
        )}
        <GuestSearch
          clients={clients || []}
          selectedClientId={selectedClientId}
          onSelect={(id) => setSelectedClientId(id)}
          onAddNew={onAddClientClick}
          isGroupCheckout={isGroupCheckout}
          payerOptions={payerOptions || []}
        />
      </div>

      {/* ── Service Recovery ── */}
      {!isCartEmpty && (
        <div className="space-y-4">
          <div className="flex items-center justify-between px-1">
            <div className="space-y-0.5">
              <h3 className="text-[10px] font-black uppercase tracking-widest text-primary flex items-center gap-2"><ShieldAlert className="w-3.5 h-3.5" />Service Recovery Protocol</h3>
              {(autonomyLimit > 0 || autonomyPercent > 0) && <p className="text-[8px] font-bold text-slate-400 uppercase tracking-tight">Autonomy: ${autonomyLimit} / {autonomyPercent}%</p>}
            </div>
            <Switch checked={isRecoveryActive} onCheckedChange={(v) => { setIsRecoveryActive(v); if (!v) { setShowPinEntry(false); setOverridePin(''); setOverrideReason(''); setIsOverrideUnlocked(false); setRecoveryAmount(0); setRecoveryReason(''); } }} />
          </div>
          <AnimatePresence>
            {isRecoveryActive && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
                <Card className={cn('border-4 rounded-[2rem] shadow-xl transition-all', isOverAutonomy && !isOverrideUnlocked ? 'border-destructive/40 bg-destructive/[0.02] shadow-destructive/10' : isOverrideUnlocked ? 'border-green-400/40 bg-green-50/20' : 'border-primary/20 bg-primary/[0.02] shadow-primary/5')}>
                  <CardContent className="p-6 space-y-6">
                    {isOverAutonomy && !isOverrideUnlocked && (
                      <Alert variant="destructive" className="border-2 rounded-2xl p-4 bg-destructive/10">
                        <AlertTriangle className="h-4 w-4" />
                        <AlertTitle className="text-[10px] font-black uppercase">Threshold Exceeded</AlertTitle>
                        <AlertDescription className="text-[9px] font-bold leading-tight uppercase opacity-80 mt-1">This adjustment requires a manager override to finalize.</AlertDescription>
                      </Alert>
                    )}
                    <div className="space-y-3">
                      <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Tactical Presets</p>
                      <div className="flex flex-wrap gap-2">
                        {(selectedTenant?.recoveryPresets || []).map((preset: RecoveryPreset) => (
                          <Button type="button" key={preset.id} variant="outline" size="sm" onClick={() => handleApplyRecoveryPreset(preset)} className="h-8 rounded-xl border-2 font-black uppercase text-[9px] tracking-tight bg-white shadow-sm hover:border-primary/40">{preset.label}</Button>
                        ))}
                      </div>
                    </div>
                    <div className="space-y-3">
                      <Label className="text-[9px] font-black uppercase text-muted-foreground ml-1">Manual Recovery Amount ($)</Label>
                      <div className="relative">
                        <DollarSign className={cn('absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 opacity-40', isOverAutonomy && !isOverrideUnlocked ? 'text-destructive' : 'text-primary')} />
                        <Input type="number" value={recoveryAmount || ''} onChange={e => setRecoveryAmount(parseFloat(e.target.value) || 0)} placeholder="0.00" className={cn('h-14 pl-12 rounded-2xl border-2 bg-white font-black text-xl font-mono', isOverAutonomy && !isOverrideUnlocked ? 'border-destructive/20 text-destructive' : 'border-primary/20 text-primary')} />
                      </div>
                    </div>
                    <div className="space-y-3">
                      <Label className="text-[9px] font-black uppercase text-muted-foreground ml-1">Context / Justification</Label>
                      <Textarea value={recoveryReason} onChange={e => setRecoveryReason(e.target.value)} placeholder="Detail the service failure or reason for recovery..." className="rounded-2xl border-2 bg-white min-h-[100px] font-medium" />
                    </div>
                    {isOverAutonomy && !isOverrideUnlocked && !showPinEntry && (
                      <Button type="button" variant="destructive" onClick={() => setShowPinEntry(true)} className="w-full h-12 rounded-xl font-black uppercase text-[10px] tracking-widest shadow-lg shadow-destructive/20 group">
                        <Lock className="w-4 h-4 mr-2" />Request Override<ArrowRight className="ml-2 w-3.5 h-3.5 transition-transform group-hover:translate-x-1" />
                      </Button>
                    )}
                    {isOverAutonomy && showPinEntry && !isOverrideUnlocked && (
                      <div className="pt-2 space-y-3 border-t border-dashed">
                        <p className="text-[9px] font-black uppercase text-destructive tracking-widest pt-2">Manager Authorization Required</p>
                        <Input type="number" inputMode="numeric" placeholder="Enter PIN" maxLength={4} value={overridePin} onChange={e => setOverridePin(e.target.value.slice(0, 4))} className="h-14 text-center text-2xl font-black border-2 rounded-2xl tracking-widest bg-white" />
                        <Textarea value={overrideReason} onChange={e => setOverrideReason(e.target.value)} placeholder="Justification for this override..." className="rounded-2xl border-2 bg-white min-h-[80px] font-medium" />
                        <div className="flex gap-2">
                          <Button type="button" variant="ghost" onClick={() => { setShowPinEntry(false); setOverridePin(''); setOverrideReason(''); }} className="flex-1 h-11 rounded-xl font-black uppercase text-[9px] border-2">Cancel</Button>
                          <Button type="button" variant="destructive" disabled={overridePin.length < 4 || !overrideReason.trim()} onClick={() => {
                            const auth = (staff || []).find((s: any) => s.pin === overridePin && (s.role === 'admin' || s.role === 'owner'));
                            if (!auth) { toast({ variant: 'destructive', title: 'Unauthorized', description: 'PIN not recognized.' }); return; }
                            const finalReason = overrideReason.trim() || recoveryReason.trim() || 'Service Recovery Override';
                            const finalAmount  = recoveryAmount > 0 ? recoveryAmount : Number(subtotal.toFixed(2));
                            setIsOverrideUnlocked(true); setShowPinEntry(false); setRecoveryReason(finalReason); setRecoveryAmount(finalAmount);
                            toast({ title: 'Override Authorized', description: `Approved by ${auth.name}. $${finalAmount.toFixed(2)} comped.` });
                          }} className="flex-[2] h-11 rounded-xl font-black uppercase text-[9px] tracking-widest">
                            <ShieldCheck className="w-3.5 h-3.5 mr-1.5" />Authorize
                          </Button>
                        </div>
                      </div>
                    )}
                    {isOverrideUnlocked && (
                      <div className="flex items-center justify-between p-3 bg-green-50 border-2 border-green-200 rounded-2xl">
                        <div className="flex items-center gap-2">
                          <CheckCircle className="w-4 h-4 text-green-600 shrink-0" />
                          <div>
                            <p className="text-[10px] font-black uppercase text-green-700">Override Authorized</p>
                            <p className="text-[8px] font-bold text-green-600 opacity-70 uppercase">-${safeNumber(recoveryAmount).toFixed(2)} — {recoveryReason || 'Service Recovery'}</p>
                          </div>
                        </div>
                        <Button type="button" variant="ghost" size="sm" onClick={() => { setIsOverrideUnlocked(false); setRecoveryAmount(0); setRecoveryReason(''); setOverridePin(''); setOverrideReason(''); }} className="h-7 px-2 text-[8px] font-black uppercase text-destructive hover:bg-destructive/5">Undo</Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* ── Birthday banner ── */}
      {selectedClient && isBirthdayToday && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mb-4">
          <Alert className="bg-pink-500/5 border-pink-500/20 border-2 rounded-2xl p-4 shadow-lg shadow-pink-500/5">
            <Cake className="h-5 w-5 text-pink-500" />
            <AlertTitle className="text-[10px] font-black uppercase text-pink-600 tracking-widest">Birthday Protocol Active</AlertTitle>
            <AlertDescription className="text-[10px] font-bold uppercase text-slate-600 opacity-80 leading-tight mt-1">It's {selectedClient.name.split(' ')[0]}'s special day. Consider a complimentary enhancement or birthday gift.</AlertDescription>
          </Alert>
        </motion.div>
      )}

      {/* ── Entitlements ── */}
      {selectedClient && availableEntitlements.length > 0 && (
        <div className="space-y-4">
          <p className="text-[10px] font-black uppercase tracking-widest text-primary flex items-center gap-2 ml-1"><Award className="w-3 h-3" />Available Benefits</p>
          <div className="grid gap-2">
            {availableEntitlements.map((ent: any, idx: number) => (
              <Button key={idx} variant="outline" disabled={ent.exhausted || redeemedOffer?.itemId === ent.itemId} onClick={() => handleRedeem(ent)} className={cn('h-auto py-3 px-4 rounded-2xl border-2 flex justify-between items-center transition-all', redeemedOffer?.itemId === ent.itemId ? 'bg-green-500/5 border-green-500/20 text-green-700' : ent.exhausted ? 'opacity-50 bg-muted/30 grayscale border-dashed cursor-not-allowed' : 'bg-white border-indigo-500/10 hover:border-primary/30 shadow-sm')}>
                <div className="text-left min-w-0 flex-1">
                  <p className="text-[11px] font-black uppercase tracking-tight truncate">{ent.label}</p>
                  <p className="text-[9px] font-bold text-muted-foreground uppercase opacity-60">{ent.subLabel}</p>
                </div>
                <div className="text-right ml-4 shrink-0">
                  {redeemedOffer?.itemId === ent.itemId ? <Badge className="bg-green-500 text-white border-none h-5 px-2 font-black text-[8px] uppercase">Applied</Badge> : ent.exhausted ? <div className="flex flex-col items-end gap-1"><Badge variant="destructive" className="h-5 px-2 font-black text-[8px] uppercase border-none animate-pulse">Exhausted</Badge><span className="text-[7px] font-black uppercase opacity-40">{ent.usage}</span></div> : <Badge variant="outline" className="h-5 px-2 font-black text-[8px] uppercase border-2 text-indigo-600 border-indigo-500/20">{ent.usage}</Badge>}
                </div>
              </Button>
            ))}
          </div>
        </div>
      )}

      {/* ── Itemized Cart ── */}
      <div className="space-y-4">
        <div className="flex items-center gap-2 px-1">
          <ShoppingCart className="w-4 h-4 text-primary" />
          <h3 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Itemized Manifest</h3>
        </div>
        {isCartEmpty ? (
          <div className="py-12 md:py-16 text-center border-4 border-dashed rounded-[3rem] opacity-30 flex flex-col items-center gap-4">
            <ShoppingCart className="w-10 h-10 md:w-12 md:h-12" />
            <div className="space-y-1 text-center">
              <p className="text-sm font-black uppercase tracking-widest">Cart Idle</p>
              <p className="text-[10px] font-bold uppercase tracking-tight px-4 text-center leading-relaxed">Scan a ticket or select retail items from the catalog.</p>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {appointmentsData.map((data: any) => {
              const isRedeemed            = redeemedOffer?.itemId === data.service.id;
              const addOns                = (data.appointment.addOnIds || []).map((id: any) => services.find((s: any) => s.id === id)).filter(Boolean);
              const refreshmentsInSession = data.appointment.checkoutState?.refreshments || [];
              const overrides             = data.appointment.checkoutState?.serviceStaffOverrides || {};
              const mainStaffId           = overrides[data.service.id] || data.appointment.staffId;
              const mainStaffMember       = staff.find((s: any) => s.id === mainStaffId);
              const adjustments           = data.appointment.checkoutState?.adjustments;
              const additionalCharge      = safeNumber(data.appointment.checkoutState?.additionalCharge);
              const isWaived              = waivedAppointmentFees.has(data.appointment.id);
              return (
                <Card key={data.appointment.id} className={cn('overflow-hidden rounded-[1.5rem] md:rounded-[2rem] border-2 shadow-sm transition-all', isRedeemed ? 'border-primary bg-primary/5 shadow-lg' : 'border-border/50 bg-muted/5')}>
                  <CardContent className="p-4 md:p-5 space-y-3 md:space-y-4">
                    <div className="flex justify-between items-start gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <p className="font-black text-xs md:text-sm uppercase tracking-tight text-slate-900 truncate">{data.service.name}</p>
                          {isRedeemed && <Badge className="bg-primary text-white border-none text-[7px] h-4 px-1.5 font-black uppercase tracking-widest">Entitlement</Badge>}
                        </div>
                        <p className="text-[10px] font-black uppercase tracking-widest text-primary/60">{mainStaffMember?.name?.split(' ')[0] || 'Tech'} · {data.service.duration}m</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className={cn('font-black font-mono text-base md:text-lg tracking-tighter', isRedeemed ? 'line-through text-muted-foreground opacity-40' : 'text-slate-900')}>${safeNumber(getServicePrice(data.service, data.staff)).toFixed(2)}</p>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive -mr-2" onClick={() => onSelectAppointment(data.appointment.id)}><Trash2 className="w-3.5 h-3.5" /></Button>
                      </div>
                    </div>
                    {addOns.length > 0 && (
                      <div className="space-y-2 pl-4 border-l-2 border-primary/10">
                        {addOns.map((addon: any) => {
                          const addonStaffId = overrides[addon.id] || data.appointment.staffId;
                          const addonStaff   = staff.find((s: any) => s.id === addonStaffId);
                          const isAddonRedeemed = redeemedOffer?.itemId === addon.id;
                          return (
                            <div key={addon.id} className="space-y-0.5">
                              <div className="flex justify-between items-center">
                                <div className="flex items-center gap-2"><span className={cn('text-[10px] font-bold uppercase tracking-tight', isAddonRedeemed ? 'text-primary' : 'text-muted-foreground')}>+ {addon.name}</span>{isAddonRedeemed && <Badge className="bg-primary text-white border-none text-[6px] h-3 font-black uppercase">REDEEMED</Badge>}</div>
                                <span className={cn('text-[10px] font-black font-mono', isAddonRedeemed ? 'line-through text-muted-foreground opacity-40' : 'text-muted-foreground')}>${safeNumber(getServicePrice(addon, data.staff)).toFixed(2)}</span>
                              </div>
                              <span className="text-[8px] font-black uppercase text-primary tracking-widest opacity-60">{addonStaff?.name?.split(' ')[0] || 'Tech'}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {refreshmentsInSession.length > 0 && (
                      <div className="space-y-2 pt-2 border-t border-dashed">
                        <p className="text-[8px] font-black uppercase text-muted-foreground opacity-40">Concierge Amenities</p>
                        {refreshmentsInSession.map((item: any, idx: number) => { const qty = safeNumber(item.quantity || 1); return (<div key={idx} className="flex justify-between items-center"><div className="flex items-center gap-2"><Coffee className="w-3 h-3 text-primary opacity-40" /><span className="text-[10px] font-bold text-slate-600 uppercase">{item.name}</span>{qty > 1 && <Badge variant="secondary" className="h-3.5 px-1 text-[7px] border-none font-black bg-muted/50">x{qty}</Badge>}</div><span className="font-mono text-[10px] text-slate-900">${safeNumber(item.price) > 0 ? (safeNumber(item.price) * qty).toFixed(2) : '0.00'}</span></div>); })}
                      </div>
                    )}
                    {!isWaived && (adjustments || additionalCharge > 0) && (
                      <div className="pt-3 border-t border-dashed space-y-2">
                        <p className="text-[8px] font-black uppercase text-muted-foreground opacity-40">Strategic Adjustments</p>
                        {adjustments && (safeNumber(adjustments.rescheduleFee) > 0 || safeNumber(adjustments.timeOverage) > 0 || safeNumber(adjustments.materialOverage) > 0) ? (
                          <div className="space-y-1.5">
                            {safeNumber(adjustments.rescheduleFee) > 0 && <div className="flex justify-between items-center"><span className="text-[10px] font-black uppercase text-amber-600">Protocol Recovery (Reschedule)</span><span className="font-black font-mono text-[10px] text-amber-600">+${safeNumber(adjustments.rescheduleFee).toFixed(2)}</span></div>}
                            {safeNumber(adjustments.timeOverage) > 0 && <div className="flex justify-between items-center"><span className="text-[10px] font-black uppercase text-primary">Time Foundation Overage</span><span className="font-black font-mono text-[10px] text-primary">+${safeNumber(adjustments.timeOverage).toFixed(2)}</span></div>}
                            {safeNumber(adjustments.materialOverage) > 0 && <div className="flex justify-between items-center"><span className="text-[10px] font-black uppercase text-primary">Material Protocol Overage</span><span className="font-black font-mono text-[10px] text-primary">+${safeNumber(adjustments.materialOverage).toFixed(2)}</span></div>}
                          </div>
                        ) : (additionalCharge > 0 && <div className="flex justify-between items-center"><span className="text-[10px] font-black uppercase text-primary">Manual Session Adjustment</span><span className="font-black font-mono text-[10px] text-primary">+${additionalCharge.toFixed(2)}</span></div>)}
                        {isOwnerOrAdmin && <Button variant="ghost" size="sm" className="h-6 px-2 text-[8px] font-black uppercase text-amber-600 border border-amber-200 bg-amber-50 w-full mt-1" onClick={() => handleWaiveClick(data.appointment.id)}>Absorb Adjustments</Button>}
                      </div>
                    )}
                    {isWaived && (
                      <div className="pt-3 border-t border-dashed flex justify-between items-center bg-green-50/50 p-2 rounded-xl border border-green-100">
                        <div className="flex items-center gap-2"><ShieldCheck className="w-3 h-3 text-green-600" /><span className="text-[10px] font-black uppercase text-green-700">Fees Absorbed</span></div>
                        <Button variant="ghost" size="sm" className="h-5 px-1.5 text-[8px] font-black uppercase text-primary underline" onClick={() => onWaiveFeeToggle(data.appointment.id, false)}>Restore</Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
            {cart.map((item: any) => (
              <div key={item.id} className="p-3 md:p-4 rounded-2xl md:rounded-3xl bg-muted/20 border-2 border-transparent hover:border-primary/10 transition-all flex items-center gap-3 md:gap-4 group shadow-sm">
                <div className="flex-1 min-w-0"><p className="font-black text-[11px] md:text-xs uppercase tracking-tight text-slate-900 truncate">{item.name}</p><p className="text-[9px] font-black text-muted-foreground uppercase tracking-widest opacity-60">{item.type}</p></div>
                <div className="flex items-center gap-2 md:gap-3">
                  <div className="flex items-center bg-background rounded-xl border-2 h-8 md:h-9 px-1 shadow-sm">
                    <Button variant="ghost" size="icon" className="h-6 w-6 md:h-7 md:w-7 rounded-lg hover:bg-primary/5" onClick={() => handleUpdateQuantity(item.id, item.quantity - 1)}><Minus className="h-3 w-3" /></Button>
                    <span className="w-6 md:w-8 text-center text-xs font-black">{item.quantity}</span>
                    <Button variant="ghost" size="icon" className="h-6 w-6 md:h-7 md:w-7 rounded-lg hover:bg-primary/5" onClick={() => handleUpdateQuantity(item.id, item.quantity + 1)}><Plus className="h-3 w-3" /></Button>
                  </div>
                  <p className="font-black font-mono text-sm tracking-tighter w-14 md:w-16 text-right text-slate-900">${(safeNumber(item.price) * item.quantity).toFixed(2)}</p>
                </div>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive opacity-0 group-hover:opacity-100 transition-opacity shrink-0" onClick={() => handleUpdateQuantity(item.id, 0)}><Trash2 className="w-4 h-4" /></Button>
              </div>
            ))}
            {Array.from(appliedAdjustments).map((id: any) => {
              const fee = clients.flatMap((c: any) => c.unpaidFees || []).find((f: any) => f.feeId === id);
              return (
                <div key={id} className="p-3 md:p-4 rounded-2xl md:rounded-[2rem] border-2 border-destructive/20 bg-destructive/5 flex items-center gap-3 md:gap-4 animate-in fade-in slide-in-from-left-2 shadow-sm">
                  <div className="p-2 bg-destructive/10 rounded-xl shadow-inner"><Wallet className="w-4 h-4 md:w-5 md:h-5 text-destructive" /></div>
                  <div className="flex-1 min-w-0"><p className="font-black text-[11px] md:text-xs uppercase tracking-tight text-destructive truncate">{fee?.reason}</p><p className="text-[9px] font-black text-destructive/60 uppercase tracking-widest">Protocol Debt</p></div>
                  <p className="font-black font-mono text-sm tracking-tighter text-destructive">+${safeNumber(fee?.feeAmount).toFixed(2)}</p>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive shrink-0" onClick={() => onApplyAdjustmentToggle(id, false)}><XCircle className="h-4 w-4" /></Button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Promo Code ── */}
      <div className="space-y-3">
        <Label className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground ml-1">Promo Code</Label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Tag className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-primary opacity-40" />
            <input type="text" placeholder="ENTER CODE..." value={promoCodeInput} onChange={e => setPromoCodeInput(e.target.value.toUpperCase())} onKeyDown={e => e.key === 'Enter' && handleApplyDiscount(promoCodeInput)} className="flex h-12 w-full rounded-2xl border-2 bg-white/80 pl-10 pr-4 py-2 text-sm font-black uppercase tracking-widest focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:border-primary transition-all shadow-inner" />
          </div>
          <Button variant="outline" onClick={() => handleApplyDiscount(promoCodeInput)} className="h-12 px-4 rounded-2xl border-2 font-black uppercase text-[10px] tracking-widest bg-white shadow-sm hover:border-primary/40">Apply</Button>
          <Button variant="outline" onClick={() => setIsDiscountBrowserOpen(true)} className="h-12 px-4 rounded-2xl border-2 font-black uppercase text-[10px] tracking-widest bg-white shadow-sm hover:border-primary/40"><Percent className="w-4 h-4" /></Button>
        </div>
        {appliedDiscountCodes.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {appliedDiscountCodes.map((code: string) => (
              <Badge key={code} variant="secondary" className="h-7 px-3 rounded-xl border-2 border-primary/20 bg-primary/5 text-primary font-black uppercase text-[10px] tracking-widest flex items-center gap-2">
                {code}
                <button onClick={() => setAppliedDiscountCodes(appliedDiscountCodes.filter((c: string) => c !== code))} className="hover:text-destructive transition-colors"><X className="w-3 h-3" /></button>
              </Badge>
            ))}
          </div>
        )}
      </div>

      {/* ── Payment Protocol ── */}
      <div className="space-y-4">
        <Label className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground ml-1">Payment Protocol</Label>
        <Tabs value={paymentTab} onValueChange={v => { setPaymentTab(v); setCardMode('select'); }} className="w-full">
          <TabsList className="grid w-full grid-cols-3 h-12 rounded-2xl bg-muted/30 p-1 border-2 border-muted shadow-inner">
            <TabsTrigger value="card"  className="rounded-xl font-black text-[9px] uppercase tracking-widest data-[state=active]:bg-white data-[state=active]:shadow-md"><CreditCard className="w-3 h-3 mr-1.5" /> CARD</TabsTrigger>
            <TabsTrigger value="cash"  className="rounded-xl font-black text-[9px] uppercase tracking-widest data-[state=active]:bg-white data-[state=active]:shadow-md"><Banknote className="w-3 h-3 mr-1.5" /> CASH</TabsTrigger>
            <TabsTrigger value="other" className="rounded-xl font-black text-[9px] uppercase tracking-widest data-[state=active]:bg-white data-[state=active]:shadow-md"><Landmark className="w-3 h-3 mr-1.5" /> OTHER</TabsTrigger>
          </TabsList>

          {/* ── CARD TAB ── */}
          <AnimatePresence mode="wait">
            {paymentTab === 'card' && cardMode === 'select' && (
              <motion.div key="card-select" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="pt-4 space-y-3">

                {/* Card on file option */}
                {hasCardOnFile && (
                  <button onClick={() => setCardMode('cof_tip')}
                    className="w-full flex items-center justify-between p-4 rounded-2xl border-2 border-primary/20 bg-primary/[0.02] hover:border-primary/40 hover:bg-primary/5 transition-all group text-left">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-white rounded-xl shadow-sm border border-primary/10">
                        <CreditCard className="w-5 h-5 text-primary" />
                      </div>
                      <div>
                        <p className="text-[11px] font-black uppercase tracking-tight text-slate-900">
                          {String(selectedClient?.cardOnFile?.brand || 'Card')} •••• {String(selectedClient?.cardOnFile?.last4 || '****')}
                        </p>
                        <p className="text-[9px] font-bold text-muted-foreground uppercase opacity-60">Card on File · Tap to charge</p>
                      </div>
                    </div>
                    <ArrowRight className="w-4 h-4 text-primary opacity-40 group-hover:opacity-100 transition-opacity shrink-0" />
                  </button>
                )}

                {/* Terminal reader option */}
                <button onClick={handleTerminalPayment}
                  disabled={!readerConnected}
                  className={cn('w-full flex items-center justify-between p-4 rounded-2xl border-2 transition-all group text-left',
                    readerConnected
                      ? 'border-green-200 bg-green-50/50 hover:border-green-300 hover:bg-green-50'
                      : 'border-border bg-muted/10 opacity-50 cursor-not-allowed')}>
                  <div className="flex items-center gap-3">
                    <div className={cn('p-2 rounded-xl shadow-sm border', readerConnected ? 'bg-white border-green-200' : 'bg-muted/20 border-border')}>
                      <Monitor className={cn('w-5 h-5', readerConnected ? 'text-green-600' : 'text-muted-foreground')} />
                    </div>
                    <div>
                      <p className="text-[11px] font-black uppercase tracking-tight text-slate-900">
                        {readerConnected ? terminal?.connectedReader?.label || 'Terminal Reader' : 'Terminal Reader'}
                      </p>
                      <p className="text-[9px] font-bold text-muted-foreground uppercase opacity-60">
                        {readerConnected ? 'Tap / Insert / Swipe' : 'No reader paired — configure in Settings'}
                      </p>
                    </div>
                  </div>
                  {readerConnected
                    ? <ArrowRight className="w-4 h-4 text-green-600 opacity-40 group-hover:opacity-100 transition-opacity shrink-0" />
                    : <Badge variant="outline" className="border-2 font-black text-[8px] uppercase h-5 px-2">Setup</Badge>}
                </button>

                {/* New card (embedded form) option */}
                <button onClick={() => setCardMode('new_card')}
                  className="w-full flex items-center justify-between p-4 rounded-2xl border-2 border-border bg-white hover:border-primary/20 hover:bg-primary/[0.01] transition-all group text-left">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-muted/20 rounded-xl shadow-sm border border-border">
                      <Plus className="w-5 h-5 text-slate-500" />
                    </div>
                    <div>
                      <p className="text-[11px] font-black uppercase tracking-tight text-slate-900">New Card</p>
                      <p className="text-[9px] font-bold text-muted-foreground uppercase opacity-60">Enter card details manually</p>
                    </div>
                  </div>
                  <ArrowRight className="w-4 h-4 text-muted-foreground opacity-40 group-hover:opacity-100 transition-opacity shrink-0" />
                </button>

                {/* Save card toggle for new card */}
                {selectedClient && (
                  <button type="button" onClick={() => setSaveNewCard(v => !v)}
                    className={cn('w-full flex items-center justify-between px-4 py-3 rounded-xl border-2 transition-all text-left', saveNewCard ? 'border-primary/20 bg-primary/5' : 'border-border bg-white')}>
                    <span className="text-[10px] font-black uppercase tracking-widest flex items-center gap-2">
                      <Lock className="w-3 h-3 text-primary" /> Save card to profile
                    </span>
                    <div className={cn('w-9 h-5 rounded-full relative transition-colors shrink-0', saveNewCard ? 'bg-primary' : 'bg-slate-200')}>
                      <div className={cn('absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all', saveNewCard ? 'left-[18px]' : 'left-0.5')} />
                    </div>
                  </button>
                )}
              </motion.div>
            )}

            {/* ── Card on file confirmation ── */}
            {/* ── Client-facing tip screen (card on file) ── */}
            {paymentTab === 'card' && cardMode === 'cof_tip' && selectedClient && (() => {
              const presets = [0, 10, 18, 20, 25];
              const baseForTip = subtotal; // tip on pre-tax subtotal
              return (
                <motion.div key="cof-tip" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="pt-4 space-y-6">
                  {/* Client-facing header */}
                  <div className="text-center space-y-1 py-4">
                    <p className="text-[9px] font-black uppercase tracking-[0.25em] text-muted-foreground">Turn screen toward client</p>
                    <p className="text-2xl font-black uppercase tracking-tighter text-slate-900">Add a Gratuity?</p>
                    <p className="text-[10px] font-bold text-muted-foreground uppercase">Your technician appreciates your support</p>
                  </div>

                  {/* Preset tip % buttons — large for client tapping */}
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
                    {/* No tip */}
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

                  {/* Custom tip amount */}
                  <div className="space-y-2">
                    <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground text-center">Or enter custom amount</p>
                    <div className="relative">
                      <DollarSign className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-primary opacity-40" />
                      <Input
                        type="number"
                        inputMode="decimal"
                        value={tipAmount > 0 && ![10,18,20,25].map(p => Number((baseForTip * p / 100).toFixed(2))).includes(tipAmount) ? tipAmount : ''}
                        onChange={e => handleTotalTipChange(parseFloat(e.target.value) || 0)}
                        onFocus={e => e.currentTarget.select()}
                        placeholder="0.00"
                        className="h-14 pl-10 text-2xl font-black font-mono border-2 rounded-2xl bg-white"
                      />
                    </div>
                  </div>

                  {/* Total preview */}
                  <div className="p-4 rounded-2xl bg-primary/5 border-2 border-primary/10 space-y-2">
                    <div className="flex justify-between text-[11px] text-muted-foreground">
                      <span className="font-bold uppercase">Subtotal</span>
                      <span className="font-mono">${subtotal.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-[11px] text-muted-foreground">
                      <span className="font-bold uppercase">Tax</span>
                      <span className="font-mono">${(subtotal * 0.07).toFixed(2)}</span>
                    </div>
                    {tipAmount > 0 && (
                      <div className="flex justify-between text-[11px] text-primary">
                        <span className="font-black uppercase">Gratuity</span>
                        <span className="font-mono font-black">${tipAmount.toFixed(2)}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-base font-black border-t border-primary/10 pt-2">
                      <span className="uppercase text-primary">Total</span>
                      <span className="font-mono text-primary">${finalTotal.toFixed(2)}</span>
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

            {/* ── Card on file confirmation ── */}
            {paymentTab === 'card' && cardMode === 'cof_confirm' && selectedClient && (
              <motion.div key="cof-confirm" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="pt-4">
                <CardOnFileConfirm
                  client={selectedClient}
                  amount={finalTotal}
                  onConfirm={handleCofCharge}
                  onCancel={() => setCardMode('cof_tip')}
                  isProcessing={isCofCharging}
                />
              </motion.div>
            )}

            {/* ── Terminal payment UI ── */}
            {paymentTab === 'card' && cardMode === 'terminal' && (
              <motion.div key="terminal" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <TerminalPaymentUI
                  amount={finalTotal}
                  onCancel={() => setCardMode('select')}
                  onSuccess={() => setCardMode('select')}
                />
              </motion.div>
            )}

            {/* ── Embedded new card form ── */}
            {paymentTab === 'card' && cardMode === 'new_card' && tenantId && (
              <motion.div key="new-card" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <EmbeddedCardForm
                  tenantId={tenantId}
                  clientId={selectedClient?.id}
                  clientEmail={selectedClient?.email}
                  amount={finalTotal}
                  saveCard={saveNewCard && !!selectedClient}
                  onSuccess={async (paymentIntentId) => {
                    toast({ title: 'Card Charged', description: `$${finalTotal.toFixed(2)} collected.` });
                    const manualPayload = { paymentMethod: 'card', amountTendered: finalTotal, recoveryAmount, recoveryReason, stripePaymentIntentId: paymentIntentId };
                    if (checkoutConsentForm && selectedClient) {
                      setPendingCheckout(manualPayload);
                      setActiveConsentForm(checkoutConsentForm);
                      setSignatureOpen(true);
                    } else {
                      await onCheckout(manualPayload);
                      setCardMode('select');
                    }
                  }}
                  onCancel={() => setCardMode('select')}
                />
              </motion.div>
            )}

            {/* ── Cash tab ── */}
            {paymentTab === 'cash' && (
              <motion.div key="cash" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="pt-4">
                <CashCheckout
                  finalTotal={finalTotal}
                  subtotal={subtotal}
                  tax={subtotal * 0.07}
                  amountTendered={amountTendered}
                  setAmountTendered={setAmountTendered}
                  tipAmount={tipAmount}
                  onTipChange={handleTotalTipChange}
                  onCheckout={() => {
                    const cashPayload = { paymentMethod: 'cash', amountTendered, recoveryAmount, recoveryReason, isEscalated: isOverrideUnlocked };
                    if (checkoutConsentForm && selectedClient) {
                      setPendingCheckout(cashPayload);
                      setActiveConsentForm(checkoutConsentForm);
                      setSignatureOpen(true);
                    } else {
                      onCheckout(cashPayload);
                    }
                  }}
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
        </Tabs>
      </div>

      {/* ── Totals ── */}
      <div className="space-y-4 pt-4 border-t border-dashed">
        <div className="flex justify-between items-center text-muted-foreground font-bold uppercase text-[9px] tracking-widest opacity-60">
          <p>Gross Manifest Value</p>
          <p className="font-mono text-[11px] md:text-xs">${safeNumber(subtotal).toFixed(2)}</p>
        </div>
        {finalTotal > 0 && (
          <div className="flex justify-between items-center text-muted-foreground font-bold uppercase text-[9px] tracking-widest opacity-60">
            <p>Studio Tax (7%)</p>
            <p className="font-mono text-[11px] md:text-xs">${(subtotal * 0.07).toFixed(2)}</p>
          </div>
        )}
        {totalDiscount > 0 && !isRecoveryActive && (
          <div className="flex justify-between items-center text-[10px] text-primary font-black uppercase tracking-tighter">
            <span className="flex items-center gap-2"><Percent className="w-3.5 h-3.5" /> Promotion Delta</span>
            <span className="font-mono text-[11px] md:text-xs">-${safeNumber(totalDiscount).toFixed(2)}</span>
          </div>
        )}
        {recoveryAmount > 0 && (
          <div className="flex justify-between items-center text-[10px] text-amber-600 font-black uppercase tracking-tighter">
            <span className="flex items-center gap-2"><ShieldAlert className="w-3.5 h-3.5" /> Service Recovery {recoveryReason ? `— ${recoveryReason.slice(0, 30)}${recoveryReason.length > 30 ? '...' : ''}` : ''}</span>
            <span className="font-mono text-[11px] md:text-xs shrink-0 ml-2">-${safeNumber(recoveryAmount).toFixed(2)}</span>
          </div>
        )}
        <div className="flex justify-between items-center py-1 md:py-2">
          <p className="font-black uppercase font-bold text-[10px] tracking-[0.2em] text-muted-foreground">Gratuity</p>
          <div className="relative w-32 md:w-36">
            <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 md:h-4 md:w-4 text-primary font-black" />
            <Input type="number" value={tipAmount || ''} onChange={(e) => handleTotalTipChange(parseFloat(e.target.value) || 0)} className="h-9 md:h-11 text-right pr-4 pl-9 font-black text-base md:text-xl border-2 rounded-xl md:rounded-2xl shadow-inner focus-visible:ring-primary/20 bg-muted/5" placeholder="0.00" />
          </div>
        </div>
        <div className="flex justify-between items-baseline font-black text-xl md:text-4xl text-primary tracking-tighter px-1 pt-4 border-t border-border/50">
          <div className="space-y-0.5">
            <p className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground opacity-60">Final Settlement</p>
            <p className="text-[8px] md:text-[9px] font-bold uppercase text-primary/40">COLLECT UPON AUTHORIZE</p>
          </div>
          <p className="font-mono text-2xl md:text-4xl">${safeNumber(finalTotal).toFixed(2)}</p>
        </div>

        <div className="pt-2">
          {isOverAutonomy && !isOverrideUnlocked && (
            <div className="flex items-center gap-2 p-3 rounded-2xl bg-destructive/10 border-2 border-destructive/20 mb-3">
              <Lock className="w-4 h-4 text-destructive shrink-0" />
              <p className="text-[10px] font-black uppercase text-destructive tracking-widest">Manager override required before checkout</p>
            </div>
          )}
          {/* Cash handled inside CashCheckout component — only show button for OTHER */}
          {paymentTab === 'other' && (
            <Button
              className="w-full h-14 md:h-16 text-base md:text-xl font-black rounded-2xl md:rounded-3xl shadow-2xl shadow-primary/30 transition-all hover:scale-105 active:scale-95 uppercase tracking-tight"
              onClick={() => onCheckout({ paymentMethod: paymentTab, amountTendered, recoveryAmount, recoveryReason, isEscalated: isOverrideUnlocked })}
              disabled={
                isSubmitting ||
                isCartEmpty ||
                (isGroupCheckout && !selectedClientId) ||
                (isOverAutonomy && !isOverrideUnlocked)
              }
            >
              {isSubmitting
                ? <Loader className="animate-spin h-6 w-6 md:h-7 md:w-7" />
                : finalTotal <= 0
                ? 'FINALIZE FREE SESSION'
                : `AUTHORIZE $${safeNumber(finalTotal).toFixed(2)}`}
            </Button>
          )}
          {/* Card tab — show selector prompt when no sub-mode chosen */}
          {paymentTab === 'card' && cardMode === 'select' && (
            <div className="p-4 rounded-2xl border-2 border-dashed border-primary/20 text-center">
              <p className="text-[10px] font-black uppercase tracking-widest text-primary/40">Select a payment method above to proceed</p>
            </div>
          )}
        </div>
      </div>

      <BrowseDiscountsDialog open={isDiscountBrowserOpen} onOpenChange={setIsDiscountBrowserOpen} allDiscounts={discounts || []} onSelect={handleApplyDiscount} cartServiceIds={cartServiceIds} />
      <WaiveFeeDialog open={isWaiveAuthOpen} onOpenChange={setIsPointOfSaleWaiveAuthOpen} staff={staff} onConfirm={handleConfirmWaive} title="Admin Override" description="Authorize fee waiver with manager PIN." />
      {activeConsentForm && selectedClient && signatureOpen && (
        <ConsentSignatureDialog
          open={signatureOpen}
          onOpenChange={(open) => { if (!open) handleSignatureSkip(); }}
          form={activeConsentForm}
          client={{ id: selectedClient.id, name: selectedClient.name, email: selectedClient.email }}
          tenantId={tenantId!}
          appointmentId={appointmentsData?.[0]?.appointment?.id || undefined}
          onComplete={handleSignatureComplete}
        />
      )}
    </div>
  );
};
