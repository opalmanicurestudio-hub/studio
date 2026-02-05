
'use client';

import React from 'react';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { OrderCard } from './OrderCard';
import { type Appointment, type Service, type Client } from '@/lib/data';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface OrderLineProps {
  appointments: (Appointment & { client?: Client, service?: Service })[];
  onSelectOrder: (order: Appointment) => void;
  selectedOrderId: string | null;
}

const statusFilters = ['ready_for_checkout', 'servicing', 'waiting', 'completed'];

export const OrderLine: React.FC<OrderLineProps> = ({ appointments, onSelectOrder, selectedOrderId }) => {
    const [filter, setFilter] = React.useState('ready_for_checkout');

    const filteredAppointments = React.useMemo(() => {
        return appointments.filter(apt => apt.status === filter);
    }, [appointments, filter]);


  return (
    <div className="space-y-3">
        <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold">Order Line</h2>
            <div className="hidden sm:flex items-center gap-1 rounded-md bg-muted p-1">
                {statusFilters.map(status => (
                    <Button 
                        key={status} 
                        variant={filter === status ? 'secondary' : 'ghost'} 
                        size="sm"
                        onClick={() => setFilter(status)}
                        className="capitalize rounded-sm shadow-none"
                    >
                        {status.replace('_', ' ')}
                    </Button>
                ))}
            </div>
        </div>
      <ScrollArea className="w-full">
        <div className="flex space-x-4 pb-4">
          {filteredAppointments.length > 0 ? (
            filteredAppointments.map(order => (
                <OrderCard
                    key={order.id}
                    order={order}
                    isSelected={selectedOrderId === order.id}
                    onSelect={() => onSelectOrder(order)}
                />
            ))
          ) : (
              <div className="w-full text-center py-8 text-muted-foreground">
                  No orders with status "{filter.replace('_', ' ')}".
              </div>
          )}
        </div>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>
    </div>
  );
};
