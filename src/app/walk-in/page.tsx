

'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useInventory } from '@/context/InventoryContext';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import { useRouter } from 'next/navigation';
import { useFirebase, addDocumentNonBlocking } from '@/firebase';
import { collection } from 'firebase/firestore';
import { Service, Staff } from '@/lib/data';
import { ClarityFlowLogo } from '@/components/shared/AppSidebar';
import { Progress } from '@/components/ui/progress';
import { CheckCircle, Sparkles, User, Phone, List, ArrowRight, ArrowLeft, Users, Mail, CalendarIcon } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';

type Step = 'services' | 'details' | 'confirmation';

const StaffSelectionCard = ({ staff, isSelected, onSelect }: { staff: Staff | { id: string, name: string, avatarUrl: string }, isSelected: boolean, onSelect: () => void }) => {
    const isAnyStaff = staff.id === 'any';
    return (
        <label htmlFor={`staff-${staff.id}`} className="block cursor-pointer">
            <Card className={`transition-all ${isSelected ? 'border-primary ring-2 ring-primary' : 'hover:border-primary/50'}`}>
                <CardContent className="p-4 flex flex-col items-center gap-3">
                    <Avatar className="w-16 h-16">
                        {staff.avatarUrl ? <AvatarImage src={staff.avatarUrl} /> : null}
                        <AvatarFallback className="text-muted-foreground">
                            {isAnyStaff ? <Users className="w-8 h-8"/> : staff.name.charAt(0)}
                        </AvatarFallback>
                    </Avatar>
                    <p className="font-semibold text-sm text-center">{staff.name}</p>
                    <RadioGroupItem value={staff.id} id={`staff-${staff.id}`} className="sr-only" />
                </CardContent>
            </Card>
        </label>
    );
};


export default function WalkInPage() {
  const { services, staff } = useInventory();
  const { firestore } = useFirebase();
  const router = useRouter();
  const { toast } = useToast();

  const [step, setStep] = useState<Step>('services');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [customerBirthday, setCustomerBirthday] = useState<Date | undefined>();
  const [birthMonth, setBirthMonth] = useState('');
  const [birthDay, setBirthDay] = useState('');
  const [birthYear, setBirthYear] = useState('');
  const [selectedServices, setSelectedServices] = useState<Service[]>([]);
  const [preferredStaffId, setPreferredStaffId] = useState<string>('any');
  const [notes, setNotes] = useState('');
  const [queuePosition, setQueuePosition] = useState<number | null>(null);
  const [waitForPreferred, setWaitForPreferred] = useState<boolean>(false);

  const mainServices = useMemo(() => services.filter(s => s.type === 'service'), [services]);
  const addOnServices = useMemo(() => services.filter(s => s.type === 'addon'), [services]);

  useEffect(() => {
    if (birthYear && birthMonth && birthDay) {
        const date = new Date(parseInt(birthYear), parseInt(birthMonth) - 1, parseInt(birthDay));
        if (date.getFullYear() === parseInt(birthYear) && (date.getMonth() + 1) === parseInt(birthMonth) && date.getDate() === parseInt(birthDay)) {
            setCustomerBirthday(date);
        } else {
             setCustomerBirthday(undefined);
        }
    } else {
        setCustomerBirthday(undefined);
    }
  }, [birthMonth, birthDay, birthYear]);

  const handleServiceToggle = (service: Service) => {
    setSelectedServices(prev =>
      prev.some(s => s.id === service.id)
        ? prev.filter(s => s.id !== service.id)
        : [...prev, service]
    );
  };

  const { totalDuration, totalPrice } = useMemo(() => {
    const duration = selectedServices.reduce((acc, s) => acc + s.duration, 0);
    const price = selectedServices.reduce((acc, s) => acc + s.price, 0);
    return { totalDuration: duration, totalPrice: price };
  }, [selectedServices]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customerName || selectedServices.length === 0 || !firestore) {
      toast({
        variant: 'destructive',
        title: 'Missing Information',
        description: 'Please enter your name and select at least one service.',
      });
      return;
    }
    
    const tenantId = 'tenant-abc';
    const walkInsRef = collection(firestore, 'tenants', tenantId, 'walkIns');

    const newWalkIn = {
      customerName,
      customerPhone,
      customerEmail,
      customerBirthday: customerBirthday?.toISOString(),
      serviceIds: selectedServices.map(s => s.id),
      requiredSkills: [...new Set(selectedServices.flatMap(s => s.requiredSkills || []))],
      estimatedDuration: totalDuration,
      checkInTime: new Date().toISOString(),
      status: 'waiting',
      preferredStaffId: preferredStaffId === 'any' ? undefined : preferredStaffId,
      waitForPreferredStaff: preferredStaffId !== 'any' ? waitForPreferred : false,
      notes: notes,
    };
    
    try {
        await addDocumentNonBlocking(walkInsRef, newWalkIn);
        setQueuePosition(Math.floor(Math.random() * 5) + 1); // Mock queue position
        setStep('confirmation');
    } catch (error) {
        console.error("Error adding walk-in:", error);
        toast({
            variant: 'destructive',
            title: 'Something went wrong',
            description: 'Could not add you to the waitlist. Please see the front desk.',
        });
    }
  };

  const progressValue = step === 'services' ? 33 : step === 'details' ? 66 : 100;
  
  const resetFlow = () => {
    setCustomerName('');
    setCustomerPhone('');
    setCustomerEmail('');
    setCustomerBirthday(undefined);
    setBirthMonth('');
    setBirthDay('');
    setBirthYear('');
    setSelectedServices([]);
    setPreferredStaffId('any');
    setNotes('');
    setWaitForPreferred(false);
    setStep('services');
  };

  return (
    <div className="flex min-h-screen w-full flex-col items-center justify-center bg-muted/40 p-4">
      <div className="w-full max-w-2xl mx-auto">
        <header className="mb-8 text-center">
          <div className="inline-block p-3 bg-card rounded-full shadow-md mb-4">
            <ClarityFlowLogo />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">ClarityFlow Salon</h1>
          <p className="text-muted-foreground">Walk-in Check-in</p>
        </header>

        <Card className="overflow-hidden">
          <div className="p-6 border-b">
            <Progress value={progressValue} className="h-2" />
          </div>
          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial={{ opacity: 0, x: 50 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -50 }}
              transition={{ duration: 0.3, ease: "easeInOut" }}
            >
              {step === 'services' && (
                <div>
                  <CardHeader>
                    <CardTitle>Select Your Services</CardTitle>
                    <CardDescription>Choose one or more services you'd like today.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4 max-h-[40vh] overflow-y-auto">
                     <Accordion type="multiple" defaultValue={['main-services']} className="w-full space-y-4">
                        <AccordionItem value="main-services">
                            <AccordionTrigger>Main Services</AccordionTrigger>
                            <AccordionContent className="space-y-2 pt-2">
                                {mainServices.map(service => {
                                    const isSelected = selectedServices.some(s => s.id === service.id);
                                    const compatibleAddons = addOnServices.filter(addOn => service.compatibleAddOnIds?.includes(addOn.id));
                                    
                                    return (
                                        <div key={service.id} className="border rounded-lg has-[:checked]:border-primary has-[:checked]:bg-primary/5 transition-all">
                                            <label htmlFor={service.id} className="flex items-center space-x-4 p-4 cursor-pointer">
                                                <Checkbox id={service.id} checked={isSelected} onCheckedChange={() => handleServiceToggle(service)} className="h-6 w-6" />
                                                <div className="flex-1">
                                                    <span className="font-medium">{service.name}</span>
                                                    <p className="text-xs text-muted-foreground">{service.duration} min &middot; ${service.price.toFixed(2)}</p>
                                                </div>
                                            </label>
                                            {isSelected && compatibleAddons.length > 0 && (
                                                <div className="p-4 pt-0 pl-14">
                                                    <h4 className="text-sm font-semibold mb-2">Compatible Add-ons</h4>
                                                    <div className="space-y-2">
                                                        {compatibleAddons.map(addon => (
                                                            <label key={addon.id} htmlFor={addon.id} className="flex items-center space-x-3 p-3 rounded-md bg-background cursor-pointer hover:bg-muted/50">
                                                                <Checkbox id={addon.id} checked={selectedServices.some(s => s.id === addon.id)} onCheckedChange={() => handleServiceToggle(addon)} />
                                                                <div className="flex-1">
                                                                    <span className="font-medium text-sm">{addon.name}</span>
                                                                    <p className="text-xs text-muted-foreground">{addon.duration} min &middot; ${addon.price.toFixed(2)}</p>
                                                                </div>
                                                            </label>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )
                                })}
                            </AccordionContent>
                        </AccordionItem>
                    </Accordion>
                  </CardContent>
                  <CardFooter className="flex justify-end">
                    <Button onClick={() => setStep('details')} disabled={selectedServices.length === 0}>
                        Next <ArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                  </CardFooter>
                </div>
              )}
              
              {step === 'details' && (
                <div>
                    <CardHeader>
                        <CardTitle>Your Details</CardTitle>
                        <CardDescription>Just a few more details to get you on the list.</CardDescription>
                    </CardHeader>
                    <form onSubmit={handleSubmit}>
                        <CardContent className="space-y-6">
                             <div className="space-y-2">
                                <Label htmlFor="name">Your Name</Label>
                                <div className="relative">
                                    <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                    <Input id="name" value={customerName} onChange={e => setCustomerName(e.target.value)} placeholder="Jane Doe" required className="pl-9" />
                                </div>
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="phone">Phone Number (for SMS updates)</Label>
                                <div className="relative">
                                    <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                    <Input id="phone" type="tel" value={customerPhone} onChange={e => setCustomerPhone(e.target.value)} placeholder="(555) 123-4567" className="pl-9" />
                                </div>
                            </div>
                             <div className="space-y-2">
                                <Label htmlFor="email">Email Address</Label>
                                <div className="relative">
                                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                    <Input id="email" type="email" value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)} placeholder="jane.doe@example.com" className="pl-9" />
                                </div>
                            </div>
                             <div className="space-y-2">
                                <Label>Birthday (Optional)</Label>
                                <div className="grid grid-cols-3 gap-2">
                                    <Select value={birthMonth} onValueChange={setBirthMonth}>
                                        <SelectTrigger><SelectValue placeholder="Month" /></SelectTrigger>
                                        <SelectContent>
                                            {Array.from({ length: 12 }, (_, i) => (
                                                <SelectItem key={i + 1} value={(i + 1).toString()}>
                                                    {format(new Date(2000, i, 1), 'MMMM')}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                    <Select value={birthDay} onValueChange={setBirthDay}>
                                        <SelectTrigger><SelectValue placeholder="Day" /></SelectTrigger>
                                        <SelectContent>
                                            {Array.from({ length: 31 }, (_, i) => (
                                                <SelectItem key={i + 1} value={(i + 1).toString()}>
                                                    {i + 1}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                    <Select value={birthYear} onValueChange={setBirthYear}>
                                        <SelectTrigger><SelectValue placeholder="Year" /></SelectTrigger>
                                        <SelectContent>
                                            {Array.from({ length: 100 }, (_, i) => {
                                                const year = new Date().getFullYear() - i;
                                                return (
                                                    <SelectItem key={year} value={year.toString()}>
                                                        {year}
                                                    </SelectItem>
                                                );
                                            })}
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                             <div className="space-y-2">
                                <Label>Preferred Staff</Label>
                                 <RadioGroup value={preferredStaffId} onValueChange={setPreferredStaffId} className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                     <StaffSelectionCard staff={{id: 'any', name: 'Any Available', avatarUrl: ''}} isSelected={preferredStaffId === 'any'} onSelect={() => setPreferredStaffId('any')} />
                                     {staff.map(s => (
                                         <StaffSelectionCard key={s.id} staff={s} isSelected={preferredStaffId === s.id} onSelect={() => setPreferredStaffId(s.id)} />
                                     ))}
                                 </RadioGroup>
                            </div>
                            <div className={`mt-4 space-y-2 transition-opacity ${preferredStaffId === 'any' ? 'opacity-50' : 'opacity-100'}`}>
                                <div className="flex items-center justify-between rounded-lg border p-4">
                                    <Label htmlFor="wait-for-preferred" className="flex flex-col gap-1">
                                        <span>Wait for {staff.find(s => s.id === preferredStaffId)?.name || 'Preferred Staff'}?</span>
                                        <span className="text-xs font-normal text-muted-foreground">If unchecked, you may be assigned to the next available stylist.</span>
                                    </Label>
                                    <Switch
                                        id="wait-for-preferred"
                                        checked={waitForPreferred}
                                        onCheckedChange={setWaitForPreferred}
                                        disabled={preferredStaffId === 'any'}
                                    />
                                </div>
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="preferences">Preferences or Special Needs (Optional)</Label>
                                <Textarea id="preferences" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g., preference for a quiet environment, allergy to certain scents..." />
                            </div>
                        </CardContent>
                        <CardFooter className="flex justify-between">
                            <Button variant="ghost" onClick={() => setStep('services')}>
                                <ArrowLeft className="mr-2 h-4 w-4" /> Back
                            </Button>
                            <Button type="submit">Join Waitlist</Button>
                        </CardFooter>
                    </form>
                </div>
              )}

              {step === 'confirmation' && (
                <div>
                  <CardContent className="p-8 text-center space-y-4">
                    <CheckCircle className="w-16 h-16 mx-auto text-green-500" />
                    <h2 className="text-2xl font-bold">You're on the list!</h2>
                    <p className="text-muted-foreground">
                        You are number <span className="font-bold text-primary">{queuePosition}</span> in the queue. 
                        Your estimated wait time is <span className="font-bold text-primary">~15 minutes</span>.
                    </p>
                    <p className="text-sm">We'll send you an SMS when it's your turn. Feel free to have a seat!</p>
                  </CardContent>
                  <CardFooter>
                      <Button className="w-full" onClick={resetFlow}>Done</Button>
                  </CardFooter>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </Card>
      </div>
    </div>
  );
}
