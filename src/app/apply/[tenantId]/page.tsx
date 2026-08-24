'use client';

/**
 * Public Job Application
 * Route: src/app/apply/[tenantId]/page.tsx
 *
 * Standalone Firebase — no auth required.
 * Writes to: tenants/{tenantId}/applications/{id} (create-only from here;
 * managers read it on the Applicants view).
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useParams } from 'next/navigation';
import { initializeApp, getApps } from 'firebase/app';
import { getFirestore, doc, getDoc, getDocs, collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { Loader, CheckCircle2, AlertTriangle, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';

const getDb = () => {
  if (getApps().length === 0) {
    initializeApp({
      apiKey:            process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
      authDomain:        process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
      projectId:         process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
      storageBucket:     process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
      appId:             process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
    });
  }
  return getFirestore();
};

const DAYS = [['mon', 'Mon'], ['tue', 'Tue'], ['wed', 'Wed'], ['thu', 'Thu'], ['fri', 'Fri'], ['sat', 'Sat'], ['sun', 'Sun']] as const;
const SLOTS = [['am', 'Morning'], ['pm', 'Afternoon'], ['eve', 'Evening']] as const;
const START_OPTIONS = ['Right away', 'Within 2 weeks', 'In a month or more'] as const;
const EXPERIENCE_LEVELS = ['Just starting', '1–3 years', '3–5 years', '5+ years'] as const;

const COOLDOWN_MS = 10 * 60 * 1000;

const fieldLabel = "text-[10px] font-black uppercase tracking-widest text-muted-foreground";
const fieldInput = "h-12 w-full rounded-xl border-2 bg-white px-4 font-bold text-sm text-slate-900 placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900";
const chipBase = "h-11 rounded-xl border-2 px-3 text-[11px] font-black uppercase tracking-widest";
const chipOff = "bg-white text-muted-foreground";
const chipOn = "bg-slate-900 text-white border-slate-900";

export default function ApplyPage() {
  const params = useParams();
  const tenantId = params?.tenantId as string;

  const [loading, setLoading] = useState(true);
  const [tenant, setTenant] = useState<any>(null);
  const [listings, setListings] = useState<any[]>([]);
  const [selectedListing, setSelectedListing] = useState<any>(null);
  const [availabilityGrid, setAvailabilityGrid] = useState<Record<string, string[]>>({});

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [position, setPosition] = useState('');
  const [experienceLevel, setExperienceLevel] = useState('');
  const [startWhen, setStartWhen] = useState('');
  const [experience, setExperience] = useState('');
  const [license, setLicense] = useState('');
  const [message, setMessage] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [website, setWebsite] = useState('');
  const [customAnswers, setCustomAnswers] = useState<Record<string, string>>({});
  const [skipListings, setSkipListings] = useState(false);

  const chooseListing = (l: any) => {
    setSelectedListing(l);
    setPosition(String(l?.title || ''));
    window.scrollTo({ top: 0 });
  };

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [done, setDone] = useState(false);
  const [tooSoon, setTooSoon] = useState(false);

  const mountedAt = useRef(Date.now());
  const errorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!tenantId) return;
    const load = async () => {
      try {
        const db = getDb();
        const snap = await getDoc(doc(db, `tenants/${tenantId}`));
        if (snap.exists()) setTenant(snap.data());
        try {
          const listingSnap = await getDocs(collection(db, `tenants/${tenantId}/jobListings`));
          const open = listingSnap.docs
            .map(d => ({ id: d.id, ...d.data() } as any))
            .filter(l => l.status === 'open')
            .sort((a, b) => String(a.title || '').localeCompare(String(b.title || '')));
          setListings(open);
          const wanted = new URLSearchParams(window.location.search).get('job');
          if (wanted) {
            const hit = open.find(l => l.id === wanted);
            if (hit) setSelectedListing(hit);
          }
        } catch { /* listings unreadable — general form still works */ }
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [tenantId]);

  const toggleSlot = (day: string, slot: string) =>
    setAvailabilityGrid(prev => {
      const cur = prev[day] || [];
      const next = cur.includes(slot) ? cur.filter(s => s !== slot) : [...cur, slot];
      const out = { ...prev, [day]: next };
      if (next.length === 0) delete out[day];
      return out;
    });

  useEffect(() => {
    try {
      const last = Number(localStorage.getItem(`applied_${tenantId}`) || 0);
      if (last && Date.now() - last < COOLDOWN_MS) setTooSoon(true);
    } catch { /* private mode — proceed */ }
  }, [tenantId]);

  const businessName = tenant?.name || 'this business';
  const logoUrl = tenant?.kioskSettings?.logoUrl;

  const questions = useMemo(
    () => (Array.isArray(tenant?.applicationQuestions) ? tenant.applicationQuestions.slice(0, 8) : []),
    [tenant]
  );
  const setAnswer = (id: string, value: string) =>
    setCustomAnswers(prev => ({ ...prev, [id]: value }));

  const validate = () => {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = 'Please add your name.';
    if (!email.trim() && !phone.trim()) e.contact = 'Add an email or a phone number so we can reach you.';
    if (email.trim() && !/^\S+@\S+\.\S+$/.test(email.trim())) e.email = 'That email doesn\u2019t look right.';
    if (!position.trim()) e.position = 'Tell us what role you\u2019re applying for.';
    for (const q of questions) {
      if (q?.required && !(customAnswers[q.id] || '').trim()) e[`q_${q.id}`] = 'This one\u2019s required.';
    }
    if (!agreed) e.agreed = 'Please agree so we\u2019re allowed to contact you.';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setSubmitError('');
    if (!validate()) {
      requestAnimationFrame(() => errorRef.current?.scrollIntoView({ block: 'center' }));
      return;
    }
    if (website.trim() || Date.now() - mountedAt.current < 4000) {
      setDone(true);
      return;
    }
    setSubmitting(true);
    try {
      const db = getDb();
      const created = await addDoc(collection(db, `tenants/${tenantId}/applications`), {
        name: name.trim().slice(0, 120),
        email: email.trim().slice(0, 160),
        phone: phone.trim().slice(0, 40),
        position: position.trim().slice(0, 120),
        experienceLevel: experienceLevel.slice(0, 40),
        availability: [],
        availabilityGrid,
        listingId: selectedListing ? String(selectedListing.id) : '',
        listingTitle: selectedListing ? String(selectedListing.title || '').slice(0, 120) : '',
        startWhen: startWhen.slice(0, 40),
        experience: experience.trim().slice(0, 2000),
        license: license.trim().slice(0, 160),
        message: message.trim().slice(0, 2000),
        answers: questions
          .map((q: any) => ({
            id: String(q.id || ''),
            label: String(q.label || '').slice(0, 140),
            value: (customAnswers[q.id] || '').trim().slice(0, 1000),
          }))
          .filter((a: any) => a.value),
        status: 'new',
        source: 'link',
        createdAt: serverTimestamp(),
      });
      try { localStorage.setItem(`applied_${tenantId}`, String(Date.now())); } catch { /* fine */ }
      try {
        void fetch('/api/comms/dispatch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ kind: 'application', tenantId, applicationId: created.id }),
        }).catch(() => { /* receipt is best-effort; the application itself is safely in */ });
      } catch { /* fire-and-forget */ }
      setDone(true);
      window.scrollTo({ top: 0 });
    } catch (e: any) {
      console.error(e);
      setSubmitError('Something went wrong sending your application. Your answers are still here — please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-dvh bg-slate-50 flex items-center justify-center">
        <Loader className="h-8 w-8 animate-spin text-slate-900" aria-label="Loading" />
      </div>
    );
  }

  if (!tenant) {
    return (
      <div className="min-h-dvh bg-slate-50 flex items-center justify-center p-6">
        <div className="w-full max-w-md rounded-[2rem] border-2 bg-white p-8 text-center">
          <AlertTriangle className="mx-auto h-10 w-10 text-amber-500" aria-hidden="true" />
          <h1 className="mt-4 text-xl font-black uppercase tracking-tight text-slate-900">This link isn&apos;t active</h1>
          <p className="mt-2 text-sm font-bold text-muted-foreground">
            The application page you&apos;re looking for isn&apos;t available. Double-check the link with the business that shared it.
          </p>
        </div>
      </div>
    );
  }

  if (done || tooSoon) {
    return (
      <div className="min-h-dvh bg-slate-50">
        <header className="bg-slate-950 px-6 pb-10 pt-12 text-center">
          <p className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400">{businessName}</p>
        </header>
        <main className="mx-auto w-full max-w-md p-6 -mt-6">
          <div className="rounded-[2rem] border-2 bg-white p-8 text-center">
            <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-600" aria-hidden="true" />
            <h1 className="mt-4 text-2xl font-black uppercase tracking-tight text-slate-900">
              {tooSoon && !done ? 'We already have it' : 'Application sent'}
            </h1>
            <p className="mt-3 text-sm font-bold text-muted-foreground leading-relaxed">
              {tooSoon && !done
                ? `Your application to ${businessName} came through recently. They\u2019ll be in touch \u2014 no need to send it again.`
                : `Thanks for applying to ${businessName}. They\u2019ll review it and reach out using the contact details you gave.`}
            </p>
            <div className="mt-6 rounded-2xl border-2 border-dashed bg-slate-50 p-4 text-left">
              <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">What happens next</p>
              <p className="mt-1.5 text-[12px] font-bold text-slate-700 leading-relaxed">
                Your application goes straight to the team at {businessName}. If it&apos;s a fit, they&apos;ll contact you to talk next steps.
              </p>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-slate-50 pb-[max(2rem,env(safe-area-inset-bottom))]">
      <header className="bg-slate-950 px-6 pb-14 pt-12 text-center">
        {logoUrl ? (
          <img src={logoUrl} alt={businessName} className="mx-auto mb-3 h-12 w-12 rounded-2xl object-cover" />
        ) : (
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-white/10 text-lg font-black text-white">
            {String(businessName).charAt(0).toUpperCase()}
          </div>
        )}
        <p className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400">{businessName}</p>
        <h1 className="mt-2 text-3xl font-black uppercase tracking-tight text-white">Join the team</h1>
        <p className="mt-2 text-[12px] font-bold text-slate-400">Takes about two minutes. No account needed.</p>
      </header>

      <main className="mx-auto w-full max-w-md px-4 -mt-8">
        {listings.length > 0 && !selectedListing && !skipListings ? (
          <div className="space-y-4">
            <p className="px-1 text-[10px] font-black uppercase tracking-[0.25em] text-slate-500">Open roles</p>
            {listings.map((l: any) => (
              <div key={l.id} className="rounded-[2rem] border-2 bg-white p-5 space-y-2">
                <p className="text-[16px] font-black tracking-tight text-slate-900">{l.title}</p>
                {(l.payRange || l.scheduleNote) && (
                  <div className="flex flex-wrap gap-1.5">
                    {l.payRange && <span className="rounded-lg border-2 bg-slate-50 px-2 py-0.5 text-[10px] font-black uppercase tracking-widest text-slate-700">{l.payRange}</span>}
                    {l.scheduleNote && <span className="rounded-lg border-2 bg-slate-50 px-2 py-0.5 text-[10px] font-black uppercase tracking-widest text-slate-700">{l.scheduleNote}</span>}
                  </div>
                )}
                {l.description && <p className="whitespace-pre-wrap text-[13px] font-bold leading-relaxed text-slate-700">{l.description}</p>}
                {l.requirements && (
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">What we&apos;re looking for</p>
                    <p className="mt-0.5 whitespace-pre-wrap text-[13px] font-bold leading-relaxed text-slate-700">{l.requirements}</p>
                  </div>
                )}
                <button type="button" onClick={() => chooseListing(l)} className="mt-1 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-slate-900 text-[11px] font-black uppercase tracking-widest text-white">
                  Apply for this role <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            ))}
            <button type="button" onClick={() => { setSkipListings(true); window.scrollTo({ top: 0 }); }} className="h-12 w-full rounded-xl border-2 border-dashed bg-white/60 text-[11px] font-black uppercase tracking-widest text-slate-700">
              Something else? Send a general application
            </button>
          </div>
        ) : (
        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          {(selectedListing || (skipListings && listings.length > 0)) && (
            <div className="flex items-center justify-between gap-3 rounded-2xl border-2 bg-white p-3">
              <p className="min-w-0 truncate text-[12px] font-black uppercase tracking-widest text-slate-900">
                {selectedListing ? `Applying: ${selectedListing.title}` : 'General application'}
              </p>
              <button type="button" onClick={() => { setSelectedListing(null); setSkipListings(false); if (selectedListing) setPosition(''); }} className="shrink-0 text-[11px] font-black uppercase tracking-widest text-muted-foreground underline">
                Change
              </button>
            </div>
          )}
          <div className="relative rounded-[2rem] border-2 bg-white p-5 space-y-4">
            <p className={fieldLabel}>About you</p>
            <div className="space-y-1.5">
              <label htmlFor="apply-name" className={fieldLabel}>Full name</label>
              <input id="apply-name" value={name} onChange={e => setName(e.target.value)} autoComplete="name" maxLength={120} className={cn(fieldInput, errors.name && 'border-destructive')} placeholder="Your name" />
              {errors.name && <p className="text-[11px] font-bold text-destructive">{errors.name}</p>}
            </div>
            <div className="space-y-1.5">
              <label htmlFor="apply-email" className={fieldLabel}>Email</label>
              <input id="apply-email" type="email" inputMode="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" maxLength={160} className={cn(fieldInput, (errors.email || errors.contact) && 'border-destructive')} placeholder="you@example.com" />
              {errors.email && <p className="text-[11px] font-bold text-destructive">{errors.email}</p>}
            </div>
            <div className="space-y-1.5">
              <label htmlFor="apply-phone" className={fieldLabel}>Phone</label>
              <input id="apply-phone" type="tel" inputMode="tel" value={phone} onChange={e => setPhone(e.target.value)} autoComplete="tel" maxLength={40} className={cn(fieldInput, errors.contact && 'border-destructive')} placeholder="(555) 555-5555" />
              {errors.contact && <p className="text-[11px] font-bold text-destructive">{errors.contact}</p>}
            </div>
            <div aria-hidden="true" className="absolute -left-[9999px] top-0 h-px w-px overflow-hidden">
              <label htmlFor="apply-website">Website</label>
              <input id="apply-website" tabIndex={-1} autoComplete="off" value={website} onChange={e => setWebsite(e.target.value)} />
            </div>
          </div>

          <div className="rounded-[2rem] border-2 bg-white p-5 space-y-4">
            <p className={fieldLabel}>The role</p>
            {!selectedListing && (
            <div className="space-y-1.5">
              <label htmlFor="apply-position" className={fieldLabel}>What role are you applying for?</label>
              <input id="apply-position" value={position} onChange={e => setPosition(e.target.value)} maxLength={120} className={cn(fieldInput, errors.position && 'border-destructive')} placeholder="e.g. front desk, technician, server" />
              {errors.position && <p className="text-[11px] font-bold text-destructive">{errors.position}</p>}
            </div>
            )}
            <div className="space-y-1.5">
              <p className={fieldLabel}>Experience level</p>
              <div className="flex flex-wrap gap-1.5">
                {EXPERIENCE_LEVELS.map(l => (
                  <button key={l} type="button" aria-pressed={experienceLevel === l} onClick={() => setExperienceLevel(experienceLevel === l ? '' : l)} className={cn(chipBase, experienceLevel === l ? chipOn : chipOff)}>
                    {l}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="apply-license" className={fieldLabel}>License or certification (if any)</label>
              <input id="apply-license" value={license} onChange={e => setLicense(e.target.value)} maxLength={160} className={fieldInput} placeholder="Optional" />
            </div>
          </div>

          <div className="rounded-[2rem] border-2 bg-white p-5 space-y-4">
            <p className={fieldLabel}>Availability</p>
            <div className="space-y-1.5">
              <p className={fieldLabel}>Tap the times you can work</p>
              <div className="space-y-1.5">
                {DAYS.map(([dayKey, dayLabel]) => (
                  <div key={dayKey} className="flex items-center gap-1.5">
                    <span className="w-10 shrink-0 text-[11px] font-black uppercase tracking-widest text-slate-700">{dayLabel}</span>
                    {SLOTS.map(([slotKey, slotLabel]) => {
                      const on = (availabilityGrid[dayKey] || []).includes(slotKey);
                      return (
                        <button
                          key={slotKey}
                          type="button"
                          aria-pressed={on}
                          aria-label={`${dayLabel} ${slotLabel}`}
                          onClick={() => toggleSlot(dayKey, slotKey)}
                          className={cn('h-10 flex-1 rounded-lg border-2 text-[10px] font-black uppercase tracking-wider', on ? chipOn : chipOff)}
                        >
                          {slotLabel.slice(0, 3)}
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
              <p className="text-[11px] font-bold text-muted-foreground">Leave a day blank if you can&apos;t work it.</p>
            </div>
            <div className="space-y-1.5">
              <p className={fieldLabel}>When could you start?</p>
              <div className="flex flex-wrap gap-1.5">
                {START_OPTIONS.map(s => (
                  <button key={s} type="button" aria-pressed={startWhen === s} onClick={() => setStartWhen(startWhen === s ? '' : s)} className={cn(chipBase, startWhen === s ? chipOn : chipOff)}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="rounded-[2rem] border-2 bg-white p-5 space-y-4">
            <p className={fieldLabel}>Your background</p>
            <div className="space-y-1.5">
              <label htmlFor="apply-experience" className={fieldLabel}>Tell us about your experience</label>
              <textarea id="apply-experience" value={experience} onChange={e => setExperience(e.target.value)} maxLength={2000} rows={4} className="w-full rounded-xl border-2 bg-white p-4 font-bold text-sm text-slate-900 placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900" placeholder="Where you've worked, what you're good at, what you enjoy" />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="apply-message" className={fieldLabel}>Anything else?</label>
              <textarea id="apply-message" value={message} onChange={e => setMessage(e.target.value)} maxLength={2000} rows={3} className="w-full rounded-xl border-2 bg-white p-4 font-bold text-sm text-slate-900 placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900" placeholder="Optional" />
            </div>
          </div>

          {questions.length > 0 && (
            <div className="rounded-[2rem] border-2 bg-white p-5 space-y-4">
              <p className={fieldLabel}>A few more questions from {businessName}</p>
              {questions.map((q: any) => {
                const val = customAnswers[q.id] || '';
                const err = errors[`q_${q.id}`];
                return (
                  <div key={q.id} className="space-y-1.5">
                    <label htmlFor={`q-${q.id}`} className={fieldLabel}>
                      {q.label}{q.required ? ' *' : ''}
                    </label>
                    {q.type === 'paragraph' ? (
                      <textarea id={`q-${q.id}`} value={val} onChange={e => setAnswer(q.id, e.target.value)} maxLength={1000} rows={3} className={cn("w-full rounded-xl border-2 bg-white p-4 font-bold text-sm text-slate-900 placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900", err && 'border-destructive')} />
                    ) : q.type === 'choice' ? (
                      <div className="flex flex-wrap gap-1.5">
                        {(q.options || []).map((opt: string) => (
                          <button key={opt} type="button" aria-pressed={val === opt} onClick={() => setAnswer(q.id, val === opt ? '' : opt)} className={cn(chipBase, val === opt ? chipOn : chipOff, err && !val && 'border-destructive')}>
                            {opt}
                          </button>
                        ))}
                      </div>
                    ) : q.type === 'yesno' ? (
                      <div className="flex flex-wrap gap-1.5">
                        {['Yes', 'No'].map(opt => (
                          <button key={opt} type="button" aria-pressed={val === opt} onClick={() => setAnswer(q.id, val === opt ? '' : opt)} className={cn(chipBase, val === opt ? chipOn : chipOff, err && !val && 'border-destructive')}>
                            {opt}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <input id={`q-${q.id}`} value={val} onChange={e => setAnswer(q.id, e.target.value)} maxLength={1000} className={cn(fieldInput, err && 'border-destructive')} />
                    )}
                    {err && <p className="text-[11px] font-bold text-destructive">{err}</p>}
                  </div>
                );
              })}
            </div>
          )}

          <div ref={errorRef} className="rounded-[2rem] border-2 bg-white p-5 space-y-4">
            <label className="flex items-start gap-3">
              <input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 rounded border-2 accent-slate-900" />
              <span className="text-[12px] font-bold text-slate-700 leading-relaxed">
                I agree to be contacted by {businessName} about my application. My details go only to {businessName}.
              </span>
            </label>
            {errors.agreed && <p className="text-[11px] font-bold text-destructive">{errors.agreed}</p>}
            {submitError && (
              <div className="rounded-xl border-2 border-destructive/40 bg-destructive/5 p-3">
                <p className="text-[12px] font-bold text-destructive">{submitError}</p>
              </div>
            )}
            <button type="submit" disabled={submitting} className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-slate-900 text-[12px] font-black uppercase tracking-widest text-white disabled:opacity-60">
              {submitting ? <Loader className="h-4 w-4 animate-spin" aria-hidden="true" /> : <>Send application <ArrowRight className="h-4 w-4" aria-hidden="true" /></>}
            </button>
          </div>
        </form>
        )}
      </main>
    </div>
  );
}
