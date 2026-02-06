

'use client';

import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { type Appointment, type Service, type Client, type Staff } from '@/lib/data';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { User, Scissors, CheckCircle } from 'lucide-react';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { Checkbox } from '../ui/checkbox';
import { Label } from '../ui/label';

interface CheckoutQueueCardProps {
  appointment: Appointment & { client?: Client, service?: Service, addOnServices: Service[], staff?: Staff };
  isSelected: boolean;
  onSelect: () => void;
}

export const CheckoutQueueCard: React.FC<CheckoutQueueCardProps> = ({ appointment, isSelected, onSelect }) => {
  const { client, service, addOnServices, staff } = appointment;

  if (!client || !service) {
    return null; // Or a skeleton/error state
  }

  const totalPrice = (service.price || 0) + addOnServices.reduce((acc, s) => acc + s.price, 0);

  return (
    <Card className={cn("transition-all", isSelected && "border-primary ring-2 ring-primary")}>
        <Label htmlFor={`apt-${appointment.id}`} className="flex items-start gap-4 p-4 cursor-pointer">
            <Checkbox id={`apt-${appointment.id}`} checked={isSelected} onCheckedChange={onSelect} className="mt-1" />
            <div className="flex-1 space-y-2">
                <div className="flex justify-between items-start">
                    <div>
                        <p className="font-semibold">{client.name}</p>
                        <p className="text-sm text-muted-foreground">{format(new Date(appointment.startTime), 'h:mm a')}</p>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                        <Avatar className="w-6 h-6">
                        <AvatarImage src={staff?.avatarUrl} />
                        <AvatarFallback>{staff?.name.charAt(0)}</AvatarFallback>
                        </Avatar>
                        <span>{staff?.name}</span>
                    </div>
                </div>
                <Separator />
                <div className="space-y-1 text-sm">
                    <div className="flex justify-between">
                        <span>{service.name}</span>
                        <span>${service.price.toFixed(2)}</span>
                    </div>
                    {addOnServices.map(addon => (
                        <div key={addon.id} className="flex justify-between text-muted-foreground">
                        <span className="pl-4">+ {addon.name}</span>
                        <span>${addon.price.toFixed(2)}</span>
                        </div>
                    ))}
                </div>
                <Separator />
                <div className="flex justify-between font-semibold">
                    <span>Total</span>
                    <span>${totalPrice.toFixed(2)}</span>
                </div>
            </div>
      </Label>
    </Card>
  );
};
