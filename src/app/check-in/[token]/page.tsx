'use client';
import { usePublicStaff } from '@/lib/use-public-staff';

/**
 * /check-in/[token] — the client's visit link: one link for the whole visit, in the business's own booking-page look
 * (VisitShell: their header, color and mood). It shows what matters now:
 *   opening → not found → "Is this you?" (old contact) → messages → finished (VisitStages) → canceled →
 *   finish your booking (forms, card, deposit) → cancel / reschedule / message settings →
 *   checked in: the waiting lounge (VisitLounge) when the business offers it, otherwise a calm checked-in screen →
 *   long past → before the day (TooEarlyView) → on the day (DayOfView).
 * There is exactly one link per appointment (checkInToken); finishing the booking happens here first, then the visit.
 */

import { TooEarlyView, CompletedView, CheckedInView, AllSetView, VisitLoading, VisitNotFound } from '@/components/visit/VisitStages';
import { VisitLounge } from '@/components/visit/VisitLounge';
import { VisitPay } from '@/components/visit/VisitPay';
import { CancelledView, NotificationPreferencesView, StaleAppointmentView, CompletionGateView, CancelGateView, RescheduleGateView } from '@/components/visit/VisitGates';
import { freeUntilWords } from '@/lib/policy-copy';
import { wallDate } from '@/lib/tenant-time';
import { deadlineStart } from '@/lib/change-rules';
import { placeOf } from '@/lib/service-place';
import { VisitShell, VisitCard, VisitButton, VisitFooter, VisitTop, brandOf } from '@/components/booking/VisitShell';
import { PassCode } from '@/components/booking/VisitHero';
import { DayOfView } from '@/components/booking/DayOfView';
import { VisitMessages } from '@/components/booking/VisitMessages';
import { ClientNotifyCard, isStandalone } from '@/components/booking/ClientNotifyCard';
import { VerifyCard, NotMeLink, LinkOffView, VisitNotice, visitDevice } from '@/components/visit/VerifyCard';
import { resolvePolicy } from '@/lib/booking-policies';
import React, { useState, useMemo, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { format, parseISO, isSameDay } from 'date-fns';
import { type Appointment, type Client, type Service, type Tenant, type Staff, type InventoryItem, type Resource, type Membership } from '@/lib/data';
import { useFirebase, useCollection, useMemoFirebase, useDoc } from '@/firebase';
import { collection, query, where, doc } from 'firebase/firestore';
import { studioPage } from '@/lib/studio-page';
import { FormsLeftCard, FormsLeftView, thingsLeft, type VisitFormsView } from '@/components/visit/VisitForms';
import { PhotosAskCard, PhotosSentCard } from '@/components/visit/PhotosAskCard';
import { PhotosReplyCard } from '@/components/visit/PhotosReplyCard';
import { formRulesOf, requestAsksMore } from '@/lib/forms';
import { inPerson } from '@/lib/business-shape';
import { chosenNiche } from '@/lib/niche';

const safeDate = (val: any): Date => {
    if (!val) return new Date();
    if (val instanceof Date) return val;
    if (typeof val === 'string') return parseISO(val);
    if (typeof val === 'object' && 'seconds' in val) return new Date(val.seconds * 1000);
    return new Date(val);
};

/** Could this phone turn on notifications right now? (Otherwise the card only shows steps, and needs no code.) */
const pushCanAsk = () => {
    if (typeof window === 'undefined') return false;
    if (/iPad|iPhone|iPod/.test(navigator.userAgent) && !isStandalone()) return false;
    return 'Notification' in window && 'serviceWorker' in navigator && Notification.permission !== 'denied';
};

export default function CheckInPage() {
    const params = useParams();
    const token = params.token as string;
    const { firestore } = useFirebase();

    const [entered, setEntered] = useState(false);
    const [showCancelFlow, setShowCancelFlow] = useState(false);
    const [showRescheduleFlow, setShowRescheduleFlow] = useState(false);
    const [showNotificationSettings, setShowNotificationSettings] = useState(false);
    const [showMessages, setShowMessages] = useState(false);
    const [openLate, setOpenLate] = useState(false);
    // "?do=confirm" → the answer, shown as a small card at the top (dismissible).
    const [confirmNote, setConfirmNote] = useState<{ ok: boolean; text: string } | null>(null);
    // v2 -- once the completion gate is submitted, we don't want the
    // still-cached-in-memory `completion` doc (which may not have refreshed
    // yet) to flash the gate again before Firestore's snapshot updates.
    const [completionJustDone, setCompletionJustDone] = useState<null | boolean>(null);

    const appointmentCheckInRef = useMemoFirebase(() => !firestore || !token ? null : doc(firestore, 'appointmentCheckIns', token), [firestore, token]);
    const { data: copyData, isLoading: appointmentLoading } = useDoc<Appointment>(appointmentCheckInRef);
    // THE VISIT ITSELF (T4): the copy above can lag if a screen forgot to update it — so whenever it changes (and every
    // 20 s while open) the page asks the server for the visit's live, safe view and shows that on top.
    const [liveView, setLiveView] = useState<any>(null);
    // "IS THIS YOU?" (lib/client-verify). revoked: "Not you?" turned this link off. notMeMsg: they just reported it.
    // trust: has this phone confirmed a code? Private things (messages, notifications, their next appointment) wait for it.
    const [revoked, setRevoked] = useState(false);
    const [revokedBiz, setRevokedBiz] = useState<{ name: string | null; phone: string | null } | null>(null);
    const [notMeMsg, setNotMeMsg] = useState<string | null>(null);
    const [trust, setTrust] = useState<'unknown' | 'trusted' | 'untrusted'>('unknown');
    const [viewNonce, setViewNonce] = useState(0);
    const [photosSent, setPhotosSent] = useState<string | null>(null);
    const fastPoll = React.useRef(false);
    useEffect(() => {
        if (!token) return; let stop = false; let t: any = null;
        const pull = async () => { try { const r = await fetch(`/api/visit-view?token=${encodeURIComponent(token)}&device=${encodeURIComponent(visitDevice())}`, { cache: 'no-store' }); const d = await r.json(); if (!stop && d?.revoked) { setRevokedBiz({ name: d.businessName || null, phone: d.businessPhone || null }); setRevoked(true); return; } if (!stop && d?.ok) setLiveView(d.view); } catch { /* keep the copy */ } finally { if (!stop) setLiveTried(true); }
            // Every 8 seconds while they're in (so a total sent from checkout shows quickly), otherwise every 20.
            if (!stop) t = setTimeout(pull, document.visibilityState === 'hidden' ? 60000 : fastPoll.current ? 8000 : 20000); };
        pull(); return () => { stop = true; clearTimeout(t); };
    }, [token, viewNonce, (copyData as any)?.status, (copyData as any)?.checkInStatus, (copyData as any)?.stage, (copyData as any)?.visitUpdatedAt]);
    // The server's view is the source (whitelisted fields only); the public copy is a fallback while it loads.
    const appointmentData = useMemo(() => (copyData || liveView ? ({ ...((copyData as any) || {}), ...(liveView || {}) } as Appointment) : copyData), [copyData, liveView]);
    const [liveTried, setLiveTried] = useState(false);
    useEffect(() => { if (liveView) setLiveTried(true); const t = setTimeout(() => setLiveTried(true), 8000); return () => clearTimeout(t); }, [liveView]);
    const visitLoading = !liveView && !copyData && (appointmentLoading || !liveTried);
    {
        const a: any = appointmentData; const done = Date.parse(a?.completedAt || a?.endTime || ''); const start = Date.parse(a?.startTime || '');
        // In, or around the visit's own time (a solo provider may never mark them in): a total sent from checkout shows quickly.
        const around = Number.isFinite(start) && Date.now() > start - 15 * 60000 && Date.now() < (Number.isFinite(done) ? done : start) + 3 * 3600e3;
        fastPoll.current = !!a && (a.checkInStatus === 'arrived' || a.status === 'servicing' || around || (a.status === 'completed' && Number.isFinite(done) && Date.now() - done < 3 * 3600e3));
    }
    // PAY AND TIP from this link: checkout sent their total here (api/client-screen visit_screen). Once it opens, it
    // stays until they tap Done, so the thank-you isn't snatched away when the payment closes.
    const [payScreen, setPayScreen] = useState<string | null>(null);
    const payInfo: any = (appointmentData as any)?.pay || null;
    const payOpen = payInfo?.open === true ? String(payInfo.screenId || '') : '';
    // Each payment sent opens once by itself; after "Back to your visit", "Pay now" at the top opens it again.
    const payKey = payOpen ? `${payOpen}|${String(payInfo?.requestId || '')}` : '';
    useEffect(() => { if (payOpen) setPayScreen(payOpen); }, [payKey]); // eslint-disable-line react-hooks/exhaustive-deps

    const tenantId = appointmentData?.tenantId;
    const clientId = appointmentData?.clientId;
    // A contact not confirmed or used in a year: the server sent only the business and the date until this phone confirms.
    const verifyFirst = !!(liveView as any)?.verifyFirst;
    const followAsked = React.useRef(false);
    const [noNext, setNoNext] = useState(false);

    // A visit that's over (done, missed, canceled a while ago, or long past): move on to their next appointment, so a
    // link saved to the home screen always opens what's coming up. A just-canceled visit stays (it may be undone).
    useEffect(() => {
        const ap: any = appointmentData; if (!ap?.id || !tenantId) return;
        const st = String(ap.status || ''); const end = Date.parse(ap.endTime || ap.startTime || '');
        const over = ['completed', 'no_show', 'noshow'].includes(st) || (['cancelled', 'canceled'].includes(st) && Date.now() - Date.parse(ap.cancelledAt || '') > 30 * 60000) || (Number.isFinite(end) && Date.now() - end > 3 * 3600e3);
        // Never while they're paying (or their total is waiting): the thank-you stays until they tap Done.
        if (!over || verifyFirst || revoked || payScreen || payOpen) return; let live = true;
        // Only on a phone that has confirmed a code: the server answers nothing otherwise (see the footer's "Is this you?").
        fetch('/api/appt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'next_link', tenantId, apptId: ap.id, k: token, device: visitDevice() }) })
            .then((r) => r.json()).then((d) => {
                if (!live) return;
                if (d?.code === 'revoked') { setRevoked(true); return; }
                if (d?.needsVerify) { setTrust('untrusted'); return; }
                if (d?.token && d.token !== token) window.location.replace(`/check-in/${d.token}${window.location.search || ''}`);
                else if (followAsked.current) setNoNext(true);
            }).catch(() => {});
        return () => { live = false; };
    }, [appointmentData?.id, (appointmentData as any)?.status, tenantId, token, verifyFirst, revoked, trust, payScreen, payOpen]); // eslint-disable-line react-hooks/exhaustive-deps

    const tenantDocRef = useMemoFirebase(() => !firestore || !tenantId ? null : doc(firestore, `tenants/${tenantId}`), [firestore, tenantId]);
    const { data: tenant, isLoading: tenantLoading } = useDoc<Tenant>(tenantDocRef);
    
    const inventoryQuery = useMemoFirebase(() => !firestore || !tenantId ? null : collection(firestore, `tenants/${tenantId}/inventory`), [firestore, tenantId]);
    const { data: inventory } = useCollection<InventoryItem>(inventoryQuery);

    const membershipsQuery = useMemoFirebase(() => !firestore || !tenantId ? null : collection(firestore, `tenants/${tenantId}/memberships`), [firestore, tenantId]);
    const { data: memberships } = useCollection<Membership>(membershipsQuery);

    const resourcesQuery = useMemoFirebase(() => !firestore || !tenantId ? null : collection(firestore, `tenants/${tenantId}/resources`), [firestore, tenantId]);
    const { data: resources } = useCollection<Resource>(resourcesQuery);

    // ── Guest lounge payload ─────────────────────────────────────────────────
    // A guest opening this link is NOT signed in to Firebase, and firestore.rules
    // denies an unauthenticated reader `inventory` (staff-only), `memberships`
    // (catch-all deny) and `clients/{id}` (read is staff-only). That is why the
    // waiting screen used to render an empty band: every collection it needed
    // came back as []. /api/guest-lounge reads those server-side with the Admin
    // SDK and returns a narrow, sanitised projection keyed off this same token —
    // no cost prices, no supplier, no stock counts, no other tenant's data.
    const [lounge, setLounge] = useState<any | null>(null);
    const [loungeError, setLoungeError] = useState(false);
    const [loungeNonce, setLoungeNonce] = useState(0);
    const isLoungeActive = appointmentData?.checkInStatus === 'arrived' || appointmentData?.status === 'servicing';

    // Polled every 15 s while the lounge is showing (60 s when the tab is in the
    // background) — this is also how the guest's own amenity requests stay in
    // step with the back of house. The request list is no longer readable from
    // a browser, so the server's token-checked list is the only source.
    useEffect(() => {
        if (!token || !isLoungeActive) return;
        let cancelled = false; let timer: any = null; let hadData = false;
        const pull = async () => {
            try {
                const res = await fetch(`/api/guest-lounge?token=${encodeURIComponent(token)}`, { cache: 'no-store' });
                const d = await res.json().catch(() => ({}));
                if (cancelled) return;
                if (!res.ok || !d?.ok) { if (!hadData) setLoungeError(true); }
                else { hadData = true; setLounge(d); setLoungeError(false); }
            } catch {
                // A dropped poll keeps the last good payload on screen.
                if (!cancelled && !hadData) setLoungeError(true);
            } finally {
                if (!cancelled) timer = setTimeout(pull, document.visibilityState === 'hidden' ? 60000 : 15000);
            }
        };
        pull();
        return () => { cancelled = true; clearTimeout(timer); };
    }, [token, isLoungeActive, loungeNonce]);

    // useCallback is not imported in this file, so a plain arrow it is. It is
    // only ever passed down as a prop, never used in a dependency array.
    const refreshLounge = () => setLoungeNonce(n => n + 1);

    const clientDocRef = useMemoFirebase(() => !firestore || !tenantId || !clientId ? null : doc(firestore, `tenants/${tenantId}/clients`, clientId), [firestore, tenantId, clientId]);
    const { data: client, isLoading: clientLoading } = useDoc<Client>(clientDocRef);
    
    const serviceDocRef = useMemoFirebase(() => !firestore || !tenantId || !appointmentData?.serviceId ? null : doc(firestore, `tenants/${tenantId}/services`, appointmentData.serviceId), [firestore, tenantId, appointmentData?.serviceId]);
    const { data: service, isLoading: serviceLoading } = useDoc<Service>(serviceDocRef);
    
    // The provider's public card (name and photo) comes through the server; staff records themselves are team-only.
    const { one: publicStaff } = usePublicStaff(tenantId || null, (appointmentData as any)?.staffId || null);
    const assignedStaff: Staff | null = publicStaff ? ({ id: publicStaff.id, name: publicStaff.name, avatarUrl: publicStaff.avatarUrl } as any) : null; const staffLoading = false;

    // v2 -- NEW: completion record + its required consent forms, looked up
    // by the SAME token as everything else on this page. Both queries are
    // no-ops (return null) until tenantId resolves, same pattern as every
    // other query on this page.
    // The completion record itself is team-only; the server returns a safe copy (no email, first name only), checked
    // against this visit's token. Re-asked whenever the visit's status or completion status moves.
    const [completion, setCompletion] = useState<any>(null);
    const [completionLoading, setCompletionLoading] = useState(true);
    // The visit's forms and documents from the client's side (lib/forms-visit): what's done, what's left, when it's due.
    const [visitForms, setVisitForms] = useState<VisitFormsView | null>(null);
    const [formsNonce, setFormsNonce] = useState(0);
    const [showForms, setShowForms] = useState(false);
    const [formsLater, setFormsLater] = useState(false);   // "Not now" on arrival, for this visit of the page
    // Asked again when the visit changes (the desk signing a form counts), when a form is saved here, and when they come
    // back to this page.
    const completionKey = `${(appointmentData as any)?.status || ''}|${(appointmentData as any)?.completionStatus || ''}|${(appointmentData as any)?.checkInStatus || ''}|${Array.isArray((appointmentData as any)?.signedForms) ? (appointmentData as any).signedForms.length : 0}|${formsNonce}|${verifyFirst ? 'v' : ''}`;
    useEffect(() => {
        const back = () => { if (document.visibilityState === 'visible') setFormsNonce((n) => n + 1); };
        document.addEventListener('visibilitychange', back);
        return () => document.removeEventListener('visibilitychange', back);
    }, []);
    useEffect(() => {
        if (!token) { setCompletionLoading(false); return; }
        let stop = false;
        fetch(`/api/visit-completion?token=${encodeURIComponent(token)}&device=${encodeURIComponent(visitDevice())}`, { cache: 'no-store' })
            .then((r) => r.json()).then((d) => { if (!stop && d?.ok) { setCompletion(d.completion || null); setVisitForms(d.visit || null); } })
            .catch(() => { /* keep what we have */ })
            .finally(() => { if (!stop) setCompletionLoading(false); });
        return () => { stop = true; };
    }, [token, completionKey]);

    const allConsentFormsQuery = useMemoFirebase(() => !firestore || !tenantId ? null : collection(firestore, `tenants/${tenantId}/consentForms`), [firestore, tenantId]);
    const { data: allConsentForms } = useCollection<any>(allConsentFormsQuery);

    const requiredForms = useMemo(() => {
        const ids: string[] = completion?.requiredConsentFormIds || [];
        if (!ids.length || !allConsentForms) return [];
        return allConsentForms.filter((f: any) => ids.includes(f.id));
    }, [completion, allConsentForms]);

    // Same computation CompletionContent used for its "nothingToDo" check,
    // just inverted and named for clarity at this call site.
    const isCompletionPending = useMemo(() => {
        if (!completion) return false;
        if (completion.status !== 'pending' && completion.status) return false;   // done, called off or anything else: nothing to finish
        // Forms still to sign (the server's list, so it doesn't wait on the forms' wording loading here), documents, or
        // anything else the request asks for (lib/forms requestAsksMore: the same rule that closes it).
        const hasForms = (completion.requiredConsentFormIds || []).length > 0;
        const hasFileReqs = (completion.fileRequirements || []).length > 0;
        return hasForms || hasFileReqs || requestAsksMore(completion);
    }, [completion]);

    // v4 — one-time "client opened the link" tracking, purely for the
    // activity timeline. Guarded on the appointment doc's own field so it
    // only ever writes once, no matter how many times the client re-opens
    // the same link. Fires unconditionally on mount (before any early
    // return) — same Rules-of-Hooks discipline as every other hook here.
    const viewNoted = React.useRef(false);
    useEffect(() => {
        if (!firestore || !tenantId || !appointmentData?.id) return;
        if (viewNoted.current) return; viewNoted.current = true;
        const by = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('by') : null;
        fetch('/api/checkin/actions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'viewed', token, by }) }).catch(() => {}); // best-effort
    }, [firestore, tenantId, appointmentData?.id]);

    // Every visit-link action goes through /api/appt with this page's token.
    // This phone's id travels with every call (private things open only on a phone that has confirmed a code).
    const apptApi = async (payload: any): Promise<any> => {
        try {
            const r = await fetch('/api/appt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, apptId: appointmentData?.id, k: token, device: visitDevice(), ...payload }) });
            const d = await r.json();
            if (d?.code === 'revoked') setRevoked(true);
            else if (d?.needsVerify) setTrust('untrusted');
            return d;
        }
        catch { return { ok: false, error: 'We couldn’t connect. Please check your connection and try again.' }; }
    };
    const apptReady = !!(tenantId && appointmentData?.id);
    // Once per page view: note that the client used their link (and whether from their home screen). Not while the
    // page is waiting for "Is this you?": opening an old number's link isn't the client using it.
    const linkNoted = React.useRef(false);
    useEffect(() => {
        if (!apptReady || verifyFirst || revoked || linkNoted.current) return; linkNoted.current = true;
        void apptApi({ action: 'link_used', standalone: isStandalone() });
    }, [apptReady, verifyFirst, revoked]); // eslint-disable-line react-hooks/exhaustive-deps
    // Has this phone confirmed a code? Asked once the full visit is showing.
    useEffect(() => {
        if (!apptReady || verifyFirst || revoked || trust !== 'unknown') return; let live = true;
        void apptApi({ action: 'verify_status' }).then((r) => { if (live && r?.ok) setTrust(r.trusted ? 'trusted' : 'untrusted'); });
        return () => { live = false; };
    }, [apptReady, verifyFirst, revoked, trust]); // eslint-disable-line react-hooks/exhaustive-deps
    // Links we send open the page straight to an action: ?do=cancel | reschedule | message | confirm | late. Applied
    // once, then removed from the address so going back (or reloading) doesn't open it again.
    const deepLinked = React.useRef(false);
    useEffect(() => {
        if (!apptReady || verifyFirst || revoked || deepLinked.current || typeof window === 'undefined') return; deepLinked.current = true;
        let act = '';
        try { const u = new URL(window.location.href); act = String(u.searchParams.get('do') || ''); if (act) { u.searchParams.delete('do'); window.history.replaceState(window.history.state, '', u.pathname + (u.search || '') + u.hash); } } catch { /* no action */ }
        if (act === 'cancel') setShowCancelFlow(true);
        else if (act === 'reschedule') setShowRescheduleFlow(true);
        else if (act === 'message') setShowMessages(true);
        else if (act === 'late') setOpenLate(true);
        else if (act === 'confirm') void apptApi({ action: 'confirm' }).then((r) => setConfirmNote(r?.ok ? { ok: true, text: 'Thank you, you’re confirmed. We look forward to seeing you.' } : { ok: false, text: r?.error || 'We couldn’t confirm your appointment just now. Please try again in a moment, or reply to our text.' }));
    }, [apptReady, verifyFirst, revoked]); // eslint-disable-line react-hooks/exhaustive-deps
    const confirmCard = confirmNote ? (
        <VisitCard tone={confirmNote.ok ? 'ok' : 'warn'}>
            <div className="flex items-start justify-between gap-3">
                <p className="text-[15px]" role="status">{confirmNote.text}</p>
                <button type="button" onClick={() => setConfirmNote(null)} className="inline-flex min-h-11 shrink-0 items-center text-[14px] underline underline-offset-2" style={{ color: 'var(--muted)' }}>Close</button>
            </div>
        </VisitCard>
    ) : null;

    // Arrived, on my way, running late. The server checks the token, the business's rules (e.g. online check-in off →
    // front desk) and duplicates. Its answer goes back to the screen, which says what went wrong in its own words; we
    // never write around it from the browser. Once it's through, the live view is asked again straight away.
    const updateStatus = async (status: string, lateMinutes?: number, lateNote?: string): Promise<any> => {
        const failed = (error: string) => ({ ok: false, error });
        // Who to tell in person when it doesn't go through: the front desk, or (with none) the person they're seeing.
        // An online or phone visit has nobody to tell in person: just try again.
        const tellWho = inPerson((appointmentData as any)?.shape, (appointmentData as any)?.staffName);
        const away = ['online', 'phone'].includes(String(placeOf(service, appointmentData)?.kind || ''));
        const orTell = away ? '' : `, or let ${tellWho} know when you arrive`;
        if (!firestore || !token || !appointmentData || !tenantId) return failed(away ? 'That didn’t send. Please try again.' : `That didn’t send. Please let ${tellWho} know when you arrive.`);
        const updates: any = { checkInStatus: status };
        if (lateMinutes !== undefined) updates.lateTimeMinutes = lateMinutes;
        if (lateNote) updates.lateNote = lateNote;
        try {
            const res = await fetch('/api/checkins', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    tenantId, token, ...updates,
                    appointmentId: appointmentData.id || undefined,
                    clientId: client?.id || appointmentData.clientId || undefined,
                    clientName: client?.name || undefined,
                }),
            });
            const d = await res.json().catch(() => ({}));
            if (!res.ok || !d?.ok) return failed(d?.error || (away ? 'That didn’t send. Please try again.' : `That didn’t send. Please let ${tellWho} know when you arrive.`));
            setViewNonce((n) => n + 1);
            return d;
        } catch {
            return failed(`That didn’t send. Please check your connection${orTell}.`);
        }
    };

    // ── "Is this you?", "Not you?", and a link that's been turned off ──
    const bizName: string | null = (tenant as any)?.name || (tenant as any)?.businessName || (liveView as any)?.businessName || revokedBiz?.name || null;
    const bizPhone: string | null = (tenant as any)?.phone || (tenant as any)?.twilioPhoneNumber || revokedBiz?.phone || null;
    const noticeBrand = tenant ? brandOf(tenant, tenantId, null) : undefined;
    if (revoked) return <LinkOffView businessName={bizName} businessPhone={bizPhone} brand={noticeBrand} />;
    if (notMeMsg) return <VisitNotice title="This link is now turned off" body={notMeMsg} businessName={bizName} businessPhone={bizPhone} brand={noticeBrand} />;
    const linkOf = tenantId && appointmentData?.id ? { tenantId, apptId: appointmentData.id, k: token } : null;
    const verifyShared = { businessName: bizName, businessPhone: bizPhone, onRevoked: () => setRevoked(true), onNotMe: (m: string) => setNotMeMsg(m) };
    // Notifications: on a phone that hasn't confirmed a code, "Is this you?" comes first (where the phone could turn them on).
    const notifySlot = !linkOf ? null
        : trust === 'trusted' || !pushCanAsk() ? <ClientNotifyCard tenantId={linkOf.tenantId} api={apptApi} hideWhenOn />
        : trust === 'untrusted' ? <VerifyCard {...linkOf} {...verifyShared} onNotMe={undefined} onVerified={() => setTrust('trusted')}
            prompt={{ title: 'Get updates here, not by text', text: 'For your privacy, please confirm it’s you first. Then you can turn on notifications for replies, reminders and early openings.', button: 'Confirm it’s me' }} />
        : null;
    // At the bottom of the visit: "Not you?", and (once the visit is over) the way on to their next appointment.
    const visitOver = (() => {
        const ap: any = appointmentData; if (!ap) return false;
        const st = String(ap.status || ''); const end = Date.parse(ap.endTime || ap.startTime || '');
        return ['completed', 'no_show', 'noshow'].includes(st) || (['cancelled', 'canceled'].includes(st) && Date.now() - Date.parse(ap.cancelledAt || '') > 30 * 60000) || (Number.isFinite(end) && Date.now() - end > 3 * 3600e3);
    })();
    // Rendered at the foot of the visit screen itself (VisitShell reads it), in the business's look.
    const footer = linkOf && clientId ? (
        <div className="space-y-4 pt-4">
            {visitOver && trust === 'untrusted' && <VerifyCard {...linkOf} {...verifyShared} onNotMe={undefined}
                onVerified={() => { followAsked.current = true; setTrust('trusted'); }}
                prompt={{ title: 'Looking for your next appointment?', text: 'For your privacy, please confirm it’s you, and we’ll take you straight there.', button: 'Confirm it’s me' }} />}
            {noNext && <p className="text-center text-[14px]" role="status" style={{ color: 'var(--muted)' }}>You don’t have another appointment booked with us yet.</p>}
            <div className="text-center"><NotMeLink {...linkOf} businessName={bizName} onDone={(m) => setNotMeMsg(m)} onRevoked={() => setRevoked(true)} /></div>
        </div>
    ) : null;
    // Their total, waiting at the top of every screen once they've stepped back from paying.
    const payTop = payOpen && !payScreen ? (
        <VisitCard>
            <div className="flex items-center justify-between gap-3">
                <div className="min-w-0"><p className="text-[15.5px] font-semibold">Your total is ready</p>
                    <p className="text-[14px]" style={{ color: 'var(--muted)' }}>{Number(payInfo?.amount) > 0 ? `$${Number(payInfo.amount).toFixed(2)} · ` : ''}Add a tip and pay from here.</p></div>
                <div className="w-[120px] shrink-0"><VisitButton onClick={() => setPayScreen(payOpen)}>Pay now</VisitButton></div>
            </div>
        </VisitCard>
    ) : null;
    const withFooter = (node: React.ReactNode) => <VisitFooter.Provider value={footer}><VisitTop.Provider value={payTop}>{node}</VisitTop.Provider></VisitFooter.Provider>;

    if (visitLoading || clientLoading || serviceLoading || tenantLoading || staffLoading || completionLoading) return <VisitLoading />;

    if (!appointmentData) return <VisitNotFound />;

    // A contact not confirmed or used in 12 months: just the business and the date, and "Is this you?" first.
    if (verifyFirst && linkOf) {
        const at = appointmentData?.startTime ? wallDate(safeDate(appointmentData.startTime), brandOf(tenant).zone) : null;
        return (
            <VisitShell brand={brandOf(tenant, tenantId, null)} title={<>Your <b>appointment</b></>}>
                {at && <VisitCard>
                    <p className="text-[15px] font-semibold">{bizName || 'Your appointment'}</p>
                    <p className="text-[15px]" style={{ color: 'var(--muted)' }}>{format(at, 'EEEE, MMMM d')} at {format(at, 'h:mm a')}</p>
                </VisitCard>}
                <VerifyCard {...linkOf} {...verifyShared} title="For your privacy, please confirm it’s you"
                    intro="It’s been a while since we last confirmed your details, so we’ll send a 6-digit code to the phone or email we have for you. Then you’ll see everything about your appointment."
                    onVerified={() => { setTrust('trusted'); setViewNonce((n) => n + 1); }} />
            </VisitShell>
        );
    }

    // Message us — open from any state of the visit (a reply link can arrive after it's finished or canceled).
    // The thread is private: on a phone that hasn't confirmed a code, "Is this you?" comes first.
    if (showMessages && linkOf && trust !== 'trusted') {
        return (
            <VisitShell brand={brandOf(tenant, tenantId, (appointmentData as any)?.serviceId || null)} title={<>Message <b>us</b></>}>
                <VerifyCard {...linkOf} {...verifyShared} title="Is this you?"
                    intro="Your messages are private. To open them on this phone, we’ll send a 6-digit code to the phone or email we have for you."
                    onVerified={() => setTrust('trusted')} />
                <VisitButton quiet onClick={() => setShowMessages(false)}>Back</VisitButton>
            </VisitShell>
        );
    }
    if (payScreen && tenantId && appointmentData?.id) {
        return withFooter(
            <VisitPay brand={brandOf(tenant, tenantId, (appointmentData as any)?.serviceId || null)} screenId={payScreen} shape={(appointmentData as any)?.shape || null}
                first={String(client?.name || appointmentData?.clientName || '').split(' ')[0] || null}
                provider={(assignedStaff as any)?.name ? String((assignedStaff as any).name).split(' ')[0] : null}
                onClose={() => { setPayScreen(null); setViewNonce((n) => n + 1); }} />
        );
    }

    if (showMessages && tenantId && appointmentData?.id) {
        return (
            <VisitMessages
                brand={brandOf(tenant, tenantId, (appointmentData as any)?.serviceId || null)}
                tenantId={tenantId}
                api={apptApi}
                onBack={() => setShowMessages(false)}
            />
        );
    }

    if (appointmentData?.status === 'completed') {
        return withFooter(
            <CompletedView brand={brandOf(tenant, tenantId, (appointmentData as any)?.serviceId || null)}
                tenant={tenant ? { ...(tenant as any), id: (tenant as any).id || tenantId } : null}
                client={client || null}
                appointment={appointmentData}
                service={service || null}
            />
        );
    }

    if (appointmentData?.status === 'cancelled') {
        return withFooter(
            <CancelledView brand={brandOf(tenant, tenantId, (appointmentData as any)?.serviceId || null)} 
                reason={appointmentData.cancellationReason}
                tenantId={tenantId}
                token={token}
                completion={completion}
                firestore={firestore}
            />
        );
    }

    // v2 -- NEW: completion gate. Sits before the arrival flow. If the
    // client just submitted it this session, `completionJustDone` short-
    // circuits so we don't flash the gate again while Firestore's snapshot
    // catches up -- and if the appointment isn't today, we show a distinct
    // "you're all set, see you on {date}" success card instead of jumping
    // into the day-of arrival screen.
    if (completionJustDone === null && isCompletionPending) {
        return (
            <CompletionGateView
                brand={brandOf(tenant, tenantId, (appointmentData as any)?.serviceId || null)}
                tenant={tenant || null}
                tenantId={tenantId!}
                token={token}
                completion={{ ...completion, appointmentStartTime: appointmentData.startTime }}
                forms={requiredForms}
                onDone={(startsToday) => setCompletionJustDone(startsToday)}
                visit={visitForms}
                allForms={allConsentForms || []}
                onChanged={() => setFormsNonce((n) => n + 1)}
            />
        );
    }

    if (completionJustDone === false) {
        return withFooter(<AllSetView brand={brandOf(tenant, tenantId, (appointmentData as any)?.serviceId || null)} startTime={appointmentData.startTime as any} businessName={tenant?.name || null} />);
    }

    // What's left, on its own screen: opened from the card before the day, or asked on arrival (below).
    const formsProps = tenantId && visitForms ? { brand: brandOf(tenant, tenantId, (appointmentData as any)?.serviceId || null), visit: visitForms, forms: allConsentForms || [], token, tenantId,
        guardianAsk: formRulesOf(tenant).guardian, businessName: tenant?.name || '', onChanged: () => setFormsNonce((n) => n + 1) } : null;
    if (showForms && formsProps && !isCompletionPending) return withFooter(<FormsLeftView {...formsProps} onBack={() => setShowForms(false)} />);
    const formsCard = formsProps && !isCompletionPending && thingsLeft(visitForms) > 0 ? <FormsLeftCard visit={visitForms!} onOpen={() => setShowForms(true)} /> : null;
    // The team asked for a different inspiration photo: added right here, with the photo tool from booking.
    const photosAsk = (appointmentData as any)?.photosAsk || null;
    const photosCard = photosAsk && tenantId && !isCompletionPending ? <PhotosAskCard ask={photosAsk} niche={chosenNiche(tenant)} token={token} tenantId={tenantId} accent={brandOf(tenant).accent} onSent={(t) => { setPhotosSent(t); setViewNonce((n) => n + 1); }} /> : null;
    const photosThanks = !photosCard && photosSent ? <PhotosSentCard text={photosSent} /> : null;
    // The team's marks on their photos, to say looks good or reply (it stays, answered, while they're on the page).
    const photosReply = (appointmentData as any)?.photosReply || null;
    const replyCard = !photosCard && photosReply && !isCompletionPending ? <PhotosReplyCard reply={photosReply} token={token} accent={brandOf(tenant).accent} /> : null;
    
    // v3 — NEW: cancellation flow. Reachable via a "Can't make it?" link on
    // the arrival screen further down. Uses the appointmentId + tenantId
    // already resolved on this page — no separate URL/token needed.
    if (showCancelFlow && tenantId && appointmentData?.id) {
        return (
            <CancelGateView
                tenantId={tenantId}
                appointmentId={appointmentData.id}
                accessKey={token}
                brand={brandOf(tenant, tenantId, (appointmentData as any)?.serviceId || null)}
                onBack={() => setShowCancelFlow(false)}
            />
        );
    }

    // v8 — reschedule flow. Reachable via "Need a different time?" on the
    // arrival screen; authenticated with this page's own token.
    if (showRescheduleFlow && tenantId && appointmentData?.id) {
        return (
            <RescheduleGateView
                tenantId={tenantId}
                appointmentId={appointmentData.id}
                k={token}
                brand={brandOf(tenant, tenantId, (appointmentData as any)?.serviceId || null)}
                onBack={() => setShowRescheduleFlow(false)}
            />
        );
    }

    if (showNotificationSettings && tenantId && tenant?.notificationDefaults?.allowClientOverride !== false) {
        return (
            <NotificationPreferencesView
                tenantId={tenantId}
                token={token}
                onBack={() => setShowNotificationSettings(false)}
                brand={brandOf(tenant, tenantId, (appointmentData as any)?.serviceId || null)}
            />
        );
    }

    // IMMERSIVE TRANSITION CHECK
    const isArrivedOrServicing = appointmentData?.checkInStatus === 'arrived' || appointmentData?.status === 'servicing';

    // Arrived with a form still not done: it's asked first, on their own phone, so the visit isn't held up at the desk.
    if (appointmentData?.checkInStatus === 'arrived' && appointmentData?.status !== 'servicing' && formsProps && visitForms && visitForms.left > 0 && !formsLater) {
        const who = String((assignedStaff as any)?.name || '').trim().split(/\s+/)[0] || null;
        return withFooter(<FormsLeftView {...formsProps} arriving first={String(client?.name || appointmentData?.clientName || '').split(' ')[0] || null} provider={who} onBack={() => setFormsLater(true)} />);
    }

    // The waiting experience (refreshments, explore services, help button) is a
    // business choice — OFF unless turned on in Settings, so guests are never
    // pointed to a concierge who isn't there. Off → a calm "you're checked in".
    if (isArrivedOrServicing && (tenant as any)?.guestExperienceEnabled !== true) {
        return withFooter(
            <CheckedInView brand={brandOf(tenant, tenantId, (appointmentData as any)?.serviceId || null)}
                first={String(client?.name || appointmentData?.clientName || '').split(' ')[0] || null}
                inService={appointmentData?.status === 'servicing'}
                who={(assignedStaff as any)?.name || null}
                startTime={appointmentData?.startTime as any}
                serviceName={service?.name || appointmentData?.serviceName || null}
                businessName={tenant?.name || null}
                phone={(tenant as any)?.phone || null}
                wifi={(tenant as any)?.wifiNetwork ? { network: (tenant as any).wifiNetwork, password: (tenant as any).wifiPassword || null } : null}
                timeline={(tenant as any)?.visitTimelineForClients !== false ? { items: (appointmentData as any)?.timelinePublic, showTimes: (appointmentData as any)?.timelineShowTimes !== false } : null}
                onMessage={() => setShowMessages(true)}
            />
        );
    }

    if (isArrivedOrServicing) {
        return withFooter(
            <VisitLounge
                brand={brandOf(tenant, tenantId, (appointmentData as any)?.serviceId || null)}
                client={client || null}
                inventory={inventory || []}
                activeRequests={Array.isArray(lounge?.requests) ? lounge.requests : []}
                appointment={appointmentData}
                staff={assignedStaff || null}
                resources={resources || []}
                memberships={memberships || []}
                isWaiting={appointmentData?.status !== 'servicing'}
                token={token}
                lounge={lounge}
                loungeError={loungeError}
                onRefresh={refreshLounge}
                onMessage={() => setShowMessages(true)}
                portalHref={tenantId && clientId ? `/portal/${encodeURIComponent(tenantId)}/${encodeURIComponent(clientId)}` : null}
                wifi={(tenant as any)?.wifiNetwork ? { network: (tenant as any).wifiNetwork, password: (tenant as any).wifiPassword || null } : null}
            />
        );
    }

    // v7 — NEW: stale/past-due appointment check. Only reached if none of
    // the above matched — status isn't canceled/completed, and the client
    // never checked in or started service. If the appointment's own end
    // time (or start time, if end time is missing) is more than 3 hours in
    // the past, treat this as a dead link rather than showing the normal
    // arrival flow. The 3-hour buffer intentionally still allows the
    // legitimate "running very late same-day" case to tap "I Have Arrived"
    // — this only catches genuinely stale appointments (yesterday, last
    // week, etc.) that nothing ever explicitly resolved.
    const referenceEnd = appointmentData?.endTime || appointmentData?.startTime;
    const isStaleUnresolved = referenceEnd
        ? (Date.now() - safeDate(referenceEnd).getTime()) > 3 * 60 * 60 * 1000
        : false;

    if (isStaleUnresolved) {
        return withFooter(<StaleAppointmentView brand={brandOf(tenant, tenantId, (appointmentData as any)?.serviceId || null)} tenantName={tenant?.name} tenantPhone={tenant?.twilioPhoneNumber} />);
    }

    // v8 — NEW: the mirror check. isSameDay rather than an hours-based
    // threshold deliberately — someone arriving 3 hours before a 2pm slot
    // is completely normal and shouldn't be blocked, but any DIFFERENT
    // calendar day (a week out, tomorrow, whenever) should not show live
    // arrival buttons at all.
    // "Is it the day?" on the business's own clock, the same one the screens speak in.
    const dayZone = brandOf(tenant).zone;
    const isTooEarly = appointmentData?.startTime
        ? !isSameDay(wallDate(safeDate(appointmentData.startTime), dayZone), wallDate(new Date(), dayZone))
            && safeDate(appointmentData.startTime).getTime() > Date.now()
        : false;

    // Where it happens, getting here (the business's own notes) and until when changing it is free.
    const place = placeOf(service, appointmentData);
    const visitNotes = tenant ? studioPage(tenant).visit : null;
    const address: string | null = (tenant as any)?.studioAddress || null;
    const freeUntil = appointmentData?.startTime ? freeUntilWords(tenant, service, deadlineStart(tenant, appointmentData, service).toISOString()) : '';

    if (isTooEarly) {
        return withFooter(
            <TooEarlyView disruption={(appointmentData as any)?.disruption || null} hasDeposit={(appointmentData as any)?.depositStatus === 'paid'} onDisruptionCancel={async (dep, extra) => { try { const r = await fetch('/api/appt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(extra?.action ? { tenantId, apptId: appointmentData?.id, k: token, ...extra } : { action: 'disruption_reply', tenantId, apptId: appointmentData?.id, k: token, choice: extra?.choice || (dep === 'keep' ? 'keep' : 'cancel'), deposit: dep === 'keep' ? null : dep }) }); return await r.json(); } catch { return { ok: false }; } }} brand={brandOf(tenant, tenantId, (appointmentData as any)?.serviceId || null)} providerName={(assignedStaff as any)?.name ? String((assignedStaff as any).name).split(' ')[0] : null}
                startTime={appointmentData!.startTime}
                serviceName={service?.name || appointmentData?.serviceName || null}
                first={String(client?.name || appointmentData?.clientName || '').split(' ')[0] || null}
                place={place} visit={visitNotes} address={address} freeUntil={freeUntil}
                onReschedule={() => setShowRescheduleFlow(true)}
                onCancel={() => setShowCancelFlow(true)}
                onMessage={() => setShowMessages(true)}
                notice={<>{confirmCard}{formsCard}{photosCard}{photosThanks}{replyCard}</>}
                stillToDo={!!formsCard || !!photosCard}
                notify={notifySlot}
                sooner={tenantId && safeDate(appointmentData!.startTime).getTime() - Date.now() > 24 * 3600e3 ? { tenantId, token, on: !!(appointmentData as any)?.soonerOn } : null}
                calendarUrl={tenantId && appointmentData?.id
                    ? `/api/appt?tenantId=${encodeURIComponent(tenantId)}&apptId=${encodeURIComponent(appointmentData.id)}&k=${encodeURIComponent(token)}`
                    : null}
            />
        );
    }

    return withFooter(
        <DayOfView
            brand={brandOf(tenant, tenantId, (appointmentData as any)?.serviceId || null)}
            visit={visitNotes}
            freeUntil={freeUntil}
            minutesAway={appointmentData?.startTime ? Math.round((safeDate(appointmentData.startTime).getTime() - Date.now()) / 60000) : null}
            pass={place?.kind && place.kind !== 'studio' ? null : <PassCode token={token} code={(appointmentData as any)?.shortCode || null} name={String(client?.name || appointmentData?.clientName || 'Your visit').split(' ')[0]}
                when={appointmentData?.startTime ? format(wallDate(safeDate(appointmentData.startTime), brandOf(tenant).zone), 'h:mm a') : ''} service={service?.name || null} business={tenant?.name || null} shape={(appointmentData as any)?.shape || null} />}
            place={place}
            shape={(appointmentData as any)?.shape || null}
            callNumber={(tenant as any)?.phone || (tenant as any)?.twilioPhoneNumber || null}
            lateChoices={(appointmentData as any)?.lateChoices || null}
            onLateChoice={async (choice) => {
                const call = async (payload: any) => { try { const r = await fetch('/api/appt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, apptId: appointmentData?.id, k: token, ...payload }) }); return await r.json(); } catch { return { ok: false }; } };
                const d = await call({ action: 'late_choice', choice });
                if (d?.ok && d.next === 'accept_offer') { const acc = await call({ action: 'provider_offer_reply', choice: 'accept' }); return { ...d, accepted: !!acc?.ok, error: acc?.ok ? undefined : acc?.error }; }
                return d;
            }}
            first={String(client?.name || appointmentData?.clientName || '').split(' ')[0] || 'there'}
            serviceName={service?.name || appointmentData?.serviceName || undefined}
            startTime={appointmentData?.startTime as any}
            provider={assignedStaff ? { name: assignedStaff.name, avatarUrl: (assignedStaff as any).avatarUrl } : null}
            address={address}
            graceMinutes={Number(resolvePolicy(tenant).late.graceMinutes.value) || 0}
            onArrived={() => updateStatus('arrived')}
            onMyWay={() => updateStatus('on_my_way')}
            onLate={(m, n) => updateStatus('running_late', m, n)}
            onReschedule={() => setShowRescheduleFlow(true)}
            onCancel={() => setShowCancelFlow(true)}
            onMessage={() => setShowMessages(true)}
            openLate={openLate}
            notice={<>{confirmCard}{formsCard}{photosCard}{photosThanks}{replyCard}</>}
            portalHref={tenantId && clientId ? `/portal/${encodeURIComponent(tenantId)}/${encodeURIComponent(clientId)}` : null}
            onNotifications={tenant?.notificationDefaults?.allowClientOverride !== false ? () => setShowNotificationSettings(true) : undefined}
            trip={tenantId && token && appointmentData?.id ? { tenantId, token, appointmentId: appointmentData.id } : null}
            reply={(appointmentData as any)?.lateReply || null}
            status={(appointmentData as any)?.checkInStatus || null}
            lateMinutes={(appointmentData as any)?.lateTimeMinutes ?? null}
            etaAt={(appointmentData as any)?.etaAt || null}
            selfCheckIn={(tenant as any)?.bookingPolicies?.onlineCheckIn !== false}
            providerDelay={(appointmentData as any)?.providerDelay || null}
            providerOffer={(appointmentData as any)?.providerOffer || null}
            disruption={(appointmentData as any)?.disruption || null}
            hasDeposit={(appointmentData as any)?.depositStatus === 'paid'}
            onDisruptionCancel={async (dep, extra) => { try { const r = await fetch('/api/appt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(extra?.action ? { tenantId, apptId: appointmentData?.id, k: token, ...extra } : { action: 'disruption_reply', tenantId, apptId: appointmentData?.id, k: token, choice: extra?.choice || (dep === 'keep' ? 'keep' : 'cancel'), deposit: dep === 'keep' ? null : dep }) }); return await r.json(); } catch { return { ok: false }; } }}
            onOfferReply={async (choice) => { try { const r = await fetch('/api/appt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'provider_offer_reply', tenantId, apptId: appointmentData?.id, k: token, choice }) }); return await r.json(); } catch { return { ok: false }; } }}
            onProviderReply={async (choice) => { try { const r = await fetch('/api/appt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'provider_delay_reply', tenantId, apptId: appointmentData?.id, k: token, choice }) }); return await r.json(); } catch { return { ok: false }; } }}
        />
    );
}
