'use client';
// src/components/appointments/RequestDecisionPanel.tsx
//
// A BOOKING WAITING ON YOUR YES — answered here, the same way everywhere.
//
// Shown at the top of the appointment sheet (planner and POS) whenever a
// booking is awaiting approval. Accept / Decline go through the one shared
// path (approveBooking / denyBooking in src/lib/booking-approval.ts): the same
// server decision the Requests page and the planner cards use, then the
// completion link to the client and a heads-up to the team member. Because
// every screen reads live data, the sheet, the timeline card, the planner's
// "awaiting you" count and the Requests list all change the moment it's done.

import { useState } from 'react';
import { Check, X, Loader, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { approveBooking, denyBooking, holdReasonLabel } from '@/lib/booking-approval';

export function RequestDecisionPanel({ appointment, firestore, tenantId, actorUid, actorName, studioName }: {
  appointment: any; firestore: any; tenantId: string; actorUid?: string | null; actorName?: string | null; studioName?: string | null;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState<'' | 'accept' | 'decline'>('');
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState('');

  const depositCents = Number(appointment?.depositAmountCents) || 0;
  const depositPaid = appointment?.depositStatus === 'paid';
  const expires = appointment?.requestExpiresAt ? new Date(appointment.requestExpiresAt) : null;
  const left = expires ? Math.max(0, expires.getTime() - Date.now()) : null;
  const leftLabel = left === null ? null : left <= 0 ? 'past its expiry' : `${Math.floor(left / 3600000)}h ${Math.floor((left % 3600000) / 60000)}m left to answer`;

  const run = async (kind: 'accept' | 'decline', outcome?: 'alternative' | 'final') => {
    setBusy(kind);
    try {
      const res = kind === 'accept'
        ? await approveBooking(firestore, tenantId, appointment, actorUid, studioName, actorName)
        : await denyBooking(firestore, tenantId, appointment, actorUid, actorName, outcome || 'alternative', reason);
      if (!res.ok) {
        toast({ variant: 'destructive', title: res.alreadyStatus ? 'Already answered' : 'Not recorded', description: res.reason });
        return;
      }
      toast(res.chargeFailed
        ? { variant: 'destructive', title: 'Accepted — card declined', description: res.message }
        : { title: kind === 'accept' ? 'Accepted' : 'Declined', description: res.message });
      setDeclining(false); setReason('');
    } finally { setBusy(''); }
  };

  return (
    <div className="glass space-y-3 rounded-3xl p-4 shadow-[0_10px_30px_-14px_rgba(217,119,6,0.45)]" role="region" aria-label="Waiting on your answer">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-amber-100 text-amber-800"><Clock className="h-5 w-5" /></div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-black text-slate-900">Waiting on your answer</p>
          <p className="text-xs font-medium text-slate-600">{holdReasonLabel(appointment) || 'This booking needs a yes before it’s confirmed.'}{leftLabel ? ` · ${leftLabel}` : ''}</p>
          {depositCents > 0 && (
            <p className="mt-1 text-xs font-medium text-slate-600">
              ${(depositCents / 100).toFixed(2)} deposit — {depositPaid ? 'already paid.' : 'not charged yet. Accepting charges their card on file, or sends them a link to pay.'}
            </p>
          )}
        </div>
      </div>

      {!declining ? (
        <div className="flex gap-2">
          <Button disabled={!!busy} onClick={() => run('accept')} className="h-12 flex-1 rounded-2xl text-[11px] font-black uppercase tracking-widest">
            {busy === 'accept' ? <Loader className="h-4 w-4 animate-spin" /> : <><Check className="mr-1.5 h-4 w-4" />Accept</>}
          </Button>
          <Button variant="outline" disabled={!!busy} onClick={() => setDeclining(true)} className="h-12 rounded-2xl border-2 px-5 text-[11px] font-black uppercase tracking-widest">
            <X className="mr-1.5 h-4 w-4" />Decline
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          <textarea value={reason} onChange={(e) => setReason(e.target.value.slice(0, 300))} rows={2} placeholder="A note for them (optional)"
            className="w-full rounded-2xl border-2 border-slate-200 bg-white/70 px-3 py-2 text-sm" />
          <Button disabled={!!busy} onClick={() => run('decline', 'alternative')} className="h-11 w-full rounded-2xl text-[11px] font-black uppercase tracking-widest">
            {busy === 'decline' ? <Loader className="h-4 w-4 animate-spin" /> : 'Decline — invite another time'}
          </Button>
          <Button variant="outline" disabled={!!busy} onClick={() => run('decline', 'final')} className="h-11 w-full rounded-2xl border-2 border-red-200 text-[11px] font-black uppercase tracking-widest text-red-700">
            Not taking this booking
          </Button>
          <button type="button" onClick={() => { setDeclining(false); setReason(''); }} className="w-full text-center text-[11px] font-bold text-slate-500 underline">Back</button>
        </div>
      )}
    </div>
  );
}
