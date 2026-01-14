'use client';

import React, { useState, useMemo, useEffect, useCallback } from 'react';
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
import { ArrowLeft, Save, PlusCircle, Trash2, Calculator, Info, DollarSign } from 'lucide-react';
import Link from 'next/link';
import { clients as initialClients, services as initialServices, type Client, type Service, inventory as allInventory } from '@/lib/data';
import { Textarea } from '@/components/ui/textarea';
import { useInventory } from '@/context/InventoryContext';
import { useToast } from '@/hooks/use-toast';
import { useFirebase, addDocumentNonBlocking } from '@/firebase';
import { collection } from 'firebase/firestore';
import { useRouter } from 'next/navigation';

type LineItem = {
    id: string;
    name: string;
    description: string;
    price: number;
    cost: number;
};

const ProfitAnalysisCard = ({ 
    lineItems,
    travelAndExpenses,
    projectFeePercent,
    tmhr,
    totalHours,
} : {
    lineItems: LineItem[];
    travelAndExpenses: number;
    projectFeePercent: number;
    tmhr: number;
    totalHours: number;
}) => {
    const { servicesSubtotal, servicesCost } = useMemo(() => {
        const subtotal = lineItems.reduce((acc, item) => acc + item.price, 0);
        const cost = lineItems.reduce((acc, item) => acc + item.cost, 0);
        return { servicesSubtotal: subtotal, servicesCost: cost };
    }, [lineItems]);

    const projectFee = servicesSubtotal * (projectFeePercent / 100);
    const totalQuotePrice = servicesSubtotal + travelAndExpenses + projectFee;
    
    const timeCost = totalHours * tmhr;
    const breakEvenPoint = servicesCost + travelAndExpenses + timeCost;
    
    const netProfit = totalQuotePrice - breakEvenPoint;
    const profitMargin = totalQuotePrice > 0 ? (netProfit / totalQuotePrice) * 100 : 0;

  return (
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
            <p className="text-2xl font-bold text-primary">${totalQuotePrice.toFixed(2)}</p>
          </div>
          <Info className="h-5 w-5 text-muted-foreground" />
        </div>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span>Services Subtotal</span>
            <span>${servicesSubtotal.toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span>Travel & Expenses</span>
            <span>${travelAndExpenses.toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span>Project Fee ({projectFeePercent}%)</span>
            <span>${projectFee.toFixed(2)}</span>
          </div>
          <div className="flex justify-between font-medium border-t pt-2">
            <span>Break-Even Point</span>
            <span className="text-destructive">${breakEvenPoint.toFixed(2)}</span>
          </div>
        </div>
      </CardContent>
      <CardFooter className="flex flex-col gap-2 bg-muted/50 p-4 rounded-b-lg">
        <div className="w-full flex justify-between text-lg font-bold">
          <span>Net Profit</span>
          <span className="text-primary">${netProfit.toFixed(2)}</span>
        </div>
        <div className="w-full flex justify-between text-sm text-muted-foreground">
          <span>Profit Margin</span>
          <span>{profitMargin.toFixed(1)}%</span>
        </div>
      </CardFooter>
    </Card>
  );
};

export default function QuoteGeneratorPage() {
    const { clients } = useInventory();
    const [tmhr, setTmhr] = useState(0);
    const { toast } = useToast();
    const { firestore, user } = useFirebase();
    const router = useRouter();

    const [clientId, setClientId] = useState('');
    const [eventName, setEventName] = useState('');
    const [eventDate, setEventDate] = useState('');
    const [eventLocation, setEventLocation] = useState('');
    const [lineItems, setLineItems] = useState<LineItem[]>([]);
    const [travelExpenses, setTravelExpenses] = useState(0);
    const [projectFee, setProjectFee] = useState(0);
    const [notes, setNotes] = useState('');
    const [totalHours, setTotalHours] = useState(0);

    useEffect(() => {
        if (typeof window !== 'undefined') {
            setTmhr(parseFloat(localStorage.getItem('tmhr') || '50'));
        }
    }, []);

    const addServiceAsLineItem = (serviceId: string) => {
        const service = initialServices.find(s => s.id === serviceId);
        if (service && !lineItems.some(item => item.id === service.id)) {
            const newItem: LineItem = {
                id: service.id,
                name: service.name,
                description: service.description || '',
                price: service.price,
                cost: service.cost,
            };
            setLineItems(prev => [...prev, newItem]);
        }
    };

    const removeLineItem = (itemId: string) => {
        setLineItems(prev => prev.filter(item => item.id !== itemId));
    };

    const handleSaveQuote = async () => {
        if (!clientId || !eventName || !firestore || !user) {
            toast({
                variant: 'destructive',
                title: 'Missing Information',
                description: 'Please select a client and provide an event name.',
            });
            return;
        }

        const quoteData = {
            clientId,
            eventName,
            eventDate,
            eventLocation,
            lineItems,
            travelExpenses,
            projectFee,
            notes,
            totalHours,
            status: 'draft',
            createdAt: new Date().toISOString(),
            userId: user.uid,
        };

        try {
            const quotesRef = collection(firestore, 'tenants', 'tenant-abc', 'quotes');
            await addDocumentNonBlocking(quotesRef, quoteData);
            toast({
                title: 'Quote Saved',
                description: 'Your quote has been saved as a draft.',
            });
            router.push('/quotes');
        } catch (error) {
            console.error("Error saving quote: ", error);
            toast({
                variant: 'destructive',
                title: 'Error',
                description: 'There was a problem saving your quote.',
            });
        }
    };


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
                              <Select value={clientId} onValueChange={setClientId}>
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
                          <Input id="event-name" value={eventName} onChange={e => setEventName(e.target.value)} placeholder="e.g., Carla & Mark's Wedding" />
                        </div>
                         <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="event-date">Event Date</Label>
                                <Input id="event-date" type="date" value={eventDate} onChange={e => setEventDate(e.target.value)} />
                            </div>
                             <div className="space-y-2">
                                <Label htmlFor="event-location">Event Location</Label>
                                <Input id="event-location" value={eventLocation} onChange={e => setEventLocation(e.target.value)} placeholder="e.g., The Grand Ballroom" />
                            </div>
                         </div>
                          <div className="space-y-2">
                            <Label htmlFor="total-hours">Total Billable Hours</Label>
                            <Input id="total-hours" type="number" value={totalHours} onChange={e => setTotalHours(Number(e.target.value))} placeholder="e.g., 8" />
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
                        {lineItems.length > 0 ? (
                            lineItems.map(item => (
                                <div key={item.id} className="flex justify-between items-center p-3 bg-muted/50 rounded-lg">
                                    <div>
                                        <p className="font-medium">{item.name}</p>
                                        <p className="text-sm text-muted-foreground">${item.price.toFixed(2)}</p>
                                    </div>
                                    <Button variant="ghost" size="icon" className="text-destructive" onClick={() => removeLineItem(item.id)}>
                                        <Trash2 className="w-4 h-4" />
                                    </Button>
                                </div>
                            ))
                        ) : (
                             <div className='p-8 text-center text-sm text-muted-foreground bg-muted/50 rounded-lg'>
                                Line items will appear here.
                            </div>
                        )}
                        <div className='flex gap-2 flex-wrap'>
                            <Select onValueChange={addServiceAsLineItem}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Add from Library..." />
                                </SelectTrigger>
                                <SelectContent>
                                    {initialServices.map(s => <SelectItem key={s.id} value={s.id} disabled={lineItems.some(li => li.id === s.id)}>{s.name}</SelectItem>)}
                                </SelectContent>
                            </Select>
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
                        <div className="space-y-2">
                            <Label htmlFor="travel-expenses">Flat Travel & Expenses</Label>
                             <div className="relative">
                                <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                <Input id="travel-expenses" type="number" value={travelExpenses} onChange={e => setTravelExpenses(Number(e.target.value))} className="pl-9" />
                            </div>
                        </div>
                      </CardContent>
                    </Card>
                  </AccordionContent>
                </AccordionItem>
                
                 <AccordionItem value="item-4">
                  <AccordionTrigger className='text-lg font-semibold'>Fees & Payment Terms</AccordionTrigger>
                  <AccordionContent className='pt-4'>
                    <Card>
                      <CardContent className="p-6 grid gap-6">
                        <div className="space-y-2">
                            <Label htmlFor="project-fee">Project Fee (%)</Label>
                            <Input id="project-fee" type="number" value={projectFee} onChange={e => setProjectFee(Number(e.target.value))} placeholder="e.g., 10 for a 10% project fee" />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="notes">Notes & Conditions</Label>
                            <Textarea id="notes" value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g., Travel fees subject to change. Quote valid for 14 days." />
                        </div>
                      </CardContent>
                    </Card>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </div>
            <div className="lg:col-span-1">
              <ProfitAnalysisCard 
                lineItems={lineItems}
                travelAndExpenses={travelExpenses}
                projectFeePercent={projectFee}
                tmhr={tmhr}
                totalHours={totalHours}
              />
            </div>
          </div>
          
          <div className="flex flex-col-reverse sm:flex-row items-center justify-end gap-2 mt-8">
              <Button variant="outline" className="w-full sm:w-auto">Preview</Button>
              <Button className="w-full sm:w-auto" onClick={handleSaveQuote}>
                <Save className="mr-2" />
                Save Quote as Draft
              </Button>
            </div>
        </div>
      </main>
    </div>
  );
}
