'use client';

/**
 * BoothListingsSection — v1 (SPRINT 2)
 *
 * Real-estate-style booth listings for the public booking page. Vacant
 * booths render as listing cards — photo area, prominent price, amenity
 * chips, availability badge — like a rental marketplace, because that's
 * what this is: you're leasing commercial space.
 *
 * Two products, two CTAs (see the booth model decisions):
 *  - Monthly booths → "Apply Now" → application form → boothApplications
 *    collection + an owner notification. You gatekeep who gets in; the
 *    price is public because listings without prices get skipped.
 *  - Hourly/Daily booths → "Reserve" → same inquiry form v1, flagged as a
 *    day-rental request. (Instant pay-and-book is Sprint 3 — it reuses the
 *    appointment/Stripe machinery; the inquiry pipeline ships value now.)
 *
 * WIRING (booking-sections.tsx):
 *   import { BoothListingsSection } from '@/components/booking/BoothListingsSection';
 *   // in the section-type switch/map:
 *   case 'booths': return <BoothListingsSection tenantId={tenantId} config={section.config} db={db} />;
 * Pass the same Firestore instance the other public sections use (the
 * standalone getDb() one). If your renderer doesn't pass db, the
 * component falls back to the default app's Firestore.
 *
 * RULES REQUIRED (see chat): public read on booths, public create on
 * boothApplications — without them this section shows nothing and the
 * form fails.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { getFirestore, collection, query, where, getDocs, doc, setDoc, type Firestore } from 'firebase/firestore';

const FREQ_LABEL: Record<string, string> = { monthly: '/mo', weekly: '/wk', daily: '/day', hourly: '/hr' };

export function BoothListingsSection({
  tenantId,
  config,
  db,
}: {
  tenantId: string;
  config: any;
  db?: Firestore;
}) {
  const firestore = db || getFirestore();
  const [booths, setBooths] = useState<any[] | null>(null);
  const [applyFor, setApplyFor] = useState<any | null>(null);
  const [form, setForm] = useState({ name: '', phone: '', email: '', specialty: '', timing: '', message: '' });
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDocs(query(collection(firestore, `tenants/${tenantId}/booths`), where('status', '==', 'vacant')));
        if (!cancelled) setBooths(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
      } catch {
        if (!cancelled) setBooths([]);
      }
    })();
    return () => { cancelled = true; };
  }, [firestore, tenantId]);

  const visible = useMemo(() => (booths || []).filter((b: any) => {
    const isMonthly = (b.baseRentFrequency || 'monthly') === 'monthly' || b.baseRentFrequency === 'weekly';
    return isMonthly ? config.showMonthly !== false : config.showDaily !== false;
  }), [booths, config.showMonthly, config.showDaily]);

  const priceOf = (b: any) => {
    const amount = Math.round((Number(b.baseRentCents) || 0) / 100);
    return { amount, suffix: FREQ_LABEL[b.baseRentFrequency || 'monthly'] || '/mo' };
  };
  const isLease = (b: any) => (b.baseRentFrequency || 'monthly') === 'monthly' || b.baseRentFrequency === 'weekly';

  const submitApplication = async () => {
    if (!applyFor || !form.name.trim() || (!form.phone.trim() && !form.email.trim()) || submitting) return;
    setSubmitting(true);
    try {
      const now = new Date().toISOString();
      const appRef = doc(collection(firestore, `tenants/${tenantId}/boothApplications`));
      await setDoc(appRef, {
        id: appRef.id, tenantId, createdAt: now, status: 'new',
        boothId: applyFor.id, boothName: applyFor.name || 'Booth',
        rentalType: isLease(applyFor) ? 'lease' : 'day_rental',
        name: form.name.trim(), phone: form.phone.trim(), email: form.email.trim(),
        specialty: form.specialty.trim(), timing: form.timing.trim(), message: form.message.trim(),
      });
      const nRef = doc(collection(firestore, `tenants/${tenantId}/notifications`));
      await setDoc(nRef, {
        id: nRef.id, type: 'booth_application', read: false, createdAt: now,
        message: `${isLease(applyFor) ? 'Booth application' : 'Day-rental request'}: ${form.name.trim()} — ${applyFor.name || 'Booth'}${form.specialty ? ` (${form.specialty})` : ''}`,
        link: '/renters',
      });
      setSubmitted(true);
    } catch {
      // fail-visible: keep the dialog open so they can retry
    } finally {
      setSubmitting(false);
    }
  };

  if (booths === null) return null; // loading — render nothing, no jank
  if (visible.length === 0 && !config.emptyMessage) return null;

  return (
    <section className="py-16 md:py-24 px-4" style={{ background: 'var(--section-bg, transparent)' }}>
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-10 md:mb-14">
          <p className="text-[10px] font-black uppercase tracking-[0.3em] opacity-50 mb-3">Now Leasing</p>
          <h2 className="text-3xl md:text-5xl font-black tracking-tight">{config.title || 'Rent a Chair at Our Studio'}</h2>
          {config.subtitle && <p className="mt-3 text-sm md:text-base opacity-70 max-w-xl mx-auto font-medium">{config.subtitle}</p>}
        </div>

        {visible.length === 0 ? (
          <p className="text-center text-sm font-bold opacity-60">{config.emptyMessage}</p>
        ) : (
          <div className={config.layout === 'showcase' ? 'space-y-8' : 'grid gap-6 md:gap-8 sm:grid-cols-2 lg:grid-cols-3'}>
            {visible.map((b: any) => {
              const { amount, suffix } = priceOf(b);
              const lease = isLease(b);
              return (
                <div key={b.id} className="group rounded-3xl overflow-hidden border bg-white shadow-sm hover:shadow-2xl hover:-translate-y-1 transition-all duration-300">
                  {/* Photo area — real listing treatment */}
                  <div className="relative h-44 md:h-52 overflow-hidden">
                    {b.photoUrl ? (
                      <img src={b.photoUrl} alt={b.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                    ) : (
                      <div className="w-full h-full bg-gradient-to-br from-amber-100 via-orange-50 to-rose-100 flex items-center justify-center">
                        <span className="text-5xl opacity-30">💺</span>
                      </div>
                    )}
                    <span className="absolute top-3 left-3 text-[9px] font-black uppercase tracking-widest bg-emerald-500 text-white rounded-full px-2.5 py-1 shadow">Available Now</span>
                    <span className="absolute top-3 right-3 text-[9px] font-black uppercase tracking-widest bg-white/90 backdrop-blur text-slate-700 rounded-full px-2.5 py-1 shadow">{lease ? 'Monthly Lease' : 'Hourly / Daily'}</span>
                  </div>

                  <div className="p-5 space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="font-black text-lg tracking-tight truncate">{b.name || 'Station'}</h3>
                        {b.type && <p className="text-[10px] font-black uppercase tracking-widest opacity-50">{b.type}</p>}
                      </div>
                      <p className="shrink-0 text-right">
                        <span className="text-2xl font-black tracking-tighter">${amount.toLocaleString()}</span>
                        <span className="text-xs font-bold opacity-50">{suffix}</span>
                      </p>
                    </div>

                    {b.notes && <p className="text-xs opacity-70 font-medium line-clamp-2">{b.notes}</p>}

                    {config.showAmenities !== false && Array.isArray(b.amenities) && b.amenities.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {b.amenities.slice(0, 5).map((a: string) => (
                          <span key={a} className="text-[9px] font-black uppercase tracking-wide bg-slate-100 text-slate-600 rounded-full px-2 py-0.5">{a}</span>
                        ))}
                        {b.amenities.length > 5 && <span className="text-[9px] font-black uppercase text-slate-400">+{b.amenities.length - 5} more</span>}
                      </div>
                    )}

                    <button
                      onClick={() => { setApplyFor(b); setSubmitted(false); }}
                      className={`w-full h-12 rounded-2xl font-black uppercase text-[10px] tracking-widest text-white transition-transform active:scale-[0.98] ${lease ? 'bg-slate-900 hover:bg-slate-800' : 'bg-amber-600 hover:bg-amber-700'}`}
                    >
                      {lease ? (config.applyCtaText || 'Apply Now') : (config.reserveCtaText || 'Reserve a Day')}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Application dialog — plain fixed overlay (public page: no shadcn dependency assumptions) */}
      {applyFor && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-6" onClick={() => !submitting && setApplyFor(null)}>
          <div className="bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl p-6 space-y-4 max-h-[90dvh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            {submitted ? (
              <div className="text-center py-8 space-y-3">
                <p className="text-4xl">🎉</p>
                <h3 className="font-black text-xl">Application received!</h3>
                <p className="text-sm opacity-70 font-medium">We'll reach out to you shortly about {applyFor.name || 'the booth'}.</p>
                <button onClick={() => setApplyFor(null)} className="h-11 px-8 rounded-2xl bg-slate-900 text-white font-black uppercase text-[10px] tracking-widest">Done</button>
              </div>
            ) : (
              <>
                <div>
                  <h3 className="font-black text-xl tracking-tight">{isLease(applyFor) ? 'Apply for' : 'Reserve'} {applyFor.name || 'this booth'}</h3>
                  <p className="text-xs opacity-60 font-bold mt-0.5">${priceOf(applyFor).amount.toLocaleString()}{priceOf(applyFor).suffix} · We respond within one business day.</p>
                </div>
                {([
                  ['name', 'Your name *', 'text'],
                  ['phone', 'Phone *', 'tel'],
                  ['email', 'Email', 'email'],
                  ['specialty', 'Your specialty (nails, lashes, hair...)', 'text'],
                  ['timing', isLease(applyFor) ? 'Ideal move-in timing' : 'What dates are you interested in?', 'text'],
                ] as const).map(([k, label, type]) => (
                  <input
                    key={k}
                    type={type}
                    value={(form as any)[k]}
                    onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))}
                    placeholder={label}
                    className="w-full h-12 rounded-xl border-2 px-4 text-sm font-medium"
                  />
                ))}
                <textarea
                  value={form.message}
                  onChange={e => setForm(f => ({ ...f, message: e.target.value }))}
                  placeholder="Anything else we should know?"
                  rows={3}
                  className="w-full rounded-xl border-2 px-4 py-3 text-sm font-medium"
                />
                <button
                  onClick={submitApplication}
                  disabled={submitting || !form.name.trim() || (!form.phone.trim() && !form.email.trim())}
                  className="w-full h-12 rounded-2xl bg-slate-900 text-white font-black uppercase text-[10px] tracking-widest disabled:opacity-40"
                >
                  {submitting ? 'Sending...' : 'Submit'}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
