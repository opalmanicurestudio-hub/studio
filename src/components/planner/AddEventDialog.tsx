
'use client';

import React, { useState } from 'react';
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
import { CalendarIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { type Event } from '@/lib/data';
import { format, setHours, setMinutes, startOfDay } from 'date-fns';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';

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

    const timeOptions = useMemo(() => {
        const options = [];
        for (let i = 0; i < 24; i++) {
            options.push(`${i.toString().padStart(2, '0')}:00`);
            options.push(`${i.toString().padStart(2, '0')}:30`);
        }
        return options;
    }, []);

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
            notes
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
                        <h3 className="text-lg font-medium">Notes</h3>
                        <Textarea rows={4} placeholder="Add any event-specific notes..." value={notes} onChange={(e) => setNotes(e.target.value)} />
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
