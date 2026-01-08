
'use client';

import React from 'react';
import { AppHeader } from '@/components/shared/AppHeader';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { ArrowLeft, Save, PlusCircle, Trash2, Calculator, Info } from 'lucide-react';
import Link from 'next/link';
import { clients, Client } from '@/lib/data';
import { Textarea } from '@/components/ui/textarea';

const ProfitAnalysisCard = () => (
  <Card className="lg:sticky top-20">
    <CardHeader>
      <CardTitle>Profit & Pricing Analysis</CardTitle>
      <CardDescription>
        Real-time financial breakdown of this quote.
      </CardDescription>
    </CardHeader>
    <CardContent className="space-y-4">
      <div className="flex justify-between items-center p-4 rounded-lg bg-muted/50">
        <div>
          <p className="text-sm text-muted-foreground">Total Quote Price</p>
          <p className="text-2xl font-bold text-primary">$0.00</p>
        </div>
        <Info className="h-5 w-5 text-muted-foreground" />
      </div>
      <div className="space-y-2 text-sm">
        <div className="flex justify-between">
          <span>Services Subtotal</span>
          <span>$0.00</span>
        </div>
        <div className="flex justify-between">
          <span>Travel & Expenses</span>
          <span>$0.00</span>
        </div>
        <div className="flex justify-between">
          <span>Project Fee (0%)</span>
          <span>$0.00</span>
        </div>
        <div className="flex justify-between font-medium border-t pt-2">
          <span>Break-Even Point</span>
          <span className="text-destructive">$0.00</span>
        </div>
      </div>
    </CardContent>
    <CardFooter className="flex flex-col gap-2 bg-muted/50 p-4 rounded-b-lg">
      <div className="w-full flex justify-between text-lg font-bold">
        <span>Net Profit</span>
        <span className="text-primary">$0.00</span>
      </div>
      <div className="w-full flex justify-between text-sm text-muted-foreground">
        <span>Profit Margin</span>
        <span>0.0%</span>
      </div>
    </CardFooter>
  </Card>
);

export default function QuoteGeneratorPage() {
  return (
    <div className="flex min-h-screen w-full flex-col">
      <AppHeader title="New Quote" />
      <main className="flex-1 p-4 md:p-8">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center justify-between gap-4 mb-8">
            <Button variant="outline" asChild>
              <Link href="/quotes">
                <ArrowLeft className="mr-2" />
                Back to All Quotes
              </Link>
            </Button>
          </div>

          <div className="grid lg:grid-cols-3 gap-8">
            <div className="lg:col-span-2 space-y-6">
              <Accordion type="multiple" defaultValue={['item-1']} className="w-full space-y-6">
                <AccordionItem value="item-1">
                  <AccordionTrigger className='text-lg font-semibold'>Event Details</AccordionTrigger>
                  <AccordionContent className='pt-4'>
                    <Card>
                      <CardContent className="p-6 grid gap-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                           <div className="space-y-2">
                              <Label htmlFor="client">Client</Label>
                              <Select>
                                <SelectTrigger id="client">
                                  <SelectValue placeholder="Select an existing client" />
                                </SelectTrigger>
                                <SelectContent>
                                  {clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="flex items-end">
                                <Button variant="outline" className="w-full md:w-auto"><PlusCircle className="mr-2"/>New Client</Button>
                            </div>
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="event-name">Event Name</Label>
                          <Input id="event-name" placeholder="e.g., Carla & Mark's Wedding" />
                        </div>
                         <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="event-date">Event Date</Label>
                                <Input id="event-date" type="date" />
                            </div>
                             <div className="space-y-2">
                                <Label htmlFor="event-location">Event Location</Label>
                                <Input id="event-location" placeholder="e.g., The Grand Ballroom" />
                            </div>
                         </div>
                      </CardContent>
                    </Card>
                  </AccordionContent>
                </AccordionItem>
                
                <AccordionItem value="item-2">
                  <AccordionTrigger className='text-lg font-semibold'>Services & Products</AccordionTrigger>
                  <AccordionContent className='pt-4'>
                    <Card>
                      <CardHeader>
                        <CardTitle>Line Items</CardTitle>
                        <CardDescription>Add services from your library and any products being sold.</CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <div className='p-8 text-center text-sm text-muted-foreground bg-muted/50 rounded-lg'>
                          Line items will appear here.
                        </div>
                        <div className='flex gap-2 flex-wrap'>
                           <Button variant="outline"><PlusCircle className="mr-2" />Add from Library</Button>
                           <Button variant="outline"><PlusCircle className="mr-2" />Browse Products</Button>
                        </div>
                      </CardContent>
                    </Card>
                  </AccordionContent>
                </AccordionItem>

                 <AccordionItem value="item-3">
                  <AccordionTrigger className='text-lg font-semibold'>Travel & Expenses</AccordionTrigger>
                  <AccordionContent className='pt-4'>
                    <Card>
                      <CardContent className="p-6 grid gap-6">
                        <div className='space-y-4 p-4 border rounded-lg'>
                            <Label>Mileage Calculator</Label>
                             <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <Input placeholder="Start Address" />
                                <Input placeholder="End Address" />
                             </div>
                             <Button variant="outline"><Calculator className="mr-2"/>Calculate Travel</Button>
                        </div>
                        <div className='space-y-2'>
                            <Label>Other Expenses</Label>
                            <div className='p-8 text-center text-sm text-muted-foreground bg-muted/50 rounded-lg'>
                              Add expenses like flights, lodging, etc.
                            </div>
                            <Button variant="outline"><PlusCircle className="mr-2" />Add Expense</Button>
                        </div>
                      </CardContent>
                    </Card>
                  </AccordionContent>
                </AccordionItem>

                 <AccordionItem value="item-4">
                  <AccordionTrigger className='text-lg font-semibold'>Payment Terms</AccordionTrigger>
                  <AccordionContent className='pt-4'>
                    <Card>
                      <CardContent className="p-6 grid gap-6">
                        <div className="space-y-2">
                            <Label>Deposit Requirement</Label>
                             <p className="text-sm text-muted-foreground">Define how much the client needs to pay upfront to secure the booking.</p>
                             {/* Placeholder for ToggleGroup */}
                             <div className="flex gap-2 flex-wrap">
                                <Button variant="outline">None</Button>
                                <Button variant="secondary">Deposit</Button>
                                <Button variant="outline">Pay in Full</Button>
                             </div>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="notes">Notes & Conditions</Label>
                            <Textarea id="notes" placeholder="e.g., Travel fees subject to change. Quote valid for 14 days." />
                        </div>
                      </CardContent>
                    </Card>
                  </AccordionContent>
                </AccordionItem>

              </Accordion>
            </div>
            <div className="lg:col-span-1">
              <ProfitAnalysisCard />
            </div>
          </div>
          
          <div className="flex flex-col-reverse sm:flex-row items-center justify-end gap-2 mt-8">
              <Button variant="outline" className="w-full sm:w-auto">Preview</Button>
              <Button className="w-full sm:w-auto">
                <Save className="mr-2" />
                Save Quote
              </Button>
            </div>
        </div>
      </main>
    </div>
  );
}
