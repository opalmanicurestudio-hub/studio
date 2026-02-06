
'use client';

import React, { useState, useMemo, useEffect, KeyboardEvent } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import { useFirebase, addDocumentNonBlocking, useCollection, useMemoFirebase, useDoc } from '@/firebase';
import { collection, getDocs, query, where, doc } from 'firebase/firestore';
import { type Service, type Staff, type ConsentForm, type Tenant, type Client, type PartyMember } from '@/lib/data';
import { ClarityFlowLogo } from '@/components/shared/AppSidebar';
import { Progress } from '@/components/ui/progress';
import { CheckCircle, Sparkles, User, Phone, List, ArrowRight, ArrowLeft, Users, Mail, CalendarIcon, Loader, Clock, Trash2, PlusCircle } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { format, getDay } from 'date-fns';
import { cn } from '@/lib/utils';
import { nanoid } from 'nanoid';
import { FormFieldRenderer } from '@/components/consents/FormFieldRenderer';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';

type Step = 'services' | 'consents' | 'confirmation';

const StaffSelectionCard = ({ staff, isSelected, onSelect }: { staff: Staff | { id: string, name: string, avatarUrl: string }, isSelected: boolean, onSelect: () => void }) => {
    const isAnyStaff = staff.id === 'any';
    return (
        <label htmlFor={`staff-${staff.id}`} className="block cursor-pointer">
            <Card className={`transition-all ${isSelected ? 'border-primary ring-2 ring-primary' : 'hover:border-primary/50'}`}>
                <CardContent className="p-4 flex flex-col items-center gap-3">
                    <Avatar className="w-16 h-16">
                        {staff.avatarUrl ? <AvatarImage src={staff.avatarUrl} /> : null}
                        <AvatarFallback className="text-muted-foreground">
                            {isAnyStaff ? <Users className="w-8 h-8"/> : staff.name.charAt(0)}
                        </AvatarFallback>
                    </Avatar>
                    <p className="font-semibold text-sm text-center">{staff.name}</p>
                    <RadioGroupItem value={staff.id} id={`staff-${staff.id}`} className="sr-only" />
                </CardContent>
            </Card>
        </label>
    );
};

type DayHours = { enabled: boolean; start: string; end: string };
type BusinessHours = {
    sunday: DayHours;
    monday: DayHours;
    tuesday: DayHours;
    wednesday: DayHours;
    thursday: DayHours;
    friday: DayHours;
    saturday: DayHours;
};


const parseLenientTime = (timeStr: string, date: Date): Date => {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);

    if (!timeStr) {
        return d;
    }

    const [time, period] = timeStr.split(' ');
    let [hours, minutes] = time.split(':').map(Number);
    
    if (period) {
      if (period.toUpperCase() === 'PM' && hours < 12) {
          hours += 12;
      }
      if (period.toUpperCase() === 'AM' && hours === 12) {
          hours = 0;
      }
    }

    d.setHours(hours, minutes);
    return d;
};

function isBusinessOpen(now: Date, scheduleProfile: { week: BusinessHours } | null): { open: boolean, nextOpen?: { day: string, time: string } } {
    if (!scheduleProfile) {
        return { open: false };
    }

    const hours = scheduleProfile.week;
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const dayOfWeek = days[getDay(now)];

    const todayHours = hours[dayOfWeek as keyof BusinessHours];

    if (todayHours && todayHours.enabled) {
        const openTime = parseLenientTime(todayHours.start, now);
        const closeTime = parseLenientTime(todayHours.end, now);
        openTime.setFullYear(now.getFullYear(), now.getMonth(), now.getDate());
        closeTime.setFullYear(now.getFullYear(), now.getMonth(), now.getDate());

        if (now >= openTime && now < closeTime) {
            return { open: true };
        }
    }

    let currentDayIndex = getDay(now);
    for (let i = 0; i < 7; i++) {
        const nextDayIndex = (currentDayIndex + i) % 7;
        const nextDayName = days[nextDayIndex];
        const nextDayHours = hours[nextDayName as keyof BusinessHours];
        if (nextDayHours && nextDayHours.enabled) {
            const closeTime = parseLenientTime(nextDayHours.end, now);
            closeTime.setFullYear(now.getFullYear(), now.getMonth(), now.getDate());
            if (i === 0 && now > closeTime) continue;

            return {
                open: false,
                nextOpen: {
                    day: i === 0 ? 'today' : i === 1 ? 'tomorrow' : `on ${nextDayName}`,
                    time: nextDayHours.start
                }
            };
        }
    }

    return { open: false };
}

const formatTime = (timeStr: string) => {
    if (!timeStr) return '';
    if (timeStr.includes('AM') || timeStr.includes('PM')) {
        return timeStr;
    }
    const [hours, minutes] = timeStr.split(':').map(Number);
    const date = new Date();
    date.setHours(hours);
    date.setMinutes(minutes);
    return format(date, 'h:mm a');
};

const PartyMemberEditor = ({ member, onUpdate, onRemove, services }: { member: PartyMember; onUpdate: (id: string, updates: Partial<PartyMember>) => void; onRemove: (id: string) => void; services: Service[] }) => {
    const toggleService = (serviceId: string) => {
        const newServiceIds = member.serviceIds.includes(serviceId)
            ? member.serviceIds.filter(id => id !== serviceId)
            : [...member.serviceIds, serviceId];
        onUpdate(member.id, { serviceIds: newServiceIds });
    };

    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
                <Input
                    value={member.name}
                    onChange={(e) => onUpdate(member.id, { name: e.target.value })}
                    className="text-base font-semibold border-0 shadow-none focus-visible:ring-0 p-0"
                />
                <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => onRemove(member.id)}><Trash2 className="w-4 h-4" /></Button>
            </CardHeader>
            <CardContent>
                <Accordion type="single" collapsible>
                    <AccordionItem value="services" className="border-none">
                        <AccordionTrigger className="p-0 hover:no-underline text-sm">
                            {member.serviceIds.length > 0 ? `${member.serviceIds.length} service(s) selected` : 'Select Services'}
                        </AccordionTrigger>
                        <AccordionContent className="pt-2">
                             <div className="space-y-2 max-h-48 overflow-y-auto pr-2">
                                {services.map(service => (
                                    <div key={service.id} className="border-b last:border-b-0">
                                        <label htmlFor={`member-${member.id}-${service.id}`} className="flex items-center space-x-4 p-2 cursor-pointer">
                                            <Checkbox
                                                id={`member-${member.id}-${service.id}`}
                                                checked={member.serviceIds.includes(service.id)}
                                                onCheckedChange={() => toggleService(service.id)}
                                                className="h-5 w-5"
                                            />
                                            <div className="flex-1">
                                                <span className="font-medium text-sm">{service.name}</span>
                                                <p className="text-xs text-muted-foreground">{service.duration} min &middot; ${service.price.toFixed(2)}</p>
                                            </div>
                                        </label>
                                    </div>
                                ))}
                            </div>
                        </AccordionContent>
                    </AccordionItem>
                </Accordion>
            </CardContent>
        </Card>
    )
};


export default function WalkInPage() {
  const { firestore } = useFirebase();
  const router = useRouter();
  const { toast } = useToast();
  const params = useParams();
  const tenantId = params.tenantId as string;

  const tenantDocRef = useMemoFirebase(() => {
    if (!firestore || !tenantId) return null;
    return doc(firestore, `tenants/${tenantId}`);
  }, [firestore, tenantId]);
  const { data: tenant, isLoading: tenantLoading } = useDoc<Tenant>(tenantDocRef);
  
  const clientsQuery = useMemoFirebase(() => {
    if (!firestore || !tenantId) return null;
    return collection(firestore, `tenants/${tenantId}/clients`);
  }, [firestore, tenantId]);
  const { data: clients, isLoading: clientsLoading } = useCollection<Client>(clientsQuery);

  const servicesQuery = useMemoFirebase(() => {
    if (!firestore || !tenantId) return null;
    return collection(firestore, `tenants/${tenantId}/services`);
  }, [firestore, tenantId]);

  const staffQuery = useMemoFirebase(() => {
    if (!firestore || !tenantId) return null;
    return collection(firestore, `tenants/${tenantId}/staff`);
  }, [firestore, tenantId]);

  const scheduleProfilesQuery = useMemoFirebase(() => {
      if (!firestore || !tenantId) return null;
      return query(collection(firestore, `tenants/${tenantId}/scheduleProfiles`), where("isActive", "==", true));
  }, [firestore, tenantId]);

  const consentFormsQuery = useMemoFirebase(() => {
    if (!firestore || !tenantId) return null;
    return collection(firestore, `tenants/${tenantId}/consentForms`);
  }, [firestore, tenantId]);

  const { data: services, isLoading: servicesLoading } = useCollection<Service>(servicesQuery);
  const { data: staff, isLoading: staffLoading } = useCollection<Staff>(staffQuery);
  const { data: scheduleProfiles, isLoading: scheduleProfilesLoading } = useCollection(scheduleProfilesQuery);
  const { data: consentForms, isLoading: consentFormsLoading } = useCollection<ConsentForm>(consentFormsQuery);

  const scheduleProfile = useMemo(() => scheduleProfiles?.[0], [scheduleProfiles]);

  const [partyType, setPartyType] = useState<'individual' | 'group' | null>(null);
  const [step, setStep] = useState<Step>('services');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [customerBirthday, setCustomerBirthday] = useState<Date | undefined>();
  const [birthMonth, setBirthMonth] = useState('');
  const [birthDay, setBirthDay] = useState('');
  const [birthYear, setBirthYear] = useState('');
  const [selectedServices, setSelectedServices] = useState<Service[]>([]);
  const [preferredStaffId, setPreferredStaffId] = useState<string>('any');
  const [notes, setNotes] = useState('');
  const [queuePosition, setQueuePosition] = useState<number | null>(null);
  const [waitForPreferred, setWaitForPreferred] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [completedForms, setCompletedForms] = useState<Set<string>>(new Set());

  const [potentialMatches, setPotentialMatches] = useState<Client[]>([]);
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  
  const [partyMembers, setPartyMembers] = useState<PartyMember[]>([]);


  const mainServices = useMemo(() => (services || []).filter(s => s.type === 'service'), [services]);
  const addOnServices = useMemo(() => (services || []).filter(s => s.type === 'addon'), [services]);

  const { open: businessIsOpen, nextOpen } = useMemo(() => {
    return isBusinessOpen(new Date(), scheduleProfile);
  }, [scheduleProfile]);
  
  const [hasMounted, setHasMounted] = useState(false);
  
  useEffect(() => {
      setHasMounted(true);
  }, []);
  
  useEffect(() => {
    if (birthYear && birthMonth && birthDay) {
        const date = new Date(parseInt(birthYear), parseInt(birthMonth) - 1, parseInt(birthDay));
        if (date.getFullYear() === parseInt(birthYear) && (date.getMonth() + 1) === parseInt(birthMonth) && date.getDate() === parseInt(birthDay)) {
            setCustomerBirthday(date);
        } else {
             setCustomerBirthday(undefined);
        }
    } else {
        setCustomerBirthday(undefined);
    }
  }, [birthMonth, birthDay, birthYear]);
  
  useEffect(() => {
    if (!clients || (!customerEmail && !customerPhone)) {
        setPotentialMatches([]);
        return;
    }

    const timer = setTimeout(() => {
        const matches = clients.filter(c => {
            const emailMatch = customerEmail && c.email && c.email.toLowerCase() === customerEmail.toLowerCase();
            const phoneMatch = customerPhone && c.phone && c.phone === customerPhone;
            return emailMatch || phoneMatch;
        });
        setPotentialMatches(matches);
    }, 300); // 300ms debounce

    return () => clearTimeout(timer);

  }, [customerEmail, customerPhone, clients]);

  const handleSelectClient = (client: Client) => {
    setSelectedClientId(client.id);
    setCustomerName(client.name);
    setCustomerEmail(client.email);
    if (client.phone) setCustomerPhone(client.phone);
    setPotentialMatches([]);
  }

  const resetClientSelection = () => {
      setSelectedClientId(null);
  }

  const handleServiceToggle = (service: Service) => {
    setSelectedServices(prev =>
      prev.some(s => s.id === service.id)
        ? prev.filter(s => s.id !== service.id)
        : [...prev, service]
    );
  };
  
  const handleAddPartyMember = () => {
      setPartyMembers(prev => [...prev, { id: nanoid(), name: `Person ${prev.length + 2}`, serviceIds: [] }]);
  };

  const handleUpdatePartyMember = (id: string, updates: Partial<PartyMember>) => {
      setPartyMembers(prev => prev.map(m => m.id === id ? { ...m, ...updates } : m));
  };
  
  const handleRemovePartyMember = (memberId: string) => {
    setPartyMembers(prev => prev.filter(m => m.id !== memberId));
  };


  const { totalDuration, totalPrice } = useMemo(() => {
    const allServices = [...selectedServices, ...partyMembers.flatMap(m => m.serviceIds.map(id => services?.find(s => s.id === id)).filter(Boolean) as Service[])];
    const duration = allServices.reduce((acc, s) => acc + s.duration, 0);
    const price = allServices.reduce((acc, s) => acc + s.price, 0);
    return { totalDuration: duration, totalPrice: price };
  }, [selectedServices, partyMembers, services]);

  const requiredForms = useMemo(() => {
    const allServiceIds = new Set([...selectedServices.map(s => s.id), ...partyMembers.flatMap(m => m.serviceIds)]);
    if (allServiceIds.size === 0 || !consentForms) return [];
    
    const allSelectedServices = (services || []).filter(s => allServiceIds.has(s.id));
    const formIds = new Set(allSelectedServices.flatMap(s => s.requiredFormIds || []));

    if (formIds.size === 0) return [];
    return consentForms.filter(f => formIds.has(f.id));
  }, [selectedServices, partyMembers, consentForms, services]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    if (!customerName || (selectedServices.length === 0 && partyMembers.every(m => m.serviceIds.length === 0))) {
      toast({
        variant: 'destructive',
        title: 'Missing Information',
        description: 'Please enter your name and select at least one service for someone in your party.',
      });
      return;
    }
    if (!/^\S+@\S+\.\S+$/.test(customerEmail)) {
        toast({ variant: 'destructive', title: 'Invalid Email', description: 'Please enter a valid email address.' });
        return;
    }

    if (requiredForms.length > 0 && step === 'services') {
        setStep('consents');
        return;
    }
    
    setIsSubmitting(true);
    const walkInsRef = collection(firestore, 'tenants', tenantId, 'walkIns');

    const newWalkIn: any = {
      customerName,
      customerPhone,
      customerEmail,
      customerBirthday: customerBirthday?.toISOString(),
      clientId: selectedClientId,
      serviceIds: selectedServices.map(s => s.id),
      partyMembers,
      requiredSkills: [...new Set(selectedServices.flatMap(s => s.requiredSkills || []))],
      estimatedDuration: totalDuration,
      checkInTime: new Date().toISOString(),
      status: 'waiting',
      waitForPreferredStaff: preferredStaffId !== 'any' ? waitForPreferred : false,
      notes: notes,
      queueOrder: Date.now(),
    };
    
    if (preferredStaffId !== 'any') {
      newWalkIn.preferredStaffId = preferredStaffId;
    }
    
    try {
        const q = query(walkInsRef, where("status", "==", "waiting"));
        const querySnapshot = await getDocs(q);
        const newPosition = querySnapshot.size + 1;
        setQueuePosition(newPosition);

        await addDocumentNonBlocking(walkInsRef, newWalkIn);
        setStep('confirmation');
    } catch (error) {
        console.error("Error adding walk-in:", error);
        toast({
            variant: 'destructive',
            title: 'Something went wrong',
            description: 'Could not add you to the waitlist. Please see the front desk.',
        });
        setIsSubmitting(false);
    }
  };

  const progressValue = step === 'services' ? 33 : step === 'consents' ? 66 : 100;
  
  const resetFlow = () => {
    setCustomerName('');
    setCustomerPhone('');
    setCustomerEmail('');
    setCustomerBirthday(undefined);
    setBirthMonth('');
    setBirthDay('');
    setBirthYear('');
    setSelectedServices([]);
    setPreferredStaffId('any');
    setNotes('');
    setWaitForPreferred(false);
    setCompletedForms(new Set());
    setSelectedClientId(null);
    setPartyMembers([]);
    setStep('services');
    setIsSubmitting(false);
    setPartyType(null);
  };
  
  const isLoading = tenantLoading || servicesLoading || staffLoading || scheduleProfilesLoading || consentFormsLoading || clientsLoading || !hasMounted;
  
  if (isLoading) {
    return (
      <div className="flex min-h-screen w-full flex-col items-center justify-center bg-muted/40 p-4">
        <Loader className="h-8 w-8 animate-spin" />
      </div>
    );
  }
  
  if (!businessIsOpen) {
      const orderedDays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
      return (
          <div className="flex min-h-screen w-full flex-col items-center justify-center bg-muted/40 p-4">
               <div className="w-full max-w-md mx-auto text-center">
                    <header className="mb-8">
                        <div className="inline-block p-3 bg-card rounded-full shadow-md mb-4">
                            <ClarityFlowLogo />
                        </div>
                        <h1 className="text-3xl font-bold tracking-tight">{tenant?.name || 'ClarityFlow Salon'}</h1>
                    </header>
                    <Card>
                        <CardHeader>
                            <CardTitle>We're Currently Closed</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <p className="text-muted-foreground">
                                Our apologies, but we are not currently accepting walk-ins.
                                {nextOpen && ` We will reopen ${nextOpen.day} at ${nextOpen.time}.`}
                            </p>
                            {scheduleProfile?.week && (
                                <Card className="text-left bg-background">
                                    <CardHeader><CardTitle className="text-base">Our Hours</CardTitle></CardHeader>
                                    <CardContent className="text-sm space-y-1">
                                        {orderedDays.map((day) => {
                                            const hours = scheduleProfile.week[day as keyof typeof scheduleProfile.week];
                                            if (!hours) return null;
                                            return (
                                                <div key={day} className="flex justify-between">
                                                    <span className="capitalize font-medium">{day}</span>
                                                    <span className="text-muted-foreground">
                                                        {hours.enabled ? `${formatTime(hours.start)} - ${formatTime(hours.end)}` : 'Closed'}
                                                    </span>
                                                </div>
                                            )
                                        })}
                                    </CardContent>
                                </Card>
                            )}
                        </CardContent>
                    </Card>
               </div>
          </div>
      )
  }
  
  if (!partyType) {
    return (
      <div className="w-full max-w-2xl mx-auto">
        <header className="mb-8 text-center">
          <div className="inline-block p-3 bg-card rounded-full shadow-md mb-4">
            <ClarityFlowLogo />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">{tenant?.name || 'ClarityFlow Salon'}</h1>
          <p className="text-muted-foreground mt-2">Ready to be seen? Let's get you checked in.</p>
        </header>
        <div className="text-center mb-6">
            <h2 className="text-2xl font-semibold">Who are we serving today?</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card
            className="cursor-pointer hover:border-primary/50 hover:shadow-lg transition-all text-center"
            onClick={() => setPartyType('individual')}
            tabIndex={0}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setPartyType('individual')}
          >
            <CardContent className="p-8 flex flex-col items-center justify-center h-full">
              <User className="w-16 h-16 mx-auto mb-4 text-primary" />
              <h3 className="text-2xl font-semibold">Just Me</h3>
              <p className="text-muted-foreground mt-1">I'm checking in for myself.</p>
            </CardContent>
          </Card>
          <Card
            className="cursor-pointer hover:border-primary/50 hover:shadow-lg transition-all text-center"
            onClick={() => setPartyType('group')}
            tabIndex={0}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setPartyType('group')}
          >
            <CardContent className="p-8 flex flex-col items-center justify-center h-full">
              <Users className="w-16 h-16 mx-auto mb-4 text-primary" />
              <h3 className="text-2xl font-semibold">My Group</h3>
              <p className="text-muted-foreground mt-1">I'm checking in for myself and others.</p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <>
    <div className="w-full max-w-2xl mx-auto">
        <header className="mb-8 text-center">
          <div className="inline-block p-3 bg-card rounded-full shadow-md mb-4">
            <ClarityFlowLogo />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">{tenant?.name || 'ClarityFlow Salon'}</h1>
          <p className="text-muted-foreground">Walk-in Check-in</p>
        </header>

        <Card className="overflow-hidden">
          <div className="p-6 border-b">
            <Progress value={progressValue} className="h-2" />
          </div>
          <form onSubmit={handleSubmit}>
            <AnimatePresence mode="wait">
              <motion.div
                key={step}
                initial={{ opacity: 0, x: 50 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -50 }}
                transition={{ duration: 0.3, ease: "easeInOut" }}
              >
                {step === 'services' && (
                  <div>
                    <CardHeader>
                      <CardTitle>{partyType === 'group' ? "Build Your Party's Request" : "Select Your Services"}</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-6 max-h-[50vh] overflow-y-auto">
                      <div className="space-y-4 pb-6 border-b">
                          <h4 className="font-semibold text-lg">Primary Contact Information</h4>
                           {selectedClientId && (
                              <div className="p-3 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-between">
                                  <div className="flex items-center gap-3">
                                      <CheckCircle className="w-5 h-5 text-primary" />
                                      <div>
                                          <p className="text-sm font-medium">Welcome back, {customerName}!</p>
                                          <p className="text-xs text-muted-foreground">Continuing with your profile.</p>
                                      </div>
                                  </div>
                                  <Button variant="ghost" size="sm" onClick={resetClientSelection}>Not you?</Button>
                              </div>
                          )}
                           <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              <div className="space-y-2">
                                  <Label htmlFor="phone">Phone Number (for SMS updates)</Label>
                                  <div className="relative">
                                      <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                      <Input id="phone" type="tel" value={customerPhone} onChange={e => setCustomerPhone(e.target.value)} placeholder="(555) 123-4567" className="pl-9" />
                                  </div>
                              </div>
                              <div className="space-y-2">
                                  <Label htmlFor="email">Email Address</Label>
                                  <div className="relative">
                                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                      <Input id="email" type="email" value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)} placeholder="jane.doe@example.com" className="pl-9" />
                                  </div>
                              </div>
                          </div>
                          {potentialMatches.length > 0 && !selectedClientId && (
                              <div className="space-y-3">
                                  <p className="text-sm font-medium text-center">Are you an existing client?</p>
                                  <Card>
                                      <CardContent className="p-2 space-y-1">
                                          {potentialMatches.map(client => (
                                              <Button key={client.id} variant="ghost" className="w-full justify-start h-auto p-3" onClick={() => handleSelectClient(client)}>
                                                  <Avatar className="w-10 h-10 mr-4">
                                                      <AvatarImage src={client.avatarUrl} />
                                                      <AvatarFallback>{client.name.charAt(0)}</AvatarFallback>
                                                  </Avatar>
                                                  <div>
                                                      <p className="font-semibold text-base">{client.name}</p>
                                                      <p className="text-sm text-muted-foreground">{client.email}</p>
                                                  </div>
                                              </Button>
                                          ))}
                                      </CardContent>
                                  </Card>
                              </div>
                          )}
                           <div className="space-y-2">
                              <Label htmlFor="name">Your Name</Label>
                              <div className="relative">
                                  <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                  <Input id="name" value={customerName} onChange={e => setCustomerName(e.target.value)} placeholder="Jane Doe" required className="pl-9" disabled={!!selectedClientId} />
                              </div>
                          </div>
                      </div>

                      <div className="space-y-2">
                          <Label className="font-semibold text-base">Your Services</Label>
                          <Accordion type="multiple" defaultValue={['main-services']} className="w-full space-y-2">
                              <AccordionItem value="main-services" className="border rounded-md">
                                  <AccordionTrigger className="p-3">Select services for yourself</AccordionTrigger>
                                  <AccordionContent className="space-y-2 px-3 pb-3">
                                      {mainServices.map(service => {
                                          const isSelected = selectedServices.some(s => s.id === service.id);
                                          return (
                                              <div key={service.id} className="border-b last:border-b-0">
                                                  <label htmlFor={`primary-${service.id}`} className="flex items-center space-x-4 p-2 cursor-pointer">
                                                      <Checkbox id={`primary-${service.id}`} checked={isSelected} onCheckedChange={() => handleServiceToggle(service)} className="h-5 w-5" />
                                                      <div className="flex-1">
                                                          <span className="font-medium text-sm">{service.name}</span>
                                                          <p className="text-xs text-muted-foreground">{service.duration} min &middot; ${service.price.toFixed(2)}</p>
                                                      </div>
                                                  </label>
                                              </div>
                                          )
                                      })}
                                  </AccordionContent>
                              </AccordionItem>
                          </Accordion>
                      </div>

                      {partyType === 'group' && (
                        <div className="space-y-4">
                          <Label className="font-semibold text-base">Your Group</Label>
                          <div className="space-y-4">
                              {partyMembers.map(member => (
                                  <PartyMemberEditor
                                      key={member.id}
                                      member={member}
                                      onUpdate={handleUpdatePartyMember}
                                      onRemove={handleRemovePartyMember}
                                      services={mainServices}
                                  />
                              ))}
                          </div>
                          <Button variant="outline" className="w-full" type="button" onClick={handleAddPartyMember}>
                              <PlusCircle className="mr-2 h-4 w-4" /> Add Another Person
                          </Button>
                        </div>
                      )}

                    </CardContent>
                    <CardFooter className="flex justify-between">
                      <Button variant="ghost" onClick={resetFlow}>
                          <ArrowLeft className="mr-2 h-4 w-4" /> Start Over
                      </Button>
                      <Button type="submit" disabled={isSubmitting || (selectedServices.length === 0 && partyMembers.every(m => m.serviceIds.length === 0))}>
                          {isSubmitting && <Loader className="mr-2 h-4 w-4 animate-spin" />}
                          {requiredForms.length > 0 ? 'Next' : 'Join Waitlist'} <ArrowRight className="ml-2 h-4 w-4" />
                      </Button>
                    </CardFooter>
                  </div>
                )}
                {step === 'consents' && (
                  <div>
                    <CardHeader>
                      <CardTitle>Consent Forms</CardTitle>
                      <CardDescription>Please review and acknowledge the following forms before continuing.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4 max-h-[50vh] overflow-y-auto">
                      {requiredForms.map(form => (
                          <Card key={form.id}>
                              <CardHeader>
                                  <CardTitle className="text-lg">{form.title}</CardTitle>
                              </CardHeader>
                              <CardContent className="space-y-4">
                                  {form.fields?.map(field => <FormFieldRenderer key={field.id} field={field} />)}
                                  <div className="flex items-center space-x-2 pt-4 border-t">
                                      <Checkbox id={`consent-ack-${form.id}`}
                                          checked={completedForms.has(form.id)}
                                          onCheckedChange={(checked) => {
                                              const newCompleted = new Set(completedForms);
                                              if (checked) {
                                                  newCompleted.add(form.id);
                                              } else {
                                                  newCompleted.delete(form.id);
                                              }
                                              setCompletedForms(newCompleted);
                                          }}
                                      />
                                      <Label htmlFor={`consent-ack-${form.id}`} className="text-sm font-normal">
                                          I have read, understood, and agree to the terms of this form.
                                      </Label>
                                  </div>
                              </CardContent>
                          </Card>
                      ))}
                    </CardContent>
                    <CardFooter className="flex justify-between">
                          <Button variant="ghost" onClick={() => setStep('services')} type="button">
                              <ArrowLeft className="mr-2 h-4 w-4" /> Back
                          </Button>
                          <Button type="submit" disabled={isSubmitting || completedForms.size < requiredForms.length}>
                                {isSubmitting && <Loader className="mr-2 h-4 w-4 animate-spin" />}
                              Join Waitlist
                          </Button>
                    </CardFooter>
                  </div>
                )}
                {step === 'confirmation' && (
                  <div>
                    <CardContent className="p-8 text-center space-y-4">
                      <CheckCircle className="w-16 h-16 mx-auto text-green-500" />
                      <h2 className="text-2xl font-bold">You're on the list!</h2>
                      <p className="text-muted-foreground">
                          You are number <span className="font-bold text-primary">{queuePosition}</span> in the queue.
                          We will send a text message to the provided phone number when it's your turn.
                      </p>
                      <p className="text-sm">Feel free to have a seat!</p>
                    </CardContent>
                    <CardFooter>
                        <Button className="w-full" onClick={resetFlow}>Done</Button>
                    </CardFooter>
                  </div>
                )}
              </motion.div>
            </AnimatePresence>
          </form>
        </Card>
    </div>
    </>
  );
}
