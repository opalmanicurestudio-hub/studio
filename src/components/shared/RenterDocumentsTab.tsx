'use client';

/**
 * RenterDocumentsTab — v3
 *
 * Renter portal → Documents. Four concerns:
 *   1. CARD ON FILE (v3) — hotel model for lease renters: add/update a
 *      card via Stripe's hosted setup page (zero client Stripe.js).
 *      Return from Stripe is confirmed on mount via URL params.
 *   2. Year-to-date rent total
 *   3. Receipts — day/hourly rentals (by phone/email) + lease payments
 *      (by name from the ledger)
 *   4. Annual statements + tax guidance
 */

import React, { useEffect, useState, useMemo } from 'react';
import {
  collection, query, where, getDocs, doc, getDoc,
  type Firestore,
} from 'firebase/firestore';

interface Props {
  tenantId:    string;
  staffMember: any;
  firestore:   Firestore;
}

export function RenterDocumentsTab({ tenantId, staffMember, firestore }: Props) {
  const [reservations, setReservations] = useState<any[] | null>(null);
  const [ledgerEntries, setLedgerEntries] = useState<any[] | null>(null);
  const [card, setCard] = useState<{ brand: string; last4: string } | null | 'loading'>('loading');
  const [cardBusy, setCardBusy] = useState(false);
  const [cardMsg, setCardMsg] = useState('');

  const fullName = (staffMember.name || '').trim();

  // ── Card on file: load status + confirm a Stripe return if present ──
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const params = new URLSearchParams(window.location.search);
        if (params.get('cfCardSetup') === '1' && params.get('cfSetupSession') && params.get('cfRenterId') === staffMember.id) {
          const res = await fetch(`/api/booths/setup-card?tenantId=${encodeURIComponent(tenantId)}&renterId=${encodeURIComponent(staffMember.id)}&session=${encodeURIComponent(params.get('cfSetupSession')!)}`);
          const d = await res.json();
          if (!cancelled && d.ok) {
            setCard({ brand: d.cardBrand, last4: d.cardLast4 });
            setCardMsg('Card saved ✓');
            try { window.history.replaceState({}, '', window.location.pathname); } catch {}
            return;
          }
        }
        const snap = await getDoc(doc(firestore, 'tenants', tenantId, 'renters', staffMember.id));
        if (cancelled) return;
        const r = snap.exists() ? (snap.data() as any) : {};
        setCard(r.cardOnFile ? { brand: r.cardBrand || 'card', last4: r.cardLast4 || '' } : null);
      } catch { if (!cancelled) setCard(null); }
    })();
    return () => { cancelled = true; };
  }, [firestore, tenantId, staffMember.id]);

  const startCardSetup = async () => {
    if (cardBusy) return;
    setCardBusy(true); setCardMsg('');
    try {
      const res = await fetch('/api/booths/setup-card', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, renterId: staffMember.id, returnUrl: window.location.href }),
      });
      const d = await res.json();
      if (d.ok && d.url) { window.location.href = d.url; return; }
      setCardMsg(d.error || 'Could not start card setup.');
    } catch { setCardMsg('Network error — try again.'); }
    finally { setCardBusy(false); }
  };

  // ── Day/hourly rentals by phone/email ──
  useEffect(() => {
    if (!firestore || !tenantId) return;
    let cancelled = false;
    (async () => {
      try {
        const phoneQ = staffMember.phone
          ? getDocs(query(collection(firestore, `tenants/${tenantId}/boothReservations`), where('phone', '==', staffMember.phone)))
          : Promise.resolve(null);
        const emailQ = staffMember.email
          ? getDocs(query(collection(firestore, `tenants/${tenantId}/boothReservations`), where('email', '==', staffMember.email)))
          : Promise.resolve(null);
        const [byPhone, byEmail] = await Promise.all([phoneQ, emailQ]);
        if (cancelled) return;
        const seen = new Set<string>();
        const all: any[] = [];
        for (const snap of [byPhone, byEmail]) {
          if (!snap) continue;
          for (const d of snap.docs) {
            if (!seen.has(d.id)) { seen.add(d.id); all.push({ id: d.id, ...(d.data() as any) }); }
          }
        }
        setReservations(all.filter(r => ['confirmed', 'checked_in', 'completed'].includes(r.status))
          .sort((a, b) => (b.startDate || '').localeCompare(a.startDate || '')));
      } catch { if (!cancelled) setReservations([]); }
    })();
    return () => { cancelled = true; };
  }, [firestore, tenantId, staffMember.phone, staffMember.email]);

  // ── Lease rent entries by name ──
  useEffect(() => {
    if (!firestore || !tenantId || !fullName) { setLedgerEntries([]); return; }
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDocs(query(
          collection(firestore, `tenants/${tenantId}/transactions`),
          where('source', '==', 'booth_rent'),
          where('clientOrVendor', '==', fullName),
        ));
        if (cancelled) return;
        setLedgerEntries(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }))
          .sort((a, b) => ((b.date || b.createdAt || '') + '').localeCompare((a.date || a.createdAt || '') + '')));
      } catch { if (!cancelled) setLedgerEntries([]); }
    })();
    return () => { cancelled = true; };
  }, [firestore, tenantId, fullName]);

  const dollars = (t: any) => typeof t.amount === 'number' ? t.amount : (Number(t.amountCents) || 0) / 100;
  const dstr = (v: any) => typeof v === 'string' ? v.slice(0, 10) : '';
  const thisYear = new Date().getFullYear().toString();
  const ytdTotal = useMemo(() => {
    const fromRes = (reservations || []).filter(r => (r.startDate || '').startsWith(thisYear)).reduce((s, r) => s + (r.amountCents || 0) / 100, 0);
    const fromLdg = (ledgerEntries || []).filter(t => dstr(t.date || t.createdAt).startsWith(thisYear)).reduce((s, t) => s + dollars(t), 0);
    return fromRes + fromLdg;
  }, [reservations, ledgerEntries, thisYear]);

  const loading = reservations === null || ledgerEntries === null;
  const hasAny = (reservations?.length || 0) + (ledgerEntries?.length || 0) > 0;

  return (
    <div className="space-y-4">
      {/* ── Card on file ── */}
      <div className={`rounded-2xl border-2 p-4 space-y-2 ${card && card !== 'loading' ? 'border-emerald-200 bg-emerald-50/60' : 'border-slate-200'}`}>
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Card on file</p>
        {card === 'loading' ? (
          <p className="text-xs text-muted-foreground">Checking…</p>
        ) : card ? (
          <>
            <p className="text-xs font-black text-emerald-800 uppercase">✓ {card.brand} ····{card.last4}</p>
            <p className="text-[10px] text-emerald-700 leading-relaxed">On file for incidentals — product, damages, or fees your studio may charge per your rental agreement.</p>
            <button onClick={startCardSetup} disabled={cardBusy} className="text-[9px] font-black uppercase tracking-widest text-emerald-700 underline underline-offset-2 disabled:opacity-40">
              {cardBusy ? 'Opening…' : 'Update card'}
            </button>
          </>
        ) : (
          <>
            <p className="text-[11px] text-slate-600 leading-relaxed">Like a hotel, your studio keeps a card on file for incidentals (product, damages, fees per your agreement). Your card details are held by Stripe — the studio never sees the number.</p>
            <button onClick={startCardSetup} disabled={cardBusy} className="w-full h-11 rounded-2xl bg-slate-900 text-white font-black uppercase text-[10px] tracking-widest disabled:opacity-40">
              {cardBusy ? 'Opening secure page…' : 'Add card on file'}
            </button>
          </>
        )}
        {cardMsg && <p className="text-[10px] font-black uppercase text-emerald-700">{cardMsg}</p>}
      </div>

      {/* ── YTD ── */}
      {ytdTotal > 0 && (
        <div className="rounded-2xl border-2 border-emerald-200 bg-emerald-50/40 px-4 py-3">
          <p className="text-[9px] font-black uppercase tracking-widest text-emerald-700">{thisYear} rent paid</p>
          <p className="text-xl font-black tracking-tighter text-emerald-900">${ytdTotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}</p>
          <p className="text-[9px] font-bold text-emerald-600 mt-0.5">May be deductible as a business expense — ask your tax preparer</p>
        </div>
      )}

      {loading ? (
        <p className="text-xs text-muted-foreground py-4 text-center">Loading documents…</p>
      ) : (
        <>
          {(reservations?.length || 0) > 0 && (
            <div className="space-y-2">
              <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground px-1">Booking receipts</p>
              {reservations!.map(r => (
                <div key={r.id} className="rounded-xl border-2 bg-white px-3.5 py-2.5 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-black truncate">{r.boothName || 'Space'}</p>
                    <p className="text-[10px] font-bold text-muted-foreground">
                      {r.bookingType === 'hourly' && r.startTime ? `${r.startDate} · ${r.startTime}–${r.endTime}` : `${r.startDate}${r.endDate && r.endDate !== r.startDate ? ` → ${r.endDate}` : ''}`}
                      {' · '}${((r.amountCents || 0) / 100).toFixed(2)}
                    </p>
                  </div>
                  <a href={`/api/booths/receipt?tenantId=${encodeURIComponent(tenantId)}&type=reservation&id=${encodeURIComponent(r.id)}`}
                    target="_blank" rel="noreferrer"
                    className="h-8 px-3 rounded-lg bg-slate-900 text-white text-[9px] font-black uppercase tracking-widest flex items-center gap-1.5 shrink-0">
                    📄 Receipt
                  </a>
                </div>
              ))}
            </div>
          )}

          {(ledgerEntries?.length || 0) > 0 && (
            <div className="space-y-2">
              <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground px-1">Rent payment receipts</p>
              {ledgerEntries!.map(t => (
                <div key={t.id} className="rounded-xl border-2 bg-white px-3.5 py-2.5 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-black truncate">{t.description || 'Booth rent'}</p>
                    <p className="text-[10px] font-bold text-muted-foreground">{dstr(t.date || t.createdAt)} · ${dollars(t).toFixed(2)}</p>
                  </div>
                  <a href={`/api/booths/receipt?tenantId=${encodeURIComponent(tenantId)}&type=ledger&id=${encodeURIComponent(t.id)}`}
                    target="_blank" rel="noreferrer"
                    className="h-8 px-3 rounded-lg bg-slate-900 text-white text-[9px] font-black uppercase tracking-widest flex items-center gap-1.5 shrink-0">
                    📄 Receipt
                  </a>
                </div>
              ))}
            </div>
          )}

          {!hasAny && (
            <p className="text-xs text-muted-foreground py-6 text-center font-medium">
              No paid bookings on record yet. Receipts will appear here after your first payment.
            </p>
          )}
        </>
      )}

      {/* ── Annual statements ── */}
      <div className="space-y-2">
        <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground px-1">Annual statements</p>
        {[new Date().getFullYear(), new Date().getFullYear() - 1].map(yr => (
          <div key={yr} className="rounded-xl border-2 bg-white px-3.5 py-2.5 flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-xs font-black">{yr} Annual Rent Statement</p>
              <p className="text-[10px] font-bold text-muted-foreground">Full year summary · IRS Schedule C reference</p>
            </div>
            <a href={`/api/booths/statement?tenantId=${encodeURIComponent(tenantId)}&renterId=${encodeURIComponent(staffMember.id)}&year=${yr}`}
              target="_blank" rel="noreferrer"
              className="h-8 px-3 rounded-lg border-2 border-slate-200 text-slate-700 text-[9px] font-black uppercase tracking-widest flex items-center gap-1.5 shrink-0 hover:border-slate-400">
              📋 Download
            </a>
          </div>
        ))}
      </div>

      {/* ── Tax note ── */}
      <div className="rounded-xl border bg-slate-50 px-4 py-3 space-y-1">
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Tax guidance</p>
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          Rent paid for a business workspace is typically deductible on <strong>Schedule C, Line 20b</strong> (rent on business property). Retain all receipts and provide them to your tax preparer at year end.
        </p>
        <p className="text-[10px] font-bold text-muted-foreground">Informational only — consult a tax professional for advice specific to your situation.</p>
      </div>
    </div>
  );
}
