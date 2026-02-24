

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
  DialogTrigger
} from '@/components/ui/dialog';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
  SheetTrigger,
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
import { Button, buttonVariants } from '@/components/ui/button';
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
import { CalendarIcon, PlusCircle, Trash2, AlertTriangle, ChevronLeft, ChevronRight, Briefcase, User, Lock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Client, Service, Appointment, InventoryItem } from '@/lib/data';
import { format, setHours, setMinutes, startOfDay, areIntervalsOverlapping, addMinutes } from 'date-fns';
import { SelectAddOnsDialog } from '../services/SelectAddOnsDialog';
import { Card, CardContent } from '../ui/card';
import { useInventory } from '@/context/InventoryContext';
import { BrowseProductsDialog } from '../services/BrowseProductsDialog';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import { Switch } from '../ui/switch';
import { useToast } from '@/hooks/use-toast';

const DatePicker = ({ date, onDateChange }: { date: Date, onDateChange: (date: Date) => void }) => {
    const isMobile = useIsMobile();
    const [isOpen, setIsOpen] = useState(false);

    const handleSelect = (selectedDate: Date | undefined) => {
        if (selectedDate) {
            onDateChange(selectedDate);
            setIsOpen(false);
        }
    }
    
    const TriggerContent = (
        <span className="flex items-center">
            <CalendarIcon className="mr-2 h-4 w-4" />
            {date ? format(date, 'PPP') : "Pick a date"}
        </span>
    );
    
    const CalendarComponent = (
        <Calendar
            mode="single"
            selected={date}
            onSelect={handleSelect}
            initialFocus
            classNames={{
                caption_label: "text-base font-medium",
                day: "h-10 w-10",
                day_selected: "rounded-md",
                day_today: "rounded-md",
            }}
        />
    );

    if (isMobile) {
        return (
            <>
                <Button
                    variant="outline"
                    className={cn("w-full justify-start text-left font-normal h-12", !date && "text-muted-foreground")}
                     onClick={() => setIsOpen(true)}
                >
                    {TriggerContent}
                </Button>
                 <Sheet open={isOpen} onOpenChange={setIsOpen}>
                    <SheetContent side="bottom">
                         <SheetHeader className="text-left">
                            <SheetTitle>Select Date</SheetTitle>
                        </SheetHeader>
                        <div className="flex justify-center py-4">
                            {CalendarComponent}
                        </div>
                    </SheetContent>
                </Sheet>
            </>
        )
    }

    return (
        <Popover open={isOpen} onOpenChange={setIsOpen}>
            <PopoverTrigger
                className={cn(
                    buttonVariants({ variant: "outline" }),
                    "w-full justify-start text-left font-normal h-12",
                    !date && "text-muted-foreground"
                )}
            >
                {TriggerContent}
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0">
                {CalendarComponent}
            </PopoverContent>
        </Popover>
    );
};

type EditableFormulaItem = {
    id: string; // productId
    name: string;
    quantity: number;
    unit: string;
};


const EditAppointmentForm = ({ 
    appointment,
    client, 
    service,
    appointments,
    services,
    onConfirm
}: { 
    appointment: Appointment;
    client: Client;
    service: Service;
    appointments: Appointment[];
    services: Service[];
    onConfirm: (apt: Appointment) => void;
}) => {
    const { inventory } = useInventory();

    const [selectedClientId, setSelectedClientId] = useState<string>(appointment.clientId);
    const [selectedServiceId, setSelectedServiceId] = useState<string>(appointment.serviceId);
    const [date, setDate] = useState<Date>(appointment.startTime);
    const [startTime, setStartTime] = useState<string>(format(appointment.startTime, 'HH:mm'));
    const [selectedAddOns, setSelectedAddOns] = useState<Service[]>([]);
    const [isAddOnSelectorOpen, setIsAddOnSelectorOpen] = useState(false);
    const [isProductBrowserOpen, setIsProductBrowserOpen] = useState(false);
    
    const [editableFormula, setEditableFormula] = useState<EditableFormulaItem[]>([]);
    
    const selectedService = useMemo(() => services.find(s => s.id === selectedServiceId), [services, selectedServiceId]);

    useEffect(() => {
        setSelectedClientId(appointment.clientId);
        setSelectedServiceId(appointment.serviceId);
        setDate(appointment.startTime);
        setStartTime(format(appointment.startTime, 'HH:mm'));

        const initialAddons = (appointment.addOnIds || [])
            .map(id => services.find(s => s.id === id))
            .filter((s): s is Service => !!s);
        setSelectedAddOns(initialAddons);

        const currentService = services.find(s => s.id === appointment.serviceId);
        const formula = currentService?.products?.map(p => ({
            id: p.id,
            name: p.name,
            quantity: p.quantityUsed,
            unit: p.unit || 'uses',
        })) || [];
        setEditableFormula(formula);

    }, [appointment, services]);

    const timeOptions = useMemo(() => {
        const options = [];
        if (!selectedService || !date) return [];

        const dayStart = setHours(startOfDay(date), 0);
        const dayEnd = setHours(startOfDay(date), 24);
        
        const existingAppointmentsOnDate = appointments.filter(
            apt => apt.id !== appointment.id && format(apt.startTime, 'yyyy-MM-dd') === format(date, 'yyyy-MM-dd')
        ).map(apt => {
            const service = services.find(s => s.id === apt.serviceId);
            const padBefore = service?.padBefore || 0;
            const padAfter = service?.padAfter || 0;
            return {
                start: addMinutes(apt.startTime, -padBefore),
                end: addMinutes(apt.endTime, padAfter)
            }
        });

        for (let i = dayStart.getTime(); i < dayEnd.getTime(); i += 15 * 60000) {
            const potentialStartTime = new Date(i);
            
            const totalDuration = selectedService.duration + (selectedService.padBefore || 0) + (selectedService.padAfter || 0);
            const potentialEndTime = addMinutes(potentialStartTime, totalDuration);

            const isOverlapping = existingAppointmentsOnDate.some(apt =>
                areIntervalsOverlapping(
                    { start: potentialStartTime, end: potentialEndTime },
                    { start: apt.start, end: apt.end },
                    { inclusive: false }
                )
            );

            if (!isOverlapping) {
                options.push(format(potentialStartTime, 'HH:mm'));
            }
        }
        
        const originalTimeFormatted = format(appointment.startTime, 'HH:mm');
        if (!options.includes(originalTimeFormatted) && format(appointment.startTime, 'yyyy-MM-dd') === format(date, 'yyyy-MM-dd')) {
            options.unshift(originalTimeFormatted);
            options.sort();
        }

        return options;
    }, [date, selectedService, appointments, services, appointment.id, appointment.startTime]);

    const handleSubmit = () => {
        if (!selectedClientId || !selectedService || !date || !startTime) return;

        const [hours, minutes] = startTime.split(':').map(Number);
        const startDateTime = setMinutes(setHours(startOfDay(date), hours), minutes);

        const endDateTime = new Date(startDateTime.getTime() + (selectedService.duration * 60000));

        const allServices = [selectedService, ...selectedAddOns];
        const allRequiredResourceIds = [...new Set(allServices.flatMap(s => s.requiredResourceIds || []))];

        const updatedAppointment: Appointment = {
            ...appointment,
            clientId: selectedClientId,
            serviceId: selectedServiceId,
            startTime: startDateTime,
            endTime: endDateTime,
            addOnIds: selectedAddOns.map(s => s.id),
            requiredResourceIds: allRequiredResourceIds,
        };
        // Here we would also save the edited formula, likely on the appointment object itself
        // For now, it just updates the appointment time/service
        onConfirm(updatedAppointment);
    }
    
    const handleAddProduct = (products: InventoryItem[]) => {
      const newItems: EditableFormulaItem[] = products.map(p => ({
        id: p.id,
        name: p.name,
        quantity: 1, // Default quantity
        unit: p.unit || 'unit',
      }));
      setEditableFormula(prev => [...prev, ...newItems.filter(newItem => !prev.find(item => item.id === newItem.id))]);
      setIsProductBrowserOpen(false);
    };

    const removeProduct = (productId: string) => {
        setEditableFormula(prev => prev.filter(item => item.id !== productId));
    };

    const handleApplyClientFormula = (formulaName: string) => {
        if (!client) return;
        const formula = client.customFormulas?.find(f => f.name === formulaName);
        if (!formula) return;
        const newFormula: EditableFormulaItem[] = formula.items.map(item => ({
            id: item.productId,
            name: item.productName,
            quantity: item.quantityUsed,
            unit: item.unit,
        }));
        setEditableFormula(newFormula);
    };


    const removeAddOn = (addOnId: string) => {
        setSelectedAddOns(prev => prev.filter(a => a.id !== addOnId));
    };
    
    return (
        <>
            <form id="edit-appointment-form" onSubmit={(e) => { e.preventDefault(); handleSubmit(); }}>
                <ScrollArea className="h-[70vh] pr-6">
                    <div className="space-y-6">
                        <div className="space-y-4">
                            <h3 className="text-lg font-medium">Client & Service</h3>
                            <div className="space-y-2">
                                <Label htmlFor="client-edit">Client</Label>
                                <div className="flex gap-2">
                                    <Select value={selectedClientId} onValueChange={setSelectedClientId}>
                                        <SelectTrigger id="client-edit">
                                        <SelectValue placeholder="Select an existing client" />
                                        </SelectTrigger>
                                        <SelectContent>
                                        {[client].map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="service-edit">Service</Label>
                                <Select value={selectedServiceId} onValueChange={setSelectedServiceId}>
                                    <SelectTrigger id="service-edit">
                                    <SelectValue placeholder="Select a service" />
                                    </SelectTrigger>
                                    <SelectContent>
                                    {services.filter(s => s.type === 'service').map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>

                        <div className="space-y-4">
                            <div className="flex justify-between items-center">
                                <h3 className="text-lg font-medium">Product Formula</h3>
                                {client?.customFormulas && client.customFormulas.length > 0 && (
                                    <div className="w-full sm:w-auto sm:min-w-[200px]">
                                        <Select onValueChange={handleApplyClientFormula}>
                                            <SelectTrigger className="h-8 text-xs">
                                                <SelectValue placeholder="Load client formula..." />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {client.customFormulas.map(f => (
                                                    <SelectItem key={f.name} value={f.name}>{f.name}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                )}
                            </div>
                            <Card>
                                <CardContent className="p-2 space-y-2">
                                {editableFormula.length > 0 ? (
                                    editableFormula.map(item => (
                                    <div key={item.id} className="flex items-center justify-between p-2 rounded-md hover:bg-muted/50">
                                        <span className="text-sm font-medium">{item.name}</span>
                                        <div className="flex items-center gap-2">
                                            <Input
                                                type="number"
                                                value={item.quantity}
                                                onChange={(e) => {
                                                    const newQty = parseFloat(e.target.value) || 0;
                                                    setEditableFormula(prev => prev.map(p => p.id === item.id ? {...p, quantity: newQty} : p))
                                                }}
                                                className="w-16 h-8 text-center"
                                                step="0.1"
                                            />
                                            <span className="text-xs text-muted-foreground">{item.unit}</span>
                                            <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => removeProduct(item.id)}>
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    </div>
                                    ))
                                ) : (
                                    <p className="text-center text-sm text-muted-foreground p-3">No products in formula.</p>
                                )}
                                </CardContent>
                            </Card>
                            <div className='flex gap-2'>
                                <Button variant="outline" size="sm" type="button" onClick={() => setIsProductBrowserOpen(true)}><PlusCircle className="mr-2 h-4 w-4" /> Browse Library</Button>
                            </div>
                        </div>

                        <div className="space-y-4">
                            <h3 className="text-lg font-medium">Add-on Services</h3>
                                {selectedAddOns.length > 0 ? (
                                <Card>
                                    <CardContent className="p-2 space-y-2">
                                        {selectedAddOns.map(item => (
                                            <div key={item.id} className="flex items-center justify-between p-2 rounded-md hover:bg-muted/50">
                                                <span className="text-sm font-medium">{item.name}</span>
                                                <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => removeAddOn(item.id)}>
                                                    <Trash2 className="h-4 w-4" />
                                                </Button>
                                            </div>
                                        ))}
                                    </CardContent>
                                </Card>
                            ) : (
                                <Card>
                                    <CardContent className="p-4 text-center text-sm text-muted-foreground">
                                        No add-ons selected.
                                    </CardContent>
                                </Card>
                            )}
                            <Button variant="outline" onClick={() => setIsAddOnSelectorOpen(true)} type="button"><PlusCircle className="mr-2 h-4 w-4" /> Select Add-ons</Button>
                        </div>

                        <div className="space-y-4">
                            <h3 className="text-lg font-medium">Date & Time</h3>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label htmlFor="date-edit">Date</Label>
                                    <DatePicker date={date} onDateChange={setDate} />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="start-time-edit">Start Time</Label>
                                    <Select onValueChange={setStartTime} value={startTime}>
                                        <SelectTrigger id="start-time-edit" disabled={!selectedService}>
                                            <SelectValue placeholder="Select a time" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {timeOptions.map(time => (
                                                <SelectItem key={time} value={time}>{format(setMinutes(setHours(new Date(), parseInt(time.split(':')[0])), parseInt(time.split(':')[1])), 'h:mm a')}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                        </div>

                        <div className="space-y-4">
                            <h3 className="text-lg font-medium">Notes</h3>
                            <Textarea rows={4} placeholder="Add any appointment-specific notes..."/>
                        </div>
                    </div>
                </ScrollArea>
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
        </>
    )
}

export const EditAppointmentDialog = ({ open, onOpenChange, appointment, clients, services, appointments, onConfirm }: { open: boolean, onOpenChange: (open: boolean) => void, appointment: Appointment, clients: Client[], services: Service[], appointments: Appointment[], onConfirm: (apt: Appointment) => void }) => {
  const isMobile = useIsMobile();
  const client = clients.find(c => c.id === appointment.clientId);
  const service = services.find(s => s.id === appointment.serviceId);

  if (!client || !service) return null;

  const title = "Edit Appointment";
  const description = "Modify the details for this appointment.";
  
  const FormContent = <EditAppointmentForm appointment={appointment} client={client} service={service} appointments={appointments} services={services} onConfirm={onConfirm} />;

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" className="h-[95vh] flex flex-col">
          <SheetHeader className="text-left px-4">
            <SheetTitle>{title}</SheetTitle>
            <SheetDescription>{description}</SheetDescription>
          </SheetHeader>
          <div className="py-4 flex-1 overflow-y-auto px-4">{FormContent}</div>
          <SheetFooter className="px-4">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" form="edit-appointment-form" className="w-full">Save Changes</Button>
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
          <Button type="submit" form="edit-appointment-form">Save Changes</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
