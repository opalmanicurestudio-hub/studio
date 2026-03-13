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
import { Card, CardContent } from '@/components/ui/card';
import { 
    Banknote, 
    Coins, 
    Calculator, 
    KeyRound, 
    Sparkles, 
    ArrowRight, 
    AlertTriangle,
    CheckCircle2,
    Undo2
} from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';
import { type TillSession, type TillDenominations, type Staff } from '@/lib/data';
import { useToast } from '@/hooks/use-toast';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { motion, AnimatePresence } from 'framer-motion';
import { format, parseISO } from 'date-fns';

const denominations = [
    { key: 'bills_100', label: '$100', val: 100, icon: Banknote },
    { key: 'bills_50', label: '$50', val: 50, icon: Banknote },
    { key: 'bills_20', label: '$20', val: 20, icon: Banknote },
    { key: 'bills_10', label: '$10', val: 10, icon: Banknote },
    { key: 'bills_5', label: '$5', val: 5, icon: Banknote },
    { key: 'bills_1', label: '$1', val: 1, icon: Banknote },
    { key: 'coins_25', label: '25¢', val: 0.25, icon: Coins },
    { key: 'coins_10', label: '10¢', val: 0.10, icon: Coins },
    { key: 'coins_05', label: '5¢', val: 0.05, icon: Coins },
    { key: 'coins_01', label: '1¢', val: 0.01, icon: Coins },
];

const DenominationInput = ({ denom, count, onChange }: any) => {
    const Icon = denom.icon;
    return (
        <div className="flex items-center justify-between p-3 rounded-2xl border-2 bg-background hover:border-primary/20 transition-all group">
            <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-muted group-hover:bg-primary/10 transition-colors">
                    <Icon className="w-4 h-4 text-muted-foreground group-hover:text-primary" />
                </div>
                <span className="font-black uppercase tracking-tight text-xs">{denom.label}</span>
            </div>
            <div className="flex items-center gap-3">
                <Input 
                    type="number" 
                    value={count || ''} 
                    onChange={e => onChange(denom.key, parseInt(e.target.value) || 0)}
                    placeholder="0"
                    className="w-20 h-10 text-center font-black rounded-xl border-2 focus-visible:ring-primary/20 bg-muted/5 shadow-inner"
                />
                <div className="w-20 text-right">
                    <p className="font-mono text-xs font-black text-slate-900">${((count || 0) * denom.val).toFixed(2)}</p>
                </div>
            </div>
        </div>
    );
};

export const TillManagement = ({ 
    open, 
    onOpenChange, 
    activeTill, 
    staff,
    onOpenTill,
    onCloseTill 
}: { 
    open: boolean, 
    onOpenChange: (open: boolean) => void, 
    activeTill: TillSession | null,
    staff: Staff[],
    onOpenTill: (data: any) => void,
    onCloseTill: (data: any) => void
}) => {
    const isMobile = useIsMobile();
    const { toast } = useToast();
    const [counts, setCounts] = useState<Record<string, number>>({});
    const [pin, setPin] = useState('');
    const [step, setStep] = useState<'count' | 'verify'>('count');

    const total = useMemo(() => {
        return denominations.reduce((acc, d) => acc + (counts[d.key] || 0) * d.val, 0);
    }, [counts]);

    const handleCountChange = (key: string, val: number) => {
        setCounts(prev => ({ ...prev, [key]: val }));
    };

    const handleAction = () => {
        const authorizedStaff = staff.find(s => s.pin === pin);
        if (!authorizedStaff) {
            toast({ variant: 'destructive', title: 'Invalid PIN', description: 'Authentication required to finalize till session.' });
            return;
        }

        if (activeTill) {
            onCloseTill({
                actualCash: total,
                closingDenominations: counts,
                closedBy: authorizedStaff.id,
            });
        } else {
            onOpenTill({
                openingFloat: total,
                openingDenominations: counts,
                openedBy: authorizedStaff.id,
            });
        }
        
        onOpenChange(false);
        setCounts({});
        setPin('');
        setStep('count');
    };

    const DialogComponent = isMobile ? Sheet : Dialog;
    const ContentComponent = isMobile ? SheetContent : DialogContent;

    return (
        <DialogComponent open={open} onOpenChange={onOpenChange}>
            <ContentComponent side={isMobile ? "bottom" : "right"} className={cn("p-0 border-none bg-background flex flex-col shadow-3xl overflow-hidden", isMobile ? "h-[92dvh] rounded-t-[3rem]" : "sm:max-w-xl max-h-[90dvh]")}>
                <DialogHeader className="p-8 pb-6 border-b bg-muted/5 text-left flex-shrink-0">
                    <div className="flex items-center gap-3 mb-2">
                        <Calculator className="w-5 h-5 text-primary" />
                        <span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground opacity-60">Financial Protocol</span>
                    </div>
                    <DialogTitle className="text-2xl md:text-3xl font-black uppercase tracking-tighter text-slate-900 leading-none">
                        {activeTill ? 'Till Reconciliation' : 'Open Studio Till'}
                    </DialogTitle>
                    <DialogDescription className="text-[10px] font-bold uppercase tracking-widest opacity-60 mt-1">
                        {activeTill ? 'Finalize the day by performing a physical cash count.' : 'Verify the starting float before accepting cash payments.'}
                    </DialogDescription>
                </DialogHeader>

                <ScrollArea className="flex-1">
                    <div className="p-8 pb-32">
                        <AnimatePresence mode="wait">
                            {step === 'count' ? (
                                <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-10">
                                    {activeTill && (
                                        <Card className="bg-primary/5 border-2 border-primary/10 rounded-[2rem] shadow-inner overflow-hidden">
                                            <CardContent className="p-6 grid grid-cols-2 gap-6">
                                                <div className="space-y-1 text-left">
                                                    <p className="text-[9px] font-black uppercase text-primary tracking-widest">Expected Balance</p>
                                                    <p className="text-3xl font-black font-mono tracking-tighter text-primary">${activeTill.expectedCash.toFixed(2)}</p>
                                                </div>
                                                <div className="space-y-1 text-right border-l border-dashed border-primary/20 pl-6">
                                                    <p className="text-[9px] font-black uppercase text-muted-foreground tracking-widest opacity-60">Session Opened</p>
                                                    <p className="text-sm font-black text-slate-900">{format(parseISO(activeTill.openedAt), 'h:mm a')}</p>
                                                </div>
                                            </CardContent>
                                        </Card>
                                    )}

                                    <div className="space-y-4">
                                        <div className="flex items-center justify-between px-1">
                                            <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Denomination Matrix</Label>
                                            <Button variant="ghost" size="xs" onClick={() => setCounts({})} className="h-6 px-2 text-[8px] font-black uppercase text-slate-400">Clear Matrix</Button>
                                        </div>
                                        <div className="grid grid-cols-1 gap-2">
                                            {denominations.map(d => (
                                                <DenominationInput key={d.key} denom={d} count={counts[d.key] || 0} onChange={handleCountChange} />
                                            ))}
                                        </div>
                                    </div>
                                </motion.div>
                            ) : (
                                <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="space-y-10 py-10 flex flex-col items-center">
                                    <div className="w-24 h-24 bg-primary/10 rounded-[2.5rem] flex items-center justify-center shadow-2xl shadow-primary/5 rotate-6">
                                        <KeyRound className="w-12 h-12 text-primary -rotate-6" />
                                    </div>
                                    <div className="text-center space-y-2">
                                        <h3 className="text-2xl font-black uppercase tracking-tighter text-slate-900">Authorize Session</h3>
                                        <p className="text-sm font-medium text-slate-500 uppercase tracking-tight">Enter your 4-digit PIN to commit counts.</p>
                                    </div>
                                    <div className="w-48 space-y-4">
                                        <Input 
                                            type="password" 
                                            maxLength={4} 
                                            value={pin} 
                                            onChange={e => setPin(e.target.value.replace(/\D/g, ''))}
                                            className="h-20 rounded-3xl border-4 text-center text-5xl font-black tracking-[0.5em] focus-visible:ring-primary/20 shadow-inner"
                                            autoFocus
                                        />
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                </ScrollArea>

                <DialogFooter className="p-8 pt-4 border-t bg-background flex-shrink-0 shadow-2xl">
                    <div className="flex flex-col gap-3 w-full">
                        <div className="flex justify-between items-center p-6 rounded-[2rem] bg-slate-900 text-white shadow-3xl mb-2">
                            <div className="space-y-0.5 text-left">
                                <p className="text-[10px] font-black uppercase tracking-widest opacity-40">Physical Count Total</p>
                                <p className="text-xs font-bold uppercase opacity-60">Verified Sum</p>
                            </div>
                            <p className="text-4xl font-black font-mono tracking-tighter text-primary">${total.toFixed(2)}</p>
                        </div>
                        
                        <div className="grid grid-cols-2 gap-3">
                            {step === 'count' ? (
                                <>
                                    <Button variant="ghost" onClick={() => onOpenChange(false)} className="h-14 font-black uppercase tracking-tighter text-[10px] text-slate-400">Cancel</Button>
                                    <Button onClick={() => setStep('verify')} disabled={total <= 0} className="h-14 rounded-2xl font-black uppercase tracking-widest text-[10px] shadow-xl group">
                                        Next: Identity Verify <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
                                    </Button>
                                </>
                            ) : (
                                <>
                                    <Button variant="ghost" onClick={() => setStep('count')} className="h-14 font-black uppercase tracking-widest text-[10px] text-slate-400">Back to Count</Button>
                                    <Button onClick={handleAction} disabled={pin.length < 4} className="h-14 rounded-2xl font-black uppercase tracking-widest text-[10px] shadow-xl">
                                        {activeTill ? 'Commit Reconciliation' : 'Initialize Float'}
                                    </Button>
                                </>
                            )}
                        </div>
                    </div>
                </DialogFooter>
            </ContentComponent>
        </DialogComponent>
    );
};
