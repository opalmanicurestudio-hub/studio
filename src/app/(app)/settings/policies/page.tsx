'use client';
// src/app/(app)/settings/policies/page.tsx — BOOKING POLICIES, ONE PLACE.
//
// Three questions: What does the client owe? When can they book or change it?
// What do they receive? Every value is the business's own setting (saved as
// it's changed, managers only), read through the one policy engine
// (src/lib/booking-policies.ts) — the same one booking, the desk, cancel and
// reschedule and every email use. The preview shows exactly what clients read.

import Link from 'next/link';
import React, { useEffect, useMemo, useState } from 'react';
import { doc, updateDoc, type Firestore } from 'firebase/firestore';
import { useTenant } from '@/context/TenantContext';
import { useFirebase } from '@/firebase';
import { useToast } from '@/hooks/use-toast';
import { useInventory } from '@/context/InventoryContext';
import { resolvePolicy, sourceLabel, type Source } from '@/lib/booking-policies';
import { bookingPolicyLines } from '@/lib/policy-copy';
import { moduleEnabled } from '@/lib/modules';

const NEXT = 'starts next update';

type CtxT = { save: (field: string, value: any, label: string) => void; isMgr: boolean; busy: string | null };
const Ctx = React.createContext<CtxT>({ save: () => {}, isMgr: false, busy: null });

const Badge = ({ s }: { s: Source }) => <span className={`ml-2 rounded-full px-2 py-0.5 text-[10px] font-semibold ${s === 'default' ? 'bg-secondary text-muted-foreground' : 'bg-primary/10 text-primary'}`}>{sourceLabel(s)}</span>;
const Soon = () => <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">{NEXT}</span>;
const Row = ({ label, note, children, source, soon }: { label: string; note?: string; children: React.ReactNode; source?: Source; soon?: boolean }) => (
  <div className="space-y-1.5 border-t py-4 first:border-t-0 first:pt-0">
    <p className="text-sm font-semibold">{label}{source && <Badge s={source} />}{soon && <Soon />}</p>
    {note && <p className="text-xs text-muted-foreground">{note}</p>}
    <div className="flex flex-wrap items-center gap-2">{children}</div>
  </div>
);
const Choice = ({ field, value, options, label }: { field: string; value: any; options: [any, string][]; label: string }) => { const { save, isMgr, busy } = React.useContext(Ctx); return (
  <div className="flex flex-wrap gap-1.5">{options.map(([v, l]) => (
    <button key={String(v)} type="button" disabled={!isMgr || busy === field} onClick={() => save(field, v, label)} aria-pressed={value === v}
      className={`rounded-full border px-3.5 py-1.5 text-sm transition disabled:opacity-60 ${value === v ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-muted/40'}`}>{l}</button>))}</div>
); };
const Num = ({ field, value, unit, label, min = 0, max = 100000, step = 1 }: { field: string; value: number; unit: string; label: string; min?: number; max?: number; step?: number }) => {
  const { save, isMgr } = React.useContext(Ctx);
  const [v, setV] = useState(String(value ?? '')); useEffect(() => setV(String(value ?? '')), [value]);
  return <label className="flex items-center gap-2 text-sm"><input type="number" inputMode="decimal" min={min} max={max} step={step} value={v} disabled={!isMgr} onChange={(e) => setV(e.target.value)}
    onBlur={() => { const n = Math.min(max, Math.max(min, Number(v) || 0)); if (n !== Number(value)) save(field, n, label); }} className="h-10 w-28 rounded-xl border px-3" /><span className="text-muted-foreground">{unit}</span></label>;
};
const Text = ({ field, value, label, placeholder }: { field: string; value: string; label: string; placeholder: string }) => {
  const { save, isMgr } = React.useContext(Ctx);
  const [v, setV] = useState(value || ''); useEffect(() => setV(value || ''), [value]);
  return <textarea value={v} disabled={!isMgr} placeholder={placeholder} rows={3} onChange={(e) => setV(e.target.value)} onBlur={() => { if ((v || '') !== (value || '')) save(field, v.trim(), label); }} className="w-full rounded-xl border p-3 text-sm" />;
};
const Section = ({ n, q, children }: { n: number; q: string; children: React.ReactNode }) => (
  <section className="rounded-3xl border bg-card p-5"><p className="mb-3 text-lg font-semibold"><span className="mr-2 inline-flex h-7 w-7 items-center justify-center rounded-full bg-secondary text-sm">{n}</span>{q}</p>{children}</section>
);


export default function BookingPoliciesPage() {
  const { selectedTenant, role } = useTenant() as any;
  const { firestore, user } = useFirebase() as any;
  const { toast } = useToast();
  const { services } = useInventory() as any;
  const t: any = selectedTenant || {};
  const tenantId = t.id;
  const isMgr = ['owner', 'admin', 'manager'].includes(String(role || '').toLowerCase()) || (!!t.userId && t.userId === user?.uid);
  const P = useMemo(() => resolvePolicy(t), [t]);
  const dp = P.deposit.outcomes;
  const [busy, setBusy] = useState<string | null>(null);

  const save = async (field: string, value: any, label: string) => {
    if (!firestore || !tenantId || !isMgr) return;
    setBusy(field);
    try { await updateDoc(doc(firestore as Firestore, 'tenants', tenantId), { [field]: value }); toast({ title: `${label} saved` }); }
    catch (e: any) { toast({ variant: 'destructive', title: `Couldn’t save ${label.toLowerCase()}`, description: e?.message }); }
    finally { setBusy(null); }
  };

  const depositServices = (services || []).filter((s: any) => s.isActive !== false && resolvePolicy(t, s).deposit.required.value);
  const overrides = (services || []).filter((s: any) => s.isActive !== false && (Number(s.cancellationWindowHours) > 0 || (s.cancellationFeeMode && s.cancellationFeeMode !== 'inherit')));
  const preview = bookingPolicyLines(t, null, { depositCents: 2000 });
  const renters = moduleEnabled(t, 'booth_rental');

  return (
    <Ctx.Provider value={{ save, isMgr, busy }}>
    <div className="mx-auto max-w-6xl px-4 py-6">
      <Link href="/settings" className="text-sm text-muted-foreground underline underline-offset-2">← Settings</Link>
      <h1 className="mt-2 text-3xl font-light tracking-tight">Booking <b className="font-semibold">policies</b></h1>
      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">Your rules for deposits, changes and cancellations — used by online booking, the front desk and every message clients get. A badge shows where each rule comes from.</p>
      {!isMgr && <p className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">Only a manager or the owner can change these.</p>}

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-6">
          <Section n={1} q="What does the client owe?">
            <Row label="Deposits" note="Set on each service. These services take one:">
              {depositServices.length ? depositServices.map((s: any) => <span key={s.id} className="rounded-full bg-secondary px-3 py-1 text-xs">{s.name} · {resolvePolicy(t, s).deposit.kind.value === 'percent' ? `${s.depositAmount}%` : resolvePolicy(t, s).deposit.kind.value === 'full' ? 'full price' : resolvePolicy(t, s).deposit.kind.value === 'breakeven' ? 'costs covered' : `$${Number(s.depositAmount).toFixed(2)}`}</span>)
                : <span className="text-sm text-muted-foreground">None yet.</span>}
              <Link href="/services" className="text-sm underline underline-offset-2">Edit on services →</Link>
            </Row>
            <Row label="If they cancel with enough notice, their deposit…" note={`“Enough notice” for deposits is ${dp.refundWindowHours} hours.`} source="business">
              <Choice field="depositPolicy.onEarlyCancel" value={dp.onEarlyCancel} label="Early cancel" options={[['rollover', 'Becomes credit'], ['refund', 'Is refunded'], ['forfeit', 'Is kept']]} />
              <Num field="depositPolicy.refundWindowHours" value={dp.refundWindowHours} unit="hours = enough notice" label="Deposit notice" max={720} />
            </Row>
            <Row label="Credit from a deposit lasts">
              <Num field="depositPolicy.rolloverExpiryDays" value={dp.rolloverExpiryDays ?? 0} unit="days (0 = never expires)" label="Credit expiry" max={3650} />
            </Row>
            <Row label="Late cancellation" note="Inside your cancellation window." source={P.cancel.lateConsequence.source}>
              <Choice field="bookingPolicies.lateCancelConsequence" value={P.cancel.lateConsequence.value} label="Late cancellation" options={[['both', 'Fee — the deposit counts toward it'], ['fee', 'Fee only — deposit becomes credit'], ['deposit', 'Keep the deposit, no fee']]} />
            </Row>
            <Row label="Cancellation window" note="Cancelling inside this is a late cancellation." source={P.cancel.windowHours.source}>
              <Num field="cancellationWindowHours" value={P.cancel.windowHours.value} unit="hours before" label="Cancellation window" max={720} />
            </Row>
            <Row label="Late-cancellation fee" source={P.cancel.feeMode.source}>
              <Choice field="defaultCancellationMode" value={P.cancel.feeMode.value} label="Cancellation fee type" options={[['flat', 'A set amount'], ['percentage', '% of the service'], ['matrix', 'Your costs (time + materials)']]} />
              {P.cancel.feeMode.value === 'flat' && <Num field="cancellationFee" value={P.cancel.feeValue.value} unit="dollars" label="Cancellation fee" step={0.5} />}
              {overrides.length > 0 && <p className="w-full text-xs text-muted-foreground">Different on: {overrides.map((s: any) => s.name).join(', ')}.</p>}
            </Row>
            <Row label="No-show" source={P.noShow.feeMode.source}>
              <Choice field="noShowFeeMode" value={P.noShow.feeMode.value} label="No-show fee" options={[['full_service', 'The full service price'], ['flat', 'A set amount'], ['matrix', 'Your costs'], ['none', 'No fee']]} />
              {P.noShow.feeMode.value === 'flat' && <Num field="flatNoShowFee" value={P.noShow.flatFee.value} unit="dollars" label="No-show fee" step={0.5} />}
              <span className="w-full text-xs text-muted-foreground">Their deposit on a no-show:</span>
              <Choice field="depositPolicy.onNoShow" value={dp.onNoShow} label="No-show deposit" options={[['forfeit', 'Is kept'], ['rollover', 'Becomes credit'], ['refund', 'Is refunded']]} />
            </Row>
            <Row label="When you cancel on them, their deposit…" source="business">
              <Choice field="depositPolicy.onStudioCancel" value={dp.onStudioCancel} label="Studio cancel" options={[['refund', 'Is refunded'], ['rollover', 'Becomes credit']]} />
            </Row>
          </Section>

          <Section n={2} q="When can they book or change it?">
            <Row label="How far ahead clients can book" note="Members can be given a longer window — or earlier access to the next month." source={P.access.publicDays.source}>
              <Choice field="bookingRelease.mode" value={t.bookingRelease?.mode || 'off'} label="Booking window" options={[['off', 'No limit'], ['rolling', 'A rolling window'], ['monthly', 'Next month opens on a set day']]} />
              {t.bookingRelease?.mode === 'rolling' && <>
                <Num field="bookingRelease.horizonDays" value={t.bookingRelease?.horizonDays ?? 30} unit="days — everyone" label="Booking window" max={365} />
                <Num field="bookingRelease.memberHorizonDays" value={t.bookingRelease?.memberHorizonDays ?? 60} unit="days — members" label="Member booking window" max={365} /></>}
              {t.bookingRelease?.mode === 'monthly' && <>
                <span className="w-full text-xs text-muted-foreground">Next month opens to everyone on day</span>
                <Num field="bookingRelease.releaseDay" value={t.bookingRelease?.releaseDay ?? 25} unit="of the month, at" label="Release day" min={1} max={28} />
                <Num field="bookingRelease.releaseHour" value={t.bookingRelease?.releaseHour ?? 9} unit=":00" label="Release hour" max={23} />
                <span className="w-full text-xs text-muted-foreground">Members get it early — on day</span>
                <Num field="bookingRelease.memberReleaseDay" value={t.bookingRelease?.memberReleaseDay ?? 20} unit="at" label="Member release day" min={1} max={28} />
                <Num field="bookingRelease.memberReleaseHour" value={t.bookingRelease?.memberReleaseHour ?? 9} unit=":00" label="Member release hour" max={23} /></>}
            </Row>
            <Row label="Minimum notice to book online" source={P.access.minNoticeMinutes.source}>
              <Num field="bookingLeadHours" value={Math.round(P.access.minNoticeMinutes.value / 60)} unit="hours" label="Minimum notice" max={336} />
            </Row>
            <Row label="Upcoming bookings one client can hold" source={P.access.maxUpcoming.source}>
              <Num field="bookingPolicies.maxUpcomingBookings" value={P.access.maxUpcoming.value} unit="(0 = no limit)" label="Upcoming bookings" max={50} />
            </Row>
            <Row label="Rescheduling fee" note="Moving a booking inside this window carries the fee." source={P.change.fee.source}>
              <Num field="rescheduleFee" value={P.change.fee.value} unit="dollars" label="Reschedule fee" step={0.5} />
              <Num field="rescheduleFeeWindowHours" value={P.change.feeWindowHours.value} unit="hours before" label="Reschedule fee window" max={720} />
            </Row>
            <Row label="No changes by the client inside" source={P.change.cutoffHours.source}>
              <Num field="bookingPolicies.changeCutoffHours" value={P.change.cutoffHours.value} unit="hours (0 = any time)" label="Change cutoff" max={336} />
            </Row>
            <Row label="Changes allowed" source={P.change.limit.source}>
              <Num field="bookingPolicies.rescheduleLimit" value={P.change.limit.value} unit="times (0 = unlimited), then…" label="Reschedule limit" max={20} />
              <Choice field="bookingPolicies.overLimit" value={P.change.overLimit.value} label="After the limit" options={[['approval', 'They ask us from their link'], ['block', 'No more changes online']]} />
            </Row>
            <Row label="When they move a booking, the notice deadline…" source={P.change.deadline.source}>
              <Choice field="bookingPolicies.rescheduleDeadline" value={P.change.deadline.value} label="Reschedule deadline" options={[['original', 'Stays with the original time'], ['new', 'Moves to the new time']]} />
            </Row>
            <Row label="Running late" source={P.late.graceMinutes.source}>
              <Num field="lateArrivalGracePeriod" value={P.late.graceMinutes.value} unit="minutes grace" label="Grace period" max={120} />
              <Num field="lateArrivalFee" value={P.late.fee.value} unit="dollars late fee after that" label="Late fee" step={0.5} />
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={!isMgr} checked={!!P.late.autoCancel.value} onChange={(e) => save('autoCancelLateArrivals', e.target.checked, 'Late arrivals')} /> Suggest rescheduling past the grace period</label>
            </Row>
            <Row label="Holding unpaid bookings" source={P.holds.holdMinutes.source}>
              <Num field="bookingMode.holdMinutes" value={P.holds.holdMinutes.value} unit="minutes while paying online" label="Hold time" max={1440} />
              <Num field="bookingMode.paymentGraceHours" value={P.holds.paymentGraceHours.value} unit="hours when a card fails / a link is sent" label="Payment grace" max={168} />
            </Row>
          </Section>

          <Section n={3} q="What do they receive, and when?">
            <Row label="Your cancellation policy, in your words" note="Shown on your booking page and in messages. Leave blank to use the wording built from your settings.">
              <Text field="cancellationPolicy" value={t.cancellationPolicy} label="Cancellation policy" placeholder="e.g. We ask for 24 hours’ notice…" />
            </Row>
            <Row label="Late arrivals, in your words"><Text field="lateArrivalPolicy" value={t.lateArrivalPolicy} label="Late arrival policy" placeholder="e.g. After 15 minutes we may need to shorten your service…" /></Row>
            <Row label="Missed appointments, in your words"><Text field="noShowPolicy" value={t.noShowPolicy} label="No-show policy" placeholder="e.g. Missed appointments are charged…" /></Row>
            <Row label="Who can decide" note="When a client is running late, a provider is behind, or a payment is due. Owners, admins and managers can always decide; fees and provider changes stay with them.">
              <Choice field="bookingPolicies.staffOpsLevel" value={t.bookingPolicies?.staffOpsLevel || 'decide_own'} label="Who can decide" options={[['decide_own', 'Staff decide for their own clients'], ['recommend', 'Staff can offer a reschedule only'], ['view', 'Staff view only']]} />
            </Row>
            <Row label="Online check-in" note="Clients can tap “I’m here” on their visit link. Off: they check in at the front desk (running late and “on my way” still work).">
              <Choice field="bookingPolicies.onlineCheckIn" value={t.bookingPolicies?.onlineCheckIn !== false} label="Online check-in" options={[[true, 'On'], [false, 'Off — front desk only']]} />
            </Row>
            <Row label="Messages and automations">
              <Link href="/settings/messages" className="text-sm underline underline-offset-2">Message wording & timing →</Link>
              <Link href="/settings/automations" className="text-sm underline underline-offset-2">Everything that runs automatically →</Link>
            </Row>
          </Section>

          {renters && <Section n={4} q="Renters using your front desk">
            <Row label="Front-desk support for renters" soon source={P.renterDesk.billing.source}>
              <Choice field="bookingPolicies.renterDeskSupport.billing" value={P.renterDesk.billing.value} label="Renter desk support" options={[['included', 'Included with rent'], ['per_booking', 'Per booking'], ['monthly', 'Monthly']]} />
              {P.renterDesk.billing.value !== 'included' && <Num field="bookingPolicies.renterDeskSupport.amount" value={P.renterDesk.amount.value} unit={P.renterDesk.billing.value === 'monthly' ? 'dollars a month' : 'dollars a booking'} label="Desk support fee" step={0.5} />}
            </Row>
          </Section>}
        </div>

        <aside className="lg:sticky lg:top-4 lg:self-start">
          <div className="rounded-3xl border bg-secondary/60 p-5">
            <p className="text-sm font-semibold">What clients see</p>
            <p className="mb-3 text-xs text-muted-foreground">With a $20 deposit, on confirmations and your booking page — updates as you change things.</p>
            <ul className="space-y-2 text-sm">{preview.map((l) => <li key={l} className="rounded-xl bg-card p-3">{l}</li>)}</ul>
          </div>
        </aside>
      </div>
    </div>
    </Ctx.Provider>
  );
}
