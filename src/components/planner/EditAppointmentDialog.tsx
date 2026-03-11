
'use client';

import React, { useState, useMemo, useEffect } from 'react';
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
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  CalendarIcon, 
  PlusCircle, 
  Trash2, 
  AlertTriangle, 
  ChevronLeft, 
  ChevronRight, 
  Briefcase, 
  User, 
  Lock, 
  Users, 
  Sparkles, 
  Clock, 
  Activity, 
  ArrowRight, 
  Check, 
  Tag, 
  List,
  ShoppingCart,
  MapPin,
  FlaskConical,
  CalendarCheck,
  Edit,
  Mail,
  Phone
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { type Client, type Service, type Appointment, type InventoryItem, type Staff } from '@/lib/data';
import { format, setHours, setMinutes, startOfDay, areIntervalsOverlapping, addMinutes, addDays, subWeeks, addWeeks, eachDayOfInterval, isSameDay, isBefore, isToday, parseISO, startOfWeek } from 'date-fns';
import { SelectAddOnsDialog } from '../services/SelectAddOnsDialog';
import { Card, CardContent } from '../ui/card';
import { useInventory } from '@/context/InventoryContext';
import { BrowseProductsDialog } from '../services/BrowseProductsDialog';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import { Switch } from '../ui/switch';
import { useToast } from '@/hooks/use-toast';
import { Separator } from '../ui/separator';
import { motion, AnimatePresence } from 'framer-motion';
import { formatPhoneNumber } from 'react-phone-number-input';

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

const timeStringToDate = (timeStr: string, date: Date): Date => {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    if (!timeStr) return d;
    const [time, period] = timeStr.split(' ');
    let [hours, minutes] = time.split(':').map(Number);
    if (period === 'PM' && hours < 12) hours += 12;
    if (period === 'AM' && hours === 12) hours = 0;
    d.setHours(hours, minutes);
    return d;
}

const SectionHeader = ({ icon: Icon, title }: { icon: any, title: string }) => (
    <div className="flex items-center gap-4 py-2">
        <div className="w-10 h-10 rounded-2xl bg-primary/10 flex items-center justify-center text-primary shadow-inner border border-primary/20 shrink-0">
            <Icon className="w-5 h-5" />
        </div>
        <div className="space-y-0.5 text-left">
            <p className="text-[9px] font-black uppercase tracking-widest text-primary/60">Module Edit</p>
            <h3 className="text-xl font-black uppercase tracking-tighter text-slate-900">{title}</h3>
        </div>
    </div>
);

type EditableFormulaItem = {
    id: string; // productId
    name: string;
    quantity: number;
    unit: string;
    costPerUnit: number;
};

const EditAppointmentForm = ({ 
    appointment,
    client, 
    services,
    onConfirm
}: { 
    appointment: Appointment;
    client: Client;
    services: Service[];
    onConfirm: (apt: Appointment) => void;
}) => {
    const { inventory, staff, appointments, events, scheduleProfiles } = useInventory();
    const publicScheduleProfile = useMemo(() => scheduleProfiles?.find((p: any) => p.isActive), [scheduleProfiles]);
    const { toast } = useToast();

    const [selectedServiceId, setSelectedServiceId] = useState<string>(appointment.serviceId);
    const [selectedStaffId, setSelectedStaffId] = useState<string>(appointment.staffId || '');
    const [date, setDate] = useState<Date>(safeDate(appointment.startTime));
    const [startTime, setStartTime] = useState<string>(format(safeDate(appointment.startTime), 'HH:mm'));
    const [selectedAddOns, setSelectedAddOns] = useState<Service[]>([]);
    const [isAddOnSelectorOpen, setIsAddOnSelectorOpen] = useState(false);
    const [isProductBrowserOpen, setIsProductBrowserOpen] = useState(false);
    const [notes, setNotes] = useState(appointment.notes || '');
    
    const [editableFormula, setEditableFormula] = useState<EditableFormulaItem[]>([]);
    const [isOverlapping, setIsOverlapping] = useState(false);
    const [clashingItem, setClashingItem] = useState<any | null>(null);
    const [showConfirmation, setShowConfirmation] = useState(false);
    
    const selectedService = useMemo(() => services.find(s => s.id === selectedServiceId), [services, selectedServiceId]);
    const selectedStaff = useMemo(() => staff.find(s => s.id === selectedStaffId), [staff, selectedStaffId]);

    useEffect(() => {
        const initialAddons = (appointment.addOnIds || [])
            .map(id => services.find(s => s.id === id))
            .filter((s): s is Service => !!s);
        setSelectedAddOns(initialAddons);

        const initialFormula = appointment.checkoutState?.formula || selectedService?.products?.map(p => ({
            id: p.id,
            name: p.name,
            quantity: p.quantityUsed,
            unit: p.unit || 'uses',
            costPerUnit: p.costPerUnit || 0,
        })) || [];
        setEditableFormula(initialFormula);
    }, [appointment, services, selectedService]);

    const weekStart = useMemo(() => startOfWeek(date, { weekStartsOn: 0 }), [date]);
    const weekDays = useMemo(() => eachDayOfInterval({ start: weekStart, end: addDays(weekStart, 6) }), [weekStart]);

    const timeSlots = useMemo(() => {
        if (!selectedService || !date || !publicScheduleProfile || !staff || !services) return [];
        const bookingInterval = publicScheduleProfile.bookingSlotInterval || 15;
        const dayName = format(date, 'eeee').toLowerCase();
        const selectedStaffMember = staff.find(s => s.id === selectedStaffId);
        let workingHours;
        const staffDaySchedule = selectedStaffMember?.availability?.week?.[dayName as keyof typeof selectedStaffMember.availability.week];
        if (staffDaySchedule?.enabled) workingHours = staffDaySchedule;
        else workingHours = publicScheduleProfile?.week?.[dayName];
        
        if (!workingHours || !workingHours.enabled) return [];
        const openT = timeStringToDate(workingHours.start, date);
        const closeT = timeStringToDate(workingHours.end, date);
        const busyIntervals: { start: Date, end: Date }[] = [];

        (appointments || []).filter(apt => {
            if (!isSameDay(safeDate(apt.startTime), date) || apt.id === appointment.id) return false;
            if (selectedStaffId && apt.staffId !== selectedStaffId) return false;
            return true;
        }).forEach(apt => {
            const svc = services.find(s => s.id === apt.serviceId);
            busyIntervals.push({ start: addMinutes(safeDate(apt.startTime), -(svc?.padBefore || 0)), end: addMinutes(safeDate(apt.endTime), (svc?.padAfter || 0)) });
        });

        (events || []).filter(evt => {
            if (!isSameDay(safeDate(evt.startTime), date) || evt.type !== 'blocked') return false;
            return !evt.staffIds || evt.staffIds.includes('all') || (selectedStaffId && evt.staffIds.includes(selectedStaffId));
        }).forEach(evt => { busyIntervals.push({ start: safeDate(evt.startTime), end: safeDate(evt.endTime) }); });

        const options: string[] = [];
        let currentTime = openT;
        const now = new Date();
        if (isToday(date) && now > openT) {
            const minSinceStart = (now.getHours() * 60) + now.getMinutes();
            const busStartMin = (openT.getHours() * 60) + openT.getMinutes();
            const skip = Math.ceil((minSinceStart - busStartMin) / bookingInterval);
            if (skip > 0) currentTime = addMinutes(openT, skip * bookingInterval);
        }
        
        while (currentTime < closeT) {
            const potentialStartTime = currentTime;
            const totalDuration = selectedService.duration + (selectedService.padBefore || 0) + (selectedService.padAfter || 0);
            const potentialEndTime = addMinutes(potentialStartTime, totalDuration);
            if (potentialEndTime > closeT) break;
            const isOverlapping = busyIntervals.some((interval) => areIntervalsOverlapping({ start: currentTime, end: potentialEndTime }, interval, { inclusive: false }));
            if (!isOverlapping) options.push(format(currentTime, 'HH:mm'));
            currentTime = addMinutes(currentTime, bookingInterval);
        }
        
        const originalTimeFormatted = format(safeDate(appointment.startTime), 'HH:mm');
        if (isSameDay(date, safeDate(appointment.startTime)) && !options.includes(originalTimeFormatted)) {
            options.push(originalTimeFormatted);
            options.sort();
        }

        return options;
    }, [date, selectedStaffId, selectedService, staff, appointments, events, publicScheduleProfile, services, appointment]);

    useEffect(() => {
        if (!selectedService || !date || !startTime || !services || !appointments) {
            setIsOverlapping(false);
            setClashingItem(null);
            return;
        }
        const [hours, minutes] = startTime.split(':').map(Number);
        const startDateTime = setMinutes(setHours(startOfDay(date), hours), minutes);
        const totalDuration = selectedService.duration + (selectedService.padBefore || 0) + (selectedService.padAfter || 0);
        const endDateTime = addMinutes(startDateTime, totalDuration);
        const newInterval = { start: startDateTime, end: endDateTime };

        const clashApt = appointments.find(apt => {
            if (apt.id === appointment.id) return false;
            if (selectedStaffId && apt.staffId !== selectedStaffId) return false;
            return areIntervalsOverlapping(newInterval, { start: safeDate(apt.startTime), end: safeDate(apt.endTime) }, { inclusive: false });
        });

        if (clashApt) {
            setIsOverlapping(true);
            const svc = services.find(s => s.id === clashApt.serviceId);
            setClashingItem({ type: 'appointment', details: `'${svc?.name || 'Service'}' for ${clashApt.clientName || 'Client'}`, time: `${format(safeDate(clashApt.startTime), 'h:mm a')} - ${format(safeDate(clashApt.endTime), 'h:mm a')}` });
            return;
        }

        const clashEvt = events.find(evt => {
            if (evt.type !== 'blocked') return false;
            if (evt.staffIds && !evt.staffIds.includes('all') && selectedStaffId && !evt.staffIds.includes(selectedStaffId)) return false;
            return areIntervalsOverlapping(newInterval, { start: safeDate(evt.startTime), end: safeDate(evt.endTime) }, { inclusive: false });
        });

        if (clashEvt) {
            setIsOverlapping(true);
            setClashingItem({ type: 'event', details: `'${clashEvt.title}' event`, time: `${format(safeDate(clashEvt.startTime), 'h:mm a')} - ${format(safeDate(clashEvt.endTime), 'h:mm a')}` });
            return;
        }
        setIsOverlapping(false);
        setClashingItem(null);
    }, [date, startTime, selectedService, appointments, services, appointment, events, selectedStaffId]);

    const handleLocalSubmit = (e: React.FormEvent) => {
        if (e && e.preventDefault) e.preventDefault();
        if (!selectedService || !date || !startTime) return;
        const [hours, minutes] = startTime.split(':').map(Number);
        const startDateTime = setMinutes(setHours(startOfDay(date), hours), minutes);
        const endDateTime = addMinutes(startDateTime, selectedService.duration);

        const allServicesInApt = [selectedService, ...selectedAddOns];
        const allRequiredResourceIds = [...new Set(allServicesInApt.flatMap(s => s.requiredResourceIds || []))];

        const updatedAppointment: Appointment = {
            ...appointment,
            serviceId: selectedServiceId,
            staffId: selectedStaffId,
            startTime: startDateTime.toISOString(),
            endTime: endDateTime.toISOString(),
            addOnIds: selectedAddOns.map(s => s.id),
            requiredResourceIds: allRequiredResourceIds,
            notes,
        };
        
        onConfirm(updatedAppointment);
    }
    
    const handleAddProduct = (products: InventoryItem[]) => {
      const newItems: EditableFormulaItem[] = products.map(p => ({
        id: p.id,
        name: p.name,
        quantity: 1, 
        unit: p.costingMethod === 'uses' ? (p.useUnit || 'uses') : (p.unit || 'unit'),
        costPerUnit: p.costPerUnit || 0
      }));
      setEditableFormula(prev => [...prev, ...newItems.filter(newItem => !prev.find(item => item.id === newItem.id))]);
      setIsProductBrowserOpen(false);
    };

    return (
        <div id="edit-appointment-form-container">
            <form id="edit-appointment-form" onSubmit={handleLocalSubmit} className="space-y-10 py-4">
                <div className="space-y-6">
                    <SectionHeader icon={User} title="Engagement" />
                    <Card className="border-4 border-primary/10 bg-primary/[0.02] rounded-[2rem] shadow-xl shadow-primary/5 overflow-hidden">
                        <CardContent className="p-6 flex items-center gap-6 text-left">
                            <Avatar className="w-16 h-16 md:w-20 md:h-20 border-4 border-background shadow-xl rounded-3xl shrink-0">
                                <AvatarImage src={client.avatarUrl} className="object-cover" />
                                <AvatarFallback className="font-black bg-primary/10 text-primary">{(client.name || 'G').substring(0, 2).toUpperCase()}</AvatarFallback>
                            </Avatar>
                            <div className="min-w-0 flex-1">
                                <p className="font-black text-xl md:text-2xl uppercase tracking-tighter text-slate-900 leading-none truncate">{client.name}</p>
                                <div className="flex flex-col gap-1 mt-2">
                                    <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest truncate flex items-center gap-2">
                                        <Mail className="w-3 h-3 opacity-40" />
                                        {client.email || 'No email on record'}
                                    </p>
                                    {client.phone && (
                                        <p className="text-[10px] font-black text-muted-foreground uppercase tracking-widest truncate flex items-center gap-2">
                                            <Phone className="w-3 h-3 opacity-40" />
                                            {formatPhoneNumber(client.phone)}
                                        </p>
                                    )}
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-3 text-left">
                            <Label htmlFor="service-edit" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Treatment Menu</Label>
                            <Select value={selectedServiceId} onValueChange={setSelectedServiceId}>
                                <SelectTrigger id="service-edit" className="h-14 rounded-2xl border-2 shadow-inner bg-muted/5 font-bold uppercase text-xs tracking-tight">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent className="rounded-xl border-2 shadow-2xl">
                                    {services.filter(s => s.type === 'service').map(s => <SelectItem key={s.id} value={s.id} className="font-bold uppercase text-[10px] tracking-widest">{s.name}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-3 text-left">
                            <Label htmlFor="staff-edit" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Assigned Professional</Label>
                            <Select value={selectedStaffId} onValueChange={setSelectedStaffId}>
                                <SelectTrigger id="staff-edit" className="h-14 rounded-2xl border-2 shadow-inner bg-muted/5 font-bold">
                                    {selectedStaff ? (
                                        <div className="flex items-center gap-3">
                                            <Avatar className="h-7 w-7 border shadow-sm rounded-xl">
                                                <AvatarImage src={selectedStaff.avatarUrl} className="object-cover" />
                                                <AvatarFallback className="font-black text-[9px]">{(selectedStaff.name || 'S').charAt(0)}</AvatarFallback>
                                            </Avatar>
                                            <span className="font-bold uppercase tracking-tight text-xs">{selectedStaff.name}</span>
                                        </div>
                                    ) : <SelectValue placeholder="Select Pro" />}
                                </SelectTrigger>
                                <SelectContent className="rounded-xl border-2 shadow-2xl">
                                    {staff.map(s => (
                                        <SelectItem key={s.id} value={s.id} className="rounded-xl">
                                            <div className="flex items-center gap-3 py-1">
                                                <Avatar className="h-8 w-8 border shadow-sm rounded-xl">
                                                    <AvatarImage src={s.avatarUrl} className="object-cover" />
                                                    <AvatarFallback className="font-black text-[9px] bg-primary/10 text-primary">{(s.name || 'S').charAt(0)}</AvatarFallback>
                                                </Avatar>
                                                <span className="font-bold uppercase tracking-tight text-xs">{s.name}</span>
                                            </div>
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                </div>

                <Separator className="border-dashed" />

                <div className="space-y-8">
                    <div className="flex items-center justify-between px-1">
                        <SectionHeader icon={FlaskConical} title="Product Formula" />
                        <Button variant="ghost" size="sm" onClick={() => setIsProductBrowserOpen(true)} type="button" className="h-7 px-3 text-[9px] font-black uppercase tracking-widest text-primary border border-primary/20 rounded-lg hover:bg-primary/5 shadow-sm">
                            <PlusCircle className="w-3 h-3 mr-1.5" /> Append Inventory
                        </Button>
                    </div>
                    <div className="space-y-3">
                        {editableFormula.length > 0 ? (
                            <div className="grid gap-2">
                                {editableFormula.map(item => (
                                    <div key={item.id} className="flex items-center justify-between p-4 rounded-2xl border-2 bg-white shadow-sm gap-4 group">
                                        <span className="text-[11px] font-black uppercase tracking-tight text-slate-900 truncate flex-1">{item.name}</span>
                                        <div className="flex items-center gap-3">
                                            <div className="flex items-center gap-2">
                                                <Label className="text-[8px] font-black uppercase text-muted-foreground opacity-40">Load</Label>
                                                <Input 
                                                    type="number" 
                                                    value={item.quantity} 
                                                    onChange={(e) => {
                                                        const newQty = parseFloat(e.target.value) || 0;
                                                        setEditableFormula(prev => prev.map(p => p.id === item.id ? {...p, quantity: newQty} : p))
                                                    }}
                                                    className="w-16 h-9 rounded-lg border-2 text-center font-black font-mono" 
                                                    step="0.1" 
                                                />
                                                <span className="text-[9px] font-black uppercase text-muted-foreground w-10 opacity-60 truncate">{item.unit}</span>
                                            </div>
                                            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive opacity-0 group-hover:opacity-100 transition-opacity" onClick={() => setEditableFormula(prev => prev.filter(p => p.id !== item.id))}><Trash2 className="w-4 h-4" /></Button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="p-12 text-center border-4 border-dashed rounded-[2.5rem] opacity-30 flex flex-col items-center gap-4">
                                <Activity className="w-12 h-12" />
                                <p className="text-[10px] font-black uppercase tracking-widest">No Products in Formula</p>
                            </div>
                        )}
                    </div>
                </div>

                <Separator className="border-dashed" />

                <div className="space-y-8">
                    <SectionHeader icon={CalendarCheck} title="Timing" />
                    <div className="space-y-3 text-left">
                        <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Schedule Picker</Label>
                        <div className="rounded-[2.5rem] border-2 bg-muted/10 p-4 md:p-6 space-y-8 shadow-inner">
                            <div className="flex justify-between items-center px-2">
                                <Button variant="outline" size="icon" onClick={() => setDate(prev => addDays(prev, -7))} type="button" className="h-8 w-8 md:h-10 md:w-10 rounded-full bg-background shadow-md border-none"><ChevronLeft className="w-4 h-4 md:w-5 md:h-5" /></Button>
                                <span className="font-black uppercase tracking-widest text-xs md:text-sm">{format(date, 'MMMM yyyy')}</span>
                                <Button variant="outline" size="icon" onClick={() => setDate(prev => addDays(prev, 7))} type="button" className="h-8 w-8 md:h-10 md:w-10 rounded-full bg-background shadow-md border-none"><ChevronRight className="w-4 h-4 md:w-5 md:h-5" /></Button>
                            </div>
                            <div className="grid grid-cols-7 gap-1.5 md:gap-3">
                                {weekDays.map(day => (
                                    <button 
                                        key={day.toISOString()} 
                                        onClick={() => setDate(day)} 
                                        disabled={isBefore(day, startOfDay(new Date())) && !isToday(day)} 
                                        className={cn(
                                            "flex flex-col items-center justify-center p-2 md:p-3 rounded-xl md:rounded-2xl border-2 transition-all aspect-square", 
                                            isSameDay(day, date) ? "bg-primary text-primary-foreground border-primary shadow-2xl scale-110" : "bg-background border-transparent hover:border-primary/30", 
                                            (isBefore(day, startOfDay(new Date())) && !isToday(day)) && "opacity-20 cursor-not-allowed"
                                        )} 
                                        type="button"
                                    >
                                        <span className="text-[8px] md:text-[10px] uppercase font-black opacity-60 mb-0.5 md:mb-1">{format(day, 'EEE')}</span>
                                        <span className="font-black text-sm md:text-xl tracking-tighter">{format(day, 'd')}</span>
                                    </button>
                                ))}
                            </div>
                            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 md:gap-3 pt-6 md:pt-8 border-t-2 border-dashed border-white/50">
                                {timeSlots.map(time => (
                                    <Button 
                                        key={time} 
                                        variant={startTime === time ? 'default' : 'outline'} 
                                        onClick={() => setStartTime(time)} 
                                        type="button"
                                        className={cn(
                                            "h-10 md:h-14 font-black uppercase text-[10px] md:text-xs tracking-widest rounded-xl md:rounded-2xl border-2 transition-all", 
                                            startTime === time ? "shadow-2xl shadow-primary/20 scale-105" : "bg-background"
                                        )}
                                    >
                                        {format(timeStringToDate(time, new Date()), 'h:mm a')}
                                    </Button>
                                ))}
                                {timeSlots.length === 0 && (<div className="col-span-full text-center text-[10px] font-black uppercase tracking-widest text-muted-foreground/40 py-10 md:py-12 border-2 border-dashed rounded-[2rem]">No Availability</div>)}
                            </div>
                        </div>
                    </div>
                    {isOverlapping && (
                        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
                            <Alert variant="destructive" className="border-4 border-destructive bg-destructive/5 rounded-[2rem] p-6 shadow-2xl">
                                <AlertTriangle className="h-6 w-6 text-destructive" />
                                <AlertTitle className="text-sm font-black uppercase tracking-tighter mb-2">Clash Warning</AlertTitle>
                                <AlertDescription className="space-y-3 pt-1">
                                    <p className="text-xs font-bold leading-relaxed opacity-80 uppercase">This modification overlaps with an existing agenda item.</p>
                                    {clashingItem && (
                                        <div className="pt-3 mt-3 border-t border-destructive/20">
                                            <p className="font-black text-xs uppercase tracking-tight">{clashingItem.details}</p>
                                            <p className="text-[10px] font-black opacity-60 mt-1 uppercase tracking-widest">{clashingItem.time}</p>
                                        </div>
                                    )}
                                </AlertDescription>
                            </Alert>
                        </motion.div>
                    )}
                </div>

                <div className="space-y-4 pt-6 border-t border-dashed text-left">
                    <Label htmlFor="notes-edit" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Session Protocol Notes</Label>
                    <Textarea id="notes-edit" value={notes} onChange={e => setNotes(e.target.value)} rows={4} placeholder="Specific strategic notes for this session..." className="rounded-2xl border-2 bg-muted/5 focus-visible:ring-primary/20 font-medium" />
                </div>
            </form>

            <BrowseProductsDialog
                open={isProductBrowserOpen}
                onOpenChange={setIsProductBrowserOpen}
                onSelect={handleAddProduct}
                allProducts={inventory.filter(i => i.type === 'professional')}
                initialSelected={[]}
            />
            <SelectAddOnsDialog
                open={isAddOnSelectorOpen}
                onOpenChange={setIsAddOnSelectorOpen}
                onSelect={setSelectedAddOns}
                allAddOns={services.filter(s => s.type === 'addon')}
                initialSelected={selectedAddOns}
            />
            <AlertDialog open={showConfirmation} onOpenChange={setShowConfirmation}>
                <AlertDialogContent className="rounded-[3rem] border-4 shadow-3xl">
                    <AlertDialogHeader className="p-6 pb-0 text-center sm:text-left">
                        <AlertDialogTitle className="font-black uppercase tracking-tighter text-xl md:text-2xl">Confirm Logic Violation</AlertDialogTitle>
                        <AlertDialogDescription className="font-bold text-sm text-slate-600 leading-relaxed uppercase text-left">
                            This modification results in a conflict with {clashingItem?.details || 'an existing item'}. Force this record update?
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter className="p-6 pt-4 flex flex-col gap-3">
                        <Button onClick={() => { handleLocalSubmit({} as any); setShowConfirmation(false); }} className="w-full h-16 rounded-2xl font-black uppercase tracking-widest shadow-2xl shadow-primary/30">Acknowledge & Force</Button>
                        <AlertDialogCancel onClick={() => setShowConfirmation(false)} className="w-full h-12 rounded-xl font-bold uppercase text-[9px] md:text-[10px] tracking-widest border-none">Cancel</AlertDialogCancel>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    )
}

export const EditAppointmentDialog = ({ open, onOpenChange, appointment, clients, services, onConfirm }: { open: boolean, onOpenChange: (open: boolean) => void, appointment: Appointment, clients: Client[], services: Service[], appointments: Appointment[], onConfirm: (apt: Appointment) => void }) => {
  const isMobile = useIsMobile();
  const client = clients.find(c => c.id === appointment.clientId);

  if (!client) return null;

  const dialogTitle = "Edit Record";
  const dialogDescription = "Modify the detail and logic for this session.";
  
  const FormContent = <EditAppointmentForm appointment={appointment} client={client} services={services} onConfirm={(apt) => { onConfirm(apt); onOpenChange(false); }} />;

  const DialogContainer = isMobile ? Sheet : Dialog;
  const ContentComponent = isMobile ? SheetContent : DialogContent;

  return (
    <DialogContainer open={open} onOpenChange={onOpenChange}>
      <ContentComponent side={isMobile ? "bottom" : "right"} className={cn("p-0 border-none bg-background flex flex-col shadow-3xl overflow-hidden", isMobile ? "h-[92dvh] rounded-t-[2.5rem]" : "sm:max-w-2xl max-h-[90dvh]")}>
         <DialogHeader className={cn("flex-shrink-0 text-left border-b bg-muted/5", isMobile ? "p-8 pb-6" : "p-8 pb-6")}>
            <div className="flex items-center gap-3 mb-2">
                <Sparkles className="w-5 h-5 text-primary" />
                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground">Strategic Refinement</span>
            </div>
            <DialogTitle className="text-3xl font-black uppercase tracking-tighter text-slate-900 leading-none">{dialogTitle}</DialogTitle>
            <DialogDescription className="text-xs font-bold uppercase tracking-widest opacity-60 mt-1">{dialogDescription}</DialogDescription>
        </DialogHeader>
        <ScrollArea className="flex-1">
            <div className="px-8 pb-32">
                {FormContent}
            </div>
        </ScrollArea>
        <DialogFooter className="p-8 pt-4 border-t bg-background flex-shrink-0 shadow-2xl">
          <div className="flex w-full gap-4">
            <Button variant="ghost" onClick={() => onOpenChange(false)} className="h-12 font-black uppercase tracking-tighter text-[10px] text-slate-400">Cancel</Button>
            <Button onClick={() => {
                const form = document.getElementById('edit-appointment-form') as HTMLFormElement;
                if (form) form.dispatchEvent(new globalThis.Event('submit', { cancelable: true, bubbles: true }));
            }} className="flex-[2.5] h-12 font-black uppercase tracking-widest text-[10px] rounded-[2rem] shadow-2xl shadow-primary/30">Commit Refinements</Button>
          </div>
        </DialogFooter>
      </ContentComponent>
    </DialogContainer>
  );
};
