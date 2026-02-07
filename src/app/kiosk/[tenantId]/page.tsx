

'use client';

import React, { useState, useMemo, useEffect, KeyboardEvent, useCallback } from 'react';
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
import { collection, getDocs, query, where, doc, writeBatch } from 'firebase/firestore';
import { type Service, type Staff, type ConsentForm, type Tenant, type Client, type PartyMember, WalkIn } from '@/lib/data';
import { ClarityFlowLogo } from '@/components/shared/AppSidebar';
import { Progress } from '@/components/ui/progress';
import { CheckCircle, Sparkles, User, Phone, List, ArrowRight, ArrowLeft, Users, Mail, CalendarIcon, Loader, Clock, Trash2, PlusCircle, Check, Printer } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { format, getDay, parseISO } from 'date-fns';
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
import { PrintWalkInTicket, type WalkInTicketData } from '@/components/walk-in/PrintWalkInTicket';

type Step = 'services' | 'consents' | 'confirmation';

const StaffSelectionCard = ({ staff }: { staff: Staff | { id: string, name: string, avatarUrl: string } }) => {
    const isAnyStaff = staff.id === 'any';
    return (
        <div>
            <RadioGroupItem value={staff.id} id={`staff-${staff.id}`} className="peer sr-only" />
            <Label
                htmlFor={`staff-${staff.id}`}
                className="block cursor-pointer rounded-md border-2 border-muted bg-popover p-4 transition-all hover:border-primary/50 peer-data-[state=checked]:border-primary peer-data-[state=checked]:ring-2 peer-data-[state=checked]:ring-primary"
            >
                <div className="flex flex-col items-center gap-3">
                    <Avatar className="w-16 h-16">
                        {staff.avatarUrl ? <AvatarImage src={staff.avatarUrl} /> : null}
                        <AvatarFallback className="text-muted-foreground">
                            {isAnyStaff ? <Users className="w-8 h-8"/> : staff.name.charAt(0)}
                        </AvatarFallback>
                    </Avatar>
                    <p className="font-semibold text-sm text-center">{staff.name}</p>
                </div>
            </Label>
        </div>
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

const ServiceSelectionCard = ({ service, isSelected, onToggle }: { service: Service; isSelected: boolean; onToggle: () => void; }) => {
    return (
        <Card
            onClick={onToggle}
            className={cn(
                "cursor-pointer hover:shadow-lg transition-shadow overflow-hidden",
                isSelected && "ring-2 ring-primary"
            )}
        >
            <CardContent className="p-3">
                <div className="flex items-start gap-3">
                     <div className={cn(
                        "w-6 h-6 rounded-md border flex items-center justify-center mt-1 flex-shrink-0",
                        isSelected ? "bg-primary border-primary" : "bg-transparent"
                    )}>
                        {isSelected && <Check className="w-4 h-4 text-primary-foreground" />}
                    </div>
                    <div className="flex-1">
                        <h4 className="font-semibold leading-tight">{service.name}</h4>
                        <p className="text-xs text-muted-foreground">{service.duration} min &middot; ${service.price.toFixed(2)}</p>
                    </div>
                </div>
            </CardContent>
        </Card>
    );
};

const PartyMemberEditor = ({ member, onUpdate, onRemove, services }: { member: PartyMember; onUpdate: (id: string, updates: Partial<PartyMember>) => void; onRemove: (id: string) => void; services: Service[] }) => {
    
    // Separate state for each part of the date, initialized from the prop
    const getInitialDatePart = (part: 'month' | 'day' | 'year') => {
        try {
            if (!member.birthday) return '';
            const date = parseISO(member.birthday);
            if (part === 'month') return String(date.getMonth() + 1);
            if (part === 'day') return String(date.getDate());
            if (part === 'year') return String(date.getFullYear());
            return '';
        } catch {
            return '';
        }
    };

    const [month, setMonth] = useState(getInitialDatePart('month'));
    const [day, setDay] = useState(getInitialDatePart('day'));
    const [year, setYear] = useState(getInitialDatePart('year'));

    // Effect to handle prop changes from parent (e.g. reset)
    useEffect(() => {
        setMonth(getInitialDatePart('month'));
        setDay(getInitialDatePart('day'));
        setYear(getInitialDatePart('year'));
    }, [member.birthday]);
    
    const handleDatePartChange = useCallback((part: 'day' | 'month' | 'year', value: string) => {
        let newDay = day, newMonth = month, newYear = year;
        if (part === 'day') { setDay(value); newDay = value; }
        if (part === 'month') { setMonth(value); newMonth = value; }
        if (part === 'year') { setYear(value); newYear = value; }

        if (newYear && newMonth && newDay) {
            const y = parseInt(newYear, 10);
            const m = parseInt(newMonth, 10) - 1;
            const d = parseInt(newDay, 10);

            if (!isNaN(y) && !isNaN(m) && !isNaN(d)) {
                const newDate = new Date(y, m, d);
                // Check if the date is valid (e.g. not Feb 30)
                if (newDate.getFullYear() === y && newDate.getMonth() === m && newDate.getDate() === d) {
                     // Only update if it's a new date string to prevent loops
                    if (newDate.toISOString() !== member.birthday) {
                        onUpdate(member.id, { birthday: newDate.toISOString() });
                    }
                } else if (member.birthday) {
                    onUpdate(member.id, { birthday: undefined });
                }
            }
        } else if (member.birthday) { // If any part is cleared, clear the whole date
            onUpdate(member.id, { birthday: undefined });
        }
    }, [day, month, year, member.id, member.birthday, onUpdate]);
    
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
                    placeholder={`Person ${member.id.slice(0,4)}`}
                />
                <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => onRemove(member.id)}><Trash2 className="w-4 h-4" /></Button>
            </CardHeader>
            <CardContent>
                <Accordion type="multiple" className="w-full space-y-2">
                    <AccordionItem value="services" className="border-b-0">
                        <AccordionTrigger className="p-2 hover:no-underline text-sm bg-muted/50 rounded-md">
                            {member.serviceIds.length > 0 ? `${member.serviceIds.length} service(s) selected` : 'Select Services'}
                        </AccordionTrigger>
                        <AccordionContent className="pt-4">
                             <div className="grid grid-cols-1 gap-2 max-h-48 overflow-y-auto pr-2">
                                {services.map(service => (
                                    <ServiceSelectionCard
                                        key={service.id}
                                        service={service}
                                        isSelected={member.serviceIds.includes(service.id)}
                                        onToggle={() => toggleService(service.id)}
                                    />
                                ))}
                            </div>
                        </AccordionContent>
                    </AccordionItem>
                    <AccordionItem value="details" className="border-b-0">
                         <AccordionTrigger className="p-2 hover:no-underline text-sm bg-muted/50 rounded-md">Contact Details (Optional)</AccordionTrigger>
                         <AccordionContent className="pt-4 space-y-4">
                            <div className="space-y-2">
                                <Label>Phone Number</Label>
                                <Input type="tel" value={member.phone || ''} onChange={(e) => onUpdate(member.id, { phone: e.target.value })} placeholder="(555) 123-4567" />
                            </div>
                             <div className="space-y-2">
                                <Label>Email Address</Label>
                                <Input type="email" value={member.email || ''} onChange={(e) => onUpdate(member.id, { email: e.target.value })} placeholder="email@example.com" />
                            </div>
                             <div className="space-y-2">
                                <Label>Birthday</Label>
                                <div className="grid grid-cols-3 gap-2">
                                    <Select value={month} onValueChange={(v) => handleDatePartChange('month', v)}>
                                        <SelectTrigger><SelectValue placeholder="Month" /></SelectTrigger>
                                        <SelectContent>
                                            {Array.from({ length: 12 }, (_, i) => (
                                                <SelectItem key={i + 1} value={(i + 1).toString()}>
                                                    {format(new Date(2000, i, 1), 'MMMM')}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                    <Select value={day} onValueChange={(v) => handleDatePartChange('day', v)}>
                                        <SelectTrigger><SelectValue placeholder="Day" /></SelectTrigger>
                                        <SelectContent>
                                            {Array.from({ length: 31 }, (_, i) => (
                                                <SelectItem key={i + 1} value={(i + 1).toString()}>
                                                    {i + 1}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                     <Select value={year} onValueChange={(v) => handleDatePartChange('year', v)}>
                                        <SelectTrigger><SelectValue placeholder="Year" /></SelectTrigger>
                                        <SelectContent>
                                            {Array.from({ length: 100 }, (_, i) => {
                                                const yearValue = new Date().getFullYear() - i;
                                                return (
                                                    <SelectItem key={yearValue} value={yearValue.toString()}>
                                                        {yearValue}
                                                    </SelectItem>
                                                );
                                            })}
                                        </SelectContent>
                                    </Select>
                                </div>
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
  const [waitForPreferred, setWaitForPreferred] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [completedForms, setCompletedForms] = useState<Set<string>>(new Set());

  const [potentialMatches, setPotentialMatches] = useState<Client[]>([]);
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  
  const [partyMembers, setPartyMembers] = useState<PartyMember[]>([]);
  const [ticketToPrint, setTicketToPrint] = useState<WalkInTicketData | null>(null);
  const [isPrintDialogOpen, setIsPrintDialogOpen] = useState(false);
  const [queuePosition, setQueuePosition] = useState<number | null>(null);


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

  const handleUpdatePartyMember = useCallback((id: string, updates: Partial<PartyMember>) => {
      setPartyMembers(prev => prev.map(m => m.id === id ? { ...m, ...updates } : m));
  }, []);
  
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
    if (customerEmail && !/^\S+@\S+\.\S+$/.test(customerEmail)) {
        toast({ variant: 'destructive', title: 'Invalid Email', description: 'Please enter a valid email address.' });
        return;
    }

    if (requiredForms.length > 0 && step === 'services') {
        setStep('consents');
        return;
    }
    
    setIsSubmitting(true);
    const walkInsRef = collection(firestore, 'tenants', tenantId, 'walkIns');
    const batch = writeBatch(firestore);
    
    const groupId = nanoid();
    const groupName = partyType === 'group' ? `${customerName}'s Group` : undefined;
    const checkInTime = new Date().toISOString();
    const currentTime = Date.now();

    // 1. Create walk-in for the primary contact
    const primaryWalkInId = nanoid();
    const primaryWalkIn: Omit<WalkIn, 'id'> = {
      groupId,
      groupName,
      isPrimaryContact: true,
      customerName,
      customerPhone,
      customerEmail,
      ...(customerBirthday && { customerBirthday: customerBirthday.toISOString() }),
      clientId: selectedClientId,
      serviceIds: selectedServices.map(s => s.id),
      requiredSkills: [...new Set(selectedServices.flatMap(s => s.requiredSkills || []))],
      estimatedDuration: selectedServices.reduce((acc, s) => acc + s.duration, 0),
      checkInTime,
      status: 'waiting',
      preferredStaffId: preferredStaffId !== 'any' ? preferredStaffId : undefined,
      waitForPreferredStaff: preferredStaffId !== 'any' ? waitForPreferred : false,
      notes,
      queueOrder: currentTime,
    };
    const primaryWalkInRef = doc(walkInsRef, primaryWalkInId);
    batch.set(primaryWalkInRef, { ...primaryWalkIn, id: primaryWalkInId });

    // 2. Create walk-ins for party members
    partyMembers.forEach((member, index) => {
      if (member.serviceIds.length === 0) return;
      
      const memberWalkInId = nanoid();
      const memberServices = services?.filter(s => member.serviceIds.includes(s.id)) || [];
      const memberWalkIn: Omit<WalkIn, 'id'> = {
          groupId,
          groupName,
          isPrimaryContact: false,
          customerName: member.name,
          customerPhone: member.phone,
          customerEmail: member.email,
          ...(member.birthday && { customerBirthday: member.birthday }),
          serviceIds: member.serviceIds,
          requiredSkills: [...new Set(memberServices.flatMap(s => s.requiredSkills || []))],
          estimatedDuration: memberServices.reduce((acc, s) => acc + s.duration, 0),
          checkInTime,
          status: 'waiting',
          preferredStaffId: preferredStaffId !== 'any' ? preferredStaffId : undefined,
          waitForPreferredStaff: preferredStaffId !== 'any' ? waitForPreferred : false,
          queueOrder: currentTime + index + 1,
      };
      const memberWalkInRef = doc(walkInsRef, memberWalkInId);
      batch.set(memberWalkInRef, { ...memberWalkIn, id: memberWalkInId });
    });

    try {
        const q = query(walkInsRef, where("status", "==", "waiting"));
        const querySnapshot = await getDocs(q);
        const newPosition = querySnapshot.size + 1;
        setQueuePosition(newPosition);

        await batch.commit();
        
        const ticketData: WalkInTicketData = {
            id: primaryWalkInId,
            name: customerName,
            services: selectedServices,
            queuePosition: newPosition,
            checkInTime: checkInTime,
        };
        setTicketToPrint(ticketData);
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
    setTicketToPrint(null);
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
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              {mainServices.map(service => (
                                  <ServiceSelectionCard
                                      key={service.id}
                                      service={service}
                                      isSelected={selectedServices.some(s => s.id === service.id)}
                                      onToggle={() => handleServiceToggle(service)}
                                  />
                              ))}
                          </div>
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
                      
                       <div className="space-y-4 pt-6 border-t">
                          <h4 className="font-semibold text-lg">Preferences & Notes</h4>
                          <div className="space-y-2">
                            <Label>Preferred Staff</Label>
                            <RadioGroup value={preferredStaffId} onValueChange={setPreferredStaffId} className="grid grid-cols-2 md:grid-cols-3 gap-4">
                                <StaffSelectionCard staff={{ id: 'any', name: 'Any Available', avatarUrl: '' }} />
                                {staff?.map(s => (
                                    <StaffSelectionCard
                                        key={s.id}
                                        staff={s}
                                    />
                                ))}
                            </RadioGroup>
                          </div>
                          {preferredStaffId !== 'any' && (
                              <div className="flex items-center justify-between rounded-lg border p-4">
                                  <div className="space-y-0.5">
                                      <Label htmlFor="wait-for-preferred">Wait for {staff?.find(s => s.id === preferredStaffId)?.name || 'Preferred Staff'}?</Label>
                                      <p className="text-xs text-muted-foreground">If they are busy, your wait may be longer.</p>
                                  </div>
                                  <Switch id="wait-for-preferred" checked={waitForPreferred} onCheckedChange={setWaitForPreferred} />
                              </div>
                          )}
                          <div className="space-y-2">
                              <Label htmlFor="notes">Notes for Staff</Label>
                              <Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g., celebrating an anniversary, prefers not to talk much." />
                          </div>
                      </div>

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
                       <div className="pt-6">
                           <Button className="w-full" onClick={() => setIsPrintDialogOpen(true)}>
                               <Printer className="mr-2 h-4 w-4" />
                               Print Ticket
                           </Button>
                       </div>
                    </CardContent>
                    <CardFooter>
                        <Button className="w-full" variant="ghost" onClick={resetFlow}>Done</Button>
                    </CardFooter>
                  </div>
                )}
              </motion.div>
            </AnimatePresence>
          </form>
        </Card>
    </div>
    <Dialog open={isPrintDialogOpen} onOpenChange={setIsPrintDialogOpen}>
        <DialogContent className="max-w-sm print:hidden">
            <DialogHeader>
                <DialogTitle>Walk-in Ticket</DialogTitle>
            </DialogHeader>
            <div id="print-ticket-area">
                {ticketToPrint && <PrintWalkInTicket data={ticketToPrint} />}
            </div>
            <DialogFooter>
                <Button variant="outline" onClick={() => setIsPrintDialogOpen(false)}>Close</Button>
                <Button onClick={() => window.print()}>
                    <Printer className="mr-2 h-4 w-4" />
                    Print
                </Button>
            </DialogFooter>
        </DialogContent>
    </Dialog>
    <div className="hidden print:block print-only">
        <div id="printable-ticket">
            {ticketToPrint && <PrintWalkInTicket data={ticketToPrint} />}
        </div>
    </div>

    <style jsx global>{`
        @media print {
            body > *:not(.print-only) {
            display: none !important;
            }
            .print-only, .print-only * {
            display: block !important;
            visibility: visible !important;
            }
            .print-only {
            position: absolute;
            left: 0;
            top: 0;
            }
        }
    `}</style>
    </>
  );
}
