"use client";

/**
 * GuestsToday — the desk's day and hourly guests: check in and out, the balance on a booking with a deposit (charged to
 * the saved card, or taken in person), refunds (all or part, more than once), prepaid days given back, credits for
 * unused time, extra time, other charges and moving a booking. Lives beside the desk panel that sells them.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { collection, doc, getDocs, query, where, updateDoc, setDoc, addDoc, deleteDoc, writeBatch, runTransaction } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { useLocation } from '@/context/LocationContext';
import { cn } from '@/lib/utils';
import { auditEntry } from '@/lib/audit';
import { FileText, FileSignature, MoreHorizontal, Phone } from 'lucide-react';
import { resolveIncidentalPolicy } from '@/lib/incidentals';
import { contactKey as boothContactKey } from '@/lib/booth-contacts';
import { buildGuestBook } from '@/lib/guest-book';
import { PRINT, esc, printPage } from '@/lib/print-style';
import { PrintLink, openPrint } from '@/components/shared/PrintLink';
import { settleStay, stayClock, deskZone } from '@/lib/stay-settle';

type OverflowItem = { label: string; onClick: () => void; danger?: boolean; disabled?: boolean };


// ── Duplicated from the booth hub (byte-for-byte; no cross-route imports) ──
const writeBoothAudit = (firestore: any, tenantId: string, e: any) => {
  try {
    const aRef = doc(collection(firestore, 'tenants', tenantId, 'auditLogs'));
    setDoc(aRef, { id: aRef.id, ...auditEntry(e) }).catch(() => {});
  } catch { /* non-fatal */ }
};

const localISO = (d: Date = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f7', GREEN = '#1f7a4d', AMBER = '#b45309', RED = '#b42318';
const BTN = 'min-h-[44px] rounded-full px-4 text-[14px] font-semibold transition active:scale-[.99] disabled:opacity-40 inline-flex items-center justify-center gap-1.5';
const BTN_DARK = `${BTN} bg-[#16171a] text-white`;
const BTN_LINE = `${BTN} bg-white border border-[#ececee] text-[#16171a] font-medium`;
const BTN_RED = `${BTN} bg-[#b42318] text-white`;
const FIELD = 'min-h-[44px] w-full rounded-xl border border-[#ececee] bg-white px-3 text-[15px] text-[#16171a]';
const usd = (c: number) => `$${(Math.max(0, c) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const hm = (t: any) => { const m = /^(\d{2}):(\d{2})/.exec(String(t || '')); if (!m) return String(t || ''); const h = Number(m[1]); return `${h % 12 || 12}${m[2] === '00' ? '' : `:${m[2]}`}${h < 12 ? 'am' : 'pm'}`; };
const shortDay = (iso: any) => { const s = String(iso || '').slice(0, 10); const d = new Date(`${s}T12:00:00Z`); return isNaN(d.getTime()) ? s : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }); };
/** Statuses where a booking is being called off and is waiting on its refund (or its prepaid days). */
const CALLING_OFF = ['cancel_requested', 'cancelled_refund_pending', 'payment_received_conflict'];

function ZoneLabel({ children }: { children: any }) {
  return (
    <div className="flex items-center gap-3 pt-3">
      <p className="text-[13px] font-medium shrink-0" style={{ color: MUTED }}>{children}</p>
      <div className="h-px flex-1" style={{ background: LINE }} />
    </div>
  );
}

function OverflowMenu({ items, align = 'right', label = 'More' }: { items: OverflowItem[]; align?: 'left' | 'right'; label?: string }) {
  const [open, setOpen] = useState(false);
  const usable = items.filter(Boolean);
  if (usable.length === 0) return null;
  return (
    <div className="relative shrink-0">
      <button
        type="button"
        aria-label={label}
        onClick={(e) => { e.stopPropagation(); setOpen(o => !o); }}
        aria-haspopup="menu" aria-expanded={open}
        className="h-11 w-11 rounded-full border border-[#ececee] bg-white flex items-center justify-center text-[#6d7075] hover:bg-[#f5f5f7] active:scale-95 transition"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={(e) => { e.stopPropagation(); setOpen(false); }} />
          <div role="menu" className={`absolute z-50 mt-1 min-w-[14rem] rounded-2xl border border-[#ececee] bg-white shadow-xl p-1.5 ${align === 'right' ? 'right-0' : 'left-0'}`}>
            {usable.map((it, i) => (
              <button
                key={i}
                type="button" role="menuitem"
                disabled={it.disabled}
                onClick={(e) => { e.stopPropagation(); setOpen(false); it.onClick(); }}
                className={`w-full text-left px-3 min-h-[44px] rounded-xl text-[14px] transition disabled:opacity-40 ${it.danger ? 'text-[#b42318] hover:bg-[#fff7ed]' : 'text-[#16171a] hover:bg-[#f5f5f7]'}`}
              >{it.label}</button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export function GuestsToday({ tenantId, firestore, reservations, boothById, tenant, renters, leases, applications, renterById, contactByKey }: {
  tenantId: string; firestore: any; reservations: any[]; boothById: Map<string, any>; tenant?: any;
  renters?: any[]; leases: { data?: any[] | null }; applications: any[]; renterById: Map<string, any>; contactByKey: Map<string, any>;
}) {
  const { toast } = useToast();
  const { selectedLocationId } = useLocation();
  const [reschedRes, setReschedRes] = useState<any>(null);
  const [reschedDate, setReschedDate] = useState('');
  const [reschedStartTime, setReschedStartTime] = useState('');
  const [reschedEndTime, setReschedEndTime] = useState('');
  const [reschedSaving, setReschedSaving] = useState(false);
  // The business's own charge types and caps, the same list the server checks a charge against (lib/incidentals).
  const incidentalPolicy: any[] = useMemo(() => resolveIncidentalPolicy(tenant), [tenant]);
  const [refundFor, setRefundFor] = useState<string | null>(null);
  const [refundAmt, setRefundAmt] = useState('');
  const [refundWhy, setRefundWhy] = useState('');
  const [refundingId, setRefundingId] = useState<string | null>(null);
  const [balanceBusyId, setBalanceBusyId] = useState<string | null>(null);
  const [chargingId, setChargingId] = useState<string | null>(null);
  const [incidentalForId, setIncidentalForId] = useState<string | null>(null);
  const [incidentalAmt, setIncidentalAmt] = useState('');
  const [incidentalDesc, setIncidentalDesc] = useState('');
  const [incidentalCat, setIncidentalCat] = useState('');
  const [incidentalBusyId, setIncidentalBusyId] = useState<string | null>(null);
  const incidentalTry = React.useRef('');
  // One person, one row — the merge itself lives in src/lib/guest-book.ts so
  // this component, the hub and the pipeline all answer "who is this?" the
  // same way. It used to be an 80-line memo copied into each of them.
  const guestBook = useMemo(() => buildGuestBook({
    reservations,
    applications,
    leases: leases.data || [],
    renterById,
    contactByKey,
  }), [reservations, applications, leases.data, renterById, contactByKey]);
  const tierByContact = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of guestBook) m.set(g.key, g.tier);
    return m;
  }, [guestBook]);
  const tierFor = useCallback((r: any): string => {
    if (r.guestTier === 'resident' || r.renterId) return 'resident';
    const key = String(r.phone || '').trim().toLowerCase() || String(r.email || '').trim().toLowerCase();
    return (key && tierByContact.get(key)) || r.guestTier || 'new';
  }, [tierByContact]);
  const TIER_BADGE: Record<string, { label: string; cls: string }> = {
    resident: { label: 'Renter', cls: 'bg-[#f5f5f7] text-[#16171a]' },
    regular: { label: 'Regular', cls: 'bg-[#ecf6f0] text-[#1f7a4d]' },
    returning: { label: 'Returning', cls: 'bg-[#f5f5f7] text-[#6d7075]' },
  };
  const hourlyCentsOf = (boothId: string): number => {
    const b = boothById.get(boothId) as any;
    const opts = Array.isArray(b?.pricingOptions) ? b.pricingOptions : [];
    return opts.find((o: any) => o.frequency === 'hourly' && o.amountCents > 0)?.amountCents || 0;
  };
const upcomingReservations = useMemo(() => {
    const today = localISO();
    return reservations
      // Today's and coming guests, anything still to settle (extra time, a credit, a cancellation), and a stay that
      // ended today with its balance still to take.
      .filter(r => ((['confirmed', 'checked_in', 'payment_received_conflict', 'cancelled_refund_pending'].includes(r.status)) && r.endDate >= today || r.overageStatus === 'due' || r.creditDecision === 'pending' || r.status === 'cancel_requested'
          || (r.status === 'completed' && r.endDate >= today && Number(r.balanceDueCents) > 0 && r.balancePaid !== true))
        && (!r.locationId || r.locationId === selectedLocationId))
      .sort((a, b) => (a.startDate || '').localeCompare(b.startDate || ''));
  }, [reservations, selectedLocationId]);

const setResStatus = async (r: any, status: string) => {
    try {
      // Saying no to a cancellation request clears it, so the guest's page no longer says they asked.
      await updateDoc(doc(firestore, 'tenants', tenantId, 'boothReservations', r.id),
        { status, [`${status}At`]: new Date().toISOString(), ...(status === 'confirmed' && r.status === 'cancel_requested' ? { cancelRequestedAt: null } : {}) });
      if (['cancelled_refund_pending', 'refunded', 'cancelled'].includes(status)) {
        writeBoothAudit(firestore, tenantId, {
          action: 'booth.reservation_' + status, targetType: 'boothReservation', targetId: r.id,
          summary: `Reservation ${status.replace(/_/g, ' ')}: ${r.name || 'guest'} · ${r.boothName || 'space'}`,
          amount: (r.amountCents || 0) / 100, actor: { type: 'user' },
        });
      }
    } catch {
      toast({ variant: 'destructive', title: 'Update failed', description: 'The reservation was not changed — try again.' });
    }
  };

const checkInRes = async (r: any) => {
    try {
      await updateDoc(doc(firestore, 'tenants', tenantId, 'boothReservations', r.id), {
        status: 'checked_in',
        checked_inAt: new Date().toISOString(),
        actualCheckIn: new Date().toISOString(),
        // v73 — snapshot the rate NOW so checkout settles at the rate in
        // force during the stay, not whatever the booth costs later.
        settleHourlyCents: hourlyCentsOf(r.boothId) || r.settleHourlyCents || 0,
      });
    } catch {
      toast({ variant: 'destructive', title: 'Check-in failed', description: 'Nothing was saved — try again.' });
    }
  };

const checkOutRes = async (r: any) => {
    // What the stay comes to, on the business's clock and the space's overtime rules (lib/stay-settle). Settled at the
    // rate snapshotted at check-in (the current rate only for stays that predate the snapshot).
    const updates: any = settleStay(r, { now: new Date(), timeZone: stayClock(tenant, deskZone()), hourlyCents: r.settleHourlyCents > 0 ? r.settleHourlyCents : hourlyCentsOf(r.boothId), space: boothById.get(r.boothId) });
    try {
      await updateDoc(doc(firestore, 'tenants', tenantId, 'boothReservations', r.id), updates);
    } catch {
      toast({ variant: 'destructive', title: 'Check-out failed', description: 'Nothing was saved — try again.' });
    }
  };

const issueCredit = async (r: any) => {
    const contactKey = (r.phone || r.email || '').trim();
    if (!contactKey || !(r.potentialCreditCents > 0)) return;
    if (r.creditDecision !== 'pending') return;
    try {
      const batch = writeBatch(firestore);
      const credRef = doc(collection(firestore, 'tenants', tenantId, 'boothCredits'));
      batch.set(credRef, {
        id: credRef.id, contactKey, phone: r.phone || null, email: r.email || null,
        name: r.name || '', amountCents: r.potentialCreditCents, minutes: r.unusedMinutes || 0,
        sourceReservationId: r.id, sourceBoothName: r.boothName || '',
        status: 'available', createdAt: new Date().toISOString(),
      });
      batch.update(doc(firestore, 'tenants', tenantId, 'boothReservations', r.id),
        { creditDecision: 'issued', creditIssuedCents: r.potentialCreditCents, creditIssuedAt: new Date().toISOString() });
      const aRef = doc(collection(firestore, 'tenants', tenantId, 'auditLogs'));
      batch.set(aRef, { id: aRef.id, ...auditEntry({
        action: 'booth.credit_issued', targetType: 'boothCredit', targetId: credRef.id,
        summary: `Credit issued to ${r.name || 'guest'} for unused time (${r.unusedMinutes || 0} min) · ${r.boothName || 'space'}`,
        amount: r.potentialCreditCents / 100, actor: { type: 'user' },
      }) });
      await batch.commit();
      toast({ title: 'Credit issued', description: `$${(r.potentialCreditCents / 100).toFixed(2)} will auto-apply to ${r.name}'s next booking.` });
    } catch {
      toast({ variant: 'destructive', title: 'Credit failed', description: 'Nothing was issued — try again.' });
    }
  };

const declineCredit = async (r: any) => {
    try {
      await updateDoc(doc(firestore, 'tenants', tenantId, 'boothReservations', r.id),
        { creditDecision: 'declined' });
      writeBoothAudit(firestore, tenantId, {
        action: 'booth.credit_declined', targetType: 'boothReservation', targetId: r.id,
        summary: `Unused-time credit declined for ${r.name || 'guest'} ($${((r.potentialCreditCents || 0) / 100).toFixed(2)})`,
        amount: (r.potentialCreditCents || 0) / 100, actor: { type: 'user' },
      });
    } catch {
      toast({ variant: 'destructive', title: 'Update failed', description: 'Try again.' });
    }
  };

// A refund: all of what's left, or part of it (the amount typed), with a reason the guest is told. On a booking being
// called off it closes it, and what isn't refunded is kept as a fee; on one that stands, it stands (api/booths/reserve).
const openRefund = (r: any) => {
    const left = Math.max(0, (Number(r.amountCents) || 0) - (Number(r.refundedCents) || 0));
    setRefundFor(refundFor === r.id ? null : r.id); setRefundAmt(left > 0 ? (left / 100).toFixed(2) : ''); setRefundWhy('');
  };

const sendRefund = async (r: any) => {
    if (refundingId) return;
    const cents = Math.round(parseFloat(refundAmt) * 100);
    if (!(cents > 0)) { toast({ variant: 'destructive', title: 'Enter an amount', description: 'Type how much to refund.' }); return; }
    setRefundingId(r.id);
    try {
      const res = await fetch('/api/booths/reserve', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, reservationId: r.id, amountCents: cents, reason: refundWhy.trim() || null }),
      });
      const d = await res.json();
      if (d.ok) {
        toast({ title: 'Refunded', description: `${usd(d.refundedCents || 0)} is going back to ${r.name || 'the guest'}’s card${d.alreadyRefunded ? ' (it had already gone through)' : d.closed ? '. The booking is called off.' : '. The booking stands.'}` });
        setRefundFor(null);
      } else toast({ variant: 'destructive', title: 'The refund didn’t go through', description: d.error || 'Try again.' });
    } catch {
      toast({ variant: 'destructive', title: 'No answer', description: 'The refund may or may not have gone through. Try again in a couple of minutes: it won’t refund twice.' });
    } finally { setRefundingId(null); }
  };

// Called off with nothing to refund to a card (paid at the desk and handed back there, or already refunded in full).
const callOff = async (r: any) => {
    if (refundingId) return;
    setRefundingId(r.id);
    try {
      const res = await fetch('/api/booths/reserve', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'call-off', tenantId, reservationId: r.id }),
      });
      const d = await res.json();
      if (d.ok) toast(d.already ? { title: 'Already called off', description: 'Nothing more to do.' } : { title: 'Called off', description: `${r.name || 'The guest'}’s booking is called off.` });
      else toast({ variant: 'destructive', title: 'Not called off', description: d.error || 'Try again.' });
    } catch {
      toast({ variant: 'destructive', title: 'No answer', description: 'Nothing was changed. Try again.' });
    } finally { setRefundingId(null); }
  };

// A booking paid with prepaid days is called off by giving the days back to the guest's pack (no money moved).
const giveDaysBack = async (r: any) => {
    if (refundingId) return;
    setRefundingId(r.id);
    try {
      const res = await fetch('/api/booths/reserve', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, reservationId: r.id }),
      });
      const d = await res.json();
      if (d.ok) toast({ title: 'Called off', description: d.packMissing ? 'Their pack wasn’t found, so no days could go back to it.' : `${d.daysReturned} prepaid day${d.daysReturned === 1 ? ' is' : 's are'} back on ${r.name || 'the guest'}’s pack.` });
      else toast({ variant: 'destructive', title: 'Not called off', description: d.error || 'Try again.' });
    } catch {
      toast({ variant: 'destructive', title: 'No answer', description: 'Nothing was changed. Try again.' });
    } finally { setRefundingId(null); }
  };

// The balance on a booking with a deposit, from the saved card (api/booths/reserve, recorded once on the server).
const chargeBalanceToCard = async (r: any) => {
    if (balanceBusyId) return;
    setBalanceBusyId(r.id);
    try {
      const res = await fetch('/api/booths/reserve', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'balance', tenantId, reservationId: r.id }),
      });
      const d = await res.json();
      if (d.ok) toast(d.already ? { title: 'Already paid', description: 'This balance was already recorded.' } : { title: 'Balance paid', description: `${usd(d.chargedCents || 0)} taken from the saved card. ${r.name || 'The guest'} gets a receipt.` });
      else toast({ variant: 'destructive', title: 'The card wasn’t charged', description: d.error || 'Take the balance in person instead.' });
    } catch {
      toast({ variant: 'destructive', title: 'No answer', description: 'The charge may or may not have gone through. Try again in a couple of minutes: it won’t charge twice.' });
    } finally { setBalanceBusyId(null); }
  };

// The balance taken in person: its line in the books and the booking marked paid, in one step and once (a card charge
// going through at the same moment, or a second tap, finds it done).
const markBalancePaid = async (r: any) => {
    if (balanceBusyId) return;
    setBalanceBusyId(r.id);
    const nowIso = new Date().toISOString();
    try {
      const resRef = doc(firestore, 'tenants', tenantId, 'boothReservations', r.id);
      const txnRef = doc(firestore, 'tenants', tenantId, 'transactions', `boothbal_${String(r.id).replace(/[^A-Za-z0-9_-]/g, '')}`);
      const aRef = doc(collection(firestore, 'tenants', tenantId, 'auditLogs'));
      const out = await runTransaction(firestore, async (tx) => {
        const cur: any = (await tx.get(resRef)).data() || {};
        const due = Math.round(Number(cur.balanceDueCents) || 0);
        if (cur.balancePaid === true || !(due > 0)) return { done: true };
        if (!['confirmed', 'checked_in', 'completed'].includes(String(cur.status || ''))) return { closed: true };
        if (cur.balanceStatus === 'charging') return { charging: true };
        tx.set(txnRef, {
          id: txnRef.id, type: 'income', context: 'Business', taxBucket: 'revenue',
          source: 'booth_rent',
          amount: due / 100, category: 'Booth Rent',
          description: `Balance — ${r.boothName || 'Space'} — ${r.name || 'guest'}`,
          clientOrVendor: r.name || 'Day renter', date: nowIso, paymentMethod: 'Collected in person',
          hasReceipt: false, sourceId: r.id, tenantId, createdAt: nowIso, renterId: r.renterId || null,
        });
        tx.update(resRef, { balancePaid: true, balancePaidAt: nowIso, balancePaidVia: 'in_person', balanceStatus: 'collected' });
        tx.set(aRef, { id: aRef.id, ...auditEntry({
          action: 'booth.balance_collected', targetType: 'transaction', targetId: txnRef.id,
          summary: `Balance taken in person: ${r.name || 'guest'} · ${r.boothName || 'space'}`,
          amount: due / 100, actor: { type: 'user' },
        }) });
        return { cents: due };
      });
      if ((out as any).closed) toast({ variant: 'destructive', title: 'Not recorded', description: 'This booking was called off.' });
      else if ((out as any).charging) toast({ variant: 'destructive', title: 'A card charge is going through', description: 'Give it a moment, then look again.' });
      else if ((out as any).done) toast({ title: 'Already paid', description: 'This balance was already recorded.' });
      else toast({ title: 'Balance paid', description: `${usd((out as any).cents)} recorded as taken in person.` });
    } catch {
      toast({ variant: 'destructive', title: 'Not recorded', description: 'Nothing was saved. Try again.' });
    } finally { setBalanceBusyId(null); }
  };

// Move a booking: same length, a new day (and hours, for an hourly one), checked against everything else on the space.
const saveReschedule = async (r: any) => {
    if (reschedSaving || !reschedDate) return;
    setReschedSaving(true);
    try {
      const isHourly = r.bookingType === 'hourly';
      const res = await fetch('/api/booths/reserve', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reschedule', tenantId, reservationId: r.id, startDate: reschedDate,
          startTime: isHourly ? reschedStartTime : undefined, endTime: isHourly ? reschedEndTime : undefined }),
      });
      const d = await res.json().catch(() => ({}));
      if (d.ok) { toast({ title: 'Booking moved', description: `Now ${shortDay(d.startDate)}${d.startTime ? `, ${hm(d.startTime)} to ${hm(d.endTime)}` : ''}.` }); setReschedRes(null); }
      else toast({ variant: 'destructive', title: 'Not moved', description: d.error || 'Try again.' });
    } catch {
      toast({ variant: 'destructive', title: 'Not moved', description: 'No connection. Nothing was changed.' });
    } finally { setReschedSaving(false); }
  };

const openSignedAgreement = (r: any) => {
    const title = r.agreementTitle || 'Short-Term Rental Agreement';
    const signedAt = r.agreementSignedAt ? new Date(r.agreementSignedAt).toLocaleString() : '';
    const window_ = r.bookingType === 'hourly'
      ? `${r.startDate || ''} · ${r.startTime || ''}–${r.endTime || ''}`
      : (r.startDate === r.endDate ? (r.startDate || '') : `${r.startDate || ''} → ${r.endDate || ''}`);
    // In the app's print look (lib/print-style). The window waits for its Print button, as before.
    const html = printPage({
      title: `${title} · ${r.name || 'Guest'}`,
      heading: esc(title),
      subtitle: 'Signed electronically',
      body: `
  <p class="no-print" style="margin:0 0 16px"><button type="button" class="print" onclick="window.print()">Print or save as PDF</button></p>
  <div class="panel facts">
    <div><p class="lbl">Guest</p><p>${esc(r.name || 'Guest')}</p></div>
    <div><p class="lbl">Space</p><p>${esc(r.boothName || 'Space')}</p></div>
    <div><p class="lbl">When</p><p>${esc(window_)}</p></div>
    ${r.amountCents ? `<div><p class="lbl">Amount</p><p>$${((r.amountCents || 0) / 100).toFixed(2)}</p></div>` : ''}
  </div>
  <div class="terms">${esc(r.agreementText || 'No agreement text was captured for this booking.')}</div>
  <div class="sig">
    <p class="lbl">Signature</p>
    <p class="name">${esc(r.agreementSignedName || '—')}</p>
    <p class="muted">Signed ${esc(signedAt)}${r.agreementSignedName ? ' · typed name = legal electronic signature' : ''}</p>
  </div>`,
      footNote: 'The terms exactly as the guest signed them, kept with the booking.',
      css: `
  .pp .print { font: inherit; font-size: 13px; font-weight: 600; color: #fff; background: ${PRINT.ink}; border: 0; border-radius: 999px; padding: 9px 18px; cursor: pointer; }
  .pp .facts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px 24px; margin: 0 0 20px; }
  .pp .facts p + p { font-size: 13px; margin-top: 1px; }
  .pp .terms { white-space: pre-wrap; font-size: 12.5px; line-height: 1.65; color: ${PRINT.body}; }
  .pp .sig { margin-top: 26px; padding-top: 16px; border-top: 1px solid ${PRINT.line}; break-inside: avoid; }
  .pp .sig .name { font-size: 26px; font-weight: 300; letter-spacing: -0.01em; line-height: 1.2; margin: 4px 0 6px; }`,
      autoPrint: false,
    });
    try {
      const w = window.open('', '_blank');
      if (!w) { toast({ variant: 'destructive', title: 'Popup blocked', description: 'Allow popups to open the signed agreement.' }); return; }
      w.document.open();
      w.document.write(html);
      w.document.close();
    } catch {
      toast({ variant: 'destructive', title: "Couldn't open", description: 'Try again.' });
    }
  };

const chargeOverageToCard = async (r: any) => {
    if (chargingId) return;
    setChargingId(r.id);
    try {
      const res = await fetch('/api/booths/reserve', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, reservationId: r.id }),
      });
      const data = await res.json();
      if (data.ok) {
        toast({ title: 'Card charged', description: `$${(data.chargedCents / 100).toFixed(2)} collected and recorded in the ledger.` });
        writeBoothAudit(firestore, tenantId, {
          action: 'booth.overage_charged', targetType: 'boothReservation', targetId: r.id,
          summary: `Overage charged to card on file: ${r.name || 'guest'} · ${r.boothName || 'space'}`,
          amount: (data.chargedCents || 0) / 100, actor: { type: 'user' },
        });
      }
      else toast({ variant: 'destructive', title: 'Charge failed', description: data.error || 'Collect in person instead.' });
    } catch {
      toast({ variant: 'destructive', title: 'Charge failed', description: 'Network error — try again or collect in person.' });
    } finally { setChargingId(null); }
  };

const chargeIncidentalToCard = async (r: any) => {
    const cents = Math.round(parseFloat(incidentalAmt) * 100);
    if (!(cents >= 50) || !incidentalCat || incidentalBusyId) return;
    setIncidentalBusyId(r.id);
    // This attempt's name: the same charge asked again (after no answer) keeps it, so it can't go through twice.
    if (!incidentalTry.current) incidentalTry.current = Math.random().toString(36).slice(2, 10);
    const key = `${incidentalTry.current}-${r.id}-${cents}-${incidentalCat}`.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 100);
    try {
      const res = await fetch('/api/booths/reserve', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'incidental', tenantId, reservationId: r.id, amountCents: cents, category: incidentalCat, note: incidentalDesc.trim(), key }),
      });
      const data = await res.json();
      // Charged, or the card said no: the next charge is a new attempt.
      if (data.ok || res.status === 402) incidentalTry.current = '';
      if (data.ok) {
        toast({ title: 'Card charged', description: `$${(data.chargedCents / 100).toFixed(2)} — ${incidentalCat} recorded in the ledger.` });
        writeBoothAudit(firestore, tenantId, {
          action: 'booth.incidental_charged', targetType: 'boothReservation', targetId: r.id,
          summary: `Incidental charged to card on file: ${r.name || 'guest'} · ${r.boothName || 'space'} — ${incidentalCat}${incidentalDesc.trim() ? ` (${incidentalDesc.trim()})` : ''}`,
          amount: (data.chargedCents || 0) / 100, actor: { type: 'user' },
        });
        setIncidentalForId(null); setIncidentalAmt(''); setIncidentalDesc(''); setIncidentalCat('');
      } else toast({ variant: 'destructive', title: 'Charge failed', description: data.error || 'Collect in person instead.' });
    } catch {
      toast({ variant: 'destructive', title: 'Charge failed', description: 'Network error — try again.' });
    } finally { setIncidentalBusyId(null); }
  };

const markOverageCollected = async (r: any) => {
    const nowIso = new Date().toISOString();
    try {
      // v73 — three fixes in one: (1) `source: 'booth_rent'` — WITHOUT it
      // this money was invisible to every booth ledger view and renter
      // statement, which all filter on that field; (2) one step, so the
      // ledger entry and the reservation flag can't drift; (3) audit entry.
      // Once: only while the overage is still due (a second tap, or a card charge a moment ago, finds it done), and the
      // line is named after the booking, the same as a card charge's.
      const resRef = doc(firestore, 'tenants', tenantId, 'boothReservations', r.id);
      const txnRef = doc(firestore, 'tenants', tenantId, 'transactions', `boothover_${String(r.id).replace(/[^A-Za-z0-9_-]/g, '')}`);
      const aRef = doc(collection(firestore, 'tenants', tenantId, 'auditLogs'));
      const cents = await runTransaction(firestore, async (tx) => {
        const cur: any = (await tx.get(resRef)).data() || {};
        const due = Math.round(Number(cur.overageDueCents) || 0);
        if (cur.overageStatus !== 'due' || !(due > 0)) return 0;
        tx.set(txnRef, {
          id: txnRef.id, type: 'income', context: 'Business', taxBucket: 'revenue',
          source: 'booth_rent',
          amount: due / 100, category: 'Booth Rent',
          description: `Overage — ${r.boothName || 'Space'} — ${r.name} (+${r.overageMinutes} min)`,
          clientOrVendor: r.name || 'Day renter', date: nowIso, paymentMethod: 'Collected in person',
          hasReceipt: false, sourceId: r.id, tenantId, createdAt: nowIso, renterId: r.renterId || null,
        });
        tx.update(resRef, { overageStatus: 'collected', overageCollectedAt: nowIso });
        tx.set(aRef, { id: aRef.id, ...auditEntry({
          action: 'booth.overage_collected', targetType: 'transaction', targetId: txnRef.id,
          summary: `Overage collected in person: ${r.name || 'guest'} · ${r.boothName || 'space'} (+${r.overageMinutes || 0} min)`,
          amount: due / 100, actor: { type: 'user' },
        }) });
        return due;
      });
      if (!cents) { toast({ title: 'Already recorded', description: 'This overage was already charged or collected.' }); return; }
      toast({ title: 'Overage collected', description: `$${(cents / 100).toFixed(2)} recorded in the ledger.` });
    } catch {
      toast({ variant: 'destructive', title: 'Could not record', description: 'Nothing was saved — try again.' });
    }
  };

const openReschedule = (r: any) => {
    if (reschedRes?.id === r.id) { setReschedRes(null); return; }
    setReschedRes(r);
    setReschedDate(r.startDate || '');
    setReschedStartTime(r.startTime || '');
    setReschedEndTime(r.endTime || '');
  };

  return (
    <div className="space-y-3">
          {upcomingReservations.length > 0 && <ZoneLabel>Today on the floor</ZoneLabel>}

          {upcomingReservations.length > 0 && (
            <div id="ops-rentals" className="space-y-3 scroll-mt-14">
              <div className="flex items-center gap-2">
                <h2 className="text-[15px] font-semibold" style={{ color: INK }}>Day and hourly guests</h2>
                <span className="h-6 min-w-6 px-2 rounded-full text-[12px] font-medium inline-flex items-center justify-center" style={{ background: SOFT, color: MUTED }}>{upcomingReservations.length}</span>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                {upcomingReservations.map((r: any) => {
                  const callingOff = CALLING_OFF.includes(r.status);
                  const byPass = !!r.paidWithPassId && !r.stripePaymentIntentId;
                  const paidOnline = !!r.stripePaymentIntentId;
                  const leftToRefund = Math.max(0, (Number(r.amountCents) || 0) - (Number(r.refundedCents) || 0));
                  const balanceOpen = Number(r.balanceDueCents) > 0 && r.balancePaid !== true && ['confirmed', 'checked_in', 'completed'].includes(r.status);
                  const chip = r.status === 'checked_in' ? { label: 'Here now', bg: '#ecf6f0', fg: GREEN }
                    : r.status === 'confirmed' ? { label: 'Coming', bg: SOFT, fg: MUTED }
                    : r.status === 'completed' ? { label: 'Checked out', bg: SOFT, fg: MUTED }
                    : { label: 'Needs you', bg: '#fff7ed', fg: AMBER };
                  const when = r.bookingType === 'hourly' ? `${shortDay(r.startDate)}, ${hm(r.startTime)} to ${hm(r.endTime)}` : r.startDate === r.endDate ? shortDay(r.startDate) : `${shortDay(r.startDate)} to ${shortDay(r.endDate)}`;
                  const paidText = byPass ? `${r.passDaysUsed || 1} prepaid day${(r.passDaysUsed || 1) === 1 ? '' : 's'}`
                    : r.paymentStatus === 'unpaid' ? 'not paid yet'
                    : `${usd(Number(r.amountCents) || 0)} paid${Number(r.refundedCents) > 0 ? `, ${usd(Number(r.refundedCents))} refunded` : ''}`;
                  const note = (text: any, tone: 'muted' | 'amber' | 'green' = 'muted') => <p className="text-[13px]" style={{ color: tone === 'amber' ? AMBER : tone === 'green' ? GREEN : MUTED }}>{text}</p>;
                  return (
                  <div key={r.id} className="rounded-2xl border p-4 space-y-2.5" style={{ borderColor: LINE, background: callingOff ? '#fff7ed' : 'white' }}>
                    <div className="flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-[15px] font-semibold truncate" style={{ color: INK }}>
                          {r.name || 'Guest'} <span className="font-normal" style={{ color: MUTED }}>· {r.boothName || 'Space'}</span>
                        </p>
                        <p className="text-[13px] mt-0.5" style={{ color: MUTED }}>{when} · {paidText}</p>
                        <div className="flex flex-wrap gap-1.5 mt-1.5">
                          {TIER_BADGE[tierFor(r)] && <span className={`text-[12px] font-medium rounded-full px-2 py-0.5 ${TIER_BADGE[tierFor(r)].cls}`}>{TIER_BADGE[tierFor(r)].label}</span>}
                          {r.renterDiscountCents > 0 && <span className="text-[12px] font-medium rounded-full px-2 py-0.5" style={{ background: SOFT, color: MUTED }}>{usd(r.renterDiscountCents)} renter discount</span>}
                        </div>
                      </div>
                      <span className="text-[12px] font-medium rounded-full px-2.5 py-1 shrink-0" style={{ background: chip.bg, color: chip.fg }}>{chip.label}</span>
                    </div>

                    {r.status === 'payment_received_conflict' && note('Paid, but the time was taken while they paid. Refund them.', 'amber')}
                    {r.status === 'cancelled_refund_pending' && note(byPass ? 'Called off. Give their prepaid days back.' : paidOnline ? 'Called off. Refund what you’re giving back; the rest is kept as a cancellation fee.' : 'Called off. It was paid at the desk: hand back what you’re refunding, record it in Money, then mark it called off.', 'amber')}
                    {r.status === 'cancel_requested' && note(`They asked to cancel${r.cancelRequestNote || r.cancelReason ? `: “${r.cancelRequestNote || r.cancelReason}”` : '.'}`, 'amber')}
                    {r.noShow && note('Didn’t check in (no-show).', 'amber')}
                    {(r.licenseNumber || r.insuranceConfirmed || r.idAcknowledged || r.doingServices || r.licenseDocUrl || r.insuranceDocUrl || r.idDocUrl) && (
                      <div className="text-[13px] flex flex-wrap items-center gap-x-3 gap-y-1" style={{ color: MUTED }}>
                        {r.doingServices && <span>Seeing clients</span>}
                        {r.licenseNumber && <span>License {r.licenseNumber}</span>}
                        {r.licenseDocUrl && <a href={r.licenseDocUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2 inline-flex items-center gap-1 min-h-[44px]" style={{ color: INK }}><FileText className="h-3.5 w-3.5" /> License</a>}
                        {(r.insuranceConfirmed && !r.insuranceDocUrl) && <span>Insured (they said so)</span>}
                        {r.insuranceDocUrl && <a href={r.insuranceDocUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2 inline-flex items-center gap-1 min-h-[44px]" style={{ color: INK }}><FileText className="h-3.5 w-3.5" /> Insurance</a>}
                        {r.idDocUrl ? <a href={r.idDocUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2 inline-flex items-center gap-1 min-h-[44px]" style={{ color: INK }}><FileText className="h-3.5 w-3.5" /> ID</a> : r.idAcknowledged && <span>ID shown</span>}
                      </div>
                    )}
                    {r.agreementSignedAt ? (
                      <div className="text-[13px] flex flex-wrap items-center gap-x-2" style={{ color: MUTED }}>
                        <span className="inline-flex items-center gap-1"><FileSignature className="h-3.5 w-3.5" /> Agreement signed by {r.agreementSignedName || 'the guest'}, {new Date(r.agreementSignedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                        <button type="button" onClick={() => openSignedAgreement(r)} className="underline underline-offset-2 min-h-[44px]" style={{ color: INK }}>Open</button>
                      </div>
                    ) : (r.status === 'confirmed' || r.status === 'checked_in') && note('No signed agreement yet. Have them sign at check-in.', 'amber')}
                    {r.status === 'checked_in' && r.actualCheckIn && note(`Here since ${new Date(r.actualCheckIn).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).replace(/\s/g, '').toLowerCase()}${r.bookingType === 'hourly' && r.endTime ? `, booked until ${hm(r.endTime)}` : ''}.`)}
                    {r.overtimeUnchecked && (
                      <p className="text-[13px]" style={{ color: AMBER }}>Extra time wasn’t checked at check-out, because there was no clock to go by. Set your time zone in Settings, and check this stay by hand.</p>
                    )}
                    {r.overageStatus === 'due' && note(`Stayed ${r.overageMinutes} minutes over: ${usd(r.overageDueCents || 0)} to collect.`, 'amber')}
                    {r.rescheduleRequestedAt && r.status === 'confirmed' && note(`They asked to move it${r.rescheduleRequestNote ? `: “${r.rescheduleRequestNote}”` : '.'}`, 'amber')}

                    {balanceOpen && (
                      <div className="rounded-xl p-3 space-y-2" style={{ background: '#fff7ed' }}>
                        <p className="text-[14px]" style={{ color: AMBER }}>
                          {usd(r.depositCents || r.amountCents || 0)} deposit paid. <span className="font-semibold">{usd(r.balanceDueCents)} still to pay</span>{r.balanceMode === 'at_checkin' ? ', at check-in.' : '.'}
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {r.cardOnFile && <button type="button" onClick={() => chargeBalanceToCard(r)} disabled={balanceBusyId === r.id} className={BTN_DARK}>{balanceBusyId === r.id ? 'Charging…' : `Charge ${usd(r.balanceDueCents)} to the saved card`}</button>}
                          <button type="button" onClick={() => markBalancePaid(r)} disabled={balanceBusyId === r.id} className={BTN_LINE}>Paid in person</button>
                        </div>
                      </div>
                    )}

                    {r.creditDecision === 'pending' && r.potentialCreditCents > 0 && (
                      <div className="rounded-xl p-3 space-y-2" style={{ background: '#ecf6f0' }}>
                        <p className="text-[14px]" style={{ color: GREEN }}>Left {r.unusedMinutes} minutes early. Give {usd(r.potentialCreditCents)} credit toward their next booking?</p>
                        <div className="flex flex-wrap gap-2">
                          <button type="button" onClick={() => issueCredit(r)} className={BTN_DARK}>Give credit</button>
                          <button type="button" onClick={() => declineCredit(r)} className={BTN_LINE}>No credit</button>
                        </div>
                      </div>
                    )}
                    {r.creditDecision === 'issued' && r.creditIssuedCents > 0 && note(`${usd(r.creditIssuedCents)} credit given. It comes off their next booking.`, 'green')}

                    <div className="flex gap-2 items-center pt-1">
                      {r.status === 'confirmed' ? (
                        <button type="button" onClick={() => checkInRes(r)} className={`${BTN_DARK} flex-1`}>Check in</button>
                      ) : r.status === 'checked_in' ? (
                        <button type="button" onClick={() => checkOutRes(r)} className={`${BTN_DARK} flex-1`}>Check out</button>
                      ) : (r.overageStatus === 'due' && r.cardOnFile) ? (
                        <button type="button" onClick={() => chargeOverageToCard(r)} disabled={chargingId === r.id} className={`${BTN_DARK} flex-1`}>{chargingId === r.id ? 'Charging…' : `Charge ${usd(r.overageDueCents || 0)} to the saved card`}</button>
                      ) : (r.overageStatus === 'due') ? (
                        <button type="button" onClick={() => markOverageCollected(r)} className={`${BTN_DARK} flex-1`}>{`Paid ${usd(r.overageDueCents || 0)} in person`}</button>
                      ) : callingOff && byPass ? (
                        <button type="button" onClick={() => giveDaysBack(r)} disabled={refundingId === r.id} className={`${BTN_DARK} flex-1`}>{refundingId === r.id ? 'Giving back…' : `Call off and give back ${r.passDaysUsed || 1} prepaid day${(r.passDaysUsed || 1) === 1 ? '' : 's'}`}</button>
                      ) : callingOff && paidOnline && leftToRefund > 0 ? (
                        <button type="button" onClick={() => openRefund(r)} className={`${BTN_DARK} flex-1`}>{refundFor === r.id ? 'Close refund' : 'Refund'}</button>
                      ) : (
                        <PrintLink path="/api/booths/receipt" params={{ tenantId, type: 'reservation', id: r.id }} className={`${BTN_LINE} flex-1`}><FileText className="h-4 w-4" /> Receipt</PrintLink>
                      )}
                      {r.phone && <a href={`tel:${r.phone}`} aria-label={`Phone ${r.name || 'the guest'}`} className="h-11 w-11 rounded-full border border-[#ececee] bg-white flex items-center justify-center shrink-0" style={{ color: MUTED }}><Phone className="h-4 w-4" /></a>}
                      <OverflowMenu
                        align="right"
                        label={`More for ${r.name || 'this guest'}`}
                        items={[
                          ...(r.status === 'confirmed' ? [
                            { label: reschedRes?.id === r.id ? 'Close move' : 'Move to another time', onClick: () => openReschedule(r) },
                            byPass
                              ? { label: `Call off and give back prepaid days`, danger: true, onClick: () => giveDaysBack(r) }
                              : { label: 'Call off the booking', danger: true, onClick: () => setResStatus(r, 'cancelled_refund_pending') },
                          ] : []),
                          ...(r.status === 'cancel_requested' ? [{ label: 'Keep the booking (say no)', onClick: () => setResStatus(r, 'confirmed') }] : []),
                          ...(callingOff && !byPass && (!paidOnline || leftToRefund === 0) ? [{ label: 'Mark it called off', danger: true, onClick: () => callOff(r) }] : []),
                          ...(paidOnline && leftToRefund > 0 && !callingOff && ['confirmed', 'checked_in', 'completed'].includes(r.status) ? [{ label: refundFor === r.id ? 'Close refund' : 'Refund part or all', onClick: () => openRefund(r) }] : []),
                          ...(r.overageStatus === 'due' && r.cardOnFile ? [{ label: 'Extra time paid in person', onClick: () => markOverageCollected(r) }] : []),
                          ...(r.cardOnFile && !callingOff ? [{ label: incidentalForId === r.id ? 'Close charge' : 'Add a charge', onClick: () => { setIncidentalForId(incidentalForId === r.id ? null : r.id); setIncidentalAmt(''); setIncidentalDesc(''); setIncidentalCat(''); } }] : []),
                          { label: 'Open receipt', onClick: () => { void openPrint('/api/booths/receipt', { tenantId, type: 'reservation', id: r.id }).catch((e: any) => toast({ title: 'Didn’t open', description: String(e?.message || 'Try again.') })); } },
                          ...(r.agreementSignedAt ? [{ label: 'Open signed agreement', onClick: () => openSignedAgreement(r) }] : []),
                          ...(['confirmed', 'checked_in'].includes(r.status) ? [{ label: 'Open the guest’s check-in link', onClick: () => window.open(`/stay/${encodeURIComponent(tenantId)}/${encodeURIComponent(r.id)}`, '_blank') }] : []),
                        ]}
                      />
                    </div>

                    {refundFor === r.id && (
                      <div className="rounded-xl p-3 space-y-2.5" style={{ background: 'white', border: `1px solid ${LINE}` }}>
                        <p className="text-[14px] font-semibold" style={{ color: INK }}>Refund to their card</p>
                        <p className="text-[13px]" style={{ color: MUTED }}>
                          Up to {usd(leftToRefund)}{Number(r.refundedCents) > 0 ? ` (${usd(Number(r.refundedCents))} already refunded)` : ''}. {callingOff ? 'The booking is called off; what you don’t refund is kept as a cancellation fee.' : 'The booking stands. Refund more later if you need to.'}
                        </p>
                        <label className="block text-[13px]" style={{ color: MUTED }}>Amount
                          <input type="number" inputMode="decimal" min="0.5" step="0.01" value={refundAmt} onChange={e => setRefundAmt(e.target.value)} className={`${FIELD} mt-1`} />
                        </label>
                        <label className="block text-[13px]" style={{ color: MUTED }}>Reason (the guest is told)
                          <input type="text" value={refundWhy} onChange={e => setRefundWhy(e.target.value)} placeholder="Optional" className={`${FIELD} mt-1`} maxLength={200} />
                        </label>
                        {Math.round(parseFloat(refundAmt) * 100) > leftToRefund && <p className="text-[13px]" style={{ color: AMBER }}>That’s more than the {usd(leftToRefund)} left to refund.</p>}
                        <button type="button" onClick={() => sendRefund(r)} disabled={refundingId === r.id || !(parseFloat(refundAmt) > 0) || Math.round(parseFloat(refundAmt) * 100) > leftToRefund} className={`${BTN_RED} w-full`}>
                          {refundingId === r.id ? 'Refunding…' : `Refund ${parseFloat(refundAmt) > 0 ? usd(Math.round(parseFloat(refundAmt) * 100)) : ''}`}
                        </button>
                      </div>
                    )}

                    {reschedRes?.id === r.id && (
                      <div className="rounded-xl p-3 space-y-2.5" style={{ background: 'white', border: `1px solid ${LINE}` }}>
                        <p className="text-[14px] font-semibold" style={{ color: INK }}>Move to another time</p>
                        <p className="text-[13px]" style={{ color: MUTED }}>Same length as booked. For a different length, call it off and book again.</p>
                        <label className="block text-[13px]" style={{ color: MUTED }}>{r.bookingType === 'hourly' ? 'Day' : 'First day'}
                          <input type="date" value={reschedDate} onChange={e => setReschedDate(e.target.value)} className={`${FIELD} mt-1`} />
                        </label>
                        {r.bookingType === 'hourly' && (
                          <div className="grid grid-cols-2 gap-2">
                            <label className="block text-[13px]" style={{ color: MUTED }}>From
                              <input type="time" value={reschedStartTime} onChange={e => setReschedStartTime(e.target.value)} className={`${FIELD} mt-1`} />
                            </label>
                            <label className="block text-[13px]" style={{ color: MUTED }}>To
                              <input type="time" value={reschedEndTime} onChange={e => setReschedEndTime(e.target.value)} className={`${FIELD} mt-1`} />
                            </label>
                          </div>
                        )}
                        <button type="button" onClick={() => saveReschedule(r)} disabled={reschedSaving || !reschedDate} className={`${BTN_DARK} w-full`}>{reschedSaving ? 'Moving…' : 'Move booking'}</button>
                      </div>
                    )}

                    {incidentalForId === r.id && (() => {
                      const sel = incidentalPolicy.find((c: any) => c.label === incidentalCat) || null;
                      const capCents = sel ? Math.round(Number(sel.capCents) || 0) : 0;
                      const overCap = capCents > 0 && Math.round(parseFloat(incidentalAmt) * 100) > capCents;
                      return (
                        <div className="rounded-xl p-3 space-y-2.5" style={{ background: 'white', border: `1px solid ${LINE}` }}>
                          <p className="text-[14px] font-semibold" style={{ color: INK }}>Add a charge to the saved card</p>
                          <label className="block text-[13px]" style={{ color: MUTED }}>What it’s for
                            <select value={incidentalCat} onChange={e => setIncidentalCat(e.target.value)} className={`${FIELD} mt-1`}>
                              <option value="">Choose one of your charge types</option>
                              {incidentalPolicy.map((c: any) => <option key={c.label} value={c.label}>{c.label}{c.capCents ? `, up to ${usd(c.capCents)}` : ''}</option>)}
                            </select>
                          </label>
                          <div className="grid grid-cols-[7rem_1fr] gap-2">
                            <label className="block text-[13px]" style={{ color: MUTED }}>Amount
                              <input type="number" inputMode="decimal" value={incidentalAmt} onChange={e => setIncidentalAmt(e.target.value)} className={`${FIELD} mt-1`} style={overCap ? { borderColor: AMBER } : undefined} />
                            </label>
                            <label className="block text-[13px]" style={{ color: MUTED }}>Note
                              <input type="text" placeholder="Optional" value={incidentalDesc} onChange={e => setIncidentalDesc(e.target.value)} className={`${FIELD} mt-1`} />
                            </label>
                          </div>
                          {overCap && sel && <p className="text-[13px]" style={{ color: AMBER }}>Over the {usd(capCents)} limit for {sel.label}.</p>}
                          <button type="button" onClick={() => chargeIncidentalToCard(r)} disabled={!incidentalCat || !(parseFloat(incidentalAmt) > 0) || overCap || incidentalBusyId === r.id} className={`${BTN_DARK} w-full`}>
                            {incidentalBusyId === r.id ? 'Charging…' : `Charge the card${parseFloat(incidentalAmt) > 0 ? ` ${usd(Math.round(parseFloat(incidentalAmt) * 100))}` : ''}`}
                          </button>
                          <p className="text-[12.5px]" style={{ color: MUTED }}>Only your own charge types, each with its limit (Settings). The guest gets a receipt.</p>
                        </div>
                      );
                    })()}
                  </div>
                  );
                })}
              </div>
            </div>
          )}

    </div>
  );
}
