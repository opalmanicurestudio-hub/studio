'use client';
// src/components/booking/DayOfView.tsx — the client's visit link, ON THE DAY.
import React, { useState } from 'react';
import { format } from 'date-fns';
import { PublicFrame } from '@/components/public/kit';

const safeDate = (v: any): Date => { try { const d = v?.toDate ? v.toDate() : new Date(v); return isNaN(d.getTime()) ? new Date() : d; } catch { return new Date(); } };
// ── YOUR VISIT, ON THE DAY (Studio look) ───────────────────────────────────
// One calm screen: when and where, "I'm here", on my way, running late (with
// the business's grace period answered straight back and "Reschedule instead"
// when it's past it), optional trip sharing (distance only; ends at check-in),
// and the ways to change it. Replaces the old "Enter Studio / Portal Active" screens.
const LATE_CHOICES = [5, 10, 15, 20, 30, 45];
export const DayOfView = ({ accent, studioName, first, serviceName, startTime, provider, address, graceMinutes, onArrived, onMyWay, onLate, onReschedule, onCancel, portalHref, onNotifications, trip, reply, status, lateMinutes, etaAt }: {
    accent: string; studioName?: string; first: string; serviceName?: string; startTime?: string; provider?: { name?: string; avatarUrl?: string } | null; address?: string | null; graceMinutes: number;
    onArrived: () => Promise<any>; onMyWay: () => Promise<any>; onLate: (mins: number, note: string) => Promise<any>;
    onReschedule?: () => void; onCancel?: () => void; portalHref?: string | null; onNotifications?: () => void;
    trip: { tenantId: string; token: string; appointmentId: string } | null;
    /** What the studio decided after they said they're running late — shown live. */
    reply?: { kind: string; message: string; at?: string } | null;
    /** What they've already told us (from the live booking) — so the screen remembers. */
    status?: string | null; lateMinutes?: number | null; etaAt?: string | null;
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
    const askedToMove = reply?.kind === 'move';
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
                    {address && <p className="text-[14px]" style={{ color: 'var(--muted)' }}>{address} · <a className="underline underline-offset-2" style={{ color: 'var(--ink)' }} target="_blank" rel="noreferrer" href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`}>Directions</a></p>}
                </section>
                {reply?.message && <section className="pub-card space-y-3 p-5" style={askedToMove ? { boxShadow: 'inset 0 0 0 2px var(--accent)' } : undefined} aria-live="polite">
                    <p className="text-[13px] font-semibold" style={{ color: 'var(--accent)' }}>{askedToMove ? 'Let’s find a new time' : `A message from ${studioName || 'us'}`}</p>
                    <p className="text-[15px]">{reply.message}</p>
                    {askedToMove && onReschedule && <button type="button" className={`${btn} font-semibold text-white`} style={{ background: 'var(--accent)' }} onClick={onReschedule}>Choose a new time</button>}
                </section>}
                {!askedToMove && status === 'running_late' && !said && <section className="pub-card p-5"><p className="text-[15px]">You told us you’re about <b>{Number(lateMinutes) || '?'} minutes</b> late{etaAt ? <> — arriving about <b>{format(safeDate(etaAt), 'h:mm a')}</b></> : null}. {provider?.name ? provider.name.split(' ')[0] : 'The team'} knows.</p></section>}
                {!askedToMove && status === 'on_my_way' && !said && <section className="pub-card p-5"><p className="text-[15px]">You’re on your way — {provider?.name ? provider.name.split(' ')[0] : 'the team'} knows.</p></section>}
                {!askedToMove && <section className="space-y-2">
                    {confirmHere ? (
                        <div className="pub-card space-y-2 p-4"><p className="text-[15px]">Looks like you’re about {dist} km away — check in anyway?</p>
                            <div className="grid grid-cols-2 gap-2"><button type="button" disabled={busy} className={`${btn} font-semibold text-white`} style={{ background: 'var(--accent)' }} onClick={async () => { setBusy(true); if (sharing) await stopTrip(true); await onArrived(); setBusy(false); }}>Yes, I’m here</button>
                                <button type="button" className={`${btn} bg-white shadow-sm`} onClick={() => setConfirmHere(false)}>Not yet</button></div></div>
                    ) : <button type="button" disabled={busy} className={`${btn} font-semibold text-white shadow-sm`} style={{ background: 'var(--accent)' }}
                        onClick={async () => { if (dist != null && dist > 1) { setConfirmHere(true); return; } setBusy(true); if (sharing) await stopTrip(true); await onArrived(); setBusy(false); }}>{busy ? 'Checking you in…' : 'I’m here'}</button>}
                    <div className="grid grid-cols-2 gap-2">
                        <button type="button" disabled={busy || status === 'on_my_way'} aria-pressed={status === 'on_my_way'} className={`${btn} bg-white shadow-sm`}
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
                {trip && !askedToMove && <section className="pub-card space-y-2 p-5">
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
