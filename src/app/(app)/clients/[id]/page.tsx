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
import { ArrowLeft, Edit, Mail, Phone, DollarSign, Calendar, FileText, FlaskConical, PlusCircle, ShieldPlus, AlertTriangle, Ear, Upload, Eye, ShieldAlert, BadgeInfo, Ban, MessageSquare, Home, User as UserIcon, Gift, Copy, Save, Award, Repeat, CheckCircle, Star, Percent, Loader, MoreHorizontal, XCircle, RefreshCw, FileSignature, Printer } from 'lucide-react';
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
import type { Client, Appointment, Service, CustomFormula, Incident, Membership, Package, ConsentForm, Event, Discount } from '@/lib/data';
import { useTenant } from '@/context/TenantContext';
import { Progress } from '@/components/ui/progress';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { PrintableConsentForm } from '@/components/consents/PrintableConsentForm';

type ClientPhoto = {
  url: string;
  label: string;
};

/**
 * Utility to safely convert Firestore/API values to Date objects.
 */
const safeDate = (val: any): Date => {
    if (!val) return new Date();
    if (val instanceof Date) return val;
    if (typeof val?.toDate === 'function') return val.toDate();
    if (typeof val === 'string') return parseISO(val);
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
  const [photos, setPhotos] = useState<ClientPhoto[]>([]);
  const [selectedPhoto, setSelectedPhoto] = useState<ClientPhoto | null>(null);
  const [feeToWaive, setFeeToWaive] = useState<any | null>(null);

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
        const collectedPhotos: ClientPhoto[] = [];
        if (client.avatarUrl) {
            // collectedPhotos.push({ url: client.avatarUrl, label: 'Profile Avatar' });
        }
        
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
    
    // Check if the usage was in the current billing cycle
    const lastUsedStr = client.subscription.perkLastUsed;
    if (!lastUsedStr) return false;

    const lastUsed = parseISO(lastUsedStr);
    const nextBilling = parseISO(client.subscription.nextBillingDate);
    const cycleStart = subMonths(nextBilling, 1);

    const isCurrentCycle = isAfter(lastUsed, cycleStart);
    if (!isCurrentCycle) return false;

    // If we just want to know if ANY perk was used this cycle
    if (perkId === 'any') return true;

    // Now check the quantity for this specific perk
    const usageCount = client.subscription.perkUsage?.[perkId] || 0;
    
    // Handle both specific service perks and the retail discount perk
    let perkDefQuantity = 1;
    if (perkId === 'retail_discount') {
        perkDefQuantity = activeMembership?.retailDiscountLimit || 0;
    } else {
        const perkDef = activeMembership?.includedServices?.find(s => s.id === perkId) || activeMembership?.includedAddOns?.find(a => a.id === perkId);
        perkDefQuantity = perkDef?.quantity || 1;
    }
    
    // If quantity is 0, it means unlimited
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

    toast({
        title: "LTV Reconciled",
        description: `${client.name}'s lifetime value has been recalculated based on their transaction history: $${totalSpent.toFixed(2)}`
    });
  };

  const handleSaveFormula = (formula: CustomFormula) => {
    if (!client || !firestore || !tenantId) return;
    const clientRef = doc(firestore, `tenants/${tenantId}/clients`, client.id);
    updateDocumentNonBlocking(clientRef, {
        customFormulas: arrayUnion(formula)
    });
    toast({
        title: "Formula Saved",
        description: `"${formula.name}" has been added to ${client.name}'s profile.`
    });
    setIsAddFormulaOpen(false);
  };

  const isLoadingStatus = isUserLoading || isTenantLoading || clientLoading || signedConsentsLoading;

  if (isLoadingStatus) {
      return (
          <div className="flex min-h-screen w-full flex-col bg-muted/40">
            <AppHeader title="Client Profile" />
            <main className="flex-1 p-4 md:p-6 flex items-center justify-center">
              <Loader className="w-8 h-8 animate-spin" />
            </main>
          </div>
      )
  }

    if (clientError) {
        return (
            <div className="flex min-h-screen w-full flex-col">
                <AppHeader title="Error" />
                <main className="flex-1 p-4 md:p-6 flex items-center justify-center">
                    <Card className="w-full max-w-lg">
                        <CardHeader>
                            <CardTitle className="text-destructive">Access Denied</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <p>You do not have permission to view this client&apos;s data.</p>
                            <p className="text-xs text-muted-foreground mt-4">{clientError.message}</p>
                        </CardContent>
                    </Card>
                </main>
            </div>
        );
    }
  
  if (!client) {
    notFound();
  }

  if (!tenantId) return null;

  const clientDocRefReal = doc(firestore, `tenants/${tenantId}/clients`, client.id);

  const upcomingAppointments = appointmentsForThisClient.filter(apt => safeDate(apt.startTime) > new Date() && apt.status !== 'cancelled');
  const pastAppointments = appointmentsForThisClient.filter(apt => safeDate(apt.startTime) <= new Date()).sort((a,b) => safeDate(b.startTime).getTime() - safeDate(a.startTime).getTime());

  const handleRebook = (appointment: Appointment) => {
    setAppointmentToRebook(appointment);
    setIsAddAppointmentOpen(true);
  };

  const handleUpdateClient = (updatedClientData: Partial<Client>) => {
    updateDocumentNonBlocking(clientDocRefReal, updatedClientData);
    toast({
      title: 'Client Updated',
      description: `${client.name}'s profile has been successfully updated.`,
    });
    setIsEditClientOpen(false);
  };
  
  const handleUpdateSubscriptionStatus = (status: 'active' | 'past_due' | 'canceled') => {
      const subscriptionUpdate = {
          'subscription.status': status
      };
      updateDocumentNonBlocking(clientDocRefReal, subscriptionUpdate);
      toast({
          title: 'Membership Updated',
          description: `${client.name}'s membership has been marked as ${status}.`
      });
  };

  const handleNewPhotoUpload = (url: string) => {
      if (url) {
          const newPhoto: ClientPhoto = { url, label: `Uploaded on ${format(new Date(), 'MMM d, yyyy')}` };
          setPhotos(prev => [newPhoto, ...prev]);
          toast({
              title: "Photo Uploaded!",
              description: "The new image has been added to the client's gallery."
          })
      }
  }
  
   const handleIncidentLogged = (incidentData: IncidentFormData) => {
    const newIncident: Incident = {
        ...incidentData,
        id: `inc-${Date.now()}`,
        date: new Date().toISOString(),
    };
    updateDocumentNonBlocking(clientDocRefReal, {
        'intel.hasIncidents': true,
        'intel.incidents': arrayUnion(newIncident)
    });
    toast({
      title: "Incident Logged",
      description: `A new incident has been recorded for ${client.name}.`,
    });
    errorEmitter.emit('incident-reported', {
        clientName: client.name,
        clientId: client.id,
        incidentType: incidentData.type,
    });
  };
  
  const handleCopyReferralCode = () => {
    if (editableReferralCode) {
        navigator.clipboard.writeText(editableReferralCode);
        toast({
            title: "Referral Code Copied",
            description: "The client's referral code has been copied to your clipboard.",
        })
    }
  }

  const handleCodeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setEditableReferralCode(e.target.value);
    setIsCodeDirty(e.target.value !== client.referralCode);
  }

  const handleSaveReferralCode = () => {
      const trimmedCode = editableReferralCode.trim();
      if (!trimmedCode) {
          toast({
              variant: "destructive",
              title: "Invalid Code",
              description: "Referral code cannot be empty.",
          });
          return;
      }
      
      const isDuplicate = allClients?.some(c => c.id !== client.id && c.referralCode?.toLowerCase() === trimmedCode.toLowerCase());

      if (isDuplicate) {
          toast({
              variant: "destructive",
              title: "Duplicate Referral Code",
              description: "This code is already in use by another client. Please choose a unique one.",
          });
          return;
      }
      updateDocumentNonBlocking(clientDocRefReal, { referralCode: trimmedCode });
      setIsCodeDirty(false);
      toast({
          title: "Referral Code Updated",
          description: "The new referral code has been saved.",
      });
  };
  
  const handleWaiveFee = async () => {
    if (!feeToWaive || !client || !firestore || !tenantId) return;

    const clientRef = doc(firestore, `tenants/${tenantId}/clients`, client.id);
    const appointmentRef = doc(firestore, `tenants/${tenantId}/appointments`, feeToWaive.appointmentId);
    
    const newUnpaidFees = (client.unpaidFees || []).filter((f: any) => f.feeId !== feeToWaive.feeId);
    const newBalance = (client.outstandingBalance || 0) - feeToWaive.feeAmount;

    const batch = writeBatch(firestore);
    
    batch.update(clientRef, {
        unpaidFees: newUnpaidFees,
        outstandingBalance: Math.max(0, newBalance)
    });
    
    batch.update(appointmentRef, {
        cancellationFeeWaived: true
    });

    try {
        await batch.commit();
        toast({
            title: "Fee Waived",
            description: `The $${feeToWaive.feeAmount.toFixed(2)} fee has been waived.`,
        });
    } catch (error) {
        console.error("Error waiving fee:", error);
        toast({ variant: 'destructive', title: 'Error', description: 'Could not waive the fee.' });
    }
    
    setFeeToWaive(null);
  };


  return (
    <div className="flex min-h-screen w-full flex-col bg-muted/40">
      <AppHeader title="Client Profile" />
      <main className="flex-1 p-4 md:p-6 space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <Button variant="outline" size="sm" asChild>
                    <Link href="/clients">
                        <ArrowLeft className="h-4 w-4 mr-2" />
                        Back to Clients
                    </Link>
                </Button>
                {isOwnerOrAdmin && (
                    <Button variant="outline" size="sm" onClick={() => setIsEditClientOpen(true)}>
                        <Edit className="h-4 w-4 mr-2" />
                        Edit Profile
                    </Button>
                )}
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
                                <a href={`mailto:${client.email}`} className="flex items-center justify-center sm:justify-start gap-2 break-all hover:text-primary transition-colors">
                                    <Mail className="w-4 h-4 flex-shrink-0" />
                                    <span className="break-all">{client.email}</span>
                                </a>
                                <div className="flex items-center justify-center sm:justify-start gap-2">
                                    <Phone className="w-4 h-4 flex-shrink-0" />
                                    <span>{client.phone ? formatPhoneNumber(client.phone) : 'N/A'}</span>
                                    <div className="ml-auto flex items-center gap-1">
                                        <a href={`tel:${client.phone}`} className="p-1.5 rounded-md hover:bg-muted">
                                            <Phone className="w-4 h-4 text-primary" />
                                        </a>
                                        <a href={`sms:${client.phone}`} className="p-1.5 rounded-md hover:bg-muted"><MessageSquare className="w-4 h-4 text-primary" /></a>
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <p className="text-sm text-muted-foreground italic">Contact info restricted by business owner.</p>
                        )}
                    </div>
                     <Button variant="outline" asChild>
                        <Link href={`/clients/${client.id}/report`}>
                            <FileText className="mr-2 h-4 w-4"/> View Report
                        </Link>
                    </Button>
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
                    <TabsTrigger value="consents" className="relative">
                        Consents
                        {signedConsents && signedConsents.length > 0 && (
                            <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-black">{signedConsents.length}</span>
                        )}
                    </TabsTrigger>
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
                                                                        <span className="flex items-center gap-2">
                                                                            {isRedeemed ? <CheckCircle className="w-4 h-4 text-green-500" /> : <Star className="w-4 h-4 text-indigo-400" />}
                                                                            {perk.name}
                                                                        </span>
                                                                        <span className="font-medium">{used} / {perk.quantity} used</span>
                                                                    </div>
                                                                )
                                                            })}
                                                            {activeMembership.retailDiscount && (
                                                                <div className="flex justify-between items-center text-sm">
                                                                    <span className="flex items-center gap-2">
                                                                        {isPerkUsedInCycle('retail_discount') ? <CheckCircle className="w-4 h-4 text-green-500" /> : <Percent className="w-4 h-4 text-indigo-400" />}
                                                                        Retail Discount ({activeMembership.retailDiscount}%)
                                                                    </span>
                                                                    <span className="font-medium">
                                                                        {activeMembership.retailDiscountLimit === 0 
                                                                            ? 'Unlimited' 
                                                                            : `${client.subscription?.perkUsage?.['retail_discount'] || 0} / ${activeMembership.retailDiscountLimit} used`
                                                                        }
                                                                    </span>
                                                                </div>
                                                            )}
                                                        </div>
                                                        <div className="grid grid-cols-2 gap-4 pt-2 border-t">
                                                            <div className="space-y-1">
                                                                <p className="text-[10px] uppercase font-bold text-muted-foreground">Status</p>
                                                                <Badge variant="outline" className={cn(isPerkUsedInCycle('any') ? "bg-green-100 text-green-800" : "bg-indigo-600 text-white")}>
                                                                    {isPerkUsedInCycle('any') ? 'Perks Redeemed' : 'Ready to Use'}
                                                                </Badge>
                                                            </div>
                                                            <div className="space-y-1 text-right">
                                                                <p className="text-[10px] uppercase font-bold text-muted-foreground">Next Bill</p>
                                                                <p className="text-sm font-semibold">{client.subscription?.nextBillingDate ? format(safeDate(client.subscription.nextBillingDate), 'MMM d, yyyy') : 'N/A'}</p>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            )}
                                            {(client.activePackages && client.activePackages.length > 0) && (
                                                <div className="space-y-2">
                                                    <h4 className="font-semibold text-sm">Active Packages</h4>
                                                    {client.activePackages.map((pack, index) => {
                                                         const packageDetails = packages?.find(pkg => pkg.id === pack.packageId);
                                                         const serviceDetails = services?.find(s => s.id === packageDetails?.serviceId);
                                                         if (!packageDetails || !serviceDetails) return null;
                                                         return (
                                                            <div key={index} className="p-3 rounded-md bg-muted/50 flex justify-between items-center border">
                                                                <div>
                                                                    <p className="font-medium text-sm flex items-center gap-2"><Repeat className="w-4 h-4 text-teal-500" /> {packageDetails.name}</p>
                                                                    <p className="text-[10px] text-muted-foreground pl-6">{serviceDetails.name}</p>
                                                                </div>
                                                                <div className="text-right">
                                                                    <p className="font-bold text-lg">{pack.sessionsRemaining}<span className="text-sm font-normal text-muted-foreground"> / {packageDetails.sessions}</span></p>
                                                                    <p className="text-[10px] text-muted-foreground uppercase">Left</p>
                                                                </div>
                                                            </div>
                                                         )
                                                    })}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                  </CardContent>
                              </Card>
                          </div>
                           <div className="lg:col-span-1 space-y-6">
                               <Card>
                                   <CardHeader className="flex flex-row items-center justify-between">
                                       <CardTitle>Client Accounts</CardTitle>
                                       {isOwnerOrAdmin && (
                                           <Button variant="ghost" size="icon" onClick={handleReconcileLTV} title="Reconcile LTV">
                                               <RefreshCw className="h-4 w-4" />
                                           </Button>
                                       )}
                                   </CardHeader>
                                   <CardContent className="space-y-4">
                                      <div className="p-4 rounded-lg bg-primary/5 border border-primary/10">
                                          <div className="text-sm text-muted-foreground">Lifetime Value</div>
                                          <div className="text-3xl font-bold text-primary">${safeLTV.toFixed(2)}</div>
                                      </div>
                                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div className="p-4 rounded-lg bg-muted/50"><div className="text-sm text-muted-foreground">Store Credit</div><div className="text-2xl font-bold">${(client.walletCredit || 0).toFixed(2)}</div></div>
                                        <div className="p-4 rounded-lg bg-destructive/10"><div className="text-sm font-medium text-destructive">Outstanding Balance</div><div className="text-2xl font-bold text-destructive">${(client.outstandingBalance || 0).toFixed(2)}</div></div>
                                      </div>
                                   </CardContent>
                                    {(isOwnerOrAdmin && client.unpaidFees && client.unpaidFees.length > 0) && (
                                        <>
                                            <Separator />
                                            <CardContent className="p-4">
                                                <h4 className="font-medium mb-2">Unpaid Fees</h4>
                                                <div className="space-y-2">
                                                    {client.unpaidFees.map((fee: any) => {
                                                        const feeStaff = staff?.find(s => s.id === fee.staffId);
                                                        return (
                                                            <div key={fee.feeId} className="flex items-center justify-between p-2 bg-muted/50 rounded-md">
                                                                <div>
                                                                    <p className="text-sm font-medium">{fee.reason}</p>
                                                                    <div className="flex flex-col text-xs text-muted-foreground">
                                                                        <span>From apt on {format(safeDate(fee.appointmentDate), 'PPP')}</span>
                                                                        {feeStaff && <span className="font-medium text-primary/80">Associated Pro: {feeStaff.name}</span>}
                                                                    </div>
                                                                </div>
                                                                <div className="flex items-center gap-2">
                                                                    <span className="font-semibold text-destructive">${fee.feeAmount.toFixed(2)}</span>
                                                                    <Button size="xs" variant="outline" onClick={() => setFeeToWaive(fee)}>Waive</Button>
                                                                </div>
                                                            </div>
                                                        )
                                                    })}
                                                </div>
                                            </CardContent>
                                        </>
                                    )}
                                  <CardFooter>
                                      <Button disabled={!client.outstandingBalance || client.outstandingBalance === 0} className="w-full">Settle Balance in POS</Button>
                                  </CardFooter>
                              </Card>
                               <LoyaltyStatusCard client={client} appointments={pastAppointments} discounts={discounts || []} />
                              <Card>
                                <Tabs defaultValue="formulas" className="w-full">
                                    <TabsList className="grid w-full grid-cols-2">
                                        <TabsTrigger value="formulas">Formulas</TabsTrigger>
                                        <TabsTrigger value="notes">Notes</TabsTrigger>
                                    </TabsList>
                                    <TabsContent value="formulas" className="m-0">
                                        <CardContent className="p-4 space-y-2">
                                            {client.customFormulas && client.customFormulas.length > 0 ? (
                                                <Accordion type="multiple" className="w-full space-y-2">
                                                    {client.customFormulas.map(formula => <FormulaCard key={formula.name} formula={formula} />)}
                                                </Accordion>
                                            ) : <div className="text-center text-sm text-muted-foreground py-8"><p>No formulas saved.</p></div>}
                                            <Button variant="outline" className="w-full" onClick={() => setIsAddFormulaOpen(true)}><PlusCircle className="w-4 h-4 mr-2" /> Add New Formula</Button>
                                        </CardContent>
                                    </TabsContent>
                                    <TabsContent value="notes" className="m-0">
                                        <CardContent className="p-4 space-y-4">
                                            <Accordion type="multiple" defaultValue={['goals', 'routine', 'history', 'general']} className="w-full space-y-2">
                                                <AccordionItem value="goals" className="border-b-0">
                                                    <AccordionTrigger className="p-3 bg-muted/50 rounded-md hover:no-underline text-base font-semibold">Client Goals</AccordionTrigger>
                                                    <AccordionContent className="p-4 border rounded-b-md">
                                                        <p className="text-sm text-muted-foreground whitespace-pre-wrap">{client.notes?.goals || 'No goals noted.'}</p>
                                                    </AccordionContent>
                                                </AccordionItem>
                                                <AccordionItem value="routine" className="border-b-0">
                                                    <AccordionTrigger className="p-3 bg-muted/50 rounded-md hover:no-underline text-base font-semibold">Current Routine & Products</AccordionTrigger>
                                                    <AccordionContent className="p-4 border rounded-b-md">
                                                        <p className="text-sm text-muted-foreground whitespace-pre-wrap">{client.notes?.routine || 'No routine noted.'}</p>
                                                    </AccordionContent>
                                                </AccordionItem>
                                                <AccordionItem value="history" className="border-b-0">
                                                    <AccordionTrigger className="p-3 bg-muted/50 rounded-md hover:no-underline text-base font-semibold">Past Service History</AccordionTrigger>
                                                    <AccordionContent className="p-4 border rounded-b-md">
                                                        <p className="text-sm text-muted-foreground whitespace-pre-wrap">{client.notes?.history || 'No history noted.'}</p>
                                                    </AccordionContent>
                                                </AccordionItem>
                                                <AccordionItem value="general" className="border-b-0">
                                                    <AccordionTrigger className="p-3 bg-muted/50 rounded-md hover:no-underline text-base font-semibold">Other Notes</AccordionTrigger>
                                                    <AccordionContent className="p-4 border rounded-b-md">
                                                        <p className="text-sm text-muted-foreground whitespace-pre-wrap">{client.notes?.general || 'No other notes.'}</p>
                                                    </AccordionContent>
                                                </AccordionItem>
                                            </Accordion>
                                        </CardContent>
                                    </TabsContent>
                                </Tabs>
                            </Card>
                           </div>
                      </div>

                  </TabsContent>
                  <TabsContent value="history" className="m-0 space-y-6">
                      <Card>
                          <CardHeader><CardTitle>Upcoming Appointments</CardTitle></CardHeader>
                          <CardContent className="space-y-4">
                              {upcomingAppointments.length > 0 ? upcomingAppointments.map((apt) => <AppointmentHistoryCard key={apt.id} appointment={apt} onRebook={handleRebook} />) : <p className="text-sm text-muted-foreground text-center col-span-full py-4">No upcoming appointments.</p>}
                          </CardContent>
                      </Card>
                       <Card>
                          <CardHeader><CardTitle>Past Appointments</CardTitle></CardHeader>
                          <CardContent className="space-y-4">
                              {pastAppointments.length > 0 ? pastAppointments.map((apt) => <AppointmentHistoryCard key={apt.id} appointment={apt} onRebook={handleRebook} />) : <p className="text-sm text-muted-foreground text-center col-span-full py-4">No past appointments.</p>}
                          </CardContent>
                      </Card>
                  </TabsContent>
                   <TabsContent value="referrals" className="m-0">
                      {isOwnerOrAdmin && (
                        <Card>
                            <CardHeader><CardTitle>Referral Program</CardTitle><CardDescription>Manage this client's referral activity.</CardDescription></CardHeader>
                            <CardContent className="space-y-6">
                                <div className="space-y-2">
                                    <Label htmlFor="referral-code">Unique Referral Code</Label>
                                    <div className="grid grid-cols-[1fr,auto] gap-2">
                                        <Input 
                                            id="referral-code" 
                                            value={editableReferralCode} 
                                            onChange={handleCodeChange}
                                        />
                                        {isCodeDirty ? (
                                            <Button onClick={handleSaveReferralCode}><Save className="w-4 h-4 mr-2" /> Save</Button>
                                        ) : (
                                            <Button variant="outline" onClick={handleCopyReferralCode}><Copy className="w-4 h-4 mr-2" /> Copy</Button>
                                        )}
                                    </div>
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <div className="p-4 rounded-lg bg-muted/50"><div className="text-sm text-muted-foreground">Referred By</div><div className="text-lg font-semibold">{client.referredBy || 'N/A'}</div></div>
                                    <div className="p-4 rounded-lg bg-muted/50"><div className="text-sm text-muted-foreground">Successful Referrals</div><div className="text-lg font-semibold">{client.successfulReferrals?.length || 0}</div></div>
                                </div>
                                {client.successfulReferrals && client.successfulReferrals.length > 0 && (
                                    <div>
                                        <h4 className="font-medium text-sm mb-2">Referred Clients</h4>
                                        <div className="space-y-2">
                                            {client.successfulReferrals.map((name, index) => (
                                                <div key={index} className="flex items-center p-3 rounded-md bg-muted/50"><UserIcon className="w-4 h-4 mr-3 text-muted-foreground" /><span className="text-sm">{name}</span></div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                      )}
                  </TabsContent>
                  <TabsContent value="photos" className="m-0">
                      <Card>
                          <CardHeader><div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4"><div><CardTitle>Photo Gallery</CardTitle><CardDescription>Inspiration and before/after photos.</CardDescription></div><ImageUpload onImageUploaded={handleNewPhotoUpload} /></div></CardHeader>
                          <CardContent>
                              {photos.length > 0 ? (
                                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                      {photos.map((photo, index) => (
                                          <div key={index} className="group relative aspect-square" onClick={() => setSelectedPhoto(photo)}>
                                              <Image src={photo.url} alt={photo.label} fill className="object-cover rounded-md transition-transform group-hover:scale-105" />
                                              <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"><Eye className="w-8 h-8 text-white" /></div>
                                              <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-2 rounded-b-md"><p className="text-white text-xs truncate">{photo.label}</p></div>
                                          </div>
                                      ))}
                                  </div>
                              ) : (
                                  <div className="text-center py-16 px-6 border-2 border-dashed rounded-lg"><p className="text-muted-foreground">No photos have been added for {client.name} yet.</p></div>
                              )}
                          </CardContent>
                      </Card>
                  </TabsContent>
                  <TabsContent value="incidents" className="m-0">
                       <Card>
                          <CardHeader className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"><div><CardTitle>Incident Log</CardTitle><CardDescription>A secure log of any incidents or issues.</CardDescription></div><Button variant="outline" onClick={() => setIsLogIncidentOpen(true)} className="w-full sm:w-auto"><PlusCircle className="mr-2 h-4 w-4"/>Log New Incident</Button></CardHeader>
                          <CardContent className="space-y-4">
                             {client.intel?.incidents && client.intel.incidents.length > 0 ? (
                                 client.intel.incidents.map(incident => (
                                     <Card key={incident.id}>
                                         <CardContent className="p-4">
                                             <div className="grid grid-cols-[1fr,auto] gap-4">
                                                 <div>
                                                     <p className="font-semibold">{incident.type}</p>
                                                     <p className="text-sm text-muted-foreground">{format(safeDate(incident.date), 'MMM d, yyyy h:mm a')}</p>
                                                 </div>
                                                 <Badge variant={incident.severity === 'Severe' ? 'destructive' : 'secondary'}>{incident.severity}</Badge>
                                             </div>
                                             <p className="text-sm mt-2">{incident.description}</p>
                                             {incident.actionsTaken && <p className="text-xs mt-2 text-muted-foreground border-t pt-2">Actions Taken: {incident.actionsTaken}</p>}
                                             {incident.photoUrls && incident.photoUrls.length > 0 && (
                                                <div className="mt-4">
                                                    <p className="text-xs font-semibold text-muted-foreground mb-2">Photo Evidence</p>
                                                    <div className="flex gap-2 flex-wrap">
                                                        {incident.photoUrls.map((url, index) => (
                                                            <a key={index} href={url} target="_blank" rel="noopener noreferrer" className="relative w-20 h-20 block">
                                                                <Image src={url} alt={`Evidence ${index + 1}`} fill className="object-cover rounded-md" />
                                                            </a>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                         </CardContent>
                                     </Card>
                                 ))
                             ) : (
                                 <div className="border-2 border-dashed rounded-lg p-12 text-center"><ShieldAlert className="w-10 h-10 text-muted-foreground mx-auto mb-4" /><h3 className="font-semibold text-lg">No Incidents Logged</h3><p className="text-sm text-muted-foreground">This client has a clean record.</p></div>
                             )}
                          </CardContent>
                      </Card>
                  </TabsContent>
                   <TabsContent value="consents" className="m-0">
                       <Card>
                          <CardHeader><div><CardTitle>Signed Forms</CardTitle><CardDescription>All consent forms signed by {client.name}.</CardDescription></div></CardHeader>
                          <CardContent>
                            {signedConsentsLoading ? (
                                <div className="text-center py-12"><Loader className="h-6 w-6 animate-spin mx-auto" /></div>
                            ) : signedConsents && signedConsents.length > 0 ? (
                                <div className="space-y-4">
                                    {signedConsents.map((consent: any) => (
                                        <Card key={consent.id} className="hover:bg-muted/50 transition-colors">
                                            <CardContent className="p-4 flex items-center justify-between">
                                                <div className="flex items-center gap-3">
                                                    <div className="p-2 bg-primary/10 rounded-md">
                                                        <FileSignature className="w-5 h-5 text-primary" />
                                                    </div>
                                                    <div>
                                                        <p className="font-semibold">{consent.formTitle}</p>
                                                        <p className="text-sm text-muted-foreground">Signed on {format(safeDate(consent.signedAt), 'PPP p')}</p>
                                                    </div>
                                                </div>
                                                <Button variant="outline" onClick={() => setViewingConsent(consent)}>View Responses</Button>
                                            </CardContent>
                                        </Card>
                                    ))}
                                </div>
                            ) : (
                                <div className="border-2 border-dashed rounded-lg p-12 text-center">
                                    <FileText className="w-10 h-10 text-muted-foreground mx-auto mb-4" />
                                    <h3 className="font-semibold text-lg">No Forms on File</h3>
                                    <p className="text-sm text-muted-foreground">This client has not signed any forms yet.</p>
                                </div>
                            )}
                          </CardContent>
                      </Card>
                  </TabsContent>
                </div>
            </Tabs>
      </main>
      
      <AddFormulaDialog 
            open={isAddFormulaOpen}
            onOpenChange={setIsAddFormulaOpen}
            onSave={handleSaveFormula}
        />

        <LogIncidentDialog 
            open={isLogIncidentOpen}
            onOpenChange={setIsLogIncidentOpen}
            client={client}
            onIncidentLogged={handleIncidentLogged}
        />
        
        <EditClientDialog
            open={isEditClientOpen}
            onOpenChange={setIsEditClientOpen}
            client={client}
            onSave={handleUpdateClient}
        />

        <AddAppointmentDialog 
            open={isAddAppointmentOpen}
            onOpenChange={(isOpen) => {
                if (!isOpen) {
                    setAppointmentToRebook(null);
                }
                setIsAddAppointmentOpen(isOpen);
            }}
            client={client}
            appointmentToRebook={appointmentToRebook}
            memberships={memberships || []}
        />

        <Dialog open={!!selectedPhoto} onOpenChange={() => setSelectedPhoto(null)}>
            <DialogContent className="max-w-3xl">
                <DialogHeader>
                    <DialogTitle>{selectedPhoto?.label}</DialogTitle>
                </DialogHeader>
                {selectedPhoto && (
                    <div className="relative aspect-video">
                        <Image src={selectedPhoto.url} alt={selectedPhoto.label} fill className="object-contain rounded-md" />
                    </div>
                )}
            </DialogContent>
        </Dialog>
        <Dialog open={!!viewingConsent} onOpenChange={() => setViewingConsent(null)}>
            <DialogContent className="max-w-2xl">
                <DialogHeader className="print:hidden">
                    <DialogTitle>{viewingConsent?.formTitle}</DialogTitle>
                    <DialogDescription>
                    Signed by {client.name} on {viewingConsent ? format(safeDate(viewingConsent.signedAt), 'PPP p') : ''}
                    </DialogDescription>
                </DialogHeader>
                <ScrollArea className="max-h-[60vh] -mr-6 pr-6 print:max-h-none print:mr-0 print:pr-0">
                <div className="py-4 space-y-4 pl-6 print:pl-0 print:py-0">
                {viewingConsent ? (
                    (() => {
                        const template = formTemplateForViewing;
                        const fieldIds = template?.fields?.map(f => f.id) || Object.keys(viewingConsent.formData || {});
                        
                        return (
                            <div className="space-y-6">
                                {fieldIds.map((id: string) => {
                                    const field = template?.fields?.find(f => f.id === id);
                                    const label = field?.label || id;
                                    const answer = viewingConsent.formData ? viewingConsent.formData[id] : undefined;

                                    if (field?.type === 'heading') {
                                        return <h3 key={id} className="text-lg font-bold pt-4 border-b pb-1">{label}</h3>
                                    }
                                    if (field?.type === 'paragraph') {
                                        return <p key={id} className="text-sm text-muted-foreground leading-relaxed">{label}</p>
                                    }
                                    
                                    return (
                                        <div key={id} className="space-y-1.5 pt-2 break-inside-avoid">
                                        <Label className="font-bold text-xs uppercase tracking-wider text-muted-foreground">{label}</Label>
                                        {field?.type === 'signature' && typeof answer === 'string' && answer.startsWith('data:image') ? (
                                            <div className="p-4 border rounded-xl bg-muted/30 flex justify-center shadow-inner print:shadow-none print:bg-transparent print:border-black/20">
                                                <div className="relative w-full max-w-[300px] aspect-[2/1]">
                                                    <Image src={answer} alt="Signature" fill className="object-contain" />
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="p-3 bg-muted/50 rounded-lg border border-border/50 break-words min-h-[40px] flex items-center print:bg-transparent print:border-black/10">
                                                {answer !== undefined ? (
                                                    <p className="text-sm">
                                                        {Array.isArray(answer) ? answer.join(', ') : String(answer)}
                                                    </p>
                                                ) : <span className="text-sm italic text-muted-foreground/50">No answer provided</span>}
                                            </div>
                                        )}
                                        </div>
                                    );
                                })}
                            </div>
                        );
                    })()
                ) : (
                    <p>Loading form details...</p>
                )}
                </div>
                </ScrollArea>
                <DialogFooter className="border-t pt-4 print:hidden">
                    <Button variant="outline" onClick={() => window.print()} className="gap-2">
                        <Printer className="w-4 h-4" /> Print Record
                    </Button>
                    <Button onClick={() => setViewingConsent(null)}>Close</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>

        {/* Hidden Printable Consent Area */}
        <div id="consent-print-area" className="hidden print:block">
            {viewingConsent && client && (
                <PrintableConsentForm 
                    tenant={selectedTenant}
                    client={client}
                    consent={viewingConsent}
                    formTemplate={formTemplateForViewing}
                />
            )}
        </div>

        <AlertDialog open={!!feeToWaive} onOpenChange={() => setFeeToWaive(null)}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>Are you sure you want to waive this fee?</AlertDialogTitle>
                    <AlertDialogDescription>
                        This will permanently remove the <strong>${feeToWaive?.feeAmount.toFixed(2)}</strong> fee for the appointment on {feeToWaive ? format(safeDate(feeToWaive.appointmentDate), 'PPP') : ''}. This action cannot be undone.
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleWaiveFee} className={buttonVariants({ variant: "destructive" })}>
                        Yes, Waive Fee
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    </div>
  );
}
