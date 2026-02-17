
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
import { useFirebase, useDoc, addDocumentNonBlocking, useCollection, useMemoFirebase } from '@/firebase';
import { collection, getDocs, query, where, doc, writeBatch } from 'firebase/firestore';
import { type Service, type Staff, type ConsentForm, type Tenant, type Client, type PartyMember, WalkIn, type PricingTier } from '@/lib/data';
import { ClarityFlowLogo } from '@/components/shared/AppSidebar';
import { Progress } from '@/components/ui/progress';
import { CheckCircle, Sparkles, User, Phone, List, ArrowRight, ArrowLeft, Users, Mail, CalendarIcon, Loader, Clock, Trash2, PlusCircle, Check, Printer, DollarSign } from 'lucide-react';
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
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { PrintWalkInTicket, type WalkInTicketData } from '@/components/walk-in/PrintWalkInTicket';
import Image from 'next/image';

type Step = 'partyType' | 'memberSetup' | 'confirmation';
type MemberSubStep = 'details' | 'services' | 'addons' | 'staff';

const PartyTypeSelection = ({ onSelect }: { onSelect: (type: 'individual' | 'group') => void }) => (
    <>
        <CardHeader className="text-center">
            <CardTitle className="text-2xl">Who are we serving today?</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-6 p-6">
            <Card className="cursor-pointer hover:border-primary/50 hover:shadow-lg transition-all text-center" onClick={() => onSelect('individual')}>
                <CardContent className="p-8 flex flex-col items-center justify-center h-full">
                    <User className="w-16 h-16 mx-auto mb-4 text-primary" />
                    <h3 className="text-2xl font-semibold">Just Me</h3>
                    <p className="text-muted-foreground mt-1">I'm checking in for myself.</p>
                </CardContent>
            </Card>
            <Card className="cursor-pointer hover:border-primary/50 hover:shadow-lg transition-all text-center" onClick={() => onSelect('group')}>
                <CardContent className="p-8 flex flex-col items-center justify-center h-full">
                    <Users className="w-16 h-16 mx-auto mb-4 text-primary" />
                    <h3 className="text-2xl font-semibold">My Group</h3>
                    <p className="text-muted-foreground mt-1">I'm checking in for myself and others.</p>
                </CardContent>
            </Card>
        </CardContent>
    </>
);

const StepDetails = ({ member, onUpdate }: { member: PartyMember; onUpdate: (updates: Partial<PartyMember>) => void }) => (
    <div className="space-y-4">
        <div className="space-y-2">
            <Label htmlFor={`name-${member.id}`}>Name</Label>
            <Input id={`name-${member.id}`} value={member.name} onChange={(e) => onUpdate({ name: e.target.value })} placeholder={member.isPrimary ? "Your Full Name" : "Guest's Name"} />
        </div>
        {member.isPrimary && (
            <>
                <div className="space-y-2">
                    <Label htmlFor={`phone-${member.id}`}>Phone</Label>
                    <Input id={`phone-${member.id}`} type="tel" value={member.phone || ''} onChange={(e) => onUpdate({ phone: e.target.value })} placeholder="For SMS updates" />
                </div>
                <div className="space-y-2">
                    <Label htmlFor={`email-${member.id}`}>Email</Label>
                    <Input id={`email-${member.id}`} type="email" value={member.email || ''} onChange={(e) => onUpdate({ email: e.target.value })} placeholder="Optional" />
                </div>
            </>
        )}
    </div>
);

const StepServices = ({ member, onUpdate, services, staff, pricingTiers }: { member: PartyMember; onUpdate: (updates: Partial<PartyMember>) => void; services: Service[]; staff: Staff[]; pricingTiers: PricingTier[] }) => {
    const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

    const handleServiceToggle = (serviceId: string) => {
        const newServiceIds = member.serviceIds.includes(serviceId)
            ? member.serviceIds.filter(id => id !== serviceId)
            : [...member.serviceIds, serviceId];
        onUpdate({ serviceIds: newServiceIds });
    };
    
    const selectedStaffMember = useMemo(() => staff.find(s => s.id === member.preferredStaffId), [staff, member.preferredStaffId]);

    const categories = useMemo(() => Array.from(new Set(services.map(s => s.category || 'Uncategorized'))).sort(), [services]);

    if (!selectedCategory) {
        return (
             <div className="grid grid-cols-2 gap-4">
                {categories.map(category => (
                    <Button key={category} variant="outline" className="h-20 text-base" onClick={() => setSelectedCategory(category)}>{category}</Button>
                ))}
            </div>
        )
    }

    return (
        <div className="space-y-4">
            <Button variant="ghost" size="sm" onClick={() => setSelectedCategory(null)} className="mb-2 -ml-2"><ArrowLeft className="mr-2 h-4 w-4"/>Back to Categories</Button>
            <div className="space-y-3">
                {services.filter(s => (s.category || 'Uncategorized') === selectedCategory).map(service => (
                    <ServiceSelectionCard
                        key={service.id}
                        service={service}
                        isSelected={member.serviceIds.includes(service.id)}
                        onToggle={() => handleServiceToggle(service.id)}
                        staffTierId={selectedStaffMember?.pricingTierId}
                    />
                ))}
            </div>
        </div>
    );
};

const StepAddons = ({ member, onUpdate, compatibleAddons, staff, pricingTiers }: { member: PartyMember; onUpdate: (updates: Partial<PartyMember>) => void; compatibleAddons: Service[]; staff: Staff[]; pricingTiers: PricingTier[]; }) => {
    
    const handleServiceToggle = (serviceId: string) => {
        const newServiceIds = member.serviceIds.includes(serviceId)
            ? member.serviceIds.filter(id => id !== serviceId)
            : [...member.serviceIds, serviceId];
        onUpdate({ serviceIds: newServiceIds });
    };

    const selectedStaffMember = useMemo(() => staff.find(s => s.id === member.preferredStaffId), [staff, member.preferredStaffId]);

    return (
        <div className="space-y-3">
            {compatibleAddons.map(service => (
                <ServiceSelectionCard
                    key={service.id}
                    service={service}
                    isSelected={member.serviceIds.includes(service.id)}
                    onToggle={() => handleServiceToggle(service.id)}
                    staffTierId={selectedStaffMember?.pricingTierId}
                />
            ))}
        </div>
    );
};

const StepStaff = ({ member, onUpdate, staff }: { member: PartyMember; onUpdate: (updates: Partial<PartyMember>) => void; staff: Staff[] }) => (
    <div className="space-y-4">
        <RadioGroup 
            value={member.preferredStaffId || 'any'} 
            onValueChange={(staffId) => onUpdate({ preferredStaffId: staffId })} 
            className="grid grid-cols-2 md:grid-cols-3 gap-4"
        >
            <StaffSelectionCard staff={{ id: 'any', name: 'Any Available', avatarUrl: '' }} />
            {staff?.map(s => <StaffSelectionCard key={s.id} staff={s} />)}
        </RadioGroup>
        {(member.preferredStaffId && member.preferredStaffId !== 'any') && (
            <div className="flex items-center justify-between rounded-lg border p-3 mt-4">
                <Label htmlFor={`wait-${member.id}`} className="font-medium">Wait for {staff?.find(s => s.id === member.preferredStaffId)?.name || 'Preferred Staff'}?</Label>
                <Switch id={`wait-${member.id}`} checked={member.waitForPreferredStaff} onCheckedChange={(checked) => onUpdate({ waitForPreferredStaff: checked })} />
            </div>
        )}
    </div>
);

const MemberSetup = ({
    member,
    onUpdate,
    memberSubStep,
    setMemberSubStep,
    services,
    staff,
    pricingTiers,
    compatibleAddons,
    onNext,
    onBack,
    isGroup,
    isLastMember,
    onAddAnother,
    onSubmit,
    isSubmitting
}: any) => {

    const subStepTitles = {
        details: 'Guest Details',
        services: 'Select Service(s)',
        addons: 'Select Add-on(s)',
        staff: 'Preferred Staff',
    };
    
    const selectedServices = services.filter((s: Service) => member.serviceIds.includes(s.id));

    const renderStepContent = () => {
        switch (memberSubStep) {
            case 'details': return <StepDetails member={member} onUpdate={onUpdate} />;
            case 'services': return <StepServices member={member} onUpdate={onUpdate} services={services} staff={staff} pricingTiers={pricingTiers}/>;
            case 'addons': return <StepAddons member={member} onUpdate={onUpdate} compatibleAddons={compatibleAddons} staff={staff} pricingTiers={pricingTiers}/>;
            case 'staff': return <StepStaff member={member} onUpdate={onUpdate} staff={staff} />;
            default: return null;
        }
    }

    return (
        <>
            <CardHeader>
                <CardTitle className="text-2xl">{isGroup ? `Person ${member.index + 1}` : 'Your Visit'}</CardTitle>
                <CardDescription>{subStepTitles[memberSubStep]}</CardDescription>
                {selectedServices.length > 0 && (
                    <div className="pt-2">
                        <div className="flex flex-wrap gap-2">
                            {selectedServices.map((s: Service) => <Badge key={s.id}>{s.name}</Badge>)}
                        </div>
                    </div>
                )}
            </CardHeader>
            <CardContent>
                {renderStepContent()}
            </CardContent>
            <CardFooter className="flex justify-between">
                <Button variant="ghost" onClick={onBack} disabled={isSubmitting}><ArrowLeft className="mr-2 h-4 w-4" /> Back</Button>
                {isGroup ? (
                    <div className="flex gap-2">
                        {!isLastMember && <Button onClick={onNext} disabled={isSubmitting}>Next Person <ArrowRight className="ml-2 h-4 w-4"/></Button>}
                        <Button variant="outline" onClick={onAddAnother} disabled={isSubmitting}>Add Another Person</Button>
                        <Button onClick={onSubmit} disabled={isSubmitting}>Finish & Join Queue</Button>
                    </div>
                ) : (
                    <Button onClick={onNext} disabled={isSubmitting}>
                        {memberSubStep === 'staff' ? 'Join Waitlist' : 'Next'}
                        <ArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                )}
            </CardFooter>
        </>
    );
};

const ConfirmationScreen = ({
    queuePosition,
    onPrint,
    onDone
}: {
    queuePosition: number | null;
    onPrint: () => void;
    onDone: () => void;
}) => {
    const [resetProgress, setResetProgress] = useState(100);

    useEffect(() => {
        const DURATION = 15000;
        const timer = setTimeout(onDone, DURATION);
        const progressInterval = setInterval(() => {
            setResetProgress(prev => Math.max(0, prev - (100 / (DURATION / 100))));
        }, 100);

        return () => {
            clearTimeout(timer);
            clearInterval(progressInterval);
        };
    }, [onDone]);
    
    return (
        <>
            <CardContent className="p-8 text-center space-y-4">
                <CheckCircle className="w-16 h-16 mx-auto text-green-500" />
                <h2 className="text-2xl font-bold">You're on the list!</h2>
                <p className="text-muted-foreground">
                    You are number <span className="font-bold text-primary">{queuePosition}</span> in the queue.
                    We will send a text message to the provided phone number when it's your turn.
                </p>
                <div className="pt-6">
                    <Button className="w-full" onClick={onPrint}>
                        <Printer className="mr-2 h-4 w-4" />
                        Print Ticket
                    </Button>
                </div>
            </CardContent>
            <CardFooter className="flex flex-col gap-4">
                <Button className="w-full" variant="ghost" onClick={onDone}>Done</Button>
                <div className="w-full text-center">
                    <p className="text-xs text-muted-foreground">Resetting for the next guest...</p>
                    <Progress value={resetProgress} className="h-1 mt-2" />
                </div>
            </CardFooter>
        </>
    )
};


const ServiceSelectionCard = ({ service, isSelected, onToggle, staffTierId }: { service: Service; isSelected: boolean; onToggle: () => void; staffTierId?: string }) => {
    const { price, duration } = useMemo(() => {
        let finalPrice = service.price;
        let finalDuration = service.durationMinutes;

        if (staffTierId && service.serviceTiers) {
            const tier = service.serviceTiers.find(t => t.tierId === staffTierId);
            if (tier) {
                finalPrice = tier.price;
                finalDuration = tier.durationMinutes;
            }
        }
        return { price: finalPrice, duration: finalDuration };
    }, [service, staffTierId]);

    const id = `service-card-${service.id}-${nanoid()}`;

    return (
        <Label
            htmlFor={id}
            className={cn(
                "block cursor-pointer rounded-lg border bg-card text-card-foreground transition-all",
                isSelected ? "border-primary ring-2 ring-primary" : "hover:shadow-md"
            )}
        >
            <div className="p-3 flex items-start gap-3">
                <Checkbox id={id} checked={isSelected} onCheckedChange={onToggle} className="mt-1" />
                <div className="flex-1">
                    <p className="font-semibold text-sm">{service.name}</p>
                    {service.description && <p className="text-xs text-muted-foreground line-clamp-2 h-8">{service.description}</p>}
                    <div className="flex items-center gap-4 text-xs text-muted-foreground mt-1">
                        <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{duration} min</span>
                        <span className="flex items-center gap-1"><DollarSign className="w-3 h-3" />{price.toFixed(2)}</span>
                    </div>
                </div>
                {service.imageUrl && (
                    <div className="w-16 h-16 bg-muted rounded-md flex-shrink-0 relative">
                        <Image src={service.imageUrl} alt={service.name} fill className="object-cover rounded-md" />
                    </div>
                )}
            </div>
        </Label>
    );
};

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

export default function WalkInPage() {
  const { firestore } = useFirebase();
  const router = useRouter();
  const { toast } = useToast();
  const params = useParams();
  const tenantId = params.tenantId as string;

  // Data fetching
  const tenantDocRef = useMemoFirebase(() => doc(firestore, `tenants/${tenantId}`), [firestore, tenantId]);
  const { data: tenant, isLoading: tenantLoading } = useDoc<Tenant>(tenantDocRef);
  const servicesQuery = useMemoFirebase(() => query(collection(firestore, `tenants/${tenantId}/services`), where('isPrivate', '!=', true)), [firestore, tenantId]);
  const staffQuery = useMemoFirebase(() => collection(firestore, `tenants/${tenantId}/staff`), [firestore, tenantId]);
  const scheduleProfilesQuery = useMemoFirebase(() => query(collection(firestore, `tenants/${tenantId}/scheduleProfiles`), where("isActive", "==", true)), [firestore, tenantId]);
  const pricingTiersQuery = useMemoFirebase(() => collection(firestore, `tenants/${tenantId}/pricingTiers`), [firestore, tenantId]);

  const { data: services, isLoading: servicesLoading } = useCollection<Service>(servicesQuery);
  const { data: staff, isLoading: staffLoading } = useCollection<Staff>(staffQuery);
  const { data: scheduleProfiles, isLoading: scheduleProfilesLoading } = useCollection(scheduleProfilesQuery);
  const { data: pricingTiers, isLoading: pricingTiersLoading } = useCollection<PricingTier>(pricingTiersQuery);


  const scheduleProfile = useMemo(() => scheduleProfiles?.[0], [scheduleProfiles]);

  // UI State
  const [step, setStep] = useState<Step>('partyType');
  const [isGroup, setIsGroup] = useState(false);
  const [partyMembers, setPartyMembers] = useState<PartyMember[]>([]);
  const [currentMemberIndex, setCurrentMemberIndex] = useState(0);
  const [memberSubStep, setMemberSubStep] = useState<MemberSubStep>('details');
  const [isPrintDialogOpen, setIsPrintDialogOpen] = useState(false);

  // Final confirmation state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [queuePosition, setQueuePosition] = useState<number | null>(null);
  const [ticketToPrint, setTicketToPrint] = useState<WalkInTicketData | null>(null);
  const [resetProgress, setResetProgress] = useState(100);

  const { open: businessIsOpen, nextOpen } = useMemo(() => {
    return isBusinessOpen(new Date(), scheduleProfile);
  }, [scheduleProfile]);
  
  const [hasMounted, setHasMounted] = useState(false);
  useEffect(() => { setHasMounted(true); }, []);
  
  const handlePartyTypeSelect = (type: 'individual' | 'group') => {
    setIsGroup(type === 'group');
    setPartyMembers([{ id: nanoid(5), name: '', serviceIds: [], isPrimary: true, preferredStaffId: 'any', waitForPreferredStaff: false }]);
    setCurrentMemberIndex(0);
    setMemberSubStep('details');
    setStep('memberSetup');
  };

  const handleMemberUpdate = (updates: Partial<PartyMember>) => {
    setPartyMembers(prev => prev.map((m, index) => index === currentMemberIndex ? { ...m, ...updates } : m));
  };

  const getNextSubStep = (current: MemberSubStep, hasCompatibleAddons: boolean): MemberSubStep | null => {
    const steps: MemberSubStep[] = ['details', 'services'];
    if (hasCompatibleAddons) {
      steps.push('addons');
    }
    steps.push('staff');
  
    const currentIndex = steps.indexOf(current);
    if (currentIndex < steps.length - 1) {
      return steps[currentIndex + 1];
    }
    return null;
  };
  
  const handleNextMember = () => {
    if (isSubmitting) return;

    const currentMember = partyMembers[currentMemberIndex];
    if (!currentMember.name.trim() || currentMember.serviceIds.length === 0) {
        toast({ variant: 'destructive', title: 'Missing Information', description: "Please enter the guest's name and select at least one service." });
        return;
    }
    
    const primaryService = services?.find(s => s.id === currentMember.serviceIds[0]);
    const hasCompatibleAddons = primaryService?.compatibleAddOnIds && primaryService.compatibleAddOnIds.length > 0;

    const nextStep = getNextSubStep(memberSubStep, hasCompatibleAddons);

    if (nextStep) {
        setMemberSubStep(nextStep);
    } else {
        if (isGroup && currentMemberIndex < partyMembers.length - 1) {
            setCurrentMemberIndex(prev => prev + 1);
            setMemberSubStep('details');
        } else {
            handleSubmit();
        }
    }
  };
  
  const handleAddAnother = () => {
    if (isSubmitting) return;
    const currentMember = partyMembers[currentMemberIndex];
     if (!currentMember.name.trim() || currentMember.serviceIds.length === 0) {
        toast({ variant: 'destructive', title: 'Missing Information', description: "Please enter the guest's name and select at least one service." });
        return;
    }
    setPartyMembers(prev => [...prev, { id: nanoid(5), name: ``, serviceIds: [], preferredStaffId: 'any', waitForPreferredStaff: false }]);
    setCurrentMemberIndex(partyMembers.length);
    setMemberSubStep('details');
  }

  const handleBack = () => {
    if (memberSubStep !== 'details') {
      const currentMember = partyMembers[currentMemberIndex];
      const primaryService = services?.find(s => s.id === currentMember.serviceIds[0]);
      const hasCompatibleAddons = primaryService?.compatibleAddOnIds && primaryService.compatibleAddOnIds.length > 0;
      const steps: MemberSubStep[] = ['details', 'services'];
      if (hasCompatibleAddons) steps.push('addons');
      steps.push('staff');
      const currentIndex = steps.indexOf(memberSubStep);
      setMemberSubStep(steps[currentIndex - 1]);
    } else if (currentMemberIndex > 0) {
        setCurrentMemberIndex(prev => prev - 1);
        setMemberSubStep('staff'); // Go to last step of previous member
    } else {
        setStep('partyType');
        setPartyMembers([]);
    }
  }

  const resetFlow = useCallback(() => {
    setStep('partyType');
    setIsGroup(false);
    setPartyMembers([]);
    setCurrentMemberIndex(0);
    setIsSubmitting(false);
    setQueuePosition(null);
    setTicketToPrint(null);
  }, []);

  const handleSubmit = async () => {
    if (isSubmitting) return;

    const primaryMember = partyMembers[0];
    if (!primaryMember.name.trim() || partyMembers.every(m => m.serviceIds.length === 0)) {
      toast({ variant: 'destructive', title: 'Missing Information', description: "Please enter the primary contact's name and select at least one service." });
      return;
    }

    setIsSubmitting(true);
    const walkInsRef = collection(firestore, 'tenants', tenantId, 'walkIns');
    const batch = writeBatch(firestore);
    
    const groupId = nanoid();
    const checkInTime = new Date().toISOString();
    const currentTime = Date.now();
    let primaryWalkInId = '';

    partyMembers.forEach((member, index) => {
        if (member.serviceIds.length === 0) return;
        const memberWalkInId = nanoid();
        if (index === 0) primaryWalkInId = memberWalkInId;
        const memberServices = services?.filter(s => member.serviceIds.includes(s.id)) || [];
        const memberWalkIn: Omit<WalkIn, 'id'> = {
            groupId,
            groupName: isGroup ? `${primaryMember.name}'s Group` : undefined,
            isPrimaryContact: index === 0,
            customerName: member.name,
            customerPhone: index === 0 ? primaryMember.phone : undefined,
            customerEmail: index === 0 ? primaryMember.email : undefined,
            serviceIds: member.serviceIds,
            requiredSkills: [...new Set(memberServices.flatMap(s => s.requiredSkills || []))],
            estimatedDuration: memberServices.reduce((acc, s) => {
                const staffMember = staff?.find(st => st.id === member.preferredStaffId);
                const tier = s.serviceTiers?.find(t => t.tierId === staffMember?.pricingTierId);
                return acc + (tier?.durationMinutes || s.durationMinutes);
            }, 0),
            checkInTime,
            status: 'waiting',
            preferredStaffId: member.preferredStaffId === 'any' ? undefined : member.preferredStaffId,
            waitForPreferredStaff: member.preferredStaffId !== 'any' ? member.waitForPreferredStaff : false,
            queueOrder: currentTime + index,
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

        setTicketToPrint({
            id: primaryWalkInId,
            name: primaryMember.name,
            services: services?.filter(s => primaryMember.serviceIds.includes(s.id)) || [],
            queuePosition: newPosition,
            checkInTime: checkInTime,
        });
        setStep('confirmation');

    } catch (error) {
        console.error("Error adding walk-in:", error);
        toast({ variant: 'destructive', title: 'Something went wrong', description: 'Could not add you to the waitlist.' });
        setIsSubmitting(false);
    }
  };
  
  const isLoading = tenantLoading || servicesLoading || staffLoading || scheduleProfilesLoading || !hasMounted || pricingTiersLoading;
  if (isLoading) return <div className="flex min-h-screen w-full items-center justify-center"><Loader className="h-8 w-8 animate-spin" /></div>;
  if (!businessIsOpen) return <div>Closed</div>;

  const currentMember = partyMembers[currentMemberIndex];
  const primaryService = services?.find(s => s.id === currentMember?.serviceIds[0]);
  const compatibleAddons = primaryService?.compatibleAddOnIds
    ? services?.filter(s => primaryService.compatibleAddOnIds!.includes(s.id))
    : [];

  return (
    <>
    <div className="w-full max-w-2xl mx-auto">
        <header className="mb-8 text-center">
          <div className="inline-block p-3 bg-card rounded-full shadow-md mb-4">
            <ClarityFlowLogo />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">{tenant?.name || 'ClarityFlow Salon'}</h1>
          <p className="text-muted-foreground mt-2">Walk-in Check-in</p>
        </header>
        
        <Card className="overflow-hidden">
            {step === 'partyType' && (
                <PartyTypeSelection onSelect={handlePartyTypeSelect} />
            )}
            {step === 'memberSetup' && currentMember && (
                <MemberSetup
                    member={{...currentMember, index: currentMemberIndex}}
                    onUpdate={handleMemberUpdate}
                    memberSubStep={memberSubStep}
                    setMemberSubStep={setMemberSubStep}
                    services={services || []}
                    staff={staff || []}
                    pricingTiers={pricingTiers || []}
                    compatibleAddons={compatibleAddons || []}
                    onNext={handleNextMember}
                    onBack={handleBack}
                    isGroup={isGroup}
                    isLastMember={currentMemberIndex === partyMembers.length - 1}
                    onAddAnother={handleAddAnother}
                    onSubmit={handleSubmit}
                    isSubmitting={isSubmitting}
                />
            )}
            {step === 'confirmation' && (
                <ConfirmationScreen
                    queuePosition={queuePosition}
                    onPrint={() => setIsPrintDialogOpen(true)}
                    onDone={resetFlow}
                />
            )}
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
