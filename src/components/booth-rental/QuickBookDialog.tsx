'use client';

// src/components/booth-rental/QuickBookDialog.tsx
//
// Lightweight booking dialog — deliberately NOT the 3-step lease wizard.
// A 2-hour day-use booking shouldn't take as many clicks as a 12-month
// lease. Drop this into page.tsx next to the existing lease/renter
// dialogs; it calls /api/stripe/book-station directly (charges the
// renter's card on file — see that route for the guest/no-card path,
// which is a separate follow-up).

import { useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import {
  Booth,
  Renter,
  Lease,
  computeBookingTotalCents,
  isBoothAvailable,
  formatCents,
} from '@/lib/booth-rental-types';

interface QuickBookDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenantId: string;
  locationId: string;
  booths: Booth[];
  renters: Renter[];
  occupyingLeaseByBooth: Map<string, Lease>;
  existingBookingsByBooth: Map<string, { startAt: string; endAt: string }[]>;
  onBooked: (bookingId: string) => void;
}

export function QuickBookDialog({
  open, onOpenChange, tenantId, locationId, booths, renters,
  occupyingLeaseByBooth, existingBookingsByBooth, onBooked,
}: QuickBookDialogProps) {
  const dayUseBooths = useMemo(() => booths.filter((b) => b.dayUseEnabled), [booths]);

  const [boothId, setBoothId] = useState('');
  const [renterId, setRenterId] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [rateType, setRateType] = useState<'hourly' | 'daily'>('hourly');
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('11:00');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [alternatives, setAlternatives] = useState<Booth[]>([]);

  const booth = booths.find((b) => b.id === boothId);
  const startAt = `${date}T${startTime}:00`;
  const endAt = rateType === 'daily' ? `${date}T23:59:00` : `${date}T${endTime}:00`;

  const totalCents = booth ? computeBookingTotalCents(booth, { startAt, endAt }, rateType) : 0;

  const localAvailability = useMemo(() => {
    if (!booth) return null;
    return isBoothAvailable({
      range: { startAt, endAt },
      occupyingLease: occupyingLeaseByBooth.get(booth.id) ? { scheduleSlot: occupyingLeaseByBooth.get(booth.id)!.scheduleSlot } : undefined,
      existingBookings: existingBookingsByBooth.get(booth.id) ?? [],
      bufferMinutes: booth.dayUseBufferMinutes ?? 0,
    });
  }, [booth, startAt, endAt, occupyingLeaseByBooth, existingBookingsByBooth]);

  async function handleSubmit() {
    setError(null);
    setAlternatives([]);
    if (!boothId || !renterId) {
      setError('Choose a booth and a renter.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/stripe/book-station', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, locationId, boothId, renterId, startAt, endAt, rateType, mode: 'pos' }),
      });
      const data = await res.json();

      if (!data.ok) {
        if (data.code === 'slot_conflict') {
          const others = dayUseBooths
            .filter((b) => b.id !== boothId)
            .filter((b) => {
              const lease = occupyingLeaseByBooth.get(b.id);
              return isBoothAvailable({
                range: { startAt, endAt },
                occupyingLease: lease ? { scheduleSlot: lease.scheduleSlot } : undefined,
                existingBookings: existingBookingsByBooth.get(b.id) ?? [],
                bufferMinutes: b.dayUseBufferMinutes ?? 0,
              });
            });
          setAlternatives(others);
        }
        setError(data.reason || 'Could not complete booking.');
        return;
      }

      onBooked(data.bookingId);
      onOpenChange(false);
    } catch (err) {
      setError('Network error — please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] max-w-md sm:w-full">
        <DialogHeader>
          <DialogTitle>Book a station</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Booth</Label>
            <Select value={boothId} onValueChange={(v) => { setBoothId(v); setError(null); setAlternatives([]); }}>
              <SelectTrigger><SelectValue placeholder="Select a day-use booth" /></SelectTrigger>
              <SelectContent>
                {dayUseBooths.map((b) => (
                  <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {dayUseBooths.length === 0 && (
              <p className="text-xs text-muted-foreground">No booths are enabled for day-use booking yet.</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>Renter</Label>
            <Select value={renterId} onValueChange={setRenterId}>
              <SelectTrigger><SelectValue placeholder="Select a renter" /></SelectTrigger>
              <SelectContent>
                {renters.filter((r) => r.stripeCustomerId && r.defaultPaymentMethodId).map((r) => (
                  <SelectItem key={r.id} value={r.id}>{r.firstName} {r.lastName}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Only renters with a card on file can be booked here.</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Date</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Rate</Label>
              <Select value={rateType} onValueChange={(v: 'hourly' | 'daily') => setRateType(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="hourly">Hourly</SelectItem>
                  <SelectItem value="daily">Full day</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {rateType === 'hourly' && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Start</Label>
                <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>End</Label>
                <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
              </div>
            </div>
          )}

          {booth && (
            <div className="rounded-md border p-3 text-sm space-y-1">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Total</span>
                <span className="font-medium">{formatCents(totalCents)}</span>
              </div>
              {localAvailability === false && (
                <p className="text-xs text-amber-600">This slot looks taken — you'll get an exact answer on submit.</p>
              )}
            </div>
          )}

          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          {alternatives.length > 0 && (
            <div className="space-y-1.5">
              <Label className="text-xs">Available instead, same time:</Label>
              <div className="flex flex-wrap gap-2">
                {alternatives.slice(0, 4).map((b) => (
                  <Button key={b.id} type="button" variant="outline" size="sm"
                    onClick={() => { setBoothId(b.id); setError(null); setAlternatives([]); }}>
                    {b.name}
                  </Button>
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={submitting || !boothId || !renterId}>
            {submitting ? 'Booking…' : `Book — ${formatCents(totalCents)}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
