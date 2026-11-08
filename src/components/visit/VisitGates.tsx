'use client';
// src/components/visit/VisitGates.tsx — the visit link's screens for doing something about the booking, in the
// business's own look (VisitShell): finishing the booking (forms, documents, confirmations, card and deposit), canceling
// (what happens to the money said in a sentence, and keeping it is the easy button), rescheduling (open times only,
// or asking the team when the change limit needs their OK), message settings, a canceled visit (with a fee to pay when
// one is owed), and a time that has passed. Everything is saved by the server against this visit's token.
import React, { useState, useMemo, useEffect } from 'react';
import { format, isSameDay } from 'date-fns';
import { CheckCircle2, Info, Lock, FileSignature, CreditCard, ShieldCheck, Upload, Image as ImageIcon, Phone, Camera } from 'lucide-react';
import { loadStripe } from '@stripe/stripe-js';
import { EmbeddedCheckoutProvider, EmbeddedCheckout } from '@stripe/react-stripe-js';
import { type Client, type Tenant } from '@/lib/data';
import { FormsLeft, type VisitFormsView } from '@/components/visit/VisitForms';
import { visitDevice } from '@/components/visit/VerifyCard';
import { formMinutes, isHealthForm, formRulesOf } from '@/lib/forms';
import { VisitShell, VisitCard, VisitButton, VisitMuted, VisitLabel, VisitChoice, VisitSelect, VisitInput, VisitCheckRow, VisitSaid, VisitCheck, type VisitBrand } from '@/components/booking/VisitShell';
import { safeDate } from '@/components/visit/VisitStages';
import { wallDate } from '@/lib/tenant-time';

// v15 — CancelledView now optionally shows a self-service payment prompt
// when bookingCompletions.status === 'fee_owed' (set by log-call-intent's
// voice-verified-but-no-card cancellation path). Reuses the EXISTING
// /api/stripe/completion route and EmbeddedCheckout pattern already proven
// in CompletionGateView — same payload shape, same component, just a
// different framing ("Cancellation Fee" instead of "Finish Your Booking").
// No new payment endpoint; this is the same money-collection mechanism
// already used everywhere else in this file.
export const CancelledView = ({
    reason,
    tenantId,
    token,
    completion,
    firestore,
    brand,
}: {
    brand: VisitBrand;
    reason?: string;
    tenantId?: string;
    token?: string;
    completion?: any;
    firestore?: any;
}) => {
    const [clientSecret, setClientSecret] = useState<string | null>(null);
    const [stripeAccountId, setStripeAccountId] = useState<string | null>(null);
    const [isStartingPayment, setIsStartingPayment] = useState(false);
    const [paymentError, setPaymentError] = useState<string | null>(null);
    const [feeSettled, setFeeSettled] = useState(false);

    const owesFee = completion?.status === 'fee_owed' && !feeSettled;
    const feeAmount = (completion?.depositAmountCents || 0) / 100;

    const stripePromise = useMemo(() => {
        const pk = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
        if (!pk || !stripeAccountId) return null;
        return loadStripe(pk, { stripeAccount: stripeAccountId });
    }, [stripeAccountId]);

    const handleStartPayment = async () => {
        setIsStartingPayment(true);
        setPaymentError(null);
        try {
            const res = await fetch('/api/stripe/completion', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    // The server reads who, what and how much from the completion record itself.
                    tenantId, completionToken: token,
                }),
            });
            const out = await res.json().catch(() => null);
            if (out?.clientSecret) {
                setStripeAccountId(out.stripeAccountId || null);
                setClientSecret(out.clientSecret);
            } else {
                setPaymentError(out?.error || 'The payment step didn’t open. Please try again in a moment.');
            }
        } catch (e: any) {
            setPaymentError(e.message || 'Something went wrong. Please try again.');
        } finally {
            setIsStartingPayment(false);
        }
    };

    const handleFeePaid = async () => {
        // The payment is recorded by the Stripe webhook when Stripe confirms it —
        // the fee (as a fee), the client's balance, the link marked paid and the
        // activity log. The page just says thank you.
        setFeeSettled(true);
    };

    const why = String(reason || '').replace(/_/g, ' ').trim();
    return (
        <VisitShell brand={brand} chip="Canceled" title={<>This appointment is <b>canceled</b></>} subtitle={why && !/protocol|void/i.test(why) ? `Reason: ${why}` : undefined}>
            {owesFee && (
                <VisitCard tone="warn">
                    <p className="text-[15px] font-semibold">Cancellation fee: ${feeAmount.toFixed(2)}</p>
                    {clientSecret && stripePromise ? (
                        <EmbeddedCheckoutProvider stripe={stripePromise} options={{ clientSecret, onComplete: handleFeePaid }}>
                            <EmbeddedCheckout />
                        </EmbeddedCheckoutProvider>
                    ) : (
                        <>
                            {paymentError && <p className="text-[14px] font-semibold" role="alert" style={{ color: 'var(--warn)' }}>{paymentError}</p>}
                            <VisitButton onClick={handleStartPayment} disabled={isStartingPayment}>{isStartingPayment ? 'Opening…' : 'Pay the fee'}</VisitButton>
                        </>
                    )}
                </VisitCard>
            )}
            {feeSettled && <VisitCard tone="ok"><p className="text-[15px]">Thank you. Your fee has been paid.</p></VisitCard>}
            <VisitCard>
                <p className="text-[15px]">We’d love to see you another time.</p>
                {brand.bookHref && <VisitButton href={brand.bookHref}>Book a new time</VisitButton>}
                            </VisitCard>
        </VisitShell>
    );
};

// v8 — NEW: lets a client control how and when they're notified. Seeded
// from client.notificationPreferences, defaulting to whatever the
// existing system-wide defaults are today (both channels for
// confirmations, voice for reminders — preserving current behavior for
// every client who hasn't touched this) so an unset preference is
// indistinguishable from "I'm fine with the defaults."
export const REMINDER_HOUR_OPTIONS = [
    { value: 1, label: '1 hour before' },
    { value: 24, label: '24 hours before' },
    { value: 48, label: '48 hours before' },
    { value: 72, label: '72 hours before' },
];

export const NotificationPreferencesView = ({ tenantId, token, onBack, brand }: { tenantId: string; token: string; onBack: () => void; brand: VisitBrand; client?: Client | null }) => {
    // What's set now comes from the server (a client's record isn't readable from their phone); defaults until then.
    const [loaded, setLoaded] = useState(false);
    const [confirmationChannel, setConfirmationChannel] = useState('both');
    const [reminderChannel, setReminderChannel] = useState('voice');
    const [reminderHoursBefore, setReminderHoursBefore] = useState(48);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [saveErr, setSaveErr] = useState('');
    const call = (body: any) => fetch('/api/checkin/actions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, ...body }) }).then((r) => r.json()).catch(() => ({ ok: false }));
    // Shown only once what's set now has loaded, so a failed load can never be saved over their real choices.
    const [loadErr, setLoadErr] = useState('');
    const [tries, setTries] = useState(0);
    useEffect(() => {
        let live = true; setLoadErr('');
        void call({ action: 'prefs_get' }).then((d) => {
            if (!live) return;
            if (d?.ok && d.prefs) { setConfirmationChannel(d.prefs.confirmationChannel); setReminderChannel(d.prefs.reminderChannel); setReminderHoursBefore(Number(d.prefs.reminderHoursBefore) || 48); setLoaded(true); }
            else setLoadErr(d?.error || 'We couldn’t load your settings. Please try again.');
        });
        return () => { live = false; };
    }, [tenantId, token, tries]); // eslint-disable-line react-hooks/exhaustive-deps

    const handleSave = async () => {
        setSaving(true); setSaveErr('');
        const d = await call({ action: 'prefs', confirmationChannel, reminderChannel, reminderHoursBefore });
        setSaving(false);
        if (!d?.ok) { setSaveErr(d?.error || 'That didn’t save. Please try again.'); return; }
        setSaved(true); setTimeout(() => setSaved(false), 2000);
    };
    const hourOptions = REMINDER_HOUR_OPTIONS.some((o) => o.value === reminderHoursBefore) ? REMINDER_HOUR_OPTIONS : [...REMINDER_HOUR_OPTIONS, { value: reminderHoursBefore, label: `${reminderHoursBefore} hours before` }];

    return (
        <VisitShell brand={brand} title={<>How we <b>reach you</b></>} subtitle="Booking confirmations and reminders">
            {!loaded ? (loadErr ? <><VisitSaid text={loadErr} /><VisitButton quiet onClick={() => setTries((n) => n + 1)}>Try again</VisitButton></> : <VisitMuted>Getting your settings…</VisitMuted>) : <>
                <VisitCard>
                    <VisitLabel>Booking confirmations</VisitLabel>
                    <VisitChoice value={confirmationChannel} onChange={setConfirmationChannel as any} options={[['sms', 'Text'], ['email', 'Email'], ['both', 'Both'], ['none', 'Off']]} />
                </VisitCard>
                <VisitCard>
                    <VisitLabel>Appointment reminders</VisitLabel>
                    <VisitChoice value={reminderChannel} onChange={setReminderChannel as any} cols={2} options={[['voice', 'Phone call'], ['sms', 'Text'], ['email', 'Email'], ['none', 'Off']]} />
                    {reminderChannel === 'voice' && <VisitMuted>A phone call is a friendly reminder, and you can reschedule or cancel right there if plans change.</VisitMuted>}
                    {reminderChannel !== 'none' && <>
                        <VisitLabel>Remind me</VisitLabel>
                        <VisitSelect label="When to remind me" value={reminderHoursBefore} onChange={(v) => setReminderHoursBefore(Number(v))} options={hourOptions} />
                    </>}
                </VisitCard>
            </>}
            <VisitSaid text={saveErr} />
            {saved && <VisitSaid ok text="Saved. We’ll reach you this way from now on." />}
            {loaded && <VisitButton onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save'}</VisitButton>}
            <VisitButton quiet onClick={onBack}>Back</VisitButton>
        </VisitShell>
    );
};

// resolution — never checked in, never explicitly canceled, never marked
// completed or no-show. Previously a stale link like this fell straight
// through to the normal arrival flow ("Hello! I Have Arrived / En Route /
// Running Late"), which is wrong and mildly harmful: tapping "I Have
// Arrived" on a week-old appointment would falsely flag it as arrived
// TODAY, corrupting whatever no-show/attendance reporting reads that
// field. This is a read-only, dead-end view — it doesn't write anything,
// just stops the client from taking an action that no longer makes sense.
export const StaleAppointmentView = ({ brand }: { brand: VisitBrand; tenantName?: string; tenantPhone?: string }) => (
    <VisitShell brand={brand} title={<>This time has <b>passed</b></>} subtitle="This link was for an earlier appointment.">
        <VisitCard>
            <p className="text-[15px]">Book a new time whenever suits you.</p>
            {brand.bookHref && <VisitButton href={brand.bookHref}>Book a new time</VisitButton>}
        </VisitCard>
    </VisitShell>
);
// ── Finish your booking ─────────────────────────────────────────────────────
// Whatever the booking still needs before the visit: forms (a parent or guardian signs for a child when the form
// says so), files, things to confirm, the marketing choice, an emergency contact, and the policy with the card and any
// deposit. Four cases: forms and card, forms only, card only, nothing (the page doesn't show this then — see
// isCompletionPending). One call to the server saves it all; the card or deposit goes through Stripe after that.
export const CompletionGateView = ({
    brand,
    tenant, tenantId, token, completion, forms, onDone, visit, allForms, onChanged,
}: {
    brand: VisitBrand;
    tenant: Tenant | null;
    tenantId: string;
    token: string;
    completion: any;
    forms: any[];
    onDone: (justCompletedToday: boolean) => void;
    /** The visit's forms and documents from the client's side (api/visit-completion), with every form's wording. */
    visit?: VisitFormsView | null;
    allForms?: any[];
    onChanged?: () => void;
}) => {

    const [uploads, setUploads] = useState<Record<string, any[]>>({});
    const [uploading, setUploading] = useState(false);
    const [accepted, setAccepted] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [clientSecret, setClientSecret] = useState<string | null>(null);
    const [stripeAccountId, setStripeAccountId] = useState<string | null>(null);
    const [marketingConsent, setMarketingConsent] = useState<boolean | null>(null);
    const [emergencyContact, setEmergencyContact] = useState({ name: '', phone: '', relationship: '' });
    const [acknowledged, setAcknowledged] = useState<Record<string, boolean>>({});

    const stripePromise = useMemo(() => {
        const pk = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
        if (!pk || !stripeAccountId) return null;
        return loadStripe(pk, { stripeAccount: stripeAccountId });
    }, [stripeAccountId]);

    const skipCardStep = completion?.skipCardStep === true;
    // Is the visit today? On the business's clock, the same one the screens use.
    const startsToday = () => !!completion?.appointmentStartTime && isSameDay(wallDate(safeDate(completion.appointmentStartTime), brand.zone), wallDate(new Date(), brand.zone));
    const depositDollars = (completion?.depositAmountCents || 0) / 100;
    const studioName = tenant?.name || 'the studio';

    // The forms are filled in one at a time above (FormsLeft) and each is saved as it's finished. Without the list from
    // the server (a slow moment), the forms this request asks for are shown as still to do.
    const fileReqsAll: any[] = completion?.fileRequirements || [];
    const shownVisit: VisitFormsView = visit || { asks: forms.map((f: any) => ({ formId: f.id, title: String(f.title || 'Form'), ask: 'sign' as const, why: '', minutes: formMinutes(f), health: isHealthForm(f), since: null })),
        files: fileReqsAll.map((fr: any) => ({ id: String(fr.id), label: String((fr.file || fr).prompt || fr.label || 'A document'), done: false, onFile: false })), left: forms.length + fileReqsAll.length, dueAt: null };
    // Saved on this screen just now count as done, even before the list comes back from the server.
    const [savedHere, setSavedHere] = useState<Record<string, true>>({});
    const formsLeftNow = shownVisit.asks.some((a) => (a.ask === 'sign' || a.ask === 'sign_again') && !savedHere[a.formId]);

    const acknowledgments: any[] = completion?.acknowledgments || [];
    const allAcknowledged = acknowledgments.every((a: any) => acknowledged[a.id]);

    const marketingConsentComplete = !completion?.requestMarketingConsent || marketingConsent !== null;
    const emergencyContactComplete = !completion?.requestEmergencyContact ||
        (!!emergencyContact.name.trim() && !!emergencyContact.phone.trim());

    const fileReqs: any[] = completion?.fileRequirements || [];
    const fileCfg = (fr: any) => fr.file || fr;
    const allFilesComplete = fileReqs.every((fr: any) => {
        if (fr.required === false) return true;
        const min = fileCfg(fr).minCount ?? 1;
        return (uploads[fr.id] || []).length >= min;
    });

    const handleFiles = async (reqId: string, fileList: FileList | null, cfg: any) => {
        if (!fileList || fileList.length === 0) return;
        const existing = uploads[reqId] || [];
        const max = cfg?.maxCount ?? 5;
        const picked = Array.from(fileList).slice(0, Math.max(0, max - existing.length));
        setError(null); setUploading(true);
        try {
            for (const file of picked) {
                if (file.size > 10 * 1024 * 1024) { setError(`${file.name} is over 10 MB, so it wasn’t added.`); continue; }
                const fd = new FormData();
                fd.append('file', file); fd.append('tenantId', tenantId);
                fd.append('token', token); fd.append('reqId', reqId);
                const res = await fetch('/api/completion/upload-file', { method: 'POST', body: fd });
                const out = await res.json().catch(() => null);
                if (out?.url) {
                    setUploads(prev => ({ ...prev, [reqId]: [...(prev[reqId] || []), { name: file.name, url: out.url, previewUrl: out.previewUrl || null, uploadedAt: new Date().toISOString() }] }));
                } else {
                    setError(out?.error || `Couldn't upload ${file.name}.`);
                }
            }
        } catch (e: any) { setError(`Upload failed: ${e.message}`); }
        finally { setUploading(false); }
    };

    const removeUpload = (reqId: string, idx: number) =>
        setUploads(prev => ({ ...prev, [reqId]: (prev[reqId] || []).filter((_, i) => i !== idx) }));

    const handleSubmit = async () => {
        setError(null);
        if (!skipCardStep && !accepted) { setError('Please accept the policy and authorization to continue.'); return; }
        if (formsLeftNow) { setError('Please finish the forms above first.'); return; }
        if (!allFilesComplete) { setError('Please add the requested photos or files before continuing.'); return; }
        if (!allAcknowledged) { setError('Please confirm you\'ve read everything before continuing.'); return; }
        if (!marketingConsentComplete) { setError('Please let us know your marketing preference before continuing.'); return; }
        if (!emergencyContactComplete) { setError('Please add an emergency contact before continuing.'); return; }
        if (uploading) { setError('Please wait for uploads to finish.'); return; }

        setSubmitting(true);
        try {
            const nowISO = new Date().toISOString();
            const signedForms: any[] = [];   // each form was saved as it was finished
            const fileSubmissions = fileReqs.map((fr: any) => ({
                requirementId: fr.id, label: fileCfg(fr).prompt || fr.label || 'Files', files: uploads[fr.id] || [],
            }));
            const policyAcceptance = {
                acceptedAt: nowISO,
                cardAuthorization: !skipCardStep,
                policyVersion: tenant?.depositPolicy?.version || 'v1',
                depositAmountCents: completion?.depositAmountCents || 0,
            };

            // ONE call to the server, which records everything (the submission,
            // the appointment, signed consents, profile documents, marketing
            // consent, emergency contact, acknowledgements, completion status).
            // These used to be written from the browser — refused by the rules,
            // so only the raw submission survived.
            const guardianByForm = {};
            const profileDocuments = fileReqs.filter((fr: any) => fileCfg(fr).persistToProfile).map((fr: any) => ({ requirementId: fr.id, label: fileCfg(fr).prompt || fr.label || 'Document', files: uploads[fr.id] || [] }));
            const saveRes = await fetch('/api/checkin/actions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
                action: 'complete', token, tenantId, device: visitDevice(), signedForms, fileSubmissions, policyAcceptance, guardianByForm, profileDocuments,
                marketingConsent: completion?.requestMarketingConsent ? marketingConsent : null,
                emergencyContact: completion?.requestEmergencyContact ? emergencyContact : null,
                acknowledgments: acknowledgments.map((a: any) => a.text), skipCardStep,
            }) });
            const saved = await saveRes.json().catch(() => ({}));
            if (!saved?.ok) { setError(saved?.error || 'We couldn’t save your answers. Please try again.'); setSubmitting(false); onChanged?.(); return; }
            if (skipCardStep) {
                setSubmitting(false);
                onDone(startsToday());
                return;
            }
            const res = await fetch('/api/stripe/completion', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    // The server reads who, what and how much from the completion record itself.
                    tenantId, completionToken: token,
                }),
            });
            const out = await res.json().catch(() => null);
            if (out?.clientSecret) {
                setStripeAccountId(out.stripeAccountId || null);
                setClientSecret(out.clientSecret);
                setSubmitting(false);
                return;
            }
            setError(out?.error || 'We couldn’t open the payment step. Please try again in a moment.');
            setSubmitting(false);
        } catch (e: any) {
            setError(e.message || 'Something went wrong. Please try again.');
            setSubmitting(false);
        }
    };

    // Stripe embedded checkout step
    if (clientSecret) {
        return (
            <VisitShell brand={brand} chip="Booked" title={depositDollars > 0 ? <>Your <b>deposit</b></> : <>Save your <b>card</b></>}
                subtitle={depositDollars > 0 ? `Pay your $${depositDollars.toFixed(2)} deposit and save your card.` : 'Save your card securely to finish.'}>
                <div className="pub-card min-h-[300px] overflow-hidden p-2 sm:p-4" style={{ background: '#fff' }}>
                    {stripePromise
                        ? <EmbeddedCheckoutProvider stripe={stripePromise} options={{ clientSecret, onComplete: () => {
                            // Completion is recorded by the Stripe webhook when payment/card is confirmed.
                            onDone(startsToday());
                        } }}>
                            <EmbeddedCheckout />
                        </EmbeddedCheckoutProvider>
                        : <p className="p-8 text-center text-[15px]" style={{ color: '#6d7075' }}>Payment can’t load right now. Please try again in a moment, or message {studioName}.</p>}
                </div>
                <p className="flex items-center justify-center gap-1.5 text-[13px]" style={{ color: 'var(--muted)' }}><Lock className="h-3.5 w-3.5" /> Secured by Stripe. Your card details never touch our servers.</p>
            </VisitShell>
        );
    }

    const at = completion?.appointmentStartTime ? wallDate(safeDate(completion.appointmentStartTime), brand.zone) : null;
    const head = (Icon: any, title: React.ReactNode, right?: React.ReactNode) => (
        <div className="flex items-center gap-2.5 pb-3" style={{ borderBottom: '1px solid var(--line)' }}>
            <Icon className="h-[18px] w-[18px] shrink-0 pub-accent-text" aria-hidden />
            <h2 className="min-w-0 flex-1 text-[16px] font-semibold">{title}</h2>{right}
        </div>
    );
    const pill = (on: boolean) => ({ background: on ? 'var(--accent)' : 'var(--card)', color: on ? '#fff' : 'var(--ink)', boxShadow: on ? 'none' : 'inset 0 0 0 1px var(--line)' });
    return (
        <VisitShell brand={brand} chip="Booked" title={skipCardStep ? <>A few <b>details</b></> : <>Finish your <b>booking</b></>}
            subtitle={[at ? `${format(at, 'EEEE, MMMM d')} at ${format(at, 'h:mm a')}` : '', completion?.serviceName || ''].filter(Boolean).join(' · ') || undefined}>
            {skipCardStep && completion?.cardAlreadyOnFile === true
                ? <p className="v-note flex items-center gap-2"><CheckCircle2 className="h-4 w-4 shrink-0" style={{ color: 'var(--good)' }} aria-hidden /> Your card is on file, so there’s nothing to pay now.</p>
                : <p className="v-note">A couple of quick steps and you’re all set.</p>}

            {!skipCardStep && depositDollars > 0 && (
                <div className="v-grp"><div className="v-row"><span className="v-ico" aria-hidden><CreditCard className="h-[18px] w-[18px]" /></span>
                    <span className="min-w-0 flex-1 py-3"><span className="block font-semibold">Deposit due today</span><span className="block text-[13.5px]" style={{ color: 'var(--muted)' }}>{completion?.serviceName || 'Your appointment'}</span></span>
                    <span className="text-[19px] font-semibold tabular-nums">${depositDollars.toFixed(2)}</span></div></div>
            )}

            {shownVisit.asks.length + shownVisit.files.length > 0 && <FormsLeft brand={brand} visit={shownVisit} forms={allForms && allForms.length ? allForms : forms} token={token} tenantId={tenantId}
                moreAfter={fileReqs.length > 0 || acknowledgments.length > 0 || !!completion?.requestMarketingConsent || !!completion?.requestEmergencyContact || !skipCardStep}
                guardianAsk={formRulesOf(tenant).guardian} businessName={studioName} onChanged={() => onChanged?.()} onAllDone={() => onDone(startsToday())}
                onSaved={(id) => setSavedHere((p) => ({ ...p, [id]: true }))} />}

            {fileReqs.map((fr: any) => {
                const cfg = fileCfg(fr);
                const got = uploads[fr.id] || [];
                const min = cfg.minCount ?? 1;
                const max = cfg.maxCount ?? 5;
                return (
                    <section key={fr.id} className="pub-card space-y-4 p-5" aria-label={cfg.prompt || fr.label || 'Files'}>
                        {head(ImageIcon, cfg.prompt || fr.label || 'Share files')}
                        <VisitMuted>Add up to {max} {max > 1 ? 'files' : 'file'}{min > 0 ? ` (at least ${min})` : ''}. Photos or PDFs, up to 10 MB each.</VisitMuted>
                        {got.length > 0 && (
                            <div className="grid grid-cols-3 gap-2">
                                {got.map((f: any, i: number) => (
                                    <div key={i} className="relative aspect-square overflow-hidden rounded-2xl" style={{ background: 'var(--soft)' }}>
                                        {/\.(png|jpe?g|gif|webp|heic)$/i.test(f.name)
                                            ? <img src={(f as any).previewUrl || f.url} alt={f.name} className="h-full w-full object-cover" />
                                            : <div className="flex h-full items-center justify-center break-all p-2 text-center text-[12px]" style={{ color: 'var(--muted)' }}>{f.name}</div>}
                                        <button type="button" onClick={() => removeUpload(fr.id, i)} aria-label={`Remove ${f.name}`} className="absolute right-0 top-0 flex h-11 w-11 items-start justify-end p-1.5">
                                            <span className="flex h-7 w-7 items-center justify-center rounded-full text-[16px] leading-none text-white" style={{ background: 'rgba(22,23,26,.65)' }} aria-hidden>×</span></button>
                                    </div>
                                ))}
                            </div>
                        )}
                        {got.length < max && (
                            <label className="flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-2xl text-[15px] font-semibold" style={{ border: '1.5px dashed var(--line)', color: 'var(--ink)' }}>
                                <Upload className="h-4 w-4" aria-hidden /> {uploading ? 'Uploading…' : got.length > 0 ? 'Add more' : 'Add photos'}
                                <input type="file" multiple accept={(cfg.acceptedTypes || ['image/*']).join(',')} className="sr-only" disabled={uploading}
                                    onChange={e => { handleFiles(fr.id, e.target.files, cfg); e.currentTarget.value = ''; }} />
                            </label>
                        )}
                    </section>
                );
            })}

            {acknowledgments.map((ack: any) => (
                <section key={ack.id} className="pub-card space-y-3 p-5" aria-label="Please confirm">
                    {head(Info, 'Please confirm')}
                    <p className="text-[15px] leading-relaxed">{ack.text}</p>
                    <VisitCheckRow checked={!!acknowledged[ack.id]} onChange={(v) => setAcknowledged(prev => ({ ...prev, [ack.id]: v }))}>I have read and understand this.</VisitCheckRow>
                </section>
            ))}

            {completion?.requestMarketingConsent && (
                <section className="pub-card space-y-4 p-5" aria-label="Photos and marketing">
                    {head(Camera, 'Photos and marketing')}
                    <VisitMuted>May {studioName} share before and after photos, or mention your visit, on social media or in marketing? You can change your answer any time.</VisitMuted>
                    <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Photos and marketing">
                        <button type="button" role="radio" aria-checked={marketingConsent === true} onClick={() => setMarketingConsent(true)} className="min-h-12 rounded-full px-3 text-[15px] font-semibold pub-press" style={pill(marketingConsent === true)}>Yes, that’s fine</button>
                        <button type="button" role="radio" aria-checked={marketingConsent === false} onClick={() => setMarketingConsent(false)} className="min-h-12 rounded-full px-3 text-[15px] font-semibold pub-press" style={pill(marketingConsent === false)}>No, please don’t</button>
                    </div>
                </section>
            )}

            {completion?.requestEmergencyContact && (
                <section className="pub-card space-y-3 p-5" aria-label="Emergency contact">
                    {head(Phone, 'Emergency contact')}
                    <div className="grid gap-2 sm:grid-cols-2">
                        <VisitInput label="Emergency contact’s full name" placeholder="Full name" value={emergencyContact.name} onChange={(v) => setEmergencyContact(prev => ({ ...prev, name: v }))} />
                        <VisitInput label="Emergency contact’s phone number" placeholder="Phone number" value={emergencyContact.phone} onChange={(v) => setEmergencyContact(prev => ({ ...prev, phone: v }))} />
                    </div>
                    <VisitInput label="Relationship (optional)" placeholder="Relationship (optional)" value={emergencyContact.relationship} onChange={(v) => setEmergencyContact(prev => ({ ...prev, relationship: v }))} />
                </section>
            )}

            {!skipCardStep && (
                <section className="pub-card space-y-3 p-5" aria-label="Policy and card">
                    {head(ShieldCheck, 'Policy and your card')}
                    <div className="max-h-44 space-y-2 overflow-y-auto pr-1 text-[14px] leading-relaxed" style={{ color: 'var(--muted)' }}>
                        <p>{tenant?.cancellationPolicyText || `Deposits secure your appointment time. Cancellations made with enough notice follow ${studioName}’s policy; late cancellations and no-shows may keep the deposit or carry a fee.`}</p>
                        <p>By continuing, you authorize {studioName} to keep your card on file and to charge it for late-cancellation or no-show fees under the policy above.</p>
                    </div>
                    <div style={{ borderTop: '1px solid var(--line)' }} className="pt-2">
                        <VisitCheckRow checked={accepted} onChange={setAccepted}>I have read and agree to the policy, and I authorize {studioName} to store my card securely and charge it for fees as described.</VisitCheckRow>
                    </div>
                </section>
            )}

            <VisitSaid text={error} />

            {(fileReqs.length > 0 || acknowledgments.length > 0 || completion?.requestMarketingConsent || completion?.requestEmergencyContact || !skipCardStep) && (
                <VisitButton onClick={handleSubmit} disabled={submitting || uploading || formsLeftNow || !allAcknowledged || !marketingConsentComplete || !emergencyContactComplete}>
                    {submitting ? 'Saving…' : skipCardStep ? 'Send' : depositDollars > 0 ? `Continue to pay $${depositDollars.toFixed(2)}` : 'Continue to save your card'}
                </VisitButton>)}

            <p className="flex items-center justify-center gap-1.5 text-[13px]" style={{ color: 'var(--muted)' }}><Lock className="h-3.5 w-3.5" aria-hidden /> Your information is kept private and secure.</p>
        </VisitShell>
    );
};

// ── v3 — NEW: CancelGateView ──────────────────────────────────────────────
// Folds the standalone /cancel/[tenantId]/[appointmentId] page's flow into
// the unified check-in link. Reuses the exact same /api/appointments/
// self-cancel route (GET for fee preview, POST to actually cancel) — no
// server-side changes needed, just a client-side entry point that doesn't
// require a separate URL/token. tenantId and appointmentId are both already
// resolved on this page by the time a client reaches the arrival screen
// (appointmentData.id is the appointmentId — it's on every appointment doc,
// including the mirrored appointmentCheckIns copy this page reads from).
export const CLIENT_REASON_OPTIONS = [
    { value: 'schedule_conflict', label: 'Schedule conflict' },
    { value: 'changed_mind', label: 'Changed my mind' },
    { value: 'found_alternative', label: 'Found another option' },
    { value: 'price_concern', label: 'Price' },
    { value: 'health_or_childcare', label: 'Health or childcare' },
    { value: 'other', label: 'Other' },
];

export const CancelGateView = ({
    tenantId,
    appointmentId,
    onBack,
    accessKey,
    brand,
}: {
    tenantId: string;
    appointmentId: string;
    onBack: () => void;
    /** This page's visit token — proves it's their own link. */
    accessKey: string;
    brand: VisitBrand;
}) => {
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [details, setDetails] = useState<any>(null);
    const [reason, setReason] = useState('schedule_conflict');
    const [useGrace, setUseGrace] = useState(false); // their late-cancellation grace, if the business allows it online
    const [scope, setScope] = useState<'one' | 'series'>('one'); // a repeat series: this visit, or this and all later ones
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [result, setResult] = useState<any>(null);

    useEffect(() => {
        if (!tenantId || !appointmentId) return;
        // v9 — truthful errors: tell the difference between "the studio's
        // cancellation service isn't deployed" and "this appointment can't
        // be canceled" instead of one vague message for everything.
        fetch(`/api/appointments/self-cancel?tenantId=${tenantId}&appointmentId=${appointmentId}&k=${encodeURIComponent(accessKey)}`)
            .then(async (res) => {
                let data: any = null;
                try { data = await res.json(); } catch {
                    setError(res.status === 404
                        ? 'Online cancellation isn’t available right now. Please try again in a moment.'
                        : `Something went wrong on our end (${res.status}). Please try again in a moment.`);
                    return;
                }
                if (!data.ok) { setError(data.error || 'This appointment could not be found.'); setDetails(data); return; }
                setDetails(data);
            })
            .catch(() => setError('We couldn’t connect. Please check your signal and try again.'))
            .finally(() => setIsLoading(false));
    }, [tenantId, appointmentId]);

    const [undoing, setUndoing] = useState(false); const [undoErr, setUndoErr] = useState<string | null>(null);
    // Loading problems replace the screen; a cancel that doesn't go through is said on the form, so they can try again.
    const [submitErr, setSubmitErr] = useState<string | null>(null);
    const handleCancel = async () => {
        setIsSubmitting(true);
        setSubmitErr(null);
        try {
            const res = await fetch('/api/appointments/self-cancel', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tenantId, appointmentId, clientReason: reason, k: accessKey, useGrace: useGrace && !!details?.grace, ...(details?.series?.later ? { scope } : {}) }),
            });
            const data = await res.json();
            if (!data.ok) { setSubmitErr(data.error || 'We couldn’t cancel this appointment. Please try again.'); return; }
            setResult(data);
        } catch {
            setSubmitErr('We couldn’t connect. Please try again.');
        } finally {
            setIsSubmitting(false);
        }
    };

    const atOf = (iso?: string | null) => (iso ? wallDate(safeDate(iso), brand.zone) : null);
    if (isLoading) {
        return <VisitShell brand={brand} title={<>Cancel your <b>appointment</b>?</>}><VisitMuted>Getting your appointment…</VisitMuted></VisitShell>;
    }

    if (error && !result) {
        return (
            <VisitShell brand={brand} title={<>We couldn’t <b>cancel</b> it here</>}>
                <VisitCard tone="warn"><p className="text-[15px]">{error}</p></VisitCard>
                <VisitButton quiet onClick={onBack}>Back</VisitButton>
            </VisitShell>
        );
    }

    const was = atOf(details?.appointment?.startTime);
    if (result?.undone) {
        return (
            <VisitShell brand={brand} chip="Booked" kicker={<VisitCheck />} title={<>You’re <b>still booked</b></>}>
                <VisitCard tone="ok"><p className="text-[15px]">We’ve undone your cancellation, so your {details?.appointment?.serviceName || 'appointment'}{was ? `, ${format(was, 'EEEE, MMMM d')} at ${format(was, 'h:mm a')},` : ''} is still booked. We’ve sent you a confirmation, and we look forward to seeing you.</p></VisitCard>
                <VisitButton quiet onClick={onBack}>Back</VisitButton>
            </VisitShell>
        );
    }

    if (result) {
        const undoBy = atOf(result.undoUntil);
        return (
            <VisitShell brand={brand} chip="Canceled" title={<>You’re <b>canceled</b></>} subtitle={result.alreadyCancelled ? 'This appointment was already canceled.' : undefined}>
                {!result.alreadyCancelled && <VisitCard tone="ok">
                    {Array.isArray(result.lines) && result.lines.length ? result.lines.map((l: string) => <p key={l} className="text-[15px]">{l}</p>)
                        : <p className="text-[15px]">{result.feeCharged ? `Because this was within ${details?.windowHours} hours of your appointment, our cancellation fee of $${Number(result.feeAmount).toFixed(2)} applies.` : 'There’s no cancellation fee. Thank you for letting us know in advance.'}</p>}
                </VisitCard>}
                {(Number(result.laterCancelled) > 0 || result.depositMovedTo) && <VisitCard tone="ok">
                    {Number(result.laterCancelled) > 0 && <p className="text-[15px]">Your {result.laterCancelled} later visit{result.laterCancelled === 1 ? ' is' : 's are'} canceled too, with no fees.</p>}
                    {result.depositMovedTo && <p className="text-[15px]">Your deposit has moved to your next visit.</p>}
                </VisitCard>}
                {undoBy && Date.parse(result.undoUntil) > Date.now() && <VisitCard>
                    <p className="text-[16px] font-semibold">Changed your mind?</p>
                    <VisitMuted>No problem. You can undo this until {format(undoBy, 'h:mm a')}, as long as the time hasn’t been booked by someone else.</VisitMuted>
                    <VisitSaid text={undoErr} />
                    <VisitButton disabled={undoing} onClick={async () => {
                        setUndoing(true); setUndoErr(null);
                        try { const r = await fetch('/api/appointments/undo-cancel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, appointmentId, k: accessKey }) }).then((x) => x.json());
                            if (r.ok) setResult({ ...result, undone: true }); else setUndoErr(r.error || 'That didn’t work. Please reply to your confirmation message, and we’ll be glad to help.'); }
                        catch { setUndoErr('We couldn’t connect. Please try again.'); } finally { setUndoing(false); }
                    }}>{undoing ? 'Undoing…' : 'Undo and keep my appointment'}</VisitButton>
                </VisitCard>}
                {brand.bookHref && <VisitButton href={brand.bookHref}>Book another time</VisitButton>}
            </VisitShell>
        );
    }

    const g = details?.grace || null; const graced = useGrace && !!g;
    const lines: string[] = graced ? (g.lines || []) : Array.isArray(details?.preview?.lines) ? details.preview.lines : [];
    const owes = graced ? Number(g.due) > 0 : Number(details?.preview?.due) > 0 || Number(details?.preview?.fee) > 0 || !!details?.isLate;
    const blocked = !!details?.feeBlock && !(graced && Number(g?.due) === 0);
    const sameDay = was && wallDate(new Date(), brand.zone).toDateString() === was.toDateString();
    return (
        <VisitShell brand={brand} title={was ? <>Cancel your <b>{format(was, 'h:mm a')}</b> {sameDay ? 'today' : `on ${format(was, 'EEEE')}`}?</> : <>Cancel your <b>appointment</b>?</>}
            subtitle={[details?.appointment?.serviceName, was && !sameDay ? format(was, 'MMMM d') : ''].filter(Boolean).join(' · ') || undefined}>
            <VisitCard tone={owes ? 'warn' : 'ok'}>
                {lines.length ? lines.map((l) => <p key={l} className="text-[15px] leading-relaxed">{l}</p>)
                    : details?.isLate ? <p className="text-[15px] leading-relaxed">It’s within {details.windowHours} hours of your appointment, so our cancellation fee of ${Number(details.estimatedFee).toFixed(2)} would apply.</p>
                    : <p className="text-[15px] leading-relaxed">There’s no cancellation fee. Thank you for letting us know in advance.</p>}
                {!graced && details?.unpaidLine && <VisitMuted>{details.unpaidLine}</VisitMuted>}
                {details?.cancellationPolicyText && <VisitMuted>{details.cancellationPolicyText}</VisitMuted>}
            </VisitCard>
            {g && <VisitCard>
                <VisitCheckRow checked={useGrace} onChange={setUseGrace}>You have {g.remaining} grace cancellation{g.remaining === 1 ? '' : 's'} left (every {g.periodMonths} months). Use one now: {String(g.permitLabel || '').toLowerCase()}.</VisitCheckRow>
            </VisitCard>}
            {Number(details?.series?.later) > 0 && <VisitCard>
                <p className="text-[15px] font-semibold">This is part of a repeat booking</p>
                <VisitChoice cols={2} value={scope} onChange={setScope as any} options={[['one', 'This visit only'], ['series', `This and all later visits (${details.series.later})`]]} />
                {scope === 'series' && <VisitMuted>Your {details.series.later} later visit{details.series.later === 1 ? '' : 's'} will be canceled too, with no fee for {details.series.later === 1 ? 'it' : 'them'}.</VisitMuted>}
                {scope === 'one' && details.series.depositMoves && !details?.isLate && <VisitMuted>Your deposit moves to your next visit.</VisitMuted>}
            </VisitCard>}
            <section aria-label="Reason">
                <VisitLabel>Reason (optional)</VisitLabel>
                <VisitSelect label="Reason for canceling" value={reason} onChange={setReason} options={CLIENT_REASON_OPTIONS} />
            </section>
            {blocked && <VisitCard tone="warn"><p className="text-[15px]">{details.feeBlock}</p></VisitCard>}
            <VisitSaid text={submitErr} />
            <VisitButton onClick={onBack}>Keep my appointment</VisitButton>
            <VisitButton danger onClick={handleCancel} disabled={isSubmitting || blocked}>{isSubmitting ? 'Canceling…' : 'Cancel my appointment'}</VisitButton>
        </VisitShell>
    );
};


// "Ask us to move it" — when the change limit needs the team's OK. Sends one
// request (with an optional note) through /api/appt → the team is notified.
export const AskToMove = ({ apptApi }: { apptApi: (p: any) => Promise<any> }) => {
    const [note, setNote] = useState(''); const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle'); const [msg, setMsg] = useState('');
    if (state === 'sent') return <VisitCard tone="ok"><p className="text-[15px]">{msg || 'Thank you. We’ll get back to you soon.'}</p></VisitCard>;
    return (
        <VisitCard>
            <VisitLabel>Ask us to reschedule</VisitLabel>
            <VisitInput multiline label="When would suit you?" value={note} onChange={(v) => setNote(v.slice(0, 300))} placeholder="When would suit you? (optional) For example, any weekday after 3:00 PM" />
            <VisitSaid text={state === 'error' ? msg : null} />
            <VisitButton disabled={state === 'sending'} onClick={async () => {
                setState('sending');
                try { const d = await apptApi({ action: 'request_change', note }); if (d.ok) { setMsg(d.alreadyAsked ? 'We already have your request, and we’ll be in touch soon.' : 'Thank you. We’ll get back to you soon.'); setState('sent'); } else { setMsg(d.error || 'That didn’t send. Please try again.'); setState('error'); } }
                catch { setMsg('That didn’t send. Please try again.'); setState('error'); }
            }}>{state === 'sending' ? 'Sending…' : 'Send my request'}</VisitButton>
        </VisitCard>
    );
};

// v8 — RESCHEDULE FLOW. "Need a different time?" on the arrival screen
// lands here. Uses the conflict-checked self-serve engine (/api/appt,
// action 'reschedule'): same provider, live calendar check, studio's
// change-window policy enforced server-side. Auth = this page's own
// checkInToken (the /api/appt engine accepts it alongside manageToken).
export const RescheduleGateView = ({
    tenantId,
    appointmentId,
    k,
    onBack,
    brand,
}: {
    tenantId: string;
    appointmentId: string;
    k: string;
    onBack: () => void;
    brand: VisitBrand;
}) => {
    const [isLoading, setIsLoading] = useState(true);
    const [useGrace, setUseGrace] = useState(false);
    const [slotDays, setSlotDays] = useState<{ date: string; times: string[] }[] | null>(null); // real open times
    const [error, setError] = useState<string | null>(null);
    const [info, setInfo] = useState<any>(null);
    const [newDate, setNewDate] = useState('');
    const [newTime, setNewTime] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [result, setResult] = useState<any>(null);

    const apptApi = async (payload: any) => {
        const res = await fetch('/api/appt', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tenantId, apptId: appointmentId, k, ...payload }),
        });
        try { return await res.json(); } catch {
            throw new Error(res.status === 404
                ? 'Rescheduling isn’t available online for this appointment, but you can ask us to reschedule it below.'
                : `Something went wrong on our end (${res.status}). Please try again in a moment.`);
        }
    };

    useEffect(() => {
        (async () => {
            try {
                const d = await apptApi({ action: 'view' });
                if (!d.ok) { setError(d.error || 'We couldn’t load this appointment.'); return; }
                setInfo(d);
                const sl = await apptApi({ action: 'slots', from: d?.policy?.earliestDate || undefined, days: 14 }).catch(() => null);
                setSlotDays(sl?.ok ? (sl.days || []).filter((x: any) => (x.times || []).length) : []);
            } catch (e: any) { setError(e?.message || 'Something went wrong loading your appointment.'); }
            finally { setIsLoading(false); }
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tenantId, appointmentId, k]);


    const handleReschedule = async () => {
        if (!newDate || !newTime || isSubmitting) return;
        setIsSubmitting(true); setError(null);
        try {
            // WALL CLOCK UP, INSTANT BACK. This used to glue a FIXED offset
            // suffix onto the picked time in the browser — and a fixed offset
            // is EST, so from March to November every rescheduled appointment
            // landed an hour late in the planner. Only the server knows the
            // studio's zone and whether daylight saving applies on the chosen
            // date, so only the server should build the moment.
            const d = await apptApi({ action: 'reschedule', newDate, newTime, useGrace });
            if (!d.ok) { setError(d.error || 'We couldn’t move the appointment. Please try another time.'); return; }
            setResult(d);
        } catch (e: any) { setError(e?.message || 'Something went wrong. Please try again.'); }
        finally { setIsSubmitting(false); }
    };

    const clockLabel = (t: string) => { const [h, m] = t.split(':').map(Number); return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`; };
    if (isLoading) {
        return <VisitShell brand={brand} title={<>Choose a <b>new time</b></>}><VisitMuted>Getting your appointment…</VisitMuted></VisitShell>;
    }
    if (result) {
        return (
            <VisitShell brand={brand} chip="Booked" kicker={<VisitCheck />} title={<>You’re <b>rescheduled</b></>} subtitle={`We look forward to seeing you ${result.whenLabel || 'then'}.`}>
                <VisitCard tone="ok"><p className="text-[15px]">Thank you. Our calendar is updated, and your reminders will follow the new time. You can use this same link as your visit link on the day.</p></VisitCard>
                <VisitButton onClick={onBack}>Done</VisitButton>
            </VisitShell>
        );
    }
    if (error && !info) {
        return (
            <VisitShell brand={brand} title={<>We couldn’t <b>reschedule</b> it here</>}>
                <VisitCard tone="warn"><p className="text-[15px]">{error}</p></VisitCard>
                <VisitButton quiet onClick={onBack}>Back</VisitButton>
            </VisitShell>
        );
    }
    const canChange = (info?.policy?.canReschedule ?? info?.policy?.canChange) !== false;
    const cutoffHours = info?.policy?.rescheduleCutoffHours ?? info?.policy?.cancelHours;
    const dayTimes = (slotDays || []).find((x) => x.date === newDate)?.times || [];
    return (
        <VisitShell brand={brand} title={<>Choose a <b>new time</b></>} subtitle={[info?.appt?.serviceName, info?.appt?.staffName ? `with ${String(info.appt.staffName).split(' ')[0]}` : ''].filter(Boolean).join(' · ') || undefined}>
            {info?.appt?.whenLabel && <p className="v-note">Booked now for {info.appt.whenLabel}.</p>}
            {!canChange && <VisitCard tone="warn"><p className="text-[15px]">{info?.policy?.changeRule?.reason || `Online rescheduling closes ${cutoffHours} hours before your appointment.`}</p></VisitCard>}
            {canChange && Number(info?.policy?.rescheduleFee) > 0 && (
                <VisitCard tone="warn">
                    <p className="text-[15px]">{useGrace ? <>Because you’re using your grace allowance, there’s <b>no reschedule fee</b> this time.</> : <>Because it’s within {info.policy.rescheduleFeeWindowHours} hours of your appointment, our <b>${Number(info.policy.rescheduleFee).toFixed(2)}</b> rescheduling fee applies. It’s charged to your card on file when you confirm.</>}</p>
                    {!useGrace && info?.policy?.unpaidLine && <VisitMuted>{info.policy.unpaidLine}</VisitMuted>}
                    {info?.policy?.graceAvailable && <VisitCheckRow checked={useGrace} onChange={setUseGrace}>You have {info.policy.graceAvailable.remaining} grace reschedule{info.policy.graceAvailable.remaining === 1 ? '' : 's'} left (every {info.policy.graceAvailable.periodMonths} months). Use one to reschedule for free.</VisitCheckRow>}
                </VisitCard>
            )}
            {!canChange && (info?.policy?.changeRule?.canRequest ?? info?.policy?.changeRule?.needsApproval) ? <AskToMove apptApi={apptApi} />
            : canChange ? <>
                <VisitCard>
                    <VisitLabel>Choose a day</VisitLabel>
                    {slotDays === null ? <VisitMuted>Finding open times…</VisitMuted>
                        : slotDays.length === 0 ? <VisitMuted>There are no open times online in the next two weeks.{brand.bookHref ? ' You can look further ahead on our booking page.' : ''}</VisitMuted>
                        : <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">{slotDays.map((x) => { const on = x.date === newDate; const d = safeDate(`${x.date}T12:00:00`);
                            return <button key={x.date} type="button" aria-pressed={on} onClick={() => { setNewDate(x.date); setNewTime(''); }} className="min-w-[4.5rem] shrink-0 rounded-2xl px-3 py-2 text-center transition active:scale-[.98]"
                                style={on ? { background: 'var(--accent)', color: '#fff' } : { background: 'var(--card)', color: 'var(--ink)', boxShadow: 'inset 0 0 0 1px var(--line)' }}>
                                <span className="block text-[12px]">{format(d, 'EEE')}</span><span className="block text-[17px] font-semibold">{format(d, 'd')}</span><span className="block text-[11px]">{format(d, 'MMM')}</span></button>; })}</div>}
                    {newDate && <>
                        <VisitLabel>Choose a time</VisitLabel>
                        <div className="grid grid-cols-3 gap-2">{dayTimes.map((tm) => { const on = tm === newTime;
                            return <button key={tm} type="button" aria-pressed={on} onClick={() => setNewTime(tm)} className="h-11 rounded-full text-[14px] transition active:scale-[.98]"
                                style={on ? { background: 'var(--accent)', color: '#fff', fontWeight: 600 } : { background: 'var(--card)', color: 'var(--ink)', boxShadow: 'inset 0 0 0 1px var(--line)' }}>{clockLabel(tm)}</button>; })}</div>
                    </>}
                </VisitCard>
                <VisitSaid text={error} />
                <VisitButton onClick={handleReschedule} disabled={isSubmitting || !newDate || !newTime}>{isSubmitting ? 'Rescheduling…' : newDate && newTime ? `Reschedule to ${format(safeDate(`${newDate}T12:00:00`), 'EEE, MMM d')} at ${clockLabel(newTime)}` : 'Choose a day and time'}</VisitButton>
            </> : null}
            <VisitButton quiet onClick={onBack}>Keep my current time</VisitButton>
        </VisitShell>
    );
};

