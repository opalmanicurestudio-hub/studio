'use client';

import React, { useState, useMemo, useCallback } from 'react';
import { AppHeader } from '@/components/shared/AppHeader';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardFooter,
} from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { 
    Edit, 
    Mail, 
    Phone, 
    Clock, 
    Award, 
    Repeat, 
    CheckCircle2, 
    ShieldAlert, 
    BadgeInfo, 
    Ban, 
    PlusCircle, 
    FlaskConical, 
    TrendingUp, 
    CreditCard, 
    Lock, 
    Zap, 
    Trash2,
    ArrowLeft,
    ArrowRight,
    Globe,
    ShieldPlus,
    AlertTriangle,
    Ear,
    Loader,
    ShieldCheck,
    Info,
    RefreshCw,
    Calendar as CalendarIcon,
    Users,
    TrendingDown,
    Activity,
    Landmark,
    Star,
    History,
    CheckCircle,
    Database,
    Coffee,
    Scale,
    Target,
    Sparkles,
    MessageSquare,
    HeartHandshake,
    Gift,
    FileSignature,
    FileImage,
    FileText,
    Maximize2,
    ChevronLeft,
    ChevronRight,
    Camera
} from 'lucide-react';
import Link from 'next/link';
import { notFound, useParams, useRouter } from 'next/navigation';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { format, parseISO, subMonths, isAfter, subYears, isBefore, startOfMonth } from 'date-fns';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { cn, safeNumber } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { Separator } from '@/components/ui/separator';
import { EditClientDialog } from '@/components/clients/EditClientDialog';
import { AddFormulaDialog } from '@/components/clients/AddFormulaDialog';
import { IssueRecoveryDialog } from '@/components/clients/IssueRecoveryDialog';
import { formatPhoneNumber } from 'react-phone-number-input';
import { nanoid } from 'nanoid';
import { useFirebase, useDoc, useMemoFirebase, updateDocumentNonBlocking, useCollection, useUser } from '@/firebase';
import { useInventory } from '@/context/InventoryContext';
import { collection, doc, arrayUnion, increment, getDocs, query, where, setDoc } from 'firebase/firestore';
import type { Client, Appointment, Service, CustomFormula, Membership, Redemption, RefreshmentRequest } from '@/lib/data';
import { useTenant } from '@/context/TenantContext';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { motion, AnimatePresence } from 'framer-motion';
import { StoreCreditHistory } from '@/components/clients/StoreCreditHistory';
import { Wallet } from 'lucide-react';

const safeDate = (val: any): Date => {
    if (!val) return new Date();
    if (val instanceof Date) return val;
    if (typeof val?.toDate === 'function') return val.toDate();
    if (typeof val === 'string') {
        try { return parseISO(val); } catch { return new Date(val); }
    }
    if (typeof val === 'object' && 'seconds' in val) return new Date(val.seconds * 1000);
    return new Date(val);
};

const getInitials = (name: string) => {
    if (!name) return '?';
    const parts = name.split(' ');
    if (parts.length > 1 && parts[parts.length-1]) {
        return (parts[0][0] + (parts[parts.length - 1][0] || '')).toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
};

const ClientIntelBanner = ({ client }: { client: Client }) => {
    const hasIntel = client.intel?.hasIncidents || client.medicalNotes || client.allergyNotes || client.sensoryNeeds || client.status === 'banned';
    if (!hasIntel) return null;
    return (
        <Card className={cn("bg-white border-2 rounded-[2rem] shadow-xl overflow-hidden relative transition-all", client.status === 'banned' && "border-destructive ring-4 ring-destructive/10")}>
            <div className={cn("absolute top-0 left-0 w-1.5 h-full", client.status === 'banned' ? "bg-destructive" : "bg-primary")} />
            <CardContent className="p-5 md:p-6 flex flex-wrap gap-x-8 gap-y-4 text-left">
                {client.status === 'banned' && (
                    <div className="flex items-center gap-3"><div className="p-2 bg-destructive rounded-xl shadow-lg shadow-destructive/20"><Ban className="w-4 h-4 text-white" /></div><span className="text-[10px] md:text-xs font-black text-destructive uppercase tracking-widest">Banned Guest</span></div>
                )}
                {client.intel?.hasIncidents && (
                    <div className="flex items-center gap-3"><div className="p-2 bg-purple-50/10 rounded-xl border border-purple-500/20 text-purple-600"><ShieldAlert className="w-4 h-4" /></div><span className="text-[10px] md:text-xs font-black uppercase tracking-widest text-purple-600">Incident History</span></div>
                )}
                {client.medicalNotes && (
                    <div className="flex items-center gap-3"><div className="p-2 bg-red-500/10 rounded-xl border border-red-500/20 text-red-600"><ShieldPlus className="w-4 h-4" /></div><span className="text-[10px] md:text-xs font-black text-red-600 uppercase tracking-widest">Medical Alert</span></div>
                )}
                {client.allergyNotes && (
                    <div className="flex items-center gap-3"><div className="p-2 bg-orange-500/10 rounded-xl border-orange-500/20 text-orange-600 border"><AlertTriangle className="w-4 h-4" /></div><span className="text-[10px] md:text-xs font-black text-orange-600 uppercase tracking-widest">Allergy Warning</span></div>
                )}
                {client.sensoryNeeds && (
                    <div className="flex items-center gap-3"><div className="p-2 bg-blue-500/10 rounded-xl border-blue-500/20 text-blue-600 border"><Ear className="w-4 h-4" /></div><span className="text-[10px] md:text-xs font-black text-blue-600 uppercase tracking-widest">Sensory Intel</span></div>
                )}
            </CardContent>
        </Card>
    );
};

const AppointmentHistoryCard = ({
  appointment,
  onRebook,
}: {
  appointment: any;
  onRebook: (appointment: Appointment) => void;
}) => {
  const displayTotal = appointment.realTotal !== null && appointment.realTotal !== undefined
    ? appointment.realTotal
    : safeNumber(appointment.revenue || appointment.service?.price || 0);
  const hasTip = safeNumber(appointment.realTip) > 0;
  const hasRecovery = appointment.aptTransactions?.some((t: any) =>
    t.type === 'expense' && (t.category === 'Discounts' || t.category === 'Service Recovery')
  );
  const hasAdjustment = appointment.aptTransactions?.some((t: any) =>
    t.category === 'Strategic Adjustment' || t.category === 'Protocol Recovery' || t.category === 'Adjustment Fee'
  );

  return (
    <Card className="flex flex-col border-2 rounded-[1.5rem] shadow-sm overflow-hidden group hover:border-primary/20 transition-all bg-white text-left">
      <CardContent className="p-5 space-y-4 flex-1 text-left">
        <div className="flex justify-between items-start text-left">
          <div className="min-w-0 flex-1 text-left">
            <p className="font-black text-sm uppercase tracking-tight text-slate-900 truncate text-left">{appointment.service?.name || 'Session'}</p>
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mt-1 opacity-60 text-left">
              {format(safeDate(appointment.startTime), 'MMMM d, yyyy')}
            </p>
            <div className="flex gap-1 mt-1.5 flex-wrap">
              {hasRecovery && <Badge className="bg-amber-100 text-amber-700 border-none font-black text-[7px] h-4 px-1.5">Recovery Applied</Badge>}
              {hasAdjustment && <Badge className="bg-blue-100 text-blue-700 border-none font-black text-[7px] h-4 px-1.5">Adjustment</Badge>}
              {hasTip && <Badge className="bg-green-100 text-green-700 border-none font-black text-[7px] h-4 px-1.5">Tip: +${safeNumber(appointment.realTip).toFixed(2)}</Badge>}
            </div>
          </div>
          <Badge
            variant="secondary"
            className={cn(
              'capitalize font-black text-[8px] h-5 px-2 border-none ml-2 shrink-0',
              appointment.status === 'completed' ? 'bg-green-100 text-green-800' : 'bg-muted text-muted-foreground'
            )}
          >
            {appointment.status}
          </Badge>
        </div>

        {appointment.status === 'cancelled' && appointment.cancellationAudit && (
          <div className="p-3 rounded-xl border-2 border-dashed border-destructive/20 bg-destructive/[0.02] space-y-1.5">
            <div className="flex items-center gap-2">
              <Ban className="w-3 h-3 text-destructive shrink-0" />
              <span className="text-[9px] font-black uppercase tracking-widest text-destructive">
                Cancelled by {appointment.cancellationAudit.actorType === 'studio' ? 'Studio' : appointment.cancellationAudit.actorType === 'no_show' ? 'No-Show' : 'Client'}
                {appointment.cancellationAudit.actorName ? ` — ${appointment.cancellationAudit.actorName}` : ''}
              </span>
            </div>
            <p className="text-[9px] font-bold text-slate-500 uppercase tracking-tight leading-relaxed">
              {(appointment.cancellationAudit.studioReason || appointment.cancellationAudit.clientReason || appointment.cancellationAudit.reason || '').toString().replace(/_/g, ' ')}
              {appointment.cancellationAudit.reasonDetail ? ` — "${appointment.cancellationAudit.reasonDetail}"` : ''}
            </p>
            <div className="flex items-center justify-between pt-1">
              <span className="text-[8px] font-black uppercase text-muted-foreground opacity-60">
                {appointment.cancellationAudit.timestamp ? format(safeDate(appointment.cancellationAudit.timestamp), 'MMM d, h:mm a') : ''}
              </span>
              <span className={cn('text-[9px] font-black uppercase', appointment.cancellationAudit.feeWaived ? 'text-green-600' : safeNumber(appointment.cancellationAudit.feeAmount) > 0 ? 'text-amber-600' : 'text-muted-foreground opacity-40')}>
                {appointment.cancellationAudit.feeWaived
                  ? 'Fee Waived'
                  : safeNumber(appointment.cancellationAudit.feeAmount) > 0
                  ? `Fee: $${safeNumber(appointment.cancellationAudit.feeAmount).toFixed(2)}`
                  : 'No Fee'}
              </span>
            </div>
            {appointment.depositDisposition && appointment.depositDisposition !== 'none' && (
              <p className="text-[8px] font-black uppercase text-primary/70 pt-0.5">
                Deposit: {appointment.depositDisposition === 'refunded' ? 'Refunded' : appointment.depositDisposition === 'store_credit' ? 'Converted to Store Credit' : appointment.depositDisposition}
              </p>
            )}
          </div>
        )}

        {appointment.hasRealData && appointment.aptTransactions?.length > 0 && (
          <div className="space-y-1.5 pt-2 border-t border-dashed">
            {appointment.aptTransactions
              .filter((t: any) => t.type === 'income')
              .map((t: any) => (
                <div key={t.id} className="flex justify-between items-center gap-2">
                  <span className="text-[9px] font-bold text-muted-foreground uppercase truncate opacity-60">{t.description}</span>
                  <span className="text-[10px] font-black font-mono text-slate-700 shrink-0">${safeNumber(t.amount).toFixed(2)}</span>
                </div>
              ))}
            {appointment.aptTransactions
              .filter((t: any) => t.type === 'expense')
              .map((t: any) => (
                <div key={t.id} className="flex justify-between items-center gap-2">
                  <span className="text-[9px] font-bold text-amber-600 uppercase truncate">{t.description}</span>
                  <span className="text-[10px] font-black font-mono text-amber-600 shrink-0">-${safeNumber(t.amount).toFixed(2)}</span>
                </div>
              ))}
          </div>
        )}

        <div className="flex justify-between items-center pt-3 border-t border-dashed text-left">
          <span className="text-[9px] font-black uppercase text-muted-foreground opacity-40 text-left">
            {appointment.hasRealData ? 'Verified Yield' : 'Scheduled Price'}
          </span>
          <span className="font-black text-lg font-mono tracking-tighter text-slate-900 text-right">
            ${displayTotal.toFixed(2)}
          </span>
        </div>
      </CardContent>
      <div className="p-2 pt-0 border-t bg-muted/5">
        <Button variant="ghost" size="sm" className="w-full font-black uppercase text-[9px] tracking-widest h-9 hover:bg-primary/5 text-primary" onClick={() => onRebook(appointment)}>
          <Repeat className="w-3.5 h-3.5 mr-2"/> Rebook Treatment
        </Button>
      </div>
    </Card>
  );
};

export default function ClientDetailPage() {
  const params = useParams<{ id: string }>();
  const { id: clientId } = params;
  const { firestore, isUserLoading } = useFirebase();
  const { selectedTenant, role, isLoading: isTenantLoading } = useTenant();
  const { appointments: allAppointments, services, memberships, redemptions: allRedemptions, packages, transactions: allTransactions } = useInventory();
  const tenantId = selectedTenant?.id;
  const isOwnerOrAdmin = role === 'owner' || role === 'admin';

  const router = useRouter();
  const clientDocRef = useMemoFirebase(() => !firestore || !clientId || !tenantId ? null : doc(firestore, `tenants/${tenantId}/clients`, clientId), [firestore, tenantId, clientId]);
  const { data: client, isLoading: clientLoading, error: clientError } = useDoc<Client>(clientDocRef);
  
  const refreshmentRequestsQuery = useMemoFirebase(() => {
      if (!firestore || !tenantId || !clientId) return null;
      return query(collection(firestore, `tenants/${tenantId}/refreshmentRequests`), where('clientId', '==', clientId));
  }, [firestore, tenantId, clientId]);
  const { data: allRequests } = useCollection(refreshmentRequestsQuery);

  // Load all transactions for this client directly
  const clientTxnQuery = useMemoFirebase(() => {
      if (!firestore || !tenantId || !clientId) return null;
      return query(collection(firestore, `tenants/${tenantId}/transactions`), where('clientId', '==', clientId));
  }, [firestore, tenantId, clientId]);
  const { data: clientTransactions } = useCollection<any>(clientTxnQuery);

  // v6 — signed consent forms, for the new Documents tab. Same pattern as
  // every other client-scoped collection query on this page.
  const signedConsentsQuery = useMemoFirebase(() => {
      if (!firestore || !tenantId || !clientId) return null;
      return collection(firestore, `tenants/${tenantId}/clients/${clientId}/signedConsents`);
  }, [firestore, tenantId, clientId]);
  const { data: signedConsents } = useCollection<any>(signedConsentsQuery);

  const { toast } = useToast();
  const [isEditClientOpen, setIsEditClientOpen] = useState(false);
  const [isAddFormulaOpen, setIsAddFormulaOpen] = useState(false);
  const [editingFormula, setEditingFormula] = useState<CustomFormula | null>(null);
  const [isQuickSettleOpen, setIsQuickSettleOpen] = useState(false);
  const [isSettleProcessing, setIsSettleProcessing] = useState(false);
  const [isReconciling, setIsReconciling] = useState(false);
  const [isRecoveryDialogOpen, setIsRecoveryDialogOpen] = useState(false);
  // v6 — lightbox for the Documents tab gallery (persistToProfile uploads,
  // e.g. Photo ID). Same multi-image prev/next pattern already built into
  // AppointmentDetailsSheet, kept local to this page since it's a separate
  // component/file.
  const [docExpandedImage, setDocExpandedImage] = useState<string | null>(null);
  const { user: currentUser } = useUser();

  // v11 — access log for sensitive documents: who viewed a client's signed
  // consent forms / uploaded documents (Photo ID, etc.), and when. This is
  // NOT a claim of HIPAA compliance by itself — that requires a legal
  // determination of whether HIPAA even applies to this business, plus
  // BAAs with every vendor touching this data, neither of which a log
  // entry can satisfy. What this DOES provide, regardless of that
  // question: a genuine, reviewable record of who accessed sensitive
  // client data, which is good practice on its own merits.
  const logDocumentAccess = useCallback(() => {
    if (!firestore || !tenantId || !clientId || !currentUser) return;
    const logRef = doc(collection(firestore, `tenants/${tenantId}/accessLogs`));
    setDoc(logRef, {
      id: logRef.id,
      tenantId,
      clientId,
      accessedBy: currentUser.uid,
      accessedByName: currentUser.displayName || currentUser.email || 'Unknown staff',
      resource: 'client_documents_tab',
      accessedAt: new Date().toISOString(),
    }).catch(() => { /* best-effort — never blocks the UI on a logging failure */ });
  }, [firestore, tenantId, clientId, currentUser]);

  const [docLightboxImages, setDocLightboxImages] = useState<{ url: string; name: string }[]>([]);
  const [docLightboxIndex, setDocLightboxIndex] = useState(0);
  const openDocLightbox = (images: { url: string; name: string }[], index: number) => {
    setDocLightboxImages(images);
    setDocLightboxIndex(index);
    setDocExpandedImage(images[index]?.url || null);
  };

  const handleRebook = (apt: any) => {
    const params = new URLSearchParams({
      rebook_apt_id: apt.id,
    });
    router.push(`/planner?${params.toString()}`);
  };

  const appointmentsForThisClient = useMemo(() => {
    return (allAppointments || [])
      .filter(apt => apt.clientId === clientId)
      .map(apt => {
        const aptTransactions = (allTransactions || []).filter((t: any) => t.appointmentId === apt.id);
        const totalPaid = aptTransactions
          .filter((t: any) => t.type === 'income')
          .reduce((sum: number, t: any) => sum + safeNumber(t.amount), 0);
        const totalRecovery = aptTransactions
          .filter((t: any) => t.type === 'expense' && (t.category === 'Discounts' || t.category === 'Service Recovery'))
          .reduce((sum: number, t: any) => sum + safeNumber(t.amount), 0);
        const tip = aptTransactions
          .filter((t: any) => t.category === 'Tips')
          .reduce((sum: number, t: any) => sum + safeNumber(t.amount), 0);
        const hasRealData = aptTransactions.length > 0;
        return {
          ...apt,
          service: services.find(s => s.id === apt.serviceId),
          realTotal: hasRealData ? totalPaid - totalRecovery : null,
          realTip: tip,
          aptTransactions,
          hasRealData,
        };
      });
  }, [clientId, allAppointments, services, allTransactions]);

  const clientRedemptions = useMemo(() => (allRedemptions || []).filter(r => r.clientId === clientId).sort((a,b) => safeDate(b.date).getTime() - safeDate(a.date).getTime()), [clientId, allRedemptions]);
  const clientRefreshments = useMemo(() => (allRequests || []).filter((r: any) => r.clientId === clientId).sort((a: any,b: any) => safeDate(b.requestedAt).getTime() - safeDate(a.requestedAt).getTime()), [clientId, allRequests]);

  const activeMembership = useMemo(() => {
    const mId = client?.subscription?.membershipId || client?.activeMembershipId;
    return (!mId || !memberships) ? null : memberships.find(m => m.id === mId);
  }, [client, memberships]);

  const getCycleCorrectUsage = (perkId: string) => {
    if (!client?.subscription || !activeMembership) return { total: 0, pending: 0, db: 0 };
    const nextBilling = safeDate(client.subscription.nextBillingDate);
    const cycleStart = startOfMonth(activeMembership.interval === 'yearly' ? subYears(nextBilling, 1) : subMonths(nextBilling, 1));
    const redemptionsInCycle = clientRedemptions.filter(r => r.serviceId === perkId && isAfter(safeDate(r.date), cycleStart) && !r.isForfeit);
    const refreshmentsInCycle = clientRefreshments.filter((r: any) => r.itemId === perkId && r.status !== 'cancelled' && isAfter(safeDate(r.requestedAt), cycleStart));
    const pendingQty = refreshmentsInCycle.filter((r: any) => r.status === 'pending').reduce((sum: number, r: any) => sum + safeNumber(r.quantity), 0);
    const deliveredQty = refreshmentsInCycle.filter((r: any) => r.status === 'delivered').reduce((sum: number, r: any) => sum + safeNumber(r.quantity), 0);
    const totalUsage = redemptionsInCycle.length + deliveredQty + pendingQty;
    return { total: totalUsage, pending: pendingQty, db: redemptionsInCycle.length + deliveredQty };
  };

  const handleQuickSettle = async () => {
    if (!client || !firestore || !tenantId) return;
    const hasCard = !!(client.cardOnFile?.token || client.cardOnFile?.paymentMethodId);
    if (!hasCard) {
        toast({ variant: 'destructive', title: "No Card on File", description: "Vault a card before attempting to settle." });
        return;
    }
    const amount = safeNumber(client.outstandingBalance);
    if (amount <= 0) return;

    setIsSettleProcessing(true);
    try {
        // This previously never called Stripe at all — it wrote a fake
        // 'income' transaction and zeroed the balance unconditionally,
        // regardless of whether any money actually moved. Now it genuinely
        // charges the card via the same route every other card-on-file charge
        // in this app uses (POS checkout, cancellation fees). That route
        // owns its own ledger write, and the real Stripe processing fee gets
        // captured the same way it does for every other charge — via the
        // charge.succeeded webhook, not anything written here.
        const res = await fetch('/api/stripe/charge-card', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                tenantId,
                clientId: client.id,
                amountCents: Math.round(amount * 100),
                description: 'Dossier Settlement — Outstanding Balance',
                category: 'Fee Recovery',
                taxBucket: 'adjustment',
            }),
        });
        const out = await res.json().catch(() => null);

        if (!out?.ok) {
            toast({ variant: 'destructive', title: "Charge Failed", description: out?.reason || 'Card was declined or could not be processed. Balance has not been cleared.' });
            return;
        }

        // Charge succeeded — clear the debt. lifetimeValue increments here
        // because unpaid fees are tracked separately from lifetimeValue when
        // incurred (see wherever unpaidFees first get added) and only count
        // once actually collected.
        await updateDocumentNonBlocking(doc(firestore, `tenants/${tenantId}/clients`, client.id), {
            outstandingBalance: 0,
            unpaidFees: [],
            lifetimeValue: increment(amount),
        });
        toast({ title: "Account Reconciled", description: `Successfully charged ${client.cardOnFile?.brand} for $${amount.toFixed(2)}.` });
        setIsQuickSettleOpen(false);
    } catch (e: any) {
        console.error(e);
        toast({ variant: 'destructive', title: "Process Failed", description: e.message || 'Could not reach the payment processor.' });
    } finally {
        setIsSettleProcessing(false);
    }
  };

  const handleReconcileLtv = async () => {
      if (!client || !firestore || !tenantId) return;
      setIsReconciling(true);
      try {
          const txnsRef = collection(firestore, `tenants/${tenantId}/transactions`);
          const q = query(txnsRef, where("clientId", "==", client.id));
          const snapshot = await getDocs(q);
          let realLtv = 0;
          snapshot.docs.forEach(d => {
              const data = d.data();
              const amt = safeNumber(data.amount);
              if (data.type === 'income') realLtv += amt;
              else if (data.type === 'reversal') realLtv -= amt;
              else if (data.type === 'expense' && data.category === 'Discounts') realLtv -= amt;
          });
          updateDocumentNonBlocking(doc(firestore, `tenants/${tenantId}/clients`, client.id), { lifetimeValue: Math.max(0, realLtv) });
          toast({ title: "Ledger Reconciled", description: `Dossier LTV synchronized to $${Math.max(0, realLtv).toFixed(2)} based on ${snapshot.docs.length} verified records.` });
      } catch (e) {
          console.error(e);
          toast({ variant: 'destructive', title: "Reconciliation Failed" });
      } finally {
          setIsReconciling(false);
      }
  };

  const handleSaveFormula = (formula: CustomFormula) => {
      if (!firestore || !tenantId || !client) return;
      const clientRef = doc(firestore, `tenants/${tenantId}/clients`, client.id);
      const currentFormulas = client.customFormulas || [];
      const existingIndex = currentFormulas.findIndex(f => f.id === formula.id);
      let nextFormulas;
      if (existingIndex !== -1) { nextFormulas = [...currentFormulas]; nextFormulas[existingIndex] = formula; }
      else nextFormulas = [...currentFormulas, formula];
      updateDocumentNonBlocking(clientRef, { customFormulas: nextFormulas });
      toast({ title: "Protocol Archived", description: `"${formula.name}" registered in technical library.` });
      setIsAddFormulaOpen(false);
      setEditingFormula(null);
  };

  const handleDeleteFormula = (formulaId: string) => {
      if (!firestore || !tenantId || !client) return;
      const clientRef = doc(firestore, `tenants/${tenantId}/clients`, client.id);
      updateDocumentNonBlocking(clientRef, { customFormulas: (client.customFormulas || []).filter(f => f.id !== formulaId) });
      toast({ title: "Protocol Purged" });
  };

  const handleEditFormula = (formula: CustomFormula) => {
      setEditingFormula(formula);
      setIsAddFormulaOpen(true);
  };

  const { safeLTV, safeStoreCredit, safeBalance, noShowTotal, cancelTotal, rescheduleTotal } = useMemo(() => ({
      safeLTV: safeNumber(client?.lifetimeValue),
      // totalStoreCredit is the unified Client Credit Ledger total — covers
      // cancellation deposit conversions, goodwill/service-recovery credit,
      // everything. walletCredit (the old field) is no longer written to by
      // anything as of the credit-ledger unification; reading it here was
      // why newly-issued credit appeared to not show up anywhere.
      safeStoreCredit: safeNumber(client?.totalStoreCredit),
      safeBalance: safeNumber(client?.outstandingBalance),
      noShowTotal: safeNumber(client?.noShowCount),
      cancelTotal: safeNumber(client?.cancellationCount),
      rescheduleTotal: safeNumber(client?.rescheduleCount)
  }), [client]);

  const isHighRisk = useMemo(() => (noShowTotal + cancelTotal) > 2, [noShowTotal, cancelTotal]);

  if (isUserLoading || isTenantLoading || clientLoading) {
      return <div className="flex min-h-screen w-full flex-col bg-slate-50/50"><AppHeader title="Profile" /><main className="flex-1 p-4 md:p-10 flex items-center justify-center"><Loader className="w-8 h-8 animate-spin text-primary" /></main></div>;
  }
  if (clientError || !client || !tenantId) return notFound();

  const upcomingAppointments = appointmentsForThisClient.filter(apt => safeDate(apt.startTime) > new Date() && apt.status !== 'cancelled');
  const pastAppointments = appointmentsForThisClient.filter(apt => safeDate(apt.startTime) <= new Date()).sort((a,b) => safeDate(b.startTime).getTime() - safeDate(a.startTime).getTime());
  const hasDebt = safeBalance > 0;
  const hasCardOnFile = !!client.cardOnFile?.token;

  return (
    <div className="flex min-h-screen w-full flex-col bg-slate-50/50 overflow-x-hidden text-left">
      <AppHeader title="Guest Dossier" />
      <main className="flex-1 p-4 sm:p-6 md:p-10 space-y-8 md:space-y-10 w-full max-w-7xl mx-auto min-w-0 text-left">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6 text-left">
          <div className="space-y-1 text-left">
            <h1 className="text-2xl md:text-5xl font-black uppercase tracking-tighter text-slate-900 leading-none text-left">Record Detail</h1>
            <p className="text-[10px] md:text-sm text-muted-foreground font-black uppercase tracking-[0.2em] opacity-60 text-left">Identity & performance profile</p>
          </div>
          <div className="flex items-center gap-2 md:gap-3 w-full sm:w-auto text-left">
            <Button variant="outline" size="sm" asChild className="flex-1 sm:flex-none h-12 px-4 md:px-6 rounded-2xl border-2 font-black uppercase text-[10px] tracking-widest bg-white/50 backdrop-blur-sm shadow-sm"><Link href="/clients" className="flex items-center"><ArrowLeft className="h-4 w-4 mr-2" />Return</Link></Button>
            {isOwnerOrAdmin && <Button variant="outline" size="sm" onClick={() => setIsEditClientOpen(true)} className="flex-1 sm:flex-none h-12 px-4 md:px-6 rounded-2xl border-2 font-black uppercase text-[10px] tracking-widest bg-white/50 backdrop-blur-sm shadow-sm"><Edit className="h-4 w-4 mr-2" />Modify</Button>}
          </div>
        </div>

        <Card className={cn("border-4 shadow-3xl rounded-[2.5rem] md:rounded-[3rem] overflow-hidden bg-white/80 backdrop-blur-xl transition-all text-left", client.status === 'banned' && "border-destructive ring-4 ring-destructive/10")}>
          <CardContent className="p-6 md:p-12 flex flex-col sm:flex-row items-center sm:items-start text-center sm:text-left gap-6 md:gap-12">
            <div className="relative shrink-0">
              <Avatar className="w-28 h-28 md:w-40 md:h-40 text-2xl border-4 border-white shadow-2xl rounded-[2.5rem] md:rounded-[3rem]">
                <AvatarImage src={client.avatarUrl} alt={client.name} className="object-cover" />
                <AvatarFallback className="font-black bg-primary/10 text-primary uppercase">{getInitials(client.name)}</AvatarFallback>
              </Avatar>
              {activeMembership && <div className="absolute -top-2 -right-2 md:-top-3 md:-right-3 bg-indigo-600 text-white p-1.5 md:p-2 rounded-2xl shadow-xl border-4 border-white"><Award className="w-4 h-4 md:w-6 md:h-6" /></div>}
            </div>
            <div className="space-y-4 flex-1 min-w-0 w-full text-left">
              <div className="flex flex-col sm:flex-row items-center justify-center sm:justify-start sm:items-baseline gap-3 md:gap-4 text-left">
                <h2 className={cn("font-black uppercase tracking-tighter text-slate-900 truncate leading-none w-full sm:w-auto text-left", client.name.length > 15 ? "text-xl md:text-4xl" : "text-2xl md:text-5xl")}>{client.name}</h2>
                <div className="flex gap-2 shrink-0">
                  {activeMembership && <Badge className="bg-indigo-500/10 text-indigo-700 border-none font-black text-[8px] md:text-[9px] uppercase tracking-widest h-6 px-3">Master Member</Badge>}
                  {client.status === 'banned' && <Badge variant="destructive" className="animate-pulse font-black text-[8px] md:text-[9px] uppercase tracking-widest h-6 px-3">Hard Restriction</Badge>}
                </div>
              </div>
              <div className="flex flex-wrap justify-center sm:justify-start gap-x-6 sm:gap-x-10 gap-y-4 pt-2 w-full text-left">
                {isOwnerOrAdmin ? (
                  <div className="space-y-1 min-w-0 max-w-full text-left">
                    <p className="text-[8px] md:text-[9px] font-black uppercase tracking-widest text-muted-foreground opacity-60 text-left">Verified Contact</p>
                    <a href={`mailto:${client.email}`} className="text-xs font-black uppercase tracking-tight text-primary hover:underline block truncate w-full text-left">{String(client.email || '')}</a>
                    <p className="text-xs font-black tracking-tight text-slate-700 text-left">{client.phone ? formatPhoneNumber(String(client.phone)) : 'N/A'}</p>
                  </div>
                ) : (
                  <div className="space-y-1 text-left">
                    <p className="text-[8px] md:text-[9px] font-black uppercase tracking-widest text-muted-foreground opacity-60 text-left">Verified Contact</p>
                    <p className="text-xs font-black uppercase tracking-tight text-muted-foreground italic text-left">Contact Restricted</p>
                  </div>
                )}
                <div className="space-y-1 text-left">
                  <p className="text-[8px] md:text-[9px] font-black uppercase tracking-widest text-muted-foreground opacity-60 text-left">Discovery Source</p>
                  <p className="text-xs font-black uppercase tracking-tight text-slate-700 text-left">{String(client.intel?.referralSource || 'Unknown')}</p>
                </div>
                <div className="space-y-1 text-left">
                  <p className="text-[8px] md:text-[9px] font-black uppercase tracking-widest text-muted-foreground opacity-60 text-left">Strategic Origin</p>
                  <Badge variant="secondary" className="h-6 px-2.5 rounded-lg border-2 font-black text-[8px] md:text-[9px] uppercase tracking-widest bg-white shadow-sm flex items-center gap-1.5 w-fit"><Globe className="w-3 h-3" />Online</Badge>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <ClientIntelBanner client={client} />

        <div className="grid lg:grid-cols-3 xl:grid-cols-4 gap-8 md:gap-10 text-left">
          <div className="lg:col-span-2 xl:col-span-3 space-y-8 md:space-y-10 min-w-0 text-left">
            <Tabs defaultValue="overview" className="text-left" onValueChange={(v) => { if (v === 'documents') logDocumentAccess(); }}>
              <ScrollArea className="w-full overflow-hidden text-left">
                <TabsList className="bg-muted/30 p-1 rounded-2xl border-2 border-muted shadow-inner flex gap-1.5 mb-6 md:mb-8 w-max text-left">
                  <TabsTrigger value="overview" className="px-6 h-10 md:h-11 rounded-xl font-black text-[9px] md:text-[10px] uppercase tracking-widest transition-all data-[state=active]:bg-white data-[state=active]:text-primary data-[state=active]:shadow-md">Overview</TabsTrigger>
                  <TabsTrigger value="preferences" className="px-6 h-10 md:h-11 rounded-xl font-black text-[9px] md:text-[10px] uppercase tracking-widest transition-all data-[state=active]:bg-white data-[state=active]:text-primary data-[state=active]:shadow-md">Preferences</TabsTrigger>
                  <TabsTrigger value="documents" className="px-6 h-10 md:h-11 rounded-xl font-black text-[9px] md:text-[10px] uppercase tracking-widest transition-all data-[state=active]:bg-white data-[state=active]:text-primary data-[state=active]:shadow-md flex items-center gap-1.5">
                    <FileText className="w-3 h-3" /> Documents
                    {((signedConsents?.length || 0) + (client.profileDocuments?.length || 0)) > 0 && (
                      <span className="ml-1 text-[7px] font-black bg-primary text-white px-1.5 py-0.5 rounded-full leading-none">
                        {(signedConsents?.length || 0) + (client.profileDocuments?.length || 0)}
                      </span>
                    )}
                  </TabsTrigger>
                  <TabsTrigger value="history" className="px-6 h-10 md:h-11 rounded-xl font-black text-[9px] md:text-[10px] uppercase tracking-widest transition-all data-[state=active]:bg-white data-[state=active]:text-primary data-[state=active]:shadow-md">History</TabsTrigger>
                  <TabsTrigger value="hospitality" className="px-6 h-10 md:h-11 rounded-xl font-black text-[9px] md:text-[10px] uppercase tracking-widest transition-all data-[state=active]:bg-white data-[state=active]:text-primary data-[state=active]:shadow-md">Hospitality</TabsTrigger>
                  <TabsTrigger value="archive" className="px-6 h-10 md:h-11 rounded-xl font-black text-[9px] md:text-[10px] uppercase tracking-widest transition-all data-[state=active]:bg-white data-[state=active]:text-primary data-[state=active]:shadow-md">Formulas</TabsTrigger>
                  <TabsTrigger value="ledger" className="px-6 h-10 md:h-11 rounded-xl font-black text-[9px] md:text-[10px] uppercase tracking-widest transition-all data-[state=active]:bg-white data-[state=active]:text-primary data-[state=active]:shadow-md">Financial Ledger</TabsTrigger>
                  <TabsTrigger value="credits" className="px-6 h-10 md:h-11 rounded-xl font-black text-[9px] md:text-[10px] uppercase tracking-widest transition-all data-[state=active]:bg-white data-[state=active]:text-primary data-[state=active]:shadow-md flex items-center gap-1.5">
                    <Wallet className="w-3 h-3" /> Credits
                    {(client?.totalStoreCredit || 0) > 0 && (
                      <span className="ml-1 text-[7px] font-black bg-green-500 text-white px-1.5 py-0.5 rounded-full leading-none">
                        ${(client.totalStoreCredit || 0).toFixed(0)}
                      </span>
                   )}
                 </TabsTrigger>
                </TabsList>

                <ScrollBar orientation="horizontal" className="hidden" />
              </ScrollArea>

              <TabsContent value="overview" className="m-0 space-y-6 md:space-y-8 animate-in fade-in duration-500 text-left">
                {activeMembership && (
                  <div className="space-y-4 text-left">
                    <h3 className="text-sm font-black uppercase tracking-[0.2em] text-indigo-600 flex items-center gap-3 text-left"><Award className="w-5 h-5" />Active Privilege Matrix</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-left">
                      {(activeMembership.includedServices || []).map(perk => {
                        const usage = getCycleCorrectUsage(perk.id);
                        const isExhausted = usage.total >= perk.quantity;
                        const progress = Math.min(100, (usage.total / safeNumber(perk.quantity)) * 100);
                        return (
                          <Card key={perk.id} className="border-2 rounded-2xl overflow-hidden bg-white shadow-sm hover:border-indigo-500/20 transition-all text-left">
                            <CardContent className="p-5 space-y-4 text-left">
                              <div className="flex justify-between items-start gap-2 text-left">
                                <div className="min-w-0 text-left">
                                  <p className="font-black text-[11px] uppercase tracking-tight text-slate-900 truncate leading-none mb-1 text-left">{perk.name}</p>
                                  <p className="text-[8px] font-bold text-muted-foreground uppercase opacity-60 text-left">Monthly Service Allotment</p>
                                </div>
                                <div className={cn("p-2 rounded-xl shadow-inner", isExhausted ? "bg-green-500/10 text-green-600" : "bg-indigo-500/10 text-indigo-600")}>
                                  {isExhausted ? <CheckCircle2 className="w-4 h-4" /> : <Star className="w-4 h-4" />}
                                </div>
                              </div>
                              <div className="space-y-2 text-left">
                                <div className="flex justify-between items-center text-[8px] font-black uppercase tracking-widest text-muted-foreground opacity-60 px-1 text-left">
                                  <span>Allotment Usage</span>
                                  <div className="flex items-center gap-1">
                                    <span>{usage.total} / {safeNumber(perk.quantity)}</span>
                                    {usage.pending > 0 && <span className="text-primary animate-pulse">(+{usage.pending} Pending)</span>}
                                  </div>
                                </div>
                                <Progress value={progress} className={cn("h-1.5 rounded-full bg-muted", isExhausted && "[&>div]:bg-green-500")} />
                              </div>
                            </CardContent>
                          </Card>
                        );
                      })}
                      {(activeMembership.includedAddOns || []).map(perk => {
                        const usage = getCycleCorrectUsage(perk.id);
                        const isExhausted = usage.total >= perk.quantity;
                        const progress = Math.min(100, (usage.total / safeNumber(perk.quantity)) * 100);
                        return (
                          <Card key={perk.id} className="border-2 rounded-2xl overflow-hidden bg-white shadow-sm hover:border-amber-500/20 transition-all text-left">
                            <CardContent className="p-5 space-y-4 text-left">
                              <div className="flex justify-between items-start text-left">
                                <div className="min-w-0 text-left">
                                  <p className="font-black text-[11px] uppercase tracking-tight text-slate-900 truncate leading-none mb-1 text-left">{perk.name}</p>
                                  <p className="text-[8px] font-bold text-muted-foreground uppercase opacity-60 text-left">Monthly Enhancement Allotment</p>
                                </div>
                                <div className={cn("p-2 rounded-xl shadow-inner", isExhausted ? "bg-green-500/10 text-green-600" : "bg-amber-500/10 text-amber-700")}>
                                  {isExhausted ? <CheckCircle2 className="w-4 h-4" /> : <Zap className="w-5 h-5" />}
                                </div>
                              </div>
                              <div className="space-y-2 text-left">
                                <div className="flex justify-between items-center text-[8px] font-black uppercase tracking-widest text-muted-foreground opacity-60 px-1 text-left">
                                  <span>Allotment Usage</span>
                                  <div className="flex items-center gap-1">
                                    <span>{usage.total} / {safeNumber(perk.quantity)}</span>
                                    {usage.pending > 0 && <span className="text-primary animate-pulse">(+{usage.pending} Pending)</span>}
                                  </div>
                                </div>
                                <Progress value={progress} className={cn("h-1.5 rounded-full bg-muted", isExhausted && "[&>div]:bg-green-500")} />
                              </div>
                            </CardContent>
                          </Card>
                        );
                      })}
                      {(activeMembership.includedProducts || []).map(perk => {
                        const usage = getCycleCorrectUsage(perk.id);
                        const isExhausted = usage.total >= perk.quantity;
                        const progress = Math.min(100, (usage.total / safeNumber(perk.quantity)) * 100);
                        return (
                          <Card key={perk.id} className="border-2 rounded-2xl overflow-hidden bg-white shadow-sm hover:border-primary/20 transition-all text-left">
                            <CardContent className="p-5 space-y-4 text-left">
                              <div className="flex justify-between items-start text-left">
                                <div className="min-w-0 text-left">
                                  <p className="font-black text-[11px] uppercase tracking-tight text-slate-900 truncate leading-none mb-1 text-left">{perk.name}</p>
                                  <p className="text-[8px] font-bold text-muted-foreground uppercase opacity-60 text-left">Monthly Hospitality Allotment</p>
                                </div>
                                <div className={cn("p-2 rounded-xl shadow-inner", isExhausted ? "bg-green-500/10 text-green-600" : "bg-primary/10 text-primary")}>
                                  {isExhausted ? <CheckCircle2 className="w-4 h-4" /> : <Coffee className="w-4 h-4" />}
                                </div>
                              </div>
                              <div className="space-y-2 text-left">
                                <div className="flex justify-between items-center text-[8px] font-black uppercase tracking-widest text-muted-foreground opacity-60 px-1 text-left">
                                  <span>Allotment Usage</span>
                                  <div className="flex items-center gap-1">
                                    <span>{usage.total} / {safeNumber(perk.quantity)}</span>
                                    {usage.pending > 0 && <span className="text-primary animate-pulse">(+{usage.pending} Pending)</span>}
                                  </div>
                                </div>
                                <Progress value={progress} className={cn("h-1.5 rounded-full bg-muted", isExhausted && "[&>div]:bg-green-500")} />
                              </div>
                            </CardContent>
                          </Card>
                        );
                      })}
                    </div>
                  </div>
                )}

                <Card className="border-2 shadow-sm rounded-[2rem] md:rounded-[2.5rem] overflow-hidden bg-white text-left">
                  <CardHeader className="bg-muted/5 border-b p-6 md:p-8 pb-4 text-left">
                    <CardTitle className="text-sm font-black uppercase tracking-widest text-muted-foreground flex items-center gap-3 text-left"><BadgeInfo className="w-4 h-4 text-primary" /> Dossier Details</CardTitle>
                  </CardHeader>
                  <CardContent className="p-6 md:p-8 grid grid-cols-1 md:grid-cols-2 gap-8 md:gap-10 text-left">
                    <div className="space-y-6 text-left">
                      <div className="space-y-1 text-left">
                        <p className="text-[8px] md:text-[9px] font-black uppercase tracking-widest text-muted-foreground opacity-60 text-left">Birth Milestone</p>
                        <p className="text-base md:text-lg font-black uppercase text-slate-900 tracking-tight text-left">{client.birthday ? format(safeDate(client.birthday), 'MMMM d') : 'Not on file'}</p>
                      </div>
                      {client.address && <div className="space-y-1 text-left"><p className="text-[8px] md:text-[9px] font-black uppercase tracking-widest text-muted-foreground opacity-60 text-left">Primary Domicile</p><p className="text-xs font-bold text-slate-700 leading-relaxed uppercase tracking-tight text-left">{String(client.address.street || '')}<br/>{String(client.address.city || '')}, {String(client.address.state || '')} {String(client.address.zip || '')}</p></div>}
                    </div>
                    <div className="space-y-6 text-left">
                      {client.emergencyContact && <div className="space-y-1 p-4 md:p-5 rounded-2xl bg-destructive/[0.02] border-2 border-destructive/10 text-left"><p className="text-[8px] md:text-[9px] font-black uppercase tracking-widest text-destructive/60 mb-2 text-left">Emergency Protocol</p><p className="text-xs font-black text-slate-900 uppercase tracking-tight text-left">{String(client.emergencyContact.name || '')}</p><p className="text-[9px] md:text-[10px] font-bold text-slate-500 uppercase tracking-widest opacity-60 text-left">{String(client.emergencyContact.relationship || '')}</p><p className="text-xs font-black text-primary tracking-tight mt-2 text-left">{client.emergencyContact.phone ? formatPhoneNumber(String(client.emergencyContact.phone)) : 'N/A'}</p></div>}
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="preferences" className="m-0 space-y-8 animate-in fade-in duration-500 text-left">
                <div className="space-y-8 text-left">
                  <h3 className="text-sm font-black uppercase tracking-[0.2em] text-primary flex items-center gap-3 text-left px-1"><Sparkles className="w-5 h-5 text-primary" />Guest Discovery & Preferences</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-left">
                    <Card className="border-2 rounded-[2rem] overflow-hidden bg-white shadow-sm text-left"><CardHeader className="bg-muted/5 border-b p-5 text-left"><CardTitle className="text-xs font-black uppercase tracking-tight flex items-center gap-2 text-left"><Target className="w-4 h-4 text-primary opacity-40" />Strategic Goals</CardTitle></CardHeader><CardContent className="p-5 text-left"><p className="text-sm font-medium text-slate-700 leading-relaxed italic text-left">{client.notes?.goals ? `"${client.notes.goals}"` : "No specific goals archived."}</p></CardContent></Card>
                    <Card className="border-2 rounded-[2rem] overflow-hidden bg-white shadow-sm text-left"><CardHeader className="bg-muted/5 border-b p-5 text-left"><CardTitle className="text-xs font-black uppercase tracking-tight flex items-center gap-2 text-left"><RefreshCw className="w-4 h-4 text-primary opacity-40" />Current Routine</CardTitle></CardHeader><CardContent className="p-5 text-left"><p className="text-sm font-medium text-slate-700 leading-relaxed italic text-left">{client.notes?.routine ? `"${client.notes.routine}"` : "No routine details on file."}</p></CardContent></Card>
                    <Card className="border-2 rounded-[2rem] overflow-hidden bg-white shadow-sm text-left"><CardHeader className="bg-muted/5 border-b p-5 text-left"><CardTitle className="text-xs font-black uppercase tracking-tight flex items-center gap-2 text-left"><History className="w-4 h-4 text-primary opacity-40" />Service History Notes</CardTitle></CardHeader><CardContent className="p-5 text-left"><p className="text-sm font-medium text-slate-700 leading-relaxed italic text-left">{client.notes?.history ? `"${client.notes.history}"` : "No historical context archived."}</p></CardContent></Card>
                    <Card className="border-2 rounded-[2rem] overflow-hidden bg-white shadow-sm text-left"><CardHeader className="bg-muted/5 border-b p-5 text-left"><CardTitle className="text-xs font-black uppercase tracking-tight flex items-center gap-2 text-left"><Ear className="w-4 h-4 text-primary opacity-40" />Sensory & Environment</CardTitle></CardHeader><CardContent className="p-5 text-left"><p className="text-sm font-medium text-slate-700 leading-relaxed italic text-left">{client.sensoryNeeds ? `"${client.sensoryNeeds}"` : "No sensory preferences recorded."}</p></CardContent></Card>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="documents" className="m-0 space-y-8 animate-in fade-in duration-500 text-left">
                <div className="space-y-4 text-left">
                  <h3 className="text-sm font-black uppercase tracking-[0.2em] text-primary flex items-center gap-3 text-left px-1">
                    <FileSignature className="w-5 h-5" />Signed Consent Forms
                  </h3>
                  {signedConsents && signedConsents.length > 0 ? (
                    <div className="rounded-[2rem] border-2 bg-white shadow-sm overflow-hidden divide-y">
                      {signedConsents.map((sc: any) => (
                        <div key={sc.formId} className="p-5 flex items-start justify-between gap-4 text-left">
                          <div className="min-w-0 flex-1 text-left">
                            <p className="font-black text-xs uppercase tracking-tight text-slate-900 text-left">{sc.formTitle || sc.formId}</p>
                            <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest mt-1 opacity-60 text-left">
                              Signed {sc.signedAt ? format(safeDate(sc.signedAt), 'MMM d, yyyy · h:mm a') : 'Unknown date'}
                              {sc.appointmentId ? ' · via appointment' : ''}
                            </p>
                            {sc.guardianName && (
                              <div className="mt-2 p-3 rounded-xl bg-amber-50 border border-amber-200 text-left">
                                <p className="text-[8px] font-black uppercase text-amber-700 tracking-widest">Guardian Consent</p>
                                <p className="text-[10px] font-bold text-amber-900 mt-0.5">{sc.guardianName} — {sc.guardianRelationship || 'Guardian'}</p>
                              </div>
                            )}
                          </div>
                          <Badge
                            variant="secondary"
                            className={cn(
                              'font-black text-[8px] h-5 px-2 border-none shrink-0',
                              sc.source === 'client_self_service' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-600',
                            )}
                          >
                            {sc.source === 'client_self_service' ? 'Self-Service' : 'Staff Witnessed'}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="py-12 text-center border-4 border-dashed rounded-[2rem] opacity-30 flex flex-col items-center gap-3">
                      <FileSignature className="w-10 h-10" />
                      <p className="text-[10px] font-black uppercase tracking-widest">No forms signed yet</p>
                    </div>
                  )}
                </div>

                <div className="space-y-4 pt-6 border-t border-dashed text-left">
                  <h3 className="text-sm font-black uppercase tracking-[0.2em] text-primary flex items-center gap-3 text-left px-1">
                    <Camera className="w-5 h-5" />Marketing &amp; Photo Consent
                  </h3>
                  {client.marketingConsent ? (
                    <div className={cn(
                      "p-5 rounded-[2rem] border-2 flex items-center justify-between",
                      client.marketingConsent.consented ? "bg-green-50 border-green-200" : "bg-slate-50 border-slate-200"
                    )}>
                      <div>
                        <p className={cn("font-black text-xs uppercase tracking-tight", client.marketingConsent.consented ? "text-green-700" : "text-slate-600")}>
                          {client.marketingConsent.consented ? 'Agreed to marketing use' : 'Declined marketing use'}
                        </p>
                        <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest mt-1 opacity-60">
                          {client.marketingConsent.consentedAt ? format(safeDate(client.marketingConsent.consentedAt), 'MMM d, yyyy') : ''}
                        </p>
                      </div>
                      {client.marketingConsent.consented ? <CheckCircle2 className="w-5 h-5 text-green-500" /> : <Ban className="w-5 h-5 text-slate-400" />}
                    </div>
                  ) : (
                    <div className="py-8 text-center border-4 border-dashed rounded-[2rem] opacity-30">
                      <p className="text-[10px] font-black uppercase tracking-widest">Not yet asked</p>
                    </div>
                  )}
                </div>

                <div className="space-y-4 pt-6 border-t border-dashed text-left">
                  <h3 className="text-sm font-black uppercase tracking-[0.2em] text-primary flex items-center gap-3 text-left px-1">
                    <FileImage className="w-5 h-5" />Documents on File
                  </h3>
                  {client.profileDocuments && client.profileDocuments.length > 0 ? (
                    <div className="space-y-4">
                      {client.profileDocuments.map((pd: any) => {
                        const images = (pd.files || []).map((f: any) => ({ url: f.url, name: f.name }));
                        return (
                          <div key={pd.requirementId} className="space-y-2">
                            <div className="flex items-center justify-between text-[10px] font-black uppercase">
                              <span className="flex items-center gap-2 text-muted-foreground">{pd.label}</span>
                              <span className="text-[9px] font-bold text-muted-foreground opacity-60">
                                Added {pd.uploadedAt ? format(safeDate(pd.uploadedAt), 'MMM d, yyyy') : ''}
                              </span>
                            </div>
                            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2.5">
                              {images.map((im: any, i: number) => (
                                <button
                                  key={i}
                                  onClick={() => openDocLightbox(images, i)}
                                  className="group relative aspect-square rounded-xl overflow-hidden border-2 bg-muted/5 cursor-zoom-in"
                                >
                                  <img src={im.url} alt={im.name} className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105" />
                                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center">
                                    <Maximize2 className="w-5 h-5 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                                  </div>
                                </button>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="py-12 text-center border-4 border-dashed rounded-[2rem] opacity-30 flex flex-col items-center gap-3">
                      <FileImage className="w-10 h-10" />
                      <p className="text-[10px] font-black uppercase tracking-widest">No documents on file</p>
                    </div>
                  )}
                </div>
              </TabsContent>

              <TabsContent value="history" className="m-0 space-y-8 md:space-y-10 animate-in fade-in duration-500 text-left">
                <div className="space-y-4 text-left">
                  <h3 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-4 mb-4 opacity-60 text-left">Scheduled Events</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-left">
                    {upcomingAppointments.length > 0 ? upcomingAppointments.map((apt) => <AppointmentHistoryCard key={apt.id} appointment={apt} onRebook={handleRebook} />) : <div className="col-span-full py-12 md:py-16 text-center border-4 border-dashed rounded-[2rem] md:rounded-[2.5rem] opacity-30 flex flex-col items-center gap-3"><CalendarIcon className="w-10 h-10 md:w-12 md:h-12 mx-auto mb-2"/><p className="text-[10px] md:text-xs font-black uppercase tracking-widest">No upcoming sessions</p></div>}
                  </div>
                </div>
                <div className="space-y-4 pt-6 border-t border-dashed text-left">
                  <h3 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-4 mb-4 opacity-60 text-left">Historical Records</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-left">
                    {pastAppointments.length > 0 ? pastAppointments.map((apt) => <AppointmentHistoryCard key={apt.id} appointment={apt} onRebook={handleRebook} />) : <div className="col-span-full py-12 md:py-16 text-center border-4 border-dashed rounded-[2rem] md:rounded-[2.5rem] opacity-30 flex flex-col items-center gap-3"><Clock className="w-10 h-10 md:w-12 md:h-12 mx-auto mb-2"/><p className="text-[10px] font-black uppercase tracking-widest">Empty history</p></div>}
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="hospitality" className="m-0 space-y-8 animate-in fade-in duration-500 text-left">
                <div className="space-y-6 text-left">
                  <h3 className="text-sm font-black uppercase tracking-[0.2em] text-primary flex items-center gap-3 text-left px-1"><Coffee className="w-5 h-5 text-primary" />Concierge Service Log</h3>
                  {clientRefreshments.length > 0 ? (
                    <div className="grid gap-3 text-left">
                      {clientRefreshments.map((req: any) => (
                        <Card key={req.id} className="border-2 rounded-[1.5rem] overflow-hidden bg-white shadow-sm hover:border-primary/20 transition-all text-left group">
                          <CardContent className="p-5 flex items-center justify-between gap-4 text-left">
                            <div className="flex items-center gap-4 text-left">
                              <div className={cn("p-2.5 rounded-xl shadow-inner", req.status === 'delivered' ? "bg-green-500/10 text-green-600" : "bg-amber-500/10 text-amber-700")}><Coffee className="w-5 h-5" /></div>
                              <div className="min-w-0 text-left">
                                <p className="font-black text-sm uppercase tracking-tight text-slate-900 truncate leading-none mb-1 text-left">{req.itemName}</p>
                                <div className="flex items-center gap-2 text-left">
                                  <p className="text-[8px] font-bold text-muted-foreground uppercase opacity-60 text-left">Served {format(safeDate(req.requestedAt), 'MMM d, h:mm a')}</p>
                                  <Badge variant="outline" className={cn("h-4 px-1 text-[7px] font-black uppercase border-none", req.status === 'delivered' ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700')}>{req.status}</Badge>
                                </div>
                              </div>
                            </div>
                            <div className="text-right shrink-0">
                              <p className="font-black text-sm font-mono text-slate-900 text-right">x{safeNumber(req.quantity) || 1}</p>
                              {safeNumber(req.priceAtRequest) > 0 ? <p className="text-[8px] font-black uppercase text-primary text-right">${(safeNumber(req.priceAtRequest) * (safeNumber(req.quantity) || 1)).toFixed(2)}</p> : <p className="text-[8px] font-black uppercase text-green-600 text-right">COMP</p>}
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  ) : (
                    <div className="py-20 text-center border-4 border-dashed rounded-[3rem] opacity-30 flex flex-col items-center gap-4">
                      <Coffee className="w-16 h-16" />
                      <p className="text-[10px] font-black uppercase tracking-widest text-center px-8 leading-relaxed">No concierge requests logged.</p>
                    </div>
                  )}
                </div>
              </TabsContent>

              <TabsContent value="archive" className="m-0 space-y-8 animate-in fade-in duration-500 text-left">
                <div className="space-y-6 text-left">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 px-1 text-left">
                    <h3 className="text-sm font-black uppercase tracking-[0.2em] text-primary flex items-center gap-3 text-left"><FlaskConical className="w-5 h-5 text-primary" />Technical Archive (Formulas)</h3>
                    <Button variant="ghost" size="sm" onClick={() => setIsAddFormulaOpen(true)} className="h-8 px-4 rounded-xl border-2 border-primary/20 bg-primary/5 text-primary font-black uppercase text-[10px] tracking-widest shadow-sm hover:bg-primary/10"><PlusCircle className="mr-2 h-3.5 w-3.5" /> Establish Protocol</Button>
                  </div>
                  {client.customFormulas && client.customFormulas.length > 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-left">
                      {client.customFormulas.map((formula) => (
                        <Card key={formula.id} className="border-2 rounded-[2rem] overflow-hidden bg-white shadow-sm hover:border-primary/20 transition-all group text-left">
                          <CardHeader className="bg-muted/5 border-b p-5 flex flex-row items-center justify-between text-left">
                            <div className="space-y-0.5 text-left">
                              <CardTitle className="text-xs font-black uppercase tracking-tight text-left">{String(formula.name || 'Untitled Formula')}</CardTitle>
                              <p className="text-[8px] font-bold text-muted-foreground uppercase opacity-60 text-left">Established {format(safeDate(formula.date), 'MMM d, yyyy')}</p>
                            </div>
                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <Button variant="ghost" size="icon" className="h-8 w-8 text-primary" onClick={() => handleEditFormula(formula)}><Edit className="w-3.5 h-3.5" /></Button>
                              <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDeleteFormula(formula.id)}><Trash2 className="w-3.5 h-3.5" /></Button>
                            </div>
                          </CardHeader>
                          <CardContent className="p-5 space-y-4 text-left">
                            <div className="space-y-2 text-left">
                              {formula.items.map((item, idx) => (
                                <div key={idx} className="p-3 rounded-xl bg-muted/20 border-2 border-transparent space-y-1.5">
                                  <div className="flex justify-between items-center text-[10px] font-bold uppercase tracking-tight">
                                    <span className="text-slate-600 truncate mr-2 text-left">{String(item.name || 'Component')}</span>
                                    <span className="font-black text-slate-900 shrink-0 text-right">{safeNumber(item.quantity)}{String(item.unit || 'u')}</span>
                                  </div>
                                  {item.note && (
                                    <div className="flex items-start gap-2 pt-1 border-t border-slate-900/5">
                                      <MessageSquare className="w-2.5 h-2.5 text-primary opacity-40 mt-0.5" />
                                      <p className="text-[9px] font-medium text-slate-500 italic leading-tight">"{item.note}"</p>
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                            {formula.notes && (
                              <div className="pt-2 text-left">
                                <p className="text-[8px] font-black uppercase text-muted-foreground opacity-40 mb-1 text-left">Global Method Audit</p>
                                <p className="text-[10px] font-medium text-slate-500 leading-relaxed italic border-l-2 border-primary/20 pl-3 text-left">"{String(formula.notes)}"</p>
                              </div>
                            )}
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  ) : (
                    <div className="py-20 text-center border-4 border-dashed rounded-[3rem] opacity-30 flex flex-col items-center gap-4">
                      <FlaskConical className="w-16 h-16" />
                      <p className="text-[10px] font-black uppercase tracking-widest text-center px-8 leading-relaxed">No strategic formulas archived.</p>
                    </div>
                  )}
                </div>
              </TabsContent>

              <TabsContent value="ledger" className="m-0 space-y-8 animate-in fade-in duration-500 text-left">

                {/* ── Full transaction history ── */}
                <div className="space-y-4 text-left">
                  <div className="flex items-center justify-between px-1">
                    <h3 className="text-[10px] font-black uppercase tracking-widest text-primary ml-1 text-left">Transaction History</h3>
                    <span className="text-[9px] font-black uppercase text-muted-foreground opacity-60">{(clientTransactions || []).length} records</span>
                  </div>
                  {(clientTransactions || []).length > 0 ? (() => {
                    // Group by checkoutSessionId so related line items are collapsed together
                    const sorted = [...(clientTransactions || [])].sort((a: any, b: any) => safeDate(b.date).getTime() - safeDate(a.date).getTime());
                    const sessionMap = new Map<string, any[]>();
                    const ungrouped: any[] = [];
                    sorted.forEach((txn: any) => {
                      if (txn.checkoutSessionId) {
                        if (!sessionMap.has(txn.checkoutSessionId)) sessionMap.set(txn.checkoutSessionId, []);
                        sessionMap.get(txn.checkoutSessionId)!.push(txn);
                      } else { ungrouped.push(txn); }
                    });
                    const renderTxn = (txn: any) => (
                      <div key={txn.id} className={cn("flex items-center justify-between p-3 rounded-xl border bg-white/50 text-left",
                        txn.type === 'income' ? 'border-green-100' : txn.type === 'reversal' ? 'border-slate-100 opacity-60' : 'border-destructive/10')}>
                        <div className="min-w-0 flex-1">
                          <p className="font-black text-[10px] uppercase tracking-tight text-slate-900 truncate">{String(txn.description || 'Transaction')}</p>
                          <Badge className={cn("h-3.5 px-1 text-[7px] font-black uppercase border-none mt-0.5",
                            txn.category === 'Service Revenue' ? 'bg-indigo-100 text-indigo-700' :
                            txn.category === 'Tips' ? 'bg-amber-100 text-amber-700' :
                            txn.category === 'Tax Collected' ? 'bg-slate-100 text-slate-600' :
                            txn.category === 'Retail' ? 'bg-teal-100 text-teal-700' :
                            'bg-muted text-muted-foreground')}>{txn.category}</Badge>
                        </div>
                        <p className={cn("font-black font-mono text-sm shrink-0 ml-3",
                          txn.type === 'income' ? 'text-green-600' : txn.type === 'reversal' ? 'text-slate-400' : 'text-destructive')}>
                          {txn.type === 'income' ? '+' : txn.type === 'reversal' ? '' : '-'}${safeNumber(txn.amount).toFixed(2)}
                        </p>
                      </div>
                    );
                    return (
                      <div className="space-y-3">
                        {Array.from(sessionMap.entries()).map(([sid, txns]) => {
                          const first = txns[0];
                          const income = txns.filter((t: any) => t.type === 'income').reduce((s: number, t: any) => s + safeNumber(t.amount), 0);
                          const expense = txns.filter((t: any) => t.type === 'expense').reduce((s: number, t: any) => s + safeNumber(t.amount), 0);
                          const net = income - expense;
                          return (
                            <div key={sid} className="rounded-2xl border-2 border-primary/10 bg-primary/[0.02] overflow-hidden">
                              <div className="flex items-center justify-between px-4 py-3 border-b border-primary/10 bg-primary/[0.03]">
                                <div>
                                  <p className="text-[9px] font-black uppercase tracking-widest text-primary/60">{format(safeDate(first.date), 'MMM d, yyyy · h:mm a')}</p>
                                  <p className="text-[10px] font-black uppercase text-slate-700">{first.paymentMethod} · {txns.length} line{txns.length !== 1 ? 's' : ''}</p>
                                </div>
                                <p className="font-black font-mono text-base text-primary">${net.toFixed(2)}</p>
                              </div>
                              <div className="p-3 space-y-1.5">{txns.map(renderTxn)}</div>
                            </div>
                          );
                        })}
                        {ungrouped.map((txn: any) => (
                          <div key={txn.id} className={cn("flex items-center justify-between p-4 rounded-2xl border-2 bg-white text-left",
                            txn.type === 'income' ? 'border-green-100' : txn.type === 'reversal' ? 'border-slate-100 opacity-60' : 'border-destructive/10')}>
                            <div className="flex items-center gap-3 min-w-0 flex-1">
                              <div className={cn("p-2 rounded-xl shrink-0",
                                txn.type === 'income' ? 'bg-green-50 text-green-600' : txn.type === 'reversal' ? 'bg-muted text-muted-foreground' : 'bg-destructive/10 text-destructive')}>
                                {txn.type === 'income' ? <TrendingUp className="w-3.5 h-3.5" /> : txn.type === 'reversal' ? <RefreshCw className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                              </div>
                              <div className="min-w-0 text-left">
                                <p className="font-black text-[11px] uppercase tracking-tight text-slate-900 truncate">{String(txn.description || 'Transaction')}</p>
                                <p className="text-[8px] font-bold text-muted-foreground uppercase opacity-60">{format(safeDate(txn.date), 'MMM d, yyyy · h:mm a')}</p>
                              </div>
                            </div>
                            <p className={cn("font-black font-mono text-sm shrink-0 ml-3",
                              txn.type === 'income' ? 'text-green-600' : txn.type === 'reversal' ? 'text-slate-400' : 'text-destructive')}>
                              {txn.type === 'income' ? '+' : txn.type === 'reversal' ? '' : '-'}${safeNumber(txn.amount).toFixed(2)}
                            </p>
                          </div>
                        ))}
                      </div>
                    );
                  })() : (
                    <div className="py-10 text-center border-4 border-dashed rounded-[2rem] opacity-30 flex flex-col items-center gap-3">
                      <History className="w-10 h-10" />
                      <p className="text-[10px] font-black uppercase tracking-widest">No transactions on file</p>
                    </div>
                  )}
                </div>

                <Separator className="border-dashed" />

                {/* ── Unpaid fees ── */}
                <div className="space-y-4 text-left">
                  <h3 className="text-[10px] font-black uppercase tracking-widest text-destructive ml-1 text-left">Unpaid Protocol Fees</h3>
                  {client.unpaidFees && client.unpaidFees.length > 0 ? (
                    <div className="grid gap-3 text-left">
                      {client.unpaidFees.map((fee) => (
                        <div key={fee.feeId} className="flex justify-between items-center p-5 rounded-2xl border-2 border-destructive/20 bg-destructive/[0.02] shadow-sm text-left">
                          <div className="space-y-1 text-left">
                            <p className="font-black text-sm uppercase tracking-tight text-destructive text-left">{String(fee.reason || 'Outstanding Balance')}</p>
                            <p className="text-[9px] font-bold text-muted-foreground uppercase opacity-60 text-left">Incurred {format(safeDate(fee.appointmentDate), 'MMM d, yyyy')}</p>
                          </div>
                          <p className="text-xl font-black font-mono tracking-tighter text-destructive text-right">${safeNumber(fee.feeAmount).toFixed(2)}</p>
                        </div>
                      ))}
                    </div>
                  ) : <div className="py-10 text-center border-4 border-dashed rounded-[2rem] opacity-30 flex flex-col items-center gap-3"><CheckCircle2 className="w-10 h-10" /><p className="text-[10px] font-black uppercase tracking-widest">Account Clear</p></div>}
                </div>

                <Separator className="border-dashed" />

                {/* ── Redemptions ── */}
                <div className="space-y-4 text-left">
                  <h3 className="text-[10px] font-black uppercase tracking-widest text-primary ml-1 text-left">Certified Redemptions & Waivers</h3>
                  <div className="grid gap-3 text-left">
                    {clientRedemptions.map(r => (
                      <div key={r.id} className={cn("flex items-center justify-between p-4 rounded-2xl border-2 bg-white text-left", r.isForfeit && "border-destructive/20 bg-destructive/[0.01]")}>
                        <div className="flex items-center gap-4 text-left">
                          <div className={cn("p-2 rounded-xl shadow-inner", r.isForfeit ? "bg-destructive/10 text-destructive" : r.type === 'membership' ? "bg-indigo-500/10 text-indigo-600" : "bg-teal-500/10 text-teal-600")}>
                            {r.isForfeit ? <AlertTriangle className="w-4 h-4" /> : r.type === 'membership' ? <Award className="w-4 h-4" /> : <Repeat className="w-4 h-4" />}
                          </div>
                          <div className="min-w-0 text-left">
                            <p className="font-black text-[11px] uppercase tracking-tight text-slate-900 truncate text-left">{String(r.serviceName || 'Benefit')}</p>
                            <p className="text-[8px] font-bold text-muted-foreground uppercase opacity-60 text-left">Via {String(r.offeringName || 'Offer')}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-[10px] font-black font-mono text-right">{format(safeDate(r.date), 'MMM d, yy')}</p>
                          <Badge variant={r.isForfeit ? "destructive" : "outline"} className="h-4 px-1 text-[7px] font-black uppercase mt-1 border-none shadow-sm">{r.isForfeit ? "FORFEITED" : "REDEEMED"}</Badge>
                        </div>
                      </div>
                    ))}
                    {clientRedemptions.length === 0 && (
                      <div className="py-10 text-center border-4 border-dashed rounded-[2rem] opacity-30 flex flex-col items-center gap-3">
                        <History className="w-10 h-10" />
                        <p className="text-[10px] font-black uppercase tracking-widest">No Redemption History</p>
                      </div>
                    )}
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="credits" className="m-0 animate-in fade-in duration-500 text-left">
                <StoreCreditHistory client={client} isOwnerOrAdmin={isOwnerOrAdmin} />
              </TabsContent>
            </Tabs>
          </div>
          <div className="lg:col-span-1 space-y-8 text-left">
            <Card className={cn("border-4 rounded-[2.5rem] overflow-hidden shadow-2xl relative group text-left", isHighRisk ? "border-destructive/20 bg-destructive/[0.02]" : "border-primary/10 bg-white")}>
              <CardHeader className="p-6 border-b bg-muted/5 flex flex-row items-center justify-between text-left">
                <CardTitle className="text-[9px] md:text-[10px] font-black uppercase tracking-widest text-muted-foreground text-left">Reliability Audit</CardTitle>
                {isHighRisk && <Badge variant="destructive" className="animate-bounce font-black text-[7px] h-4">High Risk Profile</Badge>}
              </CardHeader>
              <CardContent className="p-6 space-y-6 text-left">
                <div className="grid grid-cols-1 gap-3 text-left">
                  <div className="flex items-center justify-between p-4 rounded-xl border-2 bg-background text-left"><span className="text-[8px] font-black text-muted-foreground uppercase text-left">No-Shows</span><span className={cn("text-xl font-black font-mono text-right", noShowTotal > 0 ? "text-destructive" : "text-slate-900")}>{noShowTotal}</span></div>
                  <div className="flex items-center justify-between p-4 rounded-xl border-2 bg-background text-left"><span className="text-[8px] font-black text-muted-foreground uppercase text-left">Late Cancels</span><span className={cn("text-xl font-black font-mono text-right", cancelTotal > 0 ? "text-amber-600" : "text-slate-900")}>{cancelTotal}</span></div>
                  <div className="flex items-center justify-between p-4 rounded-xl border-2 bg-background text-left"><span className="text-[8px] font-black uppercase text-muted-foreground opacity-60 text-left">Reschedules</span><span className={cn("text-xl font-black font-mono text-right", rescheduleTotal > 0 ? "text-blue-600" : "text-slate-900")}>{rescheduleTotal}</span></div>
                </div>
                <AnimatePresence>
                  {(isHighRisk && selectedTenant?.guardianProtocolEnabled !== false) && (
                    <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="p-4 rounded-2xl border-2 border-destructive/20 bg-destructive/5 text-destructive space-y-2 text-left">
                      <div className="flex items-center gap-2 text-left"><Lock className="w-4 h-4 shrink-0" /><span className="text-[10px] font-black uppercase text-left">Guardian Lock Active</span></div>
                      <p className="text-[10px] font-bold leading-relaxed uppercase text-left">High-risk behavior detected. Booking engine will now strictly enforce upfront deposits for all sessions.</p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </CardContent>
            </Card>

            <Card className="border-2 shadow-sm rounded-[2rem] overflow-hidden bg-white text-left">
              <CardHeader className="bg-muted/5 border-b p-6 flex flex-row items-center justify-between text-left">
                <CardTitle className="text-[9px] md:text-[10px] font-black uppercase tracking-widest text-muted-foreground text-left">Financial Vault</CardTitle>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button onClick={handleReconcileLtv} disabled={isReconciling} className="h-8 w-8 rounded-xl text-primary hover:bg-primary/5 border border-primary/10 shadow-sm flex items-center justify-center transition-colors disabled:opacity-50">
                        {isReconciling ? <Loader className="w-4 h-4 animate-spin" /> : <Database className="w-4 h-4" />}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent className="rounded-xl border-2 font-black uppercase text-[10px] tracking-widest">Reconcile LTV from Ledger</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </CardHeader>
              <CardContent className="p-6 space-y-6 text-left">
                <div className="p-5 md:p-6 rounded-[1.5rem] bg-primary/5 border-2 border-primary/10 relative overflow-hidden group text-left">
                  <div className="absolute top-0 right-0 p-4 opacity-5"><TrendingUp className="w-10 h-10 md:w-12 md:h-12 text-primary"/></div>
                  <p className="text-[8px] md:text-[9px] font-black uppercase text-primary/60 tracking-widest mb-1 text-left">Lifetime Yield</p>
                  <p className="text-3xl md:text-4xl font-black text-primary tracking-tighter font-mono leading-none text-left">${safeLTV.toFixed(2)}</p>
                </div>
                <div className="grid grid-cols-1 gap-4 text-left">
                  <div className="p-4 md:p-5 rounded-[1.5rem] bg-muted/20 border-2 shadow-inner text-left">
                    <p className="text-[8px] md:text-[9px] font-black uppercase text-muted-foreground tracking-widest mb-1 opacity-60 text-left">Store Credit</p>
                    <p className="text-xl md:text-2xl font-black text-slate-900 tracking-tighter font-mono text-left">${safeStoreCredit.toFixed(2)}</p>
                  </div>
                  <div className={cn("p-4 md:p-5 rounded-[1.5rem] border-2 shadow-inner transition-all text-left", hasDebt ? "bg-destructive/5 border-destructive/20 text-destructive" : "bg-muted/20 border-transparent")}>
                    <p className="text-[8px] md:text-[9px] font-black uppercase tracking-widest mb-1 opacity-60 text-left">Account Arrears</p>
                    <p className="text-xl md:text-2xl font-black tracking-tighter font-mono text-left">${safeBalance.toFixed(2)}</p>
                  </div>
                </div>
                <Separator className="border-dashed" />
                <div className="space-y-4 text-left">
                  <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground opacity-60 flex items-center gap-2 text-left"><Lock className="w-3 h-3" /> Secure Card on File</p>
                  {client.cardOnFile ? (
                    <div className="p-4 rounded-2xl border-2 border-primary/10 bg-primary/[0.02] flex items-center justify-between text-left">
                      <div className="flex items-center gap-3 text-left">
                        <div className="p-2 bg-white rounded-xl shadow-sm border border-primary/10"><CreditCard className="w-5 h-5 text-primary" /></div>
                        <div className="text-left">
                          <p className="text-xs font-black uppercase tracking-tighter text-slate-900 text-left">{String(client.cardOnFile.brand || 'Card')} **** {String(client.cardOnFile.last4 || '****')}</p>
                          <p className="text-[8px] font-bold text-muted-foreground uppercase text-left">Exp: {safeNumber((client.cardOnFile as any).expMonth ?? client.cardOnFile.expiryMonth)}/{safeNumber((client.cardOnFile as any).expYear ?? client.cardOnFile.expiryYear)}</p>
                        </div>
                      </div>
                      <button onClick={() => setIsEditClientOpen(true)} className="h-8 w-8 text-primary hover:bg-primary/5 flex items-center justify-center rounded-lg transition-colors"><RefreshCw className="w-3.5 h-3.5" /></button>
                    </div>
                  ) : (
                    <Button variant="outline" onClick={() => setIsEditClientOpen(true)} className="w-full h-12 rounded-xl border-2 border-dashed font-black uppercase text-[9px] tracking-widest bg-muted/5 hover:bg-primary/[0.02] hover:border-primary/20 transition-all"><PlusCircle className="mr-2 h-3.5 w-3.5 opacity-40" /> Vault Security Card</Button>
                  )}
                </div>
              </CardContent>
              <CardFooter className="p-6 pt-0 flex flex-col gap-3 text-left">
                <Button className="w-full h-14 rounded-2xl font-black uppercase tracking-widest text-xs shadow-xl shadow-primary/20 bg-primary text-white" onClick={() => setIsRecoveryDialogOpen(true)}>
                  <HeartHandshake className="mr-2 h-4 w-4" /> Issue Recovery Protocol
                </Button>
                {hasDebt && hasCardOnFile && (
                  <Button className="w-full h-14 rounded-2xl font-black uppercase tracking-widest text-xs shadow-xl shadow-primary/20 bg-primary text-white" onClick={handleQuickSettle} disabled={isSettleProcessing}>
                    {isSettleProcessing ? <Loader className="animate-spin" /> : <><Zap className="mr-2 h-4 w-4" /> Charge Card on File</>}
                  </Button>
                )}
                <Button disabled={!hasDebt} variant="outline" className="w-full h-14 rounded-2xl font-black uppercase tracking-widest text-xs border-2" asChild>
                  <Link href={`/pos?payer_id=${client.id}&action=settle`}>Initialize POS Settlement</Link>
                </Button>
              </CardFooter>
            </Card>
          </div>
        </div>
      </main>

      <EditClientDialog open={isEditClientOpen} onOpenChange={setIsEditClientOpen} client={client} onSave={(data) => { if (!firestore || !tenantId) return; updateDocumentNonBlocking(doc(firestore, `tenants/${tenantId}/clients`, client.id), data); toast({ title: "Profile Updated" }); }} />
      <AddFormulaDialog open={isAddFormulaOpen} onOpenChange={(val) => { setIsAddFormulaOpen(val); if(!val) setEditingFormula(null); }} clientName={client.name} onSave={handleSaveFormula} formulaToEdit={editingFormula} />
      <IssueRecoveryDialog open={isRecoveryDialogOpen} onOpenChange={setIsRecoveryDialogOpen} client={client} />

      <Dialog open={isQuickSettleOpen} onOpenChange={setIsQuickSettleOpen}>
        <DialogContent className="sm:max-w-md rounded-[3rem] border-4 shadow-3xl p-0 overflow-hidden text-left">
          <DialogHeader className="p-8 pb-4 border-b bg-muted/5 text-left">
            <div className="flex items-center gap-3 mb-2"><ShieldCheck className="w-5 h-5 text-primary" /><span className="text-[10px] font-black uppercase tracking-[0.2em] text-primary">Strategic Settlement</span></div>
            <DialogTitle className="text-2xl font-black uppercase tracking-tighter text-slate-900 leading-none text-left">Confirm Vault Charge</DialogTitle>
            <DialogDescription className="text-xs font-bold uppercase tracking-widest opacity-60 mt-1 text-left">Authorize debt reconciliation for: <strong>{client.name}</strong></DialogDescription>
          </DialogHeader>
          <div className="p-8 space-y-8 text-left">
            <div className="p-8 rounded-[2.5rem] bg-primary/5 border-4 border-primary/10 text-center space-y-4 shadow-2xl shadow-primary/5">
              <p className="text-[10px] font-black uppercase text-primary/60 tracking-widest text-center">Total Arrears Balance</p>
              <p className="text-5xl font-black text-primary tracking-tighter font-mono text-center">${safeBalance.toFixed(2)}</p>
            </div>
            <div className="space-y-4 text-left">
              <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1 text-left">Distribution Method</p>
              <div className="p-4 rounded-2xl border-2 bg-muted/5 flex items-center gap-4 text-left">
                <div className="p-2 bg-white rounded-xl shadow-sm border"><CreditCard className="w-5 h-5 text-primary" /></div>
                <div className="text-left">
                  <p className="font-black text-sm uppercase tracking-tight text-slate-900 text-left">{String(client.cardOnFile?.brand || 'Card')} **** {String(client.cardOnFile?.last4 || '****')}</p>
                  <p className="text-[9px] font-bold text-muted-foreground uppercase text-left">Authorized Vault Access</p>
                </div>
              </div>
            </div>
            <div className="p-4 rounded-xl border-2 border-dashed bg-muted/10 flex items-start gap-3 text-left">
              <Info className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5 opacity-40" />
              <p className="text-[10px] font-bold text-slate-600 leading-relaxed uppercase tracking-tight text-left">This will instantly clear the client's unpaid fees and create a verified revenue record in the studio ledger.</p>
            </div>
          </div>
          <DialogFooter className="p-8 pt-0 flex flex-col gap-3 text-left">
            <Button className="w-full h-16 rounded-2xl text-xl font-black uppercase shadow-3xl shadow-primary/30" onClick={handleQuickSettle} disabled={isSettleProcessing}>{isSettleProcessing ? <Loader className="animate-spin" /> : 'Authorize Charge'}</Button>
            <Button variant="ghost" onClick={() => setIsQuickSettleOpen(false)} className="w-full font-bold uppercase text-[10px] tracking-widest">Cancel</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* v6 — Documents tab gallery lightbox, same multi-image prev/next
          pattern already built into AppointmentDetailsSheet. */}
      <Dialog open={!!docExpandedImage} onOpenChange={(val) => !val && setDocExpandedImage(null)}>
        <DialogContent className="max-w-fit p-0 border-none bg-transparent shadow-none overflow-hidden flex items-center justify-center">
          <DialogHeader className="sr-only">
            <DialogTitle>Document Preview</DialogTitle>
            <DialogDescription>Full screen preview{docLightboxImages.length > 1 ? ', use the on-screen buttons to browse' : ''}</DialogDescription>
          </DialogHeader>
          <div className="relative rounded-[2.5rem] overflow-hidden border-4 border-white/20 shadow-2xl bg-black/40 backdrop-blur-xl max-w-[95vw] max-h-[95vh]">
            {docExpandedImage && <img src={docExpandedImage} alt={docLightboxImages[docLightboxIndex]?.name || 'Document'} className="block max-w-full max-h-[90vh] object-contain" />}
            {docLightboxImages.length > 1 && (
              <>
                <button
                  onClick={() => { const p = (docLightboxIndex - 1 + docLightboxImages.length) % docLightboxImages.length; setDocLightboxIndex(p); setDocExpandedImage(docLightboxImages[p].url); }}
                  className="absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/50 hover:bg-black/70 flex items-center justify-center text-white transition-colors"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <button
                  onClick={() => { const n = (docLightboxIndex + 1) % docLightboxImages.length; setDocLightboxIndex(n); setDocExpandedImage(docLightboxImages[n].url); }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/50 hover:bg-black/70 flex items-center justify-center text-white transition-colors"
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
                <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-black/50 rounded-full px-3 py-1">
                  <p className="text-[10px] font-bold text-white">{docLightboxIndex + 1} / {docLightboxImages.length}</p>
                </div>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
