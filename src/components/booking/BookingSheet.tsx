

'use client';

import React, { useState, useMemo } from 'react';
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
} from '@/lib/data';
import { Progress } from '@/components/ui/progress';
import Image from 'next/image';
import { Clock, DollarSign, Users, Calendar, ChevronLeft, ChevronRight, User, Mail, Phone, CheckCircle } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { Card, CardContent } from '../ui/card';
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
  onConfirm: (appointmentData: Omit<Appointment, 'id'>) => void;
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
  onConfirm,
}) => {
  const [step, setStep] = useState(1);
  const totalSteps = 4;
  
  const [selectedStaffId, setSelectedStaffId] = useState('any');
  const [date, setDate] = useState(new Date());
  const [selectedTime, setSelectedTime] = useState<string | null>(null);

  const methods = useForm<BookingFormData>({
    resolver: zodResolver(bookingSchema),
  });

  const { control, handleSubmit, register, formState: { errors } } = methods;

  const progress = (step / totalSteps) * 100;
  
  const qualifiedStaff = useMemo(() => {
    if (!service.requiredSkills || service.requiredSkills.length === 0) {
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
    } else if (!staffDaySchedule) {
        workingHours = publicScheduleProfile.week[dayName];
    } else {
        return []; // Staff is explicitly not available
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

  const handleStaffSelect = (staffId: string) => {
    setSelectedStaffId(staffId);
    setStep(2);
    setSelectedTime(null);
  };

  const handleTimeSelect = (time: string) => {
      setSelectedTime(time);
  }

  const handleNextStep = async () => {
    let isValid = true;
    if (step === 2 && !selectedTime) {
        isValid = false;
    }
    if (step === 3) {
      isValid = await methods.trigger(['clientName', 'clientEmail']);
    }

    if (isValid && step < totalSteps) {
        setStep(step + 1);
    }
  }

  const handlePrevStep = () => {
      if (step > 1) {
          setStep(step - 1);
      }
  }
  
  const handleConfirmBooking = (data: BookingFormData) => {
    if (!service || !selectedTime) return;
    
    const [hours, minutes] = selectedTime.split(':').map(Number);
    const startDateTime = setMinutes(setHours(startOfDay(date), hours), minutes);
    const endDateTime = addMinutes(startDateTime, service.duration);

    const appointmentData: Omit<Appointment, 'id'> = {
      clientId: '', // Will be handled on submission
      clientName: data.clientName,
      clientEmail: data.clientEmail,
      clientPhone: data.clientPhone,
      serviceId: service.id,
      staffId: selectedStaffId !== 'any' ? selectedStaffId : undefined,
      startTime: startDateTime.toISOString(),
      endTime: endDateTime.toISOString(),
      status: 'confirmed',
      isWalkIn: false,
    };
    
    onConfirm(appointmentData);
    setStep(5); // Move to confirmation screen
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg p-0 flex flex-col">
        <SheetHeader className="p-6 pb-4">
          <SheetTitle>Book Your Appointment</SheetTitle>
          <div className="pt-2">
            <Progress value={progress} className="h-2" />
          </div>
        </SheetHeader>
        <ScrollArea className="flex-1">
            <div className="p-6 space-y-8">
                {step === 5 ? (
                    <div className="text-center py-10">
                        <CheckCircle className="w-16 h-16 mx-auto text-green-500 mb-4" />
                        <h2 className="text-2xl font-bold">Booking Confirmed!</h2>
                        <p className="text-muted-foreground mt-2">
                            Your appointment for a {service.name} is all set. We've sent a confirmation to your email.
                        </p>
                    </div>
                ) : (
                    <>
                         <div className="space-y-4">
                            <div className="flex items-center justify-between">
                                <h3 className="text-lg font-medium">Your Selected Service</h3>
                                <Button variant="link" size="sm" className="p-0" onClick={() => onOpenChange(false)}>Change</Button>
                            </div>
                            <Card className="bg-muted/50">
                                <CardContent className="p-4 flex gap-4 items-center">
                                    <Image
                                        src={service.imageUrl || 'https://picsum.photos/seed/1/100/100'}
                                        alt={service.name}
                                        width={80}
                                        height={80}
                                        className="rounded-md object-cover"
                                    />
                                    <div className="space-y-1">
                                        <p className="font-semibold">{service.name}</p>
                                        <div className="text-sm text-muted-foreground flex items-center gap-4">
                                            <span className="flex items-center gap-1.5"><Clock className="w-4 h-4"/>{service.duration} min</span>
                                            <span className="flex items-center gap-1.5"><DollarSign className="w-4 h-4"/>{service.price.toFixed(2)}</span>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        </div>
                        
                        {step > 1 && (
                            <div className="space-y-4">
                                <div className="flex items-center justify-between">
                                    <h3 className="text-lg font-medium flex items-center gap-2"><Users className="w-5 h-5 text-primary" />Provider</h3>
                                    <Button variant="link" size="sm" className="p-0" onClick={() => {setStep(1); setSelectedStaffId('any');}}>Change</Button>
                                </div>
                                <p className="text-muted-foreground text-sm">
                                    Selected: {selectedStaffId === 'any' ? 'Any Available' : staff.find(s=>s.id === selectedStaffId)?.name}
                                </p>
                            </div>
                        )}
                        
                        {step === 1 && (
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

                        {step > 2 && (
                             <div className="space-y-4">
                                <div className="flex items-center justify-between">
                                    <h3 className="text-lg font-medium flex items-center gap-2"><Calendar className="w-5 h-5 text-primary" />Date & Time</h3>
                                    <Button variant="link" size="sm" className="p-0" onClick={() => {setStep(2); setSelectedTime(null);}}>Change</Button>
                                </div>
                                <p className="text-muted-foreground text-sm">
                                    Selected: {format(date, 'EEEE, LLL d, yyyy')} at {selectedTime ? format(parseISO(`1970-01-01T${selectedTime}:00`), 'h:mm a') : ''}
                                </p>
                            </div>
                        )}

                        {step === 2 && (
                            <div className="space-y-4">
                                <h3 className="text-lg font-medium flex items-center gap-2"><Calendar className="w-5 h-5 text-primary" />Select Date & Time</h3>
                                <div className="p-4 rounded-lg border space-y-4">
                                    <div className="flex items-center justify-between">
                                        <Button variant="outline" size="icon" onClick={() => setDate(prev => addDays(prev, -7))}><ChevronLeft className="w-4 h-4" /></Button>
                                        <span className="font-semibold">{format(weekStart, 'MMMM yyyy')}</span>
                                        <Button variant="outline" size="icon" onClick={() => setDate(prev => addDays(prev, 7))}><ChevronRight className="w-4 h-4" /></Button>
                                    </div>
                                    <div className="grid grid-cols-7 gap-2">
                                        {weekDays.map(day => (
                                            <button
                                                key={day.toString()}
                                                onClick={() => setDate(day)}
                                                className={cn(
                                                    "flex flex-col items-center justify-center p-2 rounded-lg border w-full aspect-square transition-colors",
                                                    isSameDay(day, date)
                                                        ? "bg-primary text-primary-foreground border-primary"
                                                        : "bg-background hover:bg-accent",
                                                    isBefore(day, startOfDay(new Date())) && "opacity-50 cursor-not-allowed"
                                                )}
                                                disabled={isBefore(day, startOfDay(new Date()))}
                                            >
                                                <span className="text-xs">{format(day, 'E')}</span>
                                                <span className="font-bold text-lg">{format(day, 'd')}</span>
                                            </button>
                                        ))}
                                    </div>
                                    <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 pt-4">
                                        {timeSlots.map(time => (
                                            <Button key={time} variant={selectedTime === time ? 'default' : 'outline'} onClick={() => handleTimeSelect(time)}>
                                                {format(parseISO(`1970-01-01T${time}:00`), 'h:mm a')}
                                            </Button>
                                        ))}
                                        {timeSlots.length === 0 && (
                                            <p className="col-span-full text-center text-sm text-muted-foreground py-4">No available slots for this day.</p>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )}
                        
                        {step === 3 && (
                            <FormProvider {...methods}>
                                <form id="booking-details-form" onSubmit={handleSubmit(handleConfirmBooking)}>
                                    <div className="space-y-4">
                                        <h3 className="text-lg font-medium">Your Information</h3>
                                        <div className="space-y-2">
                                            <Label htmlFor="name">Full Name</Label>
                                            <Input id="name" {...register('clientName')} />
                                            {errors.clientName && <p className="text-sm text-destructive">{errors.clientName.message}</p>}
                                        </div>
                                        <div className="space-y-2">
                                            <Label htmlFor="email">Email</Label>
                                            <Input id="email" type="email" {...register('clientEmail')} />
                                            {errors.clientEmail && <p className="text-sm text-destructive">{errors.clientEmail.message}</p>}
                                        </div>
                                        <PhoneInput name="clientPhone" label="Phone" />
                                    </div>
                                </form>
                            </FormProvider>
                        )}
                    </>
                )}
            </div>
        </ScrollArea>
        {step < 5 && (
            <SheetFooter className="p-6 border-t">
                {step > 1 && <Button variant="ghost" onClick={handlePrevStep}>Back</Button>}
                <div className="flex-1" />
                {step === 3 ? (
                    <Button type="submit" form="booking-details-form" className="w-full sm:w-auto">Book Appointment</Button>
                ) : (
                    <Button onClick={handleNextStep} className="w-full sm:w-auto" disabled={step === 2 && !selectedTime}>Continue</Button>
                )}
            </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
  );
};
