'use client';

import React, { useState, useMemo, useEffect } from 'react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  type Service,
  type Staff,
  type Appointment,
  type Event,
  type Tenant,
  type ConsentForm,
  type PricingTier,
  type Client,
} from '@/lib/data';
import { Progress } from '@/components/ui/progress';
import Image from 'next/image';
import { Clock, DollarSign, Users, Calendar, ChevronLeft, ChevronRight, User, Mail, Phone, CheckCircle, FileSignature, ShieldCheck, CreditCard, Award, Star, Info, ListChecks, ChevronDown } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '../ui/card';
import {
  startOfWeek,
  addDays,
  isSameDay,
  format,
  setHours,
  setMinutes,
  startOfDay,
  areIntervalsOverlapping,
  addMinutes,
  isBefore,
  isToday,
  parseISO,
  subWeeks,
  addWeeks,
} from 'date-fns';
import { nanoid } from 'nanoid';
import { useForm, FormProvider } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { PhoneInput } from '../ui/phone-input';
import { useToast } from '@/hooks/use-toast';
import { FormFieldRenderer } from '../consents/FormFieldRenderer';
import { Separator } from '../ui/separator';
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from '../ui/tooltip';

const bookingSchema = z.object({
  clientName: z.string().min(1, 'Name is required'),
  clientEmail: z.string().email('Invalid email address'),
  clientPhone: z.string().optional(),
});

type BookingFormData = z.infer<typeof bookingSchema>;

const StaffSelectionCard = ({ staff, isSelected, disabled }: { staff: Staff | { id: string, name: string, avatarUrl: string }, isSelected: boolean, disabled?: boolean }) => {
    const isAnyStaff = staff.id === 'any';
    return (
        <label htmlFor={`staff-${staff.id}`} className={cn("block cursor-pointer", disabled && "cursor-not-allowed opacity-50")}>
            <Card className={cn('transition-all', isSelected ? 'border-primary ring-2 ring-primary shadow-md' : 'hover:border-primary/50', disabled && 'bg-muted/50 hover:border-muted')}>
                <CardContent className="p-4 flex flex-col items-center gap-3">
                    <Avatar className="w-16 h-16 border-2 border-background shadow-inner">
                        {staff.avatarUrl ? <AvatarImage src={staff.avatarUrl} className="object-cover" /> : null}
                        <AvatarFallback className="text-muted-foreground bg-muted">
                            {isAnyStaff ? <Users className="w-8 h-8"/> : staff.name.charAt(0)}
                        </AvatarFallback>
                    </Avatar>
                    <p className="font-semibold text-sm text-center truncate w-full">{staff.name}</p>
                    <RadioGroupItem value={staff.id} id={`staff-${staff.id}`} className="sr-only" disabled={disabled} />
                </CardContent>
            </Card>
        </label>
    );
};

interface BookingSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  service: Service;
  staff: Staff[];
  initialStaffId?: string;
  appointments: Appointment[];
  events: Event[];
  scheduleProfiles: any[];
  services: Service[];
  consentForms: ConsentForm[];
  tenant: Tenant | null;
  onConfirm: (
    formData: { clientName: string; clientEmail: string; clientPhone?: string },
    appointmentDetails: Omit<Appointment, 'id' | 'clientId' | 'clientName' | 'clientEmail' | 'clientPhone'>,
    signedForms: { formId: string; formTitle: string; formData: Record<string, any> }[],
    setBookingStep: (step: string) => void
  ) => void;
}

const timeStringToDate = (timeStr: string, date: Date): Date => {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);

    if (!timeStr) {
      return d;
    }

    const [time, period] = timeStr.split(' ');
    let [hours, minutes] = time.split(':').map(Number);

    if (period === 'PM' && hours < 12) {
        hours += 12;
    }
    if (period === 'AM' && hours === 12) {
        hours = 0;
    }

    d.setHours(hours, minutes);
    return d;
}

export const BookingSheet: React.FC<BookingSheetProps> = ({
  open,
  onOpenChange,
  service,
  staff,
  initialStaffId,
  appointments,
  events,
  scheduleProfiles,
  services,
  consentForms,
  tenant,
  onConfirm,
}) => {
  const [selectedStaffId, setSelectedStaffId] = useState(initialStaffId || 'any');
  const [selectedTierId, setSelectedTierId] = useState<string>('any');
  const [date, setDate] = useState(new Date());
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
  const [formAnswers, setFormAnswers] = useState<Record<string, Record<string, any>>>({});
  const [isDepositPaid, setIsDepositPaid] = useState(false);
  const [bookedStaffId, setBookedStaffId] = useState<string | null>(null);
  const { toast } = useToast();

  const methods = useForm<BookingFormData>({
    resolver: zodResolver(bookingSchema),
  });

  const { handleSubmit } = methods;

  const qualifiedStaff = useMemo(() => {
    if (!service?.requiredSkills || service.requiredSkills.length === 0) return staff;
    return staff.filter(s => service.requiredSkills!.every(skill => (s.skillSet || []).includes(skill)));
  }, [service, staff]);

  // Determine which tiers are actually available for this service
  const availableTiersForService = useMemo(() => {
    if (!service.serviceTiers || service.serviceTiers.length === 0) return [];
    
    // We only care about tiers that have a staff member in them who can do this service
    const tiersWithStaff = new Set(qualifiedStaff.map(s => s.pricingTierId).filter(Boolean));
    
    // Map service tiers to pricing tier info (names)
    // In a real app we'd fetch names from pricingTiers collection
    // Here we'll infer or assume the names are available in the context or data
    return service.serviceTiers.filter(st => tiersWithStaff.has(st.tierId));
  }, [service, qualifiedStaff]);
  
  const weekStart = useMemo(() => startOfWeek(date, { weekStartsOn: 0 }), [date]);
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const publicScheduleProfile = useMemo(() => scheduleProfiles?.find(p => p.isActive), [scheduleProfiles]);

  const timeSlots = useMemo(() => {
    if (!service || !date || !publicScheduleProfile || !staff || !services) return [];
    const bookingInterval = publicScheduleProfile.bookingSlotInterval || 15;
    const dayName = format(date, 'eeee').toLowerCase();
    
    let staffMembersToCheck = selectedStaffId === 'any' ? qualifiedStaff : qualifiedStaff.filter(s => s.id === selectedStaffId);
    
    // If 'Any Available' is selected but a specific tier is preferred
    if (selectedStaffId === 'any' && selectedTierId !== 'any') {
        staffMembersToCheck = staffMembersToCheck.filter(s => s.pricingTierId === selectedTierId);
    }

    const options: Set<string> = new Set();
    
    staffMembersToCheck.forEach(staffMember => {
        let workingHours;
        const staffDaySchedule = staffMember?.availability?.week?.[dayName as keyof typeof staffMember.availability.week];
        if (staffDaySchedule?.enabled) workingHours = staffDaySchedule;
        else if (staffDaySchedule && !staffDaySchedule.enabled) return;
        else workingHours = publicScheduleProfile?.week?.[dayName];
        
        if (!workingHours || !workingHours.enabled) return;
        const dayStartWithBusinessHours = timeStringToDate(workingHours.start, date);
        const dayEndWithBusinessHours = timeStringToDate(workingHours.end, date);
        const busyIntervals: { start: Date, end: Date }[] = [];

        appointments.filter(apt => isSameDay(apt.startTime, date) && apt.staffId === staffMember.id).forEach(apt => {
            const aptService = services.find(s => s.id === apt.serviceId);
            busyIntervals.push({ start: addMinutes(apt.startTime, -(aptService?.padBefore || 0)), end: addMinutes(apt.endTime, (aptService?.padAfter || 0)) });
        });

        events.filter(evt => isSameDay(evt.startTime, date) && evt.type === 'blocked' && (!evt.staffId || evt.staffId === 'all' || evt.staffId === staffMember.id)).forEach(evt => {
            busyIntervals.push({ start: evt.startTime, end: evt.endTime });
        });

        let currentTime = dayStartWithBusinessHours;
        const now = new Date();
        if (isToday(date)) {
            const minSinceStart = (now.getHours() * 60) + now.getMinutes();
            const busStartMin = (currentTime.getHours() * 60) + currentTime.getMinutes();
            const skip = Math.ceil((minSinceStart - busStartMin) / bookingInterval);
            if (skip > 0) currentTime = addMinutes(dayStartWithBusinessHours, skip * bookingInterval);
        }
        
        while (currentTime < dayEndWithBusinessHours) {
            const potentialEnd = addMinutes(currentTime, service.duration + (service.padBefore || 0) + (service.padAfter || 0));
            if (potentialEnd > dayEndWithBusinessHours) break;
            const isOverlapping = busyIntervals.some((interval) => areIntervalsOverlapping({ start: currentTime, end: potentialEnd }, interval, { inclusive: false }));
            if (!isOverlapping) options.add(format(currentTime, 'HH:mm'));
            currentTime = addMinutes(currentTime, bookingInterval);
        }
    });
    return Array.from(options).sort();
}, [date, selectedStaffId, selectedTierId, qualifiedStaff, service, staff, appointments, events, publicScheduleProfile, services]);

    const requiredForms = useMemo(() => {
        if (!service || !consentForms) return [];
        return consentForms.filter(form => service.requiredFormIds?.includes(form.id));
    }, [service, consentForms]);
    
    const { price, priceRange, activeTier } = useMemo(() => {
        if (!service.serviceTiers || service.serviceTiers.length === 0) return { price: service.price, priceRange: null, activeTier: null };
        
        // If a specific staff is selected
        if (selectedStaffId && selectedStaffId !== 'any') {
          const staffMember = staff.find(s => s.id === selectedStaffId);
          const tierPricing = service.serviceTiers.find(t => t.tierId === staffMember?.pricingTierId);
          if (tierPricing) return { price: tierPricing.price, priceRange: null, activeTier: tierPricing };
        }

        // If 'Any Available' is selected but a specific tier is preferred
        if (selectedStaffId === 'any' && selectedTierId !== 'any') {
            const tierPricing = service.serviceTiers.find(t => t.tierId === selectedTierId);
            if (tierPricing) return { price: tierPricing.price, priceRange: null, activeTier: tierPricing };
        }

        const prices = service.serviceTiers.map(t => t.price);
        const minPrice = Math.min(...prices);
        const maxPrice = Math.max(...prices);
        if (minPrice === maxPrice) return { price: minPrice, priceRange: null, activeTier: null };
        return { price: minPrice, priceRange: { min: minPrice, max: maxPrice }, activeTier: null };
      }, [service, selectedStaffId, selectedTierId, staff]);

    const depositAmount = useMemo(() => {
        if (!service || service.depositType === 'none') return 0;
        if (service.depositType === 'full') return price;
        if (service.depositType === 'breakeven') return service.cost;
        if (service.depositType === 'deposit') {
            if (service.depositSubType === 'percentage') return price * ((service.depositAmount || 0) / 100);
            return service.depositAmount || 0;
        }
        return 0;
    }, [service, price]);
    
    const steps = useMemo(() => {
        const flow = ['staff', 'dateTime', 'details'];
        if (requiredForms.length > 0) flow.push('consents');
        flow.push('summary');
        if (depositAmount > 0) flow.push('payment');
        flow.push('confirmation');
        return flow;
    }, [requiredForms.length, depositAmount]);

    const [currentStepIndex, setCurrentStepIndex] = useState(0);
    const currentStep = steps[currentStepIndex];
    const progress = useMemo(() => ((currentStepIndex) / (steps.length - 1)) * 100, [currentStepIndex, steps.length]);

  useEffect(() => {
    if (open) {
        if (initialStaffId) { setSelectedStaffId(initialStaffId); setCurrentStepIndex(1); }
        else { setSelectedStaffId('any'); setCurrentStepIndex(0); }
        setSelectedTime(null); setSelectedTierId('any'); setDate(new Date()); methods.reset(); setFormAnswers({}); setIsDepositPaid(false); setBookedStaffId(null);
    }
  }, [open, initialStaffId, methods]);

  const handleNextStep = async () => {
    if (currentStep === 'dateTime' && !selectedTime) { toast({ variant: 'destructive', title: 'Please select a time.' }); return; }
    if (currentStep === 'details') { const valid = await methods.trigger(['clientName', 'clientEmail']); if (!valid) return; }
    if (currentStep === 'consents') {
        const allCompleted = requiredForms.every(form => {
            const answers = formAnswers[form.id] || {};
            return (form.fields || []).every(f => {
                if (f.type === 'heading' || f.type === 'paragraph') return true;
                const ans = answers[f.id];
                return ans !== undefined && ans !== null && ans !== '';
            });
        });
        if (!allCompleted) { toast({ variant: 'destructive', title: 'Incomplete Forms', description: 'Please fill out all required fields and sign all forms.' }); return; }
    }
    if (currentStep === 'payment' && !isDepositPaid) { setIsDepositPaid(true); toast({ title: "Deposit Paid!" }); }
    
    if (steps[currentStepIndex + 1] === 'confirmation') { handleSubmit(handleConfirmBooking)(); return; }
    setCurrentStepIndex(currentStepIndex + 1);
  };

  const handlePrevStep = () => {
    if (currentStepIndex > 0) {
      setCurrentStepIndex(currentStepIndex - 1);
    }
  };

  const handleStaffSelect = (staffId: string) => {
    if (initialStaffId) return;
    setSelectedStaffId(staffId);
    if (staffId !== 'any') {
        setCurrentStepIndex(1);
        setSelectedTime(null);
    }
  };
  
  const handleConfirmBooking = (data: BookingFormData) => {
    if (!service || !selectedTime) return;
    const [hours, minutes] = selectedTime.split(':').map(Number);
    const startDateTime = setMinutes(setHours(startOfDay(date), hours), minutes);
    const endDateTime = addMinutes(startDateTime, service.duration);

    const clientData = { clientName: data.clientName, clientEmail: data.clientEmail, clientPhone: data.clientPhone };

    let finalStaffId = selectedStaffId;
    if (finalStaffId === 'any') {
      const available = qualifiedStaff.filter(s => {
        if (selectedTierId !== 'any' && s.pricingTierId !== selectedTierId) return false;
        const day = format(startDateTime, 'eeee').toLowerCase();
        const sched = s.availability?.week?.[day as keyof typeof s.availability.week] || publicScheduleProfile?.week?.[day];
        if (!sched?.enabled) return false;
        const openT = timeStringToDate(sched.start, startDateTime);
        const closeT = timeStringToDate(sched.end, startDateTime);
        if (startDateTime < openT || endDateTime > closeT) return false;
        return !appointments.some(apt => apt.staffId === s.id && apt.status !== 'cancelled' && areIntervalsOverlapping({ start: startDateTime, end: endDateTime }, { start: apt.startTime, end: apt.endTime }, { inclusive: false }));
      });
      if (available.length > 0) {
        available.sort((a, b) => (a.lastServedTimestamp ? new Date(a.lastServedTimestamp).getTime() : 0) - (b.lastServedTimestamp ? new Date(b.lastServedTimestamp).getTime() : 0));
        finalStaffId = available[0].id;
      } else { toast({ variant: 'destructive', title: 'No staff available' }); return; }
    }

    setBookedStaffId(finalStaffId);
    const signedForms = requiredForms.map(form => ({ formId: form.id, formTitle: form.title, formData: formAnswers[form.id] || {} }));
    onConfirm(clientData, { serviceId: service.id, staffId: finalStaffId, startTime: startDateTime.toISOString(), endTime: endDateTime.toISOString(), status: 'confirmed', isWalkIn: false }, signedForms, (s) => setCurrentStepIndex(steps.indexOf(s)));
  };

  const bookedStaff = useMemo(() => staff.find(s => s.id === bookedStaffId), [staff, bookedStaffId]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg p-0 flex flex-col border-l-0 sm:border-l">
        <SheetHeader className="p-6 pb-4 bg-muted/30">
          <SheetTitle className="text-2xl font-bold">Book Appointment</SheetTitle>
          {currentStep !== 'confirmation' && <div className="pt-2"><Progress value={progress} className="h-1.5" /></div>}
        </SheetHeader>
        <ScrollArea className="flex-1">
            <div className="p-6 space-y-8">
                {currentStep === 'confirmation' ? (
                    <div className="text-center py-12 space-y-6">
                        <div className="w-20 h-20 bg-green-500/10 rounded-full flex items-center justify-center mx-auto">
                            <CheckCircle className="w-10 h-10 text-green-500" />
                        </div>
                        <div className="space-y-2">
                            <h2 className="text-3xl font-bold">You're All Set!</h2>
                            <p className="text-muted-foreground">Your appointment for <strong>{service?.name}</strong> is confirmed. We've sent the details to your email.</p>
                        </div>
                        
                        {bookedStaff && (
                            <Card className="max-w-xs mx-auto border-2">
                                <CardContent className="p-4 flex flex-col items-center gap-3">
                                    <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Your Professional</p>
                                    <Avatar className="w-20 h-20 border-4 border-background shadow-lg">
                                        <AvatarImage src={bookedStaff.avatarUrl} className="object-cover" />
                                        <AvatarFallback>{bookedStaff.name.charAt(0)}</AvatarFallback>
                                    </Avatar>
                                    <div className="text-center">
                                        <p className="font-bold text-lg">{bookedStaff.name}</p>
                                        <p className="text-xs text-muted-foreground">{bookedStaff.specialties?.slice(0, 2).join(', ')}</p>
                                    </div>
                                </CardContent>
                            </Card>
                        )}

                        <div className="flex flex-col gap-2 pt-4">
                            <Button className="w-full h-12 text-lg font-bold" variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
                        </div>
                    </div>
                ) : (
                    <>
                        <div className="space-y-4">
                            <div className="flex items-center justify-between"><h3 className="font-bold flex items-center gap-2 text-lg"><Clock className="w-5 h-5 text-primary" /> Service</h3>{currentStep !== 'staff' && <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} className="h-auto p-0 text-muted-foreground underline">Change</Button>}</div>
                            <Card className="overflow-hidden border-2">
                                <CardContent className="p-4 flex gap-4 items-center">
                                    <div className="relative w-20 h-20 rounded-lg overflow-hidden bg-muted"><Image src={service?.imageUrl || `https://picsum.photos/seed/${service?.id}/200/200`} alt={service?.name} fill className="object-cover" /></div>
                                    <div className="flex-1 space-y-1">
                                        <p className="font-bold text-lg leading-tight">{service?.name}</p>
                                        <div className="text-sm text-muted-foreground flex items-center gap-4">
                                            <span className="flex items-center gap-1.5"><Clock className="w-3.5 h-3.5"/>{service?.duration} min</span>
                                            <span className="flex items-center gap-1.5 font-bold text-foreground"><DollarSign className="w-3.5 h-3.5"/>{priceRange ? `From $${priceRange.min}` : `$${price?.toFixed(2)}`}</span>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        </div>
                        
                        {currentStep === 'staff' && (
                           <div className="space-y-6">
                                <h3 className="text-lg font-bold flex items-center gap-2"><Users className="w-5 h-5 text-primary" /> Choose Your Provider</h3>
                                <RadioGroup onValueChange={handleStaffSelect} value={selectedStaffId} className="grid grid-cols-2 gap-4">
                                    <StaffSelectionCard staff={{id: 'any', name: 'Any Available', avatarUrl: ''}} isSelected={selectedStaffId === 'any'} disabled={!!initialStaffId} />
                                    {qualifiedStaff.map(s => <StaffSelectionCard key={s.id} staff={s} isSelected={selectedStaffId === s.id} disabled={!!initialStaffId && s.id !== initialStaffId} />)}
                                </RadioGroup>

                                {selectedStaffId === 'any' && availableTiersForService.length > 0 && (
                                    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-4 pt-4 border-t">
                                        <div className="space-y-1">
                                            <h4 className="font-bold text-sm">Price Tier Preference</h4>
                                            <p className="text-xs text-muted-foreground">Select a skill level to view accurate pricing and availability.</p>
                                        </div>
                                        <RadioGroup value={selectedTierId} onValueChange={setSelectedTierId} className="space-y-2">
                                            <label htmlFor="tier-any" className="flex items-center justify-between p-3 rounded-lg border-2 cursor-pointer hover:bg-muted/50 transition-all has-[:checked]:border-primary has-[:checked]:bg-primary/5">
                                                <div className="flex items-center gap-2">
                                                    <RadioGroupItem value="any" id="tier-any" />
                                                    <span className="text-sm font-medium">First Available (Any Price)</span>
                                                </div>
                                            </label>
                                            {availableTiersForService.map(tier => (
                                                <label key={tier.tierId} htmlFor={`tier-${tier.tierId}`} className="flex items-center justify-between p-3 rounded-lg border-2 cursor-pointer hover:bg-muted/50 transition-all has-[:checked]:border-primary has-[:checked]:bg-primary/5">
                                                    <div className="flex items-center gap-2">
                                                        <RadioGroupItem value={tier.tierId} id={`tier-${tier.tierId}`} />
                                                        <span className="text-sm font-medium">Any Available {tier.tierId.charAt(0).toUpperCase() + tier.tierId.slice(1)}</span>
                                                    </div>
                                                    <span className="font-bold text-primary text-sm">${tier.price.toFixed(2)}</span>
                                                </label>
                                            ))}
                                        </RadioGroup>
                                        <Button className="w-full h-12 mt-4" onClick={() => setCurrentStepIndex(1)}>View Available Times</Button>
                                    </motion.div>
                                )}
                            </div>
                        )}

                        {currentStep === 'dateTime' && (
                             <div className="space-y-4">
                                <h3 className="text-lg font-bold flex items-center gap-2"><Calendar className="w-5 h-5 text-primary" /> Select Date & Time</h3>
                                <div className="p-4 rounded-xl border-2 space-y-4 bg-muted/10">
                                    <div className="flex items-center justify-between"><Button variant="ghost" size="icon" onClick={() => setDate(prev => addDays(prev, -7))}><ChevronLeft className="w-4 h-4" /></Button><span className="font-bold">{format(weekStart, 'MMMM yyyy')}</span><Button variant="ghost" size="icon" onClick={() => setDate(prev => addDays(prev, 7))}><ChevronRight className="w-4 h-4" /></Button></div>
                                    <div className="grid grid-cols-7 gap-1.5">{weekDays.map(day => (<button key={day.toString()} onClick={() => setDate(day)} disabled={isBefore(day, startOfDay(new Date())) && !isToday(day)} className={cn("flex flex-col items-center justify-center p-2 rounded-lg border transition-all aspect-square", isSameDay(day, date) ? "bg-primary text-primary-foreground border-primary shadow-md scale-105" : "bg-background hover:border-primary/50", (isBefore(day, startOfDay(new Date())) && !isToday(day)) && "opacity-20 cursor-not-allowed")} type="button"><span className="text-[10px] uppercase font-bold">{format(day, 'E')}</span><span className="font-bold text-lg">{format(day, 'd')}</span></button>))}</div>
                                    <div className="grid grid-cols-3 gap-2 pt-4 border-t">
                                        {timeSlots.map(time => (<Button key={time} variant={selectedTime === time ? 'default' : 'outline'} onClick={() => setSelectedTime(time)} className={cn("h-11 font-semibold", selectedTime === time && "shadow-md")}>{format(timeStringToDate(time, new Date()), 'h:mm a')}</Button>))}
                                        {timeSlots.length === 0 && (<p className="col-span-full text-center text-sm text-muted-foreground py-8">No availability for this day.</p>)}
                                    </div>
                                </div>
                            </div>
                        )}
                        
                        {currentStep === 'details' && (
                            <FormProvider {...methods}>
                                <form id="booking-details-form" onSubmit={handleSubmit(handleConfirmBooking)} className="space-y-6">
                                    <h3 className="text-lg font-bold flex items-center gap-2"><User className="w-5 h-5 text-primary" /> Your Information</h3>
                                    <div className="space-y-4">
                                        <div className="space-y-2"><Label htmlFor="name">Full Name</Label><Input id="name" {...methods.register('clientName')} className="h-12" /></div>
                                        <div className="space-y-2"><Label htmlFor="email">Email</Label><Input id="email" type="email" {...methods.register('clientEmail')} className="h-12" /></div>
                                        <PhoneInput name="clientPhone" label="Phone (for SMS alerts)" />
                                    </div>
                                </form>
                            </FormProvider>
                        )}

                        {currentStep === 'consents' && (
                            <div className="space-y-6">
                                <h3 className="text-lg font-bold flex items-center gap-2"><FileSignature className="w-5 h-5 text-primary" /> Consent Forms</h3>
                                <div className="space-y-8">
                                    {requiredForms.map(form => (
                                        <div key={form.id} className="space-y-4 p-4 rounded-xl border-2 bg-muted/5">
                                            <div className="flex items-center gap-2 text-lg font-bold pb-2 border-b"><ListChecks className="w-5 h-5 text-primary" />{form.title}</div>
                                            <div className="space-y-6">
                                                {form.fields?.map(field => (
                                                    <FormFieldRenderer 
                                                        key={field.id} 
                                                        field={field} 
                                                        value={formAnswers[form.id]?.[field.id]}
                                                        onChange={(val) => setFormAnswers(prev => ({
                                                            ...prev,
                                                            [form.id]: { ...(prev[form.id] || {}), [field.id]: val }
                                                        }))}
                                                    />
                                                ))}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {currentStep === 'summary' && (
                             <div className="space-y-4">
                                <h3 className="text-lg font-bold flex items-center gap-2"><ShieldCheck className="w-5 h-5 text-primary" /> Review & Confirm</h3>
                                <Card className="bg-primary/5 border-primary/20 overflow-hidden">
                                    <CardContent className="p-6 space-y-4">
                                        <div className="flex justify-between items-center"><span className="text-muted-foreground">Provider</span> <span className="font-bold">{selectedStaffId === 'any' ? 'Any Available' : staff.find(s=>s.id === selectedStaffId)?.name}</span></div>
                                        {selectedStaffId === 'any' && selectedTierId !== 'any' && (
                                            <div className="flex justify-between items-center"><span className="text-muted-foreground">Price Tier</span> <span className="font-bold capitalize text-primary">{selectedTierId}</span></div>
                                        )}
                                        <div className="flex justify-between items-center"><span className="text-muted-foreground">Date</span> <span className="font-bold">{format(date, 'EEEE, MMM d, yyyy')}</span></div>
                                        <div className="flex justify-between items-center"><span className="text-muted-foreground">Time</span> <span className="font-bold text-primary">{selectedTime ? format(timeStringToDate(selectedTime, new Date()), 'h:mm a') : ''}</span></div>
                                        <Separator className="bg-primary/10" />
                                        <div className="flex justify-between items-center text-xl font-black"><span>Total</span> <span>${price?.toFixed(2)}</span></div>
                                        {depositAmount > 0 && <p className="text-xs text-right text-muted-foreground">A deposit of <strong>${depositAmount.toFixed(2)}</strong> will be required next.</p>}
                                    </CardContent>
                                </Card>
                            </div>
                        )}

                        {currentStep === 'payment' && (
                            <div className="space-y-6">
                                <h3 className="text-lg font-bold flex items-center gap-2"><CreditCard className="w-5 h-5 text-primary" /> Secure Deposit</h3>
                                <Card className="border-2 shadow-lg"><CardContent className="p-8 space-y-6">
                                    <div className="text-center space-y-1"><p className="text-sm font-medium text-muted-foreground uppercase tracking-widest">Required Deposit</p><p className="text-5xl font-black text-primary">${depositAmount.toFixed(2)}</p></div>
                                    <div className="space-y-4 pt-4 border-t">
                                        <div className="space-y-2"><Label>Card Number</Label><Input placeholder="**** **** **** 1234" className="h-12" /></div>
                                        <div className="grid grid-cols-2 gap-4"><div className="space-y-2"><Label>Expiry</Label><Input placeholder="MM / YY" className="h-12" /></div><div className="space-y-2"><Label>CVC</Label><Input placeholder="123" className="h-12" /></div></div>
                                    </div>
                                </CardContent></Card>
                            </div>
                        )}
                    </>
                )}
            </div>
        </ScrollArea>
        {currentStep !== 'confirmation' && (
            <SheetFooter className="p-6 border-t bg-muted/10 backdrop-blur-sm">
                <div className="flex w-full gap-3">
                    {currentStepIndex > 0 && <Button variant="outline" onClick={handlePrevStep} className="flex-1 h-12">Back</Button>}
                    <Button onClick={handleNextStep} className={cn("h-12 font-bold text-lg", currentStepIndex === 0 ? "w-full" : "flex-[2]")}>
                        {currentStep === 'summary' && depositAmount > 0 ? 'Pay Deposit' : currentStep === 'summary' || currentStep === 'payment' ? 'Confirm Booking' : 'Continue'}
                    </Button>
                </div>
            </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
  );
};