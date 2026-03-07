
'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { AppHeader } from '@/components/shared/AppHeader';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button, buttonVariants } from '@/components/ui/button';
import { 
    ArrowLeft, 
    Edit, 
    Mail, 
    Phone, 
    DollarSign, 
    Calendar, 
    FileText, 
    FlaskConical, 
    PlusCircle, 
    ShieldPlus, 
    AlertTriangle, 
    Ear, 
    Upload, 
    Eye, 
    ShieldAlert, 
    BadgeInfo, 
    Ban, 
    MessageSquare, 
    Home, 
    User as UserIcon, 
    Gift, 
    Copy, 
    Save, 
    Award, 
    Repeat, 
    CheckCircle, 
    Star, 
    Percent, 
    Loader, 
    MoreHorizontal, 
    XCircle, 
    RefreshCw, 
    FileSignature, 
    Printer, 
    KeyRound, 
    ShieldCheck, 
    Send, 
    CheckCircle2,
    TrendingUp
} from 'lucide-react';
import Link from 'next/link';
import { notFound, useParams } from 'next/navigation';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { format, parseISO, addMonths, subMonths, isAfter } from 'date-fns';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { AddFormulaDialog } from '@/components/clients/AddFormulaDialog';
import { useToast } from '@/hooks/use-toast';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { ImageUpload } from '@/components/shared/ImageUpload';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter } from "@/components/ui/alert-dialog";
import { LogIncidentDialog } from '@/components/incidents/LogIncidentDialog';
import { IncidentFormData } from '@/components/incidents/LogIncidentForm';
import Image from 'next/image';
import { EditClientDialog } from '@/components/clients/EditClientDialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatPhoneNumber } from 'react-phone-number-input';
import { AddAppointmentDialog } from '@/components/planner/AddAppointmentDialog';
import { nanoid } from 'nanoid';
import { useFirebase, useCollection, useDoc, useMemoFirebase, updateDocumentNonBlocking, addDocumentNonBlocking } from '@/firebase';
import { useInventory } from '@/context/InventoryContext';
import { collection, doc, arrayUnion, query, where, writeBatch, increment, updateDoc, deleteField } from 'firebase/firestore';
import type { Client, Appointment, Service, CustomFormula, Incident, Membership, Package, ConsentForm, Event, Discount, Staff, WaivedFee, Tenant } from '@/lib/data';
import { useTenant } from '@/context/TenantContext';
import { Progress } from '@/components/ui/progress';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

/**
 * Utility to safely convert potential strings, JS dates, or Timestamp objects into valid Date instances.
 */
const safeDate = (val: any): Date => {
    if (!val) return new Date();
    if (val instanceof Date) return val;
    if (typeof val?.toDate === 'function') return val.toDate();
    if (typeof val === 'string') {
        try {
            return parseISO(val);
        } catch {
            return new Date(val);
        }
    }
    if (typeof val === 'object' && 'seconds' in val) {
        return new Date(val.seconds * 1000);
    }
    return new Date(val);
};

const getInitials = (name: string) => {
    const parts = name.split(' ');
    if (parts.length > 1) {
        return (parts[0][0] + (parts[parts.length - 1][0] || '')).toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
};

const ClientIntelBanner = ({ client }: { client: Client }) => {
    const hasIntel = client.intel?.hasIncidents || client.medicalNotes || client.allergyNotes || client.sensoryNeeds || (Array.isArray(client.intel?.incidents) && client.intel.incidents.some(i => i.type === 'No-Show')) || client.status === 'banned';
    if (!hasIntel) return null;

    return (
        <Card className={cn("bg-white border-2 rounded-[2rem] shadow-xl overflow-hidden relative", client.status === 'banned' && "border-destructive ring-2 ring-destructive/10")}>
            <div className="absolute top-0 left-0 w-1 h-full bg-destructive" />
            <CardContent className="p-6 flex flex-wrap gap-x-8 gap-y-4">
                {client.status === 'banned' && (
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-destructive rounded-xl shadow-lg shadow-destructive/20"><Ban className="w-4 h-4 text-white" /></div>
                        <span className="text-xs font-black text-destructive uppercase tracking-widest">Banned Guest</span>
                    </div>
                )}
                {client.intel?.hasIncidents && (
                     <div className="flex items-center gap-3">
                        <div className="p-2 bg-purple-500/10 rounded-xl border border-purple-500/20"><ShieldAlert className="w-4 h-4 text-purple-600" /></div>
                        <span className="text-xs font-black text-purple-600 uppercase tracking-widest">Incident History</span>
                    </div>
                )}
                {client.medicalNotes && (
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-red-500/10 rounded-xl border border-red-500/20"><ShieldPlus className="w-4 h-4 text-red-600" /></div>
                        <span className="text-xs font-black text-red-600 uppercase tracking-widest">Medical Alert</span>
                    </div>
                )}
                {client.allergyNotes && (
                     <div className="flex items-center gap-3">
                        <div className="p-2 bg-orange-500/10 rounded-xl border border-orange-500/20"><AlertTriangle className="w-4 h-4 text-orange-600" /></div>
                        <span className="text-xs font-black text-orange-600 uppercase tracking-widest">Allergy Warning</span>
                    </div>
                )}
                 {client.sensoryNeeds && (
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-blue-500/10 rounded-xl border border-blue-500/20"><Ear className="w-4 h-4 text-blue-600" /></div>
                        <span className="text-xs font-black text-blue-600 uppercase tracking-widest">Sensory Intel</span>
                    </div>
                )}
            </CardContent>
        </Card>
    )
}

const AppointmentHistoryCard = ({
  appointment,
  onRebook,
}: {
  appointment: any;
  onRebook: (appointment: Appointment) => void;
}) => {
  const total = (appointment.revenue || appointment.service?.price || 0) + (appointment.tipAmount || 0);
  return (
    <Card className="flex flex-col border-2 rounded-[1.5rem] shadow-sm overflow-hidden group hover:border-primary/20 transition-all">
      <CardContent className="p-5 space-y-4 flex-1">
        <div className="flex justify-between items-start">
            <div className="min-w-0 flex-1">
                <p className="font-black text-sm uppercase tracking-tight text-slate-900 truncate">{appointment.service?.name || 'Session'}</p>
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mt-1 opacity-60">
                {format(safeDate(appointment.startTime), 'MMMM d, yyyy')}
                </p>
            </div>
            <Badge
                variant="secondary"
                className={cn(
                'capitalize font-black text-[8px] h-5 px-2 border-none',
                appointment.status === 'completed' ? 'bg-green-100 text-green-800' : 'bg-muted text-muted-foreground'
                )}
            >
                {appointment.status}
            </Badge>
        </div>
        <div className="flex justify-between items-center text-sm pt-3 border-t border-dashed">
          <span className="text-[9px] font-black uppercase text-muted-foreground opacity-40">Total Yield</span>
          <span className="font-black text-lg font-mono tracking-tighter text-slate-900">
            ${total.toFixed(2)}
          </span>
        </div>
      </CardContent>
      <div className="p-2 pt-0 border-t bg-muted/5 opacity-0 group-hover:opacity-100 transition-opacity">
        <Button variant="ghost" size="sm" className="w-full font-black uppercase text-[9px] tracking-widest h-9 hover:bg-primary/5 text-primary" onClick={() => onRebook(appointment)}>
            <Repeat className="w-3.5 h-3.5 mr-2"/> Rebook Treatment
        </Button>
      </div>
    </Card>
  );
};

const LoyaltyStatusCard = ({ client, appointments, discounts }: { client: Client; appointments: any[]; discounts: Discount[] }) => {
    const loyaltyDiscount = useMemo(() => {
        return discounts.find(d => d.automation?.trigger === 'loyalty' && d.isActive);
    }, [discounts]);

    if (!loyaltyDiscount) return null;

    const threshold = loyaltyDiscount.automation?.appointmentThreshold || 5;
    const completedAppointmentsCount = appointments.filter(apt => apt.status === 'completed').length;
    const currentCycleVisits = completedAppointmentsCount % threshold;
    const progress = (currentCycleVisits / threshold) * 100;
    const visitsRemaining = threshold - currentCycleVisits;
    const milestoneReached = currentCycleVisits === 0 && completedAppointmentsCount > 0;

    const rewardValue = loyaltyDiscount.type === 'percentage' 
        ? `${loyaltyDiscount.value}% off` 
        : `$${loyaltyDiscount.value.toFixed(2)} off`;

    return (
        <Card className="border-2 rounded-[2rem] shadow-xl overflow-hidden">
            <CardHeader className="p-6 pb-2 border-b bg-muted/5">
                <CardTitle className="text-[10px] font-black uppercase tracking-widest text-primary flex items-center gap-2">
                    <Award className="w-3 h-3" /> Loyalty Program
                </CardTitle>
            </CardHeader>
            <CardContent className="p-6 space-y-6">
                <div className="text-center space-y-1">
                    {milestoneReached ? (
                        <p className="font-black text-xl text-green-600 uppercase tracking-tight flex items-center justify-center gap-2">
                            <CheckCircle2 className="w-5 h-5" /> Reward Ready
                        </p>
                    ) : (
                        <>
                            <p className="text-3xl font-black tracking-tighter text-slate-900 leading-none">{visitsRemaining}</p>
                            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest opacity-60">Visits to Reward</p>
                        </>
                    )}
                </div>
                <div className="space-y-2">
                    <div className="flex justify-between items-center text-[9px] font-black uppercase text-muted-foreground opacity-60 px-1">
                        <span>Progress</span>
                        <span>{milestoneReached ? threshold : currentCycleVisits}/{threshold}</span>
                    </div>
                    <Progress value={milestoneReached ? 100 : progress} className={cn("h-1.5 rounded-full bg-muted", milestoneReached && "[&>div]:bg-green-500")} />
                </div>
                <div className="p-4 rounded-xl bg-primary/5 border-2 border-primary/10 flex justify-between items-center">
                    <span className="text-[10px] font-black uppercase tracking-widest text-primary">Pending Benefit</span>
                    <span className="font-black text-lg text-primary tracking-tighter">{rewardValue}</span>
                </div>
            </CardContent>
        </Card>
    );
};

export default function ClientDetailPage() {
  const params = useParams<{ id: string }>();
  const { id: clientId } = params;

  const { firestore, isUserLoading } = useFirebase();
  const { selectedTenant, role, isLoading: isTenantLoading } = useTenant();
  const { appointments: allAppointments, transactions, memberships, packages, services, staff, consentForms, discounts, clients: allClients } = useInventory();
  const tenantId = selectedTenant?.id;
  
  const isOwnerOrAdmin = role === 'owner' || role === 'admin';

  const clientDocRef = useMemoFirebase(() => {
    if (!firestore || !clientId || !tenantId) return null;
    return doc(firestore, `tenants/${tenantId}/clients`, clientId);
  }, [firestore, tenantId, clientId]);

  const { data: client, isLoading: clientLoading, error: clientError } = useDoc<Client>(clientDocRef);
  
  const signedConsentsQuery = useMemoFirebase(() => {
    if (!firestore || !clientId || !tenantId) return null;
    return collection(firestore, `tenants/${tenantId}/clients/${clientId}/signedConsents`);
  }, [firestore, tenantId, clientId]);
  const { data: signedConsents, isLoading: signedConsentsLoading } = useCollection<any>(signedConsentsQuery);
  
  const { toast } = useToast();
  const [isLogIncidentOpen, setIsLogIncidentOpen] = useState(false);
  const [isEditClientOpen, setIsEditClientOpen] = useState(false);
  const [isAddAppointmentOpen, setIsAddAppointmentOpen] = useState(false);
  const [appointmentToRebook, setAppointmentToRebook] = useState<Appointment | null>(null);
  const [photos, setPhotos] = useState<any[]>([]);
  const [selectedPhoto, setSelectedPhoto] = useState<any | null>(null);
  const [feeToWaive, setFeeToWaive] = useState<any | null>(null);
  const [isWaiveDialogOpen, setIsWaiveDialogOpen] = useState(false);
  const [isBanDialogOpen, setIsBanDialogOpen] = useState(false);
  const [isNoticePreviewOpen, setIsNoticePreviewOpen] = useState(false);

  const [editableReferralCode, setEditableReferralCode] = useState(client?.referralCode || '');
  const [isCodeDirty, setIsCodeDirty] = useState(false);
  const [viewingConsent, setViewingConsent] = useState<any | null>(null);

  const appointmentsForThisClient = useMemo(() => {
      return (allAppointments || [])
        .filter(apt => apt.clientId === clientId)
        .map(apt => ({
            ...apt,
            service: services.find(s => s.id === apt.serviceId)
        }));
  }, [clientId, allAppointments, services]);

  useEffect(() => {
    if (client) {
        const collectedPhotos: any[] = [];
        appointmentsForThisClient.forEach(apt => {
            if (apt.clientId === client.id && (apt as any).inspirationPhotoUrl) {
                collectedPhotos.push({ url: (apt as any).inspirationPhotoUrl, label: `Inspo for ${format(safeDate(apt.startTime), 'MMM d, yyyy')}`});
            }
        });
        setPhotos(collectedPhotos);
    }
  }, [client, appointmentsForThisClient]);

  useEffect(() => {
      setEditableReferralCode(client?.referralCode || '');
      setIsCodeDirty(false);
  }, [client?.referralCode]);

  const activeMembership = useMemo(() => {
    const mId = client?.subscription?.membershipId || client?.activeMembershipId;
    if (!mId || !memberships) return null;
    return memberships.find(m => m.id === mId);
  }, [client, memberships]);

  const isPerkUsedInCycle = (perkId: string) => {
    if (!client?.subscription?.nextBillingDate) return false;
    const lastUsedStr = client.subscription.perkLastUsed;
    if (!lastUsedStr) return false;
    const lastUsed = parseISO(lastUsedStr);
    const nextBilling = parseISO(client.subscription.nextBillingDate);
    const cycleStart = subMonths(nextBilling, 1);
    if (!isAfter(lastUsed, cycleStart)) return false;
    if (perkId === 'any') return true;
    const usageCount = client.subscription.perkUsage?.[perkId] || 0;
    const perkDef = activeMembership?.includedServices?.find(s => s.id === perkId) || activeMembership?.includedAddOns?.find(a => a.id === perkId);
    return usageCount >= (perkDef?.quantity || 1);
  };

  if (isUserLoading || isTenantLoading || clientLoading || signedConsentsLoading) {
      return (
          <div className="flex min-h-screen w-full flex-col bg-slate-50/50">
            <AppHeader title="Profile" />
            <main className="flex-1 p-4 md:p-10 flex items-center justify-center"><Loader className="w-8 h-8 animate-spin text-primary" /></main>
          </div>
      )
  }

  if (clientError || !client || !tenantId) return notFound();

  const clientDocRefReal = doc(firestore, `tenants/${tenantId}/clients`, client.id);
  const upcomingAppointments = appointmentsForThisClient.filter(apt => safeDate(apt.startTime) > new Date() && apt.status !== 'cancelled');
  const pastAppointments = appointmentsForThisClient.filter(apt => safeDate(apt.startTime) <= new Date()).sort((a,b) => safeDate(b.startTime).getTime() - safeDate(a.startTime).getTime());

  return (
    <div className="flex min-h-screen w-full flex-col bg-slate-50/50">
      <AppHeader title="Guest Dossier" />
      <main className="flex-1 p-4 md:p-10 space-y-10 w-full max-w-7xl mx-auto min-w-0">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6">
                <div className="space-y-1">
                    <h1 className="text-3xl md:text-5xl font-black uppercase tracking-tighter text-slate-900 leading-none">Record Detail</h1>
                    <p className="text-sm text-muted-foreground font-black uppercase tracking-[0.2em] opacity-60">Identity & performance profile</p>
                </div>
                <div className="flex items-center gap-3">
                    <Button variant="outline" size="sm" asChild className="h-12 px-6 rounded-2xl border-2 font-black uppercase text-[10px] tracking-widest"><Link href="/clients"><ArrowLeft className="h-4 w-4 mr-2" />Return to Log</Link></Button>
                    {isOwnerOrAdmin && <Button variant="outline" size="sm" onClick={() => setIsEditClientOpen(true)} className="h-12 px-6 rounded-2xl border-2 font-black uppercase text-[10px] tracking-widest"><Edit className="h-4 w-4 mr-2" />Modify Profile</Button>}
                </div>
            </div>
            
            <Card className={cn("border-4 shadow-3xl rounded-[3rem] overflow-hidden bg-white/80 backdrop-blur-xl transition-all", client.status === 'banned' && "border-destructive ring-4 ring-destructive/10")}>
                 <CardContent className="p-8 md:p-12 flex flex-col sm:flex-row items-center sm:items-start text-center sm:text-left gap-8 sm:gap-12">
                    <div className="relative">
                        <Avatar className="w-32 h-32 md:w-40 md:h-40 text-2xl border-4 border-white shadow-2xl rounded-[2.5rem] md:rounded-[3rem]">
                            <AvatarImage src={client.avatarUrl} alt={client.name} className="object-cover" />
                            <AvatarFallback className="font-black bg-primary/10 text-primary">{getInitials(client.name)}</AvatarFallback>
                        </Avatar>
                        {activeMembership && (
                            <div className="absolute -top-3 -right-3 bg-indigo-600 text-white p-2 rounded-2xl shadow-xl border-4 border-white">
                                <Award className="w-6 h-6" />
                            </div>
                        )}
                    </div>
                    <div className="space-y-4 flex-1 min-w-0">
                        <div className="flex flex-col sm:flex-row items-center sm:items-baseline gap-4">
                            <h2 className="text-3xl md:text-5xl font-black uppercase tracking-tighter text-slate-900 truncate leading-none">{client.name}</h2>
                            <div className="flex gap-2">
                                {activeMembership && <Badge className="bg-indigo-500/10 text-indigo-700 border-none font-black text-[9px] uppercase tracking-widest h-6 px-3">Master Member</Badge>}
                                {client.status === 'banned' && <Badge variant="destructive" className="animate-pulse font-black text-[9px] uppercase tracking-widest h-6 px-3">Hard Restriction</Badge>}
                            </div>
                        </div>
                        
                        <div className="flex flex-wrap justify-center sm:justify-start gap-x-8 gap-y-4 pt-2">
                            <div className="space-y-1">
                                <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground opacity-60">Verified Contact</p>
                                <a href={`mailto:${client.email}`} className="text-sm font-black uppercase tracking-tight text-primary hover:underline block">{client.email}</a>
                                <p className="text-sm font-black tracking-tight text-slate-700">{client.phone ? formatPhoneNumber(client.phone) : 'N/A'}</p>
                            </div>
                            <div className="space-y-1">
                                <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground opacity-60">Session Discovery</p>
                                <p className="text-sm font-black uppercase tracking-tight text-slate-700">{client.intel?.referralSource || 'Unknown'}</p>
                            </div>
                        </div>
                    </div>
                    <div className="flex flex-col gap-2 shrink-0">
                        <Button variant="outline" asChild className="h-12 rounded-2xl border-2 font-black uppercase text-[10px] tracking-widest shadow-sm"><Link href={`/clients/${client.id}/report`}><FileText className="mr-2 h-4 w-4"/>View Strategy Report</Link></Button>
                        <Button variant="outline" className="h-12 rounded-2xl border-2 font-black uppercase text-[10px] tracking-widest shadow-sm"><MessageSquare className="mr-2 h-4 w-4"/>Send Notification</Button>
                    </div>
                </CardContent>
            </Card>

            <ClientIntelBanner client={client} />
            
            <div className="grid lg:grid-cols-3 xl:grid-cols-4 gap-10">
                <div className="lg:col-span-2 xl:col-span-3 space-y-10">
                    <Tabs defaultValue="overview">
                        <TabsList className="bg-muted/30 p-1.5 rounded-2xl border-2 border-muted shadow-inner flex overflow-x-auto scrollbar-hide gap-1.5 mb-8">
                            <TabsTrigger value="overview" className="flex-1 min-w-[100px] h-11 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all data-[state=active]:bg-white data-[state=active]:text-primary data-[state=active]:shadow-md">Overview</TabsTrigger>
                            <TabsTrigger value="history" className="flex-1 min-w-[100px] h-11 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all data-[state=active]:bg-white data-[state=active]:text-primary data-[state=active]:shadow-md">Session History</TabsTrigger>
                            <TabsTrigger value="photos" className="flex-1 min-w-[100px] h-11 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all data-[state=active]:bg-white data-[state=active]:text-primary data-[state=active]:shadow-md">Asset Gallery</TabsTrigger>
                            <TabsTrigger value="consents" className="flex-1 min-w-[100px] h-11 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all data-[state=active]:bg-white data-[state=active]:text-primary data-[state=active]:shadow-md">Agreements</TabsTrigger>
                        </TabsList>
                        
                        <TabsContent value="overview" className="m-0 space-y-8 animate-in fade-in duration-500">
                            <Card className="border-2 shadow-sm rounded-[2.5rem] overflow-hidden">
                                <CardHeader className="bg-muted/5 border-b p-8 pb-4">
                                    <CardTitle className="text-sm font-black uppercase tracking-widest text-muted-foreground flex items-center gap-3"><BadgeInfo className="w-4 h-4 text-primary" /> Dossier Details</CardTitle>
                                </CardHeader>
                                <CardContent className="p-8 grid grid-cols-1 md:grid-cols-2 gap-10">
                                    <div className="space-y-6">
                                        <div className="space-y-1">
                                            <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground opacity-60">Birth Milestone</p>
                                            <p className="text-lg font-black uppercase text-slate-900 tracking-tight">{client.birthday ? format(safeDate(client.birthday), 'MMMM d') : 'Not on file'}</p>
                                        </div>
                                        {client.address && (
                                            <div className="space-y-1">
                                                <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground opacity-60">Primary Domicile</p>
                                                <p className="text-sm font-bold text-slate-700 leading-relaxed uppercase tracking-tight">{client.address.street}<br/>{client.address.city}, {client.address.state} {client.address.zip}</p>
                                            </div>
                                        )}
                                    </div>
                                    <div className="space-y-6">
                                        {client.emergencyContact && (
                                            <div className="space-y-1 p-5 rounded-2xl bg-destructive/[0.02] border-2 border-destructive/10">
                                                <p className="text-[9px] font-black uppercase tracking-widest text-destructive/60 mb-2">Emergency Protocol</p>
                                                <p className="text-sm font-black text-slate-900 uppercase tracking-tight">{client.emergencyContact.name}</p>
                                                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest opacity-60">{client.emergencyContact.relationship}</p>
                                                <p className="text-sm font-black text-primary tracking-tight mt-2">{client.emergencyContact.phone ? formatPhoneNumber(client.emergencyContact.phone) : 'N/A'}</p>
                                            </div>
                                        )}
                                    </div>
                                </CardContent>
                            </Card>

                            <Card className="border-2 shadow-sm rounded-[2.5rem] overflow-hidden">
                                <CardHeader className="bg-muted/5 border-b p-8 pb-4">
                                    <CardTitle className="text-sm font-black uppercase tracking-widest text-muted-foreground flex items-center gap-3"><Award className="w-4 h-4 text-indigo-600" /> Active Entitlements</CardTitle>
                                </CardHeader>
                                <CardContent className="p-8">
                                    {(!activeMembership && (!client.activePackages || client.activePackages.length === 0)) ? (
                                        <div className="text-center py-12 border-4 border-dashed rounded-[2rem] opacity-30">
                                            <Award className="w-12 h-12 mx-auto mb-3" />
                                            <p className="text-[10px] font-black uppercase tracking-widest">No active memberships or bundles</p>
                                        </div>
                                    ) : (
                                        <div className="grid gap-6">
                                            {activeMembership && (
                                                <div className="p-6 rounded-[2rem] border-2 border-indigo-500/20 bg-indigo-500/[0.02] flex flex-col md:flex-row justify-between gap-6">
                                                    <div className="space-y-4 min-w-0">
                                                        <div className="space-y-1">
                                                            <p className="text-[9px] font-black uppercase text-indigo-600 tracking-widest">Membership Tier</p>
                                                            <h4 className="text-2xl font-black uppercase tracking-tighter text-slate-900 truncate">{activeMembership.name}</h4>
                                                        </div>
                                                        <div className="flex flex-wrap gap-2 pt-2">
                                                            {activeMembership.includedServices?.map(perk => {
                                                                const used = client.subscription?.perkUsage?.[perk.id] || 0;
                                                                const isRedeemed = isPerkUsedInCycle(perk.id);
                                                                return (
                                                                    <Badge key={perk.id} variant="secondary" className={cn("h-7 px-3 rounded-lg border-2 font-black text-[9px] uppercase tracking-widest", isRedeemed ? 'bg-green-500/10 text-green-700 border-green-500/20' : 'bg-white text-indigo-700 border-indigo-500/10')}>
                                                                        {isRedeemed ? <CheckCircle className="w-2.5 h-2.5 mr-1.5" /> : <Star className="w-2.5 h-2.5 mr-1.5" />}
                                                                        {perk.name} ({used}/{perk.quantity})
                                                                    </Badge>
                                                                )
                                                            })}
                                                        </div>
                                                    </div>
                                                    <div className="text-right shrink-0">
                                                        <Badge className="bg-indigo-600 border-none font-black text-[9px] uppercase tracking-widest px-3 h-6 mb-2">VALID</Badge>
                                                        <p className="text-[9px] font-black uppercase text-muted-foreground opacity-40">Next Billing</p>
                                                        <p className="font-black text-sm uppercase tracking-tight text-slate-900">{client.subscription?.nextBillingDate ? format(parseISO(client.subscription.nextBillingDate), 'MMM d, yyyy') : 'N/A'}</p>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </CardContent>
                            </Card>
                        </TabsContent>

                        <TabsContent value="history" className="m-0 space-y-10 animate-in fade-in duration-500">
                            <div className="space-y-4">
                                <h3 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-4">Scheduled Events</h3>
                                <div className="grid sm:grid-cols-2 gap-4">
                                    {upcomingAppointments.length > 0 ? upcomingAppointments.map((apt) => <AppointmentHistoryCard key={apt.id} appointment={apt} onRebook={setAppointmentToRebook} />) : <div className="col-span-2 py-16 text-center border-4 border-dashed rounded-[2.5rem] opacity-30"><Calendar className="w-12 h-12 mx-auto mb-2"/><p className="text-xs font-black uppercase tracking-widest">No upcoming sessions</p></div>}
                                </div>
                            </div>
                            <div className="space-y-4 pt-6 border-t border-dashed">
                                <h3 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-4">Historical Records</h3>
                                <div className="grid sm:grid-cols-2 gap-4">
                                    {pastAppointments.length > 0 ? pastAppointments.map((apt) => <AppointmentHistoryCard key={apt.id} appointment={apt} onRebook={setAppointmentToRebook} />) : <div className="col-span-2 py-16 text-center border-4 border-dashed rounded-[2.5rem] opacity-30"><Clock className="w-12 h-12 mx-auto mb-2"/><p className="text-xs font-black uppercase tracking-widest">Empty history</p></div>}
                                </div>
                            </div>
                        </TabsContent>

                        <TabsContent value="consents" className="m-0 animate-in fade-in duration-500">
                            <Card className="border-2 shadow-sm rounded-[2.5rem] overflow-hidden">
                                <CardHeader className="bg-muted/5 border-b p-8"><CardTitle className="text-sm font-black uppercase tracking-widest text-muted-foreground">Certified Agreements</CardTitle></CardHeader>
                                <CardContent className="p-8">
                                    {signedConsents && signedConsents.length > 0 ? (
                                        <div className="grid gap-4">
                                            {signedConsents.map((consent: any) => (
                                                <Card key={consent.id} className="border-2 rounded-2xl overflow-hidden hover:border-primary/20 transition-all group">
                                                    <CardContent className="p-5 flex items-center justify-between">
                                                        <div className="flex items-center gap-4">
                                                            <div className="p-3 bg-primary/5 rounded-2xl border-2 border-primary/10 text-primary group-hover:bg-primary group-hover:text-white transition-all shadow-inner"><FileSignature className="w-6 h-6" /></div>
                                                            <div className="space-y-0.5">
                                                                <p className="font-black text-sm uppercase tracking-tight text-slate-900 leading-tight">{consent.formTitle}</p>
                                                                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest opacity-60">Signed {format(safeDate(consent.signedAt), 'MMM d, p')}</p>
                                                            </div>
                                                        </div>
                                                        <Button variant="outline" className="rounded-xl font-black uppercase text-[9px] tracking-widest border-2 px-5 h-9" onClick={() => setViewingConsent(consent)}>View Record</Button>
                                                    </CardContent>
                                                </Card>
                                            ))}
                                        </div>
                                    ) : (
                                        <div className="py-20 text-center border-4 border-dashed rounded-[2.5rem] opacity-30 flex flex-col items-center gap-4">
                                            <FileText className="w-16 h-16" />
                                            <p className="text-sm font-black uppercase tracking-widest">No documents on file</p>
                                        </div>
                                    )}
                                </CardContent>
                            </Card>
                        </TabsContent>
                    </Tabs>
                </div>

                <div className="lg:col-span-1 space-y-8">
                    <Card className="border-2 shadow-sm rounded-[2rem] overflow-hidden">
                        <CardHeader className="bg-muted/5 border-b p-6 flex flex-row items-center justify-between">
                            <CardTitle className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Financial Intel</CardTitle>
                            {isOwnerOrAdmin && <Button variant="ghost" size="icon" onClick={() => {}} title="Reconcile LTV" className="h-8 w-8 hover:bg-primary/5 text-primary"><RefreshCw className="h-4 w-4" /></Button>}
                        </CardHeader>
                        <CardContent className="p-6 space-y-6">
                            <div className="p-6 rounded-[1.5rem] bg-primary/5 border-2 border-primary/10 text-left relative overflow-hidden group">
                                <div className="absolute top-0 right-0 p-4 opacity-5"><TrendingUp className="w-12 h-12 text-primary"/></div>
                                <p className="text-[9px] font-black uppercase text-primary/60 tracking-widest mb-1">Lifetime Yield</p>
                                <p className="text-4xl font-black text-primary tracking-tighter font-mono leading-none">${(client.lifetimeValue || 0).toFixed(2)}</p>
                            </div>
                            
                            <div className="grid grid-cols-1 gap-4">
                                <div className="p-5 rounded-[1.5rem] bg-muted/20 border-2 shadow-inner">
                                    <p className="text-[9px] font-black uppercase text-muted-foreground tracking-widest mb-1 opacity-60">Store Credit</p>
                                    <p className="text-2xl font-black text-slate-900 tracking-tighter font-mono">${(client.walletCredit || 0).toFixed(2)}</p>
                                </div>
                                <div className={cn("p-5 rounded-[1.5rem] border-2 shadow-inner transition-all", (client.outstandingBalance || 0) > 0 ? "bg-destructive/5 border-destructive/20 text-destructive animate-in pulse duration-1000" : "bg-muted/20 border-transparent")}>
                                    <div className="flex justify-between items-start">
                                        <p className="text-[9px] font-black uppercase tracking-widest mb-1 opacity-60">Account Arrears</p>
                                        {(client.outstandingBalance || 0) > 0 && <Button variant="ghost" size="icon" onClick={() => setIsNoticePreviewOpen(true)} className="h-6 w-6 -mt-1 -mr-1 text-destructive hover:bg-destructive/10"><Send className="w-3.5 h-3.5"/></Button>}
                                    </div>
                                    <p className="text-2xl font-black tracking-tighter font-mono">${(client.outstandingBalance || 0).toFixed(2)}</p>
                                </div>
                            </div>
                        </CardContent>
                        <CardFooter className="p-6 pt-0">
                            <Button 
                                disabled={!client.outstandingBalance || client.outstandingBalance === 0} 
                                className="w-full h-14 rounded-2xl font-black uppercase tracking-tight shadow-xl shadow-primary/20"
                                asChild
                            >
                                <Link href={`/pos?payer_id=${client.id}&action=settle`}>Settle Arrears POS</Link>
                            </Button>
                        </CardFooter>
                    </Card>

                    <LoyaltyStatusCard client={client} appointments={appointmentsForThisClient} discounts={discounts || []} />
                </div>
            </div>
      </main>
      
      {/* Existing Dialogs (Unchanged logic, just ensure they are registered) */}
      <LogIncidentDialog open={isLogIncidentOpen} onOpenChange={setIsLogIncidentOpen} client={client} onIncidentLogged={() => {}} />
      <EditClientDialog open={isEditClientOpen} onOpenChange={setIsEditClientOpen} client={client} onSave={() => {}} />
      <AddAppointmentDialog open={isAddAppointmentOpen} onOpenChange={setIsAddAppointmentOpen} appointmentToRebook={appointmentToRebook} memberships={memberships || []} />
    </div>
  );
}
