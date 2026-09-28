'use client';
// src/components/booking/DayOfView.tsx — the client's visit link, ON THE DAY.
import type { ServicePlace } from '@/lib/service-place';
import React, { useState } from 'react';
import { format } from 'date-fns';
import { PublicFrame } from '@/components/public/kit';
import { DisruptionCard } from '@/components/booking/DisruptionCard';

const safeDate = (v: any): Date => { try { const d = v?.toDate ? v.toDate() : new Date(v); return isNaN(d.getTime()) ? new Date() : d; } catch { return new Date(); } };
// ── YOUR VISIT, ON THE DAY (Studio look) ───────────────────────────────────
// One calm screen: when and where, "I'm here", on my way, running late (with
// the business's grace period answered straight back and "Reschedule instead"
// when it's past it), optional trip sharing (distance only; ends at check-in),
// and the ways to change it. Replaces the old "Enter Studio / Portal Active" screens.
const LATE_CHOICES = [5, 10, 15, 20, 30, 45];
export const DayOfView = ({ place, callNumber, lateChoices, onLateChoice, accent, studioName, first, serviceName, startTime, provider, address, graceMinutes, onArrived, onMyWay, onLate, onReschedule, onCancel, portalHref, onNotifications, trip, reply, status, lateMinutes, etaAt, selfCheckIn = true, providerDelay, onProviderReply, providerOffer, onOfferReply, disruption, hasDeposit, onDisruptionCancel }: {
    /** Where it happens — online (with a link) or at the client's place skip check-in, directions and trips. */
    place?: ServicePlace | null;
    /** Their number to call, for "they call us" phone appointments. */
    callNumber?: string | null;
    /** Running late past the grace time — the options we sent them. */
    lateChoices?: { status?: string; choice?: string | null; options?: string[]; dropNames?: string[]; toStaffName?: string | null; etaAt?: string } | null;
    onLateChoice?: (choice: 'condense' | 'switch' | 'reschedule') => Promise<any>;
    accent: string; studioName?: string; first: string; serviceName?: string; startTime?: string; provider?: { name?: string; avatarUrl?: string } | null; address?: string | null; graceMinutes: number;
    onArrived: () => Promise<any>; onMyWay: () => Promise<any>; onLate: (mins: number, note: string) => Promise<any>;
    onReschedule?: () => void; onCancel?: () => void; portalHref?: string | null; onNotifications?: () => void;
    trip: { tenantId: string; token: string; appointmentId: string } | null;
    /** What the studio decided after they said they're running late — shown live. */
    reply?: { kind: string; message: string; at?: string } | null;
    /** What they've already told us (from the live booking) — so the screen remembers. */
    status?: string | null; lateMinutes?: number | null; etaAt?: string | null;
    /** The business allows online self check-in (Booking policies). Off → front desk. */
    selfCheckIn?: boolean;
    /** Their provider is running late — they choose: keep, reschedule or cancel (no fee). */
    providerDelay?: { minutes: number; newStartAt: string; reply?: string | null } | null;
    onProviderReply?: (choice: 'keep' | 'cancel') => Promise<any>;
    /** We offered another provider — they accept or decline. */
    providerOffer?: { toStaffName?: string | null; fromStaffName?: string | null; startAt: string; status: string } | null;
    onOfferReply?: (choice: 'accept' | 'decline') => Promise<any>;
    /** A provider callout / business interruption — they choose a new time or cancel (no fee). */
    disruption?: { kind: string; reasonLabel?: string | null; status?: string } | null; hasDeposit?: boolean;
    onDisruptionCancel?: (deposit: 'refund' | 'credit' | null) => Promise<any>;
}) => {
    const [lateOpen, setLateOpen] = useState(false); const [mins, setMins] = useState<number | null>(null); const [note, setNote] = useState('');
    const [said, setSaid] = useState<string | null>(null); const [past, setPast] = useState(false); const [busy, setBusy] = useState(false);
    const [sharing, setSharing] = useState(false); const [tripMsg, setTripMsg] = useState<string | null>(null);
    const [dist, setDist] = useState<number | null>(null); const [confirmHere, setConfirmHere] = useState(false); const [tripNudge, setTripNudge] = useState(false);
    const watchRef = React.useRef<number | null>(null); const lastSent = React.useRef(0);
    const sendTrip = async (body: any) => { if (!trip) return null; try { const r = await fetch('/api/checkins', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...trip, ...body }) }); return await r.json(); } catch { return null; } };
    const stopTrip = async (silent = false) => { if (watchRef.current !== null && typeof navigator !== 'undefined') navigator.geolocation?.clearWatch(watchRef.current); watchRef.current = null; setSharing(false); if (!silent) setTripMsg('Stopped sharing.'); await sendTrip({ trip: null }); };
    const startTrip = () => {
        if (typeof navigator === 'undefined' || !navigator.geolocation) { setTripMsg('Your phone can’t share location here.'); return; }
        setSharing(true); setTripMsg('Sharing how far away you are…');
        watchRef.current = navigator.geolocation.watchPosition(async (pos) => {
            if (Date.now() - lastSent.current < 45000) return; lastSent.current = Date.now();
            const d = await sendTrip({ trip: { lat: pos.coords.latitude, lng: pos.coords.longitude } });
            if (d?.distanceKm != null) setDist(Number(d.distanceKm));
            if (d?.distanceKm != null) setTripMsg(`We can see you’re about ${d.distanceKm} km away${d.etaMin ? ` (~${d.etaMin} min)` : ''}. Only the distance is shared — it stops when you check in.`);
        }, () => { setSharing(false); setTripMsg('Location is off — that’s fine, we’ll see you soon.'); }, { enableHighAccuracy: false, maximumAge: 30000, timeout: 20000 });
    };
    React.useEffect(() => () => { if (watchRef.current !== null && typeof navigator !== 'undefined') navigator.geolocation?.clearWatch(watchRef.current); }, []);
    const askedToMove = reply?.kind === 'move' || disruption?.status === 'pending';
    const isStudio = !place || place.kind === 'studio';
    const [lcBusy, setLcBusy] = useState<string | null>(null); const [lcMsg, setLcMsg] = useState<string | null>(null);
    const lcOpen = lateChoices?.status === 'sent' && !lateChoices.choice;
    const pickLate = async (c: 'condense' | 'switch' | 'reschedule') => { if (!onLateChoice) return; setLcBusy(c); const d = await onLateChoice(c); setLcBusy(null);
        if (!d?.ok) { setLcMsg(d?.error || 'That didn’t go through — please try again.'); return; }
        setLcMsg(c === 'condense' ? 'Thanks — we’ll do a shorter visit so you finish on time.' : c === 'switch' ? (d.accepted ? `Done — ${String(lateChoices?.toStaffName || 'our team').split(' ')[0]} will see you.` : d.error || 'That time has just gone — we’ll be in touch.') : 'Pick a new time below.'); };
    const [pdBusy, setPdBusy] = useState<string | null>(null); const [pdMsg, setPdMsg] = useState<string | null>(null); const [pdConfirmCancel, setPdConfirmCancel] = useState(false);
    const pdOpen = !!providerDelay && !providerDelay.reply;
    const [poBusy, setPoBusy] = useState<string | null>(null); const [poMsg, setPoMsg] = useState<string | null>(null);
    const poOpen = providerOffer?.status === 'pending';
    const poTime = providerOffer?.startAt ? format(safeDate(providerOffer.startAt), 'h:mm a') : '';
    const poWho = String(providerOffer?.toStaffName || 'Another of our team').split(' ')[0];
    const poSend = async (c: 'accept' | 'decline') => { if (!onOfferReply) return; setPoBusy(c); const d = await onOfferReply(c); setPoBusy(null);
        setPoMsg(d?.ok ? (c === 'accept' ? `Done — ${poWho} will see you at ${poTime}.` : 'No problem — we’ll be in touch with what happens next.') : (d?.error || 'That didn’t send — please try again.')); };
    const pdTime = providerDelay?.newStartAt ? format(safeDate(providerDelay.newStartAt), 'h:mm a') : '';
    const pdSend = async (c: 'keep' | 'cancel') => { if (!onProviderReply) return; setPdBusy(c); const d = await onProviderReply(c); setPdBusy(null);
        setPdMsg(d?.ok ? (c === 'keep' ? `Thanks — we’ll see you around ${pdTime}.${Number(d.creditCents) > 0 ? ` We’ve added $${(Number(d.creditCents) / 100).toFixed(2)} credit to your account as a thank-you.` : ''}` : `Cancelled — no fee.${d.depositRefund ? ' Your deposit will be returned.' : ''}`) : (d?.error || 'That didn’t send — please try again.')); };
    // We've asked them to choose a new time → stop sharing the trip.
    React.useEffect(() => { if (askedToMove && watchRef.current !== null) stopTrip(true); }, [askedToMove]); // eslint-disable-line react-hooks/exhaustive-deps
    const when = startTime ? format(safeDate(startTime), 'EEEE · h:mm a') : '';
    const btn = 'inline-flex h-12 w-full items-center justify-center rounded-full px-6 text-[15px] transition active:scale-[.98] disabled:opacity-60';
    return (
        <PublicFrame accent={accent}>
            <main className="mx-auto max-w-md space-y-4 px-4 py-8 pub-safe-bottom">
                <header className="pub-rise space-y-1 px-1">
                    <p className="text-[13px] font-semibold tracking-wide" style={{ color: 'var(--accent)' }}>{studioName || 'Your visit'}</p>
                    <h1 className="text-4xl">Hi <b>{first}</b></h1>
                    <p className="text-[15px]" style={{ color: 'var(--muted)' }}>Your visit today</p>
                </header>
                <section className="pub-card pub-rise space-y-3 p-5">
                    <p className="text-[18px] font-semibold">{serviceName || 'Your appointment'}</p>
                    <p className="text-[15px]" style={{ color: 'var(--muted)' }}>{when}</p>
                    {provider?.name && <div className="flex items-center gap-3">{provider.avatarUrl ? <img src={provider.avatarUrl} alt="" className="h-10 w-10 rounded-full object-cover" /> : <span className="flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold text-white" style={{ background: 'var(--accent)' }}>{provider.name.slice(0, 1)}</span>}<p className="text-[15px]">with <b>{provider.name.split(' ')[0]}</b></p></div>}
                    {address && isStudio && <p className="text-[14px]" style={{ color: 'var(--muted)' }}>{address} · <a className="underline underline-offset-2" style={{ color: 'var(--ink)' }} target="_blank" rel="noreferrer" href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`}>Directions</a></p>}
                </section>
                {lateChoices && (lcOpen || lcMsg) && onLateChoice && <section className="pub-card space-y-3 p-5" style={{ boxShadow: 'inset 0 0 0 2px var(--accent)' }} aria-live="polite">
                    <p className="text-[13px] font-semibold" style={{ color: 'var(--accent)' }}>Your options for today</p>
                    {lcMsg ? <p className="text-[15px]">{lcMsg}</p> : <>
                        <p className="text-[15px]">You’re running past our grace time, so your full visit won’t fit. Choose what works for you:</p>
                        {(lateChoices.options || []).includes('condense') && <button type="button" disabled={!!lcBusy} className={`${btn} font-semibold text-white`} style={{ background: 'var(--accent)' }} onClick={() => pickLate('condense')}>{lcBusy === 'condense' ? 'Saving…' : `Shorter visit today${lateChoices.dropNames?.length ? ` (without ${lateChoices.dropNames.join(' and ')})` : ''}`}</button>}
                        {(lateChoices.options || []).includes('switch') && <button type="button" disabled={!!lcBusy} className={`${btn} bg-white shadow-sm`} style={{ border: '1px solid #e7e2dc' }} onClick={() => pickLate('switch')}>{lcBusy === 'switch' ? 'Saving…' : `See ${String(lateChoices.toStaffName || 'another of our team').split(' ')[0]}${lateChoices.etaAt ? ` at ${format(safeDate(lateChoices.etaAt), 'h:mm a')}` : ''}`}</button>}
                        {onReschedule && <button type="button" disabled={!!lcBusy} className={`${btn} bg-white shadow-sm`} style={{ border: '1px solid #e7e2dc' }} onClick={async () => { await pickLate('reschedule'); onReschedule(); }}>Pick a new time</button>}
                    </>}
                </section>}
                {onDisruptionCancel && <DisruptionCard disruption={disruption} hasDeposit={!!hasDeposit} onReschedule={onReschedule} onCancel={onDisruptionCancel} />}
                {providerOffer && (poOpen || poMsg) && <section className="pub-card space-y-3 p-5" style={{ boxShadow: 'inset 0 0 0 2px var(--accent)' }} aria-live="polite">
                    <p className="text-[13px] font-semibold" style={{ color: 'var(--accent)' }}>Another option for today</p>
                    {poMsg ? <p className="text-[15px]">{poMsg}</p> : <>
                        <p className="text-[15px]">To fit you in, <b>{poWho}</b> can see you at <b>{poTime}</b>{providerOffer.fromStaffName ? <> instead of {String(providerOffer.fromStaffName).split(' ')[0]}</> : null}. Would that work?</p>
                        <div className="grid grid-cols-2 gap-2">
                            <button type="button" disabled={!!poBusy} className={`${btn} font-semibold text-white`} style={{ background: 'var(--accent)' }} onClick={() => poSend('accept')}>{poBusy === 'accept' ? 'Saving…' : 'Accept'}</button>
                            <button type="button" disabled={!!poBusy} className={`${btn} bg-white shadow-sm`} style={{ border: '1px solid #e7e2dc' }} onClick={() => poSend('decline')}>{poBusy === 'decline' ? 'Sending…' : 'No thanks'}</button>
                        </div>
                    </>}
                </section>}
                {providerDelay && (pdOpen || pdMsg) && <section className="pub-card space-y-3 p-5" style={{ boxShadow: 'inset 0 0 0 2px var(--accent)' }} aria-live="polite">
                    <p className="text-[13px] font-semibold" style={{ color: 'var(--accent)' }}>A quick update</p>
                    {pdMsg ? <p className="text-[15px]">{pdMsg}</p> : <>
                        <p className="text-[15px]">{provider?.name ? provider.name.split(' ')[0] : 'Your provider'} is running about <b>{providerDelay.minutes} minutes</b> behind, so your appointment would start around <b>{pdTime}</b>. Choose what works for you:</p>
                        <button type="button" disabled={!!pdBusy} className={`${btn} font-semibold text-white`} style={{ background: 'var(--accent)' }} onClick={() => pdSend('keep')}>{pdBusy === 'keep' ? 'Sending…' : `Keep my appointment (~${pdTime})`}</button>
                        {onReschedule && <button type="button" className={`${btn} bg-white shadow-sm`} style={{ border: '1px solid #e7e2dc' }} onClick={onReschedule}>Reschedule — no fee</button>}
                        {!pdConfirmCancel ? <button type="button" className="w-full text-center text-[14px] underline underline-offset-2" style={{ color: 'var(--muted)' }} onClick={() => setPdConfirmCancel(true)}>Cancel — no fee</button>
                          : <button type="button" disabled={!!pdBusy} className={`${btn} bg-white shadow-sm`} style={{ border: '1px solid #e7e2dc' }} onClick={() => pdSend('cancel')}>{pdBusy === 'cancel' ? 'Cancelling…' : 'Yes, cancel it (no fee)'}</button>}
                    </>}
                </section>}
                {reply?.message && <section className="pub-card space-y-3 p-5" style={askedToMove ? { boxShadow: 'inset 0 0 0 2px var(--accent)' } : undefined} aria-live="polite">
                    <p className="text-[13px] font-semibold" style={{ color: 'var(--accent)' }}>{askedToMove ? 'Let’s find a new time' : `A message from ${studioName || 'us'}`}</p>
                    <p className="text-[15px]">{reply.message}</p>
                    {askedToMove && onReschedule && <button type="button" className={`${btn} font-semibold text-white`} style={{ background: 'var(--accent)' }} onClick={onReschedule}>Choose a new time</button>}
                </section>}
                {!askedToMove && status === 'running_late' && !said && <section className="pub-card p-5"><p className="text-[15px]">You told us you’re about <b>{Number(lateMinutes) || '?'} minutes</b> late{etaAt ? <> — arriving about <b>{format(safeDate(etaAt), 'h:mm a')}</b></> : null}. {provider?.name ? provider.name.split(' ')[0] : 'The team'} knows.</p></section>}
                {!askedToMove && status === 'on_my_way' && !said && <section className="pub-card p-5"><p className="text-[15px]">You’re on your way — {provider?.name ? provider.name.split(' ')[0] : 'the team'} knows.</p></section>}
                {!askedToMove && <section className="space-y-2">
                    {place?.kind === 'online' ? (place.meetingLink
                        ? <a href={place.meetingLink} target="_blank" rel="noreferrer" className={`${btn} font-semibold text-white shadow-sm`} style={{ background: 'var(--accent)' }}>Join your appointment</a>
                        : <div className="pub-card p-4 text-center"><p className="text-[15px]">This is an online appointment — your link will be here before it starts.</p></div>)
                    : place?.kind === 'phone' ? (place.phoneWho === 'they_call'
                        ? (callNumber ? <a href={`tel:${callNumber.replace(/[^\d+]/g, '')}`} className={`${btn} font-semibold text-white shadow-sm`} style={{ background: 'var(--accent)' }}>Call us at {callNumber}</a>
                            : <div className="pub-card p-4 text-center"><p className="text-[15px]">This is a phone call — please call us at your appointment time.</p></div>)
                        : <div className="pub-card p-4 text-center"><p className="text-[15px]">This is a phone call — we’ll call you at your appointment time. Keep your phone nearby.</p></div>)
                    : place?.kind === 'client' ? <div className="pub-card p-4 text-center"><p className="text-[15px]">We’ll come to you{provider?.name ? ` — ${String(provider.name).split(' ')[0]} will let you know when they’re on the way` : ''}.</p></div>
                    : !selfCheckIn ? <div className="pub-card p-4 text-center"><p className="text-[15px]">Please check in at the front desk when you arrive.</p></div> : confirmHere ? (
                        <div className="pub-card space-y-2 p-4"><p className="text-[15px]">Looks like you’re about {dist} km away — check in anyway?</p>
                            <div className="grid grid-cols-2 gap-2"><button type="button" disabled={busy} className={`${btn} font-semibold text-white`} style={{ background: 'var(--accent)' }} onClick={async () => { setBusy(true); if (sharing) await stopTrip(true); await onArrived(); setBusy(false); }}>Yes, I’m here</button>
                                <button type="button" className={`${btn} bg-white shadow-sm`} onClick={() => setConfirmHere(false)}>Not yet</button></div></div>
                    ) : <button type="button" disabled={busy} className={`${btn} font-semibold text-white shadow-sm`} style={{ background: 'var(--accent)' }}
                        onClick={async () => { if (dist != null && dist > 1) { setConfirmHere(true); return; } setBusy(true); if (sharing) await stopTrip(true); await onArrived(); setBusy(false); }}>{busy ? 'Checking you in…' : 'I’m here'}</button>}
                    <div className="grid grid-cols-2 gap-2">
                        <button type="button" hidden={!isStudio} disabled={busy || status === 'on_my_way'} aria-pressed={status === 'on_my_way'} className={`${btn} bg-white shadow-sm`}
                            onClick={async () => { setBusy(true); const d: any = await onMyWay(); setBusy(false); if (d !== null) { setSaid(`Thanks — ${provider?.name ? provider.name.split(' ')[0] : 'the team'} knows you’re on your way.`); if (trip && !sharing) setTripNudge(true); } }}>{status === 'on_my_way' ? '✓ On my way' : 'On my way'}</button>
                        <button type="button" className={`${btn} bg-white shadow-sm`} aria-expanded={lateOpen} onClick={() => setLateOpen((v) => !v)}>{status === 'running_late' ? 'Update lateness' : 'Running late?'}</button>
                    </div>
                </section>}
                {lateOpen && !askedToMove && <section className="pub-card space-y-3 p-5">
                    <p className="text-[15px] font-semibold">About how late?</p>
                    <div className="flex flex-wrap gap-2">{LATE_CHOICES.map((m) => <button key={m} type="button" aria-pressed={mins === m} onClick={() => setMins(m)} className="h-10 rounded-full px-4 text-[14px]" style={mins === m ? { background: 'var(--accent)', color: '#fff' } : { background: '#f1ece6' }}>{m === 45 ? '45+ min' : `${m} min`}</button>)}</div>
                    <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="Anything we should know? (optional)" className="h-11 w-full rounded-xl px-3 text-[14px] outline-none" style={{ background: '#f1ece6' }} />
                    <button type="button" disabled={!mins || busy || (status === 'running_late' && mins === Number(lateMinutes))} className={`${btn} font-semibold text-white`} style={{ background: 'var(--accent)' }} onClick={async () => {
                        if (!mins) return; setBusy(true); const d = await onLate(mins, note.trim()); setBusy(false); setLateOpen(false);
                        const g = Number(d?.graceMinutes ?? graceMinutes) || 0; const over = g > 0 ? mins > g : false; setPast(over);
                        setSaid(over ? `Thanks for telling us. ${mins} minutes is past our ${g}-minute grace period, so we may need to shorten your service or move it — ${provider?.name ? provider.name.split(' ')[0] : 'we'}’ll let you know.` : `Thanks — we’ve let ${provider?.name ? provider.name.split(' ')[0] : 'the team'} know.${g > 0 ? ` We can hold your time for up to ${g} minutes.` : ''}`);
                    }}>Let them know</button>
                </section>}
                {said && !reply?.message && <section className="pub-card space-y-3 p-5"><p className="text-[15px]">{said}</p>{past && onReschedule && <button type="button" className={`${btn} bg-white shadow-sm`} style={{ border: '1px solid #e7e2dc' }} onClick={onReschedule}>Reschedule instead</button>}</section>}
                {trip && isStudio && selfCheckIn && !askedToMove && <section className="pub-card space-y-2 p-5">
                    <div className="flex items-center justify-between gap-3"><p className="text-[15px] font-semibold">Share my trip</p>
                        <button type="button" onClick={() => (sharing ? stopTrip() : startTrip())} className="h-9 rounded-full px-4 text-[14px]" style={sharing ? { background: '#f1ece6' } : { background: 'var(--accent)', color: '#fff' }}>{sharing ? 'Stop' : 'Start'}</button></div>
                    <p className="text-[13px]" style={{ color: 'var(--muted)' }}>{tripMsg || (tripNudge ? 'On your way? Tap Start and we’ll see roughly how far away you are — only the distance, and it stops when you check in.' : 'Let us see roughly how far away you are until you arrive. Only the distance is shared, and it stops when you check in.')}</p>
                </section>}
                <section className="space-y-2 px-1 pt-2 text-center text-[14px]" style={{ color: 'var(--muted)' }}>
                    {(onReschedule || onCancel) && <p>Need to change it? {onReschedule && <button type="button" className="underline underline-offset-2" onClick={onReschedule}>Reschedule</button>}{onReschedule && onCancel && ' · '}{onCancel && <button type="button" className="underline underline-offset-2" onClick={onCancel}>Cancel</button>}</p>}
                    <p>{portalHref && <a className="underline underline-offset-2" href={portalHref}>Your account</a>}{portalHref && onNotifications && ' · '}{onNotifications && <button type="button" className="underline underline-offset-2" onClick={onNotifications}>Message settings</button>}</p>
                </section>
            </main>
        </PublicFrame>
    );
};
