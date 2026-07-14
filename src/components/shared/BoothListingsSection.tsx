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

const FREQ_LABEL: Record<string, string> = { monthly: '/mo', weekly: '/wk', daily: '/day', hourly: '/hr' };
const DEFAULT_NICHES = ['Hair', 'Nails', 'Esthetics', 'Massage', 'Barber', 'Tattoo', 'Lashes & Brows', 'Wellness', 'Photography', 'Other'];

export function BoothListingsSection({ tenantId, config, db }: { tenantId: string; config: any; db?: Firestore }) {
  const firestore = db || getFirestore();
  const [booths, setBooths] = useState<any[] | null>(null);
  const [applyFor, setApplyFor] = useState<any | null>(null);
  const [photoIdx, setPhotoIdx] = useState(0);
  const [form, setForm] = useState({ name: '', phone: '', email: '', niche: '', nicheOther: '', moveIn: '', startDate: '', endDate: '', message: '' });
  const [docs, setDocs] = useState<Record<string, { name: string; url: string } | 'uploading' | null>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const niches: string[] = (Array.isArray(config.nicheOptions) && config.nicheOptions.length > 0) ? config.nicheOptions : DEFAULT_NICHES;
  const requiredDocs: string[] = Array.isArray(config.requiredDocs) ? config.requiredDocs.filter(Boolean) : [];

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
  const primaryRate = (b: any) => leaseRates(b)[0] || ratesOf(b)[0] || { frequency: 'monthly', amountCents: 0 };
  const priceOf = (b: any) => { const r = primaryRate(b); return { amount: Math.round(r.amountCents / 100), suffix: FREQ_LABEL[r.frequency] || '/mo' }; };
  const isLease = (b: any) => leaseRates(b).length > 0;

  const [applyMode, setApplyMode] = useState<'lease' | 'day'>('lease');
  const openApply = (b: any, mode?: 'lease' | 'day') => {
    setApplyFor(b); setApplyMode(mode || (leaseRates(b).length > 0 ? 'lease' : 'day'));
    setPhotoIdx(0); setSubmitted(false); setDocs({});
  };

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

  const allDocsAttached = requiredDocs.every(rd => docs[rd] && docs[rd] !== 'uploading');
  const nicheValue = form.niche === 'Other' ? (form.nicheOther || 'Other') : form.niche;
  const canSubmit = form.name.trim() && (form.phone.trim() || form.email.trim()) && allDocsAttached && !submitting;

  const submitApplication = async () => {
    if (!applyFor || !canSubmit) return;
    setSubmitting(true);
    try {
      const now = new Date().toISOString();
      const lease = applyMode === 'lease';
      const appRef = doc(collection(firestore, `tenants/${tenantId}/boothApplications`));
      await setDoc(appRef, {
        id: appRef.id, tenantId, createdAt: now, status: 'new',
        boothId: applyFor.id, boothName: applyFor.name || 'Space',
        locationId: applyFor.locationId || null,
        rentalType: applyMode === 'lease' ? 'lease' : 'day_rental',
        name: form.name.trim(), phone: form.phone.trim(), email: form.email.trim(),
        specialty: nicheValue,
        timing: applyMode === 'lease' ? (form.moveIn ? `Move-in ${form.moveIn}` : '') : [form.startDate, form.endDate].filter(Boolean).join(' → '),
        moveInDate: lease ? (form.moveIn || null) : null,
        startDate: !lease ? (form.startDate || null) : null,
        endDate: !lease ? (form.endDate || null) : null,
        message: form.message.trim(),
        attachments: requiredDocs.map(rd => ({ label: rd, ...(docs[rd] as any) })).filter(a => a.url),
      });
      const nRef = doc(collection(firestore, `tenants/${tenantId}/notifications`));
      await setDoc(nRef, {
        id: nRef.id, type: 'booth_application', read: false, createdAt: now,
        message: `${lease ? 'Space application' : 'Day-rental request'}: ${form.name.trim()} — ${applyFor.name || 'Space'}${nicheValue ? ` (${nicheValue})` : ''}`,
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
      </div>
    );
  };
  const CTA = ({ b }: { b: any }) => {
    const hasLease = leaseRates(b).length > 0;
    const hasDay = dayRates(b).length > 0;
    if (hasLease && hasDay) return (
      <div className="flex gap-2">
        <button onClick={() => openApply(b, 'lease')} className="flex-1 h-12 rounded-2xl font-black uppercase text-[10px] tracking-widest text-white bg-slate-900 hover:bg-slate-800 transition-transform active:scale-[0.98]">{config.applyCtaText || 'Apply Now'}</button>
        <button onClick={() => openApply(b, 'day')} className="flex-1 h-12 rounded-2xl font-black uppercase text-[10px] tracking-widest text-white bg-amber-600 hover:bg-amber-700 transition-transform active:scale-[0.98]">{config.reserveCtaText || 'Reserve'}</button>
      </div>
    );
    return (
      <button onClick={() => openApply(b, hasLease ? 'lease' : 'day')} className={`w-full h-12 rounded-2xl font-black uppercase text-[10px] tracking-widest text-white transition-transform active:scale-[0.98] ${hasLease ? 'bg-slate-900 hover:bg-slate-800' : 'bg-amber-600 hover:bg-amber-700'}`}>
        {hasLease ? (config.applyCtaText || 'Apply Now') : (config.reserveCtaText || 'Reserve')}
      </button>
    );
  };

  return (
    <section className="py-16 md:py-24 px-4">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-10 md:mb-14">
          <p className="text-[10px] font-black uppercase tracking-[0.3em] opacity-50 mb-3">Now Leasing</p>
          <h2 className="text-3xl md:text-5xl font-black tracking-tight">{config.title || 'Space Available'}</h2>
          {config.subtitle && <p className="mt-3 text-sm md:text-base opacity-70 max-w-xl mx-auto font-medium">{config.subtitle}</p>}
        </div>

        {visible.length === 0 ? (
          <p className="text-center text-sm font-bold opacity-60">{config.emptyMessage}</p>
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
                  {b.notes && <p className="text-sm opacity-70 font-medium leading-relaxed">{b.notes}</p>}
                  <Chips b={b} />
                  <CTA b={b} />
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
                  {b.notes && <p className="text-xs opacity-70 font-medium line-clamp-2">{b.notes}</p>}
                  <Chips b={b} />
                  <CTA b={b} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Application dialog — immersive: photo strip + guided form ── */}
      {applyFor && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-6" onClick={() => !submitting && setApplyFor(null)}>
          <div className="bg-white w-full sm:max-w-lg rounded-t-3xl sm:rounded-3xl overflow-hidden max-h-[92dvh] flex flex-col" onClick={e => e.stopPropagation()}>
            {submitted ? (
              <div className="text-center py-14 px-6 space-y-3">
                <p className="text-4xl">🎉</p>
                <h3 className="font-black text-xl">Application received!</h3>
                <p className="text-sm opacity-70 font-medium">We'll reach out shortly about {applyFor.name || 'the space'}.</p>
                <button onClick={() => setApplyFor(null)} className="h-11 px-8 rounded-2xl bg-slate-900 text-white font-black uppercase text-[10px] tracking-widest">Done</button>
              </div>
            ) : (
              <>
                {photosOf(applyFor).length > 0 && (
                  <div className="relative h-48 shrink-0">
                    <img src={photosOf(applyFor)[photoIdx]} alt="" className="w-full h-full object-cover" />
                    {photosOf(applyFor).length > 1 && (
                      <div className="absolute bottom-2 inset-x-0 flex justify-center gap-1.5">
                        {photosOf(applyFor).map((_, i) => (
                          <button key={i} onClick={() => setPhotoIdx(i)} className={`w-2 h-2 rounded-full ${i === photoIdx ? 'bg-white' : 'bg-white/40'}`} />
                        ))}
                      </div>
                    )}
                  </div>
                )}
                <div className="p-6 space-y-3.5 overflow-y-auto">
                  <div>
                    <h3 className="font-black text-xl tracking-tight">{applyMode === 'lease' ? 'Apply for' : 'Reserve'} {applyFor.name || 'this space'}</h3>
                    <p className="text-xs opacity-60 font-bold mt-0.5">{(applyMode === 'lease' ? leaseRates(applyFor) : dayRates(applyFor)).slice(0, 2).map(r => `$${Math.round(r.amountCents / 100).toLocaleString()}${FREQ_LABEL[r.frequency] || ''}`).join(' · ') || `$${priceOf(applyFor).amount.toLocaleString()}${priceOf(applyFor).suffix}`} · We respond within one business day.</p>
                  </div>

                  <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Your name *" className="w-full h-12 rounded-xl border-2 px-4 text-sm font-medium" />
                  <div className="grid grid-cols-2 gap-2">
                    <input type="tel" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="Phone *" className="h-12 rounded-xl border-2 px-4 text-sm font-medium" />
                    <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="Email" className="h-12 rounded-xl border-2 px-4 text-sm font-medium" />
                  </div>

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

                  {/* Dates — different question per product */}
                  {applyMode === 'lease' ? (
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">Ideal move-in date</p>
                      <input type="date" value={form.moveIn} onChange={e => setForm(f => ({ ...f, moveIn: e.target.value }))} className="w-full h-12 rounded-xl border-2 px-4 text-sm font-medium" />
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">From</p>
                        <input type="date" value={form.startDate} onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))} className="w-full h-12 rounded-xl border-2 px-4 text-sm font-medium" />
                      </div>
                      <div>
                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">To</p>
                        <input type="date" value={form.endDate} min={form.startDate || undefined} onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))} className="w-full h-12 rounded-xl border-2 px-4 text-sm font-medium" />
                      </div>
                    </div>
                  )}

                  {/* Required documents — owner-configured */}
                  {requiredDocs.map(rd => {
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

                  <button onClick={submitApplication} disabled={!canSubmit} className="w-full h-12 rounded-2xl bg-slate-900 text-white font-black uppercase text-[10px] tracking-widest disabled:opacity-40">
                    {submitting ? 'Sending...' : requiredDocs.length > 0 && !allDocsAttached ? 'Attach required documents' : 'Submit'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
