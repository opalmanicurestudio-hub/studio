'use client';

/**
 * RenterDocumentsTab — v1
 *
 * Shown inside the renter portal Documents tab. Fetches the renter's
 * paid day reservations and any ledger entries matching their contact
 * info, and surfaces "📄 Download Receipt" links for each — which open
 * the /api/booths/receipt route in a new tab, auto-triggering the
 * browser print dialog (save as PDF).
 *
 * Also shows a static annual-summary section with a note on tax
 * deductibility — the full year summary route (Sprint 2) will replace
 * the static note with a generated PDF link.
 */

import React, { useEffect, useState, useMemo } from 'react';
import {
  collection, query, where, getDocs,
  type Firestore,
} from 'firebase/firestore';

interface Props {
  tenantId:    string;
  staffMember: any;   // the renter's staff-mirror doc (has email, phone, name)
  firestore:   Firestore;
}

export function RenterDocumentsTab({ tenantId, staffMember, firestore }: Props) {
  const [reservations, setReservations] = useState<any[] | null>(null);
  const [ledgerEntries, setLedgerEntries] = useState<any[] | null>(null);

  useEffect(() => {
    if (!firestore || !tenantId) return;
    let cancelled = false;
    (async () => {
      try {
        // Fetch confirmed day rentals by phone or email
        const phoneQ  = staffMember.phone
          ? getDocs(query(collection(firestore, `tenants/${tenantId}/boothReservations`), where('phone', '==', staffMember.phone)))
          : Promise.resolve(null);
        const emailQ  = staffMember.email
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
        setReservations(all.filter(r => ['confirmed','completed','checked_in'].includes(r.status))
          .sort((a, b) => (b.startDate || '').localeCompare(a.startDate || '')));
      } catch {
        if (!cancelled) setReservations([]);
      }
    })();
    return () => { cancelled = true; };
  }, [firestore, tenantId, staffMember.phone, staffMember.email]);

  useEffect(() => {
    // Fetch ledger entries (lease rent payments) by clientOrVendor name
    // matching this renter's name — the field set by the service.
    if (!firestore || !tenantId || !staffMember.name) return;
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDocs(query(
          collection(firestore, `tenants/${tenantId}/transactions`),
          where('source', '==', 'booth_rent'),
          where('clientOrVendor', '==', staffMember.name),
        ));
        if (cancelled) return;
        setLedgerEntries(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }))
          .sort((a, b) => (b.date || b.createdAt || '').localeCompare(a.date || a.createdAt || '')));
      } catch {
        if (!cancelled) setLedgerEntries([]);
      }
    })();
    return () => { cancelled = true; };
  }, [firestore, tenantId, staffMember.name]);

  const yearTotal = useMemo(() => {
    const thisYear = new Date().getFullYear().toString();
    const fromRes  = (reservations || []).filter(r => (r.startDate || '').startsWith(thisYear)).reduce((s, r) => s + (r.amountCents || 0) / 100, 0);
    const fromLdg  = (ledgerEntries || []).filter(t => (t.date || t.createdAt || '').startsWith(thisYear)).reduce((s, t) => s + (typeof t.amount === 'number' ? t.amount : (t.amountCents || 0) / 100), 0);
    return fromRes + fromLdg;
  }, [reservations, ledgerEntries]);

  const loading = reservations === null || ledgerEntries === null;

  if (loading) return <p className="text-xs text-muted-foreground py-6 text-center">Loading documents…</p>;

  const hasAny = (reservations?.length || 0) + (ledgerEntries?.length || 0) > 0;

  return (
    <div className="space-y-4">
      {/* Year-to-date summary */}
      {yearTotal > 0 && (
        <div className="rounded-2xl border-2 border-emerald-200 bg-emerald-50/40 px-4 py-3 flex items-center justify-between gap-3">
          <div>
            <p className="text-[9px] font-black uppercase tracking-widest text-emerald-700">{new Date().getFullYear()} rent paid</p>
            <p className="text-xl font-black tracking-tighter text-emerald-900">${yearTotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}</p>
            <p className="text-[9px] font-bold text-emerald-600 mt-0.5">May be deductible as a business expense — ask your tax preparer</p>
          </div>
        </div>
      )}

      {/* Day rental receipts */}
      {(reservations?.length || 0) > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground px-1">Day rental receipts</p>
          {reservations!.map(r => (
            <div key={r.id} className="rounded-xl border-2 bg-white px-3.5 py-2.5 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-xs font-black truncate">{r.boothName || 'Space'}</p>
                <p className="text-[10px] font-bold text-muted-foreground">{r.startDate}{r.endDate && r.endDate !== r.startDate ? ` → ${r.endDate}` : ''} · ${((r.amountCents || 0) / 100).toFixed(2)}</p>
              </div>
              <a
                href={`/api/booths/receipt?tenantId=${encodeURIComponent(tenantId)}&type=reservation&id=${encodeURIComponent(r.id)}`}
                target="_blank"
                rel="noreferrer"
                className="h-8 px-3 rounded-lg bg-slate-900 text-white text-[9px] font-black uppercase tracking-widest flex items-center gap-1.5 shrink-0 hover:bg-slate-800 active:scale-95 transition-transform"
              >
                📄 Receipt
              </a>
            </div>
          ))}
        </div>
      )}

      {/* Lease payment receipts */}
      {(ledgerEntries?.length || 0) > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground px-1">Rent payment receipts</p>
          {ledgerEntries!.map(t => {
            const dollars = typeof t.amount === 'number' ? t.amount : (t.amountCents || 0) / 100;
            return (
              <div key={t.id} className="rounded-xl border-2 bg-white px-3.5 py-2.5 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-black truncate">{t.description || 'Booth rent'}</p>
                  <p className="text-[10px] font-bold text-muted-foreground">{(t.date || t.createdAt || '').slice(0, 10)} · ${dollars.toFixed(2)}</p>
                </div>
                <a
                  href={`/api/booths/receipt?tenantId=${encodeURIComponent(tenantId)}&type=ledger&id=${encodeURIComponent(t.id)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="h-8 px-3 rounded-lg bg-slate-900 text-white text-[9px] font-black uppercase tracking-widest flex items-center gap-1.5 shrink-0 hover:bg-slate-800 active:scale-95 transition-transform"
                >
                  📄 Receipt
                </a>
              </div>
            );
          })}
        </div>
      )}

      {!hasAny && (
        <p className="text-xs text-muted-foreground py-8 text-center font-medium">
          No paid bookings on record yet. Receipts will appear here after your first payment.
        </p>
      )}

      {/* Annual statements */}
      <div className="space-y-2">
        <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground px-1">Annual statements</p>
        {[new Date().getFullYear(), new Date().getFullYear()-1].map(yr => (
          <div key={yr} className="rounded-xl border-2 bg-white px-3.5 py-2.5 flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-xs font-black">{yr} Annual Rent Statement</p>
              <p className="text-[10px] font-bold text-muted-foreground">Full year summary · IRS Schedule C reference · auto-notes $600 threshold</p>
            </div>
            <a
              href={`/api/booths/statement?tenantId=${encodeURIComponent(tenantId)}&renterId=${encodeURIComponent(staffMember.id)}&year=${yr}`}
              target="_blank" rel="noreferrer"
              className="h-8 px-3 rounded-lg border-2 border-slate-200 text-slate-700 text-[9px] font-black uppercase tracking-widest flex items-center gap-1.5 shrink-0 hover:border-slate-400 active:scale-95 transition-transform"
            >
              📋 Download
            </a>
          </div>
        ))}
      </div>

      {/* Tax note */}
      <div className="rounded-xl border bg-slate-50 px-4 py-3 space-y-1">
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Tax guidance</p>
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          Rent paid for a business workspace is typically deductible as a business expense on <strong>Schedule C</strong> (line 20b — rent on business property). Each receipt shows the amount paid, the period covered, and the studio's business information. Retain all receipts and provide them to your tax preparer at year end.
        </p>
        <p className="text-[10px] font-bold text-muted-foreground">This is informational — consult a tax professional for advice specific to your situation.</p>
      </div>
    </div>
  );
}
