
'use client';

import React, { useState, useMemo } from 'react';
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
import { CheckCircle, Sparkles, User, Phone, List, ArrowRight, ArrowLeft } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';

type Step = 'services' | 'details' | 'confirmation';

export default function WalkInPage() {
  const { services, staff } = useInventory();
  const { firestore } = useFirebase();
  const router = useRouter();
  const { toast } = useToast();

  const [step, setStep] = useState<Step>('services');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [selectedServices, setSelectedServices] = useState<Service[]>([]);
  const [preferredStaffId, setPreferredStaffId] = useState<string>('any');
  const [queuePosition, setQueuePosition] = useState<number | null>(null);

  const nailServices = useMemo(() => services.filter(s => s.category === 'Nails'), [services]);

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
      serviceIds: selectedServices.map(s => s.id),
      requiredSkills: [...new Set(selectedServices.flatMap(s => s.requiredSkills || []))],
      estimatedDuration: totalDuration,
      checkInTime: new Date().toISOString(),
      status: 'waiting',
      preferredStaffId: preferredStaffId === 'any' ? undefined : preferredStaffId,
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
    setSelectedServices([]);
    setPreferredStaffId('any');
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
                     {nailServices.map(service => (
                        <label key={service.id} htmlFor={service.id} className="flex items-center space-x-4 p-4 rounded-lg border has-[:checked]:border-primary has-[:checked]:bg-primary/5 transition-all cursor-pointer">
                            <Checkbox
                                id={service.id}
                                checked={selectedServices.some(s => s.id === service.id)}
                                onCheckedChange={() => handleServiceToggle(service)}
                                className="h-6 w-6"
                            />
                            <div className="flex-1">
                                <span className="font-medium">{service.name}</span>
                                <p className="text-xs text-muted-foreground">{service.duration} min &middot; ${service.price.toFixed(2)}</p>
                            </div>
                        </label>
                    ))}
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
                                <Label htmlFor="staff">Preferred Staff</Label>
                                <div className="relative">
                                    <List className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                    <Select value={preferredStaffId} onValueChange={setPreferredStaffId}>
                                        <SelectTrigger id="staff" className="pl-9">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="any">Any Available</SelectItem>
                                            {staff.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                                        </SelectContent>
                                    </Select>
                                </div>
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
