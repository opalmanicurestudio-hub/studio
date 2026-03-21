'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
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
    DollarSign,
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
    Gamepad2
} from 'lucide-react';
import { format, parseISO, subMonths, isAfter } from 'date-fns';
import { type Appointment, type Client, type Service, type Tenant, type Staff, type InventoryItem, type Resource, type Membership } from '@/lib/data';
import { useFirebase, useCollection, useMemoFirebase, useDoc, setDocumentNonBlocking, updateDocumentNonBlocking } from '@/firebase';
import { collection, query, where, doc } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { cn, safeNumber } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import { nanoid } from 'nanoid';
import Image from 'next/image';
import Link from 'next/link';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';

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
        className="w-full max-w-2xl px-2 sm:px-0"
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
        <CardTitle className="text-2xl md:text-3xl font-black uppercase tracking-tighter text-slate-900 leading-none">{title}</CardTitle>
        <CardDescription className="text-[10px] font-bold uppercase tracking-widest opacity-60 mt-1">{subtitle}</CardDescription>
    </CardHeader>
);

const ArrivedView = ({ client, staff }: { client: Client | null, staff: Staff | null }) => (
    <ViewContainer>
        <ViewHeader title="Check-in Confirmed" subtitle="You are in the active queue" icon={CheckCircle2} />
        <CardContent className="p-8 text-center space-y-10">
            <div className="w-24 h-24 bg-green-500/10 rounded-[2.5rem] flex items-center justify-center mx-auto shadow-2xl shadow-green-500/5 rotate-6">
                <CheckCircle2 className="w-12 h-12 text-green-500 -rotate-6" />
            </div>
            <div className="space-y-3">
                <h3 className="text-2xl font-black uppercase tracking-tighter text-slate-900">We see you, {client?.name.split(' ')[0]}!</h3>
                <p className="text-sm font-medium text-slate-500 leading-relaxed uppercase tracking-tight max-w-xs mx-auto text-center">
                    Take a seat and relax. Your professional will be with you shortly to begin your session.
                </p>
            </div>

            {staff && (
                <div className="flex items-center gap-4 p-4 rounded-2xl border-2 bg-muted/5 shadow-inner text-left">
                    <Avatar className="h-12 w-12 border-2 border-background shadow-xl rounded-[1.5rem]">
                        <AvatarImage src={staff.avatarUrl} className="object-cover" />
                        <AvatarFallback className="font-black text-xs bg-primary/10 text-primary">{(staff.name || 'S').charAt(0)}</AvatarFallback>
                    </Avatar>
                    <div className="text-left">
                        <p className="text-[9px] font-black uppercase text-muted-foreground opacity-60 leading-none mb-1">Your Professional</p>
                        <p className="font-black text-sm uppercase text-slate-800 leading-none">{staff.name}</p>
                    </div>
                </div>
            )}

            <div className="p-4 rounded-xl border-2 border-dashed bg-primary/5 flex items-center justify-center gap-3 animate-pulse">
                <Loader className="w-4 h-4 text-primary animate-spin" />
                <span className="text-[10px] font-black uppercase text-primary tracking-widest">Awaiting Technician Signal</span>
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
    hasActiveRequest, 
    isMember, 
    activeMembership 
}: { 
    item: InventoryItem, 
    qty: number, 
    onQtyChange: (delta: number) => void, 
    onRequest: () => void, 
    isRequesting: boolean, 
    hasActiveRequest: boolean, 
    isMember: boolean,
    activeMembership: Membership | null
}) => {
    const isSoldOut = item.totalStock <= 0;
    const isIncludedPerk = !!activeMembership?.includedProducts?.some(p => p.id === item.id);

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
            className="shrink-0 w-64 md:w-72 h-full py-4"
        >
            <Card className={cn(
                "rounded-[2.5rem] border-2 transition-all h-full flex flex-col overflow-hidden bg-white shadow-lg",
                isSoldOut ? "opacity-40 grayscale" : "border-primary/5 hover:border-primary/30",
                isIncludedPerk && "border-indigo-500/20 ring-1 ring-indigo-500/10",
                item.isMembersOnly && "border-indigo-500/30"
            )}>
                <div className="relative aspect-square w-full bg-muted/20 flex items-center justify-center overflow-hidden border-b">
                    {item.imageUrl ? (
                        <Image src={item.imageUrl} alt={item.name} fill className="object-cover transition-transform duration-700 hover:scale-110" />
                    ) : (
                        <Icon className="w-16 h-16 text-primary opacity-20" />
                    )}
                    
                    <div className="absolute top-4 left-4 flex flex-col gap-2">
                        {item.isMembersOnly && (
                            <Badge className="bg-indigo-600 text-white border-none text-[8px] font-black uppercase tracking-[0.2em] h-6 px-3 shadow-xl">
                                <Award className="w-3 h-3 mr-1.5" /> Club Only
                            </Badge>
                        )}
                        {isIncludedPerk && (
                            <Badge className="bg-primary text-white border-none text-[8px] font-black uppercase tracking-[0.2em] h-6 px-3 shadow-xl">
                                <Star className="w-3 h-3 mr-1.5 fill-current" /> Perk
                            </Badge>
                        )}
                    </div>

                    <div className="absolute bottom-4 right-4">
                        <div className="bg-white/90 backdrop-blur-md rounded-2xl p-2 px-3 shadow-xl border border-white/50">
                            {isIncludedPerk ? (
                                <p className="text-[10px] font-black text-green-600 uppercase tracking-widest">Included</p>
                            ) : item.price && item.price > 0 ? (
                                <p className="text-sm font-black text-slate-900 font-mono tracking-tighter">${item.price.toFixed(2)}</p>
                            ) : (
                                <p className="text-[10px] font-black text-green-600 uppercase tracking-widest">Comp</p>
                            )}
                        </div>
                    </div>
                </div>

                <CardContent className="p-6 flex-1 flex flex-col justify-between space-y-4">
                    <div className="space-y-2 text-left">
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
                                <button onClick={() => onQtyChange(-1)} disabled={isSoldOut} className="p-1 hover:text-primary transition-colors disabled:opacity-20"><Minus className="w-4 h-4" /></button>
                                <span className="font-black font-mono text-base w-6 text-center">{qty}</span>
                                <button onClick={() => onQtyChange(1)} disabled={isSoldOut} className="p-1 hover:text-primary transition-colors disabled:opacity-20"><Plus className="w-4 h-4" /></button>
                            </div>
                            <Button 
                                size="sm" 
                                disabled={isRequesting || hasActiveRequest || isSoldOut}
                                onClick={onRequest}
                                className="h-10 px-6 rounded-xl font-black uppercase text-[10px] tracking-[0.2em] shadow-xl shadow-primary/20 transition-all active:scale-95"
                            >
                                {isSoldOut ? 'Void' : 'Order'}
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

    const refreshments = useMemo(() => 
        inventory.filter(item => 
            item.type === 'refreshment' && 
            item.showInConcierge !== false && 
            item.totalStock > 0 &&
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
        const totalSessionCount = activeRequests.reduce((sum, r) => sum + (r.quantity || 1), 0);
        const limit = tenant.complimentaryAmenityLimit || 0;

        if (limit > 0 && totalSessionCount + qty > limit) {
            toast({ variant: 'destructive', title: 'Limit Reached', description: `Complimentary limit is ${limit} items per session.` });
            return;
        }

        setIsRequesting(true);
        try {
            const requestId = nanoid();
            await setDocumentNonBlocking(doc(firestore, `tenants/${tenant.id}/refreshmentRequests`, requestId), {
                id: requestId, tenantId: tenant.id, appointmentId: appointment.id, clientId: client.id, clientName: client.name, itemId: item.id, itemName: item.name, quantity: qty, status: 'pending', requestedAt: new Date().toISOString(), stationName, staffName: staff?.name || 'Unassigned', priceAtRequest: item.price || 0
            }, {});
            toast({ title: "Request Dispatched" });
            setQuantities(prev => ({ ...prev, [item.id]: 1 }));
        } catch (e) {
            toast({ variant: 'destructive', title: "Request Failed" });
        } finally {
            setIsRequesting(false);
        }
    };

    const hasActiveRequest = activeRequests.some(r => r.status === 'pending');

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
                    {Object.entries(refreshmentsByCategory).map(([category, items], catIdx) => {
                        const isExclusive = category === 'Club Exclusive Selection';
                        const isComfort = category === 'Comfort & Environment';
                        
                        return (
                            <section key={category} className="space-y-6">
                                <div className="flex items-center justify-between px-8 text-left">
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
                                        {items.map((item, idx) => (
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
                                                        setQuantities(p => ({...p, [item.id]: Math.max(1, Math.min(item.totalStock, current + delta))}));
                                                    }}
                                                    onRequest={() => handleRequest(item)}
                                                    isRequesting={isRequesting}
                                                    hasActiveRequest={hasActiveRequest}
                                                    isMember={isMember}
                                                    activeMembership={activeMembership}
                                                />
                                            </motion.div>
                                        ))}
                                    </div>
                                    <ScrollBar orientation="horizontal" className="hidden" />
                                </ScrollArea>
                            </section>
                        );
                    })}
                </div>

                <div className="p-8 bg-muted/5 border-t-2 border-dashed border-border/50 space-y-8">
                    {tenant?.wifiNetwork && (
                        <div className="p-6 rounded-[2rem] border-2 bg-white shadow-xl flex items-center justify-between gap-6 text-left">
                            <div className="flex items-center gap-4">
                                <div className="p-3 bg-primary/10 rounded-2xl text-primary shadow-inner">
                                    <Wifi className="w-6 h-6" />
                                </div>
                                <div className="text-left">
                                    <p className="text-[10px] font-black text-muted-foreground uppercase tracking-widest opacity-40">Private WiFi</p>
                                    <p className="font-black text-sm uppercase tracking-tight text-slate-900">{tenant.wifiNetwork}</p>
                                </div>
                            </div>
                            <div className="text-right">
                                <Badge variant="outline" className="font-mono font-black text-xs h-10 px-4 border-2 shadow-sm rounded-xl select-all">{tenant.wifiPassword}</Badge>
                            </div>
                        </div>
                    )}

                    {hasActiveRequest && (
                        <div className="p-6 rounded-[2rem] border-4 border-primary/20 bg-primary/5 flex items-center justify-center gap-4 animate-pulse shadow-2xl">
                            <Loader className="w-6 h-6 text-primary animate-spin" />
                            <span className="text-[11px] font-black uppercase text-primary tracking-[0.2em]">Protocol Fulfillment Active</span>
                        </div>
                    )}
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
    const tenantDocRef = useMemoFirebase(() => !firestore || !tenantId ? null : doc(firestore, `tenants/${tenantId}`), [firestore, tenantId]);
    const { data: tenant, isLoading: tenantLoading } = useDoc<Tenant>(tenantDocRef);
    
    const inventoryQuery = useMemoFirebase(() => !firestore || !tenantId ? null : collection(firestore, `tenants/${tenantId}/inventory`), [firestore, tenantId]);
    const { data: inventory } = useCollection<InventoryItem>(inventoryQuery);

    const membershipsQuery = useMemoFirebase(() => !firestore || !tenantId ? null : collection(firestore, `tenants/${tenantId}/memberships`), [firestore, tenantId]);
    const { data: memberships } = useCollection<Membership>(membershipsQuery);

    const resourcesQuery = useMemoFirebase(() => !firestore || !tenantId ? null : collection(firestore, `tenants/${tenantId}/resources`), [firestore, tenantId]);
    const { data: resources } = useCollection<Resource>(resourcesQuery);

    const activeRequestsQuery = useMemoFirebase(() => {
        if (!firestore || !tenantId || !appointmentData?.id) return null;
        return query(
            collection(firestore, `tenants/${tenantId}/refreshmentRequests`),
            where('appointmentId', '==', appointmentData.id)
        );
    }, [firestore, tenantId, appointmentData?.id]);
    const { data: activeRequests } = useCollection(activeRequestsQuery);

    const clientDocRef = useMemoFirebase(() => !firestore || !tenantId || !appointmentData?.clientId ? null : doc(firestore, `tenants/${tenantId}/clients`, appointmentData.clientId), [firestore, tenantId, appointmentData?.clientId]);
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
            <div className="min-h-screen w-full flex flex-col items-center justify-center p-4 bg-muted/40">
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
                        <p className="text-sm font-medium text-slate-500 uppercase tracking-tight leading-relaxed text-center">
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
    
    if (appointmentData?.status === 'servicing') {
        return (
            <ServicingView 
                tenant={tenant || null} 
                client={client || null} 
                inventory={inventory || []} 
                activeRequests={activeRequests || []}
                appointment={appointmentData}
                staff={assignedStaff || null}
                resources={resources || []}
                memberships={memberships || []}
            />
        );
    }

    if (appointmentData?.checkInStatus === 'arrived') {
        return (
            <ArrivedView client={client || null} staff={assignedStaff || null} />
        );
    }
    
    return (
        <ViewContainer>
            <ViewHeader title="Portal Ready" subtitle="Manage your session" icon={Fingerprint} />
            <CardContent className="p-8 text-center space-y-8">
                <div className="p-8 rounded-[3rem] bg-primary/5 border-2 border-primary/10 shadow-inner space-y-6 text-center">
                    <CalendarIcon className="w-12 h-12 text-primary mx-auto opacity-40" />
                    <div className="space-y-1">
                        <p className="text-[10px] font-black uppercase text-primary tracking-widest">Current Booking</p>
                        <h3 className="text-xl font-black uppercase text-slate-900">{service?.name}</h3>
                        <p className="text-xs font-bold text-muted-foreground uppercase">{format(safeDate(appointmentData?.startTime), 'EEEE, MMM d @ h:mm a')}</p>
                    </div>
                </div>

                <div className="space-y-6 text-center">
                    <p className="text-sm font-medium text-slate-500 leading-relaxed px-4 text-center">Welcome, <strong>{client?.name}</strong>! Your session is scheduled for today. Please certifty your arrival status below.</p>
                    
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
                                className="h-14 rounded-2xl border-2 font-black uppercase text-[10px] tracking-widest bg-white"
                            >
                                <Car className="w-4 h-4 mr-2 text-primary" /> On My Way
                            </Button>
                            <Button 
                                variant="outline" 
                                onClick={() => updateStatus('running_late', 15)} 
                                className="h-14 rounded-2xl border-2 font-black uppercase text-[10px] tracking-widest bg-white"
                            >
                                <AlertTriangle className="w-4 h-4 mr-2 text-amber-500" /> Running Late
                            </Button>
                        </div>
                    </div>

                    {assignedStaff && (
                        <div className="flex items-center gap-4 p-4 rounded-2xl border-2 bg-muted/5 shadow-inner text-left">
                            <Avatar className="h-12 w-12 border-2 border-background shadow-xl rounded-[1.5rem]">
                                <AvatarImage src={assignedStaff.avatarUrl} className="object-cover" />
                                <AvatarFallback className="font-black text-xs bg-primary/10 text-primary">{(assignedStaff.name || 'S').charAt(0)}</AvatarFallback>
                            </Avatar>
                            <div className="text-left">
                                <p className="text-[9px] font-black uppercase text-muted-foreground opacity-60 leading-none mb-1">Your Professional</p>
                                <p className="font-black text-sm uppercase text-slate-800 leading-none">{assignedStaff.name}</p>
                            </div>
                        </div>
                    )}
                </div>
            </CardContent>
        </ViewContainer>
    );
}
