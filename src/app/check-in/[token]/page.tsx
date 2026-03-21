'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { 
    Clock, 
    MapPin, 
    Check, 
    Loader, 
    CheckCircle2, 
    Sparkles, 
    Calendar as CalendarIcon, 
    Fingerprint, 
    Wifi, 
    Coffee,
    Activity,
    ArrowRight,
    Plus,
    Minus,
    Info,
    ChevronDown,
    ChevronUp,
    XCircle,
    Car,
    AlertTriangle,
    Users,
    Lock,
    Star,
    Zap,
    Award,
    Smartphone,
    Headphones,
    Moon,
    VolumeX,
    SunDim,
    Gamepad2,
    Trash2,
    MessageSquare,
    Heart,
    Undo2,
    ArrowLeft,
    Repeat,
    User,
    LayoutDashboard,
    Maximize2
} from 'lucide-react';
import { format, parseISO, subMonths, isAfter, subYears, isBefore, startOfMonth, differenceInHours, isSameDay, startOfDay, addMonths, isToday } from 'date-fns';
import { type Appointment, type Client, type Service, type Tenant, type Staff, type InventoryItem, type Resource, type Membership, type RefreshmentRequest, type Review } from '@/lib/data';
import { useFirebase, useCollection, useMemoFirebase, useDoc, setDocumentNonBlocking, updateDocumentNonBlocking } from '@/firebase';
import { collection, query, where, doc } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { cn, safeNumber } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import { nanoid } from 'nanoid';
import Image from 'next/image';
import Link from 'next/link';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';

const safeDate = (val: any): Date => {
    if (!val) return new Date();
    if (val instanceof Date) return val;
    if (typeof val === 'string') return parseISO(val);
    if (typeof val === 'object' && 'seconds' in val) return new Date(val.seconds * 1000);
    return new Date(val);
};

const ViewContainer = ({ children }: { children: React.ReactNode }) => (
    <motion.div 
        initial={{ opacity: 0, y: 20 }} 
        animate={{ opacity: 1, y: 0 }} 
        className="w-full max-w-2xl px-2 sm:px-0 text-left"
    >
        <Card className="border-4 rounded-[2.5rem] md:rounded-[3rem] shadow-3xl overflow-hidden bg-white/90 backdrop-blur-xl">
            {children}
        </Card>
    </motion.div>
);

const ViewHeader = ({ title, subtitle, icon: Icon }: { title: string, subtitle: string, icon?: any }) => (
    <CardHeader className="p-6 md:p-8 pb-4 border-b bg-muted/5 text-left">
        <div className="flex items-center gap-3 mb-2">
            {Icon ? <Icon className="w-4 h-4 md:w-5 md:h-5 text-primary" /> : <Sparkles className="w-4 h-4 md:w-5 md:h-5 text-primary" />}
            <span className="text-[9px] md:text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground opacity-60">Studio Portal</span>
        </div>
        <CardTitle className="text-2xl md:text-3xl font-black uppercase tracking-tighter text-slate-900 leading-none">{title}</DialogTitle>
        <CardDescription className="text-[10px] font-bold uppercase tracking-widest opacity-60 mt-1">{subtitle}</CardDescription>
    </CardHeader>
);

const CancelledView = ({ reason }: { reason?: string }) => (
    <ViewContainer>
        <ViewHeader title="Session Cancelled" subtitle="This record has been voided" icon={XCircle} />
        <CardContent className="p-8 text-center space-y-8">
            <div className="w-24 h-24 bg-destructive/5 rounded-[2.5rem] flex items-center justify-center mx-auto opacity-40">
                <XCircle className="w-12 h-12 text-destructive" />
            </div>
            <div className="space-y-2 text-center">
                <h3 className="text-2xl font-black uppercase tracking-tighter text-slate-900 text-center">Appointment Voided</h3>
                <p className="text-sm font-medium text-slate-500 leading-relaxed uppercase tracking-tight max-w-xs mx-auto text-center">
                    This appointment is no longer active in our manifest. Reason: <strong>{reason?.replace('_', ' ') || 'Protocol Change'}</strong>.
                </p>
            </div>
            <Button asChild className="w-full h-14 rounded-2xl font-black uppercase tracking-widest text-[10px]">
                <Link href="/">Book New Session</Link>
            </Button>
        </CardContent>
    </ViewContainer>
);

const CompletedView = ({ tenant, client, appointment, service, staff }: { tenant: Tenant | null, client: Client | null, appointment: Appointment, service: Service | null, staff: Staff | null }) => {
    const { firestore } = useFirebase();
    const { toast } = useToast();
    const [rating, setRating] = useState(0);
    const [reviewText, setReviewText] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [submitted, setSubmitted] = useState(false);

    const handleReviewSubmit = async () => {
        if (rating === 0 || !firestore || !tenant || !client) return;
        setIsSubmitting(true);
        try {
            const reviewId = nanoid();
            const review: Review = {
                id: reviewId,
                tenantId: tenant.id,
                clientId: client.id,
                clientName: client.name,
                clientAvatarUrl: client.avatarUrl,
                staffId: appointment.staffId || '',
                serviceId: appointment.serviceId,
                serviceName: service?.name || 'Treatment',
                rating,
                text: reviewText,
                isPublic: false,
                isFeatured: false,
                createdAt: new Date().toISOString()
            };
            await setDocumentNonBlocking(doc(firestore, `tenants/${tenant.id}/reviews`, reviewId), review, {});
            toast({ title: "Feedback Archived", description: "Thank you for sharing your story with us." });
            setSubmitted(true);
        } catch (e) {
            toast({ variant: 'destructive', title: "Submission Failed" });
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <ViewContainer>
            <ViewHeader title="Session Concluded" subtitle="We hope you enjoyed your visit" icon={CheckCircle2} />
            <CardContent className="p-0">
                <AnimatePresence mode="wait">
                    {!submitted ? (
                        <motion.div key="review-form" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="p-8 space-y-10">
                            <div className="text-center space-y-4">
                                <div className="w-20 h-20 bg-primary/10 rounded-[2.5rem] flex items-center justify-center mx-auto shadow-2xl shadow-primary/5 rotate-6">
                                    <Heart className="w-10 h-10 text-primary -rotate-6" />
                                </div>
                                <div className="space-y-1 text-center">
                                    <h3 className="text-2xl font-black uppercase tracking-tighter text-slate-900 text-center">How was it?</h3>
                                    <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest opacity-60 text-center">Help us refine our technical protocol</p>
                                </div>
                            </div>

                            <div className="flex justify-center gap-2">
                                {[1, 2, 3, 4, 5].map((star) => (
                                    <button 
                                        key={star} 
                                        onClick={() => setRating(star)}
                                        className={cn(
                                            "p-2 transition-all active:scale-90",
                                            rating >= star ? "text-amber-400" : "text-muted-foreground opacity-20 hover:opacity-40"
                                        )}
                                    >
                                        <Star className={cn("w-10 h-10 md:w-12 md:h-12", rating >= star && "fill-current")} />
                                    </button>
                                ))}
                            </div>

                            <div className="space-y-3 text-left">
                                <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Share your Story</Label>
                                <Textarea 
                                    placeholder="Write a few words about your session..." 
                                    value={reviewText}
                                    onChange={e => setReviewText(e.target.value)}
                                    className="rounded-[2rem] border-2 bg-muted/5 p-6 font-medium leading-relaxed min-h-[120px]"
                                />
                            </div>

                            <Button 
                                onClick={handleReviewSubmit} 
                                disabled={rating === 0 || isSubmitting}
                                className="w-full h-16 rounded-[2rem] text-xl font-black uppercase shadow-3xl shadow-primary/30 group"
                            >
                                {isSubmitting ? <Loader className="animate-spin" /> : <>Submit Feedback <ArrowRight className="ml-2 w-5 h-5 transition-transform group-hover:translate-x-1" /></>}
                            </Button>
                        </motion.div>
                    ) : (
                        <motion.div key="success" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="p-12 text-center space-y-8">
                            <div className="w-20 h-20 bg-green-500/10 rounded-[2.5rem] flex items-center justify-center mx-auto shadow-xl">
                                <CheckCircle2 className="w-10 h-10 text-green-500" />
                            </div>
                            <div className="space-y-2 text-center">
                                <h3 className="text-2xl font-black uppercase tracking-tighter text-center">Feedback Certified</h3>
                                <p className="text-sm font-medium text-slate-500 uppercase tracking-tight max-w-xs mx-auto text-center">Your review has been added to our studio archive. See you next time!</p>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>

                <div className="p-8 bg-muted/5 border-t-2 border-dashed border-border/50 space-y-6">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <Button asChild variant="outline" className="h-14 rounded-2xl border-2 font-black uppercase tracking-widest text-[10px] bg-white shadow-sm">
                            <Link href={`/book/${tenant?.id}`}>
                                <Repeat className="w-4 h-4 mr-2" /> Book Again
                            </Link>
                        </Button>
                        <Button asChild variant="outline" className="h-14 rounded-2xl border-2 font-black uppercase tracking-widest text-[10px] bg-white shadow-sm">
                            <Link href={`/portal/${tenant?.id}/${client?.id}`}>
                                <LayoutDashboard className="w-4 h-4 mr-2" /> My Portal
                            </Link>
                        </Button>
                    </div>
                </div>
            </CardContent>
        </ViewContainer>
    );
};

const ArrivedView = ({ client, staff, tenantId }: { client: Client | null, staff: Staff | null, tenantId?: string }) => (
    <ViewContainer>
        <ViewHeader title="Check-in Confirmed" subtitle="You are in the active queue" icon={CheckCircle2} />
        <CardContent className="p-8 text-center space-y-10">
            <div className="w-24 h-24 bg-green-500/10 rounded-[2.5rem] flex items-center justify-center mx-auto shadow-2xl shadow-green-500/5 rotate-6">
                <CheckCircle2 className="w-12 h-12 text-green-500 -rotate-6" />
            </div>
            <div className="space-y-3 text-center">
                <h3 className="text-2xl font-black uppercase tracking-tighter text-slate-900 text-center">We see you, {client?.name.split(' ')[0]}!</h3>
                <p className="text-sm font-medium text-slate-500 leading-relaxed uppercase tracking-tight max-w-xs mx-auto text-center">
                    Take a seat and relax. Your professional will be with you shortly to begin your session.
                </p>
            </div>

            {staff && (
                <div className="flex items-center gap-4 p-4 rounded-2xl border-2 bg-muted/5 shadow-inner text-left">
                    <Avatar className="h-12 h-12 border-2 border-background shadow-xl rounded-[1.5rem]">
                        <AvatarImage src={staff.avatarUrl} className="object-cover" />
                        <AvatarFallback className="font-black text-xs bg-primary/10 text-primary">{(staff.name || 'S').charAt(0)}</AvatarFallback>
                    </Avatar>
                    <div className="text-left">
                        <p className="text-[9px] font-black uppercase text-muted-foreground opacity-60 leading-none mb-1 text-left">Your Professional</p>
                        <p className="font-black text-sm uppercase text-slate-800 leading-none text-left">{staff.name}</p>
                    </div>
                </div>
            )}

            <div className="p-4 rounded-xl border-2 border-dashed bg-primary/5 flex items-center justify-center gap-3 animate-pulse">
                <Loader className="w-4 h-4 text-primary animate-spin" />
                <span className="text-[10px] font-black uppercase text-primary tracking-widest text-center">Awaiting Technician Signal</span>
            </div>
            
            <div className="pt-6 border-t border-dashed">
                <Button asChild variant="outline" className="w-full h-12 rounded-xl border-2 font-black uppercase text-[10px] tracking-widest bg-white shadow-sm">
                    <Link href={`/portal/${tenantId}/${client?.id}`}>
                        <LayoutDashboard className="w-4 h-4 mr-2 opacity-40" />
                        Manage Full Account Portfolio
                    </Link>
                </Button>
            </div>
        </CardContent>
    </ViewContainer>
);

const RefreshmentCard = ({ 
    item, 
    qty, 
    onQtyChange, 
    onRequest, 
    isRequesting, 
    hasPendingRequest, 
    isMember, 
    activeMembership,
    remainingPerkUses
}: { 
    item: InventoryItem, 
    qty: number, 
    onQtyChange: (delta: number) => void, 
    onRequest: () => void, 
    isRequesting: boolean, 
    hasPendingRequest: boolean, 
    isMember: boolean,
    activeMembership: Membership | null,
    remainingPerkUses: number
}) => {
    const isSoldOut = safeNumber(item.totalStock) <= 0;
    const isPerkDefinition = !!activeMembership?.includedProducts?.some(p => p.id === item.id);
    const isPerkAvailableNow = isPerkDefinition && remainingPerkUses >= qty;

    const getDynamicIcon = (name: string) => {
        const n = name.toLowerCase();
        if (n.includes('charger') || n.includes('stand') || n.includes('power')) return Smartphone;
        if (n.includes('headphone') || n.includes('noise')) return Headphones;
        if (n.includes('blanket') || n.includes('pillow')) return Moon;
        if (n.includes('quiet') || n.includes('silent')) return VolumeX;
        if (n.includes('light')) return SunDim;
        if (n.includes('game') || n.includes('tablet')) return Gamepad2;
        return Coffee;
    };

    const Icon = getDynamicIcon(item.name);

    return (
        <motion.div
            whileTap={{ scale: 0.98 }}
            className="shrink-0 w-64 md:w-72 h-full py-4 text-left"
        >
            <Card className={cn(
                "rounded-[2.5rem] border-2 transition-all h-full flex flex-col overflow-hidden bg-white shadow-lg",
                (isSoldOut || hasPendingRequest) ? "opacity-40" : "border-primary/5 hover:border-primary/30",
                isPerkAvailableNow && "border-indigo-500/20 ring-1 ring-indigo-500/10",
                item.isMembersOnly && "border-indigo-500/30"
            )}>
                <div className="relative aspect-square w-full bg-muted/20 flex items-center justify-center overflow-hidden border-b">
                    {item.imageUrl ? (
                        <div className="relative w-full h-full">
                            <Image src={item.imageUrl} alt={item.name} fill className="object-cover transition-transform duration-700 hover:scale-110" />
                        </div>
                    ) : (
                        <Icon className="w-16 h-16 text-primary opacity-20" />
                    )}
                    
                    <div className="absolute top-4 left-4 flex flex-col gap-2">
                        {item.isMembersOnly && (
                            <Badge className="bg-indigo-600 text-white border-none text-[8px] font-black uppercase tracking-[0.2em] h-6 px-3 shadow-xl">
                                <Award className="w-3 h-3 mr-1.5" /> Club Only
                            </Badge>
                        )}
                        {isPerkDefinition && (
                            <Badge className={cn(
                                "border-none text-[8px] font-black uppercase tracking-[0.2em] h-6 px-3 shadow-xl",
                                remainingPerkUses > 0 ? "bg-primary text-white" : "bg-muted text-muted-foreground opacity-60"
                            )}>
                                <Star className={cn("w-3 h-3 mr-1.5", remainingPerkUses > 0 && "fill-current")} /> 
                                {remainingPerkUses > 0 ? `Perk: ${remainingPerkUses} left` : "Perks Exhausted"}
                            </Badge>
                        )}
                    </div>

                    <div className="absolute bottom-4 right-4">
                        <div className="bg-white/90 backdrop-blur-md rounded-2xl p-2 px-3 shadow-xl border border-white/50">
                            {isPerkAvailableNow ? (
                                <p className="text-[10px] font-black text-green-600 uppercase tracking-widest">Included</p>
                            ) : safeNumber(item.price) > 0 ? (
                                <p className="text-sm font-black text-slate-900 font-mono tracking-tighter">${safeNumber(item.price).toFixed(2)}</p>
                            ) : (
                                <p className="text-[10px] font-black text-green-600 uppercase tracking-widest">Comp</p>
                            )}
                        </div>
                    </div>
                </div>

                <CardContent className="p-6 flex-1 flex flex-col justify-between space-y-4 text-left">
                    <div className="space-y-2">
                        <h4 className="font-black text-lg uppercase tracking-tight text-slate-900 leading-none">{item.name}</h4>
                        {item.description && (
                            <p className="text-[11px] font-medium text-slate-500 leading-relaxed line-clamp-2 italic">
                                "{item.description}"
                            </p>
                        )}
                    </div>

                    <div className="pt-4 border-t border-dashed space-y-4">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3 bg-muted/50 rounded-xl p-1 px-3 h-10 border shadow-inner">
                                <button onClick={() => onQtyChange(-1)} disabled={isSoldOut || hasPendingRequest} className="p-1 hover:text-primary transition-colors disabled:opacity-20"><Minus className="w-4 h-4" /></button>
                                <span className="font-black font-mono text-base w-6 text-center">{qty}</span>
                                <button onClick={() => onQtyChange(1)} disabled={isSoldOut || hasPendingRequest} className="p-1 hover:text-primary transition-colors disabled:opacity-20"><Plus className="w-4 h-4" /></button>
                            </div>
                            <Button 
                                size="sm" 
                                disabled={isRequesting || hasPendingRequest || isSoldOut}
                                onClick={onRequest}
                                className="h-10 px-6 rounded-xl font-black uppercase text-[10px] tracking-[0.2em] shadow-xl shadow-primary/20 transition-all active:scale-95"
                            >
                                {hasPendingRequest ? 'Pending' : isSoldOut ? 'Void' : 'Order'}
                            </Button>
                        </div>
                    </div>
                </CardContent>
            </Card>
        </motion.div>
    );
};

const ServicingView = ({ 
    tenant, 
    client, 
    inventory, 
    activeRequests, 
    appointment, 
    staff, 
    resources,
    memberships
}: { 
    tenant: Tenant | null, 
    client: Client | null, 
    inventory: InventoryItem[], 
    activeRequests: any[],
    appointment: Appointment | null,
    staff: Staff | null,
    resources: Resource[],
    memberships: Membership[]
}) => {
    const { firestore } = useFirebase();
    const { toast } = useToast();
    const [isRequesting, setIsRequesting] = useState(false);
    const [quantities, setQuantities] = useState<Record<string, number>>({});

    const isMember = useMemo(() => {
        if (!client) return false;
        return !!(client.activeMembershipId && client.subscription?.status === 'active');
    }, [client]);

    const activeMembership = useMemo(() => {
        if (!isMember || !client?.activeMembershipId || !memberships) return null;
        return memberships.find(m => m.id === client.activeMembershipId);
    }, [isMember, client, memberships]);

    const getRemainingPerkUses = (itemId: string) => {
        if (!isMember || !activeMembership || !client?.subscription) return 0;
        
        const perkDef = activeMembership.includedProducts?.find(p => p.id === itemId);
        if (!perkDef) return 0;

        const limit = safeNumber(perkDef.quantity);
        const nextBilling = safeDate(client.subscription.nextBillingDate);
        const cycleStart = startOfMonth(activeMembership.interval === 'yearly' ? subYears(nextBilling, 1) : subMonths(nextBilling, 1));

        const totalCycleUsage = activeRequests
            .filter(r => r.itemId === itemId && r.status !== 'cancelled' && isAfter(safeDate(r.requestedAt), cycleStart))
            .reduce((sum, r) => sum + safeNumber(r.quantity), 0);

        return Math.max(0, limit - totalCycleUsage);
    };

    const refreshments = useMemo(() => 
        inventory.filter(item => 
            item.type === 'refreshment' && 
            item.showInConcierge !== false && 
            safeNumber(item.totalStock) > 0 &&
            (!item.isMembersOnly || isMember)
        )
    , [inventory, isMember]);

    const refreshmentsByCategory = useMemo(() => {
        const grouped: Record<string, InventoryItem[]> = {};
        const exclusiveKey = 'Club Exclusive Selection';
        const comfortKey = 'Comfort & Environment';
        
        refreshments.forEach(item => {
            let cat = item.category || 'Standard Selection';
            if (item.isMembersOnly) {
                cat = exclusiveKey;
            } else if (cat.toLowerCase().includes('comfort') || cat.toLowerCase().includes('amenity')) {
                cat = comfortKey;
            }

            if (!grouped[cat]) grouped[cat] = [];
            grouped[cat].push(item);
        });

        const orderedGrouped: Record<string, InventoryItem[]> = {};
        if (grouped[exclusiveKey]) orderedGrouped[exclusiveKey] = grouped[exclusiveKey];
        if (grouped[comfortKey]) orderedGrouped[comfortKey] = grouped[comfortKey];
        
        Object.keys(grouped).sort().forEach(key => {
            if (key !== exclusiveKey && key !== comfortKey) orderedGrouped[key] = grouped[key];
        });

        return orderedGrouped;
    }, [refreshments]);

    const stationName = useMemo(() => {
        if (!appointment?.requiredResourceIds?.length || !resources) return 'Station';
        const res = resources.find(r => r.id === appointment.requiredResourceIds![0]);
        return res?.name || 'Station';
    }, [appointment, resources]);

    const handleRequest = async (item: InventoryItem) => {
        if (!firestore || !tenant || !client || !appointment || isRequesting) return;
        const qty = quantities[item.id] || 1;
        
        const currentSessionPending = activeRequests.filter(r => r.appointmentId === appointment.id && r.status === 'pending');
        const totalSessionQty = currentSessionPending.reduce((sum, r) => sum + safeNumber(r.quantity || 1), 0);
        const limit = tenant.complimentaryAmenityLimit || 0;

        if (limit > 0 && totalSessionQty + qty > limit) {
            toast({ variant: 'destructive', title: 'Limit Reached', description: `Complimentary limit is ${limit} items per session.` });
            return;
        }

        const remainingPerks = getRemainingPerkUses(item.id);
        const isRedemption = remainingPerks >= qty;

        setIsRequesting(true);
        try {
            const requestId = nanoid();
            await setDocumentNonBlocking(doc(firestore, `tenants/${tenant.id}/refreshmentRequests`, requestId), {
                id: requestId, 
                tenantId: tenant.id, 
                appointmentId: appointment.id, 
                clientId: client.id, 
                clientName: client.name, 
                itemId: item.id, 
                itemName: item.name, 
                quantity: qty, 
                status: 'pending', 
                requestedAt: new Date().toISOString(), 
                stationName, 
                staffName: staff?.name || 'Unassigned', 
                priceAtRequest: isRedemption ? 0 : safeNumber(item.price || 0),
                isRedemption
            }, {});
            toast({ title: isRedemption ? "Perk Redeemed!" : "Request Dispatched" });
            setQuantities(prev => ({ ...prev, [item.id]: 1 }));
        } catch (e) {
            toast({ variant: 'destructive', title: "Request Failed" });
        } finally {
            setIsRequesting(false);
        }
    };

    const handleCancelRequest = async (requestId: string) => {
        if (!firestore || !tenant || isRequesting) return;
        try {
            await updateDocumentNonBlocking(doc(firestore, `tenants/${tenant.id}/refreshmentRequests`, requestId), {
                status: 'cancelled'
            });
            toast({ title: "Request Recalled" });
        } catch (e) {
            toast({ variant: 'destructive', title: "Recall Failed" });
        }
    };

    const pendingRequestsForThisSession = activeRequests.filter(r => r.appointmentId === appointment.id && r.status === 'pending');
    const hasActiveRequest = pendingRequestsForThisSession.length > 0;

    return (
        <ViewContainer>
            <ViewHeader title="In Service" subtitle="Your session is active" icon={Clock} />
            <CardContent className="p-0 space-y-12">
                <div className="p-8 text-center space-y-6 bg-primary/5 border-b-2 border-primary/10 shadow-inner">
                    <div className="w-20 h-20 bg-white rounded-[2.5rem] flex items-center justify-center mx-auto shadow-2xl border-2 border-primary/10 rotate-6">
                        <Activity className="w-10 h-10 text-primary -rotate-6" />
                    </div>
                    <div className="space-y-2">
                        <p className="font-black text-2xl uppercase tracking-tighter text-slate-900">Enjoy the Flow</p>
                        <p className="text-[10px] font-bold text-slate-500 leading-relaxed uppercase tracking-widest opacity-60">
                            Service in progress at <strong>{stationName}</strong>
                        </p>
                    </div>
                </div>

                <div className="space-y-16 py-8">
                    {hasActiveRequest && (
                        <div className="px-8 space-y-4">
                            <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-primary">Active Request Ledger</h3>
                            <div className="grid gap-3">
                                {pendingRequestsForThisSession.map(req => (
                                    <div key={req.id} className="flex items-center justify-between p-4 rounded-2xl border-2 bg-primary/5 border-primary/10 animate-pulse">
                                        <div className="flex items-center gap-3">
                                            <div className="p-2 bg-white rounded-xl shadow-inner"><Loader className="w-4 h-4 text-primary animate-spin" /></div>
                                            <div className="text-left">
                                                <p className="text-xs font-black uppercase text-slate-900">{req.itemName}</p>
                                                <div className="flex items-center gap-2">
                                                    <p className="text-[8px] font-bold text-primary/60 uppercase">Qty: {safeNumber(req.quantity || 1)}</p>
                                                    {req.isRedemption && <Badge className="bg-primary text-white border-none text-[6px] h-3 px-1 font-black uppercase">Club Perk</Badge>}
                                                </div>
                                            </div>
                                        </div>
                                        <Button 
                                            variant="ghost" 
                                            size="sm" 
                                            onClick={() => handleCancelRequest(req.id)}
                                            className="h-8 px-3 rounded-lg font-black uppercase text-[9px] tracking-widest text-destructive hover:bg-destructive/10"
                                        >
                                            Recall
                                        </Button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {Object.entries(refreshmentsByCategory).map(([category, items], catIdx) => {
                        const isExclusive = category === 'Club Exclusive Selection';
                        const isComfort = category === 'Comfort & Environment';
                        
                        return (
                            <section key={category} className="space-y-6">
                                <div className="flex items-center justify-between px-8">
                                    <h3 className={cn(
                                        "text-xs md:text-sm font-black uppercase tracking-[0.3em]",
                                        isExclusive ? "text-indigo-600" : isComfort ? "text-primary" : "text-muted-foreground opacity-40"
                                    )}>
                                        {isExclusive && <Award className="inline-block w-4 h-4 mr-2 -mt-1" />}
                                        {isComfort && <Zap className="inline-block w-4 h-4 mr-2 -mt-1" />}
                                        {category}
                                    </h3>
                                    <div className="flex gap-1">
                                        <div className="w-1 h-1 rounded-full bg-border" />
                                        <div className="w-1 h-1 rounded-full bg-border" />
                                        <div className="w-1 h-1 rounded-full bg-border" />
                                    </div>
                                </div>

                                <ScrollArea className="w-full">
                                    <div className="flex gap-6 px-8 pb-6">
                                        {items.map((item, idx) => {
                                            const hasPendingRequest = pendingRequestsForThisSession.some(r => r.itemId === item.id);
                                            return (
                                                <motion.div
                                                    key={item.id}
                                                    initial={{ opacity: 0, x: 20 }}
                                                    animate={{ opacity: 1, x: 0 }}
                                                    transition={{ delay: (catIdx * 0.1) + (idx * 0.05) }}
                                                >
                                                    <RefreshmentCard 
                                                        item={item} 
                                                        qty={quantities[item.id] || 1}
                                                        onQtyChange={(delta) => {
                                                            const current = quantities[item.id] || 1;
                                                            setQuantities(p => ({...p, [item.id]: Math.max(1, Math.min(safeNumber(item.totalStock), current + delta))}));
                                                        }}
                                                        onRequest={() => handleRequest(item)}
                                                        isRequesting={isRequesting}
                                                        hasPendingRequest={hasPendingRequest} 
                                                        isMember={isMember}
                                                        activeMembership={activeMembership}
                                                        remainingPerkUses={getRemainingPerkUses(item.id)}
                                                    />
                                                </motion.div>
                                            )
                                        })}
                                    </div>
                                    <ScrollBar orientation="horizontal" className="hidden" />
                                </ScrollArea>
                            </section>
                        );
                    })}
                </div>

                <div className="p-8 bg-muted/5 border-t-2 border-dashed border-border/50 space-y-8">
                    {tenant?.wifiNetwork && (
                        <div className="p-6 rounded-[2rem] border-2 bg-white shadow-xl flex items-center justify-between gap-6">
                            <div className="flex items-center gap-4 text-left">
                                <div className="p-3 bg-primary/10 rounded-2xl text-primary shadow-inner shrink-0">
                                    <Wifi className="w-6 h-6" />
                                </div>
                                <div className="text-left">
                                    <p className="text-[10px] font-black text-muted-foreground uppercase tracking-widest opacity-40">Private WiFi</p>
                                    <p className="font-black text-sm uppercase tracking-tight text-slate-900">{tenant.wifiNetwork}</p>
                                </div>
                            </div>
                            <div className="text-right shrink-0">
                                <Badge variant="outline" className="font-mono font-black text-xs h-10 px-4 border-2 shadow-sm rounded-xl select-all">{tenant.wifiPassword}</Badge>
                            </div>
                        </div>
                    )}
                    <div className="pt-4 text-center">
                        <Button asChild variant="outline" className="w-full h-14 rounded-2xl border-2 font-black uppercase text-[10px] tracking-widest bg-white shadow-sm">
                            <Link href={`/portal/${tenant?.id}/${client?.id}`}>
                                <LayoutDashboard className="w-4 h-4 mr-2 opacity-40" />
                                Access Main Studio Portal
                            </Link>
                        </Button>
                    </div>
                </div>
            </CardContent>
        </ViewContainer>
    );
};

export default function CheckInPage() {
    const params = useParams();
    const token = params.token as string;
    const { toast } = useToast();
    const { firestore } = useFirebase();

    const appointmentCheckInRef = useMemoFirebase(() => !firestore || !token ? null : doc(firestore, 'appointmentCheckIns', token), [firestore, token]);
    const { data: appointmentData, isLoading: appointmentLoading } = useDoc<Appointment>(appointmentCheckInRef);

    const tenantId = appointmentData?.tenantId;
    const clientId = appointmentData?.clientId;

    const tenantDocRef = useMemoFirebase(() => !firestore || !tenantId ? null : doc(firestore, `tenants/${tenantId}`), [firestore, tenantId]);
    const { data: tenant, isLoading: tenantLoading } = useDoc<Tenant>(tenantDocRef);
    
    const inventoryQuery = useMemoFirebase(() => !firestore || !tenantId ? null : collection(firestore, `tenants/${tenantId}/inventory`), [firestore, tenantId]);
    const { data: inventory } = useCollection<InventoryItem>(inventoryQuery);

    const membershipsQuery = useMemoFirebase(() => !firestore || !tenantId ? null : collection(firestore, `tenants/${tenantId}/memberships`), [firestore, tenantId]);
    const { data: memberships } = useCollection<Membership>(membershipsQuery);

    const resourcesQuery = useMemoFirebase(() => !firestore || !tenantId ? null : collection(firestore, `tenants/${tenantId}/resources`), [firestore, tenantId]);
    const { data: resources } = useCollection<Resource>(resourcesQuery);

    const allClientRequestsQuery = useMemoFirebase(() => {
        if (!firestore || !tenantId || !clientId) return null;
        return query(
            collection(firestore, `tenants/${tenantId}/refreshmentRequests`),
            where('clientId', '==', clientId)
        );
    }, [firestore, tenantId, clientId]);
    const { data: clientRequests } = useCollection(allClientRequestsQuery);

    const clientDocRef = useMemoFirebase(() => !firestore || !tenantId || !clientId ? null : doc(firestore, `tenants/${tenantId}/clients`, clientId), [firestore, tenantId, clientId]);
    const { data: client, isLoading: clientLoading } = useDoc<Client>(clientDocRef);
    
    const serviceDocRef = useMemoFirebase(() => !firestore || !tenantId || !appointmentData?.serviceId ? null : doc(firestore, `tenants/${tenantId}/services`, appointmentData.serviceId), [firestore, tenantId, appointmentData?.serviceId]);
    const { data: service, isLoading: serviceLoading } = useDoc<Service>(serviceDocRef);
    
    const staffDocRef = useMemoFirebase(() => !firestore || !tenantId || !appointmentData?.staffId ? null : doc(firestore, `tenants/${tenantId}/staff`, appointmentData.staffId), [firestore, tenantId, appointmentData?.staffId]);
    const { data: assignedStaff, isLoading: staffLoading } = useDoc<Staff>(staffDocRef);

    const updateStatus = async (status: string, lateMinutes?: number) => {
        if (!firestore || !token || !appointmentData) return;
        const updateRef = doc(firestore, 'appointmentCheckIns', token);
        const updates: any = { checkInStatus: status };
        if (lateMinutes !== undefined) updates.lateTimeMinutes = lateMinutes;
        
        try {
            await updateDocumentNonBlocking(updateRef, updates);
            toast({ title: "Status Updated", description: "The studio has been notified." });
        } catch (e) {
            toast({ variant: 'destructive', title: "Update Failed" });
        }
    };

    if (appointmentLoading || clientLoading || serviceLoading || tenantLoading || staffLoading) {
        return (
            <div className="min-h-screen w-full flex flex-col items-center justify-center p-4 bg-muted/40 text-center text-left">
                <Loader className="h-10 w-10 animate-spin text-primary" />
                <p className="text-[10px] font-black uppercase tracking-widest opacity-60 mt-4">Initializing Portal...</p>
            </div>
        );
    }

    if (!appointmentData) {
        return (
            <ViewContainer>
                <div className="p-12 text-center space-y-6">
                    <XCircle className="w-16 h-16 text-destructive mx-auto opacity-40" />
                    <div className="space-y-2">
                        <h2 className="text-2xl font-black uppercase tracking-tighter">Record Expired</h2>
                        <p className="text-sm font-medium text-slate-500 uppercase tracking-tight leading-relaxed">
                            This check-in link is no longer valid or could not be found in our manifest.
                        </p>
                    </div>
                    <Button asChild className="w-full h-14 rounded-2xl font-black uppercase tracking-widest text-[10px]">
                        <Link href="/">Return to Registry</Link>
                    </Button>
                </div>
            </ViewContainer>
        );
    }

    if (appointmentData?.status === 'completed') {
        return (
            <CompletedView 
                tenant={tenant || null} 
                client={client || null} 
                appointment={appointmentData} 
                service={service || null}
                staff={assignedStaff || null}
            />
        );
    }

    if (appointmentData?.status === 'cancelled') {
        return (
            <CancelledView reason={appointmentData.cancellationReason} />
        );
    }
    
    if (appointmentData?.status === 'servicing') {
        return (
            <ServicingView 
                tenant={tenant || null} 
                client={client || null} 
                inventory={inventory || []} 
                activeRequests={clientRequests || []}
                appointment={appointmentData}
                staff={assignedStaff || null}
                resources={resources || []}
                memberships={memberships || []}
            />
        );
    }

    if (appointmentData?.checkInStatus === 'arrived') {
        return (
            <ArrivedView client={client || null} staff={assignedStaff || null} tenantId={tenantId} />
        );
    }
    
    return (
        <ViewContainer>
            <ViewHeader title="Portal Ready" subtitle="Manage your session" icon={Fingerprint} />
            <CardContent className="p-8 text-center space-y-8">
                <div className="p-8 rounded-[3rem] bg-primary/5 border-2 border-primary/10 shadow-inner space-y-6">
                    <CalendarIcon className="w-12 h-12 text-primary mx-auto opacity-40" />
                    <div className="space-y-1">
                        <p className="text-[10px] font-black uppercase text-primary tracking-widest">Current Booking</p>
                        <h3 className="text-xl font-black uppercase text-slate-900">{service?.name}</h3>
                        <p className="text-xs font-bold text-muted-foreground uppercase">{format(safeDate(appointmentData?.startTime), 'EEEE, MMM d @ h:mm a')}</p>
                    </div>
                </div>

                <div className="space-y-6">
                    <p className="text-sm font-medium text-slate-500 leading-relaxed px-4">Welcome, <strong>{client?.name}</strong>! Your session is scheduled for today. Please certify your arrival status below.</p>
                    
                    <div className="grid gap-3">
                        <Button 
                            onClick={() => updateStatus('arrived')} 
                            className="w-full h-16 rounded-[2rem] text-lg font-black uppercase tracking-tight shadow-3xl shadow-primary/30 group"
                        >
                            I Have Arrived <ArrowRight className="ml-2 w-5 h-5 transition-transform group-hover:translate-x-1" />
                        </Button>
                        <div className="grid grid-cols-2 gap-3">
                            <Button 
                                variant="outline" 
                                onClick={() => updateStatus('on_my_way')} 
                                className="h-14 rounded-2xl border-2 font-black uppercase text-[10px] tracking-widest bg-white shadow-sm"
                            >
                                <Car className="w-4 h-4 mr-2 text-primary" /> En Route
                            </Button>
                            <Button 
                                variant="outline" 
                                onClick={() => updateStatus('running_late', 15)} 
                                className="h-14 rounded-2xl border-2 font-black uppercase text-[10px] tracking-widest bg-white shadow-sm"
                            >
                                <AlertTriangle className="w-4 h-4 mr-2 text-amber-500" /> Late
                            </Button>
                        </div>
                    </div>

                    {assignedStaff && (
                        <div className="flex items-center gap-4 p-4 rounded-2xl border-2 bg-muted/5 shadow-inner text-left">
                            <Avatar className="h-12 h-12 border-2 border-background shadow-xl rounded-[1.5rem] shrink-0">
                                <AvatarImage src={assignedStaff.avatarUrl} className="object-cover" />
                                <AvatarFallback className="font-black text-xs bg-primary/10 text-primary">{(assignedStaff.name || 'S').charAt(0)}</AvatarFallback>
                            </Avatar>
                            <div className="text-left flex-1 min-w-0">
                                <p className="text-[9px] font-black uppercase text-muted-foreground opacity-60 leading-none mb-1">Your Professional</p>
                                <p className="font-black text-sm uppercase text-slate-800 leading-none truncate">{assignedStaff.name}</p>
                            </div>
                        </div>
                    )}
                </div>
                
                <div className="pt-6 border-t border-dashed">
                    <Button asChild variant="outline" className="w-full h-14 rounded-2xl border-2 font-black uppercase text-[10px] tracking-widest bg-white shadow-sm">
                        <Link href={`/portal/${tenantId}/${clientId}`}>
                            <LayoutDashboard className="w-4 h-4 mr-2 opacity-40" />
                            Access Main Studio Portal
                        </Link>
                    </Button>
                </div>
            </CardContent>
        </ViewContainer>
    );
}