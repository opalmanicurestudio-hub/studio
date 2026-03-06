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
    addMonths
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
                <p className="text-xs font-black uppercase tracking-widest text-muted-foreground">{label}</p>
                <p className="text-[10px] font-bold text-muted-foreground opacity-60">{percentage}% Allocation</p>
            </div>
        </div>
        <p className="text-lg font-black font-mono tracking-tighter text-slate-900">${amount.toFixed(2)}</p>
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
  
  // Initialize date to current Bi-Weekly period
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
            details: `${member.payStructure === 'commission' ? 'Commission' : 'Hourly'} + Tips`
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
          { label: 'Profit', pct: 5, amount: amt * 0.05, color: 'bg-green-500' },
          { label: 'Owner Comp', pct: 50, amount: amt * 0.50, color: 'bg-primary' },
          { label: 'Tax', pct: 15, amount: amt * 0.15, color: 'bg-orange-500' },
          { label: 'OpEx / Bills', pct: 30, amount: amt * 0.30, color: 'bg-blue-500' },
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

    // 1. Record Staff Payouts as expenses
    staffObligations.forEach(obligation => {
        const txnRef = doc(collection(firestore, `tenants/${tenantId}/transactions`));
        const newTxn: Omit<Transaction, 'id'> = {
            date: now,
            description: `Payroll Payout: ${obligation.name}`,
            clientOrVendor: obligation.name,
            type: 'expense',
            context: 'Business',
            category: 'Payroll',
            amount: obligation.amount,
            paymentMethod: 'Distribution',
            hasReceipt: false,
            staffId: obligation.id,
        };
        batch.set(txnRef, { ...newTxn, id: txnRef.id });
    });

    // 2. Record Profit First bucket allocations as expenses (distributions)
    suggestions.forEach(bucket => {
        if (bucket.amount > 0) {
            const txnRef = doc(collection(firestore, `tenants/${tenantId}/transactions`));
            const newTxn: Omit<Transaction, 'id'> = {
                date: now,
                description: `Profit First Allocation: ${bucket.label}`,
                clientOrVendor: 'Internal Distribution',
                type: 'expense',
                context: 'Business',
                category: 'Distribution',
                amount: bucket.amount,
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
            description: `Successfully logged ${staffObligations.length + suggestions.filter(s => s.amount > 0).length} distribution transactions to the ledger.`
        });
        setAllocationAmount(0);
    } catch (e) {
        console.error("Distributions failed:", e);
        toast({ variant: 'destructive', title: "Distribution Failed", description: "Could not save transactions. Please try again." });
    } finally {
        setIsSubmitting(false);
    }
  };

  if (isLoading) {
      return (
          <div className="flex min-h-screen w-full flex-col bg-white">
            <AppHeader title="Payday" />
            <main className="flex-1 p-4 md:p-8 flex items-center justify-center">
                <Loader className="w-8 h-8 animate-spin" />
            </main>
          </div>
      )
  }

  return (
    <div className="flex min-h-screen w-full flex-col bg-white">
      <AppHeader title="Payday" />
      <main className="flex-1 p-4 md:p-8">
        <div className="max-w-2xl mx-auto px-4 md:px-0 space-y-10">
            <div className="text-center space-y-1">
                <h1 className="text-3xl font-black uppercase tracking-tighter text-slate-900">Run Payday</h1>
                <p className="text-sm text-muted-foreground font-medium uppercase tracking-widest opacity-70">
                    Reconcile Period & Allocate Revenue
                </p>
            </div>

            <div className="space-y-6">
                <div className="max-w-[340px] mx-auto flex gap-2 p-3 bg-muted border-2 border-muted rounded-2xl shadow-inner">
                    <Button variant="ghost" size="sm" onClick={() => handleCadenceChange('weekly')} className={cn("flex-1 text-[10px] font-black uppercase h-9 rounded-xl transition-all", cadence === 'weekly' ? "bg-white shadow-sm border border-border/50" : "hover:bg-white/50")}>Weekly</Button>
                    <Button variant="ghost" size="sm" onClick={() => handleCadenceChange('bi-weekly')} className={cn("flex-1 text-[10px] font-black uppercase h-9 rounded-xl transition-all", cadence === 'bi-weekly' ? "bg-white shadow-sm border border-border/50" : "hover:bg-white/50")}>Bi-Weekly</Button>
                    <Button variant="ghost" size="sm" onClick={() => handleCadenceChange('monthly')} className={cn("flex-1 text-[10px] font-black uppercase h-9 rounded-xl transition-all", cadence === 'monthly' ? "bg-white shadow-sm border border-border/50" : "hover:bg-white/50")}>Monthly</Button>
                    <Button variant="ghost" size="sm" onClick={() => handleCadenceChange('custom')} className={cn("flex-1 text-[10px] font-black uppercase h-9 rounded-xl transition-all", cadence === 'custom' ? "bg-white shadow-sm border border-border/50" : "hover:bg-white/50")}>Custom</Button>
                </div>

                {cadence === 'custom' ? (
                    <div className="p-10 md:p-16 bg-muted/30 rounded-[3rem] border-2 border-dashed border-muted-foreground/20 space-y-8 shadow-inner">
                        <div className="flex items-center gap-3 justify-center text-[11px] font-black uppercase tracking-widest text-primary">
                            <CalendarRange className="w-4 h-4" /> Select Custom Window
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-8 px-2 md:px-4">
                            <div className="space-y-3">
                                <Label className="text-[10px] uppercase font-black tracking-widest text-muted-foreground ml-2">Start Date</Label>
                                <input 
                                    type="date" 
                                    value={format(dateRange.from, 'yyyy-MM-dd')}
                                    onChange={(e) => {
                                        const newDate = e.target.value ? startOfDay(new Date(e.target.value.replace(/-/g, '/'))) : dateRange.from;
                                        setDateRange(prev => ({ ...prev, from: newDate }));
                                    }}
                                    className="w-full h-16 rounded-2xl border-2 bg-background px-4 font-black text-lg text-center focus:border-primary focus:ring-4 focus:ring-primary/10 transition-all outline-none shadow-md"
                                />
                            </div>
                            <div className="space-y-3">
                                <Label className="text-[10px] uppercase font-black tracking-widest text-muted-foreground ml-2">End Date</Label>
                                <input 
                                    type="date" 
                                    value={format(dateRange.to, 'yyyy-MM-dd')}
                                    onChange={(e) => {
                                        const newDate = e.target.value ? endOfDay(new Date(e.target.value.replace(/-/g, '/'))) : dateRange.to;
                                        setDateRange(prev => ({ ...prev, to: newDate }));
                                    }}
                                    className="w-full h-16 rounded-2xl border-2 bg-background px-4 font-black text-lg text-center focus:border-primary focus:ring-4 focus:ring-primary/10 transition-all outline-none shadow-md"
                                />
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="flex items-center justify-between p-6 bg-muted/30 rounded-2xl border-2 border-dashed border-muted-foreground/20 mx-1 md:mx-0 shadow-inner">
                        <Button 
                            variant="ghost" 
                            size="icon" 
                            onClick={handlePrevPeriod} 
                            className="h-12 w-12 hover:bg-white rounded-full shadow-sm"
                        >
                            <ChevronLeft className="w-6 h-6"/>
                        </Button>
                        
                        <div className="text-center px-4">
                            <p className="text-[10px] font-black uppercase tracking-widest text-primary mb-1">Reconciling Period</p>
                            <p className="text-base md:text-xl font-black text-slate-900 leading-none">
                                {format(dateRange.from, 'MMM d')} – {format(dateRange.to, 'MMM d, yyyy')}
                            </p>
                        </div>

                        <Button 
                            variant="ghost" 
                            size="icon" 
                            onClick={handleNextPeriod} 
                            className="h-12 w-12 hover:bg-white rounded-full shadow-sm"
                        >
                            <ChevronRight className="w-6 h-6"/>
                        </Button>
                    </div>
                )}
            </div>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Card className="border-2 shadow-sm bg-primary/5 border-primary/10">
                    <CardContent className="p-6 flex flex-col justify-center">
                        <p className="text-[10px] font-black uppercase text-primary tracking-widest mb-1">Period Net Income</p>
                        <p className="text-3xl font-black tracking-tighter text-primary">${currentBalance.toFixed(2)}</p>
                    </CardContent>
                </Card>
                <Card className={cn("border-2 shadow-sm", totalHardObligations > currentBalance ? "bg-destructive/5 border-destructive/20" : "bg-muted/20")}>
                    <CardContent className="p-6 flex flex-col justify-center">
                        <p className="text-[10px] font-black uppercase text-muted-foreground tracking-widest mb-1">Period Obligations Total</p>
                        <div className="flex items-center justify-between">
                            <p className={cn("text-3xl font-black tracking-tighter", totalHardObligations > currentBalance && "text-destructive")}>
                                ${totalHardObligations.toFixed(2)}
                            </p>
                            {totalHardObligations > currentBalance && (
                                <TooltipProvider>
                                    <Tooltip>
                                        <TooltipTrigger><AlertCircle className="w-5 h-5 text-destructive animate-pulse" /></TooltipTrigger>
                                        <TooltipContent><p>Warning: Obligations exceed period income.</p></TooltipContent>
                                    </Tooltip>
                                </TooltipProvider>
                            )}
                        </div>
                    </CardContent>
                </Card>
            </div>

            <Card className="border-2 shadow-xl overflow-hidden">
                <CardHeader className="p-6">
                    <CardTitle className="text-lg font-black uppercase tracking-tight flex items-center gap-2">
                        <Calculator className="w-5 h-5 text-primary" />
                        Allocation Engine
                    </CardTitle>
                    <CardDescription className="text-xs font-bold uppercase tracking-widest opacity-60">Suggestions based on Profit First methodology</CardDescription>
                </CardHeader>
                <CardContent className="space-y-8 p-6 pt-0">
                    <div className="space-y-2">
                        <div className="relative">
                            <DollarSign className="absolute left-4 top-1/2 -translate-y-1/2 h-6 w-6 text-muted-foreground" />
                            <Input 
                                id="allocation-amount" 
                                type="number" 
                                placeholder="0.00" 
                                className="pl-12 text-3xl font-black h-20 border-2 rounded-2xl tracking-tighter focus-visible:ring-primary/20" 
                                value={allocationAmount || ''}
                                onChange={(e) => setAllocationAmount(parseFloat(e.target.value) || 0)}
                            />
                        </div>
                        <div className="flex justify-between items-center px-1">
                            <p className="text-[10px] font-black uppercase text-muted-foreground">Amount to Distribute</p>
                            <Button variant="link" className="h-auto p-0 text-[10px] font-black uppercase" onClick={handleSetMaxBalance}>Use Period Income</Button>
                        </div>
                    </div>

                    {allocationAmount > 0 && (
                        <div className="space-y-4 animate-in fade-in slide-in-from-top-2 duration-500">
                            <Separator />
                            <p className="text-[10px] font-black uppercase tracking-widest text-primary text-center">Suggested Distribution</p>
                            <div className="grid gap-3">
                                {suggestions.map(s => (
                                    <AllocationItem key={s.label} label={s.label} percentage={s.pct} amount={s.amount} color={s.color} />
                                ))}
                            </div>
                            <div className="p-4 rounded-xl border-2 border-dashed bg-muted/10 flex items-start gap-3">
                                <Info className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
                                <p className="text-xs text-muted-foreground leading-relaxed font-medium">
                                    Your <strong>OpEx Allocation</strong> of ${suggestions[3].amount.toFixed(2)} will be used to clear the ${totalHardObligations.toFixed(2)} in hard obligations for this period.
                                </p>
                            </div>
                        </div>
                    )}

                     <Accordion type="single" collapsible className="w-full border-t pt-6">
                        <AccordionItem value="obligations-summary" className="border-none">
                            <AccordionTrigger className="p-5 bg-muted/30 rounded-2xl border-2 hover:no-underline">
                                <div className="flex items-center gap-2">
                                    <Receipt className="w-4 h-4 text-primary" />
                                    <span className="font-black uppercase text-xs tracking-widest">Unpaid Period Obligations Detail</span>
                                </div>
                            </AccordionTrigger>
                            <AccordionContent className="pt-6 space-y-6">
                                <div className='p-5 bg-muted/50 rounded-2xl border-2 space-y-4'>
                                    <h4 className='font-black text-[10px] uppercase tracking-widest flex items-center gap-2 text-primary'><Users className='w-3 h-3'/>Staff Earnings in Period</h4>
                                    <div className="space-y-3">
                                        {staffObligations.length > 0 ? staffObligations.map((owed, idx) => (
                                            <div key={idx} className='flex items-center justify-between bg-background p-3 rounded-xl border shadow-sm'>
                                                <div className="flex items-center gap-2">
                                                    <Avatar className="h-8 w-8">
                                                        <AvatarImage src={owed.avatarUrl} />
                                                        <AvatarFallback>{owed.name.charAt(0)}</AvatarFallback>
                                                    </Avatar>
                                                    <div>
                                                        <p className="text-xs font-bold leading-none">{owed.name}</p>
                                                        <p className="text-[10px] text-muted-foreground uppercase font-medium mt-1">{owed.details}</p>
                                                    </div>
                                                </div>
                                                <span className="font-mono font-bold text-sm">${owed.amount.toFixed(2)}</span>
                                            </div>
                                        )) : <p className="text-[10px] text-muted-foreground italic">No staff earnings recorded for this period.</p>}
                                    </div>
                                    <div className='flex justify-between text-sm border-t border-primary/20 pt-3 font-black'>
                                        <span className="uppercase text-[10px]">Total Staff Owed</span>
                                        <span className="text-primary">${staffTotalOwed.toFixed(2)}</span>
                                    </div>
                                </div>

                                <div className='p-5 bg-muted/50 rounded-2xl border-2 space-y-4'>
                                    <h4 className='font-black text-[10px] uppercase tracking-widest flex items-center gap-2 text-blue-600'><Building className='w-3 h-3'/>Business Bills Due</h4>
                                    <div className="space-y-2">
                                        {upcomingBusiness.length > 0 ? upcomingBusiness.map((item, idx) => (
                                            <div key={idx} className='flex justify-between text-xs font-bold'>
                                                <span className="text-muted-foreground">{item.definition?.name}</span>
                                                <span className="font-mono">${item.definition?.amount.toFixed(2)}</span>
                                            </div>
                                        )) : <p className="text-[10px] text-muted-foreground italic">No business bills due in this window.</p>}
                                    </div>
                                    <div className='flex justify-between text-sm border-t border-blue-500/20 pt-3 font-black'>
                                        <span className="uppercase text-[10px]">Total Business</span>
                                        <span className="text-blue-600">${businessBillsTotal.toFixed(2)}</span>
                                    </div>
                                </div>

                                 <div className='p-5 bg-muted/50 rounded-2xl border-2 space-y-4'>
                                    <h4 className='font-black text-[10px] uppercase tracking-widest flex items-center gap-2 text-purple-600'><User className='w-3 h-3'/>Personal Needs Due</h4>
                                    <div className="space-y-2">
                                        {upcomingPersonal.length > 0 ? upcomingPersonal.map((item, idx) => (
                                            <div key={idx} className='flex justify-between text-xs font-bold'>
                                                <span className="text-muted-foreground">{item.definition?.name}</span>
                                                <span className="font-mono">${item.definition?.amount.toFixed(2)}</span>
                                            </div>
                                        )) : <p className="text-[10px] text-muted-foreground italic">No personal bills due in this window.</p>}
                                    </div>
                                    <div className='flex justify-between text-sm border-t border-purple-500/20 pt-3 font-black'>
                                        <span className="uppercase text-[10px]">Total Personal</span>
                                        <span className="text-purple-600">${personalBillsTotal.toFixed(2)}</span>
                                    </div>
                                </div>
                            </AccordionContent>
                        </AccordionItem>
                    </Accordion>
                </CardContent>
                <CardFooter className="p-6 pt-0">
                    <Button 
                        size="lg" 
                        className="w-full h-16 rounded-2xl text-xl font-black uppercase tracking-tight shadow-xl shadow-primary/20" 
                        disabled={allocationAmount <= 0 || isSubmitting}
                        onClick={handleConfirmDistributions}
                    >
                        {isSubmitting ? <Loader className="animate-spin h-7 w-7" /> : (
                            <>
                                <CheckCircle2 className="mr-3 h-7 w-7" />
                                Confirm Distributions
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
