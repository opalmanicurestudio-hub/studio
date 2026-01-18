

'use client';

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { AppHeader } from '@/components/shared/AppHeader';
import { Button, buttonVariants } from '@/components/ui/button';
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
import { ArrowLeft, Save, PlusCircle, Trash2, Calculator, Info, DollarSign, Calendar as CalendarIcon, UserPlus, Car, Briefcase, Landlord, Utensils, Plane, Hotel, Loader } from 'lucide-react';
import Link from 'next/link';
import { clients as initialClients, services as initialServices, type Client, type Service, inventory as allInventory } from '@/lib/data';
import { Textarea } from '@/components/ui/textarea';
import { useInventory } from '@/context/InventoryContext';
import { useToast } from '@/hooks/use-toast';
import { useFirebase, addDocumentNonBlocking } from '@/firebase';
import { collection } from 'firebase/firestore';
import { useRouter } from 'next/navigation';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Switch } from '@/components/ui/switch';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Slider } from '@/components/ui/slider';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';

type LineItem = {
    id: string;
    name: string;
    description: string;
    price: number;
    cost: number;
    quantity: number;
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
        const subtotal = lineItems.reduce((acc, item) => acc + (item.price * item.quantity), 0);
        const cost = lineItems.reduce((acc, item) => acc + (item.cost * item.quantity), 0);
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
    const { clients, setClients: setAllClients } = useInventory();
    const [tmhr, setTmhr] = useState(0);
    const { toast } = useToast();
    const { firestore, user } = useFirebase();
    const router = useRouter();

    // Event Details
    const [clientId, setClientId] = useState('');
    const [isAddingClient, setIsAddingClient] = useState(false);
    const [eventName, setEventName] = useState('');
    const [eventStartDate, setEventStartDate] = useState<Date | undefined>(new Date());
    const [eventEndDate, setEventEndDate] = useState<Date | undefined>();
    const [eventStartTime, setEventStartTime] = useState('09:00');
    const [eventEndTime, setEventEndTime] = useState('17:00');
    const [isMultiDay, setIsMultiDay] = useState(false);
    const [totalHours, setTotalHours] = useState(0);
    const [eventLocation, setEventLocation] = useState({ street: '', city: '', state: '', zip: '', country: '' });


    // Line Items
    const [lineItems, setLineItems] = useState<LineItem[]>([]);
    
    // Travel & Expenses
    const [roundTripDistance, setRoundTripDistance] = useState(0);
    const [travelTime, setTravelTime] = useState(0);
    const [costPerMile, setCostPerMile] = useState(0.67); // 2024 IRS rate
    const [isCalculatingTravel, setIsCalculatingTravel] = useState(false);
    const [flightsCost, setFlightsCost] = useState(0);
    const [lodgingNights, setLodgingNights] = useState(0);
    const [lodgingRatePerNight, setLodgingRatePerNight] = useState(0);
    const [numberOfDays, setNumberOfDays] = useState(0);
    const [ratePerDay, setRatePerDay] = useState(0);
    const [equipmentRentalCost, setEquipmentRentalCost] = useState(0);


    // Fees & Payment
    const [projectFee, setProjectFee] = useState(0);
    const [price, setPrice] = useState(0);
    const [depositType, setDepositType] = useState('none');
    const [depositAmount, setDepositAmount] = useState(0);
    const [notes, setNotes] = useState('');


    useEffect(() => {
        if (typeof window !== 'undefined') {
            setTmhr(parseFloat(localStorage.getItem('tmhr') || '50'));
        }
    }, []);
    
    const travelAndExpenses = useMemo(() => {
        const mileageCost = roundTripDistance * costPerMile;
        const lodgingCost = lodgingNights * lodgingRatePerNight;
        const perDiemCost = numberOfDays * ratePerDay;
        return mileageCost + flightsCost + lodgingCost + perDiemCost + equipmentRentalCost;
    }, [roundTripDistance, costPerMile, flightsCost, lodgingNights, lodgingRatePerNight, numberOfDays, ratePerDay, equipmentRentalCost]);
    
    const handleCalculateTravel = () => {
        setIsCalculatingTravel(true);
        // This would be a server action in a real app
        setTimeout(() => {
            setRoundTripDistance(124); // Mock data
            setTravelTime(150); // Mock data
            setIsCalculatingTravel(false);
            toast({
                title: "Travel Calculated",
                description: "Round trip distance and time have been estimated.",
            })
        }, 1500);
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
            eventDate: eventStartDate?.toISOString(),
            eventLocation: eventLocation,
            lineItems: lineItems,
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
    
    const addServiceAsLineItem = (serviceId: string) => {
        const service = initialServices.find(s => s.id === serviceId);
        if (service && !lineItems.some(item => item.id === service.id)) {
            const newItem: LineItem = {
                id: service.id,
                name: service.name,
                description: service.description || '',
                price: service.price,
                cost: service.cost,
                quantity: 1,
            };
            setLineItems(prev => [...prev, newItem]);
        }
    };
    
    const removeLineItem = (itemId: string) => {
        setLineItems(prev => prev.filter(item => item.id !== itemId));
    };

    const handleLineItemQuantityChange = (id: string, quantity: number) => {
        setLineItems(prev => prev.map(item => item.id === id ? {...item, quantity: quantity} : item));
    }


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
              <Accordion type="multiple" defaultValue={['event-details', 'services-products']} className="w-full space-y-6">
                <AccordionItem value="event-details">
                  <AccordionTrigger className='text-lg font-semibold'>Event Details</AccordionTrigger>
                  <AccordionContent className='pt-4'>
                    <Card>
                      <CardContent className="p-6 grid gap-4">
                        <div className="space-y-2">
                           <Label htmlFor="client">Client</Label>
                            <div className="flex gap-2">
                              <Select value={clientId} onValueChange={(value) => {
                                  if (value === 'add-new') {
                                      setIsAddingClient(true);
                                      setClientId('');
                                  } else {
                                      setIsAddingClient(false);
                                      setClientId(value);
                                  }
                              }}>
                                <SelectTrigger id="client">
                                  <SelectValue placeholder="Select an existing client" />
                                </SelectTrigger>
                                <SelectContent>
                                  {clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                                  <SelectItem value="add-new">
                                      <span className="flex items-center gap-2"><UserPlus /> Register New Client</span>
                                  </SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                        </div>
                        {isAddingClient && (
                            <Card className="bg-muted/50 p-4 space-y-4">
                                <h4 className="font-medium">New Client</h4>
                                <Input placeholder="Full Name" />
                                <Input type="email" placeholder="Email Address" />
                                <Input type="tel" placeholder="Phone Number" />
                            </Card>
                        )}
                        <div className="space-y-2">
                          <Label htmlFor="event-name">Event Name</Label>
                          <Input id="event-name" value={eventName} onChange={e => setEventName(e.target.value)} placeholder="e.g., Carla & Mark's Wedding" />
                        </div>
                        <div className="space-y-2">
                            <Label>Event Location</Label>
                             <div className="space-y-2 p-4 border rounded-lg">
                                <Input value={eventLocation.street} onChange={(e) => setEventLocation(prev => ({ ...prev, street: e.target.value }))} placeholder="Street Address" />
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                    <Input value={eventLocation.city} onChange={(e) => setEventLocation(prev => ({ ...prev, city: e.target.value }))} placeholder="City" />
                                    <Input value={eventLocation.state} onChange={(e) => setEventLocation(prev => ({ ...prev, state: e.target.value }))} placeholder="State / Province" />
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                    <Input value={eventLocation.zip} onChange={(e) => setEventLocation(prev => ({ ...prev, zip: e.target.value }))} placeholder="ZIP / Postal Code" />
                                    <Input value={eventLocation.country} onChange={(e) => setEventLocation(prev => ({ ...prev, country: e.target.value }))} placeholder="Country" />
                                </div>
                            </div>
                        </div>
                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <Label>Event Date(s)</Label>
                                <div className="flex items-center gap-2">
                                    <Label htmlFor="multi-day" className="text-sm">Multi-Day Event</Label>
                                    <Switch id="multi-day" checked={isMultiDay} onCheckedChange={setIsMultiDay} />
                                </div>
                            </div>
                             <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                               <Popover>
                                    <PopoverTrigger className={cn(buttonVariants({ variant: 'outline' }), "justify-start font-normal h-11")}>
                                        <span className="flex items-center">
                                            <CalendarIcon className="mr-2 h-4 w-4" />
                                            {eventStartDate ? format(eventStartDate, "PPP") : "Start Date"}
                                        </span>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-auto p-0">
                                    <Calendar mode="single" selected={eventStartDate} onSelect={setEventStartDate} initialFocus />
                                    </PopoverContent>
                                </Popover>
                                {isMultiDay && (
                                     <Popover>
                                        <PopoverTrigger className={cn(buttonVariants({ variant: 'outline' }), "justify-start font-normal h-11")}>
                                            <span className="flex items-center">
                                                <CalendarIcon className="mr-2 h-4 w-4" />
                                                {eventEndDate ? format(eventEndDate, "PPP") : "End Date"}
                                            </span>
                                        </PopoverTrigger>
                                        <PopoverContent className="w-auto p-0">
                                        <Calendar mode="single" selected={eventEndDate} onSelect={setEventEndDate} initialFocus disabled={{ before: eventStartDate }}/>
                                        </PopoverContent>
                                    </Popover>
                                )}
                            </div>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="total-hours">Total Billable Hours</Label>
                            <Input id="total-hours" type="number" value={totalHours || ''} onChange={e => setTotalHours(Number(e.target.value))} placeholder="e.g., 8" />
                        </div>
                      </CardContent>
                    </Card>
                  </AccordionContent>
                </AccordionItem>
                
                <AccordionItem value="services-products">
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
                                    <div className="flex items-center gap-2">
                                        <Input type="number" value={item.quantity} onChange={e => handleLineItemQuantityChange(item.id, Number(e.target.value))} className="w-16 h-8" />
                                        <Button variant="ghost" size="icon" className="text-destructive h-8 w-8" onClick={() => removeLineItem(item.id)}>
                                            <Trash2 className="w-4 h-4" />
                                        </Button>
                                    </div>
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

                 <AccordionItem value="travel-expenses">
                  <AccordionTrigger className='text-lg font-semibold'>Travel & Other Expenses</AccordionTrigger>
                  <AccordionContent className='pt-4'>
                    <Card>
                      <CardHeader>
                        <CardTitle>Mileage Calculator</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-4">
                          <div className="space-y-2">
                                <Label>Start Location</Label>
                                <div className="space-y-2 p-3 border rounded-lg">
                                    <Input placeholder="Street Address" />
                                    <div className="grid grid-cols-2 gap-2">
                                      <Input placeholder="City" />
                                      <Input placeholder="State" />
                                    </div>
                                </div>
                                <Button variant="link" size="sm" className="p-0 h-auto">Use Business Address</Button>
                            </div>
                           <div className="space-y-2">
                                <Label>End Location</Label>
                                <div className="space-y-2 p-3 border rounded-lg">
                                    <Input placeholder="Street Address" />
                                    <div className="grid grid-cols-2 gap-2">
                                      <Input placeholder="City" />
                                      <Input placeholder="State" />
                                    </div>
                                </div>
                            </div>
                            <Button onClick={handleCalculateTravel} disabled={isCalculatingTravel} className="w-full">
                                {isCalculatingTravel ? <Loader className="animate-spin mr-2"/> : <Car className="mr-2"/>}
                                Calculate Travel
                            </Button>
                             <div className="grid grid-cols-2 gap-4 pt-4">
                                <div className="p-3 bg-muted/50 rounded-lg">
                                    <Label className="text-xs text-muted-foreground">Round Trip</Label>
                                    <p className="font-semibold text-lg">{roundTripDistance} miles</p>
                                </div>
                                 <div className="p-3 bg-muted/50 rounded-lg">
                                    <Label className="text-xs text-muted-foreground">Est. Travel Time</Label>
                                    <p className="font-semibold text-lg">{travelTime} min</p>
                                </div>
                            </div>
                             <div className="space-y-2">
                                <Label htmlFor="cost-per-mile">Cost per Mile</Label>
                                 <div className="relative">
                                    <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                    <Input id="cost-per-mile" type="number" value={costPerMile} onChange={e => setCostPerMile(Number(e.target.value))} className="pl-9" />
                                </div>
                            </div>
                      </CardContent>
                      <CardHeader>
                          <CardTitle>Other Expenses</CardTitle>
                      </CardHeader>
                      <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="space-y-2">
                                <Label htmlFor="flights-cost" className="flex items-center gap-2"><Plane/>Flights</Label>
                                <Input id="flights-cost" type="number" value={flightsCost || ''} onChange={e => setFlightsCost(Number(e.target.value))} placeholder="0.00" />
                            </div>
                             <div className="space-y-2">
                                <Label htmlFor="equipment-rental-cost" className="flex items-center gap-2"><Briefcase />Equipment Rentals</Label>
                                <Input id="equipment-rental-cost" type="number" value={equipmentRentalCost || ''} onChange={e => setEquipmentRentalCost(Number(e.target.value))} placeholder="0.00" />
                            </div>
                            <div className="space-y-2">
                                <Label className="flex items-center gap-2"><Hotel/>Lodging</Label>
                                <div className="flex items-center gap-2">
                                    <Input type="number" value={lodgingNights || ''} onChange={e => setLodgingNights(Number(e.target.value))} placeholder="# nights"/>
                                    <span className="text-muted-foreground">x</span>
                                    <Input type="number" value={lodgingRatePerNight || ''} onChange={e => setLodgingRatePerNight(Number(e.target.value))} placeholder="rate/night"/>
                                </div>
                            </div>
                            <div className="space-y-2">
                                <Label className="flex items-center gap-2"><Utensils/>Per Diem</Label>
                                <div className="flex items-center gap-2">
                                    <Input type="number" value={numberOfDays || ''} onChange={e => setNumberOfDays(Number(e.target.value))} placeholder="# days"/>
                                    <span className="text-muted-foreground">x</span>
                                    <Input type="number" value={ratePerDay || ''} onChange={e => setRatePerDay(Number(e.target.value))} placeholder="rate/day"/>
                                </div>
                            </div>
                      </CardContent>
                    </Card>
                  </AccordionContent>
                </AccordionItem>
                
                 <AccordionItem value="fees-payment">
                  <AccordionTrigger className='text-lg font-semibold'>Fees & Payment Terms</AccordionTrigger>
                  <AccordionContent className='pt-4'>
                    <Card>
                      <CardContent className="p-6 grid gap-6">
                        <div className="space-y-2">
                            <Label htmlFor="project-fee">Project Fee (%)</Label>
                            <Input id="project-fee" type="number" value={projectFee || ''} onChange={e => setProjectFee(Number(e.target.value))} placeholder="e.g., 10 for a 10% project fee" />
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
                travelAndExpenses={travelAndExpenses}
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
