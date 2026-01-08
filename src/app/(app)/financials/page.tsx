
'use client';

import React from 'react';
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
import { DollarSign, Percent, Banknote, ShieldCheck, TrendingUp, Building, User, Save, PlusCircle } from 'lucide-react';

const FinancialFoundationPage = () => {
  return (
    <div className="flex min-h-screen w-full flex-col">
      <AppHeader title="Financial Foundation" />
      <main className="flex-1 p-4 md:p-8">
        <div className="max-w-4xl mx-auto space-y-8">
            <div>
              <h1 className="text-3xl font-bold">Financial Foundation</h1>
              <p className="text-muted-foreground mt-2">
                Define the core rules for your Profit First money management system.
              </p>
            </div>
            
            <div className="space-y-6">
                <Card>
                    <CardHeader>
                        <CardTitle>Smart Wallets</CardTitle>
                        <CardDescription>Set the allocation percentages for your payday suggestions. The remainder after these will be available for Owner's Draw.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                         <div className="flex items-center justify-between">
                            <Label htmlFor="tax-wallet" className="flex items-center gap-2"><ShieldCheck className="text-red-500" /> Tax Wallet</Label>
                            <div className="relative w-24">
                                <Input id="tax-wallet" type="number" defaultValue="20" className="pr-8" />
                                <Percent className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            </div>
                        </div>
                         <div className="flex items-center justify-between">
                            <Label htmlFor="growth-wallet" className="flex items-center gap-2"><TrendingUp className="text-green-500" /> Growth Fund</Label>
                            <div className="relative w-24">
                                <Input id="growth-wallet" type="number" defaultValue="5" className="pr-8" />
                                <Percent className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            </div>
                        </div>
                    </CardContent>
                     <CardFooter>
                        <Button className="ml-auto"><Save className="mr-2"/>Save Percentages</Button>
                    </CardFooter>
                </Card>

                 <Card>
                    <CardHeader>
                        <CardTitle>Recurring Expenses</CardTitle>
                        <CardDescription>Log all your fixed, recurring bills here. These will automatically populate your Bills page and inform your Payday calculations.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                       <p className='text-muted-foreground text-center py-8'>Recurring expense management coming soon.</p>
                       <Button variant="outline"><PlusCircle className="mr-2" />Add Recurring Expense</Button>
                    </CardContent>
                </Card>
            </div>
        </div>
      </main>
    </div>
  );
};

export default FinancialFoundationPage;
