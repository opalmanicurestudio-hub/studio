
'use client';

import React, { useState, useMemo } from 'react';
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
    HeartHandshake, 
    Sparkles, 
    ArrowRight, 
    Wallet, 
    Gift, 
    Coffee, 
    Zap, 
    Landmark,
    ShieldCheck,
    Check,
    DollarSign,
    Target,
    Activity,
    Users,
    KeyRound,
    Loader
} from 'lucide-react';
import { cn, safeNumber } from '@/lib/utils';
import { type Client, type Service, type InventoryItem, type Staff, type OneTimePerk } from '@/lib/data';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useInventory } from '@/context/InventoryContext';
import { useTenant } from '@/context/TenantContext';
import { useFirebase } from '@/firebase';
import { doc, collection, writeBatch, increment, arrayUnion } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { nanoid } from 'nanoid';

interface IssueRecoveryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  client: Client;
}

type RecoveryMode = 'wallet' | 'service' | 'hospitality';

export const IssueRecoveryDialog: React.FC<IssueRecoveryDialogProps> = ({
  open,
  onOpenChange,
  client,
}) => {
  const isMobile = useIsMobile();
  const { services, inventory, staff } = useInventory();
  const { selectedTenant, user } = useTenant();
  const { firestore } = useFirebase();
  const { toast } = useToast();
  const tenantId = selectedTenant?.id;

  const [mode, setMode] = useState<RecoveryMode>('wallet');
  const [amount, setAmount] = useState<number>(0);
  const [selectedItemId, setSelectedItemId] = useState('');
  const [reason, setReason] = useState('');
  const [pin, setPin] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleAction = async () => {
    if (!firestore || !tenantId || !user) return;
    
    // 1. PIN VERIFICATION
    const authorizer = staff.find(s => s.pin === pin && (s.role === 'admin' || s.role === 'owner'));
    if (!authorizer) {
        toast({ variant: 'destructive', title: 'Invalid PIN', description: 'Manager authorization required for post-op recovery.' });
        return;
    }

    if (!reason.trim()) {
        toast({ variant: 'destructive', title: 'Reason Required' });
        return;
    }

    setIsSubmitting(true);
    const batch = writeBatch(firestore);
    const now = new Date().toISOString();
    const clientRef = doc(firestore, `tenants/${tenantId}/clients`, client.id);
    const txnRef = doc(collection(firestore, `tenants/${tenantId}/transactions`));

    let txnDescription = '';
    let txnAmount = 0;

    if (mode === 'wallet') {
        txnDescription = `Wallet Credit Issued: ${reason}`;
        txnAmount = amount;
        batch.update(clientRef, { walletCredit: increment(amount) });
    } else {
        const item = mode === 'service' 
            ? services.find(s => s.id === selectedItemId)
            : inventory.find(i => i.id === selectedItemId);
        
        if (!item) return;

        const newPerk: OneTimePerk = {
            id: nanoid(),
            name: item.name,
            type: mode === 'service' ? 'service' : 'product',
            grantedAt: now,
            reason: reason,
            grantedBy: authorizer.id,
            isRedeemed: false
        };

        txnDescription = `Voucher Issued: ${item.name} (${reason})`;
        txnAmount = mode === 'service' ? (item as Service).cost : (item as InventoryItem).costPerUnit || 0;
        
        batch.update(clientRef, { oneTimePerks: arrayUnion(newPerk) });
    }

    // CREATE AUDIT TRANSACTION
    batch.set(txnRef, {
        id: txnRef.id,
        date: now,
        description: txnDescription,
        clientOrVendor: client.name,
        clientId: client.id,
        type: 'expense',
        context: 'Business',
        category: 'Service Recovery',
        amount: txnAmount,
        paymentMethod: 'Internal Protocol',
        staffId: authorizer.id,
        hasReceipt: false,
        notes: `Manual Post-Op Recovery issued. Reason: ${reason}`
    });

    try {
        await batch.commit();
        toast({ title: "Protocol Committed", description: `${mode === 'wallet' ? `$${amount.toFixed(2)} added to wallet` : 'Voucher issued'} for ${client.name}.` });
        onOpenChange(false);
        resetForm();
    } catch (e) {
        console.error(e);
        toast({ variant: 'destructive', title: "Process Error" });
    } finally {
        setIsSubmitting(false);
    }
  };

  const resetForm = () => {
      setMode('wallet');
      setAmount(0);
      setSelectedItemId('');
      setReason('');
      setPin('');
  };

  const SectionHeader = ({ icon: Icon, title }: { icon: any, title: string }) => (
    <div className="flex items-center gap-3 mb-6">
        <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center text-primary shadow-inner border border-primary/20 shrink-0">
            <Icon className="w-4 h-4" />
        </div>
        <div className="space-y-0.5 text-left">
            <p className="text-[8px] font-black uppercase tracking-widest text-primary/60">Module Recovery</p>
            <h3 className="text-sm md:text-base font-black uppercase tracking-tighter text-slate-900 leading-none">{title}</h3>
        </div>
    </div>
  );

  const DialogComp = isMobile ? Sheet : Dialog;
  const ContentComp = isMobile ? SheetContent : DialogContent;

  return (
    <DialogComp open={open} onOpenChange={onOpenChange}>
      <ContentComp side={isMobile ? "bottom" : "right"} className={cn("p-0 border-none bg-background flex flex-col shadow-3xl overflow-hidden", isMobile ? "h-[92dvh] rounded-t-[3rem]" : "sm:max-w-xl max-h-[92dvh]")}>
        <SheetHeader className={cn("p-8 pb-6 border-b bg-muted/5 flex-shrink-0 text-left")}>
          <div className="flex items-center gap-3 mb-2">
            <HeartHandshake className="w-5 h-5 text-primary" />
            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground opacity-60">Reputation Suite</span>
          </div>
          <SheetTitle className="text-2xl md:text-3xl font-black uppercase tracking-tighter text-slate-900 leading-none">Issue Recovery</SheetTitle>
          <SheetDescription className="text-xs font-bold uppercase tracking-widest opacity-60 mt-1">Resolution protocol for: <strong>{client.name}</strong></SheetDescription>
        </SheetHeader>

        <ScrollArea className="flex-1">
            <div className="p-8 space-y-10">
                <div className="space-y-4">
                    <SectionHeader icon={Zap} title="Select Yield Type" />
                    <RadioGroup value={mode} onValueChange={(v: any) => setMode(v)} className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <label htmlFor="mode-wallet" className="cursor-pointer">
                            <div className={cn("flex flex-col items-center justify-center p-5 border-2 rounded-[2rem] transition-all h-full text-center", mode === 'wallet' ? "border-primary bg-primary/5 shadow-lg" : "border-border bg-white")}>
                                <Wallet className={cn("w-6 h-6 mb-2", mode === 'wallet' ? "text-primary" : "text-slate-400")} />
                                <span className="text-[9px] font-black uppercase tracking-widest">Wallet Credit</span>
                                <RadioGroupItem value="wallet" id="mode-wallet" className="sr-only" />
                            </div>
                        </label>
                        <label htmlFor="mode-service" className="cursor-pointer">
                            <div className={cn("flex flex-col items-center justify-center p-5 border-2 rounded-[2rem] transition-all h-full text-center", mode === 'service' ? "border-primary bg-primary/5 shadow-lg" : "border-border bg-white")}>
                                <Sparkles className={cn("w-6 h-6 mb-2", mode === 'service' ? "text-primary" : "text-slate-400")} />
                                <span className="text-[9px] font-black uppercase tracking-widest">Service Gift</span>
                                <RadioGroupItem value="service" id="mode-service" className="sr-only" />
                            </div>
                        </label>
                        <label htmlFor="mode-hosp" className="cursor-pointer">
                            <div className={cn("flex flex-col items-center justify-center p-5 border-2 rounded-[2rem] transition-all h-full text-center", mode === 'hospitality' ? "border-primary bg-primary/5 shadow-lg" : "border-border bg-white")}>
                                <Coffee className={cn("w-6 h-6 mb-2", mode === 'hospitality' ? "text-primary" : "text-slate-400")} />
                                <span className="text-[9px] font-black uppercase tracking-widest">Hospitality</span>
                                <RadioGroupItem value="hospitality" id="mode-hosp" className="sr-only" />
                            </div>
                        </label>
                    </RadioGroup>
                </div>

                <div className="space-y-6">
                    <Separator className="border-dashed" />
                    <AnimatePresence mode="wait">
                        {mode === 'wallet' && (
                            <motion.div key="wallet-input" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-3">
                                <Label className="text-[10px] font-black uppercase tracking-widest text-primary ml-1">Credit Allocation Amount</Label>
                                <div className="relative">
                                    <DollarSign className="absolute left-4 top-1/2 -translate-y-1/2 h-6 w-6 text-primary opacity-40" />
                                    <Input 
                                        type="number" 
                                        value={amount || ''} 
                                        onChange={e => setAmount(parseFloat(e.target.value) || 0)}
                                        className="h-20 rounded-[2.5rem] border-4 font-black text-5xl tracking-tighter text-primary text-center bg-primary/5 shadow-inner"
                                    />
                                </div>
                            </motion.div>
                        )}

                        {mode === 'service' && (
                            <motion.div key="service-input" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-3">
                                <Label className="text-[10px] font-black uppercase tracking-widest text-primary ml-1">Select Gift Service</Label>
                                <Select value={selectedItemId} onValueChange={setSelectedItemId}>
                                    <SelectTrigger className="h-14 rounded-2xl border-2 font-black uppercase text-xs tracking-tight shadow-inner bg-muted/5">
                                        <SelectValue placeholder="CHOOSE TREATMENT..." />
                                    </SelectTrigger>
                                    <SelectContent className="rounded-xl border-2 shadow-2xl">
                                        {services.map(s => <SelectItem key={s.id} value={s.id} className="font-bold uppercase text-[10px] tracking-widest">{s.name}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </motion.div>
                        )}

                        {mode === 'hospitality' && (
                            <motion.div key="hosp-input" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-3">
                                <Label className="text-[10px] font-black uppercase tracking-widest text-primary ml-1">Select Amenity Gift</Label>
                                <Select value={selectedItemId} onValueChange={setSelectedItemId}>
                                    <SelectTrigger className="h-14 rounded-2xl border-2 font-black uppercase text-xs tracking-tight shadow-inner bg-muted/5">
                                        <SelectValue placeholder="CHOOSE AMENITY..." />
                                    </SelectTrigger>
                                    <SelectContent className="rounded-xl border-2 shadow-2xl">
                                        {inventory.filter(i => i.type === 'refreshment').map(i => <SelectItem key={i.id} value={i.id} className="font-bold uppercase text-[10px] tracking-widest">{i.name}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </motion.div>
                        )}
                    </AnimatePresence>

                    <div className="space-y-3">
                        <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Resolution Justification</Label>
                        <Textarea 
                            value={reason}
                            onChange={e => setReason(e.target.value)}
                            placeholder="Detail the complaint and why this recovery is being issued..."
                            className="rounded-2xl border-2 bg-muted/5 min-h-[120px] focus-visible:ring-primary/20 font-medium p-6 shadow-inner"
                        />
                    </div>

                    <div className="space-y-4 pt-4 border-t border-dashed">
                        <div className="flex items-center gap-3 px-1">
                            <div className="p-2 bg-muted rounded-xl"><Lock className="w-4 h-4 text-slate-400" /></div>
                            <Label className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground">Manager Authorization PIN</Label>
                        </div>
                        <Input 
                            type="password" 
                            maxLength={4} 
                            value={pin} 
                            onChange={e => setPin(e.target.value.replace(/\D/g, ''))}
                            className="h-16 text-center text-4xl font-black tracking-[0.5em] rounded-2xl border-4 focus-visible:ring-primary/20 shadow-inner bg-muted/5"
                            placeholder="••••"
                        />
                    </div>
                </div>
            </div>
        </ScrollArea>

        <DialogFooter className="p-8 pt-4 border-t bg-muted/5 shrink-0 flex flex-col gap-3">
            <Button onClick={handleAction} disabled={isSubmitting || !reason.trim() || pin.length < 4} className="w-full h-16 rounded-[2rem] text-xl font-black uppercase shadow-2xl shadow-primary/30 active:scale-95 transition-all">
                {isSubmitting ? <Loader className="animate-spin" /> : 'Certify Recovery'}
            </Button>
            <Button variant="ghost" onClick={() => onOpenChange(false)} className="w-full font-black uppercase text-[10px] tracking-widest text-slate-400">Abort Protocol</Button>
        </DialogFooter>
      </ContentComp>
    </DialogComp>
  );
};
