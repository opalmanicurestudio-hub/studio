'use client';
// src/components/booking/DayOfView.tsx — the client's visit link, ON THE DAY (ClientVisit board, "On the day").
// "Hi Dana — See you at 3:30", what and with whom, then the one thing to do next: "I'm on my way" (or "I'm here" once
// they're close), with "Running a few minutes late" beside it. Getting here (the address, parking, the way in, a
// video) from the business's own notes, the pass for the desk, and changing or canceling with until when it's free.
// Everything that can come up on the day is answered right here: running past the grace time (shorter visit, another
// provider, a new time), the provider running behind, another provider offered, a disruption, a message from the
// business, sharing the trip (distance only, ends at check-in), online and phone appointments, and visits at home.
import type { ServicePlace } from '@/lib/service-place';
import { inPerson, type PublicShape } from '@/lib/business-shape';
import type { VisitNotes } from '@/lib/studio-page';
import React, { useState } from 'react';
import { format } from 'date-fns';
import { wallDate } from '@/lib/tenant-time';
import { MessageSquare, Bell, User } from 'lucide-react';
import { DisruptionCard } from '@/components/booking/DisruptionCard';
import { VisitShell, VisitRows, VisitButton, VisitGettingHere, VisitChange, type VisitBrand } from '@/components/booking/VisitShell';

const safeDate = (v: any): Date => { try { const d = v?.toDate ? v.toDate() : new Date(v); return isNaN(d.getTime()) ? new Date() : d; } catch { return new Date(); } };
const LATE_CHOICES = [5, 10, 15, 20, 30, 45];
/** "in 2 hours", "in 25 minutes", "now" — how soon, said simply. */
const soonWords = (m: number | null) => {
    if (m === null || !Number.isFinite(m)) return '';
    if (m < -5) return '';
    if (m <= 0) return 'starting now';
    if (m < 60) return `in ${m} minute${m === 1 ? '' : 's'}`;
    if (m >= 180) return '';
    const h = Math.round(m / 30) / 2; return h === 1 ? 'in an hour' : `in ${h} hours`;
};

export const DayOfView = ({ brand, visit, freeUntil, pass, minutesAway, place, callNumber, lateChoices, onLateChoice, first, serviceName, startTime, provider, address, graceMinutes, onArrived, onMyWay, onLate, onReschedule, onCancel, portalHref, onNotifications, trip, reply, status, lateMinutes, etaAt, selfCheckIn = true, providerDelay, onProviderReply, providerOffer, onOfferReply, disruption, hasDeposit, onDisruptionCancel, onMessage, openLate, notice, shape }: {
    /** The business's header, color and mood. */
    brand: VisitBrand;
    /** Getting here, in the business's own words (Settings › Booking page › Visit us). */
    visit?: VisitNotes | null;
    /** Beside Change or cancel: "free until Thu 3:30 PM", 'late', or ''. */
    freeUntil?: string;
    /** The pass the desk scans. */
    pass?: React.ReactNode;
    /** Minutes until it starts (negative once it has). */
    minutesAway?: number | null;
    /** Where it happens — online (with a link) or at the client's place skip check-in, directions and trips. */
    place?: ServicePlace | null;
    /** How the business works (lib/business-shape): with no front desk, things are said to the person they'll see. */
    shape?: PublicShape | null;
    /** The studio's number, for phone appointments where the client calls. */
    callNumber?: string | null;
    /** Running late past the grace time — the options we sent them. */
    lateChoices?: { status?: string; choice?: string | null; options?: string[]; dropNames?: string[]; toStaffName?: string | null; etaAt?: string } | null;
    onLateChoice?: (choice: 'condense' | 'switch' | 'reschedule') => Promise<any>;
    first: string; serviceName?: string; startTime?: string; provider?: { name?: string; avatarUrl?: string } | null; address?: string | null; graceMinutes: number;
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
    onDisruptionCancel?: (deposit: 'refund' | 'credit' | 'keep' | null, extra?: any) => Promise<any>;
    /** "Message us" — opens the visit link's messages. */
    onMessage?: () => void;
    /** Open the running-late section straight away (a "?do=late" link). */
    openLate?: boolean;
    /** A short notice under the greeting (e.g. "you're confirmed"). */
    notice?: React.ReactNode;
}) => {
    // Every time shown is the business's own clock (when it has set its zone).
    const at = (v: any) => wallDate(safeDate(v), brand.zone);
    const [lateOpen, setLateOpen] = useState(!!openLate); const [mins, setMins] = useState<number | null>(null); const [note, setNote] = useState('');
    const [said, setSaid] = useState<string | null>(null); const [past, setPast] = useState(false); const [busy, setBusy] = useState(false);
    const [sharing, setSharing] = useState(false); const [tripMsg, setTripMsg] = useState<string | null>(null);
    const [dist, setDist] = useState<number | null>(null); const [confirmHere, setConfirmHere] = useState(false); const [tripNudge, setTripNudge] = useState(false);
    const watchRef = React.useRef<number | null>(null); const lastSent = React.useRef(0);
    React.useEffect(() => { if (openLate) setLateOpen(true); }, [openLate]);
    const sendTrip = async (body: any) => { if (!trip) return null; try { const r = await fetch('/api/checkins', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...trip, ...body }) }); return await r.json(); } catch { return null; } };
    const stopTrip = async (silent = false) => { if (watchRef.current !== null && typeof navigator !== 'undefined') navigator.geolocation?.clearWatch(watchRef.current); watchRef.current = null; setSharing(false); if (!silent) setTripMsg('Stopped sharing.'); await sendTrip({ trip: null }); };
    const startTrip = () => {
        if (typeof navigator === 'undefined' || !navigator.geolocation) { setTripMsg('Your phone can’t share location here.'); return; }
        setSharing(true); setTripMsg('Sharing how far away you are…');
        watchRef.current = navigator.geolocation.watchPosition(async (pos) => {
            if (Date.now() - lastSent.current < 45000) return; lastSent.current = Date.now();
            const d = await sendTrip({ trip: { lat: pos.coords.latitude, lng: pos.coords.longitude } });
            if (d?.distanceKm != null) setDist(Number(d.distanceKm));
            if (d?.distanceKm != null) setTripMsg(`We can see you’re about ${d.distanceKm} km away${d.etaMin ? ` (about ${d.etaMin} min)` : ''}. Only the distance is shared, and it stops when you check in.`);
        }, () => { setSharing(false); setTripMsg('Location is off. That’s fine, we’ll see you soon.'); }, { enableHighAccuracy: false, maximumAge: 30000, timeout: 20000 });
    };
    React.useEffect(() => () => { if (watchRef.current !== null && typeof navigator !== 'undefined') navigator.geolocation?.clearWatch(watchRef.current); }, []);
    const askedToMove = reply?.kind === 'move' || disruption?.status === 'pending';
    const isStudio = !place || place.kind === 'studio';
    const who = provider?.name ? String(provider.name).split(' ')[0] : '';
    const [lcBusy, setLcBusy] = useState<string | null>(null); const [lcMsg, setLcMsg] = useState<string | null>(null);
    const lcOpen = lateChoices?.status === 'sent' && !lateChoices.choice;
    const pickLate = async (c: 'condense' | 'switch' | 'reschedule') => { if (!onLateChoice) return; setLcBusy(c); const d = await onLateChoice(c); setLcBusy(null);
        if (!d?.ok) { setLcMsg(d?.error || 'That didn’t go through. Please try again.'); return; }
        setLcMsg(c === 'condense' ? 'Thanks. We’ll do a shorter visit so you finish on time.' : c === 'switch' ? (d.accepted ? `Done. ${String(lateChoices?.toStaffName || 'Our team').split(' ')[0]} will see you.` : d.error || 'That time has just gone. We’ll be in touch.') : 'Choose a new time below.'); };
    const [pdBusy, setPdBusy] = useState<string | null>(null); const [pdMsg, setPdMsg] = useState<string | null>(null); const [pdConfirmCancel, setPdConfirmCancel] = useState(false);
    const pdOpen = !!providerDelay && !providerDelay.reply;
    const [poBusy, setPoBusy] = useState<string | null>(null); const [poMsg, setPoMsg] = useState<string | null>(null);
    const poOpen = providerOffer?.status === 'pending';
    const poTime = providerOffer?.startAt ? format(at(providerOffer.startAt), 'h:mm a') : '';
    const poWho = String(providerOffer?.toStaffName || 'Another of our team').split(' ')[0];
    const poSend = async (c: 'accept' | 'decline') => { if (!onOfferReply) return; setPoBusy(c); const d = await onOfferReply(c); setPoBusy(null);
        setPoMsg(d?.ok ? (c === 'accept' ? `Done. ${poWho} will see you at ${poTime}.` : 'No problem. We’ll be in touch with what happens next.') : (d?.error || 'That didn’t send. Please try again.')); };
    const pdTime = providerDelay?.newStartAt ? format(at(providerDelay.newStartAt), 'h:mm a') : '';
    const pdSend = async (c: 'keep' | 'cancel') => { if (!onProviderReply) return; setPdBusy(c); const d = await onProviderReply(c); setPdBusy(null);
        setPdMsg(d?.ok ? (c === 'keep' ? `Thanks. We’ll see you around ${pdTime}.${Number(d.creditCents) > 0 ? ` We’ve added $${(Number(d.creditCents) / 100).toFixed(2)} credit to your account as a thank-you.` : ''}` : `Canceled, with no fee.${d.depositRefund ? ' Your deposit will be returned.' : ''}`) : (d?.error || 'That didn’t send. Please try again.')); };
    // We've asked them to choose a new time → stop sharing the trip.
    React.useEffect(() => { if (askedToMove && watchRef.current !== null) stopTrip(true); }, [askedToMove]); // eslint-disable-line react-hooks/exhaustive-deps

    const time = startTime ? format(at(startTime), 'h:mm') : '';
    const ampm = startTime ? format(at(startTime), 'a') : '';
    const told = status === 'on_my_way' || status === 'running_late';
    // The next thing to do: on the way first, then "I'm here" once they've said so or it's nearly time.
    const [toldNow, setToldNow] = useState(false);
    const hereFirst = told || toldNow || (minutesAway !== null && minutesAway !== undefined && minutesAway <= 20);
    // Anything that didn't go through is said here, in amber, beside the buttons (no pop-ups).
    const [actErr, setActErr] = useState('');
    const failed = (d: any) => !d || d.ok === false;
    // Who to tell in person: the front desk, or (with none) the person they're seeing. Online and phone visits: try again.
    const told2 = inPerson(shape, provider?.name);
    const DIDNT = place?.kind === 'online' || place?.kind === 'phone' ? 'That didn’t send. Please try again.' : `That didn’t send. Please try again, or let ${told2} know when you arrive.`;
    // Trip sharing ends once they're checked in (not before: if check-in doesn't go through, it keeps going).
    const arrive = async () => { setBusy(true); setActErr(''); const d: any = await onArrived(); setBusy(false); if (failed(d)) { setActErr(d?.error || DIDNT); return; } setConfirmHere(false); if (sharing) await stopTrip(true); };
    const checkIn = async () => { if (dist != null && dist > 1) { setConfirmHere(true); return; } await arrive(); };
    const sayOnWay = async () => { setBusy(true); setActErr(''); const d: any = await onMyWay(); setBusy(false); if (failed(d)) { setActErr(d?.error || DIDNT); return; } { setToldNow(true); setSaid(`Thanks. ${who || 'The team'} knows you’re on your way.`); if (trip && !sharing) setTripNudge(true); } };
    const accentCard = { boxShadow: 'inset 0 0 0 2px var(--accent-text, var(--accent))' };
    const chip = askedToMove ? 'Needs you' : status === 'running_late' ? 'Running late' : status === 'on_my_way' ? 'On the way' : 'Today';

    return (
        <VisitShell brand={brand} chip={chip} kicker={`Hi ${first}`}
            title={status === 'running_late' ? <>On your <b>way</b></> : time ? <>See you at <b>{time}</b><span className="text-[20px]" style={{ fontWeight: 400 }}> {ampm}</span></> : <>See you <b>today</b></>}
            subtitle={[serviceName, who ? `with ${who}` : '', soonWords(minutesAway ?? null)].filter(Boolean).join(' · ')}>
            {notice}
            {lateChoices && (lcOpen || lcMsg) && onLateChoice && <section className="pub-card space-y-3 p-5" style={accentCard} aria-live="polite">
                <p className="pub-accent-text text-[13px] font-semibold">Your options for today</p>
                {lcMsg ? <p className="text-[15px]">{lcMsg}</p> : <>
                    <p className="text-[15px]">You’re running past our grace time, so your full visit won’t fit. Choose what works for you:</p>
                    {(lateChoices.options || []).includes('condense') && <VisitButton disabled={!!lcBusy} onClick={() => pickLate('condense')}>{lcBusy === 'condense' ? 'Saving…' : `Shorter visit today${lateChoices.dropNames?.length ? ` (without ${lateChoices.dropNames.join(' and ')})` : ''}`}</VisitButton>}
                    {(lateChoices.options || []).includes('switch') && <VisitButton quiet disabled={!!lcBusy} onClick={() => pickLate('switch')}>{lcBusy === 'switch' ? 'Saving…' : `See ${String(lateChoices.toStaffName || 'another of our team').split(' ')[0]}${lateChoices.etaAt ? ` at ${format(at(lateChoices.etaAt), 'h:mm a')}` : ''}`}</VisitButton>}
                    {onReschedule && <VisitButton quiet disabled={!!lcBusy} onClick={async () => { await pickLate('reschedule'); onReschedule(); }}>Choose a new time</VisitButton>}
                </>}
            </section>}
            {onDisruptionCancel && <DisruptionCard disruption={disruption} hasDeposit={!!hasDeposit} onReschedule={onReschedule} onCancel={onDisruptionCancel} />}
            {providerOffer && (poOpen || poMsg) && <section className="pub-card space-y-3 p-5" style={accentCard} aria-live="polite">
                <p className="pub-accent-text text-[13px] font-semibold">Another option for today</p>
                {poMsg ? <p className="text-[15px]">{poMsg}</p> : <>
                    <p className="text-[15px]">To fit you in, <b>{poWho}</b> can see you at <b>{poTime}</b>{providerOffer.fromStaffName ? <> instead of {String(providerOffer.fromStaffName).split(' ')[0]}</> : null}. Would that work?</p>
                    <div className="grid grid-cols-2 gap-2">
                        <VisitButton disabled={!!poBusy} onClick={() => poSend('accept')}>{poBusy === 'accept' ? 'Saving…' : 'Accept'}</VisitButton>
                        <VisitButton quiet disabled={!!poBusy} onClick={() => poSend('decline')}>{poBusy === 'decline' ? 'Sending…' : 'No thanks'}</VisitButton>
                    </div>
                </>}
            </section>}
            {providerDelay && (pdOpen || pdMsg) && <section className="pub-card space-y-3 p-5" style={accentCard} aria-live="polite">
                <p className="pub-accent-text text-[13px] font-semibold">A quick update</p>
                {pdMsg ? <p className="text-[15px]">{pdMsg}</p> : <>
                    <p className="text-[15px]">{who || 'Your provider'} is running about <b>{providerDelay.minutes} minutes</b> behind, so your appointment would start around <b>{pdTime}</b>. Choose what works for you:</p>
                    <VisitButton disabled={!!pdBusy} onClick={() => pdSend('keep')}>{pdBusy === 'keep' ? 'Sending…' : `Keep my appointment (about ${pdTime})`}</VisitButton>
                    {onReschedule && <VisitButton quiet onClick={onReschedule}>Choose a new time, no fee</VisitButton>}
                    {!pdConfirmCancel ? <button type="button" className="inline-flex min-h-11 w-full items-center justify-center text-[14px] underline underline-offset-2" style={{ color: 'var(--muted)' }} onClick={() => setPdConfirmCancel(true)}>Cancel, no fee</button>
                        : <VisitButton quiet disabled={!!pdBusy} onClick={() => pdSend('cancel')}>{pdBusy === 'cancel' ? 'Canceling…' : 'Yes, cancel it (no fee)'}</VisitButton>}
                </>}
            </section>}
            {reply?.message && <section className="pub-card space-y-3 p-5" style={askedToMove ? accentCard : undefined} aria-live="polite">
                <p className="pub-accent-text text-[13px] font-semibold">{askedToMove ? 'Let’s find a new time' : `A message from ${brand.studioName || 'us'}`}</p>
                <p className="text-[15px]">{reply.message}</p>
                {askedToMove && onReschedule && <VisitButton onClick={onReschedule}>Choose a new time</VisitButton>}
            </section>}
            {!askedToMove && status === 'running_late' && !said && <p className="v-note">You told us you’re about <b>{Number(lateMinutes) || '?'} minutes</b> late{etaAt ? <>, arriving about <b>{format(at(etaAt), 'h:mm a')}</b></> : null}. {who || 'The team'} knows.</p>}
            {!askedToMove && status === 'on_my_way' && !said && <p className="v-note">You’re on your way. {who || 'The team'} knows.</p>}

            {!askedToMove && <section className="space-y-2.5">
                {place?.kind === 'online' ? (place.meetingLink
                    ? <VisitButton href={place.meetingLink} target="_blank">Join your appointment</VisitButton>
                    : <p className="v-note">This is an online appointment. Your link will be here before it starts.</p>)
                : place?.kind === 'phone' ? (place.phoneWho === 'they_call'
                    ? (callNumber ? <VisitButton href={`tel:${callNumber.replace(/[^\d+]/g, '')}`}>Call {callNumber}</VisitButton> : <p className="v-note">This is a phone appointment. Please call at your appointment time.</p>)
                    : <p className="v-note">This is a phone call. We’ll call you at your appointment time, so keep your phone nearby.</p>)
                : place?.kind === 'client' ? <p className="v-note">We’ll come to you{who ? `. ${who} will let you know when they’re on the way` : ''}.</p>
                : confirmHere ? <div className="pub-card space-y-3 p-4"><p className="text-[15px]">Looks like you’re about {dist} km away. Check in anyway?</p>
                    <div className="grid grid-cols-2 gap-2"><VisitButton good disabled={busy} onClick={arrive}>Yes, I’m here</VisitButton>
                        <VisitButton quiet onClick={() => setConfirmHere(false)}>Not yet</VisitButton></div></div>
                : !selfCheckIn ? <>
                    {!told && !toldNow && <VisitButton disabled={busy} onClick={sayOnWay}>I’m on my way</VisitButton>}
                    <p className="v-note">{shape?.desk === false ? `Please let ${told2} know you’re here when you arrive.` : 'Please check in at the front desk when you arrive.'}</p>
                </> : hereFirst ? <VisitButton good disabled={busy} onClick={checkIn}>{busy ? 'Checking you in…' : 'I’m here'}</VisitButton>
                : <VisitButton disabled={busy} onClick={sayOnWay}>{busy ? 'Sending…' : 'I’m on my way'}</VisitButton>}
                {<VisitButton quiet expanded={lateOpen} onClick={() => { setActErr(''); setLateOpen((v) => !v); }}>{status === 'running_late' ? 'Update how late I’ll be' : 'Running a few minutes late'}</VisitButton>}
                {actErr && !lateOpen && <p className="px-1 text-[14px]" role="alert" style={{ color: 'var(--warn)' }}>{actErr}</p>}
                {isStudio && selfCheckIn && !hereFirst && !confirmHere && <button type="button" disabled={busy} onClick={checkIn} className="inline-flex min-h-11 w-full items-center justify-center text-[14.5px] font-semibold pub-accent-text">Already here? Check in</button>}
            </section>}

            {lateOpen && !askedToMove && <section className="pub-card space-y-3 p-5" aria-label="Running late">
                <p className="text-[15px] font-semibold">About how late?</p>
                <div className="flex flex-wrap gap-2">{LATE_CHOICES.map((m) => <button key={m} type="button" aria-pressed={mins === m} onClick={() => setMins(m)} className="v-pill pub-press">{m === 45 ? '45+ min' : `${m} min`}</button>)}</div>
                <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="Anything we should know? (optional)" aria-label="A note about running late" className="v-field h-12" />
                <VisitButton disabled={!mins || busy || (status === 'running_late' && mins === Number(lateMinutes))} onClick={async () => {
                    if (!mins) return; setBusy(true); setActErr(''); const d = await onLate(mins, note.trim()); setBusy(false);
                    if (failed(d)) { setActErr(d?.error || DIDNT); return; }
                    setLateOpen(false);
                    const g = Number(d?.graceMinutes ?? graceMinutes) || 0; const over = g > 0 ? mins > g : false; setPast(over);
                    setSaid(over ? `Thanks for telling us. ${mins} minutes is past our ${g}-minute grace period, so we may need to shorten your service or move it. ${who || 'We'}’ll let you know.` : `Thanks. We’ve let ${who || 'the team'} know.${g > 0 ? ` We can hold your time for up to ${g} minutes.` : ''}`);
                }}>Let them know</VisitButton>
                {actErr && <p className="text-[14px]" role="alert" style={{ color: 'var(--warn)' }}>{actErr}</p>}
            </section>}
            {said && !reply?.message && <section className="pub-card space-y-3 p-5" aria-live="polite"><p className="text-[15px]">{said}</p>{past && onReschedule && <VisitButton quiet onClick={onReschedule}>Choose a new time instead</VisitButton>}</section>}

            {pass && isStudio && <div className="v-grp"><div className="v-row"><span className="min-w-0 flex-1 py-3"><span className="block text-[15.5px] font-semibold">Your pass</span><span className="block text-[13px]" style={{ color: 'var(--muted)' }}>{shape?.desk === false ? `Show it to ${told2}, or tap it to make it big.` : 'Show it at the desk, or tap it to make it big.'}</span></span>{pass}</div></div>}

            {isStudio && <VisitGettingHere address={address} notes={visit} />}

            {trip && isStudio && selfCheckIn && !askedToMove && <section className="pub-card space-y-2 p-5">
                <div className="flex items-center justify-between gap-3"><p className="text-[15px] font-semibold">Share my trip</p>
                    <button type="button" onClick={() => (sharing ? stopTrip() : startTrip())} aria-pressed={sharing} className="v-pill pub-press">{sharing ? 'Stop' : 'Start'}</button></div>
                <p className="text-[13.5px]" style={{ color: 'var(--muted)' }}>{tripMsg || (tripNudge ? 'On your way? Tap Start and we’ll see roughly how far away you are. Only the distance, and it stops when you check in.' : 'Let us see roughly how far away you are until you arrive. Only the distance is shared, and it stops when you check in.')}</p>
            </section>}

            <VisitChange freeUntil={freeUntil} onReschedule={onReschedule} onCancel={onCancel} />
            <VisitRows rows={[
                onMessage && { key: 'm', icon: <MessageSquare className="h-[18px] w-[18px]" />, text: 'Message us', onClick: onMessage },
                onNotifications && { key: 'n', icon: <Bell className="h-[18px] w-[18px]" />, text: 'How we reach you', onClick: onNotifications },
                portalHref && { key: 'y', icon: <User className="h-[18px] w-[18px]" />, text: 'Your account', href: portalHref },
            ]} />
        </VisitShell>
    );
};
