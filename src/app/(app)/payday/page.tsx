
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
import { DollarSign, Building, User } from 'lucide-react';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';

const PaydayPage = () => {
  return (
    <div className="flex min-h-screen w-full flex-col">
      <AppHeader title="Payday" />
      <main className="flex-1 p-4 md:p-8">
        <div className="max-w-2xl mx-auto space-y-8">
            <div>
              <h1 className="text-3xl font-bold">Run Payday</h1>
              <p className="text-muted-foreground mt-2">
                Follow the Profit First principle to pay yourself and manage your business cash flow.
              </p>
            </div>
            
            <Card>
                <CardHeader>
                    <CardTitle>Run Payday</CardTitle>
                    <CardDescription>Allocate every dollar of revenue into your digital wallets.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="space-y-2">
                        <Label htmlFor="allocation-amount" className="text-base">Available to Allocate</Label>
                        <div className="relative">
                            <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                            <Input id="allocation-amount" type="number" placeholder="Enter total funds for this payday" className="pl-10 text-xl h-14" />
                        </div>
                    </div>
                     <Accordion type="single" collapsible className="w-full">
                        <AccordionItem value="bills-summary">
                            <AccordionTrigger>Upcoming Bills Summary</AccordionTrigger>
                            <AccordionContent className="space-y-4">
                                <div className='p-4 bg-muted/50 rounded-lg space-y-2'>
                                    <h4 className='font-semibold flex items-center gap-2'><Building className='w-4 h-4 text-blue-500'/>Upcoming Business Bills</h4>
                                    <div className='flex justify-between text-sm'><span>Studio Rent</span><span>$1,200.00</span></div>
                                    <div className='flex justify-between text-sm'><span>Booking Software</span><span>$49.00</span></div>
                                    <div className='flex justify-between text-sm border-t pt-2 font-medium'><span>Total:</span><span>$1,249.00</span></div>
                                </div>
                                 <div className='p-4 bg-muted/50 rounded-lg space-y-2'>
                                    <h4 className='font-semibold flex items-center gap-2'><User className='w-4 h-4 text-purple-500'/>Upcoming Personal Bills</h4>
                                    <div className='flex justify-between text-sm'><span>Personal Rent</span><span>$2,000.00</span></div>
                                    <div className='flex justify-between text-sm'><span>Car Insurance</span><span>$150.00</span></div>
                                    <div className='flex justify-between text-sm border-t pt-2 font-medium'><span>Total:</span><span>$2,150.00</span></div>
                                </div>
                            </AccordionContent>
                        </AccordionItem>
                    </Accordion>
                </CardContent>
                <CardFooter>
                    <Button size="lg" className="w-full">Run Payday & Allocate Funds</Button>
                </CardFooter>
            </Card>
        </div>
      </main>
    </div>
  );
};

export default PaydayPage;
