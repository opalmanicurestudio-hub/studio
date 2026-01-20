'use client';

import React, { useState, useMemo } from 'react';
import { AppHeader } from '@/components/shared/AppHeader';
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

export default function WalkInPage() {
  const { services, staff } = useInventory();
  const { firestore } = useFirebase();
  const router = useRouter();
  const { toast } = useToast();

  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [selectedServices, setSelectedServices] = useState<Service[]>([]);
  const [preferredStaffId, setPreferredStaffId] = useState<string>('any');

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
        toast({
            title: 'You\'re on the list!',
            description: `We'll notify you when it's your turn. Estimated wait: ~15 mins.`,
        });
        // Maybe redirect to a status page later
        setCustomerName('');
        setCustomerPhone('');
        setSelectedServices([]);
        setPreferredStaffId('any');
    } catch (error) {
        console.error("Error adding walk-in:", error);
        toast({
            variant: 'destructive',
            title: 'Something went wrong',
            description: 'Could not add you to the waitlist. Please see the front desk.',
        });
    }
  };

  return (
    <div className="flex min-h-screen w-full flex-col">
      <AppHeader title="Walk-In Check-in" />
      <main className="flex-1 p-4 md:p-8 flex items-center justify-center">
        <Card className="w-full max-w-2xl">
          <CardHeader>
            <CardTitle>Welcome!</CardTitle>
            <CardDescription>Please enter your details and select your services to join the waitlist.</CardDescription>
          </CardHeader>
          <form onSubmit={handleSubmit}>
            <CardContent className="space-y-6">
                <div className="space-y-2">
                    <Label htmlFor="name">Your Name</Label>
                    <Input id="name" value={customerName} onChange={e => setCustomerName(e.target.value)} placeholder="Jane Doe" required />
                </div>
                 <div className="space-y-2">
                    <Label htmlFor="phone">Phone Number (for SMS updates)</Label>
                    <Input id="phone" type="tel" value={customerPhone} onChange={e => setCustomerPhone(e.target.value)} placeholder="(555) 123-4567" />
                </div>
                <div className="space-y-4">
                    <Label>Select Services</Label>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-h-60 overflow-y-auto p-1">
                        {nailServices.map(service => (
                            <div key={service.id} className="flex items-center space-x-2 p-3 rounded-md border has-[:checked]:border-primary">
                                <Checkbox
                                    id={service.id}
                                    checked={selectedServices.some(s => s.id === service.id)}
                                    onCheckedChange={() => handleServiceToggle(service)}
                                />
                                <Label htmlFor={service.id} className="flex-1 cursor-pointer">
                                    <span className="font-medium">{service.name}</span>
                                    <p className="text-xs text-muted-foreground">{service.duration} min &middot; ${service.price.toFixed(2)}</p>
                                </Label>
                            </div>
                        ))}
                    </div>
                </div>
                 <div className="space-y-2">
                    <Label htmlFor="staff">Preferred Staff</Label>
                     <Select value={preferredStaffId} onValueChange={setPreferredStaffId}>
                        <SelectTrigger id="staff">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="any">Any Available</SelectItem>
                            {staff.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                        </SelectContent>
                    </Select>
                </div>
                 <div className="p-4 rounded-lg bg-muted/50 text-sm">
                    <div className="flex justify-between"><span>Est. Duration:</span> <span className="font-semibold">{totalDuration} min</span></div>
                    <div className="flex justify-between"><span>Est. Total:</span> <span className="font-semibold">${totalPrice.toFixed(2)}</span></div>
                </div>
            </CardContent>
            <CardFooter>
                 <Button type="submit" size="lg" className="w-full">Join Waitlist</Button>
            </CardFooter>
          </form>
        </Card>
      </main>
    </div>
  );
}