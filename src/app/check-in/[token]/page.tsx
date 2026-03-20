
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
    Lock
} from 'lucide-react';
import { format, parseISO, subMonths, isAfter } from 'date-fns';
import { type Appointment, type Client, type Service, type Tenant, type Staff, type InventoryItem, type Resource } from '@/lib/data';
import { useFirebase, useCollection, useMemoFirebase, useDoc, setDocumentNonBlocking, updateDocumentNonBlocking } from '@/firebase';
import { collection, query, where, doc } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { cn, safeNumber } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import { nanoid } from 'nanoid';
import Image from 'next/image';
import Link from 'next/link';

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
        className="w-full max-w-lg px-2 sm:px-0"
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

const ServicingView = ({ 
    tenant, 
    client, 
    inventory, 
    activeRequests, 
    appointment, 
    staff, 
    resources 
}: { 
    tenant: Tenant | null, 
    client: Client | null, 
    inventory: InventoryItem[], 
    activeRequests: any[],
    appointment: Appointment | null,
    staff: Staff | null,
    resources: Resource[]
}) => {
    const { firestore } = useFirebase();
    const { toast } = useToast();
    const [isRequesting, setIsRequesting] = useState(false);
    const [quantities, setQuantities] = useState<Record<string, number>>({});

    const isMember = client?.activeMembershipId && client?.subscription?.status === 'active';

    const refreshments = useMemo(() => 
        inventory.filter(item => 
            item.type === 'refreshment' && 
            item.showInConcierge !== false && 
            item.totalStock > 0
        )
    , [inventory]);

    const stationName = useMemo(() => {
        if (!appointment?.requiredResourceIds?.length || !resources) return 'Station';
        const res = resources.find(r => r.id === appointment.requiredResourceIds![0]);
        return res?.name || 'Station';
    }, [appointment, resources]);

    const handleQuantityChange = (itemId: string, delta: number, max: number) => {
        setQuantities(prev => {
            const current = prev[itemId] || 1;
            const next = Math.max(1, Math.min(max, current + delta));
            return { ...prev, [itemId]: next };
        });
    };

    const handleRequest = async (item: InventoryItem) => {
        if (!firestore || !tenant || !client || !appointment || isRequesting) return;
        
        const qty = quantities[item.id] || 1;
        const totalSessionCount = activeRequests.reduce((sum, r) => sum + (r.quantity || 1), 0);
        const limit = tenant.complimentaryAmenityLimit || 0;

        if (item.isMembersOnly && !isMember) {
            toast({ 
                variant: 'destructive', 
                title: 'Access Restricted', 
                description: 'This premium amenity is exclusive to studio members.' 
            });
            return;
        }

        if (limit > 0 && totalSessionCount + qty > limit) {
            toast({ 
                variant: 'destructive', 
                title: 'Limit Reached', 
                description: `Complimentary limit is ${limit} items per session.` 
            });
            return;
        }

        setIsRequesting(true);
        const requestId = nanoid();
        const requestRef = doc(firestore, `tenants/${tenant.id}/refreshmentRequests`, requestId);
        
        const payload = {
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
            stationName: stationName,
            staffName: staff?.name || 'Unassigned',
            priceAtRequest: item.price || 0
        };

        try {
            await setDocumentNonBlocking(requestRef, payload, {});
            
            const notificationRef = doc(collection(firestore, `tenants/${tenant.id}/notifications`));
            await setDocumentNonBlocking(notificationRef, {
                id: nanoid(),
                userId: 'all_staff',
                type: 'refreshment_request',
                message: `New request: ${qty}x ${item.name} for ${client.name} at ${stationName}`,
                link: '/dashboard',
                createdAt: new Date().toISOString(),
                read: false
            }, {});

            toast({ title: "Request Dispatched", description: "Your pro will be with you shortly." });
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
            <CardContent className="p-6 md:p-8 space-y-10 text-left">
                <div className="p-8 text-center space-y-6 bg-primary/5 rounded-[2.5rem] border-2 border-primary/10 shadow-inner text-left">
                    <div className="w-20 h-20 bg-white rounded-[2rem] flex items-center justify-center mx-auto shadow-xl border-2 border-primary/10 rotate-6">
                        <Activity className="w-10 h-10 text-primary -rotate-6" />
                    </div>
                    <div className="space-y-2 text-center">
                        <p className="font-black text-xl uppercase tracking-tight text-slate-900">Relax & Recharge</p>
                        <p className="text-xs font-medium text-slate-500 leading-relaxed max-w-xs mx-auto text-center uppercase tracking-tight">
                            Your transformation is in progress at <strong>{stationName}</strong>.
                        </p>
                    </div>
                </div>

                {tenant?.wifiNetwork && (
                    <div className="space-y-4 text-left">
                        <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1 flex items-center gap-2 text-left">
                            <Wifi className="w-3.5 h-3.5 opacity-40" /> Connectivity Hub
                        </p>
                        <div className="p-6 rounded-[2.5rem] border-2 border-primary/10 bg-white shadow-xl space-y-4">
                            <div className="flex justify-between items-center px-1 text-left">
                                <div className="space-y-0.5 text-left">
                                    <p className="text-[8px] font-black uppercase text-muted-foreground opacity-40">Network SSID</p>
                                    <p className="text-sm font-black uppercase tracking-tight">{tenant.wifiNetwork}</p>
                                </div>
                                <div className="space-y-0.5 text-right">
                                    <p className="text-[8px] font-black uppercase text-muted-foreground opacity-40">Access Key</p>
                                    <p className="text-sm font-black tracking-tight font-mono text-primary select-all">{tenant.wifiPassword}</p>
                                </div>
                            </div>
                            <Button variant="outline" className="w-full h-10 rounded-xl font-black uppercase tracking-widest text-[9px] border-2" onClick={() => {
                                navigator.clipboard.writeText(tenant.wifiPassword || '');
                                toast({ title: "Key Copied" });
                            }}>
                                Copy Password
                            </Button>
                        </div>
                    </div>
                )}

                {tenant?.refreshmentServiceEnabled && refreshments.length > 0 && (
                    <div className="space-y-6 text-left">
                        <div className="flex items-center justify-between px-1 text-left">
                            <p className="text-[10px] font-black uppercase tracking-widest text-primary flex items-center gap-2">
                                <Coffee className="w-3.5 h-3.5" /> Hospitality Menu
                            </p>
                            {tenant.complimentaryAmenityLimit ? (
                                <Badge variant="outline" className="h-5 px-2 border-primary/20 text-primary bg-primary/5 font-black text-[8px] uppercase">Limit: {tenant.complimentaryAmenityLimit} / session</Badge>
                            ) : null}
                        </div>
                        
                        <div className="space-y-4 text-left">
                            {refreshments.map(item => {
                                const qty = quantities[item.id] || 1;
                                const isSoldOut = item.totalStock <= 0;
                                const isLocked = item.isMembersOnly && !isMember;
                                
                                return (
                                    <Card key={item.id} className={cn(
                                        "rounded-[2rem] border-2 transition-all overflow-hidden text-left",
                                        isSoldOut ? "opacity-40 grayscale" : "bg-white border-primary/10 hover:border-primary/30 shadow-sm",
                                        isLocked && "border-indigo-500/20 bg-indigo-500/[0.02]"
                                    )}>
                                        <CardContent className="p-4 flex gap-4 items-center">
                                            <div className="relative w-24 h-24 rounded-2xl overflow-hidden bg-muted/20 shrink-0 flex items-center justify-center">
                                                {item.imageUrl ? (
                                                    <Image src={item.imageUrl} alt={item.name} fill className="object-cover" />
                                                ) : (
                                                    <Coffee className="w-10 h-10 text-primary opacity-20" />
                                                )}
                                                {isLocked && (
                                                    <div className="absolute inset-0 bg-indigo-900/40 backdrop-blur-[2px] flex items-center justify-center">
                                                        <Lock className="w-8 h-8 text-white" />
                                                    </div>
                                                )}
                                            </div>
                                            <div className="flex-1 min-w-0 text-left space-y-1">
                                                <div className="flex justify-between items-start">
                                                    <div className="flex flex-col gap-1 text-left">
                                                        <p className="font-black text-sm uppercase tracking-tight text-slate-900 truncate text-left">{item.name}</p>
                                                        {item.isMembersOnly && (
                                                            <Badge className="w-fit bg-indigo-600 text-white border-none text-[7px] h-4 px-1.5 font-black uppercase">Members Only</Badge>
                                                        )}
                                                    </div>
                                                    {item.price && item.price > 0 ? (
                                                        <span className="font-black font-mono text-[10px] text-primary">${item.price.toFixed(2)}</span>
                                                    ) : (
                                                        <span className="font-black text-[8px] text-green-600 uppercase bg-green-50 px-1.5 rounded">Comp</span>
                                                    )}
                                                </div>
                                                {item.description && (
                                                    <p className="text-[10px] font-medium text-slate-500 leading-relaxed tracking-tight italic opacity-80 text-left">
                                                        {item.description}
                                                    </p>
                                                )}
                                                
                                                <div className="flex items-center justify-between pt-3">
                                                    <div className={cn("flex items-center gap-3 bg-muted/30 rounded-xl px-2 h-8", isLocked && "opacity-20")}>
                                                        <button onClick={() => !isLocked && handleQuantityChange(item.id, -1, item.totalStock)} className="p-1 hover:text-primary transition-colors"><Minus className="w-3 h-3" /></button>
                                                        <span className="font-black font-mono text-xs w-4 text-center">{qty}</span>
                                                        <button onClick={() => !isLocked && handleQuantityChange(item.id, 1, item.totalStock)} className="p-1 hover:text-primary transition-colors"><Plus className="w-3 h-3" /></button>
                                                    </div>
                                                    {isLocked ? (
                                                        <Button 
                                                            size="sm" 
                                                            variant="outline"
                                                            className="h-8 rounded-xl font-black uppercase text-[9px] tracking-widest border-indigo-500/20 text-indigo-600 bg-indigo-500/5"
                                                        >
                                                            Join Club
                                                        </Button>
                                                    ) : (
                                                        <Button 
                                                            size="sm" 
                                                            disabled={isRequesting || hasActiveRequest || isSoldOut}
                                                            onClick={() => handleRequest(item)}
                                                            className="h-8 rounded-xl font-black uppercase text-[9px] tracking-widest shadow-lg shadow-primary/20"
                                                        >
                                                            {isSoldOut ? 'Sold Out' : 'Request'}
                                                        </Button>
                                                    )}
                                                </div>
                                            </div>
                                        </CardContent>
                                    </Card>
                                );
                            })}
                        </div>
                        
                        {hasActiveRequest && (
                            <div className="p-4 rounded-2xl border-2 border-dashed bg-primary/5 flex items-center justify-center gap-3 animate-pulse">
                                <Loader className="w-4 h-4 text-primary animate-spin" />
                                <span className="text-[10px] font-black uppercase text-primary tracking-widest">Protocol Fulfillment Underway</span>
                            </div>
                        )}
                    </div>
                )}
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
            <div className="min-h-screen w-full flex flex-col items-center justify-center p-4 bg-muted/40 text-left text-left">
                <Loader className="h-10 w-10 animate-spin text-primary" />
                <p className="text-[10px] font-black uppercase tracking-widest opacity-60 mt-4 text-left">Initializing Portal...</p>
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

                <div className="space-y-6 text-center text-left text-left">
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
