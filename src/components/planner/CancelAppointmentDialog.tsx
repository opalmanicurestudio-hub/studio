'use client';

import React, { useState, useMemo, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { motion, AnimatePresence } from 'framer-motion';
import { type Appointment, type Tenant, type Service, type Membership, type Package, type Staff } from '@/lib/data';
import { 
  CreditCard, 
  Landmark, 
  Loader, 
  TrendingDown, 
  Award,
  Repeat,
  AlertTriangle,
  ShieldAlert,
  Info,
  Ban,
  ArrowRight,
  DollarSign,
  ShieldCheck,
  Lock,
  CheckCircle2,
  Users,
  Clock,
  Check
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { differenceInHours, parseISO } from 'date-fns';
import { useInventory } from '@/context/InventoryContext';
import { Checkbox } from '@/components/ui/checkbox';

interface CancelAppointmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  appointment: Appointment;
  tenant: Tenant | null;
  onConfirm: (data: { 
    reason: string; 
    chargeFee: boolean; 
    feeAmount: number;
    paymentMethod: 'card_on_file' | 'add_to_balance' | 'waived';
  }) => Promise<void>;
}

const safeDate = (val: any): Date => {
    if (!val) return new Date();
    if (val instanceof Date) return val;
    if (typeof val === 'string') return parseISO(val);
    if (typeof val === 'object' && 'seconds' in val) return new Date(val.seconds * 1000);
    return new Date(val);
};

export const CancelAppointmentDialog: React.FC<CancelAppointmentDialogProps> = ({
  open,
  onOpenChange,
  appointment,
  tenant,
  onConfirm,
}) => {
  const { services, clients, memberships, packages, staff, inventory } = useInventory();
  const [reason, setReason] = useState('client_request');
  const [chargeFee, setChargeFee] = useState(true);
  const [paymentMethod, setPaymentMethod] = useState<'card_on_file' | 'add_to_balance'>('card_on_file');
  const [customReason, setCustomReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // Selective Recovery State
  const [selectedHouseRecoveryIds, setSelectedHouseRecoveryIds] = useState<Set<string>>(new Set());
  const [selectedLaborRecoveryIds, setSelectedLaborRecoveryIds] = useState<Set<string>>(new Set());
  const [useOverrideFee, setUseOverrideFee] = useState(false);
  const [overrideFeeValue, setOverrideFeeValue] = useState(0);

  const client = useMemo(() => clients?.find(c => c.id === appointment.clientId), [clients, appointment.clientId]);
  const hasCardOnFile = !!client?.cardOnFile?.token;
  const tmhr = tenant?.tmhr || 50;
  const taxBurden = tenant?.employerTaxBurdenPct || 10;

  const sessionItems = useMemo(() => {
      const primarySvc = services.find(s => s.id === appointment.serviceId);
      const addOns = (appointment.addOnIds || []).map(id => services.find(s => s.id === id)).filter(Boolean) as Service[];
      return [primarySvc, ...addOns].filter((s): s is Service => !!s);
  }, [appointment, services]);

  const recoveryMatrix = useMemo(() => {
      return sessionItems.map(s => {
          const duration = s.duration || 60;
          const houseOverhead = (duration / 60) * tmhr;
          const materialCost = (s.products || []).reduce((acc, p) => {
              const product = inventory.find(i => i.id === p.id);
              let cpu = 0;
              if (product) {
                  if (product.costingMethod === 'size' && product.size) cpu = (product.costPerUnit || 0) / product.size;
                  else if (product.costingMethod === 'uses' && product.estimatedUses) cpu = (product.costPerUnit || 0) / product.estimatedUses;
                  else cpu = product.costPerUnit || 0;
              }
              return acc + (cpu * (p.quantityUsed || 1));
          }, 0);

          const proId = appointment.checkoutState?.serviceStaffOverrides?.[s.id] || appointment.staffId;
          const pro = staff.find(sm => sm.id === proId);
          const price = s.serviceTiers?.find(t => t.tierId === pro?.pricingTierId)?.price || s.price;
          
          let labor = 0;
          if (pro?.payStructure === 'commission') labor = price * (pro.commissionRate / 100);
          else if (pro?.payStructure === 'hourly' && pro.hourlyRate) labor = (duration / 60) * pro.hourlyRate;
          
          const burdenedLabor = labor * (1 + (taxBurden / 100));

          return {
              id: s.id,
              name: s.name,
              houseFloor: houseOverhead + materialCost,
              laborProtection: burdenedLabor,
              overrideFee: s.customCancellationFee || 0,
              window: s.cancellationWindowHours || tenant?.cancellationWindowHours || 24
          };
      });
  }, [sessionItems, tmhr, inventory, staff, appointment, taxBurden, tenant]);

  useEffect(() => {
      if (open) {
          const allIds = new Set(sessionItems.map(s => s.id));
          setSelectedHouseRecoveryIds(allIds);
          setSelectedLaborRecoveryIds(allIds);
          
          const firstOverride = recoveryMatrix.find(m => m.overrideFee > 0);
          if (firstOverride) {
              setUseOverrideFee(true);
              setOverrideFeeValue(firstOverride.overrideFee);
          } else {
              setUseOverrideFee(false);
              setOverrideFeeValue(tenant?.cancellationFee || 0);
          }
      }
  }, [open, sessionItems, recoveryMatrix, tenant]);

  const isLateCancellation = useMemo(() => {
    const hoursUntil = differenceInHours(safeDate(appointment.startTime), new Date());
    // If any service in the session has a window violation, it's late.
    return recoveryMatrix.some(m => hoursUntil < m.window);
  }, [appointment, recoveryMatrix]);

  const totalMatrixFee = useMemo(() => {
      let total = 0;
      recoveryMatrix.forEach(m => {
          if (selectedHouseRecoveryIds.has(m.id)) total += m.houseFloor;
          if (selectedLaborRecoveryIds.has(m.id)) total += m.laborProtection;
      });
      return total;
  }, [recoveryMatrix, selectedHouseRecoveryIds, selectedLaborRecoveryIds]);

  const finalFeeAmount = useMemo(() => {
      if (!chargeFee) return 0;
      if (reason === 'no-show') return sessionItems.reduce((acc, s) => acc + s.price, 0);
      if (useOverrideFee) return overrideFeeValue;
      return totalMatrixFee;
  }, [chargeFee, reason, useOverrideFee, overrideFeeValue, totalMatrixFee, sessionItems]);

  const handleAction = async () => {
    setIsSubmitting(true);
    await onConfirm({
        reason: reason === 'other' ? customReason : reason,
        chargeFee: chargeFee && finalFeeAmount > 0,
        feeAmount: finalFeeAmount,
        paymentMethod: (chargeFee && finalFeeAmount > 0) ? paymentMethod : 'waived',
    });
    setIsSubmitting(false);
    onOpenChange(false);
  };

  const toggleHouse = (id: string) => {
      const next = new Set(selectedHouseRecoveryIds);
      next.has(id) ? next.delete(id) : next.add(id);
      setSelectedHouseRecoveryIds(next);
  }

  const toggleLabor = (id: string) => {
      const next = new Set(selectedLaborRecoveryIds);
      next.has(id) ? next.delete(id) : next.add(id);
      setSelectedLaborRecoveryIds(next);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl p-0 border-4 rounded-[3rem] overflow-hidden shadow-3xl flex flex-col max-h-[95dvh] bg-background">
        <DialogHeader className="p-8 pb-6 border-b bg-muted/5 shrink-0 text-left">
          <div className="flex items-center gap-3 mb-2">
            <Ban className="w-5 h-5 text-destructive" />
            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground opacity-60">Protocol Termination</span>
          </div>
          <DialogTitle className="text-2xl font-black uppercase tracking-tighter text-slate-900 leading-none">Cancel Appointment</DialogTitle>
          <DialogDescription className="text-xs font-bold uppercase tracking-widest opacity-60 mt-1">
            Guest: <strong>{appointment.clientName}</strong>
          </DialogDescription>
        </DialogHeader>
        
        <ScrollArea className="flex-1">
            <div className="p-8 space-y-10">
                <div className="space-y-4">
                  <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Cancellation Mode</Label>
                  <RadioGroup value={reason} onValueChange={setReason} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <label htmlFor="r-client" className={cn("flex items-center space-x-3 border-2 p-4 rounded-2xl cursor-pointer transition-all hover:bg-muted/50", reason === 'client_request' ? "border-primary bg-primary/5" : "border-border")}>
                        <RadioGroupItem value="client_request" id="r-client" />
                        <span className="font-black uppercase tracking-tight text-xs">Client Request</span>
                    </label>
                    <label htmlFor="r-noshow" className={cn("flex items-center space-x-3 border-2 p-4 rounded-2xl cursor-pointer transition-all hover:bg-muted/50", reason === 'no-show' ? "border-destructive bg-destructive/5" : "border-border")}>
                        <RadioGroupItem value="no-show" id="r-noshow" />
                        <span className="font-black uppercase tracking-tight text-xs">No-Show (100% Fee)</span>
                    </label>
                  </RadioGroup>
                </div>

                <div className="space-y-6">
                    <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Itemized Recovery Manifest</p>
                    <div className="space-y-3">
                        {recoveryMatrix.map(m => (
                            <Card key={m.id} className="border-2 rounded-2xl overflow-hidden bg-white shadow-sm">
                                <CardHeader className="p-4 border-b bg-muted/5 flex flex-row items-center justify-between">
                                    <p className="text-xs font-black uppercase tracking-tight truncate flex-1 text-left">{m.name}</p>
                                    <Badge variant="outline" className="h-5 text-[8px] font-black bg-white">{m.window}h Window</Badge>
                                </CardHeader>
                                <CardContent className="p-4 space-y-3 text-left">
                                    <div className="flex items-center justify-between group">
                                        <div className="flex items-center gap-3">
                                            <Checkbox id={`house-${m.id}`} checked={selectedHouseRecoveryIds.has(m.id)} onCheckedChange={() => toggleHouse(m.id)} className="h-5 w-5 rounded-lg border-2" />
                                            <Label htmlFor={`house-${m.id}`} className="text-[10px] font-bold uppercase opacity-60 flex items-center gap-2 cursor-pointer"><Landmark className="w-3 h-3"/> Studio Floor (Time + Mats)</Label>
                                        </div>
                                        <span className="font-mono text-[10px] font-black text-slate-900">${m.houseFloor.toFixed(2)}</span>
                                    </div>
                                    <div className="flex items-center justify-between group">
                                        <div className="flex items-center gap-3">
                                            <Checkbox id={`labor-${m.id}`} checked={selectedLaborRecoveryIds.has(m.id)} onCheckedChange={() => toggleLabor(m.id)} className="h-5 w-5 rounded-lg border-2" />
                                            <Label htmlFor={`labor-${m.id}`} className="text-[10px] font-bold uppercase opacity-60 flex items-center gap-2 cursor-pointer"><Users className="w-3 h-3"/> Labor Protection</Label>
                                        </div>
                                        <span className="font-mono text-[10px] font-black text-slate-900">${m.laborProtection.toFixed(2)}</span>
                                    </div>
                                </CardContent>
                            </Card>
                        ))}
                    </div>
                </div>

                <div className="space-y-6">
                    <Separator className="border-dashed" />
                    <div className="flex items-center justify-between p-6 rounded-[2.5rem] border-4 border-primary/10 bg-primary/[0.02] shadow-inner">
                        <div className="space-y-1 text-left">
                            <Label className="text-base font-black uppercase tracking-tight flex items-center gap-2">
                                <DollarSign className="w-4 h-4 text-primary" /> 
                                Final Settlement Fee
                            </Label>
                            <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-tight opacity-60">
                                {useOverrideFee ? 'Applied via Fixed Override' : 'Calculated via Profitability Matrix'}
                            </p>
                        </div>
                        <div className="flex flex-col items-end gap-2">
                            <span className={cn("text-3xl font-black font-mono tracking-tighter", chargeFee ? "text-primary" : "text-muted-foreground opacity-40")}>
                                ${finalFeeAmount.toFixed(2)}
                            </span>
                            <Switch checked={chargeFee} onCheckedChange={setChargeFee} className="scale-110" />
                        </div>
                    </div>

                    <AnimatePresence>
                        {chargeFee && finalFeeAmount > 0 && (
                            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }}>
                                <div className="space-y-6">
                                    <div className="flex items-center justify-between p-4 rounded-2xl border-2 bg-muted/5">
                                        <div className="space-y-0.5 text-left">
                                            <p className="text-[10px] font-black uppercase text-slate-900">Fixed Rate Override</p>
                                            <p className="text-[8px] font-bold uppercase opacity-60">Bypass matrix suggestion</p>
                                        </div>
                                        <Switch checked={useOverrideFee} onCheckedChange={setUseOverrideFee} />
                                    </div>

                                    {useOverrideFee && (
                                        <div className="space-y-3 text-left">
                                            <Label htmlFor="override-value-manual" className="text-[10px] font-black uppercase tracking-widest text-primary ml-1">Override Value ($)</Label>
                                            <div className="relative">
                                                <DollarSign className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-primary opacity-40" />
                                                <Input id="override-value-manual" type="number" step="0.01" value={overrideFeeValue || ''} onChange={e => setOverrideFeeValue(parseFloat(e.target.value) || 0)} className="h-14 pl-12 rounded-2xl border-2 font-black text-xl shadow-inner bg-white" />
                                            </div>
                                        </div>
                                    )}

                                    <div className="space-y-4 pt-2 text-left">
                                        <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Settlement Protocol</Label>
                                        <RadioGroup value={paymentMethod} onValueChange={(v: any) => setPaymentMethod(v)} className="grid grid-cols-2 gap-3">
                                            <label htmlFor="pay-vault-cancel" className={cn("cursor-pointer h-full", !hasCardOnFile && "opacity-40 grayscale")}>
                                                <RadioGroupItem value="card_on_file" id="pay-vault-cancel" className="peer sr-only" disabled={!hasCardOnFile} />
                                                <div className={cn("flex flex-col items-center justify-center p-5 border-2 rounded-[2rem] transition-all text-center h-full peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/5 peer-data-[state=checked]:shadow-lg", paymentMethod === 'card_on_file' ? "border-primary" : "border-border bg-white")}>
                                                    {hasCardOnFile ? <ShieldCheck className="w-6 h-6 mb-2 text-primary" /> : <Lock className="w-6 h-6 mb-2 text-slate-400" />}
                                                    <span className="text-[10px] font-black uppercase tracking-widest leading-none">Vault Card</span>
                                                </div>
                                            </label>
                                            <label htmlFor="pay-balance-cancel" className="cursor-pointer h-full">
                                                <RadioGroupItem value="add_to_balance" id="pay-balance-cancel" className="peer sr-only" />
                                                <div className={cn("flex flex-col items-center justify-center p-5 border-2 rounded-[2rem] transition-all text-center h-full peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/5 peer-data-[state=checked]:shadow-lg", paymentMethod === 'add_to_balance' ? "border-primary" : "border-border bg-white")}>
                                                    <Landmark className={cn("w-6 h-6 mb-2 transition-colors", paymentMethod === 'add_to_balance' ? "text-primary" : "text-muted-foreground opacity-40")} />
                                                    <span className="text-[10px] font-black uppercase tracking-widest leading-none">Client Arrears</span>
                                                </div>
                                            </label>
                                        </RadioGroup>
                                    </div>
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            </div>
        </ScrollArea>

        <DialogFooter className="p-8 pt-4 border-t bg-muted/5 flex flex-col gap-3 shrink-0">
            <Button onClick={handleAction} className="w-full h-16 rounded-[2rem] text-xl font-black uppercase shadow-2xl shadow-primary/30 group" disabled={isSubmitting}>
                {isSubmitting ? <Loader className="w-6 h-6 animate-spin" /> : <>Finalize Reversal <ArrowRight className="ml-3 w-5 h-5 transition-transform group-hover:translate-x-1" /></>}
            </Button>
            <Button variant="ghost" onClick={() => onOpenChange(false)} className="w-full h-10 font-black uppercase tracking-widest text-[10px] text-slate-400">Abort Protocol</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};