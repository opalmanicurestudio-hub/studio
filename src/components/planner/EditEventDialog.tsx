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
import { CalendarIcon, PlusCircle, Trash2, DollarSign, Users, Briefcase, User, Lock, Check, Sparkles, ArrowRight, ChevronLeft, ChevronRight, Edit } from 'lucide-react';
import { cn } from '@/lib/utils';
import { type Event, type EventChecklistItem, type Staff } from '@/lib/data';
import { format, setHours, setMinutes, startOfDay, parse } from 'date-fns';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Checkbox } from '../ui/checkbox';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import { useTenant } from '@/context/TenantContext';
import { useInventory } from '@/context/InventoryContext';

const EditEventForm = ({
    event,
    onConfirm,
    staff,
}: {
    event: Event;
    onConfirm: (event: Event) => void;
    staff: Staff[];
}) => {
    const { role, user } = useTenant();
    const [title, setTitle] = useState(event.title);
    const [type, setType] = useState(event.type);
    const [date, setDate] = useState(new Date(event.startTime));
    const [startTime, setStartTime] = useState(format(new Date(event.startTime), 'HH:mm'));
    const [endTime, setEndTime] = useState(format(new Date(event.endTime), 'HH:mm'));
    const [notes, setNotes] = useState(event.notes || '');
    const [location, setLocation] = useState(event.location || '');
    const [checklist, setChecklist] = useState<EventChecklistItem[]>(event.checklist || []);
    const [newChecklistItem, setNewChecklistItem] = useState('');
    const [selectedStaffIds, setSelectedStaffIds] = useState<string[]>(event.staffIds || []);

    const staffToDisplay = useMemo(() => (role === 'owner' || role === 'admin' ? staff : staff.filter(s => s.id === user?.uid)), [staff, role, user]);

    useEffect(() => {
        setTitle(event.title);
        setType(event.type);
        setDate(new Date(event.startTime));
        setStartTime(format(new Date(event.startTime), 'HH:mm'));
        setEndTime(format(new Date(event.endTime), 'HH:mm'));
        setNotes(event.notes || '');
        setLocation(event.location || '');
        setChecklist(event.checklist || []);
        setSelectedStaffIds(event.staffIds || []);
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
            staffIds: selectedStaffIds,
        };
        onConfirm(updatedEvent);
    }
    
    return (
        <form id="edit-event-form" onSubmit={(e) => { e.preventDefault(); handleSubmit(); }}>
            <div className="space-y-6">
                <div className="space-y-4 text-left">
                    <h3 className="text-lg font-black uppercase tracking-tight flex items-center gap-3">
                        <Briefcase className="w-6 h-6 text-primary" />
                        Event Details
                    </h3>
                    <div className="space-y-2">
                        <Label htmlFor="title-edit" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Title</Label>
                        <Input id="title-edit" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g., Team Lunch" className="h-14 rounded-2xl border-2 font-bold text-lg" />
                    </div>
                    <div className="space-y-2">
                            <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Type</Label>
                        <RadioGroup value={type} onValueChange={(v: any) => setType(v)} className="grid grid-cols-3 gap-2">
                            <div>
                                <RadioGroupItem value="business" id="business-edit" className="peer sr-only" />
                                <Label htmlFor="business-edit" className="flex flex-col items-center justify-center rounded-2xl border-2 border-muted bg-popover p-4 text-xs font-black uppercase tracking-widest hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/5 peer-data-[state=checked]:text-primary transition-all cursor-pointer h-full">
                                    <Briefcase className="w-5 h-5 mb-2 opacity-40"/>
                                    Business
                                </Label>
                            </div>
                            <div>
                                <RadioGroupItem value="personal" id="personal-edit" className="peer sr-only" />
                                <Label htmlFor="personal-edit" className="flex flex-col items-center justify-center rounded-2xl border-2 border-muted bg-popover p-4 text-xs font-black uppercase tracking-widest hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/5 peer-data-[state=checked]:text-primary transition-all cursor-pointer h-full">
                                    <User className="w-5 h-5 mb-2 opacity-40"/>
                                    Personal
                                </Label>
                            </div>
                                <div>
                                <RadioGroupItem value="blocked" id="blocked-edit" className="peer sr-only" />
                                <Label htmlFor="blocked-edit" className="flex flex-col items-center justify-center rounded-2xl border-2 border-muted bg-popover p-4 text-xs font-black uppercase tracking-widest hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/5 peer-data-[state=checked]:text-primary transition-all cursor-pointer h-full">
                                    <Lock className="w-5 h-5 mb-2 opacity-40"/>
                                    Blocked
                                </Label>
                            </div>
                        </RadioGroup>
                    </div>
                    <div className="space-y-4 pt-4">
                        <div className="flex items-center justify-between">
                            <Label className="text-sm font-black uppercase tracking-tight flex items-center gap-3">
                                <Users className="w-4 h-4 text-primary" />
                                Assigned Team
                            </Label>
                            {(role === 'owner' || role === 'admin') && (
                                <Button variant="ghost" size="sm" onClick={toggleSelectAllStaff} className="h-auto p-0 text-[10px] font-black uppercase tracking-widest text-primary underline">
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
                                        id={`staff-chk-edit-${s.id}`} 
                                        checked={selectedStaffIds.includes(s.id)}
                                        onCheckedChange={() => toggleStaffSelection(s.id)}
                                        className="h-5 w-5"
                                    />
                                    <Avatar className="h-8 w-8 border shadow-sm">
                                        <AvatarImage src={s.avatarUrl} className="object-cover" />
                                        <AvatarFallback className="font-black text-xs bg-primary/10 text-primary">{s.name.charAt(0)}</AvatarFallback>
                                    </Avatar>
                                    <span className="text-[11px] font-black uppercase tracking-tight truncate">{s.name}</span>
                                </label>
                            ))}
                        </div>
                    </div>
                </div>

                <div className="space-y-4 pt-6 border-t border-dashed text-left">
                    <h3 className="text-lg font-black uppercase tracking-tight flex items-center gap-3">
                        <CalendarIcon className="w-6 h-6 text-primary" />
                        Timing
                    </h3>
                    <div className="space-y-2">
                        <Label htmlFor="event-date-edit" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Date</Label>
                        <Popover>
                            <PopoverTrigger asChild>
                                <Button
                                    variant={"outline"}
                                    className={cn(
                                    "w-full h-14 rounded-2xl border-2 font-black text-lg justify-start text-left",
                                    !date && "text-muted-foreground"
                                    )}
                                >
                                    <span className="flex items-center">
                                        <CalendarIcon className="mr-2 h-4 w-4" />
                                        {date ? format(date, 'PPP') : "Pick a date"}
                                    </span>
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0 rounded-3xl overflow-hidden border-2 shadow-2xl">
                                <Calendar
                                    mode="single"
                                    selected={date}
                                    onSelect={(d) => setDate(d || new Date())}
                                    initialFocus
                                />
                            </PopoverContent>
                        </Popover>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                        <div className="space-y-2">
                            <Label htmlFor="start-time-edit" className="text-[10px] font-black uppercase text-muted-foreground ml-1">Start Time</Label>
                            <Select onValueChange={setStartTime} value={startTime}>
                                <SelectTrigger id="start-time-edit" className="h-14 rounded-2xl border-2 font-black text-lg">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {timeOptions.map(time => (
                                        <SelectItem key={`start-${time}`} value={time} className="font-bold">{format(parse(`1970-01-01T${time}:00`, "yyyy-MM-dd'T'HH:mm:ss", new Date()), 'h:mm a')}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="end-time-edit" className="text-[10px] font-black uppercase text-muted-foreground ml-1">End Time</Label>
                            <Select onValueChange={setEndTime} value={endTime}>
                                <SelectTrigger id="end-time-edit" className="h-14 rounded-2xl border-2 font-black text-lg">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {timeOptions.map(time => (
                                        <SelectItem key={`end-${time}`} value={time} className="font-bold">{format(parse(`1970-01-01T${time}:00`, "yyyy-MM-dd'T'HH:mm:ss", new Date()), 'h:mm a')}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                </div>

                    <div className="space-y-6 pt-6 border-t border-dashed text-left">
                    <h3 className="text-lg font-black uppercase tracking-tight flex items-center gap-3">
                        <PlusCircle className="w-6 h-6 text-primary" />
                        Engagement
                    </h3>
                        <div className="space-y-2">
                        <Label htmlFor="location-edit" className="text-[10px] font-black uppercase text-muted-foreground ml-1">Location</Label>
                        <Input id="location-edit" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g., Main Studio or 'Zoom'" className="h-12 rounded-2xl border-2 font-bold" />
                    </div>
                    
                    <div className="space-y-3">
                        <Label className="text-[10px] font-black uppercase text-muted-foreground ml-1">Action Items Checklist</Label>
                        <div className='space-y-2'>
                            {checklist.map((item) => (
                                <div key={item.id} className="flex items-center gap-3 p-3 bg-muted/20 rounded-2xl border-2 border-transparent hover:border-primary/10 transition-all group">
                                    <Checkbox id={`check-edit-${item.id}`} checked={item.completed} disabled className="h-5 w-5" />
                                    <p className="flex-1 text-sm font-bold uppercase tracking-tight text-slate-700">{item.text}</p>
                                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive opacity-0 group-hover:opacity-100 transition-opacity" onClick={() => removeChecklistItem(item.id)}><Trash2 className="w-4 h-4"/></Button>
                                </div>
                            ))}
                        </div>
                        <div className="flex gap-2">
                            <Input 
                                placeholder="Add sub-task..."
                                value={newChecklistItem}
                                onChange={(e) => setNewChecklistItem(e.target.value)}
                                onKeyDown={handleChecklistKeyDown}
                                className="h-12 rounded-2xl border-2 font-bold"
                            />
                            <Button type="button" variant="outline" onClick={handleAddChecklistItem} className="h-12 w-12 rounded-2xl border-2"><PlusCircle className="h-5 w-5"/></Button>
                        </div>
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="notes-edit" className="text-[10px] font-black uppercase text-muted-foreground ml-1">Notes & Context</Label>
                        <Textarea id="notes-edit" rows={4} placeholder="Strategic objectives or personal reminders..." value={notes} onChange={(e) => setNotes(e.target.value)} className="rounded-2xl border-2 bg-muted/5 focus-visible:ring-primary/20" />
                    </div>
                </div>
            </div>
        </form>
    )
}

export const EditEventDialog = ({ open, onOpenChange, event, onConfirm }: { open: boolean, onOpenChange: (open: boolean) => void, event: Event, onConfirm: (event: Event) => void }) => {
  const isMobile = useIsMobile();
  const { staff } = useInventory();

  const title = "Edit Event";
  const description = "Update the details for this event.";
  
  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" className="h-[95vh] flex flex-col p-0 rounded-t-[3rem] overflow-hidden bg-background">
          <SheetHeader className="text-left p-6 border-b bg-muted/5 flex-shrink-0">
            <div className="flex items-center gap-3 mb-1.5">
                <Sparkles className="w-4 h-4 text-primary" />
                <span className="text-[9px] font-black uppercase tracking-[0.2em] text-muted-foreground opacity-60">Strategic Refinement</span>
            </div>
            <SheetTitle className="text-2xl font-black uppercase tracking-tighter text-slate-900 leading-none">{title}</SheetTitle>
            <SheetDescription className="text-[10px] font-bold uppercase tracking-widest opacity-60 mt-1">{description}</SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto">
            <div className="p-6">
                <EditEventForm event={event} onConfirm={(evt) => { onConfirm(evt); onOpenChange(false); }} staff={staff || []} />
            </div>
          </div>
          <SheetFooter className="p-6 pt-4 border-t bg-background flex-shrink-0 shadow-2xl">
            <div className="flex w-full gap-3">
                <Button variant="ghost" onClick={() => onOpenChange(false)} className="h-14 font-black uppercase tracking-tighter text-xs text-slate-400 flex-1">Cancel</Button>
                <Button type="submit" form="edit-event-form" className="h-14 font-black uppercase tracking-widest shadow-xl shadow-primary/20 rounded-2xl flex-[2]">Save Changes</Button>
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
                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground opacity-60">Strategic Refinement</span>
            </div>
            <DialogTitle className="text-3xl font-black uppercase tracking-tighter text-slate-900 leading-none">{title}</DialogTitle>
            <DialogDescription className="text-xs font-bold uppercase tracking-widest opacity-60 mt-1">{description}</DialogDescription>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto">
            <div className="px-8 py-8">
                <EditEventForm event={event} onConfirm={(evt) => { onConfirm(evt); onOpenChange(false); }} staff={staff || []} />
            </div>
        </div>
        <DialogFooter className="p-8 pt-4 border-t bg-background flex-shrink-0">
          <Button variant="ghost" onClick={() => onOpenChange(false)} className="h-14 px-8 rounded-2xl font-black uppercase tracking-widest text-xs text-slate-400">Cancel</Button>
          <Button onClick={() => {
              const form = document.getElementById('edit-event-form') as HTMLFormElement;
              if (form) form.dispatchEvent(new globalThis.Event('submit', { cancelable: true, bubbles: true }));
          }} className="h-14 px-12 rounded-2xl font-black uppercase tracking-widest shadow-2xl shadow-primary/20 active:scale-95 transition-all group">Commit Changes <ArrowRight className="ml-2 w-4 h-4 transition-transform group-hover:translate-x-1"/></Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};