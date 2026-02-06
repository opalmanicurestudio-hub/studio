
'use client';

import React, { useState, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { type Appointment, type Service, type Client, type Staff } from '@/lib/data';
import { CheckoutQueueCard } from './CheckoutQueueCard';
import { ScrollArea, ScrollBar } from '../ui/scroll-area';
import { Input } from '../ui/input';
import { Search } from 'lucide-react';

interface CheckoutQueueProps {
  appointments: (Appointment & { client?: Client, service?: Service, addOnServices: Service[], staff?: Staff })[];
  onSelectAppointment: (appointmentId: string) => void;
  selectedAppointmentIds: Set<string>;
}

export const CheckoutQueue: React.FC<CheckoutQueueProps> = ({ appointments, onSelectAppointment, selectedAppointmentIds }) => {
  const [searchTerm, setSearchTerm] = useState('');

  const filteredAppointments = useMemo(() => {
    if (!searchTerm) return appointments;
    const lowercasedFilter = searchTerm.toLowerCase();
    return appointments.filter(apt => 
      apt.client?.name.toLowerCase().includes(lowercasedFilter) ||
      apt.service?.name.toLowerCase().includes(lowercasedFilter)
    );
  }, [appointments, searchTerm]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Checkout Queue</CardTitle>
        <CardDescription>Clients who are ready to pay.</CardDescription>
        <div className="relative pt-2">
            <Search className="absolute left-3 top-1/2 -translate-y-[-4px] h-4 w-4 text-muted-foreground" />
            <Input
                placeholder="Search by client or service..."
                className="pl-9"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
            />
        </div>
      </CardHeader>
      <CardContent>
        {appointments.length > 0 ? (
          <ScrollArea>
            <div className="flex space-x-4 pb-4">
              {filteredAppointments.map(order => (
                <CheckoutQueueCard
                  key={order.id}
                  appointment={order}
                  isSelected={selectedAppointmentIds.has(order.id)}
                  onSelect={() => onSelectAppointment(order.id)}
                />
              ))}
            </div>
            <ScrollBar orientation="horizontal" />
          </ScrollArea>
        ) : (
          <div className="text-center py-10 px-6 border-2 border-dashed rounded-lg">
            <p className="text-muted-foreground">No clients are currently ready for checkout.</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
