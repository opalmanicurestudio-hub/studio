'use client';

import React, { useState, useEffect, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { 
    CheckCircle2, 
    User, 
    Sparkles, 
    ArrowRight, 
    PlusCircle, 
    Trash2, 
    Clock, 
    Tag, 
    Check, 
    Box, 
    Activity, 
    Landmark, 
    MapPin, 
    ShieldCheck,
    Info,
    Mail,
    Phone,
    Printer,
    Ear,
    VolumeX,
    SunDim,
    MessageSquare,
    Users
} from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useForm, FormProvider } from 'react-hook-form';
import { PhoneInput } from '@/components/ui/phone-input';
import { type Service, type Tenant } from '@/lib/data';
import { PrintTicket } from '@/components/planner/PrintTicket';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { useIsMobile } from '@/hooks/use-mobile';

interface CheckInConfirmationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: any; // Appointment or WalkIn
  services: Service[];
  tenant: Tenant | null;
  onConfirm: (data: { 
    serviceId: string; 
    addOnIds: string[]; 
    email: string; 
    phone: string;
    accommodations: string[];
    notes: string;
  }) => void;
}

const accommodationsOptions = [
    { id: 'silent', label: 'Silent Appointment', icon: VolumeX, color: 'text-indigo-500' },
    { id: 'sensory', label: 'Sensory Sensitivity', icon: Ear, color: 'text-blue-500' },
    { id: 'lighting', label: 'Low Lighting', icon: SunDim, color: 'text-amber-500' },
];

export const CheckInConfirmationDialog: React.FC<CheckInConfirmationDialogProps> = ({
  open,
  onOpenChange,
  item,
  services,
  tenant,
  onConfirm,
}) => {
  const isMobile = useIsMobile();
  const [serviceId, setServiceId] = useState('');
  const [addOnIds, setAddOnIds] = useState<string[]>([]);
  const [selectedAccommodations, setSelectedAccommodations] = useState<string[]>([]);
  const [arrivalNotes, setArrivalNotes] = useState('');
  
  const methods = useForm({
      defaultValues: {
          email: '',
          phone: '',
      }
  });

  useEffect(() => {
    if (open && item) {
      setServiceId(item.serviceId || (item.serviceIds?.[0]) || '');
      setAddOnIds(item.addOnIds || item.serviceIds?.slice(1) || []);
      setArrivalNotes(item.notes || '');
      
      const currentNeeds = item.client?.sensoryNeeds || '';
      const initialAcc = accommodationsOptions
        .filter(opt => currentNeeds.toLowerCase().includes(opt.label.toLowerCase()))
        .map(opt => opt.id);
      setSelectedAccommodations(initialAcc);

      methods.reset({
          email: item.clientEmail || item.customerEmail || item.client?.email || '',
          phone: item.clientPhone || item.customerPhone || item.client?.phone || '',
      });
    }
  }, [open, item, methods]);

  const selectedService = useMemo(() => services.find(s => s.id === serviceId), [services, serviceId]);
  
  const handleToggleAddOn = (id: string) => {
    setAddOnIds(prev => prev.includes(id) ? prev.filter(aid => aid !== id) : [...prev, id]);
  };

  const handleToggleAccommodation = (id: string) => {
    setSelectedAccommodations(prev => 
        prev.includes(id) ? prev.filter(a => a !== id) : [...prev, id]
    );
  };

  const handleConfirm = () => {
    const { email, phone } = methods.getValues();
    const accommodationsLabels = accommodationsOptions
        .filter(opt => selectedAccommodations.includes(opt.id))
        .map(opt => opt.label);

    onConfirm({ 
        serviceId, 
        addOnIds, 
        email, 
        phone,
        accommodations: accommodationsLabels,
        notes: arrivalNotes
    });
    onOpenChange(false);
  };

  const handlePrint = () => {
      window.print();
  };

  if (!item) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl p-0 border-4 rounded-[3rem] overflow-hidden shadow-3xl bg-background flex flex-col h-full max-h-[95vh] sm:max-h-[90vh]">
        <DialogHeader className={cn("flex-shrink-0 text-left border-b bg-muted/5 p-8 pb-6")}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
                <ShieldCheck className="w-5 h-5 text-primary" />
                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground opacity-60">Identity Certification</span>
            </div>
            <Button variant="ghost" size="sm" onClick={handlePrint} className="h-8 rounded-xl font-black uppercase text-[10px] tracking-widest text-primary border border-primary/20 hover:bg-primary/5">
                <Printer className="w-3.5 h-3.5 mr-2" /> Print Ticket
            </Button>
          </div>
          <DialogTitle className="text-2xl md:text-3xl font-black uppercase tracking-tighter text-slate-900 leading-none mt-4">
            Verify Check-in
          </DialogTitle>
          <DialogDescription className="text-[10px] font-bold uppercase tracking-widest opacity-60 mt-1">Confirm manifest for: <strong className="text-foreground">{item.clientName || item.customerName}</strong></DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1">
            <div className="p-8 space-y-10">
                <div className="space-y-6">
                    <div className="flex items-center gap-4 text-left">
                        <Avatar className="h-16 w-16 border-4 border-background shadow-xl rounded-[1.5rem]">
                            <AvatarFallback className="font-black text-xl bg-primary/10 text-primary">{(item.clientName || item.customerName || 'G')[0]}</AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 text-left">
                            <p className="text-[9px] font-black uppercase text-primary/60 tracking-widest">Guest Profile</p>
                            <h3 className="text-xl md:text-2xl font-black uppercase tracking-tighter text-slate-900 leading-none">{item.clientName || item.customerName}</h3>
                        </div>
                    </div>

                    <FormProvider {...methods}>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="space-y-2 text-left">
                                <Label className="text-[9px] font-black uppercase text-muted-foreground ml-1 flex items-center gap-2"><Mail className="w-3 h-3"/> Verified Email</Label>
                                <Input {...methods.register('email')} className="h-12 rounded-xl border-2 font-bold text-xs" />
                            </div>
                            <div className="space-y-2 text-left">
                                <Label className="text-[9px] font-black uppercase text-muted-foreground ml-1 flex items-center gap-2"><Phone className="w-3 h-3"/> Verified Mobile</Label>
                                <PhoneInput name="phone" label="" className="h-12" />
                            </div>
                        </div>
                    </FormProvider>

                    <div className="p-6 rounded-[2.5rem] bg-muted/10 border-2 space-y-6 shadow-inner text-left">
                        <div className="space-y-3">
                            <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Primary Treatment</Label>
                            <Select value={serviceId} onValueChange={setServiceId}>
                                <SelectTrigger id="service-confirm-select" className="h-14 rounded-2xl border-2 shadow-sm bg-white font-black uppercase text-xs tracking-tight">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent className="rounded-xl border-2 shadow-2xl">
                                    {services.filter(s => s.type === 'service').map(s => (
                                        <SelectItem key={s.id} value={s.id} className="font-bold uppercase text-[10px] tracking-widest">{s.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-4">
                            <div className="flex items-center justify-between px-1">
                                <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Session Enhancements</Label>
                                <span className="text-[8px] font-black uppercase text-primary/60">{addOnIds.length} Added</span>
                            </div>
                            <div className="grid grid-cols-1 gap-2">
                                {services.filter(s => s.type === 'addon' && !s.isPrivate).map(addon => {
                                    const isSelected = addOnIds.includes(addon.id);
                                    return (
                                        <div 
                                            key={addon.id} 
                                            onClick={() => handleToggleAddOn(addon.id)}
                                            className={cn(
                                                "flex items-center justify-between p-4 rounded-2xl border-2 transition-all text-left cursor-pointer",
                                                isSelected ? "border-primary bg-primary/5 shadow-md" : "border-transparent bg-white hover:border-primary/10"
                                            )}
                                        >
                                            <div className="flex items-center gap-3">
                                                <div className={cn("p-1.5 rounded-lg", isSelected ? "bg-primary text-white" : "bg-muted text-slate-400")}>
                                                    {isSelected ? <Check className="w-3.5 h-3.5" /> : <PlusCircle className="w-3.5 h-3.5" />}
                                                </div>
                                                <span className={cn("text-[11px] font-black uppercase tracking-tight", isSelected ? "text-slate-900" : "text-slate-500")}>{addon.name}</span>
                                            </div>
                                            <span className="font-black font-mono text-[10px] text-primary/60">+${addon.price.toFixed(0)}</span>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>

                    <div className="space-y-6 pt-4 border-t border-dashed">
                        <div className="space-y-4 text-left">
                            <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1 flex items-center gap-2">
                                <Activity className="w-3.5 h-3.5 opacity-40" /> Strategic Accommodations
                            </Label>
                            <div className="grid grid-cols-1 gap-2">
                                {accommodationsOptions.map((opt) => {
                                    const isSelected = selectedAccommodations.includes(opt.id);
                                    return (
                                        <div
                                            key={opt.id}
                                            onClick={() => handleToggleAccommodation(opt.id)}
                                            className={cn(
                                                "flex items-center justify-between p-4 rounded-2xl border-2 transition-all text-left cursor-pointer",
                                                isSelected ? "border-primary bg-primary/5 shadow-md" : "border-transparent bg-muted/10 hover:border-border"
                                            )}
                                        >
                                            <div className="flex items-center gap-3">
                                                <div className={cn("p-2 rounded-xl bg-white shadow-sm", isSelected ? opt.color : "text-slate-400 opacity-40")}>
                                                    <opt.icon className="w-4 h-4" />
                                                </div>
                                                <span className={cn("text-[11px] font-black uppercase tracking-tight", isSelected ? "text-slate-900" : "text-slate-500")}>{opt.label}</span>
                                            </div>
                                            <Checkbox 
                                                checked={isSelected} 
                                                onCheckedChange={() => handleToggleAccommodation(opt.id)} 
                                                className="h-5 w-5 rounded-lg border-2" 
                                                onClick={(e) => e.stopPropagation()}
                                            />
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        <div className="space-y-2 text-left">
                            <Label htmlFor="arrival-notes" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1 flex items-center gap-2">
                                <MessageSquare className="w-3.5 h-3.5 opacity-40" /> Arrival Intel & Notes
                            </Label>
                            <Textarea 
                                id="arrival-notes"
                                value={arrivalNotes}
                                onChange={(e) => setArrivalNotes(e.target.value)}
                                placeholder="Last minute instructions or requests for the technician..."
                                className="rounded-2xl border-2 bg-muted/5 p-4 font-medium leading-relaxed min-h-[100px]"
                            />
                        </div>
                    </div>
                </div>

                <div className="p-5 rounded-2xl border-2 border-dashed bg-primary/[0.02] flex items-start gap-4 text-left shadow-inner">
                    <Info className="w-5 h-5 text-primary shrink-0 mt-0.5 opacity-40" />
                    <div className="space-y-1">
                        <p className="text-[10px] font-black uppercase text-primary">Protocol Confirmation</p>
                        <p className="text-[11px] font-medium text-slate-600 leading-relaxed uppercase tracking-tight">
                            Verifying the manifest here updates the appointment card instantly across all studio terminals.
                        </p>
                    </div>
                </div>
            </div>
        </ScrollArea>

        <DialogFooter className={cn("border-t bg-background flex-shrink-0 shadow-2xl", isMobile ? "p-6" : "p-8 pt-4")}>
          <div className="flex flex-col sm:flex-row gap-3 w-full">
            <Button variant="ghost" onClick={() => onOpenChange(false)} className="flex-1 font-black uppercase tracking-tighter text-[10px] text-slate-400">Abort Check-in</Button>
            <Button onClick={handleConfirm} className="flex-[2] h-16 rounded-[2rem] font-black uppercase tracking-widest text-[10px] shadow-xl shadow-primary/30 group">
                Certify & Check In <ArrowRight className="ml-2 w-4 h-4 transition-transform group-hover:translate-x-1"/>
            </Button>
          </div>
        </DialogFooter>

        <div className="hidden print:block" id="print-ticket-area">
            {selectedService && (
                <PrintTicket data={{
                    business: { name: tenant?.name || 'Studio', phone: tenant?.twilioPhoneNumber || '' },
                    client: { name: item.clientName || item.customerName, email: methods.watch('email'), phone: methods.watch('phone') } as any,
                    appointment: item,
                    service: selectedService
                }} />
            )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
