
'use client';

import React, { useState, useMemo } from 'react';
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
import { DollarSign, Building, User, PiggyBank, Receipt, Wallet, TrendingUp, Landmark, Calculator, Info } from 'lucide-react';
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

const AllocationItem = ({ label, percentage, amount, color }: { label: string, percentage: number, amount: number, color: string }) => (
    <div className="flex items-center justify-between p-3 rounded-xl bg-muted/30 border">
        <div className="flex items-center gap-3">
            <div className={cn("w-2 h-8 rounded-full", color)} />
            <div>
                <p className="text-xs font-black uppercase tracking-widest text-muted-foreground">{label}</p>
                <p className="text-[10px] font-bold text-muted-foreground opacity-60">{percentage}% Allocation</p>
            </div>
        </div>
        <p className="text-lg font-black font-mono tracking-tighter">${amount.toFixed(2)}</p>
    </div>
);

const PaydayPage = () => {
  const { billDefinitions, billInstances, transactions } = useInventory();
  const [allocationAmount, setAllocationAmount] = useState<number>(0);

  const currentBalance = useMemo(() => {
      const income = transactions.filter(t => t.type === 'income').reduce((acc, t) => acc + t.amount, 0);
      const expenses = transactions.filter(t => t.type === 'expense' || t.type === 'payment').reduce((acc, t) => acc + t.amount, 0);
      return Math.max(0, income - expenses);
  }, [transactions]);

  const unpaidInstances = useMemo(() => billInstances.filter(i => i.status !== 'paid'), [billInstances]);

  const upcomingBusiness = useMemo(() => {
      return unpaidInstances
        .map(i => ({ instance: i, definition: billDefinitions.find(d => d.id === i.billDefinitionId) }))
        .filter(item => item.definition?.context === 'Business');
  }, [unpaidInstances, billDefinitions]);

  const upcomingPersonal = useMemo(() => {
      return unpaidInstances
        .map(i => ({ instance: i, definition: billDefinitions.find(d => d.id === i.billDefinitionId) }))
        .filter(item => item.definition?.context === 'Personal');
  }, [unpaidInstances, billDefinitions]);

  const businessTotal = upcomingBusiness.reduce((sum, item) => sum + (item.definition?.amount || 0), 0);
  const personalTotal = upcomingPersonal.reduce((sum, item) => sum + (item.definition?.amount || 0), 0);

  // Profit First Suggestions
  const suggestions = useMemo(() => {
      const amt = allocationAmount || 0;
      return [
          { label: 'Profit', pct: 5, amount: amt * 0.05, color: 'bg-green-500' },
          { label: 'Owner Comp', pct: 50, amount: amt * 0.50, color: 'bg-primary' },
          { label: 'Tax', pct: 15, amount: amt * 0.15, color: 'bg-orange-500' },
          { label: 'OpEx / Bills', pct: 30, amount: amt * 0.30, color: 'bg-blue-500' },
      ];
  }, [allocationAmount]);

  return (
    <div className="flex min-h-screen w-full flex-col bg-white">
      <AppHeader title="Payday" />
      <main className="flex-1 p-4 md:p-8">
        <div className="max-w-2xl mx-auto space-y-8">
            <div className="space-y-1">
              <h1 className="text-3xl font-black uppercase tracking-tighter">Run Payday</h1>
              <p className="text-sm text-muted-foreground font-medium uppercase tracking-widest opacity-70">
                Allocate revenue using the Profit First principle
              </p>
            </div>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Card className="border-2 shadow-sm bg-primary/5 border-primary/10">
                    <CardContent className="p-4 flex flex-col justify-center">
                        <p className="text-[10px] font-black uppercase text-primary tracking-widest mb-1">Current Wallet Balance</p>
                        <p className="text-3xl font-black tracking-tighter text-primary">${currentBalance.toFixed(2)}</p>
                    </CardContent>
                </Card>
                <Card className="border-2 shadow-sm bg-muted/20">
                    <CardContent className="p-4 flex flex-col justify-center">
                        <p className="text-[10px] font-black uppercase text-muted-foreground tracking-widest mb-1">Unpaid Bills Total</p>
                        <p className="text-3xl font-black tracking-tighter">${(businessTotal + personalTotal).toFixed(2)}</p>
                    </CardContent>
                </Card>
            </div>

            <Card className="border-2 shadow-xl">
                <CardHeader>
                    <CardTitle className="text-lg font-black uppercase tracking-tight flex items-center gap-2">
                        <Calculator className="w-5 h-5 text-primary" />
                        Allocation Engine
                    </CardTitle>
                    <CardDescription className="text-xs font-bold uppercase tracking-widest opacity-60">How much are you distributing today?</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
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
                            <p className="text-[10px] font-black uppercase text-muted-foreground">Available to Allocate</p>
                            <Button variant="link" className="h-auto p-0 text-[10px] font-black uppercase" onClick={() => setAllocationAmount(currentBalance)}>Use Max Balance</Button>
                        </div>
                    </div>

                    {allocationAmount > 0 && (
                        <div className="space-y-3 animate-in fade-in slide-in-from-top-2 duration-500">
                            <Separator />
                            <p className="text-[10px] font-black uppercase tracking-widest text-primary text-center">Suggested Profit First Distribution</p>
                            <div className="grid gap-2">
                                {suggestions.map(s => (
                                    <AllocationItem key={s.label} label={s.label} percentage={s.pct} amount={s.amount} color={s.color} />
                                ))}
                            </div>
                            <div className="p-3 rounded-xl border-2 border-dashed bg-muted/10 flex items-start gap-3">
                                <Info className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
                                <p className="text-[10px] text-muted-foreground leading-relaxed font-medium">
                                    Your <strong>OpEx Allocation</strong> of ${suggestions[3].amount.toFixed(2)} compares to your total business bills of ${businessTotal.toFixed(2)} due this period.
                                </p>
                            </div>
                        </div>
                    )}

                     <Accordion type="single" collapsible className="w-full border-t pt-4">
                        <AccordionItem value="bills-summary" className="border-none">
                            <AccordionTrigger className="p-4 bg-muted/30 rounded-xl border-2 hover:no-underline">
                                <div className="flex items-center gap-2">
                                    <Receipt className="w-4 h-4 text-primary" />
                                    <span className="font-black uppercase text-xs tracking-widest">Upcoming Bills Summary</span>
                                </div>
                            </AccordionTrigger>
                            <AccordionContent className="pt-4 space-y-4">
                                <div className='p-4 bg-muted/50 rounded-xl border-2 space-y-3'>
                                    <h4 className='font-black text-[10px] uppercase tracking-widest flex items-center gap-2 text-blue-600'><Building className='w-3 h-3'/>Business Obligations</h4>
                                    <div className="space-y-1">
                                        {upcomingBusiness.length > 0 ? upcomingBusiness.map((item, idx) => (
                                            <div key={idx} className='flex justify-between text-xs font-bold'>
                                                <span className="text-muted-foreground">{item.definition?.name}</span>
                                                <span className="font-mono">${item.definition?.amount.toFixed(2)}</span>
                                            </div>
                                        )) : <p className="text-[10px] text-muted-foreground italic">No upcoming business bills.</p>}
                                    </div>
                                    <div className='flex justify-between text-sm border-t border-blue-500/20 pt-2 font-black'>
                                        <span className="uppercase text-[10px]">Total Business</span>
                                        <span className="text-blue-600">${businessTotal.toFixed(2)}</span>
                                    </div>
                                </div>

                                 <div className='p-4 bg-muted/50 rounded-xl border-2 space-y-3'>
                                    <h4 className='font-black text-[10px] uppercase tracking-widest flex items-center gap-2 text-purple-600'><User className='w-3 h-3'/>Personal Needs</h4>
                                    <div className="space-y-1">
                                        {upcomingPersonal.length > 0 ? upcomingPersonal.map((item, idx) => (
                                            <div key={idx} className='flex justify-between text-xs font-bold'>
                                                <span className="text-muted-foreground">{item.definition?.name}</span>
                                                <span className="font-mono">${item.definition?.amount.toFixed(2)}</span>
                                            </div>
                                        )) : <p className="text-[10px] text-muted-foreground italic">No upcoming personal bills.</p>}
                                    </div>
                                    <div className='flex justify-between text-sm border-t border-purple-500/20 pt-2 font-black'>
                                        <span className="uppercase text-[10px]">Total Personal</span>
                                        <span className="text-purple-600">${personalTotal.toFixed(2)}</span>
                                    </div>
                                </div>
                            </AccordionContent>
                        </AccordionItem>
                    </Accordion>
                </CardContent>
                <CardFooter className="p-6 pt-0">
                    <Button size="lg" className="w-full h-14 rounded-2xl text-lg font-black uppercase tracking-tight shadow-xl shadow-primary/20" disabled={allocationAmount <= 0}>
                        <DollarSign className="mr-2" />
                        Process Payday
                    </Button>
                </CardFooter>
            </Card>
        </div>
      </main>
    </div>
  );
};

export default PaydayPage;
