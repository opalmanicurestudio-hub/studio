'use client';

/**
 * BoothListingsSection — v2 (immersive)
 *
 * Industry-neutral space listings for the public page — works for
 * salons, barbershops, tattoo studios, wellness suites, photo studios,
 * coworking chairs. Nothing beauty-specific is hardcoded; niches and
 * required documents are OWNER-CONFIGURED in the page builder.
 *
 * Layouts (picked in the editor):
 *  - grid     — classic marketplace cards, 3-up
 *  - showcase — magazine spread: alternating full-width image/text splits
 *  - luxe     — full-bleed photo cards with overlay copy, editorial feel
 *
 * Listing photos come from the booth editor (Booths page → edit a booth →
 * "Listing photos"; first photo = hero). Cards show a photo-count badge;
 * the application dialog opens with a swipeable photo strip.
 *
 * Applications v2:
 *  - Date selection: lease → preferred move-in date; hourly/daily →
 *    start + end dates
 *  - Niche select from config.nicheOptions (+ "Other" free text)
 *  - Required documents from config.requiredDocs (e.g. "License",
 *    "Insurance") — each renders an upload slot; submit is gated until
 *    all are attached. Files go to Storage under
 *    tenants/{tid}/applications/ — REQUIRES the public-write Storage
 *    rules block (see chat), since applicants are not signed in.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { getFirestore, collection, query, where, getDocs, doc, setDoc, type Firestore } from 'firebase/firestore';
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { AGREEMENT_TEMPLATES } from '@/lib/esign';

const FREQ_LABEL: Record<string, string> = { monthly: '/mo', weekly: '/wk', daily: '/day', hourly: '/hr' };
const DEFAULT_NICHES = ['Hair', 'Nails', 'Esthetics', 'Massage', 'Barber', 'Tattoo', 'Lashes & Brows', 'Wellness', 'Photography', 'Other'];

// ─── Tour availability: weekly window → concrete, always-current tour times ───────
const TOUR_DOW_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const TOUR_MON_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function tourParse12(str: string): number | null {
  const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec((str || '').trim());
  if (!m) return null;
  let h = Number(m[1]) % 12;
  if (/PM/i.test(m[3])) h += 12;
  return h * 60 + Number(m[2]);
}
function tourFmt12(mins: number): string {
  const h = Math.floor(mins / 60), mm = mins % 60, ap = h >= 12 ? 'PM' : 'AM', hh = (h % 12) || 12;
  return `${hh}:${String(mm).padStart(2, '0')} ${ap}`;
}
// Returns null when no weekly schedule is configured (caller falls back to the
// legacy manual list). Returns [] when configured but nothing upcoming fits.
function genTourSlots(sched: any, now: Date): Array<{ label: string; startIso: string; endIso: string }> | null {
  if (!sched || typeof sched !== 'object' || !sched.enabled) return null;
  const days: number[] = Array.isArray(sched.days) ? sched.days.map(Number) : [];
  const startM = tourParse12(sched.start || '10:00 AM');
  const endM = tourParse12(sched.end || '12:00 PM');
  const step = Math.max(5, Number(sched.slotMin) || 20);
  const weeks = Math.min(8, Math.max(1, Number(sched.weeksAhead) || 2));
  if (!days.length || startM == null || endM == null || endM <= startM) return [];
  const out: Array<{ label: string; startIso: string; endIso: string }> = [];
  const horizon = new Date(now.getFullYear(), now.getMonth(), now.getDate() + weeks * 7);
  const cur = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  for (; cur <= horizon; cur.setDate(cur.getDate() + 1)) {
    if (!days.includes(cur.getDay())) continue;
    for (let m = startM; m + step <= endM; m += step) {
      const dt = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate(), Math.floor(m / 60), m % 60);
      if (dt.getTime() <= now.getTime()) continue;
      const dtEnd = new Date(dt.getTime() + step * 60000);
      out.push({ label: `${TOUR_DOW_SHORT[dt.getDay()]} ${TOUR_MON_SHORT[dt.getMonth()]} ${dt.getDate()} · ${tourFmt12(m)}`, startIso: dt.toISOString(), endIso: dtEnd.toISOString() });
    }
  }
  return out.slice(0, 48);
}

// ─── BookingCalendar (v90) — dependency-free month grid ──────────────────────
// A purpose-built booking calendar: proper 7-col grid, weekday header,
// range + single select, and per-day disabled gating. No react-day-picker,
// so it can't break from a missing stylesheet. States: available (tappable),
// selected (filled), in-range (connected), disabled (faint), today (ring).
function BookingCalendar({
  mode, selectedStart, selectedEnd, onPick, isDisabled,
}: {
  mode: 'single' | 'range';
  selectedStart?: string;   // YYYY-MM-DD
  selectedEnd?: string;
  onPick: (iso: string) => void;
  isDisabled: (iso: string) => boolean;
}) {
  // v73 — LOCAL date, not UTC: the old toISOString() version flipped to
  // tomorrow at ~7-8pm US time, disabling same-day bookings every evening.
  const todayIso = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
  const [view, setView] = React.useState(() => {
    const base = selectedStart ? new Date(selectedStart + 'T00:00:00') : new Date();
    return { y: base.getFullYear(), m: base.getMonth() };
  });

  const iso = (y: number, m: number, d: number) =>
    `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const monthName = new Date(view.y, view.m, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const firstDow = new Date(view.y, view.m, 1).getDay();
  const daysInMonth = new Date(view.y, view.m + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array(firstDow).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const inRange = (dIso: string) =>
    mode === 'range' && selectedStart && selectedEnd &&
    dIso > selectedStart && dIso < selectedEnd;
  const isEdge = (dIso: string) => dIso === selectedStart || dIso === selectedEnd;

  const shift = (delta: number) => setView(v => {
    const nm = v.m + delta;
    return { y: v.y + Math.floor(nm / 12), m: ((nm % 12) + 12) % 12 };
  });
  const canGoBack = new Date(view.y, view.m, 1) > new Date(new Date().getFullYear(), new Date().getMonth(), 1);

  return (
    <div className="w-full select-none">
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm font-black tracking-tight">{monthName}</p>
        <div className="flex gap-1">
          <button type="button" onClick={() => canGoBack && shift(-1)} disabled={!canGoBack}
            className="h-8 w-8 rounded-lg border-2 flex items-center justify-center font-black disabled:opacity-20 active:scale-90 transition-transform">‹</button>
          <button type="button" onClick={() => shift(1)}
            className="h-8 w-8 rounded-lg border-2 flex items-center justify-center font-black active:scale-90 transition-transform">›</button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-y-1 mb-1">
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
          <div key={i} className="text-center text-[10px] font-black uppercase tracking-widest text-slate-400 py-1">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-y-1">
        {cells.map((day, i) => {
          if (day === null) return <div key={i} />;
          const dIso = iso(view.y, view.m, day);
          const disabled = isDisabled(dIso);
          const edge = isEdge(dIso);
          const mid = inRange(dIso);
          const isToday = dIso === todayIso;
          return (
            <div key={i} className={`relative flex items-center justify-center ${mid ? 'bg-slate-900/10' : ''}`}>
              <button type="button" disabled={disabled} onClick={() => onPick(dIso)}
                className={[
                  'h-10 w-10 rounded-full text-sm font-bold flex items-center justify-center transition-all',
                  disabled ? 'text-slate-300 cursor-not-allowed line-through decoration-slate-200'
                    : edge ? 'bg-slate-900 text-white font-black scale-100 active:scale-95'
                    : mid ? 'text-slate-900 font-black'
                    : 'text-slate-700 hover:bg-slate-100 active:scale-90',
                  isToday && !edge ? 'ring-2 ring-slate-900/20' : '',
                ].join(' ')}>
                {day}
              </button>
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-3 mt-3 pt-2.5 border-t">
        <span className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest text-slate-400"><span className="h-2.5 w-2.5 rounded-full bg-slate-900" /> Selected</span>
        <span className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest text-slate-400"><span className="h-2.5 w-2.5 rounded-full border-2 border-slate-200" /> Open</span>
        <span className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest text-slate-400"><span className="text-slate-300 line-through">15</span> Unavailable</span>
      </div>
    </div>
  );
}

export function BoothListingsSection({ tenantId, config, db }: { tenantId: string; config: any; db?: Firestore }) {
  const firestore = db || getFirestore();
  const [booths, setBooths] = useState<any[] | null>(null);
  const [applyFor, setApplyFor] = useState<any | null>(null);
  const [photoIdx, setPhotoIdx] = useState(0);
  const [form, setForm] = useState({ name: '', phone: '', email: '', niche: '', nicheOther: '', moveIn: '', startDate: '', endDate: '', message: '', startTime: '', endTime: '', licensed: '', bringClients: '', experience: '' });
  const [granularity, setGranularity] = useState<'daily' | 'hourly'>('daily');
  // v89 — stepped reserve flow: 'type' → 'when' → 'time' → 'you'
  const [reserveStep, setReserveStep] = useState<'type' | 'when' | 'time' | 'you'>('type');
  const [hourlyMode, setHourlyMode] = useState<'slots' | 'custom'>('slots'); // when a space has both
  const [pickedStart, setPickedStart] = useState('');   // 'HH:MM'
  const [pickedHours, setPickedHours] = useState(0);
  const [pickedSlot, setPickedSlot] = useState<any>(null);
  const slotsOf = (bb: any): any[] => Array.isArray(bb?.bookingSlots) ? bb.bookingSlots.filter((s: any) => s.label && s.startTime && s.endTime && s.amountCents > 0) : [];
  const [docs, setDocs] = useState<Record<string, { name: string; url: string } | 'uploading' | null>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const niches: string[] = (Array.isArray(config.nicheOptions) && config.nicheOptions.length > 0) ? config.nicheOptions : DEFAULT_NICHES;
  // v53 — owner-configured tour availability + application agreement.
  // v92 — tour times now auto-generate from a weekly schedule (config.tourSchedule)
  // and stay current; falls back to the legacy manual list if no schedule is set.
  const scheduledTours = !!(config.tourSchedule && config.tourSchedule.enabled);
  const tourSlotObjs = useMemo(() => {
    const gen = genTourSlots(config.tourSchedule, new Date());
    if (gen) return gen;
    const legacy = Array.isArray(config.tourSlots) ? config.tourSlots.filter(Boolean) : [];
    return legacy.map((s: string) => ({ label: s, startIso: '', endIso: '' }));
  }, [config.tourSchedule, config.tourSlots]);
  const tourSlots: string[] = useMemo(() => tourSlotObjs.map(o => o.label), [tourSlotObjs]);
  const agreementText: string = typeof config.applicationAgreement === 'string' ? config.applicationAgreement.trim() : '';
  // A paid day/hourly guest ALWAYS signs real terms: the owner's custom
  // booking terms if written, else the built-in protective default. (The
  // authoritative, filled-in copy is snapshotted server-side on booking —
  // this is what the guest reads and signs here.)
  const dayUseTermsPreview: string = agreementText || AGREEMENT_TEMPLATES.day_use.body;
  const [tourSlot, setTourSlot] = useState('');
  const [tourStartIso, setTourStartIso] = useState('');
  const [tourEndIso, setTourEndIso] = useState('');
  const pickTour = (o: { label: string; startIso: string; endIso: string }) => {
    if (tourSlot === o.label) { setTourSlot(''); setTourStartIso(''); setTourEndIso(''); }
    else { setTourSlot(o.label); setTourStartIso(o.startIso); setTourEndIso(o.endIso); }
  };
  const [agreed, setAgreed] = useState(false);
  const [agreementOpen, setAgreementOpen] = useState(false);
  // Typed legal-name e-signature for paid day/hourly bookings.
  const [signName, setSignName] = useState('');
  const requiredDocs: string[] = Array.isArray(config.requiredDocs) ? config.requiredDocs.filter(Boolean) : [];
  // Owner toggle: when true, license/insurance/ID/documents are collected
  // AFTER approval instead of gating the first application.
  const deferPaperwork = !!config.collectDocsAfterApproval;
  // Tranche 1 — compliance-at-booking, from the owner's automation rules
  const compRules = (config.automationRules || {}) as any;
  const [comp, setComp] = useState({ doingServices: false, licenseNumber: '', insuranceCarrier: '', insuranceConfirmed: false, idAck: false });
  const [compDocs, setCompDocs] = useState<Record<string, { name: string; url: string } | 'uploading' | null>>({});
  const uploadCompDoc = async (slot: string, file: File) => {
    setCompDocs(d => ({ ...d, [slot]: 'uploading' }));
    try {
      const path = `tenants/${tenantId}/reservation-docs/${Date.now()}_${slot}_${file.name}`;
      const sRef = storageRef(getStorage(), path);
      await uploadBytes(sRef, file, { contentType: file.type || 'application/octet-stream' });
      const url = await getDownloadURL(sRef);
      setCompDocs(d => ({ ...d, [slot]: { name: file.name, url } }));
    } catch { setCompDocs(d => ({ ...d, [slot]: null })); alert('Upload failed — please try again.'); }
  };
  const compDocUrl = (slot: string) => { const s = compDocs[slot]; return s && s !== 'uploading' ? s.url : null; };
  const compNeeded = (compRules.requireLicense || compRules.requireInsurance || compRules.requireIdVerification);
  const compApplies = compNeeded && (compRules.complianceAppliesTo === 'all' || comp.doingServices);
  const compSatisfied = deferPaperwork || !compApplies || (
    (!compRules.requireLicense || (comp.licenseNumber.trim() && compDocUrl('license'))) &&
    (!compRules.requireInsurance || (comp.insuranceConfirmed && compDocUrl('insurance'))) &&
    (!compRules.requireIdVerification || compDocUrl('id'))
  );

  // v52 — pay-and-book: returning from Stripe Checkout, confirm the
  // reservation server-side and celebrate.
  const [confirmedRes, setConfirmedRes] = useState<any | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const rid = params.get('cfReservationId');
    const sid = params.get('cfSession');
    if (!rid || !sid) return;
    (async () => {
      try {
        const res = await fetch(`/api/booths/reserve?tenantId=${encodeURIComponent(tenantId)}&reservationId=${encodeURIComponent(rid)}&sessionId=${encodeURIComponent(sid)}`);
        const data = await res.json();
        if (data.ok && data.confirmed) setConfirmedRes(data);
        else if (data.error) setConfirmError(data.error);
      } catch { /* silent — banner just won't show */ }
    })();
  }, [tenantId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDocs(query(collection(firestore, `tenants/${tenantId}/booths`), where('status', '==', 'vacant')));
        if (!cancelled) setBooths(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
      } catch { if (!cancelled) setBooths([]); }
    })();
    return () => { cancelled = true; };
  }, [firestore, tenantId]);

  const visible = useMemo(() => (booths || []).filter((b: any) => {
    const opts = Array.isArray(b.pricingOptions) && b.pricingOptions.length > 0
      ? b.pricingOptions : [{ frequency: b.baseRentFrequency || 'monthly' }];
    const hasLease = opts.some((o: any) => ['monthly', 'weekly', 'biweekly'].includes(o.frequency));
    const hasDay = opts.some((o: any) => !['monthly', 'weekly', 'biweekly'].includes(o.frequency));
    return (hasLease && config.showMonthly !== false) || (hasDay && config.showDaily !== false);
  }), [booths, config.showMonthly, config.showDaily]);

  const photosOf = (b: any): string[] => (Array.isArray(b.photoUrls) && b.photoUrls.length > 0) ? b.photoUrls : (b.photoUrl ? [b.photoUrl] : []);
  // v55 — video tours: YouTube/Vimeo links become embeds, direct files
  // become a <video> player.
  const embedOf = (url: string): { kind: 'iframe' | 'video'; src: string } | null => {
    if (!url) return null;
    const yt = url.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)([\w-]{6,})/);
    if (yt) return { kind: 'iframe', src: `https://www.youtube.com/embed/${yt[1]}` };
    const vm = url.match(/vimeo\.com\/(\d+)/);
    if (vm) return { kind: 'iframe', src: `https://player.vimeo.com/video/${vm[1]}` };
    if (/\.(mp4|webm|mov)(\?|$)/i.test(url)) return { kind: 'video', src: url };
    return null;
  };
  const [showVideo, setShowVideo] = useState(false);
  const blurbOf = (b: any) => b.listingDescription || b.notes || '';
  // v50 — multi-pricing: pricingOptions[] is authoritative when present;
  // legacy base fields remain the fallback so old assets render unchanged.
  const ratesOf = (b: any): { frequency: string; amountCents: number }[] => {
    const opts = Array.isArray(b.pricingOptions) ? b.pricingOptions.filter((o: any) => o && o.amountCents > 0) : [];
    if (opts.length > 0) return opts;
    return b.baseRentCents ? [{ frequency: b.baseRentFrequency || 'monthly', amountCents: b.baseRentCents }] : [];
  };
  const LEASE_FREQS = ['monthly', 'weekly', 'biweekly'];
  const leaseRates = (b: any) => ratesOf(b).filter(r => LEASE_FREQS.includes(r.frequency));
  const dayRates = (b: any) => ratesOf(b).filter(r => !LEASE_FREQS.includes(r.frequency));
  const dailyRateOf = (b: any) => ratesOf(b).find((r: any) => r.frequency === 'daily' && r.amountCents > 0);
  const hourlyRateOf = (b: any) => ratesOf(b).find((r: any) => r.frequency === 'hourly' && r.amountCents > 0);
  const primaryRate = (b: any) => leaseRates(b)[0] || ratesOf(b)[0] || { frequency: 'monthly', amountCents: 0 };
  const priceOf = (b: any) => { const r = primaryRate(b); return { amount: Math.round(r.amountCents / 100), suffix: FREQ_LABEL[r.frequency] || '/mo' }; };
  const isLease = (b: any) => leaseRates(b).length > 0;

  const [applyMode, setApplyMode] = useState<'lease' | 'day'>('lease');
  // v51 — INQUIRY ENGINE: not everyone follows the same path. Apply and
  // Reserve are full applications; tours, questions, and waitlist are
  // lighter flows — same collection, a `kind` field, one owner queue.
  const [inquiryKind, setInquiryKind] = useState<'application' | 'tour' | 'question' | 'waitlist'>('application');
  const [showChooser, setShowChooser] = useState(false);
  const openApply = (b: any, mode?: 'lease' | 'day') => {
    setApplyFor(b); setApplyMode(mode || (leaseRates(b).length > 0 ? 'lease' : 'day'));
    setPickedSlot(null);
    setBookedDates(new Set());
    fetch('/api/booths/kiosk', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'availability', tenantId, boothId: b.id }),
    }).then(res => res.json()).then(d => {
      if (d.ok && Array.isArray(d.bookedDates)) setBookedDates(new Set(d.bookedDates));
    }).catch(() => {});
    setGranularity(slotsOf(b).length > 0 ? 'hourly' : dailyRateOf(b) ? 'daily' : hourlyRateOf(b) ? 'hourly' : 'daily');
    setInquiryKind('application'); setPhotoIdx(0); setSubmitted(false); setDocs({}); setTourSlot(''); setTourStartIso(''); setTourEndIso(''); setAgreed(false); setSignName(''); setShowVideo(false); setReserveStep('type'); setHourlyMode('slots'); setPickedStart(''); setPickedHours(0); setComp({ doingServices: false, licenseNumber: '', insuranceCarrier: '', insuranceConfirmed: false, idAck: false }); setCompDocs({});
  };
  const openInquiry = (b: any | null, kind: 'tour' | 'question' | 'waitlist') => {
    setApplyFor(b || { id: null, name: null, pricingOptions: [], photoUrls: [] });
    // Tour/question/waitlist aren't day reservations — force a non-'day' mode so
    // the contact fields (gated on applyMode !== 'day') always show, even for a
    // space that only offers day rentals.
    setInquiryKind(kind); setApplyMode('lease'); setPhotoIdx(0); setSubmitted(false); setDocs({}); setTourSlot(''); setTourStartIso(''); setTourEndIso(''); setAgreed(false); setSignName(''); setShowVideo(false);
  };
  // Open a space into the guided chooser (capability-aware: only shows the
  // actions this space actually offers).
  const openSpace = (b: any) => { openApply(b, leaseRates(b).length > 0 ? 'lease' : 'day'); setShowChooser(true); };

  const uploadDoc = async (docName: string, file: File) => {
    setDocs(d => ({ ...d, [docName]: 'uploading' }));
    try {
      const path = `tenants/${tenantId}/applications/${Date.now()}_${docName.replace(/\W+/g, '')}_${file.name}`;
      const sRef = storageRef(getStorage(), path);
      await uploadBytes(sRef, file, { contentType: file.type || 'application/octet-stream' });
      const url = await getDownloadURL(sRef);
      setDocs(d => ({ ...d, [docName]: { name: file.name, url } }));
    } catch {
      setDocs(d => ({ ...d, [docName]: null }));
      alert('Upload failed — please try again.');
    }
  };

  const allDocsAttached = deferPaperwork || inquiryKind !== 'application' || requiredDocs.every(rd => docs[rd] && docs[rd] !== 'uploading');
  const nicheValue = form.niche === 'Other' ? (form.nicheOther || 'Other') : form.niche;
  // A paid day/hourly reservation requires a typed e-signature; every other
  // inquiry (lease, waitlist, tour) keeps the lighter agree-checkbox behavior.
  // Matches the reserve/checkout trigger exactly (application + day mode) so
  // the signed agreement is captured for precisely the bookings that pay.
  const isPaidDayBooking = inquiryKind === 'application' && applyMode === 'day';
  const signOk = signName.trim().length >= 2;
  const agreementSatisfied = isPaidDayBooking
    ? signOk
    : (inquiryKind !== 'application' || !agreementText || agreed);
  // v66 — AVAILABILITY: mirror the server's schedule check so visitors
  // learn a date is closed before paying, not after. The route enforces
  // the same rules authoritatively.
  const DOW_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  // v82 — humans don't book in military time
  const t12 = (t?: string | null): string => {
    if (!t || !/^\d{2}:\d{2}$/.test(t)) return t || '';
    const [h, m] = t.split(':').map(Number);
    const ap = h >= 12 ? 'PM' : 'AM';
    const hr = h % 12 === 0 ? 12 : h % 12;
    return m === 0 ? `${hr} ${ap}` : `${hr}:${String(m).padStart(2, '0')} ${ap}`;
  };
  const [bookedDates, setBookedDates] = useState<Set<string>>(new Set());
  // Only-available scheduling: build the concrete list of open days (matches
  // the space's allowed weekdays, skips blackouts + already-booked days), so
  // the visitor picks from what's bookable instead of a broad month grid.
  const localIso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const availableDates = (b: any): string[] => {
    const out: string[] = [];
    const now = new Date();
    const todayIso = localIso(now);
    const sched: number[] | null = Array.isArray(b?.dayRentalDays) && b.dayRentalDays.length > 0 && b.dayRentalDays.length < 7 ? b.dayRentalDays.map(Number) : null;
    const bl: string[] = Array.isArray(b?.blackoutDates) ? b.blackoutDates : [];
    for (let i = 0; i < 90 && out.length < 24; i++) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
      const diso = localIso(d);
      if (diso < todayIso) continue;
      if (sched && !sched.includes(d.getDay())) continue;
      if (bl.includes(diso)) continue;
      if (bookedDates.has(diso)) continue;
      out.push(diso);
    }
    return out;
  };
  // Start-time grid + duration options from a space's window + increment.
  const toMin = (t: string) => { const [h, m] = (t || '').split(':').map(Number); return (h || 0) * 60 + (m || 0); };
  const toHHMM = (mins: number) => `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
  const startTimesFor = (b: any): string[] => {
    const open = toMin(b?.openTime || '09:00');
    const close = toMin(b?.closeTime || '18:00');
    const inc = Number(b?.startIncrementMins) || 30;
    if (close <= open) return [];
    const out: string[] = [];
    for (let m = open; m <= close - 60; m += inc) out.push(toHHMM(m));  // need ≥1hr room
    return out;
  };
  const maxHoursFor = (b: any, start: string): number => {
    const close = toMin(b?.closeTime || '18:00');
    const s = toMin(start);
    return Math.max(0, Math.floor((close - s) / 60));
  };
  const ratingOf = (bb: any): { avg: number; count: number } | null => {
    const count = Number(bb?.ratingCount) || 0;
    if (count < 1) return null;
    return { avg: (Number(bb?.ratingSum) || 0) / count, count };
  };
  const Stars = ({ avg }: { avg: number }) => (
    <span className="text-amber-500 tracking-tight" aria-label={`${avg.toFixed(1)} stars`}>
      {'★'.repeat(Math.round(avg))}{'☆'.repeat(5 - Math.round(avg))}
    </span>
  );
  const scheduleIssue = useMemo(() => {
    if (!applyFor || applyMode !== 'day') return null;
    if (granularity === 'hourly') {
      if (!form.startDate) return null;
      const schedDays: number[] | undefined = Array.isArray((applyFor as any).dayRentalDays) ? (applyFor as any).dayRentalDays : undefined;
      const blackouts: string[] = Array.isArray((applyFor as any).blackoutDates) ? (applyFor as any).blackoutDates : [];
      const dow = new Date(form.startDate + 'T00:00:00Z').getUTCDay();
      if (schedDays && !schedDays.includes(dow)) return `${DOW_NAMES[dow]} isn't available — this space is open ${schedDays.map(d => DOW_NAMES[d]).join(', ')}.`;
      if (blackouts.includes(form.startDate)) return `${form.startDate} is unavailable.`;
      if (form.startTime && form.endTime) {
        if (form.startTime >= form.endTime) return 'End time must be after start time.';
        const openT = (applyFor as any).openTime || '00:00';
        const closeT = (applyFor as any).closeTime || '23:59';
        if (form.startTime < openT || form.endTime > closeT) return `Hourly bookings are available ${openT} – ${closeT}.`;
      }
      return null;
    }
    if (!form.startDate || !form.endDate) return null;
    const schedDays: number[] | undefined = Array.isArray((applyFor as any).dayRentalDays) ? (applyFor as any).dayRentalDays : undefined;
    const blackouts: string[] = Array.isArray((applyFor as any).blackoutDates) ? (applyFor as any).blackoutDates : [];
    if (schedDays && schedDays.length === 0) return 'This space does not offer day rentals.';
    const s = new Date(form.startDate + 'T00:00:00Z').getTime();
    const e = new Date(form.endDate + 'T00:00:00Z').getTime();
    if (Number.isNaN(s) || Number.isNaN(e) || e < s) return null;
    for (let t = s; t <= e; t += 86400000) {
      const iso = new Date(t).toISOString().slice(0, 10);
      const dow = new Date(t).getUTCDay();
      if (schedDays && !schedDays.includes(dow)) return `${DOW_NAMES[dow]} ${iso} isn't available — this space is open ${schedDays.map(d => DOW_NAMES[d]).join(', ')}.`;
      if (blackouts.includes(iso)) return `${iso} is unavailable — pick a different range.`;
    }
    return null;
  }, [applyFor, applyMode, form.startDate, form.endDate, form.startTime, form.endTime, granularity]);
  const canSubmit = form.name.trim() && (form.phone.trim() || form.email.trim()) && allDocsAttached && agreementSatisfied && compSatisfied && !scheduleIssue && !submitting;

  const submitApplication = async () => {
    if (!applyFor || !canSubmit) return;
    setSubmitting(true);
    // Pay-and-book path: a day-rental Reserve with dates goes straight to
    // Stripe Checkout. If checkout can't start (no daily rate, conflict,
    // or Stripe hiccup), fall through to the inquiry pipeline so the lead
    // is never lost.
    const hourlyReady = granularity === 'hourly' && form.startDate && form.startTime && form.endTime;
    const dailyReady = granularity === 'daily' && form.startDate && form.endDate;
    if (inquiryKind === 'application' && applyMode === 'day' && (dailyReady || hourlyReady)) {
      try {
        const res = await fetch('/api/booths/reserve', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tenantId, boothId: applyFor.id,
            startDate: form.startDate,
            endDate: granularity === 'hourly' ? form.startDate : form.endDate,
            bookingType: granularity,
            startTime: granularity === 'hourly' ? form.startTime : undefined,
            endTime: granularity === 'hourly' ? form.endTime : undefined,
            slotLabel: granularity === 'hourly' && pickedSlot ? pickedSlot.label : undefined,
            name: form.name.trim(), phone: form.phone.trim(), email: form.email.trim(),
            returnUrl: window.location.href,
            agreementSignedName: signName.trim(),
            consentAccepted: isPaidDayBooking ? signOk : (!!agreementText && agreed),
            doingServices: comp.doingServices,
            licenseNumber: comp.licenseNumber.trim() || null,
            insuranceCarrier: comp.insuranceCarrier.trim() || null,
            insuranceConfirmed: comp.insuranceConfirmed,
            idAcknowledged: comp.idAck,
            licenseDocUrl: compDocUrl('license'),
            insuranceDocUrl: compDocUrl('insurance'),
            idDocUrl: compDocUrl('id'),
          }),
        });
        const data = await res.json();
        if (data.ok && data.url) { window.location.href = data.url; return; }
        // This is a real paid reservation — do NOT silently fall through to a
        // free booking. Tell the guest so payment isn't skipped by accident.
        alert(data.error || 'We couldn\'t start checkout for this reservation. Please try again, or contact us to book.');
        setSubmitting(false);
        return;
      } catch {
        alert('We couldn\'t reach checkout. Please check your connection and try again.');
        setSubmitting(false);
        return;
      }
    }
    try {
      const now = new Date().toISOString();
      const lease = applyMode === 'lease';
      const isApp = inquiryKind === 'application';
      const appRef = doc(collection(firestore, `tenants/${tenantId}/boothApplications`));
      await setDoc(appRef, {
        id: appRef.id, tenantId, createdAt: now, status: 'new',
        kind: inquiryKind,
        boothId: applyFor.id || null, boothName: applyFor.name || (inquiryKind === 'waitlist' ? 'Any space' : 'Space'),
        locationId: applyFor.locationId || null,
        rentalType: isApp ? (applyMode === 'lease' ? 'lease' : 'day_rental') : null,
        name: form.name.trim(), phone: form.phone.trim(), email: form.email.trim(),
        specialty: nicheValue,
        timing: inquiryKind === 'tour' ? [form.moveIn ? `Tour ${form.moveIn}` : 'Tour', tourSlot].filter(Boolean).join(' · ')
          : !isApp ? ''
          : applyMode === 'lease' ? (form.moveIn ? `Move-in ${form.moveIn}` : '')
          : [form.startDate, form.endDate].filter(Boolean).join(' → '),
        moveInDate: lease ? (form.moveIn || null) : null,
        tourStartIso: inquiryKind === 'tour' ? (tourStartIso || null) : null,
        tourEndIso: inquiryKind === 'tour' ? (tourEndIso || null) : null,
        tourTimeTBD: inquiryKind === 'tour' && /time to confirm/i.test(tourSlot),
        licensed: inquiryKind === 'application' ? (form.licensed || null) : null,
        bringsClients: inquiryKind === 'application' ? (form.bringClients || null) : null,
        experience: inquiryKind === 'application' ? (form.experience || null) : null,
        startDate: !lease ? (form.startDate || null) : null,
        endDate: !lease ? (form.endDate || null) : null,
        message: form.message.trim(),
        attachments: isApp ? requiredDocs.map(rd => ({ label: rd, ...(docs[rd] as any) })).filter(a => a.url) : [],
        consentAccepted: isApp && !!agreementText ? true : null,
        consentAcceptedAt: isApp && !!agreementText ? now : null,
      });
      const nRef = doc(collection(firestore, `tenants/${tenantId}/notifications`));
      await setDoc(nRef, {
        id: nRef.id, type: 'booth_application', read: false, createdAt: now,
        message: `${inquiryKind === 'tour' ? 'Tour request' : inquiryKind === 'question' ? 'Question' : inquiryKind === 'waitlist' ? 'Waitlist signup' : lease ? 'Space application' : 'Day-rental request'}: ${form.name.trim()} — ${applyFor.name || 'Any space'}${nicheValue ? ` (${nicheValue})` : ''}`,
        link: '/booths',
      });
      setSubmitted(true);
    } catch { /* dialog stays open for retry */ }
    finally { setSubmitting(false); }
  };

  if (booths === null) return null;
  if (visible.length === 0 && !config.emptyMessage) return null;

  const layout = config.layout || 'grid';

  const PriceTag = ({ b, light }: { b: any; light?: boolean }) => {
    const { amount, suffix } = priceOf(b);
    const others = ratesOf(b).slice(1);
    return (
      <div className="shrink-0 text-right">
        <p>
          <span className={`text-2xl font-black tracking-tighter ${light ? 'text-white' : ''}`}>${amount.toLocaleString()}</span>
          <span className={`text-xs font-bold ${light ? 'text-white/70' : 'opacity-50'}`}>{suffix}</span>
        </p>
        {others.length > 0 && (
          <p className={`text-[9px] font-bold ${light ? 'text-white/60' : 'opacity-50'}`}>
            {others.map(r => `$${Math.round(r.amountCents / 100).toLocaleString()}${FREQ_LABEL[r.frequency] || ''}`).join(' · ')}
          </p>
        )}
      </div>
    );
  };
  const Chips = ({ b, light }: { b: any; light?: boolean }) => (
    config.showAmenities !== false && Array.isArray(b.amenities) && b.amenities.length > 0 ? (
      <div className="flex flex-wrap gap-1.5">
        {b.amenities.slice(0, 5).map((a: string) => (
          <span key={a} className={`text-[9px] font-black uppercase tracking-wide rounded-full px-2 py-0.5 ${light ? 'bg-white/15 text-white backdrop-blur' : 'bg-slate-100 text-slate-600'}`}>{a}</span>
        ))}
        {b.amenities.length > 5 && <span className={`text-[9px] font-black uppercase ${light ? 'text-white/60' : 'text-slate-400'}`}>+{b.amenities.length - 5}</span>}
      </div>
    ) : null
  );
  const InquiryRow = ({ b }: { b: any }) => (
    <div className="flex justify-center gap-4 pt-1">
      <button onClick={() => openInquiry(b, 'tour')} className="text-[9px] font-black uppercase tracking-widest opacity-80 hover:opacity-100 underline underline-offset-2 transition-opacity">Book a tour</button>
      <button onClick={() => openInquiry(b, 'question')} className="text-[9px] font-black uppercase tracking-widest opacity-80 hover:opacity-100 underline underline-offset-2 transition-opacity">Ask a question</button>
    </div>
  );
  const Photo = ({ b, className }: { b: any; className: string }) => {
    const ph = photosOf(b);
    return (
      <div className={`relative overflow-hidden ${className}`}>
        {ph[0] ? (
          <img src={ph[0]} alt={b.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700" />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-slate-200 via-slate-100 to-stone-200" />
        )}
        <span className="absolute top-3 left-3 text-[9px] font-black uppercase tracking-widest bg-emerald-500 text-white rounded-full px-2.5 py-1 shadow">Available</span>
        {ph.length > 1 && <span className="absolute bottom-3 right-3 text-[9px] font-black bg-black/60 text-white rounded-full px-2 py-0.5 backdrop-blur">📷 {ph.length}</span>}
        {embedOf(b.videoUrl) && <span className="absolute bottom-3 left-3 text-[9px] font-black bg-black/60 text-white rounded-full px-2 py-0.5 backdrop-blur">▶ Video tour</span>}
      </div>
    );
  };
  const CTA = ({ b }: { b: any }) => {
    // One clear action per card. Intent is chosen inside the guided view —
    // capability-aware, so unoffered options never appear.
    return (
      <button onClick={() => openSpace(b)} className="w-full h-12 rounded-2xl font-black uppercase text-[10px] tracking-widest text-white bg-slate-900 hover:bg-slate-800 transition-transform active:scale-[0.98]">
        {config.viewBookCtaText || 'View & Book'}
      </button>
    );
  };

  return (
    <section className="py-16 md:py-24 px-4">
      <div className="max-w-6xl mx-auto">
        {confirmedRes && (
          <div className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm flex items-center justify-center p-6">
            <div className="bg-white w-full max-w-md rounded-3xl p-8 text-center space-y-4 animate-in fade-in zoom-in-95 duration-300">
              <p className="text-6xl">🎉</p>
              <div>
                <h3 className="font-black text-2xl tracking-tight">You're booked!</h3>
                <p className="text-sm font-bold text-slate-500 mt-1">Payment received — this space is yours.</p>
              </div>
              <div className="rounded-2xl border-2 bg-slate-50 p-4 text-left space-y-1">
                <p className="font-black text-sm uppercase">{confirmedRes.boothName}</p>
                <p className="text-xs font-bold text-slate-600">{confirmedRes.startDate} → {confirmedRes.endDate}</p>
                <p className="text-[10px] font-bold text-slate-400 uppercase">Save or screenshot this confirmation</p>
              </div>
              <button
                onClick={() => { setConfirmedRes(null); try { window.history.replaceState({}, '', window.location.pathname); } catch {} }}
                className="w-full h-12 rounded-2xl bg-slate-900 text-white font-black uppercase text-[10px] tracking-widest"
              >
                Done
              </button>
            </div>
          </div>
        )}
        {confirmError && (
          <div className="mb-8 rounded-3xl border-2 border-amber-300 bg-amber-50 p-5 text-center">
            <p className="text-sm font-bold text-amber-800">{confirmError}</p>
          </div>
        )}
        <div className="text-center mb-10 md:mb-14">
          <p className="text-[10px] font-black uppercase tracking-[0.3em] opacity-50 mb-3">Now Leasing</p>
          <h2 className="text-3xl md:text-5xl font-black tracking-tight">{config.title || 'Space Available'}</h2>
          {config.subtitle && <p className="mt-3 text-sm md:text-base opacity-70 max-w-xl mx-auto font-medium">{config.subtitle}</p>}
        </div>

        {visible.length === 0 ? (
          <div className="text-center space-y-4">
            <p className="text-sm font-bold opacity-60">{config.emptyMessage}</p>
            <button onClick={() => openInquiry(null, 'waitlist')} className="h-12 px-8 rounded-2xl bg-slate-900 text-white font-black uppercase text-[10px] tracking-widest transition-transform active:scale-[0.98]">Join the Waitlist</button>
          </div>
        ) : layout === 'immersive' ? (
          /* v72 — IMMERSIVE: Airbnb-style full-bleed cards. Photo carries
             the card; content overlays the lower third on a gradient. */
          <div className="grid gap-6 md:grid-cols-2">
            {/* v73 — was `visibleBooths` (undefined): guaranteed crash for
                any tenant configured with the immersive layout */}
            {visible.map((b: any) => {
              const ph = photosOf(b);
              const rates = dayRates(b);
              const lease = leaseRates(b);
              return (
                <button key={b.id} onClick={() => openApply(b)} className="relative rounded-3xl overflow-hidden text-left group h-[420px] block w-full">
                  {ph.length > 0 ? (
                    <img src={ph[0]} alt={b.name} className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-105" />
                  ) : (
                    <div className="absolute inset-0 bg-gradient-to-br from-slate-700 to-slate-900" />
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-transparent" />
                  {embedOf(b.videoUrl) && <span className="absolute top-4 right-4 text-[9px] font-black bg-black/60 text-white rounded-full px-2.5 py-1 backdrop-blur">▶ Video tour</span>}
                  {ph.length > 1 && <span className="absolute top-4 left-4 text-[9px] font-black bg-black/60 text-white rounded-full px-2.5 py-1 backdrop-blur">📷 {ph.length}</span>}
                  <div className="absolute bottom-0 inset-x-0 p-5 space-y-2">
                    <p className="font-black text-white text-xl tracking-tight">{b.name}</p>
                    {ratingOf(b) && <p className="text-[11px] font-black text-amber-300">★ {ratingOf(b)!.avg.toFixed(1)} <span className="text-white/50 font-bold">({ratingOf(b)!.count})</span></p>}
                    {blurbOf(b) && <p className="text-white/70 text-xs font-medium leading-relaxed line-clamp-2">{blurbOf(b)}</p>}
                    {Array.isArray(b.amenities) && b.amenities.length > 0 && (
                      <p className="text-[10px] font-bold text-white/60 uppercase tracking-wide">{b.amenities.slice(0, 3).join(' · ')}</p>
                    )}
                    <div className="flex items-end justify-between gap-3 pt-1">
                      <div className="flex gap-3 flex-wrap">
                        {lease[0] && <p className="text-white font-black text-sm">${(lease[0].amountCents / 100).toFixed(0)}<span className="text-white/50 font-bold text-[10px]">/{lease[0].frequency}</span></p>}
                        {rates[0] && <p className="text-white font-black text-sm">${(rates[0].amountCents / 100).toFixed(0)}<span className="text-white/50 font-bold text-[10px]">/{rates[0].frequency === 'hourly' ? 'hr' : 'day'}</span></p>}
                      </div>
                      <span className="text-[9px] font-black uppercase tracking-widest text-white bg-white/20 backdrop-blur rounded-full px-3 py-1.5">View space →</span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        ) : layout === 'luxe' ? (
          /* LUXE — full-bleed editorial cards */
          <div className="grid gap-6 md:grid-cols-2">
            {visible.map((b: any) => (
              <div key={b.id} className="group relative rounded-[2rem] overflow-hidden h-96 cursor-pointer" onClick={() => openApply(b)}>
                <Photo b={b} className="absolute inset-0 h-full" />
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
                <div className="absolute bottom-0 inset-x-0 p-6 space-y-2.5">
                  <div className="flex items-end justify-between gap-3">
                    <div>
                      <p className="text-[9px] font-black uppercase tracking-[0.25em] text-white/60">{isLease(b) ? 'Monthly Lease' : 'Hourly · Daily'}{b.type ? ` · ${b.type}` : ''}</p>
                      <h3 className="font-black text-2xl text-white tracking-tight">{b.name || 'Station'}</h3>
                    </div>
                    <PriceTag b={b} light />
                  </div>
                  <Chips b={b} light />
                  <p className="text-[10px] font-black uppercase tracking-widest text-white/80 group-hover:text-white transition-colors">Tap to {isLease(b) ? 'apply' : 'reserve'} →</p>
                </div>
              </div>
            ))}
          </div>
        ) : layout === 'showcase' ? (
          /* SHOWCASE — magazine spreads, alternating */
          <div className="space-y-10">
            {visible.map((b: any, i: number) => (
              <div key={b.id} className={`group grid md:grid-cols-2 gap-0 rounded-[2rem] overflow-hidden border bg-white shadow-sm hover:shadow-2xl transition-shadow ${i % 2 ? 'md:[&>*:first-child]:order-2' : ''}`}>
                <Photo b={b} className="h-64 md:h-80" />
                <div className="p-8 md:p-10 flex flex-col justify-center gap-4">
                  <div>
                    <p className="text-[9px] font-black uppercase tracking-[0.25em] opacity-50">{isLease(b) ? 'Monthly Lease' : 'Hourly · Daily'}{b.type ? ` · ${b.type}` : ''}</p>
                    <div className="flex items-end justify-between gap-3 mt-1">
                      <h3 className="font-black text-2xl md:text-3xl tracking-tight">{b.name || 'Station'}</h3>
                      <PriceTag b={b} />
                    </div>
                  </div>
                  {blurbOf(b) && <p className="text-sm opacity-70 font-medium leading-relaxed line-clamp-4">{blurbOf(b)}</p>}
                  <Chips b={b} />
                  <CTA b={b} />
                  <InquiryRow b={b} />
                </div>
              </div>
            ))}
          </div>
        ) : (
          /* GRID — marketplace cards */
          <div className="grid gap-6 md:gap-8 sm:grid-cols-2 lg:grid-cols-3">
            {visible.map((b: any) => (
              <div key={b.id} className="group rounded-3xl overflow-hidden border bg-white shadow-sm hover:shadow-2xl hover:-translate-y-1 transition-all duration-300">
                <Photo b={b} className="h-44 md:h-52" />
                <div className="p-5 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="font-black text-lg tracking-tight truncate">{b.name || 'Station'}</h3>
                      <p className="text-[10px] font-black uppercase tracking-widest opacity-50">{isLease(b) ? 'Monthly lease' : 'Hourly · daily'}{b.type ? ` · ${b.type}` : ''}</p>
                    </div>
                    <PriceTag b={b} />
                  </div>
                  {blurbOf(b) && <p className="text-xs opacity-70 font-medium line-clamp-2">{blurbOf(b)}</p>}
                  <Chips b={b} />
                  <CTA b={b} />
                  <InquiryRow b={b} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Application dialog — immersive: photo strip + guided form ── */}
      {applyFor && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-6" onClick={() => !submitting && setApplyFor(null)}>
          <div className="relative bg-white w-full sm:max-w-lg rounded-t-3xl sm:rounded-3xl overflow-hidden max-h-[92dvh] flex flex-col" onClick={e => e.stopPropagation()}>
            {submitting && (
              <div className="absolute inset-0 z-20 bg-white/75 backdrop-blur-sm flex items-center justify-center">
                <div className="flex flex-col items-center gap-3">
                  <div className="w-10 h-10 rounded-full border-[3px] border-slate-200 border-t-slate-900 animate-spin" />
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">{inquiryKind === 'tour' ? 'Requesting your tour…' : (applyMode === 'day' && !isLease(applyFor)) ? 'Starting secure checkout…' : 'Sending…'}</p>
                </div>
              </div>
            )}
            {submitted ? (
              <div className="text-center py-12 px-6 space-y-4">
                <div className="mx-auto w-16 h-16 rounded-full bg-emerald-500 flex items-center justify-center text-white text-3xl font-black shadow-lg shadow-emerald-500/30 animate-in zoom-in duration-300">✓</div>
                <div className="space-y-1">
                  <h3 className="font-black text-xl tracking-tight">
                    {inquiryKind === 'tour' ? 'Tour requested!' : inquiryKind === 'question' ? 'Question sent!' : inquiryKind === 'waitlist' ? "You're on the waitlist!" : 'Application received!'}
                  </h3>
                  <p className="text-sm text-slate-500 font-medium">
                    {inquiryKind === 'tour' && tourSlot ? `${applyFor.name || 'The space'} · ${tourSlot}` : (applyFor.name || 'The space')}
                  </p>
                </div>
                <p className="text-[13px] text-slate-500 font-medium max-w-xs mx-auto leading-relaxed">
                  {inquiryKind === 'tour' ? "We'll confirm your tour shortly by phone or email — keep an eye out." : inquiryKind === 'question' ? "We'll get back to you within one business day." : inquiryKind === 'waitlist' ? "We'll notify you the moment a spot opens up." : "We'll review your application and reach out within one business day."}
                </p>
                <button onClick={() => setApplyFor(null)} className="h-12 px-10 rounded-2xl bg-slate-900 text-white font-black uppercase text-[10px] tracking-widest active:scale-[0.98] transition-transform">Done</button>
              </div>
            ) : (
              <>
                {(photosOf(applyFor).length > 0 || embedOf(applyFor.videoUrl)) && (() => {
                  // Full media gallery — every photo AND the video are slides in
                  // one horizontal, swipeable, scroll-snapping strip, so nothing
                  // is hidden behind a toggle or off-screen.
                  const vid = embedOf(applyFor.videoUrl);
                  const photos = photosOf(applyFor);
                  const total = photos.length + (vid ? 1 : 0);
                  return (
                    <div className="relative shrink-0 bg-black">
                      <div className="flex overflow-x-auto snap-x snap-mandatory" style={{ scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' }}>
                        {photos.map((src, i) => (
                          <div key={i} className="snap-center shrink-0 w-full h-56 relative">
                            <img src={src} alt="" className="w-full h-full object-cover" />
                            {total > 1 && <span className="absolute top-2 left-2 text-[9px] font-black uppercase tracking-widest bg-black/60 text-white rounded-full px-2.5 py-1 backdrop-blur">{i + 1}/{total}</span>}
                          </div>
                        ))}
                        {vid && (
                          <div className="snap-center shrink-0 w-full h-56 relative">
                            {vid.kind === 'iframe'
                              ? <iframe src={vid.src} className="w-full h-full" allow="autoplay; fullscreen" allowFullScreen />
                              : <video src={vid.src} className="w-full h-full object-cover" controls muted playsInline />}
                            <span className="absolute top-2 left-2 text-[9px] font-black uppercase tracking-widest bg-black/70 text-white rounded-full px-2.5 py-1 backdrop-blur pointer-events-none">▶ Video</span>
                          </div>
                        )}
                      </div>
                      {total > 1 && (
                        <div className="py-1.5 text-center bg-black">
                          <span className="text-[9px] font-black uppercase tracking-widest text-white/60">← Swipe · {photos.length} photo{photos.length === 1 ? '' : 's'}{vid ? ' + video' : ''} →</span>
                        </div>
                      )}
                    </div>
                  );
                })()}
                <div className="p-6 space-y-3.5 overflow-y-auto">
                  {showChooser && (
                    <div className="space-y-4 py-1">
                      <div>
                        <h3 className="font-black text-xl tracking-tight">{applyFor.name || 'This space'}</h3>
                        <p className="text-xs opacity-60 font-bold mt-0.5">{((isLease(applyFor) ? leaseRates(applyFor) : ratesOf(applyFor)).slice(0, 2).map((r: any) => `$${Math.round(r.amountCents / 100).toLocaleString()}${FREQ_LABEL[r.frequency] || ''}`).join(' · ')) || ''} · We respond within one business day.</p>
                      </div>
                      {(ratingOf(applyFor) || blurbOf(applyFor) || (Array.isArray(applyFor.amenities) && applyFor.amenities.length > 0)) && (
                        <div className="rounded-2xl bg-slate-50 border-2 border-slate-100 p-3.5 space-y-2.5">
                          {ratingOf(applyFor) && (
                            <div className="flex items-center gap-2"><Stars avg={ratingOf(applyFor)!.avg} /><span className="text-xs font-black">{ratingOf(applyFor)!.avg.toFixed(1)}</span><span className="text-[10px] font-bold text-slate-400">· {ratingOf(applyFor)!.count} review{ratingOf(applyFor)!.count === 1 ? '' : 's'}</span></div>
                          )}
                          {blurbOf(applyFor) && <p className="text-xs leading-relaxed text-slate-600 font-medium whitespace-pre-wrap max-h-24 overflow-y-auto">{blurbOf(applyFor)}</p>}
                          {Array.isArray(applyFor.amenities) && applyFor.amenities.length > 0 && (
                            <div className="flex flex-wrap gap-1.5">{applyFor.amenities.map((a: string) => (<span key={a} className="text-[10px] font-bold text-slate-600 bg-white border rounded-full px-2.5 py-1">✓ {a}</span>))}</div>
                          )}
                          {ratesOf(applyFor).length > 1 && (
                            <div className="flex flex-wrap gap-x-3 gap-y-1 pt-0.5">{ratesOf(applyFor).map((rt: any) => (<span key={rt.frequency} className="text-[10px] font-black text-slate-500"><span className="uppercase tracking-wide">{rt.frequency}</span> ${(rt.amountCents / 100).toFixed(rt.amountCents % 100 === 0 ? 0 : 2)}</span>))}</div>
                          )}
                        </div>
                      )}
                      <div className="space-y-2">
                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">What would you like to do?</p>
                        {leaseRates(applyFor).length > 0 && (
                          <button type="button" onClick={() => { openApply(applyFor, 'lease'); setShowChooser(false); }} className="w-full rounded-2xl border-2 border-slate-900 bg-slate-900 text-white p-4 flex items-center justify-between text-left transition-all active:scale-[0.99]">
                            <span className="min-w-0"><span className="block text-sm font-black">Apply for full-time rental</span>{leaseRates(applyFor)[0] && <span className="block text-[11px] font-bold text-white/60">${Math.round(leaseRates(applyFor)[0].amountCents / 100).toLocaleString()}{FREQ_LABEL[leaseRates(applyFor)[0].frequency] || '/mo'}</span>}</span>
                            <span className="text-lg font-black text-white">›</span>
                          </button>
                        )}
                        {dailyRateOf(applyFor) && (
                          <button type="button" onClick={() => { openApply(applyFor, 'day'); setGranularity('daily'); setReserveStep('when'); setShowChooser(false); }} className="w-full rounded-2xl border-2 border-slate-200 p-4 flex items-center justify-between text-left transition-all active:scale-[0.99] hover:border-slate-900">
                            <span className="min-w-0"><span className="block text-sm font-black">Reserve a day</span><span className="block text-[11px] font-bold text-slate-400">${(dailyRateOf(applyFor).amountCents / 100).toFixed(0)}/day</span></span>
                            <span className="text-lg font-black text-slate-300">›</span>
                          </button>
                        )}
                        {(hourlyRateOf(applyFor) || slotsOf(applyFor).length > 0) && (
                          <button type="button" onClick={() => { openApply(applyFor, 'day'); setGranularity('hourly'); setReserveStep('when'); setShowChooser(false); }} className="w-full rounded-2xl border-2 border-slate-200 p-4 flex items-center justify-between text-left transition-all active:scale-[0.99] hover:border-slate-900">
                            <span className="min-w-0"><span className="block text-sm font-black">{slotsOf(applyFor).length > 0 ? 'Book a time slot' : 'Book by the hour'}</span>{hourlyRateOf(applyFor) && <span className="block text-[11px] font-bold text-slate-400">${(hourlyRateOf(applyFor).amountCents / 100).toFixed(0)}/hr</span>}</span>
                            <span className="text-lg font-black text-slate-300">›</span>
                          </button>
                        )}
                        <button type="button" onClick={() => { openInquiry(applyFor, 'tour'); setShowChooser(false); }} className="w-full rounded-2xl border-2 border-slate-200 p-4 flex items-center justify-between text-left transition-all active:scale-[0.99] hover:border-slate-900">
                          <span className="block text-sm font-black">Book a tour</span>
                          <span className="text-lg font-black text-slate-300">›</span>
                        </button>
                        <button type="button" onClick={() => { openInquiry(applyFor, 'question'); setShowChooser(false); }} className="w-full rounded-2xl border-2 border-slate-200 p-4 flex items-center justify-between text-left transition-all active:scale-[0.99] hover:border-slate-900">
                          <span className="block text-sm font-black">Ask a question</span>
                          <span className="text-lg font-black text-slate-300">›</span>
                        </button>
                      </div>
                    </div>
                  )}
                  {!showChooser && (<>
                  <div>
                    <h3 className="font-black text-xl tracking-tight">
                    {inquiryKind === 'tour' ? `Tour ${applyFor.name || 'the space'}`
                      : inquiryKind === 'question' ? `Ask about ${applyFor.name || 'the space'}`
                      : inquiryKind === 'waitlist' ? 'Join the waitlist'
                      : `${applyMode === 'lease' ? 'Apply for' : 'Reserve'} ${applyFor.name || 'this space'}`}
                  </h3>
                    <p className="text-xs opacity-60 font-bold mt-0.5">{(applyMode === 'lease' ? leaseRates(applyFor) : dayRates(applyFor)).slice(0, 2).map(r => `$${Math.round(r.amountCents / 100).toLocaleString()}${FREQ_LABEL[r.frequency] || ''}`).join(' · ') || `$${priceOf(applyFor).amount.toLocaleString()}${priceOf(applyFor).suffix}`} · We respond within one business day.</p>
                  </div>

                  {applyFor.id && (
                    <button type="button" onClick={() => setShowChooser(true)} className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-slate-700 transition-colors">‹ Back to options</button>
                  )}

                  {/* Space details now live in the chooser overview above — the
                      focused flow stays clean, just the form for the chosen action. */}
                  {(applyMode !== 'day' || reserveStep === 'you') && (
                  <div className="space-y-3 animate-in fade-in duration-200">
                  <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Your name *" className="w-full h-12 rounded-xl border-2 px-4 text-sm font-medium" />
                  <div className="grid grid-cols-2 gap-2">
                    <input type="tel" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="Phone *" className="h-12 rounded-xl border-2 px-4 text-sm font-medium" />
                    <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="Email" className="h-12 rounded-xl border-2 px-4 text-sm font-medium" />
                  </div>
                  {applyMode !== 'day' && (
                  <>
                  {/* Niche — owner-configured, prefilled options */}
                  <div className="flex flex-wrap gap-1.5">
                    {niches.map(n => (
                      <button key={n} type="button" onClick={() => setForm(f => ({ ...f, niche: n }))}
                        className={`h-9 px-3.5 rounded-full border-2 text-[10px] font-black uppercase tracking-wide transition-colors ${form.niche === n ? 'bg-slate-900 text-white border-slate-900' : 'border-slate-200 text-slate-600 hover:border-slate-400'}`}>
                        {n}
                      </button>
                    ))}
                  </div>
                  {form.niche === 'Other' && (
                    <input type="text" value={form.nicheOther} onChange={e => setForm(f => ({ ...f, nicheOther: e.target.value }))} placeholder="Tell us your specialty" className="w-full h-12 rounded-xl border-2 px-4 text-sm font-medium" />
                  )}
                  {config.applicationQualifiers && inquiryKind === 'application' && (
                    <div className="space-y-3 rounded-2xl border-2 border-slate-100 bg-slate-50 p-3.5">
                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">A few quick questions</p>
                      {[
                        { key: 'licensed', label: 'Are you licensed?', opts: ['Yes', 'No', 'In progress'] },
                        { key: 'bringClients', label: 'Do you bring your own clients?', opts: ['Yes', 'Building', 'No'] },
                        { key: 'experience', label: 'Years of experience', opts: ['<1', '1–3', '3–5', '5+'] },
                      ].map(q => (
                        <div key={q.key}>
                          <p className="text-[10px] font-bold text-slate-500 mb-1">{q.label}</p>
                          <div className="flex flex-wrap gap-1.5">
                            {q.opts.map(v => (
                              <button key={v} type="button" onClick={() => setForm(f => ({ ...f, [q.key]: v }))}
                                className={`h-8 px-3 rounded-full border-2 text-[10px] font-black uppercase tracking-wide transition-colors ${(form as any)[q.key] === v ? 'bg-slate-900 text-white border-slate-900' : 'border-slate-200 text-slate-600 hover:border-slate-400'}`}>
                                {v}
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  </>
                  )}
                  </div>
                  )}

                  {/* Dates — different question per product */}
                  {inquiryKind === 'tour' ? (
                    <div className="space-y-2">
                      {scheduledTours && tourSlots.length > 0 ? (
                        // Weekly schedule → concrete, always-current times. The slot
                        // already carries the date, so no separate date field is needed.
                        <div>
                          <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">Pick a tour time</p>
                          <div className="flex flex-wrap gap-1.5 max-h-52 overflow-y-auto">
                            {tourSlotObjs.map(o => (
                              <button key={o.label} type="button" onClick={() => pickTour(o)}
                                className={`h-9 px-3.5 rounded-full border-2 text-[10px] font-black uppercase tracking-wide transition-colors ${tourSlot === o.label ? 'bg-slate-900 text-white border-slate-900' : 'border-slate-200 text-slate-600 hover:border-slate-400'}`}>
                                {o.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : scheduledTours ? (
                        <p className="text-[11px] font-medium text-slate-500 py-2">No tour times available in the next few weeks — send your request and we'll reach out to arrange one.</p>
                      ) : (
                        <>
                          <div>
                            <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">Pick a day</p>
                            {(() => {
                              const dates = availableDates(applyFor);
                              if (dates.length === 0) return <p className="text-[11px] font-medium text-slate-500">Send your request and we'll arrange a time.</p>;
                              return (
                                <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5 max-h-40 overflow-y-auto pr-0.5">
                                  {dates.map(diso => {
                                    const d = new Date(diso + 'T00:00:00'); const sel = form.moveIn === diso;
                                    return (
                                      <button key={diso} type="button" onClick={() => { setForm(f => ({ ...f, moveIn: diso })); setTourSlot(''); setTourStartIso(''); setTourEndIso(''); }}
                                        className={`h-14 rounded-2xl border-2 flex flex-col items-center justify-center gap-0.5 transition-colors active:scale-[0.97] ${sel ? 'bg-slate-900 text-white border-slate-900' : 'border-slate-200 text-slate-700 hover:border-slate-400'}`}>
                                        <span className="text-[9px] font-black uppercase tracking-widest opacity-70">{TOUR_DOW_SHORT[d.getDay()]}</span>
                                        <span className="text-sm font-black leading-none">{TOUR_MON_SHORT[d.getMonth()]} {d.getDate()}</span>
                                      </button>
                                    );
                                  })}
                                </div>
                              );
                            })()}
                          </div>
                          {form.moveIn && (
                            <div>
                              <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">Pick a time</p>
                              <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto">
                                {(() => {
                                  const openM = toMin((applyFor as any).openTime || '10:00');
                                  const closeM = toMin((applyFor as any).closeTime || '17:00');
                                  const times: number[] = [];
                                  for (let m = (closeM > openM ? openM : 600); m + 30 <= (closeM > openM ? closeM : 1020); m += 30) times.push(m);
                                  return times.map(m => {
                                    const hh = String(Math.floor(m / 60)).padStart(2, '0'); const mm = String(m % 60).padStart(2, '0');
                                    const st = new Date(`${form.moveIn}T${hh}:${mm}:00`);
                                    const sel = tourStartIso === st.toISOString();
                                    return (
                                      <button key={m} type="button" onClick={() => { const en = new Date(st.getTime() + 30 * 60000); const d = new Date(form.moveIn + 'T00:00:00'); setTourStartIso(st.toISOString()); setTourEndIso(en.toISOString()); setTourSlot(`${TOUR_DOW_SHORT[d.getDay()]} ${TOUR_MON_SHORT[d.getMonth()]} ${d.getDate()} · ${t12(`${hh}:${mm}`)}`); }}
                                        className={`h-9 px-3.5 rounded-full border-2 text-[10px] font-black uppercase tracking-wide transition-colors ${sel ? 'bg-slate-900 text-white border-slate-900' : 'border-slate-200 text-slate-600 hover:border-slate-400'}`}>
                                        {t12(`${hh}:${mm}`)}
                                      </button>
                                    );
                                  });
                                })()}
                              </div>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  ) : inquiryKind !== 'application' ? null : applyMode === 'lease' ? (
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">When are you looking to start?</p>
                      <div className="flex flex-wrap gap-1.5">
                        {['Immediately', 'Within 1 month', '1–3 months', 'Just exploring'].map(p => (
                          <button key={p} type="button" onClick={() => setForm(f => ({ ...f, moveIn: p }))}
                            className={`h-9 px-3.5 rounded-full border-2 text-[10px] font-black uppercase tracking-wide transition-colors ${form.moveIn === p ? 'bg-slate-900 text-white border-slate-900' : 'border-slate-200 text-slate-600 hover:border-slate-400'}`}>
                            {p}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {/* Stepper rail */}
                      {(() => {
                        const hasChoice = dailyRateOf(applyFor) && (hourlyRateOf(applyFor) || slotsOf(applyFor).length > 0);
                        const steps = hasChoice ? ['type', 'when', 'time', 'you'] : ['when', 'time', 'you'];
                        const useTime = granularity === 'hourly';
                        const shown = steps.filter(s => s !== 'time' || useTime);
                        const idx = shown.indexOf(reserveStep === 'type' && !hasChoice ? 'when' : reserveStep);
                        return (
                          <div className="flex items-center gap-1.5">
                            {shown.map((s, k) => (
                              <div key={s} className={`h-1.5 flex-1 rounded-full transition-colors duration-300 ${k <= idx ? 'bg-slate-900' : 'bg-slate-200'}`} />
                            ))}
                          </div>
                        );
                      })()}

                      {(() => {
                        const hasChoice = dailyRateOf(applyFor) && (hourlyRateOf(applyFor) || slotsOf(applyFor).length > 0);
                        const useTime = granularity === 'hourly';
                        const hasSlots = slotsOf(applyFor).length > 0;
                        // Auto-skip 'type' when there's only one option
                        const step = (reserveStep === 'type' && !hasChoice) ? 'when' : reserveStep;

                        const priceLine = () => {
                          if (useTime && pickedSlot) return `$${(pickedSlot.amountCents / 100).toFixed(pickedSlot.amountCents % 100 === 0 ? 0 : 2)}`;
                          if (useTime && form.startTime && form.endTime && hourlyRateOf(applyFor)) {
                            const hrs = (new Date(`2000-01-01T${form.endTime}:00`).getTime() - new Date(`2000-01-01T${form.startTime}:00`).getTime()) / 3600000;
                            return hrs > 0 ? `$${((hourlyRateOf(applyFor).amountCents * hrs) / 100).toFixed(2)}` : '';
                          }
                          if (!useTime && form.startDate && form.endDate && dailyRateOf(applyFor)) {
                            const days = Math.round((new Date(form.endDate).getTime() - new Date(form.startDate).getTime()) / 86400000) + 1;
                            return days > 0 ? `$${((dailyRateOf(applyFor).amountCents * days) / 100).toFixed(0)}${days > 1 ? ` · ${days} days` : ''}` : '';
                          }
                          return '';
                        };
                        const whenLabel = () => {
                          if (!form.startDate) return '';
                          const d = (iso: string) => new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
                          if (useTime) return `${d(form.startDate)}${pickedSlot ? ` · ${pickedSlot.label}` : form.startTime ? ` · ${t12(form.startTime)}–${t12(form.endTime)}` : ''}`;
                          return form.endDate && form.endDate !== form.startDate ? `${d(form.startDate)} → ${d(form.endDate)}` : d(form.startDate);
                        };

                        return (
                          <div key={step} className="animate-in fade-in slide-in-from-right-2 duration-200 space-y-3">

                            {/* STEP: TYPE */}
                            {step === 'type' && (
                              <div className="space-y-2">
                                <p className="text-sm font-black tracking-tight">How do you want to book?</p>
                                <button type="button" onClick={() => { setGranularity('daily'); setReserveStep('when'); }}
                                  className="w-full rounded-2xl border-2 p-4 flex items-center justify-between text-left hover:border-slate-900 transition-colors active:scale-[0.99]">
                                  <div><p className="text-sm font-black">Full day</p><p className="text-[11px] font-bold text-slate-400">Book one or more whole days</p></div>
                                  <span className="text-lg font-black">${(dailyRateOf(applyFor).amountCents / 100).toFixed(0)}<span className="text-[10px] text-slate-400">/day</span></span>
                                </button>
                                <button type="button" onClick={() => { setGranularity('hourly'); setReserveStep('when'); }}
                                  className="w-full rounded-2xl border-2 p-4 flex items-center justify-between text-left hover:border-slate-900 transition-colors active:scale-[0.99]">
                                  <div><p className="text-sm font-black">{hasSlots ? 'Time slot' : 'By the hour'}</p><p className="text-[11px] font-bold text-slate-400">{hasSlots ? 'Pick a ready-made time block' : 'Choose your own hours'}</p></div>
                                  {hourlyRateOf(applyFor) && !hasSlots && <span className="text-lg font-black">${(hourlyRateOf(applyFor).amountCents / 100).toFixed(0)}<span className="text-[10px] text-slate-400">/hr</span></span>}
                                  {hasSlots && <span className="text-[10px] font-black uppercase text-slate-400">Slots →</span>}
                                </button>
                              </div>
                            )}

                            {/* STEP: WHEN (calendar) */}
                            {step === 'when' && (
                              <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                  <p className="text-sm font-black tracking-tight">Pick an available day</p>
                                  {hasChoice && <button type="button" onClick={() => setReserveStep('type')} className="text-[10px] font-black uppercase tracking-widest text-slate-400">← Back</button>}
                                </div>
                                {Array.isArray((applyFor as any)?.dayRentalDays) && (applyFor as any).dayRentalDays.length > 0 && (applyFor as any).dayRentalDays.length < 7 && (
                                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Available {(applyFor as any).dayRentalDays.slice().sort((a: number, b: number) => a - b).map((d: number) => DOW_NAMES[d]).join(' · ')}</p>
                                )}
                                {(() => {
                                  const dates = availableDates(applyFor);
                                  if (dates.length === 0) return (
                                    <p className="text-[11px] font-medium text-slate-500 rounded-xl bg-slate-50 border-2 border-dashed px-3.5 py-3">No open days coming up — send a question and we'll help you find a time.</p>
                                  );
                                  return (
                                    <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5 max-h-56 overflow-y-auto pr-0.5">
                                      {dates.map(diso => {
                                        const d = new Date(diso + 'T00:00:00');
                                        const sel = form.startDate === diso;
                                        return (
                                          <button key={diso} type="button" onClick={() => setForm(f => ({ ...f, startDate: diso, endDate: diso }))}
                                            className={`h-16 rounded-2xl border-2 flex flex-col items-center justify-center gap-0.5 transition-colors active:scale-[0.97] ${sel ? 'bg-slate-900 text-white border-slate-900' : 'border-slate-200 text-slate-700 hover:border-slate-400'}`}>
                                            <span className="text-[9px] font-black uppercase tracking-widest opacity-70">{TOUR_DOW_SHORT[d.getDay()]}</span>
                                            <span className="text-sm font-black leading-none">{TOUR_MON_SHORT[d.getMonth()]} {d.getDate()}</span>
                                          </button>
                                        );
                                      })}
                                    </div>
                                  );
                                })()}
                                {scheduleIssue && <p className="text-[10px] font-black uppercase text-amber-600 rounded-xl bg-amber-50 border border-amber-200 px-3 py-2">⚠ {scheduleIssue}</p>}
                                {form.startDate && (!useTime ? form.endDate : true) && !scheduleIssue && (
                                  <button type="button" onClick={() => setReserveStep(useTime ? 'time' : 'you')}
                                    className="w-full h-12 rounded-2xl bg-slate-900 text-white font-black uppercase text-[10px] tracking-widest active:scale-[0.99] transition-transform">
                                    Continue{priceLine() ? ` · ${priceLine()}` : ''} →
                                  </button>
                                )}
                              </div>
                            )}

                            {/* STEP: TIME — start-time grid + duration (and slots if offered) */}
                            {step === 'time' && useTime && (() => {
                              const starts = startTimesFor(applyFor);
                              const showSlots = hasSlots && hourlyMode === 'slots';
                              const hourRate = hourlyRateOf(applyFor);
                              return (
                                <div className="space-y-3">
                                  <div className="flex items-center justify-between">
                                    <p className="text-sm font-black tracking-tight">When works for you?</p>
                                    <button type="button" onClick={() => setReserveStep('when')} className="text-[10px] font-black uppercase tracking-widest text-slate-400">← Back</button>
                                  </div>

                                  {/* Slots vs by-the-hour toggle — only when both exist */}
                                  {hasSlots && hourRate && (
                                    <div className="flex gap-1 p-1 bg-slate-100 rounded-xl">
                                      {(['slots', 'custom'] as const).map(m => (
                                        <button key={m} type="button" onClick={() => { setHourlyMode(m); setPickedSlot(null); setPickedStart(''); setPickedHours(0); setForm(f => ({ ...f, startTime: '', endTime: '' })); }}
                                          className={`flex-1 h-9 rounded-lg text-[10px] font-black uppercase tracking-widest transition-colors ${hourlyMode === m ? 'bg-slate-900 text-white' : 'text-slate-500'}`}>
                                          {m === 'slots' ? 'Ready-made slots' : 'By the hour'}
                                        </button>
                                      ))}
                                    </div>
                                  )}

                                  {showSlots ? (
                                    <div className="grid grid-cols-2 gap-2">
                                      {slotsOf(applyFor).map((s: any) => (
                                        <button key={s.label + s.startTime} type="button"
                                          onClick={() => { setPickedSlot(s); setForm(f => ({ ...f, startTime: s.startTime, endTime: s.endTime })); }}
                                          className={`rounded-2xl border-2 p-3.5 text-left transition-all active:scale-[0.98] ${pickedSlot?.label === s.label && pickedSlot?.startTime === s.startTime ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 hover:border-slate-400'}`}>
                                          <p className="text-sm font-black">{s.label}</p>
                                          <p className={`text-[10px] font-bold ${pickedSlot?.label === s.label && pickedSlot?.startTime === s.startTime ? 'text-white/60' : 'text-slate-400'}`}>{t12(s.startTime)} – {t12(s.endTime)}</p>
                                          <p className="text-base font-black mt-0.5">${(s.amountCents / 100).toFixed(s.amountCents % 100 === 0 ? 0 : 2)}</p>
                                        </button>
                                      ))}
                                    </div>
                                  ) : (
                                    <>
                                      {/* Start time grid */}
                                      <div>
                                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5">Start time</p>
                                        {starts.length === 0 ? (
                                          <p className="text-xs text-slate-400 py-2">No available start times for this space.</p>
                                        ) : (
                                          <div className="grid grid-cols-3 gap-2">
                                            {starts.map(st => (
                                              <button key={st} type="button"
                                                onClick={() => { setPickedStart(st); setPickedHours(0); setForm(f => ({ ...f, startTime: st, endTime: '' })); setPickedSlot(null); }}
                                                className={`h-11 rounded-xl border-2 text-xs font-black transition-all active:scale-95 ${pickedStart === st ? 'bg-slate-900 text-white border-slate-900' : 'border-slate-200 hover:border-slate-400'}`}>
                                                {t12(st)}
                                              </button>
                                            ))}
                                          </div>
                                        )}
                                      </div>

                                      {/* Duration chips — capped at closing time */}
                                      {pickedStart && (
                                        <div className="animate-in fade-in duration-200">
                                          <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5">How long?</p>
                                          <div className="grid grid-cols-4 gap-2">
                                            {Array.from({ length: Math.min(8, maxHoursFor(applyFor, pickedStart)) }, (_, i) => i + 1).map(h => (
                                              <button key={h} type="button"
                                                onClick={() => { setPickedHours(h); const endM = toMin(pickedStart) + h * 60; setForm(f => ({ ...f, startTime: pickedStart, endTime: toHHMM(endM) })); }}
                                                className={`h-11 rounded-xl border-2 text-xs font-black transition-all active:scale-95 ${pickedHours === h ? 'bg-slate-900 text-white border-slate-900' : 'border-slate-200 hover:border-slate-400'}`}>
                                                {h}h
                                              </button>
                                            ))}
                                          </div>
                                          {pickedHours > 0 && hourRate && (
                                            <p className="text-[11px] font-bold text-slate-500 mt-2">
                                              {t12(pickedStart)} – {t12(form.endTime)} · {pickedHours} hour{pickedHours === 1 ? '' : 's'} · ${((hourRate.amountCents * pickedHours) / 100).toFixed(2)}
                                            </p>
                                          )}
                                        </div>
                                      )}
                                    </>
                                  )}

                                  {scheduleIssue && <p className="text-[10px] font-black uppercase text-amber-600 rounded-xl bg-amber-50 border border-amber-200 px-3 py-2">⚠ {scheduleIssue}</p>}
                                  {(pickedSlot || (form.startTime && form.endTime && form.startTime < form.endTime)) && !scheduleIssue && (
                                    <button type="button" onClick={() => setReserveStep('you')}
                                      className="w-full h-12 rounded-2xl bg-slate-900 text-white font-black uppercase text-[10px] tracking-widest active:scale-[0.99] transition-transform">
                                      Continue{priceLine() ? ` · ${priceLine()}` : ''} →
                                    </button>
                                  )}
                                </div>
                              );
                            })()}

                            {/* STEP: YOU (summary + details) */}
                            {step === 'you' && (
                              <div className="space-y-3">
                                <div className="flex items-center justify-between">
                                  <p className="text-sm font-black tracking-tight">Almost there</p>
                                  <button type="button" onClick={() => setReserveStep(useTime ? 'time' : 'when')} className="text-[10px] font-black uppercase tracking-widest text-slate-400">← Back</button>
                                </div>
                                <div className="rounded-2xl bg-slate-900 text-white p-4 space-y-0.5">
                                  <p className="text-[10px] font-black uppercase tracking-widest text-white/50">{applyFor.name}</p>
                                  <p className="text-sm font-black">{whenLabel()}</p>
                                  {priceLine() && <p className="text-lg font-black text-emerald-300">{priceLine()}</p>}
                                  {(() => {
                                    const dt = (applyFor as any).depositType ?? (compRules.depositRequired ? (compRules.depositType || 'percent') : 'none');
                                    if (!dt || dt === 'none') return null;
                                    const bm = ((applyFor as any).balanceMode || compRules.balanceMode) === 'at_checkin' ? 'at check-in' : 'in person';
                                    // Total from the current selection (same math as priceLine)
                                    let totalCents = 0;
                                    if (useTime && pickedSlot) totalCents = pickedSlot.amountCents;
                                    else if (useTime && form.startTime && form.endTime && hourlyRateOf(applyFor)) {
                                      const hrs = (toMin(form.endTime) - toMin(form.startTime)) / 60;
                                      if (hrs > 0) totalCents = Math.round(hourlyRateOf(applyFor).amountCents * hrs);
                                    } else if (!useTime && form.startDate && form.endDate && dailyRateOf(applyFor)) {
                                      const days = Math.round((new Date(form.endDate).getTime() - new Date(form.startDate).getTime()) / 86400000) + 1;
                                      if (days > 0) totalCents = dailyRateOf(applyFor).amountCents * days;
                                    }
                                    const hrsBooked = useTime && form.startTime && form.endTime
                                      ? Math.max(0, (toMin(form.endTime) - toMin(form.startTime)) / 60) : 8;
                                    let dep = 0;
                                    if (dt === 'flat') dep = Number((applyFor as any).depositFlatCents ?? compRules.depositFlatCents) || 0;
                                    else if (dt === 'percent') { const p = Number((applyFor as any).depositPercent ?? compRules.depositPercent) || 0; if (p > 0 && p < 100) dep = Math.round(totalCents * p / 100); }
                                    else if (dt === 'breakeven') { const hr = Number((applyFor as any).breakevenHourlyCents ?? compRules.breakevenHourlyCents) || 0; dep = Math.round(hr * hrsBooked); }
                                    if (totalCents > 100) dep = Math.min(dep, totalCents);
                                    // Break-even may resolve server-side from TMHR — be honest when unknown
                                    if (dep <= 0) {
                                      return dt === 'breakeven'
                                        ? <p className="text-[11px] font-bold text-white/60">A hold-your-time deposit is calculated at checkout · balance {bm}</p>
                                        : null;
                                    }
                                    if (totalCents > 100 && dep >= totalCents) return null;
                                    const bal = totalCents > 0 ? totalCents - dep : 0;
                                    return (
                                      <div className="pt-1 space-y-0.5">
                                        <p className="text-sm font-black">Due now: <span className="text-emerald-300">${(dep / 100).toFixed(2)}</span> <span className="text-[10px] font-bold text-white/50 uppercase">deposit</span></p>
                                        {bal > 0 && <p className="text-[11px] font-bold text-white/60">Balance ${(bal / 100).toFixed(2)} {bm}</p>}
                                      </div>
                                    );
                                  })()}
                                </div>

                                {compNeeded && !deferPaperwork && (
                                  <div className="rounded-2xl border-2 p-4 space-y-3">
                                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Before you book</p>
                                    {compRules.complianceAppliesTo === 'services' && (
                                      <button type="button" onClick={() => setComp(c => ({ ...c, doingServices: !c.doingServices }))}
                                        className={`w-full rounded-xl border-2 p-3 flex items-center gap-3 text-left transition-colors ${comp.doingServices ? 'border-slate-900 bg-slate-50' : 'border-slate-200'}`}>
                                        <span className={`w-5 h-5 rounded-md border-2 flex items-center justify-center text-[10px] font-black shrink-0 ${comp.doingServices ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300'}`}>{comp.doingServices ? '✓' : ''}</span>
                                        <span className="text-xs font-bold">I'll be performing services on clients in this space</span>
                                      </button>
                                    )}
                                    {compApplies && (
                                      <div className="space-y-2.5 animate-in fade-in duration-200">
                                        {compRules.requireLicense && (
                                          <div className="space-y-1.5">
                                            <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Professional license</p>
                                            <input value={comp.licenseNumber} onChange={e => setComp(c => ({ ...c, licenseNumber: e.target.value }))} placeholder="License number" className="w-full h-11 rounded-xl border-2 px-4 text-sm font-medium" />
                                            <div className="flex items-center gap-3 rounded-xl border-2 border-dashed px-3.5 py-2.5">
                                              <div className="flex-1 min-w-0">
                                                <p className="text-[10px] font-black uppercase tracking-widest text-slate-600">License photo/PDF *</p>
                                                <p className="text-[10px] font-bold text-slate-400 truncate">{compDocs['license'] === 'uploading' ? 'Uploading…' : compDocUrl('license') ? (compDocs['license'] as any).name : 'Attach a clear photo or PDF'}</p>
                                              </div>
                                              {compDocUrl('license') ? <span className="text-emerald-600 font-black text-xs">✓</span> : (
                                                <label className="h-9 px-3.5 rounded-xl bg-slate-900 text-white text-[9px] font-black uppercase tracking-widest flex items-center cursor-pointer">
                                                  {compDocs['license'] === 'uploading' ? '…' : 'Attach'}
                                                  <input type="file" accept="image/*,.pdf" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) uploadCompDoc('license', f); }} />
                                                </label>
                                              )}
                                            </div>
                                          </div>
                                        )}
                                        {compRules.requireInsurance && (
                                          <div className="space-y-1.5">
                                            <input value={comp.insuranceCarrier} onChange={e => setComp(c => ({ ...c, insuranceCarrier: e.target.value }))} placeholder="Insurance carrier (optional)" className="w-full h-11 rounded-xl border-2 px-4 text-sm font-medium" />
                                            <button type="button" onClick={() => setComp(c => ({ ...c, insuranceConfirmed: !c.insuranceConfirmed }))}
                                              className={`w-full rounded-xl border-2 p-3 flex items-center gap-3 text-left transition-colors ${comp.insuranceConfirmed ? 'border-emerald-400 bg-emerald-50' : 'border-slate-200'}`}>
                                              <span className={`w-5 h-5 rounded-md border-2 flex items-center justify-center text-[10px] font-black shrink-0 ${comp.insuranceConfirmed ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-slate-300'}`}>{comp.insuranceConfirmed ? '✓' : ''}</span>
                                              <span className="text-xs font-bold">I carry current liability insurance</span>
                                            </button>
                                            <div className="flex items-center gap-3 rounded-xl border-2 border-dashed px-3.5 py-2.5">
                                              <div className="flex-1 min-w-0">
                                                <p className="text-[10px] font-black uppercase tracking-widest text-slate-600">Insurance certificate (COI) *</p>
                                                <p className="text-[10px] font-bold text-slate-400 truncate">{compDocs['insurance'] === 'uploading' ? 'Uploading…' : compDocUrl('insurance') ? (compDocs['insurance'] as any).name : 'Upload your certificate of insurance'}</p>
                                              </div>
                                              {compDocUrl('insurance') ? <span className="text-emerald-600 font-black text-xs">✓</span> : (
                                                <label className="h-9 px-3.5 rounded-xl bg-slate-900 text-white text-[9px] font-black uppercase tracking-widest flex items-center cursor-pointer">
                                                  {compDocs['insurance'] === 'uploading' ? '…' : 'Attach'}
                                                  <input type="file" accept="image/*,.pdf" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) uploadCompDoc('insurance', f); }} />
                                                </label>
                                              )}
                                            </div>
                                          </div>
                                        )}
                                        {compRules.requireIdVerification && (
                                          <div className="flex items-center gap-3 rounded-xl border-2 border-dashed px-3.5 py-2.5">
                                            <div className="flex-1 min-w-0">
                                              <p className="text-[10px] font-black uppercase tracking-widest text-slate-600">Photo ID *</p>
                                              <p className="text-[10px] font-bold text-slate-400 truncate">{compDocs['id'] === 'uploading' ? 'Uploading…' : compDocUrl('id') ? (compDocs['id'] as any).name : 'Driver\'s license, passport, or state ID'}</p>
                                            </div>
                                            {compDocUrl('id') ? <span className="text-emerald-600 font-black text-xs">✓</span> : (
                                              <label className="h-9 px-3.5 rounded-xl bg-slate-900 text-white text-[9px] font-black uppercase tracking-widest flex items-center cursor-pointer">
                                                {compDocs['id'] === 'uploading' ? '…' : 'Attach'}
                                                <input type="file" accept="image/*,.pdf" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) uploadCompDoc('id', f); }} />
                                              </label>
                                            )}
                                          </div>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  )}

                  {(applyMode !== 'day' || reserveStep === 'you') && (
                  <div className="space-y-3 animate-in fade-in duration-200">
                  {deferPaperwork && inquiryKind === 'application' && (compNeeded || requiredDocs.length > 0) && (
                    <div className="rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 px-4 py-3">
                      <p className="text-[11px] font-bold text-slate-500 leading-snug">No paperwork needed yet — we'll collect your license, insurance{requiredDocs.length > 0 ? ' and documents' : ''} once your application is approved.</p>
                    </div>
                  )}
                  {/* Required documents — owner-configured */}
                  {inquiryKind === 'application' && !deferPaperwork && requiredDocs.map(rd => {
                    const state = docs[rd];
                    return (
                      <div key={rd} className="flex items-center gap-3 rounded-xl border-2 border-dashed px-4 py-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-[10px] font-black uppercase tracking-widest text-slate-600">{rd} *</p>
                          <p className="text-[10px] font-bold text-slate-400 truncate">{state === 'uploading' ? 'Uploading...' : state ? (state as any).name : 'PDF or photo'}</p>
                        </div>
                        {state && state !== 'uploading' ? (
                          <span className="text-emerald-600 font-black text-xs">✓</span>
                        ) : (
                          <label className="h-9 px-3.5 rounded-xl bg-slate-900 text-white text-[9px] font-black uppercase tracking-widest flex items-center cursor-pointer">
                            {state === 'uploading' ? '...' : 'Attach'}
                            <input type="file" accept="image/*,.pdf" className="hidden" disabled={state === 'uploading'}
                              onChange={e => { const f = e.target.files?.[0]; if (f) uploadDoc(rd, f); }} />
                          </label>
                        )}
                      </div>
                    );
                  })}

                  <textarea value={form.message} onChange={e => setForm(f => ({ ...f, message: e.target.value }))} placeholder="Anything else we should know?" rows={2} className="w-full rounded-xl border-2 px-4 py-3 text-sm font-medium" />

                  {isPaidDayBooking ? (
                    <div className="rounded-xl border-2 p-3 space-y-2.5">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Rental agreement</span>
                        <button type="button" onClick={(e) => { e.preventDefault(); setAgreementOpen(o => !o); }} className="ml-auto text-indigo-600 underline underline-offset-2 font-black text-[10px] uppercase">{agreementOpen ? 'Hide terms' : 'Read terms'}</button>
                      </div>
                      {agreementOpen && (
                        <p className="text-[11px] leading-relaxed text-slate-600 whitespace-pre-wrap max-h-48 overflow-y-auto border-2 rounded-lg p-2.5 bg-slate-50">{dayUseTermsPreview}</p>
                      )}
                      <div className="space-y-1">
                        <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500">Type your full legal name to sign</label>
                        <input
                          value={signName}
                          onChange={e => setSignName(e.target.value)}
                          placeholder="e.g., Alexander Smith"
                          className="w-full rounded-xl border-2 px-4 py-3 font-semibold"
                          style={{ fontFamily: "'Dancing Script', cursive", fontSize: '20px' }}
                        />
                        <p className="text-[10px] font-medium text-slate-400">By typing your name you agree to the rental agreement above. This is your legal electronic signature.</p>
                      </div>
                    </div>
                  ) : inquiryKind === 'application' && agreementText ? (
                    <div className="rounded-xl border-2 p-3 space-y-2">
                      <label className="flex items-start gap-2.5 cursor-pointer">
                        <input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)} className="mt-0.5 h-4 w-4" />
                        <span className="text-xs font-bold text-slate-700">
                          I have read and agree to the terms.
                          <button type="button" onClick={(e) => { e.preventDefault(); setAgreementOpen(o => !o); }} className="ml-1.5 text-indigo-600 underline underline-offset-2 font-black text-[10px] uppercase">{agreementOpen ? 'Hide' : 'Read terms'}</button>
                        </span>
                      </label>
                      {agreementOpen && (
                        <p className="text-[11px] leading-relaxed text-slate-600 whitespace-pre-wrap max-h-40 overflow-y-auto border-t pt-2">{agreementText}</p>
                      )}
                    </div>
                  ) : null}
                  {/* Sticky action bar — the primary action is always reachable,
                      pinned to the bottom of the modal regardless of scroll. */}
                  <div className="sticky bottom-0 -mx-6 mt-1 px-6 pt-3 bg-white border-t" style={{ paddingBottom: 'max(16px, env(safe-area-inset-bottom))' }}>
                    <button onClick={submitApplication} disabled={!canSubmit} className="w-full h-12 rounded-2xl bg-slate-900 text-white font-black uppercase text-[10px] tracking-widest disabled:opacity-40 active:scale-[0.99] transition-transform">
                      {submitting ? 'Sending...' : !allDocsAttached ? 'Attach required documents' : scheduleIssue ? 'Pick available dates' : !agreementSatisfied ? (isPaidDayBooking ? 'Sign the agreement to continue' : 'Agree to the terms to continue') : (applyMode === 'day' ? (isLease(applyFor) ? 'Submit' : 'Pay & Reserve') : 'Submit')}
                    </button>
                  </div>
                  </div>
                  )}
                  </>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
