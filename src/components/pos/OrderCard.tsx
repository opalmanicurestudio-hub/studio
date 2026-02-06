

'use client';

import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { type Appointment, type Service, type Client, type Staff } from '@/lib/data';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { User, Scissors, CheckCircle } from 'lucide-react';
import { Separator } from '@/components/ui/separator';

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

  return (
    <Card className={isSelected ? "border-primary ring-2 ring-primary" : ""}>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
                <Avatar>
                    <AvatarImage src={client.avatarUrl} alt={client.name} />
                    <AvatarFallback>{client.name.substring(0, 2)}</AvatarFallback>
                </Avatar>
                <div>
                    <p className="font-semibold">{client.name}</p>
                    <p className="text-sm text-muted-foreground flex items-center gap-1.5">
                        <User className="w-3 h-3" />
                        {staff?.name || 'N/A'}
                    </p>
                </div>
            </div>
            <Button size="sm" onClick={onSelect}>Checkout</Button>
        </div>
        <Separator />
        <div className="space-y-2 text-sm">
             <div className="flex items-center gap-2">
                <Scissors className="w-4 h-4 text-muted-foreground" />
                <span className="font-medium">{service.name}</span>
                <span className="ml-auto font-mono">${service.price.toFixed(2)}</span>
            </div>
            {addOnServices.map(addon => (
                <div key={addon.id} className="flex items-center gap-2 pl-6">
                    <CheckCircle className="w-3.5 h-3.5 text-green-500" />
                    <span className="text-muted-foreground">{addon.name}</span>
                    <span className="ml-auto font-mono text-muted-foreground">${addon.price.toFixed(2)}</span>
                </div>
            ))}
        </div>
      </CardContent>
    </Card>
  );
};
