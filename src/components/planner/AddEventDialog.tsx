
'use client';

import React, { useState, useMemo, KeyboardEvent } from 'react';
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

const AddEventForm = ({
    onConfirm
}: {
    onConfirm: (event: Omit<Event, 'id'>) => void
}) => {
    const [title, setTitle] = useState('');
    const [type, setType] = useState<'personal' | 'business'>('business');
    const [date, setDate] = useState<Date>(new Date());
    const [startTime, setStartTime] = useState<string>('09:00');
    const [endTime, setEndTime] = useState<string>('10:00');
    const [notes, setNotes] = useState('');
    const [location, setLocation] = useState('');
    const [cost, setCost] = useState<number | undefined>(undefined);
    const [logExpense, setLogExpense] = useState(true);
    const [checklist, setChecklist] = useState<Omit<EventChecklistItem, 'id'>[]>([]);
    const [newChecklistItem, setNewChecklistItem] = useState('');


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

    const handleSubmit = () => {
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
            cost: type === 'business' ? cost : undefined,
            isWriteOff: type === 'business' && logExpense,
            checklist: checklist.map((item, index) => ({...item, id: `cl-${Date.now()}-${index}`}))
        };
        onConfirm(newEvent);
    }
    
    return (
        <form id="add-event-form" onSubmit={(e) => { e.preventDefault(); handleSubmit(); }}>
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
                            <RadioGroup value={type} onValueChange={(v: any) => setType(v)} className="grid grid-cols-2 gap-4">
                                <div>
                                    <RadioGroupItem value="business" id="business" className="peer sr-only" />
                                    <Label htmlFor="business" className="flex flex-col items-center justify-between rounded-md border-2 border-muted bg-popover p-4 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary">Business</Label>
                                </div>
                                <div>
                                    <RadioGroupItem value="personal" id="personal" className="peer sr-only" />
                                    <Label htmlFor="personal" className="flex flex-col items-center justify-between rounded-md border-2 border-muted bg-popover p-4 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary">Personal</Label>
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
                    </div>

                     <div className="space-y-4">
                        <h3 className="text-lg font-medium">Important Details</h3>
                         <div className="space-y-2">
                            <Label htmlFor="location">Location</Label>
                            <Input id="location" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g., 123 Main St or 'Zoom'" />
                        </div>
                        {type === 'business' && (
                             <div className="space-y-2">
                                <Label htmlFor="cost">Cost</Label>
                                <div className="relative">
                                     <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                     <Input id="cost" type="number" value={cost || ''} onChange={(e) => setCost(parseFloat(e.target.value))} placeholder="0.00" className="pl-8" />
                                </div>
                                <div className="flex items-center space-x-2 pt-2">
                                    <Checkbox id="log-expense" checked={logExpense} onCheckedChange={(checked) => setLogExpense(!!checked)} disabled={!cost || cost <= 0} />
                                    <label
                                        htmlFor="log-expense"
                                        className="text-sm font-medium leading-none text-muted-foreground peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                                    >
                                        Log this cost as a business expense in the ledger.
                                    </label>
                                </div>
                            </div>
                        )}
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
    )
}

export const AddEventDialog = ({ open, onOpenChange, onConfirm }: { open: boolean, onOpenChange: (open: boolean) => void, onConfirm: (event: Omit<Event, 'id'>) => void }) => {
  const isMobile = useIsMobile();

  const title = "Add New Event";
  const description = "Add a personal or business event to your calendar.";
  
  const FormContent = <AddEventForm onConfirm={onConfirm} />;

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
