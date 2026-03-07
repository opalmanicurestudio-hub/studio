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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { Appointment, Client } from '@/lib/data';
import { Card, CardContent } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { DollarSign, Calendar, Hash, Fingerprint, Merge, Search, ArrowRight, ShieldCheck, Check } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { ScrollArea } from '../ui/scroll-area';

type DuplicateClient = Client;

export const MergeClientsDialog = ({ 
    open, 
    onOpenChange, 
    allClients,
    allAppointments,
    onMerge
}: { 
    open: boolean, 
    onOpenChange: (open: boolean) => void,
    allClients: Client[],
    allAppointments: Appointment[],
    onMerge: (primaryClientId: string, secondaryClients: Client[]) => void;
}) => {
  const [step, setStep] = useState(1);
  const [email, setEmail] = useState('');
  const [duplicates, setDuplicates] = useState<DuplicateClient[]>([]);
  const [primaryClientId, setPrimaryClientId] = useState<string | null>(null);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const { toast } = useToast();

  const handleFindDuplicates = () => {
    if (!email) return;
    const searchEmail = email.toLowerCase().trim();
    const found = allClients.filter(c => c.email && c.email.toLowerCase() === searchEmail);
    if (found.length < 2) {
      toast({
        variant: 'destructive',
        title: 'No Matches Found',
        description: `Merge requires at least two records with the email: ${email}`,
      });
    } else {
      setDuplicates(found);
      setPrimaryClientId(found[0]?.id || null);
      setStep(2);
    }
  };

  const handleClose = () => {
    onOpenChange(false);
    setTimeout(() => {
        setStep(1);
        setEmail('');
        setDuplicates([]);
        setPrimaryClientId(null);
    }, 300);
  }

  const selectedPrimaryClient = useMemo(() => {
    return duplicates.find(d => d.id === primaryClientId);
  }, [primaryClientId, duplicates]);

  const clientsToMerge = useMemo(() => {
    return duplicates.filter(d => d.id !== primaryClientId);
  }, [primaryClientId, duplicates]);

  const totalAppointmentsToTransfer = useMemo(() => {
    return clientsToMerge.reduce((acc, client) => {
        return acc + allAppointments.filter(apt => apt.clientId === client.id).length;
    }, 0);
  }, [clientsToMerge, allAppointments])

  const handleConfirmMerge = () => {
    if (!primaryClientId) return;
    onMerge(primaryClientId, clientsToMerge);
    setIsConfirmOpen(false);
    handleClose();
  }

  return (
    <>
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-2xl p-0 border-4 rounded-[3rem] overflow-hidden shadow-3xl bg-background">
        <DialogHeader className="p-8 pb-6 border-b bg-muted/5 text-left">
            <div className="flex items-center gap-3 mb-2">
                <Fingerprint className="w-5 h-5 text-primary" />
                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground opacity-60">Operations Suite</span>
            </div>
            <DialogTitle className="text-2xl md:text-3xl font-black uppercase tracking-tighter text-slate-900">Record Reconciler</DialogTitle>
            <DialogDescription className="text-xs font-bold uppercase tracking-widest opacity-60 mt-1">
                {step === 1 ? 'Locate duplicate dossiers via primary identity email.' : 'Identify the master dossier to preserve.'}
            </DialogDescription>
        </DialogHeader>
        
        <div className="p-8">
            {step === 1 && (
                <div className="space-y-6">
                    <div className="space-y-3">
                        <Label htmlFor="email-search-merge" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Identity Filter (Email)</Label>
                        <div className="flex gap-3">
                            <div className="relative flex-1">
                                <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground opacity-40" />
                                <Input
                                    id="email-search-merge"
                                    type="email"
                                    placeholder="SEARCH DUPLICATES..."
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    onKeyDown={(e) => e.key === 'Enter' && handleFindDuplicates()}
                                    className="pl-12 h-14 rounded-2xl border-2 font-black uppercase text-sm tracking-tight focus-visible:ring-primary/20 bg-muted/5 shadow-inner"
                                />
                            </div>
                            <Button onClick={handleFindDuplicates} className="h-14 px-8 rounded-2xl font-black uppercase tracking-widest text-xs shadow-xl shadow-primary/20">Analyze</Button>
                        </div>
                    </div>
                    <p className="text-[10px] text-muted-foreground font-medium uppercase leading-relaxed px-1 opacity-60">
                        Input the email address used across multiple profiles. We will group all matching dossiers for consolidation.
                    </p>
                </div>
            )}

            {step === 2 && (
                <div className="space-y-6">
                    <RadioGroup value={primaryClientId || ''} onValueChange={setPrimaryClientId} className="grid grid-cols-1 gap-3">
                        <ScrollArea className="h-[350px] -mx-2 px-2">
                            <div className="space-y-3 pb-4">
                                {duplicates.map(client => {
                                    const clientAppointments = allAppointments.filter(apt => apt.clientId === client.id);
                                    const isSelected = primaryClientId === client.id;
                                    return (
                                        <Label key={client.id} htmlFor={`primary-client-sel-${client.id}`} className="block">
                                            <div className={cn(
                                                "relative p-5 rounded-[2rem] border-2 transition-all cursor-pointer group",
                                                isSelected ? "border-primary bg-primary/5 shadow-md ring-4 ring-primary/10" : "border-border/50 bg-white hover:border-primary/20"
                                            )}>
                                                <div className="flex items-start gap-4">
                                                    <div className="pt-1">
                                                        <RadioGroupItem value={client.id} id={`primary-client-sel-${client.id}`} className="h-5 w-5 border-2" />
                                                    </div>
                                                    <Avatar className="w-14 h-14 border-2 border-background shadow-lg rounded-2xl shrink-0">
                                                        <AvatarImage src={client.avatarUrl} alt={client.name} className="object-cover" />
                                                        <AvatarFallback className="font-black bg-primary/10 text-primary">{(client.name || 'G').charAt(0)}</AvatarFallback>
                                                    </Avatar>
                                                    <div className="flex-1 min-w-0 space-y-3">
                                                        <div className="space-y-0.5">
                                                            <p className="font-black uppercase tracking-tight text-slate-900 truncate">{client.name}</p>
                                                            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest opacity-60">Record ID: {client.id.slice(-6).toUpperCase()}</p>
                                                        </div>
                                                        <div className="grid grid-cols-3 gap-2">
                                                            <div className="px-2 py-1 rounded-lg bg-muted/30 border flex flex-col items-center">
                                                                <span className="text-[8px] font-black uppercase text-muted-foreground opacity-60">Yield</span>
                                                                <span className="text-xs font-black font-mono tracking-tighter">${client.lifetimeValue.toFixed(0)}</span>
                                                            </div>
                                                            <div className="px-2 py-1 rounded-lg bg-muted/30 border flex flex-col items-center">
                                                                <span className="text-[8px] font-black uppercase text-muted-foreground opacity-60">Sessions</span>
                                                                <span className="text-xs font-black font-mono tracking-tighter">{clientAppointments.length}</span>
                                                            </div>
                                                            <div className="px-2 py-1 rounded-lg bg-muted/30 border flex flex-col items-center">
                                                                <span className="text-[8px] font-black uppercase text-muted-foreground opacity-60">Since</span>
                                                                <span className="text-xs font-black uppercase tracking-tighter">{client.lastAppointment ? format(new Date(client.lastAppointment), "MMM yy") : 'N/A'}</span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                    {isSelected && (
                                                        <Badge className="bg-primary text-white border-none font-black text-[8px] h-5 px-2 rounded-lg shadow-sm">MASTER</Badge>
                                                    )}
                                                </div>
                                            </div>
                                        </Label>
                                    )
                                })}
                            </div>
                        </ScrollArea>
                    </RadioGroup>
                </div>
            )}
        </div>

        <DialogFooter className="p-8 pt-4 border-t bg-muted/5">
          <div className="flex w-full gap-4">
            {step === 2 && <Button variant="ghost" onClick={() => setStep(1)} className="h-14 font-black uppercase tracking-tighter text-sm text-slate-400">Back</Button>}
            <div className="flex-1" />
            <Button variant="outline" onClick={handleClose} className="h-14 px-8 rounded-2xl border-2 font-black uppercase text-[10px] tracking-widest bg-white">Cancel</Button>
            {step > 1 && (
                <Button 
                    onClick={() => setIsConfirmOpen(true)} 
                    disabled={!primaryClientId}
                    className="h-14 px-10 rounded-2xl font-black uppercase tracking-widest text-[10px] shadow-2xl shadow-primary/20"
                >
                    Review Merge <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>

     <AlertDialog open={isConfirmOpen} onOpenChange={setIsConfirmOpen}>
        <AlertDialogContent className="rounded-[3rem] border-4 shadow-3xl p-0 overflow-hidden">
            <AlertDialogHeader className="p-8 pb-6 border-b bg-muted/5 text-left">
                <div className="flex items-center gap-3 mb-2">
                    <Merge className="w-5 h-5 text-primary" />
                    <span className="text-[10px] font-black uppercase tracking-[0.2em] text-primary">Final Authorization</span>
                </div>
                <AlertDialogTitle className="text-2xl font-black uppercase tracking-tighter">Confirm Consolidation</AlertDialogTitle>
                <AlertDialogDescription className="text-sm font-bold text-slate-600 leading-relaxed uppercase tracking-tight">
                    You are merging <strong className="text-slate-900">{clientsToMerge.length} records</strong> into the master dossier of <strong className="text-primary">{selectedPrimaryClient?.name}</strong>.
                </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="p-8 space-y-6">
                <div className="p-6 rounded-[2rem] bg-primary/[0.03] border-2 border-primary/10 space-y-4 shadow-inner">
                    <p className="text-[10px] font-black uppercase text-primary tracking-widest text-center">Consolidation Impact</p>
                    <div className="grid gap-3">
                        <div className="flex justify-between items-center bg-white p-3 rounded-xl border shadow-sm">
                            <span className="text-[10px] font-bold text-muted-foreground uppercase">Migrating Sessions</span>
                            <span className="font-black text-slate-900">{totalAppointmentsToTransfer} Appointments</span>
                        </div>
                        <div className="flex justify-between items-center bg-white p-3 rounded-xl border shadow-sm">
                            <span className="text-[10px] font-bold text-muted-foreground uppercase">Aggregating LTV</span>
                            <span className="font-black text-green-600 font-mono">+${clientsToMerge.reduce((sum, c) => sum + (c.lifetimeValue || 0), 0).toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between items-center bg-white p-3 rounded-xl border shadow-sm">
                            <span className="text-[10px] font-bold text-muted-foreground uppercase">Transferring Debt</span>
                            <span className="font-black text-destructive font-mono">+${clientsToMerge.reduce((sum, c) => sum + (c.outstandingBalance || 0), 0).toFixed(2)}</span>
                        </div>
                    </div>
                </div>
                <div className="p-4 rounded-xl border-2 border-dashed bg-destructive/5 border-destructive/20 flex items-start gap-3">
                    <AlertTriangle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
                    <p className="text-[10px] font-black uppercase text-destructive leading-relaxed">This action will permanently delete secondary records. It cannot be reversed.</p>
                </div>
            </div>
            <AlertDialogFooter className="p-8 pt-4 bg-muted/5 border-t gap-3 flex-col sm:flex-col">
                <Button onClick={handleConfirmMerge} className="w-full h-16 rounded-2xl font-black uppercase text-lg tracking-tight shadow-2xl shadow-primary/30">Authorize Merge</Button>
                <AlertDialogCancel className="w-full h-12 rounded-xl font-bold uppercase text-[10px] tracking-widest border-none bg-transparent">Abort</AlertDialogCancel>
            </AlertDialogFooter>
        </AlertDialogContent>
    </AlertDialog>
    </>
  );
};
