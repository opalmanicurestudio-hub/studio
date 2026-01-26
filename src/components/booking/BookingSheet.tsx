

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
import { Button, buttonVariants } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  type Service,
  type Staff,
  type Appointment,
  type Event,
  type Tenant,
  type ConsentForm,
} from '@/lib/data';
import { Progress } from '@/components/ui/progress';
import Image from 'next/image';
import { Clock, DollarSign, Users, Calendar, ChevronLeft, ChevronRight, User, Mail, Phone, CheckCircle, FileSignature, ShieldCheck, CreditCard } from 'lucide-react';
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
  getDay,
  parse,
  parseISO,
} from 'date-fns';
import { nanoid } from 'nanoid';
import { useForm, FormProvider } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { PhoneInput } from '../ui/phone-input';
import { useToast } from '@/hooks/use-toast';
import { FormFieldRenderer } from '../consents/FormFieldRenderer';
import { Checkbox } from '../ui/checkbox';
import { Separator } from '../ui/separator';

const bookingSchema = z.object({
  clientName: z.string().min(1, 'Name is required'),
  clientEmail: z.string().email('Invalid email address'),
  clientPhone: z.string().optional(),
});

type BookingFormData = z.infer<typeof bookingSchema>;


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

interface BookingSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  service: Service;
  staff: Staff[];
  appointments: Appointment[];
  events: Event[];
  scheduleProfiles: any[];
  services: Service[];
  consentForms: ConsentForm[];
  tenant: Tenant | null;
  onConfirm: (
    formData: { clientName: string; clientEmail: string; clientPhone?: string },
    appointmentDetails: Omit<Appointment, 'id' | 'clientId' | 'clientName' | 'clientEmail' | 'clientPhone'>,
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
  appointments,
  events,
  scheduleProfiles,
  services,
  consentForms,
  tenant,
  onConfirm,
}) => {
  const [selectedStaffId, setSelectedStaffId] = useState('any');
  const [date, setDate] = useState(new Date());
  const [selectedTime, setSelectedTime] = useState<string | null>(null);

  const [completedForms, setCompletedForms] = useState<Set<string>>(new Set());
  const [isDepositPaid, setIsDepositPaid] = useState(false);
  const { toast } = useToast();

  const methods = useForm<BookingFormData>({
    resolver: zodResolver(bookingSchema),
  });

  const { control, handleSubmit, register, formState: { errors } } = methods;

  const qualifiedStaff = useMemo(() => {
    if (!service || !service.requiredSkills || service.requiredSkills.length === 0) {
        return staff;
    }
    return staff.filter(s => 
        service.requiredSkills!.every(skill => (s.skillSet || []).includes(skill))
    );
  }, [service, staff]);
  
  const weekStart = useMemo(() => startOfWeek(date, { weekStartsOn: 0 }), [date]);
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  
  const publicScheduleProfile = scheduleProfiles[0];

  const timeSlots = useMemo(() => {
    if (!service || !date || !publicScheduleProfile) return [];

    const bookingInterval = publicScheduleProfile.bookingSlotInterval || 15;
    const dayName = format(date, 'eeee').toLowerCase();
    
    const selectedStaffMember = staff.find(s => s.id === selectedStaffId);
    let workingHours: { enabled: boolean; start: string; end: string; };

    const staffDaySchedule = selectedStaffMember?.availability?.week?.[dayName as keyof typeof selectedStaffMember.availability.week];

    if (staffDaySchedule && staffDaySchedule.enabled) {
        workingHours = staffDaySchedule;
    } else if (!staffDaySchedule && publicScheduleProfile?.week?.[dayName]) {
        workingHours = publicScheduleProfile.week[dayName];
    } else {
        return []; // Staff is explicitly not available or no schedule found
    }
    
    if (!workingHours || !workingHours.enabled) {
      return [];
    }
    
    const dayStartWithBusinessHours = timeStringToDate(workingHours.start, date);
    const dayEndWithBusinessHours = timeStringToDate(workingHours.end, date);
    
    const busyIntervals: { start: Date, end: Date }[] = [];

    appointments
      .filter(apt => {
        if (!isSameDay(apt.startTime, date)) return false;
        if (selectedStaffId !== 'any' && apt.staffId !== selectedStaffId) return false;
        return true;
      })
      .forEach(apt => {
        const aptService = services.find(s => s.id === apt.serviceId);
        const padBefore = aptService?.padBefore || 0;
        const padAfter = aptService?.padAfter || 0;
        busyIntervals.push({
          start: addMinutes(apt.startTime, -padBefore),
          end: addMinutes(apt.endTime, padAfter),
        });
      });

    events
      .filter(evt => {
        if (!isSameDay(evt.startTime, date)) return false;
        if (evt.type !== 'blocked') return false;
        return !evt.staffId || evt.staffId === 'all' || (selectedStaffId !== 'any' && evt.staffId === selectedStaffId);
      })
      .forEach(evt => {
        busyIntervals.push({ start: evt.startTime, end: evt.endTime });
      });

    const options: string[] = [];
    
    let earliestBookableTime = dayStartWithBusinessHours;
    const now = new Date();

    if (isToday(date) && now > dayStartWithBusinessHours) {
        const minutesSinceStartOfDay = (now.getHours() * 60) + now.getMinutes();
        const businessStartMinutes = (earliestBookableTime.getHours() * 60) + earliestBookableTime.getMinutes();
        const intervalsToSkip = Math.ceil((minutesSinceStartOfDay - businessStartMinutes) / bookingInterval);
        if (intervalsToSkip > 0) {
            earliestBookableTime = addMinutes(dayStartWithBusinessHours, intervalsToSkip * bookingInterval);
        }
    }
    
    let currentTime = earliestBookableTime;

    while (currentTime < dayEndWithBusinessHours) {
        const potentialStartTime = currentTime;
        const totalDuration = service.duration + (service.padBefore || 0) + (service.padAfter || 0);
        const potentialEndTime = addMinutes(potentialStartTime, totalDuration);
        
        if (potentialEndTime > dayEndWithBusinessHours) {
            break;
        }
        
        const isOverlapping = busyIntervals.some((interval) =>
            areIntervalsOverlapping(
                { start: potentialStartTime, end: potentialEndTime },
                interval,
                { inclusive: false }
            )
        );

        if (!isOverlapping) {
            options.push(format(potentialStartTime, 'HH:mm'));
        }

        currentTime = addMinutes(currentTime, bookingInterval);
    }
    return options;
}, [date, selectedStaffId, service, staff, appointments, events, publicScheduleProfile, services]);

    const requiredForms = useMemo(() => {
        if (!service || !consentForms) return [];
        return consentForms.filter(form => service.requiredFormIds?.includes(form.id));
    }, [service, consentForms]);
    
    const depositAmount = useMemo(() => {
        if (!service || service.depositType === 'none') return 0;
        if (service.depositType === 'full') return service.price;
        if (service.depositType === 'breakeven') return service.cost;
        if (service.depositType === 'deposit') {
            if (service.depositSubType === 'percentage') {
                return service.price * ((service.depositAmount || 0) / 100);
            }
            return service.depositAmount || 0;
        }
        return 0;
    }, [service]);
    
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
    const progress = useMemo(() => ((currentStepIndex + 1) / (steps.length - 1)) * 100, [currentStepIndex, steps.length]);

  const handleNextStep = async () => {
    let isValid = true;

    if (currentStep === 'dateTime' && !selectedTime) {
      toast({ variant: 'destructive', title: 'Please select a time.' });
      isValid = false;
    }
    if (currentStep === 'details') {
      isValid = await methods.trigger(['clientName', 'clientEmail']);
    }
    if (currentStep === 'consents') {
        if (completedForms.size < requiredForms.length) {
            toast({ variant: 'destructive', title: 'Please complete all required forms.' });
            isValid = false;
        }
    }
     if (currentStep === 'payment') {
        if (!isDepositPaid) {
            // In a real app this would be a Stripe interaction. For now, we simulate success.
            setIsDepositPaid(true);
            toast({ title: "Deposit Paid!", description: "Your deposit has been processed."});
        }
    }
    
    // Check if we are on the final step before confirmation
    const isFinalStepBeforeConfirm = steps[currentStepIndex + 1] === 'confirmation';

    if (isValid) {
        if (isFinalStepBeforeConfirm) {
            handleSubmit(handleConfirmBooking)();
            return; // Exit here, form submission handles the last step
        }
        if (currentStepIndex < steps.length - 1) {
            setCurrentStepIndex(currentStepIndex + 1);
        }
    }
  };

  const handlePrevStep = () => {
    if (currentStepIndex > 0) {
      setCurrentStepIndex(currentStepIndex - 1);
    }
  };

  const handleStaffSelect = (staffId: string) => {
    setSelectedStaffId(staffId);
    setCurrentStepIndex(1);
    setSelectedTime(null);
  };
  
  const handleConfirmBooking = (data: BookingFormData) => {
    if (!service || !selectedTime) return;
    
    const [hours, minutes] = selectedTime.split(':').map(Number);
    const startDateTime = setMinutes(setHours(startOfDay(date), hours), minutes);
    const endDateTime = addMinutes(startDateTime, service.duration);

    const clientData = {
        clientName: data.clientName,
        clientEmail: data.clientEmail,
        clientPhone: data.clientPhone,
    };

    const appointmentDetails = {
      serviceId: service.id,
      staffId: selectedStaffId !== 'any' ? selectedStaffId : undefined,
      startTime: startDateTime.toISOString(),
      endTime: endDateTime.toISOString(),
      status: 'confirmed' as const,
      isWalkIn: false,
    };
    
    onConfirm(clientData, appointmentDetails, (step) => setCurrentStepIndex(steps.indexOf(step)));
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg p-0 flex flex-col">
        <SheetHeader className="p-6 pb-4">
          <SheetTitle>Book Your Appointment</SheetTitle>
          {currentStep !== 'confirmation' && <div className="pt-2"><Progress value={progress} className="h-2" /></div>}
        </SheetHeader>
        <ScrollArea className="flex-1">
            <div className="p-6 space-y-8">
                {currentStep === 'confirmation' ? (
                    <div className="text-center py-10">
                        <CheckCircle className="w-16 h-16 mx-auto text-green-500 mb-4" />
                        <h2 className="text-2xl font-bold">Booking Confirmed!</h2>
                        <p className="text-muted-foreground mt-2">
                            Your appointment for a {service?.name} is all set. We've sent a confirmation to your email.
                        </p>
                    </div>
                ) : (
                    <>
                        <div className="space-y-4">
                            <div className="flex items-center justify-between">
                                <h3 className="text-lg font-medium">Your Selected Service</h3>
                                {currentStep !== 'staff' && <Button variant="link" size="sm" className="p-0" onClick={() => onOpenChange(false)}>Change</Button>}
                            </div>
                            <Card className="bg-muted/50">
                                <CardContent className="p-4 flex gap-4 items-center">
                                    <Image src={service?.imageUrl || 'https://picsum.photos/seed/1/100/100'} alt={service?.name || ''} width={80} height={80} className="rounded-md object-cover" />
                                    <div className="space-y-1">
                                        <p className="font-semibold">{service?.name}</p>
                                        <div className="text-sm text-muted-foreground flex items-center gap-4">
                                            <span className="flex items-center gap-1.5"><Clock className="w-4 h-4"/>{service?.duration} min</span>
                                            <span className="flex items-center gap-1.5"><DollarSign className="w-4 h-4"/>{service?.price?.toFixed(2)}</span>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        </div>
                        
                        {currentStepIndex > 0 && currentStep !== 'confirmation' && (
                            <div className="space-y-4">
                                <div className="flex items-center justify-between">
                                    <h3 className="text-lg font-medium flex items-center gap-2"><Users className="w-5 h-5 text-primary" />Provider</h3>
                                    <Button variant="link" size="sm" className="p-0" onClick={() => setCurrentStepIndex(0)}>Change</Button>
                                </div>
                                <p className="text-muted-foreground text-sm">Selected: {selectedStaffId === 'any' ? 'Any Available' : staff.find(s=>s.id === selectedStaffId)?.name}</p>
                            </div>
                        )}
                        
                        {currentStep === 'staff' && (
                           <div className="space-y-4">
                                <h3 className="text-lg font-medium flex items-center gap-2"><Users className="w-5 h-5 text-primary" />Choose Your Provider</h3>
                                <RadioGroup onValueChange={handleStaffSelect} value={selectedStaffId} className="grid grid-cols-2 md:grid-cols-3 gap-4">
                                    <StaffSelectionCard staff={{id: 'any', name: 'Any Available', avatarUrl: ''}} isSelected={selectedStaffId === 'any'} onSelect={() => handleStaffSelect('any')} />
                                    {qualifiedStaff.map(s => (
                                        <StaffSelectionCard key={s.id} staff={s} isSelected={selectedStaffId === s.id} onSelect={() => handleStaffSelect(s.id)} />
                                    ))}
                                </RadioGroup>
                            </div>
                        )}

                        {currentStepIndex > 1 && currentStep !== 'confirmation' && (
                             <div className="space-y-4">
                                <div className="flex items-center justify-between">
                                    <h3 className="text-lg font-medium flex items-center gap-2"><Calendar className="w-5 h-5 text-primary" />Date & Time</h3>
                                    <Button variant="link" size="sm" className="p-0" onClick={() => setCurrentStepIndex(1)}>Change</Button>
                                </div>
                                <p className="text-muted-foreground text-sm">Selected: {format(date, 'EEEE, LLL d, yyyy')} at {selectedTime ? format(parseISO(`1970-01-01T${selectedTime}:00`), 'h:mm a') : ''}</p>
                            </div>
                        )}

                        {currentStep === 'dateTime' && (
                             <div className="space-y-4">
                                <h3 className="text-lg font-medium flex items-center gap-2"><Calendar className="w-5 h-5 text-primary" />Select Date & Time</h3>
                                <div className="p-4 rounded-lg border space-y-4">
                                    <div className="flex items-center justify-between"><Button variant="outline" size="icon" onClick={() => setDate(prev => addDays(prev, -7))}><ChevronLeft className="w-4 h-4" /></Button><span className="font-semibold">{format(weekStart, 'MMMM yyyy')}</span><Button variant="outline" size="icon" onClick={() => setDate(prev => addDays(prev, 7))}><ChevronRight className="w-4 h-4" /></Button></div>
                                    <div className="grid grid-cols-7 gap-2">{weekDays.map(day => (<button key={day.toString()} onClick={() => setDate(day)} className={cn("flex flex-col items-center justify-center p-2 rounded-lg border w-full aspect-square transition-colors", isSameDay(day, date) ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-accent", isBefore(day, startOfDay(new Date())) && "opacity-50 cursor-not-allowed")} disabled={isBefore(day, startOfDay(new Date()))}><span className="text-xs">{format(day, 'E')}</span><span className="font-bold text-lg">{format(day, 'd')}</span></button>))}</div>
                                    <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 pt-4">
                                        {timeSlots.map(time => (<Button key={time} variant={selectedTime === time ? 'default' : 'outline'} onClick={() => setSelectedTime(time)}>{format(setMinutes(setHours(new Date(), parseInt(time.split(':')[0])), parseInt(time.split(':')[1])), 'h:mm a')}</Button>))}
                                        {timeSlots.length === 0 && (<p className="col-span-full text-center text-sm text-muted-foreground py-4">No available slots for this day.</p>)}
                                    </div>
                                </div>
                            </div>
                        )}
                        
                        {currentStep === 'details' && (
                            <FormProvider {...methods}>
                                <form id="booking-details-form" onSubmit={handleSubmit(handleConfirmBooking)}>
                                    <div className="space-y-4">
                                        <h3 className="text-lg font-medium">Your Information</h3>
                                        <div className="space-y-2"><Label htmlFor="name">Full Name</Label><Input id="name" {...register('clientName')} />{errors.clientName && <p className="text-sm text-destructive">{errors.clientName.message}</p>}</div>
                                        <div className="space-y-2"><Label htmlFor="email">Email</Label><Input id="email" type="email" {...register('clientEmail')} />{errors.clientEmail && <p className="text-sm text-destructive">{errors.clientEmail.message}</p>}</div>
                                        <PhoneInput name="clientPhone" label="Phone" />
                                    </div>
                                </form>
                            </FormProvider>
                        )}
                        {currentStep === 'consents' && (
                            <div className="space-y-4">
                                <h3 className="text-lg font-medium">Consent Forms</h3>
                                {requiredForms.map(form => (
                                    <Card key={form.id}>
                                        <CardHeader><CardTitle className="text-base">{form.title}</CardTitle></CardHeader>
                                        <CardContent className="space-y-4">
                                            {form.fields?.map(field => <FormFieldRenderer key={field.id} field={field} />)}
                                        </CardContent>
                                        <CardFooter>
                                            <Button onClick={() => setCompletedForms(prev => new Set(prev.add(form.id)))} disabled={completedForms.has(form.id)}>
                                                {completedForms.has(form.id) ? <><CheckCircle className="w-4 h-4 mr-2"/>Completed</> : 'Acknowledge & Sign'}
                                            </Button>
                                        </CardFooter>
                                    </Card>
                                ))}
                            </div>
                        )}
                        {currentStep === 'summary' && (
                             <div className="space-y-4">
                                <h3 className="text-lg font-medium">Review & Confirm</h3>
                                <Card className="bg-muted/50">
                                    <CardContent className="p-4 text-sm space-y-3">
                                        <div className="flex justify-between"><span>Service:</span> <span className="font-semibold">{service?.name}</span></div>
                                        <div className="flex justify-between"><span>Provider:</span> <span className="font-semibold">{selectedStaffId === 'any' ? 'Any Available' : staff.find(s=>s.id === selectedStaffId)?.name}</span></div>
                                        <div className="flex justify-between"><span>Date:</span> <span className="font-semibold">{format(date, 'EEEE, LLL d, yyyy')}</span></div>
                                        <div className="flex justify-between"><span>Time:</span> <span className="font-semibold">{selectedTime ? format(parseISO(`1970-01-01T${selectedTime}:00`), 'h:mm a') : ''}</span></div>
                                        <Separator className="my-2"/>
                                        <div className="flex justify-between font-bold"><span>Total Due Today:</span> <span>${depositAmount > 0 ? depositAmount.toFixed(2) : service?.price?.toFixed(2) ?? '0.00'}</span></div>
                                        {depositAmount > 0 && <p className="text-xs text-muted-foreground text-right">Remaining balance of ${((service?.price ?? 0) - depositAmount).toFixed(2)} due at appointment.</p>}
                                    </CardContent>
                                </Card>
                            </div>
                        )}
                        {currentStep === 'payment' && (
                            <div className="space-y-4">
                                <h3 className="text-lg font-medium">Deposit Required</h3>
                                <Card><CardContent className="p-6 space-y-4">
                                    <div className="text-center"><p className="text-sm text-muted-foreground">A deposit of</p><p className="text-4xl font-bold">${depositAmount.toFixed(2)}</p><p className="text-xs text-muted-foreground">is required to secure your booking.</p></div>
                                    <div className="space-y-2"><Label htmlFor="card-number">Card Number</Label><Input id="card-number" placeholder="**** **** **** 1234" /></div>
                                    <div className="grid grid-cols-2 gap-4"><div className="space-y-2"><Label htmlFor="expiry">Expiry</Label><Input id="expiry" placeholder="MM / YY" /></div><div className="space-y-2"><Label htmlFor="cvc">CVC</Label><Input id="cvc" placeholder="123" /></div></div>
                                </CardContent></Card>
                            </div>
                        )}
                    </>
                )}
            </div>
        </ScrollArea>
        {currentStep !== 'confirmation' && (
            <SheetFooter className="p-6 border-t">
                {currentStepIndex > 0 && <Button variant="ghost" onClick={handlePrevStep}>Back</Button>}
                <div className="flex-1" />
                <Button onClick={handleNextStep} className="w-full sm:w-auto">
                    {currentStep === 'summary' && depositAmount > 0 
                        ? 'Continue to Payment' 
                        : (currentStep === 'summary' && depositAmount === 0) || currentStep === 'payment'
                        ? 'Book Appointment'
                        : 'Continue'
                    }
                </Button>
            </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
  );
};
