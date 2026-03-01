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
import { ArrowLeft, Edit, Mail, Phone, DollarSign, Calendar, FileText, FlaskConical, PlusCircle, ShieldPlus, AlertTriangle, Ear, Upload, Eye, ShieldAlert, BadgeInfo, Ban, MessageSquare, Home, User as UserIcon, Gift, Copy, Save, Award, Repeat, CheckCircle, Star, Percent, Loader, MoreHorizontal, XCircle, RefreshCw, FileSignature, Printer, KeyRound, ShieldCheck } from 'lucide-react';
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
import { useFirebase, useCollection, useDoc, useMemoFirebase, updateDocumentNonBlocking, addDocumentNonBlocking, errorEmitter } from '@/firebase';
import { useInventory } from '@/context/InventoryContext';
import { collection, doc, arrayUnion, query, where, writeBatch, increment, updateDoc } from 'firebase/firestore';
import type { Client, Appointment, Service, CustomFormula, Incident, Membership, Package, ConsentForm, Event, Discount, Staff, WaivedFee } from '@/lib/data';
import { useTenant } from '@/context/TenantContext';
import { Progress } from '@/components/ui/progress';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { PrintableConsentForm } from '@/components/consents/PrintableConsentForm';

/**
 * Utility to safely convert potential strings or Date objects into valid Date instances.
 */
const safeDate = (val: any): Date => {
    if (!val) return new Date();
    if (val instanceof Date) return val;
    if (typeof val === 'string') {
        try {
            return parseISO(val);
        } catch {
            return new Date(val);
        }
    }
    if (typeof val?.toDate === 'function') return val.toDate();
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
    const hasIntel = client.intel?.hasIncidents || client.medicalNotes || client.allergyNotes || client.sensoryNeeds || (Array.isArray(client.intel?.incidents) && client.intel.incidents.some(i => i.type === 'No-Show'));
    if (!hasIntel) return null;

    return (
        <Card className="bg-muted/50">
            <CardContent className="p-4 flex flex-wrap gap-x-6 gap-y-3">
                {client.intel?.hasIncidents && (
                     <div className="flex items-center gap-2 text-sm font-medium text-purple-600 dark:text-purple-400">
                        <ShieldAlert className="w-4 h-4" />
                        <span>Incident History</span>
                    </div>
                )}
                {client.medicalNotes && (
                    <div className="flex items-center gap-2 text-sm font-medium text-red-600 dark:text-red-400">
                        <ShieldPlus className="w-4 h-4" />
                        <span>Medical Alert</span>
                    </div>
                )}
                {client.allergyNotes && (
                     <div className="flex items-center gap-2 text-sm font-medium text-orange-600 dark:text-orange-400">
                        <AlertTriangle className="w-4 h-4" />
                        <span>Allergy Alert</span>
                    </div>
                )}
                 {client.sensoryNeeds && (
                    <div className="flex items-center gap-2 text-sm font-medium text-blue-600 dark:text-blue-400">
                        <Ear className="w-4 h-4" />
                        <span>Sensory Needs</span>
                    </div>
                )}
                 {Array.isArray(client.intel?.incidents) && client.intel.incidents.some(i => i.type === 'No-Show') && (
                    <div className="flex items-center gap-2 text-sm font-medium text-gray-600 dark:text-gray-400">
                        <Ban className="w-4 h-4" />
                        <span>No-Show History</span>
                    </div>
                )}
            </CardContent>
        </Card>
    )
}

const FormulaCard = ({ formula }: { formula: CustomFormula }) => (
    <AccordionItem value={formula.name}>
        <AccordionTrigger>
            <div className="flex items-center gap-3">
                <FlaskConical className="w-5 h-5 text-primary" />
                <span className="font-semibold">{formula.name}</span>
            </div>
        </AccordionTrigger>
        <AccordionContent className="pt-2 space-y-2">
            {formula.items.map((item, index) => (
                <div key={index} className="p-3 rounded-md bg-background border text-sm">
                    <p className="font-medium">{item.quantityUsed}{item.unit} {item.productName}</p>
                    {item.note && <p className="text-xs text-muted-foreground pl-4">&ndash; {item.note}</p>}
                </div>
            ))}
             <Button variant="outline" size="sm" className="mt-2"><Edit className="w-3 h-3 mr-2"/>Edit Formula</Button>
        </AccordionContent>
    </AccordionItem>
)

const AppointmentHistoryCard = ({
  appointment,
  onRebook,
}: {
  appointment: any;
  onRebook: (appointment: Appointment) => void;
}) => {
  const total = (appointment.revenue || appointment.service?.price || 0) + (appointment.tipAmount || 0);
  return (
    <Card className="flex flex-col">
      <CardContent className="p-4 space-y-3 flex-1">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
                <p className="font-semibold">{appointment.service?.name || 'N/A'}</p>
                <p className="text-sm text-muted-foreground">
                {format(safeDate(appointment.startTime), 'MMMM d, yyyy')}
                </p>
            </div>
            <div className="sm:text-right">
                 <Badge
                    variant={appointment.status === 'completed' ? 'default' : 'secondary'}
                    className={cn(
                    'capitalize',
                    appointment.status === 'completed' &&
                        'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-300'
                    )}
                >
                    {appointment.status}
                </Badge>
            </div>
        </div>
        <div className="flex justify-between items-center text-sm pt-3 border-t">
          <span className="text-muted-foreground">Total (Incl. Tips)</span>
          <span className="font-semibold text-lg">
            ${total.toFixed(2)}
          </span>
        </div>
      </CardContent>
      <CardFooter className="p-2 border-t">
        <Button variant="secondary" className="w-full" onClick={() => onRebook(appointment)}>
            <Repeat className="w-4 h-4 mr-2"/> Rebook Service
        </Button>
      </CardFooter>
    </Card>
  );
};

const LoyaltyStatusCard = ({ client, appointments, discounts }: { client: Client; appointments: any[]; discounts: Discount[] }) => {
    const loyaltyDiscount = useMemo(() => {
        return discounts.find(d => d.automation?.trigger === 'loyalty' && d.isActive);
    }, [discounts]);

    if (!loyaltyDiscount) {
        return (
            <Card>
                <CardHeader><CardTitle>Loyalty Program</CardTitle></CardHeader>
                <CardContent>
                    <p className="text-sm text-muted-foreground text-center py-4">
                        No active loyalty program found.
                    </p>
                </CardContent>
            </Card>
        )
    }

    const threshold = loyaltyDiscount.automation?.appointmentThreshold || 5;
    const completedAppointmentsCount = appointments.filter(apt => apt.status === 'completed').length;
    const progress = (completedAppointmentsCount % threshold) / threshold * 100;
    const visitsRemaining = threshold - (completedAppointmentsCount % threshold);
    
    const rewardValue = loyaltyDiscount.type === 'percentage' 
        ? `${loyaltyDiscount.value}% off` 
        : `$${loyaltyDiscount.value.toFixed(2)} off`;

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2"><Award className="w-5 h-5 text-primary" /> Loyalty Status</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="text-center">
                    {visitsRemaining === threshold && completedAppointmentsCount > 0 && (
                        <p>Reward earned on last visit!</p>
                    )
                    }
                    {visitsRemaining === threshold && completedAppointmentsCount === 0 && (
                         <p>Their next visit is their first towards a reward!</p>
                    )
                    }
                    {visitsRemaining === 1 && (
                        <p>Just <span className="font-bold text-primary text-lg">1</span> more visit until the next reward!</p>
                    )
                    }
                    {visitsRemaining > 1 && (
                         <p><span className="font-bold text-primary text-lg">{visitsRemaining}</span> more visits until the next reward!</p>
                    )}
                </div>
                <Progress value={progress} />
                <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                        <span className="text-muted-foreground">Completed Visits (cycle)</span>
                        <span className="font-medium">{(completedAppointmentsCount % threshold)} / {threshold}</span>
                    </div>
                     <div className="flex justify-between">
                        <span className="text-muted-foreground">Total Lifetime Visits</span>
                        <span className="font-medium">{completedAppointmentsCount}</span>
                    </div>
                    <div className="flex justify-between pt-2 border-t">
                        <span className="font-semibold">Next Reward</span>
                        <span className="font-bold text-primary">{rewardValue}</span>
                    </div>
                </div>
            </CardContent>
        </Card>
    );
};

const WaiveFeeDialog = ({ open, onOpenChange, fee, onConfirm, staff }: { open: boolean, onOpenChange: (val: boolean) => void, fee: any, onConfirm: (staffMember: Staff, reason: string) => void, staff: Staff[] }) => {
    const [pin, setPin] = useState('');
    const [reason, setReason] = useState('');
    const { toast } = useToast();

    const handleConfirm = () => {
        if (!pin || pin.length < 4) {
            toast({ variant: 'destructive', title: 'PIN Required' });
            return;
        }
        if (!reason.trim()) {
            toast({ variant: 'destructive', title: 'Reason Required' });
            return;
        }

        // SECURITY: Strictly check for admin role
        const authorizedStaff = staff.find(s => s.pin === pin && s.role === 'admin');
        if (!authorizedStaff) {
            toast({ 
                variant: 'destructive', 
                title: 'Unauthorized', 
                description: 'A manager or owner PIN is required to waive fees. Standard staff PINs are not authorized for this action.' 
            });
            return;
        }

        onConfirm(authorizedStaff, reason);
        setPin('');
        setReason('');
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <ShieldCheck className="w-5 h-5 text-primary" />
                        Waive Fee Authorization
                    </DialogTitle>
                    <DialogDescription>A manager or owner PIN is required to waive this ${fee?.feeAmount.toFixed(2)} fee.</DialogDescription>
                </DialogHeader>
                <div className="space-y-6 py-4">
                    <div className="space-y-2">
                        <Label className="text-xs font-black uppercase tracking-widest text-muted-foreground text-center block">Admin/Owner PIN</Label>
                        <div className="flex justify-center">
                            <Input 
                                type="password" 
                                maxLength={4} 
                                value={pin} 
                                onChange={e => setPin(e.target.value.replace(/\D/g, ''))}
                                className="text-center text-3xl font-black h-14 tracking-[0.5em] w-48 bg-muted/50 border-2"
                                autoFocus
                            />
                        </div>
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="waive-reason">Reason for Waiving (Required)</Label>
                        <Textarea 
                            id="waive-reason" 
                            placeholder="e.g., Client verified emergency, first-time courtesy..."
                            value={reason}
                            onChange={e => setReason(e.target.value)}
                        />
                    </div>
                </div>
                <DialogFooter className="gap-2">
                    <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                    <Button onClick={handleConfirm} disabled={pin.length < 4 || !reason.trim()}>Authorize Waiver</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
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
  const [isAddFormulaOpen, setIsAddFormulaOpen] = useState(false);
  const [isLogIncidentOpen, setIsLogIncidentOpen] = useState(false);
  const [isEditClientOpen, setIsEditClientOpen] = useState(false);
  const [isAddAppointmentOpen, setIsAddAppointmentOpen] = useState(false);
  const [appointmentToRebook, setAppointmentToRebook] = useState<Appointment | null>(null);
  const [photos, setPhotos] = useState<any[]>([]);
  const [selectedPhoto, setSelectedPhoto] = useState<any | null>(null);
  const [feeToWaive, setFeeToWaive] = useState<any | null>(null);
  const [isWaiveDialogOpen, setIsWaiveDialogOpen] = useState(false);

  const [editableReferralCode, setEditableReferralCode] = useState(client?.referralCode || '');
  const [isCodeDirty, setIsCodeDirty] = useState(false);
  const [viewingConsent, setViewingConsent] = useState<any | null>(null);

  const formTemplateForViewing = useMemo(() => {
    if (!viewingConsent || !consentForms) return null;
    return consentForms.find(f => f.id === viewingConsent.formId);
  }, [viewingConsent, consentForms]);

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
    const isCurrentCycle = isAfter(lastUsed, cycleStart);
    if (!isCurrentCycle) return false;
    if (perkId === 'any') return true;
    const usageCount = client.subscription.perkUsage?.[perkId] || 0;
    let perkDefQuantity = 1;
    if (perkId === 'retail_discount') {
        perkDefQuantity = activeMembership?.retailDiscountLimit || 0;
    } else {
        const perkDef = activeMembership?.includedServices?.find(s => s.id === perkId) || activeMembership?.includedAddOns?.find(a => a.id === perkId);
        perkDefQuantity = perkDef?.quantity || 1;
    }
    if (perkDefQuantity === 0) return false;
    return usageCount >= perkDefQuantity;
  };

  const safeLTV = useMemo(() => {
    const val = Number(client?.lifetimeValue);
    return isNaN(val) ? 0 : val;
  }, [client?.lifetimeValue]);

  const handleReconcileLTV = () => {
    if (!transactions || !client || !firestore || !tenantId) return;
    const clientTransactions = transactions.filter(t => 
        t.clientId === client.id && 
        t.type === 'income' &&
        (t.category === 'Service Revenue' || t.category === 'Retail' || t.category === 'Membership Sales' || t.category === 'Package Sales' || t.category === 'Membership/Package Sales')
    );
    const totalSpent = clientTransactions.reduce((sum, t) => sum + t.amount, 0);
    const clientRef = doc(firestore, `tenants/${tenantId}/clients`, client.id);
    updateDocumentNonBlocking(clientRef, { lifetimeValue: totalSpent });
    toast({ title: "LTV Reconciled", description: `${client.name}'s lifetime value updated.` });
  };

  const handleSaveFormula = (formula: CustomFormula) => {
    if (!client || !firestore || !tenantId) return;
    const clientRef = doc(firestore, `tenants/${tenantId}/clients`, client.id);
    updateDocumentNonBlocking(clientRef, { customFormulas: arrayUnion(formula) });
    toast({ title: "Formula Saved" });
    setIsAddFormulaOpen(false);
  };

  const isLoadingStatus = isUserLoading || isTenantLoading || clientLoading || signedConsentsLoading;

  if (isLoadingStatus) {
      return (
          <div className="flex min-h-screen w-full flex-col bg-muted/40">
            <AppHeader title="Client Profile" />
            <main className="flex-1 p-4 md:p-6 flex items-center justify-center"><Loader className="w-8 h-8 animate-spin" /></main>
          </div>
      )
  }

  if (clientError || !client || !tenantId) return notFound();

  const clientDocRefReal = doc(firestore, `tenants/${tenantId}/clients`, client.id);
  const upcomingAppointments = appointmentsForThisClient.filter(apt => safeDate(apt.startTime) > new Date() && apt.status !== 'cancelled');
  const pastAppointments = appointmentsForThisClient.filter(apt => safeDate(apt.startTime) <= new Date()).sort((a,b) => safeDate(b.startTime).getTime() - safeDate(a.startTime).getTime());

  const handleUpdateClient = (updatedClientData: Partial<Client>) => {
    updateDocumentNonBlocking(clientDocRefReal, updatedClientData);
    toast({ title: 'Client Updated' });
    setIsEditClientOpen(false);
  };
  
  const handleUpdateSubscriptionStatus = (status: 'active' | 'past_due' | 'canceled') => {
      updateDocumentNonBlocking(clientDocRefReal, { 'subscription.status': status });
      toast({ title: 'Membership Updated' });
  };

  const handleNewPhotoUpload = (url: string) => {
      if (url) setPhotos(prev => [{ url, label: `Uploaded on ${format(new Date(), 'MMM d, yyyy')}` }, ...prev]);
  }
  
   const handleIncidentLogged = (incidentData: IncidentFormData) => {
    const newIncident: Incident = { ...incidentData, id: `inc-${Date.now()}`, date: new Date().toISOString() };
    updateDocumentNonBlocking(clientDocRefReal, { 'intel.hasIncidents': true, 'intel.incidents': arrayUnion(newIncident) });
    toast({ title: "Incident Logged" });
  };
  
  const handleCopyReferralCode = () => {
    if (editableReferralCode) {
        navigator.clipboard.writeText(editableReferralCode);
        toast({ title: "Referral Code Copied" });
    }
  }

  const handleConfirmWaive = async (authorizer: Staff, reason: string) => {
    if (!feeToWaive || !client || !firestore || !tenantId) return;

    const clientRef = doc(firestore, `tenants/${tenantId}/clients`, client.id);
    const appointmentRef = doc(firestore, `tenants/${tenantId}/appointments`, feeToWaive.appointmentId);
    
    const newUnpaidFees = (client.unpaidFees || []).filter((f: any) => f.feeId !== feeToWaive.feeId);
    const newBalance = Math.max(0, (client.outstandingBalance || 0) - feeToWaive.feeAmount);

    const waiverEntry: WaivedFee = {
        ...feeToWaive,
        waivedBy: authorizer.id,
        waivedByName: authorizer.name,
        waivedAt: new Date().toISOString(),
        reason: reason
    };

    const batch = writeBatch(firestore);
    batch.update(clientRef, { 
        unpaidFees: newUnpaidFees, 
        outstandingBalance: newBalance,
        waivedFees: arrayUnion(waiverEntry)
    });
    batch.update(appointmentRef, { 
        cancellationFeeWaived: true, 
        waivedBy: authorizer.id, 
        waivedReason: reason,
        waivedAt: waiverEntry.waivedAt
    });

    try {
        await batch.commit();
        toast({ title: "Fee Waived", description: `Authorized by ${authorizer.name}.` });
    } catch (error) {
        console.error("Error waiving fee:", error);
        toast({ variant: 'destructive', title: 'Error', description: 'Could not waive the fee.' });
    }
    
    setIsWaiveDialogOpen(false);
    setFeeToWaive(null);
  };

  return (
    <div className="flex min-h-screen w-full flex-col bg-muted/40">
      <AppHeader title="Client Profile" />
      <main className="flex-1 p-4 md:p-6 space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <Button variant="outline" size="sm" asChild><Link href="/clients"><ArrowLeft className="h-4 w-4 mr-2" />Back to Clients</Link></Button>
                {isOwnerOrAdmin && <Button variant="outline" size="sm" onClick={() => setIsEditClientOpen(true)}><Edit className="h-4 w-4 mr-2" />Edit Profile</Button>}
            </div>
            
            <Card>
                 <CardContent className="p-6 flex flex-col sm:flex-row items-center sm:items-start text-center sm:text-left gap-4 sm:gap-6">
                    <div className="relative">
                        <Avatar className="w-24 h-24 text-xl border mx-auto sm:mx-0">
                            <AvatarImage src={client.avatarUrl} alt={client.name} />
                            <AvatarFallback>{getInitials(client.name)}</AvatarFallback>
                        </Avatar>
                        {(client.activeMembershipId || client.subscription) && (
                            <Badge className="absolute -top-2 -right-2 bg-indigo-600 text-white border-2 border-background shadow-md">
                                <Award className="w-3 h-3 mr-1" /> Member
                            </Badge>
                        )}
                    </div>
                    <div className="space-y-2 flex-1">
                        <div className="flex flex-col sm:flex-row items-center sm:items-baseline gap-2">
                            <h1 className="text-2xl font-bold">{client.name}</h1>
                            {activeMembership && <Badge variant="secondary" className="bg-indigo-500/10 text-indigo-700 dark:text-indigo-300">Active Member</Badge>}
                        </div>
                        {isOwnerOrAdmin ? (
                            <div className="text-muted-foreground space-y-2">
                                <a href={`mailto:${client.email}`} className="flex items-center justify-center sm:justify-start gap-2 break-all hover:text-primary transition-colors"><Mail className="w-4 h-4 flex-shrink-0" /><span>{client.email}</span></a>
                                <div className="flex items-center justify-center sm:justify-start gap-2"><Phone className="w-4 h-4 flex-shrink-0" /><span>{client.phone ? formatPhoneNumber(client.phone) : 'N/A'}</span>
                                    <div className="ml-auto flex items-center gap-1">
                                        <a href={`tel:${client.phone}`} className="p-1.5 rounded-md hover:bg-muted"><Phone className="w-4 h-4 text-primary" /></a>
                                        <a href={`sms:${client.phone}`} className="p-1.5 rounded-md hover:bg-muted"><MessageSquare className="w-4 h-4 text-primary" /></a>
                                    </div>
                                </div>
                            </div>
                        ) : <p className="text-sm text-muted-foreground italic">Contact info restricted.</p>}
                    </div>
                     <Button variant="outline" asChild><Link href={`/clients/${client.id}/report`}><FileText className="mr-2 h-4 w-4"/>View Report</Link></Button>
                </CardContent>
            </Card>

            <ClientIntelBanner client={client} />
            
            <Tabs defaultValue="overview">
                <div className="w-full border-b bg-background">
                  <TabsList className="flex flex-wrap h-auto p-0 bg-transparent gap-1 mx-0">
                    <TabsTrigger value="overview">Overview</TabsTrigger>
                    <TabsTrigger value="history">History</TabsTrigger>
                    {isOwnerOrAdmin && <TabsTrigger value="referrals">Referrals</TabsTrigger>}
                    <TabsTrigger value="photos">Photos</TabsTrigger>
                    <TabsTrigger value="incidents">Incidents</TabsTrigger>
                    <TabsTrigger value="consents" className="relative">Consents{signedConsents && signedConsents.length > 0 && <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-black">{signedConsents.length}</span>}</TabsTrigger>
                  </TabsList>
                </div>
                
                <div className="space-y-6 pt-6">
                  <TabsContent value="overview" className="m-0 space-y-6">
                      <div className="grid gap-6 grid-cols-1 lg:grid-cols-3">
                          <div className="lg:col-span-2 space-y-6">
                              <Card>
                                  <CardHeader><CardTitle>Client Details</CardTitle></CardHeader>
                                  <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-y-4 gap-x-6">
                                      <div className="space-y-1"><p className="text-sm font-medium text-muted-foreground">Birthday</p><p>{client.birthday ? format(safeDate(client.birthday), 'MMMM d') : 'N/A'}</p></div>
                                      <div className="space-y-1"><p className="text-sm font-medium text-muted-foreground">Referral Source</p><p>{client.intel?.referralSource || 'N/A'}</p></div>
                                      {isOwnerOrAdmin && client.address && <div className="space-y-1 col-span-1 sm:col-span-2"><p className="text-sm font-medium text-muted-foreground flex items-center gap-2"><Home className="w-4 h-4"/>Address</p><p>{client.address.street}<br/>{client.address.city}, {client.address.state} {client.address.zip}</p></div>}
                                      {client.emergencyContact && <div className="space-y-1 col-span-1 sm:col-span-2"><p className="text-sm font-medium text-muted-foreground flex items-center gap-2"><UserIcon className="w-4 h-4"/>Emergency Contact</p><p>{client.emergencyContact.name} ({client.emergencyContact.relationship})<br/>{client.emergencyContact.phone ? formatPhoneNumber(client.emergencyContact.phone) : 'N/A'}</p></div>}
                                  </CardContent>
                              </Card>
                               <Card>
                                  <CardHeader><CardTitle>Active Offers</CardTitle></CardHeader>
                                  <CardContent>
                                    {(!activeMembership && (!client.activePackages || client.activePackages.length === 0)) ? (
                                        <p className="text-sm text-center text-muted-foreground py-8">No active memberships or packages.</p>
                                    ) : (
                                        <div className="space-y-4">
                                            {activeMembership && (
                                                <div className={cn("p-4 rounded-lg border", client.subscription ? {
                                                    'bg-indigo-500/10 border-indigo-500/20': client.subscription.status === 'active',
                                                    'bg-amber-500/10 border-amber-500/20': client.subscription.status === 'past_due',
                                                    'bg-muted/50': client.subscription.status === 'canceled',
                                                } : 'bg-indigo-500/10 border-indigo-500/20')}>
                                                     <div className="flex justify-between items-start">
                                                        <div>
                                                            <h4 className="font-semibold text-indigo-700 dark:text-indigo-300 flex items-center gap-2"><Award className="w-4 h-4" /> Active Membership</h4>
                                                            <p className="font-bold text-lg mt-1">{activeMembership.name}</p>
                                                        </div>
                                                        {isOwnerOrAdmin && (
                                                            <DropdownMenu>
                                                                <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8 -mt-1"><MoreHorizontal/></Button></DropdownMenuTrigger>
                                                                <DropdownMenuContent>
                                                                    {(!client.subscription || client.subscription.status !== 'past_due') && <DropdownMenuItem onClick={() => handleUpdateSubscriptionStatus('past_due')}>Mark as Past Due</DropdownMenuItem>}
                                                                    {(!client.subscription || client.subscription.status !== 'canceled') && <DropdownMenuItem className="text-destructive" onClick={() => handleUpdateSubscriptionStatus('canceled')}>Cancel Membership</DropdownMenuItem>}
                                                                    {(client.subscription && client.subscription.status !== 'active') && <DropdownMenuItem onClick={() => handleUpdateSubscriptionStatus('active')}>Reactivate</DropdownMenuItem>}
                                                                </DropdownMenuContent>
                                                            </DropdownMenu>
                                                        )}
                                                     </div>
                                                    <div className="mt-4 space-y-3">
                                                        <p className="text-[10px] uppercase font-bold text-muted-foreground">Monthly Perk Allotment</p>
                                                        <div className="space-y-2">
                                                            {activeMembership.includedServices?.map(perk => {
                                                                const used = client.subscription?.perkUsage?.[perk.id] || 0;
                                                                const isRedeemed = isPerkUsedInCycle(perk.id);
                                                                return (
                                                                    <div key={perk.id} className="flex justify-between items-center text-sm">
                                                                        <span className="flex items-center gap-2">{isRedeemed ? <CheckCircle className="w-4 h-4 text-green-500" /> : <Star className="w-4 h-4 text-indigo-400" />}{perk.name}</span>
                                                                        <span className="font-medium">{used} / {perk.quantity} used</span>
                                                                    </div>
                                                                )
                                                            })}
                                                        </div>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                  </CardContent>
                              </Card>
                          </div>
                           <div className="lg:col-span-1 space-y-6">
                               <Card>
                                   <CardHeader className="flex flex-row items-center justify-between"><CardTitle>Client Accounts</CardTitle>{isOwnerOrAdmin && <Button variant="ghost" size="icon" onClick={handleReconcileLTV} title="Reconcile LTV"><RefreshCw className="h-4 w-4" /></Button>}</CardHeader>
                                   <CardContent className="space-y-4">
                                      <div className="p-4 rounded-lg bg-primary/5 border border-primary/10"><div className="text-sm text-muted-foreground">Lifetime Value</div><div className="text-3xl font-bold text-primary">${safeLTV.toFixed(2)}</div></div>
                                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div className="p-4 rounded-lg bg-muted/50"><div className="text-sm text-muted-foreground">Store Credit</div><div className="text-2xl font-bold">${(client.walletCredit || 0).toFixed(2)}</div></div>
                                        <div className="p-4 rounded-lg bg-destructive/10"><div className="text-sm font-medium text-destructive">Outstanding Balance</div><div className="text-2xl font-bold text-destructive">${(client.outstandingBalance || 0).toFixed(2)}</div></div>
                                      </div>
                                   </CardContent>
                                    {isOwnerOrAdmin && (
                                        <>
                                            <Separator />
                                            <Accordion type="single" collapsible className="w-full">
                                                <AccordionItem value="unpaid-fees" className="border-none">
                                                    <AccordionTrigger className="px-4 py-2 hover:no-underline"><h4 className="font-medium">Unpaid Fees ({client.unpaidFees?.length || 0})</h4></AccordionTrigger>
                                                    <AccordionContent className="px-4 pb-4">
                                                        <div className="space-y-2">
                                                            {client.unpaidFees && client.unpaidFees.length > 0 ? client.unpaidFees.map((fee: any) => {
                                                                const feeStaff = staff?.find(s => s.id === fee.staffId);
                                                                return (
                                                                    <div key={fee.feeId} className="flex items-center justify-between p-2 bg-muted/50 rounded-md">
                                                                        <div className="min-w-0 pr-2">
                                                                            <p className="text-sm font-medium truncate">{fee.reason}</p>
                                                                            <div className="flex flex-col text-[10px] text-muted-foreground">
                                                                                <span>Apt on {format(safeDate(fee.appointmentDate), 'MMM d, yyyy')}</span>
                                                                                {feeStaff && <span className="font-bold text-primary/80 truncate">Pro: {feeStaff.name}</span>}
                                                                            </div>
                                                                        </div>
                                                                        <div className="flex items-center gap-2 shrink-0">
                                                                            <span className="font-semibold text-destructive text-sm">${fee.feeAmount.toFixed(2)}</span>
                                                                            <Button size="xs" variant="outline" onClick={() => { setFeeToWaive(fee); setIsWaiveDialogOpen(true); }}>Waive</Button>
                                                                        </div>
                                                                    </div>
                                                                )
                                                            }) : <p className="text-xs text-muted-foreground italic">No unpaid fees.</p>}
                                                        </div>
                                                    </AccordionContent>
                                                </AccordionItem>
                                                
                                                <AccordionItem value="waived-history" className="border-none">
                                                    <AccordionTrigger className="px-4 py-2 hover:no-underline"><h4 className="font-medium text-muted-foreground">Waiver History ({client.waivedFees?.length || 0})</h4></AccordionTrigger>
                                                    <AccordionContent className="px-4 pb-4">
                                                        <div className="space-y-2">
                                                            {client.waivedFees && client.waivedFees.length > 0 ? client.waivedFees.map((waiver: WaivedFee) => (
                                                                <div key={waiver.feeId} className="p-2 border rounded-md bg-muted/20 text-xs">
                                                                    <div className="flex justify-between items-start">
                                                                        <span className="font-bold text-muted-foreground">{waiver.reason}</span>
                                                                        <span className="font-mono text-muted-foreground line-through">${waiver.feeAmount.toFixed(2)}</span>
                                                                    </div>
                                                                    <p className="text-[10px] mt-1 italic">Authorized by {waiver.waivedByName || 'Admin'} on {format(safeDate(waiver.waivedAt), 'MMM d, yyyy')}</p>
                                                                </div>
                                                            )) : <p className="text-xs text-muted-foreground italic">No history of waived fees.</p>}
                                                        </div>
                                                    </AccordionContent>
                                                </AccordionItem>
                                            </Accordion>
                                        </>
                                    )}
                                  <CardFooter className="pt-2">
                                      <Button 
                                        disabled={!client.outstandingBalance || client.outstandingBalance === 0} 
                                        className="w-full"
                                        asChild
                                      >
                                        <Link href={`/pos?payer_id=${client.id}&action=settle`}>Settle Balance in POS</Link>
                                      </Button>
                                  </CardFooter>
                              </Card>
                               <LoyaltyStatusCard client={client} appointments={pastAppointments} discounts={discounts || []} />
                           </div>
                      </div>
                  </TabsContent>
                  <TabsContent value="history" className="m-0 space-y-6">
                      <Card><CardHeader><CardTitle>Upcoming Appointments</CardTitle></CardHeader><CardContent className="space-y-4">{upcomingAppointments.length > 0 ? upcomingAppointments.map((apt) => <AppointmentHistoryCard key={apt.id} appointment={apt} onRebook={setAppointmentToRebook} />) : <p className="text-sm text-muted-foreground text-center col-span-full py-4">No upcoming appointments.</p>}</CardContent></Card>
                       <Card><CardHeader><CardTitle>Past Appointments</CardTitle></CardHeader><CardContent className="space-y-4">{pastAppointments.length > 0 ? pastAppointments.map((apt) => <AppointmentHistoryCard key={apt.id} appointment={apt} onRebook={setAppointmentToRebook} />) : <p className="text-sm text-muted-foreground text-center col-span-full py-4">No past appointments.</p>}</CardContent></Card>
                  </TabsContent>
                  <TabsContent value="referrals" className="m-0">
                      {isOwnerOrAdmin && (
                        <Card>
                            <CardHeader><CardTitle>Referral Program</CardTitle></CardHeader>
                            <CardContent className="space-y-6">
                                <div className="space-y-2">
                                    <Label htmlFor="referral-code">Unique Referral Code</Label>
                                    <div className="grid grid-cols-[1fr,auto] gap-2"><Input id="referral-code" value={editableReferralCode} onChange={e => { setEditableReferralCode(e.target.value); setIsCodeDirty(e.target.value !== client.referralCode); }}/>{isCodeDirty ? <Button onClick={() => { updateDocumentNonBlocking(clientDocRefReal, { referralCode: editableReferralCode }); setIsCodeDirty(false); }}><Save className="w-4 h-4 mr-2" /> Save</Button> : <Button variant="outline" onClick={handleCopyReferralCode}><Copy className="w-4 h-4 mr-2" /> Copy</Button>}</div>
                                </div>
                            </CardContent>
                        </Card>
                      )}
                  </TabsContent>
                  <TabsContent value="photos" className="m-0">
                      <Card>
                          <CardHeader><div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4"><div><CardTitle>Photo Gallery</CardTitle></div><ImageUpload onImageUploaded={handleNewPhotoUpload} /></div></CardHeader>
                          <CardContent>{photos.length > 0 ? <div className="grid grid-cols-2 md:grid-cols-4 gap-4">{photos.map((photo, index) => <div key={index} className="group relative aspect-square" onClick={() => setSelectedPhoto(photo)}><Image src={photo.url} alt={photo.label} fill className="object-cover rounded-md transition-transform group-hover:scale-105" /><div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"><Eye className="w-8 h-8 text-white" /></div></div>)}</div> : <p className="text-center text-muted-foreground py-16">No photos yet.</p>}</CardContent>
                      </Card>
                  </TabsContent>
                  <TabsContent value="incidents" className="m-0"><Card><CardHeader className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"><div><CardTitle>Incident Log</CardTitle></div><Button variant="outline" onClick={() => setIsLogIncidentOpen(true)} className="w-full sm:w-auto"><PlusCircle className="mr-2 h-4 w-4"/>Log New Incident</Button></CardHeader><CardContent className="space-y-4">{(client.intel?.incidents || []).map(incident => <Card key={incident.id}><CardContent className="p-4"><div className="grid grid-cols-[1fr,auto] gap-4"><div><p className="font-semibold">{incident.type}</p><p className="text-sm text-muted-foreground">{format(safeDate(incident.date), 'MMM d, yyyy h:mm a')}</p></div><Badge variant={incident.severity === 'Severe' ? 'destructive' : 'secondary'}>{incident.severity}</Badge></div><p className="text-sm mt-2">{incident.description}</p></CardContent></Card>)}</CardContent></Card></TabsContent>
                   <TabsContent value="consents" className="m-0"><Card><CardHeader><div><CardTitle>Signed Forms</CardTitle></div></CardHeader><CardContent>{signedConsents && signedConsents.length > 0 ? <div className="space-y-4">{signedConsents.map((consent: any) => <Card key={consent.id} className="hover:bg-muted/50 transition-colors"><CardContent className="p-4 flex items-center justify-between"><div className="flex items-center gap-3"><div className="p-2 bg-primary/10 rounded-md"><FileSignature className="w-5 h-5 text-primary" /></div><div><p className="font-semibold">{consent.formTitle}</p><p className="text-sm text-muted-foreground">Signed {format(safeDate(consent.signedAt), 'PPP p')}</p></div></div><Button variant="outline" onClick={() => setViewingConsent(consent)}>View</Button></CardContent></Card>)}</div> : <div className="border-2 border-dashed rounded-lg p-12 text-center"><FileText className="w-10 h-10 text-muted-foreground mx-auto mb-4" /><h3 className="font-semibold text-lg">No Forms on File</h3></div>}</CardContent></Card></TabsContent>
                </div>
            </Tabs>
      </main>
      
      <AddFormulaDialog open={isAddFormulaOpen} onOpenChange={setIsAddFormulaOpen} onSave={handleSaveFormula} />
      <LogIncidentDialog open={isLogIncidentOpen} onOpenChange={setIsLogIncidentOpen} client={client} onIncidentLogged={handleIncidentLogged} />
      <EditClientDialog open={isEditClientOpen} onOpenChange={setIsEditClientOpen} client={client} onSave={handleUpdateClient} />
      <AddAppointmentDialog open={isAddAppointmentOpen} onOpenChange={setIsAddAppointmentOpen} appointmentToRebook={appointmentToRebook} memberships={memberships || []} onConfirm={() => setIsAddAppointmentOpen(false)}/>
      
      <WaiveFeeDialog 
        open={isWaiveDialogOpen} 
        onOpenChange={setIsWaiveDialogOpen} 
        fee={feeToWaive} 
        onConfirm={handleConfirmWaive} 
        staff={staff || []}
      />

        <Dialog open={!!viewingConsent} onOpenChange={() => setViewingConsent(null)}>
            <DialogContent className="max-w-2xl">
                <DialogHeader className="print:hidden">
                    <DialogTitle>{viewingConsent?.formTitle}</DialogTitle>
                    <DialogDescription>Signed on {viewingConsent ? format(safeDate(viewingConsent.signedAt), 'PPP p') : ''}</DialogDescription>
                </DialogHeader>
                <ScrollArea className="max-h-[60vh]">
                <div className="py-4 space-y-4 px-6 print:p-0">
                {viewingConsent && (
                    <div className="space-y-6">
                        {Object.entries(viewingConsent.formData || {}).map(([key, value]: [string, any]) => (
                            <div key={key} className="space-y-1 pt-2">
                                <Label className="font-bold text-xs uppercase text-muted-foreground">{key}</Label>
                                <div className="p-3 bg-muted/50 rounded-lg border">{String(value)}</div>
                            </div>
                        ))}
                    </div>
                )}
                </div>
                </ScrollArea>
                <DialogFooter className="print:hidden"><Button variant="outline" onClick={() => window.print()}>Print</Button><Button onClick={() => setViewingConsent(null)}>Close</Button></DialogFooter>
            </DialogContent>
        </Dialog>
    </div>
  );
}
