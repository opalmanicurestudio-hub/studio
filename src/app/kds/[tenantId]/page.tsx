'use client';

import React, { useState, useMemo, useEffect, useRef, Suspense } from 'react';
import { useParams } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
    Coffee,
    CheckCircle2,
    Loader,
    MapPin,
    Star,
    ArrowRight,
    XCircle,
    Eye,
    ChefHat,
    Zap,
    Volume2,
    VolumeX,
    Timer,
    User,
    Bell,
    Activity,
    TrendingUp,
} from 'lucide-react';
import { useFirebase, useCollection, useMemoFirebase, useDoc } from '@/firebase';
import {
    collection,
    doc,
    writeBatch,
    increment,
    arrayUnion,
    query,
    where,
} from 'firebase/firestore';
import { cn, safeNumber } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import { nanoid } from 'nanoid';
import { format, differenceInSeconds } from 'date-fns';
import { useToast } from '@/hooks/use-toast';
import Image from 'next/image';
import { type InventoryItem, type Tenant } from '@/lib/data';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const safeDate = (val: any): Date => {
    if (!val) return new Date();
    if (val instanceof Date) return val;
    if (typeof val?.toDate === 'function') return val.toDate();
    if (typeof val === 'string') return new Date(val);
    return new Date(val);
};

const sanitize = (obj: any): any => {
    if (obj === null || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.map(sanitize);
    return Object.fromEntries(
        Object.entries(obj)
            .filter(([, v]) => v !== undefined)
            .map(([k, v]) => [k, sanitize(v)])
    );
};

// ─── Elapsed Timer Hook ───────────────────────────────────────────────────────

function useElapsed(startDate: Date) {
    const [elapsed, setElapsed] = useState(0);
    useEffect(() => {
        const update = () => setElapsed(differenceInSeconds(new Date(), startDate));
        update();
        const id = setInterval(update, 1000);
        return () => clearInterval(id);
    }, [startDate]);
    return elapsed;
}

// ─── Urgency ─────────────────────────────────────────────────────────────────

function urgencyLevel(s: number): 'fresh' | 'warm' | 'hot' | 'critical' {
    if (s < 120) return 'fresh';
    if (s < 300) return 'warm';
    if (s < 480) return 'hot';
    return 'critical';
}

const URGENCY = {
    fresh:    { bar: 'bg-emerald-400', border: 'border-slate-200',  glow: '',                                                     label: 'bg-emerald-100 text-emerald-700' },
    warm:     { bar: 'bg-amber-400',   border: 'border-amber-300',  glow: '',                                                     label: 'bg-amber-100 text-amber-700'     },
    hot:      { bar: 'bg-orange-500',  border: 'border-orange-400', glow: 'shadow-[0_0_20px_rgba(249,115,22,0.25)]',              label: 'bg-orange-100 text-orange-700'   },
    critical: { bar: 'bg-red-500',     border: 'border-red-500',    glow: 'shadow-[0_0_30px_rgba(239,68,68,0.35)] animate-pulse', label: 'bg-red-100 text-red-700'         },
};

function formatElapsed(s: number): string {
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
}

// ─── Ticket Card ──────────────────────────────────────────────────────────────

const TicketCard = ({
    request,
    inventory,
    onClaim,
    onMarkReady,
    onDeliver,
    onCancel,
    lane,
}: {
    request: any;
    inventory: InventoryItem[];
    onClaim: (id: string) => void;
    onMarkReady: (req: any) => void;
    onDeliver: (req: any) => void;
    onCancel: (id: string) => void;
    lane: 'incoming' | 'prep' | 'ready';
}) => {
    const startDate = safeDate(request.requestedAt);
    const elapsed = useElapsed(startDate);
    const urgency = urgencyLevel(elapsed);
    const styles = URGENCY[urgency];
    const qty = safeNumber(request.quantity) || 1;
    const item = inventory.find(i => i.id === request.itemId);

    const ingredients = useMemo(() => {
        if (!item?.formula || item.formula.length === 0) return [];
        return item.formula.map((f: any) => ({
            ...f,
            totalNeeded: (safeNumber(f.quantityUsed) * qty).toFixed(1),
        }));
    }, [item, qty]);

    return (
        <motion.div
            layout
            initial={{ opacity: 0, y: 16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.93, y: -10 }}
            transition={{ type: 'spring', stiffness: 300, damping: 28 }}
            className={cn(
                'relative rounded-[1.75rem] border-2 bg-white overflow-hidden transition-shadow duration-500',
                styles.border,
                styles.glow
            )}
        >
            {/* Urgency bar */}
            <div className={cn('absolute top-0 left-0 right-0 h-1.5', styles.bar)} />

            {/* Header row */}
            <div className="px-5 pt-6 pb-3 flex items-start justify-between gap-3">
                <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-black text-[10px] uppercase tracking-[0.25em] text-slate-400">
                            #{(request.id ?? '').slice(-5).toUpperCase()}
                        </span>
                        {request.isRedemption && (
                            <Badge className="bg-indigo-600 text-white border-none font-black text-[8px] uppercase tracking-widest h-4 px-2">
                                <Star className="w-2 h-2 mr-1 fill-current" /> Perk
                            </Badge>
                        )}
                        {request.isGuestKiosk && (
                            <Badge className="bg-amber-500 text-white border-none font-black text-[8px] uppercase tracking-widest h-4 px-2">
                                Lounge
                            </Badge>
                        )}
                        {safeNumber(request.priceAtRequest) > 0 && !request.isRedemption && (
                            <Badge className="bg-emerald-600 text-white border-none font-black text-[8px] uppercase tracking-widest h-4 px-2">
                                ${(safeNumber(request.priceAtRequest) * qty).toFixed(2)}
                            </Badge>
                        )}
                    </div>
                    <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">
                        {format(startDate, 'h:mm:ss a')}
                    </p>
                </div>
                <div className={cn('px-3 py-1.5 rounded-xl font-black font-mono text-sm tabular-nums shrink-0', styles.label)}>
                    {formatElapsed(elapsed)}
                </div>
            </div>

            {/* Item */}
            <div className="px-5 pb-3 flex items-center gap-4">
                <div className="relative w-14 h-14 rounded-2xl overflow-hidden bg-slate-100 flex items-center justify-center shrink-0 border border-slate-200">
                    {item?.imageUrl ? (
                        <Image src={item.imageUrl} alt={item.name} fill className="object-cover" />
                    ) : (
                        <Coffee className="w-6 h-6 text-slate-300" />
                    )}
                    <div className="absolute -top-1.5 -right-1.5 bg-slate-900 text-white rounded-full w-5 h-5 flex items-center justify-center font-black text-[10px] border-2 border-white">
                        {qty}
                    </div>
                </div>
                <div className="min-w-0">
                    <h3 className="font-black text-xl uppercase tracking-tighter text-slate-900 leading-none truncate">
                        {request.itemName}
                    </h3>
                    {ingredients.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-2">
                            {ingredients.map((f: any, i: number) => (
                                <span key={i} className="text-[9px] font-black uppercase tracking-widest bg-slate-100 text-slate-600 px-2 py-0.5 rounded-lg border border-slate-200">
                                    {f.totalNeeded}{f.unit} {f.name}
                                </span>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Guest info */}
            <div className="mx-5 mb-3 p-3 rounded-2xl bg-slate-50 border border-slate-100 space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[9px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1">
                        <User className="w-3 h-3" /> Guest
                    </span>
                    <span className="text-[10px] font-black text-slate-700 uppercase tracking-tight">
                        {request.clientName}
                    </span>
                    <span className="text-slate-300">·</span>
                    <span className="text-[9px] font-black text-primary uppercase flex items-center gap-1">
                        <MapPin className="w-3 h-3" />
                        {request.stationName || 'Lounge'}
                    </span>
                </div>
                {(request.guestDescription || request.notes) && (
                    <div className="space-y-1.5 pt-1 border-t border-slate-200">
                        {request.guestDescription && (
                            <p className="text-[9px] font-black text-indigo-600 uppercase flex items-center gap-1.5 tracking-widest">
                                <Eye className="w-3 h-3" />
                                {request.guestDescription}
                            </p>
                        )}
                        {request.notes && (
                            <p className="text-[9px] font-medium text-slate-500 italic leading-relaxed border-l-2 border-slate-300 pl-2">
                                "{request.notes}"
                            </p>
                        )}
                    </div>
                )}
            </div>

            {/* Actions */}
            <div className="px-5 pb-5 flex gap-2">
                {lane === 'incoming' && (
                    <>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => onCancel(request.id)}
                            className="h-10 w-10 rounded-xl p-0 border-2 hover:bg-red-50 hover:border-red-300 hover:text-red-600 transition-all shrink-0"
                        >
                            <XCircle className="w-4 h-4" />
                        </Button>
                        <Button
                            size="sm"
                            onClick={() => onClaim(request.id)}
                            className="h-10 flex-1 rounded-xl font-black uppercase text-[9px] tracking-[0.2em] shadow-lg shadow-primary/20"
                        >
                            <ChefHat className="w-3.5 h-3.5 mr-2" /> Claim & Prep
                        </Button>
                    </>
                )}
                {lane === 'prep' && (
                    <>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => onCancel(request.id)}
                            className="h-10 w-10 rounded-xl p-0 border-2 hover:bg-red-50 hover:border-red-300 hover:text-red-600 transition-all shrink-0"
                        >
                            <XCircle className="w-4 h-4" />
                        </Button>
                        <Button
                            size="sm"
                            onClick={() => onMarkReady(request)}
                            className="h-10 flex-1 rounded-xl font-black uppercase text-[9px] tracking-[0.2em] shadow-lg shadow-emerald-500/20 bg-emerald-600 hover:bg-emerald-700"
                        >
                            <CheckCircle2 className="w-3.5 h-3.5 mr-2" /> Mark Ready
                        </Button>
                    </>
                )}
                {lane === 'ready' && (
                    <Button
                        size="sm"
                        onClick={() => onDeliver(request)}
                        className="h-10 flex-1 rounded-xl font-black uppercase text-[9px] tracking-[0.2em] shadow-lg shadow-primary/20 animate-pulse"
                    >
                        <ArrowRight className="w-3.5 h-3.5 mr-2" /> Certify Delivery
                    </Button>
                )}
            </div>
        </motion.div>
    );
};

// ─── Lane Column ──────────────────────────────────────────────────────────────

const LaneColumn = ({
    title,
    icon: Icon,
    count,
    children,
    accentClass,
    emptyLabel,
}: {
    title: string;
    icon: React.ElementType;
    count: number;
    children: React.ReactNode;
    accentClass: string;
    emptyLabel: string;
}) => (
    <div className="flex flex-col gap-4 min-w-0">
        <div className="flex items-center justify-between px-1">
            <div className="flex items-center gap-2.5">
                <div className={cn('p-2 rounded-xl', accentClass)}>
                    <Icon className="w-4 h-4" />
                </div>
                <span className="font-black text-[11px] uppercase tracking-[0.25em] text-slate-700">{title}</span>
            </div>
            <span className={cn('font-black font-mono text-sm w-8 h-8 rounded-xl flex items-center justify-center', count > 0 ? accentClass : 'bg-slate-100 text-slate-400')}>
                {count}
            </span>
        </div>
        <div className="h-px bg-slate-200/80" />
        <div className="space-y-4 flex-1">
            <AnimatePresence mode="popLayout">
                {count === 0 ? (
                    <motion.div
                        key="empty"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="py-16 flex flex-col items-center gap-3 text-slate-300 border-2 border-dashed border-slate-200 rounded-[2rem]"
                    >
                        <Icon className="w-8 h-8" />
                        <p className="text-[9px] font-black uppercase tracking-[0.3em]">{emptyLabel}</p>
                    </motion.div>
                ) : children}
            </AnimatePresence>
        </div>
    </div>
);

// ─── Stats Bar ────────────────────────────────────────────────────────────────

const StatsBar = ({ requests }: { requests: any[] }) => {
    const stats = useMemo(() => {
        // FIX: guard against null — useCollection may return null before data loads
        const safeRequests = requests ?? [];
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayReqs = safeRequests.filter(r => safeDate(r.requestedAt) >= today);
        const delivered = todayReqs.filter(r => r.status === 'delivered');
        const waitTimes = delivered.map(r =>
            Math.max(0, differenceInSeconds(safeDate(r.deliveredAt), safeDate(r.requestedAt)))
        );
        const avgWait = waitTimes.length > 0
            ? Math.round(waitTimes.reduce((a, b) => a + b, 0) / waitTimes.length)
            : 0;
        const itemCount: Record<string, number> = {};
        safeRequests.forEach(r => { itemCount[r.itemName] = (itemCount[r.itemName] || 0) + 1; });
        const topItem = Object.entries(itemCount).sort((a, b) => b[1] - a[1])[0]?.[0] || '—';
        return {
            total: todayReqs.length,
            delivered: delivered.length,
            pending: todayReqs.filter(r => r.status === 'pending').length,
            avgWait: formatElapsed(avgWait),
            topItem,
        };
    }, [requests]);

    const items = [
        { label: 'Today',     value: stats.total,     icon: Activity     },
        { label: 'Delivered', value: stats.delivered, icon: CheckCircle2 },
        { label: 'Pending',   value: stats.pending,   icon: Timer        },
        { label: 'Avg Wait',  value: stats.avgWait,   icon: TrendingUp   },
        { label: 'Top Item',  value: stats.topItem,   icon: Star, truncate: true },
    ];

    return (
        <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
            {items.map((item, i) => (
                <div key={i} className="flex items-center gap-2.5 px-4 py-2.5 rounded-2xl bg-white border-2 border-slate-100 shrink-0">
                    <item.icon className="w-3.5 h-3.5 text-primary opacity-50 shrink-0" />
                    <div>
                        <p className="text-[8px] font-black uppercase tracking-widest text-slate-400 leading-none mb-0.5">{item.label}</p>
                        <p className={cn('font-black text-sm text-slate-900 leading-none font-mono', item.truncate && 'max-w-[80px] truncate text-xs')}>
                            {item.value}
                        </p>
                    </div>
                </div>
            ))}
        </div>
    );
};

// ─── Main KDS ─────────────────────────────────────────────────────────────────

function KDSContent() {
    const { tenantId } = useParams() as { tenantId: string };
    const { firestore, user } = useFirebase();
    const { toast } = useToast();

    const [soundEnabled, setSoundEnabled] = useState(true);
    const [lastCount, setLastCount] = useState(0);
    const audioCtxRef = useRef<AudioContext | null>(null);

    // Data
    const tenantRef = useMemoFirebase(
        () => doc(firestore, `tenants/${tenantId}`),
        [firestore, tenantId]
    );
    const { data: tenant } = useDoc<Tenant>(tenantRef);

    const inventoryQuery = useMemoFirebase(
        () => collection(firestore, `tenants/${tenantId}/inventory`),
        [firestore, tenantId]
    );
    const { data: inventory = [] } = useCollection<InventoryItem>(inventoryQuery);

    // Active orders only
    const activeQuery = useMemoFirebase(
        () => query(
            collection(firestore, `tenants/${tenantId}/refreshmentRequests`),
            where('status', 'in', ['pending', 'in_progress', 'ready'])
        ),
        [firestore, tenantId]
    );
    const { data: activeRequestsRaw } = useCollection<any>(activeQuery);
    // FIX: guard against null — useCollection may return null before data loads
    const activeRequests = activeRequestsRaw ?? [];

    // All requests for stats bar
    const allQuery = useMemoFirebase(
        () => collection(firestore, `tenants/${tenantId}/refreshmentRequests`),
        [firestore, tenantId]
    );
    const { data: allRequestsRaw } = useCollection<any>(allQuery);
    // FIX: guard against null — useCollection may return null before data loads
    const allRequests = allRequestsRaw ?? [];

    // Lanes — oldest first (FIFO)
    const incoming = useMemo(() =>
        activeRequests.filter(r => r.status === 'pending')
            .sort((a, b) => safeDate(a.requestedAt).getTime() - safeDate(b.requestedAt).getTime()),
        [activeRequests]
    );
    const prep = useMemo(() =>
        activeRequests.filter(r => r.status === 'in_progress')
            .sort((a, b) => safeDate(a.requestedAt).getTime() - safeDate(b.requestedAt).getTime()),
        [activeRequests]
    );
    const ready = useMemo(() =>
        activeRequests.filter(r => r.status === 'ready')
            .sort((a, b) => safeDate(a.requestedAt).getTime() - safeDate(b.requestedAt).getTime()),
        [activeRequests]
    );

    // Sound on new incoming
    useEffect(() => {
        if (incoming.length > lastCount && lastCount !== 0 && soundEnabled) {
            try {
                if (!audioCtxRef.current) audioCtxRef.current = new AudioContext();
                const ctx = audioCtxRef.current;
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.frequency.setValueAtTime(880, ctx.currentTime);
                osc.frequency.setValueAtTime(1100, ctx.currentTime + 0.1);
                gain.gain.setValueAtTime(0.3, ctx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
                osc.start(ctx.currentTime);
                osc.stop(ctx.currentTime + 0.4);
            } catch (_) {}
        }
        setLastCount(incoming.length);
    }, [incoming.length]); // eslint-disable-line react-hooks/exhaustive-deps

    // ── Actions ──────────────────────────────────────────────────────────────

    const handleClaim = async (requestId: string) => {
        if (!firestore || !tenantId) return;
        try {
            const b = writeBatch(firestore);
            b.update(
                doc(firestore, `tenants/${tenantId}/refreshmentRequests`, requestId),
                sanitize({ status: 'in_progress', claimedBy: user?.uid || 'kds', claimedAt: new Date().toISOString() })
            );
            await b.commit();
        } catch {
            toast({ variant: 'destructive', title: 'Error', description: 'Could not claim order.' });
        }
    };

    const handleMarkReady = async (request: any) => {
        if (!firestore || !tenantId) return;
        try {
            const b = writeBatch(firestore);
            b.update(
                doc(firestore, `tenants/${tenantId}/refreshmentRequests`, request.id),
                sanitize({ status: 'ready', readyAt: new Date().toISOString() })
            );
            await b.commit();
            toast({ title: 'Order Ready', description: `${request.itemName} ready for ${request.clientName}.` });
        } catch {
            toast({ variant: 'destructive', title: 'Error', description: 'Could not update order.' });
        }
    };

    const handleDeliver = async (request: any) => {
        if (!firestore || !tenantId) return;
        const item = inventory.find(i => i.id === request.itemId);
        if (!item) return;

        const b = writeBatch(firestore);
        const now = new Date().toISOString();
        const qty = safeNumber(request.quantity || 1);

        // 1. Mark delivered
        b.update(
            doc(firestore, `tenants/${tenantId}/refreshmentRequests`, request.id),
            sanitize({ status: 'delivered', deliveredAt: now, deliveredBy: user?.uid || 'kds' })
        );

        // 2. Inventory deduction
        const ingredients =
            item.formula && item.formula.length > 0
                ? item.formula.map((f: any) => ({ ...f, quantityUsed: safeNumber(f.quantityUsed) * qty }))
                : [{ id: item.id, name: item.name, quantityUsed: qty, unit: item.unit || 'unit' }];

        ingredients.forEach((ingredient: any) => {
            const product = inventory.find(p => p.id === ingredient.id);
            if (!product) return;
            const productRef = doc(firestore, `tenants/${tenantId}/inventory`, product.id);
            const updateData: any = {};
            if (product.costingMethod === 'uses') {
                let uses = safeNumber(product.partialContainerUses) - ingredient.quantityUsed;
                let stock = safeNumber(product.totalStock);
                const usesPerContainer = safeNumber(product.estimatedUses) || 1;
                while (uses <= 0 && stock > 0) { stock -= 1; uses += usesPerContainer; }
                if (stock <= 0) { stock = 0; uses = Math.max(0, uses); }
                updateData.totalStock = stock;
                updateData.partialContainerUses = uses;
            } else {
                updateData.totalStock = increment(-ingredient.quantityUsed);
            }
            b.update(productRef, sanitize(updateData));

            const corrRef = doc(collection(firestore, `tenants/${tenantId}/stockCorrections`));
            b.set(corrRef, sanitize({
                id: nanoid(), productId: product.id, date: now,
                change: -ingredient.quantityUsed, unit: product.unit || 'unit',
                reason: `KDS Delivery: ${item.name} (x${qty}) — ${request.clientName}`,
                requestId: request.id,
            }));
        });

        // 3. Perk usage
        if (request.isRedemption && request.clientId && request.clientId !== 'guest-walkin') {
            b.update(
                doc(firestore, `tenants/${tenantId}/clients`, request.clientId),
                {
                    [`subscription.perkUsage.${request.itemId}`]: increment(qty),
                    'subscription.perkLastUsed': now,
                }
            );
        }

        // 4. Appointment binding
        if (request.appointmentId && request.appointmentId !== 'guest-walkin') {
            b.set(
                doc(firestore, `tenants/${tenantId}/appointments/${request.appointmentId}`),
                {
                    checkoutState: {
                        refreshments: arrayUnion(sanitize({
                            id: item.id, name: item.name,
                            price: safeNumber(request.priceAtRequest),
                            deliveredAt: now, quantity: qty, isAccountedFor: true,
                        })),
                    },
                },
                { merge: true }
            );
        }

        try {
            await b.commit();
            toast({ title: 'Delivery Certified', description: `${request.itemName} delivered to ${request.clientName}.` });
        } catch {
            toast({ variant: 'destructive', title: 'Error', description: 'Delivery record failed.' });
        }
    };

    const handleCancel = async (requestId: string) => {
        if (!firestore || !tenantId) return;
        try {
            const b = writeBatch(firestore);
            b.update(
                doc(firestore, `tenants/${tenantId}/refreshmentRequests`, requestId),
                { status: 'cancelled' }
            );
            await b.commit();
            toast({ title: 'Order Cancelled' });
        } catch {
            toast({ variant: 'destructive', title: 'Error', description: 'Could not cancel order.' });
        }
    };

    const totalActive = incoming.length + prep.length + ready.length;

    return (
        <div className="min-h-screen bg-slate-50 font-body flex flex-col overflow-hidden">

            {/* ── Top Bar ── */}
            <header className="shrink-0 bg-white border-b-2 border-slate-100 px-6 py-4 flex items-center justify-between gap-4">
                <div className="flex items-center gap-4 min-w-0">
                    <div className="p-2.5 bg-primary/10 rounded-2xl shrink-0">
                        <ChefHat className="w-5 h-5 text-primary" />
                    </div>
                    <div className="min-w-0">
                        <div className="flex items-center gap-2">
                            <h1 className="font-black text-lg uppercase tracking-tighter text-slate-900 leading-none">KDS</h1>
                            <span className="text-slate-300 font-light">·</span>
                            <span className="font-black text-[11px] uppercase tracking-[0.2em] text-slate-400 truncate">
                                {tenant?.name || 'Concierge'}
                            </span>
                        </div>
                        <p className="text-[9px] font-black uppercase tracking-[0.3em] text-slate-400 mt-0.5">Kitchen Display System</p>
                    </div>
                    {totalActive > 0 && (
                        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-primary text-white shrink-0">
                            <Bell className="w-3 h-3 animate-bounce" />
                            <span className="font-black text-[10px] uppercase tracking-widest">{totalActive} Active</span>
                        </div>
                    )}
                </div>

                <div className="flex items-center gap-3 shrink-0">
                    <StatsBar requests={allRequests} />
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setSoundEnabled(v => !v)}
                        className={cn(
                            'h-10 w-10 rounded-2xl p-0 border-2 transition-all',
                            soundEnabled ? 'border-primary/20 text-primary bg-primary/5' : 'border-slate-200 text-slate-400'
                        )}
                    >
                        {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
                    </Button>
                </div>
            </header>

            {/* ── Three Lanes ── */}
            <main className="flex-1 overflow-hidden p-6">
                <div className="h-full grid grid-cols-3 gap-6">

                    <div className="overflow-y-auto pr-1 scrollbar-none">
                        <LaneColumn title="Incoming" icon={Bell} count={incoming.length} accentClass="bg-blue-100 text-blue-600" emptyLabel="Queue Clear">
                            {incoming.map(r => (
                                <TicketCard key={r.id} request={r} inventory={inventory}
                                    onClaim={handleClaim} onMarkReady={handleMarkReady}
                                    onDeliver={handleDeliver} onCancel={handleCancel} lane="incoming" />
                            ))}
                        </LaneColumn>
                    </div>

                    <div className="overflow-y-auto pr-1 scrollbar-none">
                        <LaneColumn title="In Prep" icon={ChefHat} count={prep.length} accentClass="bg-amber-100 text-amber-600" emptyLabel="Nothing Prepping">
                            {prep.map(r => (
                                <TicketCard key={r.id} request={r} inventory={inventory}
                                    onClaim={handleClaim} onMarkReady={handleMarkReady}
                                    onDeliver={handleDeliver} onCancel={handleCancel} lane="prep" />
                            ))}
                        </LaneColumn>
                    </div>

                    <div className="overflow-y-auto pr-1 scrollbar-none">
                        <LaneColumn title="Ready to Deliver" icon={Zap} count={ready.length} accentClass="bg-emerald-100 text-emerald-600" emptyLabel="Nothing Ready Yet">
                            {ready.map(r => (
                                <TicketCard key={r.id} request={r} inventory={inventory}
                                    onClaim={handleClaim} onMarkReady={handleMarkReady}
                                    onDeliver={handleDeliver} onCancel={handleCancel} lane="ready" />
                            ))}
                        </LaneColumn>
                    </div>

                </div>
            </main>

            {/* ── Footer ── */}
            <footer className="shrink-0 bg-white border-t-2 border-slate-100 px-6 py-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                    <span className="text-[9px] font-black uppercase tracking-[0.3em] text-slate-400">Live · Auto-Sync</span>
                </div>
                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-3">
                        {[
                            { color: 'bg-emerald-400', label: '0–2m' },
                            { color: 'bg-amber-400',   label: '2–5m' },
                            { color: 'bg-orange-500',  label: '5–8m' },
                            { color: 'bg-red-500',     label: '8m+'  },
                        ].map(({ color, label }) => (
                            <div key={label} className="flex items-center gap-1.5">
                                <div className={cn('w-2.5 h-2.5 rounded-full', color)} />
                                <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">{label}</span>
                            </div>
                        ))}
                    </div>
                    <span className="text-[9px] font-black uppercase tracking-widest text-slate-300">
                        {format(new Date(), 'h:mm a')}
                    </span>
                </div>
            </footer>
        </div>
    );
}

export default function KDSPage() {
    return (
        <Suspense fallback={
            <div className="h-screen flex items-center justify-center bg-slate-50">
                <div className="flex flex-col items-center gap-4">
                    <Loader className="w-8 h-8 animate-spin text-primary" />
                    <p className="text-[10px] font-black uppercase tracking-[0.4em] text-slate-400">Initializing KDS...</p>
                </div>
            </div>
        }>
            <KDSContent />
        </Suspense>
    );
}