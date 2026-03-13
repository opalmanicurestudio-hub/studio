
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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { 
    Banknote, 
    Coins, 
    Calculator, 
    KeyRound, 
    Sparkles, 
    ArrowRight, 
    AlertTriangle,
    CheckCircle2,
    Undo2,
    Printer,
    Landmark,
    FileText,
    ArrowDownToLine,
    ArrowUpFromLine,
    Users,
    ShieldCheck
} from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';
import { type TillSession, type Staff } from '@/lib/data';
import { useToast } from '@/hooks/use-toast';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { motion, AnimatePresence } from 'framer-motion';
import { format, parseISO } from 'date-fns';

const safeDate = (val: any): Date => {
    if (!val) return new Date();
    if (val instanceof Date) return val;
    if (typeof val?.toDate === 'function') return val.toDate();
    if (typeof val === 'string') {
        try {
            return parseISO(val);
        } catch {
            return new Date(val);
        }
    }
    if (typeof val === 'object' && 'seconds' in val) {
        return new Date(val.seconds * 1000);
    }
    return new Date(val);
};

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
    const [primaryPin, setPrimaryPin] = useState('');
    const [witnessPin, setWitnessPin] = useState('');
    const [step, setStep] = useState<'count' | 'allocation' | 'verify' | 'success'>('count');
    const [nextDayFloat, setNextDayFloat] = useState<number>(0);
    const [finalSessionData, setFinalSessionData] = useState<any | null>(null);

    const actualTotal = useMemo(() => {
        return denominations.reduce((acc, d) => acc + (counts[d.key] || 0) * d.val, 0);
    }, [counts]);

    useEffect(() => {
        if (open && activeTill && step === 'count') {
            setNextDayFloat(activeTill.openingFloat || 0);
        }
    }, [open, activeTill, step]);

    const cashToDeposit = useMemo(() => {
        return Math.max(0, actualTotal - nextDayFloat);
    }, [actualTotal, nextDayFloat]);

    const handleCountChange = (key: string, val: number) => {
        setCounts(prev => ({ ...prev, [key]: val }));
    };

    const handleAction = () => {
        const authorizedStaff = staff.find(s => s.pin === primaryPin);
        if (!authorizedStaff) {
            toast({ variant: 'destructive', title: 'Invalid PIN', description: 'Primary authenticator not found.' });
            return;
        }

        if (activeTill) {
            const witnessStaff = staff.find(s => s.pin === witnessPin);
            if (!witnessStaff) {
                toast({ variant: 'destructive', title: 'Witness Required', description: 'Invalid Witness PIN.' });
                return;
            }
            if (witnessStaff.id === authorizedStaff.id) {
                toast({ variant: 'destructive', title: 'Audit Conflict', description: 'The witness must be a different staff member.' });
                return;
            }

            const discrepancy = actualTotal - activeTill.expectedCash;
            const closingData = {
                actualCash: actualTotal,
                cashToDeposit,
                nextDayFloat,
                closingDenominations: counts,
                closedBy: authorizedStaff.id,
                verifiedBy: witnessStaff.id,
                discrepancy,
                closedAt: new Date().toISOString()
            };
            setFinalSessionData({ ...activeTill, ...closingData, staffName: authorizedStaff.name, witnessName: witnessStaff.name });
            onCloseTill(closingData);
            setStep('success');
        } else {
            onOpenTill({
                openingFloat: actualTotal,
                openingDenominations: counts,
                openedBy: authorizedStaff.id,
            });
            onOpenChange(false);
            resetState();
        }
    };

    const resetState = () => {
        setCounts({});
        setPrimaryPin('');
        setWitnessPin('');
        setStep('count');
        setFinalSessionData(null);
    };

    const handleClose = () => {
        onOpenChange(false);
        setTimeout(resetState, 300);
    };

    const DialogComponent = isMobile ? Sheet : Dialog;
    const ContentComponent = isMobile ? SheetContent : DialogContent;

    return (
        <DialogComponent open={open} onOpenChange={handleClose}>
            <ContentComponent side={isMobile ? "bottom" : "right"} className={cn("p-0 border-none bg-background flex flex-col shadow-3xl overflow-hidden", isMobile ? "h-[92dvh] rounded-t-[3rem]" : "sm:max-w-xl max-h-[90dvh]")}>
                <DialogHeader className={cn("flex-shrink-0 text-left border-b bg-muted/5", isMobile ? "p-8 pb-6" : "p-8 pb-6")}>
                    <div className="flex items-center gap-3 mb-2">
                        <Calculator className="w-5 h-5 text-primary" />
                        <span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground opacity-60">Financial Protocol</span>
                    </div>
                    <DialogTitle className="text-2xl md:text-3xl font-black uppercase tracking-tighter text-slate-900 leading-none">
                        {step === 'success' ? 'Audit Certified' : activeTill ? 'Till Reconciliation' : 'Open Studio Till'}
                    </DialogTitle>
                </DialogHeader>

                <ScrollArea className="flex-1">
                    <div className="p-8 pb-32">
                        <AnimatePresence mode="wait">
                            {step === 'count' && (
                                <motion.div key="count" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-10">
                                    {activeTill && (
                                        <Card className="bg-primary/5 border-2 border-primary/10 rounded-[2rem] shadow-inner overflow-hidden">
                                            <CardContent className="p-6 grid grid-cols-2 gap-6">
                                                <div className="space-y-1 text-left">
                                                    <p className="text-[9px] font-black uppercase text-primary tracking-widest">Expected Balance</p>
                                                    <p className="text-3xl font-black font-mono tracking-tighter text-primary">${activeTill.expectedCash.toFixed(2)}</p>
                                                </div>
                                                <div className="space-y-1 text-right border-l border-dashed border-primary/20 pl-6">
                                                    <p className="text-[9px] font-black uppercase text-muted-foreground tracking-widest opacity-60">Session Window</p>
                                                    <p className="text-sm font-black text-slate-900">{format(safeDate(activeTill.openedAt), 'h:mm a')}</p>
                                                </div>
                                            </CardContent>
                                        </Card>
                                    )}
                                    <div className="grid grid-cols-1 gap-2">
                                        {denominations.map(d => <DenominationInput key={d.key} denom={d} count={counts[d.key] || 0} onChange={handleCountChange} />)}
                                    </div>
                                </motion.div>
                            )}

                            {step === 'allocation' && (
                                <motion.div key="allocation" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-8">
                                    <div className="p-8 rounded-[2.5rem] bg-slate-900 text-white text-center space-y-4 shadow-2xl relative overflow-hidden">
                                        <div className="absolute top-0 right-0 p-6 opacity-5"><Banknote className="w-32 h-32" /></div>
                                        <div className="space-y-1 relative z-10">
                                            <p className="text-[10px] font-black uppercase tracking-[0.3em] opacity-40">Total Physical Count</p>
                                            <p className="text-6xl font-black font-mono tracking-tighter text-primary">${actualTotal.toFixed(2)}</p>
                                        </div>
                                        {activeTill && (
                                            <div className={cn("inline-flex items-center gap-2 px-4 py-1.5 rounded-full font-black text-[9px] uppercase tracking-widest relative z-10", 
                                                actualTotal >= activeTill.expectedCash ? "bg-green-500/20 text-green-400" : "bg-destructive/20 text-red-400")}>
                                                {actualTotal >= activeTill.expectedCash ? `Overage: +$${(actualTotal - activeTill.expectedCash).toFixed(2)}` : `Shortage: -$${(activeTill.expectedCash - actualTotal).toFixed(2)}`}
                                            </div>
                                        )}
                                    </div>

                                    <div className="space-y-6">
                                        <div className="space-y-3">
                                            <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Float Retention (Remaining in Drawer)</Label>
                                            <div className="relative">
                                                <ArrowDownToLine className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-indigo-500 opacity-40" />
                                                <Input 
                                                    type="number" 
                                                    value={nextDayFloat || ''} 
                                                    onChange={e => setNextDayFloat(parseFloat(e.target.value) || 0)}
                                                    className="h-14 pl-12 rounded-2xl border-2 font-black text-xl shadow-inner bg-muted/5"
                                                />
                                            </div>
                                            <p className="text-[9px] font-bold text-indigo-600/60 uppercase ml-1">Suggested: ${activeTill?.openingFloat.toFixed(2)} (Standard Reset)</p>
                                        </div>

                                        <div className="p-6 rounded-[2rem] border-4 border-primary/20 bg-primary/5 flex justify-between items-center shadow-xl">
                                            <div className="flex items-center gap-3">
                                                <div className="p-2 rounded-xl bg-primary text-white shadow-lg"><ArrowUpFromLine className="w-5 h-5" /></div>
                                                <span className="font-black uppercase tracking-tight text-sm text-slate-900">Final Bank Deposit</span>
                                            </div>
                                            <p className="text-3xl font-black font-mono tracking-tighter text-primary">${cashToDeposit.toFixed(2)}</p>
                                        </div>
                                    </div>
                                </motion.div>
                            )}

                            {step === 'verify' && (
                                <motion.div key="verify" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="space-y-10 py-6 flex flex-col items-center">
                                    <div className="w-full space-y-8">
                                        <div className="space-y-4">
                                            <div className="flex items-center gap-3">
                                                <div className="p-2 bg-primary/10 rounded-xl"><User className="w-5 h-5 text-primary" /></div>
                                                <Label className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground">Primary Auditor PIN</Label>
                                            </div>
                                            <Input 
                                                type="password" 
                                                maxLength={4} 
                                                value={primaryPin} 
                                                onChange={e => setPrimaryPin(e.target.value.replace(/\D/g, ''))}
                                                className="h-16 text-center text-4xl font-black tracking-[0.5em] rounded-2xl border-4 focus-visible:ring-primary/20 shadow-inner bg-muted/5"
                                                placeholder="••••"
                                            />
                                        </div>

                                        {activeTill && (
                                            <div className="space-y-4 pt-6 border-t-2 border-dashed">
                                                <div className="flex items-center gap-3">
                                                    <div className="p-2 bg-primary/10 rounded-xl"><ShieldCheck className="w-5 h-5 text-primary" /></div>
                                                    <Label className="text-[10px] font-black uppercase tracking-[0.2em] text-primary">Witness Verification PIN</Label>
                                                </div>
                                                <Input 
                                                    type="password" 
                                                    maxLength={4} 
                                                    value={witnessPin} 
                                                    onChange={e => setWitnessPin(e.target.value.replace(/\D/g, ''))}
                                                    className="h-16 text-center text-4xl font-black tracking-[0.5em] rounded-2xl border-4 border-primary/20 focus-visible:ring-primary/20 shadow-inner bg-white"
                                                    placeholder="••••"
                                                />
                                                <div className="flex items-start gap-3 p-4 rounded-xl bg-amber-50 border border-amber-100 text-left">
                                                    <Info className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                                                    <p className="text-[9px] font-bold text-amber-700 uppercase leading-relaxed">
                                                        A second provider must witness this count and authorize with their unique studio PIN.
                                                    </p>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </motion.div>
                            )}

                            {step === 'success' && finalSessionData && (
                                <motion.div key="success" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="space-y-8">
                                    <div className="p-8 rounded-[3rem] border-4 border-green-500/20 bg-green-500/5 text-center space-y-4 shadow-xl">
                                        <div className="w-20 h-20 bg-green-500 rounded-[2rem] flex items-center justify-center mx-auto shadow-2xl shadow-green-500/20 rotate-6">
                                            <CheckCircle2 className="w-12 h-12 text-white -rotate-6" />
                                        </div>
                                        <div className="space-y-1">
                                            <h3 className="text-2xl font-black uppercase tracking-tighter text-slate-900">Audit Finalized</h3>
                                            <p className="text-[10px] font-bold uppercase tracking-widest text-green-700">Certified by {finalSessionData.staffName} & {finalSessionData.witnessName}</p>
                                        </div>
                                    </div>

                                    <Card className="rounded-[2.5rem] border-2 shadow-sm overflow-hidden bg-white" id="deposit-slip-print">
                                        <CardHeader className="bg-muted/5 border-b p-6 flex flex-row items-center justify-between">
                                            <div className="flex items-center gap-3">
                                                <FileText className="w-5 h-5 text-primary" />
                                                <CardTitle className="text-[10px] font-black uppercase tracking-widest">Bank Deposit Slip</CardTitle>
                                            </div>
                                            <p className="text-[9px] font-black font-mono">#{finalSessionData.id.slice(-6).toUpperCase()}</p>
                                        </CardHeader>
                                        <CardContent className="p-6 space-y-4 text-left">
                                            <div className="space-y-2 text-[10px] font-bold uppercase text-slate-600">
                                                <div className="flex justify-between"><span>Closing Physical Count</span><span className="font-mono text-slate-900">${finalSessionData.actualCash.toFixed(2)}</span></div>
                                                <div className="flex justify-between"><span>Retained Float</span><span className="font-mono text-indigo-600">-${finalSessionData.nextDayFloat.toFixed(2)}</span></div>
                                                <Separator className="border-dashed" />
                                                <div className="flex justify-between text-base font-black text-primary pt-2">
                                                    <span>NET DEPOSIT TOTAL</span>
                                                    <span className="font-mono">${finalSessionData.cashToDeposit.toFixed(2)}</span>
                                                </div>
                                            </div>
                                            <div className="pt-4 border-t border-dashed space-y-1 text-[8px] font-black uppercase opacity-40">
                                                <p>Certified by: {finalSessionData.staffName}</p>
                                                <p>Witnessed by: {finalSessionData.witnessName}</p>
                                                <p>Timestamp: {format(new Date(), 'MMM d, yyyy @ h:mm a')}</p>
                                            </div>
                                        </CardContent>
                                    </Card>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                </ScrollArea>

                <DialogFooter className={cn("border-t bg-background flex-shrink-0 shadow-2xl p-8 pt-4")}>
                    <div className="flex flex-col gap-3 w-full">
                        {step === 'count' && (
                            <div className="flex gap-3">
                                <Button variant="ghost" onClick={handleClose} className="flex-1 h-14 font-black uppercase tracking-tighter text-[10px] text-slate-400">Cancel</Button>
                                <Button onClick={() => setStep(activeTill ? 'allocation' : 'verify')} disabled={actualTotal <= 0} className="flex-[2] h-14 rounded-2xl font-black uppercase tracking-widest text-[10px] shadow-xl group">
                                    {activeTill ? 'Analyze Yield' : 'Identity Verify'} <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
                                </Button>
                            </div>
                        )}
                        {step === 'allocation' && (
                            <div className="flex gap-3">
                                <Button variant="ghost" onClick={() => setStep('count')} className="flex-1 h-14 font-black uppercase tracking-tighter text-[10px] text-slate-400">Back</Button>
                                <Button onClick={() => setStep('verify')} className="flex-[2] h-14 rounded-2xl font-black uppercase tracking-widest text-[10px] shadow-xl">Dual Authorization</Button>
                            </div>
                        )}
                        {step === 'verify' && (
                            <div className="flex gap-3">
                                <Button variant="ghost" onClick={() => setStep(activeTill ? 'allocation' : 'count')} className="flex-1 h-14 font-black uppercase tracking-tighter text-[10px] text-slate-400">Back</Button>
                                <Button onClick={handleAction} disabled={primaryPin.length < 4 || (activeTill && witnessPin.length < 4)} className="flex-[2] h-14 rounded-2xl font-black uppercase tracking-widest text-[10px] shadow-xl">Commit Audit</Button>
                            </div>
                        )}
                        {step === 'success' && (
                            <div className="flex flex-col gap-3">
                                <Button className="w-full h-16 rounded-2xl font-black uppercase text-[10px] tracking-widest shadow-2xl shadow-primary/30 group" onClick={() => window.print()}>
                                    <Printer className="mr-3 h-5 w-5" /> Print Certified Slip
                                </Button>
                                <Button variant="ghost" onClick={handleClose} className="w-full h-10 font-bold uppercase text-[10px] tracking-widest text-slate-400">Return to Terminal</Button>
                            </div>
                        )}
                    </div>
                </DialogFooter>
            </ContentComponent>
            <style jsx global>{`
                @media print {
                    body * { visibility: hidden; }
                    #deposit-slip-print, #deposit-slip-print * { visibility: visible; }
                    #deposit-slip-print { position: absolute; left: 0; top: 0; width: 3in; margin: 0; }
                }
            `}</style>
        </DialogComponent>
    );
};
