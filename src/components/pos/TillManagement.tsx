
'use client';

import React, { useState, useMemo, useEffect, useRef } from 'react';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
    ShieldCheck,
    User,
    History,
    FileSignature,
    Search,
    Filter,
    Calendar,
    ChevronRight,
    ArrowDown,
    HeartHandshake,
    PackageOpen,
    Check
} from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';
import { type TillSession, type Staff, type TillDenominations } from '@/lib/data';
import { useToast } from '@/hooks/use-toast';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { motion, AnimatePresence } from 'framer-motion';
import { format, parseISO, isSameDay, startOfDay, subDays, isAfter } from 'date-fns';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import SignatureCanvas from 'react-signature-canvas';
import { useInventory } from '@/context/InventoryContext';

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

const DenominationInput = ({ denom, count, onChange, disabled }: any) => {
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
                    disabled={disabled}
                    className="w-20 h-10 text-center font-black rounded-xl border-2 focus-visible:ring-primary/20 bg-muted/5 shadow-inner"
                />
                <div className="w-20 text-right">
                    <p className="font-mono text-xs font-black text-slate-900">${((count || 0) * denom.val).toFixed(2)}</p>
                </div>
            </div>
        </div>
    );
};

const DepositSlip = ({ session, staff }: { session: any, staff: Staff[] }) => {
    const closedBy = staff.find(s => s.id === session.closedBy);
    const verifiedBy = staff.find(s => s.id === session.verifiedBy);
    const openedBy = staff.find(s => s.id === session.openedBy);

    const depositDenoms = denominations.map(d => ({
        ...d,
        count: session.depositDenominations?.[d.key] || 0
    })).filter(d => d.count > 0);

    return (
        <div className="bg-white p-6 md:p-8 rounded-none border shadow-none font-mono text-xs text-black space-y-6 w-[300px] mx-auto text-left" id="deposit-slip-print">
            <div className="text-center space-y-2">
                <div className="flex justify-center mb-2">
                    <Landmark className="w-10 h-10" />
                </div>
                <h2 className="text-sm font-black uppercase tracking-widest">Studio Deposit Slip</h2>
                <p className="text-[10px] font-bold">Session ID: {session.id.toUpperCase()}</p>
                <p className="text-[9px] opacity-60">{format(safeDate(session.closedAt || session.openedAt), 'MMM d, yyyy @ h:mm a')}</p>
            </div>

            <Separator className="border-dashed border-black" />

            <div className="space-y-4">
                <p className="text-[10px] font-black uppercase tracking-widest border-b border-black pb-1 text-center">Bank Deposit Manifest</p>
                <div className="space-y-1">
                    {depositDenoms.length > 0 ? depositDenoms.map(d => (
                        <div key={d.key} className="flex justify-between items-center">
                            <span>{d.count} x {d.label}</span>
                            <span>${(d.count * d.val).toFixed(2)}</span>
                        </div>
                    )) : <p className="text-center italic opacity-40 py-2">No physical deposit</p>}
                </div>
                <div className="flex justify-between font-black border-t border-dashed border-black pt-2 text-sm">
                    <span>Net Deposit</span>
                    <span>${(session.cashToDeposit || 0).toFixed(2)}</span>
                </div>
            </div>

            <Separator className="border-dashed border-black" />
            <div className="space-y-2 uppercase font-bold text-[10px]">
                <p className="text-[9px] font-black tracking-widest border-b border-black pb-1 text-center">Audit Summary</p>
                <div className="flex justify-between items-center">
                    <span>Opening Float</span>
                    <span className="font-black">${session.openingFloat?.toFixed(2)}</span>
                </div>
                <div className="flex justify-between items-center">
                    <span>Total Cash sales</span>
                    <span className="font-black">${(session.totalCashSales || 0).toFixed(2)}</span>
                </div>
                <div className="flex justify-between items-center">
                    <span>Total Tips</span>
                    <span className="font-black">${(session.totalCashTips || 0).toFixed(2)}</span>
                </div>
                <Separator className="border-black opacity-20" />
                <div className="flex justify-between items-center">
                    <span>Actual Physical Count</span>
                    <span className="font-black">${(session.actualCash || session.openingFloat).toFixed(2)}</span>
                </div>
                <div className="flex justify-between items-center">
                    <span>Next Day Float</span>
                    <span className="font-black">-${session.nextDayFloat?.toFixed(2)}</span>
                </div>
                {Math.abs(session.discrepancy || 0) > 0.01 && (
                    <div className="mt-2 p-2 bg-slate-100 flex flex-col gap-1">
                        <div className="flex justify-between items-center text-destructive">
                            <span>Audit Delta</span>
                            <span>{session.discrepancy > 0 ? '+' : ''}${session.discrepancy?.toFixed(2)}</span>
                        </div>
                    </div>
                )}
            </div>

            <Separator className="border-dashed border-black" />

            <div className="space-y-6 pt-2">
                {openedBy && (
                    <div className="space-y-2">
                        <div className="flex justify-between items-baseline">
                            <span className="text-[8px] font-black opacity-40">Opened By:</span>
                            <span className="text-[9px] font-black">{openedBy.name}</span>
                        </div>
                        {session.openedBySignature && (
                            <div className="relative h-12 w-full bg-slate-50 border">
                                <img src={session.openedBySignature} alt="Signature" className="h-full w-full object-contain" />
                            </div>
                        )}
                    </div>
                )}
                {closedBy && (
                    <div className="space-y-2">
                        <div className="flex justify-between items-baseline">
                            <span className="text-[8px] font-black opacity-40">Closed By:</span>
                            <span className="text-[9px] font-black">{closedBy.name}</span>
                        </div>
                        {session.closedBySignature && (
                            <div className="relative h-12 w-full bg-slate-50 border">
                                <img src={session.closedBySignature} alt="Signature" className="h-full w-full object-contain" />
                            </div>
                        )}
                    </div>
                )}
                {verifiedBy && (
                    <div className="space-y-2">
                        <div className="flex justify-between items-baseline">
                            <span className="text-[8px] font-black opacity-40">Witnessed By:</span>
                            <span className="text-[9px] font-black">{verifiedBy.name}</span>
                        </div>
                        {session.verifiedBySignature && (
                            <div className="relative h-12 w-full bg-slate-50 border">
                                <img src={session.verifiedBySignature} alt="Signature" className="h-full w-full object-contain" />
                            </div>
                        )}
                    </div>
                )}
            </div>

            <div className="pt-4 text-center space-y-1">
                <p className="text-[8px] font-black opacity-40 tracking-widest">CLARITYFLOW AUDIT SYSTEM</p>
                <p className="text-[7px] opacity-30 italic">Certified Digital Record &middot; Non-Transferable</p>
            </div>
        </div>
    );
}

export const TillManagement = ({ 
    open, 
    onOpenChange, 
    activeTill, 
    staff,
    onOpenTill,
    onCloseTill,
    requireTillWitness = true
}: { 
    open: boolean, 
    onOpenChange: (open: boolean) => void, 
    activeTill: TillSession | null,
    staff: Staff[],
    onOpenTill: (data: any) => void,
    onCloseTill: (data: any) => void,
    requireTillWitness?: boolean
}) => {
    const isMobile = useIsMobile();
    const { toast } = useToast();
    const { tillSessions } = useInventory();
    
    const [counts, setCounts] = useState<Record<string, number>>({});
    const [floatCounts, setFloatCounts] = useState<Record<string, number>>({});
    const [primaryPin, setPrimaryPin] = useState('');
    const [witnessPin, setWitnessPin] = useState('');
    const [step, setStep] = useState<'count' | 'float_select' | 'allocation' | 'verify' | 'sign' | 'success'>('count');
    const [nextDayFloat, setNextDayFloat] = useState<number>(0);
    const [finalSessionData, setFinalSessionData] = useState<any | null>(null);
    const [mainView, setMainView] = useState<'active' | 'history'>('active');
    const [historicalSession, setHistoricalSession] = useState<TillSession | null>(null);

    const [historySearch, setHistorySearch] = useState('');
    const [historyDateFilter, setHistoryDateFilter] = useState('all');

    const sigCanvasRef = useRef<SignatureCanvas | null>(null);
    const witnessSigCanvasRef = useRef<SignatureCanvas | null>(null);

    const actualTotal = useMemo(() => {
        return denominations.reduce((acc, d) => acc + (counts[d.key] || 0) * d.val, 0);
    }, [counts]);

    const floatTotal = useMemo(() => {
        return denominations.reduce((acc, d) => acc + (floatCounts[d.key] || 0) * d.val, 0);
    }, [floatCounts]);

    const filteredSessions = useMemo(() => {
        if (!tillSessions) return [];
        let list = [...tillSessions];

        if (historySearch.trim()) {
            const search = historySearch.toLowerCase();
            list = list.filter(s => 
                s.id.toLowerCase().includes(search) || 
                staff.find(sm => sm.id === s.openedBy)?.name.toLowerCase().includes(search) ||
                staff.find(sm => sm.id === s.closedBy)?.name.toLowerCase().includes(search)
            );
        }

        if (historyDateFilter !== 'all') {
            const now = new Date();
            let cutoff = startOfDay(now);
            if (historyDateFilter === '7days') cutoff = subDays(cutoff, 7);
            if (historyDateFilter === '30days') cutoff = subDays(cutoff, 30);
            list = list.filter(s => safeDate(s.openedAt) >= cutoff);
        }

        return list.sort((a,b) => safeDate(b.openedAt).getTime() - safeDate(a.openedAt).getTime());
    }, [tillSessions, historySearch, historyDateFilter, staff]);

    const handleCountChange = (key: string, val: number) => {
        setCounts(prev => ({ ...prev, [key]: val }));
    };

    const handleFloatChange = (key: string, val: number) => {
        const totalInDrawer = counts[key] || 0;
        if (val > totalInDrawer) {
            toast({ variant: 'destructive', title: 'Invalid Selection', description: `Only ${totalInDrawer} units of ${key.replace('_', ' ')} available in drawer.` });
            return;
        }
        setFloatCounts(prev => ({ ...prev, [key]: val }));
    };

    const handleStepTransition = () => {
        if (step === 'count') {
            setStep(activeTill ? 'float_select' : 'verify');
        } else if (step === 'float_select') {
            setNextDayFloat(floatTotal);
            setStep('allocation');
        } else if (step === 'allocation') {
            setStep('verify');
        } else if (step === 'verify') {
            const authorizedStaff = staff.find(s => s.pin === primaryPin);
            if (!authorizedStaff) {
                toast({ variant: 'destructive', title: 'Invalid PIN', description: 'Primary auditor not identified.' });
                return;
            }
            if (activeTill && requireTillWitness) {
                const witnessStaff = staff.find(s => s.pin === witnessPin);
                if (!witnessStaff) {
                    toast({ variant: 'destructive', title: 'Witness Required', description: 'Invalid Witness PIN.' });
                    return;
                }
                if (witnessStaff.id === authorizedStaff.id) {
                    toast({ variant: 'destructive', title: 'Audit Conflict', description: 'The witness must be a different staff member.' });
                    return;
                }
            }
            setStep('sign');
        }
    };

    const handleAction = () => {
        const authorizedStaff = staff.find(s => s.pin === primaryPin);
        if (!authorizedStaff) return;

        const mainSig = sigCanvasRef.current?.getTrimmedCanvas().toDataURL('image/png');
        if (!mainSig) {
            toast({ variant: 'destructive', title: 'Signature Required' });
            return;
        }

        if (activeTill) {
            const witnessStaff = requireTillWitness ? staff.find(s => s.pin === witnessPin) : null;
            const witnessSig = requireTillWitness ? witnessSigCanvasRef.current?.getTrimmedCanvas().toDataURL('image/png') : null;
            
            if (requireTillWitness && !witnessSig) {
                toast({ variant: 'destructive', title: 'Witness Signature Required' });
                return;
            }

            const discrepancy = actualTotal - activeTill.expectedCash;
            
            // Calculate what goes to the bank
            const depositDenoms: Record<string, number> = {};
            denominations.forEach(d => {
                const remaining = (counts[d.key] || 0) - (floatCounts[d.key] || 0);
                if (remaining > 0) depositDenoms[d.key] = remaining;
            });

            const closingData = {
                actualCash: actualTotal,
                cashToDeposit: actualTotal - floatTotal,
                nextDayFloat: floatTotal,
                closingDenominations: counts,
                nextDayDenominations: floatCounts,
                depositDenominations: depositDenoms,
                closedBy: authorizedStaff.id,
                verifiedBy: witnessStaff?.id,
                closedBySignature: mainSig,
                verifiedBySignature: witnessSig,
                discrepancy,
                closedAt: new Date().toISOString()
            };
            setFinalSessionData({ ...activeTill, ...closingData });
            onCloseTill(closingData);
            setStep('success');
        } else {
            onOpenTill({
                openingFloat: actualTotal,
                openingDenominations: counts,
                openedBy: authorizedStaff.id,
                openedBySignature: mainSig,
            });
            onOpenChange(false);
            resetState();
        }
    };

    const resetState = () => {
        setCounts({});
        setFloatCounts({});
        setPrimaryPin('');
        setWitnessPin('');
        setStep('count');
        setFinalSessionData(null);
        setMainView('active');
        setHistoricalSession(null);
        setHistorySearch('');
        setHistoryDateFilter('all');
    };

    const handleClose = () => {
        onOpenChange(false);
        setTimeout(resetState, 300);
    };

    const DialogComponent = isMobile ? Sheet : Dialog;
    const ContentComponent = isMobile ? SheetContent : DialogContent;

    return (
        <DialogComponent open={open} onOpenChange={handleClose}>
            <ContentComponent side={isMobile ? "bottom" : "right"} className={cn("p-0 border-none bg-background flex flex-col shadow-3xl overflow-hidden", isMobile ? "h-[92dvh] rounded-t-[3rem]" : "sm:max-w-xl max-h-[92dvh]")}>
                <DialogHeader className={cn("flex-shrink-0 text-left border-b bg-muted/5", isMobile ? "p-8 pb-6" : "p-8 pb-6")}>
                    <div className="flex items-center gap-3 mb-2">
                        <Landmark className="w-5 h-5 text-primary" />
                        <span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground opacity-60">Accounting Suite</span>
                    </div>
                    <div className="flex justify-between items-center">
                        <DialogTitle className="text-2xl md:text-3xl font-black uppercase tracking-tighter text-slate-900 leading-none">
                            {step === 'success' ? 'Audit Certified' : mainView === 'history' ? 'Archives' : activeTill ? 'Closing Protocol' : 'Open Studio Till'}
                        </DialogTitle>
                        {step === 'count' && (
                            <Tabs value={mainView} onValueChange={(v: any) => setMainView(v)} className="w-fit">
                                <TabsList className="bg-muted/50 rounded-xl h-9 border p-1">
                                    <TabsTrigger value="active" className="rounded-lg h-7 px-3 text-[9px] font-black uppercase tracking-widest">Active</TabsTrigger>
                                    <TabsTrigger value="history" className="rounded-lg h-7 px-3 text-[9px] font-black uppercase tracking-widest">Archives</TabsTrigger>
                                </TabsList>
                            </Tabs>
                        )}
                    </div>
                </DialogHeader>

                <ScrollArea className="flex-1">
                    <div className="p-8">
                        <AnimatePresence mode="wait">
                            {mainView === 'history' ? (
                                <motion.div key="history" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-6 pb-20">
                                    {historicalSession ? (
                                        <div className="space-y-8 animate-in zoom-in-95 duration-300">
                                            <Button variant="ghost" size="sm" onClick={() => setHistoricalSession(null)} className="h-8 font-black uppercase text-[10px] tracking-widest text-primary hover:bg-primary/5">
                                                <Undo2 className="mr-2 h-3.5 w-3.5"/> Back to Archives
                                            </Button>
                                            <DepositSlip session={historicalSession} staff={staff} />
                                            <Button className="w-full h-16 rounded-2xl font-black uppercase tracking-widest text-sm shadow-xl shadow-primary/20" onClick={() => window.print()}>
                                                <Printer className="mr-3 h-5 w-5" /> Print Certified Slip
                                            </Button>
                                        </div>
                                    ) : (
                                        <div className="space-y-6">
                                            <div className="flex flex-col sm:flex-row gap-3">
                                                <div className="relative flex-1">
                                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground opacity-40" />
                                                    <Input 
                                                        placeholder="SEARCH BY ID OR TECH..." 
                                                        value={historySearch} 
                                                        onChange={e => setHistorySearch(e.target.value)}
                                                        className="pl-9 h-11 rounded-xl border-2 font-black uppercase text-[10px] tracking-widest bg-muted/5 shadow-inner"
                                                    />
                                                </div>
                                                <Select value={historyDateFilter} onValueChange={setHistoryDateFilter}>
                                                    <SelectTrigger className="h-11 w-full sm:w-40 rounded-xl border-2 font-black uppercase text-[10px] tracking-widest">
                                                        <SelectValue placeholder="Period" />
                                                    </SelectTrigger>
                                                    <SelectContent className="rounded-xl border-2 shadow-2xl">
                                                        <SelectItem value="all" className="font-bold">ALL TIME</SelectItem>
                                                        <SelectItem value="today" className="font-bold">TODAY</SelectItem>
                                                        <SelectItem value="7days" className="font-bold">LAST 7 DAYS</SelectItem>
                                                        <SelectItem value="30days" className="font-bold">LAST 30 DAYS</SelectItem>
                                                    </SelectContent>
                                                </Select>
                                            </div>

                                            <div className="grid gap-3">
                                                {filteredSessions.map(session => {
                                                    const staffMember = staff.find(s => s.id === session.openedBy);
                                                    const isDiff = Math.abs(session.discrepancy || 0) > 0.01;
                                                    return (
                                                        <button key={session.id} onClick={() => setHistoricalSession(session)} className="text-left w-full p-4 rounded-2xl border-2 bg-white hover:border-primary/20 transition-all group flex items-center justify-between">
                                                            <div className="flex items-center gap-4">
                                                                <div className="p-3 bg-muted rounded-2xl group-hover:bg-primary/5 transition-colors shrink-0">
                                                                    <Landmark className="w-5 h-5 text-muted-foreground group-hover:text-primary" />
                                                                </div>
                                                                <div className="min-w-0">
                                                                    <p className="font-black uppercase tracking-tight text-xs text-slate-900 truncate">{format(safeDate(session.openedAt), 'MMM d, yyyy')}</p>
                                                                    <div className="flex items-center gap-2 mt-0.5">
                                                                        <Badge variant="outline" className={cn("text-[8px] font-black uppercase h-4 px-1.5 border-none", session.status === 'open' ? 'bg-green-100 text-green-700' : 'bg-muted text-muted-foreground')}>{session.status}</Badge>
                                                                        <p className="text-[9px] font-bold text-muted-foreground uppercase opacity-60 truncate">By {staffMember?.name.split(' ')[0]}</p>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                            <div className="text-right shrink-0 ml-4">
                                                                <p className="font-black font-mono text-sm tracking-tighter text-slate-900">${(session.actualCash || session.openingFloat).toFixed(2)}</p>
                                                                {isDiff && <p className="text-[8px] font-black uppercase text-destructive animate-pulse">Variance Logged</p>}
                                                            </div>
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}
                                </motion.div>
                            ) : (
                                <>
                                    {step === 'count' && (
                                        <motion.div key="count" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-10 pb-20">
                                            {activeTill && (
                                                <Card className="bg-primary/5 border-2 border-primary/10 rounded-[2rem] shadow-inner overflow-hidden">
                                                    <CardContent className="p-6 grid grid-cols-2 gap-6">
                                                        <div className="space-y-1 text-left">
                                                            <p className="text-[9px] font-black uppercase text-primary tracking-widest">Expected Balance</p>
                                                            <p className="text-3xl font-black font-mono tracking-tighter text-primary">${activeTill.expectedCash.toFixed(2)}</p>
                                                            <p className="text-[8px] font-bold text-primary/60 uppercase">Incl. Gratuity</p>
                                                        </div>
                                                        <div className="space-y-1 text-right border-l border-dashed border-primary/20 pl-6">
                                                            <p className="text-[9px] font-black uppercase text-muted-foreground tracking-widest opacity-60">Session Started</p>
                                                            <p className="text-sm font-black text-slate-900">{format(safeDate(activeTill.openedAt), 'h:mm a')}</p>
                                                        </div>
                                                    </CardContent>
                                                </Card>
                                            )}
                                            <div className="space-y-4">
                                                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground ml-1">Physical Drawer Count</p>
                                                <div className="grid grid-cols-1 gap-2">
                                                    {denominations.map(d => <DenominationInput key={d.key} denom={d} count={counts[d.key] || 0} onChange={handleCountChange} />)}
                                                </div>
                                            </div>
                                        </motion.div>
                                    )}

                                    {step === 'float_select' && (
                                        <motion.div key="float_select" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-8 pb-20 text-left">
                                            <div className="p-8 rounded-[2.5rem] border-2 border-dashed border-indigo-500/30 bg-indigo-500/[0.02] text-center space-y-4 shadow-inner">
                                                <div className="space-y-1">
                                                    <p className="text-[10px] font-black uppercase tracking-[0.3em] text-indigo-600">Tomorrow's Float Target</p>
                                                    <p className="text-5xl font-black font-mono tracking-tighter text-indigo-700">${floatTotal.toFixed(2)}</p>
                                                </div>
                                                <p className="text-[9px] font-bold uppercase text-slate-500 max-w-xs mx-auto">Select the specific bills and coins remaining in the drawer for tomorrow's opening.</p>
                                            </div>
                                            <div className="grid grid-cols-1 gap-2">
                                                {denominations.map(d => <DenominationInput key={d.key} denom={d} count={floatCounts[d.key] || 0} onChange={handleFloatChange} />)}
                                            </div>
                                        </motion.div>
                                    )}

                                    {step === 'allocation' && (
                                        <motion.div key="allocation" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-8 pb-20 text-left">
                                            <div className="p-8 rounded-[2.5rem] bg-slate-900 text-white text-center space-y-4 shadow-2xl relative overflow-hidden">
                                                <div className="absolute top-0 right-0 p-6 opacity-5"><Banknote className="w-32 h-32" /></div>
                                                <div className="space-y-1 relative z-10">
                                                    <p className="text-[10px] font-black uppercase tracking-[0.3em] opacity-40">Total Physical count</p>
                                                    <p className="text-6xl font-black font-mono tracking-tighter text-primary">${actualTotal.toFixed(2)}</p>
                                                </div>
                                                {activeTill && (
                                                    <div className={cn("inline-flex items-center gap-2 px-4 py-1.5 rounded-full font-black text-[9px] uppercase tracking-widest relative z-10", 
                                                        actualTotal >= activeTill.expectedCash ? "bg-green-500/20 text-green-400" : "bg-destructive/20 text-red-400")}>
                                                        {actualTotal >= activeTill.expectedCash ? `Overage: +$${(actualTotal - activeTill.expectedCash).toFixed(2)}` : `Shortage: -$${(activeTill.expectedCash - actualTotal).toFixed(2)}`}
                                                    </div>
                                                )}
                                            </div>

                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                                <div className="p-5 rounded-[1.5rem] border-2 bg-muted/10 space-y-1">
                                                    <p className="text-[9px] font-black uppercase text-muted-foreground opacity-60">Verified Revenue</p>
                                                    <p className="text-xl font-black font-mono text-slate-900">${(activeTill?.totalCashSales || 0).toFixed(2)}</p>
                                                </div>
                                                <div className="p-5 rounded-[1.5rem] border-2 bg-indigo-500/5 border-indigo-500/10 space-y-1">
                                                    <p className="text-[9px] font-black uppercase text-indigo-600 opacity-60 flex items-center gap-2"><HeartHandshake className="w-3 h-3" /> Team Gratuity</p>
                                                    <p className="text-xl font-black font-mono text-indigo-600">${(activeTill?.totalCashTips || 0).toFixed(2)}</p>
                                                </div>
                                            </div>

                                            <div className="p-6 rounded-[2rem] border-4 border-primary/20 bg-primary/5 flex justify-between items-center shadow-xl">
                                                <div className="flex items-center gap-3">
                                                    <div className="p-2 rounded-xl bg-primary text-white shadow-lg"><ArrowUpFromLine className="w-5 h-5" /></div>
                                                    <div className="space-y-0.5">
                                                        <span className="font-black uppercase tracking-tight text-xs text-slate-900">Bank Deposit Bag</span>
                                                        <p className="text-[8px] font-black text-primary/60 uppercase">Net removed from drawer</p>
                                                    </div>
                                                </div>
                                                <p className="text-3xl font-black font-mono tracking-tighter text-primary">${cashToDeposit.toFixed(2)}</p>
                                            </div>
                                        </motion.div>
                                    )}

                                    {step === 'verify' && (
                                        <motion.div key="verify" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="space-y-10 py-6 pb-20">
                                            <div className="space-y-8 text-left">
                                                <div className="space-y-4">
                                                    <div className="flex items-center gap-3 px-1">
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

                                                {activeTill && requireTillWitness && (
                                                    <div className="space-y-4 pt-10 border-t-2 border-dashed">
                                                        <div className="flex items-center gap-3 px-1">
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
                                                    </div>
                                                )}
                                            </div>
                                        </motion.div>
                                    )}

                                    {step === 'sign' && (
                                        <motion.div key="sign" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-10 pb-20">
                                            <div className="space-y-4 text-left">
                                                <Label className="text-[10px] font-black uppercase tracking-widest text-primary ml-1 flex items-center gap-2">
                                                    <FileSignature className="w-4 h-4" /> Primary Signature
                                                </Label>
                                                <div className="rounded-[2rem] border-4 border-dashed bg-muted/20 overflow-hidden relative h-48">
                                                    <SignatureCanvas 
                                                        ref={sigCanvasRef}
                                                        penColor="black"
                                                        canvasProps={{ className: 'w-full h-full' }}
                                                    />
                                                    <div className="absolute bottom-4 left-4 right-4 flex items-center gap-2 opacity-20 pointer-events-none">
                                                        <span className="text-xl font-black">X</span>
                                                        <div className="flex-1 border-b-2 border-black" />
                                                    </div>
                                                </div>
                                                <Button variant="ghost" size="sm" onClick={() => sigCanvasRef.current?.clear()} className="text-[9px] font-black uppercase tracking-widest text-muted-foreground h-6 px-3">Clear Pad</Button>
                                            </div>

                                            {activeTill && requireTillWitness && (
                                                <div className="space-y-4 pt-10 border-t-2 border-dashed text-left">
                                                    <Label className="text-[10px] font-black uppercase tracking-widest text-primary ml-1 flex items-center gap-2">
                                                        <ShieldCheck className="w-4 h-4" /> Witness Signature
                                                    </Label>
                                                    <div className="rounded-[2rem] border-4 border-dashed bg-muted/20 overflow-hidden relative h-48">
                                                        <SignatureCanvas 
                                                            ref={witnessSigCanvasRef}
                                                            penColor="black"
                                                            canvasProps={{ className: 'w-full h-full' }}
                                                        />
                                                        <div className="absolute bottom-4 left-4 right-4 flex items-center gap-2 opacity-20 pointer-events-none">
                                                            <span className="text-xl font-black">X</span>
                                                            <div className="flex-1 border-b-2 border-black" />
                                                        </div>
                                                    </div>
                                                    <Button variant="ghost" size="sm" onClick={() => witnessSigCanvasRef.current?.clear()} className="text-[9px] font-black uppercase tracking-widest text-muted-foreground h-6 px-3">Clear Pad</Button>
                                                </div>
                                            )}
                                        </motion.div>
                                    )}

                                    {step === 'success' && finalSessionData && (
                                        <motion.div key="success" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="space-y-10 pb-20">
                                            <div className="p-8 rounded-[3rem] border-4 border-green-500/20 bg-green-500/5 text-center space-y-4 shadow-xl">
                                                <div className="w-20 h-20 bg-green-500 rounded-[2rem] flex items-center justify-center mx-auto shadow-2xl shadow-green-500/20 rotate-6">
                                                    <CheckCircle2 className="w-12 h-12 text-white -rotate-6" />
                                                </div>
                                                <div className="space-y-1">
                                                    <h3 className="text-2xl font-black uppercase tracking-tighter text-slate-900">Audit Finalized</h3>
                                                    <p className="text-[10px] font-bold uppercase tracking-widest text-green-700">Protocol Entry Verified</p>
                                                </div>
                                            </div>
                                            <DepositSlip session={finalSessionData} staff={staff} />
                                        </motion.div>
                                    )}
                                </>
                            )}
                        </AnimatePresence>
                    </div>
                </ScrollArea>

                <DialogFooter className={cn("border-t bg-background flex-shrink-0 shadow-2xl p-8 pt-4")}>
                    <div className="flex flex-col gap-3 w-full">
                        {mainView === 'history' ? (
                            <Button variant="outline" onClick={handleClose} className="w-full h-14 rounded-2xl font-black uppercase text-[10px] tracking-widest bg-white">Close Archives</Button>
                        ) : (
                            <>
                                {step === 'count' && (
                                    <div className="flex gap-3">
                                        <Button variant="ghost" onClick={handleClose} className="flex-1 h-14 font-black uppercase tracking-tighter text-[10px] text-slate-400">Cancel</Button>
                                        <Button onClick={handleStepTransition} disabled={actualTotal <= 0} className="flex-[2] h-14 rounded-2xl font-black uppercase tracking-widest text-[10px] shadow-xl group">
                                            {activeTill ? 'Next: Allocation' : 'Next: Identity'} <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
                                        </Button>
                                    </div>
                                )}
                                {step === 'float_select' && (
                                    <div className="flex gap-3">
                                        <Button variant="ghost" onClick={() => setStep('count')} className="flex-1 h-14 font-black uppercase tracking-tighter text-[10px] text-slate-400">Back</Button>
                                        <Button onClick={handleStepTransition} className="flex-[2] h-14 rounded-2xl font-black uppercase tracking-widest text-[10px] shadow-xl group">Confirm Float <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" /></Button>
                                    </div>
                                )}
                                {step === 'allocation' && (
                                    <div className="flex gap-3">
                                        <Button variant="ghost" onClick={() => setStep('float_select')} className="flex-1 h-14 font-black uppercase tracking-tighter text-[10px] text-slate-400">Back</Button>
                                        <Button onClick={handleStepTransition} className="flex-[2] h-14 rounded-2xl font-black uppercase tracking-widest text-[10px] shadow-xl group">Audit Verification <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" /></Button>
                                    </div>
                                )}
                                {step === 'verify' && (
                                    <div className="flex gap-3">
                                        <Button variant="ghost" onClick={() => setStep('allocation')} className="flex-1 h-14 font-black uppercase tracking-tighter text-[10px] text-slate-400">Back</Button>
                                        <Button onClick={handleStepTransition} disabled={primaryPin.length < 4 || (activeTill && requireTillWitness && witnessPin.length < 4)} className="flex-[2] h-14 rounded-2xl font-black uppercase tracking-widest text-[10px] shadow-xl group">Biometric Sign <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" /></Button>
                                    </div>
                                )}
                                {step === 'sign' && (
                                    <div className="flex gap-3">
                                        <Button variant="ghost" onClick={() => setStep('verify')} className="flex-1 h-14 font-black uppercase tracking-tighter text-[10px] text-slate-400">Back</Button>
                                        <Button onClick={handleAction} className="flex-[2] h-14 rounded-2xl font-black uppercase tracking-widest text-[10px] shadow-xl">Commit Archive</Button>
                                    </div>
                                )}
                                {step === 'success' && (
                                    <div className="flex flex-col gap-3">
                                        <Button className="w-full h-16 rounded-2xl font-black uppercase text-sm tracking-widest shadow-2xl shadow-primary/30 group" onClick={() => window.print()}>
                                            <Printer className="mr-3 h-5 w-5" /> Print Certified Slip
                                        </Button>
                                        <Button variant="ghost" onClick={handleClose} className="w-full h-10 font-bold uppercase text-[10px] tracking-widest text-slate-400">Return to Terminal</Button>
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                </DialogFooter>
            </ContentComponent>
            <style jsx global>{`
                @media print {
                    body * { visibility: hidden; }
                    #deposit-slip-print, #deposit-slip-print * { visibility: visible; }
                    #deposit-slip-print { position: absolute; left: 0; top: 0; width: 3.5in; margin: 0; border: none; box-shadow: none; padding: 0.25in; }
                }
            `}</style>
        </DialogComponent>
    );
};
