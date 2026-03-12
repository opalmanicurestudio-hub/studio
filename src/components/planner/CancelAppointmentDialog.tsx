
'use client';

import React, { useState, useMemo } from 'react';
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
import { motion } from 'framer-motion';
import { type Appointment, type Tenant, type Service, type Membership, type Package } from '@/lib/data';
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
  Lock
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { differenceInHours } from 'date-fns';
import { useInventory } from '@/context/InventoryContext';

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

export const CancelAppointmentDialog: React.FC<CancelAppointmentDialogProps> = ({
  open,
  onOpenChange,
  appointment,
  tenant,
  onConfirm,
}) => {
  const { services, clients, memberships, packages } = useInventory();
  const [reason, setReason] = useState('client_request');
  const [chargeFee, setChargeFee] = useState(true);
  const [shouldRoundUp, setShouldRoundUp] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<'card_on_file' | 'add_to_balance'>('card_on_file');
  const [customReason, setCustomReason] = useState('');
  
  const [isSubmitting, setIsSubmitting] = useState(false);

  const service = useMemo(() => services?.find(s => s.id === appointment.serviceId), [services, appointment.serviceId]);
  const client = useMemo(() => clients?.find(c => c.id === appointment.clientId), [clients, appointment.clientId]);

  const hasCardOnFile = !!client?.cardOnFile?.token;

  const activeOffer = useMemo(() => {
    if (!client) return null;
    
    if (client.activeMembershipId) {
        const membership = memberships.find(m => m.id === client.activeMembershipId);
        const isPerk = membership?.includedServices?.some(p => p.id === appointment.serviceId);
        if (isPerk) return { type: 'membership', name: membership.name, forfeitOnLate: !!membership.forfeitOnLateCancel, forfeitOnNoShow: !!membership.forfeitOnNoShow };
    }

    const activePack = client.activePackages?.find(p => {
        const pkgDef = packages.find(pkg => pkg.id === p.packageId);
        return pkgDef?.serviceId === appointment.serviceId;
    });
    if (activePack) {
        const pkgDef = packages.find(pkg => pkg.id === activePack.packageId);
        return { type: 'package', name: pkgDef?.name || 'Package', sessions: activePack.sessionsRemaining };
    }

    return null;
  }, [client, appointment.serviceId, memberships, packages]);

  const isLateCancellation = useMemo(() => {
    if (!appointment || !tenant?.cancellationWindowHours) return false;
    const startTime = appointment.startTime instanceof Date ? appointment.startTime : new Date(appointment.startTime);
    const hoursUntil = differenceInHours(startTime, new Date());
    return hoursUntil < (tenant.cancellationWindowHours || 24);
  }, [appointment, tenant]);

  const willForfeit = useMemo(() => {
    if (!activeOffer) return false;
    if (reason === 'no-show') return true;
    if (isLateCancellation && (reason === 'client_request' || reason === 'other')) {
        return activeOffer.type === 'package' || (activeOffer.type === 'membership' && activeOffer.forfeitOnLate);
    }
    return false;
  }, [activeOffer, reason, isLateCancellation]);

  const dynamicFees = useMemo(() => {
    if (!service || !tenant?.tmhr) return { overheadRecovery: 0, noShowPenalty: 0, duration: 0 };
    const duration = service.duration || 60;
    const overheadRecovery = (duration / 60) * (tenant.tmhr || 50);
    const noShowPenalty = service.price || 0;
    return { overheadRecovery, noShowPenalty, duration };
  }, [service, tenant?.tmhr]);

  const baseFeeAmount = useMemo(() => {
    if (reason === 'no-show') return dynamicFees.noShowPenalty;
    return isLateCancellation ? dynamicFees.overheadRecovery : 0;
  }, [reason, isLateCancellation, dynamicFees]);

  const feeAmount = shouldRoundUp ? Math.ceil(baseFeeAmount) : baseFeeAmount;

  // Auto-switch payment method if no card on file
  useEffect(() => {
    if (!hasCardOnFile && paymentMethod === 'card_on_file') {
        setPaymentMethod('add_to_balance');
    }
  }, [hasCardOnFile, paymentMethod]);

  const handleAction = async () => {
    setIsSubmitting(true);
    await onConfirm({
        reason: reason === 'other' ? customReason : reason,
        chargeFee: chargeFee && feeAmount > 0,
        feeAmount: chargeFee ? feeAmount : 0,
        paymentMethod: (chargeFee && feeAmount > 0) ? paymentMethod : 'waived',
    });
    setIsSubmitting(false);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md p-0 border-4 rounded-[3rem] overflow-hidden shadow-3xl flex flex-col max-h-[95dvh] bg-background">
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
                  <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Cancellation Logic</Label>
                  <RadioGroup value={reason} onValueChange={setReason} className="grid grid-cols-1 gap-3">
                    <label 
                        htmlFor="reason-client"
                        className={cn(
                            "flex items-center space-x-4 border-2 p-4 rounded-2xl cursor-pointer transition-all hover:bg-muted/50 border-border",
                            reason === 'client_request' && "border-primary bg-primary/5 shadow-md"
                        )}
                    >
                        <RadioGroupItem value="client_request" id="reason-client" />
                        <div className="flex-1 text-left">
                            <p className="font-black uppercase tracking-tight text-sm text-slate-900">Client Request</p>
                            {isLateCancellation && <p className="text-[9px] text-amber-600 font-black uppercase tracking-widest mt-0.5">Late Notice Encountered</p>}
                        </div>
                    </label>
                    <label 
                        htmlFor="reason-noshow"
                        className={cn(
                            "flex items-center space-x-4 border-2 p-4 rounded-2xl cursor-pointer transition-all hover:bg-muted/50 border-border",
                            reason === 'no-show' && "border-primary bg-primary/5 shadow-md"
                        )}
                    >
                        <RadioGroupItem value="no-show" id="reason-noshow" />
                        <div className="flex-1 text-left">
                            <span className="font-black uppercase tracking-tight text-sm text-slate-900">No-Show</span>
                            <span className="text-[9px] text-destructive font-black uppercase tracking-widest block mt-0.5">Penalty: 100% Protocol Value</span>
                        </div>
                    </label>
                    <label 
                        htmlFor="reason-other"
                        className={cn(
                            "flex items-center space-x-4 border-2 p-4 rounded-2xl cursor-pointer transition-all hover:bg-muted/50 border-border",
                            reason === 'other' && "border-primary bg-primary/5 shadow-md"
                        )}
                    >
                        <RadioGroupItem value="other" id="reason-other" />
                        <span className="font-black uppercase tracking-tight text-sm text-slate-900">Custom Protocol</span>
                    </label>
                  </RadioGroup>
                  {reason === 'other' && (
                    <Textarea 
                        placeholder="ENTER AUDIT NOTES..." 
                        value={customReason} 
                        onChange={(e) => setCustomReason(e.target.value)}
                        className="mt-2 bg-muted/5 border-2 rounded-xl focus-visible:ring-primary/20"
                    />
                  )}
                </div>

                <div className="space-y-4">
                    <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Yield Impact Analysis</p>
                    <div className="grid gap-4">
                        {willForfeit && activeOffer && (
                            <motion.div initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} className="p-6 rounded-[2rem] border-4 border-primary bg-primary/5 shadow-2xl shadow-primary/5 space-y-4 relative overflow-hidden">
                                <div className="absolute top-0 right-0 p-4 opacity-5"><ShieldAlert className="w-12 h-12 text-primary" /></div>
                                <div className="flex items-center gap-3">
                                    <div className="p-2 bg-primary rounded-xl shadow-lg shadow-primary/20">
                                        {activeOffer.type === 'membership' ? <Award className="w-5 h-5 text-white" /> : <Repeat className="w-5 h-5 text-white" />}
                                    </div>
                                    <div className="space-y-0.5 text-left">
                                        <p className="text-[10px] font-black uppercase tracking-widest text-primary leading-none">Dossier Consequence</p>
                                        <p className="text-sm font-black uppercase tracking-tight text-slate-900">Protocol Forfeit Triggered</p>
                                    </div>
                                </div>
                                <p className="text-xs font-bold text-slate-600 leading-relaxed uppercase text-left">
                                    This cancellation violates the window for <strong>{activeOffer.name}</strong>. The session will be deducted from the client's balance as "Forfeited."
                                </p>
                            </motion.div>
                        )}

                        <Card className="bg-muted/20 border-2 shadow-inner rounded-[2rem]">
                            <CardContent className="p-6 space-y-4">
                                <div className="flex items-center justify-between">
                                    <p className="text-[10px] font-black uppercase text-muted-foreground tracking-widest flex items-center gap-2">
                                        <TrendingDown className="w-3.5 h-3.5 opacity-40" />
                                        Overhead Liability
                                    </p>
                                    <Badge variant="outline" className="font-mono text-[9px] uppercase h-5 px-2 bg-white border-2">{dynamicFees.duration}m Session</Badge>
                                </div>
                                <div className="space-y-2 text-sm font-bold uppercase">
                                    <div className="flex justify-between items-baseline opacity-60">
                                        <span className="text-[10px]">Reserved Foundation</span>
                                        <span className="font-mono">${dynamicFees.overheadRecovery.toFixed(2)}</span>
                                    </div>
                                    <div className="flex justify-between items-baseline opacity-60">
                                        <span className="text-[10px]">Treatment Value</span>
                                        <span className="font-mono">${dynamicFees.noShowPenalty.toFixed(2)}</span>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    </div>
                </div>

                {(isLateCancellation || reason === 'no-show') && (
                    <div className="space-y-6 pt-2">
                        <Separator className="border-dashed" />
                        <div className="flex items-center justify-between p-6 rounded-[2.5rem] border-4 border-destructive/10 bg-destructive/[0.02] shadow-inner transition-all">
                            <div className="space-y-1 text-left">
                                <Label className="text-base font-black uppercase tracking-tight flex items-center gap-2"><DollarSign className="w-4 h-4" /> Enforce Monetary Penalty</Label>
                                <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-tight opacity-60">Collect independent of session forfeit</p>
                            </div>
                            <div className="flex flex-col items-end gap-2">
                                <span className={cn("text-2xl font-black font-mono tracking-tighter", chargeFee ? "text-destructive" : "text-muted-foreground opacity-40")}>
                                    ${feeAmount.toFixed(2)}
                                </span>
                                <Switch checked={chargeFee} onCheckedChange={setChargeFee} disabled={isSubmitting} className="data-[state=checked]:bg-destructive" />
                            </div>
                        </div>
                        
                        {chargeFee && feeAmount > 0 && (
                            <div className="space-y-4 animate-in slide-in-from-top-2">
                                <div className="flex items-center justify-between px-1">
                                    <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Distribution Protocol</Label>
                                    <div className="flex items-center gap-2">
                                        <Label htmlFor="round-up-cancel" className="text-[9px] font-black uppercase text-muted-foreground opacity-60">Round Up</Label>
                                        <Switch id="round-up-cancel" checked={shouldRoundUp} onCheckedChange={setShouldRoundUp} />
                                    </div>
                                </div>
                                <RadioGroup value={paymentMethod} onValueChange={(v: any) => setPaymentMethod(v)} disabled={isSubmitting} className="grid grid-cols-2 gap-3">
                                    <label htmlFor="pay-card" className={cn("cursor-pointer flex-1 h-full", !hasCardOnFile && "opacity-40 grayscale")}>
                                        <RadioGroupItem value="card_on_file" id="pay-card" className="peer sr-only" disabled={!hasCardOnFile} />
                                        <div className={cn("flex flex-col items-center justify-center p-5 border-2 rounded-[2rem] transition-all text-center h-full peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/5 peer-data-[state=checked]:shadow-lg", paymentMethod === 'card_on_file' ? "border-primary" : "border-border bg-white")}>
                                            {hasCardOnFile ? <ShieldCheck className="w-6 h-6 mb-2 text-primary" /> : <Lock className="w-6 h-6 mb-2 text-slate-400" />}
                                            <span className="text-[10px] font-black uppercase tracking-widest text-slate-900 leading-none">Card on File</span>
                                            {hasCardOnFile ? (
                                                <span className="text-[8px] text-primary/60 font-black uppercase mt-2 tracking-tighter">{client?.cardOnFile?.brand} •••• {client?.cardOnFile?.last4}</span>
                                            ) : (
                                                <span className="text-[8px] text-muted-foreground font-bold uppercase mt-2 opacity-60">No Vaulted Card</span>
                                            )}
                                        </div>
                                    </label>
                                    <label htmlFor="pay-balance" className="cursor-pointer flex-1 h-full">
                                        <RadioGroupItem value="add_to_balance" id="pay-balance" className="peer sr-only" />
                                        <div className={cn("flex flex-col items-center justify-center p-5 border-2 rounded-[2rem] transition-all text-center h-full peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/5 peer-data-[state=checked]:shadow-lg", paymentMethod === 'add_to_balance' ? "border-primary" : "border-border bg-white")}>
                                            <Landmark className={cn("w-6 h-6 mb-2 transition-colors", paymentMethod === 'add_to_balance' ? "text-primary" : "text-muted-foreground opacity-40")} />
                                            <span className="text-[10px] font-black uppercase tracking-widest text-slate-900 leading-none">Client Arrears</span>
                                            <span className="text-[8px] text-muted-foreground font-bold uppercase mt-2 opacity-60">Add to Dossier Balance</span>
                                        </div>
                                    </label>
                                </RadioGroup>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </ScrollArea>

        <DialogFooter className="p-8 pt-4 border-t bg-muted/5 flex flex-col gap-3 shrink-0">
            <Button 
                onClick={handleAction} 
                className="w-full h-16 rounded-[2rem] text-xl font-black uppercase shadow-2xl shadow-primary/30 transition-all active:scale-95 group"
                disabled={isSubmitting}
            >
                {isSubmitting ? (
                    <Loader className="w-6 h-6 animate-spin" />
                ) : (
                    <>
                        Finalize Termination 
                        <ArrowRight className="ml-3 w-5 h-5 transition-transform group-hover:translate-x-1" />
                    </>
                )}
            </Button>
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isSubmitting} className="w-full h-10 font-black uppercase tracking-widest text-[10px] text-slate-400">Abort Cancellation</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
