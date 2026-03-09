
'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { AppHeader } from '@/components/shared/AppHeader';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { 
    DollarSign, 
    Building, 
    User, 
    PiggyBank, 
    Receipt, 
    Wallet, 
    TrendingUp, 
    Landmark, 
    Calculator, 
    Info, 
    Users, 
    AlertCircle,
    ChevronLeft,
    ChevronRight,
    CheckCircle2,
    CalendarRange,
    Loader
} from 'lucide-react';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { useInventory } from '@/context/InventoryContext';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Separator } from '@/components/ui/separator';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { 
    differenceInMinutes, 
    parseISO, 
    startOfDay, 
    endOfDay, 
    subDays, 
    format, 
    startOfWeek, 
    startOfMonth, 
    endOfMonth,
    addDays,
    subMonths,
    addMonths,
    isSameDay,
    differenceInDays
} from 'date-fns';
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { useFirebase, useUser } from '@/firebase';
import { collection, doc, writeBatch } from 'firebase/firestore';
import { useTenant } from '@/context/TenantContext';
import { useToast } from '@/hooks/use-toast';
import { type Transaction } from '@/lib/financial-data';

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

const AllocationItem = ({ label, percentage, amount, color }: { label: string, percentage: number, amount: number, color: string }) => (
    <div className="flex items-center justify-between p-3 rounded-xl bg-muted/30 border shadow-sm">
        <div className="flex items-center gap-3">
            <div className={cn("w-2 h-8 rounded-full", color)} />
            <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{label}</p>
                <p className="text-[8px] font-bold text-muted-foreground opacity-60">{percentage}% Allocation</p>
            </div>
        </div>
        <p className="text-base md:text-lg font-black font-mono tracking-tighter text-slate-900">${amount.toFixed(2)}</p>
    </div>
);

type Cadence = 'weekly' | 'bi-weekly' | 'monthly' | 'custom';

export default function PaydayPage() {
  const { billDefinitions, billInstances, transactions, staff, activityLogs, isLoading } = useInventory();
  const { firestore } = useFirebase();
  const { selectedTenant } = useTenant();
  const { toast } = useToast();
  const tenantId = selectedTenant?.id;

  const [allocationAmount, setAllocationAmount] = useState<number>(0);
  const [cadence, setCadence] = useState<Cadence>('bi-weekly');
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const [dateRange, setDateRange] = useState<{ from: Date, to: Date }>(() => {
      const now = new Date();
      return {
          from: startOfDay(subDays(now, 13)),
          to: endOfDay(now)
      };
  });

  const handlePrevPeriod = () => {
      if (cadence === 'custom') return;
      setDateRange(prev => {
          let daysToShift = 7;
          if (cadence === 'bi-weekly') daysToShift = 14;
          if (cadence === 'monthly') {
              const prevMonth = subMonths(prev.from, 1);
              return { from: startOfMonth(prevMonth), to: endOfMonth(prevMonth) };
          }
          return { from: startOfDay(subDays(prev.from, daysToShift)), to: endOfDay(subDays(prev.to, daysToShift)) };
      });
  };

  const handleNextPeriod = () => {
      if (cadence === 'custom') return;
      setDateRange(prev => {
          let daysToShift = 7;
          if (cadence === 'bi-weekly') daysToShift = 14;
          if (cadence === 'monthly') {
              const nextMonth = addMonths(prev.from, 1);
              return { from: startOfMonth(nextMonth), to: endOfMonth(nextMonth) };
          }
          return { from: startOfDay(addDays(prev.from, daysToShift)), to: endOfDay(addDays(prev.to, daysToShift)) };
      });
  };

  const handleCadenceChange = (newCadence: Cadence) => {
      setCadence(newCadence);
      const now = new Date();
      if (newCadence === 'weekly') {
          setDateRange({ from: startOfDay(subDays(now, 6)), to: endOfDay(now) });
      } else if (newCadence === 'bi-weekly') {
          setDateRange({ from: startOfDay(subDays(now, 13)), to: endOfDay(now) });
      } else if (newCadence === 'monthly') {
          setDateRange({ from: startOfMonth(now), to: endOfMonth(now) });
      }
  };

  const filteredTransactions = useMemo(() => {
      if (!transactions) return [];
      return transactions.filter(t => {
          const d = safeDate(t.date);
          return d >= dateRange.from && d <= dateRange.to;
      });
  }, [transactions, dateRange]);

  const currentBalance = useMemo(() => {
      const income = filteredTransactions.filter(t => t.type === 'income').reduce((acc, t) => acc + t.amount, 0);
      const expenses = filteredTransactions.filter(t => t.type === 'expense' || t.type === 'payment').reduce((acc, t) => acc + t.amount, 0);
      return Math.max(0, income - expenses);
  }, [filteredTransactions]);

  const staffObligations = useMemo(() => {
    if (!staff || !filteredTransactions || !activityLogs) return [];

    return staff.map(member => {
        const staffTransactions = filteredTransactions.filter(t => t.staffId === member.id && t.type === 'income');
        
        const serviceRevenue = staffTransactions
            .filter(t => t.category === 'Service Revenue')
            .reduce((acc, t) => acc + t.amount, 0);

        const retailSales = staffTransactions
            .filter(t => t.category === 'Retail')
            .reduce((acc, t) => acc + t.amount, 0);
        
        const tips = staffTransactions
            .filter(t => t.category === 'Tips' || t.tipAmount)
            .reduce((acc, t) => acc + (t.tipAmount || t.amount), 0);

        let earnings = 0;
        if (member.payStructure === 'commission') {
            earnings = (serviceRevenue * ((member.commissionRate || 40) / 100)) + 
                       (member.retailCommissionRate ? (retailSales * (member.retailCommissionRate / 100)) : 0);
        } else if (member.payStructure === 'hourly' && member.hourlyRate) {
            const logs = activityLogs.filter(l => 
                l.staffId === member.id && 
                safeDate(l.timestamp) >= dateRange.from && 
                safeDate(l.timestamp) <= dateRange.to
            );
            const totalMinutes = logs.reduce((acc, l) => acc + (l.durationMinutes || 0), 0);
            earnings = (totalMinutes / 60) * member.hourlyRate;
        }

        const totalOwed = earnings + tips;

        return {
            id: member.id,
            name: member.name,
            avatarUrl: member.avatarUrl,
            amount: totalOwed,
            details: `${member.payStructure === 'commission' ? 'Comm' : 'Hr'} + Tips`
        };
    }).filter(o => o.amount > 0);
  }, [staff, filteredTransactions, activityLogs, dateRange]);

  const staffTotalOwed = useMemo(() => staffObligations.reduce((sum, o) => sum + o.amount, 0), [staffObligations]);

  const unpaidInstancesInPeriod = useMemo(() => {
      if (!billInstances) return [];
      return billInstances.filter(i => {
          const d = safeDate(i.dueDate);
          return i.status !== 'paid' && d >= dateRange.from && d <= dateRange.to;
      });
  }, [billInstances, dateRange]);

  const upcomingBusiness = useMemo(() => {
      return unpaidInstancesInPeriod
        .map(i => ({ instance: i, definition: billDefinitions.find(d => d.id === i.billDefinitionId) }))
        .filter(item => item.definition?.context === 'Business');
  }, [unpaidInstancesInPeriod, billDefinitions]);

  const upcomingPersonal = useMemo(() => {
      return unpaidInstancesInPeriod
        .map(i => ({ instance: i, definition: billDefinitions.find(d => d.id === i.billDefinitionId) }))
        .filter(item => item.definition?.context === 'Personal');
  }, [unpaidInstancesInPeriod, billDefinitions]);

  const businessBillsTotal = upcomingBusiness.reduce((sum, item) => sum + (item.definition?.amount || 0), 0);
  const personalBillsTotal = upcomingPersonal.reduce((sum, item) => sum + (item.definition?.amount || 0), 0);
  
  const totalHardObligations = staffTotalOwed + businessBillsTotal + personalBillsTotal;

  const suggestions = useMemo(() => {
      const amt = allocationAmount || 0;
      return [
          { label: 'Profit', pct: 5, amount: Number((amt * 0.05).toFixed(2)), color: 'bg-green-500' },
          { label: 'Owner Comp', pct: 50, amount: Number((amt * 0.50).toFixed(2)), color: 'bg-primary' },
          { label: 'Tax', pct: 15, amount: Number((amt * 0.15).toFixed(2)), color: 'bg-orange-500' },
          { label: 'OpEx / Bills', pct: 30, amount: Number((amt * 0.30).toFixed(2)), color: 'bg-blue-500' },
      ];
  }, [allocationAmount]);

  const handleSetMaxBalance = () => {
      setAllocationAmount(Number(currentBalance.toFixed(2)));
  };

  const handleConfirmDistributions = async () => {
    if (!firestore || !tenantId) return;
    setIsSubmitting(true);

    const batch = writeBatch(firestore);
    const now = new Date().toISOString();

    staffObligations.forEach(obligation => {
        const txnRef = doc(collection(firestore, `tenants/${tenantId}/transactions`));
        const newTxn: Omit<Transaction, 'id'> = {
            date: now,
            description: `Payroll Payout: ${obligation.name}`,
            clientOrVendor: obligation.name,
            type: 'expense',
            context: 'Business',
            category: 'Payroll',
            amount: Number(obligation.amount.toFixed(2)),
            paymentMethod: 'Distribution',
            hasReceipt: false,
            staffId: obligation.id,
        };
        batch.set(txnRef, { ...newTxn, id: txnRef.id });
    });

    suggestions.forEach(bucket => {
        if (bucket.amount > 0 && bucket.label !== 'OpEx / Bills') {
            const txnRef = doc(collection(firestore, `tenants/${tenantId}/transactions`));
            const newTxn: Omit<Transaction, 'id'> = {
                date: now,
                description: `Profit First Allocation: ${bucket.label}`,
                clientOrVendor: 'Internal Distribution',
                type: 'expense',
                context: 'Business',
                category: 'Distribution',
                amount: Number(bucket.amount.toFixed(2)),
                paymentMethod: 'Internal Transfer',
                hasReceipt: false,
            };
            batch.set(txnRef, { ...newTxn, id: txnRef.id });
        }
    });

    try {
        await batch.commit();
        toast({
            title: "Distributions Confirmed",
            description: `Logged distributions successfully.`
        });
        setAllocationAmount(0);
    } catch (e) {
        console.error("Distributions failed:", e);
        toast({ variant: 'destructive', title: "Distribution Failed" });
    } finally {
        setIsSubmitting(false);
    }
  };

  if (isLoading) {
      return (
          <div className="flex min-h-screen w-full flex-col bg-white">
            <AppHeader title="Payday" />
            <main className="flex-1 p-4 md:p-8 flex items-center justify-center">
                <Loader className="w-8 h-8 animate-spin text-primary" />
            </main>
          </div>
      )
  }

  return (
    <div className="flex min-h-screen w-full flex-col bg-white">
      <AppHeader title="Payday" />
      <main className="flex-1 p-4 md:p-8">
        <div className="max-w-2xl mx-auto px-2 md:px-0 space-y-8 md:space-y-10">
            <div className="text-center space-y-1">
                <h1 className="text-2xl md:text-3xl font-black uppercase tracking-tighter text-slate-900">Run Payday</h1>
                <p className="text-[10px] md:text-sm text-muted-foreground font-medium uppercase tracking-widest opacity-70">
                    Reconcile Period & Allocate Revenue
                </p>
            </div>

            <div className="space-y-6">
                <div className="max-w-[340px] mx-auto flex gap-1.5 p-2 bg-muted border-2 border-muted rounded-2xl shadow-inner">
                    {(['weekly', 'bi-weekly', 'monthly', 'custom'] as Cadence[]).map(c => (
                        <Button key={c} variant="ghost" size="sm" onClick={() => handleCadenceChange(c)} className={cn("flex-1 text-[9px] font-black uppercase h-8 rounded-xl transition-all", cadence === c ? "bg-white shadow-sm border border-border/50" : "hover:bg-white/50")}>{c.replace('-', ' ')}</Button>
                    ))}
                </div>

                {cadence === 'custom' ? (
                    <div className="p-6 md:p-16 bg-muted/30 rounded-[2.5rem] md:rounded-[3rem] border-2 border-dashed border-muted-foreground/20 space-y-6 md:space-y-8 shadow-inner">
                        <div className="flex items-center gap-3 justify-center text-[10px] md:text-[11px] font-black uppercase tracking-widest text-primary">
                            <CalendarRange className="w-4 h-4" /> Select Custom Window
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 md:gap-8 px-2 md:px-4">
                            <div className="space-y-2 text-left">
                                <Label className="text-[9px] uppercase font-black text-muted-foreground ml-2">Start Date</Label>
                                <input 
                                    type="date" 
                                    value={format(dateRange.from, 'yyyy-MM-dd')}
                                    onChange={(e) => {
                                        const newDate = e.target.value ? startOfDay(new Date(e.target.value.replace(/-/g, '/'))) : dateRange.from;
                                        setDateRange(prev => ({ ...prev, from: newDate }));
                                    }}
                                    className="w-full h-12 sm:h-16 rounded-2xl border-2 bg-background px-4 font-black text-sm sm:text-lg text-center focus:border-primary focus:ring-4 focus:ring-primary/10 transition-all outline-none shadow-md"
                                />
                            </div>
                            <div className="space-y-2 text-left">
                                <Label className="text-[9px] uppercase font-black text-muted-foreground ml-2">End Date</Label>
                                <input 
                                    type="date" 
                                    value={format(dateRange.to, 'yyyy-MM-dd')}
                                    onChange={(e) => {
                                        const newDate = e.target.value ? endOfDay(new Date(e.target.value.replace(/-/g, '/'))) : dateRange.to;
                                        setDateRange(prev => ({ ...prev, to: newDate }));
                                    }}
                                    className="w-full h-12 sm:h-16 rounded-2xl border-2 bg-background px-4 font-black text-sm sm:text-lg text-center focus:border-primary focus:ring-4 focus:ring-primary/10 transition-all outline-none shadow-md"
                                />
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="flex items-center justify-between p-4 md:p-6 bg-muted/30 rounded-2xl border-2 border-dashed border-muted-foreground/20 mx-1 md:mx-0 shadow-inner">
                        <Button 
                            variant="ghost" 
                            size="icon" 
                            onClick={handlePrevPeriod} 
                            className="h-10 w-10 md:h-12 md:w-12 hover:bg-white rounded-full shadow-sm"
                        >
                            <ChevronLeft className="w-5 h-5 md:w-6 md:h-6"/>
                        </Button>
                        
                        <div className="text-center px-2">
                            <p className="text-[9px] md:text-[10px] font-black uppercase tracking-widest text-primary mb-1">Reconciling Period</p>
                            <p className="text-sm md:text-xl font-black text-slate-900 leading-none">
                                {format(dateRange.from, 'MMM d')} – {format(dateRange.to, 'MMM d, yyyy')}
                            </p>
                        </div>

                        <Button 
                            variant="ghost" 
                            size="icon" 
                            onClick={handleNextPeriod} 
                            className="h-10 w-10 md:h-12 md:w-12 hover:bg-white rounded-full shadow-sm"
                        >
                            <ChevronRight className="w-5 h-5 md:w-6 md:h-6"/>
                        </Button>
                    </div>
                )}
            </div>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Card className="border-2 shadow-sm bg-primary/5 border-primary/10">
                    <CardContent className="p-5 md:p-6 flex flex-col justify-center text-left">
                        <p className="text-[9px] md:text-[10px] font-black uppercase text-primary tracking-widest mb-1">Period Net Income</p>
                        <p className="text-2xl md:text-3xl font-black tracking-tighter text-primary font-mono">${currentBalance.toFixed(2)}</p>
                    </CardContent>
                </Card>
                <Card className={cn("border-2 shadow-sm", totalHardObligations > currentBalance ? "bg-destructive/5 border-destructive/20" : "bg-muted/20")}>
                    <CardContent className="p-5 md:p-6 flex flex-col justify-center text-left">
                        <p className="text-[9px] md:text-[10px] font-black uppercase text-muted-foreground tracking-widest mb-1">Obligations Total</p>
                        <div className="flex items-center justify-between">
                            <p className={cn("text-2xl md:text-3xl font-black tracking-tighter font-mono", totalHardObligations > currentBalance && "text-destructive")}>
                                ${totalHardObligations.toFixed(2)}
                            </p>
                            {totalHardObligations > currentBalance && (
                                <TooltipProvider>
                                    <Tooltip>
                                        <TooltipTrigger><AlertCircle className="w-5 h-5 text-destructive animate-pulse" /></TooltipTrigger>
                                        <TooltipContent className="border-2 rounded-xl font-black uppercase text-[9px]">Warning: Obligations exceed period income.</TooltipContent>
                                    </Tooltip>
                                </TooltipProvider>
                            )}
                        </div>
                    </CardContent>
                </Card>
            </div>

            <Card className="border-2 shadow-xl overflow-hidden">
                <CardHeader className="p-5 md:p-6 text-left border-b bg-muted/5">
                    <CardTitle className="text-sm md:text-lg font-black uppercase tracking-tight flex items-center gap-2">
                        <Calculator className="w-4 h-4 md:w-5 md:h-5 text-primary" />
                        Allocation Engine
                    </CardTitle>
                    <CardDescription className="text-[10px] font-bold uppercase tracking-widest opacity-60">Profit First methodology suggestions</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6 md:space-y-8 p-5 md:p-6">
                    <div className="space-y-2 text-left">
                        <div className="relative">
                            <DollarSign className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 md:h-6 md:w-6 text-muted-foreground opacity-40" />
                            <Input 
                                id="allocation-amount" 
                                type="number" 
                                placeholder="0.00" 
                                className="pl-12 text-2xl md:text-3xl font-black h-16 md:h-20 border-2 rounded-2xl tracking-tighter focus-visible:ring-primary/20 bg-muted/5 shadow-inner" 
                                value={allocationAmount || ''}
                                onChange={(e) => setAllocationAmount(parseFloat(e.target.value) || 0)}
                            />
                        </div>
                        <div className="flex justify-between items-center px-1">
                            <p className="text-[9px] font-black uppercase text-muted-foreground">Amount to Distribute</p>
                            <Button variant="link" className="h-auto p-0 text-[9px] font-black uppercase text-primary underline underline-offset-4" onClick={handleSetMaxBalance}>Use Period Income</Button>
                        </div>
                    </div>

                    {allocationAmount > 0 && (
                        <div className="space-y-4 animate-in fade-in slide-in-from-top-2 duration-500">
                            <Separator className="border-dashed" />
                            <p className="text-[9px] font-black uppercase tracking-widest text-primary text-center">Suggested Distribution</p>
                            <div className="grid gap-3">
                                {suggestions.map(s => (
                                    <AllocationItem key={s.label} label={s.label} percentage={s.pct} amount={s.amount} color={s.color} />
                                ))}
                            </div>
                            <div className="p-4 rounded-xl border-2 border-dashed bg-muted/10 flex items-start gap-3 text-left">
                                <Info className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5 opacity-40" />
                                <p className="text-[10px] text-muted-foreground leading-relaxed font-bold uppercase tracking-tight">
                                    The <strong>OpEx Allocation</strong> of ${suggestions[3].amount.toFixed(2)} stays in your studio account to cover the ${totalHardObligations.toFixed(2)} in period obligations.
                                </p>
                            </div>
                        </div>
                    )}

                     <Accordion type="single" collapsible className="w-full border-t pt-6">
                        <AccordionItem value="obligations-summary" className="border-none">
                            <AccordionTrigger className="p-4 md:p-5 bg-muted/30 rounded-2xl border-2 hover:no-underline shadow-sm">
                                <div className="flex items-center gap-2">
                                    <Receipt className="w-4 h-4 text-primary" />
                                    <span className="font-black uppercase text-[10px] md:text-xs tracking-widest">Unpaid Obligations Detail</span>
                                </div>
                            </AccordionTrigger>
                            <AccordionContent className="pt-6 space-y-6 text-left">
                                <div className='p-4 md:p-5 bg-muted/50 rounded-2xl border-2 space-y-4 shadow-inner'>
                                    <h4 className='font-black text-[9px] md:text-[10px] uppercase tracking-widest flex items-center gap-2 text-primary'><Users className='w-3 h-3'/>Staff Earnings</h4>
                                    <div className="space-y-2">
                                        {staffObligations.length > 0 ? staffObligations.map((owed, idx) => (
                                            <div key={idx} className='flex items-center justify-between bg-background p-2.5 rounded-xl border shadow-sm'>
                                                <div className="flex items-center gap-2 min-w-0">
                                                    <Avatar className="h-7 w-7 rounded-lg border">
                                                        <AvatarImage src={owed.avatarUrl} className="object-cover" />
                                                        <AvatarFallback className="text-[8px] font-black">{(owed.name || 'S').charAt(0)}</AvatarFallback>
                                                    </Avatar>
                                                    <div className="min-w-0">
                                                        <p className="text-[10px] font-black uppercase tracking-tight truncate">{owed.name}</p>
                                                        <p className="text-[8px] text-muted-foreground uppercase font-bold tracking-widest mt-0.5">{owed.details}</p>
                                                    </div>
                                                </div>
                                                <span className="font-mono font-black text-xs md:text-sm ml-2">${owed.amount.toFixed(2)}</span>
                                            </div>
                                        )) : <p className="text-[9px] text-muted-foreground uppercase font-bold text-center py-4 border-2 border-dashed rounded-xl opacity-40">No staff earnings</p>}
                                    </div>
                                    <div className='flex justify-between text-xs border-t border-primary/20 pt-3 font-black uppercase'>
                                        <span className="tracking-widest opacity-60">Total Staff</span>
                                        <span className="text-primary tracking-tighter">${staffTotalOwed.toFixed(2)}</span>
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <div className='p-4 bg-muted/50 rounded-2xl border-2 space-y-4 shadow-inner'>
                                        <h4 className='font-black text-[9px] uppercase tracking-widest flex items-center gap-2 text-blue-600'><Building className='w-3 h-3'/>Business Bills</h4>
                                        <div className="space-y-1.5">
                                            {upcomingBusiness.length > 0 ? upcomingBusiness.map((item, idx) => (
                                                <div key={idx} className='flex justify-between text-[9px] font-black uppercase'>
                                                    <span className="text-muted-foreground truncate mr-2">{item.definition?.name}</span>
                                                    <span className="font-mono">${item.definition?.amount.toFixed(2)}</span>
                                                </div>
                                            )) : <p className="text-[8px] text-muted-foreground uppercase font-bold italic opacity-40">No entries</p>}
                                        </div>
                                        <div className='flex justify-between text-[10px] border-t border-blue-500/20 pt-2 font-black uppercase'>
                                            <span className="tracking-widest opacity-60">Total</span>
                                            <span className="text-blue-600">${businessBillsTotal.toFixed(2)}</span>
                                        </div>
                                    </div>

                                    <div className='p-4 bg-muted/50 rounded-2xl border-2 space-y-4 shadow-inner'>
                                        <h4 className='font-black text-[9px] uppercase tracking-widest flex items-center gap-2 text-purple-600'><User className='w-3 h-3'/>Personal Needs</h4>
                                        <div className="space-y-1.5">
                                            {upcomingPersonal.length > 0 ? upcomingPersonal.map((item, idx) => (
                                                <div key={idx} className='flex justify-between text-[9px] font-black uppercase'>
                                                    <span className="text-muted-foreground truncate mr-2">{item.definition?.name}</span>
                                                    <span className="font-mono">${item.definition?.amount.toFixed(2)}</span>
                                                </div>
                                            )) : <p className="text-[8px] text-muted-foreground uppercase font-bold italic opacity-40">No entries</p>}
                                        </div>
                                        <div className='flex justify-between text-[10px] border-t border-purple-500/20 pt-2 font-black uppercase'>
                                            <span className="tracking-widest opacity-60">Total</span>
                                            <span className="text-purple-600">${personalBillsTotal.toFixed(2)}</span>
                                        </div>
                                    </div>
                                </div>
                            </AccordionContent>
                        </AccordionItem>
                    </Accordion>
                </CardContent>
                <CardFooter className="p-5 md:p-6 pt-0">
                    <Button 
                        size="lg" 
                        className="w-full h-14 md:h-16 rounded-2xl text-base md:text-xl font-black uppercase tracking-tight shadow-xl shadow-primary/20 transition-all active:scale-95" 
                        disabled={allocationAmount <= 0 || isSubmitting}
                        onClick={handleConfirmDistributions}
                    >
                        {isSubmitting ? <Loader className="animate-spin h-6 w-6 md:h-7 md:w-7" /> : (
                            <>
                                <CheckCircle2 className="mr-2 md:mr-3 h-5 w-5 md:h-7 md:w-7" />
                                Confirm Payouts
                            </>
                        )}
                    </Button>
                </CardFooter>
            </Card>
        </div>
      </main>
    </div>
  );
}
