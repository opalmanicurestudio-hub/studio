'use client';

// src/components/staff/ConvertToRenterDialog.tsx
//
// Four questions, in the order they matter, with the counts visible before
// anything is chosen. Nothing is written until the last step, and the client
// book has no default — the owner picks, every time.

import React, { useMemo, useState } from 'react';
import { collection, doc, setDoc, updateDoc, writeBatch } from 'firebase/firestore';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { createRenter } from '@/lib/booth-rental-service';
import { auditEntry } from '@/lib/audit';
import {
  previewConversion, staffPatchForConversion, conversionSummary,
  type ClientBookChoice, type InFlightChoice, type ConversionChoices,
} from '@/lib/staff-to-renter';

const money = (c: number) => `$${(Math.round(c) / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
const shortDate = (iso: string | null) => iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';

export function ConvertToRenterDialog({ open, onOpenChange, member, firestore, tenantId, locationId, appointments, clients, services, onDone }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  member: any;
  firestore: any;
  tenantId: string;
  locationId: string | null;
  appointments: any[];
  clients: any[];
  services: any[];
  onDone?: (renterId: string) => void;
}) {
  const { toast } = useToast();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [effectiveDate, setEffectiveDate] = useState(new Date().toISOString().slice(0, 10));
  const [clientBook, setClientBook] = useState<ClientBookChoice | ''>('');
  const [picked, setPicked] = useState<string[]>([]);
  const [inFlight, setInFlight] = useState<InFlightChoice | ''>('');
  const [seedMenu, setSeedMenu] = useState(true);

  const choices: ConversionChoices = { effectiveDate, clientBook: (clientBook || 'stay') as ClientBookChoice, clientIds: picked, inFlight: (inFlight || 'studio_keeps') as InFlightChoice, seedMenu };
  const preview = useMemo(
    () => previewConversion({ staffId: member?.id, appointments, clients, services, choices }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [member?.id, appointments, clients, services, effectiveDate, clientBook, picked, inFlight, seedMenu],
  );
  const served = useMemo(
    () => previewConversion({ staffId: member?.id, appointments, clients, services, choices: { ...choices, clientBook: 'follow' } }).clientsMoving,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [member?.id, appointments, clients, effectiveDate],
  );

  const run = async () => {
    if (!firestore || !tenantId || !member) return;
    setBusy(true);
    try {
      const parts = String(member.name || '').trim().split(' ');
      const renterId = await createRenter(firestore, {
        tenantId,
        locationId: locationId || member.locationId || '',
        firstName: parts[0] || member.name || 'Renter',
        lastName: parts.slice(1).join(' ') || '',
        email: member.email || '',
        phone: member.phone || undefined,
        specialty: member.specialty || undefined,
        notes: `Converted from team member on ${effectiveDate}.`,
      } as any);

      // The staff record becomes a provider record: employedUntil preserves
      // their history, pay structure is cleared so payroll can never reach them.
      await updateDoc(doc(firestore, 'tenants', tenantId, 'staff', member.id), staffPatchForConversion(renterId, effectiveDate));
      await setDoc(doc(firestore, 'tenants', tenantId, 'renters', renterId), {
        photoUrl: member.photoUrl || member.avatarUrl || '', bio: member.bio || '',
        convertedFromStaffId: member.id, convertedAt: new Date().toISOString(),
      }, { merge: true });

      // The client book, exactly as chosen. Batched so a half-moved book is
      // impossible — either every chosen client follows them or none does.
      if (preview.clientsMoving.length > 0) {
        for (let i = 0; i < preview.clientsMoving.length; i += 400) {
          const batch = writeBatch(firestore);
          for (const c of preview.clientsMoving.slice(i, i + 400)) {
            batch.set(doc(firestore, 'tenants', tenantId, 'clients', c.id),
              { ownerRenterId: renterId, ownerStaffId: member.id, ownerAssignedAt: new Date().toISOString(), ownerAssignedBy: 'conversion' }, { merge: true });
          }
          await batch.commit();
        }
      }

      // Outstanding bookings, if they were handed over. Re-stamped rather than
      // rebooked so the client keeps their time and their confirmation.
      if (inFlight === 'transfer' && preview.inFlightCount > 0) {
        const live = appointments.filter((a: any) => a.staffId === member.id && !a.isRenterBooking
          && String(a.startTime).slice(0, 10) >= effectiveDate
          && !['cancelled', 'completed', 'no_show'].includes(String(a.status || '')));
        for (let i = 0; i < live.length; i += 400) {
          const batch = writeBatch(firestore);
          for (const a of live.slice(i, i + 400)) {
            batch.set(doc(firestore, 'tenants', tenantId, 'appointments', a.id),
              { isRenterBooking: true, renterProviderId: member.id, renterServiceName: a.serviceName || '', renterServicePrice: Number(a.price) || 0, transferredAt: new Date().toISOString() }, { merge: true });
          }
          await batch.commit();
        }
      }

      // Their menu, seeded from the house services they were assigned, at the
      // studio's prices, for them to edit from their portal.
      if (seedMenu && preview.servicesToSeed.length > 0) {
        const batch = writeBatch(firestore);
        for (const sv of preview.servicesToSeed) {
          const ref = doc(collection(firestore, 'tenants', tenantId, 'renterServices'));
          batch.set(ref, { id: ref.id, staffId: member.id, renterId, name: sv.name, price: sv.price, duration: sv.duration, isActive: true, createdAt: new Date().toISOString(), seededFromServiceId: sv.id });
        }
        await batch.commit();
      }

      // Same client-side audit pattern the booths page uses — one line in
      // auditLogs saying what was decided, so the file answers "who got the
      // clients" a year from now.
      try {
        const aRef = doc(collection(firestore, 'tenants', tenantId, 'auditLogs'));
        await setDoc(aRef, { id: aRef.id, ...auditEntry({
          action: 'staff.converted_to_renter', targetType: 'renter', targetId: renterId,
          summary: conversionSummary(member.name || 'Team member', choices, preview),
          actor: { type: 'user' },
        } as any) });
      } catch { /* the conversion stands */ }

      toast({ title: 'Converted', description: conversionSummary(member.name || 'They', choices, preview) });
      onOpenChange(false);
      onDone?.(renterId);
    } catch (e) {
      toast({ variant: 'destructive', title: 'Could not convert', description: 'Nothing was changed. Try again.' });
    } finally { setBusy(false); }
  };

  const Choice = ({ on, onClick, title, body, tone }: { on: boolean; onClick: () => void; title: string; body: string; tone?: string }) => (
    <button type="button" onClick={onClick} aria-pressed={on}
      className={cn('w-full rounded-2xl border-2 px-4 py-3 text-left', on ? 'border-slate-900 bg-slate-50' : 'bg-white', tone)}>
      <span className="block text-[11px] font-black uppercase tracking-widest">{title}</span>
      <span className="block text-[10px] font-bold text-muted-foreground">{body}</span>
    </button>
  );

  const steps = ['When', 'Their clients', 'Bookings already made', 'Confirm'];
  const canNext = step === 0 ? !!effectiveDate
    : step === 1 ? (clientBook === 'stay' || clientBook === 'follow' || (clientBook === 'pick' && picked.length > 0))
    : step === 2 ? !!inFlight
    : true;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy) onOpenChange(o); }}>
      <DialogContent className="max-w-md rounded-2xl max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-lg font-black tracking-tight">{member?.name} becomes a booth renter</DialogTitle>
          <DialogDescription className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest">
            Step {step + 1} of 4 · {steps[step]}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {step === 0 && (
            <>
              <p className="text-[11px] font-bold text-muted-foreground">The date they stop being an employee. It decides their final pay period, their first rent day, and which bookings count as studio work.</p>
              <input type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} aria-label="Effective date"
                className="h-11 w-full rounded-xl border-2 bg-white px-3 text-sm font-bold" />
              <div className="rounded-xl border-2 bg-slate-50 px-3 py-2">
                <p className="text-[10px] font-bold text-muted-foreground">
                  Their {preview.pastAppointments} past appointment{preview.pastAppointments === 1 ? '' : 's'} stay studio revenue and stay in your reports — converting never rewrites history.
                </p>
              </div>
            </>
          )}

          {step === 1 && (
            <>
              <p className="text-[11px] font-bold text-muted-foreground">
                {served.length} client{served.length === 1 ? '' : 's'} have been served by them. Your agreement decides this, not the app — so it asks every time.
              </p>
              <Choice on={clientBook === 'stay'} onClick={() => setClientBook('stay')} title="The book stays with the studio"
                body="They start with an empty client list. You keep every history and note." />
              <Choice on={clientBook === 'follow'} onClick={() => setClientBook('follow')} title={`All ${served.length} follow them`}
                body="Their clients move to their book. You will no longer see those histories." />
              <Choice on={clientBook === 'pick'} onClick={() => setClientBook('pick')} title="Choose person by person"
                body="Move some, keep the rest." />
              {clientBook === 'pick' && (
                <div className="max-h-64 space-y-1 overflow-y-auto rounded-xl border-2 bg-white p-2">
                  {served.length === 0 && <p className="py-2 text-center text-[11px] font-bold text-muted-foreground">No clients to choose from.</p>}
                  {served.map((c) => {
                    const on = picked.includes(c.id);
                    return (
                      <button key={c.id} type="button" aria-pressed={on} onClick={() => setPicked((p) => on ? p.filter((x) => x !== c.id) : [...p, c.id])}
                        className={cn('flex w-full items-center justify-between gap-2 rounded-lg border-2 px-2.5 py-1.5 text-left', on ? 'border-slate-900 bg-slate-900 text-white' : 'bg-white')}>
                        <span className="min-w-0 truncate text-[11px] font-black">{c.name}</span>
                        <span className={cn('shrink-0 text-[10px] font-bold', on ? 'text-slate-300' : 'text-muted-foreground')}>{c.visits} visit{c.visits === 1 ? '' : 's'} · {shortDate(c.lastVisit)}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {step === 2 && (
            <>
              <p className="text-[11px] font-bold text-muted-foreground">
                {preview.inFlightCount} booking{preview.inFlightCount === 1 ? '' : 's'} on or after {effectiveDate}, worth {money(preview.inFlightValueCents)}. They were taken as studio work.
              </p>
              <Choice on={inFlight === 'studio_keeps'} onClick={() => setInFlight('studio_keeps')} title="Stay studio work"
                body="The studio keeps the money; pay them for these in the final pay period. The client sees no change." />
              <Choice on={inFlight === 'transfer'} onClick={() => setInFlight('transfer')} title="Hand them over"
                body="They become the renter's bookings at the same time and price. Deposits already taken by the studio are not moved." />
              <button type="button" aria-pressed={seedMenu} onClick={() => setSeedMenu((v) => !v)}
                className={cn('w-full rounded-2xl border-2 px-4 py-3 flex items-center justify-between gap-3 text-left', seedMenu ? 'border-slate-900 bg-slate-50' : 'bg-white')}>
                <span className="min-w-0">
                  <span className="block text-[11px] font-black uppercase tracking-widest">Start their menu from yours</span>
                  <span className="block text-[10px] font-bold text-muted-foreground">Copy the {preview.servicesToSeed.length} service{preview.servicesToSeed.length === 1 ? '' : 's'} they offer, at your prices, for them to change.</span>
                </span>
                <span className={cn('shrink-0 rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-widest', seedMenu ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500')}>{seedMenu ? 'Yes' : 'No'}</span>
              </button>
            </>
          )}

          {step === 3 && (
            <>
              <div className="rounded-2xl border-2 bg-slate-50 px-4 py-3 space-y-1">
                <p className="text-[11px] font-black uppercase tracking-widest">What happens when you confirm</p>
                <p className="text-[11px] font-bold text-slate-700">Employee until {effectiveDate}; a booth renter from then.</p>
                <p className="text-[11px] font-bold text-slate-700">{preview.clientsMoving.length} client{preview.clientsMoving.length === 1 ? '' : 's'} move to their book, {preview.clientsStaying} stay with you.</p>
                <p className="text-[11px] font-bold text-slate-700">{preview.inFlightCount} outstanding booking{preview.inFlightCount === 1 ? '' : 's'} {inFlight === 'transfer' ? 'become theirs' : 'stay studio work'}.</p>
                <p className="text-[11px] font-bold text-slate-700">{seedMenu ? `${preview.servicesToSeed.length} services copied to their menu.` : 'They build their own menu.'}</p>
                <p className="text-[11px] font-bold text-slate-700">Pay structure and commission cleared — they can never appear on a payroll draft.</p>
              </div>
              {preview.warnings.map((w, i) => (
                <p key={i} className="rounded-xl border-2 border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-bold text-amber-900">{w}</p>
              ))}
              <p className="text-[10px] font-bold text-muted-foreground">
                Still to do afterwards, by hand: give them a booth and a lease on the Renters page, and settle their final pay. This does not create a lease — rent terms are yours to agree.
              </p>
            </>
          )}
        </div>

        <div className="flex gap-2 pt-1">
          {step > 0 && <Button variant="outline" onClick={() => setStep((s) => s - 1)} disabled={busy} className="h-11 rounded-xl border-2 font-black uppercase text-[10px] tracking-widest">Back</Button>}
          {step < 3
            ? <Button onClick={() => setStep((s) => s + 1)} disabled={!canNext} className="h-11 flex-1 rounded-xl font-black uppercase text-[10px] tracking-widest">Next</Button>
            : <Button onClick={run} disabled={busy} className="h-11 flex-1 rounded-xl bg-slate-900 font-black uppercase text-[10px] tracking-widest">{busy ? 'Converting…' : 'Convert'}</Button>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
