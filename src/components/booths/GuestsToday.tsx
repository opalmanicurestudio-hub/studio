"use client";

/**
 * GuestsToday — the day-guest desk: check-in/out, refunds, credits, overages,
 * incidentals. Lifted VERBATIM from the booth hub so money-touching logic
 * moved without being rewritten. Lives beside the desk panel that SELLS them.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { collection, doc, getDocs, query, where, updateDoc, setDoc, addDoc, deleteDoc, writeBatch } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { useLocation } from '@/context/LocationContext';
import { cn } from '@/lib/utils';
import { auditEntry } from '@/lib/audit';
import { FileText, Scissors, FileSignature, MoreHorizontal } from 'lucide-react';
import { contactKey as boothContactKey } from '@/lib/booth-contacts';

type OverflowItem = { label: string; onClick: () => void; danger?: boolean; disabled?: boolean };
const FREQ_TO_MONTHLY: Record<string, number> = {
  daily: 30,
  weekly: 4.33,
  biweekly: 2.17,
  monthly: 1,
};


// ── Duplicated from the booth hub (byte-for-byte; no cross-route imports) ──
const writeBoothAudit = (firestore: any, tenantId: string, e: any) => {
  try {
    const aRef = doc(collection(firestore, 'tenants', tenantId, 'auditLogs'));
    setDoc(aRef, { id: aRef.id, ...auditEntry(e) }).catch(() => {});
  } catch { /* non-fatal */ }
};

const localISO = (d: Date = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function ZoneLabel({ children }: { children: any }) {
  return (
    <div className="flex items-center gap-3 pt-3">
      <p className="text-[9px] font-black uppercase tracking-[0.3em] text-slate-400 shrink-0">{children}</p>
      <div className="h-px flex-1 bg-slate-200" />
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
        className="h-8 w-8 rounded-lg border-2 flex items-center justify-center text-slate-500 hover:bg-slate-50 active:scale-95 transition"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={(e) => { e.stopPropagation(); setOpen(false); }} />
          <div className={`absolute z-50 mt-1 min-w-[11rem] rounded-2xl border-2 bg-white shadow-xl p-1.5 ${align === 'right' ? 'right-0' : 'left-0'}`}>
            {usable.map((it, i) => (
              <button
                key={i}
                type="button"
                disabled={it.disabled}
                onClick={(e) => { e.stopPropagation(); setOpen(false); it.onClick(); }}
                className={`w-full text-left px-3 py-2.5 rounded-xl text-[11px] font-black uppercase tracking-widest transition disabled:opacity-40 ${it.danger ? 'text-red-600 hover:bg-red-50' : 'text-slate-700 hover:bg-slate-50'}`}
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
  const incidentalPolicy: any[] = (Array.isArray((tenant as any)?.incidentalCategories) && (tenant as any).incidentalCategories.length)
  const [refundingId, setRefundingId] = useState<string | null>(null);
  const [chargingId, setChargingId] = useState<string | null>(null);
  const [incidentalForId, setIncidentalForId] = useState<string | null>(null);
  const [incidentalAmt, setIncidentalAmt] = useState('');
  const [incidentalDesc, setIncidentalDesc] = useState('');
  const [incidentalCat, setIncidentalCat] = useState('');
  const [incidentalBusyId, setIncidentalBusyId] = useState<string | null>(null);
const guestBook = useMemo(() => {
    const norm = (v: any) => (v || '').trim().toLowerCase();
    const byContact = new Map<string, any>();
    const get = (phone: any, email: any, name: any) => {
      const key = norm(phone) || norm(email);
      if (!key) return null;
      let g = byContact.get(key);
      if (!g) {
        g = { key, name: name || 'Guest', phone: phone || '', email: email || '',
          visits: 0, totalCents: 0, lastDate: '', firstDate: '9999',
          stage: 'inquiry', stageRank: 0, tags: new Set<string>() };
        byContact.set(key, g);
      }
      if (name && (!g.name || g.name === 'Guest')) g.name = name;
      if (phone && !g.phone) g.phone = phone;
      if (email && !g.email) g.email = email;
      return g;
    };
    const STAGE_RANK: Record<string, number> = { inquiry: 0, tour: 1, applicant: 2, guest: 3, renter: 4, repeat: 5 };
    const promote = (g: any, stage: string) => { if (STAGE_RANK[stage] > g.stageRank) { g.stage = stage; g.stageRank = STAGE_RANK[stage]; } };

    // Reservations — paid guests, lifetime value, ratings
    for (const r of reservations) {
      if (!['confirmed', 'checked_in', 'completed', 'cancel_requested'].includes(r.status)) continue;
      const g = get(r.phone, r.email, r.name); if (!g) continue;
      if (['confirmed', 'checked_in', 'completed'].includes(r.status)) {
        g.visits += 1;
        g.totalCents += (r.amountCents || 0) + (r.overageStatus === 'charged' ? (r.overageDueCents || 0) : 0);
        // Rolling 90-day visit count — powers the recurring-guest tier.
        const vt = new Date(r.createdAt || r.startDate || 0).getTime();
        if (vt >= Date.now() - 90 * 24 * 60 * 60 * 1000) g.visits90 = (g.visits90 || 0) + 1;
        promote(g, g.visits > 1 ? 'repeat' : 'guest');
      }
      if ((r.startDate || '') > g.lastDate) { g.lastDate = r.startDate; }
      if ((r.startDate || '') < g.firstDate) g.firstDate = r.startDate;
      if (Number(r.rating) >= 1 && (r.reviewedAt || '') > (g.lastReviewedAt || '')) { g.lastRating = r.rating; g.lastReviewedAt = r.reviewedAt || ''; }
    }
    // Applications & tours — the top of the funnel, never lost
    for (const app of applications) {
      const g = get(app.phone, app.email, app.name); if (!g) continue;
      const when = String(app.decidedAt || app.createdAt || '').slice(0, 10);
      if (when && when > g.lastDate) g.lastDate = when;
      if (when && when < g.firstDate) g.firstDate = when;
      const kind = app.kind || 'application';
      if (kind === 'tour') { promote(g, 'tour'); g.tags.add('toured'); }
      else { promote(g, 'applicant'); }
      if (app.status === 'approved') g.tags.add('approved');
    }
    // Leases — renters, valued with their rent
    for (const l of (leases.data || [])) {
      if (!['active', 'on_leave', 'pending_signature'].includes(l.status)) continue;
      const rt = renterById.get(l.renterId);
      if (!rt) continue;
      const g = get(rt.phone, rt.email, `${rt.firstName || ''} ${rt.lastName || ''}`.trim()); if (!g) continue;
      promote(g, 'renter');
      g.tags.add('renter');
      g.isRenter = true; g.renterId = rt.id;
      g.monthlyRentCents = (l.rentAmountCents || 0) * (FREQ_TO_MONTHLY[l.frequency] ?? 1);
    }
    const arr = Array.from(byContact.values()).map(g => {
      const c = contactByKey.get(g.key);
      return {
        ...g,
        // Recurring-guest tier — same thresholds the server uses at booking
        // time (booth-recognition.ts): resident renter, regular (4+ visits in
        // 90 days), returning (2+ ever), new. Computed, never stored.
        tier: g.isRenter ? 'resident'
          : (g.visits90 || 0) >= 4 ? 'regular'
          : g.visits >= 2 ? 'returning'
          : 'new',
        tags: Array.from(g.tags),
        // Persisted journey overlay (undefined until the owner acts on them).
        pipelineStage: c?.pipelineStage || null,
        nextFollowUpAt: c?.nextFollowUpAt || null,
        lostReason: c?.lostReason || null,
        ownerNotes: c?.ownerNotes || null,
        convertedRenterId: c?.convertedRenterId || (g.isRenter ? g.renterId : null),
        photoUrl: c?.photoUrl || null,
        history: Array.isArray(c?.history) ? c.history : [],
      };
    });
    return arr.sort((a, b) => (b.lastDate || '').localeCompare(a.lastDate || ''));
  }, [reservations, applications, leases.data, renterById, contactByKey]);
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
    resident: { label: 'Resident', cls: 'bg-indigo-100 text-indigo-700' },
    regular: { label: 'Regular', cls: 'bg-emerald-100 text-emerald-700' },
    returning: { label: 'Returning', cls: 'bg-sky-100 text-sky-700' },
  };
  const hourlyCentsOf = (boothId: string): number => {
    const b = boothById.get(boothId) as any;
    const opts = Array.isArray(b?.pricingOptions) ? b.pricingOptions : [];
    return opts.find((o: any) => o.frequency === 'hourly' && o.amountCents > 0)?.amountCents || 0;
  };
const upcomingReservations = useMemo(() => {
    const today = localISO();
    return reservations
      .filter(r => ((['confirmed', 'checked_in', 'payment_received_conflict', 'cancelled_refund_pending'].includes(r.status)) && r.endDate >= today || r.overageStatus === 'due' || r.creditDecision === 'pending' || r.status === 'cancel_requested')
        && (!r.locationId || r.locationId === selectedLocationId))
      .sort((a, b) => (a.startDate || '').localeCompare(b.startDate || ''));
  }, [reservations, selectedLocationId]);

const setResStatus = async (r: any, status: string) => {
    try {
      await updateDoc(doc(firestore, 'tenants', tenantId, 'boothReservations', r.id),
        { status, [`${status}At`]: new Date().toISOString() });
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
    const now = new Date();
    const updates: any = {
      status: 'completed',
      completedAt: now.toISOString(),
      actualCheckOut: now.toISOString(),
    };
    // Settlement only makes sense for hourly stays with a booked window.
    if (r.bookingType === 'hourly' && r.startTime && r.endTime && r.actualCheckIn) {
      const bookedEnd = new Date(`${r.startDate}T${r.endTime}:00`);
      // v73 — settle at the rate snapshotted at check-in (falls back to
      // the current rate only for stays that predate the snapshot).
      const rate = (r.settleHourlyCents > 0 ? r.settleHourlyCents : hourlyCentsOf(r.boothId));
      const GRACE_MS = 10 * 60 * 1000;
      const diffMs = now.getTime() - bookedEnd.getTime();
      if (diffMs > GRACE_MS && rate > 0) {
        const overQuarters = Math.ceil((diffMs - GRACE_MS) / (15 * 60 * 1000));
        updates.overageMinutes = overQuarters * 15;
        updates.overageDueCents = Math.round(rate * (overQuarters * 15) / 60);
        updates.overageStatus = 'due';
      } else if (diffMs < -(30 * 60 * 1000) && rate > 0) {
        // Left 30+ min early: unused time is recorded as a POTENTIAL
        // credit — issuing it is the owner's call (v70: discretionary,
        // per business decision), via the Issue Credit button on the card.
        const underQuarters = Math.floor(-diffMs / (15 * 60 * 1000));
        const creditCents = Math.round(rate * (underQuarters * 15) / 60);
        if (creditCents >= 100) {
          updates.unusedMinutes = underQuarters * 15;
          updates.potentialCreditCents = creditCents;
          updates.creditDecision = 'pending';
        }
      }
    }
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

const refundReservation = async (r: any) => {
    if (refundingId) return;
    setRefundingId(r.id);
    try {
      const res = await fetch('/api/booths/reserve', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, reservationId: r.id }),
      });
      const d = await res.json();
      if (d.ok) toast({ title: 'Refunded', description: `$${((d.refundedCents || 0) / 100).toFixed(2)} refunded to ${r.name || 'guest'}'s card${d.alreadyRefunded ? ' (was already processed)' : ''}.` });
      else toast({ variant: 'destructive', title: 'Refund failed', description: d.error || 'Try again, or record it manually.' });
    } catch {
      toast({ variant: 'destructive', title: 'Network error', description: 'The refund may not have completed — check Stripe before retrying.' });
    } finally { setRefundingId(null); }
  };

const openSignedAgreement = (r: any) => {
    const esc = (s: any) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' } as any)[c]);
    const title = r.agreementTitle || 'Short-Term Rental Agreement';
    const signedAt = r.agreementSignedAt ? new Date(r.agreementSignedAt).toLocaleString() : '';
    const window_ = r.bookingType === 'hourly'
      ? `${r.startDate || ''} · ${r.startTime || ''}–${r.endTime || ''}`
      : (r.startDate === r.endDate ? (r.startDate || '') : `${r.startDate || ''} → ${r.endDate || ''}`);
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)} — ${esc(r.name || 'Guest')}</title>
<style>
  @media print { .noprint { display:none } }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color:#0f172a; max-width:720px; margin:40px auto; padding:0 24px; line-height:1.6; }
  h1 { font-size:20px; margin:0 0 4px; }
  .muted { color:#64748b; font-size:12px; text-transform:uppercase; letter-spacing:.08em; font-weight:800; }
  .meta { margin:16px 0 24px; padding:14px 16px; border:2px solid #e2e8f0; border-radius:14px; font-size:13px; }
  .meta div { margin:2px 0; }
  .terms { white-space:pre-wrap; font-size:13px; border-top:2px solid #e2e8f0; padding-top:18px; }
  .sig { margin-top:28px; padding-top:18px; border-top:2px solid #e2e8f0; }
  .sig .name { font-family:'Dancing Script', cursive; font-size:30px; }
  .btn { display:inline-block; margin:0 0 20px; padding:10px 16px; background:#4f46e5; color:#fff; border:0; border-radius:10px; font-weight:800; text-transform:uppercase; letter-spacing:.08em; font-size:11px; cursor:pointer; }
</style></head><body>
  <button class="btn noprint" onclick="window.print()">Print / Save as PDF</button>
  <h1>${esc(title)}</h1>
  <div class="muted">Signed electronically</div>
  <div class="meta">
    <div><b>Guest:</b> ${esc(r.name || 'Guest')}</div>
    <div><b>Space:</b> ${esc(r.boothName || 'Space')}</div>
    <div><b>When:</b> ${esc(window_)}</div>
    ${r.amountCents ? `<div><b>Amount:</b> $${((r.amountCents || 0) / 100).toFixed(2)}</div>` : ''}
  </div>
  <div class="terms">${esc(r.agreementText || 'No agreement text was captured for this booking.')}</div>
  <div class="sig">
    <div class="muted">Signature</div>
    <div class="name">${esc(r.agreementSignedName || '—')}</div>
    <div class="muted" style="margin-top:6px">Signed ${esc(signedAt)}${r.agreementSignedName ? ' · typed name = legal electronic signature' : ''}</div>
  </div>
</body></html>`;
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
    try {
      const res = await fetch('/api/booths/reserve', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'incidental', tenantId, reservationId: r.id, amountCents: cents, category: incidentalCat, note: incidentalDesc.trim() }),
      });
      const data = await res.json();
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
      // statement, which all filter on that field; (2) atomic batch so the
      // ledger entry and the reservation flag can't drift; (3) audit entry.
      const batch = writeBatch(firestore);
      const txnRef = doc(collection(firestore, 'tenants', tenantId, 'transactions'));
      batch.set(txnRef, {
        id: txnRef.id, type: 'income', context: 'Business', taxBucket: 'revenue',
        source: 'booth_rent',
        amount: (r.overageDueCents || 0) / 100, category: 'Booth Rent',
        description: `Overage — ${r.boothName || 'Space'} — ${r.name} (+${r.overageMinutes} min)`,
        clientOrVendor: r.name || 'Day renter', date: nowIso, paymentMethod: 'Collected in person',
        hasReceipt: false, sourceId: r.id, tenantId, createdAt: nowIso,
      });
      batch.update(doc(firestore, 'tenants', tenantId, 'boothReservations', r.id),
        { overageStatus: 'collected', overageCollectedAt: nowIso });
      const aRef = doc(collection(firestore, 'tenants', tenantId, 'auditLogs'));
      batch.set(aRef, { id: aRef.id, ...auditEntry({
        action: 'booth.overage_collected', targetType: 'transaction', targetId: txnRef.id,
        summary: `Overage collected in person: ${r.name || 'guest'} · ${r.boothName || 'space'} (+${r.overageMinutes || 0} min)`,
        amount: (r.overageDueCents || 0) / 100, actor: { type: 'user' },
      }) });
      await batch.commit();
      toast({ title: 'Overage collected', description: `$${((r.overageDueCents || 0) / 100).toFixed(2)} recorded in the ledger.` });
    } catch {
      toast({ variant: 'destructive', title: 'Could not record', description: 'Nothing was saved — try again.' });
    }
  };

const openReschedule = (r: any) => {
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
                <h2 className="text-xs font-black uppercase tracking-widest">Day Rentals</h2>
                <span className="h-5 min-w-5 px-1.5 bg-emerald-600 text-white text-[9px] font-black rounded-full flex items-center justify-center">{upcomingReservations.length}</span>
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                {upcomingReservations.map((r: any) => (
                  <div key={r.id} className={`rounded-2xl border-2 px-4 py-3 space-y-2 ${r.status === 'payment_received_conflict' || r.status === 'cancelled_refund_pending' ? 'border-red-300 bg-red-50' : r.status === 'cancel_requested' ? 'border-amber-300 bg-amber-50' : r.status === 'checked_in' ? 'border-indigo-300 bg-indigo-50/50' : 'border-emerald-200 bg-emerald-50/40'}`}>
                    <div className="flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="font-black text-sm truncate">
                          {r.name} <span className="font-bold text-muted-foreground normal-case text-xs">· {r.boothName}</span>
                          {TIER_BADGE[tierFor(r)] && (
                            <span className={`ml-1.5 align-middle text-[8px] font-black uppercase tracking-widest rounded-full px-1.5 py-0.5 ${TIER_BADGE[tierFor(r)].cls}`}>{TIER_BADGE[tierFor(r)].label}</span>
                          )}
                          {r.renterDiscountCents > 0 && (
                            <span className="ml-1 align-middle text-[8px] font-black uppercase tracking-widest rounded-full px-1.5 py-0.5 bg-indigo-50 text-indigo-600">−${(r.renterDiscountCents / 100).toFixed(0)}</span>
                          )}
                        </p>
                        <p className="text-[10px] font-bold text-slate-600 uppercase">{r.bookingType === 'hourly' ? `${r.startDate} · ${r.startTime}–${r.endTime}` : `${r.startDate} → ${r.endDate}`} · ${((r.amountCents || 0) / 100).toFixed(2)} paid{r.consentAccepted ? ' · ✓' : ''}</p>
                      </div>
                      <span className={`text-[8px] font-black uppercase tracking-widest rounded-full px-2 py-0.5 shrink-0 ${r.status === 'checked_in' ? 'bg-indigo-200 text-indigo-800' : r.status === 'confirmed' ? 'bg-emerald-200 text-emerald-800' : 'bg-red-200 text-red-800'}`}>
                        {r.status === 'checked_in' ? 'In' : r.status === 'confirmed' ? 'Upcoming' : 'Issue'}
                      </span>
                      {r.phone && <a href={`tel:${r.phone}`} className="text-[9px] font-black uppercase tracking-widest text-indigo-600 underline underline-offset-2 shrink-0">Call</a>}
                    </div>
                    {(r.status === 'payment_received_conflict' || r.status === 'cancelled_refund_pending') && (
                      <p className="text-[10px] font-black uppercase text-red-600">⚠ Refund needed · {r.stripePaymentIntentId || ''}</p>
                    )}
                    {r.status === 'cancel_requested' && (
                      <p className="text-[10px] font-black uppercase text-amber-700">Cancellation requested{r.cancelReason ? ` · "${r.cancelReason}"` : ''}</p>
                    )}
                    {r.noShow && (
                      <p className="text-[10px] font-black uppercase text-red-600">No-show — never checked in</p>
                    )}
                    {(r.licenseNumber || r.insuranceConfirmed || r.idAcknowledged || r.doingServices || r.licenseDocUrl || r.insuranceDocUrl || r.idDocUrl) && (
                      <div className="text-[10px] font-black uppercase text-slate-500 flex flex-wrap items-center gap-x-1.5 gap-y-1">
                        {r.doingServices && <span className="inline-flex items-center gap-1"><Scissors className="h-3 w-3" /> Services</span>}
                        {r.licenseNumber && <span>· Lic {r.licenseNumber}</span>}
                        {r.licenseDocUrl && <a href={r.licenseDocUrl} target="_blank" rel="noreferrer" className="text-indigo-600 underline inline-flex items-center gap-1">· <FileText className="h-3 w-3" /> License</a>}
                        {(r.insuranceConfirmed || r.insuranceDocUrl) && <span>· ✓ Insured</span>}
                        {r.insuranceDocUrl && <a href={r.insuranceDocUrl} target="_blank" rel="noreferrer" className="text-indigo-600 underline inline-flex items-center gap-1"><FileText className="h-3 w-3" /> COI</a>}
                        {r.idDocUrl ? <a href={r.idDocUrl} target="_blank" rel="noreferrer" className="text-indigo-600 underline inline-flex items-center gap-1">· <FileText className="h-3 w-3" /> ID</a> : r.idAcknowledged && <span>· ✓ ID</span>}
                      </div>
                    )}
                    {r.agreementSignedAt ? (
                      <div className="text-[10px] font-black uppercase text-emerald-700 flex flex-wrap items-center gap-x-1.5">
                        <span className="inline-flex items-center gap-1"><FileSignature className="h-3 w-3" /> Signed agreement · {r.agreementSignedName || 'guest'} · {new Date(r.agreementSignedAt).toLocaleDateString()}</span>
                        <button onClick={() => openSignedAgreement(r)} className="text-indigo-600 underline">View / print</button>
                      </div>
                    ) : (r.status === 'confirmed' || r.status === 'checked_in') && (
                      <p className="text-[10px] font-black uppercase text-amber-600">⚠ No signed agreement on file — capture one at check-in</p>
                    )}
                    {r.balanceDueCents > 0 && !r.balancePaid && (
                      <p className="text-[10px] font-black uppercase text-amber-600">
                        Deposit ${((r.depositCents || 0) / 100).toFixed(0)} paid · balance ${((r.balanceDueCents || 0) / 100).toFixed(2)} {r.balanceMode === 'at_checkin' ? 'at check-in' : 'due in person'}
                      </p>
                    )}
                    {r.status === 'checked_in' && r.actualCheckIn && (
                      <p className="text-[10px] font-black uppercase text-indigo-700">
                        In since {new Date(r.actualCheckIn).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                        {r.bookingType === 'hourly' && r.endTime ? ` · booked until ${r.endTime}` : ''}
                      </p>
                    )}
                    {r.overageStatus === 'due' && (
                      <p className="text-[10px] font-black uppercase text-red-600">Ran {r.overageMinutes} min over · ${((r.overageDueCents || 0) / 100).toFixed(2)} due</p>
                    )}
                    {r.creditDecision === 'pending' && r.potentialCreditCents > 0 && (
                      <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 space-y-1.5">
                        <p className="text-[10px] font-black uppercase text-emerald-700">Left {r.unusedMinutes} min early — issue ${(r.potentialCreditCents / 100).toFixed(2)} credit toward their next booking?</p>
                        <div className="flex gap-2">
                          <button onClick={() => issueCredit(r)} className="flex-1 h-7 rounded-lg bg-emerald-600 text-white font-black uppercase text-[9px] tracking-widest">Issue Credit</button>
                          <button onClick={() => declineCredit(r)} className="h-7 px-3 rounded-lg border font-black uppercase text-[9px] tracking-widest text-slate-500">No Credit</button>
                        </div>
                      </div>
                    )}
                    {r.creditDecision === 'issued' && r.creditIssuedCents > 0 && (
                      <p className="text-[10px] font-black uppercase text-emerald-600">✓ ${(r.creditIssuedCents / 100).toFixed(2)} credit issued — auto-applies to their next booking</p>
                    )}
                    {r.rescheduleRequestedAt && r.status === 'confirmed' && (
                      <p className="text-[10px] font-black uppercase text-indigo-600">Reschedule requested{r.rescheduleRequestNote ? ` — “${r.rescheduleRequestNote}”` : ''}</p>
                    )}
                    <div className="flex gap-2 items-center">
                      {/* PRIMARY action — one clear next step for this reservation's state */}
                      {r.status === 'confirmed' ? (
                        <button onClick={() => checkInRes(r)} className="flex-1 h-9 rounded-lg bg-indigo-600 text-white font-black uppercase text-[9px] tracking-widest">Check In</button>
                      ) : r.status === 'checked_in' ? (
                        <button onClick={() => checkOutRes(r)} className="flex-1 h-9 rounded-lg bg-slate-900 text-white font-black uppercase text-[9px] tracking-widest">Check Out</button>
                      ) : (r.overageStatus === 'due' && r.cardOnFile) ? (
                        <button onClick={() => chargeOverageToCard(r)} disabled={chargingId === r.id} className="flex-1 h-9 rounded-lg bg-red-600 text-white font-black uppercase text-[9px] tracking-widest disabled:opacity-40">{chargingId === r.id ? 'Charging…' : `Charge Card $${((r.overageDueCents || 0) / 100).toFixed(2)}`}</button>
                      ) : (r.overageStatus === 'due') ? (
                        <button onClick={() => markOverageCollected(r)} className="flex-1 h-9 rounded-lg bg-red-600 text-white font-black uppercase text-[9px] tracking-widest">{`Collect $${((r.overageDueCents || 0) / 100).toFixed(2)} → Ledger`}</button>
                      ) : r.status === 'cancel_requested' ? (
                        <button onClick={() => refundReservation(r)} disabled={refundingId === r.id} className="flex-1 h-9 rounded-lg bg-red-600 text-white font-black uppercase text-[9px] tracking-widest disabled:opacity-50">{refundingId === r.id ? 'Refunding…' : 'Approve → Refund'}</button>
                      ) : (r.status === 'payment_received_conflict' || r.status === 'cancelled_refund_pending') ? (
                        <button onClick={() => refundReservation(r)} disabled={refundingId === r.id} className="flex-1 h-9 rounded-lg bg-red-600 text-white font-black uppercase text-[9px] tracking-widest disabled:opacity-50">{refundingId === r.id ? 'Refunding…' : 'Refund via Stripe'}</button>
                      ) : (
                        <a href={`/api/booths/receipt?tenantId=${encodeURIComponent(tenantId)}&type=reservation&id=${encodeURIComponent(r.id)}`} target="_blank" rel="noreferrer" className="flex-1 h-9 rounded-lg border-2 font-black uppercase text-[9px] tracking-widest text-slate-600 flex items-center justify-center gap-1"><FileText className="h-3 w-3" /> Receipt</a>
                      )}
                      {/* Secondary actions tucked into one tidy menu */}
                      <OverflowMenu
                        align="right"
                        items={[
                          ...(r.status === 'confirmed' ? [
                            { label: 'Reschedule', onClick: () => openReschedule(r) },
                            { label: 'Cancel booking', danger: true, onClick: () => setResStatus(r, 'cancelled_refund_pending') },
                          ] : []),
                          ...(r.status === 'cancel_requested' ? [{ label: 'Decline request', onClick: () => setResStatus(r, 'confirmed') }] : []),
                          ...(r.overageStatus === 'due' && r.cardOnFile ? [{ label: 'Mark paid in person', onClick: () => markOverageCollected(r) }] : []),
                          ...(r.cardOnFile && !['cancel_requested', 'cancelled_refund_pending', 'payment_received_conflict'].includes(r.status) ? [{ label: incidentalForId === r.id ? 'Close incidental' : 'Add incidental charge', onClick: () => { setIncidentalForId(incidentalForId === r.id ? null : r.id); setIncidentalAmt(''); setIncidentalDesc(''); setIncidentalCat(''); } }] : []),
                          ...(['confirmed', 'checked_in', 'cancel_requested', 'payment_received_conflict', 'cancelled_refund_pending'].includes(r.status) || r.overageStatus === 'due'
                            ? [{ label: 'Open receipt', onClick: () => window.open(`/api/booths/receipt?tenantId=${encodeURIComponent(tenantId)}&type=reservation&id=${encodeURIComponent(r.id)}`, '_blank') }] : []),
                          ...(r.agreementSignedAt ? [{ label: 'Open signed agreement', onClick: () => openSignedAgreement(r) }] : []),
                          ...(['confirmed', 'checked_in'].includes(r.status) ? [{ label: 'Open guest check-in link', onClick: () => window.open(`/stay/${encodeURIComponent(tenantId)}/${encodeURIComponent(r.id)}`, '_blank') }] : []),
                        ]}
                      />
                    </div>
                    {incidentalForId === r.id && (() => {
                      const sel = incidentalPolicy.find((c: any) => c.label === incidentalCat) || null;
                      const capCents = sel ? Math.round(Number(sel.capCents) || 0) : 0;
                      const overCap = capCents > 0 && Math.round(parseFloat(incidentalAmt) * 100) > capCents;
                      return (
                        <div className="mt-2 rounded-xl border-2 border-slate-200 bg-slate-50 p-2.5 space-y-2">
                          <select value={incidentalCat} onChange={e => setIncidentalCat(e.target.value)} className="w-full h-9 rounded-lg border-2 px-2 text-xs font-black uppercase bg-white">
                            <option value="">Select a charge type…</option>
                            {incidentalPolicy.map((c: any) => <option key={c.label} value={c.label}>{c.label}{c.capCents ? ` — up to $${(c.capCents / 100).toFixed(0)}` : ''}</option>)}
                          </select>
                          <div className="flex gap-2">
                            <input type="number" inputMode="decimal" placeholder="$" value={incidentalAmt} onChange={e => setIncidentalAmt(e.target.value)} className={`w-20 h-9 rounded-lg border-2 px-2.5 text-sm font-bold ${overCap ? 'border-red-400' : ''}`} />
                            <input type="text" placeholder="Note (optional)" value={incidentalDesc} onChange={e => setIncidentalDesc(e.target.value)} className="flex-1 h-9 rounded-lg border-2 px-3 text-sm font-medium" />
                          </div>
                          {overCap && sel && <p className="text-[9px] font-black uppercase tracking-widest text-red-600">Over the ${(capCents / 100).toFixed(0)} cap for {sel.label}</p>}
                          <button onClick={() => chargeIncidentalToCard(r)} disabled={!incidentalCat || !(parseFloat(incidentalAmt) > 0) || overCap || incidentalBusyId === r.id} className="w-full h-9 rounded-lg bg-slate-900 text-white font-black uppercase text-[9px] tracking-widest disabled:opacity-40">
                            {incidentalBusyId === r.id ? 'Charging…' : `Charge card${parseFloat(incidentalAmt) > 0 ? ` $${parseFloat(incidentalAmt).toFixed(2)}` : ''}`}
                          </button>
                          <p className="text-[9px] font-bold text-muted-foreground">Only your policy's charge types, each capped — no made-up charges. Records under “Renter Incidental” in the ledger.</p>
                        </div>
                      );
                    })()}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── PEOPLE — one directory. Renters, regulars, guests, and leads
              are the same humans at different stages of one journey, so they
              live in ONE searchable list. Filter chips slice it; renters get
              the full management card, everyone else a contact card. ── */}
    </div>
  );
}
