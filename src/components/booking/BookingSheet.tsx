'use client';

import React, { useState, useMemo, useEffect, useCallback } from 'react';
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
  getServicePrice,
} from '@/lib/data';
import { Progress } from '@/components/ui/progress';
import Image from 'next/image';
import { Clock, Calendar, ChevronLeft, ChevronRight, User, Mail, Phone, CheckCircle, FileSignature, ShieldCheck, CreditCard, Award, Star, Info, ListChecks, ChevronDown, MapPin, Wallet, AlertTriangle, ArrowDown, Fingerprint, CalendarCheck, CheckCircle2, Zap, Check, Loader, Lock, ArrowRight, Sparkles, Users, FileImage, Flame } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { cn, hexToHSLComponents } from '@/lib/utils';
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
  eachDayOfInterval,
  differenceInMinutes,
  subMinutes,
  differenceInHours
} from 'date-fns';
import { nanoid } from 'nanoid';
import { useForm, FormProvider, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { PhoneInput } from '../ui/phone-input';
import { useToast } from '@/hooks/use-toast';
import { FormFieldRenderer } from '../consents/FormFieldRenderer';
import { Separator } from '../ui/separator';
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from '../ui/tooltip';
import { motion, AnimatePresence } from 'framer-motion';
import { useFirebase } from '@/firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { useIsMobile } from '@/hooks/use-mobile';
import { ImageUpload } from '../shared/ImageUpload';

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
    if (typeof val === 'object' && 'seconds' in val) {
        return new Date(val.seconds * 1000);
    }
    return new Date(val);
};

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

const StaffSelectionCard = ({ staff, isSelected, disabled }: { staff: Staff | { id: string, name: string, avatarUrl: string }, isSelected: boolean, disabled?: boolean }) => {
    const isAnyStaff = staff.id === 'any';
    return (
        <label htmlFor={`staff-sheet-${staff.id}`} className={cn("block cursor-pointer", disabled && "cursor-not-allowed opacity-50")}>
            <div className={cn(
                'relative transition-all duration-300 rounded-2xl border-2 p-4 flex flex-col items-center gap-3', 
                isSelected ? 'border-primary bg-primary/5 ring-4 ring-primary/10 shadow-xl' : 'bg-background border-border hover:border-primary/30', 
                disabled && 'bg-muted/5 border-dashed'
            )}>
                <Avatar className={cn("w-16 h-16 border-4 shadow-sm transition-transform duration-500", isSelected ? "border-primary scale-110" : "border-background")}>
                    {staff.avatarUrl ? <AvatarImage src={staff.avatarUrl} className="object-cover" /> : null}
                    <AvatarFallback className="text-muted-foreground bg-muted">
                        {isAnyStaff ? <Users className="w-8 h-8 md:w-10 md:h-10"/> : staff.name.charAt(0)}
                    </AvatarFallback>
                </Avatar>
                <p className="font-black uppercase tracking-tight text-[10px] text-center truncate w-full">{staff.name}</p>
                <RadioGroupItem value={staff.id} id={`staff-sheet-${staff.id}`} className="sr-only" disabled={disabled} />
                {isSelected && (
                    <div className="absolute top-2 right-2 bg-primary text-white rounded-full p-0.5">
                        <Check className="w-3 h-3" />
                    </div>
                )}
            </div>
        </label>
    );
};

const bookingSchema = z.object({
  clientName: z.string().min(1, 'Name is required.'),
  clientEmail: z.string().email('Invalid email address.'),
  clientPhone: z.string().optional(),
});

type BookingFormData = z.infer<typeof bookingSchema>;

interface BookingSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  service: Service;
  staff: Staff[];
  pricingTiers: PricingTier[];
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

export const BookingSheet: React.FC<BookingSheetProps> = ({
  open,
  onOpenChange,
  service,
  staff,
  pricingTiers,
  initialStaffId,
  appointments,
  events,
  scheduleProfiles,
  services,
  consentForms,
  tenant,
  onConfirm,
}) => {
  const isMobile = useIsMobile();
  const [selectedStaffId, setSelectedStaffId] = useState(initialStaffId || 'any');
  const [selectedTierId, setSelectedTierId] = useState<string>('any');
  const [date, setDate] = useState(new Date());
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
  const [formAnswers, setFormAnswers] = useState<Record<string, Record<string, any>>>({});
  const [isDepositPaid, setIsDepositPaid] = useState(false);
  const [bookedStaffId, setBookedStaffId] = useState<string | null>(null);
  const [inspirationPhotoUrl, setInspirationPhotoUrl] = useState<string>('');
  const { toast } = useToast();
  const { firestore } = useFirebase();

  const methods = useForm<BookingFormData>({
    resolver: zodResolver(bookingSchema),
  });

  const { handleSubmit, watch } = methods;
  const clientEmail = watch('clientEmail');
  const clientPhone = watch('clientPhone');

  const [existingClientWithBalance, setExistingClientWithBalance] = useState<Client | null>(null);
  const [bannedClient, setBannedClient] = useState<Client | null>(null);
  const [matchedClient, setMatchedClient] = useState<Client | null>(null);
  const [isResolvingIdentity, setIsResolvingIdentity] = useState(false);
  
  const resolveIdentity = useCallback(async (email?: string, phone?: string) => {
    if (!firestore || !tenant || (!email && !phone)) return;
    
    setIsResolvingIdentity(true);
    try {
        const clientsRef = collection(firestore, 'tenants', tenant.id, 'clients');
        
        const matchPromises = [];
        if (email) matchPromises.push(getDocs(query(clientsRef, where("email", "==", email.toLowerCase().trim()))));
        if (phone) matchPromises.push(getDocs(query(clientsRef, where("phone", "==", phone))));

        const snapshots = await Promise.all(matchPromises);
        const allDocs = snapshots.flatMap(s => s.docs);

        if (allDocs.length > 0) {
            const clientData = allDocs[0].data() as Client;
            setMatchedClient(clientData);
            if (clientData.status === 'banned') {
                setBannedClient(clientData);
                setExistingClientWithBalance(null);
            } else if (clientData.outstandingBalance && clientData.outstandingBalance > 0) {
                setExistingClientWithBalance(clientData);
                setBannedClient(null);
            } else {
                setBannedClient(null);
                setExistingClientWithBalance(null);
            }
        } else {
            setBannedClient(null);
            setExistingClientWithBalance(null);
            setMatchedClient(null);
        }
    } catch (e) {
        console.error("Identity resolution failed", e);
    } finally {
        setIsResolvingIdentity(false);
    }
  }, [firestore, tenant]);

  useEffect(() => {
    const timer = setTimeout(() => {
        if ((clientEmail && clientEmail.includes('@')) || (clientPhone && clientPhone.length > 5)) {
            resolveIdentity(clientEmail, clientPhone);
        }
    }, 500);
    return () => clearTimeout(timer);
  }, [clientEmail, clientPhone, resolveIdentity]);

  const qualifiedStaff = useMemo(() => {
    if (!service?.requiredSkills || service.requiredSkills.length === 0) return staff;
    return staff.filter(s => service.requiredSkills!.every(skill => (s.skillSet || []).includes(skill)));
  }, [service, staff]);

  const availableTiersForService = useMemo(() => {
    if (!service.serviceTiers || service.serviceTiers.length === 0 || !pricingTiers) return [];
    const tiersWithStaff = new Set(qualifiedStaff.map(s => s.pricingTierId).filter(Boolean));
    return service.serviceTiers
        .filter(st => tiersWithStaff.has(st.tierId))
        .map(st => ({
            ...st,
            name: pricingTiers.find(pt => pt.id === st.tierId)?.name || 'Tier'
        }));
  }, [service, qualifiedStaff, pricingTiers]);
  
  const weekStart = useMemo(() => startOfWeek(date, { weekStartsOn: 0 }), [date]);
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const publicScheduleProfile = useMemo(() => scheduleProfiles?.find(p => p.isActive), [scheduleProfiles]);

  const activeDaySchedule = useMemo(() => {
      const dayName = format(date, 'eeee').toLowerCase();
      return publicScheduleProfile?.week?.[dayName] || null;
  }, [date, publicScheduleProfile]);

  const { timeSlots, hotSlotMap } = useMemo(() => {
    if (!service || !date || !publicScheduleProfile || !staff || !services) return { timeSlots: [], hotSlotMap: new Map() };
    const bookingInterval = publicScheduleProfile.bookingSlotInterval || 15;
    const dayName = format(date, 'eeee').toLowerCase();
    
    let staffMembersToCheck = selectedStaffId === 'any' ? qualifiedStaff : qualifiedStaff.filter(s => s.id === selectedStaffId);
    if (selectedStaffId === 'any' && selectedTierId !== 'any') {
        staffMembersToCheck = staffMembersToCheck.filter(s => s.pricingTierId === selectedTierId);
    }

    const options: Set<string> = new Set();
    const hSlots = new Map<string, boolean>();
    const isTightScheduling = !!tenant?.tightSchedulingEnabled;
    const isMorningAnchor = !!tenant?.morningAnchorEnabled;
    const isFlashYield = !!tenant?.flashYieldEnabled;

    staffMembersToCheck.forEach(staffMember => {
        let workingHours;
        const staffDaySchedule = staffMember?.availability?.week?.[dayName as keyof typeof staffMember.availability.week];
        if (staffDaySchedule?.enabled) workingHours = staffDaySchedule;
        else if (staffDaySchedule && !staffDaySchedule.enabled) return;
        else workingHours = publicScheduleProfile?.week?.[dayName];
        
        if (!workingHours || !workingHours.enabled) return;
        const dayStartWithBusinessHours = timeStringToDate(workingHours.start, date);
        const dayEndWithBusinessHours = timeStringToDate(workingHours.end, date);
        
        const busyIntervals: { start: Date, end: Date, padBefore: number, padAfter: number }[] = [];
        const dayCancelledSlots: { start: Date, end: Date }[] = [];

        appointments.filter(apt => isSameDay(apt.startTime, date) && apt.staffId === staffMember.id).forEach(apt => {
            if (apt.status === 'cancelled') {
                if (isFlashYield) {
                    const hoursSinceCancellation = differenceInHours(new Date(), safeDate(apt.startTime));
                    if (Math.abs(hoursSinceCancellation) < 48) {
                        dayCancelledSlots.push({ start: safeDate(apt.startTime), end: safeDate(apt.endTime) });
                    }
                }
                return;
            }
            const aptService = services.find(s => s.id === apt.serviceId);
            busyIntervals.push({ 
                start: apt.startTime, 
                end: apt.endTime, 
                padBefore: aptService?.padBefore || 0, 
                padAfter: aptService?.padAfter || 0 
            });
        });

        events.filter(evt => isSameDay(evt.startTime, date) && evt.type === 'blocked' && (!evt.staffId || evt.staffId === 'all' || evt.staffId === staffMember.id)).forEach(evt => {
            busyIntervals.push({ start: evt.startTime, end: evt.endTime, padBefore: 0, padAfter: 0 });
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
            const totalServiceDuration = service.duration + (service.padBefore || 0) + (service.padAfter || 0);
            const potentialEnd = addMinutes(currentTime, totalServiceDuration);
            
            if (potentialEnd > dayEndWithBusinessHours) break;

            const isOverlapping = busyIntervals.some((interval) => {
                const intervalStartWithPad = subMinutes(interval.start, interval.padBefore);
                const intervalEndWithPad = addMinutes(interval.end, interval.padAfter);
                return areIntervalsOverlapping(
                    { start: currentTime, end: potentialEnd }, 
                    { start: intervalStartWithPad, end: intervalEndWithPad }, 
                    { inclusive: false }
                );
            });
            
            const isStaffActiveForSameDay = !isToday(date) || (staffMember.active && !staffMember.onBreak);

            if (!isOverlapping && isStaffActiveForSameDay) {
                const timeStr = format(currentTime, 'HH:mm');
                const isStartOfDaySlot = isSameDay(currentTime, dayStartWithBusinessHours) && currentTime.getTime() === dayStartWithBusinessHours.getTime();
                const isDayEmpty = busyIntervals.length === 0;
                
                const isHotSlot = dayCancelledSlots.some(cs => 
                    isSameDay(currentTime, cs.start) && format(currentTime, 'HH:mm') === format(cs.start, 'HH:mm')
                );

                let allowed = true;

                if (!isHotSlot) { 
                    if (isMorningAnchor && isDayEmpty && !isStartOfDaySlot) {
                        allowed = false;
                    }

                    if (allowed && isTightScheduling && !isDayEmpty) {
                        const startsAtAnotherEnd = busyIntervals.some(interval => {
                            const prevEndWithPad = addMinutes(interval.end, interval.padAfter);
                            return Math.abs(differenceInMinutes(currentTime, prevEndWithPad)) < 1;
                        });
                        const endsAtAnotherStart = busyIntervals.some(interval => {
                            const nextStartWithPad = subMinutes(interval.start, interval.padBefore);
                            return Math.abs(differenceInMinutes(potentialEnd, nextStartWithPad)) < 1;
                        });
                        
                        if (!isStartOfDaySlot && !startsAtAnotherEnd && !endsAtAnotherStart) {
                            allowed = false;
                        }
                    }
                }

                if (allowed) {
                    options.add(timeStr);
                    if (isHotSlot) hSlots.set(timeStr, true);
                }
            }
            currentTime = addMinutes(currentTime, bookingInterval);
        }
    });
    return { timeSlots: Array.from(options).sort(), hotSlotMap: hSlots };
}, [date, selectedStaffId, selectedTierId, qualifiedStaff, service, staff, appointments, events, publicScheduleProfile, services, tenant]);

    const requiredForms = useMemo(() => {
        if (!service || !consentForms) return [];
        return consentForms.filter(form => service.requiredFormIds?.includes(form.id));
    }, [service, consentForms]);
    
    const { price, priceRange } = useMemo(() => {
        if (!service.serviceTiers || service.serviceTiers.length === 0) return { price: service.price, priceRange: null };
        
        if (selectedStaffId && selectedStaffId !== 'any') {
          const staffMember = staff.find(s => s.id === selectedStaffId);
          const tierPricing = service.serviceTiers.find(t => t.tierId === staffMember?.pricingTierId);
          if (tierPricing) return { price: tierPricing.price, priceRange: null };
        }

        if (selectedStaffId === 'any' && selectedTierId !== 'any') {
            const tierPricing = service.serviceTiers.find(t => t.tierId === selectedTierId);
            if (tierPricing) return { price: tierPricing.price, priceRange: null };
        }

        const prices = service.serviceTiers.map(t => t.price);
        const minPrice = Math.min(...prices);
        const maxPrice = Math.max(...prices);
        if (minPrice === maxPrice) return { price: minPrice, priceRange: null };
        return { price: minPrice, priceRange: { min: minPrice, max: maxPrice } };
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
        setSelectedTime(null); setSelectedTierId('any'); setDate(new Date()); methods.reset(); setFormAnswers({}); setIsDepositPaid(false); setBookedStaffId(null); setInspirationPhotoUrl('');
    }
  }, [open, initialStaffId, methods]);

  const handleNextStep = async () => {
    if (currentStep === 'dateTime' && !selectedTime) { toast({ variant: 'destructive', title: 'Please select a time.' }); return; }
    if (currentStep === 'details') { 
        const valid = await methods.trigger(['clientName', 'clientEmail']); 
        if (!valid) return; 
        
        const currentEmail = watch('clientEmail');
        const currentPhone = watch('clientPhone');
        await resolveIdentity(currentEmail, currentPhone);
        
        if (bannedClient || existingClientWithBalance) return;

        const dayAccess = activeDaySchedule?.accessTier || 'all';
        if (dayAccess === 'members') {
            const isClientMember = !!(matchedClient?.activeMembershipId || matchedClient?.subscription);
            const isClientPackageHolder = (matchedClient?.activePackages?.length || 0) > 0;
            if (!isClientMember && !isClientPackageHolder) {
                toast({ variant: 'destructive', title: 'Access Restricted', description: 'This day is reserved for Club Members and Package holders.' });
                return;
            }
        } else if (dayAccess === 'returning') {
            if (!matchedClient) {
                toast({ variant: 'destructive', title: 'Priority Access Only', description: 'This day is reserved for returning guests. Please select a standard booking day.' });
                return;
            }
        }
    }
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
        if (isToday(startDateTime) && !s.active) return false;
        const day = format(startDateTime, 'eeee').toLowerCase();
        const sched = s.availability?.week?.[day as keyof typeof s.availability.week] || publicScheduleProfile?.week?.[day];
        if (!sched?.enabled) return false;
        const openT = timeStringToDate(sched.start, startDateTime);
        const closeT = timeStringToDate(sched.end, startDateTime);
        if (startDateTime < openT || endDateTime > closeT) return false;
        const isAptOverlapping = appointments.some(apt => apt.staffId === s.id && apt.status !== 'cancelled' && areIntervalsOverlapping({ start: startDateTime, end: endDateTime }, { start: apt.startTime, end: apt.endTime }, { inclusive: false }));
        if (isAptOverlapping) return false;
        const isEventOverlapping = events.some(evt => evt.type === 'blocked' && (!evt.staffId || evt.staffId === 'all' || evt.staffId === s.id) && areIntervalsOverlapping({ start: startDateTime, end: endDateTime }, { start: evt.startTime, end: evt.endTime }, { inclusive: false }));
        if (isEventOverlapping) return false;
        return true;
      });
      if (available.length > 0) {
        available.sort((a, b) => (a.lastServedTimestamp ? new Date(a.lastServedTimestamp).getTime() : 0) - (b.lastServedTimestamp ? new Date(b.lastServedTimestamp).getTime() : 0));
        finalStaffId = available[0].id;
      } else { toast({ variant: 'destructive', title: 'No staff available' }); return; }
    }

    setBookedStaffId(finalStaffId);
    const signedForms = requiredForms.map(form => ({ formId: form.id, formTitle: form.title, formData: formAnswers[form.id] || {} }));
    
    onConfirm(clientData, { 
        serviceId: service.id, 
        staffId: finalStaffId, 
        startTime: startDateTime.toISOString(), 
        endTime: endDateTime.toISOString(), 
        status: 'confirmed', 
        isWalkIn: false,
        source: 'online',
        inspirationPhotoUrl: inspirationPhotoUrl || undefined
    }, signedForms, (s) => setCurrentStepIndex(steps.indexOf(s)));
  };

  const bookedStaff = useMemo(() => staff.find(s => s.id === bookedStaffId), [staff, bookedStaffId]);
  const selectedStaff = useMemo(() => staff.find(s => s.id === selectedStaffId), [staff, selectedStaffId]);

  const customPrimaryColor = tenant?.bookingPageSettings?.primaryColor;
  const primaryColorHSL = customPrimaryColor && customPrimaryColor.startsWith('#') 
    ? hexToHSLComponents(customPrimaryColor) 
    : customPrimaryColor;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent 
        side="right" 
        className={cn(isMobile ? 'h-[92dvh] rounded-t-[2.5rem]' : 'sm:max-w-2xl', 'flex flex-col p-0 border-l-0 sm:border-l bg-background overflow-hidden shadow-2xl')}
        style={primaryColorHSL ? { '--primary': primaryColorHSL } as React.CSSProperties : {}}
      >
        <SheetHeader className={cn("border-b bg-muted/5 flex-shrink-0 text-left", isMobile ? "p-8" : "p-8 pb-6")}>
          <div className="flex items-center gap-3 mb-2">
            <Sparkles className="w-5 h-5 text-primary" />
            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground">Booking Experience</span>
          </div>
          <SheetTitle className="text-3xl font-black uppercase tracking-tighter text-slate-900">Reserve Session</SheetTitle>
          {currentStep !== 'confirmation' && <div className="pt-6"><Progress value={progress} className="h-1 rounded-full bg-muted" /></div>}
        </SheetHeader>
        
        <ScrollArea className="flex-1">
            <div className="p-8 space-y-12 pb-32">
                <AnimatePresence mode="wait">
                {currentStep === 'confirmation' ? (
                    <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="text-center py-12 space-y-10" key="confirmation">
                        <div className="w-32 h-32 bg-green-500/10 rounded-[2.5rem] flex items-center justify-center mx-auto shadow-2xl shadow-green-500/5 rotate-6">
                            <CheckCircle2 className="w-16 h-16 text-green-500 -rotate-6" />
                        </div>
                        <div className="space-y-3">
                            <h2 className="text-4xl font-black uppercase tracking-tighter">You're All Set!</h2>
                            <p className="text-muted-foreground font-medium max-w-sm mx-auto leading-relaxed">Your appointment for <strong className="text-foreground">{service?.name}</strong> is confirmed. We've sent the details to your email.</p>
                        </div>
                        <div className="grid gap-6 max-sm mx-auto">
                            {bookedStaff && (
                                <div className="p-6 rounded-[2rem] border-2 bg-white/50 backdrop-blur-sm shadow-xl flex flex-col items-center gap-4">
                                    <p className="text-[10px] font-black uppercase tracking-widest text-primary">Your Professional</p>
                                    <Avatar className="w-24 h-24 border-4 border-background shadow-2xl">
                                        <AvatarImage src={bookedStaff.avatarUrl} className="object-cover" />
                                        <AvatarFallback>{bookedStaff.name.charAt(0)}</AvatarFallback>
                                    </Avatar>
                                    <div className="text-center">
                                        <p className="font-black text-xl uppercase tracking-tight">{bookedStaff.name}</p>
                                        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mt-1">{bookedStaff.specialties?.slice(0, 2).join(' • ')}</p>
                                    </div>
                                </div>
                            )}
                            <div className="p-6 rounded-[2rem] border-2 bg-muted/20 text-left shadow-inner space-y-4">
                                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground text-center">Session Intel</p>
                                <div className="flex items-start gap-4">
                                    <Calendar className="w-5 h-5 mt-0.5 text-primary opacity-40" />
                                    <div className="space-y-1 text-left">
                                        <p className="font-black uppercase text-sm">{format(date, 'EEEE, MMM d, yyyy')}</p>
                                        <p className="text-xs font-bold text-primary">{selectedTime ? format(timeStringToDate(selectedTime, new Date()), 'h:mm a') : ''}</p>
                                    </div>
                                </div>
                                <div className="flex items-start gap-4 pt-4 border-t border-dashed">
                                    <MapPin className="w-5 h-5 mt-0.5 text-primary opacity-40" />
                                    <div className="space-y-1 text-left">
                                        <p className="font-black uppercase text-sm">{tenant?.name || 'Studio'}</p>
                                        <p className="text-xs font-medium text-muted-foreground">123 Beauty Lane, Suite 100</p>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <Button className="w-full h-16 text-lg font-black uppercase tracking-widest rounded-3xl shadow-2xl shadow-primary/20" variant="outline" onClick={() => onOpenChange(false)}>Finish</Button>
                    </motion.div>
                ) : (
                    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} key={currentStep} className="space-y-12">
                        <div className="space-y-4">
                            <div className="flex items-center justify-between">
                                <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-primary flex items-center gap-2">
                                    <Zap className="w-3 h-3" />
                                    Active Selection
                                </h3>
                                {currentStep !== 'staff' && (
                                    <Button variant="ghost" size="sm" onClick={() => setCurrentStepIndex(0)} className="h-auto p-0 text-[10px] font-black uppercase tracking-widest underline decoration-2 underline-offset-4">Change</Button>
                                )}
                            </div>
                            <Card className="overflow-hidden rounded-[2rem] border-2 bg-white/50 backdrop-blur-xl shadow-2xl shadow-primary/5">
                                <CardContent className="p-6 flex gap-6 items-center">
                                    <div className="relative w-24 h-24 rounded-2xl overflow-hidden bg-muted shadow-inner">
                                        <Image src={service?.imageUrl || `https://picsum.photos/seed/${service?.id}/200/200`} alt={service?.name} fill className="object-cover" />
                                    </div>
                                    <div className="flex-1 min-w-0 text-left">
                                        <p className="font-black text-2xl uppercase tracking-tighter leading-none mb-2">{service?.name}</p>
                                        <div className="flex items-center gap-6">
                                            <div className="flex flex-col text-left">
                                                <span className="text-[9px] font-black uppercase text-muted-foreground tracking-widest">Duration</span>
                                                <span className="text-sm font-bold">{service?.duration} min</span>
                                            </div>
                                            <div className="flex flex-col text-left">
                                                <span className="text-[9px] font-black uppercase text-muted-foreground tracking-widest">Investment</span>
                                                <span className="text-sm font-black text-primary">{priceRange ? `From $${priceRange.min}` : `$${price?.toFixed(2)}`}</span>
                                            </div>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        </div>
                        
                        {currentStep === 'staff' && (
                           <div className="space-y-8">
                                <div className="space-y-2 text-left">
                                    <h3 className="text-xl font-black uppercase tracking-tight flex items-center gap-3">
                                        <Users className="w-6 h-6 text-primary" />
                                        Select Provider
                                    </h3>
                                    <p className="text-xs font-medium text-muted-foreground">Expert hands for your specific needs.</p>
                                </div>
                                <RadioGroup onValueChange={handleStaffSelect} value={selectedStaffId} className="grid grid-cols-2 gap-4">
                                    <StaffSelectionCard staff={{id: 'any', name: 'Any Available', avatarUrl: ''}} isSelected={selectedStaffId === 'any'} disabled={!!initialStaffId} />
                                    {qualifiedStaff.map(s => <StaffSelectionCard key={s.id} staff={s} isSelected={selectedStaffId === s.id} disabled={!!initialStaffId && s.id !== initialStaffId} />)}
                                </RadioGroup>
                                {selectedStaffId === 'any' && availableTiersForService.length > 0 && (
                                    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-6 pt-10 border-t border-dashed text-left">
                                        <div className="space-y-1">
                                            <h4 className="font-black uppercase tracking-tight text-sm text-left">Tiered Preference</h4>
                                            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest opacity-60 text-left">Prices vary by professional experience level</p>
                                        </div>
                                        <RadioGroup value={selectedTierId} onValueChange={setSelectedTierId} className="grid grid-cols-1 gap-3">
                                            <label htmlFor="tier-any" className="flex items-center justify-between p-5 rounded-2xl border-2 cursor-pointer transition-all hover:bg-muted/50 has-[:checked]:border-primary has-[:checked]:bg-primary/5 has-[:checked]:shadow-lg">
                                                <div className="flex items-center gap-3">
                                                    <RadioGroupItem value="any" id="tier-any" />
                                                    <span className="text-sm font-black uppercase tracking-tight">First Available (Any Price)</span>
                                                </div>
                                            </label>
                                            {availableTiersForService.map(tier => (
                                                <label key={tier.tierId} htmlFor={`tier-${tier.tierId}`} className="flex items-center justify-between p-5 rounded-2xl border-2 cursor-pointer transition-all hover:bg-muted/50 has-[:checked]:border-primary has-[:checked]:bg-primary/5 has-[:checked]:shadow-lg">
                                                    <div className="flex items-center gap-3">
                                                        <RadioGroupItem value={tier.tierId} id={`tier-${tier.tierId}`} />
                                                        <span className="text-sm font-black uppercase tracking-tight">{tier.name}</span>
                                                    </div>
                                                    <span className="font-black text-primary text-base tracking-tighter">${tier.price.toFixed(2)}</span>
                                                </label>
                                            ))}
                                        </RadioGroup>
                                    </motion.div>
                                )}
                            </div>
                        )}

                        {currentStep === 'dateTime' && (
                             <div className="space-y-8">
                                <div className="space-y-2 text-left">
                                    <h3 className="text-xl font-black uppercase tracking-tight flex items-center gap-3">
                                        <Calendar className="w-6 h-6 text-primary" />
                                        Timing
                                    </h3>
                                    <p className="text-xs font-medium text-muted-foreground">Select a window that fits your schedule.</p>
                                </div>

                                {activeDaySchedule?.accessTier && activeDaySchedule.accessTier !== 'all' && (
                                    <Alert className="bg-indigo-50 border-indigo-200 rounded-[2rem] p-6 border-2 shadow-sm text-left">
                                        <Award className="h-6 w-6 text-indigo-600" />
                                        <AlertTitle className="text-sm font-black uppercase tracking-tight mb-2 text-indigo-700">Priority Access Only</AlertTitle>
                                        <AlertDescription className="text-xs font-bold leading-relaxed opacity-80 uppercase text-left text-indigo-600">
                                            This day is reserved for {activeDaySchedule.accessTier === 'members' ? 'Members & Package Holders' : 'Returning Guests'}. Identity verification required at checkout.
                                        </AlertDescription>
                                    </Alert>
                                )}

                                <div className="p-8 rounded-[2.5rem] border-2 bg-muted/10 space-y-8 shadow-inner text-center">
                                    <div className="flex items-center justify-between">
                                        <Button variant="outline" size="icon" className="h-10 w-10 rounded-full bg-background shadow-md border-none" onClick={() => setDate(prev => addDays(prev, -7))}><ChevronLeft className="w-5 h-5" /></Button>
                                        <span className="font-black uppercase tracking-widest text-sm">{format(weekStart, 'MMMM yyyy')}</span>
                                        <Button variant="outline" size="icon" className="h-10 w-10 rounded-full bg-background shadow-md border-none" onClick={() => setDate(prev => addDays(prev, 7))}><ChevronRight className="w-5 h-5" /></Button>
                                    </div>
                                    <div className="grid grid-cols-7 gap-3">
                                        {weekDays.map(day => (
                                            <button 
                                                key={day.toString()} 
                                                onClick={() => setDate(day)} 
                                                disabled={isBefore(day, startOfDay(new Date())) && !isToday(day)} 
                                                className={cn(
                                                    "flex flex-col items-center justify-center p-3 rounded-2xl border-2 transition-all aspect-square", 
                                                    isSameDay(day, date) ? "bg-primary text-primary-foreground border-primary shadow-2xl scale-110" : "bg-background border-transparent hover:border-primary/30", 
                                                    (isBefore(day, startOfDay(new Date())) && !isToday(day)) && "opacity-20 cursor-not-allowed"
                                                )} 
                                                type="button"
                                            >
                                                <span className="text-[10px] uppercase font-black opacity-60 mb-1">{format(day, 'EEE')}</span>
                                                <span className="font-black text-xl tracking-tighter">{format(day, 'd')}</span>
                                            </button>
                                        ))}
                                    </div>
                                    <div className="grid grid-cols-3 gap-3 pt-8 border-t border-dashed">
                                        {timeSlots.map(time => {
                                            const isHotSlot = hotSlotMap.get(time);
                                            return (
                                                <Button 
                                                    key={time} 
                                                    variant={selectedTime === time ? 'default' : 'outline'} 
                                                    onClick={() => setSelectedTime(time)} 
                                                    className={cn(
                                                        "h-14 font-black uppercase text-xs tracking-widest rounded-2xl border-2 transition-all relative overflow-hidden", 
                                                        selectedTime === time ? "shadow-2xl shadow-primary/20 scale-105" : "bg-background",
                                                        isHotSlot && "border-amber-500/50 bg-amber-500/5 text-amber-700"
                                                    )}
                                                >
                                                    {isHotSlot && <div className="absolute top-0 right-0 p-1 bg-amber-500 rounded-bl-lg shadow-sm"><Flame className="w-2.5 h-2.5 text-white" /></div>}
                                                    {format(timeStringToDate(time, new Date()), 'h:mm a')}
                                                </Button>
                                            )
                                        })}
                                        {timeSlots.length === 0 && (
                                            <div className="col-span-full text-center py-12 px-6 border-2 border-dashed rounded-3xl">
                                                <Clock className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
                                                <p className="text-xs font-black uppercase tracking-widest text-muted-foreground/60">No availability matches your preference</p>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )}
                        
                        {currentStep === 'details' && (
                            <FormProvider {...methods}>
                                <form id="booking-details-form" onSubmit={handleSubmit(handleConfirmBooking)} className="space-y-10 text-left">
                                    <div className="space-y-2 text-left">
                                        <h3 className="text-xl font-black uppercase tracking-tight flex items-center gap-3">
                                            <User className="w-6 h-6 text-primary" />
                                            Guest Profile
                                        </h3>
                                        <p className="text-xs font-medium text-muted-foreground">Personalize your visit.</p>
                                    </div>
                                    <div className="space-y-6">
                                        <div className="space-y-3">
                                            <Label htmlFor="name" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Full Legal Name</Label>
                                            <Input id="name" {...methods.register('clientName')} className="h-14 rounded-2xl border-2 text-lg font-bold shadow-inner" placeholder="Enter your full name" />
                                        </div>
                                        <div className="space-y-3">
                                            <Label htmlFor="email" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Email for Confirmation</Label>
                                            <Input id="email" type="email" {...methods.register('clientEmail')} className="h-14 rounded-2xl border-2 font-bold shadow-inner" placeholder="jane@example.com" />
                                        </div>
                                        <div className="space-y-3">
                                            <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Mobile for Alerts</Label>
                                            <PhoneInput name="clientPhone" label="" className="h-14 kiosk-phone-input" />
                                        </div>
                                    </div>

                                    <div className="space-y-4 pt-4 border-t border-dashed text-left">
                                        <div className="flex items-center gap-3">
                                            <FileImage className="w-5 h-5 text-primary" />
                                            <h3 className="text-sm font-black uppercase tracking-widest text-slate-900">Visual Inspiration</h3>
                                        </div>
                                        <p className="text-[10px] font-bold text-muted-foreground uppercase leading-relaxed tracking-tight opacity-60">
                                            Upload a reference photo to help your pro understand your target look.
                                        </p>
                                        <ImageUpload onImageUploaded={setInspirationPhotoUrl} initialImage={inspirationPhotoUrl} />
                                    </div>
                                    
                                    <AnimatePresence>
                                        {isResolvingIdentity && (
                                            <motion.div key="resolving" className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-primary animate-pulse">
                                                <Loader className="w-3 h-3 animate-spin" /> Verifying Profile...
                                            </motion.div>
                                        )}
                                        {bannedClient && (
                                            <motion.div key="banned" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}>
                                                <Alert variant="destructive" className="bg-destructive/10 border-destructive shadow-xl border-4 rounded-[2rem] p-6">
                                                    <Ban className="h-6 w-6" />
                                                    <AlertTitle className="text-sm font-black uppercase tracking-tight mb-2">Check-in Restricted</AlertTitle>
                                                    <AlertDescription className="text-xs font-bold leading-relaxed opacity-80 uppercase text-left">
                                                        Your account is currently restricted. Please see the front desk for further assistance.
                                                    </AlertDescription>
                                                </Alert>
                                            </motion.div>
                                        )}
                                        {existingClientWithBalance && !bannedClient && (
                                            <motion.div key="balance" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}>
                                                <Alert variant="destructive" className="bg-destructive/5 border-destructive/20 border-2 rounded-[2rem] p-6 shadow-xl">
                                                    <Wallet className="h-6 w-6" />
                                                    <AlertTitle className="text-sm font-black uppercase tracking-tight mb-2">Balance Detected</AlertTitle>
                                                    <AlertDescription className="text-xs font-bold leading-relaxed opacity-80 uppercase text-left">
                                                        Account balance of <strong>${existingClientWithBalance.outstandingBalance?.toFixed(2)}</strong> found. Please settle at the desk to complete this booking.
                                                    </AlertDescription>
                                                </Alert>
                                            </motion.div>
                                        )}
                                    </AnimatePresence>
                                </form>
                            </FormProvider>
                        )}

                        {currentStep === 'consents' && (
                            <div className="space-y-10 text-left">
                                <div className="space-y-2">
                                    <h3 className="text-xl font-black uppercase tracking-tight flex items-center gap-3">
                                        <FileSignature className="w-6 h-6 text-primary" />
                                        Agreements
                                    </h3>
                                    <p className="text-xs font-medium text-muted-foreground">Required standards and waivers.</p>
                                </div>
                                <div className="space-y-12">
                                    {requiredForms.map(form => (
                                        <div key={form.id} className="space-y-8 p-8 md:p-12 rounded-[3rem] border-2 border-white/50 bg-white/60 backdrop-blur-2xl shadow-2xl">
                                            <div className="flex items-center gap-4 text-2xl font-black uppercase tracking-tighter pb-4 border-b border-dashed"><ListChecks className="w-8 h-8 text-primary" />{form.title}</div>
                                            <div className="space-y-10">
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
                             <div className="space-y-8 text-left">
                                <div className="space-y-2">
                                    <h3 className="text-xl font-black uppercase tracking-tight flex items-center gap-3">
                                        <ShieldCheck className="w-6 h-6 text-primary" />
                                        Review
                                    </h3>
                                    <p className="text-xs font-medium text-muted-foreground">Finalize your session details.</p>
                                </div>
                                <Card className="bg-primary/5 border-primary/20 overflow-hidden shadow-2xl rounded-[2.5rem] border-2">
                                    <CardContent className="p-8 md:p-10 space-y-6">
                                        <div className="flex justify-between items-center gap-4">
                                            <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground shrink-0">Professional</span> 
                                            <div className="flex items-center gap-2 min-w-0">
                                                <span className="font-black text-[11px] sm:text-sm uppercase tracking-tight truncate">{selectedStaffId === 'any' ? 'First Available' : selectedStaff?.name}</span>
                                                {selectedStaff && (
                                                    <Avatar className="h-6 w-6 border shadow-sm shrink-0">
                                                        <AvatarImage src={selectedStaff.avatarUrl} className="object-cover" />
                                                        <AvatarFallback>{selectedStaff.name.charAt(0)}</AvatarFallback>
                                                    </Avatar>
                                                )}
                                            </div>
                                        </div>
                                        {selectedStaffId === 'any' && selectedTierId !== 'any' && (
                                            <div className="flex justify-between items-center gap-4">
                                                <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground shrink-0">Tier Pref</span> 
                                                <span className="font-black text-[11px] sm:text-sm uppercase tracking-tight text-primary truncate">{availableTiersForService.find(t => t.tierId === selectedTierId)?.name}</span>
                                            </div>
                                        )}
                                        <div className="flex justify-between items-center gap-4">
                                            <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground shrink-0">Schedule</span> 
                                            <span className="font-black text-[11px] sm:text-sm uppercase tracking-tight truncate">{format(date, 'MMM d, yyyy')}</span>
                                        </div>
                                        <div className="flex justify-between items-center gap-4">
                                            <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground shrink-0">Start Time</span> 
                                            <span className="font-black text-sm sm:text-xl uppercase tracking-tight text-primary truncate">{selectedTime ? format(timeStringToDate(selectedTime, new Date()), 'h:mm a') : ''}</span>
                                        </div>
                                        {inspirationPhotoUrl && (
                                            <div className="flex justify-between items-center gap-4 pt-4 border-t border-dashed border-primary/10">
                                                <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground shrink-0">Inspiration</span> 
                                                <div className="relative w-12 h-12 rounded-xl overflow-hidden border-2 border-primary/20">
                                                    <Image src={inspirationPhotoUrl} alt="Target Visual" fill className="object-cover" />
                                                </div>
                                            </div>
                                        )}
                                        <Separator className="bg-primary/10 border-dashed" />
                                        <div className="flex justify-between items-center text-2xl sm:text-3xl font-black uppercase tracking-tighter"><span>Total</span> <span>${price?.toFixed(2)}</span></div>
                                        {depositAmount > 0 && (
                                            <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-center">
                                                <p className="text-[10px] font-black uppercase tracking-widest text-amber-700">Required Deposit: <strong className="text-sm sm:text-base tracking-tighter">${depositAmount.toFixed(2)}</strong></p>
                                            </div>
                                        )}
                                    </CardContent>
                                </Card>
                            </div>
                        )}

                        {currentStep === 'payment' && (
                            <div className="space-y-8 text-left">
                                <div className="space-y-2">
                                    <h3 className="text-xl font-black uppercase tracking-tight flex items-center gap-3">
                                        <CreditCard className="w-6 h-6 text-primary" />
                                        Deposit
                                    </h3>
                                    <p className="text-xs font-medium text-muted-foreground">Secure your spot with a partial payment.</p>
                                </div>
                                <Card className="border-4 rounded-[3rem] shadow-2xl overflow-hidden text-left">
                                    <CardHeader className="bg-muted/30 p-10 pb-6 text-center">
                                        <p className="text-[10px] font-black uppercase tracking-[0.3em] text-muted-foreground mb-2">Required Today</p>
                                        <p className="text-7xl font-black text-primary tracking-tighter">${depositAmount.toFixed(2)}</p>
                                    </CardHeader>
                                    <CardContent className="p-10 space-y-8">
                                        <div className="space-y-4">
                                            <div className="space-y-2 text-left"><Label className="text-[10px] font-black uppercase tracking-widest ml-1">Card Number</Label><Input placeholder="•••• •••• •••• 1234" className="h-14 rounded-2xl border-2 font-mono text-lg shadow-inner" /></div>
                                            <div className="grid grid-cols-2 gap-6"><div className="space-y-2 text-left"><Label className="text-[10px] font-black uppercase tracking-widest ml-1">Expiry</Label><Input placeholder="MM / YY" className="h-12 rounded-xl border-2 text-center" /></div><div className="space-y-2 text-left"><Label className="text-[10px] font-black uppercase tracking-widest ml-1">CVC</Label><Input placeholder="•••" className="h-12 rounded-xl border-2 text-center" /></div></div>
                                        </div>
                                        <div className="flex items-center gap-3 p-4 bg-muted/20 rounded-2xl text-xs text-muted-foreground font-medium italic">
                                            <Lock className="w-4 h-4 shrink-0" />
                                            Your payment information is encrypted and never stored on our servers.
                                        </div>
                                    </CardContent>
                                </Card>
                            </div>
                        )}
                    </motion.div>
                )}
                </AnimatePresence>
            </div>
        </ScrollArea>
        
        {currentStep !== 'confirmation' && (
            <SheetFooter className={cn("p-4 sm:p-8 border-t bg-background/80 backdrop-blur-xl flex-shrink-0 z-20 shadow-2xl")}>
                <div className="flex w-full gap-4">
                    {currentStepIndex > 0 && (
                        <Button variant="ghost" onClick={handlePrevStep} className="flex-1 h-12 md:h-20 rounded-3xl font-black uppercase tracking-tighter text-[10px] md:text-2xl text-slate-400">
                            Back
                        </Button>
                    )}
                    <Button 
                        onClick={handleNextStep} 
                        disabled={(currentStep === 'details' && (!!existingClientWithBalance || !!bannedClient || isResolvingIdentity))} 
                        className={cn(
                            "h-12 md:h-20 font-black uppercase tracking-widest text-[10px] md:text-2xl rounded-[2rem] shadow-2xl shadow-primary/30 group transition-all",
                            currentStepIndex === 0 ? "w-full" : "flex-[2.5]"
                        )}
                    >
                        {currentStep === 'summary' && depositAmount > 0 ? 'Pay Deposit' : 
                         currentStep === 'summary' || currentStep === 'payment' ? 'Finalize Booking' : 
                         'Continue'}
                        <ArrowRight className="ml-3 w-4 h-4 md:w-8 md:h-8 transition-transform group-hover:translate-x-1" />
                    </Button>
                </div>
            </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
  );
};
