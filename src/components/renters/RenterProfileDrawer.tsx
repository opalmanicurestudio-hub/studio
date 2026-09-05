"use client";

/**
 * The renter's full card — leases, money, documents, activity.
 *
 * Lifted VERBATIM from the booth hub (its 490 lines are unchanged below) so
 * it can be mounted anywhere without duplicating logic. During the migration
 * the hub and /renters both render THIS file: one truth, zero drift. Every
 * outside dependency arrives through props — the component owns presentation
 * and its own tab state, never data fetching.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { collection } from 'firebase/firestore';
import { useTenant } from '@/context/TenantContext';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { auditEntry } from '@/lib/audit';
import { getDocs, query, where, doc, setDoc } from 'firebase/firestore';
import { Badge } from '@/components/ui/badge';
import { Coffee, CreditCard, FileText, Paperclip, X } from 'lucide-react';
import type { Renter, Lease, Booth } from '@/lib/booth-rental-types';
import { formatCents, RENTER_STATUS_LABELS } from '@/lib/booth-rental-types';

const BOOTH_DEFAULT_INCIDENTALS: { label: string; capCents: number }[] = [
  { label: 'Cleaning fee', capCents: 7500 },
  { label: 'Damage', capCents: 50000 },
  { label: 'Lost key / fob', capCents: 2500 },
  { label: 'Late checkout', capCents: 5000 },
  { label: 'Missing product / supplies', capCents: 15000 },
];

// ── Duplicated from the booth hub (byte-for-byte, per repo convention: no
// cross-route imports). If one of these changes there, change it here.
const fmtStamp = (v: any): string => {
  const s = typeof v === 'string' ? v : '';
  if (!s) return '';
  try {
    if (s.length > 10) return new Date(s).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
    return new Date(s + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return s.slice(0, 16); }
};

const resolveBoothIncidentalPolicy = (tenant: any): { label: string; capCents: number }[] => {
  const saved = tenant?.incidentalCategories;
  return (Array.isArray(saved) && saved.length) ? saved : BOOTH_DEFAULT_INCIDENTALS;
};

const writeBoothAudit = (firestore: any, tenantId: string, e: any) => {
  try {
    const aRef = doc(collection(firestore, 'tenants', tenantId, 'auditLogs'));
    setDoc(aRef, { id: aRef.id, ...auditEntry(e) }).catch(() => {});
  } catch { /* non-fatal */ }
};

function complianceOf(r: any): { items: { label: string; number: string; expiry: string; state: string }[]; worst: string } {
  const judge = (expiry: any): string => {
    if (!expiry) return 'missing';
    const days = Math.floor((new Date(expiry + 'T00:00:00Z').getTime() - Date.now()) / 86400000);
    if (days < 0) return 'expired';
    if (days <= 30) return 'expiring';
    return 'ok';
  };
  const items: { label: string; number: string; expiry: string; state: string; fileUrl?: string; fileName?: string }[] = [];
  if (Array.isArray(r.credentials)) {
    for (const cr of r.credentials) {
      if (!cr?.label) continue;
      items.push({ label: cr.label, number: cr.number || '', expiry: cr.expiry || '', state: judge(cr.expiry), fileUrl: cr.fileUrl || '', fileName: cr.fileName || '' });
    }
  }
  // Legacy fields from the first compliance version — still honored
  if (items.length === 0) {
    if (r.licenseExpiry || r.licenseNumber) items.push({ label: 'Professional license', number: r.licenseNumber || '', expiry: r.licenseExpiry || '', state: judge(r.licenseExpiry) });
    if (r.insuranceExpiry || r.insuranceCarrier) items.push({ label: `Liability insurance${r.insuranceCarrier ? ` (${r.insuranceCarrier})` : ''}`, number: '', expiry: r.insuranceExpiry || '', state: judge(r.insuranceExpiry) });
  }
  const rank: Record<string, number> = { expired: 0, expiring: 1, missing: 2, ok: 3 };
  const worst = items.length === 0 ? 'none' : items.reduce((w, it) => rank[it.state] < rank[w] ? it.state : w, 'ok');
  return { items, worst };
}

export function RenterProfileDrawer({
  renter, lease, booth, reservations, amenityRequests, w9, tenantId, firestore,
  onClose, onEdit, onLease, onEndLease, contactNote, onSaveNote,
  onRecordPayment, onAddCard,
}: {
  renter: Renter;
  lease?: Lease;
  booth?: Booth;
  reservations: any[];
  amenityRequests?: any[];
  w9: any;
  tenantId: string;
  firestore: any;
  onClose: () => void;
  onEdit: () => void;
  onLease: () => void;
  onEndLease: () => void;
  contactNote?: string;
  onSaveNote?: (note: string) => void;
  onRecordPayment?: (() => void) | null;
  onAddCard?: () => void;
}) {
  const [ptab, setPtab] = useState<'overview' | 'money' | 'documents' | 'activity'>('overview');
  const [noteDraft, setNoteDraft] = useState<string>(contactNote || '');
  const [chargeAmt, setChargeAmt] = useState('');
  const [chargeCat, setChargeCat] = useState('');
  const [chargeNote, setChargeNote] = useState('');
  const [renterChargingId, setRenterChargingId] = useState<string | null>(null);
  const { toast: drawerToast } = useToast();
  const { selectedTenant: drawerTenant } = useTenant();
  // Constrained to the studio's capped incidentals policy — no made-up charges.
  const chargePolicy = resolveBoothIncidentalPolicy(drawerTenant);
  const chargeCatObj = chargePolicy.find((c: any) => c.label === chargeCat) || null;
  const chargeCapCents = chargeCatObj ? Math.round(Number(chargeCatObj.capCents) || 0) : 0;
  const chargeCents = Math.round((parseFloat(chargeAmt) || 0) * 100);
  const chargeOverCap = chargeCapCents > 0 && chargeCents > chargeCapCents;
  const chargeRenterCard = async (rt: Renter) => {
    if (!(chargeCents >= 50) || !chargeCat || chargeOverCap || renterChargingId) return;
    setRenterChargingId(rt.id);
    try {
      // Hardened monthly-renter path: same capped policy as day/hourly renters,
      // enforced server-side (setup-card PUT validates category + cap).
      const res = await fetch('/api/booths/setup-card', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, renterId: rt.id, amountCents: chargeCents, category: chargeCat, note: chargeNote.trim() }),
      });
      const d = await res.json();
      if (d.ok) {
        const label = chargeCat + (chargeNote.trim() ? ` — ${chargeNote.trim()}` : '');
        setChargeAmt(''); setChargeCat(''); setChargeNote('');
        drawerToast({ title: 'Card charged', description: `$${(d.chargedCents / 100).toFixed(2)} — ${chargeCat} recorded in the ledger.` });
        writeBoothAudit(firestore, tenantId, {
          action: 'booth.renter_charged', targetType: 'renter', targetId: rt.id,
          summary: `Card on file charged: ${rt.firstName || ''} ${rt.lastName || ''}`.trim() + ` — ${label}`,
          amount: (d.chargedCents || chargeCents) / 100, actor: { type: 'user' },
        });
      } else {
        drawerToast({ variant: 'destructive', title: 'Charge failed', description: d.error || 'Try again or collect another way.' });
      }
    } catch {
      drawerToast({ variant: 'destructive', title: 'Network error', description: 'The charge may not have completed — check Stripe before retrying.' });
    }
    finally { setRenterChargingId(null); }
  };
  const [txns, setTxns] = useState<any[] | null>(null);

  const fullName = `${renter.firstName} ${renter.lastName}`.trim();

  // This renter's day rentals — matched by phone/email
  const myReservations = useMemo(() =>
    reservations.filter(r =>
      (renter.phone && r.phone === renter.phone) ||
      (renter.email && r.email === renter.email)
    ).sort((a, b) => (b.startDate || '').localeCompare(a.startDate || '')),
    [reservations, renter.phone, renter.email]);

  // This renter's concierge amenity orders (their clients order to their booth,
  // stamped with renterId). Newest first.
  const myAmenity = useMemo(() =>
    (amenityRequests || [])
      .filter(a => a.renterId && a.renterId === renter.id)
      .sort((a, b) => String(b.requestedAt || '').localeCompare(String(a.requestedAt || ''))),
    [amenityRequests, renter.id]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const byName = await getDocs(query(
          collection(firestore, 'tenants', tenantId, 'transactions'),
          where('source', '==', 'booth_rent'),
          where('clientOrVendor', '==', fullName)));
        if (cancelled) return;
        setTxns(byName.docs.map(d => ({ id: d.id, ...(d.data() as any) }))
          .sort((a, b) => ((b.date || b.createdAt || '') + '').localeCompare((a.date || a.createdAt || '') + '')));
      } catch { if (!cancelled) setTxns([]); }
    })();
    return () => { cancelled = true; };
  }, [firestore, tenantId, fullName]);

  const dollars = (t: any) => typeof t.amount === 'number' ? t.amount : (Number(t.amountCents) || 0) / 100;
  const dateStr = (v: any) => {
    if (!v) return '';
    if (typeof v === 'string') return v.slice(0, 10);
    if (typeof v?.toDate === 'function') { try { return v.toDate().toISOString().slice(0, 10); } catch { return ''; } }
    if (typeof v?.seconds === 'number') return new Date(v.seconds * 1000).toISOString().slice(0, 10);
    return '';
  };
  // Full-precision stamp (keeps the TIME) for events that were actually
  // logged — timelines show the real moment, not just the day.
  const stampStr = (v: any) => {
    if (!v) return '';
    if (typeof v === 'string') return v;
    if (typeof v?.toDate === 'function') { try { return v.toDate().toISOString(); } catch { return ''; } }
    if (typeof v?.seconds === 'number') return new Date(v.seconds * 1000).toISOString();
    return '';
  };
  const thisYear = new Date().getFullYear().toString();
  const ytdTotal = useMemo(() => {
    const fromTxns = (txns || []).filter(t => dateStr(t.date || t.createdAt).startsWith(thisYear)).reduce((s, t) => s + dollars(t), 0);
    const fromRes = myReservations.filter(r => ['confirmed','checked_in','completed'].includes(r.status) && (r.startDate || '').startsWith(thisYear)).reduce((s, r) => s + (r.amountCents || 0) / 100, 0);
    return fromTxns + fromRes;
  }, [txns, myReservations, thisYear]);

  // Activity timeline: lease events + reservation lifecycle stamps
  const activity = useMemo(() => {
    const items: { at: string; label: string }[] = [];
    if ((renter as any).appliedAt) items.push({ at: String((renter as any).appliedAt).slice(0, 10), label: 'Applied via website' });
    if (lease) {
      if (lease.startDate) items.push({ at: lease.startDate, label: `Lease started · ${booth?.name ?? ''}` });
      if (lease.endDate) items.push({ at: lease.endDate, label: `Lease ends · ${booth?.name ?? ''}` });
    }
    myReservations.forEach(r => {
      if (r.createdAt) items.push({ at: stampStr(r.createdAt), label: `Booked ${r.boothName} (${r.startDate} → ${r.endDate})` });
      if (r.checked_inAt) items.push({ at: stampStr(r.checked_inAt), label: `Checked in · ${r.boothName}` });
      if (r.completedAt) items.push({ at: stampStr(r.completedAt), label: `Completed stay · ${r.boothName}` });
      if (r.cancelled_refund_pendingAt) items.push({ at: stampStr(r.cancelled_refund_pendingAt), label: `Cancelled — refund pending · ${r.boothName}` });
    });
    // Real logged events — signed lease + every status change with its
    // recorded timestamp (statusHistory is written the moment status changes).
    if ((lease as any)?.signedAt) items.push({ at: stampStr((lease as any).signedAt), label: `Signed lease · ${booth?.name ?? ''}` });
    for (const h of (Array.isArray((renter as any).statusHistory) ? (renter as any).statusHistory : [])) {
      if (h?.at && h?.to) items.push({ at: stampStr(h.at), label: `Status: ${RENTER_STATUS_LABELS[h.from] ?? h.from ?? '—'} → ${RENTER_STATUS_LABELS[h.to] ?? h.to}` });
    }
    // Money events from their ledger — payments recorded (cash, card, Zelle…).
    for (const t of (txns || [])) {
      const at = stampStr(t.date || t.createdAt);
      if (at && (t.type === 'income' || typeof t.amount === 'number')) {
        items.push({ at, label: `${t.category === 'Booth Rent' || /rent/i.test(t.description || '') ? 'Rent' : t.category || 'Payment'} $${(typeof t.amount === 'number' ? t.amount : (Number(t.amountCents) || 0) / 100).toFixed(2)}${t.paymentMethod ? ` · ${t.paymentMethod}` : ''}` });
      }
    }
    return items.filter(i => i.at).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 40);
  }, [lease, booth, myReservations, renter, txns]);

  const PTABS = [
    { id: 'overview', label: 'Overview' },
    { id: 'money', label: 'Money' },
    { id: 'documents', label: 'Docs' },
    { id: 'activity', label: 'Activity' },
  ] as const;

  return (
    <div className="fixed inset-0 z-[70] flex justify-end">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={onClose} />
      <div className="relative w-full sm:w-[420px] h-full bg-white shadow-2xl flex flex-col animate-in slide-in-from-right duration-200">
        {/* Header — identity banner: who they are + the three numbers that
            matter, readable in one glance. Dark gradient so the profile feels
            like a card, not a form. */}
        <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-950 text-white px-5 pt-5 pb-0">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3.5 min-w-0">
              {(renter as any).avatarUrl ? (
                <img src={(renter as any).avatarUrl} alt="" className="w-14 h-14 rounded-2xl object-cover shrink-0 ring-2 ring-white/30" />
              ) : (
                <div className="w-14 h-14 rounded-2xl bg-white/10 ring-2 ring-white/20 text-white flex items-center justify-center font-black text-xl shrink-0">
                  {(renter.firstName || '?').charAt(0).toUpperCase()}
                </div>
              )}
              <div className="min-w-0">
                <p className="font-black text-lg leading-tight truncate">{fullName}</p>
                {renter.businessName && <p className="text-[10px] font-bold text-white/50 truncate">{renter.businessName}{renter.specialty ? ` · ${renter.specialty}` : ''}</p>}
                {!renter.businessName && renter.specialty && <p className="text-[10px] font-bold text-white/50 truncate">{renter.specialty}</p>}
                <div className="flex gap-1.5 mt-1.5 flex-wrap">
                  <span className={`text-[8px] font-black uppercase tracking-widest rounded-full px-2 py-0.5 ${renter.status === 'active' ? 'bg-emerald-400/20 text-emerald-300' : 'bg-white/10 text-white/60'}`}>{RENTER_STATUS_LABELS[renter.status] ?? renter.status}</span>
                  {(renter as any).linkedStaffId && <span className="text-[8px] font-black uppercase tracking-widest rounded-full px-2 py-0.5 bg-violet-400/20 text-violet-300">Hybrid</span>}
                  {w9 ? <span className="text-[8px] font-black uppercase tracking-widest rounded-full px-2 py-0.5 bg-emerald-400/20 text-emerald-300">✓ W-9</span> : w9 === null ? <span className="text-[8px] font-black uppercase tracking-widest rounded-full px-2 py-0.5 bg-amber-400/20 text-amber-300">⚠ W-9</span> : null}
                  {(renter as any).cardOnFile && <span className="text-[8px] font-black uppercase tracking-widest rounded-full px-2 py-0.5 bg-sky-400/20 text-sky-300">Card on file</span>}
                </div>
              </div>
            </div>
            <button onClick={onClose} className="h-9 w-9 rounded-xl bg-white/10 hover:bg-white/20 flex items-center justify-center text-white/70 shrink-0 transition-colors"><X className="h-4 w-4" /></button>
          </div>

          {/* The three numbers: station · rent · YTD value */}
          <div className="grid grid-cols-3 gap-2 mt-4">
            <div className="rounded-xl bg-white/[0.07] px-2.5 py-2">
              <p className="text-[7px] font-black uppercase tracking-[0.2em] text-white/40">Station</p>
              <p className="text-sm font-black truncate">{booth?.name || '—'}</p>
            </div>
            <div className="rounded-xl bg-white/[0.07] px-2.5 py-2">
              <p className="text-[7px] font-black uppercase tracking-[0.2em] text-white/40">Rent</p>
              <p className="text-sm font-black truncate">{lease ? `${formatCents(lease.rentAmountCents)}/${(lease.frequency || 'mo').slice(0, 2)}` : '—'}</p>
            </div>
            <div className="rounded-xl bg-white/[0.07] px-2.5 py-2">
              <p className="text-[7px] font-black uppercase tracking-[0.2em] text-white/40">This year</p>
              <p className="text-sm font-black truncate text-emerald-300">${ytdTotal.toFixed(0)}</p>
            </div>
          </div>

          <div className="flex gap-2 mt-3">
            <button onClick={onEdit} className="flex-1 h-9 rounded-xl bg-white/10 hover:bg-white/20 font-black uppercase text-[9px] tracking-widest text-white/90 transition-colors">Edit</button>
            {renter.phone && <a href={`tel:${renter.phone}`} className="flex-1 h-9 rounded-xl bg-white/10 hover:bg-white/20 font-black uppercase text-[9px] tracking-widest text-white/90 flex items-center justify-center transition-colors">Call</a>}
            {renter.phone && <a href={`sms:${renter.phone}`} className="flex-1 h-9 rounded-xl bg-white/10 hover:bg-white/20 font-black uppercase text-[9px] tracking-widest text-white/90 flex items-center justify-center transition-colors">Text</a>}
            {renter.email && <a href={`mailto:${renter.email}`} className="flex-1 h-9 rounded-xl bg-white/10 hover:bg-white/20 font-black uppercase text-[9px] tracking-widest text-white/90 flex items-center justify-center transition-colors">Email</a>}
          </div>

          <div className="flex gap-0 mt-3">
            {PTABS.map(t => (
              <button key={t.id} onClick={() => setPtab(t.id)}
                className={`px-3.5 py-2.5 text-[10px] font-black uppercase tracking-widest transition-colors rounded-t-xl ${ptab === t.id ? 'bg-white text-slate-900' : 'text-white/50 hover:text-white/80'}`}>
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {ptab === 'overview' && (
            <>
              <div className="rounded-2xl border-2 p-4 space-y-2">
                <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Contact</p>
                {renter.email && <p className="text-xs font-bold">{renter.email}</p>}
                {renter.phone && <p className="text-xs font-bold">{renter.phone}</p>}
                {renter.specialty && <p className="text-[10px] font-bold text-muted-foreground">{renter.specialty}</p>}
                {renter.notes && <p className="text-[11px] text-muted-foreground leading-relaxed border-t pt-2">{renter.notes}</p>}
              </div>

              {(() => {
                const comp = complianceOf(renter as any);
                const STYLE: Record<string, string> = { ok: 'text-emerald-600', expiring: 'text-amber-600', expired: 'text-red-600', missing: 'text-slate-400' };
                const WORD: Record<string, (d: string) => string> = {
                  ok: d => `valid · exp ${d}`, expiring: d => `expires ${d}`, expired: d => `EXPIRED ${d}`, missing: () => 'no expiry on file',
                };
                return (
                  <div className={`rounded-2xl border-2 p-4 space-y-1.5 ${comp.worst === 'ok' || comp.worst === 'none' ? '' : comp.worst === 'expiring' ? 'border-amber-200 bg-amber-50/50' : 'border-red-200 bg-red-50/50'}`}>
                    <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Credentials & compliance</p>
                    {comp.items.length === 0 ? (
                      <p className="text-xs font-bold text-slate-400">Nothing tracked yet — add credentials via Edit.</p>
                    ) : comp.items.map((it, i) => (
                      <p key={i} className="text-xs font-bold flex items-center gap-1.5 flex-wrap">
                        <span>{it.label}{it.number ? ` #${it.number}` : ''}: <span className={STYLE[it.state]}>{WORD[it.state](it.expiry)}</span></span>
                        {(it as any).fileUrl && <a href={(it as any).fileUrl} target="_blank" rel="noreferrer" className="text-[10px] font-black uppercase tracking-widest text-indigo-600 inline-flex items-center gap-0.5"><FileText className="h-3 w-3" /> File</a>}
                      </p>
                    ))}
                  </div>
                );
              })()}
              {lease && booth ? (
                <div className="rounded-2xl border-2 border-slate-800 bg-slate-900 text-white p-4 space-y-2">
                  <p className="text-[9px] font-black uppercase tracking-widest text-white/50">Current lease</p>
                  <p className="font-black text-sm uppercase">{booth.name}</p>
                  <p className="text-xs font-bold text-white/80">{formatCents(lease.rentAmountCents)}/{lease.frequency} · {lease.endDate ? `ends ${lease.endDate}` : 'month-to-month'}</p>
                  <button onClick={onEndLease} className="text-[9px] font-black uppercase tracking-widest text-red-300 underline underline-offset-2">End lease</button>
                </div>
              ) : (
                <button onClick={onLease} className="w-full h-11 rounded-2xl border-2 border-dashed font-black uppercase text-[10px] tracking-widest text-muted-foreground hover:border-slate-400">
                  + Assign a space
                </button>
              )}
              {(renter as any).amenitiesEnabled && lease?.boothId && (() => {
                const link = `${typeof window !== 'undefined' ? window.location.origin : ''}/concierge/${tenantId}?booth=${lease.boothId}`;
                return (
                  <div className="rounded-2xl border-2 border-amber-200 bg-amber-50/50 p-4 space-y-2">
                    <p className="text-[9px] font-black uppercase tracking-widest text-amber-700 flex items-center gap-1.5"><Coffee className="h-3 w-3" /> Client concierge</p>
                    <p className="text-[10px] font-medium text-muted-foreground">Their clients scan or open this to order amenities to {booth?.name || 'their booth'}. {(renter as any).amenityPayer === 'client' ? 'Client pays for anything over the free allowance.' : 'Extras charge this renter’s card.'}</p>
                    <div className="flex items-center gap-2">
                      <input readOnly value={link} className="flex-1 h-8 rounded-lg border-2 px-2 text-[10px] font-mono bg-white truncate" onFocus={(e) => e.currentTarget.select()} />
                      <button onClick={() => { navigator.clipboard?.writeText(link).catch(() => {}); }} className="h-8 px-3 rounded-lg bg-slate-900 text-white font-black uppercase text-[9px] tracking-widest shrink-0">Copy</button>
                    </div>
                  </div>
                );
              })()}
              {(renter as any).portalEnabled && (
                <div className="rounded-2xl border-2 border-emerald-200 bg-emerald-50 p-3">
                  <p className="text-[9px] font-black uppercase tracking-widest text-emerald-700">Portal active · PIN {(renter as any).portalPin}</p>
                </div>
              )}

              {/* Shared owner notes — the same journey note a lead carries, so a
                  contact's notes follow them from lead to renter. */}
              {onSaveNote && (
                <div className="rounded-2xl border-2 p-4 space-y-1.5">
                  <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Notes</p>
                  <textarea value={noteDraft} onChange={e => setNoteDraft(e.target.value)} onBlur={() => { if ((noteDraft || '') !== (contactNote || '')) onSaveNote(noteDraft); }} rows={2} placeholder="Private notes about this person — carried across their whole journey…" className="w-full rounded-xl border-2 px-3 py-2 text-sm font-medium resize-none" />
                </div>
              )}

              {/* v71 — card on file + incidental charge (v86: capped policy picker,
                  no made-up charges — same policy the day/hourly path enforces) */}
              {(renter as any).cardOnFile ? (
                <div className="rounded-2xl border-2 p-4 space-y-2">
                  <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">
                    Card on file{(renter as any).cardBrand ? ` · ${(renter as any).cardBrand} ····${(renter as any).cardLast4}` : ' · Stripe'}
                  </p>
                  <select
                    value={chargeCat}
                    onChange={e => { setChargeCat(e.target.value); const c = chargePolicy.find((x: any) => x.label === e.target.value); if (c && c.capCents > 0 && chargeCents > c.capCents) setChargeAmt((c.capCents / 100).toFixed(0)); }}
                    className="w-full h-10 rounded-xl border-2 px-3 text-sm font-bold bg-white"
                  >
                    <option value="">Select charge type…</option>
                    {chargePolicy.map((c: any) => (
                      <option key={c.label} value={c.label}>{c.label}{c.capCents > 0 ? ` — up to $${(c.capCents / 100).toFixed(0)}` : ''}</option>
                    ))}
                  </select>
                  <div className="grid grid-cols-[90px_1fr] gap-2">
                    <input type="number" inputMode="decimal" placeholder="$" value={chargeAmt}
                      onChange={e => setChargeAmt(e.target.value)}
                      className={`h-10 rounded-xl border-2 px-3 text-sm font-bold ${chargeOverCap ? 'border-red-400 text-red-600' : ''}`} />
                    <input type="text" placeholder="Note (optional)" value={chargeNote}
                      onChange={e => setChargeNote(e.target.value)}
                      className="h-10 rounded-xl border-2 px-3 text-sm font-medium" />
                  </div>
                  {chargeOverCap && (
                    <p className="text-[9px] font-black uppercase tracking-widest text-red-600">Over the ${(chargeCapCents / 100).toFixed(0)} cap for {chargeCat}</p>
                  )}
                  <button
                    onClick={() => chargeRenterCard(renter)}
                    disabled={!(chargeCents >= 50) || !chargeCat || chargeOverCap || renterChargingId === renter.id}
                    className="w-full h-10 rounded-xl bg-slate-900 text-white font-black uppercase text-[9px] tracking-widest disabled:opacity-40"
                  >
                    {renterChargingId === renter.id ? 'Charging…' : `Charge Card${chargeCents >= 50 ? ` $${(chargeCents / 100).toFixed(2)}` : ''}`}
                  </button>
                  <p className="text-[9px] font-bold text-muted-foreground">Only your policy's charge types, each capped. Charges off-session and records under "Renter Incidental" in the ledger.</p>
                </div>
              ) : (
                <div className="rounded-2xl border-2 border-dashed p-3">
                  <p className="text-[10px] font-bold text-muted-foreground">No card on file yet — it's saved automatically the first time this renter pays rent online, or they can add one in their portal. Once on file, capped incidentals charge from right here.</p>
                </div>
              )}
            </>
          )}

          {ptab === 'money' && (
            <>
              <div className="rounded-2xl bg-slate-900 text-white px-4 py-3">
                <p className="text-[9px] font-black uppercase tracking-widest text-white/50">{thisYear} total paid</p>
                <p className="text-2xl font-black tracking-tighter">${ytdTotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}</p>
              </div>
              {/* Money actions — record a payment or get their card on file,
                  right where you're already looking at their money. */}
              <div className="grid grid-cols-2 gap-2">
                {onRecordPayment && (
                  <button onClick={onRecordPayment} className="h-11 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-black uppercase text-[9px] tracking-widest transition-colors">
                    Record payment
                  </button>
                )}
                {(renter as any).cardOnFile ? (
                  <div className="h-11 rounded-2xl border-2 border-emerald-200 bg-emerald-50 flex items-center justify-center gap-1.5 text-[9px] font-black uppercase tracking-widest text-emerald-700">
                    <CreditCard className="h-3.5 w-3.5" /> {(renter as any).cardBrand || 'Card'} ····{(renter as any).cardLast4 || ''}
                  </div>
                ) : onAddCard ? (
                  <button onClick={onAddCard} className="h-11 rounded-2xl border-2 border-indigo-300 text-indigo-700 hover:bg-indigo-50 font-black uppercase text-[9px] tracking-widest transition-colors flex items-center justify-center gap-1.5">
                    <CreditCard className="h-3.5 w-3.5" /> Add card on file
                  </button>
                ) : null}
              </div>

              {/* Autopay — the switch that never existed. The cron has always
                  required renter.autopayEnabled and nothing ever set it, so no
                  renter has ever been drafted. Only enableable with a card on
                  file, and it says which card, so what will be charged is
                  never a guess. */}
              {(() => {
                const r: any = renter;
                const hasCard = !!(r.cardOnFile && r.stripeCustomerId && (r.stripePaymentMethodId || r.defaultPaymentMethodId));
                const on = r.autopayEnabled === true;
                const toggle = async () => {
                  if (!hasCard && !on) { drawerToast({ title: 'No card on file', description: 'Add a card first — autopay needs something to draft from.' }); return; }
                  try {
                    await setDoc(doc(firestore, 'tenants', tenantId, 'renters', r.id), {
                      autopayEnabled: !on,
                      autopayChangedAt: new Date().toISOString(),
                      autopayChangedBy: 'owner',
                    }, { merge: true });
                    writeBoothAudit(firestore, tenantId, {
                      action: !on ? 'renter.autopay_on' : 'renter.autopay_off', targetType: 'renter', targetId: r.id,
                      summary: `${!on ? 'Turned on' : 'Turned off'} autopay for ${r.firstName || ''} ${r.lastName || ''}`.trim(),
                      actor: { type: 'user' },
                    });
                    drawerToast({ title: !on ? 'Autopay on' : 'Autopay off', description: !on ? 'Rent drafts on each due day from the card on file.' : 'They pay by hand from now on.' });
                  } catch {
                    drawerToast({ title: 'Could not save', description: 'Try again in a moment.' });
                  }
                };
                return (
                  <button type="button" onClick={toggle} aria-pressed={on}
                    className={cn('w-full rounded-2xl border-2 px-4 py-3 flex items-center justify-between gap-3 text-left transition-colors',
                      on ? 'border-emerald-300 bg-emerald-50' : 'bg-white')}>
                    <span className="min-w-0">
                      <span className="block text-[11px] font-black uppercase tracking-widest">Autopay</span>
                      <span className="block text-[10px] font-bold text-muted-foreground">
                        {on
                          ? `Drafts rent on each due day from ${r.cardBrand || 'the card'} ····${r.cardLast4 || ''}.`
                          : hasCard ? `Off — pays by hand. Card ····${r.cardLast4 || ''} is on file if you want to turn it on.`
                          : 'Off — no card on file yet.'}
                      </span>
                    </span>
                    <span className={cn('shrink-0 rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-widest',
                      on ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-500')}>
                      {on ? 'On' : 'Off'}
                    </span>
                  </button>
                );
              })()}

              {txns === null ? <p className="text-xs text-muted-foreground text-center py-4">Loading…</p> : (
                <>
                  {(txns.length + myReservations.length) === 0 && <p className="text-xs text-muted-foreground text-center py-4">No payments on record.</p>}
                  {myReservations.filter(r => ['confirmed','checked_in','completed'].includes(r.status)).map(r => (
                    <div key={r.id} className="rounded-xl border-2 px-3.5 py-2.5 flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-black truncate">Day rental · {r.boothName}</p>
                        <p className="text-[10px] font-bold text-muted-foreground">{r.startDate} → {r.endDate}</p>
                      </div>
                      <p className="font-black text-emerald-700 text-sm shrink-0">${((r.amountCents || 0) / 100).toFixed(2)}</p>
                    </div>
                  ))}
                  {txns.map(t => (
                    <div key={t.id} className="rounded-xl border-2 px-3.5 py-2.5 flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-black truncate">{t.description || 'Booth rent'}</p>
                        <p className="text-[10px] font-bold text-muted-foreground truncate">
                          {(() => { try { return new Date(t.date || t.createdAt).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }); } catch { return dateStr(t.date || t.createdAt); } })()}
                          {t.paymentMethod ? ` · ${t.paymentMethod}` : ''}
                        </p>
                      </div>
                      <p className="font-black text-emerald-700 text-sm shrink-0">${dollars(t).toFixed(2)}</p>
                    </div>
                  ))}
                </>
              )}

              {myAmenity.length > 0 && (
                <div className="space-y-2 pt-1">
                  <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground px-1 flex items-center gap-1.5">Amenity orders · {myAmenity.length}</p>
                  {myAmenity.slice(0, 20).map((a: any) => {
                    const when = (() => { try { return new Date(a.requestedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); } catch { return ''; } })();
                    const tag = a.compedByRenter ? { t: 'Comped', c: 'bg-green-100 text-green-700' }
                      : a.chargedToStation ? { t: 'Charged to card', c: 'bg-slate-900 text-white' }
                      : (Number(a.priceAtRequest) > 0 ? { t: 'Client paid', c: 'bg-emerald-100 text-emerald-700' } : { t: 'Complimentary', c: 'bg-sky-100 text-sky-700' });
                    const statusTag = a.status === 'delivered' ? 'Delivered' : a.status === 'cancelled' ? 'Cancelled' : 'Pending';
                    return (
                      <div key={a.id} className="rounded-xl border-2 px-3.5 py-2.5 flex items-center gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-black truncate">{a.quantity > 1 ? `${a.quantity}× ` : ''}{a.itemName || 'Amenity'}</p>
                          <p className="text-[10px] font-bold text-muted-foreground truncate">{when}{a.clientName ? ` · ${a.clientName}` : ''} · {statusTag}</p>
                        </div>
                        <span className={`text-[8px] font-black uppercase tracking-widest rounded-full px-1.5 py-0.5 shrink-0 ${tag.c}`}>{tag.t}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {ptab === 'documents' && (
            <>
              <div className={`rounded-2xl border-2 p-4 space-y-1 ${w9 ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}>
                <p className={`text-[9px] font-black uppercase tracking-widest ${w9 ? 'text-emerald-700' : 'text-amber-700'}`}>{w9 ? 'W-9 on file ✓' : 'W-9 missing'}</p>
                {w9 ? (
                  <p className="text-xs font-bold text-emerald-800">{w9.legalName} · TIN {w9.tinMasked}</p>
                ) : (
                  <p className="text-[11px] text-amber-700">Renter completes this in their portal → Documents tab.</p>
                )}
              </div>
              {Array.isArray((renter as any).applicationAttachments) && (renter as any).applicationAttachments.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground px-1">Application documents</p>
                  {(renter as any).applicationAttachments.map((at: any) => (
                    <a key={at.url} href={at.url} target="_blank" rel="noreferrer"
                      className="rounded-xl border-2 px-3.5 py-2.5 flex items-center justify-between hover:border-slate-400 transition-colors">
                      <p className="text-xs font-black truncate flex items-center gap-1.5"><Paperclip className="h-3 w-3 shrink-0" /> {at.label || at.name || 'Document'}</p>
                      <span className="text-[9px] font-black uppercase tracking-widest text-indigo-600 shrink-0">Open →</span>
                    </a>
                  ))}
                </div>
              )}
              <div className="space-y-2">
                <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground px-1">Annual statements</p>
                {[new Date().getFullYear(), new Date().getFullYear()-1].map(yr => (
                  <a key={yr} href={`/api/booths/statement?tenantId=${encodeURIComponent(tenantId)}&renterId=${encodeURIComponent(renter.id)}&year=${yr}`} target="_blank" rel="noreferrer"
                    className="rounded-xl border-2 px-3.5 py-2.5 flex items-center justify-between hover:border-slate-400 transition-colors">
                    <p className="text-xs font-black">{yr} Rent Statement</p>
                    <span className="text-[9px] font-black uppercase tracking-widest text-indigo-600">Open →</span>
                  </a>
                ))}
              </div>
              {myReservations.filter(r => ['confirmed','checked_in','completed'].includes(r.status)).length > 0 && (
                <div className="space-y-2">
                  <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground px-1">Receipts</p>
                  {myReservations.filter(r => ['confirmed','checked_in','completed'].includes(r.status)).map(r => (
                    <a key={r.id} href={`/api/booths/receipt?tenantId=${encodeURIComponent(tenantId)}&type=reservation&id=${encodeURIComponent(r.id)}`} target="_blank" rel="noreferrer"
                      className="rounded-xl border-2 px-3.5 py-2.5 flex items-center justify-between hover:border-slate-400 transition-colors">
                      <p className="text-xs font-black truncate">{r.boothName} · {r.startDate}</p>
                      <span className="text-[9px] font-black uppercase tracking-widest text-indigo-600 shrink-0 flex items-center gap-1"><FileText className="h-3 w-3" /> Receipt</span>
                    </a>
                  ))}
                </div>
              )}
            </>
          )}

          {ptab === 'activity' && (
            activity.length === 0 ? <p className="text-xs text-muted-foreground text-center py-6">No activity yet.</p> : (
              <div className="space-y-0">
                {activity.map((a, i) => (
                  <div key={i} className="flex gap-3 pb-4 relative">
                    <div className="flex flex-col items-center">
                      <div className="h-2.5 w-2.5 rounded-full bg-slate-900 mt-1 shrink-0" />
                      {i < activity.length - 1 && <div className="w-px flex-1 bg-slate-200 mt-1" />}
                    </div>
                    <div className="min-w-0 -mt-0.5">
                      <p className="text-xs font-bold leading-snug">{a.label}</p>
                      <p className="text-[10px] font-bold text-muted-foreground">{fmtStamp(a.at)}</p>
                    </div>
                  </div>
                ))}
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Perk row (lease wizard) ──────────────────────────────────────────────────
