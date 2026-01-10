

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
import { CalendarIcon, PlusCircle, Trash2, DollarSign } from 'lucide-react';
import { cn } from '@/lib/utils';
import { type Event, type EventChecklistItem } from '@/lib/data';
import { format, setHours, setMinutes, startOfDay } from 'date-fns';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Checkbox } from '../ui/checkbox';

const EditEventForm = ({
    event,
    onConfirm
}: {
    event: Event;
    onConfirm: (event: Event) => void
}) => {
    const [title, setTitle] = useState(event.title);
    const [type, setType] = useState(event.type);
    const [date, setDate] = useState(event.startTime);
    const [startTime, setStartTime] = useState(format(event.startTime, 'HH:mm'));
    const [endTime, setEndTime] = useState(format(event.endTime, 'HH:mm'));
    const [notes, setNotes] = useState(event.notes || '');
    const [location, setLocation] = useState(event.location || '');
    const [checklist, setChecklist] = useState<EventChecklistItem[]>(event.checklist || []);
    const [newChecklistItem, setNewChecklistItem] = useState('');

    useEffect(() => {
        setTitle(event.title);
        setType(event.type);
        setDate(event.startTime);
        setStartTime(format(event.startTime, 'HH:mm'));
        setEndTime(format(event.endTime, 'HH:mm'));
        setNotes(event.notes || '');
        setLocation(event.location || '');
        setChecklist(event.checklist || []);
    }, [event]);


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
            setChecklist([...checklist, { id: `new-${Date.now()}`, text: newChecklistItem.trim(), completed: false }]);
            setNewChecklistItem('');
        }
    };
    
    const handleChecklistKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleAddChecklistItem();
        }
    };

    const removeChecklistItem = (id: string) => {
        setChecklist(checklist.filter((item) => item.id !== id));
    };

    const handleSubmit = () => {
        if (!title || !date) return;

        const [startHours, startMinutes] = startTime.split(':').map(Number);
        const startDateTime = setMinutes(setHours(startOfDay(date), startHours), startMinutes);

        const [endHours, endMinutes] = endTime.split(':').map(Number);
        const endDateTime = setMinutes(setHours(startOfDay(date), endHours), endMinutes);

        const updatedEvent: Event = {
            ...event,
            title,
            type,
            startTime: startDateTime,
            endTime: endDateTime,
            notes,
            location,
            checklist: checklist,
        };
        onConfirm(updatedEvent);
    }
    
    return (
        <form id="edit-event-form" onSubmit={(e) => { e.preventDefault(); handleSubmit(); }}>
            <ScrollArea className="h-[70vh] pr-6">
                <div className="space-y-6">
                    <div className="space-y-4">
                        <h3 className="text-lg font-medium">Event Details</h3>
                        <div className="space-y-2">
                            <Label htmlFor="title-edit">Title</Label>
                            <Input id="title-edit" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g., Team Lunch" />
                        </div>
                        <div className="space-y-2">
                             <Label>Type</Label>
                            <RadioGroup value={type} onValueChange={(v: any) => setType(v)} className="grid grid-cols-3 gap-2">
                                <div>
                                    <RadioGroupItem value="business" id="business-edit" className="peer sr-only" />
                                    <Label htmlFor="business-edit" className="flex items-center justify-center rounded-md border-2 border-muted bg-popover p-2 text-sm hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary">Business</Label>
                                </div>
                                <div>
                                    <RadioGroupItem value="personal" id="personal-edit" className="peer sr-only" />
                                    <Label htmlFor="personal-edit" className="flex items-center justify-center rounded-md border-2 border-muted bg-popover p-2 text-sm hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary">Personal</Label>
                                </div>
                                 <div>
                                    <RadioGroupItem value="blocked" id="blocked-edit" className="peer sr-only" />
                                    <Label htmlFor="blocked-edit" className="flex items-center justify-center rounded-md border-2 border-muted bg-popover p-2 text-sm hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary">Blocked</Label>
                                </div>
                            </RadioGroup>
                        </div>
                    </div>

                    <div className="space-y-4">
                        <h3 className="text-lg font-medium">Date & Time</h3>
                        <div className="space-y-2">
                            <Label htmlFor="event-date-edit">Date</Label>
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
                                <Label htmlFor="start-time-edit">Start Time</Label>
                                <Select onValueChange={setStartTime} value={startTime}>
                                    <SelectTrigger id="start-time-edit">
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
                                <Label htmlFor="end-time-edit">End Time</Label>
                                <Select onValueChange={setEndTime} value={endTime}>
                                    <SelectTrigger id="end-time-edit">
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
                    </div>

                     <div className="space-y-4">
                        <h3 className="text-lg font-medium">Important Details</h3>
                         <div className="space-y-2">
                            <Label htmlFor="location-edit">Location</Label>
                            <Input id="location-edit" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g., 123 Main St or 'Zoom'" />
                        </div>
                        
                        <div className="space-y-2">
                            <Label>Checklist</Label>
                            <div className='space-y-2'>
                                {checklist.map((item) => (
                                    <div key={item.id} className="flex items-center gap-2 p-2 bg-muted/50 rounded-md">
                                        <Checkbox id={`check-edit-${item.id}`} checked={item.completed} disabled />
                                        <p className="flex-1 text-sm">{item.text}</p>
                                        <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => removeChecklistItem(item.id)}><Trash2 className="h-4 w-4"/></Button>
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
                            <Label htmlFor="notes-edit">Notes</Label>
                            <Textarea id="notes-edit" rows={4} placeholder="Add any event-specific notes..." value={notes} onChange={(e) => setNotes(e.target.value)} />
                        </div>
                    </div>
                </div>
            </ScrollArea>
        </form>
    )
}

export const EditEventDialog = ({ open, onOpenChange, event, onConfirm }: { open: boolean, onOpenChange: (open: boolean) => void, event: Event, onConfirm: (event: Event) => void }) => {
  const isMobile = useIsMobile();

  const title = "Edit Event";
  const description = "Update the details for this event.";
  
  const FormContent = <EditEventForm event={event} onConfirm={onConfirm} />;

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
            <Button type="submit" form="edit-event-form" className="w-full">Save Changes</Button>
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
          <Button type="submit" form="edit-event-form">Save Changes</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
