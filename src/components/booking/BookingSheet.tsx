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
import { Clock, DollarSign, Users, Calendar, ChevronLeft, ChevronRight } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
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
  parse,
  getDay,
  isBefore,
  isToday,
} from 'date-fns';

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
}) => {
  const [step, setStep] = useState(1);
  const totalSteps = 3;
  
  const [selectedStaffId, setSelectedStaffId] = useState('any');
  const [date, setDate] = useState(new Date());
  const [selectedTime, setSelectedTime] = useState<string | null>(null);

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
  
  const timeSlots = useMemo(() => {
    if (!service || !date || !scheduleProfiles?.length) return [];
    
    const publicScheduleProfile = scheduleProfiles[0];
    if (!publicScheduleProfile) return [];

    const bookingInterval = publicScheduleProfile.bookingSlotInterval || 15;
    const dayName = format(date, 'eeee').toLowerCase();
    
    const selectedStaff = staff.find(s => s.id === selectedStaffId);
    let workingHours = publicScheduleProfile.week[dayName];
    
    if (selectedStaff && selectedStaff.availability?.week) {
        const staffDayHours = selectedStaff.availability.week[dayName as keyof typeof selectedStaff.availability.week];
        if (staffDayHours.enabled) {
            workingHours = staffDayHours;
        }
    }

    if (!workingHours || !workingHours.enabled) {
      return [];
    }

    const dayStartWithBusinessHours = parse(workingHours.start, 'h:mm a', startOfDay(date));
    const dayEndWithBusinessHours = parse(workingHours.end, 'h:mm a', startOfDay(date));
    
    const busyIntervals = [
      ...appointments
        .filter(apt => {
          if (!isSameDay(apt.startTime, date)) return false;
          if (selectedStaffId !== 'any' && apt.staffId !== selectedStaffId) return false;
          return true;
        })
        .map(apt => {
            const aptService = services.find(s => s.id === apt.serviceId);
            const padBefore = aptService?.padBefore || 0;
            const padAfter = aptService?.padAfter || 0;
            return {
                start: addMinutes(apt.startTime, -padBefore),
                end: addMinutes(apt.endTime, padAfter)
            }
        }),
      ...events
        .filter(evt => {
            if (!isSameDay(evt.startTime, date)) return false;
            if (evt.type !== 'blocked') return false;
            if (evt.staffId && evt.staffId !== 'all' && selectedStaffId !== 'any' && evt.staffId !== selectedStaffId) return false;
            if (evt.staffId === 'all') return true;
            if (!evt.staffId && selectedStaffId !== 'any') return false; // Event not for anyone specific
            return true;
        })
        .map(evt => ({ start: evt.startTime, end: evt.endTime })),
    ];
    
    const options: string[] = [];
    let currentTime = dayStartWithBusinessHours;
    
    while(currentTime < dayEndWithBusinessHours) {
        const potentialStartTime = currentTime;

        if (isToday(date) && isBefore(potentialStartTime, new Date())) {
            currentTime = addMinutes(currentTime, bookingInterval);
            continue;
        }

        const totalDuration = service.duration + (service.padBefore || 0) + (service.padAfter || 0);
        const potentialEndTime = addMinutes(potentialStartTime, totalDuration);

        if (potentialEndTime > dayEndWithBusinessHours) {
            break;
        }

        const isOverlapping = busyIntervals.some(interval =>
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
}, [date, selectedStaffId, service, staff, appointments, events, scheduleProfiles, services]);

  const handleStaffSelect = (staffId: string) => {
    setSelectedStaffId(staffId);
    setStep(3);
    setSelectedTime(null);
  };

  const handleTimeSelect = (time: string) => {
      setSelectedTime(time);
      // Here you would proceed to the next step, e.g. client details
  }

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
                {/* Step 1: Service Confirmation */}
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
                
                 {/* Step 2: Staff Selection */}
                <div className="space-y-4">
                    <h3 className="text-lg font-medium flex items-center gap-2"><Users className="w-5 h-5 text-primary" />Choose Your Provider</h3>
                    <RadioGroup onValueChange={handleStaffSelect} value={selectedStaffId} className="grid grid-cols-2 md:grid-cols-3 gap-4">
                        <StaffSelectionCard staff={{id: 'any', name: 'Any Available', avatarUrl: ''}} isSelected={selectedStaffId === 'any'} onSelect={() => handleStaffSelect('any')} />
                        {qualifiedStaff.map(s => (
                            <StaffSelectionCard key={s.id} staff={s} isSelected={selectedStaffId === s.id} onSelect={() => handleStaffSelect(s.id)} />
                        ))}
                    </RadioGroup>
                </div>

                {/* Step 3: Date & Time */}
                <div className={cn("space-y-4", step < 3 && "opacity-50 pointer-events-none")}>
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
                                            : "bg-background hover:bg-accent"
                                    )}
                                >
                                    <span className="text-xs">{format(day, 'E')}</span>
                                    <span className="font-bold text-lg">{format(day, 'd')}</span>
                                </button>
                            ))}
                        </div>
                         <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 pt-4">
                            {timeSlots.map(time => (
                                <Button key={time} variant={selectedTime === time ? 'default' : 'outline'} onClick={() => handleTimeSelect(time)}>
                                    {format(parse(time, 'HH:mm', new Date()), 'h:mm a')}
                                </Button>
                            ))}
                            {timeSlots.length === 0 && (
                                <p className="col-span-full text-center text-sm text-muted-foreground py-4">No available slots for this day.</p>
                            )}
                        </div>
                     </div>
                </div>
            </div>
        </ScrollArea>
        <SheetFooter className="p-6 border-t">
          <Button className="w-full" size="lg" disabled={!selectedTime}>Continue</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
};
