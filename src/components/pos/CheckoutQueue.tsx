'use client';

import React, { useState, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { type Appointment, type Service, type Client, type Staff } from '@/lib/data';
import { CheckoutQueueCard } from './CheckoutQueueCard';
import { ScrollArea, ScrollBar } from '../ui/scroll-area';
import { Input } from '../ui/input';
import { Search, QrCode, X } from 'lucide-react';
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

/**
 * Turn anything into a lowercase haystack string, safely.
 *
 * The search used to read `apt.client.name.toLowerCase()` directly. If a row
 * arrived without a resolved client or service — which happens for a walk-in
 * whose client record does not exist yet — that line threw on the FIRST
 * keystroke and white-screened the whole Terminal mid-checkout. Never dot into
 * a name here. Coerce and move on.
 */
const hay = (v: any): string => (v == null ? '' : String(v)).toLowerCase();

export const CheckoutQueue: React.FC<CheckoutQueueProps> = ({ appointments, onSelectAppointment, selectedAppointmentIds, onScanClick }) => {
  const [searchTerm, setSearchTerm] = useState('');

  const filteredAppointments = useMemo(() => {
    const term = hay(searchTerm).trim();
    if (!term) return appointments;
    // Digits only, so "555 0143", "(555) 0143" and "5550143" all match a phone.
    const digits = term.replace(/\D/g, '');
    return (appointments || []).filter((apt: any) => {
      const fields = [
        apt?.client?.name,
        apt?.service?.name,
        apt?.staff?.name,
        apt?.appointment?.clientName,
        apt?.appointment?.serviceName,
        ...(Array.isArray(apt?.addOnServices) ? apt.addOnServices.map((s: any) => s?.name) : []),
      ];
      if (fields.some(f => hay(f).includes(term))) return true;
      // Phone match only when the typed term actually contains digits, so a
      // plain-text search does not match every row through an empty string.
      if (digits.length >= 3) {
        const phone = hay(apt?.client?.phone ?? apt?.appointment?.clientPhone).replace(/\D/g, '');
        if (phone && phone.includes(digits)) return true;
      }
      return false;
    });
  }, [appointments, searchTerm]);

  const total = (appointments || []).length;
  const shown = (filteredAppointments || []).length;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
                <CardTitle className="flex items-center gap-2">
                  Checkout Queue
                  {total > 0 && (
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
                      {total} waiting
                    </span>
                  )}
                </CardTitle>
                <CardDescription>Clients who are ready to pay. Select multiple for a group checkout.</CardDescription>
            </div>
            {/* Full width on a phone so it is a real thumb target, not a sliver. */}
            <Button variant="outline" onClick={onScanClick} className="w-full gap-2 sm:w-auto sm:shrink-0">
                <QrCode className="h-4 w-4" />
                Scan Ticket
            </Button>
        </div>
        {/* No queue means nothing to search. Hiding the box keeps the empty
            state clean instead of offering a control that can only fail. */}
        {total > 0 && (
          <div className="relative pt-2">
              {/* -translate-y-[-4px] was a double negative: it pushed the icon 4px
                  DOWN out of the field instead of centering it. pt-2 above shifts
                  the row, so center against the input, not the wrapper. */}
              <Search className="pointer-events-none absolute left-3 top-1/2 mt-1 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                  placeholder="Search name, phone, service, or tech..."
                  className="pl-9 pr-9"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
              />
              {searchTerm && (
                <button
                  type="button"
                  aria-label="Clear search"
                  onClick={() => setSearchTerm('')}
                  className="absolute right-2 top-1/2 mt-1 -translate-y-1/2 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
          </div>
        )}
      </CardHeader>
      <CardContent>
        {total === 0 ? (
          <div className="text-center py-10 px-6 border-2 border-dashed rounded-lg">
            <p className="text-muted-foreground">No clients are currently ready for checkout.</p>
          </div>
        ) : shown === 0 ? (
          /* This used to live INSIDE the horizontally scrolling strip, where it
             could be parked off-screen — you typed a typo and the panel just
             looked blank. It is a sibling of the strip now, so it cannot hide. */
          <div className="rounded-lg border-2 border-dashed py-8 text-center">
            <p className="text-muted-foreground">No clients match &ldquo;{searchTerm}&rdquo;.</p>
            <Button variant="link" onClick={() => setSearchTerm('')}>Clear search</Button>
          </div>
        ) : (
          /* w-full + whitespace-nowrap are what make a horizontal ScrollArea
             actually scroll; without them the strip clips and the last card is
             unreachable. Both are gated to sm and up, because on a phone the
             cards stack vertically instead (flex-col) — a sideways scroll on a
             narrow screen is how you miss the guest at the counter. */
          <ScrollArea className="w-full sm:whitespace-nowrap">
            <div className="flex flex-col gap-4 pb-4 sm:flex-row sm:space-x-0">
              {filteredAppointments.map(data => (
                  <CheckoutQueueCard
                      key={data.id}
                      appointmentData={data}
                      isSelected={selectedAppointmentIds.has(data.id)}
                      onSelect={() => onSelectAppointment(data.id)}
                  />
              ))}
            </div>
            <ScrollBar orientation="horizontal" className="hidden sm:flex" />
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
};
