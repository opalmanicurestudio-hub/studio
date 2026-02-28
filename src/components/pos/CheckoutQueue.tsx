'use client';

import React, { useState, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { type Appointment, type Service, type Client, type Staff } from '@/lib/data';
import { CheckoutQueueCard } from './CheckoutQueueCard';
import { ScrollArea, ScrollBar } from '../ui/scroll-area';
import { Input } from '../ui/input';
import { Search, QrCode } from 'lucide-react';
import { Button } from '../ui/button';

interface CheckoutQueueProps {
  appointments: {
    id: string;
    appointment: Appointment;
    client: Client;
    service: Service;
    addOnServices: Service[];
    staff: Staff;
  }[];
  onSelectAppointment: (appointmentId: string) => void;
  selectedAppointmentIds: Set<string>;
  onScanClick: () => void;
}

export const CheckoutQueue: React.FC<CheckoutQueueProps> = ({ appointments, onSelectAppointment, selectedAppointmentIds, onScanClick }) => {
  const [searchTerm, setSearchTerm] = useState('');

  const filteredAppointments = useMemo(() => {
    if (!searchTerm) return appointments;
    const lowercasedFilter = searchTerm.toLowerCase();
    return appointments.filter(apt => 
      apt.client.name.toLowerCase().includes(lowercasedFilter) ||
      apt.service.name.toLowerCase().includes(lowercasedFilter)
    );
  }, [appointments, searchTerm]);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
            <div>
                <CardTitle>Checkout Queue</CardTitle>
                <CardDescription>Clients who are ready to pay. Select multiple for a group checkout.</CardDescription>
            </div>
            <Button variant="outline" onClick={onScanClick} className="gap-2">
                <QrCode className="h-4 w-4" />
                Scan Ticket
            </Button>
        </div>
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
        {appointments.length === 0 ? (
          <div className="text-center py-10 px-6 border-2 border-dashed rounded-lg">
            <p className="text-muted-foreground">No clients are currently ready for checkout.</p>
          </div>
        ) : (
          <ScrollArea>
            <div className="flex space-x-4 pb-4">
              {filteredAppointments.length > 0 ? (
                filteredAppointments.map(data => (
                    <CheckoutQueueCard
                        key={data.id}
                        appointmentData={data}
                        isSelected={selectedAppointmentIds.has(data.id)}
                        onSelect={() => onSelectAppointment(data.id)}
                    />
                ))
              ) : (
                <div className="w-full text-center py-8 text-muted-foreground">
                    <p>No clients match your search.</p>
                </div>
              )}
            </div>
            <ScrollBar orientation="horizontal" />
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
};
