
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
import { DollarSign, Calendar, Hash } from 'lucide-react';
import { format } from 'date-fns';

type DuplicateClient = Client;

export const MergeClientsDialog = ({ 
    open, 
    onOpenChange, 
    allClients,
    allAppointments
}: { 
    open: boolean, 
    onOpenChange: (open: boolean) => void,
    allClients: Client[],
    allAppointments: Appointment[]
}) => {
  const [step, setStep] = useState(1);
  const [email, setEmail] = useState('');
  const [duplicates, setDuplicates] = useState<DuplicateClient[]>([]);
  const [primaryClientId, setPrimaryClientId] = useState<string | null>(null);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const { toast } = useToast();

  const handleFindDuplicates = () => {
    if (!email) return;
    const found = allClients.filter(c => c.email.toLowerCase() === email.toLowerCase());
    if (found.length < 2) {
      toast({
        title: 'No Duplicates Found',
        description: `No duplicate profiles were found for the email: ${email}`,
      });
    } else {
      setDuplicates(found);
      setStep(2);
    }
  };

  const handleClose = () => {
    onOpenChange(false);
    // Reset state after a short delay to allow for animations
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

  const handleMerge = () => {
      // In a real app, this would trigger a Firestore writeBatch.
      console.log("Merging clients...", {
          primary: selectedPrimaryClient,
          deleting: clientsToMerge,
      });
      toast({
          title: "Merge Successful",
          description: `Clients have been merged into ${selectedPrimaryClient?.name}'s profile.`,
      })
      setIsConfirmOpen(false);
      handleClose();
  }

  return (
    <>
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Merge Duplicate Clients</DialogTitle>
          <DialogDescription>
            {step === 1 ? 'Find and combine duplicate client profiles into a single primary record.' : 'Select the primary profile to keep. All data from other profiles will be merged into it.'}
          </DialogDescription>
        </DialogHeader>
        
        {step === 1 && (
            <div className="grid gap-4 py-4">
                <div className="space-y-2">
                    <Label htmlFor="email-search">Client Email</Label>
                    <div className="flex gap-2">
                        <Input
                            id="email-search"
                            type="email"
                            placeholder="Enter email to find duplicates"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleFindDuplicates()}
                        />
                         <Button onClick={handleFindDuplicates}>Find</Button>
                    </div>
                </div>
            </div>
        )}

        {step === 2 && (
            <div className="grid gap-6 py-4 max-h-[60vh] overflow-y-auto pr-4 -mr-4">
                <RadioGroup value={primaryClientId || ''} onValueChange={setPrimaryClientId}>
                    <div className="space-y-4">
                    {duplicates.map(client => {
                        const clientAppointments = allAppointments.filter(apt => apt.clientId === client.id);
                        return (
                            <Label key={client.id} htmlFor={`client-${client.id}`} className="block">
                                <Card className={`cursor-pointer hover:border-primary ${primaryClientId === client.id ? 'border-primary ring-2 ring-primary' : ''}`}>
                                    <CardContent className="p-4">
                                        <div className="flex items-start gap-4">
                                            <RadioGroupItem value={client.id} id={`client-${client.id}`} className="mt-1" />
                                            <Avatar className="w-12 h-12 border">
                                                <AvatarImage src={client.avatarUrl} alt={client.name} />
                                                <AvatarFallback>{client.name.charAt(0)}</AvatarFallback>
                                            </Avatar>
                                            <div className="flex-1 space-y-2">
                                                <p className="font-semibold">{client.name}</p>
                                                <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
                                                     <div className="flex items-center gap-1.5"><DollarSign className="w-3 h-3" /> LTV: ${client.lifetimeValue.toFixed(2)}</div>
                                                     <div className="flex items-center gap-1.5"><Hash className="w-3 h-3" /> Appts: {clientAppointments.length}</div>
                                                     <div className="flex items-center gap-1.5"><Calendar className="w-3 h-3" /> Last seen: {format(new Date(client.lastAppointment), "MMM yyyy")}</div>
                                                </div>
                                            </div>
                                        </div>
                                    </CardContent>
                                </Card>
                            </Label>
                        )
                    })}
                    </div>
                </RadioGroup>
            </div>
        )}

        <DialogFooter>
            <Button variant="outline" onClick={handleClose}>Cancel</Button>
            {step > 1 && (
                <Button onClick={() => setIsConfirmOpen(true)} disabled={!primaryClientId}>Merge Profiles</Button>
            )}
        </DialogFooter>
      </DialogContent>
    </Dialog>

     <AlertDialog open={isConfirmOpen} onOpenChange={setIsConfirmOpen}>
        <AlertDialogContent>
            <AlertDialogHeader>
            <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
            <AlertDialogDescription>
                You are about to merge {clientsToMerge.length} profile(s) into{' '}
                <span className="font-bold">{selectedPrimaryClient?.name}</span>. 
                This action will permanently delete the other profiles. A total of{' '}
                <span className="font-bold">{totalAppointmentsToTransfer}</span> appointments and their associated data will be transferred.
                This cannot be undone.
            </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleMerge} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                Yes, Merge Clients
            </AlertDialogAction>
            </AlertDialogFooter>
        </AlertDialogContent>
    </AlertDialog>
    </>
  );
};
