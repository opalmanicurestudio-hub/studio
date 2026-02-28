'use client';

import React, { useState, useMemo, KeyboardEvent, useEffect } from 'react';
import { useIsMobile } from '@/hooks/use-mobile';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from '@/components/ui/sheet';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { CalendarIcon, PlusCircle, Trash2, DollarSign, AlertTriangle, ChevronLeft, ChevronRight, Briefcase, User, Lock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { type Event, type EventChecklistItem, type Appointment, type Staff, services as allServices } from '@/lib/data';
import { format, setHours, setMinutes, startOfDay, areIntervalsOverlapping, addMinutes, startOfWeek, addDays, subWeeks, addWeeks, eachDayOfInterval, isSameDay, isBefore, isToday, getDay, parse } from 'date-fns';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Checkbox } from '../ui/checkbox';
import { Switch } from '../ui/switch';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import { useFirebase, useCollection, useMemoFirebase } from '@/firebase';
import { useTenant } from '@/context/TenantContext';
import { collection, query, where } from 'firebase/firestore';
import { nanoid } from 'nanoid';


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

const AddEventForm = ({
    onConfirm,
    staff,
}: {
    onConfirm: (event: Omit<Event, 'id' | 'startTime' | 'endTime'> & {startTime: Date, endTime: Date}) => void;
    staff: Staff[];
}) => {
    const { user, role, selectedTenant } = useTenant();
    const { firestore } = useFirebase();
    const tenantId = selectedTenant?.id;

    const { data: appointmentsFromDB, isLoading: appointmentsLoading } = useCollection<Appointment>(useMemoFirebase(() => tenantId && firestore ? collection(firestore, `tenants/${tenantId}/appointments`) : null, [firestore, tenantId]));
    const { data: eventsFromDB, isLoading: eventsLoading } = useCollection<Event>(useMemoFirebase(() => tenantId && firestore ? collection(firestore, `tenants/${tenantId}/events`) : null, [firestore, tenantId]));

    const appointments = useMemo(() => {
        if (!appointmentsFromDB) return [];
        return appointmentsFromDB.map(apt => ({
          ...apt,
          startTime: (apt.startTime as any)?.toDate ? (apt.startTime as any).toDate() : new Date(apt.startTime),
          endTime: (apt.endTime as any)?.toDate ? (apt.endTime as any).toDate() : new Date(apt.endTime),
        }));
      }, [appointmentsFromDB]);
    
      const events = useMemo(() => {
        if (!eventsFromDB) return [];
        return eventsFromDB.map(evt => ({
            ...evt,
            startTime: (evt.startTime as any)?.toDate ? (evt.startTime as any).toDate() : new Date(evt.startTime),
            endTime: (evt.endTime as any)?.toDate ? (evt.endTime as any).toDate() : new Date(evt.endTime),
        }));
      }, [eventsFromDB]);

    const [title, setTitle] = useState('');
    const [type, setType] = useState<'personal' | 'business' | 'blocked'>('business');
    const [date, setDate] = useState<Date>(new Date());
    const [startTime, setStartTime] = useState<string>('');
    const [duration, setDuration] = useState<number>(60);
    const [allDay, setAllDay] = useState(false);
    const [staffId, setStaffId] = useState(() => (role === 'staff' && user ? user.uid : ''));
    const [notes, setNotes] = useState('');
    const [location, setLocation] = useState('');
    const [checklist, setChecklist] = useState<Omit<EventChecklistItem, 'id' | 'completed'>[]>([]);
    const [newChecklistItem, setNewChecklistItem] = useState('');

    const [isOverlapping, setIsOverlapping] = useState(false);
    const [clashingItem, setClashingItem] = useState<any | null>(null);
    const [showConfirmation, setShowConfirmation] = useState(false);
    
    const selectedStaff = useMemo(() => staff.find(s => s.id === staffId), [staff, staffId]);
    const staffToDisplay = useMemo(() => (role === 'owner' || role === 'admin' ? staff : staff.filter(s => s.id === user?.uid)), [staff, role, user]);

    const weekStart = useMemo(() => startOfWeek(date, { weekStartsOn: 0 }), [date]);
    const weekDays = useMemo(() => eachDayOfInterval({ start: weekStart, end: addDays(weekStart, 6) }), [weekStart]);

    const handlePreviousWeek = () => setDate(prev => subWeeks(prev, 1));
    const handleNextWeek = () => setDate(prev => addWeeks(prev, 1));
    const handleDateSelect = (day: Date) => setDate(day);


    useEffect(() => {
        if (role === 'staff' && user && staff.length > 0 && staffId !== user.uid) {
            setStaffId(user.uid);
        }
    }, [role, user, staff, staffId]);

    useEffect(() => {
        if (allDay) {
            setStartTime('00:00');
            setDuration(24 * 60 - 1);
        }
    }, [allDay]);

    useEffect(() => {
        if (!date || !startTime || !duration) {
            setIsOverlapping(false);
            setClashingItem(null);
            return;
        }

        const [startHours, startMinutes] = startTime.split(':').map(Number);
        const startDateTime = setMinutes(setHours(startOfDay(date), startHours), startMinutes);
        const endDateTime = addMinutes(startDateTime, duration);

        if (startDateTime >= endDateTime) {
            setIsOverlapping(false);
            setClashingItem(null);
            return;
        }

        const newInterval = { start: startDateTime, end: endDateTime };

        const relevantAppointments = (appointments || []).filter(apt => 
            !staffId || staffId === 'all' || apt.staffId === staffId
        );
        const relevantEvents = (events || []).filter(evt => 
            !staffId || staffId === 'all' || evt.staffId === staffId || !evt.staffId || evt.staffId === 'all'
        );

        const clashApt = relevantAppointments.find(item => {
            const itemInterval = { start: item.startTime, end: item.endTime };
            return areIntervalsOverlapping(newInterval, itemInterval, { inclusive: false });
        });

        if (clashApt) {
            setIsOverlapping(true);
            setClashingItem({ type: 'appointment', details: `'Service' for ${clashApt.clientName || 'Client'}`, time: `${format(clashApt.startTime, 'h:mm a')} - ${format(clashApt.endTime, 'h:mm a')}` });
            return;
        }

        const clashEvt = relevantEvents.find(item => {
            const itemInterval = { start: item.startTime, end: item.endTime };
            return areIntervalsOverlapping(newInterval, itemInterval, { inclusive: false });
        });

        if (clashEvt) {
            setIsOverlapping(true);
            setClashingItem({ type: 'event', details: `'${clashEvt.title}' event`, time: `${format(clashEvt.startTime, 'h:mm a')} - ${format(clashEvt.endTime, 'h:mm a')}` });
            return;
        }

        setIsOverlapping(false);
        setClashingItem(null);
    }, [date, startTime, duration, appointments, events, staffId]);

    const handleAddChecklistItem = () => {
        if (newChecklistItem.trim()) {
            setChecklist([...checklist, { text: newChecklistItem.trim() }]);
            setNewChecklistItem('');
        }
    };
    
    const handleChecklistKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleAddChecklistItem();
        }
    };

    const removeChecklistItem = (index: number) => {
        setChecklist(checklist.filter((_, i) => i !== index));
    };

    const confirmAndSubmit = () => {
        if (!title || !date || !startTime) return;

        const [startHours, startMinutes] = startTime.split(':').map(Number);
        const startDateTime = setMinutes(setHours(startOfDay(date), startHours), startMinutes);
        const endDateTime = addMinutes(startDateTime, duration);

        const newEvent: Omit<Event, 'id' | 'startTime' | 'endTime'> & {startTime: Date, endTime: Date} = {
            title,
            type,
            startTime: startDateTime,
            endTime: endDateTime,
            allDay,
            notes,
            location,
            checklist: checklist.map((item, index) => ({...item, id: `cl-${Date.now()}-${index}`, completed: false })),
            staffId: (staffId && staffId !== 'all') ? staffId : undefined,
        };
        onConfirm(newEvent);
    }
    
    const handleSaveAttempt = () => {
        if (!title.trim()) return; 
        if (isOverlapping && type === 'blocked') {
            setShowConfirmation(true);
        } else {
            confirmAndSubmit();
        }
    };
    
    return (
        <>
            <form id="add-event-form" onSubmit={(e) => { e.preventDefault(); handleSaveAttempt(); }}>
                <ScrollArea className="h-[70vh] pr-6">
                <div className="space-y-6">
                    <div className="space-y-4">
                        <h3 className="text-lg font-medium">Event Details</h3>
                        <div className="space-y-2">
                            <Label htmlFor="title">Title</Label>
                            <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g., Team Lunch" />
                        </div>
                        <div className="space-y-2">
                            <Label>Type</Label>
                            <RadioGroup value={type} onValueChange={(v: any) => setType(v)} className="grid grid-cols-3 gap-2">
                                <div>
                                    <RadioGroupItem value="business" id="business-add" className="peer sr-only" />
                                    <Label htmlFor="business-add" className="flex flex-col items-center justify-center rounded-md border-2 border-muted bg-popover p-4 text-sm hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary transition-all cursor-pointer">
                                        <Briefcase className="w-5 h-5 mb-2"/>
                                        Business
                                    </Label>
                                </div>
                                <div>
                                    <RadioGroupItem value="personal" id="personal-add" className="peer sr-only" />
                                    <Label htmlFor="personal-add" className="flex flex-col items-center justify-center rounded-md border-2 border-muted bg-popover p-4 text-sm hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary transition-all cursor-pointer">
                                        <User className="w-5 h-5 mb-2"/>
                                        Personal
                                    </Label>
                                </div>
                                <div>
                                    <RadioGroupItem value="blocked" id="blocked-add" className="peer sr-only" />
                                    <Label htmlFor="blocked-add" className="flex flex-col items-center justify-center rounded-md border-2 border-muted bg-popover p-4 text-sm hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary transition-all cursor-pointer">
                                        <Lock className="w-5 h-5 mb-2"/>
                                        Blocked
                                    </Label>
                                </div>
                            </RadioGroup>
                        </div>
                         <div className="space-y-2">
                            <Label htmlFor="staff-block">Staff Member</Label>
                            <Select value={staffId} onValueChange={setStaffId} disabled={role==='staff'}>
                                <SelectTrigger id="staff-block">
                                     {selectedStaff ? (
                                        <div className="flex items-center gap-2">
                                            <Avatar className="w-6 h-6"><AvatarImage src={selectedStaff.avatarUrl || ''} /><AvatarFallback>{selectedStaff.name.charAt(0)}</AvatarFallback></Avatar>
                                            <span>{selectedStaff.name}</span>
                                        </div>
                                    ) : (
                                        <SelectValue placeholder={type === 'blocked' ? 'All Staff' : 'Optional'} />
                                    )}
                                </SelectTrigger>
                                <SelectContent>
                                    {(role === 'owner' || role === 'admin') && <SelectItem value="all">{type === 'blocked' ? 'All Staff' : 'None'}</SelectItem>}
                                    {staffToDisplay.map(s => (
                                        <SelectItem key={s.id} value={s.id}>
                                            <div className="flex items-center gap-2">
                                                <Avatar className="w-6 h-6">
                                                    <AvatarImage src={s.avatarUrl} />
                                                    <AvatarFallback>{s.name.charAt(0)}</AvatarFallback>
                                                </Avatar>
                                                <span>{s.name}</span>
                                            </div>
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            {type === 'blocked' && <p className="text-xs text-muted-foreground">Select a staff member to block only their schedule. Leave as "All Staff" to block everyone.</p>}
                        </div>
                    </div>

                    <div className="space-y-4">
                        <h3 className="text-lg font-medium">Date & Time</h3>
                        <div className="space-y-2">
                            <Label>Date</Label>
                            <div className="rounded-lg border p-4 space-y-4">
                                <div className="flex justify-between items-center">
                                    <Button variant="outline" size="icon" onClick={handlePreviousWeek} type="button"><ChevronLeft className="w-4 h-4" /></Button>
                                    <span className="font-semibold text-center">{format(date, 'MMMM yyyy')}</span>
                                    <Button variant="outline" size="icon" onClick={handleNextWeek} type="button"><ChevronRight className="w-4 h-4" /></Button>
                                </div>
                                <div className="grid grid-cols-7 gap-2">
                                    {weekDays.map(day => (
                                        <button
                                            key={day.toISOString()}
                                            onClick={() => handleDateSelect(day)}
                                            type="button"
                                            className={cn(
                                                "flex flex-col items-center justify-center p-2 rounded-lg border w-full aspect-square transition-colors",
                                                isSameDay(day, date)
                                                    ? "bg-primary text-primary-foreground border-primary"
                                                    : "bg-background hover:bg-accent",
                                                isBefore(day, startOfDay(new Date())) && !isSameDay(day, startOfDay(new Date())) && "opacity-50 cursor-not-allowed"
                                            )}
                                            disabled={isBefore(day, startOfDay(new Date())) && !isSameDay(day, startOfDay(new Date()))}
                                        >
                                            <span className="text-xs">{format(day, 'E')}</span>
                                            <span className="font-bold text-lg">{format(day, 'd')}</span>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>
                         <div className="flex items-center justify-between">
                            <Label htmlFor="all-day-event">All Day Event</Label>
                            <Switch id="all-day-event" checked={allDay} onCheckedChange={setAllDay} />
                        </div>
                        {!allDay ? (
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label htmlFor="start-time-event">Start Time</Label>
                                    <Input id="start-time-event" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="duration-event">Duration (minutes)</Label>
                                    <Input id="duration-event" type="number" value={duration} onChange={(e) => setDuration(Number(e.target.value))} placeholder="e.g., 60" />
                                </div>
                            </div>
                        ) : null}
                        {isOverlapping && type === 'blocked' && (
                            <Alert variant="destructive" className="mt-2">
                                <AlertTriangle className="h-4 w-4" />
                                <AlertTitle>Potential Double Booking</AlertTitle>
                                <AlertDescription className="space-y-1">
                                    <p>This event overlaps with an existing item on your calendar.</p>
                                    {clashingItem && (
                                        <div className="pt-1 mt-1 border-t border-destructive/20">
                                            <p className="font-bold">Clashes with: {clashingItem.details}</p>
                                            <p className="text-xs opacity-80">{clashingItem.time}</p>
                                        </div>
                                    )}
                                </AlertDescription>
                            </Alert>
                        )}
                    </div>

                    <div className="space-y-4">
                        <h3 className="text-lg font-medium">Important Details</h3>
                        <div className="space-y-2">
                            <Label htmlFor="location-event">Location</Label>
                            <Input id="location-event" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g., 123 Main St or 'Zoom'" />
                        </div>
                        
                        <div className="space-y-2">
                            <Label>Checklist</Label>
                            <div className='space-y-2'>
                                {checklist.map((item, index) => (
                                    <div key={index} className="flex items-center gap-2 p-2 bg-muted/50 rounded-md">
                                        <p className="flex-1 text-sm">{item.text}</p>
                                        <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => removeChecklistItem(index)}><Trash2 className="h-4 w-4"/></Button>
                                    </div>
                                ))}
                            </div>
                            <div className="flex gap-2">
                                <Input 
                                    placeholder="Add checklist item..."
                                    value={newChecklistItem}
                                    onChange={(e) => setNewChecklistItem(e.target.value)}
                                    onKeyDown={handleChecklistKeyDown}
                                />
                                <Button type="button" variant="outline" onClick={handleAddChecklistItem}><PlusCircle className="h-4 w-4"/></Button>
                            </div>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="notes-event">Notes</Label>
                            <Textarea id="notes-event" rows={4} placeholder="Add any event-specific notes..." value={notes} onChange={(e) => setNotes(e.target.value)} />
                        </div>
                    </div>
                </div>
                </ScrollArea>
            </form>
             <AlertDialog open={showConfirmation} onOpenChange={setShowConfirmation}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                    <AlertDialogTitle>Confirm Double Booking</AlertDialogTitle>
                    <AlertDialogDescription>
                        This event overlaps with {clashingItem?.details || 'an existing item'} on your calendar. Are you sure you want to schedule it anyway?
                    </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={confirmAndSubmit}>Book Anyway</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    )
}

export const AddEventDialog = ({ open, onOpenChange, onConfirm, staff }: { 
    open: boolean; 
    onOpenChange: (open: boolean) => void; 
    onConfirm: (event: Omit<Event, 'id' | 'startTime' | 'endTime'> & {startTime: Date, endTime: Date}) => void;
    staff: Staff[];
}) => {
  const isMobile = useIsMobile();

  const title = "Add New Event";
  const description = "Add a personal or business event to your calendar.";
  
  const FormContent = <AddEventForm onConfirm={onConfirm} staff={staff} />;

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" className="h-[95vh] flex flex-col p-0">
          <SheetHeader className="text-left p-4 border-b">
            <SheetTitle>{title}</SheetTitle>
            <SheetDescription>{description}</SheetDescription>
          </SheetHeader>
          <div className="py-4 flex-1 overflow-y-auto px-4">{FormContent}</div>
          <SheetFooter className="p-4 border-t">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" form="add-event-form" className="w-full">Save Event</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[90vh] flex flex-col p-0">
         <DialogHeader className="p-6 pb-4">
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto px-6">
            {FormContent}
        </div>
        <DialogFooter className="p-6 pt-4 border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" form="add-event-form">Save Event</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
