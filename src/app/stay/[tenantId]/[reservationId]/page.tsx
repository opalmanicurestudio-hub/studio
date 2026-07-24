'use client';

// src/app/stay/[tenantId]/[reservationId]/page.tsx  (or wrap <StayPage/> there)
//
// Public "your stay" page for a day/hourly booth guest. Phone-gated (last 4
// digits of the number on the booking), then:
//   1) shows the booking details,
//   2) has the guest TYPE-SIGN the Short-Term Rental Agreement (the same
//      terms + incidentals caps the online booking flow uses), and
//   3) optionally captures an emergency contact.
//
// The signature is snapshotted server-side to the write-once signedDocuments
// legal store (see /api/booths/kiosk → stay-onboard). A guest who already
// signed online just sees a receipt instead of re-signing.
//
// No app chrome / auth — anonymous guests reach this from their confirmation
// link. All reads/writes go through the Admin-SDK kiosk route, which never
// leaks another guest's data.

import React, { useEffect, useMemo, useState } from 'react';
import { ESignAgreement } from '@/components/shared/ESignAgreement';

interface Booking {
  id: string;
  firstName: string;
  name: string;
  boothName: string;
  startDate: string;
  endDate: string;
  bookingType: string;
  startTime: string | null;
  endTime: string | null;
  slotLabel: string | null;
  amountCents: number;
  status: string;
  rulesAcknowledgedAt: string | null;
  agreementSignedName: string | null;
  agreementSignedAt: string | null;
  emergencyContact: { name?: string; phone?: string } | null;
  rating: number | null;
}

interface StayPageProps {
  tenantId?: string;
  reservationId?: string;
}

// Resolve ids from props first, else the URL. Supports either a path
// (/stay/{tenantId}/{reservationId}) or query (?tenantId=&reservationId=).
function useStayIds(props: StayPageProps): { tenantId: string; reservationId: string } {
  return useMemo(() => {
    let tenantId = props.tenantId || '';
    let reservationId = props.reservationId || '';
    if ((!tenantId || !reservationId) && typeof window !== 'undefined') {
      try {
        const q = new URLSearchParams(window.location.search);
        tenantId = tenantId || q.get('tenantId') || '';
        reservationId = reservationId || q.get('reservationId') || q.get('r') || '';
        if (!tenantId || !reservationId) {
          const parts = window.location.pathname.split('/').filter(Boolean);
          const i = parts.indexOf('stay');
          if (i >= 0) {
            tenantId = tenantId || parts[i + 1] || '';
            reservationId = reservationId || parts[i + 2] || '';
          }
        }
      } catch { /* ignore */ }
    }
    return { tenantId, reservationId };
  }, [props.tenantId, props.reservationId]);
}

function fmtWindow(b: Booking): string {
  if (b.bookingType === 'hourly') {
    return `${b.startDate} · ${b.startTime || ''}–${b.endTime || ''}`;
  }
  return b.startDate === b.endDate ? b.startDate : `${b.startDate} → ${b.endDate}`;
}

export function StayPage(props: StayPageProps = {}) {
  const { tenantId, reservationId } = useStayIds(props);

  const [phase, setPhase] = useState<'gate' | 'view'>('gate');
  const [last4, setLast4] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [studioName, setStudioName] = useState('The studio');
  const [booking, setBooking] = useState<Booking | null>(null);
  const [agreement, setAgreement] = useState<{ title: string; text: string } | null>(null);

  const [emName, setEmName] = useState('');
  const [emPhone, setEmPhone] = useState('');
  const [signing, setSigning] = useState(false);
  const [done, setDone] = useState(false);

  const digitsOnly = (s: string) => s.replace(/\D/g, '');

  const lookUp = async () => {
    const l4 = digitsOnly(last4).slice(-4);
    if (l4.length !== 4) { setError('Enter the last 4 digits of the phone number on your booking.'); return; }
    if (!tenantId || !reservationId) { setError('This link is missing its booking reference.'); return; }
    setLoading(true); setError('');
    try {
      const res = await fetch('/api/booths/kiosk', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'stay-view', tenantId, reservationId, phoneLast4: l4 }),
      });
      const d = await res.json();
      if (!d.ok) { setError(d.error || 'We couldn\'t find that booking.'); setLoading(false); return; }
      setStudioName(d.studioName || 'The studio');
      setBooking(d.booking);
      setAgreement(d.dayUseAgreement || null);
      if (d.booking?.emergencyContact) {
        setEmName(d.booking.emergencyContact.name || '');
        setEmPhone(d.booking.emergencyContact.phone || '');
      }
      setPhase('view');
    } catch {
      setError('Network error — please try again.');
    } finally { setLoading(false); }
  };

  const submitSignature = async (signedName: string) => {
    if (!booking) return;
    setSigning(true); setError('');
    try {
      const res = await fetch('/api/booths/kiosk', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'stay-onboard',
          tenantId, reservationId,
          phoneLast4: digitsOnly(last4).slice(-4),
          signedName,
          emergencyName: emName.trim() || undefined,
          emergencyPhone: emPhone.trim() || undefined,
        }),
      });
      const d = await res.json();
      if (!d.ok) { setError(d.error || 'We couldn\'t save your signature — please try again.'); setSigning(false); return; }
      setBooking(b => b ? { ...b, agreementSignedName: signedName, agreementSignedAt: new Date().toISOString(), rulesAcknowledgedAt: new Date().toISOString() } : b);
      setDone(true);
    } catch {
      setError('Network error — please try again.');
    } finally { setSigning(false); }
  };

  // ── Gate: phone last-4 ──────────────────────────────────────────────
  if (phase === 'gate') {
    return (
      <Shell studioName={studioName}>
        <div className="space-y-4">
          <div>
            <h1 className="text-xl font-black uppercase tracking-tight text-slate-900">Your booking</h1>
            <p className="text-[11px] font-black uppercase tracking-widest text-muted-foreground mt-1">Confirm it's you to continue</p>
          </div>
          <div className="space-y-1.5">
            <label className="block text-[10px] font-black uppercase tracking-widest text-muted-foreground">Last 4 digits of your phone</label>
            <input
              value={last4}
              onChange={e => setLast4(digitsOnly(e.target.value).slice(0, 4))}
              inputMode="numeric"
              placeholder="1234"
              className="w-full h-14 rounded-2xl border-2 px-4 text-2xl font-black tracking-[0.4em] text-center"
              onKeyDown={e => { if (e.key === 'Enter') lookUp(); }}
            />
          </div>
          {error && <p className="text-[11px] font-bold text-red-600">{error}</p>}
          <button
            onClick={lookUp}
            disabled={loading || digitsOnly(last4).length !== 4}
            className="w-full h-14 rounded-2xl bg-slate-900 text-white font-black uppercase tracking-widest text-[11px] disabled:opacity-40"
          >
            {loading ? 'Checking…' : 'Continue'}
          </button>
        </div>
      </Shell>
    );
  }

  // ── View: details + sign ────────────────────────────────────────────
  const b = booking!;
  const alreadySigned = !!b.agreementSignedAt || done;

  return (
    <Shell studioName={studioName}>
      <div className="space-y-5">
        <div>
          <p className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">Hi {b.firstName} 👋</p>
          <h1 className="text-xl font-black uppercase tracking-tight text-slate-900 mt-0.5">You're booked</h1>
        </div>

        {/* Booking summary */}
        <div className="rounded-2xl border-2 bg-muted/20 p-4 space-y-1.5 text-sm">
          <Row label="Space" value={b.boothName} />
          <Row label="When" value={fmtWindow(b)} />
          {b.amountCents ? <Row label="Paid" value={`$${(b.amountCents / 100).toFixed(2)}`} /> : null}
        </div>

        {alreadySigned ? (
          <div className="rounded-2xl border-2 border-emerald-200 bg-emerald-50 p-4 space-y-2">
            <div className="flex items-center gap-2 text-emerald-700">
              <span className="text-lg">✓</span>
              <p className="text-sm font-black uppercase tracking-tight">You're all set</p>
            </div>
            <p className="text-[12px] font-semibold text-emerald-800 leading-snug">
              Your rental agreement is signed{b.agreementSignedName ? ` as ${b.agreementSignedName}` : ''}. Please arrive a few minutes early — see you soon!
            </p>
          </div>
        ) : (
          <>
            {/* Emergency contact (optional) */}
            <div className="rounded-2xl border-2 p-4 space-y-2.5">
              <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Emergency contact <span className="text-slate-400">(optional)</span></p>
              <input value={emName} onChange={e => setEmName(e.target.value)} placeholder="Name" className="w-full h-11 rounded-xl border-2 px-3.5 text-sm font-semibold" />
              <input value={emPhone} onChange={e => setEmPhone(e.target.value)} inputMode="tel" placeholder="Phone" className="w-full h-11 rounded-xl border-2 px-3.5 text-sm font-semibold" />
            </div>

            {/* Type-to-sign */}
            {agreement ? (
              <div className="rounded-2xl border-2 p-4">
                <ESignAgreement
                  title={agreement.title}
                  agreementText={agreement.text}
                  signerName={b.name || ''}
                  busy={signing}
                  submitLabel="Sign & Confirm"
                  onSign={submitSignature}
                />
              </div>
            ) : (
              <p className="text-[12px] font-semibold text-muted-foreground">No agreement is required for this booking.</p>
            )}
            {error && <p className="text-[11px] font-bold text-red-600">{error}</p>}
          </>
        )}
      </div>
    </Shell>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground shrink-0">{label}</span>
      <span className="text-sm font-bold text-slate-900 text-right">{value}</span>
    </div>
  );
}

function Shell({ studioName, children }: { studioName: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center px-4 py-8" style={{ paddingBottom: 'max(32px, env(safe-area-inset-bottom))' }}>
      <div className="w-full max-w-md">
        <p className="text-center text-[10px] font-black uppercase tracking-[0.25em] text-muted-foreground mb-4">{studioName}</p>
        <div className="rounded-3xl bg-white border-2 shadow-sm p-5 sm:p-6">
          {children}
        </div>
        <p className="text-center text-[10px] font-medium text-slate-400 mt-4">Secured booking · your details are only used for this reservation.</p>
      </div>
    </div>
  );
}

export default StayPage;
