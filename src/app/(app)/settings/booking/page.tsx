'use client';

// ─── /settings/booking ────────────────────────────────────────────────────────
// The face of two engines that already ran headless: resolveBookingPlan (what
// happens when someone books) and resolveDepositOutcome (what happens to their
// money when the visit falls apart). Both were fully policy-driven in code and
// editable only in the database until now.
//
// Every control names its consequence in plain language, because a booking
// rule the owner cannot predict is a rule they will not trust — and an owner
// who does not trust the rule turns the whole feature off.

import { doc, updateDoc, type Firestore } from 'firebase/firestore';
import {
  ArrowLeft, CalendarCheck, CreditCard, Loader, ShieldCheck, Sparkles, Timer, UserCheck,
} from 'lucide-react';
import Link from 'next/link';
import React, { useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useTenant } from '@/context/TenantContext';
import { useFirebase } from '@/firebase';
import { useToast } from '@/hooks/use-toast';
import {
  DEFAULT_BOOKING_MODE, resolveBookingMode, resolveDepositPolicy,
  type BookingMode, type DepositOutcome,
} from '@/lib/deposit-policy';
import { cn } from '@/lib/utils';

/* Each mode is described the way an owner decides between them: what the
 * CLIENT experiences, what YOU have to do, and when money moves. The old
 * copy described the mechanism; an owner choosing a setting needs the
 * consequence, and needs it before they tap rather than after. */
const MODES: {
  id: BookingMode; label: string; icon: any;
  clientSees: string; youDo: string; money: string; goodFor: string; watchOut?: string;
}[] = [
  {
    id: 'instant', label: 'They just book', icon: Sparkles,
    clientSees: 'They pick a time and it is theirs. Done in one tap.',
    youDo: 'Nothing. It appears on your calendar.',
    money: 'If the service has a deposit, they pay it now. If not, nothing is taken.',
    goodFor: 'Regulars, repeat services, anything you are happy to have booked without looking.',
  },
  {
    id: 'deposit_required', label: 'They pay to hold it', icon: CreditCard,
    clientSees: '"Your slot is held for 30 minutes" — it becomes a real booking once they pay.',
    youDo: 'Nothing. If they never pay, the time goes back on sale by itself.',
    money: 'The deposit is taken straight away. It comes off their total on the day.',
    goodFor: 'Long or expensive services where an empty chair really hurts.',
    watchOut: 'Services with no deposit set just confirm normally — this only bites where a deposit exists.',
  },
  {
    id: 'card_on_file', label: 'They leave a card', icon: ShieldCheck,
    clientSees: 'Booked immediately. They enter a card and are told plainly that nothing is charged today.',
    youDo: 'Nothing.',
    money: 'Nothing now. The card is only used if they no-show or cancel late — and only for the fee you set.',
    goodFor: 'When you want no friction at booking but you are tired of no-shows costing you.',
  },
  {
    id: 'approval', label: 'You say yes or no first', icon: UserCheck,
    clientSees: '"Request sent — this is not booked yet." They are told they will hear back.',
    youDo: 'You get a text and email straight away, and a Requests list with Accept and Decline.',
    money: 'Nothing at request time. If you accept and they have a card on file, the deposit charges itself.',
    goodFor: 'Consultations, new clients, big work you want to see a photo of first.',
    watchOut: 'Someone is holding their day open until you answer. Set an expiry below so your silence never costs them.',
  },
];

const OUTCOMES: { id: DepositOutcome; label: string; note: string }[] = [
  { id: 'refund', label: 'Refund', note: 'money goes back' },
  { id: 'rollover', label: 'Roll over', note: 'credit for next visit' },
  { id: 'forfeit', label: 'Keep', note: 'studio keeps it' },
];

export default function BookingSettingsPage() {
  const { firestore } = useFirebase();
  const { selectedTenant } = useTenant();
  const tenantId = selectedTenant?.id || '';
  const { toast } = useToast();

  const bm = useMemo(() => resolveBookingMode(selectedTenant), [selectedTenant]);
  const dp = useMemo(() => resolveDepositPolicy(selectedTenant), [selectedTenant]);
  const staffRole = String((selectedTenant as any)?.staffMember?.role || 'owner').toLowerCase();
  const isMgr = ['owner', 'admin'].includes(staffRole);
  const depositsLive = (selectedTenant as any)?.depositsLive === true;

  const [busy, setBusy] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const initial: Record<string, string> = {
    holdMinutes: String(bm.holdMinutes),
    approvalExpiryHours: String(bm.approvalExpiryHours),
    autoApproveAfterVisits: String(bm.autoApproveAfterVisits),
    refundWindowHours: String(dp.refundWindowHours),
    rolloverExpiryDays: dp.rolloverExpiryDays === null ? '0' : String(dp.rolloverExpiryDays),
  };
  const val = (k: string) => (draft[k] !== undefined ? draft[k] : initial[k]);

  const save = async (key: string, field: string, value: any, label: string) => {
    if (!firestore || !tenantId || !isMgr || busy) return;
    setBusy(key);
    try {
      await updateDoc(doc(firestore as Firestore, 'tenants', tenantId), { [field]: value });
      toast({ title: `${label} saved` });
    } catch (e: any) {
      toast({ variant: 'destructive', title: `Could not save ${label.toLowerCase()}`, description: e?.message });
    } finally { setBusy(null); }
  };

  const NumRow = ({ k, field, unit, label, note, zeroMeans, transform }: {
    k: string; field: string; unit: string; label: string; note: string; zeroMeans: string;
    transform?: (n: number) => any;
  }) => (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-black">{label}</p>
        <span className="flex items-center gap-1.5">
          <input inputMode="numeric" aria-label={label} value={val(k)} disabled={!isMgr}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDraft((d) => ({ ...d, [k]: e.target.value.replace(/[^0-9]/g, '') }))}
            className="h-9 w-20 rounded-xl border-2 bg-white px-2 text-center font-mono text-sm font-bold outline-none focus:border-foreground/60 disabled:opacity-50" />
          <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">{unit}</span>
          <Button size="sm" variant="outline" disabled={!isMgr || busy === k || val(k) === initial[k]}
            onClick={() => void save(k, field, transform ? transform(Number(val(k)) || 0) : Math.max(0, Number(val(k)) || 0), label)}
            className="h-9 rounded-xl border-2 px-2.5 font-black uppercase text-[8px] tracking-widest">
            {busy === k ? <Loader className="h-3 w-3 animate-spin" /> : 'Set'}
          </Button>
        </span>
      </div>
      <p className="text-[10px] font-bold text-muted-foreground leading-relaxed">
        {note} <span className="text-muted-foreground/70">0 = {zeroMeans}.</span>
      </p>
    </div>
  );

  const OutcomeRow = ({ field, label, current, note }: { field: string; label: string; current: DepositOutcome; note: string }) => (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-black">{label}</p>
        <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">{note}</p>
      </div>
      <div className="flex gap-1.5">
        {OUTCOMES.map((o) => (
          <button key={o.id} type="button" disabled={!isMgr || busy === field}
            onClick={() => void save(field, `depositPolicy.${field}`, o.id, label)}
            className={cn('flex-1 rounded-xl border-2 px-2 py-2 text-left transition-all disabled:opacity-60',
              current === o.id ? 'border-foreground bg-foreground text-background' : 'bg-white hover:border-primary/40')}>
            <span className="block text-[9px] font-black uppercase tracking-widest">{o.label}</span>
            <span className={cn('block text-[8px] font-bold', current === o.id ? 'opacity-70' : 'text-muted-foreground')}>{o.note}</span>
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <div className="min-h-dvh bg-muted/5 pb-24">
      <header className="sticky top-0 z-30 bg-white/90 backdrop-blur border-b-2">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center gap-3">
          <Button asChild variant="ghost" size="icon" className="h-10 w-10 rounded-xl">
            <Link href="/settings"><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <div className="flex-1 min-w-0">
            <h1 className="font-black uppercase tracking-tighter text-xl leading-none">Booking &amp; deposits</h1>
            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mt-0.5">
              What happens when someone books online{isMgr ? '' : ' · view only'}
            </p>
          </div>
          <CalendarCheck className="h-5 w-5 text-muted-foreground" />
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        <Card className="border-2 rounded-[2rem] bg-white">
          <CardContent className="p-5 space-y-3">
            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">How online bookings arrive</p>
            {MODES.map((m) => {
              const active = bm.mode === m.id;
              const Icon = m.icon;
              return (
                <button key={m.id} type="button" disabled={!isMgr || busy === 'mode'}
                  onClick={() => void save('mode', 'bookingMode.mode', m.id, 'Booking mode')}
                  className={cn('w-full rounded-2xl border-2 p-3.5 text-left transition-all disabled:opacity-60',
                    active ? 'border-foreground bg-foreground/[0.04]' : 'bg-white hover:border-primary/40')}>
                  <span className="flex items-start gap-3">
                    <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', active ? 'text-foreground' : 'text-muted-foreground')} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="text-sm font-black">{m.label}</span>
                        {active && <span className="rounded-full bg-foreground px-2 py-0.5 text-[8px] font-black uppercase tracking-widest text-background">On</span>}
                      </span>
                      <span className="mt-0.5 block text-[11px] font-bold leading-relaxed text-muted-foreground">
                        Good for {m.goodFor}
                      </span>

                      {/* The three questions an owner is actually weighing.
                          Only opened up on the SELECTED mode, so the list
                          stays scannable while you are choosing. */}
                      {active && (
                        <span className="mt-2.5 block space-y-1.5 rounded-2xl bg-background/60 p-3">
                          {([
                            ['They see', m.clientSees],
                            ['You do', m.youDo],
                            ['Money', m.money],
                          ] as [string, string][]).map(([k, v]) => (
                            <span key={k} className="block text-[11px] font-bold leading-relaxed">
                              <span className="mr-1.5 inline-block min-w-[52px] text-[9px] font-black uppercase tracking-widest text-muted-foreground">{k}</span>
                              {v}
                            </span>
                          ))}
                          {m.watchOut && (
                            <span className="block pt-1 text-[11px] font-bold leading-relaxed text-amber-700">
                              <span className="mr-1.5 inline-block min-w-[52px] text-[9px] font-black uppercase tracking-widest">Note</span>
                              {m.watchOut}
                            </span>
                          )}
                        </span>
                      )}
                    </span>
                  </span>
                </button>
              );
            })}
            {/* Card on file is orthogonal to the mode — "book instantly but we
                keep a card" is a real and common house rule, and it had no
                control at all until now. Hidden when the dedicated mode is
                selected, because there it is already implied. */}
            {bm.mode !== 'card_on_file' && (
              <div className="flex items-start justify-between gap-3 rounded-2xl border-2 border-dashed p-3.5">
                <div className="min-w-0">
                  <p className="text-sm font-black">Also keep a card on file</p>
                  <p className="mt-0.5 text-[11px] font-bold leading-relaxed text-muted-foreground">
                    Whatever you picked above, ask for a card too. Nothing extra is charged at booking — it is there so a
                    no-show or a late cancellation is not free. Individual services can require one even if you leave this off.
                  </p>
                </div>
                <button type="button" role="switch" aria-checked={bm.requireCardOnFile} aria-label="Require a card on file"
                  disabled={!isMgr || busy === 'card'}
                  onClick={() => void save('card', 'bookingMode.requireCardOnFile', !bm.requireCardOnFile, 'Card on file')}
                  className={cn('relative h-7 w-12 shrink-0 rounded-full border-2 transition-all disabled:opacity-40',
                    bm.requireCardOnFile ? 'border-green-600 bg-green-500/20' : 'border-muted-foreground/30 bg-muted/40')}>
                  <span className={cn('absolute top-0.5 h-5 w-5 rounded-full transition-all',
                    bm.requireCardOnFile ? 'right-0.5 bg-green-600' : 'left-0.5 bg-muted-foreground/50')} />
                </button>
              </div>
            )}

            {!depositsLive && (
              <p className="rounded-xl border-2 border-amber-300 bg-amber-50 px-3 py-2 text-[10px] font-bold leading-relaxed text-amber-800">
                Deposits are currently switched off shop-wide, so no money is collected in any mode. Turn them on in payment settings when you are ready.
              </p>
            )}
            <p className="text-[10px] font-bold leading-relaxed text-muted-foreground">
              Individual services can override this, and a client marked trusted always books instantly — except when their own no-show history says otherwise.
            </p>
          </CardContent>
        </Card>

        <Card className="border-2 rounded-[2rem] bg-white">
          <CardContent className="p-5 space-y-4">
            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">What happens when</p>
            <NumRow k="holdMinutes" field="bookingMode.holdMinutes" unit="min" label="Someone starts paying and wanders off"
              note="We keep the slot for them this long, then put it back on sale so nobody else is blocked out."
              zeroMeans="the slot is never held" />
            {bm.mode === 'approval' && (
              <>
                <NumRow k="approvalExpiryHours" field="bookingMode.approvalExpiryHours" unit="hours" label="You do not answer a request"
                  note="After this long it declines itself, the time goes back on sale, and the client is told rather than left waiting."
                  zeroMeans="it waits forever, and so do they" />
                <NumRow k="autoApproveAfterVisits" field="bookingMode.autoApproveAfterVisits" unit="visits" label="A proven regular requests a time"
                  note="Once someone has this many completed visits and a clean record, their requests skip you entirely and just book."
                  zeroMeans="everyone waits for you, every time" />
              </>
            )}
            {bm.mode !== 'approval' && (
              <p className="rounded-xl border-2 border-dashed px-3 py-2 text-[10px] font-bold leading-relaxed text-muted-foreground">
                Request expiry and auto-accepting regulars only apply when you are approving each booking. Switch to
                &ldquo;You say yes or no first&rdquo; above and they appear here.
              </p>
            )}
          </CardContent>
        </Card>

        {/* The deposit-outcome rules (early cancel / late cancel / no-show /
            studio cancel, the refund window and rollover expiry) deliberately
            live in main Settings only. They were briefly duplicated here, and
            two screens editing one policy means whichever you touched last is
            the one you trust. */}
        <Card className="border-2 rounded-[2rem] bg-white">
          <CardContent className="p-5 space-y-2">
            <p className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-muted-foreground">
              <Timer className="h-3 w-3" /> When plans change
            </p>
            <p className="text-[11px] font-bold leading-relaxed text-muted-foreground">
              What happens to a deposit on an early cancel, a late cancel, a no-show, or a cancellation of your own —
              plus the notice window and how long rolled-over credit lasts — is set in Studio Settings, alongside your
              cancellation fee.
            </p>
            <Button asChild variant="outline"
              className="h-10 rounded-2xl border-2 font-black uppercase text-[9px] tracking-widest">
              <Link href="/settings">Open Studio Settings</Link>
            </Button>
          </CardContent>
        </Card>

        <p className="px-2 text-[10px] font-bold leading-relaxed text-muted-foreground">
          Deposit amounts themselves live on each service — flat, percentage, your product cost, or the full price. This page decides
          when they are asked for and what happens to them afterwards.
        </p>
      </main>
    </div>
  );
}
