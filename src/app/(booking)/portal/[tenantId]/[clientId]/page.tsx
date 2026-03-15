'use client';

import React, { useMemo } from 'react';
import { useParams } from 'next/navigation';
import { useFirebase, useDoc, useCollection, useMemoFirebase } from '@/firebase';
import { doc, collection, query, where } from 'firebase/firestore';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { format, parseISO, subMonths, isAfter } from 'date-fns';
import { Award, Repeat, Calendar, DollarSign, Gift, Loader, Clock, User, Heart, Star, CheckCircle, Percent, TicketIcon, History, AlertTriangle, Zap } from 'lucide-react';
import { type Client, type Appointment, type Service, type Membership, type Package, type Tenant, type Redemption } from '@/lib/data';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

export default function ClientPortalPage() {
    const { tenantId, clientId } = useParams() as { tenantId: string; clientId: string };
    const { firestore } = useFirebase();

    const clientRef = useMemoFirebase(() => doc(firestore, `tenants/${tenantId}/clients/${clientId}`), [firestore, tenantId, clientId]);
    const { data: client, isLoading: clientLoading } = useDoc<Client>(clientRef);

    const tenantRef = useMemoFirebase(() => doc(firestore, `tenants/${tenantId}`), [firestore, tenantId]);
    const { data: tenant } = useDoc<Tenant>(tenantRef);

    const appointmentsQuery = useMemoFirebase(() => query(collection(firestore, `tenants/${tenantId}/appointments`), where('clientId', '==', clientId)), [firestore, tenantId, clientId]);
    const { data: appointments, isLoading: appointmentsLoading } = useCollection<Appointment>(appointmentsQuery);

    const redemptionsQuery = useMemoFirebase(() => collection(firestore, `tenants/${tenantId}/clients/${clientId}/redemptions`), [firestore, tenantId, clientId]);
    const { data: redemptions, isLoading: redemptionsLoading } = useCollection<Redemption>(redemptionsQuery);

    const servicesQuery = useMemoFirebase(() => collection(firestore, `tenants/${tenantId}/services`), [firestore, tenantId]);
    const { data: services } = useCollection<Service>(servicesQuery);

    const membershipsQuery = useMemoFirebase(() => collection(firestore, `tenants/${tenantId}/memberships`), [firestore, tenantId]);
    const { data: memberships } = useCollection<Membership>(membershipsQuery);

    const packagesQuery = useMemoFirebase(() => collection(firestore, `tenants/${tenantId}/packages`), [firestore, tenantId]);
    const { data: packages } = useCollection<Package>(packagesQuery);

    const upcomingAppointments = useMemo(() => {
        if (!appointments) return [];
        return appointments
            .filter(a => a.status !== 'cancelled' && new Date(a.startTime) > new Date())
            .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
    }, [appointments]);

    const pastAppointments = useMemo(() => {
        if (!appointments) return [];
        return appointments
            .filter(a => a.status === 'completed' || new Date(a.startTime) <= new Date())
            .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
    }, [appointments]);

    const activeMembership = useMemo(() => {
        const mId = client?.subscription?.membershipId || client?.activeMembershipId;
        if (!mId || !memberships) return null;
        return memberships.find(m => m.id === mId);
    }, [client, memberships]);

    const isPerkUsedInCycle = (perkId: string) => {
        if (!client?.subscription?.nextBillingDate || !client.subscription.perkLastUsed) return false;
        
        const lastUsed = parseISO(client.subscription.perkLastUsed);
        const nextBilling = parseISO(client.subscription.nextBillingDate);
        const cycleStart = subMonths(nextBilling, 1);

        const isCurrentCycle = isAfter(lastUsed, cycleStart);
        if (!isCurrentCycle) return false;

        if (perkId === 'any') return true;

        const usageCount = client.subscription.perkUsage?.[perkId] || 0;
        const perkDef = activeMembership?.includedServices?.find(s => s.id === perkId) || 
                        activeMembership?.includedAddOns?.find(a => a.id === perkId);
        
        return usageCount >= (perkDef?.quantity || 1);
    };

    if (clientLoading || appointmentsLoading || redemptionsLoading) {
        return (
            <div className="flex h-screen w-full items-center justify-center">
                <Loader className="animate-spin" />
            </div>
        );
    }

    if (!client) return <div>Account not found.</div>;

    return (
        <div className="space-y-8 pb-20">
            <header className="flex flex-col md:flex-row items-center gap-6">
                <div className="relative">
                    <Avatar className="w-24 h-24 border-4 border-background shadow-lg">
                        <AvatarImage src={client.avatarUrl} />
                        <AvatarFallback>{client.name.substring(0, 2).toUpperCase()}</AvatarFallback>
                    </Avatar>
                    {activeMembership && (
                        <Badge className="absolute -top-2 -right-2 bg-indigo-600 text-white border-2 border-background shadow-md">
                            <Award className="w-3 h-3 mr-1" /> Member
                        </Badge>
                    )}
                </div>
                <div className="text-center md:text-left space-y-1">
                    <h1 className="text-3xl font-bold tracking-tight">Hello, {client.name.split(' ')[0]}!</h1>
                    <p className="text-muted-foreground">Manage your information and view your benefits at {tenant?.name}.</p>
                </div>
                <div className="md:ml-auto">
                    <Button asChild variant="outline">
                        <Link href={`/book/${tenantId}`}>Book New Appointment</Link>
                    </Button>
                </div>
            </header>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <Card className="bg-primary/5 border-primary/20 overflow-hidden">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium flex items-center gap-2"><Award className="w-4 h-4 text-primary" /> Membership</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        {activeMembership ? (
                            <>
                                <div className="space-y-1">
                                    <p className="text-xl font-bold">{activeMembership.name}</p>
                                    {client.subscription && (
                                        <Badge variant={client.subscription.status === 'active' ? 'default' : 'destructive'} className="capitalize">
                                            {client.subscription.status}
                                        </Badge>
                                    )}
                                </div>
                                <div className="pt-2 border-t space-y-2">
                                    <p className="text-[10px] uppercase font-bold text-muted-foreground">Monthly Perks Allotment</p>
                                    <div className="space-y-1">
                                        {activeMembership.includedServices?.map(perk => {
                                            const used = client.subscription?.perkUsage?.[perk.id] || 0;
                                            const isRedeemed = isPerkUsedInCycle(perk.id);
                                            return (
                                                <div key={perk.id} className="flex justify-between items-center text-xs">
                                                    <span className="flex items-center gap-1.5">
                                                        {isRedeemed ? <CheckCircle className="w-3 h-3 text-green-500" /> : <Star className="w-3 h-3 text-indigo-400" />}
                                                        {perk.name}
                                                    </span>
                                                    <span>{used} / {perk.quantity}</span>
                                                </div>
                                            )
                                        })}
                                        {activeMembership.includedAddOns?.map(perk => {
                                            const used = client.subscription?.perkUsage?.[perk.id] || 0;
                                            const isRedeemed = isPerkUsedInCycle(perk.id);
                                            return (
                                                <div key={perk.id} className="flex justify-between items-center text-xs">
                                                    <span className="flex items-center gap-1.5">
                                                        {isRedeemed ? <CheckCircle className="w-3 h-3 text-green-500" /> : <Zap className="w-3 h-3 text-amber-400" />}
                                                        {perk.name}
                                                    </span>
                                                    <span>{used} / {perk.quantity}</span>
                                                </div>
                                            )
                                        })}
                                    </div>
                                </div>
                                <p className="text-[10px] text-muted-foreground pt-1">Next billing: {client.subscription?.nextBillingDate ? format(parseISO(client.subscription.nextBillingDate), 'MMM d, yyyy') : 'N/A'}</p>
                            </>
                        ) : (
                            <p className="text-sm text-muted-foreground">No active membership.</p>
                        )}
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium flex items-center gap-2"><DollarSign className="w-4 h-4 text-green-500" /> Wallet Credit</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <p className="text-3xl font-bold">${(client.walletCredit || 0).toFixed(2)}</p>
                        <p className="text-xs text-muted-foreground">Available store credit.</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium flex items-center gap-2"><Gift className="w-4 h-4 text-purple-500" /> Refer & Earn</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <p className="text-lg font-bold font-mono bg-muted p-2 rounded text-center">{client.referralCode || 'N/A'}</p>
                        <p className="text-[10px] text-muted-foreground mt-2 text-center">Share this code to earn rewards!</p>
                    </CardContent>
                </Card>
            </div>

            <Tabs defaultValue="appointments">
                <TabsList className="w-full justify-start border-b rounded-none bg-transparent h-auto p-0 mb-6">
                    <TabsTrigger value="appointments" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-6 py-3 h-auto">Appointments</TabsTrigger>
                    <TabsTrigger value="history" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-6 py-3 h-auto">Usage Log</TabsTrigger>
                    <TabsTrigger value="benefits" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-6 py-3 h-auto">Benefits & Perks</TabsTrigger>
                    <TabsTrigger value="profile" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-6 py-3 h-auto">My Information</TabsTrigger>
                </TabsList>

                <TabsContent value="appointments" className="space-y-6">
                    <div>
                        <h3 className="text-lg font-bold mb-4">Upcoming Visits</h3>
                        {upcomingAppointments.length > 0 ? (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                {upcomingAppointments.map(apt => {
                                    const service = services?.find(s => s.id === apt.serviceId);
                                    return (
                                        <Card key={apt.id}>
                                            <CardContent className="p-4 flex items-center gap-4">
                                                <div className="bg-primary/10 p-3 rounded-lg text-primary">
                                                    <Calendar className="w-6 h-6" />
                                                </div>
                                                <div className="text-left">
                                                    <p className="font-bold">{service?.name || 'Service'}</p>
                                                    <p className="text-sm text-muted-foreground">{format(new Date(apt.startTime), 'EEEE, MMM d @ h:mm a')}</p>
                                                </div>
                                            </CardContent>
                                        </Card>
                                    );
                                })}
                            </div>
                        ) : (
                            <Card className="border-dashed bg-transparent"><CardContent className="py-10 text-center text-muted-foreground">No upcoming appointments.</CardContent></Card>
                        )}
                    </div>

                    <div>
                        <h3 className="text-lg font-bold mb-4">Past Visits</h3>
                        <div className="space-y-2">
                            {pastAppointments.map(apt => {
                                const service = services?.find(s => s.id === apt.serviceId);
                                return (
                                    <div key={apt.id} className="flex justify-between items-center p-3 border rounded-lg bg-muted/30">
                                        <div className="text-left">
                                            <p className="font-semibold text-sm">{service?.name}</p>
                                            <p className="text-xs text-muted-foreground">{format(new Date(apt.startTime), 'MMM d, yyyy')}</p>
                                        </div>
                                        <Badge variant="secondary" className="capitalize">{apt.status}</Badge>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </TabsContent>

                <TabsContent value="history" className="space-y-6">
                    <div>
                        <h3 className="text-lg font-bold mb-4">Perk & Session Usage</h3>
                        <p className="text-sm text-muted-foreground mb-6">A complete history of your non-monetary redemptions and policy adjustments.</p>
                        {redemptions && redemptions.length > 0 ? (
                            <div className="grid gap-3">
                                {redemptions.sort((a,b) => parseISO(b.date).getTime() - parseISO(a.date).getTime()).map(r => (
                                    <div key={r.id} className={cn("flex items-center justify-between p-4 border rounded-xl bg-card shadow-sm hover:border-primary/20 transition-all text-left", r.isForfeit && "border-destructive/20 bg-destructive/[0.01]")}>
                                        <div className="flex items-center gap-4">
                                            <div className={cn("p-2 rounded-lg", r.isForfeit ? "bg-destructive/10 text-destructive" : r.type === 'membership' ? "bg-indigo-500/10 text-indigo-600" : "bg-teal-500/10 text-teal-600")}>
                                                {r.isForfeit ? <AlertTriangle className="w-5 h-5" /> : r.type === 'membership' ? <Award className="w-5 h-5" /> : <Repeat className="w-5 h-5" />}
                                            </div>
                                            <div>
                                                <p className="font-bold text-sm">{r.serviceName}</p>
                                                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Applied to {r.offeringName}</p>
                                            </div>
                                        </div>
                                        <div className="text-right">
                                            <p className="font-mono font-bold text-xs">{format(parseISO(r.date), 'MMM d, yyyy')}</p>
                                            <Badge variant={r.isForfeit ? "destructive" : "outline"} className="text-[10px] mt-1 uppercase font-black border-none shadow-sm">
                                                {r.isForfeit ? "Forfeited" : "Verified"}
                                            </Badge>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="text-center py-20 border-2 border-dashed rounded-2xl opacity-40">
                                <History className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
                                <p className="text-sm font-bold uppercase tracking-widest">No usage history found</p>
                            </div>
                        )}
                    </div>
                </TabsContent>

                <TabsContent value="benefits" className="space-y-6">
                    {client.activePackages && client.activePackages.length > 0 && (
                        <div>
                            <h3 className="text-lg font-bold mb-4">Your Service Packages</h3>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                {client.activePackages.map((pack, idx) => {
                                    const details = packages?.find(p => p.id === pack.packageId);
                                    const service = services?.find(s => s.id === details?.serviceId);
                                    return (
                                        <Card key={idx}>
                                            <CardHeader className="pb-2">
                                                <CardTitle className="text-base">{details?.name}</CardTitle>
                                                <CardDescription>Sessions for {service?.name}</CardDescription>
                                            </CardHeader>
                                            <CardContent>
                                                <div className="flex justify-between items-end">
                                                    <div className="text-left">
                                                        <p className="text-3xl font-bold">{pack.sessionsRemaining}</p>
                                                        <p className="text-xs text-muted-foreground">Left of {details?.sessions}</p>
                                                    </div>
                                                    <Repeat className="w-8 h-8 text-teal-500/20" />
                                                </div>
                                            </CardContent>
                                        </Card>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {activeMembership && (
                        <div>
                            <h3 className="text-lg font-bold mb-4">Membership Inclusions</h3>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                {(activeMembership.includedServices || []).map(s => {
                                    const used = client.subscription?.perkUsage?.[s.id] || 0;
                                    const isRedeemed = isPerkUsedInCycle(s.id);
                                    return (
                                        <Card key={s.id} className="bg-indigo-500/5 border-indigo-500/10">
                                            <CardContent className="p-4 flex justify-between items-center">
                                                <div className="flex items-center gap-3">
                                                    <div className={cn("p-2 rounded-full", isRedeemed ? "bg-green-500/10 text-green-600" : "bg-indigo-500/10 text-indigo-600")}>
                                                        {isRedeemed ? <CheckCircle className="w-5 h-5" /> : <Star className="w-5 h-5" />}
                                                    </div>
                                                    <div className="text-left">
                                                        <p className="font-bold text-sm">{s.quantity}x {s.name}</p>
                                                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Per Month &middot; {used} used</p>
                                                    </div>
                                                </div>
                                                <div className="text-right">
                                                    {isRedeemed ? (
                                                        <Badge variant="outline" className="text-[10px] bg-green-50 text-green-700">Redeemed</Badge>
                                                    ) : (
                                                        <Badge variant="default" className="text-[10px] bg-indigo-600">Available</Badge>
                                                    )}
                                                </div>
                                            </CardContent>
                                        </Card>
                                    )
                                })}
                                {(activeMembership.includedAddOns || []).map(s => {
                                    const used = client.subscription?.perkUsage?.[s.id] || 0;
                                    const isRedeemed = isPerkUsedInCycle(s.id);
                                    return (
                                        <Card key={s.id} className="bg-amber-500/5 border-amber-500/10">
                                            <CardContent className="p-4 flex justify-between items-center">
                                                <div className="flex items-center gap-3">
                                                    <div className={cn("p-2 rounded-full", isRedeemed ? "bg-green-500/10 text-green-600" : "bg-amber-500/10 text-amber-600")}>
                                                        {isRedeemed ? <CheckCircle className="w-5 h-5" /> : <Zap className="w-5 h-5" />}
                                                    </div>
                                                    <div className="text-left">
                                                        <p className="font-bold text-sm">{s.quantity}x {s.name}</p>
                                                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Per Month &middot; {used} used</p>
                                                    </div>
                                                </div>
                                                <div className="text-right">
                                                    {isRedeemed ? (
                                                        <Badge variant="outline" className="text-[10px] bg-green-50 text-green-700">Redeemed</Badge>
                                                    ) : (
                                                        <Badge variant="default" className="text-[10px] bg-amber-600 border-none">Available</Badge>
                                                    )}
                                                </div>
                                            </CardContent>
                                        </Card>
                                    )
                                })}
                                {activeMembership.retailDiscount && (
                                    <Card className="bg-indigo-500/5 border-indigo-500/10">
                                        <CardContent className="p-4 flex items-center gap-3">
                                            <div className="p-2 rounded-full bg-indigo-500/10 text-indigo-600">
                                                <Percent className="w-5 h-5" />
                                            </div>
                                            <div className="text-left">
                                                <p className="font-bold text-sm">{activeMembership.retailDiscount}% Off Priority Retail</p>
                                                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Always Active</p>
                                            </div>
                                        </CardContent>
                                    </Card>
                                )}
                            </div>
                        </div>
                    )}
                </TabsContent>

                <TabsContent value="profile" className="max-w-xl">
                    <Card>
                        <CardHeader><CardTitle>Your Profile</CardTitle></CardHeader>
                        <CardContent className="space-y-4">
                            <div className="grid grid-cols-2 gap-4 text-left">
                                <div className="space-y-1"><Label className="text-xs text-muted-foreground">Name</Label><p className="font-medium">{client.name}</p></div>
                                <div className="space-y-1"><Label className="text-xs text-muted-foreground">Email</Label><p className="font-medium">{client.email}</p></div>
                                <div className="space-y-1"><Label className="text-xs text-muted-foreground">Phone</Label><p className="font-medium">{client.phone ? formatPhoneNumber(client.phone) : 'N/A'}</p></div>
                                <div className="space-y-1"><Label className="text-xs text-muted-foreground">Member Since</Label><p className="font-medium">{pastAppointments.length > 0 ? format(safeDateWrapper(pastAppointments[pastAppointments.length-1].startTime), 'MMMM yyyy') : 'New Guest'}</p></div>
                            </div>
                            <Separator />
                            <div className="space-y-2 text-sm text-muted-foreground text-left">
                                <p>To update your contact information or health notes, please let us know during your next visit.</p>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>
        </div>
    );
}

function formatPhoneNumber(phoneNumberString: string) {
  var cleaned = ('' + phoneNumberString).replace(/\D/g, '');
  var match = cleaned.match(/^(\d{3})(\d{3})(\d{4})$/);
  if (match) {
    return '(' + match[1] + ') ' + match[2] + '-' + match[3];
  }
  return phoneNumberString;
}

function safeDateWrapper(val: any): Date {
    if (!val) return new Date();
    if (val instanceof Date) return val;
    if (typeof val?.toDate === 'function') return val.toDate();
    if (typeof val === 'string') return parseISO(val);
    return new Date(val);
}
