'use client';

// src/components/quotes/ConvertToEventDialog.tsx — MAKE AN ACCEPTED QUOTE AN EVENT (the Quotes page). Everything on the
// quote goes with it (lib/quote-convert); its day is held on the calendar for the team on it (lib/event-block), in
// place of the hold made when the client accepted; the team on it is told in the app. Once: a quote already made into
// an event opens that event.
import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { collection, doc, runTransaction, setDoc } from 'firebase/firestore';
import { format } from 'date-fns';
import { CalendarCheck, Loader } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { useTenant } from '@/context/TenantContext';
import { placeText } from '@/lib/quote-public';
import { eventFromQuote } from '@/lib/quote-convert';
import { eventBlockFor, eventBlockId } from '@/lib/event-block';
import { tenantTimeZone, dayKey } from '@/lib/tenant-time';

const formatCurrency = (n: number) => `$${(Number(n) || 0).toFixed(2)}`;
const hm = (t: any) => { const m = /^(\d{2}):(\d{2})$/.exec(String(t || '')); if (!m) return ''; const h = Number(m[1]); return `${h % 12 || 12}${m[2] === '00' ? '' : `:${m[2]}`}${h < 12 ? 'am' : 'pm'}`; };

export const ConvertToEventDialog = ({ open, onOpenChange, quote, clients, tenantId, firestore, total, dayText }: {
  open: boolean; onOpenChange: (v: boolean) => void;
  quote: any; clients: any[]; tenantId: string; firestore: any;
  /** The quote's total and its day as written, worked out by the Quotes page. */
  total: number; dayText: string;
}) => {
  const router    = useRouter();
  const { toast } = useToast();
  const { selectedTenant } = useTenant();
  const [converting, setConverting] = useState(false);
  const client = clients.find(c => c.id === quote?.clientId);

  // Everything on the quote goes with it (lib/quote-convert): the client and their address, the team, the day and start
  // time, what was quoted and the deposit. Once: a quote already made into an event opens that event instead. Its day is
  // held on the calendar for the team on it (lib/event-block), in place of the hold made when the client accepted, and
  // the team on it are told in the app.
  const handleConvert = async () => {
    if (!firestore || !tenantId || !quote) return;
    setConverting(true);
    try {
      const tz = tenantTimeZone(selectedTenant);
      const qRef = doc(firestore, `tenants/${tenantId}/quotes`, quote.id);
      const eRef = doc(collection(firestore, `tenants/${tenantId}/studioEvents`));
      const out = await runTransaction(firestore, async (tx) => {
        const cur: any = (await tx.get(qRef)).data();
        if (!cur) return { gone: true };
        if (cur.convertedToEventId) return { eventId: String(cur.convertedToEventId), already: true };
        const ev = eventFromQuote({ ...cur, id: quote.id }, client || null, (d) => dayKey(d, tz));
        tx.set(eRef, { ...ev, id: eRef.id, tenantId });
        if (client) {
          const gRef = doc(collection(firestore, `tenants/${tenantId}/eventGuests`));
          tx.set(gRef, { id: gRef.id, eventId: eRef.id, tenantId, name: ev.clientName || client.name || 'Guest', email: client.email || '', phone: client.phone || '',
            tableNumber: '', seatNumber: '', mealChoiceId: null, mealChoiceName: null, allergies: [], dietaryRestrictions: [], checkedIn: false,
            source: 'quote_conversion', clientId: client.id, submittedAt: new Date().toISOString() });
        }
        const block = eventBlockFor({ ...ev, id: eRef.id }, tz);
        if (block) tx.set(doc(firestore, `tenants/${tenantId}/events`, eventBlockId(eRef.id)), block);
        tx.delete(doc(firestore, `tenants/${tenantId}/events`, `quote_${quote.id}`));
        tx.update(qRef, { convertedToEventId: eRef.id, convertedAt: new Date().toISOString() });
        return { eventId: eRef.id, staff: ev.assignedStaffIds, title: ev.title, day: ev.date, time: ev.time };
      });
      if ((out as any).gone) { toast({ variant: 'destructive', title: 'Quote not found' }); return; }
      if (!(out as any).already) {
        const o: any = out;
        const when = o.day ? format(new Date(`${o.day}T12:00:00`), 'EEE, MMM d') + (hm(o.time) ? `, ${hm(o.time)}` : '') : '';
        await Promise.all((o.staff || []).map((uid: string) => {
          const nRef = doc(collection(firestore, `tenants/${tenantId}/notifications`));
          return setDoc(nRef, { id: nRef.id, userId: uid, type: 'event_assigned', message: `You’re on ${o.title}${when ? `, ${when}` : ''}.`, link: `/events/${o.eventId}/manifest`, eventId: o.eventId, createdAt: new Date().toISOString(), read: false }).catch(() => undefined);
        }));
      }
      toast({ title: (out as any).already ? 'Already an event' : 'Event made', description: (out as any).already ? 'Opening it.' : 'Everything on the quote went with it.' });
      onOpenChange(false);
      router.push(`/events/${(out as any).eventId}/manifest`);
    } catch (e) {
      console.error(e);
      toast({ variant: 'destructive', title: 'Not made into an event', description: 'Nothing was changed. Try again.' });
    } finally {
      setConverting(false);
    }
  };

  if (!quote) return null;
  const staffNames = (Array.isArray(quote.staffPayouts) ? quote.staffPayouts : []).map((s: any) => s?.name).filter(Boolean);
  const rows = [
    { label: 'Name', value: quote.eventName || 'Untitled' },
    dayText && { label: 'Day', value: `${dayText}${hm(quote.startTime) ? `, from ${hm(quote.startTime)}` : ''}` },
    placeText(quote.eventLocation) && { label: 'Where', value: placeText(quote.eventLocation) },
    client && { label: 'Client', value: client.name },
    staffNames.length > 0 && { label: 'Team', value: staffNames.join(', ') },
    { label: 'Quoted', value: formatCurrency(total) },
    (quote.depositAmount || 0) > 0 && { label: 'Deposit', value: `${formatCurrency(quote.depositAmount)}${quote.depositPaid ? ', paid' : ', not paid yet'}` },
  ].filter(Boolean) as { label: string; value: string }[];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-2xl max-w-md">
        <DialogHeader className="text-left">
          <DialogTitle className="text-[20px] font-semibold flex items-center gap-2">
            <CalendarCheck className="w-5 h-5" style={{ color: '#1f7a4d' }} /> Make it an event
          </DialogTitle>
          <DialogDescription className="text-[14px]" style={{ color: '#6d7075' }}>
            Everything on this quote goes with it. The team on it is told, and its day is held on the calendar.
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-xl p-4 space-y-2" style={{ background: '#f5f5f7' }}>
          {rows.map((row) => (
            <div key={row.label} className="flex justify-between gap-4 text-[14px]">
              <span style={{ color: '#6d7075' }}>{row.label}</span>
              <span className="font-medium text-right" style={{ color: '#16171a' }}>{row.value}</span>
            </div>
          ))}
        </div>
        <DialogFooter className="flex gap-2 sm:gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} className="flex-1 min-h-[44px] rounded-full text-[14px]">Cancel</Button>
          <Button onClick={handleConvert} disabled={converting} className="flex-[2] min-h-[44px] rounded-full text-[14px] font-semibold" style={{ background: '#16171a', color: '#fff' }}>
            {converting ? <Loader className="w-4 h-4 animate-spin" /> : 'Make the event'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
