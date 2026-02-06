

'use client';

import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { type Appointment, type Service, type Client, type Staff } from '@/lib/data';
import { CheckoutQueueCard } from './CheckoutQueueCard';

interface CheckoutQueueProps {
  appointments: (Appointment & { client?: Client, service?: Service, addOnServices: Service[], staff?: Staff })[];
  onSelectOrder: (order: Appointment) => void;
  selectedOrderId: string | null;
}

export const CheckoutQueue: React.FC<CheckoutQueueProps> = ({ appointments, onSelectOrder, selectedOrderId }) => {

  return (
    <Card>
      <CardHeader>
        <CardTitle>Checkout Queue</CardTitle>
        <CardDescription>Clients who have finished their service and are ready to pay.</CardDescription>
      </CardHeader>
      <CardContent>
        {appointments.length > 0 ? (
          <div className="space-y-4">
            {appointments.map(order => (
              <CheckoutQueueCard
                key={order.id}
                appointment={order}
                isSelected={selectedOrderId === order.id}
                onSelect={() => onSelectOrder(order)}
              />
            ))}
          </div>
        ) : (
          <div className="text-center py-10 px-6 border-2 border-dashed rounded-lg">
            <p className="text-muted-foreground">No clients are currently ready for checkout.</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
