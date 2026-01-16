

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
import { CalendarIcon, PlusCircle, Trash2, DollarSign, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { type Event, type EventChecklistItem, type Appointment } from '@/lib/data';
import { format, setHours, setMinutes, startOfDay, areIntervalsOverlapping } from 'date-fns';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';

const AddEventForm = ({
    onConfirm,
    appointments,
    events
}: {
    onConfirm: (event: Omit<Event, 'id'>) => void;
    appointments: Appointment[];
    events: Event[];
}) => {
    const [title, setTitle] = useState('');
    const [type, setType] = useState<'personal' | 'business' | 'blocked'>('business');
    const [date, setDate] = useState<Date>(new Date());
    const [startTime, setStartTime] = useState<string>('09:00');
    const [endTime, setEndTime] = useState<string>('10:00');
    const [notes, setNotes] = useState('');
    const [location, setLocation] = useState('');
    const [checklist, setChecklist] = useState<Omit<EventChecklistItem, 'id'>[]>([]);
    const [newChecklistItem, setNewChecklistItem] = useState('');

    const [isOverlapping, setIsOverlapping] = useState(false);
    const [showConfirmation, setShowConfirmation] = useState(false);

    useEffect(() => {
        if (!date || !startTime || !endTime) {
            setIsOverlapping(false);
            return;
        }

        const [startHours, startMinutes] = startTime.split(':').map(Number);
        const startDateTime = setMinutes(setHours(startOfDay(date), startHours), startMinutes);

        const [endHours, endMinutes] = endTime.split(':').map(Number);
        const endDateTime = setMinutes(setHours(startOfDay(date), endHours), endMinutes);

        if (startDateTime >= endDateTime) {
            setIsOverlapping(false);
            return;
        }

        const newInterval = { start: startDateTime, end: endDateTime };

        const allCalendarItems = [...appointments, ...events];

        const hasOverlap = allCalendarItems.some(item => {
            const itemInterval = { start: item.startTime, end: item.endTime };
            return areIntervalsOverlapping(newInterval, itemInterval, { inclusive: false });
        });

        setIsOverlapping(hasOverlap);
    }, [date, startTime, endTime, appointments, events]);


    const timeOptions = useMemo(() => {
        const options = [];
        for (let i = 0; i < 24; i++) {
            options.push(`${i.toString().padStart(2, '0')}:00`);
            options.push(`${i.toString().padStart(2, '0')}:30`);
        }
        return options;
    }, []);

    const handleAddChecklistItem = () => {
        if (newChecklistItem.trim()) {
            setChecklist([...checklist, { text: newChecklistItem.trim(), completed: false }]);
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
        if (!title || !date) return;

        const [startHours, startMinutes] = startTime.split(':').map(Number);
        const startDateTime = setMinutes(setHours(startOfDay(date), startHours), startMinutes);

        const [endHours, endMinutes] = endTime.split(':').map(Number);
        const endDateTime = setMinutes(setHours(startOfDay(date), endHours), endMinutes);

        const newEvent: Omit<Event, 'id'> = {
            title,
            type,
            startTime: startDateTime,
            endTime: endDateTime,
            notes,
            location,
            checklist: checklist.map((item, index) => ({...item, id: `cl-${Date.now()}-${index}`}))
        };
        onConfirm(newEvent);
    }
    
    const handleSaveAttempt = () => {
        if (!title.trim()) return; // Basic validation
        if (isOverlapping) {
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
                                        <RadioGroupItem value="business" id="business" className="peer sr-only" />
                                        <Label htmlFor="business" className="flex items-center justify-center rounded-md border-2 border-muted bg-popover p-2 text-sm hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary">Business</Label>
                                    </div>
                                    <div>
                                        <RadioGroupItem value="personal" id="personal" className="peer sr-only" />
                                        <Label htmlFor="personal" className="flex items-center justify-center rounded-md border-2 border-muted bg-popover p-2 text-sm hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary">Personal</Label>
                                    </div>
                                    <div>
                                        <RadioGroupItem value="blocked" id="blocked" className="peer sr-only" />
                                        <Label htmlFor="blocked" className="flex items-center justify-center rounded-md border-2 border-muted bg-popover p-2 text-sm hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary">Blocked</Label>
                                    </div>
                                </RadioGroup>
                            </div>
                        </div>

                        <div className="space-y-4">
                            <h3 className="text-lg font-medium">Date & Time</h3>
                            <div className="space-y-2">
                                <Label htmlFor="event-date">Date</Label>
                                <Popover>
                                    <PopoverTrigger asChild>
                                        <Button
                                            variant={"outline"}
                                            className={cn(
                                            "w-full justify-start text-left font-normal",
                                            !date && "text-muted-foreground"
                                            )}
                                        >
                                            <CalendarIcon className="mr-2 h-4 w-4" />
                                            {date ? format(date, 'PPP') : <span>Pick a date</span>}
                                        </Button>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-auto p-0">
                                        <Calendar
                                            mode="single"
                                            selected={date}
                                            onSelect={(d) => setDate(d || new Date())}
                                            initialFocus
                                        />
                                    </PopoverContent>
                                </Popover>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label htmlFor="start-time">Start Time</Label>
                                    <Select onValueChange={setStartTime} defaultValue={startTime}>
                                        <SelectTrigger id="start-time">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {timeOptions.map(time => (
                                                <SelectItem key={`start-${time}`} value={time}>{format(setMinutes(setHours(new Date(), parseInt(time.split(':')[0])), parseInt(time.split(':')[1])), 'h:mm a')}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="end-time">End Time</Label>
                                    <Select onValueChange={setEndTime} defaultValue={endTime}>
                                        <SelectTrigger id="end-time">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {timeOptions.map(time => (
                                                <SelectItem key={`end-${time}`} value={time}>{format(setMinutes(setHours(new Date(), parseInt(time.split(':')[0])), parseInt(time.split(':')[1])), 'h:mm a')}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                             {isOverlapping && (
                                <Alert variant="destructive" className="mt-2">
                                    <AlertTriangle className="h-4 w-4" />
                                    <AlertTitle>Potential Double Booking</AlertTitle>
                                    <AlertDescription>
                                        This time slot overlaps with an existing appointment or event.
                                    </AlertDescription>
                                </Alert>
                            )}
                        </div>

                        <div className="space-y-4">
                            <h3 className="text-lg font-medium">Important Details</h3>
                            <div className="space-y-2">
                                <Label htmlFor="location">Location</Label>
                                <Input id="location" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g., 123 Main St or 'Zoom'" />
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
                                <Label htmlFor="notes">Notes</Label>
                                <Textarea id="notes" rows={4} placeholder="Add any event-specific notes..." value={notes} onChange={(e) => setNotes(e.target.value)} />
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
                        This event overlaps with an existing item on your calendar. Are you sure you want to schedule it anyway?
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

export const AddEventDialog = ({ open, onOpenChange, onConfirm, appointments, events }: { open: boolean, onOpenChange: (open: boolean) => void, onConfirm: (event: Omit<Event, 'id'>) => void, appointments: Appointment[], events: Event[] }) => {
  const isMobile = useIsMobile();

  const title = "Add New Event";
  const description = "Add a personal or business event to your calendar.";
  
  const FormContent = <AddEventForm onConfirm={onConfirm} appointments={appointments} events={events} />;

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" className="h-[95dvh]">
          <SheetHeader className="text-left">
            <SheetTitle>{title}</SheetTitle>
            <SheetDescription>{description}</SheetDescription>
          </SheetHeader>
          <div className="py-4">{FormContent}</div>
          <SheetFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" form="add-event-form" className="w-full">Save Event</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
         <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="py-4">{FormContent}</div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" form="add-event-form">Save Event</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
