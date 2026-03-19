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
    ShieldCheck 
} from 'lucide-react';
import { type Service, type Appointment, type WalkIn } from '@/lib/data';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';

interface CheckInConfirmationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: any; // Appointment or WalkIn
  services: Service[];
  onConfirm: (data: { serviceId: string; addOnIds: string[] }) => void;
}

export const CheckInConfirmationDialog: React.FC<CheckInConfirmationDialogProps> = ({
  open,
  onOpenChange,
  item,
  services,
  onConfirm,
}) => {
  const [serviceId, setServiceId] = useState('');
  const [addOnIds, setAddOnIds] = useState<string[]>([]);

  useEffect(() => {
    if (open && item) {
      setServiceId(item.serviceId || (item.serviceIds?.[0]) || '');
      setAddOnIds(item.addOnIds || item.serviceIds?.slice(1) || []);
    }
  }, [open, item]);

  const selectedService = useMemo(() => services.find(s => s.id === serviceId), [services, serviceId]);
  
  const handleToggleAddOn = (id: string) => {
    setAddOnIds(prev => prev.includes(id) ? prev.filter(aid => aid !== id) : [...prev, id]);
  };

  const handleConfirm = () => {
    onConfirm({ serviceId, addOnIds });
    onOpenChange(false);
  };

  if (!item) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl p-0 border-4 rounded-[3rem] overflow-hidden shadow-3xl bg-background">
        <DialogHeader className="p-8 pb-6 border-b bg-muted/5 text-left flex-shrink-0">
          <div className="flex items-center gap-3 mb-2">
            <ShieldCheck className="w-5 h-5 text-primary" />
            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground opacity-60">Identity Certification</span>
          </div>
          <DialogTitle className="text-2xl md:text-3xl font-black uppercase tracking-tighter text-slate-900 leading-none">
            Verify Check-in
          </DialogTitle>
          <DialogDescription className="text-[10px] font-bold uppercase tracking-widest opacity-60 mt-1">Confirm manifest for: <strong className="text-foreground">{item.clientName || item.customerName}</strong></DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh]">
            <div className="p-8 space-y-10">
                <div className="space-y-6">
                    <div className="flex items-center gap-4 text-left">
                        <Avatar className="h-16 w-16 border-4 border-background shadow-xl rounded-[1.5rem]">
                            <AvatarFallback className="font-black text-xl bg-primary/10 text-primary">{(item.clientName || item.customerName || 'G')[0]}</AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                            <p className="text-[9px] font-black uppercase text-primary/60 tracking-widest">Guest Profile</p>
                            <h3 className="text-xl md:text-2xl font-black uppercase tracking-tighter text-slate-900 leading-none">{item.clientName || item.customerName}</h3>
                        </div>
                    </div>

                    <div className="p-6 rounded-[2.5rem] bg-muted/10 border-2 space-y-6 shadow-inner text-left">
                        <div className="space-y-3">
                            <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Primary Treatment</Label>
                            <Select value={serviceId} onValueChange={setServiceId}>
                                <SelectTrigger className="h-14 rounded-2xl border-2 shadow-sm bg-white font-black uppercase text-xs tracking-tight">
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
                                        <button 
                                            key={addon.id} 
                                            type="button"
                                            onClick={() => handleToggleAddOn(addon.id)}
                                            className={cn(
                                                "flex items-center justify-between p-4 rounded-2xl border-2 transition-all text-left",
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
                                        </button>
                                    );
                                })}
                            </div>
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

        <DialogFooter className="p-8 pt-4 border-t bg-muted/5 shrink-0">
          <div className="flex flex-col sm:flex-row gap-3 w-full">
            <Button variant="ghost" onClick={() => onOpenChange(false)} className="flex-1 font-black uppercase tracking-tighter text-[10px] text-slate-400">Abort Check-in</Button>
            <Button onClick={handleConfirm} className="flex-[2] h-16 rounded-[2rem] font-black uppercase tracking-widest text-[10px] shadow-xl shadow-primary/30 group">
                Certify & Check In <ArrowRight className="ml-2 w-4 h-4 transition-transform group-hover:translate-x-1"/>
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
