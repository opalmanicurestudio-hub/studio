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
import { CalendarIcon, PlusCircle, Trash2, DollarSign, AlertTriangle, ChevronLeft, ChevronRight, Briefcase, User, Lock, Users, Check, Loader, Sparkles, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { type Event, type EventChecklistItem, type Staff, type Appointment } from '@/lib/data';
import { format, setHours, setMinutes, startOfDay, areIntervalsOverlapping, addMinutes, startOfWeek, addDays, subWeeks, addWeeks, eachDayOfInterval, isSameDay, isBefore, isToday, parseISO } from 'date-fns';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Checkbox } from '../ui/checkbox';
import { Switch } from '../ui/switch';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import { useFirebase, useCollection, useMemoFirebase } from '@/firebase';
import { useTenant } from '@/context/TenantContext';
import { collection, query, where } from 'firebase/firestore';
import { nanoid } from 'nanoid';

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
    if (typeof val?.toDate === 'function') return val.toDate();
    if (typeof val === 'object' && 'seconds' in val) return new Date(val.seconds * 1000);
    return new Date(val);
};

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

    const { data: appointmentsFromDB } = useCollection<Appointment>(useMemoFirebase(() => tenantId && firestore ? collection(firestore, `tenants/${tenantId}/appointments`) : null, [firestore, tenantId]));
    const { data: eventsFromDB } = useCollection<Event>(useMemoFirebase(() => tenantId && firestore ? collection(firestore, `tenants/${tenantId}/events`) : null, [firestore, tenantId]));

    const appointments = useMemo(() => {
        if (!appointmentsFromDB) return [];
        return appointmentsFromDB.map(apt => ({
          ...apt,
          startTime: safeDate(apt.startTime),
          endTime: safeDate(apt.endTime),
        }));
      }, [appointmentsFromDB]);
    
      const events = useMemo(() => {
        if (!eventsFromDB) return [];
        return eventsFromDB.map(evt => ({
            ...evt,
            startTime: safeDate(evt.startTime),
            endTime: safeDate(evt.endTime),
        }));
      }, [eventsFromDB]);

    const [title, setTitle] = useState('');
    const [type, setType] = useState<'personal' | 'business' | 'blocked'>('business');
    const [date, setDate] = useState<Date>(new Date());
    const [startTime, setStartTime] = useState<string>('');
    const [duration, setDuration] = useState<number>(60);
    const [allDay, setAllDay] = useState(false);
    const [selectedStaffIds, setSelectedStaffIds] = useState<string[]>(() => (role === 'staff' && user ? [user.uid] : []));
    const [notes, setNotes] = useState('');
    const [location, setLocation] = useState('');
    const [checklist, setChecklist] = useState<Omit<EventChecklistItem, 'id' | 'completed'>[]>([]);
    const [newChecklistItem, setNewChecklistItem] = useState('');

    const [isOverlapping, setIsOverlapping] = useState(false);
    const [clashingItem, setClashingItem] = useState<any | null>(null);
    const [showConfirmation, setShowConfirmation] = useState(false);
    
    const staffToDisplay = useMemo(() => (role === 'owner' || role === 'admin' ? staff : staff.filter(s => s.id === user?.uid)), [staff, role, user]);

    const weekStart = useMemo(() => startOfWeek(date, { weekStartsOn: 0 }), [date]);
    const weekDays = useMemo(() => eachDayOfInterval({ start: weekStart, end: addDays(weekStart, 6) }), [weekStart]);

    const handlePreviousWeek = () => setDate(prev => subWeeks(prev, 1));
    const handleNextWeek = () => setDate(prev => addWeeks(prev, 1));
    const handleDateSelect = (day: Date) => setDate(day);

    const toggleStaffSelection = (id: string) => {
        setSelectedStaffIds(prev => prev.includes(id) ? prev.filter(sid => sid !== id) : [...prev, id]);
    };

    const toggleSelectAllStaff = () => {
        if (selectedStaffIds.length === staff.length) {
            setSelectedStaffIds([]);
        } else {
            setSelectedStaffIds(staff.map(s => s.id));
        }
    };

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
            selectedStaffIds.length === 0 || selectedStaffIds.includes(apt.staffId || '')
        );
        const relevantEvents = (events || []).filter(evt => 
            selectedStaffIds.length === 0 || 
            (evt.staffIds || []).some(sid => selectedStaffIds.includes(sid)) ||
            !(evt.staffIds && evt.staffIds.length > 0)
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
    }, [date, startTime, duration, appointments, events, selectedStaffIds]);

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
            staffIds: selectedStaffIds,
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
        <div id="add-event-form-container">
            <div className="space-y-6">
                <div className="space-y-4 text-left">
                    <h3 className="text-lg font-black uppercase tracking-tight flex items-center gap-3">
                        <Briefcase className="w-6 h-6 text-primary" />
                        Event Details
                    </h3>
                    <div className="space-y-2">
                        <Label htmlFor="title" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Title</Label>
                        <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g., Team Lunch" className="h-14 rounded-2xl border-2 font-bold text-lg shadow-inner bg-muted/5" />
                    </div>
                    <div className="space-y-2">
                        <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Type</Label>
                        <RadioGroup value={type} onValueChange={(v: any) => setType(v)} className="grid grid-cols-3 gap-2">
                            <div>
                                <RadioGroupItem value="business" id="business-add" className="peer sr-only" />
                                <Label htmlFor="business-add" className="flex flex-col items-center justify-center rounded-2xl border-2 border-muted bg-popover p-4 text-xs font-black uppercase tracking-widest hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/5 peer-data-[state=checked]:text-primary transition-all cursor-pointer h-full">
                                    <Briefcase className="w-5 h-5 mb-2 opacity-40"/>
                                    Business
                                </Label>
                            </div>
                            <div>
                                <RadioGroupItem value="personal" id="personal-add" className="peer sr-only" />
                                <Label htmlFor="personal-add" className="flex flex-col items-center justify-center rounded-2xl border-2 border-muted bg-popover p-4 text-xs font-black uppercase tracking-widest hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/5 peer-data-[state=checked]:text-primary transition-all cursor-pointer h-full">
                                    <User className="w-5 h-5 mb-2 opacity-40"/>
                                    Personal
                                </Label>
                            </div>
                            <div>
                                <RadioGroupItem value="blocked" id="blocked-add" className="peer sr-only" />
                                <Label htmlFor="blocked-add" className="flex flex-col items-center justify-center rounded-2xl border-2 border-muted bg-popover p-4 text-xs font-black uppercase tracking-widest hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/5 peer-data-[state=checked]:text-primary transition-all cursor-pointer h-full">
                                    <Lock className="w-5 h-5 mb-2 opacity-40"/>
                                    Blocked
                                </Label>
                            </div>
                        </RadioGroup>
                    </div>
                        <div className="space-y-4 pt-4">
                        <div className="flex items-center justify-between">
                            <Label className="text-sm font-black uppercase tracking-tight flex items-center gap-2">
                                <Users className="w-4 h-4 text-primary" />
                                Assigned Team
                            </Label>
                            {(role === 'owner' || role === 'admin') && (
                                <Button variant="ghost" size="sm" onClick={toggleSelectAllStaff} className="h-auto p-0 text-[10px] font-black uppercase tracking-widest text-primary underline decoration-2 underline-offset-4">
                                    {selectedStaffIds.length === staff.length ? 'Clear All' : 'Select All Team'}
                                </Button>
                            )}
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[200px] overflow-y-auto pr-2">
                            {staffToDisplay.map(s => (
                                <label key={s.id} className={cn(
                                    "flex items-center gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all",
                                    selectedStaffIds.includes(s.id) ? "border-primary bg-primary/5 shadow-sm" : "border-border bg-background hover:border-primary/20"
                                )}>
                                    <Checkbox 
                                        id={`staff-chk-${s.id}`} 
                                        checked={selectedStaffIds.includes(s.id)}
                                        onCheckedChange={() => toggleStaffSelection(s.id)}
                                        className="h-5 w-5 border-2 rounded-full"
                                    />
                                    <Avatar className="h-8 w-8 border shadow-sm rounded-xl">
                                        <AvatarImage src={s.avatarUrl} className="object-cover" />
                                        <AvatarFallback className="font-black text-xs bg-primary/10 text-primary">{(s.name || 'S').charAt(0)}</AvatarFallback>
                                    </Avatar>
                                    <span className="text-[11px] font-black uppercase tracking-tight truncate">{s.name}</span>
                                </label>
                            ))}
                        </div>
                        {selectedStaffIds.length === 0 && (
                            <p className="text-[10px] text-muted-foreground uppercase font-black tracking-widest italic text-center opacity-60 bg-muted/20 py-2 rounded-lg">Global Event &middot; Visible in Business Column</p>
                        )}
                    </div>
                </div>

                <div className="space-y-4 pt-6 border-t border-dashed">
                    <h3 className="text-lg font-black uppercase tracking-tight flex items-center gap-3">
                        <CalendarIcon className="w-6 h-6 text-primary" />
                        Timing
                    </h3>
                    <div className="space-y-2 text-left">
                        <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Schedule Picker</Label>
                        <div className="rounded-[2.5rem] border-2 bg-muted/10 p-6 space-y-6 shadow-inner">
                            <div className="flex justify-between items-center px-2">
                                <Button variant="outline" size="icon" onClick={handlePreviousWeek} type="button" className="h-10 w-10 rounded-full bg-background shadow-md border-none"><ChevronLeft className="w-5 h-5" /></Button>
                                <span className="font-black uppercase tracking-widest text-sm">{format(date, 'MMMM yyyy')}</span>
                                <Button variant="outline" size="icon" onClick={handleNextWeek} type="button" className="h-10 w-10 rounded-full bg-background shadow-md border-none"><ChevronRight className="w-5 h-5" /></Button>
                            </div>
                            <div className="grid grid-cols-7 gap-2">
                                {weekDays.map(day => (
                                    <button
                                        key={day.toISOString()}
                                        onClick={() => handleDateSelect(day)}
                                        type="button"
                                        className={cn(
                                            "flex flex-col items-center justify-center p-3 rounded-2xl border-2 transition-all aspect-square",
                                            isSameDay(day, date)
                                                ? "bg-primary text-primary-foreground border-primary shadow-2xl scale-110"
                                                : "bg-background border-transparent hover:border-primary/30",
                                            isBefore(day, startOfDay(new Date())) && !isSameDay(day, startOfDay(new Date())) && "opacity-20 cursor-not-allowed"
                                        )}
                                        disabled={isBefore(day, startOfDay(new Date())) && !isSameDay(day, startOfDay(new Date()))}
                                    >
                                        <span className="text-[8px] sm:text-[10px] uppercase font-black opacity-60 mb-1">{format(day, 'E')}</span>
                                        <span className="font-black text-sm md:text-xl tracking-tighter">{format(day, 'd')}</span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                        <div className="flex items-center justify-between p-6 border-2 rounded-[2rem] bg-muted/5 shadow-inner">
                        <div className="space-y-1 text-left">
                            <Label htmlFor="all-day-event" className="text-base font-black uppercase tracking-tight">All Day Event</Label>
                            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest opacity-60 tracking-widest">Block entire operating window</p>
                        </div>
                        <Switch id="all-day-event" checked={allDay} onCheckedChange={setAllDay} className="scale-125" />
                    </div>
                    {!allDay ? (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                            <div className="space-y-2 text-left">
                                <Label htmlFor="start-time-event" className="text-[10px] font-black uppercase text-muted-foreground ml-1">Start Time</Label>
                                <Input id="start-time-event" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className="h-14 rounded-2xl border-2 font-black text-xl shadow-inner" />
                            </div>
                            <div className="space-y-2 text-left">
                                <Label htmlFor="duration-event" className="text-[10px] font-black uppercase text-muted-foreground ml-1">Duration (minutes)</Label>
                                <Input id="duration-event" type="number" value={duration} onChange={(e) => setDuration(Number(e.target.value))} placeholder="e.g., 60" className="h-14 rounded-2xl border-2 font-black text-xl shadow-inner text-center" />
                            </div>
                        </div>
                    ) : null}
                    {isOverlapping && type === 'blocked' && (
                        <Alert variant="destructive" className="mt-2 border-4 border-destructive bg-destructive/5 rounded-[2rem] p-6 shadow-2xl shadow-destructive/10">
                            <AlertTriangle className="h-6 w-6 text-destructive" />
                            <AlertTitle className="text-sm font-black uppercase tracking-tight mb-2">Clash Detected</AlertTitle>
                            <AlertDescription className="space-y-2 pt-1 uppercase">
                                <p className="text-[10px] font-bold leading-relaxed opacity-80">This block overlaps with an existing agenda item.</p>
                                {clashingItem && (
                                    <div className="pt-3 mt-3 border-t border-destructive/20 space-y-1">
                                        <p className="font-black text-xs tracking-tight text-destructive">{clashingItem.details}</p>
                                        <p className="text-[10px] font-black opacity-60 tracking-widest">{clashingItem.time}</p>
                                    </div>
                                )}
                            </AlertDescription>
                        </Alert>
                    )}
                </div>

                <div className="space-y-6 pt-6 border-t border-dashed text-left">
                    <h3 className="text-lg font-black uppercase tracking-tight flex items-center gap-3">
                        <PlusCircle className="w-6 h-6 text-primary" />
                        Engagement
                    </h3>
                    <div className="space-y-2">
                        <Label htmlFor="location-event" className="text-[10px] font-black uppercase text-muted-foreground ml-1">Deployment Location</Label>
                        <Input id="location-event" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g., Main Studio or 'Zoom'" className="h-14 rounded-2xl border-2 font-black uppercase text-sm tracking-tight shadow-inner" />
                    </div>
                    
                    <div className="space-y-3">
                        <Label className="text-[10px] font-black uppercase text-muted-foreground ml-1">Action Items Checklist</Label>
                        <div className='space-y-2'>
                            {checklist.map((item, index) => (
                                <div key={index} className="flex items-center gap-3 p-4 bg-white rounded-2xl border-2 border-transparent hover:border-primary/10 transition-all group shadow-sm">
                                    <p className="flex-1 text-sm font-bold uppercase tracking-tight text-slate-700 truncate">{item.text}</p>
                                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive opacity-0 group-hover:opacity-100 transition-opacity" onClick={() => removeChecklistItem(index)}><Trash2 className="w-4 h-4" /></Button>
                                </div>
                            ))}
                        </div>
                        <div className="flex gap-2">
                            <Input 
                                placeholder="APPEND SUB-TASK..."
                                value={newChecklistItem}
                                onChange={(e) => setNewChecklistItem(e.target.value)}
                                onKeyDown={handleChecklistKeyDown}
                                className="h-12 rounded-xl border-2 font-black uppercase text-[10px] tracking-widest bg-muted/5 shadow-inner"
                            />
                            <Button type="button" variant="outline" onClick={handleAddChecklistItem} className="h-12 w-12 rounded-xl border-2 shrink-0"><PlusCircle className="h-5 w-5 text-primary opacity-40"/></Button>
                        </div>
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="notes-event" className="text-[10px] font-black uppercase text-muted-foreground ml-1">Strategic Context & Notes</Label>
                        <Textarea id="notes-event" rows={4} placeholder="Operational objectives or personal reminders..." value={notes} onChange={(e) => setNotes(e.target.value)} className="rounded-2xl border-2 bg-muted/5 focus-visible:ring-primary/20 font-medium p-6" />
                    </div>
                </div>
            </div>
            <AlertDialog open={showConfirmation} onOpenChange={setShowConfirmation}>
                <AlertDialogContent className="rounded-[3rem] border-4 shadow-3xl">
                    <AlertDialogHeader className="p-6 pb-0 text-center sm:text-left">
                    <AlertDialogTitle className="font-black uppercase tracking-tighter text-2xl">Confirm Double Booking</AlertDialogTitle>
                    <AlertDialogDescription className="font-bold text-sm text-slate-600 leading-relaxed uppercase">
                        This event overlaps with {clashingItem?.details || 'an existing item'} on your calendar. Proceed with creating this clash?
                    </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter className="p-6 pt-4 flex flex-col gap-3">
                        <Button onClick={confirmAndSubmit} className="w-full h-16 rounded-2xl font-black uppercase tracking-widest shadow-2xl shadow-primary/20">Book Anyway</Button>
                        <AlertDialogCancel onClick={() => setShowConfirmation(false)} className="w-full h-12 rounded-xl font-bold uppercase text-[10px] tracking-widest border-none bg-transparent">Back</AlertDialogCancel>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    )
}

export const AddEventDialog = ({ open, onOpenChange, onConfirm, staff }: { 
    open: boolean; 
    onOpenChange: (open: boolean) => void; 
    onConfirm: (event: Omit<Event, 'id' | 'startTime' | 'endTime'> & {startTime: Date, endTime: Date}) => void;
    staff: Staff[];
}) => {
  const isMobile = useIsMobile();

  const title = "New Event";
  const description = "Initialize a business, personal, or blocked window.";
  
  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" className="h-[95vh] p-0 border-none rounded-t-[3rem] overflow-hidden bg-background flex flex-col">
          <SheetHeader className="text-left p-6 border-b bg-muted/5 flex-shrink-0">
            <div className="flex items-center gap-3 mb-1.5">
                <Sparkles className="w-4 h-4 text-primary" />
                <span className="text-[9px] font-black uppercase tracking-[0.2em] text-muted-foreground opacity-60">Planning Suite</span>
            </div>
            <SheetTitle className="text-2xl font-black uppercase tracking-tighter text-slate-900 leading-none">{title}</SheetTitle>
            <SheetDescription className="text-[10px] font-bold uppercase tracking-widest opacity-60 mt-1">{description}</SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto">
            <div className="p-6">
                <AddEventForm onConfirm={(data) => { onConfirm(data); onOpenChange(false); }} staff={staff} />
            </div>
          </div>
          <SheetFooter className="p-6 pt-4 border-t bg-background flex-shrink-0 shadow-2xl">
            <div className="flex w-full gap-3">
                <Button variant="ghost" onClick={() => onOpenChange(false)} className="h-14 font-black uppercase tracking-tighter text-xs text-slate-400 flex-1">Cancel</Button>
                <Button type="submit" form="add-event-form" className="h-14 font-black uppercase tracking-widest shadow-xl shadow-primary/20 rounded-2xl flex-[2]">Establish Event</Button>
            </div>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl max-h-[90vh] flex flex-col p-0 rounded-[3rem] overflow-hidden border-4 shadow-3xl bg-background">
         <DialogHeader className="p-8 pb-6 bg-muted/5 border-b text-left flex-shrink-0">
            <div className="flex items-center gap-3 mb-2">
                <Sparkles className="w-5 h-5 text-primary" />
                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground opacity-60">Planning Suite</span>
            </div>
            <DialogTitle className="text-3xl font-black uppercase tracking-tighter text-slate-900 leading-none">{title}</DialogTitle>
            <DialogDescription className="text-xs font-bold uppercase tracking-widest opacity-60 mt-1">{description}</DialogDescription>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto">
            <div className="px-8 py-8">
                <AddEventForm onConfirm={(data) => { onConfirm(data); onOpenChange(false); }} staff={staff} />
            </div>
        </div>
        <DialogFooter className="p-8 pt-4 border-t bg-background flex-shrink-0">
          <Button variant="ghost" onClick={() => onOpenChange(false)} className="h-14 px-8 rounded-2xl font-black uppercase tracking-widest text-xs text-slate-400">Cancel</Button>
          <Button type="submit" form="add-event-form" className="h-14 px-12 rounded-2xl font-black uppercase tracking-widest shadow-2xl shadow-primary/20 active:scale-95 transition-all group">Establish Event <ArrowRight className="ml-2 w-4 h-4 transition-transform group-hover:translate-x-1"/></Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
