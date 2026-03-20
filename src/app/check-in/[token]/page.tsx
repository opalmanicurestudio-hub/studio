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
    DollarSign
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { type Appointment, type Client, type Service, type Tenant, type Staff, type InventoryItem, type Resource } from '@/lib/data';
import { useFirebase, useCollection, useMemoFirebase, useDoc, setDocumentNonBlocking, updateDocumentNonBlocking } from '@/firebase';
import { collection, query, where, doc } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';
import { nanoid } from 'nanoid';
import Image from 'next/image';

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

    const refreshments = useMemo(() => 
        inventory.filter(item => item.type === 'refreshment' && item.showInConcierge !== false && item.totalStock > 0)
    , [inventory]);

    const stationName = useMemo(() => {
        if (!appointment?.requiredResourceIds?.length || !resources) return 'Station';
        const res = resources.find(r => r.id === appointment.requiredResourceIds![0]);
        return res?.name || 'Station';
    }, [appointment, resources]);

    const handleRequest = async (item: InventoryItem) => {
        if (!firestore || !tenant || !client || isRequesting) return;
        
        setIsRequesting(true);
        const requestId = nanoid();
        const requestRef = doc(firestore, `tenants/${tenant.id}/refreshmentRequests`, requestId);
        
        const payload = {
            id: requestId,
            tenantId: tenant.id,
            clientId: client.id,
            clientName: client.name,
            itemId: item.id,
            itemName: item.name,
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
                message: `New request: ${item.name} for ${client.name} at ${stationName}`,
                link: '/dashboard',
                createdAt: new Date().toISOString(),
                read: false
            }, {});

            toast({ title: "Request Dispatched", description: "Your pro will be with you shortly." });
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
                <div className="p-8 text-center space-y-6 bg-primary/5 rounded-[2.5rem] border-2 border-primary/10 shadow-inner">
                    <div className="w-20 h-20 bg-white rounded-[2rem] flex items-center justify-center mx-auto shadow-xl border-2 border-primary/10 rotate-6">
                        <Activity className="w-10 h-10 text-primary -rotate-6" />
                    </div>
                    <div className="space-y-2 text-center">
                        <p className="font-black text-xl uppercase tracking-tight text-slate-900">Relax & Recharge</p>
                        <p className="text-xs font-medium text-slate-500 leading-relaxed max-w-xs mx-auto text-center uppercase tracking-tight">
                            Your transformation is in progress at <strong>{stationName}</strong>. We've optimized this window for your comfort.
                        </p>
                    </div>
                </div>

                {tenant?.wifiNetwork && (
                    <div className="space-y-4">
                        <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1 flex items-center gap-2">
                            <Wifi className="w-3.5 h-3.5 opacity-40" /> Connectivity Hub
                        </p>
                        <div className="p-6 rounded-[2.5rem] border-2 border-primary/10 bg-white shadow-xl space-y-4">
                            <div className="flex justify-between items-center px-1">
                                <div className="space-y-0.5">
                                    <p className="text-[8px] font-black uppercase text-muted-foreground opacity-40">Network SSID</p>
                                    <p className="text-sm font-black uppercase tracking-tight">{tenant.wifiNetwork}</p>
                                </div>
                                <div className="space-y-0.5 text-right">
                                    <p className="text-[8px] font-black uppercase text-muted-foreground opacity-40">Access Key</p>
                                    <p className="text-sm font-black tracking-tight font-mono text-primary select-all">{tenant.wifiPassword}</p>
                                </div>
                            </div>
                            <Button variant="outline" className="w-full h-10 rounded-xl font-black uppercase text-[9px] tracking-widest border-2" onClick={() => {
                                navigator.clipboard.writeText(tenant.wifiPassword || '');
                                toast({ title: "Key Copied" });
                            }}>
                                Copy Password
                            </Button>
                        </div>
                    </div>
                )}

                {tenant?.refreshmentServiceEnabled && refreshments.length > 0 && (
                    <div className="space-y-6">
                        <div className="flex items-center justify-between px-1">
                            <p className="text-[10px] font-black uppercase tracking-widest text-primary flex items-center gap-2">
                                <Coffee className="w-3.5 h-3.5" /> Hospitality Menu
                            </p>
                            {hasActiveRequest && <Badge className="bg-primary text-white border-none font-black text-[8px] uppercase animate-pulse">Request Pending</Badge>}
                        </div>
                        
                        <div className="grid grid-cols-2 gap-4">
                            {refreshments.map(item => (
                                <button 
                                    key={item.id}
                                    onClick={() => handleRequest(item)}
                                    disabled={isRequesting || hasActiveRequest}
                                    className={cn(
                                        "flex flex-col items-center justify-center p-4 rounded-[2rem] border-2 transition-all gap-3 shadow-sm relative overflow-hidden",
                                        hasActiveRequest ? "opacity-40 grayscale cursor-not-allowed border-dashed" : "bg-white border-primary/10 hover:border-primary/40 active:scale-95"
                                    )}
                                >
                                    <div className="w-full aspect-square bg-muted/20 rounded-2xl relative overflow-hidden flex items-center justify-center shadow-inner">
                                        {item.imageUrl ? (
                                            <Image src={item.imageUrl} alt={item.name} fill className="object-cover" />
                                        ) : (
                                            <Coffee className="w-8 h-8 text-primary opacity-20" />
                                        )}
                                        {item.price > 0 && (
                                            <div className="absolute top-2 right-2 bg-slate-900/80 backdrop-blur-md text-white text-[8px] font-black uppercase px-1.5 py-0.5 rounded shadow-lg">
                                                ${item.price.toFixed(2)}
                                            </div>
                                        )}
                                    </div>
                                    <span className="text-[9px] font-black uppercase tracking-tight text-slate-900 leading-tight text-center">{item.name}</span>
                                </button>
                            ))}
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
        if (!firestore || !tenantId || !appointmentData?.clientId) return null;
        return query(
            collection(firestore, `tenants/${tenantId}/refreshmentRequests`),
            where('clientId', '==', appointmentData.clientId),
            where('status', '==', 'pending')
        );
    }, [firestore, tenantId, appointmentData?.clientId]);
    const { data: activeRequests } = useCollection(activeRequestsQuery);

    const clientDocRef = useMemoFirebase(() => !firestore || !tenantId || !appointmentData?.clientId ? null : doc(firestore, `tenants/${tenantId}/clients`, appointmentData.clientId), [firestore, tenantId, appointmentData?.clientId]);
    const { data: client, isLoading: clientLoading } = useDoc<Client>(clientDocRef);
    
    const serviceDocRef = useMemoFirebase(() => !firestore || !tenantId || !appointmentData?.serviceId ? null : doc(firestore, `tenants/${tenantId}/services`, appointmentData.serviceId), [firestore, tenantId, appointmentData?.serviceId]);
    const { data: service, isLoading: serviceLoading } = useDoc<Service>(serviceDocRef);
    
    const staffDocRef = useMemoFirebase(() => !firestore || !tenantId || !appointmentData?.staffId ? null : doc(firestore, `tenants/${tenantId}/staff`, appointmentData.staffId), [firestore, tenantId, appointmentData?.staffId]);
    const { data: assignedStaff, isLoading: staffLoading } = useDoc<Staff>(staffDocRef);

    if (appointmentLoading || clientLoading || serviceLoading || tenantLoading || staffLoading) {
        return (
            <div className="min-h-screen w-full flex flex-col items-center justify-center p-4 bg-muted/40">
                <Loader className="h-10 w-10 animate-spin text-primary" />
                <p className="text-[10px] font-black uppercase tracking-widest opacity-60 mt-4">Initializing Portal...</p>
            </div>
        );
    }
    
    if (appointmentData?.status === 'servicing') {
        return (
            <ServicingView 
                tenant={tenant} 
                client={client} 
                inventory={inventory || []} 
                activeRequests={activeRequests || []}
                appointment={appointmentData}
                staff={assignedStaff}
                resources={resources || []}
            />
        );
    }
    
    return (
        <ViewContainer>
            <ViewHeader title="Portal Ready" subtitle="Manage your session" icon={Fingerprint} />
            <CardContent className="p-8 text-center space-y-6">
                <div className="p-10 rounded-[3rem] bg-primary/5 border-2 border-primary/10 shadow-inner space-y-6 text-center">
                    <CalendarIcon className="w-12 h-12 text-primary mx-auto opacity-40" />
                    <div className="space-y-1">
                        <p className="text-[10px] font-black uppercase text-primary tracking-widest">Current Booking</p>
                        <h3 className="text-xl font-black uppercase text-slate-900">{service?.name}</h3>
                        <p className="text-xs font-bold text-muted-foreground uppercase">{format(safeDate(appointmentData?.startTime), 'EEEE, MMM d @ h:mm a')}</p>
                    </div>
                </div>

                <div className="space-y-6 text-center">
                    <p className="text-sm font-medium text-slate-500 leading-relaxed px-4 text-center">Welcome, <strong>{client?.name}</strong>! Your session is scheduled for today. Please confirm your arrival below.</p>
                    
                    {assignedStaff && (
                        <div className="flex items-center gap-4 p-4 rounded-2xl border-2 bg-muted/5 shadow-inner text-left">
                            <Avatar className="h-12 w-12 border-2 border-background shadow-md rounded-xl">
                                <AvatarImage src={assignedStaff.avatarUrl} className="object-cover" />
                                <AvatarFallback className="font-black text-xs bg-primary/10 text-primary">{(assignedStaff.name || 'S').charAt(0)}</AvatarFallback>
                            </Avatar>
                            <div className="text-left">
                                <p className="text-[9px] font-black uppercase text-muted-foreground opacity-60 leading-none mb-1">Your Professional</p>
                                <p className="font-black text-sm uppercase text-slate-800 leading-none">{assignedStaff.name}</p>
                            </div>
                        </div>
                    )}

                    <Button 
                        onClick={() => {
                            if (!firestore || !token) return;
                            const updateRef = doc(firestore, 'appointmentCheckIns', token);
                            updateDocumentNonBlocking(updateRef, { checkInStatus: 'arrived' });
                            toast({ title: "Arrival Certified", description: "Your professional has been notified." });
                        }} 
                        className="w-full h-16 rounded-[2rem] text-lg font-black uppercase tracking-tight shadow-3xl shadow-primary/30 group"
                    >
                        I Have Arrived <ArrowRight className="ml-2 w-5 h-5 transition-transform group-hover:translate-x-1" />
                    </Button>
                </div>
            </CardContent>
        </ViewContainer>
    );
}
