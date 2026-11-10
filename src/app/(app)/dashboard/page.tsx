'use client';

import { useToday, useTransactionsInRange } from '@/hooks/use-transactions';
import { useAppointmentWindow } from '@/hooks/use-appointments';
import { useClientsOwing } from '@/hooks/use-clients';
import { kitchenStep } from '@/lib/kitchen-client';
import { loungeMaker } from '@/lib/kitchen';
import { ReadyToRun, useReadyToRun } from '@/components/kitchen/ReadyToRun';
import { moduleEnabled } from '@/lib/modules';
import React, { useState, useMemo } from 'react';
import { AppHeader } from '@/components/shared/AppHeader';
import { MovingInCard } from '@/components/import/MovingInCard';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from '@/components/ui/card';
import {
  Users,
  Calendar as CalendarIcon,
  DollarSign,
  ArrowUp,
  Sparkles,
  Loader,
  TrendingUp,
  HeartHandshake,
  Clock,
  MoreHorizontal,
  Coffee,
  Play,
  Wallet,
  MapPin,
  Car,
  KeyRound,
  ChevronRight,
  Landmark,
  Globe,
  Phone,
  Smartphone,
  Square,
  CheckCircle2,
  Check,
  ArrowRight,
  ShieldAlert,
  Activity,
  PackageX,
  Zap,
  TrendingDown,
  User as UserIcon,
  Timer,
  XCircle,
  Award,
  Star,
  MessageSquare,
  Eye
} from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { type Appointment, type Event, type Transaction, type Service, Staff, ActivityLog, InventoryItem, WalkIn, RefreshmentRequest } from '@/lib/data';
import { Button } from '@/components/ui/button';
import { useFirebase, useCollection, useMemoFirebase, useUser, updateDocumentNonBlocking } from '@/firebase';
import { collection, query, where, doc, writeBatch, increment, arrayUnion, setDoc } from 'firebase/firestore';
import { startOfDay, endOfDay, format, isSameDay, parseISO, differenceInMinutes, isToday } from 'date-fns';
import { useInventory } from '@/context/InventoryContext';
import { ClientOnly } from '@/components/shared/ClientOnly';
import { useTenant } from '@/context/TenantContext';
import { Badge } from '@/components/ui/badge';
import { cn, safeNumber } from '@/lib/utils';
import { requestWaitMinutes, LOUNGE_ESCALATE_MIN } from '@/lib/retail-orders';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { useToast } from '@/hooks/use-toast';
import { nanoid } from 'nanoid';
import Image from 'next/image';

const sanitizeForFirestore = (obj: any): any => {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(sanitizeForFirestore);
  return Object.fromEntries(
    Object.entries(obj)
      .filter(([_, v]) => v !== undefined)
      .map(([k, v]) => [k, sanitizeForFirestore(v)])
  );
};

const safeDate = (val: any): Date => {
    if (!val) return new Date();
    if (val instanceof Date) return val;
    if (typeof val?.toDate === 'function') return val.toDate();
    if (typeof val === 'string') return parseISO(val);
    return new Date(val);
};

const BusinessPulse = ({ tenantId }: { tenantId: string }) => {
  const { firestore } = useFirebase();
  const appsQ = useMemoFirebase(
    () => tenantId ? collection(firestore, `tenants/${tenantId}/applications`) : null,
    [firestore, tenantId]
  );
  const { data: applications } = useCollection<any>(appsQ);
  const invitesQ = useMemoFirebase(
    () => tenantId ? collection(firestore, `tenants/${tenantId}/interviewInvites`) : null,
    [firestore, tenantId]
  );
  const { data: invites } = useCollection<any>(invitesQ);
  const tasksQ = useMemoFirebase(
    () => tenantId ? collection(firestore, `tenants/${tenantId}/tasks`) : null,
    [firestore, tenantId]
  );
  const { data: tasks } = useCollection<any>(tasksQ);
  const rentInvQ = useMemoFirebase(
    () => tenantId ? query(collection(firestore, `tenants/${tenantId}/rentInvoices`), where('status', 'in', ['due', 'late'])) : null,
    [firestore, tenantId]
  );
  const { data: rentInvoices } = useCollection<any>(rentInvQ);
  const pulseLeasesQ = useMemoFirebase(
    () => tenantId ? collection(firestore, `tenants/${tenantId}/leases`) : null,
    [firestore, tenantId]
  );
  const { data: pulseLeases } = useCollection<any>(pulseLeasesQ);
  const pulseRentersQ = useMemoFirebase(
    () => tenantId ? collection(firestore, `tenants/${tenantId}/renters`) : null,
    [firestore, tenantId]
  );
  const { data: pulseRenters } = useCollection<any>(pulseRentersQ);
  const pendingRentQ = useMemoFirebase(
    () => tenantId ? query(collection(firestore, `tenants/${tenantId}/rentLedger`), where('status', '==', 'pending')) : null,
    [firestore, tenantId]
  );
  const { data: pendingRent } = useCollection<any>(pendingRentQ);

  const todayStr = format(new Date(), 'yyyy-MM-dd');
  const items = useMemo(() => {
    const out: Array<{ key: string; icon: string; text: string; href: string; tone: 'urgent' | 'info' | 'good' }> = [];
    const apps = (applications || []) as any[];
    const inv = (invites || []) as any[];
    const tk = (tasks || []) as any[];

    for (const a of apps.filter(x => x.status === 'new')) {
      out.push({ key: `app-${a.id}`, icon: '🧑\u200d💼', text: `New application — ${a.name || 'Someone'}${a.position ? ` (${a.position})` : ''}`, href: `/applicants?app=${a.id}`, tone: 'urgent' });
    }
    for (const i of inv.filter(x => x.status === 'countered')) {
      out.push({ key: `cnt-${i.id}`, icon: '📅', text: `${i.firstName || 'An applicant'} sent their availability — pick a time`, href: i.applicationId ? `/applicants?app=${i.applicationId}` : '/applicants', tone: 'urgent' });
    }
    for (const i of inv.filter(x => x.status === 'needs_new_times')) {
      out.push({ key: `nnt-${i.id}`, icon: '🔁', text: `${i.firstName || 'An applicant'} needs different interview times`, href: i.applicationId ? `/applicants?app=${i.applicationId}` : '/applicants', tone: 'urgent' });
    }
    for (const i of inv.filter(x => x.status === 'accepted' && x.chosenSlot)) {
      try {
        const d = new Date(i.chosenSlot);
        if (!isNaN(d.getTime()) && format(d, 'yyyy-MM-dd') === todayStr) {
          out.push({ key: `int-${i.id}`, icon: '🤝', text: `Interview today ${format(d, 'h:mm a')} — ${i.firstName || 'applicant'}${i.roleTitle ? ` (${i.roleTitle})` : ''}`, href: i.applicationId ? `/applicants?app=${i.applicationId}` : '/applicants', tone: 'info' });
        }
      } catch { /* skip malformed */ }
    }
    for (const t of tk.filter(x => x.status !== 'done' && x.dueDate && x.dueDate < todayStr)) {
      out.push({ key: `od-${t.id}`, icon: '⏰', text: `Task overdue — ${t.title} (due ${t.dueDate})`, href: `/documents?tab=tasks&task=${t.id}`, tone: 'urgent' });
    }
    const rinv = (rentInvoices || []) as any[];
    const ls = (pulseLeases || []) as any[];
    const leaseById = new Map(ls.map((l: any) => [l.id, l]));
    const renterById = new Map(((pulseRenters || []) as any[]).map((r: any) => [r.id, r]));
    const rName = (leaseId?: string, renterId?: string, fallback?: string) => {
      const lease = leaseId ? leaseById.get(leaseId) : null;
      const r = renterById.get(renterId || lease?.renterId || '');
      const nm = r ? `${r.firstName || ''} ${r.lastName || ''}`.trim() : '';
      return nm || fallback || 'Renter';
    };
    for (const v of rinv.filter((x: any) => x.status === 'late')) {
      const total = ((Number(v.amountCents) || 0) + (Number(v.lateFeeCents) || 0)) / 100;
      out.push({ key: `rlate-${v.id}`, icon: '💸', text: `Rent late — ${rName(v.leaseId, undefined, v.renterName)} ($${total.toFixed(2)}${v.lateFeeCents ? ' incl. late fee' : ''})`, href: '/booths', tone: 'urgent' });
    }
    for (const c of ((pendingRent || []) as any[]).filter((x: any) => x.type === 'rent_charge' && String(x.description || '').toLowerCase().includes('declined'))) {
      out.push({ key: `rfail-${c.id}`, icon: '💳', text: `Autopay card declined — ${rName(c.leaseId, c.renterId)} ($${((Number(c.amountCents) || 0) / 100).toFixed(2)})`, href: '/booths', tone: 'urgent' });
    }
    for (const v of rinv.filter((x: any) => x.status === 'due' && String(x.dueDate || '').slice(0, 10) === todayStr)) {
      out.push({ key: `rdue-${v.id}`, icon: '🏠', text: `Rent due today — ${rName(v.leaseId, undefined, v.renterName)} ($${((Number(v.amountCents) || 0) / 100).toFixed(2)})`, href: '/booths', tone: 'info' });
    }
    const soonD = new Date(); soonD.setDate(soonD.getDate() + 7);
    const soonStr = format(soonD, 'yyyy-MM-dd');
    for (const l of ls.filter((x: any) => x.status === 'active' && x.endDate && !x.autoRenew && String(x.endDate).slice(0, 10) >= todayStr && String(x.endDate).slice(0, 10) <= soonStr)) {
      out.push({ key: `lend-${l.id}`, icon: '📄', text: `Lease ends ${String(l.endDate).slice(0, 10)} — ${rName(undefined, l.renterId)} (renew or end)`, href: '/booths', tone: 'info' });
    }
    const doneToday = tk.filter(x => x.status === 'done' && String(x.completedAt || '').slice(0, 10) === todayStr);
    if (doneToday.length > 0) {
      out.push({ key: 'done-today', icon: '✅', text: `${doneToday.length} task${doneToday.length === 1 ? '' : 's'} completed today — see the audit trail`, href: '/documents?tab=audit', tone: 'good' });
    }
    return out;
  }, [applications, invites, tasks, rentInvoices, pulseLeases, pulseRenters, pendingRent, todayStr]);

  if (items.length === 0) return null;

  return (
    <Card className="rounded-[2rem] border-4 border-slate-900/10 bg-card shadow-xl">
      <CardHeader className="p-5 pb-2">
        <CardTitle className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-foreground">
          <Zap className="h-3 w-3" aria-hidden="true" /> Needs your attention
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 p-5 pt-1">
        {items.slice(0, 8).map(it => (
          <Link key={it.key} href={it.href} className={cn(
            'flex items-center justify-between gap-2 rounded-xl border-2 px-3 py-2.5 transition-colors',
            it.tone === 'urgent' ? 'border-amber-300 bg-amber-50 hover:bg-amber-100' : it.tone === 'good' ? 'border-emerald-200 bg-emerald-50/60 hover:bg-emerald-100/60' : 'bg-muted/60 hover:bg-muted'
          )}>
            <p className="min-w-0 flex-1 text-[12px] font-bold text-foreground">{it.icon} {it.text}</p>
            <span className="shrink-0 text-[10px] font-black uppercase tracking-widest text-muted-foreground">Open →</span>
          </Link>
        ))}
      </CardContent>
    </Card>
  );
};

const RefreshmentQueue = ({ requests, inventory, user, onDeliver, onCancel, onBringing, staff }: any) => {
    // One tick a second so every guest's wait counts up on its own. The same
    // clock the curbside board runs: "pending" tells you nothing at a glance,
    // "waiting 6 min" tells you to move.
    const [nowTick, setNowTick] = React.useState<Date>(() => new Date());
    React.useEffect(() => {
        const id = setInterval(() => setNowTick(new Date()), 1000);
        return () => clearInterval(id);
    }, []);
    if (!requests || requests.length === 0) return (
        <div className="p-12 text-center border-4 border-dashed rounded-[3rem] opacity-30 flex flex-col items-center gap-4">
            <Coffee className="w-12 h-12" />
            <p className="text-[10px] font-black uppercase tracking-widest">No hospitality requests</p>
        </div>
    );

    return (
        <div className="space-y-4">
            <AnimatePresence>
                {requests.map((request: any) => {
                    const item = inventory.find((i: any) => i.id === request.itemId);
                    const safeQuantity = safeNumber(request.quantity) || 1;
                    return (
                        <motion.div 
                            key={request.id}
                            initial={{ opacity: 0, x: -20 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            className="flex flex-col xl:flex-row items-start xl:items-center justify-between p-5 rounded-2xl border bg-card transition-all gap-5 group"
                        >
                            <div className="flex flex-row items-start gap-4 text-left w-full xl:w-auto min-w-0">
                                <div className="p-4 bg-primary/5 rounded-2xl shadow-inner border border-primary/10 relative shrink-0">
                                    {item?.imageUrl ? (
                                        <div className="relative w-10 h-10">
                                            <Image src={item.imageUrl} alt={item.name} fill className="object-cover rounded-lg" />
                                        </div>
                                    ) : (
                                        <Coffee className="w-8 h-8 text-primary" />
                                    )}
                                    <div className="absolute -top-2 -right-2 bg-primary text-white rounded-full p-1 shadow-lg h-6 w-6 flex items-center justify-center font-black text-[10px]">
                                        {safeQuantity}
                                    </div>
                                </div>
                                <div className="space-y-1 text-left w-full sm:w-auto flex-1">
                                    {request.accessNote && (
                                        <p className="rounded-lg border-2 border-sky-300 bg-sky-50 px-2 py-1 text-[11px] font-black uppercase tracking-widest text-sky-900">
                                            {request.accessNote}
                                        </p>
                                    )}
                                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                                        <p className="text-[18px] font-semibold text-foreground">{request.itemName}</p>
                                        {(() => {
                                            const mins = requestWaitMinutes(request as any, nowTick);
                                            if (mins === null) return null;
                                            return (
                                                <Badge variant="outline" className={cn('h-6 px-2 border whitespace-nowrap font-medium text-[12.5px]',
                                                    mins >= LOUNGE_ESCALATE_MIN ? 'border-destructive/50 bg-destructive/10 text-destructive'
                                                        : mins >= 3 ? 'border-amber-300 bg-amber-50 text-amber-800'
                                                        : 'border-primary/30 bg-primary/5 text-primary')}>
                                                    {mins === 0 ? 'just now' : `waiting ${mins} min`}
                                                </Badge>
                                            );
                                        })()}
                                        {request.bringingOutAt && (
                                            <Badge className="bg-primary text-white border-none h-5 px-2 font-black text-[8px] uppercase tracking-widest">
                                                {request.bringingOutBy || 'Someone'} is bringing it
                                            </Badge>
                                        )}
                                        <div className="flex items-center gap-2">
                                            <Badge variant="outline" className="h-6 px-2 whitespace-nowrap bg-primary/10 text-primary border-none font-medium text-[12.5px]">{safeQuantity} {safeQuantity === 1 ? 'item' : 'items'}</Badge>
                                            {request.isRedemption && (
                                                <Badge className="bg-indigo-600 text-white border-none h-5 px-2 font-black text-[8px] uppercase tracking-widest shadow-sm">
                                                    <Star className="w-2.5 h-2.5 mr-1 fill-current" /> Perk
                                                </Badge>
                                            )}
                                            {request.isGuestKiosk && (
                                                <Badge className="bg-amber-500 text-white border-none h-5 px-2 font-black text-[8px] uppercase tracking-widest shadow-sm">
                                                    Lounge Guest
                                                </Badge>
                                            )}
                                        </div>
                                    </div>
                                    
                                    {item?.formula && item.formula.length > 0 && (
                                        <div className="flex flex-wrap gap-2 mt-2 mb-3 text-left">
                                            {item.formula.map((f: any, idx: number) => {
                                                const totalNeeded = safeNumber(f.quantityUsed) * safeQuantity;
                                                return (
                                                    <Badge key={idx} variant="outline" className="text-[8px] font-black uppercase tracking-widest bg-muted/50 border-none px-2 py-0.5">
                                                        {totalNeeded.toFixed(1)}{f.unit} {f.name}
                                                    </Badge>
                                                )
                                            })}
                                        </div>
                                    )}

                                    <div className="flex flex-col gap-2 mt-2">
                                        <p className="text-[13px] text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1">
                                            For <span className="font-medium text-foreground">{request.clientName}</span>
                                            <span className="opacity-40">&middot;</span>
                                            <span className="flex items-center gap-1"><MapPin className="w-3 h-3"/> {request.stationName || 'Lounge'}</span>
                                            {request.staffName && request.staffName !== 'Unassigned' && (
                                                <>
                                                    <span className="opacity-40">&middot;</span>
                                                    <span className="flex items-center gap-1"><UserIcon className="w-3 h-3"/> {request.staffName}</span>
                                                </>
                                            )}
                                            <span className="opacity-40">&middot;</span>
                                            {format(safeDate(request.requestedAt), 'h:mm a')}
                                        </p>
                                        
                                        {(request.guestDescription || request.notes) && (
                                            <div className="p-3 rounded-xl bg-primary/[0.03] border-2 border-primary/5 space-y-2 mt-1">
                                                {request.guestDescription && (
                                                    <p className="text-[10px] font-black text-primary uppercase flex items-center gap-2">
                                                        <Eye className="w-3.5 h-3.5" />
                                                        ID: {request.guestDescription}
                                                    </p>
                                                )}
                                                {request.notes && (
                                                    <p className="text-[10px] font-medium text-foreground/80 leading-relaxed italic border-l-2 border-primary/20 pl-3">
                                                        "{request.notes}"
                                                    </p>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                            <div className="flex flex-wrap items-center gap-3 w-full xl:w-auto">
                                <Button 
                                    variant="outline"
                                    aria-label="Cancel this request"
                                    onClick={() => onCancel(request.id)}
                                    className="h-12 flex-1 sm:flex-none sm:w-12 rounded-xl border-2 hover:bg-destructive/5 hover:text-destructive hover:border-destructive/20 transition-all"
                                >
                                    <XCircle className="w-5 h-5" />
                                </Button>
                                <Button 
                                    onClick={() => onDeliver(request)}
                                    className="h-12 flex-1 sm:w-44 rounded-xl font-medium text-[14px] group"
                                >
                                    Mark delivered <ArrowRight className="ml-2 w-4 h-4 transition-transform group-hover:translate-x-1" />
                                </Button>
                                {!request.bringingOutAt && onBringing && (
                                    <Button
                                        variant="outline"
                                        onClick={() => onBringing(request.id)}
                                        className="h-12 flex-1 sm:w-40 rounded-xl border font-medium text-[14px]"
                                    >
                                        I&apos;m bringing it
                                    </Button>
                                )}
                            </div>
                        </motion.div>
                    );
                })}
            </AnimatePresence>
        </div>
    );
};

const ActiveSessionCard = ({ appointment, service, staffMember }: { appointment: Appointment, service?: Service, staffMember?: Staff }) => {
    const [elapsed, setElapsed] = useState('0m');
    const [isOver, setIsOver] = useState(false);

    React.useEffect(() => {
        const start = safeDate(appointment.actualStartTime || appointment.startTime);
        const target = service?.duration || 60;
        const timer = setInterval(() => {
            const mins = differenceInMinutes(new Date(), start);
            setElapsed(`${mins}m`);
            setIsOver(mins > target);
        }, 10000);
        return () => clearInterval(timer);
    }, [appointment, service]);

    return (
        <div className={cn("p-4 rounded-2xl border-2 bg-card flex items-center justify-between transition-all", isOver ? "border-destructive ring-2 ring-destructive/10" : "border-border/50")}>
            <div className="flex items-center gap-3 min-w-0 text-left">
                <Avatar className="h-10 w-10 border-2 rounded-xl shadow-sm">
                    <AvatarImage src={staffMember?.avatarUrl} className="object-cover" />
                    <AvatarFallback className="font-black text-xs">{(staffMember?.name || 'S')[0]}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 text-left">
                    <p className="font-black uppercase text-xs truncate leading-none mb-1">{appointment.clientName}</p>
                    <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest opacity-60 truncate">{service?.name}</p>
                </div>
            </div>
            <div className="text-right shrink-0">
                <p className={cn("font-black font-mono text-base tracking-tighter", isOver ? "text-destructive" : "text-primary")}>{elapsed}</p>
                <p className="text-[8px] font-black uppercase text-muted-foreground opacity-40">Progress</p>
            </div>
        </div>
    );
};

export default function DashboardPage() {
  const { firestore, user } = useFirebase();
  const { selectedTenant, role: tenantRole } = useTenant() as any;
  const { inventory, staff, services, walkIns, refreshmentRequests, isLoading: ctxLoading } = useInventory();
  const { clients } = useClientsOwing();   // only clients with a balance, for arrears
  const { appointments, isLoading: apptLoading } = useAppointmentWindow();   // today's world, shared with the planner and desk
  const isInventoryLoading = ctxLoading || apptLoading;
  // Today's sales only (hooks/use-transactions), not the whole history.
  const [dayStart, dayEnd] = useToday();
  const { transactions } = useTransactionsInRange(dayStart, dayEnd);
  const tenantId = selectedTenant?.id;
  const { toast } = useToast();

  const today = useMemo(() => startOfDay(new Date()), []);

  const readyToRun = useReadyToRun(firestore, tenantId || null);   // "Order up": ready on the kitchen screen, to carry out
  const pendingRequests = useMemo(() => 
    refreshmentRequests?.filter(r => r.status === 'pending' && safeDate(r.requestedAt) >= today) || []
  , [refreshmentRequests, today]);

  // Handed over with the kitchen's own server step (lib/kitchen-client): stock, a member perk and the visit are counted
  // once, however many screens show the order.
  const handleDeliverRefreshment = async (request: RefreshmentRequest) => {
      if (!tenantId) return;
      const r = await kitchenStep(tenantId, 'refreshmentRequests', String((request as any).id), 'deliver');
      if (r.ok) toast({ title: r.already ? 'Already handed over' : 'Delivered', description: r.already ? `${request.clientName}’s order was already handed over.` : `${request.clientName} has their order.` });
      else toast({ variant: 'destructive', title: 'That didn’t go through', description: r.error || 'Try again.' });
  };

  /**
   * "I'm bringing it over."
   *
   * The lounge half of the curbside back-signal. A guest who asked for
   * something and heard nothing assumes they were missed — and unlike a
   * customer in a car park, they can't come and check. One tap turns silence
   * into "Kayla is on her way", and the gap between this and delivery is how
   * long the walk actually takes.
   */
  /** Fire-and-forget: a text must never block a floor action. */
  const notifyLounge = (requestId: string, moment: 'out' | 'staff_escalation') => {
    if (typeof window === 'undefined' || !tenantId) return;
    try {
      void fetch('/api/retail/lounge-notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, requestId, moment }),
        keepalive: true,
      }).catch(() => undefined);
    } catch { /* the badge on the board is still true */ }
  };

  const handleBringingRefreshment = async (requestId: string) => {
    if (!firestore || !tenantId) return;
    updateDocumentNonBlocking(doc(firestore, `tenants/${tenantId}/refreshmentRequests`, requestId), {
      bringingOutAt: new Date().toISOString(),
      bringingOutBy: user?.displayName || 'Someone',
    });
    // A badge only reaches a guest who is looking at their phone. Under a
    // lamp, mid-service, they are not — so the text goes too.
    notifyLounge(requestId, 'out');
    toast({ title: 'They know you\u2019re coming', description: 'The guest can see someone is on the way.' });
  };

  // A guest in a chair cannot come and ask. If a request passes the threshold
  // with nobody bringing it, the alert leaves the building and finds a person.
  const loungeEscalatedRef = React.useRef<Set<string>>(new Set());
  React.useEffect(() => {
    const tick = setInterval(() => {
      for (const r of (pendingRequests || []) as any[]) {
        if (!r?.id || loungeEscalatedRef.current.has(r.id)) continue;
        if (r.bringingOutAt) continue;
        const mins = requestWaitMinutes(r, new Date());
        if (mins === null || mins < LOUNGE_ESCALATE_MIN) continue;
        loungeEscalatedRef.current.add(r.id);
        notifyLounge(r.id, 'staff_escalation');
      }
    }, 30000);
    return () => clearInterval(tick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingRequests, tenantId]);

  // Cancelled with the same server step: anything ordering took off the shelf goes back, once.
  const handleCancelRefreshment = async (requestId: string) => {
      if (!tenantId) return;
      const r = await kitchenStep(tenantId, 'refreshmentRequests', requestId, 'cancel');
      if (r.ok) toast({ title: 'Order cancelled', description: 'Anything taken off the shelf for it was put back.' });
      else toast({ variant: 'destructive', title: 'That didn’t go through', description: r.error || 'Try again.' });
  };

  const dashboardMetrics = useMemo(() => {
    const todayStart = startOfDay(new Date());
    const dailyIncome = (transactions || []).filter(t => t.type === 'income' && isSameDay(safeDate(t.date), todayStart)).reduce((acc, t) => acc + safeNumber(t.amount), 0);
    const totalArrears = (clients || []).reduce((acc, c) => acc + safeNumber(c.outstandingBalance), 0);
    const activeStaff = (staff || []).filter(s => s.active && !s.onBreak).length;
    const todayArrivals = (walkIns || []).filter(w => isSameDay(safeDate(w.checkInTime), todayStart)).length + 
                         (appointments || []).filter(a => isSameDay(safeDate(a.startTime), todayStart) && a.checkInStatus === 'arrived').length;

    const liveSessions = (appointments || []).filter(a => a.status === 'servicing');
    const lowStockItems = (inventory || []).filter(i => i.reorderPoint && i.totalStock <= i.reorderPoint);

    const deliveredToday = refreshmentRequests?.filter(r => r.status === 'delivered' && safeDate(r.requestedAt) >= todayStart) || [];
    const waitTimes = deliveredToday.map(r => {
        const req = safeDate(r.requestedAt);
        const del = safeDate(r.deliveredAt);
        return Math.max(0, differenceInMinutes(del, req));
    });
    const hospitalityWaitVelocity = waitTimes.length > 0 
        ? Math.round(waitTimes.reduce((a, b) => a + b, 0) / waitTimes.length) 
        : 0;

    const itemPopularity: Record<string, number> = {};
    refreshmentRequests?.filter(r => safeDate(r.requestedAt) >= todayStart).forEach(r => {
        itemPopularity[r.itemName] = (itemPopularity[r.itemName] || 0) + 1;
    });
    const topAmenity = Object.entries(itemPopularity).sort((a,b) => b[1] - a[1])[0]?.[0] || 'N/A';

    return { 
        dailyIncome, 
        totalArrears, 
        activeStaff, 
        todayArrivals, 
        liveSessions, 
        lowStockItems,
        hospitalityWaitVelocity,
        topAmenity,
        totalHospitalityRequests: refreshmentRequests?.filter(r => safeDate(r.requestedAt) >= todayStart).length || 0
    };
  }, [transactions, clients, staff, walkIns, appointments, inventory, refreshmentRequests]);

  if (isInventoryLoading) return <div className="h-screen w-full flex flex-col items-center justify-center gap-4 bg-background"><Loader className="h-8 w-8 animate-spin text-muted-foreground" /><p className="text-[14px] text-muted-foreground">Loading today…</p></div>;

  // What the day looks like, in plain words. The lounge sections (drink and snack requests from guests) show only for a
  // business that has its lounge tool on and has had a request today, so a business without one never sees them.
  const owed = safeNumber(dashboardMetrics.totalArrears);
  const usesLounge = moduleEnabled(selectedTenant, 'hospitality') && ((pendingRequests?.length || 0) > 0 || safeNumber(dashboardMetrics.totalHospitalityRequests) > 0);
  const loungeByKitchen = loungeMaker(selectedTenant) === 'kitchen';   // then the kitchen screen makes them, not this list
  const bookedToday = safeNumber(appointments?.filter(a => isToday(safeDate(a.startTime))).length);
  const stat = (label: string, value: React.ReactNode, note?: string, tone?: 'warn') => (
    <div className={cn('rounded-2xl border bg-card p-4 md:p-5', tone === 'warn' ? 'border-amber-200 dark:border-amber-900' : 'border-border')}>
      <p className="text-[13px] text-muted-foreground">{label}</p>
      <p className={cn('mt-1 text-[26px] md:text-[32px] font-semibold tracking-tight tabular-nums', tone === 'warn' ? 'text-amber-700 dark:text-amber-400' : 'text-foreground')}>{value}</p>
      {note && <p className="text-[12.5px] text-muted-foreground">{note}</p>}
    </div>
  );
  const heading = (text: string, extra?: React.ReactNode) => <div className="flex items-center justify-between gap-3 px-1"><h3 className="text-[17px] font-semibold text-foreground">{text}</h3>{extra}</div>;

  return (
    <div className="flex min-h-screen w-full flex-col bg-background">
      <AppHeader title="Today" />
      <main className="flex-1 p-4 md:p-10 max-w-7xl mx-auto w-full space-y-8">
        <MovingInCard tenantId={selectedTenant?.id || ''} tenant={selectedTenant} role={String(tenantRole || '')} />
        <BusinessPulse tenantId={selectedTenant?.id || ''} />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
          {stat('Sales today', `$${safeNumber(dashboardMetrics.dailyIncome).toFixed(2)}`)}
          {stat('Working now', safeNumber(dashboardMetrics.activeStaff), 'Clocked in, not on a break')}
          {stat('Visits today', safeNumber(dashboardMetrics.todayArrivals), `${bookedToday} booked`)}
          {stat('Owed to you', `$${owed.toFixed(2)}`, owed > 0 ? 'Balances clients still owe' : 'Nothing owed', owed > 0 ? 'warn' : undefined)}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-8 text-left">
            {readyToRun.length > 0 && tenantId && <ReadyToRun tenantId={tenantId} list={readyToRun} />}
            {usesLounge && !loungeByKitchen && (
              <section className="space-y-4">
                {heading('Lounge requests', <Badge variant="secondary" className="h-7 rounded-full px-3 text-[13px] font-medium">{pendingRequests?.length || 0} waiting</Badge>)}
                <RefreshmentQueue
                  requests={pendingRequests || []}
                  inventory={inventory}
                  user={user}
                  onDeliver={handleDeliverRefreshment}
                  onCancel={handleCancelRefreshment}
                  onBringing={handleBringingRefreshment}
                  staff={staff}
                />
              </section>
            )}

            <section className="space-y-4">
              {heading('In progress now')}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {dashboardMetrics.liveSessions.length > 0 ? dashboardMetrics.liveSessions.map(apt => (
                  <ActiveSessionCard
                    key={apt.id}
                    appointment={apt}
                    service={services.find(s => s.id === apt.serviceId)}
                    staffMember={staff.find(s => s.id === apt.staffId)}
                  />
                )) : (
                  <div className="col-span-full rounded-2xl border border-dashed py-10 text-center text-[14.5px] text-muted-foreground">Nothing in progress right now. Visits show here once they start.</div>
                )}
              </div>
            </section>
          </div>

          <div className="space-y-6 text-left">
            {usesLounge && (
              <Card className="rounded-2xl border shadow-none text-left">
                <CardHeader className="p-5 pb-2"><CardTitle className="text-[17px] font-semibold">Lounge today</CardTitle></CardHeader>
                <CardContent className="p-5 pt-0 space-y-3">
                  <div className="flex items-baseline justify-between"><span className="text-[14px] text-muted-foreground">Average wait</span><span className="text-[20px] font-semibold tabular-nums">{safeNumber(dashboardMetrics.hospitalityWaitVelocity)} min</span></div>
                  <div className="flex items-baseline justify-between"><span className="text-[14px] text-muted-foreground">Requests</span><span className="text-[15px] font-medium tabular-nums">{safeNumber(dashboardMetrics.totalHospitalityRequests)}</span></div>
                  {dashboardMetrics.topAmenity !== 'N/A' && <div className="flex items-baseline justify-between gap-3"><span className="text-[14px] text-muted-foreground">Asked for most</span><span className="truncate text-[15px] font-medium">{dashboardMetrics.topAmenity}</span></div>}
                </CardContent>
              </Card>
            )}

            <Card className="rounded-2xl border shadow-none text-left">
              <CardHeader className="p-5 pb-2"><CardTitle className="text-[17px] font-semibold">Running low</CardTitle></CardHeader>
              <CardContent className="p-5 pt-0 space-y-3">
                {dashboardMetrics.lowStockItems.length > 0 ? (
                  <>
                    {dashboardMetrics.lowStockItems.slice(0, 5).map(item => (
                      <div key={item.id} className="flex items-center justify-between gap-3 rounded-xl border border-amber-200 dark:border-amber-900 px-3 py-2.5">
                        <div className="min-w-0 flex-1"><p className="truncate text-[14.5px] font-medium">{item.name}</p>{item.category && <p className="truncate text-[12.5px] text-muted-foreground">{item.category}</p>}</div>
                        <span className="shrink-0 text-[14px] font-semibold tabular-nums text-amber-700 dark:text-amber-400">{safeNumber(item.totalStock)} left</span>
                      </div>
                    ))}
                    <Button variant="ghost" asChild className="h-11 w-full rounded-xl text-[14px] font-medium">
                      <Link href="/inventory">See inventory <ArrowRight className="ml-2 h-4 w-4" /></Link>
                    </Button>
                  </>
                ) : (
                  <p className="text-[14.5px] text-muted-foreground">Nothing is running low. Items you give a reorder point show here when they get close.</p>
                )}
              </CardContent>
            </Card>

            <Card className="rounded-2xl border shadow-none text-left">
              <CardHeader className="p-5 pb-2"><CardTitle className="text-[17px] font-semibold">Today so far</CardTitle></CardHeader>
              <CardContent className="p-5 pt-0 space-y-3">
                <p className="text-[32px] font-semibold tracking-tight tabular-nums">${safeNumber(dashboardMetrics.dailyIncome).toFixed(0)}</p>
                <p className="text-[14.5px] text-muted-foreground">{safeNumber(walkIns?.length)} walk-in{safeNumber(walkIns?.length) === 1 ? '' : 's'} and {bookedToday} booked visit{bookedToday === 1 ? '' : 's'} today.</p>
                <Button asChild variant="outline" className="h-11 w-full rounded-xl text-[14px] font-medium">
                  <Link href="/reports">See reports</Link>
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}
