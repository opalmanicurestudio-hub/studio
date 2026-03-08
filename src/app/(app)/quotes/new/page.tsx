
'use client';

import React, { useState, useMemo, useEffect, useRef } from 'react';
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
import { 
    ArrowLeft, 
    Save, 
    PlusCircle, 
    Trash2, 
    Calculator, 
    Info, 
    DollarSign, 
    Calendar as CalendarIcon, 
    UserPlus, 
    Car, 
    Briefcase, 
    Utensils, 
    Plane, 
    Hotel, 
    Loader,
    Sparkles,
    Target,
    Activity,
    MapPin,
    ArrowRight,
    TrendingUp,
    List,
    Clock,
    Tag,
    Landmark,
    Truck,
    ShieldCheck,
    Percent,
    ShoppingCart,
    FileSignature,
    Users,
    Zap,
    Wallet,
    Shield
} from 'lucide-react';
import Link from 'next/link';
import { type Client, type Service, type ConsentForm, type Staff, getServicePrice } from '@/lib/data';
import { Textarea } from '@/components/ui/textarea';
import { useInventory } from '@/context/InventoryContext';
import { useToast } from '@/hooks/use-toast';
import { useFirebase, addDocumentNonBlocking } from '@/firebase';
import { collection, doc } from 'firebase/firestore';
import { useRouter } from 'next/navigation';
import { Switch } from '@/components/ui/switch';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { useTenant } from '@/context/TenantContext';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { nanoid } from 'nanoid';
import { BrowseConsentFormsDialog } from '@/components/services/BrowseConsentFormsDialog';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

type LineItem = {
    id: string;
    name: string;
    description: string;
    price: number;
    cost: number;
    quantity: number;
};

type StaffPayout = {
    staffId: string;
    name: string;
    amount: number;
};

const SectionHeader = ({ icon: Icon, title, step }: { icon: any, title: string, step: number | string }) => (
    <div className="flex items-center gap-4 py-2">
        <div className="w-10 h-10 rounded-2xl bg-primary/10 flex items-center justify-center text-primary shadow-inner border border-primary/20 shrink-0">
            <Icon className="w-5 h-5" />
        </div>
        <div className="space-y-0.5 text-left">
            <p className="text-[9px] font-black uppercase tracking-widest text-primary/60">Module {step}</p>
            <h3 className="text-xl font-black uppercase tracking-tighter text-slate-900">{title}</h3>
        </div>
    </div>
);

const YieldEngineCard = ({ 
    lineItems,
    travelAndExpenses,
    staffPayouts,
    projectFeePercent,
    tmhr,
    totalHours,
    depositAmount,
} : {
    lineItems: LineItem[];
    travelAndExpenses: number;
    staffPayouts: StaffPayout[];
    projectFeePercent: number;
    tmhr: number;
    totalHours: number;
    depositAmount: number;
}) => {
    const { servicesSubtotal, servicesCost } = useMemo(() => {
        const subtotal = lineItems.reduce((acc, item) => acc + (item.price * item.quantity), 0);
        const cost = lineItems.reduce((acc, item) => acc + (item.cost * item.quantity), 0);
        return { servicesSubtotal: subtotal, servicesCost: cost };
    }, [lineItems]);

    const totalStaffPayout = staffPayouts.reduce((acc, s) => acc + s.amount, 0);
    const projectFee = servicesSubtotal * (projectFeePercent / 100);
    const totalQuotePrice = servicesSubtotal + travelAndExpenses + projectFee;
    
    const timeCost = totalHours * tmhr;
    const breakEvenPoint = servicesCost + travelAndExpenses + timeCost + totalStaffPayout;
    
    const netProfit = totalQuotePrice - breakEvenPoint;
    const profitMargin = totalQuotePrice > 0 ? (netProfit / totalQuotePrice) * 100 : 0;

  return (
    <Card className="lg:sticky lg:top-24 border-4 rounded-[2.5rem] shadow-2xl shadow-primary/5 overflow-hidden">
      <CardHeader className="p-8 pb-4">
        <CardTitle className="text-[10px] font-black uppercase tracking-[0.25em] text-primary flex items-center gap-2">
            <Sparkles className="w-3 h-3" />
            Yield Engine
        </CardTitle>
        <CardDescription className="text-xs font-bold uppercase tracking-tight opacity-60">
          Target analysis @ <strong>${tmhr.toFixed(2)}/hr</strong> TMHR
        </CardDescription>
      </CardHeader>
      <CardContent className="p-8 pt-4 space-y-8">
        <div className="p-6 rounded-[2rem] bg-primary/5 border-2 border-primary/10 space-y-4 shadow-inner">
            <p className="text-[9px] font-black uppercase text-primary/60 tracking-widest text-center">Contract Evaluation</p>
            <div className="flex justify-between items-baseline">
                <div className="flex flex-col">
                    <span className="text-[8px] font-black uppercase text-muted-foreground opacity-40">Proposal Value</span>
                    <span className="text-3xl font-black tracking-tighter font-mono text-slate-900">${totalQuotePrice.toFixed(2)}</span>
                </div>
                <div className="text-right flex flex-col">
                    <span className="text-[8px] font-black uppercase text-muted-foreground opacity-40">Net Yield</span>
                    <span className={cn("font-black text-4xl font-mono tracking-tighter", netProfit >= 0 ? "text-primary" : "text-destructive")}>
                        ${netProfit.toFixed(2)}
                    </span>
                </div>
            </div>
            <div className="pt-4 border-t border-primary/10 flex justify-between items-center">
                <span className="text-[10px] font-black uppercase text-slate-600">Margin Precision</span>
                <Badge className={cn("text-white border-none font-black text-xs font-mono", netProfit >= 0 ? "bg-primary" : "bg-destructive")}>
                    {profitMargin.toFixed(1)}%
                </Badge>
            </div>
        </div>

        <div className="space-y-4">
            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Hard Cost Allocations</p>
            <div className="grid gap-3">
                <div className="p-4 rounded-2xl bg-muted/20 border-2 flex justify-between items-center">
                    <div className="space-y-0.5">
                        <p className="text-[8px] font-black uppercase text-muted-foreground opacity-60">Services Overhead</p>
                        <p className="text-sm font-black font-mono text-slate-900">${servicesCost.toFixed(2)}</p>
                    </div>
                    <Target className="w-4 h-4 text-muted-foreground opacity-20" />
                </div>
                <div className="p-4 rounded-2xl bg-muted/20 border-2 flex justify-between items-center">
                    <div className="space-y-0.5">
                        <p className="text-[8px] font-black uppercase text-muted-foreground opacity-60">Logistics Allocation</p>
                        <p className="text-sm font-black font-mono text-slate-900">${travelAndExpenses.toFixed(2)}</p>
                    </div>
                    <Car className="w-4 h-4 text-muted-foreground opacity-20" />
                </div>
                <div className="p-4 rounded-2xl bg-muted/20 border-2 flex justify-between items-center">
                    <div className="space-y-0.5">
                        <p className="text-[8px] font-black uppercase text-muted-foreground opacity-60">Staff Labor Cost</p>
                        <p className="text-sm font-black font-mono text-slate-900">${totalStaffPayout.toFixed(2)}</p>
                    </div>
                    <Users className="w-4 h-4 text-muted-foreground opacity-20" />
                </div>
            </div>
        </div>

        <div className="pt-4 border-t border-dashed space-y-4">
            <div className="flex justify-between items-center">
                <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Hard Cost Threshold</span>
                <span className="text-sm font-black font-mono text-destructive">${breakEvenPoint.toFixed(2)}</span>
            </div>
            {depositAmount > 0 && (
                <div className="flex justify-between items-center p-4 rounded-xl bg-green-500/5 border-2 border-green-500/10">
                    <span className="text-[10px] font-black uppercase text-green-700">Retained Deposit</span>
                    <span className="text-sm font-black font-mono text-green-700">${depositAmount.toFixed(2)}</span>
                </div>
            )}
            <div className="flex items-center gap-3 p-4 rounded-xl border-2 border-dashed bg-muted/10">
                <Info className="w-4 h-4 text-muted-foreground shrink-0" />
                <p className="text-[9px] font-bold uppercase text-muted-foreground leading-relaxed">
                    Breakeven includes ${timeCost.toFixed(2)} in reserved studio time based on your current foundation.
                </p>
            </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default function QuoteGeneratorPage() {
    const { clients, services, consentForms, staff } = useInventory();
    const { selectedTenant } = useTenant();
    const tmhr = selectedTenant?.tmhr || 50;
    const { toast } = useToast();
    const { firestore, user } = useFirebase();
    const tenantId = selectedTenant?.id;
    const router = useRouter();

    // Event Details
    const [clientId, setClientId] = useState('');
    const [isAddingClient, setIsAddingClient] = useState(false);
    const [eventName, setEventName] = useState('');
    const [eventStartDate, setEventStartDate] = useState<Date | undefined>(new Date());
    const [totalHours, setTotalHours] = useState(0);
    const [eventLocation, setEventLocation] = useState({ street: '', city: '', state: '', zip: '', country: '' });

    // Line Items
    const [lineItems, setLineItems] = useState<LineItem[]>([]);
    
    // Travel & Expenses
    const [roundTripDistance, setRoundTripDistance] = useState(0);
    const [costPerMile, setCostPerMile] = useState(0.67);
    const [isCalculatingTravel, setIsCalculatingTravel] = useState(false);
    const [flightsCost, setFlightsCost] = useState(0);
    const [lodgingNights, setLodgingNights] = useState(0);
    const [lodgingRatePerNight, setLodgingRatePerNight] = useState(0);
    const [numberOfDays, setNumberOfDays] = useState(0);
    const [ratePerDay, setRatePerDay] = useState(0);
    const [equipmentRentalCost, setEquipmentRentalCost] = useState(0);

    // Team & Labor
    const [staffPayouts, setStaffPayouts] = useState<StaffPayout[]>([]);

    // Fees & Payment
    const [projectFee, setProjectFee] = useState(0);
    const [notes, setNotes] = useState('');
    
    // Financial Terms
    const [depositType, setDepositType] = useState<'percentage' | 'flat'>('percentage');
    const [depositAmountValue, setDepositAmountValue] = useState(20);
    const [paymentTerms, setPaymentTerms] = useState<'on_receipt' | 'net_15' | 'net_30'>('on_receipt');

    // Legal & Compliance
    const [requiredFormIds, setRequiredFormIds] = useState<string[]>([]);
    const [isConsentFormDialogOpen, setIsConsentFormDialogOpen] = useState(false);

    const travelAndExpenses = useMemo(() => {
        const mileageCost = roundTripDistance * costPerMile;
        const lodgingCost = lodgingNights * lodgingRatePerNight;
        const perDiemCost = numberOfDays * ratePerDay;
        return mileageCost + flightsCost + lodgingCost + perDiemCost + equipmentRentalCost;
    }, [roundTripDistance, costPerMile, flightsCost, lodgingNights, lodgingRatePerNight, numberOfDays, ratePerDay, equipmentRentalCost]);
    
    const servicesSubtotal = useMemo(() => {
        return lineItems.reduce((acc, item) => acc + (item.price * item.quantity), 0);
    }, [lineItems]);

    const totalQuotePrice = useMemo(() => {
        const fee = servicesSubtotal * (projectFee / 100);
        return servicesSubtotal + travelAndExpenses + fee;
    }, [servicesSubtotal, travelAndExpenses, projectFee]);

    const calculatedDeposit = useMemo(() => {
        if (depositType === 'percentage') {
            return totalQuotePrice * (depositAmountValue / 100);
        }
        return depositAmountValue;
    }, [totalQuotePrice, depositType, depositAmountValue]);

    const handleCalculateTravel = () => {
        setIsCalculatingTravel(true);
        setTimeout(() => {
            setRoundTripDistance(124);
            setIsCalculatingTravel(false);
            toast({ title: "Logistics Calculated", description: "Mileage overhead estimated based on current route." });
        }, 1200);
    };

    const handleSaveQuote = async () => {
        if (!clientId || !eventName || !firestore || !user || !tenantId) {
            toast({ variant: 'destructive', title: 'Missing Identity', description: 'Please select a client and provide a project label.' });
            return;
        }

        const quoteData = {
            id: nanoid(),
            clientId,
            eventName,
            eventDate: eventStartDate?.toISOString(),
            eventLocation: eventLocation,
            lineItems: lineItems,
            travelExpenses: travelAndExpenses,
            staffPayouts: staffPayouts,
            projectFee,
            notes,
            totalHours,
            requiredFormIds,
            status: 'draft',
            createdAt: new Date().toISOString(),
            userId: user.uid,
            depositType,
            depositAmount: calculatedDeposit,
            paymentTerms,
            clientSecret: nanoid(32),
        };

        try {
            await addDocumentNonBlocking(collection(firestore, 'tenants', tenantId, 'quotes'), quoteData);
            toast({ title: 'Protocol Saved', description: 'Your quote has been cached as a draft.' });
            router.push('/quotes');
        } catch (error) {
            console.error("Error saving quote: ", error);
            toast({ variant: 'destructive', title: 'Critical Error', description: 'There was a problem finalizing the proposal.' });
        }
    };
    
    const addServiceAsLineItem = (serviceId: string) => {
        const service = services.find(s => s.id === serviceId);
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
        setLineItems(prev => prev.map(item => item.id === id ? {...item, quantity: Math.max(1, quantity)} : item));
    }

    const handleAddStaff = (staffId: string) => {
        const member = staff.find(s => s.id === staffId);
        if (member && !staffPayouts.some(s => s.staffId === member.id)) {
            setStaffPayouts(prev => [...prev, { staffId: member.id, name: member.name, amount: 0 }]);
        }
    };

    const handleStaffPayoutChange = (staffId: string, amount: number) => {
        setStaffPayouts(prev => prev.map(s => s.staffId === staffId ? { ...s, amount } : s));
    };

    const suggestStaffPayout = (staffId: string) => {
        const member = staff.find(s => s.id === staffId);
        if (!member) return;

        const hours = totalHours || 1;
        const numStaff = staffPayouts.length || 1;

        const revenueShare = (servicesSubtotal / numStaff) * ((member.commissionRate || 40) / 100);

        let timeFloor = 0;
        if (member.payStructure === 'hourly' && member.hourlyRate) {
            timeFloor = hours * member.hourlyRate;
        } else {
            timeFloor = (hours * tmhr) * ((member.commissionRate || 40) / 100);
        }

        let suggestion = Math.max(revenueShare, timeFloor);
        suggestion = suggestion * 1.15;

        handleStaffPayoutChange(staffId, Number(suggestion.toFixed(2)));
        toast({
            title: "Effective Rate Calculated",
            description: `Suggested $${suggestion.toFixed(2)} based on revenue share and event premium.`
        });
    };

    const removeStaff = (staffId: string) => {
        setStaffPayouts(prev => prev.filter(s => s.staffId !== staffId));
    };

    const assignedForms = useMemo(() => consentForms.filter(f => requiredFormIds.includes(f.id)), [requiredFormIds, consentForms]);

  return (
    <div className="flex min-h-screen w-full flex-col bg-slate-50/50">
      <AppHeader title="New Proposal" />
      <main className="flex-1 p-4 md:p-10 w-full max-w-7xl mx-auto min-w-0">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className="space-y-10">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
            <div className="space-y-1 text-left">
                <h1 className="text-3xl md:text-5xl font-black uppercase tracking-tighter text-slate-900 leading-none">Draft Protocol</h1>
                <p className="text-sm text-muted-foreground font-black uppercase tracking-[0.2em] opacity-60">Strategic project configuration</p>
            </div>
            <div className="flex items-center gap-3 w-full md:w-auto">
                <Button variant="outline" asChild className="flex-1 md:flex-none h-14 px-8 rounded-2xl border-2 font-black uppercase tracking-widest text-[10px] shadow-sm bg-white/50 backdrop-blur-sm">
                    <Link href="/quotes"><ArrowLeft className="mr-2 h-4 w-4" />Return</Link>
                </Button>
                <Button onClick={handleSaveQuote} className="flex-1 md:flex-none h-14 px-10 rounded-2xl shadow-xl font-black uppercase tracking-widest text-[10px] shadow-primary/20">
                    <Save className="mr-2 h-4 w-4" /> Cache Draft
                </Button>
            </div>
          </div>

          <div className="grid lg:grid-cols-3 gap-10">
            <div className="lg:col-span-2 space-y-10">
              <Accordion type="multiple" defaultValue={['event-details', 'services-products', 'travel-expenses', 'team-labor', 'legal-compliance', 'financial-logic']} className="w-full space-y-10">
                <AccordionItem value="event-details" className="border-none">
                  <Card className="border-2 shadow-sm rounded-[2.5rem] overflow-hidden bg-white">
                    <CardHeader className="bg-muted/5 border-b p-6 md:p-8">
                        <AccordionTrigger className="hover:no-underline">
                            <SectionHeader icon={Landmark} title="Engagement Profile" step={1} />
                        </AccordionTrigger>
                    </CardHeader>
                    <AccordionContent>
                        <CardContent className="p-6 md:p-8 space-y-8 text-left">
                            <div className="space-y-3">
                            <Label htmlFor="client" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Guest Identification</Label>
                                <div className="flex gap-3">
                                <Select value={clientId} onValueChange={(value) => {
                                    if (value === 'add-new') { setIsAddingClient(true); setClientId(''); } 
                                    else { setIsAddingClient(false); setClientId(value); }
                                }}>
                                    <SelectTrigger id="client" className="h-14 rounded-2xl border-2 shadow-inner bg-muted/5 font-bold uppercase text-xs tracking-tight">
                                    <SelectValue placeholder="SEARCH GUEST ARCHIVE..." />
                                    </SelectTrigger>
                                    <SelectContent className="rounded-xl border-2 shadow-2xl">
                                    {clients.map(c => <SelectItem key={c.id} value={c.id} className="font-bold uppercase text-[10px] tracking-widest">{c.name}</SelectItem>)}
                                    <SelectItem value="add-new" className="font-black text-primary">
                                        <span className="flex items-center gap-2"><UserPlus className="w-3.5 h-3.5" /> REGISTER NEW PROFILE</span>
                                    </SelectItem>
                                    </SelectContent>
                                </Select>
                                </div>
                            </div>
                            {isAddingClient && (
                                <Card className="bg-primary/[0.02] border-primary/10 p-6 rounded-[2rem] space-y-4 shadow-inner">
                                    <p className="text-[10px] font-black uppercase text-primary tracking-widest">Rapid Registry</p>
                                    <Input placeholder="FULL LEGAL NAME" className="h-12 rounded-xl border-2 font-bold" />
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                        <Input type="email" placeholder="EMAIL ADDRESS" className="h-12 rounded-xl border-2 font-bold" />
                                        <Input type="tel" placeholder="MOBILE CONTACT" className="h-12 rounded-xl border-2 font-bold" />
                                    </div>
                                </Card>
                            )}
                            <div className="space-y-3">
                            <Label htmlFor="event-name" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Project Label</Label>
                            <Input id="event-name" value={eventName} onChange={e => setEventName(e.target.value)} placeholder="e.g., THE ANDERSON WEDDING" className="h-14 rounded-2xl border-2 font-black uppercase text-lg tracking-tight" />
                            </div>
                            <div className="space-y-3">
                                <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Deployment Zone</Label>
                                <div className="space-y-3 p-6 rounded-[2rem] border-2 bg-muted/5 shadow-inner">
                                    <Input value={eventLocation.street} onChange={(e) => setEventLocation(prev => ({ ...prev, street: e.target.value }))} placeholder="STREET ADDRESS" className="h-12 rounded-xl border-2 font-bold uppercase text-xs" />
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                        <Input value={eventLocation.city} onChange={(e) => setEventLocation(prev => ({ ...prev, city: e.target.value }))} placeholder="CITY" className="h-12 rounded-xl border-2 font-bold uppercase text-xs" />
                                        <Input value={eventLocation.state} onChange={(e) => setEventLocation(prev => ({ ...prev, state: e.target.value }))} placeholder="STATE / PROVINCE" className="h-12 rounded-xl border-2 font-bold uppercase text-xs" />
                                    </div>
                                </div>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
                                <div className="space-y-3">
                                    <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Event Timestamp</Label>
                                    <Input
                                    type="date"
                                    value={eventStartDate ? format(eventStartDate, 'yyyy-MM-dd') : ''}
                                    onChange={(e) => setEventStartDate(e.target.value ? new Date(e.target.value.replace(/-/g, '/')) : undefined)}
                                    className="h-14 rounded-2xl border-2 font-black text-lg"
                                    />
                                </div>
                                <div className="space-y-3">
                                    <Label htmlFor="total-hours" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Total Resource Allocation (Hours)</Label>
                                    <div className="relative">
                                        <Clock className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-primary opacity-40" />
                                        <Input id="total-hours" type="number" value={totalHours || ''} onChange={e => setTotalHours(Number(e.target.value))} placeholder="0" className="h-14 pl-12 rounded-2xl border-2 font-black text-xl font-mono shadow-inner" />
                                    </div>
                                </div>
                            </div>
                        </CardContent>
                    </AccordionContent>
                  </Card>
                </AccordionItem>
                
                <AccordionItem value="services-products" className="border-none">
                  <Card className="border-2 shadow-sm rounded-[2.5rem] overflow-hidden bg-white">
                    <CardHeader className="bg-muted/5 border-b p-6 md:p-8">
                        <AccordionTrigger className="hover:no-underline">
                            <SectionHeader icon={ShoppingCart} title="Protocol Manifest" step={2} />
                        </AccordionTrigger>
                    </CardHeader>
                    <AccordionContent>
                        <CardContent className="p-6 md:p-8 space-y-8 text-left">
                            <div className="space-y-4">
                                {lineItems.length > 0 ? (
                                    <div className="space-y-3">
                                        {lineItems.map(item => (
                                            <div key={item.id} className="flex justify-between items-center p-5 bg-muted/20 rounded-[1.5rem] border-2 border-transparent hover:border-primary/10 transition-all group">
                                                <div className="min-w-0 flex-1">
                                                    <p className="font-black text-sm uppercase tracking-tight text-slate-900 truncate">{item.name}</p>
                                                    <p className="text-[10px] font-black text-primary uppercase tracking-widest opacity-60 mt-0.5">${item.price.toFixed(2)} unit value</p>
                                                </div>
                                                <div className="flex items-center gap-4">
                                                    <div className="flex items-center gap-2">
                                                        <Label className="text-[8px] font-black uppercase text-muted-foreground opacity-40">Load</Label>
                                                        <Input type="number" value={item.quantity} onChange={e => handleLineItemQuantityChange(item.id, Number(e.target.value))} className="w-16 h-10 rounded-xl border-2 text-center font-black" />
                                                    </div>
                                                    <Button variant="ghost" size="icon" className="text-destructive opacity-0 group-hover:opacity-100 transition-opacity" onClick={() => removeLineItem(item.id)}>
                                                        <Trash2 className="w-4 h-4" />
                                                    </Button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div className='p-16 text-center border-4 border-dashed rounded-[3rem] opacity-30 flex flex-col items-center gap-4'>
                                        <List className="w-12 h-12" />
                                        <p className="text-[10px] font-black uppercase tracking-widest">No Manifest Items</p>
                                    </div>
                                )}
                                <div className='pt-4'>
                                    <Select onValueChange={addServiceAsLineItem}>
                                        <SelectTrigger className="h-14 rounded-2xl border-2 border-dashed font-black uppercase text-[10px] tracking-[0.2em] bg-muted/5 shadow-inner">
                                            <PlusCircle className="mr-2 h-4 w-4 text-primary" />
                                            <SelectValue placeholder="APPEND FROM STUDIO LIBRARY..." />
                                        </SelectTrigger>
                                        <SelectContent className="rounded-xl border-2 shadow-2xl">
                                            {services.map(s => <SelectItem key={s.id} value={s.id} disabled={lineItems.some(li => li.id === s.id)} className="font-bold uppercase text-[10px] tracking-widest">{s.name}</SelectItem>)}
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                        </CardContent>
                    </AccordionContent>
                  </Card>
                </AccordionItem>

                 <AccordionItem value="travel-expenses" className="border-none">
                  <Card className="border-2 shadow-sm rounded-[2.5rem] overflow-hidden bg-white">
                    <CardHeader className="bg-muted/5 border-b p-6 md:p-8">
                        <AccordionTrigger className="hover:no-underline">
                            <SectionHeader icon={Truck} title="Logistics & Deployment" step={3} />
                        </AccordionTrigger>
                    </CardHeader>
                    <AccordionContent>
                        <CardContent className="p-6 md:p-8 space-y-10 text-left">
                            <div className="space-y-8">
                                <div className="p-8 rounded-[2.5rem] bg-muted/10 border-2 border-border/50 space-y-8 shadow-inner">
                                    <div className="flex flex-col sm:flex-row items-center gap-6">
                                        <div className="flex-1 w-full space-y-3">
                                            <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Strategic Round Trip (Miles)</Label>
                                            <div className="relative">
                                                <Car className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-primary opacity-40" />
                                                <Input type="number" value={roundTripDistance || ''} onChange={e => setRoundTripDistance(Number(e.target.value))} placeholder="0" className="h-14 pl-12 rounded-2xl border-2 font-black text-xl font-mono shadow-inner bg-white" />
                                            </div>
                                        </div>
                                        <Button onClick={handleCalculateTravel} disabled={isCalculatingTravel} className="h-14 px-8 rounded-2xl font-black uppercase tracking-widest text-[10px] shadow-lg w-full sm:w-auto">
                                            {isCalculatingTravel ? <Loader className="animate-spin mr-2 h-4 w-4"/> : <Activity className="mr-2 h-4 w-4"/>}
                                            ANALYZE ROUTE
                                        </Button>
                                    </div>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                                        <div className="space-y-3">
                                            <Label htmlFor="cost-per-mile" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Landed Rate / Mile</Label>
                                            <div className="relative">
                                                <DollarSign className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-primary opacity-40" />
                                                <Input id="cost-per-mile" type="number" value={costPerMile} onChange={e => setCostPerMile(Number(e.target.value))} className="h-12 pl-10 rounded-xl border-2 font-black font-mono bg-white" />
                                            </div>
                                        </div>
                                        <div className="p-4 rounded-xl bg-white border flex justify-between items-center shadow-sm">
                                            <span className="text-[9px] font-black uppercase text-muted-foreground">Est. Mileage Cost</span>
                                            <span className="text-lg font-black font-mono text-slate-900">${(roundTripDistance * costPerMile).toFixed(2)}</span>
                                        </div>
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-10 pt-4">
                                    <div className="space-y-6">
                                        <div className="space-y-3">
                                            <Label htmlFor="flights-cost" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1 flex items-center gap-2"><Plane className="w-3 h-3 text-primary"/> Air Logistics</Label>
                                            <div className="relative"><DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-primary opacity-40" /><Input id="flights-cost" type="number" value={flightsCost || ''} onChange={e => setFlightsCost(Number(e.target.value))} placeholder="0.00" className="h-12 pl-9 rounded-xl border-2 font-bold font-mono" /></div>
                                        </div>
                                        <div className="space-y-3">
                                            <Label htmlFor="equipment-rental-cost" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1 flex items-center gap-2"><Briefcase className="w-3 h-3 text-primary" /> Resource Rentals</Label>
                                            <div className="relative"><DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-primary opacity-40" /><Input id="equipment-rental-cost" type="number" value={equipmentRentalCost || ''} onChange={e => setEquipmentRentalCost(Number(e.target.value))} placeholder="0.00" className="h-12 pl-9 rounded-xl border-2 font-bold font-mono" /></div>
                                        </div>
                                    </div>
                                    <div className="space-y-6">
                                        <div className="space-y-3">
                                            <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1 flex items-center gap-2"><Hotel className="w-3 h-3 text-primary"/> Accommodation Archive</Label>
                                            <div className="flex items-center gap-3">
                                                <Input type="number" value={lodgingNights || ''} onChange={e => setLodgingNights(Number(e.target.value))} placeholder="NIGHTS" className="h-12 rounded-xl border-2 text-center font-black" />
                                                <span className="text-muted-foreground font-black text-xs">@</span>
                                                <div className="relative flex-1"><DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-primary opacity-40" /><Input type="number" value={lodgingRatePerNight || ''} onChange={e => setLodgingRatePerNight(Number(e.target.value))} placeholder="RATE" className="h-12 pl-9 rounded-xl border-2 font-bold font-mono" /></div>
                                            </div>
                                        </div>
                                        <div className="space-y-3">
                                            <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1 flex items-center gap-2"><Utensils className="w-3 h-3 text-primary"/> Per Diem Engine (Meals)</Label>
                                            <div className="flex items-center gap-3">
                                                <Input type="number" value={numberOfDays || ''} onChange={e => setNumberOfDays(Number(e.target.value))} placeholder="DAYS" className="h-12 rounded-xl border-2 text-center font-black" />
                                                <span className="text-muted-foreground font-black text-xs">@</span>
                                                <div className="relative flex-1"><DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-primary opacity-40" /><Input type="number" value={ratePerDay || ''} onChange={e => setRatePerDay(Number(e.target.value))} placeholder="RATE" className="h-12 pl-9 rounded-xl border-2 font-bold font-mono" /></div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </CardContent>
                    </AccordionContent>
                  </Card>
                </AccordionItem>

                <AccordionItem value="team-labor" className="border-none">
                  <Card className="border-2 shadow-sm rounded-[2.5rem] overflow-hidden bg-white">
                    <CardHeader className="bg-muted/5 border-b p-6 md:p-8">
                        <AccordionTrigger className="hover:no-underline">
                            <SectionHeader icon={Users} title="Team & Labor Matrix" step={4} />
                        </AccordionTrigger>
                    </CardHeader>
                    <AccordionContent>
                        <CardContent className="p-6 md:p-8 space-y-8 text-left">
                            <div className="space-y-4">
                                <div className='flex items-center justify-between px-1'>
                                    <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Provider Payouts</Label>
                                    <Select onValueChange={handleAddStaff}>
                                        <SelectTrigger className="h-7 px-3 text-[9px] font-black uppercase tracking-widest text-primary border border-primary/20 rounded-lg hover:bg-primary/5 shadow-sm w-48">
                                            <PlusCircle className="w-3 h-3 mr-1.5" /> Assign Provider
                                        </SelectTrigger>
                                        <SelectContent className="rounded-xl border-2 shadow-2xl">
                                            {staff.filter(s => !staffPayouts.some(p => p.staffId === s.id)).map(s => (
                                                <SelectItem key={s.id} value={s.id} className="font-bold uppercase text-[9px] tracking-widest">{s.name}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                
                                {staffPayouts.length > 0 ? (
                                    <div className="grid grid-cols-1 gap-3">
                                        {staffPayouts.map(payout => {
                                            const member = staff.find(s => s.id === payout.staffId);
                                            return (
                                                <div key={payout.staffId} className="flex items-center justify-between p-4 rounded-2xl border-2 bg-white shadow-sm group gap-4">
                                                    <div className="flex items-center gap-3 min-w-0 flex-1">
                                                        <Avatar className="h-10 w-10 border shadow-sm rounded-xl">
                                                            <AvatarImage src={member?.avatarUrl} className="object-cover" />
                                                            <AvatarFallback className="font-black text-[10px] bg-primary/10 text-primary">{(payout.name || 'S')[0]}</AvatarFallback>
                                                        </Avatar>
                                                        <div className="min-w-0">
                                                            <p className="font-black text-sm uppercase tracking-tight text-slate-900 truncate leading-none mb-1">{payout.name}</p>
                                                            <Badge variant="outline" className="h-4 px-1.5 text-[7px] font-black uppercase tracking-widest border-none bg-muted/50 text-muted-foreground">
                                                                {member?.payStructure === 'hourly' ? `Hourly: $${member.hourlyRate}/hr` : `Commission: ${member?.commissionRate}%`}
                                                            </Badge>
                                                        </div>
                                                    </div>
                                                    <div className="flex items-center gap-3">
                                                        <TooltipProvider>
                                                            <Tooltip>
                                                                <TooltipTrigger asChild>
                                                                    <Button 
                                                                        variant="outline" 
                                                                        size="icon" 
                                                                        className="h-10 w-10 rounded-xl border-2 bg-primary/5 text-primary hover:bg-primary/10 transition-all active:scale-90"
                                                                        onClick={() => suggestStaffPayout(payout.staffId)}
                                                                    >
                                                                        <Sparkles className="w-4 h-4" />
                                                                    </Button>
                                                                </TooltipTrigger>
                                                                <TooltipContent className="font-black uppercase text-[9px] tracking-widest border-2">Suggest Effective Rate</TooltipContent>
                                                            </Tooltip>
                                                        </TooltipProvider>
                                                        <div className="relative w-32">
                                                            <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-primary opacity-40" />
                                                            <Input 
                                                                type="number" 
                                                                value={payout.amount || ''} 
                                                                onChange={e => handleStaffPayoutChange(payout.staffId, Number(e.target.value))} 
                                                                placeholder="0.00" 
                                                                className="h-10 pl-8 rounded-xl border-2 font-black font-mono text-xs" 
                                                            />
                                                        </div>
                                                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive opacity-0 group-hover:opacity-100 transition-opacity" onClick={() => removeStaff(payout.staffId)}><Trash2 className="w-4 h-4" /></Button>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                ) : (
                                    <div className="p-12 text-center border-4 border-dashed rounded-[3rem] opacity-30 flex flex-col items-center gap-4">
                                        <Users className="w-12 h-12" />
                                        <p className="text-[10px] font-black uppercase tracking-widest">Solo Project (No Staff Labor)</p>
                                    </div>
                                )}
                            </div>
                        </CardContent>
                    </AccordionContent>
                  </Card>
                </AccordionItem>

                <AccordionItem value="legal-compliance" className="border-none">
                  <Card className="border-2 shadow-sm rounded-[2.5rem] overflow-hidden bg-white">
                    <CardHeader className="bg-muted/5 border-b p-6 md:p-8">
                        <AccordionTrigger className="hover:no-underline">
                            <SectionHeader icon={FileSignature} title="Legal & Compliance" step={5} />
                        </AccordionTrigger>
                    </CardHeader>
                    <AccordionContent>
                        <CardContent className="p-6 md:p-8 space-y-8 text-left">
                            <div className="space-y-4">
                                <div className='flex items-center justify-between px-1'>
                                    <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                                        <ShieldCheck className="w-3.5 h-3.5 opacity-40" /> Required Agreements
                                    </Label>
                                    <Button variant="ghost" size="sm" onClick={() => setIsConsentFormDialogOpen(true)} className="h-7 px-3 text-[9px] font-black uppercase tracking-widest text-primary border border-primary/20 rounded-lg hover:bg-primary/5 shadow-sm">
                                        <PlusCircle className="w-3 h-3 mr-1.5" /> Attach Form
                                    </Button>
                                </div>
                                {assignedForms.length > 0 ? (
                                    <div className="grid grid-cols-1 gap-2">
                                        {assignedForms.map(form => (
                                            <div key={form.id} className="flex items-center justify-between p-4 rounded-2xl border-2 bg-white shadow-sm group">
                                                <span className="text-[10px] font-black uppercase tracking-tight text-slate-900 truncate">{form.title}</span>
                                                <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive opacity-0 group-hover:opacity-100 transition-opacity" onClick={() => setRequiredFormIds(requiredFormIds.filter(id => id !== form.id))}><Trash2 className="w-4 h-4" /></Button>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="p-12 text-center border-4 border-dashed rounded-[3rem] opacity-30 flex flex-col items-center gap-4">
                                        <FileSignature className="w-12 h-12" />
                                        <p className="text-[10px] font-black uppercase tracking-widest">No Legal Requirements Attached</p>
                                    </div>
                                )}
                            </div>
                        </CardContent>
                    </AccordionContent>
                  </Card>
                </AccordionItem>
                
                 <AccordionItem value="financial-logic" className="border-none">
                  <Card className="border-2 shadow-sm rounded-[2.5rem] overflow-hidden bg-white">
                    <CardHeader className="bg-muted/5 border-b p-6 md:p-8">
                        <AccordionTrigger className="hover:no-underline">
                            <SectionHeader icon={Shield} title="Governance & Terms" step={6} />
                        </AccordionTrigger>
                    </CardHeader>
                    <AccordionContent>
                        <CardContent className="p-6 md:p-8 space-y-10 text-left">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                <div className="space-y-4">
                                    <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Deposit Requirement</Label>
                                    <div className="flex gap-3">
                                        <Select value={depositType} onValueChange={(v: any) => setDepositType(v)}>
                                            <SelectTrigger className="h-14 rounded-2xl border-2 font-bold w-32 bg-muted/5"><SelectValue /></SelectTrigger>
                                            <SelectContent className="rounded-xl">
                                                <SelectItem value="percentage" className="font-bold">PERCENT %</SelectItem>
                                                <SelectItem value="flat" className="font-bold">FLAT $</SelectItem>
                                            </SelectContent>
                                        </Select>
                                        <div className="relative flex-1">
                                            {depositType === 'flat' ? <DollarSign className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-primary opacity-40" /> : <Percent className="absolute right-4 top-1/2 -translate-y-1/2 h-5 w-5 text-primary opacity-40" />}
                                            <Input type="number" value={depositAmountValue} onChange={e => setDepositAmountValue(Number(e.target.value))} className={cn("h-14 rounded-2xl border-2 font-black text-xl shadow-inner", depositType === 'flat' ? "pl-12" : "pr-12")} />
                                        </div>
                                    </div>
                                    <p className="text-[9px] font-black uppercase text-primary/60 ml-1">Retained Security: ${calculatedDeposit.toFixed(2)}</p>
                                </div>
                                <div className="space-y-4">
                                    <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Settlement Cycle</Label>
                                    <Select value={paymentTerms} onValueChange={(v: any) => setPaymentTerms(v)}>
                                        <SelectTrigger className="h-14 rounded-2xl border-2 font-black uppercase text-xs tracking-tight shadow-inner bg-muted/5"><SelectValue /></SelectTrigger>
                                        <SelectContent className="rounded-xl border-2 shadow-2xl">
                                            <SelectItem value="on_receipt" className="font-bold uppercase text-[10px] tracking-widest">DUE ON RECEIPT</SelectItem>
                                            <SelectItem value="net_15" className="font-bold uppercase text-[10px] tracking-widest">NET 15 (15 DAYS)</SelectItem>
                                            <SelectItem value="net_30" className="font-bold uppercase text-[10px] tracking-widest">NET 30 (30 DAYS)</SelectItem>
                                        </SelectContent>
                                    </Select>
                                    <p className="text-[9px] font-black uppercase text-muted-foreground ml-1 opacity-40">Final balance due post-deployment.</p>
                                </div>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 pt-4 border-t border-dashed">
                                <div className="space-y-3">
                                    <Label htmlFor="project-fee" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Administrative Project Fee (%)</Label>
                                    <div className="relative"><Input id="project-fee" type="number" value={projectFee || ''} onChange={e => setProjectFee(Number(e.target.value))} placeholder="0" className="h-14 pr-10 rounded-2xl border-2 font-black text-xl text-primary shadow-inner" /><Percent className="absolute right-4 top-1/2 -translate-y-1/2 h-5 w-5 text-primary opacity-40"/></div>
                                </div>
                            </div>
                            <div className="space-y-3">
                                <Label htmlFor="notes" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Strategic Cavets & Footnotes</Label>
                                <Textarea id="notes" value={notes} onChange={e => setNotes(e.target.value)} placeholder="ENTER PROPOSAL CONDITIONS OR LOGISTICS NOTES..." className="rounded-2xl border-2 bg-muted/5 min-h-[120px] focus-visible:ring-primary/20" />
                            </div>
                        </CardContent>
                    </AccordionContent>
                  </Card>
                </AccordionItem>
              </Accordion>
            </div>
            <div className="lg:col-span-1">
              <YieldEngineCard 
                lineItems={lineItems}
                travelAndExpenses={travelAndExpenses}
                staffPayouts={staffPayouts}
                projectFeePercent={projectFee}
                tmhr={tmhr}
                totalHours={totalHours}
                depositAmount={calculatedDeposit}
              />
            </div>
          </div>
          
          <div className="flex flex-col-reverse sm:flex-row items-center justify-end gap-4 mt-10 pb-20">
              <Button variant="ghost" asChild className="w-full sm:w-auto h-14 px-8 font-black uppercase text-[10px] tracking-widest text-slate-400"><Link href="/quotes">Abort Proposal</Link></Button>
              <Button className="w-full sm:w-auto h-16 px-12 rounded-[2rem] shadow-2xl shadow-primary/30 font-black uppercase tracking-widest text-sm group" onClick={handleSaveQuote}>
                Commit Record <ArrowRight className="ml-3 w-5 h-5 transition-transform group-hover:translate-x-1" />
              </Button>
            </div>
        </motion.div>
      </main>

      <BrowseConsentFormsDialog 
        open={isConsentFormDialogOpen} 
        onOpenChange={setIsConsentFormDialogOpen} 
        onSelect={(forms) => setRequiredFormIds(forms.map(f => f.id))} 
        allForms={consentForms || []} 
        initialSelected={assignedForms} 
      />
    </div>
  );
}
