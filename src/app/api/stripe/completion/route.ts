'use client';

export const dynamic = 'force-dynamic';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { getFirestore } from 'firebase/firestore';
import { getApp } from 'firebase/app';
import { doc, getDoc, getDocs, collection, addDoc, setDoc } from 'firebase/firestore';
import { FormFieldRenderer } from '@/components/consents/FormFieldRenderer';
import { loadStripe } from '@stripe/stripe-js';
import { EmbeddedCheckoutProvider, EmbeddedCheckout } from '@stripe/react-stripe-js';
import { CheckCircle2, ShieldCheck, CreditCard, Loader, AlertTriangle, Lock, FileSignature } from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// /complete/[tenantId]/[token]
//
// The secure link sent for a phone booking. The client:
//   1. reviews the deposit + cancellation policy and the card-on-file authorization
//   2. signs any required consent forms
//   3. is sent to the combined Checkout (deposit + card vault)
//
// Policy acceptance and signatures are recorded — immutably, with timestamps —
// BEFORE payment, because that agreement is the authorization for the saved card.
// ─────────────────────────────────────────────────────────────────────────────
function CompletionContent({ tenantId, token }: { tenantId: string; token: string }) {
  const [loading, setLoading]       = useState(true);
  const [tenant, setTenant]         = useState<any>(null);
  const [completion, setCompletion] = useState<any>(null);
  const [forms, setForms]           = useState<any[]>([]);
  const [answers, setAnswers]       = useState<Record<string, Record<string, any>>>({});
  const [accepted, setAccepted]     = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [returnState, setReturnState] = useState<null | 'success' | 'cancelled'>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [stripeAccountId, setStripeAccountId] = useState<string | null>(null);

  // Stripe.js must be initialised for the studio's connected account (direct charges)
  const stripePromise = useMemo(() => {
    const pk = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
    if (!pk || !stripeAccountId) return null;
    return loadStripe(pk, { stripeAccount: stripeAccountId });
  }, [stripeAccountId]);

  const getDb = useCallback(() => {
    try { return getFirestore(getApp()); } catch { return null; }
  }, []);

  // Detect return from Stripe
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const p = new URLSearchParams(window.location.search);
    const c = p.get('completed');
    if (c === 'success' || c === 'cancelled') setReturnState(c as 'success' | 'cancelled');
  }, []);

  // Load tenant + completion + required consent forms
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const db = getDb();
      if (!db || !tenantId || !token) { setLoading(false); return; }
      try {
        const [tSnap, cSnap] = await Promise.all([
          getDoc(doc(db, 'tenants', tenantId)),
          getDoc(doc(db, 'tenants', tenantId, 'bookingCompletions', token)),
        ]);
        if (cancelled) return;
        if (tSnap.exists()) setTenant({ id: tSnap.id, ...tSnap.data() });
        if (cSnap.exists()) {
          const comp = { id: cSnap.id, ...cSnap.data() } as any;
          setCompletion(comp);
          const ids: string[] = comp.requiredConsentFormIds || [];
          if (ids.length > 0) {
            const allSnap = await getDocs(collection(db, `tenants/${tenantId}/consentForms`));
            const all = allSnap.docs.map(d => ({ id: d.id, ...d.data() }));
            if (!cancelled) setForms(all.filter((f: any) => ids.includes(f.id)));
          }
        }
      } catch (e) { console.warn('[completion:load]', e); }
      if (!cancelled) setLoading(false);
    };
    run();
    return () => { cancelled = true; };
  }, [tenantId, token, getDb]);

  const accent = tenant?.bookingPageSettings?.cfPageConfig?.accentColor || '#111827';
  const studioName = tenant?.name || 'the studio';
  const depositDollars = (completion?.depositAmountCents || 0) / 100;

  const allConsentsComplete = forms.every((f: any) =>
    (f.fields || []).every((fld: any) => {
      if (fld.type === 'heading' || fld.type === 'paragraph') return true;
      const v = answers[f.id]?.[fld.id];
      return v !== undefined && v !== null && v !== '';
    })
  );

  const handleSubmit = async () => {
    setError(null);
    if (!accepted) { setError('Please accept the policy and authorization to continue.'); return; }
    if (!allConsentsComplete) { setError('Please complete and sign all forms before continuing.'); return; }
    const db = getDb();
    if (!db) { setError('Connection problem — please try again.'); return; }

    setSubmitting(true);
    try {
      const nowISO = new Date().toISOString();
      const signedForms = forms.map((f: any) => ({ formId: f.id, formTitle: f.title, formData: answers[f.id] || {} }));
      const policyAcceptance = {
        acceptedAt: nowISO,
        cardAuthorization: true,
        policyVersion: tenant?.depositPolicy?.version || 'v1',
        depositAmountCents: completion?.depositAmountCents || 0,
      };

      // 1) Immutable audit record (create-only)
      await addDoc(collection(db, `tenants/${tenantId}/completionSubmissions`), {
        token, tenantId,
        appointmentId: completion?.appointmentId || null,
        clientId: completion?.clientId || null,
        clientName: completion?.clientName || null,
        clientEmail: completion?.clientEmail || null,
        signedForms, policyAcceptance, submittedAt: nowISO,
      });

      // 2) Best-effort write onto the appointment so the front desk sees it
      try {
        if (completion?.appointmentId) {
          await setDoc(
            doc(db, `tenants/${tenantId}/appointments/${completion.appointmentId}`),
            { signedForms, policyAcceptance, completionConsentsAt: nowISO },
            { merge: true }
          );
        }
      } catch { /* rules may restrict public writes — the audit record above is the source of truth */ }

      // 3) Get the embedded checkout client secret (renders inline — no redirect)
      const res = await fetch('/api/stripe/completion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId,
          completionToken: token,
          appointmentId: completion?.appointmentId,
          clientId:      completion?.clientId,
          clientName:    completion?.clientName,
          clientEmail:   completion?.clientEmail,
          depositAmount: depositDollars,
          serviceName:   completion?.serviceName,
        }),
      });
      const out = await res.json().catch(() => null);
      if (out?.clientSecret) {
        setStripeAccountId(out.stripeAccountId || null);
        setClientSecret(out.clientSecret);
        setSubmitting(false);
        return;
      }
      setError(out?.error || 'Could not start checkout. Please contact the studio.');
      setSubmitting(false);
    } catch (e: any) {
      setError(e.message || 'Something went wrong. Please try again.');
      setSubmitting(false);
    }
  };

  // ── Render states ──────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-slate-50">
        <Loader className="w-7 h-7 animate-spin" style={{ color: accent }} />
      </div>
    );
  }

  if (returnState === 'success' || completion?.status === 'complete') {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-slate-50 p-6">
        <div className="w-full max-w-md bg-white rounded-3xl border shadow-xl p-10 text-center space-y-5">
          <div className="w-20 h-20 rounded-full bg-green-50 flex items-center justify-center mx-auto">
            <CheckCircle2 className="w-10 h-10 text-green-500" />
          </div>
          <h1 className="text-2xl font-black tracking-tight text-slate-900">You're all set</h1>
          <p className="text-sm text-slate-500 leading-relaxed">
            Your booking with {studioName} is secured. Your card is safely on file and any forms are signed. We'll see you soon!
          </p>
        </div>
      </div>
    );
  }

  if (!completion) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-slate-50 p-6">
        <div className="w-full max-w-md bg-white rounded-3xl border shadow-xl p-10 text-center space-y-4">
          <AlertTriangle className="w-10 h-10 text-amber-500 mx-auto" />
          <h1 className="text-xl font-black tracking-tight text-slate-900">Link not found</h1>
          <p className="text-sm text-slate-500">This link may have expired or already been completed. Please contact {studioName} for a new one.</p>
        </div>
      </div>
    );
  }

  if (completion?.expiresAt && new Date(completion.expiresAt).getTime() < Date.now()) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-slate-50 p-6">
        <div className="w-full max-w-md bg-white rounded-3xl border shadow-xl p-10 text-center space-y-4">
          <AlertTriangle className="w-10 h-10 text-amber-500 mx-auto" />
          <h1 className="text-xl font-black tracking-tight text-slate-900">This link has expired</h1>
          <p className="text-sm text-slate-500">For your security, completion links are valid for a limited time. Please contact {studioName} and they'll send you a fresh one.</p>
        </div>
      </div>
    );
  }

  // Inline payment — embedded Stripe Checkout, no redirect
  if (clientSecret) {
    return (
      <div className="min-h-dvh bg-slate-50 py-8 px-4">
        <div className="w-full max-w-lg mx-auto space-y-5">
          <div className="text-center space-y-2 pt-4">
            <p className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-400">{studioName}</p>
            <h1 className="text-2xl font-black tracking-tight text-slate-900">{depositDollars > 0 ? 'Payment & card on file' : 'Save your card'}</h1>
            <p className="text-sm text-slate-500">{depositDollars > 0 ? `Pay your $${depositDollars.toFixed(2)} deposit and save your card — all right here.` : 'Securely save your card to finish.'}</p>
          </div>
          <div className="bg-white rounded-2xl border shadow-sm p-2 sm:p-4 min-h-[300px]">
            {stripePromise
              ? <EmbeddedCheckoutProvider stripe={stripePromise} options={{ clientSecret, onComplete: () => setReturnState('success') }}>
                  <EmbeddedCheckout />
                </EmbeddedCheckoutProvider>
              : <div className="p-8 text-center text-sm text-slate-500">Payment can't load right now — please contact {studioName}.</div>}
          </div>
          <p className="flex items-center justify-center gap-1.5 text-[10px] font-medium text-slate-400 pb-8">
            <Lock className="w-3 h-3" /> Secured by Stripe · your card details never touch our servers
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-slate-50 py-8 px-4">
      <div className="w-full max-w-lg mx-auto space-y-5">

        {/* Header */}
        <div className="text-center space-y-2 pt-4">
          <p className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-400">{studioName}</p>
          <h1 className="text-2xl font-black tracking-tight text-slate-900">Finish your booking</h1>
          <p className="text-sm text-slate-500">A couple of quick steps to secure your appointment.</p>
        </div>

        {returnState === 'cancelled' && (
          <div className="flex items-start gap-3 p-4 rounded-2xl bg-amber-50 border border-amber-200">
            <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
            <p className="text-xs font-medium text-amber-800">Payment wasn't completed, so your spot isn't secured yet. You can finish below.</p>
          </div>
        )}

        {/* Deposit summary */}
        {depositDollars > 0 && (
          <div className="bg-white rounded-2xl border shadow-sm p-5 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <CreditCard className="w-5 h-5" style={{ color: accent }} />
              <div>
                <p className="text-sm font-bold text-slate-900">Deposit due today</p>
                <p className="text-[11px] text-slate-400">{completion?.serviceName || 'Your appointment'}</p>
              </div>
            </div>
            <p className="text-xl font-black text-slate-900">${depositDollars.toFixed(2)}</p>
          </div>
        )}

        {/* Consent forms */}
        {forms.map((form: any) => (
          <div key={form.id} className="bg-white rounded-2xl border shadow-sm p-6 space-y-5">
            <div className="flex items-center gap-2 pb-3 border-b">
              <FileSignature className="w-4 h-4" style={{ color: accent }} />
              <h2 className="text-sm font-black uppercase tracking-tight text-slate-900">{form.title}</h2>
            </div>
            <div className="space-y-6">
              {(form.fields || []).map((field: any) => (
                <FormFieldRenderer
                  key={field.id}
                  field={field}
                  value={answers[form.id]?.[field.id]}
                  onChange={(val: any) => setAnswers(prev => ({ ...prev, [form.id]: { ...(prev[form.id] || {}), [field.id]: val } }))}
                />
              ))}
            </div>
          </div>
        ))}

        {/* Policy + card authorization */}
        <div className="bg-white rounded-2xl border shadow-sm p-6 space-y-4">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4" style={{ color: accent }} />
            <h2 className="text-sm font-black uppercase tracking-tight text-slate-900">Policy & Authorization</h2>
          </div>
          <div className="text-xs text-slate-500 leading-relaxed space-y-2 max-h-44 overflow-y-auto pr-1">
            <p>{tenant?.cancellationPolicyText || `Deposits secure your appointment time. Cancellations made with adequate notice are handled per ${studioName}'s policy; late cancellations and no-shows may forfeit the deposit or incur a fee.`}</p>
            <p>By continuing, you authorize {studioName} to keep your card on file and to charge it for late-cancellation or no-show fees in accordance with the policy above.</p>
          </div>
          <label className="flex items-start gap-3 cursor-pointer pt-2 border-t">
            <input
              type="checkbox"
              checked={accepted}
              onChange={e => setAccepted(e.target.checked)}
              className="mt-0.5 h-5 w-5 rounded border-2 shrink-0"
              style={{ accentColor: accent }}
            />
            <span className="text-xs font-medium text-slate-700 leading-relaxed">
              I have read and agree to the policy, and I authorize {studioName} to securely store and charge my card for fees as described.
            </span>
          </label>
        </div>

        {error && (
          <div className="flex items-start gap-3 p-4 rounded-2xl bg-red-50 border border-red-200">
            <AlertTriangle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
            <p className="text-xs font-medium text-red-700">{error}</p>
          </div>
        )}

        {/* Submit */}
        <button
          onClick={handleSubmit}
          disabled={submitting}
          className="w-full h-14 rounded-2xl text-white font-black uppercase tracking-widest text-sm shadow-lg flex items-center justify-center gap-2 disabled:opacity-60"
          style={{ background: accent }}
        >
          {submitting
            ? <><Loader className="w-5 h-5 animate-spin" /> Securing…</>
            : depositDollars > 0
              ? <>Pay ${depositDollars.toFixed(2)} & save card</>
              : <>Save card & finish</>}
        </button>

        <p className="flex items-center justify-center gap-1.5 text-[10px] font-medium text-slate-400 pb-8">
          <Lock className="w-3 h-3" /> Secured by Stripe · your card details never touch our servers
        </p>
      </div>
    </div>
  );
}

export default function BookingCompletionPage({ params }: { params: { tenantId: string; token: string } }) {
  return <CompletionContent tenantId={params.tenantId} token={params.token} />;
}