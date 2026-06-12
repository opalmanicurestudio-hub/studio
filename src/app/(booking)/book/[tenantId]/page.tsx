'use client';

export const dynamic = 'force-dynamic';

import React, { useState, useEffect, useCallback } from 'react';
import { getFirestore } from 'firebase/firestore';
import { getApp } from 'firebase/app';
import { doc, getDoc, getDocs, addDoc, collection, query, orderBy, where } from 'firebase/firestore';
import { type PageSection, type PageBuilderConfig } from '@/lib/data';
import { X as XIcon, ArrowRight, ShieldCheck, Loader, AlertTriangle } from 'lucide-react';
import { BookingSheet } from '@/components/booking/BookingSheet';
import {
  ANIM_CSS, STACKS, GFONTS,
  StyleConfig, PageData,
  DS, ac, hf, bf, br, hexToHsl, injectFonts,
  SectionWrapper, SectionRenderer, Footer,
  isBuilderConfig, buildDefaults,
} from '@/lib/booking-sections';

// ─── Font loading ─────────────────────────────────────────────────────────────
const GFONTS_HREF = `https://fonts.googleapis.com/css2?${
  Object.values(GFONTS).map(f => `family=${f}`).join('&')
}&display=swap`;

function usePageFonts() {
  useEffect(() => {
    if (document.getElementById('cf-page-gfonts')) return;
    const pre = document.createElement('link');
    pre.rel = 'preconnect'; pre.href = 'https://fonts.googleapis.com';
    document.head.appendChild(pre);
    const pre2 = document.createElement('link');
    pre2.rel = 'preconnect'; pre2.href = 'https://fonts.gstatic.com';
    pre2.crossOrigin = 'anonymous'; document.head.appendChild(pre2);
    const link = document.createElement('link');
    link.id = 'cf-page-gfonts'; link.rel = 'stylesheet'; link.href = GFONTS_HREF;
    document.head.appendChild(link);
  }, []);
}

// ─── Main component ────────────────────────────────────────────────────────────
function BookingPageContent({ tenantId }: { tenantId: string }) {
  usePageFonts();

  const [tenant,          setTenant]          = useState<any>(null);
  const [services,        setServices]        = useState<any[]>([]);
  const [staff,           setStaff]           = useState<any[]>([]);
  const [events,          setEvents]          = useState<any[]>([]);
  const [appointments,    setAppointments]    = useState<any[]>([]);
  const [scheduleProfiles,setScheduleProfiles]= useState<any[]>([]);
  const [pricingTiers,    setPricingTiers]    = useState<any[]>([]);
  const [consentForms,    setConsentForms]    = useState<any[]>([]);
  const [savedConfig,     setSavedConfig]     = useState<PageBuilderConfig|null>(null);
  const [configReady,     setConfigReady]     = useState(false);
  const [dialogOpen,      setDialogOpen]      = useState(false);
  const [dialogService,   setDialogService]   = useState<any>(null);
  const [showPicker,      setShowPicker]      = useState(false);

  // ── Deposit redirect / return state ─────────────────────────────────────────
  const [redirecting,      setRedirecting]      = useState(false);
  const [depositError,     setDepositError]     = useState<string | null>(null);
  const [postBookingState, setPostBookingState] = useState<'success' | 'cancelled' | null>(null);

  const [loadingStyle] = useState<StyleConfig>(() => {
    try {
      if (typeof window === 'undefined') return DS;
      const raw = localStorage.getItem(`cf-style-${tenantId}`);
      if (raw) return { ...DS, ...JSON.parse(raw) };
    } catch {}
    return DS;
  });

  const getDb = useCallback(() => {
    try { return getFirestore(getApp()); } catch { return null; }
  }, []);

  // Inject animation keyframes
  useEffect(() => {
    if (!document.getElementById('cf-anim')) {
      const s = document.createElement('style');
      s.id = 'cf-anim'; s.textContent = ANIM_CSS;
      document.head.appendChild(s);
    }
  }, []);

  // Detect return from Stripe deposit checkout (?deposit=success | cancelled)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const sp = new URLSearchParams(window.location.search);
    const dep = sp.get('deposit');
    if (dep === 'success') setPostBookingState('success');
    else if (dep === 'cancelled') setPostBookingState('cancelled');
  }, []);

  // Phase 1: Load tenant + saved page config
  useEffect(() => {
    if (!tenantId) { setConfigReady(true); return; }
    let cancelled = false;
    const run = async () => {
      const db = getDb();
      if (!db) { setConfigReady(true); return; }
      try {
        const tSnap = await getDoc(doc(db, 'tenants', tenantId));
        if (!cancelled && tSnap.exists()) {
          const t = { id: tSnap.id, ...tSnap.data() } as any;
          setTenant(t);
          const pc = t?.bookingPageSettings?.cfPageConfig;
          if (isBuilderConfig(pc)) {
            setSavedConfig(pc as PageBuilderConfig);
            try {
              localStorage.setItem(`cf-style-${tenantId}`, JSON.stringify({
                accentColor: pc.accentColor, bgColor: pc.bgColor,
                headingFont: pc.headingFont, bodyFont: pc.bodyFont,
                borderRadius: pc.borderRadius, buttonStyle: pc.buttonStyle,
                density: pc.density,
              }));
            } catch {}
          }
        }
      } catch (e) { console.warn('[booking:config]', e); }
      if (!cancelled) setConfigReady(true);
    };
    run();
    return () => { cancelled = true; };
  }, [tenantId, getDb]);

  // Phase 2: Load services, staff, events (non-blocking)
  useEffect(() => {
    if (!tenantId || !configReady) return;
    let cancelled = false;
    const run = async () => {
      const db = getDb(); if (!db) return;
      try {
        const [svSnap,stSnap,evSnap,aptSnap,spSnap,ptSnap,cfSnap] = await Promise.all([
          getDocs(collection(db, `tenants/${tenantId}/services`)),
          getDocs(collection(db, `tenants/${tenantId}/staff`)),
          getDocs(query(collection(db, `tenants/${tenantId}/studioEvents`), orderBy('date','asc'))).catch(() => getDocs(collection(db, `tenants/${tenantId}/studioEvents`))),
          getDocs(query(collection(db, `tenants/${tenantId}/appointments`), where('startTime','>=',new Date().toISOString().split('T')[0]))).catch(() => ({ docs: [] })),
          getDocs(collection(db, `tenants/${tenantId}/scheduleProfiles`)).catch(() => ({ docs: [] })),
          getDocs(collection(db, `tenants/${tenantId}/pricingTiers`)).catch(() => ({ docs: [] })),
          getDocs(collection(db, `tenants/${tenantId}/consentForms`)).catch(() => ({ docs: [] })),
        ]);
        if (!cancelled) {
          setServices(svSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter((s: any) => s.isActive !== false));
          setStaff(stSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter((s: any) => s.isActive !== false));
          setEvents(evSnap.docs.map(d => ({ id: d.id, ...d.data() })));
          setAppointments((aptSnap as any).docs.map((d: any) => ({ id: d.id, ...d.data() })));
          setScheduleProfiles((spSnap as any).docs.map((d: any) => ({ id: d.id, ...d.data() })));
          setPricingTiers((ptSnap as any).docs.map((d: any) => ({ id: d.id, ...d.data() })));
          setConsentForms((cfSnap as any).docs.map((d: any) => ({ id: d.id, ...d.data() })));
        }
      } catch (e) { console.warn('[booking:data]', e); }
    };
    run();
    return () => { cancelled = true; };
  }, [tenantId, configReady, getDb]);

  // Booking events
  useEffect(() => {
    const h = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (d?.service) { setDialogService(d.service); setDialogOpen(true); }
      else { if (services.length === 1) { setDialogService(services[0]); setDialogOpen(true); } else setShowPicker(true); }
    };
    window.addEventListener('cf-book', h);
    return () => window.removeEventListener('cf-book', h);
  }, [services]);

  // Derive resolved config and style
  const sections: PageSection[] = savedConfig?.sections ?? buildDefaults();
  const resolvedStyle: StyleConfig = {
    accentColor:  savedConfig?.accentColor  ?? DS.accentColor,
    bgColor:      savedConfig?.bgColor      ?? DS.bgColor,
    headingFont:  savedConfig?.headingFont  ?? DS.headingFont,
    bodyFont:     savedConfig?.bodyFont     ?? DS.bodyFont,
    borderRadius: savedConfig?.borderRadius ?? DS.borderRadius,
    buttonStyle:  savedConfig?.buttonStyle  ?? DS.buttonStyle,
    density:      savedConfig?.density      ?? DS.density,
  };

  // Only render sections that are enabled AND not hidden from visitors
  const activeSections = sections
    .filter(s => s.enabled && s.visible !== false)
    .sort((a, b) => a.order - b.order);

  useEffect(() => { injectFonts(resolvedStyle.headingFont, resolvedStyle.bodyFont); }, [resolvedStyle.headingFont, resolvedStyle.bodyFont]);
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--booking-heading-font', STACKS[resolvedStyle.headingFont] || STACKS.josefin);
    root.style.setProperty('--booking-body-font',    STACKS[resolvedStyle.bodyFont]    || STACKS.inter);
    root.style.setProperty('--radius', `${resolvedStyle.borderRadius}px`);
    try { root.style.setProperty('--primary', hexToHsl(resolvedStyle.accentColor)); } catch {}
  }, [resolvedStyle]);

  const data: PageData = { tenant, services, staff, events, tenantId };

  // Clears the ?deposit= query param and dismisses the post-booking overlay
  const dismissPostBooking = useCallback(() => {
    try { window.history.replaceState({}, '', `/book/${tenantId}`); } catch {}
    setPostBookingState(null);
  }, [tenantId]);

  // Loading spinner
  if (!configReady) {
    return (
      <div className="w-full min-h-dvh flex items-center justify-center" style={{ background: loadingStyle.bgColor }}>
        <div className="w-7 h-7 border-2 border-t-transparent rounded-full animate-spin"
             style={{ borderColor: loadingStyle.accentColor }}/>
      </div>
    );
  }

  const handleConfirm = async (
    formData: { clientName: string; clientEmail: string; clientPhone?: string; notes?: string },
    apptDetails: any, signedForms: any[], setStep: (s: string) => void,
  ) => {
    const depositAmount = Number(apptDetails?.depositAmount || 0);
    try {
      const db = getFirestore(getApp());
      const ref = await addDoc(collection(db, `tenants/${tenantId}/bookingRequests`), {
        ...formData, ...apptDetails, signedForms,
        status: 'pending', source: 'booking-page', createdAt: new Date(),
        depositAmount,
        depositStatus: depositAmount > 0 ? 'pending' : 'none',
      });

      // No deposit → keep the existing in-sheet confirmation flow
      if (depositAmount <= 0) { setStep('confirmation'); return; }

      // Deposit required → hand off to Stripe secure checkout
      setDepositError(null);
      setRedirecting(true);
      const origin = window.location.origin;
      const res = await fetch('/api/stripe/deposit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId,
          bookingRequestId: ref.id,
          depositAmount,
          clientName:  formData.clientName,
          clientEmail: formData.clientEmail,
          serviceName: dialogService?.name || '',
          successUrl:  `${origin}/book/${tenantId}?deposit=success`,
          cancelUrl:   `${origin}/book/${tenantId}?deposit=cancelled`,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.url) {
        setRedirecting(false);
        setDepositError(json?.error || 'Could not start secure checkout. Your spot is held — please try again.');
        return;
      }
      window.location.href = json.url;
    } catch (e) {
      console.error('[booking-confirm]', e);
      setRedirecting(false);
      setDepositError('Something went wrong starting checkout. Please try again.');
    }
  };

  return (
    <div className="w-full min-h-dvh overflow-x-hidden"
         style={{ background: resolvedStyle.bgColor, fontFamily: STACKS[resolvedStyle.bodyFont] || STACKS.inter }}>

      {/* Redirecting to Stripe overlay */}
      {redirecting && (
        <div className="fixed inset-0 z-[400] flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.6)' }}>
          <div className="flex flex-col items-center gap-4 px-8 py-10 bg-white text-center"
               style={{ borderRadius: br(resolvedStyle), maxWidth: '22rem' }}>
            <Loader className="w-8 h-8 animate-spin" style={{ color: ac(resolvedStyle) }}/>
            <p className="font-black text-sm uppercase tracking-widest text-slate-900" style={{ fontFamily: bf(resolvedStyle) }}>
              Taking you to secure checkout…
            </p>
            <p className="text-[11px] font-medium text-slate-500">Please don't close this window.</p>
          </div>
        </div>
      )}

      {/* Deposit error banner */}
      {depositError && !redirecting && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[400] w-[92%] max-w-md">
          <div className="flex items-start gap-3 p-4 bg-white shadow-2xl border-2 border-red-200"
               style={{ borderRadius: br(resolvedStyle) }}>
            <AlertTriangle className="w-5 h-5 text-red-500 shrink-0 mt-0.5"/>
            <div className="flex-1">
              <p className="font-black text-xs uppercase tracking-widest text-red-600">Checkout Issue</p>
              <p className="text-[11px] font-medium text-slate-600 mt-1">{depositError}</p>
            </div>
            <button onClick={() => setDepositError(null)}
                    className="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 shrink-0">
              <XIcon className="w-4 h-4"/>
            </button>
          </div>
        </div>
      )}

      {/* Post-deposit return: success / cancelled */}
      {postBookingState && (
        <div className="fixed inset-0 z-[400] flex items-end sm:items-center justify-center">
          <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.7)' }} onClick={dismissPostBooking}/>
          <div className="relative w-full sm:max-w-md sm:mx-4 bg-white overflow-hidden p-8 text-center"
               style={{ borderRadius: '24px 24px 0 0' }}>
            {postBookingState === 'success' ? (
              <>
                <div className="w-16 h-16 mx-auto flex items-center justify-center mb-5"
                     style={{ borderRadius: br(resolvedStyle), background: ac(resolvedStyle) + '15' }}>
                  <ShieldCheck className="w-8 h-8" style={{ color: ac(resolvedStyle) }}/>
                </div>
                <h2 className="font-black text-xl uppercase tracking-tight text-slate-900 mb-2"
                    style={{ fontFamily: hf(resolvedStyle) }}>Deposit Received</h2>
                <p className="text-sm font-medium text-slate-500 leading-relaxed mb-6">
                  Your appointment request is reserved. We've emailed your confirmation and details.
                </p>
              </>
            ) : (
              <>
                <div className="w-16 h-16 mx-auto flex items-center justify-center mb-5"
                     style={{ borderRadius: br(resolvedStyle), background: '#f59e0b15' }}>
                  <AlertTriangle className="w-8 h-8 text-amber-500"/>
                </div>
                <h2 className="font-black text-xl uppercase tracking-tight text-slate-900 mb-2"
                    style={{ fontFamily: hf(resolvedStyle) }}>Deposit Not Completed</h2>
                <p className="text-sm font-medium text-slate-500 leading-relaxed mb-6">
                  Your deposit wasn't completed, so your spot isn't reserved yet. You can start again whenever you're ready.
                </p>
              </>
            )}
            <button onClick={dismissPostBooking}
                    className="w-full h-12 font-black text-xs uppercase tracking-widest text-white"
                    style={{ borderRadius: br(resolvedStyle), background: ac(resolvedStyle) }}>
              Done
            </button>
          </div>
        </div>
      )}

      {/* Service picker modal */}
      {showPicker && (
        <div className="fixed inset-0 z-[300] flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setShowPicker(false)}/>
          <div className="relative w-full sm:max-w-lg sm:mx-4 bg-white overflow-hidden"
               style={{ borderRadius: '24px 24px 0 0', maxHeight: '80dvh' }}>
            <div className="flex items-center justify-between px-5 py-4 border-b"
                 style={{ borderColor: ac(resolvedStyle) + '20' }}>
              <p className="font-black text-sm uppercase tracking-widest"
                 style={{ fontFamily: bf(resolvedStyle), color: ac(resolvedStyle) }}>Select a Service</p>
              <button onClick={() => setShowPicker(false)}
                      className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-400">
                <XIcon className="w-4 h-4"/>
              </button>
            </div>
            <div className="overflow-y-auto p-4 space-y-2" style={{ maxHeight: '60dvh' }}>
              {services.map((s: any) => (
                <button key={s.id}
                        onClick={() => { setDialogService(s); setShowPicker(false); setDialogOpen(true); }}
                        className="w-full flex items-center justify-between p-4 text-left hover:shadow-md transition-all"
                        style={{ borderRadius: br(resolvedStyle), border: `2px solid ${ac(resolvedStyle)}25`, background: 'white' }}>
                  <div className="flex-1 min-w-0">
                    <p className="font-black text-sm uppercase tracking-tight text-slate-900 truncate"
                       style={{ fontFamily: bf(resolvedStyle) }}>{s.name}</p>
                    {s.duration && <p className="text-[10px] font-black uppercase tracking-widest mt-0.5"
                                      style={{ color: ac(resolvedStyle) + '80' }}>{s.duration} min</p>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0 ml-4">
                    {s.price && <span className="text-xl font-light"
                                      style={{ fontFamily: hf(resolvedStyle), color: ac(resolvedStyle) }}>${s.price}</span>}
                    <ArrowRight className="w-4 h-4 text-slate-300"/>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Booking sheet */}
      {dialogOpen && dialogService && (
        <BookingSheet
          open={dialogOpen}
          onOpenChange={o => { if (!o) { setDialogOpen(false); setDialogService(null); } }}
          service={dialogService}
          staff={staff}
          pricingTiers={pricingTiers}
          appointments={appointments}
          events={events}
          scheduleProfiles={scheduleProfiles}
          services={services}
          consentForms={consentForms}
          tenant={tenant}
          onConfirm={handleConfirm}
        />
      )}

      {/* Sections — enabled and visible to visitors */}
      {activeSections.map(section => (
        <SectionWrapper key={section.id} section={section} isPreview={false}
          onEdit={() => {}} onFieldTap={() => {}}>
          <SectionRenderer section={section} style={resolvedStyle} data={data}
            isPreview={false} onFieldTap={() => {}}/>
        </SectionWrapper>
      ))}

      <Footer tenant={tenant} style={resolvedStyle}/>
    </div>
  );
}

export default function BookingPage({ params }: { params: { tenantId: string } }) {
  return <BookingPageContent tenantId={params.tenantId}/>;
}