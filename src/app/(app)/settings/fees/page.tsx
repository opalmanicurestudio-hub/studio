'use client';

// ─── /settings/fees ───────────────────────────────────────────────────────────
// Cancellation, no-show, and reschedule fees — set against the number that
// actually matters, which is what the slot costs you.
//
// The design decision that shapes this whole screen: a fee is meaningless in
// isolation. "$25 late-cancel fee" tells the owner nothing; "$25 against a
// $90 floor — you are $65 down on every late cancellation" tells them
// everything. So the breakeven calculator sits at the top and every fee below
// is scored against it live.

import { doc, updateDoc, type Firestore } from 'firebase/firestore';
import { AlertTriangle, ArrowLeft, CalendarX, Check, Clock, Loader, Percent } from 'lucide-react';
import Link from 'next/link';
import React, { useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useTenant } from '@/context/TenantContext';
import { useFirebase } from '@/firebase';
import { useToast } from '@/hooks/use-toast';
import {
  computeBreakeven, resolveFeePolicy, resolveShopEconomics, settleFee, type FeeEvent,
} from '@/lib/service-economics';
import { cn } from '@/lib/utils';

const EVENTS: { id: FeeEvent; label: string; icon: any; when: string; note: string }[] = [
  {
    id: 'late_cancel', label: 'Late cancellation', icon: CalendarX,
    when: 'They cancel inside the notice window.',
    note: 'The slot is usually unfillable at this point, which is what the fee is for.',
  },
  {
    id: 'no_show', label: 'No-show', icon: AlertTriangle,
    when: 'They never arrive and never called.',
    note: 'No notice at all — the slot was lost outright.',
  },
  {
    id: 'reschedule', label: 'Late reschedule', icon: Clock,
    when: 'They move the appointment at short notice, more times than you allow free.',
    note: 'A first move is usually goodwill. The fourth move in a week is a habit.',
  },
];

export default function FeeSettingsPage() {
  const { firestore } = useFirebase();
  const { selectedTenant } = useTenant();
  const tenantId = selectedTenant?.id || '';
  const { toast } = useToast();

  const staffRole = String((selectedTenant as any)?.staffMember?.role || 'owner').toLowerCase();
  const isMgr = ['owner', 'admin'].includes(staffRole);
  const econ = useMemo(() => resolveShopEconomics(selectedTenant), [selectedTenant]);

  const [busy, setBusy] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  // The example booking every fee is scored against.
  const [examplePrice, setExamplePrice] = useState('200');
  const [exampleMins, setExampleMins] = useState('120');
  const [exampleProducts, setExampleProducts] = useState('12');

  const val = (k: string, fallback: string) => (draft[k] !== undefined ? draft[k] : fallback);
  const num = (v: string) => Number(String(v).replace(/[^0-9.]/g, '')) || 0;

  const save = async (key: string, field: string, value: any, label: string) => {
    if (!firestore || !tenantId || !isMgr || busy) return;
    setBusy(key);
    try {
      await updateDoc(doc(firestore as Firestore, 'tenants', tenantId), { [field]: value });
      toast({ title: `${label} saved` });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Could not save', description: e?.message });
    } finally { setBusy(null); }
  };

  const priceCents = Math.round(num(examplePrice) * 100);
  /* FULL breakeven, not chair time alone — the same function the deposit
   * engine uses, so a "breakeven deposit" and the number a fee is scored
   * against are guaranteed to be the same figure. */
  const be = useMemo(() => computeBreakeven({
    tenant: selectedTenant,
    service: { cost: num(exampleProducts), duration: num(exampleMins), price: num(examplePrice) },
  }), [selectedTenant, exampleProducts, exampleMins, examplePrice]);
  const breakevenCents = be.totalCents;

  const Money = ({ c }: { c: number }) => <>${(c / 100).toFixed(2)}</>;

  return (
    <div className="min-h-dvh bg-muted/5 pb-24">
      <header className="sticky top-0 z-30 bg-white/90 backdrop-blur border-b-2">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center gap-3">
          <Button asChild variant="ghost" size="icon" className="h-10 w-10 rounded-xl">
            <Link href="/settings"><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <div className="flex-1 min-w-0">
            <h1 className="font-black uppercase tracking-tighter text-xl leading-none">Fees &amp; profitability</h1>
            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mt-0.5">
              What a lost slot costs, and what you charge for it{isMgr ? '' : ' · view only'}
            </p>
          </div>
          <Percent className="h-5 w-5 text-muted-foreground" />
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        {/* ── The floor ─────────────────────────────────────────────────── */}
        <Card className="border-2 rounded-[2rem] bg-white">
          <CardContent className="p-5 space-y-3">
            <div>
              <p className="text-sm font-black">What an hour of your time costs</p>
              <p className="mt-1 text-[11px] font-bold leading-relaxed text-muted-foreground">
                Rent, power, insurance, software and everything else that runs whether or not somebody sits down,
                divided by the hours you can actually sell. Every fee below is judged against it. Most shops have never
                worked this out, and it is almost always larger than the products.
              </p>
            </div>

            {/* The floor is NOT re-entered here. Foundation already computes
                TMHR from your bills; typing it twice would guarantee the two
                screens eventually disagree. */}
            <div className="flex items-center justify-between gap-2 rounded-2xl border-2 border-dashed px-3 py-2.5">
              <div className="min-w-0">
                <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">
                  {econ.floorSource === 'override' ? 'Override in use'
                    : econ.floorSource === 'tmhr' ? 'From Foundation (TMHR)'
                      : 'Not calculated yet'}
                </p>
                <p className="text-2xl font-black leading-tight">
                  {econ.hourlyFloorCents > 0 ? <><Money c={econ.hourlyFloorCents} /><span className="text-[10px] font-bold text-muted-foreground">/hr</span></> : '—'}
                </p>
              </div>
              <Button asChild variant="outline" size="sm"
                className="h-9 shrink-0 rounded-xl border-2 px-3 font-black uppercase text-[9px] tracking-widest">
                <Link href="/financials">{econ.hourlyFloorCents > 0 ? 'Adjust in Foundation' : 'Set it up'}</Link>
              </Button>
            </div>
            {econ.floorSource === 'unset' && (
              <p className="rounded-xl border-2 border-amber-300 bg-amber-50 px-3 py-2 text-[10px] font-bold leading-relaxed text-amber-800">
                Your True Minimum Hourly Rate has not been calculated. Enter your lifestyle and overhead bills in
                Foundation and it works itself out — until then, breakeven deposits collect product cost only, and the
                fee checks below have nothing to measure against.
              </p>
            )}
            {econ.floorSource === 'override' && (
              <p className="rounded-xl border-2 border-dashed px-3 py-2 text-[10px] font-bold leading-relaxed text-muted-foreground">
                Fees are being judged against a manual override rather than your TMHR. That is deliberate for shops that
                recover overhead only — but service pricing still uses TMHR, so the two numbers differ on purpose.
              </p>
            )}

            <div className="flex items-start justify-between gap-3 border-t-2 border-dashed pt-3">
              <div className="min-w-0">
                <p className="text-sm font-black">Include staff pay</p>
                <p className="mt-0.5 text-[10px] font-bold leading-relaxed text-muted-foreground">
                  Turn on only if you pay for the hour whether or not the client shows. Pure commission staff earn
                  nothing on a no-show, so including it would overstate your loss.
                </p>
              </div>
              <button type="button" role="switch" aria-checked={econ.includeLabour} aria-label="Include staff pay"
                disabled={!isMgr || busy === 'labour'}
                onClick={() => void save('labour', 'economics.includeLabour', !econ.includeLabour, 'Labour setting')}
                className={cn('relative h-6 w-11 shrink-0 rounded-full border-2 transition-all disabled:opacity-40',
                  econ.includeLabour ? 'border-green-600 bg-green-500/20' : 'border-muted-foreground/30 bg-muted/40')}>
                <span className={cn('absolute top-0.5 h-4 w-4 rounded-full transition-all',
                  econ.includeLabour ? 'right-0.5 bg-green-600' : 'left-0.5 bg-muted-foreground/50')} />
              </button>
            </div>
          </CardContent>
        </Card>

        {/* ── The example everything is scored against ───────────────────── */}
        <Card className="border-2 rounded-[2rem] bg-foreground text-background">
          <CardContent className="p-4 space-y-2">
            <p className="text-[9px] font-black uppercase tracking-widest opacity-70">Score my fees against</p>
            <div className="flex flex-wrap items-center gap-2 text-sm font-bold">
              <span>a $</span>
              <input inputMode="decimal" aria-label="Example service price" value={examplePrice}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setExamplePrice(e.target.value)}
                className="h-9 w-20 rounded-xl border-2 border-background/30 bg-transparent px-2 text-center font-mono outline-none" />
              <span>service taking</span>
              <input inputMode="numeric" aria-label="Example duration in minutes" value={exampleMins}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setExampleMins(e.target.value)}
                className="h-9 w-16 rounded-xl border-2 border-background/30 bg-transparent px-2 text-center font-mono outline-none" />
              <span>minutes, using $</span>
              <input inputMode="decimal" aria-label="Example product cost" value={exampleProducts}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setExampleProducts(e.target.value)}
                className="h-9 w-16 rounded-xl border-2 border-background/30 bg-transparent px-2 text-center font-mono outline-none" />
              <span>of product</span>
            </div>
            <p className="text-[11px] font-bold opacity-80">
              {econ.hourlyFloorCents > 0
                ? <>That slot costs you <strong><Money c={breakevenCents} /></strong> — <Money c={be.productCents} /> in
                  products plus <Money c={be.timeCents} /> for {be.minutes} minutes at your hourly floor
                  {be.labourCents > 0 ? <>, plus <Money c={be.labourCents} /> in labour</> : null}.</>
                : <>Calculate your TMHR in Foundation and this will show what the slot costs you.</>}
            </p>
          </CardContent>
        </Card>

        {/* ── The fees ──────────────────────────────────────────────────── */}
        {EVENTS.map((ev) => {
          const p = resolveFeePolicy(selectedTenant, ev.id);
          const Icon = ev.icon;
          const preview = settleFee({
            tenant: selectedTenant, event: ev.id, priceCents,
            depositHeldCents: 0, depositForfeited: false,
            priorRescheduleCount: 99, hoursUntilAppointment: 0,
            breakevenCents,
          });
          return (
            <Card key={ev.id} className="border-2 rounded-[2rem] bg-white">
              <CardContent className="p-5 space-y-3">
                <div>
                  <p className="flex items-center gap-1.5 text-sm font-black"><Icon className="h-3.5 w-3.5" /> {ev.label}</p>
                  <p className="mt-0.5 text-[11px] font-bold leading-relaxed text-muted-foreground">{ev.when} {ev.note}</p>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  {[
                    { k: `${ev.id}-pct`, field: `feePolicy.${ev.id}.pct`, label: '% of price', value: String(p.pct), unit: '%', mult: 1 },
                    { k: `${ev.id}-flat`, field: `feePolicy.${ev.id}.flatCents`, label: 'plus flat', value: (p.flatCents / 100).toFixed(2), unit: '$', mult: 100 },
                    { k: `${ev.id}-cap`, field: `feePolicy.${ev.id}.capCents`, label: 'never above', value: (p.capCents / 100).toFixed(2), unit: '$', mult: 100 },
                    { k: `${ev.id}-window`, field: `feePolicy.${ev.id}.windowHours`, label: 'applies inside', value: String(p.windowHours), unit: 'hrs', mult: 1 },
                    ...(ev.id === 'reschedule'
                      ? [{ k: `${ev.id}-free`, field: `feePolicy.${ev.id}.freeCount`, label: 'free moves first', value: String(p.freeCount), unit: '×', mult: 1 }]
                      : []),
                  ].map((f) => (
                    <div key={f.k} className="space-y-1">
                      <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">{f.label}</p>
                      <span className="flex items-center gap-1">
                        <input inputMode="decimal" aria-label={`${ev.label} ${f.label}`}
                          value={val(f.k, f.value)}
                          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDraft((d) => ({ ...d, [f.k]: e.target.value.replace(/[^0-9.]/g, '') }))}
                          disabled={!isMgr}
                          className="h-9 w-full rounded-xl border-2 bg-white px-2 text-center font-mono text-sm font-bold outline-none focus:border-foreground/60" />
                        <span className="text-[9px] font-black text-muted-foreground">{f.unit}</span>
                        <Button size="sm" variant="outline" disabled={!isMgr || busy === f.k || val(f.k, f.value) === f.value}
                          onClick={() => void save(f.k, f.field, Math.round(num(val(f.k, f.value)) * f.mult), ev.label)}
                          className="h-9 rounded-xl border-2 px-2 font-black uppercase text-[8px] tracking-widest">
                          <Check className="h-3 w-3" />
                        </Button>
                      </span>
                    </div>
                  ))}
                </div>

                {/* Live verdict — the whole point of the screen. */}
                <div className={cn('rounded-2xl border-2 px-3 py-2',
                  preview.waived ? 'border-dashed'
                    : preview.belowBreakeven ? 'border-amber-300 bg-amber-50'
                      : 'border-green-300 bg-green-50')}>
                  {preview.waived ? (
                    <p className="text-[11px] font-bold leading-relaxed text-muted-foreground">
                      No fee configured — this situation currently costs you the full slot.
                    </p>
                  ) : (
                    <p className={cn('text-[11px] font-bold leading-relaxed',
                      preview.belowBreakeven ? 'text-amber-800' : 'text-green-800')}>
                      On that example you would charge <strong><Money c={preview.feeCents} /></strong>
                      {econ.hourlyFloorCents > 0 && (
                        preview.belowBreakeven
                          ? <> — still <strong><Money c={preview.breakevenGapCents} /></strong> short of what the slot costs you.</>
                          : <> — that clears the <Money c={breakevenCents} /> the slot costs you.</>
                      )}
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}

        <p className="px-2 text-[10px] font-bold leading-relaxed text-muted-foreground">
          A deposit already held is applied first; anything still owed is charged to the card on file, and recorded as a
          balance when there is no card or the card declines. Retail restocking fees are separate and live under Retail
          Orders → Policies.
        </p>
      </main>
    </div>
  );
}
